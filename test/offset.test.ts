import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { offsetArea, offsetRing } from "../src/offset.ts";
import { mmRing, ringArea, straightRing } from "../src/ring.ts";
import type { MmRing, P } from "../src/ring.ts";

/**
 * The closed form the library used before: `A − Σ len·t/2 + Σ_corners ±t₁t₂/4`, exact
 * for rectilinear rooms and wrong everywhere else. Kept here, and only here, as the
 * thing the constructed offset has to agree with on the shapes it was right about.
 */
function closedForm(pts: P[], d: (edge: number) => number): number {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += (pts[i]![0] * pts[(i + 1) % n]![1] - pts[(i + 1) % n]![0] * pts[i]![1]) / 2;
  const orient = Math.sign(area);
  let deduct = 0;
  for (let i = 0; i < n; i++) deduct += Math.hypot(pts[(i + 1) % n]![0] - pts[i]![0], pts[(i + 1) % n]![1] - pts[i]![1]) * d(i);
  let corners = 0;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    corners += (Math.sign(cross) === orient ? 1 : -1) * d((i - 1 + n) % n) * d(i);
  }
  return Math.max(0, Math.abs(area) - deduct + corners);
}

/**
 * Independent truth for a convex ring: the clear region is the intersection of the
 * inward half-planes, whose width on each horizontal line is an exact interval. Nothing
 * here knows how `offsetRing` mitres a corner.
 */
function integrateHalfPlanes(pts: P[], d: (edge: number) => number, rows = 20_000): number {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += (pts[i]![0] * pts[(i + 1) % n]![1] - pts[(i + 1) % n]![0] * pts[i]![1]) / 2;
  const inward = Math.sign(area) >= 0 ? 1 : -1;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    // unit inward normal, and the offset the half-plane is pushed to
    const nx = (-dy / l) * inward;
    const ny = (dx / l) * inward;
    return { nx, ny, c: nx * a[0] + ny * a[1] + d(i) };
  });
  const ys = pts.map((p) => p[1]);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const step = (y1 - y0) / rows;
  let total = 0;
  for (let k = 0; k < rows; k++) {
    const y = y0 + step * (k + 0.5);
    let lo = -Infinity;
    let hi = Infinity;
    let empty = false;
    for (const L of lines) {
      // nx·x ≥ c − ny·y
      const rhs = L.c - L.ny * y;
      if (Math.abs(L.nx) < 1e-12) {
        if (0 < rhs - 1e-9) empty = true;
      } else if (L.nx > 0) lo = Math.max(lo, rhs / L.nx);
      else hi = Math.min(hi, rhs / L.nx);
    }
    if (!empty && hi > lo) total += (hi - lo) * step;
  }
  return total;
}

