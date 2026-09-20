// The degenerate cases docs/gaps-design.md §1.3.3 says an arrangement has to survive,
// each with the face count it must produce.
//
// Every one of them is a place where a naive implementation splits a boundary into a
// comb of slivers, loses a T-junction, or decides the same point is on two sides of the
// same edge. They are cheap to write and expensive to discover later.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SNAP_PASSES, arrange } from "../src/arrangement.ts";
import { analyze, parse } from "../src/index.ts";
import { flattenArc, mmRing, resolveArc, straightRing } from "../src/ring.ts";
import type { Arc, MmRing, P } from "../src/ring.ts";
import { rulesOf } from "./helpers.ts";

const FIXTURES = readdirSync(new URL("../fixtures/", import.meta.url))
  .filter((n) => n.endsWith(".json"))
  .map((n) => n.replace(/\.json$/, ""));

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

/**
 * gpt-5.5 §2.7: snap-rounding has a budget of passes, not a proof.
 *
 * `snapRound` stopped after 8 passes whatever state it was in, and `arrange` returned the
 * half-woven result as if it had settled. It can be exhausted — this file constructs a
 * document that never settles — so it now says so, with the region still moving, and
 * `derive` turns that into a `geometry.unstable` error.
 *
 * Two things were wrong, and the second hid the first. The termination test compared the
 * *length* of the chord list, and a pass can add chords that duplicate an (endpoints,
 * source edge) triple already there: the same arrangement, a longer list. On a soup of
 * crossing rings that growth is unbounded, so an arrangement that had converged on the
 * first pass looked unsettled for ever and burned the whole budget proving it. Settling
 * is now the triples ceasing to change, which is exactly what `arrange` reads.
 */
describe("snap-rounding says when it has not settled (gpt-5.5 §2.7)", () => {
  /** twelve long thin triangles overlapping inside a 24 mm window */
  const fan = (): MmRing[] => {
    const out: MmRing[] = [];
    for (let i = 0; i < 12; i++) {
      const y = 10000 + i * 2;
      out.push(straightRing([[0, y], [20000, 10000 + ((i * 7919) % 24)], [10000, y + 1]] as P[]));
    }
    return out;
  };

  /**
   * Six simple polygons 28 mm across, found by search. Two chords cycle for ever between
   * the same pair of hot pixels: the arrangement never reaches a fixed point at any
   * budget, which is the case §2.7 says cannot be assumed away.
   */
  const NEVER: P[][] = [
    [[4, 9], [28, 25], [26, 28]],
    [[6, 4], [25, 23], [20, 26], [19, 24]],
    [[29, 1], [22, 6], [13, 10], [5, 14]],
    [[0, 0], [28, 0], [24, 11]],
    [[6, 8], [13, 8], [15, 14], [13, 12]],
    [[1, 6], [29, 8], [25, 12], [24, 12]],
  ];

  it("takes seven passes on the fan, and reports nothing because seven is within the budget", () => {
    const rings = fan();
    // the smallest budget that settles it
    const needed = (() => {
      for (let p = 1; p <= 20; p++) if (arrange(rings, p).unstable === undefined) return p;
      return Infinity;
    })();
    assert.equal(needed, 7, "the fan is the adversarial case that needs several passes");
    assert.equal(arrange(rings, SNAP_PASSES).unstable, undefined);
  });

  it("names the region still moving when the budget is too small", () => {
    const u = arrange(fan(), 4).unstable;
    assert.ok(u, "four passes is not enough for the fan");
    assert.equal(u.passes, 4);
    assert.ok(u.moved > 0);
    // the fan's crossings are all in a 20 mm band around y = 10 m, and by the fourth pass
    // only a millimetre-wide sliver of it is still moving
    assert.ok(u.box.x1 - u.box.x0 < 2000 && u.box.y1 - u.box.y0 < 30, JSON.stringify(u.box));
  });

  it("reports a construction that never settles, at any budget", () => {
    const rings = NEVER.map((p) => straightRing(p));
    for (const budget of [SNAP_PASSES, 32, 64]) {
      const u = arrange(rings, budget).unstable;
      assert.ok(u, `settled at ${budget} passes, which this construction is not meant to do`);
      assert.equal(u.passes, budget);
      assert.equal(u.moved, 2, "two chords cycle between the same pair of hot pixels");
      assert.deepEqual(u.box, { x0: 13, y0: 9, x1: 14, y1: 10 }, "one millimetre square");
    }
  });

  it("turns it into a geometry.unstable error on the level, naming that region in metres", () => {
    const doc = {
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: Object.fromEntries(
        NEVER.map((pts, i) => [`r${i}`, { name: `R${i}`, kind: "storage", poly: pts.map(([x, y]) => [x / 1000, y / 1000]) }]),
      ),
      openings: [],
    };
    const f = analyze(parse(doc)).findings.filter((x) => x.rule === "geometry.unstable");
    assert.equal(f.length, 1);
    assert.equal(f[0]!.severity, "error");
    assert.equal(f[0]!.path, "rooms");
    assert.match(f[0]!.message, /after 8 rounds of snapping to the millimetre grid, 2 chords were still moving/);
    assert.match(f[0]!.message, /between \(0\.013, 0\.009\) and \(0\.014, 0\.01\)/);
    assert.deepEqual(f[0]!.at, [0.014, 0.01]);
  });

  it("never fires on a plan anyone would draw: every fixture settles", () => {
    for (const name of FIXTURES) {
      const doc = JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
      assert.ok(!rulesOf(analyze(parse(doc)).findings).includes("geometry.unstable"), name);
    }
  });
});
