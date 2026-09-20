// The mitred inward offset of a ring, and the clear floor it defines.
//
// Rooms are authored on wall centrelines, so the floor you can stand on is the ring
// brought in by half the thickness of the wall along each edge — a different distance on
// each edge, because an exterior wall and a partition are not the same thickness.
//
// The library used to compute that area from a closed form, `A − Σ len·t/2 + Σ ±t₁t₂/4`,
// whose corner term assumes a right angle. Measured against the true mitred polygon on an
// isoceles triangle with 5 m arms it is −0.6 % at a 90° apex, −4.2 % at 20° and −28 % at
// 10° (docs/gaps-design.md §1.3.4, dissent D4). No better closed form is worth chasing:
// construct the polygon and take its area. One offsetter, four consumers — the clear
// area, the inscribed circle, the clear rectangle, and one day the wall outlines.

import type { Arc, MmRing, P } from "./ring.ts";
import { ringArea, ringEdges } from "./ring.ts";

type V = [number, number];

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const len = (a: V) => Math.hypot(a[0], a[1]);
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];

/** One offset edge, as the curve that supports it plus where it currently starts and ends. */
type Elem =
  | { kind: "line"; through: V; dir: V; a: V; b: V; src: number }
  | { kind: "arc"; c: V; r: number; ccw: boolean; a: V; b: V; src: number };

/**
 * Inward offset of a ring by a per-edge distance, mitred at the corners.
 *
 * An arc offsets to the same arc on the same centre with its radius reduced (when the
 * interior is on the centre's side) or increased (when it is not) — one case, still
 * exact, which is the whole reason arcs are kept as arcs rather than flattened.
 *
 * Where an edge is shorter than the offsets meeting on it the mitred ring turns back on
 * itself. Such edges are dropped and the neighbours re-mitred, which is the explicit
 * form of the `Math.max(0, …)` that used to sit at the end of the closed form and was
 * doing real work undocumented. If nothing survives, the ring is empty and the caller
 * should say so: a room with no clear floor is a room the author wants to hear about.
 */
export function offsetRing(ring: MmRing, dist: (edge: number) => number): MmRing {
  const inward = Math.sign(ringArea(ring)) >= 0 ? 1 : -1;
  const edges = ringEdges(ring);
  let elems: Elem[] = [];
  edges.forEach((e, i) => {
    const d = dist(i);
    if (e.arc) elems.push(arcElem(e.arc, d, inward, i));
    else {
      const dir = sub(e.b as V, e.a as V);
      const l = len(dir);
      if (l === 0) return;
      const u: V = [dir[0] / l, dir[1] / l];
      const n: V = [-u[1] * inward * d, u[0] * inward * d];
      elems.push({
        kind: "line",
        through: [e.a[0] + n[0], e.a[1] + n[1]],
        dir: u,
        a: [e.a[0] + n[0], e.a[1] + n[1]],
        b: [e.b[0] + n[0], e.b[1] + n[1]],
        src: i,
      });
    }
  });
  if (elems.length < 2) return { pts: [], arcs: [] };

  for (let pass = 0; pass <= elems.length + 1; pass++) {
    join(elems, edges);
    const keep = elems.filter((el) => !reversed(el, edges));
    if (keep.length === elems.length) break;
    if (keep.length < 2) return { pts: [], arcs: [] };
    elems = keep;
  }
  if (elems.length < 2) return { pts: [], arcs: [] };
  join(elems, edges);

  // Assemble: each element contributes its start point, plus a step when the join could
  // not be mitred (two parallel edges of different thickness meeting head on).
  const pts: P[] = [];
  const arcs: Array<Arc | undefined> = [];
  for (let i = 0; i < elems.length; i++) {
    const el = elems[i]!;
    const next = elems[(i + 1) % elems.length]!;
    pts.push([el.a[0], el.a[1]]);
    arcs.push(el.kind === "arc" ? arcRecord(el) : undefined);
    // a micron is far below anything this library measures; two ends that close to each
    // other met, and inserting a step between them would only add float noise
    if (len(sub(el.b, next.a)) > 1e-6) {
      pts.push([el.b[0], el.b[1]]);
      arcs.push(undefined);
    }
  }
  const out: MmRing = { pts, arcs };
  // a ring that has turned itself inside out has no clear floor at all
  return Math.sign(ringArea(out)) === Math.sign(ringArea(ring)) ? out : { pts: [], arcs: [] };
}

