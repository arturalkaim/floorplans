import { bbox, cellsToPolygons, eq, largestRect, pointInPoly, polyInside, polysOverlap, shoelace, snap } from "./geometry.ts";
import type {
  Analysis,
  Axis,
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
  Side,
  Vertical,
  WallSegment,
} from "./types.ts";
import { EXTERIOR, GAP, isOpenSky, isVoid, outdoorOwner, ownerId, ownerKey, roomOwner, sameOwner, voidOwner } from "./types.ts";

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
    for (const at of v.at) {
      if (at.level !== level.id) continue;
      out.push({
        index: -1,
        type: v.type === "stairs" ? "stairs" : "other",
        name: v.name,
        in: at.in,
        poly: at.poly,
        depth: undefined,
        vertical: v.id,
      });
    }
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

/** Everything derived from one storey alone. */
function deriveLevel(plan: Plan, level: Level, planFixtures: Fixture[]): { model: LevelModel; findings: Finding[] } {
  const findings: Finding[] = [];
  const rooms = level.rooms;

  // ---- arrangement grid from every distinct x / y ----
  const xset = new Set<number>();
  const yset = new Set<number>();
  for (const r of rooms) for (const [x, y] of r.poly) (xset.add(x), yset.add(y));
  for (const o of level.outdoor) for (const [x, y] of o.poly) (xset.add(x), yset.add(y));
  for (const v of level.voids) for (const [x, y] of v.poly) (xset.add(x), yset.add(y));
  for (const fx of planFixtures) for (const [x, y] of fx.poly) (xset.add(x), yset.add(y));
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
  // A cell no room covers belongs to a declared outdoor space, to a declared void, to the
  // street, or to nothing at all. Declared spaces are claimed first, so a deck on the
  // boundary keeps its own id instead of being swallowed by the street.
  const unowned: Owner[][] = ownersOf.map((col) => col.map(() => GAP));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rowsN; j++) {
      if (ownersOf[i]![j]!.length > 0) continue;
      const c: Pt = [(xs[i]! + xs[i + 1]!) / 2, (ys[j]! + ys[j + 1]!) / 2];
      const o = level.outdoor.find((o) => pointInPoly(c, o.poly));
      if (o) unowned[i]![j] = outdoorOwner(o.id);
      else {
        const v = level.voids.find((v) => pointInPoly(c, v.poly));
        if (v) unowned[i]![j] = voidOwner(v.id);
      }
    }
  }
  // The street is what the border flood fill reaches over cells no room covers. It walks
  // *through* outdoor cells without claiming them — no wall is ever derived between two
  // voids, so a deck touching the boundary is continuous with the street — and every
  // outdoor space it reaches is street-connected. One it cannot reach is a courtyard:
  // open sky you can only get to from inside the house.
  // A declared void stops the fill exactly as a room does: it is a hole in the slab, not
  // a hole in the building, so the street never flows through it.
  const streetOutdoor = new Set<string>();
  const reached: boolean[][] = ownersOf.map((col) => col.map(() => false));
  const open = (i: number, j: number) => ownersOf[i]![j]!.length === 0 && unowned[i]![j]!.kind !== "void";
  const stack: Array<[number, number]> = [];
  for (let i = 0; i < cols; i++) for (const j of [0, rowsN - 1]) if (open(i, j)) stack.push([i, j]);
  for (let j = 0; j < rowsN; j++) for (const i of [0, cols - 1]) if (open(i, j)) stack.push([i, j]);
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (i < 0 || j < 0 || i >= cols || j >= rowsN || reached[i]![j] || !open(i, j)) continue;
    reached[i]![j] = true;
    const v = unowned[i]![j]!;
    if (v.kind === "outdoor") streetOutdoor.add(v.id);
    else unowned[i]![j] = EXTERIOR;
    stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  const owner = (i: number, j: number): Owner => {
    if (i < 0 || j < 0 || i >= cols || j >= rowsN) return EXTERIOR;
    const o = ownersOf[i]![j]!;
    if (o.length >= 1) return roomOwner(o[0]!);
    return unowned[i]![j]!;
  };
  /** is this owner the room with that id? */
  const isRoom = (o: Owner, id: string) => o.kind === "room" && o.id === id;
  // A gap or an overlap is a region, not a cell: flood-fill 4-connected cells of the same
  // kind into one component and report it once, with the component's bbox, area and
  // area-weighted centroid. Reporting per cell instead makes one hole or one overlap look
  // like several findings, once per arrangement-grid cell it happens to span.
  for (const cells of tilingComponents((i, j) => ownersOf[i]![j]!.length > 1, cols, rowsN)) {
    const region = cellRegion(cells, xs, ys);
    const rooms = [...new Set(cells.flatMap(([i, j]) => ownersOf[i]![j]!))];
    findings.push({
      rule: "tiling.overlap",
      severity: "error",
      message: `rooms ${rooms.join(", ")} overlap over ${region.area} m² from (${region.x0}, ${region.y0}) to (${region.x1}, ${region.y1})`,
      at: region.at,
      rooms,
    });
  }
  for (const cells of tilingComponents((i, j) => ownersOf[i]![j]!.length === 0 && unowned[i]![j]!.kind === "gap", cols, rowsN)) {
    const region = cellRegion(cells, xs, ys);
    findings.push({
      rule: "tiling.gap",
      severity: "error",
      message: `no room covers a ${region.area} m² area from (${region.x0}, ${region.y0}) to (${region.x1}, ${region.y1}); the plan has a hole`,
      at: region.at,
    });
  }

  // ---- wall pieces between cells with different owners ----
  const pieces: Piece[] = [];
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j < rowsN; j++) {
      const a = owner(i - 1, j);
      const b = owner(i, j);
      if (!sameOwner(a, b) && !(isVoid(a) && isVoid(b))) pieces.push({ axis: "v", c: xs[i]!, from: ys[j]!, to: ys[j + 1]!, neg: a, pos: b });
    }
  }
  for (let j = 0; j <= rowsN; j++) {
    for (let i = 0; i < cols; i++) {
      const a = owner(i, j - 1);
      const b = owner(i, j);
      if (!sameOwner(a, b) && !(isVoid(a) && isVoid(b))) pieces.push({ axis: "h", c: ys[j]!, from: xs[i]!, to: xs[i + 1]!, neg: a, pos: b });
    }
  }
  // A wall onto open sky is an exterior wall whether the sky is the street or a courtyard:
  // see the INVARIANT on isOpenSky in types.ts.
  const thicknessOf = (p: Piece) => (isOpenSky(p.neg) || isOpenSky(p.pos) ? plan.walls.exterior : plan.walls.partition);

  // merge collinear pieces with the same owner pair
  const groups = new Map<string, Piece[]>();
  for (const p of pieces) {
    const k = `${p.axis}|${p.c}|${ownerKey(p.neg)}|${ownerKey(p.pos)}`;
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
    const kind = isOpenSky(p.neg) || isOpenSky(p.pos) ? "exterior" : "partition";
    return { id: "", axis: p.axis, c: p.c, from: p.from, to: p.to, neg: p.neg, pos: p.pos, kind, thickness: thicknessOf(p) };
  }

  // ---- outdoor space is open sky, so no room may stand on it ----
  for (const o of level.outdoor) {
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
    ...level.outdoor.map((o) => [o.id, o.poly] as const),
  ]);
  const fixtureModels: FixtureModel[] = planFixtures.map((fixture) => ({
    fixture,
    bbox: bbox(fixture.poly),
    area: snap(Math.abs(shoelace(fixture.poly))),
  }));
  for (const fm of fixtureModels) {
    // a vertical element's footprint is checked by `stair.no_arrival`, which says the same
    // thing about the same geometry but names the element the author can actually edit
    if (fm.fixture.vertical !== undefined) continue;
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
        ...occupantRef(a.fixture),
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
      if (!isRoom(w.neg, id) && !isRoom(w.pos, id)) continue;
      if (Math.min(w.to, to) - Math.max(w.from, from) <= MM) continue;
      t = Math.max(t, w.thickness);
    }
    return t / 2;
  };

  // ---- room metrics ----
  const roomModels: RoomModel[] = rooms.map((room) => {
    const area = Math.abs(shoelace(room.poly));
    const rect = largestRect(
      (i, j) => isRoom(owner(i, j), room.id) && ownersOf[i]![j]!.length === 1 && !occupied[i]![j]!,
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
      if (wall.axis === "h" && isRoom(wall.pos, room.id)) faces.add("north");
      if (wall.axis === "h" && isRoom(wall.neg, room.id)) faces.add("south");
      if (wall.axis === "v" && isRoom(wall.pos, room.id)) faces.add("west");
      if (wall.axis === "v" && isRoom(wall.neg, room.id)) faces.add("east");
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
        // the wall is exterior, so exactly one side is open sky; the other is the room
        // that gets the daylight — including when the sky is a courtyard
        const r = ownerId(isOpenSky(o.wall.neg) ? o.wall.pos : o.wall.neg);
        const m = r === undefined ? undefined : byId.get(r);
        if (m) m.exteriorWindow = true;
      }
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
  for (const o of level.outdoor) access.set(ownerKey(outdoorOwner(o.id)), new Set());
  access.set(ownerKey(EXTERIOR), new Set());
  for (const o of openings) {
    if (o.spec.type === "window") continue;
    if (o.wall.neg.kind === "gap" || o.wall.pos.kind === "gap") continue;
    link(o.wall.neg, o.wall.pos);
  }

  // ---- envelope ----
  // The floor plate is every cell that is not open sky — rooms and the voids cut through
  // them, since a stairwell is inside the building. `outline` is its real boundary rather
  // than a bounding box, which is what the ghost of the level below needs to be legible.
  const env = bbox(rooms.flatMap((r) => r.poly));
  let footprint = 0;
  const plate: Array<[number, number]> = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rowsN; j++)
      if (!isOpenSky(owner(i, j))) {
        footprint += (xs[i + 1]! - xs[i]!) * (ys[j + 1]! - ys[j]!);
        plate.push([i, j]);
      }

  return {
    model: {
      level,
      rooms: roomModels,
      walls,
      openings,
      fixtures: fixtureModels,
      envelope: { ...env, area: snap(footprint), outline: cellsToPolygons(plate, xs, ys) },
      access,
      streetOutdoor,
      interiorArea: snap(roomModels.reduce((s, m) => s + m.area, 0)),
    },
    findings,
  };
}

