import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  areaBoth,
  areaOnly,
  arrange,
  coveredArea,
  distanceToRings,
  facesWhere,
  orient,
  poleOfInaccessibility,
  segmentsCross,
} from "../src/arrangement.ts";
import { mmRing, ringArea, straightRing } from "../src/ring.ts";
import type { MmRing, P } from "../src/ring.ts";

const box = (x: number, y: number, w: number, h: number): MmRing =>
  straightRing([
    [x * 1000, y * 1000],
    [(x + w) * 1000, y * 1000],
    [(x + w) * 1000, (y + h) * 1000],
    [x * 1000, (y + h) * 1000],
  ]);

const bounded = (a: ReturnType<typeof arrange>) => a.faces.filter((_, i) => i !== a.outer);

describe("predicates: exact at degree two", () => {
  it("orients three points", () => {
    assert.ok(orient([0, 0], [1000, 0], [0, 1000]) > 0, "y grows south, so this turns clockwise on the page");
    assert.equal(orient([0, 0], [1000, 0], [2000, 0]), 0);
  });

  it("stays exact at a hundred metres", () => {
    // the headroom claim: |cross| ≤ 4e10 against 2^53
    const a: P = [0, 0];
    const b: P = [100_000, 100_000];
    assert.equal(orient(a, b, [100_000, 99_999]), -100_000 * 1);
    assert.ok(Number.isSafeInteger(orient(a, b, [100_000, 99_999])));
  });

  it("detects crossings, touches and collinear overlap", () => {
    assert.equal(segmentsCross([0, 0], [10, 10], [0, 10], [10, 0]), true);
    assert.equal(segmentsCross([0, 0], [10, 0], [10, 0], [20, 0]), true, "touching counts");
    assert.equal(segmentsCross([0, 0], [10, 0], [5, 0], [15, 0]), true, "overlap counts");
    assert.equal(segmentsCross([0, 0], [10, 0], [0, 1], [10, 1]), false);
  });
});

describe("arrange: faces are the regions the plan actually has", () => {
  it("gives two rooms one face each, plus the unbounded one", () => {
    const a = arrange([box(0, 0, 4, 3), box(4, 0, 3, 3)]);
    assert.equal(a.faces.length, 3);
    assert.equal(bounded(a).length, 2);
    for (const f of bounded(a)) assert.ok(f.area > 0, "a bounded face winds the other way from the outer one");
    assert.deepEqual(
      bounded(a)
        .map((f) => f.tags)
        .sort(),
      [[0], [1]],
    );
    assert.equal(Math.round(bounded(a).reduce((s, f) => s + f.area, 0)), 21_000_000);
  });

  it("introduces no coordinate a rectilinear plan did not author", () => {
    const a = arrange([box(0, 0, 4, 3), box(4, 0, 3, 3), box(0, 3, 7, 2)]);
    const authored = new Set([0, 3000, 4000, 5000, 7000]);
    for (const [x, y] of a.verts) assert.ok(authored.has(x) && authored.has(y), `constructed (${x}, ${y})`);
  });

  it("splits a long edge at a T-junction", () => {
    // one room spanning 0..6 with two below it splitting at x = 3
    const a = arrange([box(0, 0, 6, 2), box(0, 2, 3, 2), box(3, 2, 3, 2)]);
    assert.equal(bounded(a).length, 3);
    assert.ok(a.verts.some(([x, y]) => x === 3000 && y === 2000), "the T-junction became a vertex");
  });

  it("finds the hole four rooms leave in the middle", () => {
    const a = arrange([box(0, 0, 3, 1), box(0, 2, 3, 1), box(0, 1, 1, 1), box(2, 1, 1, 1)]);
    const hole = bounded(a).filter((f) => f.tags.length === 0);
    assert.equal(hole.length, 1, "one hole, not one per cell");
    assert.equal(Math.round(hole[0]!.area), 1_000_000);
    assert.deepEqual(hole[0]!.probe.map(Math.round), [1500, 1500]);
  });

  it("keeps two holes apart", () => {
    const ring = (dx: number) => [box(dx, 0, 3, 1), box(dx, 2, 3, 1), box(dx, 1, 1, 1), box(dx + 2, 1, 1, 1)];
    const a = arrange([...ring(0), ...ring(3)]);
    assert.equal(bounded(a).filter((f) => f.tags.length === 0).length, 2);
  });

  it("gives an overlap its own face, tagged with both claimants", () => {
    const a = arrange([box(0, 0, 4, 3), box(3, 0, 3, 3)]);
    const both = bounded(a).filter((f) => f.tags.length === 2);
    assert.equal(both.length, 1);
    assert.deepEqual(both[0]!.tags, [0, 1]);
    assert.equal(Math.round(both[0]!.area), 3_000_000);
  });

  it("handles a room entirely inside another: the outer face keeps its hole", () => {
    const a = arrange([box(0, 0, 10, 10), box(3, 3, 2, 2)]);
    const outerRoom = bounded(a).find((f) => f.tags.length === 1 && f.tags[0] === 0)!;
    assert.equal(Math.round(outerRoom.area), 96_000_000, "100 m² less the 4 m² island");
    assert.equal(outerRoom.cycles.length, 2, "one outer ring and one hole");
  });

  it("sees an L-shaped envelope as no hole at all", () => {
    const a = arrange([box(0, 0, 6, 3), box(0, 3, 3, 3)]);
    assert.equal(bounded(a).filter((f) => f.tags.length === 0).length, 0);
  });
});

