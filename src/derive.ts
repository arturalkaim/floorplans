import { arcThrough, arrange, areaBoth, distToSeg, poleOfInaccessibility, segmentsCross, traceBoundary } from "./arrangement.ts";
import type { Arrangement, Face } from "./arrangement.ts";
import { bbox, eq, largestRect, pointInPoly, snap } from "./geometry.ts";
import { offsetRing } from "./offset.ts";
import {
  arcChords,
  arcLength,
  arcPoint,
  arcTangent,
  mmRing,
  onArc,
  pointInPolyMm,
  ptM,
  ptMm,
  ringArea,
  ringBox,
  ringEdges,
  ringPoints,
  sagitta,
  toM,
  toMm,
} from "./ring.ts";
import type { Arc, MmRing, P } from "./ring.ts";
import type {
  Analysis,
  ArcSpec,
  Axis,
  FaceModel,
  Finding,
  Fixture,
  FixtureModel,
  Level,
  LevelModel,
  Model,
  Opening,
  Owner,
  Plan,
  Pt,
  ResolvedOpening,
  RoomModel,
  Shape,
  Side,
  Vertical,
  Wall,
  WallCandidate,
  WallGeometry,
} from "./types.ts";
import {
  EXTERIOR,
  GAP,
  inLevel,
  isOpenSky,
  isRectilinear,
  isVoid,
  outdoorOwner,
  ownerId,
  ownerKey,
  pathTo,
  roomOwner,
  sameOwner,
  voidOwner,
} from "./types.ts";

const MM = 0.001;
const CORNER_SLIVER = 0.1;
/**
 * A face this small is a slip of the pen, not a room: 100 mm² is the area a 1 mm
 * authoring error leaves over a 20 cm run (docs/gaps-design.md §1.3.3). It is reported
 * rather than screamed about, and named, because silently swallowing it is how a 3 mm
 * slip becomes an invisible wrong area.
 */
const SLIVER_M2 = 1e-4;
/** Below this interior angle the mitred wall faces meet so far from the corner that the corner is not floor. */
const ACUTE_DEG = 25;
/** An arc flatter than this is a straight wall written expensively. */
const SHALLOW_SAGITTA_MM = 5;

/**
 * Turn authored rooms into walls, resolve openings onto walls, compute room
 * metrics and the access graph, one level at a time; then join the levels.
 * Geometry/topology problems are returned as findings, never thrown, so a
 * broken plan still yields a drawable model.
 */
export function derive(plan: Plan): Analysis {
  const findings: Finding[] = [];
  const models: LevelModel[] = [];
  for (const level of plan.levels) {
    // A vertical element is an obstacle on every level it serves, exactly as a `stairs`
    // fixture is, so it reuses that machinery rather than a second kind of occupant.
    const fixtures = [...level.fixtures, ...syntheticFixtures(plan.vertical, level)];
    const r = deriveLevel(plan, level, fixtures);
    models.push(r.model);
    for (const f of r.findings) findings.push(plan.levelled ? { ...f, level: level.id } : f);
  }

  const ground = models[Math.max(0, models.findIndex((m) => m.level.ground))]!;
  const model: Model = {
    ...ground,
    plan,
    levels: models,
    building: buildingOf(plan, models),
  };
  return { model, findings };
}

/**
 * One synthetic fixture per level a vertical element serves. `index` deliberately
 * addresses nothing in the document — `vertical` names the element instead — so an edit
 * or a finding can never point a reader at the wrong `fixtures[i]`.
 */
function syntheticFixtures(vertical: Vertical[], level: Level): Fixture[] {
  const out: Fixture[] = [];
  for (const v of vertical) {
    v.at.forEach((at, j) => {
      if (at.level !== level.id) return;
      out.push({
        index: -1,
        // ":" keeps this out of the authored-fixture id namespace, exactly as a
        // synthesised opening id is kept out of the authored one
        id: `vertical:${v.id}`,
        path: `${v.path}.at[${j}]`,
        authored: [],
        type: v.type === "stairs" ? "stairs" : "other",
        name: v.name,
        in: at.in,
        poly: at.poly,
        arcs: at.arcs,
        depth: undefined,
        vertical: v.id,
      });
    });
  }
  return out;
}

/**
 * What only exists across levels: the combined access graph, and the totals. Each
 * vertical element joins the nodes of consecutive levels it serves; the street is one
 * node however many levels reach it, so a walk from the road crosses the whole building.
 */
function buildingOf(plan: Plan, models: LevelModel[]): Model["building"] {
  const access = new Map<string, Set<string>>();
  const groundIds = new Set(plan.levels.filter((l) => l.ground).map((l) => l.id));
  /**
   * INVARIANT: the street is one node, and only a ground level touches it. A door to open
   * air on an upper floor gets its own `piso1/exterior` node instead, which no walk ever
   * starts from — so a first-floor balcony door cannot make the first floor reachable and
   * hide a missing stair.
   */
  const node = (levelId: string, key: string) =>
    key === "exterior" && groundIds.has(levelId) ? "exterior" : `${levelId}/${key}`;
  const link = (a: string, b: string) => {
    (access.get(a) ?? access.set(a, new Set()).get(a)!).add(b);
    (access.get(b) ?? access.set(b, new Set()).get(b)!).add(a);
  };
  access.set("exterior", new Set());
  const roomsOn = new Map(models.map((m) => [m.level.id, new Set(m.rooms.map((r) => r.room.id))]));
  for (const m of models) {
    for (const [k, ns] of m.access) {
      const from = node(m.level.id, k);
      if (!access.has(from)) access.set(from, new Set());
      for (const n of ns) link(from, node(m.level.id, n));
    }
  }
  const arrival = (at: { level: string; in: string }) =>
    node(at.level, `${roomsOn.get(at.level)?.has(at.in) ? "room" : "outdoor"}:${at.in}`);
  for (const v of plan.vertical) {
    for (let i = 1; i < v.at.length; i++) link(arrival(v.at[i - 1]!), arrival(v.at[i]!));
  }
  return {
    access,
    grossArea: snap(models.reduce((s, m) => s + m.envelope.area, 0)),
    footprint: snap(Math.max(0, ...models.map((m) => m.envelope.area))),
    storeys: models.length,
  };
}

// ---------- shapes ----------

/**
 * The authored shape as a millimetre ring, which is the only form the core works in.
 *
 * INVARIANT: the cache is keyed on the shape's identity and never invalidated, which is
 * safe because nothing downstream of `parse` mutates a shape — an edit re-parses the
 * document and produces new objects. It matters: a shape with arcs costs a `resolveArc`
 * per edge, and `pointInShape` is called once per grid cell per room.
 */
const RINGS = new WeakMap<Shape, MmRing>();
export function ringOf(s: Shape): MmRing {
  let r = RINGS.get(s);
  if (r === undefined) {
    r = mmRing({ pts: s.poly, arcs: s.arcs });
    RINGS.set(s, r);
  }
  return r;
}

/** Centreline area in m², exact over arcs. */
export const shapeArea = (s: Shape): number => Math.abs(ringArea(ringOf(s))) / 1e6;

/** Bounding box in metres, tight over an arc's bulge. Memoised like `ringOf`. */
const BOXES = new WeakMap<Shape, { x0: number; y0: number; x1: number; y1: number }>();
export function shapeBox(s: Shape): { x0: number; y0: number; x1: number; y1: number } {
  let box = BOXES.get(s);
  if (box === undefined) {
    const b = ringBox(ringOf(s));
    box = { x0: toM(b.x0), y0: toM(b.y0), x1: toM(b.x1), y1: toM(b.y1) };
    BOXES.set(s, box);
  }
  return box;
}

/**
 * How much of `a` stands on `b`, in m². The arrangement of the two rings, read with an
 * intersection predicate — the boolean operation that needs no clipper (§1.3.2).
 */
export const overlapArea = (a: Shape, b: Shape): number => areaBoth(arrange([ringOf(a), ringOf(b)]), 0, 1) / 1e6;

/** Is `a` entirely on `b`'s floor? The area that is, against the area there is. */
export const shapeWithin = (a: Shape, b: Shape): boolean => Math.abs(overlapArea(a, b) - shapeArea(a)) <= 1e-6;

/**
 * The part of `a` that none of `others` covers: how much, in m², and a point in it. One
 * arrangement of every ring involved, read with a "covered by a and by nothing else"
 * predicate — the difference of §1.3.2's table.
 */
export function uncovered(a: Shape, others: Shape[]): { area: number; at: Pt } {
  const arr = arrange([ringOf(a), ...others.map(ringOf)]);
  const rest = new Set(others.map((_, i) => i + 1));
  let area = 0;
  let cx = 0;
  let cy = 0;
  arr.faces.forEach((f, i) => {
    if (i === arr.outer || !f.tags.includes(0) || f.tags.some((t) => rest.has(t))) return;
    area += f.area;
    cx += f.area * f.probe[0];
    cy += f.area * f.probe[1];
  });
  if (area <= 0) return { area: 0, at: [0, 0] };
  return { area: snap(area / 1e6), at: [snap(toM(cx / area)), snap(toM(cy / area))] };
}

/**
 * Is this point on the shape's boundary, to the millimetre? Used to decide whether
 * moving a wall's end would drag a corner off a third space's edge — the T-junction that
 * a "is it one of its corners" test misses.
 */
export function pointOnShapeBoundary(p: Pt, s: Shape, tol = 0.001): boolean {
  const q = ptMm(p);
  const ring = ringPoints(ringOf(s));
  const t = toMm(tol);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2));
    if (Math.hypot(q[0] - a[0] - dx * u, q[1] - a[1] - dy * u) <= t) return true;
  }
  return false;
}

/**
 * Shortest distance between two shapes, in metres; 0 when they touch or overlap.
 *
 * Replaces the distance between two *bounding boxes*, which was already wrong for an
 * L-shaped kitchen run before any wall was angled (docs/gaps-design.md §1.3.6). Arcs are
 * measured on their canonical chords, so a curved fixture is understated by at most the
 * one-millimetre sagitta.
 */
export function shapeGap(a: Shape, b: Shape): number {
  const ra = ringPoints(ringOf(a));
  const rb = ringPoints(ringOf(b));
  if (pointInPolyMm(ra[0]!, rb) || pointInPolyMm(rb[0]!, ra)) return 0;
  let best = Infinity;
  for (let i = 0; i < ra.length; i++)
    for (let j = 0; j < rb.length; j++)
      best = Math.min(best, segGap(ra[i]!, ra[(i + 1) % ra.length]!, rb[j]!, rb[(j + 1) % rb.length]!));
  return toM(best);
}

