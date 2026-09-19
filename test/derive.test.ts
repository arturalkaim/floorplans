import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { derive } from "../src/derive.ts";
import { doorSwing } from "../src/doors.ts";
import { parse } from "../src/parse.ts";
import { has, rect, rulesOf, twoRooms } from "./helpers.ts";

const analyze = (input: unknown) => derive(parse(input));

describe("derive: walls", () => {
  it("derives exterior and partition segments for two rooms", () => {
    const { model, findings } = analyze(twoRooms());
    assert.deepEqual(findings, []);
    // a: 0..4×0..3, b: 4..7×0..3 → 1 shared vertical + 6 exterior runs (top a, top b, bottom a, bottom b, west a, east b)
    const shared = model.walls.filter((w) => w.kind === "partition");
    assert.equal(shared.length, 1);
    assert.deepEqual({ axis: shared[0]!.axis, c: shared[0]!.c, from: shared[0]!.from, to: shared[0]!.to, neg: shared[0]!.neg, pos: shared[0]!.pos }, { axis: "v", c: 4, from: 0, to: 3.4, neg: "a", pos: "b" });
    assert.equal(model.walls.filter((w) => w.kind === "exterior").length, 6);
    assert.equal(shared[0]!.thickness, 0.12);
    assert.equal(model.walls.find((w) => w.kind === "exterior")!.thickness, 0.3);
  });
  it("splits a long edge into one segment per neighbour", () => {
    // hall 0..1 × 0..4 with three rooms stacked on its east side
    const { model } = analyze({
      rooms: {
        hall: { kind: "hall", poly: rect(0, 0, 1, 4) },
        r1: { poly: rect(1, 0, 2, 1) },
        r2: { poly: rect(1, 1, 2, 2) },
        r3: { poly: rect(1, 3, 2, 1) },
      },
    });
    const east = model.walls.filter((w) => w.axis === "v" && w.c === 1 && w.neg === "hall");
    assert.deepEqual(east.map((w) => [w.pos, w.from, w.to]), [["r1", 0, 1], ["r2", 1, 3], ["r3", 3, 4]]);
  });
  it("merges collinear pieces across T-junction vertices", () => {
    // room a spans 0..6; rooms b and c below it split at x=3 → a's north wall is one exterior segment
    const { model } = analyze({
      rooms: { a: { poly: rect(0, 0, 6, 2) }, b: { poly: rect(0, 2, 3, 2) }, c: { poly: rect(3, 2, 3, 2) } },
    });
    const north = model.walls.filter((w) => w.axis === "h" && w.c === 0);
    assert.equal(north.length, 1);
    assert.deepEqual([north[0]!.from, north[0]!.to], [0, 6]);
  });
});

describe("derive: tiling", () => {
  it("treats an enclosed void declared as outdoor as exterior, not a gap", () => {
    const courtyard = {
      rooms: {
        n: { poly: rect(0, 0, 3, 1) },
        s: { poly: rect(0, 2, 3, 1) },
        w: { poly: rect(0, 1, 1, 1) },
        e: { poly: rect(2, 1, 1, 1) },
      },
      outdoor: { patio: { poly: rect(1, 1, 1, 1) } },
    };
    const { model, findings } = analyze(courtyard);
    assert.ok(!has(findings, "tiling.gap"), "a declared courtyard is not a hole");
    assert.equal(model.walls.filter((w) => w.neg === "gap" || w.pos === "gap").length, 0);
    // the four walls around the courtyard are exterior walls, at exterior thickness
    const facing = model.walls.filter((w) => w.neg === "exterior" || w.pos === "exterior");
    assert.ok(facing.every((w) => w.kind === "exterior"));
    const south = model.walls.find((w) => w.axis === "h" && w.c === 1 && w.from === 1 && w.to === 2)!;
    assert.equal(south.kind, "exterior");
    assert.equal(south.thickness, 0.3);
  });
  it("flags a hole enclosed by rooms as tiling.gap, not exterior", () => {
    const ring = {
      rooms: {
        n: { poly: rect(0, 0, 3, 1) },
        s: { poly: rect(0, 2, 3, 1) },
        w: { poly: rect(0, 1, 1, 1) },
        e: { poly: rect(2, 1, 1, 1) },
      },
    };
    const { model, findings } = analyze(ring);
    assert.ok(has(findings, "tiling.gap"));
    assert.deepEqual(findings.find((f) => f.rule === "tiling.gap")!.at, [1.5, 1.5]);
    // walls facing the hole are partitions against "gap", not exterior
    const gapWalls = model.walls.filter((w) => w.neg === "gap" || w.pos === "gap");
    assert.equal(gapWalls.length, 4);
    assert.ok(gapWalls.every((w) => w.kind === "partition"));
  });
  it("flags overlapping rooms", () => {
    const { findings } = analyze({ rooms: { a: { poly: rect(0, 0, 4, 3) }, b: { poly: rect(3, 0, 3, 3) } } });
    const f = findings.find((x) => x.rule === "tiling.overlap")!;
    assert.ok(f);
    assert.deepEqual(f.rooms, ["a", "b"]);
  });
  it("a concave envelope (L-shaped house) has no gap", () => {
    const { findings } = analyze({ rooms: { a: { poly: rect(0, 0, 6, 3) }, b: { poly: rect(0, 3, 3, 3) } } });
    assert.equal(findings.length, 0);
  });
});

