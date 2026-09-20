// The planar arrangement: one primitive under every geometric question the library asks.
//
// Every room, outdoor space, void and fixture contributes its ring's edges. The edges
// are split against one another, snap-rounded onto the millimetre grid through hot
// pixels, and woven into a half-edge (DCEL) structure whose faces are the regions the
// plan actually has. A face gets exactly one owner; a wall is a half-edge whose owner
// differs from its twin's; a boolean operation is the same arrangement read with a
// different face predicate (docs/gaps-design.md §1.3.1–§1.3.2).
//
// This replaces the cell grid that ran from `derive.ts:39` — which was itself a planar
// arrangement restricted to axis-parallel lines, and which could only be exact while
// every edge lay on a grid line.
//
// INVARIANT: for a plan whose every edge is axis-parallel this constructs **no new
// coordinate value at all**. The intersection of a horizontal and a vertical edge is at
// (x of the vertical, y of the horizontal) — both authored numbers — so no rounding
// happens, no hot pixel moves anything, and the result is bit-for-bit what the cell grid
// produced. There is therefore no "fast exact rectilinear path" to keep
// (docs/gaps-design.md §1.4, dissent D9).

import type { Arc, MmRing, P } from "./ring.ts";
import { arcParamAt, flattenArc, pointInPolyMm, ringEdges } from "./ring.ts";

// ---------- exact degree-2 predicates ----------

/**
 * Twice the signed area of the triangle abc; > 0 when c is clockwise of a→b on the page.
 *
 * INVARIANT: exact in doubles. Coordinates are integer millimetres and a plan spans at
 * most a few hundred metres, so |cross| ≤ 4 × 10¹⁰ against 2⁵³ ≈ 9 × 10¹⁵ — five orders
 * of headroom (docs/gaps-design.md §1.3.3). Every predicate in this file is degree 2 for
 * that reason. A degree-4 predicate — "does the intersection of A and B lie on C",
 * decided without constructing the point — would reach (2 × 10⁵)⁴ and overflow, so it is
 * never used: constructed points are rounded to the grid and re-tested at degree 2, which
 * is what snap-rounding is for.
 */
export const orient = (a: P, b: P, c: P): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

const between = (a: number, b: number, c: number) => Math.min(a, b) <= c && c <= Math.max(a, b);

/** Does point c lie on the closed segment ab? Exact. */
export function onSegment(a: P, b: P, c: P): boolean {
  return orient(a, b, c) === 0 && between(a[0], b[0], c[0]) && between(a[1], b[1], c[1]);
}

/** Do segments ab and cd share a point? Exact, including touching and collinear overlap. */
export function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  const o1 = Math.sign(orient(a, b, c));
  const o2 = Math.sign(orient(a, b, d));
  const o3 = Math.sign(orient(c, d, a));
  const o4 = Math.sign(orient(c, d, b));
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  );
}

/** Where two segments meet, as integer millimetres; the endpoints of a collinear overlap. */
function crossingPoints(a: P, b: P, c: P, d: P): P[] {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 === 0 && o2 === 0) {
    // collinear: every endpoint that lies on the other segment is a place to split
    const out: P[] = [];
    if (onSegment(a, b, c)) out.push(c);
    if (onSegment(a, b, d)) out.push(d);
    if (onSegment(c, d, a)) out.push(a);
    if (onSegment(c, d, b)) out.push(b);
    return out;
  }
  const out: P[] = [];
  if (o1 === 0 && onSegment(a, b, c)) out.push(c);
  if (o2 === 0 && onSegment(a, b, d)) out.push(d);
  if (o3 === 0 && onSegment(c, d, a)) out.push(a);
  if (o4 === 0 && onSegment(c, d, b)) out.push(b);
  if (out.length) return out;
  if (Math.sign(o1) === Math.sign(o2) || Math.sign(o3) === Math.sign(o4)) return [];
  // a proper crossing: the one place the arrangement constructs a coordinate. Rounding
  // it to the millimetre is what makes a hot pixel (§1.3.3).
  const t = o3 / (o3 - o4);
  return [[Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t)]];
}

// ---------- input ----------

/** One edge of the arrangement before it is woven together. */
interface Seg {
  a: P;
  b: P;
  /** which input ring and which of its edges this chord came from */
  input: number;
  edge: number;
  /** set when the source edge is an arc: the exact circle, for recovering wall geometry */
  circle: { c: [number, number]; r: number; arc: Arc } | undefined;
}

