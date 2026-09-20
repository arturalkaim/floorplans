// The degenerate cases docs/gaps-design.md §1.3.3 says an arrangement has to survive,
// each with the face count it must produce.
//
// Every one of them is a place where a naive implementation splits a boundary into a
// comb of slivers, loses a T-junction, or decides the same point is on two sides of the
// same edge. They are cheap to write and expensive to discover later.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arrange } from "../src/arrangement.ts";
import { analyze, parse } from "../src/index.ts";
import { flattenArc, mmRing, resolveArc, straightRing } from "../src/ring.ts";
import type { Arc, MmRing, P } from "../src/ring.ts";
import { rulesOf } from "./helpers.ts";

const box = (x: number, y: number, w: number, h: number): MmRing =>
  straightRing([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]);

const bounded = (a: ReturnType<typeof arrange>) => a.faces.filter((_, i) => i !== a.outer);
const owned = (a: ReturnType<typeof arrange>) => bounded(a).filter((f) => f.tags.length > 0);
const holes = (a: ReturnType<typeof arrange>) => bounded(a).filter((f) => f.tags.length === 0);

describe("robustness: T-junctions", () => {
  it("splits one long edge once per neighbour and no more", () => {
    // the fixtures already contain 70 of these over 250 vertices
    const a = arrange([box(0, 0, 6000, 2000), box(0, 2000, 2000, 2000), box(2000, 2000, 2000, 2000), box(4000, 2000, 2000, 2000)]);
    assert.equal(bounded(a).length, 4);
    assert.equal(holes(a).length, 0);
    for (const x of [2000, 4000]) assert.ok(a.verts.some(([vx, vy]) => vx === x && vy === 2000), `no vertex at (${x}, 2000)`);
  });

  it("keeps a vertex that lies exactly on another ring's edge out of the interior", () => {
    // b's north-west corner sits in the middle of a's south edge, and nowhere else
    const a = arrange([box(0, 0, 6000, 2000), box(3000, 2000, 3000, 2000)]);
    assert.equal(bounded(a).length, 2);
    assert.equal(holes(a).length, 0);
    assert.ok(a.verts.some(([x, y]) => x === 3000 && y === 2000));
  });

  it("four rooms meeting at one point leave no face between them", () => {
    const a = arrange([box(0, 0, 2000, 2000), box(2000, 0, 2000, 2000), box(0, 2000, 2000, 2000), box(2000, 2000, 2000, 2000)]);
    assert.equal(bounded(a).length, 4);
    assert.equal(holes(a).length, 0);
  });
});

describe("robustness: near-coincident vertices", () => {
  it("a one-millimetre step is a face, not a silent tear", () => {
    // the smallest gap integer millimetres can express at all, walled in at both ends
    const a = arrange([
      box(0, 0, 4000, 2000),
      straightRing([[0, 2001], [4000, 2001], [4000, 4000], [0, 4000]]),
      box(-1000, 0, 1000, 4000),
      box(4000, 0, 1000, 4000),
    ]);
    assert.equal(owned(a).length, 4);
    assert.equal(holes(a).length, 1);
    assert.equal(holes(a)[0]!.area, 4000, "4 m × 1 mm");
  });

  it("snap-rounding never moves an authored coordinate on a rectilinear plan", () => {
    const a = arrange([box(0, 0, 4300, 3100), box(4300, 0, 2700, 3100), box(0, 3100, 7000, 1900)]);
    const authored = new Set([0, 1900, 3100, 2700, 4300, 5000, 7000]);
    for (const [x, y] of a.verts) assert.ok(authored.has(x) && authored.has(y), `constructed (${x}, ${y})`);
  });

  it("two edges crossing at a non-integer point land on one snapped vertex", () => {
    // a near-horizontal edge across a vertical one meets it at y = 2.916667 mm
    const slope = straightRing([[0, 0], [12000, 7], [12000, 3000], [0, 3000]]);
    const a = arrange([slope, box(5000, -2000, 2000, 2000)]);
    const at5000 = a.verts.filter(([x]) => x === 5000);
    assert.ok(at5000.length > 0);
    for (const [, y] of at5000) assert.ok(Number.isInteger(y), `${y} is not on the millimetre grid`);
  });
});