describe("derive: room metrics", () => {
  it("measures minDimension between wall faces, not on centrelines", () => {
    // one 2 x 1 room, every wall exterior at 0.30: clear is 1.70 x 0.70
    const { model } = analyze({
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: { a: { kind: "office", poly: rect(0, 0, 2, 1) } },
    });
    const m = model.rooms[0]!;
    assert.deepEqual([m.largestRect.x1 - m.largestRect.x0, m.largestRect.y1 - m.largestRect.y0], [2, 1]);
    assert.deepEqual([m.clearRect.w, m.clearRect.h], [1.7, 0.7]);
    assert.equal(m.minDimension, 0.7);
  });

  it("deducts each side separately, taking the thickest wall along it", () => {
    // b sits south of a, so a's south edge is a 0.12 partition and the rest 0.30 exterior
    const { model } = analyze({
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: { a: { kind: "office", poly: rect(0, 0, 2, 1) }, b: { kind: "living", poly: rect(0, 1, 2, 2) } },
    });
    const a = model.rooms.find((m) => m.room.id === "a")!;
    // width: 0.30/2 either side; height: 0.30/2 north (exterior) + 0.12/2 south (partition)
    assert.deepEqual([a.clearRect.w, a.clearRect.h], [1.7, 0.79]);
    assert.equal(a.minDimension, 0.79);
  });

  it("computes centreline and clear areas exactly for a single rectangle", () => {
    const { model } = analyze({ walls: { exterior: 0.3, partition: 0.12 }, rooms: { a: { poly: rect(0, 0, 4, 3) } } });
    const a = model.rooms[0]!;
    assert.equal(a.area, 12);
    assert.equal(a.clearArea, 9.99); // (4 − 0.3) × (3 − 0.3)
  });
  it("uses the right thickness per edge when a room has both exterior and partition walls", () => {
    const { model } = analyze(twoRooms());
    const a = model.rooms.find((m) => m.room.id === "a")!;
    // a is 4×3; west/north/south exterior (0.15 each), east partition (0.06)
    // clear = (4 − 0.15 − 0.06) × (3 − 0.3) = 3.79 × 2.7
    assert.equal(a.clearArea, 11.749);
  });
  it("reports largest clear rectangle and label point for an L", () => {
    const { model } = analyze({ rooms: { l: { poly: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]] } } });
    const l = model.rooms[0]!;
    assert.deepEqual(l.largestRect, { x0: 0, y0: 0, x1: 4, y1: 1 });
    // 1 m on centrelines is 0.70 m between the wall faces
    assert.deepEqual([l.clearRect.w, l.clearRect.h], [3.7, 0.7]);
    assert.equal(l.minDimension, 0.7);
    assert.deepEqual(l.labelAt, [2, 0.5]);
  });
  it("lists exterior faces", () => {
    const { model } = analyze(twoRooms());
    assert.deepEqual(model.rooms.find((m) => m.room.id === "a")!.exteriorFaces.sort(), ["north", "south", "west"]);
  });
});

