import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyze } from "../src/index.ts";
import { parse } from "../src/parse.ts";
import { has, rect, twoRooms } from "./helpers.ts";
import type { Finding } from "../src/types.ts";

const run = (input: unknown, rules = {}) => analyze(parse(input), rules).findings;
const only = (findings: Finding[], rule: string) => findings.filter((f) => f.rule === rule);

describe("rules: a sound two-room plan is clean", () => {
  it("has no findings", () => {
    assert.deepEqual(run(twoRooms()), []);
  });
});

describe("rules: entrance & reachability", () => {
  it("entrance.missing is an error and suppresses reach.unreachable noise", () => {
    const f = run(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8 }] }));
    assert.ok(has(f, "entrance.missing"));
    assert.ok(!has(f, "reach.unreachable"));
  });
  it("entrance.multiple is info", () => {
    const f = run(twoRooms({ openings: [...twoRooms().openings, { type: "door", between: ["exterior", "b"], on: { room: "b", side: "north" }, width: 0.9 }] }));
    assert.equal(only(f, "entrance.multiple")[0]!.severity, "info");
  });
  it("space.no_access for a room with no door, and reach.unreachable for an isolated group", () => {
    const f = run({
      rooms: {
        a: { kind: "living", poly: rect(0, 0, 4, 3) },
        b: { kind: "bedroom", poly: rect(4, 0, 3, 3) },
        c: { kind: "bedroom", poly: rect(7, 0, 3, 3) },
        d: { kind: "storage", poly: rect(0, 3, 10, 2) },
      },
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9 },
        { type: "door", between: ["b", "c"], width: 0.8 },
      ],
    });
    assert.deepEqual(only(f, "space.no_access").map((x) => x.rooms), [["d"]]);
    assert.deepEqual(only(f, "reach.unreachable").map((x) => x.rooms![0]).sort(), ["b", "c"]);
  });
  it("cased openings count as access", () => {
    const f = run(twoRooms({ openings: [twoRooms().openings[0], { type: "cased", between: ["a", "b"], width: 1.2 }] }));
    assert.ok(!has(f, "reach.unreachable"));
  });
});

describe("rules: light", () => {
  it("habitable.no_window names the exterior faces available", () => {
    const f = run(twoRooms({ openings: twoRooms().openings.slice(0, 2) }));
    const w = only(f, "habitable.no_window");
    assert.equal(w.length, 2);
    assert.match(w.find((x) => x.rooms![0] === "b")!.message, /north\/south\/east|exterior wall/);
  });
  it("a window onto a courtyard counts as daylight", () => {
    const plan = (outdoor: Record<string, unknown> | undefined) => ({
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: {
        hall: { kind: "hall", poly: rect(0, 0, 3, 1) },
        bed: { kind: "bedroom", poly: rect(0, 1, 1, 1) },
        kit: { kind: "kitchen", poly: rect(2, 1, 1, 1) },
        liv: { kind: "living", poly: rect(0, 2, 3, 1) },
      },
      ...(outdoor ? { outdoor } : {}),
      openings: [
        { type: "door", between: ["exterior", "hall"], on: { room: "hall", side: "north" }, width: 0.9, entrance: true },
        { type: "door", between: ["hall", "bed"], width: 0.8 },
        { type: "door", between: ["hall", "kit"], width: 0.8 },
        { type: "door", between: ["kit", "liv"], width: 0.8 },
        // bed's ONLY window faces the courtyard
        { type: "window", between: ["exterior", "bed"], on: { room: "bed", side: "east" }, width: 0.6 },
        { type: "window", between: ["exterior", "kit"], on: { room: "kit", side: "east" }, width: 0.6 },
        { type: "window", between: ["exterior", "liv"], on: { room: "liv", side: "south" }, width: 1.2 },
      ],
    });
    const withPatio = run(plan({ patio: { poly: rect(1, 1, 1, 1) } }));
    assert.ok(!has(withPatio, "habitable.no_window"), "courtyard window lights the bedroom");
    assert.ok(!has(withPatio, "window.not_exterior"));
    assert.ok(!has(withPatio, "tiling.gap"));
    // without the courtyard declared, that same wall is interior and the void is a hole
    const without = run(plan(undefined));
    assert.ok(has(without, "tiling.gap"));
  });
  it("wet.no_window is a warning and habitable wins over wet", () => {
    const f = run({
      rooms: { a: { kind: "living", poly: rect(0, 0, 4, 3) }, w: { kind: "wc", poly: rect(4, 0, 2, 3) } },
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9 },
        { type: "door", between: ["a", "w"], width: 0.7 },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1 },
      ],
    });
    assert.deepEqual(only(f, "wet.no_window").map((x) => [x.rooms![0], x.severity]), [["w", "warning"]]);
  });
});

