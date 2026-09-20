// Rings: closed boundaries made of straight edges and true circular arcs, in integer
// millimetres.
//
// Everything the geometry core does — the planar arrangement, face areas, the mitred
// inward offset, the inscribed circle — happens here, on integers. Metres are the
// document's unit and the model's unit; they are converted at the boundary and never
// used for a comparison. That is the point of the change (docs/gaps-design.md §1.3.3):
// the old code snapped to the millimetre 33 times in one file and still needed six
// different tolerance constants for one concept. On integers, equality is `===`.

import type { ArcSpec, Pt } from "./types.ts";

/** Integer millimetres. */
export type Mm = number;
/** A point in integer millimetres. */
export type P = [Mm, Mm];

/** metres → integer millimetres. Lossless for any coordinate the parser has snapped. */
export const toMm = (m: number): Mm => Math.round(m * 1000);
/** integer millimetres → metres, exactly representable for any plan under 9000 km. */
export const toM = (mm: Mm): number => mm / 1000;

export const ptMm = (p: Pt): P => [toMm(p[0]), toMm(p[1])];
export const ptM = (p: P): Pt => [toM(p[0]), toM(p[1])];

/**
 * The chord sagitta an arc is flattened to, in millimetres.
 *
 * INVARIANT: this is a constant and not a parameter, and `flattenArc` takes nothing but
 * the arc. Two spaces that share a curved wall each flatten it from their own ring; if
 * they could disagree by half a step the shared boundary would split into a comb of
 * slivers — measured at 61 faces totalling 277 cm² on an R = 3 m semicircle
 * (docs/gaps-design.md §1.3.3). Canonical input, canonical output, no free parameters.
 */
export const SAGITTA_MM = 1;

// ---------- arcs ----------

/**
 * A circular arc, resolved: centre, radius and the signed angular span from `a` to `b`.
 * Angles are `atan2(y, x)` in the document's frame, where y grows southwards, so a
 * positive span turns clockwise on the page — the same handedness `shoelace` uses.
 */
export interface Arc {
  c: [number, number];
  r: number;
  /** start angle, radians */
  t0: number;
  /** signed span, radians; |span| < 2π */
  span: number;
  a: P;
  b: P;
}

export type ArcProblem = { kind: "radius_too_small"; needed: number; got: number } | { kind: "degenerate" };

/**
 * Resolve `{ arc: [x,y], r, sweep, large }` against the previous corner.
 *
 * Endpoints, a radius, a turn direction and the reflex flag are the minimal
 * non-redundant description of a circular arc, and each of the four is a number an
 * agent can compute or edit on its own (docs/gaps-design.md §1.2). The centre is
 * derived, never authored, so a `spliceAt` on `r` cannot make the record inconsistent.
 */
export function resolveArc(a: P, b: P, r: Mm, cw: boolean, large: boolean): Arc | { problem: ArcProblem } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return { problem: { kind: "degenerate" } };
  if (r * 2 < chord - 1e-9) return { problem: { kind: "radius_too_small", needed: chord / 2, got: r } };
  const rr = Math.max(r, chord / 2);
  const h = Math.sqrt(Math.max(0, rr * rr - (chord / 2) ** 2));
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  // Of the two circles through a and b, `cw` and `large` together pick one and the way
  // round it: the same convention SVG's sweep/large-arc flags use.
  const side = cw !== large ? 1 : -1;
  const c: [number, number] = [mx + (side * h * -dy) / chord, my + (side * h * dx) / chord];
  const t0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  const t1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  let span = t1 - t0;
  if (cw && span < 0) span += 2 * Math.PI;
  if (!cw && span > 0) span -= 2 * Math.PI;
  return { c, r: rr, t0, span, a, b };
}

/** Where an arc is, `t` of the way along its span. */
export const arcPoint = (arc: Arc, t: number): [number, number] => [
  arc.c[0] + arc.r * Math.cos(arc.t0 + arc.span * t),
  arc.c[1] + arc.r * Math.sin(arc.t0 + arc.span * t),
];

export const arcLength = (arc: Arc): number => Math.abs(arc.span) * arc.r;

/** Unit tangent, pointing the way the arc is travelled. */
export function arcTangent(arc: Arc, t: number): [number, number] {
  const a = arc.t0 + arc.span * t;
  const s = Math.sign(arc.span) || 1;
  return [-Math.sin(a) * s, Math.cos(a) * s];
}

/** The arc that is this one run backwards. */
export const reverseArc = (arc: Arc): Arc => ({
  c: arc.c,
  r: arc.r,
  t0: arc.t0 + arc.span,
  span: -arc.span,
  a: arc.b,
  b: arc.a,
});

/** Lexicographic order on points: x, then y. */
export const before = (p: P, q: P): boolean => p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]);

/**
 * Chord points for an arc, excluding both endpoints, identical for either space that
 * shares it. Canonical in two ways: the subdivision always runs from the
 * lexicographically smaller endpoint, and the step is fixed by the radius alone.
 */
export function flattenArc(arc: Arc): P[] {
  const canonical = before(arc.a, arc.b) ? arc : reverseArc(arc);
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - SAGITTA_MM / canonical.r)));
  const n = Math.max(1, Math.ceil(Math.abs(canonical.span) / Math.max(step, 1e-9)));
  const out: P[] = [];
  for (let i = 1; i < n; i++) {
    const p = arcPoint(canonical, i / n);
    out.push([Math.round(p[0]), Math.round(p[1])]);
  }
  return canonical === arc ? out : out.reverse();
}

