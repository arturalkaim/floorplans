import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse, PlanError } from "../src/parse.ts";
import { shoelace } from "../src/geometry.ts";
import { rect, twoRooms } from "./helpers.ts";

const issuesOf = (input: unknown): string[] => {
  try {
    parse(input);
    return [];
  } catch (e) {
    if (e instanceof PlanError) return e.issues.map((i) => i.path);
    throw e;
  }
};

describe("parse: basics", () => {
  it("parses a minimal plan and applies defaults", () => {
    const plan = parse(twoRooms());
    assert.equal(plan.walls.exterior, 0.3);
    assert.equal(plan.rooms.length, 2);
    const a = plan.rooms.find((r) => r.id === "a")!;
    assert.equal(a.habitable, true); // living
    assert.equal(a.wet, false);
    assert.equal(plan.openings[0]!.position, "center");
    assert.equal(plan.openings[1]!.swingInto, "b"); // defaults to the last-named room
    assert.equal(plan.openings[1]!.hinge, "start");
  });
  it("accepts a JSON string", () => {
    const plan = parse(JSON.stringify(twoRooms()));
    assert.equal(plan.rooms.length, 2);
  });
  it("rejects invalid JSON text", () => {
    assert.throws(() => parse("{ nope"), PlanError);
  });
  it("kind drives habitable / wet / circulation, flags override", () => {
    const plan = parse({
      rooms: {
        h: { kind: "hall", poly: rect(0, 0, 2, 2) },
        w: { kind: "wc", poly: rect(2, 0, 2, 2), wet: false },
        s: { kind: "storage", poly: rect(4, 0, 2, 2), habitable: true },
      },
    });
    const by = Object.fromEntries(plan.rooms.map((r) => [r.id, r]));
    assert.equal(by["h"]!.circulation, true);
    assert.equal(by["w"]!.wet, false);
    assert.equal(by["s"]!.habitable, true);
  });
});

describe("parse: schema errors carry paths", () => {
  it("reports several problems at once", () => {
    const paths = issuesOf({
      walls: { exterior: -1 },
      rooms: { "Bad Id": { poly: rect(0, 0, 1, 1) }, ok: { poly: [[0, 0], [1, 1], [0, 1]] } },
      openings: [{ type: "door", between: ["ok", "nope"], width: 0.8 }],
    });
    assert.ok(paths.includes("walls.exterior"));
    assert.ok(paths.includes("rooms.Bad Id"));
    assert.ok(paths.includes("rooms.ok.poly"));
    assert.ok(paths.includes("openings[0].between[1]"));
  });
  it("rejects reserved ids, bad kinds, bad opening fields", () => {
    const paths = issuesOf({
      rooms: { exterior: { poly: rect(0, 0, 1, 1) }, a: { kind: "ballroom", poly: rect(1, 0, 1, 1) } },
      openings: [
        { type: "window", between: ["exterior", "a"], width: 1, hinge: "start" },
        { type: "door", between: ["a", "a"], width: 1 },
        { type: "door", between: ["exterior", "a"], width: 1, swingInto: "b" },
        { type: "door", between: ["exterior", "a"], width: 0 },
        { type: "door", between: ["exterior", "a"], width: 1, position: { from: "middle", distance: 1 } },
        { type: "door", between: ["exterior", "a"], width: 1, on: { room: "b" } },
        { type: "arch", between: ["exterior", "a"], width: 1 },
      ],
    });
    for (const p of [
      "rooms.exterior",
      "rooms.a.kind",
      "openings[0].hinge",
      "openings[1].between",
      "openings[2].swingInto",
      "openings[3].width",
      "openings[4].position",
      "openings[5].on.room",
      "openings[6].type",
    ])
      assert.ok(paths.includes(p), `expected issue at ${p}, got ${paths.join(", ")}`);
  });
  it("requires geometry for every room", () => {
    assert.deepEqual(issuesOf({ rooms: { a: { name: "A" } } }), ["rooms.a"]);
  });
  it("reports a bad poly once, not also as missing geometry", () => {
    const bent = [[0, 0], [2, 0], [5, 7], [0, 7]];
    assert.deepEqual(issuesOf({ rooms: { a: { poly: bent } } }), ["rooms.a.poly"]);
    assert.deepEqual(
      issuesOf({ rooms: { a: { poly: rect(0, 0, 2, 2) } }, outdoor: { p: { poly: bent } } }),
      ["outdoor.p.poly"],
    );
  });
  it("accepts a numeric position as metres from start", () => {
    const plan = parse(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8, position: 1.25 }] }));
    assert.deepEqual(plan.openings[0]!.position, { from: "start", distance: 1.25 });
  });
});

describe("parse: layout grid compiles to polygons", () => {
  const grid = {
    walls: { exterior: 0.3, partition: 0.12 },
    layout: {
      cols: [3, 1, 3],
      rows: [3, 2],
      areas: ["bed hall bath", "living living living"],
    },
    rooms: {
      bed: { kind: "bedroom" },
      hall: { kind: "hall" },
      bath: { kind: "bath" },
      living: { kind: "living" },
    },
  };
  it("produces one rectilinear polygon per token", () => {
    const plan = parse(grid);
    const by = Object.fromEntries(plan.rooms.map((r) => [r.id, r]));
    assert.deepEqual(by["bed"]!.poly, [[0, 0], [3, 0], [3, 3], [0, 3]]);
    assert.deepEqual(by["hall"]!.poly, [[3, 0], [4, 0], [4, 3], [3, 3]]);
    assert.equal(Math.abs(shoelace(by["living"]!.poly)), 14);
  });
  it("accepts a multi-line string for areas and '.' for void", () => {
    const plan = parse({ ...grid, layout: { ...grid.layout, areas: "bed hall bath\nliving living ." } });
    assert.equal(Math.abs(shoelace(plan.rooms.find((r) => r.id === "living")!.poly)), 8);
  });
  it("builds L-shaped rooms from cells", () => {
    const plan = parse({
      layout: { cols: [2, 2], rows: [2, 2], areas: ["l l", "l x"] },
      rooms: { l: { kind: "living" }, x: { kind: "wc" } },
    });
    assert.equal(plan.rooms.find((r) => r.id === "l")!.poly.length, 6);
  });
  it("lets outdoor spaces sit on the grid too", () => {
    const plan = parse({
      layout: { cols: [3, 3], rows: [3], areas: ["room porch"] },
      rooms: { room: { kind: "living" } },
      outdoor: { porch: { covered: true } },
    });
    assert.equal(plan.outdoor.length, 1);
    assert.deepEqual(plan.outdoor[0]!.poly, [[3, 0], [6, 0], [6, 3], [3, 3]]);
  });
  it("rejects ragged rows, unknown tokens, split rooms, and double geometry", () => {
    assert.ok(issuesOf({ ...grid, layout: { ...grid.layout, areas: ["bed hall", "living living living"] } }).includes("layout.areas[0]"));
    assert.ok(issuesOf({ ...grid, layout: { ...grid.layout, areas: ["bed hall attic", "living living living"] } }).includes("layout.areas[0]"));
    assert.ok(issuesOf({ ...grid, layout: { ...grid.layout, areas: ["bed hall bed", "living living living"] } }).includes("rooms.bed"));
    assert.ok(issuesOf({ ...grid, rooms: { ...grid.rooms, bed: { kind: "bedroom", poly: rect(0, 0, 3, 3) } } }).includes("rooms.bed"));
    assert.ok(issuesOf({ ...grid, layout: { ...grid.layout, rows: [3] } }).includes("layout.areas"));
  });
});