function segGap(a: P, b: P, c: P, d: P): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(distToSeg(a, c, d), distToSeg(b, c, d), distToSeg(c, a, b), distToSeg(d, a, b));
}

/**
 * Does the quarter-disc a door leaf sweeps meet this shape?
 *
 * The exact predicate, rather than "do their bounding boxes overlap and is the nearest
 * corner of the overlap within reach": a vertex inside the sector, an edge crossing
 * either radius, an edge crossing the arc, or the hinge inside the shape.
 */
export function sectorMeetsShape(hinge: Pt, closed: Pt, open: Pt, s: Shape): boolean {
  const h = ptMm(hinge);
  const c = ptMm(closed);
  const o = ptMm(open);
  const r = Math.hypot(c[0] - h[0], c[1] - h[1]);
  if (r === 0) return false;
  const ring = ringPoints(ringOf(s));
  if (pointInPolyMm(h, ring)) return true;
  const a0 = Math.atan2(c[1] - h[1], c[0] - h[0]);
  const a1 = Math.atan2(o[1] - h[1], o[0] - h[0]);
  const twoPi = 2 * Math.PI;
  const span = ((a1 - a0 + Math.PI) % twoPi + twoPi) % twoPi - Math.PI; // the short way, ±π
  const inSector = (p: [number, number]) => {
    const d = Math.hypot(p[0] - h[0], p[1] - h[1]);
    if (d > r + 1e-9) return false;
    const t = ((Math.atan2(p[1] - h[1], p[0] - h[0]) - a0 + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
    return span >= 0 ? t >= -1e-9 && t <= span + 1e-9 : t <= 1e-9 && t >= span - 1e-9;
  };
  for (const p of ring) if (inSector(p)) return true;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    if (segmentsCross(h, c, p, q) || segmentsCross(h, o, p, q)) return true;
    // where the edge crosses the circle of the sweep
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const fx = p[0] - h[0];
    const fy = p[1] - h[1];
    const A = dx * dx + dy * dy;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - r * r;
    const disc = B * B - 4 * A * C;
    if (A === 0 || disc < 0) continue;
    const root = Math.sqrt(disc);
    for (const t of [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
      if (t < 0 || t > 1) continue;
      if (inSector([p[0] + dx * t, p[1] + dy * t])) return true;
    }
  }
  return false;
}

/**
 * Is this point inside the shape? Arcs are tested on their canonical chords.
 *
 * The bounding box first: the clear-rectangle sweep asks this once per grid cell per room,
 * and a curved room's ring is a hundred chords, so rejecting the cells that are nowhere
 * near it is most of the work saved.
 */
export function pointInShape(p: Pt, s: Shape): boolean {
  const b = shapeBox(s);
  if (p[0] < b.x0 || p[0] > b.x1 || p[1] < b.y0 || p[1] > b.y1) return false;
  return s.arcs.some((a) => a !== undefined) ? pointInPolyMm(ptMm(p), ringPoints(ringOf(s))) : pointInPoly(p, s.poly);
}

// ---------- one storey ----------

/** Everything derived from one storey alone. */
function deriveLevel(plan: Plan, level: Level, planFixtures: Fixture[]): { model: LevelModel; findings: Finding[] } {
  const findings: Finding[] = [];
  const rooms = level.rooms;
  const outdoor = level.outdoor;
  const voids = level.voids;
  // Document paths come from the parser, which recorded where it read each entity — never
  // from a template built here (docs/gaps-design.md §2.5).
  const byRoomId = new Map(rooms.map((r) => [r.id, r]));

  // ---- the planar arrangement: every declared space's ring, woven together ----
  const spaces: Array<Shape & { path: string }> = [...rooms, ...outdoor, ...voids];
  const R = rooms.length;
  const O = outdoor.length;
  const arr = arrange(spaces.map(ringOf));

  // Snap-rounding has a budget of passes, not a proof, and a plan can reach the end of it
  // still moving — a handful of chords bending onto one another's hot pixels in a cycle.
  // Everything below is a well-formed arrangement of the chords as they stood when the
  // budget ran out, which is not the same thing as the arrangement of the document, so it
  // is said out loud rather than returned as if it were settled (gpt-5.5 §2.7).
  if (arr.unstable) {
    const u = arr.unstable;
    const box = [toM(u.box.x0), toM(u.box.y0), toM(u.box.x1), toM(u.box.y1)].map(snap);
    findings.push({
      rule: "geometry.unstable",
      severity: "error",
      message: `the geometry did not settle: after ${u.passes} rounds of snapping to the millimetre grid, ${u.moved} chords were still moving, all of them between (${box[0]}, ${box[1]}) and (${box[2]}, ${box[3]}). Every wall and area on this level is derived from where they happened to stop; move the edges that meet there apart, or round their coordinates to the millimetre yourself`,
      path: inLevel(level, "rooms"),
      at: [snap((box[0]! + box[2]!) / 2), snap((box[1]! + box[3]!) / 2)],
    });
  }

  /**
   * One owner per face. A face several rooms claim is an `overlap`; one inside the
   * building that nobody claims is a `gap`; the rest are the space that contains the
   * face's probe point. Declared spaces are claimed first, so a deck on the boundary
   * keeps its own id instead of being swallowed by the street.
   */
  const ownerOfFace = (f: Face): Owner => {
    const rs = f.tags.filter((t) => t < R);
    if (rs.length === 1) return roomOwner(rooms[rs[0]!]!.id);
    if (rs.length > 1) return { kind: "overlap", ids: rs.map((t) => rooms[t]!.id) };
    const os = f.tags.filter((t) => t >= R && t < R + O);
    if (os.length) return outdoorOwner(outdoor[os[0]! - R]!.id);
    const vs = f.tags.filter((t) => t >= R + O);
    if (vs.length) return voidOwner(voids[vs[0]! - R - O]!.id);
    return GAP;
  };
  const faceOwner: Owner[] = arr.faces.map(ownerOfFace);
  faceOwner[arr.outer] = EXTERIOR;

  // The street is what a walk from outside reaches over faces no room covers. It passes
  // *through* outdoor faces without claiming them — no wall is ever derived between two
  // voids, so a deck touching the boundary is continuous with the street — and every
  // outdoor space it reaches is street-connected. One it cannot reach is a courtyard:
  // open sky you can only get to from inside the house.
  // A declared void stops the walk exactly as a room does: it is a hole in the slab, not
  // a hole in the building, so the street never flows through it.
  const streetOutdoor = new Set<string>();
  {
    const open = (i: number) => i === arr.outer || faceOwner[i]!.kind === "gap" || faceOwner[i]!.kind === "outdoor";
    const seen = new Set<number>([arr.outer]);
    const stack = [arr.outer];
    while (stack.length) {
      const i = stack.pop()!;
      const o = faceOwner[i]!;
      if (o.kind === "outdoor") streetOutdoor.add(o.id);
      else if (o.kind === "gap") faceOwner[i] = EXTERIOR;
      for (const h of arr.faces[i]!.cycles.flat()) {
        const j = arr.half[arr.half[h]!.twin]!.face;
        if (seen.has(j) || !open(j)) continue;
        seen.add(j);
        stack.push(j);
      }
    }
  }

  /**
   * INVARIANT: a wall never separates a room from the ground it is erroneously sharing
   * with another. An `overlap` face keeps the first claimant for everything except its
   * own `tiling.overlap` finding and `LevelModel.faces`, exactly as the cell grid did.
   * Deriving walls around the overlap instead would box the mistake in partitions that
   * do not exist, put them in the drawing, and shrink the clear floor of a room that is
   * not in fact divided — a plan that is already wrong would then be wrong about more.
   */
  const wallOwner = (i: number): Owner => {
    const o = faceOwner[i]!;
    return o.kind === "overlap" ? roomOwner(o.ids[0]!) : o;
  };

  /** is this owner the room with that id? */
  const isRoom = (o: Owner, id: string) => o.kind === "room" && o.id === id;

  // ---- one finding per face, not one per cell ----
  // A gap or an overlap is a region. The arrangement has no artificial grid lines, so
  // each is a single face however many rooms surround it, and `tilingComponents` — which
  // used to flood-fill cells back together — is gone.
  arr.faces.forEach((f, i) => {
    const o = faceOwner[i]!;
    if (o.kind !== "overlap") return;
    const region = faceRegion(arr, f);
    findings.push({
      rule: "tiling.overlap",
      severity: "error",
      message: `rooms ${o.ids.join(", ")} overlap over ${region.area} m² from (${region.x0}, ${region.y0}) to (${region.x1}, ${region.y1})`,
      // a relation between several rooms: the path names the first, the rest are in `rooms`
      path: byRoomId.get(o.ids[0]!)?.path ?? inLevel(level, "rooms"),
      at: region.at,
      rooms: o.ids,
    });
  });
  arr.faces.forEach((f, i) => {
    if (faceOwner[i]!.kind !== "gap") return;
    const region = faceRegion(arr, f);
    if (f.area / 1e6 < SLIVER_M2) {
      // what the design doc calls dissolving: the face is left where it is and reported,
      // because merging it away would move a wall by a millimetre to hide a mistake
      const around = [
        ...new Set(f.cycles.flat().map((h) => label(wallOwner(arr.half[arr.half[h]!.twin]!.face)))),
      ].sort();
      findings.push({
        rule: "geometry.sliver",
        severity: "info",
        message: `a sliver of floor ${Math.round(f.area)} mm² across is covered by nothing, between ${around.join(" and ")}; two edges that were meant to meet are ${region.area === 0 ? "a fraction of a millimetre" : "just"} apart`,
        // like any absence, it names the collection a fix would edit, not an entity
        path: inLevel(level, "rooms"),
        at: region.at,
      });
      return;
    }
    findings.push({
      rule: "tiling.gap",
      severity: "error",
      message: `no room covers a ${region.area} m² area from (${region.x0}, ${region.y0}) to (${region.x1}, ${region.y1}); the plan has a hole`,
      // an absence has no entity to name, so it names the collection a fix would add to
      path: inLevel(level, "rooms"),
      at: region.at,
    });
  });

  // ---- an arc so shallow it is a straight wall written expensively ----
  for (const space of spaces) {
    const ring = ringOf(space);
    ringEdges(ring).forEach((e) => {
      if (!e.arc) return;
      const s = sagitta(e.arc);
      if (s >= SHALLOW_SAGITTA_MM) return;
      findings.push({
        rule: "arc.too_shallow",
        severity: "warning",
        message: `an arc of radius ${snap(e.arc.r / 1000)} m bulges ${snap(s)} mm past its chord; that is a straight edge, written as ${arcChords(e.arc)} chords' worth of curve`,
        // the arc entry carries the corner it ends at, which is the next index
        path: `${space.path}.poly[${(e.i + 1) % ring.pts.length}]`,
        at: [snap(toM(e.a[0])), snap(toM(e.a[1]))],
      });
    });
  }

  // ---- walls: half-edges whose owner differs from their twin's ----
  const thicknessOf = (a: Owner, b: Owner) =>
    isOpenSky(a) || isOpenSky(b) ? plan.walls.exterior : plan.walls.partition;
  const walls = wallsOf(arr, wallOwner, thicknessOf);
  const wallOfEdge = new Map<number, Wall>();
  for (const w of walls) for (const h of (w as Wall & { edges: number[] }).edges) wallOfEdge.set(h >> 1, w);
  for (const w of walls) delete (w as Wall & { edges?: number[] }).edges;

  // ---- outdoor space is open sky, so no room may stand on it ----
  for (const o of outdoor) {
    for (const r of rooms) {
      if (areaBoth(arr, R + outdoor.indexOf(o), rooms.indexOf(r)) <= 0) continue;
      const b = shapeBox(o);
      findings.push({
        rule: "outdoor.overlap",
        severity: "error",
        message: `${o.name} is open sky but ${r.name} is built over it`,
        path: pathTo(r, "poly", "rect"),
        at: [snap((b.x0 + b.x1) / 2), snap((b.y0 + b.y1) / 2)],
        rooms: [r.id],
      });
    }
  }

  // ---- a void is a hole in the slab, so no room may have floor over it ----
  // `ownerOfFace` prefers a room to a void, which is right for the ordinary case — a void
  // that shares its edge with the room around it claims no face the room also claims —
  // but it means a void drawn *inside* a room is swallowed without trace: no wall round
  // it, its area still counted as interior floor, and nothing said. A declared hole under
  // a declared floor is a contradiction, exactly as a room over open sky is.
  for (const v of voids) {
    for (const r of rooms) {
      if (areaBoth(arr, R + O + voids.indexOf(v), rooms.indexOf(r)) <= 0) continue;
      const b = shapeBox(v);
      findings.push({
        rule: "void.overlap",
        severity: "error",
        message: `${v.name} is a hole in this floor but ${r.name} has floor over it; cut the room back to the void's edge`,
        path: pathTo(r, "poly", "rect"),
        at: [snap((b.x0 + b.x1) / 2), snap((b.y0 + b.y1) / 2)],
        rooms: [r.id],
      });
    }
  }

  // ---- fixtures standing inside rooms ----
  // a fixture stands in a room or in an outdoor space — a pool is a pool either way
  const hostShape = new Map<string, Shape>([
    ...rooms.map((r) => [r.id, r as Shape] as const),
    ...outdoor.map((o) => [o.id, o as Shape] as const),
  ]);
  const fixtureModels: FixtureModel[] = planFixtures.map((fixture) => ({
    fixture,
    bbox: shapeBox(fixture),
    area: snap(shapeArea(fixture)),
  }));
  /**
   * D3, exactly: how much of each fixture stands on its host's own floor. The overlay is
   * the arrangement of the two rings read with an intersection predicate, so a fixture
   * that straddles a boundary deducts the part that is inside and nothing more — which
   * is what the stopgap that only counted fully-contained fixtures promised to become.
   */
  const insideHost = new Map<FixtureModel, number>();
  for (const fm of fixtureModels) {
    const host = hostShape.get(fm.fixture.in);
    if (!host) continue;
    insideHost.set(fm, overlapArea(fm.fixture, host));
  }
  for (const fm of fixtureModels) {
    // a vertical element's footprint is checked by `stair.no_arrival`, which says the same
    // thing about the same geometry but names the element the author can actually edit
    if (fm.fixture.vertical !== undefined) continue;
    const host = hostShape.get(fm.fixture.in);
    if (!host) continue;
    if (Math.abs((insideHost.get(fm) ?? 0) - fm.area) <= 1e-6) continue;
    findings.push({
      rule: "fixture.outside_space",
      severity: "error",
      message: `${fm.fixture.name} (fixture #${fm.fixture.index}) is not fully inside ${fm.fixture.in}`,
      path: pathTo(fm.fixture, "poly", "at"),
      at: [snap((fm.bbox.x0 + fm.bbox.x1) / 2), snap((fm.bbox.y0 + fm.bbox.y1) / 2)],
      rooms: [fm.fixture.in],
      fixture: fm.fixture.id,
    });
  }
  for (let i = 0; i < fixtureModels.length; i++) {
    for (let j = i + 1; j < fixtureModels.length; j++) {
      const a = fixtureModels[i]!;
      const b = fixtureModels[j]!;
      if (a.fixture.in !== b.fixture.in) continue;
      if (overlapArea(a.fixture, b.fixture) <= 0) continue;
      findings.push({
        rule: "fixture.overlap",
        severity: "error",
        message: `${a.fixture.name} and ${b.fixture.name} overlap in ${a.fixture.in}`,
        path: pathTo(a.fixture, "poly", "at"),
        at: [snap((a.bbox.x0 + a.bbox.x1) / 2), snap((a.bbox.y0 + a.bbox.y1) / 2)],
        rooms: [a.fixture.in],
        ...occupantRef(a.fixture),
      });
    }
  }
  // INVARIANT: a vertical element's footprint is not deducted here, although it does
  // occupy floor for `largestRect`. It is not in the document's `fixtures`, so a reader
  // comparing the schedule against the fixtures they wrote would not be able to account
  // for it; `stair.*` is where a stair's footprint is reported.
  const fixtureAreaOf = (id: string) =>
    snap(
      fixtureModels
        .filter((m) => m.fixture.in === id && m.fixture.vertical === undefined)
        .reduce((t, m) => t + (insideHost.get(m) ?? 0), 0),
    );

  // ---- the coordinate grid the clear rectangle is swept on ----
  // Every distinct x and y of every ring and every fixture, exactly as the cell grid had
  // them: the largest rectangle inside a rectilinear region has its sides on the
  // region's own lines, so this grid is where the optimum lives.
  const grids = new Map<number, ReturnType<typeof buildGrid>>();
  /** The sweep grid for one bearing, built once: rooms that share a bearing share it. */
  const gridOf = (bearingDeg: number) => {
    let g = grids.get(bearingDeg);
    if (g === undefined) {
      g = buildGrid(bearingDeg);
      grids.set(bearingDeg, g);
    }
    return g;
  };
  const buildGrid = (bearingDeg: number) => {
    const rot = rotator(bearingDeg);
    const back = rotator(-bearingDeg);
    const xset = new Set<number>();
    const yset = new Set<number>();
    const take = (s: Shape) => {
      for (const p of ringPoints(ringOf(s))) {
        const q = rot(ptM(p));
        xset.add(snap(q[0]));
        yset.add(snap(q[1]));
      }
    };
    for (const s of spaces) take(s);
    for (const f of planFixtures) take(f);
    const xs = [...xset].sort((a, b) => a - b);
    const ys = [...yset].sort((a, b) => a - b);
    // one pass over the cells, not one per room: which rooms claim each cell, and
    // whether anything stands on it
    const claims: string[][][] = [];
    const busy: boolean[][] = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      const col: string[][] = [];
      const busyCol: boolean[] = [];
      for (let j = 0; j + 1 < ys.length; j++) {
        const c = back([(xs[i]! + xs[i + 1]!) / 2, (ys[j]! + ys[j + 1]!) / 2]);
        col.push(rooms.filter((r) => pointInShape(c, r)).map((r) => r.id));
        busyCol.push(planFixtures.some((f) => pointInShape(c, f)));
      }
      claims.push(col);
      busy.push(busyCol);
    }
    return { xs, ys, rot, back, claims, busy };
  };
  const planGrid = gridOf(0);

  // ---- room metrics ----
  const roomModels: RoomModel[] = rooms.map((room) => {
    const ring = ringOf(room);
    const area = shapeArea(room);
    const straight = isRectilinear(room);
    // A room's own frame: the plan's axes when it is rectilinear, otherwise the bearing
    // of its longest straight edge, so the "clear rectangle" is the one a reader would
    // draw on the floor. An approximation, and documented as one (Appendix B).
    const bearingDeg = straight ? 0 : longestEdgeBearing(room);
    const g = straight ? planGrid : gridOf(bearingDeg);
    // the floor this room owns alone and nothing stands on
    const owned = (i: number, j: number) => {
      const claim = g.claims[i]?.[j];
      return claim !== undefined && claim.length === 1 && claim[0] === room.id && !g.busy[i]![j]!;
    };
    const rect = largestRect(owned, g.xs, g.ys);
    const west = halfWallAlong(walls, g, "v", rect.x0, rect.y0, rect.y1, room.id);
    const east = halfWallAlong(walls, g, "v", rect.x1, rect.y0, rect.y1, room.id);
    const north = halfWallAlong(walls, g, "h", rect.y0, rect.x0, rect.x1, room.id);
    const south = halfWallAlong(walls, g, "h", rect.y1, rect.x0, rect.x1, room.id);
    const clearRect = {
      x0: snap(rect.x0 + west),
      y0: snap(rect.y0 + north),
      x1: snap(rect.x1 - east),
      y1: snap(rect.y1 - south),
      w: snap(rect.x1 - rect.x0 - west - east),
      h: snap(rect.y1 - rect.y0 - north - south),
    };

    // the clear floor: the ring brought in to the faces of the walls along it
    const split = splitByThickness(ring, arr, rooms.indexOf(room), wallOfEdge, room.id);
    const clear = offsetRing(split.ring, (i) => split.dist[i]! / 2);
    const clearArea = Math.abs(ringArea(clear)) / 1e6;
    const inscribed = poleOfInaccessibility(clear.pts.length ? [ringPoints(clear)] : [[[0, 0]]], 0.5);

    if (clear.pts.length === 0 && area > 0) {
      findings.push({
        rule: "room.no_clear_floor",
        severity: "error",
        message: `${room.name} has no floor left once its walls are built: every part of it is within half a wall thickness of another wall`,
        path: pathTo(room, "poly", "rect"),
        rooms: [room.id],
        at: [snap(shapeBox(room).x0), snap(shapeBox(room).y0)],
      });
    }
    for (const c of acuteCorners(split.ring, split.dist)) {
      findings.push({
        rule: "room.acute_corner",
        severity: "info",
        message: `${room.name} has a ${c.deg}° corner at (${snap(toM(c.at[0]))}, ${snap(toM(c.at[1]))}); the wall faces meet ${snap(c.lost / 1000)} m along each arm, so that much of both walls is not floor you can reach`,
        path: pathTo(room, "poly", "rect"),
        rooms: [room.id],
        at: [snap(toM(c.at[0])), snap(toM(c.at[1]))],
      });
    }

    const faces = new Set<Side>();
    for (const wall of walls) {
      if (wall.kind !== "exterior") continue;
      const side = exteriorFaceOf(wall, room.id);
      if (side) faces.add(side);
    }
    const label = g.back([snap((rect.x0 + rect.x1) / 2), snap((rect.y0 + rect.y1) / 2)]);
    const fixtureArea = fixtureAreaOf(room.id);
    return {
      room,
      bbox: shapeBox(room),
      area: snap(area),
      clearRing: { poly: clear.pts.map(ptM), arcs: clear.arcs.map(arcSpecOf) },
      clearArea: snap(clearArea),
      largestRect: rect,
      clearRect,
      bearing: bearingDeg,
      inscribed: { at: ptM([inscribed.at[0], inscribed.at[1]] as P), r: snap(inscribed.r / 1000) },
      minDimension: straight ? snap(Math.min(clearRect.w, clearRect.h)) : snap((2 * inscribed.r) / 1000),
      labelAt: [snap(label[0]), snap(label[1])],
      exteriorWindow: false,
      exteriorFaces: [...faces],
      fixtureArea,
      usableArea: snap(Math.max(0, snap(clearArea) - fixtureArea)),
    };
  });
  const byId = new Map(roomModels.map((m) => [m.room.id, m]));

  // ---- openings ----
  const openings: ResolvedOpening[] = [];
  for (const spec of level.openings) {
    const res = resolveOpening(spec, walls, findings);
    if (res) openings.push(res);
  }
  // collisions per wall
  const perWall = new Map<string, ResolvedOpening[]>();
  for (const o of openings) (perWall.get(o.wall.id) ?? perWall.set(o.wall.id, []).get(o.wall.id)!).push(o);
  for (const list of perWall.values()) {
    list.sort((a, b) => a.from - b.from);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!;
      const b = list[i]!;
      if (b.from < a.to - MM) {
        findings.push({
          rule: "opening.collision",
          severity: "error",
          message: `openings #${a.spec.index} and #${b.spec.index} overlap on the wall between ${label(a.wall.neg)} and ${label(a.wall.pos)}`,
          path: pathTo(b.spec, "at", "position"),
          at: b.center,
          opening: b.spec.id,
        });
      }
    }
  }
  for (const o of openings) {
    if (o.spec.type === "window") {
      if (o.wall.kind !== "exterior") {
        findings.push({
          rule: "window.not_exterior",
          severity: "error",
          message: `window #${o.spec.index} sits on the interior wall between ${label(o.wall.neg)} and ${label(o.wall.pos)}`,
          path: `${o.spec.path}.between`,
          at: o.center,
          opening: o.spec.id,
        });
      } else {
        // the wall is exterior, so exactly one side is open sky; the other is the room
        // that gets the daylight — including when the sky is a courtyard
        const r = ownerId(isOpenSky(o.wall.neg) ? o.wall.pos : o.wall.neg);
        const m = r === undefined ? undefined : byId.get(r);
        if (m) m.exteriorWindow = true;
      }
    } else if (o.spec.type === "door" && o.spec.glazed && o.wall.kind === "exterior") {
      // D1: a glazed exterior door is daylight too, exactly like a window — including onto
      // a courtyard, which is open sky (isOpenSky). A glazed *interior* door (wall.kind !==
      // "exterior") never reaches here, so it never counts.
      const r = ownerId(isOpenSky(o.wall.neg) ? o.wall.pos : o.wall.neg);
      const m = r === undefined ? undefined : byId.get(r);
      if (m) m.exteriorWindow = true;
    }
  }

  // ---- access graph ----
  // Every outdoor space is a node of its own: a door onto a courtyard leads somewhere,
  // it just does not lead to the street.
  const access = new Map<string, Set<string>>();
  const link = (a: Owner, b: Owner) => {
    const [ka, kb] = [ownerKey(a), ownerKey(b)];
    (access.get(ka) ?? access.set(ka, new Set()).get(ka)!).add(kb);
    (access.get(kb) ?? access.set(kb, new Set()).get(kb)!).add(ka);
  };
  for (const r of rooms) access.set(ownerKey(roomOwner(r.id)), new Set());
  for (const o of outdoor) access.set(ownerKey(outdoorOwner(o.id)), new Set());
  access.set(ownerKey(EXTERIOR), new Set());
  for (const o of openings) {
    if (o.spec.type === "window") continue;
    if (o.wall.neg.kind === "gap" || o.wall.pos.kind === "gap") continue;
    link(o.wall.neg, o.wall.pos);
  }

  // ---- envelope ----
  // The floor plate is every face that is not open sky — rooms and the voids cut through
  // them, since a stairwell is inside the building. `outline` is its real boundary rather
  // than a bounding box, which is what the ghost of the level below needs to be legible,
  // and it comes from the same arrangement rather than a second outline tracer.
  const env = bbox(rooms.flatMap((r) => ringPoints(ringOf(r)).map(ptM)));
  const plate = new Set<number>();
  let footprint = 0;
  arr.faces.forEach((f, i) => {
    if (i === arr.outer || isOpenSky(faceOwner[i]!)) return;
    plate.add(i);
    footprint += f.area / 1e6;
  });
  const outline = traceBoundary(arr, plate).map((ring) => normaliseRing(ring).map(ptM));

  const faceModels: FaceModel[] = arr.faces.flatMap((f, i) =>
    i === arr.outer
      ? []
      : [
          {
            owner: faceOwner[i]!,
            ...faceRegionModel(arr, f),
          },
        ],
  );

  return {
    model: {
      level,
      rooms: roomModels,
      walls,
      openings,
      fixtures: fixtureModels,
      envelope: { ...env, area: snap(footprint), outline },
      access,
      streetOutdoor,
      interiorArea: snap(roomModels.reduce((s, m) => s + m.area, 0)),
      faces: faceModels,
    },
    findings,
  };
}

