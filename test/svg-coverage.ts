// How much ink the walls of a drawing put on the page, and where.
//
// The arrangement rewrite replaces `<line stroke-width=t>` runs — whose corners are
// filled by extending every true end by t/2 — with stroked `<path>` chains that mitre
// their corners. That is a change of *representation*, and this module is how the claim
// is checked rather than asserted: both forms are turned into the same thing, a set of
// filled polygons in SVG user units, and the symmetric difference of their covered area
// is measured by scanline integration.
//
// Nothing here knows about the model. It reads SVG text, which is what makes the frozen
// `test/__snapshots__/before-levels/*.svg` usable as the "before" side: those files were
// written by the pre-arrangement renderer and cannot be regenerated.

export type Poly = Array<[number, number]>;

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** Every `<line …>` and `<path …>` tagged `data-wall`, as filled polygons. */
export function wallSolids(svg: string): Poly[] {
  const out: Poly[] = [];
  for (const m of svg.matchAll(/<line\b([^>]*\bdata-wall=[^>]*)\/>/g)) out.push(...lineSolid(m[1]!));
  for (const m of svg.matchAll(/<path\b([^>]*\bdata-wall=[^>]*)\/>/g)) out.push(...pathSolid(m[1]!));
  return out;
}

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const num = (tag: string, name: string, dflt = 0): number => {
  const v = attr(tag, name);
  return v === undefined ? dflt : Number(v);
};

/** A butt-capped straight stroke is one rectangle. */
function lineSolid(tag: string): Poly[] {
  const w = num(tag, "stroke-width");
  if (!(w > 0)) return [];
  return segmentRect([num(tag, "x1"), num(tag, "y1")], [num(tag, "x2"), num(tag, "y2")], w);
}

function segmentRect(a: [number, number], b: [number, number], w: number): Poly[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return [];
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  return [[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]];
}

/**
 * A butt-capped, mitre-joined stroke along a polyline: one rectangle per segment plus
 * the wedge each join fills. The wedge is the quadrilateral hinge→outer(a)→mitre→outer(b)
 * on the outside of the turn; on the inside the two rectangles already overlap.
 */
export function strokeSolids(pts: Poly, w: number, miterLimit = 8): Poly[] {
  const out: Poly[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push(...segmentRect(pts[i]!, pts[i + 1]!, w));
  for (let i = 1; i + 1 < pts.length; i++) {
    const p = pts[i - 1]!;
    const q = pts[i]!;
    const r = pts[i + 1]!;
    const u = unit(p, q);
    const v = unit(q, r);
    if (!u || !v) continue;
    const cross = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(cross) < 1e-12) continue; // straight through: nothing to fill
    // outward side of the turn
    const s = cross > 0 ? -1 : 1;
    const n1: [number, number] = [(-u[1] * w * s) / 2, (u[0] * w * s) / 2];
    const n2: [number, number] = [(-v[1] * w * s) / 2, (v[0] * w * s) / 2];
    const a: [number, number] = [q[0] + n1[0], q[1] + n1[1]];
    const b: [number, number] = [q[0] + n2[0], q[1] + n2[1]];
    // mitre apex: intersection of the two offset lines
    const apex = intersect(a, u, b, v);
    const half = Math.hypot(n1[0], n1[1]);
    if (apex && Math.hypot(apex[0] - q[0], apex[1] - q[1]) <= miterLimit * half) out.push([q, a, apex, b]);
    else out.push([q, a, b]); // bevel
  }
  return out;
}

const unit = (a: [number, number], b: [number, number]): [number, number] | undefined => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  return l < 1e-12 ? undefined : [dx / l, dy / l];
};