describe("derive: openings", () => {
  it("resolves by room pair and positions from either jamb", () => {
    const { model, findings } = analyze(
      twoRooms({
        openings: [
          { type: "door", between: ["a", "b"], width: 0.8, position: { from: "start", distance: 1 } },
          { type: "window", between: ["exterior", "b"], on: { room: "b", side: "east" }, width: 1, position: { from: "end", distance: 1 } },
        ],
      }),
    );
    assert.deepEqual(rulesOf(findings), []);
    const [door, win] = model.openings;
    assert.deepEqual([door!.from, door!.to], [0.6, 1.4]);
    assert.deepEqual(door!.center, [4, 1]);
    assert.deepEqual([win!.from, win!.to], [1.9, 2.9]);
  });
  it("reports wall.unresolved with a hint listing real neighbours", () => {
    const { findings } = analyze({
      rooms: { a: { poly: rect(0, 0, 2, 2) }, b: { poly: rect(2, 0, 2, 2) }, c: { poly: rect(4, 0, 2, 2) } },
      openings: [{ type: "door", between: ["a", "c"], width: 0.8 }],
    });
    const f = findings.find((x) => x.rule === "wall.unresolved")!;
    assert.ok(f);
    assert.match(f.message, /a touches: the exterior, b/);
    assert.equal(f.opening, 0);
  });
  it("reports wall.ambiguous when a pair shares two segments, and side/near disambiguate", () => {
    const L = { rooms: { l: { kind: "living", poly: [[0, 0], [4, 0], [4, 4], [2, 4], [2, 2], [0, 2]] }, k: { kind: "kitchen", poly: rect(0, 2, 2, 2) } } };
    const amb = analyze({ ...L, openings: [{ type: "door", between: ["l", "k"], width: 0.8 }] });
    assert.ok(has(amb.findings, "wall.ambiguous"));
    const bySide = analyze({ ...L, openings: [{ type: "door", between: ["l", "k"], on: { room: "k", side: "north" }, width: 0.8 }] });
    assert.deepEqual(rulesOf(bySide.findings), []);
    assert.equal(bySide.model.openings[0]!.wall.axis, "h");
    const byNear = analyze({ ...L, openings: [{ type: "door", between: ["l", "k"], on: { room: "k", near: [2, 3] }, width: 0.8 }] });
    assert.equal(byNear.model.openings[0]!.wall.axis, "v");
  });
  it("reports opening.overflow, opening.collision, opening.near_corner", () => {
    const { findings } = analyze(
      twoRooms({
        openings: [
          { type: "door", between: ["a", "b"], width: 3.5 },
          { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1, position: 1 },
          { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1, position: 1.5 },
          { type: "window", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 1, position: 0.55 },
        ],
      }),
    );
    assert.ok(has(findings, "opening.overflow"));
    assert.ok(has(findings, "opening.collision"));
    const nc = findings.find((f) => f.rule === "opening.near_corner")!;
    assert.ok(nc);
    assert.equal(nc.opening, 3);
    assert.equal(nc.severity, "warning");
  });
  it("an opening exactly filling its wall is fine", () => {
    const { findings } = analyze(twoRooms({ openings: [{ type: "cased", between: ["a", "b"], width: 3 }] }));
    assert.deepEqual(rulesOf(findings), []);
  });
  it("rejects windows on interior walls and marks rooms with exterior windows", () => {
    const { model, findings } = analyze(twoRooms({ openings: [{ type: "window", between: ["a", "b"], width: 1 }, { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1 }] }));
    assert.ok(has(findings, "window.not_exterior"));
    assert.equal(model.rooms.find((m) => m.room.id === "a")!.exteriorWindow, true);
    assert.equal(model.rooms.find((m) => m.room.id === "b")!.exteriorWindow, false);
  });
  it("builds the access graph from doors and cased openings only", () => {
    const { model } = analyze(twoRooms());
    assert.deepEqual([...model.access.get("a")!].sort(), ["b", "exterior"]);
    assert.deepEqual([...model.access.get("b")!], ["a"]);
  });
});

describe("doorSwing", () => {
  it("opens 90° into the swing room from the chosen jamb", () => {
    const { model } = analyze(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8, position: 1, hinge: "end", swingInto: "a" }] }));
    const s = doorSwing(model.openings[0]!)!;
    assert.deepEqual(s.hinge, [4, 1.4]);
    assert.deepEqual(s.closed, [4, 0.6]);
    assert.deepEqual(s.open, [3.2, 1.4]); // west, into a
    assert.deepEqual(s.box, { x0: 3.2, y0: 0.6, x1: 4, y1: 1.4 });
  });
  it("is undefined for windows", () => {
    const { model } = analyze(twoRooms());
    assert.equal(doorSwing(model.openings.find((o) => o.spec.type === "window")!), undefined);
  });
});