// ---------- walls ----------

/** A directed arrangement edge that has built wall on it. */
interface Piece {
  h: number;
  a: P;
  b: P;
  circle: { c: [number, number]; r: number; arc: Arc } | undefined;
  pair: string;
}

const vkey = (p: P) => `${p[0]},${p[1]}`;

/**
 * Every wall on a level: each arrangement edge whose two faces have different owners,
 * grouped by the unordered owner pair, chained through shared vertices, and merged where
 * consecutive edges are collinear or lie on the same circle.
 */
function wallsOf(arr: Arrangement, wallOwner: (face: number) => Owner, thicknessOf: (a: Owner, b: Owner) => number): Wall[] {
  const pieces: Piece[] = [];
  for (let h = 0; h < arr.half.length; h += 2) {
    const he = arr.half[h]!;
    const right = wallOwner(he.face);
    const left = wallOwner(arr.half[he.twin]!.face);
    if (sameOwner(left, right)) continue;
    if (isVoid(left) && isVoid(right)) continue;
    // Two declared voids are two holes in the same slab, side by side: neither has a
    // floor for a wall to stand on, so nothing is built between them. This is not the
    // `isVoid` case above — a void is *not* open sky, and keeps its wall against a room,
    // against the street and against a courtyard, which is what makes the stairwell
    // partition and the envelope past a double-height space derive at all.
    if (left.kind === "void" && right.kind === "void") continue;
    const pair = [ownerKey(left), ownerKey(right)].sort().join("\u0000");
    pieces.push({ h, a: arr.verts[he.from]!, b: arr.verts[he.to]!, circle: he.circle, pair });
  }

  const groups = new Map<string, Piece[]>();
  for (const p of pieces) (groups.get(p.pair) ?? groups.set(p.pair, []).get(p.pair)!).push(p);

  const walls: Wall[] = [];
  for (const list of groups.values()) {
    for (const chain of chainsOf(list)) {
      const parts = partsOf(chain);
      const first = parts[0]!;
      const last = parts[parts.length - 1]!;
      // canonical direction: the one pointing east, or north when there is no east in it
      const d: [number, number] = [last.end[0] - first.start[0], last.end[1] - first.start[1]];
      const forward = d[0] > 0 || (d[0] === 0 && d[1] < 0) || (d[0] === 0 && d[1] === 0);
      const ordered = forward ? parts : [...parts].reverse().map(reversePart);
      const head = ordered[0]!;
      // `face(h)` is on the right of h, so the left — `neg` — is the twin's face
      const neg = wallOwner(arr.half[arr.half[head.h]!.twin]!.face);
      const pos = wallOwner(arr.half[head.h]!.face);
      const [n, p] = head.flipped ? [pos, neg] : [neg, pos];
      walls.push(wallFrom(ordered, n, p, thicknessOf(n, p), chain.map((x) => x.h)));
    }
  }

  walls.sort(byWallOrder);
  walls.forEach((w, i) => (w.id = `w${i + 1}`));
  return walls;
}

