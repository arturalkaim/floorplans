import type { Pt } from "./types.ts";

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
  | { kind: "not_rectilinear"; edge: [Pt, Pt] }
  | { kind: "zero_area" }
  | { kind: "self_intersecting"; edges: [number, number] };

/**
 * Snap, drop repeated and collinear points, and check the polygon is a simple
 * rectilinear loop. Returns the cleaned polygon or a problem description.
 */
/**
 * Cell-decomposition predicates for rectilinear polygons. Both build the grid of
 * every distinct x and y across the inputs and test cell centres, which is exact
 * for rectilinear shapes — the same trick derive() uses for room tiling.
 */
function cellCentres(polys: Pt[][]): Pt[] {
  const all = polys.flat();
  const xs = [...new Set(all.map((p) => p[0]))].sort((a, b) => a - b);
  const ys = [...new Set(all.map((p) => p[1]))].sort((a, b) => a - b);
  const out: Pt[] = [];
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < ys.length - 1; j++) out.push([(xs[i]! + xs[i + 1]!) / 2, (ys[j]! + ys[j + 1]!) / 2]);
  return out;
}

/** true if two rectilinear polygons share interior area; touching edges do not count */
export function polysOverlap(a: Pt[], b: Pt[]): boolean {
  return cellCentres([a, b]).some((c) => pointInPoly(c, a) && pointInPoly(c, b));
}

/** true if every part of `inner` lies within `outer` */
export function polyInside(inner: Pt[], outer: Pt[]): boolean {
  return cellCentres([inner, outer]).every((c) => !pointInPoly(c, inner) || pointInPoly(c, outer));
}

/** shortest distance between two axis-aligned boxes; 0 when they touch or overlap */
export function boxGap(a: BBox, b: BBox): number {
  const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  return Math.hypot(dx, dy);
}

export function normalizePoly(raw: Pt[]): { poly: Pt[] } | { problem: PolyProblem } {
  let pts: Pt[] = raw.map(([x, y]) => [snap(x), snap(y)]);
  // drop consecutive duplicates (including closing point equal to first)
  pts = pts.filter((p, i) => {
    const next = pts[(i + 1) % pts.length]!;
    return !(eq(p[0], next[0]) && eq(p[1], next[1]));
  });
  if (pts.length < 4) return { problem: { kind: "too_few_points", count: pts.length } };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    if (!eq(a[0], b[0]) && !eq(a[1], b[1])) return { problem: { kind: "not_rectilinear", edge: [a, b] } };
  }
  // drop collinear midpoints (three points on the same axis-aligned line)
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % pts.length]!;
    const collinear = (eq(prev[0], cur[0]) && eq(cur[0], next[0])) || (eq(prev[1], cur[1]) && eq(cur[1], next[1]));
    if (!collinear) out.push(cur);
  }
  if (out.length < 4) return { problem: { kind: "too_few_points", count: out.length } };
  if (eq(shoelace(out), 0)) return { problem: { kind: "zero_area" } };
  const hit = selfIntersection(out);
  if (hit) return { problem: { kind: "self_intersecting", edges: hit } };
  return { poly: out };
}

/** For rectilinear polygons: any two non-adjacent edges that touch or overlap. */
function selfIntersection(poly: Pt[]): [number, number] | null {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent around the loop
      if (segmentsTouch(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!)) return [i, j];
    }
  }
  return null;
}

function segmentsTouch(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const ax0 = Math.min(a[0], b[0]);
  const ax1 = Math.max(a[0], b[0]);
  const ay0 = Math.min(a[1], b[1]);
  const ay1 = Math.max(a[1], b[1]);
  const cx0 = Math.min(c[0], d[0]);
  const cx1 = Math.max(c[0], d[0]);
  const cy0 = Math.min(c[1], d[1]);
  const cy1 = Math.max(c[1], d[1]);
  return ax0 <= cx1 + 1e-9 && cx0 <= ax1 + 1e-9 && ay0 <= cy1 + 1e-9 && cy0 <= ay1 + 1e-9;
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
