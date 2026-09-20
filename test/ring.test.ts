import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  arcChords,
  arcLength,
  arcPoint,
  arcTangent,
  before,
  flattenArc,
  mmRing,
  onArc,
  resolveArc,
  reverseArc,
  ringArea,
  ringBox,
  ringPerimeter,
  ringPoints,
  pointInRing,
  sagitta,
  straightRing,
  toMm,
} from "../src/ring.ts";
import type { Arc, P } from "../src/ring.ts";

const arc = (a: P, b: P, r: number, cw: boolean, large = false): Arc => {
  const r0 = resolveArc(a, b, r, cw, large);
  assert.ok(!("problem" in r0), "expected a resolvable arc");
  return r0 as Arc;
};

describe("arcs: resolved from endpoints, radius and a turn direction", () => {
  it("puts the centre where the radius says", () => {
    // a semicircle from (0,0) to (0,2000) of radius 1000 has its centre at (0,1000)
    const a = arc([0, 0], [0, 2000], 1000, true);
    assert.deepEqual([Math.round(a.c[0]), Math.round(a.c[1])], [0, 1000]);
    assert.equal(a.r, 1000);
    assert.ok(Math.abs(Math.abs(a.span) - Math.PI) < 1e-9);
  });

  it("cw and ccw pick opposite bulges", () => {
    const cw = arc([0, 0], [0, 2000], 1000, true);
    const ccw = arc([0, 0], [0, 2000], 1000, false);
    assert.ok(arcPoint(cw, 0.5)[0] < 0 !== arcPoint(ccw, 0.5)[0] < 0, "one bulges west, the other east");
    assert.ok(Math.abs(Math.abs(arcPoint(cw, 0.5)[0]) - 1000) < 1e-6);
  });

  it("`large` picks the reflex arc", () => {
    const minor = arc([0, 0], [1000, 0], 1000, true, false);
    const major = arc([0, 0], [1000, 0], 1000, true, true);
    assert.ok(Math.abs(minor.span) < Math.PI);
    assert.ok(Math.abs(major.span) > Math.PI);
    assert.ok(Math.abs(Math.abs(minor.span) + Math.abs(major.span) - 2 * Math.PI) < 1e-9);
  });

  it("refuses a radius smaller than half the chord, saying what was needed", () => {
    const r = resolveArc([0, 0], [0, 4000], 1000, true, false);
    assert.ok("problem" in r && r.problem.kind === "radius_too_small");
    assert.equal((r as { problem: { needed: number } }).problem.needed, 2000);
  });

  it("measures arc length and sagitta", () => {
    const a = arc([0, 0], [0, 2000], 1000, true);
    assert.ok(Math.abs(arcLength(a) - Math.PI * 1000) < 1e-6);
    assert.ok(Math.abs(sagitta(a) - 1000) < 1e-6, "a semicircle's sagitta is its radius");
    const shallow = arc([0, 0], [1000, 0], 100000, true);
    assert.ok(sagitta(shallow) < 2, "a 100 m radius over a 1 m chord is all but straight");
  });

  it("has a tangent that points the way it is travelled", () => {
    const cw = arc([0, 0], [0, 2000], 1000, true);
    const t = arcTangent(cw, 0);
    assert.ok(Math.abs(t[0] - 1) < 1e-9 && Math.abs(t[1]) < 1e-9, `got ${t}`);
    const back = arcTangent(reverseArc(cw), 1);
    assert.ok(Math.abs(back[0] + 1) < 1e-9, "the reverse leaves the same point the other way");
  });
});

describe("flattenArc: the same chords whichever neighbour asks", () => {
  it("is identical for an arc and its reverse", () => {
    const a = arc([0, 0], [0, 6000], 3000, true);
    const fwd = flattenArc(a);
    const rev = flattenArc(reverseArc(a));
    assert.deepEqual(fwd, [...rev].reverse());
  });

  it("is identical for the two spaces that share a wall, whichever way each authored it", () => {
    // room A draws the arc west-about from north to south; room B draws the same
    // boundary the other way round, which is the same circle with the sweep flipped
    const a = arc([0, 0], [0, 6000], 3000, true);
    const b = arc([0, 6000], [0, 0], 3000, false);
    assert.deepEqual(flattenArc(a), [...flattenArc(b)].reverse());
  });

  it("takes 61 chords over an R = 3 m semicircle, as the design doc measured", () => {
    assert.equal(arcChords(arc([0, 0], [0, 6000], 3000, true)), 61);
    assert.equal(arcChords(arc([0, 0], [0, 1200], 600, true)), 28);
    assert.equal(arcChords(arc([0, 0], [0, 12000], 6000, true)), 87);
  });

  it("keeps every chord within the sagitta of the true arc", () => {
    const a = arc([0, 0], [0, 6000], 3000, true);
    const pts = [a.a, ...flattenArc(a), a.b];
    for (let i = 0; i + 1 < pts.length; i++) {
      const mx = (pts[i]![0] + pts[i + 1]![0]) / 2;
      const my = (pts[i]![1] + pts[i + 1]![1]) / 2;
      const d = Math.abs(Math.hypot(mx - a.c[0], my - a.c[1]) - a.r);
      assert.ok(d <= 1.5, `chord ${i} strays ${d.toFixed(3)} mm`);
    }
  });

  it("orders points lexicographically from the smaller endpoint", () => {
    assert.equal(before([0, 0], [0, 1]), true);
    assert.equal(before([1, 0], [0, 99]), false);
  });
});