/** Maximal runs of pieces that meet end to end and continue smoothly into one another. */
function chainsOf(list: Piece[]): Piece[][] {
  const at = new Map<string, Piece[]>();
  for (const p of list) {
    (at.get(vkey(p.a)) ?? at.set(vkey(p.a), []).get(vkey(p.a))!).push(p);
    (at.get(vkey(p.b)) ?? at.set(vkey(p.b), []).get(vkey(p.b))!).push(p);
  }
  /** the piece that continues `p` past vertex `v`, if exactly one does and does so smoothly */
  const nextAt = (p: Piece, v: P): Piece | undefined => {
    const here = at.get(vkey(v)) ?? [];
    if (here.length !== 2) return undefined;
    const q = here[0] === p ? here[1]! : here[0]!;
    return q !== p && continuous(p, q, v) ? q : undefined;
  };
  const used = new Set<Piece>();
  const chains: Piece[][] = [];
  const walk = (start: Piece): Piece[] => {
    const chain = [start];
    used.add(start);
    for (const dir of [0, 1]) {
      let cur = start;
      let v = dir === 0 ? start.b : start.a;
      for (;;) {
        const nxt = nextAt(cur, v);
        if (!nxt || used.has(nxt)) break;
        used.add(nxt);
        if (dir === 0) chain.push(nxt);
        else chain.unshift(nxt);
        v = vkey(nxt.a) === vkey(v) ? nxt.b : nxt.a;
        cur = nxt;
      }
    }
    return chain;
  };
  for (const p of list) if (!used.has(p)) chains.push(walk(p));
  return chains;
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Do these two pieces run smoothly into one another at the vertex they share? */
function continuous(p: Piece, q: Piece, v: P): boolean {
  const away = (x: Piece): [number, number] =>
    x.circle
      ? tangentAt(x, v)
      : vkey(x.a) === vkey(v)
        ? [x.b[0] - x.a[0], x.b[1] - x.a[1]]
        : [x.a[0] - x.b[0], x.a[1] - x.b[1]];
  const u = away(p);
  const w = away(q);
  const lu = Math.hypot(u[0], u[1]);
  const lw = Math.hypot(w[0], w[1]);
  if (lu === 0 || lw === 0) return false;
  // `p` arrives at v and `q` leaves it, so smooth means their directions are opposite
  const c = cross(u[0] / lu, u[1] / lu, w[0] / lw, w[1] / lw);
  const d = (u[0] * w[0] + u[1] * w[1]) / (lu * lw);
  return Math.abs(c) < 1e-6 && d < 0;
}

/** Unit tangent of an arc piece at one of its ends, pointing away from that end. */
function tangentAt(p: Piece, v: P): [number, number] {
  const c = p.circle!.c;
  const radial: [number, number] = [v[0] - c[0], v[1] - c[1]];
  const other = vkey(p.a) === vkey(v) ? p.b : p.a;
  const t: [number, number] = [-radial[1], radial[0]];
  const to: [number, number] = [other[0] - v[0], other[1] - v[1]];
  return t[0] * to[0] + t[1] * to[1] >= 0 ? t : [-t[0], -t[1]];
}

/** One straight or circular run inside a wall. */
interface Part {
  h: number;
  flipped: boolean;
  start: P;
  end: P;
  via: P | undefined;
  circle: { c: [number, number]; r: number; arc: Arc } | undefined;
}

const reversePart = (p: Part): Part => ({ ...p, flipped: !p.flipped, start: p.end, end: p.start });

const sameCircle = (a: Piece, b: Piece) =>
  a.circle !== undefined &&
  b.circle !== undefined &&
  Math.abs(a.circle.r - b.circle.r) < 1e-6 &&
  Math.hypot(a.circle.c[0] - b.circle.c[0], a.circle.c[1] - b.circle.c[1]) < 1e-6;

/** Collapse a chain into maximal straight and circular runs, in chain order. */
function partsOf(chain: Piece[]): Part[] {
  // put the chain's vertices in order first
  const order: P[] = [];
  if (chain.length === 1) order.push(chain[0]!.a, chain[0]!.b);
  else {
    const second = chain[1]!;
    const first = chain[0]!;
    let v: P = vkey(first.a) === vkey(second.a) || vkey(first.a) === vkey(second.b) ? first.b : first.a;
    order.push(v);
    for (const p of chain) {
      v = vkey(p.a) === vkey(v) ? p.b : p.a;
      order.push(v);
    }
  }
  const parts: Part[] = [];
  let i = 0;
  while (i < chain.length) {
    let j = i;
    while (j + 1 < chain.length && mergeable(chain[j]!, chain[j + 1]!)) j++;
    const p = chain[i]!;
    const start = order[i]!;
    const end = order[j + 1]!;
    const flipped = vkey(p.a) !== vkey(start);
    parts.push({ h: p.h, flipped, start, end, via: order[Math.floor((i + j + 1) / 2)] ?? undefined, circle: p.circle });
    i = j + 1;
  }
  return parts;
}

const mergeable = (a: Piece, b: Piece): boolean => {
  if (a.circle || b.circle) return sameCircle(a, b);
  const u: [number, number] = [a.b[0] - a.a[0], a.b[1] - a.a[1]];
  const w: [number, number] = [b.b[0] - b.a[0], b.b[1] - b.a[1]];
  return cross(u[0], u[1], w[0], w[1]) === 0;
};

function wallFrom(parts: Part[], neg: Owner, pos: Owner, thickness: number, edges: number[]): Wall {
  const geos = parts.map(partGeometry);
  const geometry: WallGeometry = geos.length === 1 ? geos[0]! : { kind: "chain", parts: geos };
  const start = ptM(parts[0]!.start);
  const end = ptM(parts[parts.length - 1]!.end);
  const length = snap(parts.reduce((s, p) => s + partLength(p), 0) / 1000);
  const straight = geos.length === 1 && geos[0]!.kind === "segment";
  const axis: Axis | undefined = !straight ? undefined : start[1] === end[1] ? "h" : start[0] === end[0] ? "v" : undefined;
  const c = axis === "h" ? start[1] : axis === "v" ? start[0] : undefined;
  const lo = axis === "h" ? Math.min(start[0], end[0]) : axis === "v" ? Math.min(start[1], end[1]) : 0;
  const hi = axis === "h" ? Math.max(start[0], end[0]) : axis === "v" ? Math.max(start[1], end[1]) : length;
  const w: Wall = {
    id: "",
    kind: isOpenSky(neg) || isOpenSky(pos) ? "exterior" : "partition",
    thickness,
    geometry,
    start,
    end,
    length,
    from: lo,
    to: hi,
    neg,
    pos,
  };
  if (axis !== undefined && c !== undefined) {
    w.axis = axis;
    w.c = c;
  }
  (w as Wall & { edges: number[] }).edges = edges;
  return w;
}

function partGeometry(p: Part): WallGeometry {
  const a = ptM(p.start);
  const b = ptM(p.end);
  if (!p.circle) return { kind: "segment", a, b };
  const arc = arcThrough(p.circle, p.start, p.via ?? p.start, p.end);
  if (!arc) return { kind: "segment", a, b };
  return {
    kind: "arc",
    a,
    b,
    r: snap(arc.r / 1000),
    sweep: arc.span >= 0 ? "cw" : "ccw",
    large: Math.abs(arc.span) > Math.PI,
    centre: [snap(arc.c[0] / 1000), snap(arc.c[1] / 1000)],
  };
}

function partLength(p: Part): number {
  if (!p.circle) return Math.hypot(p.end[0] - p.start[0], p.end[1] - p.start[1]);
  const arc = arcThrough(p.circle, p.start, p.via ?? p.start, p.end);
  return arc ? arcLength(arc) : Math.hypot(p.end[0] - p.start[0], p.end[1] - p.start[1]);
}

/**
 * Wall order, and therefore wall ids. Horizontal walls first by their y then their run,
 * then vertical walls by x, then everything else by where it starts — which reproduces
 * the `axis.localeCompare(axis) || c − c || from − from` the cell grid sorted by, so a
 * rectilinear plan's wall ids are unchanged.
 */
function byWallOrder(a: Wall, b: Wall): number {
  const rank = (w: Wall) => (w.axis === "h" ? 0 : w.axis === "v" ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 2)
    return a.start[0] - b.start[0] || a.start[1] - b.start[1] || a.end[0] - b.end[0] || a.end[1] - b.end[1];
  return a.c! - b.c! || a.from - b.from;
}

// ---------- room geometry helpers ----------

/**
 * Corners too sharp to stand in: where two straight edges meet below ACUTE_DEG, the
 * mitred wall faces meet `d / tan(θ/2)` along each arm, and everything short of that is
 * wall rather than floor. Measured for t = 0.3 m: 0.26 m at 60°, 0.56 m at 30°, 1.72 m
 * at 10° (docs/gaps-design.md §1.6).
 */
function acuteCorners(ring: MmRing, dist: number[]): Array<{ at: P; deg: number; lost: number }> {
  const out: Array<{ at: P; deg: number; lost: number }> = [];
  const n = ring.pts.length;
  if (n < 3) return out;
  const orient = Math.sign(ringArea(ring));
  for (let i = 0; i < n; i++) {
    const back = (i - 1 + n) % n;
    if (ring.arcs[back] !== undefined || ring.arcs[i] !== undefined) continue;
    const prev = ring.pts[back]!;
    const v = ring.pts[i]!;
    const next = ring.pts[(i + 1) % n]!;
    const a: [number, number] = [prev[0] - v[0], prev[1] - v[1]];
    const b: [number, number] = [next[0] - v[0], next[1] - v[1]];
    const la = Math.hypot(a[0], a[1]);
    const lb = Math.hypot(b[0], b[1]);
    if (la === 0 || lb === 0) continue;
    const cross = (v[0] - prev[0]) * (next[1] - v[1]) - (v[1] - prev[1]) * (next[0] - v[0]);
    if (Math.sign(cross) !== orient) continue; // reflex: the floor opens out, not in
    const theta = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb))));
    if (theta >= (ACUTE_DEG * Math.PI) / 180) continue;
    const d = Math.max(dist[back] ?? 0, dist[i] ?? 0) / 2;
    out.push({ at: v, deg: Math.round((theta * 180) / Math.PI), lost: d / Math.tan(theta / 2) });
  }
  return out;
}