const key = (p: P) => `${p[0]},${p[1]}`;
const same = (p: P, q: P) => p[0] === q[0] && p[1] === q[1];

function segsOf(rings: MmRing[]): Seg[] {
  const out: Seg[] = [];
  rings.forEach((ring, input) => {
    for (const e of ringEdges(ring)) {
      const pts = e.arc ? [e.a, ...flattenArc(e.arc), e.b] : [e.a, e.b];
      const circle = e.arc ? { c: e.arc.c, r: e.arc.r, arc: e.arc } : undefined;
      for (let i = 0; i + 1 < pts.length; i++) {
        if (same(pts[i]!, pts[i + 1]!)) continue;
        out.push({ a: pts[i]!, b: pts[i + 1]!, input, edge: e.i, circle });
      }
    }
  });
  return out;
}

// ---------- snap-rounding with hot pixels ----------

/** Does the segment ab pass through the 1 mm square centred on the integer point h? */
function throughPixel(a: P, b: P, h: P): boolean {
  // Liang–Barsky against [hx−½, hx+½] × [hy−½, hy+½]
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, a[0] - (h[0] - 0.5)) &&
    clip(dx, h[0] + 0.5 - a[0]) &&
    clip(-dy, a[1] - (h[1] - 0.5)) &&
    clip(dy, h[1] + 0.5 - a[1])
  );
}

/**
 * Split every segment at every hot pixel it passes through, bending it to the pixel's
 * centre. Repeated until no new intersection appears, which on a rectilinear plan is
 * after the first pass because no coordinate is ever constructed.
 */
function snapRound(segs: Seg[]): Seg[] {
  let cur = segs;
  for (let pass = 0; pass < 8; pass++) {
    const hot = new Map<string, P>();
    const heat = (p: P) => hot.set(key(p), p);
    for (const s of cur) {
      heat(s.a);
      heat(s.b);
    }
    let constructed = false;
    for (let i = 0; i < cur.length; i++) {
      for (let j = i + 1; j < cur.length; j++) {
        const s = cur[i]!;
        const t = cur[j]!;
        if (!boxesTouch(s, t)) continue;
        for (const p of crossingPoints(s.a, s.b, t.a, t.b)) {
          if (!hot.has(key(p))) constructed = true;
          heat(p);
        }
      }
    }
    const next = splitAll(cur, [...hot.values()]);
    const stable = next.length === cur.length && !constructed;
    cur = next;
    if (stable) break;
  }
  return cur;
}

const boxesTouch = (s: Seg, t: Seg) =>
  Math.min(s.a[0], s.b[0]) <= Math.max(t.a[0], t.b[0]) &&
  Math.min(t.a[0], t.b[0]) <= Math.max(s.a[0], s.b[0]) &&
  Math.min(s.a[1], s.b[1]) <= Math.max(t.a[1], t.b[1]) &&
  Math.min(t.a[1], t.b[1]) <= Math.max(s.a[1], s.b[1]);