/** How many chords `flattenArc` uses. Reported by `arc.too_shallow` and by the tests. */
export const arcChords = (arc: Arc): number => flattenArc(arc).length + 1;

/** Height of the arc over its chord: what makes a curve worth writing as one. */
export function sagitta(arc: Arc): number {
  const chord = Math.hypot(arc.b[0] - arc.a[0], arc.b[1] - arc.a[1]);
  const h = Math.sqrt(Math.max(0, arc.r * arc.r - (chord / 2) ** 2));
  return Math.abs(arc.span) > Math.PI ? arc.r + h : arc.r - h;
}

// ---------- rings ----------

/**
 * A closed boundary. `pts` are the corners in document order; `arcs[i]`, when present,
 * curves the edge from `pts[i]` to `pts[i+1]`. A ring with no arcs is exactly the
 * polygon the library had before, which is why `Room.poly` can still be `pts`.
 */
export interface MmRing {
  pts: P[];
  arcs: Array<Arc | undefined>;
}

export const straightRing = (pts: P[]): MmRing => ({ pts, arcs: pts.map(() => undefined) });

/** The ring's corner + arc description in metres, as the model carries it. */
export interface Ring {
  pts: Pt[];
  arcs: Array<ArcSpec | undefined>;
}

/** Resolve a metre-space ring into millimetres. Arcs whose radius is impossible are dropped. */
export function mmRing(ring: Ring): MmRing {
  const pts = ring.pts.map(ptMm);
  const arcs = pts.map((a, i) => {
    const spec = ring.arcs[i];
    if (!spec) return undefined;
    const r = resolveArc(a, pts[(i + 1) % pts.length]!, toMm(spec.r), spec.sweep === "cw", spec.large);
    return "problem" in r ? undefined : r;
  });
  return { pts, arcs };
}

/** Every edge of a ring, as an index plus its two corners and its arc if it has one. */
export function ringEdges(ring: MmRing): Array<{ i: number; a: P; b: P; arc: Arc | undefined }> {
  return ring.pts.map((a, i) => ({ i, a, b: ring.pts[(i + 1) % ring.pts.length]!, arc: ring.arcs[i] }));
}

/**
 * Signed area in mm², positive when the ring winds clockwise on the page. Exact for
 * arcs: each edge contributes ½∮(x dy − y dx) over its own parameterisation, which for
 * a circular arc closes to cx·Δy − cy·Δx + r²·span.
 */
export function ringArea(ring: MmRing): number {
  let a = 0;
  for (const e of ringEdges(ring)) {
    if (e.arc) {
      const arc = e.arc;
      a += (arc.c[0] * (e.b[1] - e.a[1]) - arc.c[1] * (e.b[0] - e.a[0]) + arc.r * arc.r * arc.span) / 2;
    } else {
      a += (e.a[0] * e.b[1] - e.b[0] * e.a[1]) / 2;
    }
  }
  return a;
}

/** Perimeter in mm, arcs by arc length. */
export function ringPerimeter(ring: MmRing): number {
  let p = 0;
  for (const e of ringEdges(ring)) p += e.arc ? arcLength(e.arc) : Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
  return p;
}

/** The ring as a closed polyline: corners with every arc's canonical chord points. */
export function ringPoints(ring: MmRing): P[] {
  const out: P[] = [];
  for (const e of ringEdges(ring)) {
    out.push(e.a);
    if (e.arc) for (const p of flattenArc(e.arc)) out.push(p);
  }
  return out;
}

/** Even-odd ray cast against the flattened ring. Points on the boundary are unspecified. */
export function pointInRing(p: P, ring: MmRing): boolean {
  return pointInPolyMm(p, ringPoints(ring));
}

export function pointInPolyMm(p: [number, number], poly: Array<[number, number]>): boolean {
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bounding box in mm, tight over arcs: a bulge past its chord counts. */
export function ringBox(ring: MmRing): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const take = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };
  for (const e of ringEdges(ring)) {
    take(e.a[0], e.a[1]);
    take(e.b[0], e.b[1]);
    if (!e.arc) continue;
    // the four compass extremes of the circle, where the arc reaches them
    for (const k of [0, 1, 2, 3]) {
      const ang = (k * Math.PI) / 2;
      if (!onArc(e.arc, ang)) continue;
      // to the millimetre, like every other coordinate: a bounding box that carried
      // float residue would reopen the tolerance problem integers are here to close
      take(Math.round(e.arc.c[0] + e.arc.r * Math.cos(ang)), Math.round(e.arc.c[1] + e.arc.r * Math.sin(ang)));
    }
  }
  return { x0, y0, x1, y1 };
}

/** Is the ray at angle `ang` from the centre within the arc's span? */
export function onArc(arc: Arc, ang: number): boolean {
  const twoPi = 2 * Math.PI;
  const d = ((ang - arc.t0) % twoPi + twoPi) % twoPi;
  return arc.span >= 0 ? d <= arc.span + 1e-12 : twoPi - d <= -arc.span + 1e-12;
}

/** Where along the arc's span a ray at `ang` falls, 0..1, or undefined if it misses. */
export function arcParamAt(arc: Arc, ang: number): number | undefined {
  if (!onArc(arc, ang)) return undefined;
  const twoPi = 2 * Math.PI;
  const d = ((ang - arc.t0) % twoPi + twoPi) % twoPi;
  return arc.span >= 0 ? d / arc.span : (d - twoPi) / arc.span;
}