const snapPt = (p: Pt): Pt => [snap(p[0]), snap(p[1])];

/**
 * Is a coordinate on a line of the sweep grid, at the grid's own resolution?
 *
 * INVARIANT: the grid is built from millimetre-snapped rotated coordinates, so a
 * comparison against it has to be made on the same lattice and cannot be exact. One
 * millimetre is the whole tolerance: it is what a coordinate can lose to `snap`, and it
 * is also what a wall's far end drifts across when the frame's bearing — itself snapped,
 * to a thousandth of a degree — is a few thousandths off the wall's own.
 */
const onLine = (v: number, c: number): boolean => Math.abs(Math.round((v - c) * 1000)) <= 1;

/** A rotation about the origin by `deg` clockwise on the page. */
function rotator(deg: number): (p: Pt) => Pt {
  if (deg === 0) return (p) => p;
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return (p) => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
}

/** The bearing of a room's longest straight edge, which is the frame it reads best in. */
function longestEdgeBearing(room: Shape): number {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < room.poly.length; i++) {
    if (room.arcs[i]) continue;
    const a = room.poly[i]!;
    const b = room.poly[(i + 1) % room.poly.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l <= bestLen) continue;
    bestLen = l;
    best = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  }
  // a frame is the same every quarter turn, so keep it in [0, 90)
  return snap(((best % 90) + 90) % 90);
}

/**
 * Half the thickness of the wall running along one side of the clear rectangle. Rooms are
 * authored on centrelines, so a comfort minimum has to come off both faces; a side that
 * does not sit on a wall deducts nothing. Where a side spans walls of different thickness
 * the thickest wins, which is the conservative reading for a comfort check.
 *
 * The wall's endpoints are rotated into the room's frame and snapped exactly as
 * `buildGrid` snapped the ring points that produced `c`. Comparing the unsnapped rotation
 * against the snapped grid was B9: at any bearing but 0 the residue is sub-millimetre,
 * larger than the 1e-6 the test used, so no wall matched and every angled room's
 * `clearRect` was its centreline `largestRect`.
 */