describe("arrange: arcs", () => {
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

  it("gives a round room one face of the right area", () => {
    const a = arrange([roundRoom(0, 0, 3)]);
    assert.equal(bounded(a).length, 1);
    const want = Math.PI * 9e6;
    assert.ok(Math.abs(bounded(a)[0]!.area - want) / want < 2e-4, `got ${bounded(a)[0]!.area}`);
  });

  it("two rooms sharing an R = 3 m semicircular wall produce no sliver at all", () => {
    // the measured failure the canonical flattening exists to prevent: out of phase,
    // this pair produced 61 sliver faces totalling 277 cm² (docs/gaps-design.md §1.3.3)
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
    const slivers = bounded(a).filter((f) => f.tags.length === 0);
    assert.deepEqual(
      slivers.map((f) => Math.round(f.area)),
      [],
      `expected no sliver faces, got ${slivers.length} totalling ${Math.round(slivers.reduce((s, f) => s + f.area, 0)) / 100} cm²`,
    );
    assert.equal(bounded(a).length, 2);
    for (const f of bounded(a)) assert.equal(f.tags.length, 1);
    // and the two faces still measure what their rings measure
    assert.ok(Math.abs(bounded(a)[0]!.area + bounded(a)[1]!.area - Math.abs(ringArea(west)) - Math.abs(ringArea(east))) < 5000);
  });

  it("splits two rooms whose arcs are tangent into exactly two faces", () => {
    const a = arrange([roundRoom(0, 0, 3), roundRoom(6, 0, 3)]);
    assert.equal(bounded(a).length, 2);
    assert.equal(bounded(a).filter((f) => f.tags.length !== 1).length, 0);
  });

  it("cuts an arc where another ring's edge crosses it", () => {
    const a = arrange([roundRoom(0, 0, 3), box(-1, -5, 2, 10)]);
    assert.ok(bounded(a).length >= 3, `expected the arc to be cut, got ${bounded(a).length} faces`);
    assert.equal(bounded(a).filter((f) => f.tags.length === 2).length, 1);
  });
});

describe("overlay: booleans as face predicates", () => {
  it("measures union, intersection and difference from one arrangement", () => {
    const a = arrange([box(0, 0, 4, 4), box(2, 2, 4, 4)]);
    assert.equal(Math.round(coveredArea(a, 1)), 28_000_000, "union: 16 + 16 − 4");
    assert.equal(Math.round(coveredArea(a, 2)), 4_000_000, "intersection");
    assert.equal(Math.round(areaOnly(a, 0, new Set([1]))), 12_000_000, "difference");
    assert.equal(Math.round(areaBoth(a, 0, 1)), 4_000_000);
  });

  it("traces the outline of a union, holes included", () => {
    const a = arrange([box(0, 0, 3, 1), box(0, 2, 3, 1), box(0, 1, 1, 1), box(2, 1, 1, 1)]);
    const rings = facesWhere(a, (tags) => tags.length > 0);
    assert.equal(rings.length, 2, "the ring of rooms and the hole inside it");
    const areas = rings.map((r) => Math.abs(ringArea(straightRing(r)))).sort((m, n) => n - m);
    assert.equal(Math.round(areas[0]!), 9_000_000);
    assert.equal(Math.round(areas[1]!), 1_000_000);
  });

  it("traces one outline for an L-shaped envelope", () => {
    const a = arrange([box(0, 0, 6, 3), box(0, 3, 3, 3)]);
    const rings = facesWhere(a, (tags) => tags.length > 0);
    assert.equal(rings.length, 1);
    assert.equal(rings[0]!.length, 6, "six corners, the collinear ones dropped");
    assert.equal(Math.abs(Math.round(ringArea(straightRing(rings[0]!)))), 27_000_000);
  });
});

describe("poleOfInaccessibility", () => {
  const square = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];

  it("puts a square's pole at its centre, with the inradius", () => {
    const p = poleOfInaccessibility([square(0, 0, 4000, 4000)]);
    assert.deepEqual(p.at.map(Math.round), [2000, 2000]);
    assert.ok(Math.abs(p.r - 2000) < 1);
  });

  it("finds the inradius of a rectangle, which is half its short side", () => {
    const p = poleOfInaccessibility([square(0, 0, 8000, 3000)]);
    assert.ok(Math.abs(p.r - 1500) < 1, `got r = ${p.r}`);
  });

  it("stays out of a hole", () => {
    const p = poleOfInaccessibility([square(0, 0, 10_000, 10_000), [...square(1000, 1000, 9000, 9000)].reverse()]);
    assert.ok(p.r < 600, `a 1 m frame has no room for a bigger circle than ${p.r} mm`);
  });

  it("is deterministic: the same rings give the same point every time", () => {
    const rings = [square(0, 0, 7000, 4000)];
    const a = poleOfInaccessibility(rings);
    const b = poleOfInaccessibility(rings);
    assert.deepEqual(a, b);
  });

  it("measures signed distance", () => {
    const rings = [square(0, 0, 4000, 4000)];
    assert.ok(distanceToRings([2000, 2000], rings) > 0);
    assert.ok(distanceToRings([5000, 2000], rings) < 0);
  });
});