describe("ringArea: exact over arcs", () => {
  it("measures a rectangle the way shoelace always did", () => {
    const r = straightRing([
      [0, 0],
      [4000, 0],
      [4000, 3000],
      [0, 3000],
    ]);
    assert.equal(ringArea(r), 12_000_000);
    assert.equal(ringPerimeter(r), 14000);
  });

  it("measures a circle written as two semicircles to the square millimetre", () => {
    const R = 3000;
    const ring = mmRing({
      pts: [
        [0, -3],
        [0, 3],
      ],
      arcs: [
        { r: 3, sweep: "cw", large: false },
        { r: 3, sweep: "cw", large: false },
      ],
    });
    assert.ok(Math.abs(Math.abs(ringArea(ring)) - Math.PI * R * R) < 1, `got ${ringArea(ring)}`);
    assert.ok(Math.abs(ringPerimeter(ring) - 2 * Math.PI * R) < 1e-6);
  });

  it("measures a stadium: a rectangle with two semicircular ends", () => {
    // 6 m × 4 m core with R = 2 m ends → 24 + π·4
    const ring = mmRing({
      pts: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      arcs: [undefined, { r: 2, sweep: "cw", large: false }, undefined, { r: 2, sweep: "cw", large: false }],
    });
    const want = (24 + Math.PI * 4) * 1e6;
    assert.ok(Math.abs(Math.abs(ringArea(ring)) - want) < 10, `got ${ringArea(ring)}, want ${want}`);
  });

  it("flips sign with the winding and not with the arcs", () => {
    const ring = mmRing({
      pts: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      arcs: [undefined, undefined, undefined, undefined],
    });
    const rev = mmRing({ pts: [...ring.pts].map((p) => [p[0] / 1000, p[1] / 1000] as [number, number]).reverse(), arcs: [undefined, undefined, undefined, undefined] });
    assert.equal(Math.sign(ringArea(ring)), -Math.sign(ringArea(rev)));
  });
});

describe("ringBox / pointInRing", () => {
  it("includes an arc's bulge past its chord", () => {
    const ring = mmRing({
      pts: [
        [0, 0],
        [0, 6],
      ],
      arcs: [{ r: 3, sweep: "cw", large: false }, undefined],
    });
    // clockwise on the page from the top of a clock face goes east, so the bulge does
    const b = ringBox(ring);
    assert.equal(b.x0, 0);
    assert.equal(b.x1, 3000, "the eastern bulge reaches x = 3 m");
  });

  it("classifies points inside and outside a round room", () => {
    const ring = mmRing({
      pts: [
        [0, -3],
        [0, 3],
      ],
      arcs: [
        { r: 3, sweep: "cw", large: false },
        { r: 3, sweep: "cw", large: false },
      ],
    });
    assert.equal(pointInRing([0, 0], ring), true);
    assert.equal(pointInRing([2900, 0], ring), true);
    assert.equal(pointInRing([3100, 0], ring), false);
    assert.equal(ringPoints(ring).length, arcChords(ring.arcs[0]!) + arcChords(ring.arcs[1]!));
  });

  it("knows which rays an arc spans", () => {
    const a = arc([3000, 0], [0, 3000], 3000, true); // centre (0,0), quarter turn east→south
    assert.equal(onArc(a, 0), true);
    assert.equal(onArc(a, Math.PI / 2), true);
    assert.equal(onArc(a, Math.PI), false);
  });

  it("converts metres to millimetres without float residue", () => {
    assert.equal(toMm(4.95), 4950);
    assert.equal(toMm(0.1 + 0.2), 300);
  });
});