function halfWallAlong(
  walls: Wall[],
  g: { rot: (p: Pt) => Pt },
  axis: Axis,
  c: number,
  from: number,
  to: number,
  id: string,
): number {
  let t = 0;
  for (const w of walls) {
    if (w.geometry.kind !== "segment") continue;
    const a = snapPt(g.rot(w.geometry.a));
    const b = snapPt(g.rot(w.geometry.b));
    const wc = axis === "h" ? a[1] : a[0];
    const other = axis === "h" ? b[1] : b[0];
    if (!onLine(wc, c) || !onLine(other, c)) continue;
    const lo = Math.min(axis === "h" ? a[0] : a[1], axis === "h" ? b[0] : b[1]);
    const hi = Math.max(axis === "h" ? a[0] : a[1], axis === "h" ? b[0] : b[1]);
    if (w.neg.kind !== "room" && w.pos.kind !== "room") continue;
    if (!(w.neg.kind === "room" && w.neg.id === id) && !(w.pos.kind === "room" && w.pos.id === id)) continue;
    if (Math.min(hi, to) - Math.max(lo, from) <= MM) continue;
    t = Math.max(t, w.thickness);
  }
  return t / 2;
}

/**
 * Which compass face of the room this exterior wall is on, or undefined when the wall is
 * not the room's. For an axis-aligned wall this is what `sideOf` always said; for an
 * angled one it is the nearest compass point to the wall's outward normal, which is how
 * `habitable.no_window` can still name a direction on a wing at 45°.
 */
function exteriorFaceOf(wall: Wall, id: string): Side | undefined {
  const onNeg = wall.neg.kind === "room" && wall.neg.id === id;
  const onPos = wall.pos.kind === "room" && wall.pos.id === id;
  if (!onNeg && !onPos) return undefined;
  if (wall.axis === "h") return onPos ? "north" : "south";
  if (wall.axis === "v") return onPos ? "west" : "east";
  // outward normal: away from the room, perpendicular to the canonical direction
  const d: Pt = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]];
  const left: Pt = [d[1], -d[0]];
  const out: Pt = onNeg ? left : [-left[0], -left[1]];
  return Math.abs(out[0]) >= Math.abs(out[1]) ? (out[0] > 0 ? "east" : "west") : out[1] > 0 ? "south" : "north";
}

/**
 * Which way an exterior wall faces, seen from the room behind it: degrees clockwise from
 * north. `exteriorFaceOf` rounds this to a compass point, which is exact for an
 * axis-aligned wall and an approximation for any other; a message about an angled room
 * should quote the bearing instead.
 */
export function outwardBearing(wall: Wall, id: string): number | undefined {
  const onNeg = wall.neg.kind === "room" && wall.neg.id === id;
  const onPos = wall.pos.kind === "room" && wall.pos.id === id;
  if (!onNeg && !onPos) return undefined;
  const mid = (wall.from + wall.to) / 2;
  const n = normalOn(wall, mid);
  const out: Pt = onNeg ? [-n[0], -n[1]] : n;
  return Math.round((((Math.atan2(out[0], -out[1]) * 180) / Math.PI) % 360 + 360) % 360);
}

/** `flattenArc`-free conversion of an offset ring's arc back to the authored form. */
const arcSpecOf = (a: Arc | undefined): ArcSpec | undefined =>
  a === undefined ? undefined : { r: snap(a.r / 1000), sweep: a.span >= 0 ? "cw" : "ccw", large: Math.abs(a.span) > Math.PI };

/**
 * A room's ring, cut wherever the wall along it changes thickness, with the thickness of
 * each piece. A long edge that is exterior wall for part of its run and partition for the
 * rest has to become two edges, or the offset cannot be right on either.
 */
function splitByThickness(
  ring: MmRing,
  arr: Arrangement,
  input: number,
  wallOfEdge: Map<number, Wall>,
  id: string,
): { ring: MmRing; dist: number[] } {
  // only a wall this room is on one side of counts: a wall that merely runs along the
  // ring without the room behind it — which happens where two rooms overlap — belongs to
  // its own two owners, not to this one
  const thicknessOfMine = (h: number): number => {
    const w = wallOfEdge.get(h >> 1);
    if (!w) return 0;
    const on = (o: Owner) => o.kind === "room" && o.id === id;
    return on(w.neg) || on(w.pos) ? w.thickness : 0;
  };
  const pts: P[] = [];
  const arcs: Array<Arc | undefined> = [];
  const dist: number[] = [];
  const n = ring.pts.length;
  for (let e = 0; e < n; e++) {
    const a = ring.pts[e]!;
    const b = ring.pts[(e + 1) % n]!;
    const arc = ring.arcs[e];
    const ordered = orderAlong(edgesAlong(arr, input, e), a, b, arc);
    if (ordered.length === 0) {
      pts.push(a);
      arcs.push(arc);
      dist.push(0);
      continue;
    }
    let run: { start: P; end: P; t: number } | undefined;
    const flush = () => {
      if (!run) return;
      pts.push(run.start);
      arcs.push(arc ? subArc(arc, run.start, run.end) : undefined);
      dist.push(run.t);
      run = undefined;
    };
    for (const piece of ordered) {
      // millimetres on both sides of the comparison: a run only continues while the wall
      // along it keeps the same thickness, and a mismatch of units would split a curved
      // wall into one sub-arc per flattening chord
      const t = toMm(thicknessOfMine(piece.h));
      if (run && run.t === t && vkey(run.end) === vkey(piece.a)) run.end = piece.b;
      else {
        flush();
        run = { start: piece.a, end: piece.b, t };
      }
    }
    flush();
  }
  return { ring: { pts, arcs }, dist };
}

function edgesAlong(arr: Arrangement, input: number, edge: number): Array<{ h: number; a: P; b: P }> {
  const out: Array<{ h: number; a: P; b: P }> = [];
  for (let h = 0; h < arr.half.length; h += 2) {
    const he = arr.half[h]!;
    if (!he.srcs.some((s) => s.input === input && s.edge === edge)) continue;
    out.push({ h, a: arr.verts[he.from]!, b: arr.verts[he.to]! });
  }
  return out;
}

/** Put an edge's pieces in order from `a` to `b`, flipping any that face the other way. */
function orderAlong(
  pieces: Array<{ h: number; a: P; b: P }>,
  a: P,
  b: P,
  arc: Arc | undefined,
): Array<{ h: number; a: P; b: P }> {
  const param = (p: P): number => {
    if (!arc) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      return l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    }
    // INVARIANT: the wrap has to follow the arc's own direction. Taking the angle
    // difference into [0, 2π) and then subtracting 2π for a counter-clockwise arc sends
    // the arc's own start to 1 instead of 0, which puts the first piece of a split arc
    // last and tears the ring apart.
    const raw = Math.atan2(p[1] - arc.c[1], p[0] - arc.c[0]) - arc.t0;
    const twoPi = 2 * Math.PI;
    const d = arc.span >= 0 ? ((raw % twoPi) + twoPi) % twoPi : -((((-raw) % twoPi) + twoPi) % twoPi);
    return arc.span === 0 ? 0 : d / arc.span;
  };
  return pieces
    .map((p) => (param(p.a) <= param(p.b) ? p : { h: p.h, a: p.b, b: p.a }))
    .sort((m, n) => param(m.a) - param(n.a));
}

/** The piece of `arc` between two points on it. */
function subArc(arc: Arc, a: P, b: P): Arc {
  const ang = (p: P) => Math.atan2(p[1] - arc.c[1], p[0] - arc.c[0]);
  const twoPi = 2 * Math.PI;
  const t0 = ang(a);
  const t1 = ang(b);
  const span = arc.span >= 0 ? (((t1 - t0) % twoPi) + twoPi) % twoPi : -((((t0 - t1) % twoPi) + twoPi) % twoPi);
  return { c: arc.c, r: arc.r, t0, span, a, b };
}

// ---------- faces ----------

function faceRingsOf(arr: Arrangement, f: Face): P[][] {
  return f.cycles.map((c) => c.map((h) => arr.verts[arr.half[h]!.from]!));
}

/** bbox, area and centroid of one face, in metres — what a tiling finding quotes. */
function faceRegion(arr: Arrangement, f: Face) {
  const rings = faceRingsOf(arr, f);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const p = r[i]!;
      const q = r[(i + 1) % r.length]!;
      const c = p[0] * q[1] - q[0] * p[1];
      a2 += c;
      cx += (p[0] + q[0]) * c;
      cy += (p[1] + q[1]) * c;
    }
  const at: Pt = a2 === 0 ? [toM(x0), toM(y0)] : [snap(toM(cx / (3 * a2))), snap(toM(cy / (3 * a2)))];
  return { x0: toM(x0), y0: toM(y0), x1: toM(x1), y1: toM(y1), area: snap(f.area / 1e6), at };
}

function faceRegionModel(arr: Arrangement, f: Face) {
  const r = faceRegion(arr, f);
  return {
    area: r.area,
    at: r.at,
    bbox: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 },
    rings: faceRingsOf(arr, f).map((ring) => normaliseRing(ring).map(ptM)),
  };
}

/**
 * Start a traced ring at its lexicographically smallest corner, so the same boundary
 * always reads the same however the walk happened to reach it.
 */
function normaliseRing(ring: P[]): P[] {
  let k = 0;
  for (let i = 1; i < ring.length; i++)
    if (ring[i]![0] < ring[k]![0] || (ring[i]![0] === ring[k]![0] && ring[i]![1] < ring[k]![1])) k = i;
  return [...ring.slice(k), ...ring.slice(0, k)];
}

// ---------- labels, references ----------

export const label = (o: Owner): string =>
  o.kind === "exterior" ? "the exterior" : o.kind === "gap" ? "a gap" : o.kind === "overlap" ? o.ids.join(" + ") : o.id;

/**
 * How a finding points at a thing standing on the floor. An authored fixture is an index
 * into the document's `fixtures`; a vertical element's synthetic footprint has no such
 * index, so it names the element instead.
 */
export const occupantRef = (f: Fixture): { fixture: string } | { vertical: string } =>
  f.vertical === undefined ? { fixture: f.id } : { vertical: f.vertical };

/**
 * Does the id an opening's `between` names refer to this owner? The literal "exterior" is
 * the street and only the street; anything else is a room or an outdoor space by id.
 */
const refMatches = (ref: string, o: Owner): boolean =>
  ref === "exterior" ? o.kind === "exterior" : (o.kind === "room" || o.kind === "outdoor") && o.id === ref;

/** how an authored `between` id reads in a message */
const refLabel = (ref: string): string => (ref === "exterior" ? "the exterior" : ref);

// ---------- openings ----------