function splitAll(segs: Seg[], hot: P[]): Seg[] {
  // a grid index over the hot pixels, so a segment only tests the ones near it
  const cell = 256;
  const buckets = new Map<string, P[]>();
  for (const h of hot) {
    const k = `${Math.floor(h[0] / cell)},${Math.floor(h[1] / cell)}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(h);
  }
  const out: Seg[] = [];
  for (const s of segs) {
    const cuts: Array<{ t: number; p: P }> = [];
    const dx = s.b[0] - s.a[0];
    const dy = s.b[1] - s.a[1];
    const len2 = dx * dx + dy * dy;
    const i0 = Math.floor(Math.min(s.a[0], s.b[0]) / cell) - 1;
    const i1 = Math.floor(Math.max(s.a[0], s.b[0]) / cell) + 1;
    const j0 = Math.floor(Math.min(s.a[1], s.b[1]) / cell) - 1;
    const j1 = Math.floor(Math.max(s.a[1], s.b[1]) / cell) + 1;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (const h of buckets.get(`${i},${j}`) ?? []) {
          if (same(h, s.a) || same(h, s.b)) continue;
          if (!throughPixel(s.a, s.b, h)) continue;
          cuts.push({ t: ((h[0] - s.a[0]) * dx + (h[1] - s.a[1]) * dy) / len2, p: h });
        }
      }
    }
    if (cuts.length === 0) {
      out.push(s);
      continue;
    }
    cuts.sort((m, n) => m.t - n.t);
    let prev = s.a;
    for (const c of cuts) {
      if (same(prev, c.p)) continue;
      out.push({ ...s, a: prev, b: c.p });
      prev = c.p;
    }
    if (!same(prev, s.b)) out.push({ ...s, a: prev, b: s.b });
  }
  return out;
}

// ---------- the DCEL ----------

export interface HalfEdge {
  from: number;
  to: number;
  twin: number;
  next: number;
  face: number;
  /** the arc this edge lies on, when it does */
  circle: { c: [number, number]; r: number; arc: Arc } | undefined;
}

export interface Face {
  /** boundary cycles, half-edge indices; for a bounded face the first is its outer ring */
  cycles: number[][];
  /** signed mm², positive for a bounded face */
  area: number;
  /** an interior point with the greatest clearance from the boundary */
  probe: [number, number];
  /** indices of the input rings that contain `probe` */
  tags: number[];
}

export interface Arrangement {
  verts: P[];
  half: HalfEdge[];
  faces: Face[];
  /** the unbounded face */
  outer: number;
  rings: MmRing[];
}

const twinOf = (h: number) => h ^ 1;

/** Build the arrangement of every input ring. */
export function arrange(rings: MmRing[]): Arrangement {
  const segs = snapRound(segsOf(rings));

  // unique undirected edges; an edge two spaces share appears once
  const edges = new Map<string, Seg>();
  for (const s of segs) {
    const k = same(s.a, s.b) ? "" : keyOf(s.a, s.b);
    if (k === "") continue;
    const had = edges.get(k);
    if (!had) edges.set(k, s);
    else if (!had.circle && s.circle) edges.set(k, s);
  }

  const index = new Map<string, number>();
  const verts: P[] = [];
  const vert = (p: P) => {
    const k = key(p);
    const i = index.get(k);
    if (i !== undefined) return i;
    index.set(k, verts.length);
    verts.push(p);
    return verts.length - 1;
  };

  const half: HalfEdge[] = [];
  for (const s of edges.values()) {
    const u = vert(s.a);
    const v = vert(s.b);
    const h = half.length;
    half.push({ from: u, to: v, twin: h + 1, next: -1, face: -1, circle: s.circle });
    half.push({ from: v, to: u, twin: h, next: -1, face: -1, circle: s.circle });
  }

  // outgoing half-edges per vertex, by bearing
  const out: number[][] = verts.map(() => []);
  half.forEach((h, i) => out[h.from]!.push(i));
  const bearing = (i: number) => {
    const h = half[i]!;
    const a = verts[h.from]!;
    const b = verts[h.to]!;
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  for (const list of out) list.sort((a, b) => bearing(a) - bearing(b) || a - b);
  const slot = new Map<number, number>();
  for (const list of out) list.forEach((h, i) => slot.set(h, i));

  // next(h): at h's far end, the outgoing edge just before h's twin in bearing order.
  // That keeps the face on one consistent side of every half-edge, which is what makes
  // "a wall is a half-edge whose face owner differs from its twin's" well defined.
  for (let i = 0; i < half.length; i++) {
    const t = twinOf(i);
    const list = out[half[t]!.from]!;
    const at = slot.get(t)!;
    half[i]!.next = list[(at - 1 + list.length) % list.length]!;
  }

  // ---- cycles ----
  const cycles: number[][] = [];
  const cycleOf = new Int32Array(half.length).fill(-1);
  for (let i = 0; i < half.length; i++) {
    if (cycleOf[i]! >= 0) continue;
    const cycle: number[] = [];
    let h = i;
    do {
      cycle.push(h);
      cycleOf[h] = cycles.length;
      h = half[h]!.next;
    } while (h !== i && cycle.length <= half.length);
    cycles.push(cycle);
  }
  const areas = cycles.map((c) => cycleArea(c, half, verts));
  const pts = cycles.map((c) => cyclePoints(c, half, verts));

  // ---- cycles into faces ----
  // A cycle that winds the bounded way is a face's outer boundary. One that winds the
  // other way is either a hole in some face or the outside of a whole disconnected
  // piece of the plan — a detached shack has one, and the `next` pointers can never
  // link it to the rest, so containment has to.
  const faces: Face[] = [];
  const faceOfCycle = new Int32Array(cycles.length).fill(-1);
  cycles.forEach((c, i) => {
    if (areas[i]! <= 0) return;
    faceOfCycle[i] = faces.length;
    faces.push({ cycles: [c], area: areas[i]!, probe: [0, 0], tags: [] });
  });
  const outerFace: Face = { cycles: [], area: 0, probe: outsidePoint(verts), tags: [] };
  const outer = faces.length;
  faces.push(outerFace);

  const boxes = pts.map(boxOf);
  cycles.forEach((c, i) => {
    if (areas[i]! > 0) return;
    // A point inside the region this cycle encloses, used to find what contains it.
    // Cycles of one arrangement are nested or disjoint, never crossing, so a containing
    // cycle must also contain this one's bounding box and enclose more area — without
    // both guards the outer boundary of a ring of rooms would "land in" the hole it
    // encircles, whose own boundary contains that point.
    const q = poleOfInaccessibility([pts[i]!]).at;
    const twinCycle = cycleOf[twinOf(c[0]!)]!;
    let best = -1;
    cycles.forEach((d, j) => {
      if (areas[j]! <= -areas[i]! || j === twinCycle) return;
      if (!boxWithin(boxes[i]!, boxes[j]!)) return;
      if (!pointInPolyMm(q, pts[j]!)) return;
      if (best < 0 || areas[j]! < areas[best]!) best = j;
    });
    if (best < 0) {
      outerFace.cycles.push(c);
      outerFace.area += areas[i]!;
      faceOfCycle[i] = outer;
    } else {
      const f = faces[faceOfCycle[best]!]!;
      f.cycles.push(c);
      f.area += areas[i]!;
      faceOfCycle[i] = faceOfCycle[best]!;
    }
  });
  for (let h = 0; h < half.length; h++) half[h]!.face = faceOfCycle[cycleOf[h]!]!;

  const polys = rings.map((r) => ringPolyline(r));
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i]!;
    if (i !== outer) f.probe = facePole(f, half, verts);
    f.tags = polys.flatMap((poly, k) => (pointInPolyMm(f.probe, poly) ? [k] : []));
  }
  return { verts, half, faces, outer, rings };
}

const keyOf = (a: P, b: P) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? `${key(a)}|${key(b)}` : `${key(b)}|${key(a)}`);

function ringPolyline(ring: MmRing): P[] {
  const out: P[] = [];
  for (const e of ringEdges(ring)) {
    out.push(e.a);
    if (e.arc) for (const p of flattenArc(e.arc)) out.push(p);
  }
  return out;
}

/**
 * Signed area of one boundary cycle, exact over arcs.
 *
 * The chords come from `flattenArc`, so the polygon through them understates a convex
 * curve by the circular segment each chord cuts off — 0.0138 m² on an R = 3 m circle,
 * which is enough to show in a printed area. Each edge that lies on a circle therefore
 * adds its segment back, signed by which side of the chord the centre is on.
 */
function cycleArea(cycle: number[], half: HalfEdge[], verts: P[]): number {
  let a = 0;
  for (const h of cycle) {
    const p = verts[half[h]!.from]!;
    const q = verts[half[h]!.to]!;
    a += (p[0] * q[1] - q[0] * p[1]) / 2;
    const circle = half[h]!.circle;
    if (!circle) continue;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const d = Math.min(1, L / (2 * circle.r));
    const delta = 2 * Math.asin(d);
    a += Math.sign(orient(p, q, [circle.c[0], circle.c[1]] as unknown as P)) * ((circle.r * circle.r * (delta - Math.sin(delta))) / 2);
  }
  return a;
}

const cyclePoints = (cycle: number[], half: HalfEdge[], verts: P[]): P[] => cycle.map((h) => verts[half[h]!.from]!);

function boxOf(poly: P[]): { x0: number; y0: number; x1: number; y1: number } {
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

type Bx = ReturnType<typeof boxOf>;
const boxWithin = (inner: Bx, outer: Bx) =>
  outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 && outer.y1 >= inner.y1;

function outsidePoint(verts: P[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const v of verts) {
    if (v[0] < x) x = v[0];
    if (v[1] < y) y = v[1];
  }
  return [x - 1000, y - 1000];
}

/**
 * A point inside the face, as far from its boundary as possible.
 *
 * INVARIANT: not "a boundary midpoint nudged inward by half a millimetre". On a face
 * 0.3 mm across that lands outside, and the arrangement does produce faces that thin
 * where two rings very nearly coincide (docs/gaps-design.md §1.3.1 item 5).
 */
function facePole(f: Face, half: HalfEdge[], verts: P[]): [number, number] {
  // a probe only has to be safely inside, so it stops at 5 % of the clearance it has
  // already found; the exact pole is wanted only where it is reported (§1.3.5)
  return poleOfInaccessibility(f.cycles.map((c) => cyclePoints(c, half, verts)), 1, 0.05).at;
}

// ---------- the inscribed circle ----------

export interface Pole {
  at: [number, number];
  /** clearance from every boundary, mm */
  r: number;
}

/** Signed distance to a set of rings: positive inside, negative outside. */
export function distanceToRings(p: [number, number], rings: Array<Array<[number, number]>>): number {
  let best = Infinity;
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) best = Math.min(best, distToSeg(p, ring[i]!, ring[(i + 1) % ring.length]!));
  let inside = false;
  for (const ring of rings) if (pointInPolyMm(p, ring)) inside = !inside;
  return inside ? best : -best;
}

export function distToSeg(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}

/**
 * The pole of inaccessibility: the centre of the largest circle that fits inside
 * `rings` (outer ring first, holes after). A quadtree refinement, as Mapbox's polylabel
 * does it, on a deterministic queue — no randomness, no dependence on input order.
 *
 * Ties are broken by taking the centre of the cell that achieved the optimum, and cells
 * are searched in a fixed order, so a rectangle — whose optimum is a whole segment of
 * its medial axis — always yields the same answer.
 */
export function poleOfInaccessibility(
  rings: Array<Array<[number, number]>>,
  precision = 0.5,
  relative = 0,
): Pole {
  const flat = rings.flat();
  if (flat.length === 0) return { at: [0, 0], r: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of flat) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const w = x1 - x0;
  const h = y1 - y0;
  const cellSize = Math.max(Math.min(w, h), 1e-9);
  interface Cell {
    x: number;
    y: number;
    half: number;
    d: number;
    max: number;
  }
  const make = (x: number, y: number, half: number): Cell => {
    const d = distanceToRings([x, y], rings);
    return { x, y, half, d, max: d + half * Math.SQRT2 };
  };
  // a max-heap on `max`, ties broken by position, so the search order — and therefore
  // the answer for a shape whose optimum is a whole segment, like any rectangle — does
  // not depend on the order the cells happened to be created in
  const better = (a: Cell, b: Cell) => a.max > b.max || (a.max === b.max && (a.x < b.x || (a.x === b.x && a.y < b.y)));
  const queue: Cell[] = [];
  const push = (c: Cell) => {
    queue.push(c);
    let i = queue.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!better(queue[i]!, queue[p]!)) break;
      [queue[i], queue[p]] = [queue[p]!, queue[i]!];
      i = p;
    }
  };
  const pop = (): Cell => {
    const top = queue[0]!;
    const last = queue.pop()!;
    if (queue.length) {
      queue[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < queue.length && better(queue[l]!, queue[m]!)) m = l;
        if (r < queue.length && better(queue[r]!, queue[m]!)) m = r;
        if (m === i) break;
        [queue[i], queue[m]] = [queue[m]!, queue[i]!];
        i = m;
      }
    }
    return top;
  };
  const step = cellSize / 2;
  for (let x = x0; x < x1 + step; x += step)
    for (let y = y0; y < y1 + step; y += step) push(make(x + step / 2, y + step / 2, step / 2));
  let best = make(x0 + w / 2, y0 + h / 2, 0);
  let guard = 0;
  while (queue.length && guard++ < 200_000) {
    const c = pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= Math.max(precision, best.d * relative)) continue;
    const q = c.half / 2;
    push(make(c.x - q, c.y - q, q));
    push(make(c.x + q, c.y - q, q));
    push(make(c.x - q, c.y + q, q));
    push(make(c.x + q, c.y + q, q));
  }
  return { at: [best.x, best.y], r: Math.max(0, best.d) };
}

// ---------- reading the arrangement ----------

/** The face on the other side of a half-edge. */
export const twin = twinOf;

/** Every face whose tag set satisfies the predicate, as boundary rings in millimetres. */
export function facesWhere(a: Arrangement, keep: (tags: number[], face: Face) => boolean): P[][] {
  const wanted = new Set<number>();
  a.faces.forEach((f, i) => {
    if (i !== a.outer && keep(f.tags, f)) wanted.add(i);
  });
  return traceBoundary(a, wanted);
}

/** The boundary of a set of faces: one ring per closed loop, holes as their own loops. */
export function traceBoundary(a: Arrangement, faces: ReadonlySet<number>): P[][] {
  const live = new Set<number>();
  for (let h = 0; h < a.half.length; h++)
    if (faces.has(a.half[h]!.face) && !faces.has(a.half[twinOf(h)]!.face)) live.add(h);
  const rings: P[][] = [];
  /**
   * Rotate about the far vertex until the boundary resumes. `next(h)` leaves `h`'s own
   * face, so following it alone would walk round that one face and miss the moment the
   * boundary crosses into a neighbour that is also in the set; stepping through the twin
   * of every edge that is *not* on the boundary is what carries the walk across.
   */
  const onward = (h: number): number => {
    let g = a.half[h]!.next;
    for (let guard = 0; guard < a.half.length; guard++) {
      if (live.has(g)) return g;
      g = a.half[twinOf(g)]!.next;
    }
    return g;
  };
  while (live.size) {
    const start: number = live.values().next().value!;
    const ring: P[] = [];
    let h = start;
    do {
      live.delete(h);
      ring.push(a.verts[a.half[h]!.from]!);
      h = onward(h);
    } while (h !== start && live.has(h));
    if (ring.length >= 3) rings.push(dropCollinear(ring));
  }
  return rings;
}

function dropCollinear(ring: P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[(i - 1 + ring.length) % ring.length]!;
    const c = ring[i]!;
    const n = ring[(i + 1) % ring.length]!;
    if (orient(p, c, n) !== 0) out.push(c);
  }
  return out.length >= 3 ? out : ring;
}

/**
 * Overlay: the boolean operations, as face predicates over one arrangement.
 *
 * INVARIANT: this is why there is no clipper in this repository. Union, intersection and
 * difference are the same arrangement read three ways, so there is one robustness story
 * instead of two — and the degeneracies a clipper is worst at, shared vertices and
 * collinear overlapping edges, are exactly what wall junctions are made of
 * (docs/gaps-design.md §1.3.2, dissent D2).
 */
export const overlay = (rings: MmRing[]): Arrangement => arrange(rings);

/** Area, in mm², of the region covered by at least `n` of the input rings. */
export function coveredArea(a: Arrangement, n: number): number {
  let area = 0;
  a.faces.forEach((f, i) => {
    if (i !== a.outer && f.tags.length >= n) area += f.area;
  });
  return area;
}

/** Area, in mm², covered by ring `i` and by none of `others`. */
export function areaOnly(a: Arrangement, i: number, others: ReadonlySet<number>): number {
  let area = 0;
  a.faces.forEach((f, k) => {
    if (k === a.outer || !f.tags.includes(i)) return;
    if (f.tags.some((t) => others.has(t))) return;
    area += f.area;
  });
  return area;
}

/** Area, in mm², covered by both ring `i` and ring `j`. */
export function areaBoth(a: Arrangement, i: number, j: number): number {
  let area = 0;
  a.faces.forEach((f, k) => {
    if (k !== a.outer && f.tags.includes(i) && f.tags.includes(j)) area += f.area;
  });
  return area;
}

/** The sub-arc a chain of edges on one circle describes, or undefined if it is straight. */
export function arcThrough(circle: { arc: Arc }, from: P, via: P, to: P): Arc | undefined {
  const arc = circle.arc;
  const ang = (p: P) => Math.atan2(p[1] - arc.c[1], p[0] - arc.c[0]);
  const t0 = ang(from);
  const tm = ang(via);
  const t1 = ang(to);
  const twoPi = 2 * Math.PI;
  const fwd = (a: number, b: number) => ((b - a) % twoPi + twoPi) % twoPi;
  const cw = fwd(t0, tm) <= fwd(t0, t1);
  const span = cw ? fwd(t0, t1) : -fwd(t1, t0);
  if (Math.abs(span) < 1e-12) return undefined;
  return { c: arc.c, r: arc.r, t0, span, a: from, b: to };
}

/** Is this arrangement edge on a circle at all? */
export const edgeArc = (h: HalfEdge): Arc | undefined => h.circle?.arc;

export { arcParamAt };