export const label = (o: Owner): string =>
  o.kind === "exterior" ? "the exterior" : o.kind === "gap" ? "a gap" : o.kind === "overlap" ? o.ids.join(" + ") : o.id;

/**
 * How a finding points at a thing standing on the floor. An authored fixture is an index
 * into the document's `fixtures`; a vertical element's synthetic footprint has no such
 * index, so it names the element instead.
 */
export const occupantRef = (f: Fixture): { fixture: number } | { vertical: string } =>
  f.vertical === undefined ? { fixture: f.index } : { vertical: f.vertical };

/**
 * Does the id an opening's `between` names refer to this owner? The literal "exterior" is
 * the street and only the street; anything else is a room or an outdoor space by id.
 */
const refMatches = (ref: string, o: Owner): boolean =>
  ref === "exterior" ? o.kind === "exterior" : (o.kind === "room" || o.kind === "outdoor") && o.id === ref;

/** how an authored `between` id reads in a message */
const refLabel = (ref: string): string => (ref === "exterior" ? "the exterior" : ref);

/** 4-connected components of arrangement-grid cells matching `mask`, as lists of [i, j]. */
function tilingComponents(mask: (i: number, j: number) => boolean, cols: number, rowsN: number): Array<Array<[number, number]>> {
  const seen: boolean[][] = Array.from({ length: cols }, () => new Array<boolean>(rowsN).fill(false));
  const groups: Array<Array<[number, number]>> = [];
  for (let i0 = 0; i0 < cols; i0++) {
    for (let j0 = 0; j0 < rowsN; j0++) {
      if (!mask(i0, j0) || seen[i0]![j0]) continue;
      const cells: Array<[number, number]> = [];
      const stack: Array<[number, number]> = [[i0, j0]];
      seen[i0]![j0] = true;
      while (stack.length) {
        const [i, j] = stack.pop()!;
        cells.push([i, j]);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rowsN || seen[ni]![nj] || !mask(ni, nj)) continue;
          seen[ni]![nj] = true;
          stack.push([ni, nj]);
        }
      }
      groups.push(cells);
    }
  }
  return groups;
}