function resolveOpening(spec: Opening, walls: Wall[], findings: Finding[]): ResolvedOpening | undefined {
  const [a, b] = spec.between;
  let cands = walls.filter(
    (w) => (refMatches(a, w.neg) && refMatches(b, w.pos)) || (refMatches(b, w.neg) && refMatches(a, w.pos)),
  );
  const fail = (rule: string, message: string, extra: Partial<Finding> = {}) => {
    findings.push({
      rule,
      severity: "error",
      message,
      path: spec.path,
      opening: spec.id,
      rooms: spec.between.filter((s) => s !== "exterior"),
      ...extra,
    });
    return undefined;
  };
  /** the same wall the message describes, structured, so a fix needs no prose parsing */
  const candidate = (w: Wall, roomRef?: string): WallCandidate => {
    const c: WallCandidate = { wall: w.id, from: pointOn(w, w.from), to: pointOn(w, w.to) };
    // `side` is only meaningful relative to a room, and only where the wall has one: a
    // wall at 20° has no compass side, so it carries none and the `from`/`to` say where
    // it is instead
    const side = roomRef === undefined ? undefined : sideOf(w, roomRef);
    if (side !== undefined) c.side = side;
    return c;
  };
  if (cands.length === 0) {
    const neighbours = (id: string) =>
      [
        ...new Set(
          walls
            .filter((w) => refMatches(id, w.neg) || refMatches(id, w.pos))
            .map((w) => label(refMatches(id, w.neg) ? w.pos : w.neg)),
        ),
      ].join(", ");
    const hint = a === "exterior" ? `${b} touches: ${neighbours(b)}` : b === "exterior" ? `${a} touches: ${neighbours(a)}` : `${a} touches: ${neighbours(a)}; ${b} touches: ${neighbours(b)}`;
    return fail("wall.unresolved", `opening #${spec.index} (${spec.type}): ${refLabel(a)} and ${refLabel(b)} share no wall. ${hint}`, {
      path: `${spec.path}.between`,
    });
  }
  let centre: number;
  if (spec.at) {
    // `at` chooses the nearest candidate wall by point-to-wall distance and projects the
    // point onto it to get the centre — the selector that survives angled walls
    // (agent-review.md §B5): unlike on.side, it never asks the author to reason about a
    // derived segment's orientation or which end is its start.
    const at = spec.at;
    const dists = cands.map((w) => ({ w, d: distToWall(at, w) }));
    const minD = Math.min(...dists.map((x) => x.d));
    const nearest = dists.filter((x) => eq(x.d, minD));
    if (nearest.length > 1) {
      const desc = nearest.map((x) => `${describe(x.w)} (${snap(x.d)} m)`).join("; ");
      return fail(
        "wall.ambiguous",
        `opening #${spec.index}: point (${at[0]}, ${at[1]}) is equidistant from ${nearest.length} wall segments (${desc}); move it, or use "on" instead of "at" to disambiguate`,
        { path: `${spec.path}.at`, candidates: nearest.map((x) => candidate(x.w)) },
      );
    }
    const nearWall = nearest[0]!.w;
    const tol = 0.05;
    const limit = nearWall.thickness / 2 + tol;
    if (minD > limit) {
      return fail(
        "opening.off_wall",
        `opening #${spec.index}: point (${at[0]}, ${at[1]}) is ${snap(minD)} m from the nearest wall (${describe(nearWall)}), farther than half its thickness plus tolerance (${snap(limit)} m)`,
        { path: `${spec.path}.at`, nearest: nearWall.id, distance: snap(minD) },
      );
    }
    cands = [nearWall];
    centre = Math.max(nearWall.from, Math.min(nearWall.to, paramAt(nearWall, at)));
  } else {
    if (spec.on) {
      const { room, side, near } = spec.on;
      if (side) {
        // `north | south | east | west` says nothing about a wall at 20°, so a side that
        // matches nothing while an angled candidate exists is not "no such wall" — it is
        // the wrong selector, and the message says which one works (§1.5).
        const angled = cands.filter((w) => w.axis === undefined);
        const bySide = cands.filter((w) => sideOf(w, room) === side);
        if (bySide.length === 0 && angled.length > 0) {
          return fail(
            "wall.ambiguous",
            `opening #${spec.index}: "on": { "side": "${side}" } cannot pick out a wall that is not axis-aligned — ${refLabel(a)} and ${refLabel(b)} share ${angled.length} angled or curved wall${angled.length === 1 ? "" : "s"}. Use "at": [x, y] instead, which names a point and works at any angle`,
            { path: `${spec.path}.on`, candidates: angled.map((w) => candidate(w, room)) },
          );
        }
        cands = bySide;
      }
      if (cands.length === 0)
        return fail("wall.unresolved", `opening #${spec.index}: ${room} has no wall to ${refLabel(a === room ? b : a)} on its ${side} side`, {
          path: `${spec.path}.on`,
        });
      if (near && cands.length > 1) {
        cands.sort((w1, w2) => distToWall(near, w1) - distToWall(near, w2));
        cands = [cands[0]!];
      }
    }
    if (cands.length > 1) {
      const roomRef = a === "exterior" ? b : a;
      const desc = cands.map((w) => `${sideOf(w, roomRef) ?? "the"} ${describe(w)}`).join("; ");
      return fail(
        "wall.ambiguous",
        `opening #${spec.index}: ${refLabel(a)} and ${refLabel(b)} share ${cands.length} wall segments (${desc}); add "on": { "room": "${roomRef}", "side": … } or "near": [x, y]`,
        { path: pathTo(spec, "on"), candidates: cands.map((w) => candidate(w, roomRef)) },
      );
    }
    const wall = cands[0]!;
    const len = wall.to - wall.from;
    centre =
      spec.position === "center"
        ? wall.from + len / 2
        : spec.position.from === "start"
          ? wall.from + spec.position.distance
          : wall.to - spec.position.distance;
  }
  const wall = cands[0]!;
  const from = snap(centre - spec.width / 2);
  const to = snap(centre + spec.width / 2);
  if (from < wall.from - MM || to > wall.to + MM) {
    findings.push({
      rule: "opening.overflow",
      severity: "error",
      message: `opening #${spec.index} (${spec.type}, ${spec.width} m) does not fit the ${snap(wall.to - wall.from)} m wall between ${label(wall.neg)} and ${label(wall.pos)} at that position`,
      path: pathTo(spec, "width"),
      at: pointOn(wall, centre),
      opening: spec.id,
    });
  } else {
    for (const gap of [from - wall.from, wall.to - to]) {
      if (snap(gap) > MM && snap(gap) < CORNER_SLIVER) {
        findings.push({
          rule: "opening.near_corner",
          severity: "warning",
          message: `opening #${spec.index} leaves a ${snap(gap)} m sliver of wall at a corner; move it to the corner or leave ≥ ${CORNER_SLIVER} m`,
          path: pathTo(spec, "at", "position"),
          at: pointOn(wall, centre),
          opening: spec.id,
        });
        break;
      }
    }
  }
  // INVARIANT: a sliding door has no hinge and no swing room. `doorSwing` (src/doors.ts)
  // treats an undefined hinge as "no swing geometry", so every swing-only finding
  // (door.swing_collision, door.swing_hits_fixture) already skips a sliding door for
  // free — it never resolves a sector for one to test.
  const swings = spec.type === "door" && !spec.sliding;
  return {
    spec,
    wall,
    from,
    to,
    center: pointOn(wall, centre),
    hinge: swings ? pointOn(wall, spec.hinge === "start" ? from : to) : undefined,
    swingRoom: swings ? spec.swingInto : undefined,
  };
}

// ---------- reading a wall ----------

/**
 * Which compass side of the space `ref` this wall lies on. Defined only for an
 * axis-aligned wall: `north`, `south`, `east` and `west` say nothing about a wall at 20°,
 * and `at: [x, y]` is the selector that survives angles (docs/gaps-design.md §1.5).
 */
export function sideOf(w: Wall, ref: string): Side | undefined {
  if (w.axis === "h") return refMatches(ref, w.pos) ? "north" : "south";
  if (w.axis === "v") return refMatches(ref, w.pos) ? "west" : "east";
  return undefined;
}

/** Where on the wall the parameter `t` is. */
export function pointOn(w: Wall, t: number): Pt {
  if (w.axis === "h") return [snap(t), w.c!];
  if (w.axis === "v") return [w.c!, snap(t)];
  const p = alongGeometry(w.geometry, Math.max(0, Math.min(w.length, t - w.from)) * 1000);
  return [snap(toM(p[0])), snap(toM(p[1]))];
}

/** The point `s` millimetres along a wall's geometry from its start. */
function alongGeometry(g: WallGeometry, s: number): [number, number] {
  if (g.kind === "chain") {
    let left = s;
    for (const part of g.parts) {
      const l = geometryLength(part);
      if (left <= l || part === g.parts[g.parts.length - 1]) return alongGeometry(part, left);
      left -= l;
    }
    return alongGeometry(g.parts[0]!, 0);
  }
  if (g.kind === "segment") {
    const a = ptMm(g.a);
    const b = ptMm(g.b);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = Math.max(0, Math.min(1, s / l));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  const arc = arcOfGeometry(g);
  return arcPoint(arc, Math.max(0, Math.min(1, s / (arcLength(arc) || 1))));
}

function geometryLength(g: WallGeometry): number {
  if (g.kind === "chain") return g.parts.reduce((s, p) => s + geometryLength(p), 0);
  if (g.kind === "segment") {
    const a = ptMm(g.a);
    const b = ptMm(g.b);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return arcLength(arcOfGeometry(g));
}

/** The millimetre arc record behind an arc geometry. */
export function arcOfGeometry(g: WallGeometry & { kind: "arc" }): Arc {
  const c: [number, number] = [toMm(g.centre[0]), toMm(g.centre[1])];
  const a = ptMm(g.a);
  const b = ptMm(g.b);
  const t0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  const t1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  const twoPi = 2 * Math.PI;
  const span = g.sweep === "cw" ? (((t1 - t0) % twoPi) + twoPi) % twoPi : -((((t0 - t1) % twoPi) + twoPi) % twoPi);
  return { c, r: toMm(g.r), t0, span, a, b };
}

/** How a wall reads in a message. */
export function describe(w: Wall): string {
  if (w.axis === "h") return `y=${w.c} x ${w.from}→${w.to}`;
  if (w.axis === "v") return `x=${w.c} y ${w.from}→${w.to}`;
  const bearing = Math.round((((Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]) * 180) / Math.PI + 90) % 360 + 360) % 360);
  const shape = w.geometry.kind === "segment" ? "wall" : w.geometry.kind === "arc" ? `r=${w.geometry.r} m wall` : "wall";
  return `${w.length} m ${shape} (${w.start[0]}, ${w.start[1]})→(${w.end[0]}, ${w.end[1]}), bearing ${bearing}°`;
}