function intersect(
  p: [number, number],
  d: [number, number],
  q: [number, number],
  e: [number, number],
): [number, number] | undefined {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return undefined;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/** `d` attribute → polyline, arcs flattened finely enough that the raster cannot tell. */
export function pathPoints(d: string): Poly[] {
  const runs: Poly[] = [];
  let cur: Poly = [];
  let at: [number, number] = [0, 0];
  const tokens = d.match(/[MLA][^MLA]*/g) ?? [];
  for (const tok of tokens) {
    const nums = (tok.slice(1).match(NUM) ?? []).map(Number);
    if (tok[0] === "M") {
      if (cur.length > 1) runs.push(cur);
      at = [nums[0]!, nums[1]!];
      cur = [at];
    } else if (tok[0] === "L") {
      at = [nums[0]!, nums[1]!];
      cur.push(at);
    } else {
      const [rx, , , large, sweep, x, y] = nums as [number, number, number, number, number, number, number];
      for (const p of arcPoints(at, [x, y], rx, large === 1, sweep === 1)) cur.push(p);
      at = [x, y];
    }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

/** Endpoint-parameterised circular arc, sampled at ≤ 0.05 px sagitta. */
function arcPoints(a: [number, number], b: [number, number], r: number, large: boolean, sweep: boolean): Poly {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9 || r <= 0) return [b];
  const rr = Math.max(r, chord / 2);
  const h = Math.sqrt(Math.max(0, rr * rr - (chord / 2) ** 2));
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  // centre offset direction: left of a→b when sweep xor large picks the other side
  const sign = sweep === large ? 1 : -1;
  const cx = mx + (sign * h * -dy) / chord;
  const cy = my + (sign * h * dx) / chord;
  let a0 = Math.atan2(a[1] - cy, a[0] - cx);
  let a1 = Math.atan2(b[1] - cy, b[0] - cx);
  if (sweep && a1 < a0) a1 += 2 * Math.PI;
  if (!sweep && a1 > a0) a1 -= 2 * Math.PI;
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - 0.05 / rr)));
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / Math.max(step, 1e-3)));
  const out: Poly = [];
  for (let i = 1; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    out.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
  }
  return out;
}

function pathSolid(tag: string): Poly[] {
  const w = num(tag, "stroke-width");
  const d = attr(tag, "d");
  if (!(w > 0) || d === undefined) return [];
  return pathPoints(d).flatMap((pts) => strokeSolids(pts, w));
}

/** Covered x-intervals of one polygon on the horizontal line `y`, even-odd. */
function spans(poly: Poly, y: number): Array<[number, number]> {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (a[1] === b[1]) continue;
    const lo = Math.min(a[1], b[1]);
    const hi = Math.max(a[1], b[1]);
    if (y < lo || y >= hi) continue;
    xs.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
  }
  xs.sort((m, n) => m - n);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i]!, xs[i + 1]!]);
  return out;
}

function union(list: Array<[number, number]>): Array<[number, number]> {
  const s = [...list].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const measure = (list: Array<[number, number]>): number => list.reduce((s, [a, b]) => s + (b - a), 0);

/** Length of the symmetric difference of two interval unions. */
function symDiff(a: Array<[number, number]>, b: Array<[number, number]>): number {
  const cuts = [...new Set([...a, ...b].flat())].sort((m, n) => m - n);
  let d = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const mid = (cuts[i]! + cuts[i + 1]!) / 2;
    const inA = a.some(([p, q]) => mid > p && mid < q);
    const inB = b.some(([p, q]) => mid > p && mid < q);
    if (inA !== inB) d += cuts[i + 1]! - cuts[i]!;
  }
  return d;
}

export interface Coverage {
  /** covered area of each drawing, in m² */
  areaA: number;
  areaB: number;
  /** area covered by exactly one of them, in m² */
  difference: number;
}

/**
 * Compare the wall ink of two drawings by scanline integration, at `step` SVG user
 * units per row (default a quarter pixel). Areas come back in m² using `scale`
 * px/m, which is what a reader can judge: "the two drawings differ by 0.4 mm²".
 */
export function compareWallCoverage(svgA: string, svgB: string, scale = 40, step = 0.25): Coverage {
  const A = wallSolids(svgA);
  const B = wallSolids(svgB);
  const all = [...A, ...B];
  if (all.length === 0) return { areaA: 0, areaB: 0, difference: 0 };
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of all)
    for (const [, y] of p) {
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  let areaA = 0;
  let areaB = 0;
  let diff = 0;
  for (let y = y0 + step / 2; y < y1; y += step) {
    const ua = union(A.flatMap((p) => spans(p, y)));
    const ub = union(B.flatMap((p) => spans(p, y)));
    areaA += measure(ua) * step;
    areaB += measure(ub) * step;
    diff += symDiff(ua, ub) * step;
  }
  const px2 = scale * scale;
  return { areaA: areaA / px2, areaB: areaB / px2, difference: diff / px2 };
}
