import { bbox, eq, largestRect, pointInPoly, polyInside, polysOverlap, shoelace, snap } from "./geometry.ts";
import type {
  Analysis,
  Axis,
  Finding,
  FixtureModel,
  Model,
  Opening,
  Owner,
  Plan,
  Pt,
  ResolvedOpening,
  RoomModel,
  Side,
  WallSegment,
} from "./types.ts";

const MM = 0.001;
const CORNER_SLIVER = 0.1;

interface Piece {
  axis: Axis;
  c: number;
  from: number;
  to: number;
  neg: Owner;
  pos: Owner;
}

/**
 * Turn authored rooms into walls, resolve openings onto walls, compute room
 * metrics and the access graph. Geometry/topology problems are returned as
 * findings, never thrown, so a broken plan still yields a drawable model.
 */
export function derive(plan: Plan): Analysis {
  const findings: Finding[] = [];
  const rooms = plan.rooms;

  // ---- arrangement grid from every distinct x / y ----
  const xset = new Set<number>();
  const yset = new Set<number>();
  for (const r of rooms) for (const [x, y] of r.poly) (xset.add(x), yset.add(y));
  for (const o of plan.outdoor) for (const [x, y] of o.poly) (xset.add(x), yset.add(y));
  for (const fx of plan.fixtures) for (const [x, y] of fx.poly) (xset.add(x), yset.add(y));
  const xs = [...xset].sort((a, b) => a - b);
  const ys = [...yset].sort((a, b) => a - b);
  const cols = xs.length - 1;
  const rowsN = ys.length - 1;

  // owners per cell
  const ownersOf: string[][][] = [];
  for (let i = 0; i < cols; i++) {
    ownersOf.push([]);
    for (let j = 0; j < rowsN; j++) {
      const cx = (xs[i]! + xs[i + 1]!) / 2;
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      ownersOf[i]!.push(rooms.filter((r) => pointInPoly([cx, cy], r.poly)).map((r) => r.id));
    }
  }
  // outside = zero-coverage cells connected to the grid border
  const outside: boolean[][] = ownersOf.map((col) => col.map(() => false));
  const stack: Array<[number, number]> = [];
  for (let i = 0; i < cols; i++) for (const j of [0, rowsN - 1]) if (ownersOf[i]![j]!.length === 0) stack.push([i, j]);
  for (let j = 0; j < rowsN; j++) for (const i of [0, cols - 1]) if (ownersOf[i]![j]!.length === 0) stack.push([i, j]);
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (i < 0 || j < 0 || i >= cols || j >= rowsN || outside[i]![j] || ownersOf[i]![j]!.length > 0) continue;
    outside[i]![j] = true;
    stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  // A declared outdoor space is open sky, so a courtyard fully enclosed by rooms is
  // "outside" even though the border flood fill cannot reach it.
  // INVARIANT: cells marked here are the only "outside" ones not connected to the
  // border. This is what makes courtyard-facing walls derive as exterior, so a window
  // onto a patio satisfies habitable.no_window rather than tripping window.not_exterior.
  for (const o of plan.outdoor) {
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rowsN; j++) {
        if (outside[i]![j] || ownersOf[i]![j]!.length > 0) continue;
        const cx = (xs[i]! + xs[i + 1]!) / 2;
        const cy = (ys[j]! + ys[j + 1]!) / 2;
        if (pointInPoly([cx, cy], o.poly)) outside[i]![j] = true;
      }
    }
  }
  const owner = (i: number, j: number): Owner => {
    if (i < 0 || j < 0 || i >= cols || j >= rowsN) return "exterior";
    const o = ownersOf[i]![j]!;
    if (o.length >= 1) return o[0]!;
    return outside[i]![j] ? "exterior" : "gap";
  };
  const cellCentre = (i: number, j: number): Pt => [snap((xs[i]! + xs[i + 1]!) / 2), snap((ys[j]! + ys[j + 1]!) / 2)];

  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rowsN; j++) {
      const o = ownersOf[i]![j]!;
      if (o.length > 1) {
        findings.push({
          rule: "tiling.overlap",
          severity: "error",
          message: `rooms ${o.join(", ")} overlap around (${cellCentre(i, j).join(", ")})`,
          at: cellCentre(i, j),
          rooms: o,
        });
      } else if (o.length === 0 && !outside[i]![j]) {
        findings.push({
          rule: "tiling.gap",
          severity: "error",
          message: `no room covers the area around (${cellCentre(i, j).join(", ")}); the plan has a hole`,
          at: cellCentre(i, j),
        });
      }
    }
  }

  // ---- wall pieces between cells with different owners ----
  const pieces: Piece[] = [];
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j < rowsN; j++) {
      const a = owner(i - 1, j);
      const b = owner(i, j);
      if (a !== b && !(isVoid(a) && isVoid(b))) pieces.push({ axis: "v", c: xs[i]!, from: ys[j]!, to: ys[j + 1]!, neg: a, pos: b });
    }
  }
  for (let j = 0; j <= rowsN; j++) {
    for (let i = 0; i < cols; i++) {
      const a = owner(i, j - 1);
      const b = owner(i, j);
      if (a !== b && !(isVoid(a) && isVoid(b))) pieces.push({ axis: "h", c: ys[j]!, from: xs[i]!, to: xs[i + 1]!, neg: a, pos: b });
    }
  }
  const thicknessOf = (p: Piece) => (p.neg === "exterior" || p.pos === "exterior" ? plan.walls.exterior : plan.walls.partition);

  // merge collinear pieces with the same owner pair
  const groups = new Map<string, Piece[]>();
  for (const p of pieces) {
    const k = `${p.axis}|${p.c}|${p.neg}|${p.pos}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p);
  }
  const walls: WallSegment[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.from - b.from);
    let cur: Piece | undefined;
    for (const p of list) {
      if (cur && eq(cur.to, p.from)) cur.to = p.to;
      else {
        if (cur) walls.push(toWall(cur));
        cur = { ...p };
      }
    }
    if (cur) walls.push(toWall(cur));
  }
  walls.sort((a, b) => a.axis.localeCompare(b.axis) || a.c - b.c || a.from - b.from);
  walls.forEach((w, i) => (w.id = `w${i + 1}`));

  function toWall(p: Piece): WallSegment {
    const kind = p.neg === "exterior" || p.pos === "exterior" ? "exterior" : "partition";
    return { id: "", axis: p.axis, c: p.c, from: p.from, to: p.to, neg: p.neg, pos: p.pos, kind, thickness: thicknessOf(p) };
  }

  // ---- outdoor space is open sky, so no room may stand on it ----
  for (const o of plan.outdoor) {
    for (const r of rooms) {
      if (!polysOverlap(o.poly, r.poly)) continue;
      const b = bbox(o.poly);
      findings.push({
        rule: "outdoor.overlap",
        severity: "error",
        message: `${o.name} is open sky but ${r.name} is built over it`,
        at: [snap((b.x0 + b.x1) / 2), snap((b.y0 + b.y1) / 2)],
        rooms: [r.id],
      });
    }
  }

  // ---- fixtures standing inside rooms ----
  // a fixture stands in a room or in an outdoor space — a pool is a pool either way
  const hostPoly = new Map<string, Pt[]>([
    ...rooms.map((r) => [r.id, r.poly] as const),
    ...plan.outdoor.map((o) => [o.id, o.poly] as const),
  ]);
  const fixtureModels: FixtureModel[] = plan.fixtures.map((fixture) => ({
    fixture,
    bbox: bbox(fixture.poly),
    area: snap(Math.abs(shoelace(fixture.poly))),
  }));
  for (const fm of fixtureModels) {
    const host = hostPoly.get(fm.fixture.in);
    if (host && !polyInside(fm.fixture.poly, host)) {
      findings.push({
        rule: "fixture.outside_space",
        severity: "error",
        message: `${fm.fixture.name} (fixture #${fm.fixture.index}) is not fully inside ${fm.fixture.in}`,
        at: [snap((fm.bbox.x0 + fm.bbox.x1) / 2), snap((fm.bbox.y0 + fm.bbox.y1) / 2)],
        rooms: [fm.fixture.in],
        fixture: fm.fixture.index,
      });
    }
  }
  for (let i = 0; i < fixtureModels.length; i++) {
    for (let j = i + 1; j < fixtureModels.length; j++) {
      const a = fixtureModels[i]!;
      const b = fixtureModels[j]!;
      if (a.fixture.in !== b.fixture.in) continue;
      if (!polysOverlap(a.fixture.poly, b.fixture.poly)) continue;
      findings.push({
        rule: "fixture.overlap",
        severity: "error",
        message: `${a.fixture.name} and ${b.fixture.name} overlap in ${a.fixture.in}`,
        at: [snap((a.bbox.x0 + a.bbox.x1) / 2), snap((a.bbox.y0 + a.bbox.y1) / 2)],
        rooms: [a.fixture.in],
        fixture: a.fixture.index,
      });
    }
  }
  const fixtureAreaOf = (id: string) =>
    snap(fixtureModels.filter((m) => m.fixture.in === id).reduce((t, m) => t + m.area, 0));

  // floor standing under a fixture is not floor you can use
  const occupied: boolean[][] = [];
  for (let i = 0; i < cols; i++) {
    occupied.push([]);
    for (let j = 0; j < rowsN; j++) {
      const c: Pt = [(xs[i]! + xs[i + 1]!) / 2, (ys[j]! + ys[j + 1]!) / 2];
      occupied[i]!.push(fixtureModels.some((m) => pointInPoly(c, m.fixture.poly)));
    }
  }

  /**
   * Half the thickness of the wall running along one side of a rectangle. Rooms are
   * authored on centrelines, so a comfort minimum has to come off both faces; a side
   * that does not sit on a wall deducts nothing. Where a side spans walls of different
   * thickness the thickest wins, which is the conservative reading for a comfort check.
   */
  const halfWallAlong = (axis: Axis, c: number, from: number, to: number, id: string): number => {
    let t = 0;
    for (const w of walls) {
      if (w.axis !== axis || !eq(w.c, c)) continue;
      if (w.neg !== id && w.pos !== id) continue;
      if (Math.min(w.to, to) - Math.max(w.from, from) <= MM) continue;
      t = Math.max(t, w.thickness);
    }
    return t / 2;
  };

  // ---- room metrics ----
  const roomModels: RoomModel[] = rooms.map((room) => {
    const area = Math.abs(shoelace(room.poly));
    const rect = largestRect(
      (i, j) => owner(i, j) === room.id && ownersOf[i]![j]!.length === 1 && !occupied[i]![j]!,
      xs,
      ys,
    );
    const west = halfWallAlong("v", rect.x0, rect.y0, rect.y1, room.id);
    const east = halfWallAlong("v", rect.x1, rect.y0, rect.y1, room.id);
    const north = halfWallAlong("h", rect.y0, rect.x0, rect.x1, room.id);
    const south = halfWallAlong("h", rect.y1, rect.x0, rect.x1, room.id);
    const clearRect = {
      x0: snap(rect.x0 + west),
      y0: snap(rect.y0 + north),
      x1: snap(rect.x1 - east),
      y1: snap(rect.y1 - south),
      w: snap(rect.x1 - rect.x0 - west - east),
      h: snap(rect.y1 - rect.y0 - north - south),
    };
    const w = clearRect.w;
    const h = clearRect.h;
    const faces = new Set<Side>();
    for (const wall of walls) {
      if (wall.kind !== "exterior") continue;
      if (wall.axis === "h" && wall.pos === room.id) faces.add("north");
      if (wall.axis === "h" && wall.neg === room.id) faces.add("south");
      if (wall.axis === "v" && wall.pos === room.id) faces.add("west");
      if (wall.axis === "v" && wall.neg === room.id) faces.add("east");
    }
    return {
      room,
      bbox: bbox(room.poly),
      area: snap(area),
      clearArea: snap(clearArea(room.poly, area, pieces, room.id, thicknessOf)),
      largestRect: rect,
      clearRect,
      minDimension: snap(Math.min(w, h)),
      labelAt: [snap((rect.x0 + rect.x1) / 2), snap((rect.y0 + rect.y1) / 2)],
      exteriorWindow: false,
      exteriorFaces: [...faces],
      fixtureArea: fixtureAreaOf(room.id),
      usableArea: snap(Math.max(0, snap(clearArea(room.poly, area, pieces, room.id, thicknessOf)) - fixtureAreaOf(room.id))),
    };
  });
  const byId = new Map(roomModels.map((m) => [m.room.id, m]));

  // ---- openings ----
  const openings: ResolvedOpening[] = [];
  for (const spec of plan.openings) {
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
          at: b.center,
          opening: b.spec.index,
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
          at: o.center,
          opening: o.spec.index,
        });
      } else {
        const r = o.wall.neg === "exterior" ? o.wall.pos : o.wall.neg;
        const m = byId.get(r);
        if (m) m.exteriorWindow = true;
      }
    }
  }

  // ---- access graph ----
  const access = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (access.get(a) ?? access.set(a, new Set()).get(a)!).add(b);
    (access.get(b) ?? access.set(b, new Set()).get(b)!).add(a);
  };
  for (const r of rooms) access.set(r.id, new Set());
  access.set("exterior", new Set());
  for (const o of openings) {
    if (o.spec.type === "window") continue;
    if (o.wall.neg === "gap" || o.wall.pos === "gap") continue;
    link(o.wall.neg, o.wall.pos);
  }

  // ---- envelope ----
  const env = bbox(rooms.flatMap((r) => r.poly));
  let footprint = 0;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rowsN; j++)
      if (owner(i, j) !== "exterior") footprint += (xs[i + 1]! - xs[i]!) * (ys[j + 1]! - ys[j]!);

  return {
    model: {
      plan,
      rooms: roomModels,
      walls,
      openings,
      fixtures: fixtureModels,
      envelope: { ...env, area: snap(footprint) },
      access,
      interiorArea: snap(roomModels.reduce((s, m) => s + m.area, 0)),
    },
    findings,
  };
}