/** bbox, area and area-weighted centroid of a set of arrangement-grid cells, in metres. */
function cellRegion(cells: Array<[number, number]>, xs: number[], ys: number[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const [i, j] of cells) {
    const cx0 = xs[i]!;
    const cx1 = xs[i + 1]!;
    const cy0 = ys[j]!;
    const cy1 = ys[j + 1]!;
    x0 = Math.min(x0, cx0);
    y0 = Math.min(y0, cy0);
    x1 = Math.max(x1, cx1);
    y1 = Math.max(y1, cy1);
    const a = (cx1 - cx0) * (cy1 - cy0);
    area += a;
    cx += a * ((cx0 + cx1) / 2);
    cy += a * ((cy0 + cy1) / 2);
  }
  return { x0: snap(x0), y0: snap(y0), x1: snap(x1), y1: snap(y1), area: snap(area), at: [snap(cx / area), snap(cy / area)] as Pt };
}

/**
 * Area after deducting half of every bounding wall's thickness:
 *   A − Σ len·t/2 + Σ_corners ±t₁t₂/4  (convex +, reflex −)
 * Exact for rectilinear polygons; pieces carry the thickness along each edge.
 */
function clearArea(poly: Pt[], area: number, pieces: Piece[], id: string, thicknessOf: (p: Piece) => number): number {
  let deduct = 0;
  const mine = pieces.filter((p) => ownerId(p.neg) === id || ownerId(p.pos) === id);
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
  let cands = walls.filter(
    (w) => (refMatches(a, w.neg) && refMatches(b, w.pos)) || (refMatches(b, w.neg) && refMatches(a, w.pos)),
  );
  const fail = (rule: string, message: string) => {
    findings.push({ rule, severity: "error", message, opening: spec.index, rooms: spec.between.filter((s) => s !== "exterior") });
    return undefined;
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
    return fail("wall.unresolved", `opening #${spec.index} (${spec.type}): ${refLabel(a)} and ${refLabel(b)} share no wall. ${hint}`);
  }
  if (spec.on) {
    const { room, side, near } = spec.on;
    if (side) cands = cands.filter((w) => sideOf(w, room) === side);
    if (cands.length === 0) return fail("wall.unresolved", `opening #${spec.index}: ${room} has no wall to ${refLabel(a === room ? b : a)} on its ${side} side`);
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
      `opening #${spec.index}: ${refLabel(a)} and ${refLabel(b)} share ${cands.length} wall segments (${desc}); add "on": { "room": "${roomRef}", "side": … } or "near": [x, y]`,
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

/** which side of the space `ref` a wall lies on */
export function sideOf(w: WallSegment, ref: string): Side {
  if (w.axis === "h") return refMatches(ref, w.pos) ? "north" : "south";
  return refMatches(ref, w.pos) ? "west" : "east";
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