const rect = (x: number, y: number, w: number, h: number): P[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

describe("offsetRing: reproduces the closed form exactly where the closed form was right", () => {
  it("a 4 × 4 m square with 0.3 m walls", () => {
    const pts = rect(0, 0, 4000, 4000);
    const d = () => 150;
    assert.ok(Math.abs(offsetArea(straightRing(pts), d) - closedForm(pts, d)) < 1e-6);
    assert.equal(Math.round(offsetArea(straightRing(pts), d)), 3700 * 3700);
  });

  it("a 6 × 3 m room with a different thickness on every edge", () => {
    const pts = rect(0, 0, 6000, 3000);
    const d = (i: number) => [150, 60, 150, 60][i]!;
    assert.ok(Math.abs(offsetArea(straightRing(pts), d) - closedForm(pts, d)) < 1e-6);
  });

  it("an L-shape, whose reflex corner subtracts instead of adding", () => {
    const pts: P[] = [
      [0, 0],
      [6000, 0],
      [6000, 2000],
      [2000, 2000],
      [2000, 5000],
      [0, 5000],
    ];
    const d = (i: number) => [150, 60, 150, 60, 150, 60][i]!;
    const got = offsetArea(straightRing(pts), d);
    assert.ok(Math.abs(got - closedForm(pts, d)) < 1e-6, `${got} vs ${closedForm(pts, d)}`);
  });

  it("every fixture-shaped rectangle, to the square micrometre", () => {
    for (const [w, h, t] of [
      [4600, 4400, 150],
      [2200, 2200, 60],
      [16800, 10600, 150],
      [900, 2000, 60],
    ] as const) {
      const pts = rect(0, 0, w, h);
      const d = () => t;
      assert.ok(Math.abs(offsetArea(straightRing(pts), d) - closedForm(pts, d)) < 1e-6, `${w}×${h}`);
    }
  });
});

describe("offsetRing: right at angles the closed form is wrong at", () => {
  /** isoceles triangle, 5 m arms, apex angle θ, every edge offset by 0.15 m */
  const triangle = (deg: number): P[] => {
    const t = ((deg / 2) * Math.PI) / 180;
    return [
      [0, 0],
      [Math.round(5000 * Math.sin(t)), Math.round(5000 * Math.cos(t))],
      [Math.round(-5000 * Math.sin(t)), Math.round(5000 * Math.cos(t))],
    ];
  };

  it("matches numerically integrated truth at 90°, 45°, 20° and 10°", () => {
    const rows: string[] = [];
    for (const deg of [150, 120, 90, 60, 45, 20, 10]) {
      const pts = triangle(deg);
      const d = () => 150;
      const truth = integrateHalfPlanes(pts, d, 200_000);
      const got = offsetArea(straightRing(pts), d);
      const old = closedForm(pts, d);
      rows.push(
        `${deg}°: truth ${(truth / 1e6).toFixed(4)} m², offsetRing ${(got / 1e6).toFixed(4)} m² (${(((got - truth) / truth) * 100).toFixed(4)} %), closed form ${(old / 1e6).toFixed(4)} m² (${(((old - truth) / truth) * 100).toFixed(2)} %)`,
      );
      assert.ok(
        Math.abs(got - truth) / truth < 1e-4,
        `${deg}°: offsetRing ${got} against integrated truth ${truth}\n${rows.join("\n")}`,
      );
    }
    // the closed form's error, for the record: −0.6 % at 90°, −4.2 % at 20°, −28 % at 10°
    const ten = triangle(10);
    const truth10 = integrateHalfPlanes(ten, () => 150, 200_000);
    assert.ok(closedForm(ten, () => 150) < truth10 * 0.8, `the closed form should be far low at 10°:\n${rows.join("\n")}`);
    const ninety = triangle(90);
    assert.ok(closedForm(ninety, () => 150) < integrateHalfPlanes(ninety, () => 150, 200_000));
  });

  it("a 45°-cut pentagon", () => {
    const pts: P[] = [
      [0, 0],
      [6000, 0],
      [6000, 3000],
      [3000, 6000],
      [0, 6000],
    ];
    const d = () => 150;
    const truth = integrateHalfPlanes(pts, d, 200_000);
    assert.ok(Math.abs(offsetArea(straightRing(pts), d) - truth) / truth < 1e-4);
  });
});

describe("offsetRing: degenerate rings", () => {
  it("a 6 × 0.2 m slot offset by 0.15 m has no clear floor at all", () => {
    const pts = rect(0, 0, 6000, 200);
    assert.equal(offsetArea(straightRing(pts), () => 150), 0);
    assert.deepEqual(offsetRing(straightRing(pts), () => 150).pts, []);
  });

  it("a room exactly twice the wall thickness wide keeps a sliver", () => {
    const pts = rect(0, 0, 6000, 400);
    assert.ok(offsetArea(straightRing(pts), () => 150) > 0);
  });

  it("offsetting by nothing changes nothing", () => {
    const pts = rect(0, 0, 4000, 3000);
    assert.equal(offsetArea(straightRing(pts), () => 0), 12_000_000);
  });
});

describe("offsetRing: arcs stay arcs", () => {
  const roundRoom = (r: number): MmRing =>
    mmRing({
      pts: [
        [0, -r / 1000],
        [0, r / 1000],
      ],
      arcs: [
        { r: r / 1000, sweep: "cw", large: false },
        { r: r / 1000, sweep: "cw", large: false },
      ],
    });

  it("shrinks a round room's radius by the offset, exactly", () => {
    const got = offsetArea(roundRoom(3000), () => 150);
    const want = Math.PI * 2850 * 2850;
    assert.ok(Math.abs(got - want) / want < 1e-9, `got ${got}, want ${want}`);
  });

  it("keeps the result a two-arc ring, not a polygon", () => {
    const out = offsetRing(roundRoom(3000), () => 150);
    assert.equal(out.pts.length, 2);
    assert.equal(out.arcs.filter((a) => a !== undefined).length, 2);
    assert.ok(Math.abs(out.arcs[0]!.r - 2850) < 1e-9);
  });

  it("grows a concave arc's radius: a bite out of a room offsets outward", () => {
    // a 6 × 6 m room with a quarter-circle bite taken out of one corner
    const ring = mmRing({
      pts: [
        [0, 0],
        [6, 0],
        [6, 6],
        [0, 6],
        [0, 4],
        [2, 4],
      ],
      arcs: [undefined, undefined, undefined, undefined, { r: 2, sweep: "ccw", large: false }, undefined],
    });
    const out = offsetRing(ring, () => 150);
    const bite = out.arcs.find((a) => a !== undefined)!;
    assert.ok(bite.r > 2000, `a concave arc offsets outward: r went 2000 → ${bite.r}`);
    assert.ok(Math.abs(bite.r - 2150) < 1e-6);
  });

  it("agrees with the straight-edge answer for a many-sided approximation", () => {
    // a 24-gon inscribed in a 3 m circle, offset by 0.15, is within 1 % of the ring
    const n = 24;
    const pts: P[] = [];
    for (let i = 0; i < n; i++)
      pts.push([Math.round(3000 * Math.cos((2 * Math.PI * i) / n)), Math.round(3000 * Math.sin((2 * Math.PI * i) / n))]);
    const poly = offsetArea(straightRing(pts), () => 150);
    const exact = offsetArea(roundRoom(3000), () => 150);
    assert.ok(Math.abs(poly - exact) / exact < 0.02, `${poly} vs ${exact}`);
    assert.ok(poly < exact, "a polygon inscribed in the circle is smaller");
  });
});

describe("offsetRing: what it produces is a ring", () => {
  it("keeps the winding of the ring it came from", () => {
    const pts = rect(0, 0, 4000, 3000);
    const a = straightRing(pts);
    const b = straightRing([...pts].reverse());
    assert.equal(Math.sign(ringArea(offsetRing(a, () => 150))), Math.sign(ringArea(a)));
    assert.equal(Math.sign(ringArea(offsetRing(b, () => 150))), Math.sign(ringArea(b)));
  });

  it("inserts a step where two collinear edges carry different thicknesses", () => {
    // the shape of a room edge that is exterior wall for part of its run and partition
    // for the rest — the split the clear area needs in order to stay exact
    const pts: P[] = [
      [0, 0],
      [3000, 0],
      [6000, 0],
      [6000, 3000],
      [0, 3000],
    ];
    const d = (i: number) => [150, 60, 150, 150, 150][i]!;
    const out = offsetRing(straightRing(pts), d);
    assert.ok(out.pts.length > pts.length, "the change of thickness makes a step");
    // the offset ring is (150,150) (3000,150) (3000,60) (5850,60) (5850,2850) (150,2850)
    const truth = 2850 * 2700 + 2850 * 2790;
    assert.ok(Math.abs(Math.abs(ringArea(out)) - truth) < 1, `${Math.abs(ringArea(out))} vs ${truth}`);
  });
});