/** Distance from a point to the wall, in metres. */
export function distToWall(p: Pt, w: Wall): number {
  if (w.axis === "h" || w.axis === "v") {
    const along = w.axis === "h" ? p[0] : p[1];
    const across = w.axis === "h" ? p[1] : p[0];
    const t = Math.max(w.from, Math.min(w.to, along));
    return Math.hypot(along - t, across - w.c!);
  }
  return toM(distToGeometry(ptMm(p), w.geometry));
}

function distToGeometry(p: P, g: WallGeometry): number {
  if (g.kind === "chain") return Math.min(...g.parts.map((x) => distToGeometry(p, x)));
  if (g.kind === "segment") {
    const a = ptMm(g.a);
    const b = ptMm(g.b);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  }
  const arc = arcOfGeometry(g);
  const ang = Math.atan2(p[1] - arc.c[1], p[0] - arc.c[0]);
  if (onArc(arc, ang)) return Math.abs(Math.hypot(p[0] - arc.c[0], p[1] - arc.c[1]) - arc.r);
  const a = ptMm(g.a);
  const b = ptMm(g.b);
  return Math.min(Math.hypot(p[0] - a[0], p[1] - a[1]), Math.hypot(p[0] - b[0], p[1] - b[1]));
}

/** The wall parameter of the point on the wall nearest `p`. */
export function paramAt(w: Wall, p: Pt): number {
  if (w.axis === "h") return p[0];
  if (w.axis === "v") return p[1];
  const q = ptMm(p);
  const total = w.length * 1000;
  const at = (s: number) => {
    const c = alongGeometry(w.geometry, s);
    return Math.hypot(c[0] - q[0], c[1] - q[1]);
  };
  // a centimetre sweep to find the bracket, then bisection inside it: a chain's
  // parameter has no closed form, but the distance along it is unimodal near its
  // minimum, and an opening's centre has to be right to the millimetre
  const n = Math.max(2, Math.ceil(total / 10));
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * total;
    const d = at(s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  let lo = Math.max(0, best - total / n);
  let hi = Math.min(total, best + total / n);
  for (let i = 0; i < 40 && hi - lo > 1e-4; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (at(a) <= at(b)) hi = b;
    else lo = a;
  }
  return w.from + (lo + hi) / 2 / 1000;
}

/** Unit tangent of a wall at parameter `t`, pointing the way `from` → `to` runs. */
export function tangentOn(w: Wall, t: number): Pt {
  if (w.axis === "h") return [1, 0];
  if (w.axis === "v") return [0, 1];
  const s = Math.max(0, Math.min(w.length, t - w.from)) * 1000;
  return tangentOfGeometry(w.geometry, s);
}

/**
 * The unit normal of a wall at parameter `t`, pointing toward its `pos` side.
 *
 * For an axis-aligned wall that is south for a horizontal wall and east for a vertical
 * one, which is exactly what the window glazing and the entrance tag used to derive from
 * `axis` by table (`svg.ts`, `doors.ts`).
 */
export function normalOn(w: Wall, t: number): Pt {
  if (w.axis === "h") return [0, 1];
  if (w.axis === "v") return [1, 0];
  // `pos` is on the right of the canonical direction, and `from → to` runs that way
  const [tx, ty] = tangentOn(w, t);
  return [-ty, tx];
}

/** Where along the wall's geometry, in millimetres from `start`, the parameter `t` is. */
const arcLengthAt = (w: Wall, t: number): number =>
  (w.axis === "v" ? w.to - t : t - w.from) * 1000;

/** The piece of a wall between two of its parameters, as exact geometry. */
export function wallSubGeometry(w: Wall, a: number, b: number): WallGeometry {
  const s0 = arcLengthAt(w, a);
  const s1 = arcLengthAt(w, b);
  return geometryBetween(w.geometry, Math.min(s0, s1), Math.max(s0, s1));
}

function geometryBetween(g: WallGeometry, s0: number, s1: number): WallGeometry {
  if (g.kind === "chain") {
    const parts: WallGeometry[] = [];
    let at = 0;
    for (const part of g.parts) {
      const l = geometryLength(part);
      const lo = Math.max(s0, at);
      const hi = Math.min(s1, at + l);
      if (hi - lo > 1e-9) parts.push(geometryBetween(part, lo - at, hi - at));
      at += l;
    }
    return parts.length === 1 ? parts[0]! : { kind: "chain", parts };
  }
  if (g.kind === "segment") {
    const a = ptMm(g.a);
    const b = ptMm(g.b);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const at = (s: number): Pt => {
      const t = Math.max(0, Math.min(1, s / l));
      return [snap(toM(a[0] + (b[0] - a[0]) * t)), snap(toM(a[1] + (b[1] - a[1]) * t))];
    };
    return { kind: "segment", a: at(s0), b: at(s1) };
  }
  const arc = arcOfGeometry(g);
  const total = arcLength(arc) || 1;
  const u0 = Math.max(0, Math.min(1, s0 / total));
  const u1 = Math.max(0, Math.min(1, s1 / total));
  const p0 = arcPoint(arc, u0);
  const p1 = arcPoint(arc, u1);
  const span = arc.span * (u1 - u0);
  return {
    kind: "arc",
    a: [snap(toM(p0[0])), snap(toM(p0[1]))],
    b: [snap(toM(p1[0])), snap(toM(p1[1]))],
    r: g.r,
    sweep: span >= 0 ? "cw" : "ccw",
    large: Math.abs(span) > Math.PI,
    centre: g.centre,
  };
}

/**
 * The same wall geometry moved `d` metres toward its `pos` side. A segment translates; an
 * arc keeps its centre and changes radius, which is why window glazing on a curved wall
 * is two concentric arcs rather than two chords.
 */
export function offsetGeometry(g: WallGeometry, d: number): WallGeometry {
  if (g.kind === "chain") return { kind: "chain", parts: g.parts.map((p) => offsetGeometry(p, d)) };
  if (g.kind === "segment") {
    const dx = g.b[0] - g.a[0];
    const dy = g.b[1] - g.a[1];
    const l = Math.hypot(dx, dy) || 1;
    const n: Pt = [(-dy / l) * d, (dx / l) * d];
    return { kind: "segment", a: [snap(g.a[0] + n[0]), snap(g.a[1] + n[1])], b: [snap(g.b[0] + n[0]), snap(g.b[1] + n[1])] };
  }
  const sign = g.sweep === "cw" ? 1 : -1;
  const r = Math.max(1e-6, g.r - d * sign);
  const move = (p: Pt): Pt => {
    const vx = p[0] - g.centre[0];
    const vy = p[1] - g.centre[1];
    const l = Math.hypot(vx, vy) || 1;
    return [snap(g.centre[0] + (vx / l) * r), snap(g.centre[1] + (vy / l) * r)];
  };
  return { kind: "arc", a: move(g.a), b: move(g.b), r: snap(r), sweep: g.sweep, large: g.large, centre: g.centre };
}

/**
 * A whole shape as a closed SVG path: straight edges as `L`, curved ones as `A`. A ring
 * with no arcs is left to the caller to draw as a `<polygon>`, which is what it is.
 */
export function shapePath(sh: Shape, X: (m: number) => number, Y: (m: number) => number, S: number): string {
  const ring = ringOf(sh);
  const head = sh.poly[0]!;
  let d = `M${fmtNum(X(head[0]))} ${fmtNum(Y(head[1]))}`;
  for (const e of ringEdges(ring)) {
    const b = ptM(e.b);
    if (!e.arc) {
      d += ` L${fmtNum(X(b[0]))} ${fmtNum(Y(b[1]))}`;
      continue;
    }
    const r = fmtNum((e.arc.r / 1000) * S);
    const large = Math.abs(e.arc.span) > Math.PI ? 1 : 0;
    const sweep = e.arc.span >= 0 ? 1 : 0;
    d += ` A${r} ${r} 0 ${large} ${sweep} ${fmtNum(X(b[0]))} ${fmtNum(Y(b[1]))}`;
  }
  return `${d} Z`;
}

/** Has any edge of this shape a curve on it? Decides polygon versus path. */
export const isCurved = (sh: Shape): boolean => sh.arcs.some((a) => a !== undefined);

/** Area centroid of a shape, in metres; where a label without a room goes. */
export function shapeCentroid(sh: Shape): Pt {
  const ring = ringPoints(ringOf(sh));
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const c = p[0] * q[1] - q[0] * p[1];
    a2 += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  if (a2 === 0) return [snap(toM(ring[0]![0])), snap(toM(ring[0]![1]))];
  return [snap(toM(cx / (3 * a2))), snap(toM(cy / (3 * a2)))];
}

/** Every point an SVG path needs to draw this geometry, as `M`/`L`/`A` commands. */
export function geometryPath(g: WallGeometry, X: (m: number) => number, Y: (m: number) => number, S: number): string {
  const head = geometryStart(g);
  return `M${fmtNum(X(head[0]))} ${fmtNum(Y(head[1]))}${geometryTail(g, X, Y, S)}`;
}

function geometryStart(g: WallGeometry): Pt {
  return g.kind === "chain" ? geometryStart(g.parts[0]!) : g.a;
}

/** Where a wall geometry ends, in metres. */
export function geometryEnd(g: WallGeometry): Pt {
  return g.kind === "chain" ? geometryEnd(g.parts[g.parts.length - 1]!) : g.b;
}

function geometryTail(g: WallGeometry, X: (m: number) => number, Y: (m: number) => number, S: number): string {
  if (g.kind === "chain") return g.parts.map((p) => geometryTail(p, X, Y, S)).join("");
  if (g.kind === "segment") return ` L${fmtNum(X(g.b[0]))} ${fmtNum(Y(g.b[1]))}`;
  const r = fmtNum(g.r * S);
  return ` A${r} ${r} 0 ${g.large ? 1 : 0} ${g.sweep === "cw" ? 1 : 0} ${fmtNum(X(g.b[0]))} ${fmtNum(Y(g.b[1]))}`;
}

const fmtNum = (n: number) => String(Math.round(n * 100) / 100);

function tangentOfGeometry(g: WallGeometry, s: number): Pt {
  if (g.kind === "chain") {
    let left = s;
    for (const part of g.parts) {
      const l = geometryLength(part);
      if (left <= l || part === g.parts[g.parts.length - 1]) return tangentOfGeometry(part, left);
      left -= l;
    }
  }
  if (g.kind === "segment") {
    const dx = g.b[0] - g.a[0];
    const dy = g.b[1] - g.a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }
  if (g.kind === "arc") {
    const arc = arcOfGeometry(g);
    const t = arcTangent(arc, Math.max(0, Math.min(1, s / (arcLength(arc) || 1))));
    return [t[0], t[1]];
  }
  return [1, 0];
}

export type { Model };