const isVoid = (o: Owner) => o === "exterior" || o === "gap";
export const label = (o: Owner): string => (o === "exterior" ? "the exterior" : o === "gap" ? "a gap" : o);

/**
 * Area after deducting half of every bounding wall's thickness:
 *   A − Σ len·t/2 + Σ_corners ±t₁t₂/4  (convex +, reflex −)
 * Exact for rectilinear polygons; pieces carry the thickness along each edge.
 */
function clearArea(poly: Pt[], area: number, pieces: Piece[], id: string, thicknessOf: (p: Piece) => number): number {
  let deduct = 0;
  const mine = pieces.filter((p) => p.neg === id || p.pos === id);
  for (const p of mine) deduct += (p.to - p.from) * (thicknessOf(p) / 2);
  const orient = Math.sign(shoelace(poly));
  let corners = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n]!;
    const cur = poly[i]!;
    const next = poly[(i + 1) % n]!;
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    const convex = Math.sign(cross) === orient;
    const t1 = thicknessAt(mine, prev, cur, thicknessOf);
    const t2 = thicknessAt(mine, cur, next, thicknessOf);
    corners += ((convex ? 1 : -1) * t1 * t2) / 4;
  }
  return Math.max(0, area - deduct + corners);
}

/** thickness of the wall piece touching vertex `b` on the edge a→b */
function thicknessAt(pieces: Piece[], a: Pt, b: Pt, thicknessOf: (p: Piece) => number): number {
  const axis: Axis = eq(a[1], b[1]) ? "h" : "v";
  const c = axis === "h" ? b[1] : b[0];
  const at = axis === "h" ? b[0] : b[1];
  const p = pieces.find((q) => q.axis === axis && eq(q.c, c) && (eq(q.from, at) || eq(q.to, at)));
  return p ? thicknessOf(p) : 0;
}