describe("robustness: shallow angles", () => {
  it("a wedge a millimetre deep over a metre is one face, of the area it looks", () => {
    const wedge = straightRing([[0, 0], [4000, 0], [4000, 2000], [3000, 2000], [3000, 1999], [0, 1999]]);
    const a = arrange([wedge, box(0, 1999, 3000, 2001)]);
    assert.equal(owned(a).length, 2);
    assert.equal(holes(a).length, 0, "the two rings meet along the shallow edge, so nothing is left over");
  });

  it("two edges a millimetre apart at one end leave exactly one thin face", () => {
    const a = arrange([
      box(0, 0, 3000, 2000),
      straightRing([[0, 2001], [3000, 2000], [3000, 4000], [0, 4000]]),
      box(-1000, 0, 1000, 4000),
    ]);
    assert.equal(owned(a).length, 3);
    assert.equal(holes(a).length, 1);
    assert.equal(holes(a)[0]!.area, 1500, "half of 3 m × 1 mm");
  });

  it("reports a sharp corner and says how much of both arms it costs", () => {
    const { findings } = analyze(
      parse({
        walls: { exterior: 0.3, partition: 0.12 },
        rooms: { a: { kind: "living", poly: [[0, 0], [8, 0], [0, 1]] } },
        openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1, entrance: true }],
      }),
    );
    const f = findings.find((x) => x.rule === "room.acute_corner");
    assert.ok(f, `expected room.acute_corner, got ${rulesOf(findings).join(", ")}`);
    // 7° apex, 0.15 m of wall face: 0.15 / tan(3.57°) ≈ 2.4 m of each arm is not floor
    assert.match(f.message, /has a 7° corner at \(8, 0\)/);
    assert.match(f.message, /the wall faces meet 2\.4\d+ m along each arm/);
  });
});

describe("robustness: arcs", () => {
  const arcOf = (a: P, b: P, r: number, cw: boolean): Arc => {
    const x = resolveArc(a, b, r, cw, false);
    assert.ok(!("problem" in x));
    return x as Arc;
  };
  const roundRoom = (cx: number, cy: number, r: number): MmRing =>
    mmRing({
      pts: [
        [cx, cy - r],
        [cx, cy + r],
      ],
      arcs: [
        { r, sweep: "cw", large: false },
        { r, sweep: "cw", large: false },
      ],
    });

  it("two tangent circles give two faces and no lens between them", () => {
    const a = arrange([roundRoom(0, 0, 3), roundRoom(6, 0, 3)]);
    assert.equal(bounded(a).length, 2);
    assert.equal(holes(a).length, 0);
  });

  it("an arc crossing a straight edge is cut at the crossing, on the grid", () => {
    // a vertical line through a circle: two crossings, both snapped to millimetres
    const a = arrange([roundRoom(0, 0, 3), straightRing([[1000, -5000], [2000, -5000], [2000, 5000], [1000, 5000]])]);
    assert.ok(bounded(a).length >= 3, `expected the arc to be cut, got ${bounded(a).length}`);
    for (const [x, y] of a.verts) assert.ok(Number.isInteger(x) && Number.isInteger(y));
    assert.equal(bounded(a).filter((f) => f.tags.length === 2).length, 1, "one lens claimed by both");
  });

  it("an arc that passes exactly through a lattice point keeps it as one vertex", () => {
    // a 3-4-5 circle: (3000, 4000) is exactly on the r = 5000 circle about the origin
    const arc = arcOf([0, -5000], [0, 5000], 5000, true);
    const pts = flattenArc(arc);
    const a = arrange([
      mmRing({
        pts: [
          [0, -5],
          [0, 5],
        ],
        arcs: [
          { r: 5, sweep: "cw", large: false },
          { r: 5, sweep: "cw", large: false },
        ],
      }),
      straightRing([[3000, 4000], [9000, 4000], [9000, 9000], [3000, 9000]]),
    ]);
    assert.ok(pts.length > 10);
    assert.equal(a.verts.filter(([x, y]) => x === 3000 && y === 4000).length, 1);
  });

  it("the same arc authored by both neighbours is one boundary, not a comb", () => {
    // the measured failure: out of phase this produced 61 faces totalling 277 cm²
    const west = mmRing({
      pts: [
        [0, -3],
        [0, 3],
        [-6, 3],
        [-6, -3],
      ],
      arcs: [{ r: 3, sweep: "cw", large: false }, undefined, undefined, undefined],
    });
    const east = mmRing({
      pts: [
        [0, 3],
        [0, -3],
        [6, -3],
        [6, 3],
      ],
      arcs: [{ r: 3, sweep: "ccw", large: false }, undefined, undefined, undefined],
    });
    const a = arrange([west, east]);
    assert.equal(bounded(a).length, 2);
    assert.equal(holes(a).length, 0);
  });

  it("a whole plan of arcs derives without a single gap", () => {
    const { findings } = analyze(
      parse({
        walls: { exterior: 0.3, partition: 0.12 },
        rooms: {
          n: {
            kind: "living",
            poly: [[0, -3], { arc: [0, 3], r: 3, sweep: "ccw" }, [0, 3]],
          },
          s: {
            kind: "living",
            poly: [[0, 3], { arc: [0, -3], r: 3, sweep: "ccw" }, [0, -3]],
          },
        },
        openings: [
          { type: "door", between: ["exterior", "n"], at: [0, -3], width: 1, entrance: true },
          { type: "door", between: ["n", "s"], at: [0, 0], width: 1 },
        ],
      }),
    );
    assert.ok(!rulesOf(findings).some((x) => x.startsWith("tiling.")), rulesOf(findings).join(", "));
  });
});
