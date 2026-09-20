import { segmentsCross } from "./arrangement.ts";
import { flattenArc, mmRing, ringArea, ringEdges } from "./ring.ts";
import type { P } from "./ring.ts";
import type { ArcSpec, Pt } from "./types.ts";

/** Snap to a 1 mm grid; removes float noise from authored coordinates. */
export const snap = (n: number): number => Math.round(n * 1000) / 1000;

export const eq = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

export function shoelace(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2; // signed: positive when clockwise on a y-down screen
}

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function bbox(poly: Pt[]): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Even-odd ray cast. Points exactly on an edge are unspecified; callers probe cell centres. */
export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export type PolyProblem =
  | { kind: "too_few_points"; count: number }
  | { kind: "zero_area" }
  | { kind: "self_intersecting"; edges: [number, number] }
  | { kind: "arc_radius"; edge: number; needed: number; got: number };

/**
 * Snap, drop repeated and collinear corners, and check the ring is a simple closed loop.
 *
 * Any simple polygon is accepted — the rectilinear test that used to sit here is gone
 * (docs/gaps-design.md §1.2) — and an edge may carry an arc. What is still refused, with
 * the reason: fewer than three distinct corners, zero area, an arc whose radius cannot
 * span its chord, and a boundary that crosses or touches itself.
 */
export function normalizeRing(
  rawPts: Pt[],
  rawArcs: ReadonlyArray<ArcSpec | undefined>,
): { poly: Pt[]; arcs: Array<ArcSpec | undefined> } | { problem: PolyProblem } {
  let pts: Pt[] = rawPts.map(([x, y]) => [snap(x), snap(y)]);
  let arcs: Array<ArcSpec | undefined> = pts.map((_, i) => rawArcs[i]);

  // drop zero-length edges (including a repeated closing point)
  for (let i = pts.length - 1; i >= 0; i--) {
    const next = (i + 1) % pts.length;
    if (pts.length <= 2) break;
    if (!eq(pts[i]![0], pts[next]![0]) || !eq(pts[i]![1], pts[next]![1])) continue;
    pts.splice(i, 1);
    arcs.splice(i, 1);
  }
  const curved = arcs.some((a) => a !== undefined);
  const floor = curved ? 2 : 3;
  if (pts.length < floor) return { problem: { kind: "too_few_points", count: pts.length } };

  // drop a corner that lies on the straight line between its neighbours
  {
    const keepPts: Pt[] = [];
    const keepArcs: Array<ArcSpec | undefined> = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = (i - 1 + pts.length) % pts.length;
      const next = (i + 1) % pts.length;
      const straightHere = arcs[prev] === undefined && arcs[i] === undefined;
      const collinear =
        straightHere &&
        eq(
          (pts[i]![0] - pts[prev]![0]) * (pts[next]![1] - pts[i]![1]) -
            (pts[i]![1] - pts[prev]![1]) * (pts[next]![0] - pts[i]![0]),
          0,
        );
      if (collinear && pts.length > floor) continue;
      keepPts.push(pts[i]!);
      keepArcs.push(arcs[i]);
    }
    if (keepPts.length >= floor) {
      pts = keepPts;
      arcs = keepArcs;
    }
  }
  if (pts.length < floor) return { problem: { kind: "too_few_points", count: pts.length } };

  // every arc has to be able to span its chord
  for (let i = 0; i < pts.length; i++) {
    const spec = arcs[i];
    if (!spec) continue;
    const j = (i + 1) % pts.length;
    const chord = Math.hypot(pts[j]![0] - pts[i]![0], pts[j]![1] - pts[i]![1]);
    if (spec.r * 2 < chord - 1e-9)
      return { problem: { kind: "arc_radius", edge: i, needed: snap(chord / 2), got: spec.r } };
  }

  const ring = mmRing({ pts, arcs });
  if (Math.abs(ringArea(ring)) < 1) return { problem: { kind: "zero_area" } };

  const hit = selfIntersection(pts, arcs);
  if (hit) return { problem: { kind: "self_intersecting", edges: hit } };
  return { poly: pts, arcs };
}

/** The straight-edged form, kept for the grid compiler and for callers with no arcs. */
export function normalizePoly(raw: Pt[]): { poly: Pt[] } | { problem: PolyProblem } {
  const res = normalizeRing(
    raw,
    raw.map(() => undefined),
  );
  return "problem" in res ? res : { poly: res.poly };
}

/**
 * Any two non-adjacent edges that cross or touch. Arcs are tested on their canonical
 * chords, which is exact enough at a one-millimetre sagitta and is the same geometry the
 * arrangement will build; two arcs that merely graze each other may therefore be
 * reported, and that is the safe direction to be wrong in.
 */