function resolveOpening(spec: Opening, walls: WallSegment[], findings: Finding[]): ResolvedOpening | undefined {
  const [a, b] = spec.between;
  let cands = walls.filter((w) => (w.neg === a && w.pos === b) || (w.neg === b && w.pos === a));
  const fail = (rule: string, message: string) => {
    findings.push({ rule, severity: "error", message, opening: spec.index, rooms: spec.between.filter((s) => s !== "exterior") });
    return undefined;
  };
  if (cands.length === 0) {
    const neighbours = (id: string) =>
      [...new Set(walls.filter((w) => w.neg === id || w.pos === id).map((w) => (w.neg === id ? w.pos : w.neg)))].map(label).join(", ");
    const hint = a === "exterior" ? `${b} touches: ${neighbours(b)}` : b === "exterior" ? `${a} touches: ${neighbours(a)}` : `${a} touches: ${neighbours(a)}; ${b} touches: ${neighbours(b)}`;
    return fail("wall.unresolved", `opening #${spec.index} (${spec.type}): ${label(a)} and ${label(b)} share no wall. ${hint}`);
  }
  if (spec.on) {
    const { room, side, near } = spec.on;
    if (side) cands = cands.filter((w) => sideOf(w, room) === side);
    if (cands.length === 0) return fail("wall.unresolved", `opening #${spec.index}: ${room} has no wall to ${label(a === room ? b : a)} on its ${side} side`);
    if (near && cands.length > 1) {
      cands.sort((w1, w2) => distToWall(near, w1) - distToWall(near, w2));
      cands = [cands[0]!];
    }
  }
  if (cands.length > 1) {
    const roomRef = a === "exterior" ? b : a;
    const desc = cands.map((w) => `${sideOf(w, roomRef)} ${describe(w)}`).join("; ");
    return fail(
      "wall.ambiguous",
      `opening #${spec.index}: ${label(a)} and ${label(b)} share ${cands.length} wall segments (${desc}); add "on": { "room": "${roomRef}", "side": … } or "near": [x, y]`,
    );
  }
  const wall = cands[0]!;
  const len = wall.to - wall.from;
  const centre =
    spec.position === "center"
      ? wall.from + len / 2
      : spec.position.from === "start"
        ? wall.from + spec.position.distance
        : wall.to - spec.position.distance;
  const from = snap(centre - spec.width / 2);
  const to = snap(centre + spec.width / 2);
  if (from < wall.from - MM || to > wall.to + MM) {
    findings.push({
      rule: "opening.overflow",
      severity: "error",
      message: `opening #${spec.index} (${spec.type}, ${spec.width} m) does not fit the ${snap(len)} m wall between ${label(wall.neg)} and ${label(wall.pos)} at that position`,
      at: pointOn(wall, centre),
      opening: spec.index,
    });
  } else {
    for (const gap of [from - wall.from, wall.to - to]) {
      if (snap(gap) > MM && snap(gap) < CORNER_SLIVER) {
        findings.push({
          rule: "opening.near_corner",
          severity: "warning",
          message: `opening #${spec.index} leaves a ${snap(gap)} m sliver of wall at a corner; move it to the corner or leave ≥ ${CORNER_SLIVER} m`,
          at: pointOn(wall, centre),
          opening: spec.index,
        });
        break;
      }
    }
  }
  const isDoor = spec.type === "door";
  return {
    spec,
    wall,
    from,
    to,
    center: pointOn(wall, centre),
    hinge: isDoor ? pointOn(wall, spec.hinge === "start" ? from : to) : undefined,
    swingRoom: isDoor ? spec.swingInto : undefined,
  };
}

/** which side of `room` a wall lies on */
export function sideOf(w: WallSegment, room: string): Side {
  if (w.axis === "h") return w.pos === room ? "north" : "south";
  return w.pos === room ? "west" : "east";
}

export function pointOn(w: WallSegment, t: number): Pt {
  return w.axis === "h" ? [snap(t), w.c] : [w.c, snap(t)];
}

function describe(w: WallSegment): string {
  return w.axis === "h" ? `y=${w.c} x ${w.from}→${w.to}` : `x=${w.c} y ${w.from}→${w.to}`;
}

function distToWall(p: Pt, w: WallSegment): number {
  const along = w.axis === "h" ? p[0] : p[1];
  const across = w.axis === "h" ? p[1] : p[0];
  const t = Math.max(w.from, Math.min(w.to, along));
  return Math.hypot(along - t, across - w.c);
}

export type { Model };