function arcElem(arc: Arc, d: number, inward: number, src: number): Elem {
  // does the inward normal point at the centre? then the offset arc is the smaller one
  const mid: V = [arc.c[0] + arc.r * Math.cos(arc.t0 + arc.span / 2), arc.c[1] + arc.r * Math.sin(arc.t0 + arc.span / 2)];
  const s = Math.sign(arc.span) || 1;
  const tan: V = [-Math.sin(arc.t0 + arc.span / 2) * s, Math.cos(arc.t0 + arc.span / 2) * s];
  const n: V = [-tan[1] * inward, tan[0] * inward];
  const toCentre = sub(arc.c as V, mid);
  const r = dot(n, toCentre) > 0 ? arc.r - d : arc.r + d;
  const t1 = arc.t0 + arc.span;
  return {
    kind: "arc",
    c: arc.c as V,
    r: Math.max(0, r),
    ccw: arc.span < 0,
    a: [arc.c[0] + r * Math.cos(arc.t0), arc.c[1] + r * Math.sin(arc.t0)],
    b: [arc.c[0] + r * Math.cos(t1), arc.c[1] + r * Math.sin(t1)],
    src,
  };
}

function arcRecord(el: Elem & { kind: "arc" }): Arc {
  const t0 = Math.atan2(el.a[1] - el.c[1], el.a[0] - el.c[0]);
  const t1 = Math.atan2(el.b[1] - el.c[1], el.b[0] - el.c[0]);
  const twoPi = 2 * Math.PI;
  let span = el.ccw ? -(((t0 - t1) % twoPi + twoPi) % twoPi) : ((t1 - t0) % twoPi + twoPi) % twoPi;
  if (Math.abs(span) < 1e-12) span = 0;
  return { c: el.c, r: el.r, t0, span, a: [el.a[0], el.a[1]], b: [el.b[0], el.b[1]] };
}

/** Meet every consecutive pair of offset elements at their true mitre point. */
function join(elems: Elem[], edges: ReturnType<typeof ringEdges>): void {
  for (let i = 0; i < elems.length; i++) {
    const a = elems[i]!;
    const b = elems[(i + 1) % elems.length]!;
    // where the authored corner was, as the tie-break between two candidate meetings
    const corner = edges[a.src]!.b as V;
    const hit = meet(a, b, corner);
    if (!hit) continue;
    a.b = hit;
    b.a = hit;
  }
}

function meet(a: Elem, b: Elem, near: V): V | undefined {
  const cands =
    a.kind === "line" && b.kind === "line"
      ? lineLine(a, b)
      : a.kind === "line" && b.kind === "arc"
        ? lineCircle(a, b)
        : a.kind === "arc" && b.kind === "line"
          ? lineCircle(b, a)
          : circleCircle(a as Elem & { kind: "arc" }, b as Elem & { kind: "arc" });
  if (cands.length === 0) return undefined;
  let best = cands[0]!;
  for (const c of cands) if (len(sub(c, near)) < len(sub(best, near))) best = c;
  return best;
}

function lineLine(a: Elem & { kind: "line" }, b: Elem & { kind: "line" }): V[] {
  const den = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
  if (Math.abs(den) < 1e-12) return [];
  const t = ((b.through[0] - a.through[0]) * b.dir[1] - (b.through[1] - a.through[1]) * b.dir[0]) / den;
  return [[a.through[0] + a.dir[0] * t, a.through[1] + a.dir[1] * t]];
}

function lineCircle(l: Elem & { kind: "line" }, c: Elem & { kind: "arc" }): V[] {
  const f = sub(l.through, c.c);
  const bq = 2 * dot(f, l.dir);
  const cq = dot(f, f) - c.r * c.r;
  const disc = bq * bq - 4 * cq;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  return [(-bq - s) / 2, (-bq + s) / 2].map((t): V => [l.through[0] + l.dir[0] * t, l.through[1] + l.dir[1] * t]);
}

function circleCircle(a: Elem & { kind: "arc" }, b: Elem & { kind: "arc" }): V[] {
  const d = sub(b.c, a.c);
  const dd = len(d);
  if (dd < 1e-12 || dd > a.r + b.r || dd < Math.abs(a.r - b.r)) return [];
  const x = (dd * dd - b.r * b.r + a.r * a.r) / (2 * dd);
  const h2 = a.r * a.r - x * x;
  if (h2 < 0) return [];
  const h = Math.sqrt(h2);
  const mx = a.c[0] + (d[0] * x) / dd;
  const my = a.c[1] + (d[1] * x) / dd;
  return [
    [mx + (d[1] * h) / dd, my - (d[0] * h) / dd],
    [mx - (d[1] * h) / dd, my + (d[0] * h) / dd],
  ];
}

/** Has this offset element ended up running the other way from the edge it came from? */
function reversed(el: Elem, edges: ReturnType<typeof ringEdges>): boolean {
  const e = edges[el.src]!;
  if (el.kind === "line") {
    const was = sub(e.b as V, e.a as V);
    const now = sub(el.b, el.a);
    return dot(was, now) < 0;
  }
  const arc = arcRecord(el);
  return Math.sign(arc.span) !== Math.sign(e.arc?.span ?? arc.span) || el.r <= 0;
}

/** Area in mm² of the clear floor a ring leaves under its walls. Never negative. */
export const offsetArea = (ring: MmRing, dist: (edge: number) => number): number =>
  Math.abs(ringArea(offsetRing(ring, dist)));