function selfIntersection(pts: Pt[], arcs: ReadonlyArray<ArcSpec | undefined>): [number, number] | null {
  const ring = mmRing({ pts, arcs: [...arcs] });
  const flat: Array<{ a: P; b: P; edge: number }> = [];
  for (const e of ringEdges(ring)) {
    const chain = e.arc ? [e.a, ...flattenArc(e.arc), e.b] : [e.a, e.b];
    for (let i = 0; i + 1 < chain.length; i++) flat.push({ a: chain[i]!, b: chain[i + 1]!, edge: e.i });
  }
  const n = pts.length;
  const adjacent = (i: number, j: number) => i === j || (j - i + n) % n === 1 || (i - j + n) % n === 1;
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i]!;
      const b = flat[j]!;
      if (adjacent(a.edge, b.edge)) continue;
      if (segmentsCross(a.a, a.b, b.a, b.b)) return [Math.min(a.edge, b.edge), Math.max(a.edge, b.edge)];
    }
  }
  return null;
}

/**
 * Outline of a union of grid cells. `cells` are [col,row] indices; xs/ys are the
 * track coordinates. Returns one polygon per connected component (holes are
 * returned as separate loops, so callers should demand exactly one loop).
 */
export function cellsToPolygons(cells: Array<[number, number]>, xs: number[], ys: number[]): Pt[][] {
  // directed boundary edges: each cell contributes its 4 edges clockwise (screen);
  // an edge shared by two cells appears in both directions and cancels.
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  const edges = new Map<string, Pt[]>(); // from -> list of to
  const add = (from: Pt, to: Pt) => {
    const rev = edges.get(key(to));
    if (rev) {
      const i = rev.findIndex((p) => eq(p[0], from[0]) && eq(p[1], from[1]));
      if (i >= 0) {
        rev.splice(i, 1);
        return;
      }
    }
    const list = edges.get(key(from)) ?? [];
    list.push(to);
    edges.set(key(from), list);
  };
  for (const [i, j] of cells) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const y0 = ys[j]!;
    const y1 = ys[j + 1]!;
    add([x0, y0], [x1, y0]);
    add([x1, y0], [x1, y1]);
    add([x1, y1], [x0, y1]);
    add([x0, y1], [x0, y0]);
  }
  const loops: Pt[][] = [];
  for (;;) {
    let startKey: string | undefined;
    for (const [k, v] of edges) {
      if (v.length > 0) {
        startKey = k;
        break;
      }
    }
    if (startKey === undefined) break;
    const loop: Pt[] = [];
    let curKey = startKey;
    let prevDir: Pt | undefined;
    for (;;) {
      const outs = edges.get(curKey);
      if (!outs || outs.length === 0) break;
      const cur = curKey.split(",").map(Number) as Pt;
      // prefer turning right (clockwise) to keep loops simple at pinch points
      let pick = 0;
      if (prevDir && outs.length > 1) {
        let best = -Infinity;
        outs.forEach((to, idx) => {
          const dir: Pt = [Math.sign(to[0] - cur[0]), Math.sign(to[1] - cur[1])];
          const cross = prevDir![0] * dir[1] - prevDir![1] * dir[0];
          if (cross > best) {
            best = cross;
            pick = idx;
          }
        });
      }
      const to = outs.splice(pick, 1)[0]!;
      loop.push(cur);
      prevDir = [Math.sign(to[0] - cur[0]), Math.sign(to[1] - cur[1])];
      curKey = key(to);
      if (curKey === startKey) break;
    }
    const cleaned = normalizePoly(loop);
    if ("poly" in cleaned) loops.push(cleaned.poly);
  }
  return loops;
}

/** Largest axis-aligned rectangle made of fully owned cells. O(cols²·rows²), fine at house scale. */
export function largestRect(
  owned: (i: number, j: number) => boolean,
  xs: number[],
  ys: number[],
): BBox {
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  let best: BBox = { x0: 0, y0: 0, x1: 0, y1: 0 };
  let bestArea = -1;
  for (let i0 = 0; i0 < cols; i0++) {
    for (let j0 = 0; j0 < rows; j0++) {
      if (!owned(i0, j0)) continue;
      let maxJ = rows - 1;
      for (let i1 = i0; i1 < cols; i1++) {
        // shrink allowed row range as columns extend
        let j = j0;
        while (j <= maxJ && owned(i1, j)) j++;
        maxJ = j - 1;
        if (maxJ < j0) break;
        const area = (xs[i1 + 1]! - xs[i0]!) * (ys[maxJ + 1]! - ys[j0]!);
        if (area > bestArea) {
          bestArea = area;
          best = { x0: xs[i0]!, y0: ys[j0]!, x1: xs[i1 + 1]!, y1: ys[maxJ + 1]! };
        }
      }
    }
  }
  return best;
}