describe("rules: adjacency semantics", () => {
  const base = (kb: string, extra: Record<string, unknown> = {}) =>
    run({
      rooms: { a: { kind: "living", poly: rect(0, 0, 4, 3) }, b: { kind: kb, poly: rect(4, 0, 3, 3) }, ...extra },
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9 },
        { type: "door", between: ["a", "b"], width: 0.8 },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1 },
        { type: "window", between: ["exterior", "b"], on: { room: "b", side: "north" }, width: 1 },
      ],
    });
  it("wet.opens_to_kitchen", () => {
    const f = run({
      rooms: { k: { kind: "kitchen", poly: rect(0, 0, 4, 3) }, w: { kind: "wc", poly: rect(4, 0, 2, 3) } },
      openings: [
        { type: "door", between: ["exterior", "k"], on: { room: "k", side: "west" }, width: 0.9 },
        { type: "door", between: ["k", "w"], width: 0.7 },
        { type: "window", between: ["exterior", "k"], on: { room: "k", side: "north" }, width: 1 },
        { type: "window", between: ["exterior", "w"], on: { room: "w", side: "north" }, width: 0.6 },
      ],
    });
    assert.ok(has(f, "wet.opens_to_kitchen"));
  });
  it("privacy.bedroom_off_living is info", () => {
    assert.equal(only(base("bedroom"), "privacy.bedroom_off_living")[0]!.severity, "info");
    assert.ok(!has(base("office"), "privacy.bedroom_off_living"));
  });
  it("privacy.bedroom_through_route is a warning", () => {
    const f = run({
      rooms: { h: { kind: "hall", poly: rect(0, 0, 2, 3) }, b1: { kind: "bedroom", poly: rect(2, 0, 3, 3) }, b2: { kind: "bedroom", poly: rect(5, 0, 3, 3) } },
      openings: [
        { type: "door", between: ["exterior", "h"], on: { room: "h", side: "west" }, width: 0.9 },
        { type: "door", between: ["h", "b1"], width: 0.8 },
        { type: "door", between: ["b1", "b2"], width: 0.8 },
        { type: "window", between: ["exterior", "b1"], on: { room: "b1", side: "north" }, width: 1 },
        { type: "window", between: ["exterior", "b2"], on: { room: "b2", side: "north" }, width: 1 },
      ],
    });
    assert.equal(only(f, "privacy.bedroom_through_route")[0]!.severity, "warning");
  });
});

describe("rules: sizes", () => {
  it("room.min_dimension uses the largest clear rectangle and per-kind thresholds", () => {
    const f = run(twoRooms({ rooms: { a: { kind: "living", poly: rect(0, 0, 4, 3) }, b: { kind: "bedroom", poly: rect(4, 0, 2, 3) } } }));
    const m = only(f, "room.min_dimension");
    assert.deepEqual(m.map((x) => x.rooms![0]), ["b"]);
    assert.match(m[0]!.message, /2 × 3 m; comfort minimum for a bedroom is 2.4 m/);
  });
  it("thresholds are configurable", () => {
    const f = run(twoRooms(), { minDimension: { living: 5 } });
    assert.deepEqual(only(f, "room.min_dimension").map((x) => x.rooms![0]), ["a"]);
  });
  it("door.min_width distinguishes entrance from interior doors", () => {
    const f = run(twoRooms({ openings: [{ ...twoRooms().openings[0], width: 0.8 }, { type: "door", between: ["a", "b"], width: 0.6 }, ...twoRooms().openings.slice(2)] }));
    assert.equal(only(f, "door.min_width").length, 2);
  });
});

describe("rules: circulation & swings", () => {
  it("circulation.share fires above the threshold with the share in the message", () => {
    const f = run({
      rooms: { h: { kind: "hall", poly: rect(0, 0, 2, 3) }, a: { kind: "living", poly: rect(2, 0, 4, 3) } },
      openings: [
        { type: "door", between: ["exterior", "h"], on: { room: "h", side: "west" }, width: 0.9 },
        { type: "cased", between: ["h", "a"], width: 1.2 },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1 },
      ],
    });
    const c = only(f, "circulation.share")[0]!;
    assert.equal(c.severity, "info");
    assert.match(c.message, /33 %/);
  });
  it("door.swing_collision when two leaves sweep the same corner", () => {
    const f = run({
      rooms: { a: { kind: "living", poly: rect(0, 0, 4, 4) }, b: { kind: "bedroom", poly: rect(4, 0, 3, 4) }, c: { kind: "bedroom", poly: rect(0, 4, 4, 3) } },
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, position: 1 },
        { type: "door", between: ["a", "b"], width: 0.8, position: { from: "end", distance: 0.5 }, hinge: "end", swingInto: "a" },
        { type: "door", between: ["a", "c"], width: 0.8, position: { from: "end", distance: 0.5 }, hinge: "end", swingInto: "a" },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1 },
        { type: "window", between: ["exterior", "b"], on: { room: "b", side: "north" }, width: 1 },
        { type: "window", between: ["exterior", "c"], on: { room: "c", side: "south" }, width: 1 },
      ],
    });
    assert.equal(only(f, "door.swing_collision").length, 1);
  });
});

describe("findings ordering", () => {
  it("sorts error → warning → info", () => {
    const f = run(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8 }] }));
    const sev = f.map((x) => x.severity);
    const rank = { error: 0, warning: 1, info: 2 };
    for (let i = 1; i < sev.length; i++) assert.ok(rank[sev[i - 1]!] <= rank[sev[i]!]);
  });
});
