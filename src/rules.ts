import { occupantRef, outwardBearing, overlapArea, sectorMeetsShape, shapeArea, shapeGap, shapeWithin, uncovered } from "./derive.ts";
import { doorSwing } from "./doors.ts";
import { bbox, snap } from "./geometry.ts";
import type { Finding, LevelModel, Model, Owner, Pt, ResolvedOpening, RoomKind, Shape } from "./types.ts";
import { inLevel, isOpenSky, isRectilinear, isStreet, outdoorOwner, ownerId, ownerKey, pathTo, roomOwner } from "./types.ts";

export interface RuleOptions {
  /** share of interior area above which circulation is flagged (default 0.10) */
  circulationShare?: number;
  /** comfort minimum for the short side of a room's largest clear rectangle, per kind (metres) */
  minDimension?: Partial<Record<RoomKind, number>>;
  /** minimum door widths (metres) */
  doorMinWidth?: { interior?: number; entrance?: number };
  /** walkable gap required between two fixtures in the same room (default 0.6 m) */
  minClearance?: number;
  /**
   * Comfortable stair geometry: pitch in degrees and the shortest going (default 30–42°,
   * 0.25 m). These are conventions and not a code, which is exactly why they are options.
   */
  stairPitch?: { min?: number; max?: number; going?: number };
  /** clear height under the slab a stair passes through, metres (default 2.0) */
  minHeadroom?: number;
}

const DEFAULT_MIN_DIM: Partial<Record<RoomKind, number>> = {
  bedroom: 2.4,
  living: 3.0,
  kitchen: 1.8,
  office: 2.0,
  bath: 1.5,
  wc: 1.0,
  hall: 1.0,
  corridor: 1.0,
  storage: 0.6,
  utility: 1.2,
  garage: 2.5,
};

/** Comfortable stair pitch, the going a foot needs, and the height a head needs. */
const STAIR_DEFAULTS = { min: 30, max: 42, going: 0.25, headroom: 2.0 };

/**
 * Semantic rules over the derived model. Geometry/topology errors are already
 * produced by derive(); these are the "is this a good house" checks.
 *
 * Three scopes, and each rule belongs to exactly one: **per level** (tiling, walls,
 * openings, light, privacy, sizes — a storey is its own plan), **building-wide**
 * (`entrance.*` and `reach.*`, because you enter a building once and then walk through
 * all of it), and **cross-level** (the stair rules, which are about the seam itself).
 */
export function checkRules(model: Model, opts: RuleOptions = {}): Finding[] {
  const f: Finding[] = [];
  const plan = model.plan;
  // A single-level document never carries `level` on a finding, so its output stays
  // byte-identical to what it was before levels existed.
  const tag = (levelId: string, x: Finding): Finding => (plan.levelled ? { ...x, level: levelId } : x);
  /**
   * INVARIANT: a finding of a document that did not author `levels` never carries one,
   * whatever produced it. A single-level plan may still declare a `vertical` block — it
   * will go nowhere and say so — and that message must not be the one thing that leaks a
   * level id into output a caller has been parsing since before levels existed.
   */
  const on = (levelId: string) => (plan.levelled ? { level: levelId } : {});

  const named = new Map(plan.levels.map((l) => [l.id, l.name]));
  /** how a room reads in a building-wide message, which may span levels */
  const where = (levelId: string, name: string) => (plan.levelled ? `${name} on ${named.get(levelId) ?? levelId}` : name);

  buildingRules(model, f, where, on);
  for (const lm of model.levels) levelRules(model, lm, opts, f, tag);
  verticalRules(model, opts, f, on);
  return f;
}

/** Per-level naming helpers: a message says the name the author wrote, never an id. */
function namesOf(lm: LevelModel) {
  const byId = new Map(lm.rooms.map((m) => [m.room.id, m]));
  const outdoorName = new Map(lm.level.outdoor.map((o) => [o.id, o.name]));
  const voidName = new Map(lm.level.voids.map((v) => [v.id, v.name]));
  const nameOf = (id: string) => byId.get(id)?.room.name ?? outdoorName.get(id) ?? voidName.get(id) ?? id;
  /** how one side of a wall reads in a message */
  const sideName = (o: Owner): string => {
    const id = ownerId(o);
    return id !== undefined ? nameOf(id) : o.kind === "overlap" ? o.ids.join(" + ") : o.kind;
  };
  return { byId, nameOf, sideName };
}

/**
 * You enter a building once and then walk through all of it, so the way in and the walk
 * from it are the only rules that see every level at once.
 */
function buildingRules(
  model: Model,
  f: Finding[],
  where: (levelId: string, name: string) => string,
  on: (levelId: string) => { level?: string },
): void {
  const plan = model.plan;
  const ground = new Set(plan.levels.filter((l) => l.ground).map((l) => l.id));

  interface StreetDoor {
    lm: LevelModel;
    o: ResolvedOpening;
  }
  const streetDoors: StreetDoor[] = [];
  const doorsOff: StreetDoor[] = [];
  for (const lm of model.levels) {
    const street = (o: Owner) => isStreet(o, lm.streetOutdoor);
    for (const o of lm.openings) {
      if (o.spec.type !== "door" || !(street(o.wall.neg) || street(o.wall.pos))) continue;
      (ground.has(lm.level.id) ? streetDoors : doorsOff).push({ lm, o });
    }
  }

  const describe = ({ lm, o }: StreetDoor) => {
    const { sideName } = namesOf(lm);
    const street = (x: Owner) => isStreet(x, lm.streetOutdoor);
    return where(lm.level.id, sideName(street(o.wall.neg) ? o.wall.pos : o.wall.neg));
  };

  // a building-wide finding about an absence points at the ground level's opening list,
  // which is where the door that is missing would have to be written
  const groundOpenings = inLevel(model.level, "openings");
  const hasEntrance = streetDoors.length > 0;
  if (!hasEntrance) {
    f.push({ rule: "entrance.missing", severity: "error", message: "no door leads outside; the house cannot be entered", path: groundOpenings });
  } else if (streetDoors.length > 1) {
    // say something true about what the plan already declares: telling an author to mark
    // the main entrance when they have marked it is advice they have to stop and check
    const marked = streetDoors.filter((d) => d.o.spec.entrance);
    const all = streetDoors.map(describe).join(", ");
    const tail =
      marked.length === 0
        ? 'none is marked the main one with "entrance": true'
        : marked.length === 1
          ? `the main one is ${describe(marked[0]!)}`
          : `${marked.length} of them are marked "entrance": true (${marked.map(describe).join(", ")}); only one can be the main door`;
    f.push({
      rule: "entrance.multiple",
      severity: "info",
      message: `${streetDoors.length} doors lead outside (${all}); ${tail}`,
      path: groundOpenings,
    });
  }

  // A door to open air on a floor the street does not meet is a hole in the wall, not a
  // way in. It is legitimate — a balcony has one — so this is information, not an error;
  // a sloping site answers it by marking that level `"ground": true`.
  for (const d of doorsOff) {
    f.push({
      ...on(d.lm.level.id),
      rule: "entrance.not_ground",
      severity: "info",
      message: `door #${d.o.spec.index} opens to the outside on ${d.lm.level.name}, which the street does not meet; it is a balcony door, not a way in`,
      path: d.o.spec.path,
      at: d.o.center,
      opening: d.o.spec.id,
    });
  }

  // ---- the walk from the street, across every level ----
  const noAccess = new Set<string>();
  for (const lm of model.levels)
    for (const m of lm.rooms)
      if ((lm.access.get(ownerKey(roomOwner(m.room.id)))?.size ?? 0) === 0) noAccess.add(`${lm.level.id}/${m.room.id}`);

  if (!hasEntrance) return;
  // the walk starts wherever someone standing on the road already is: the street itself
  // and every outdoor space it reaches on a level the street meets
  const start = ["exterior"];
  for (const lm of model.levels)
    if (ground.has(lm.level.id))
      for (const id of lm.streetOutdoor) start.push(`${lm.level.id}/${ownerKey(outdoorOwner(id))}`);
  const seen = new Set<string>(start);
  const queue = [...start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of model.building.access.get(cur) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
  }
  for (const lm of model.levels) {
    const served = model.plan.vertical.some((v) => v.at.some((a) => a.level === lm.level.id));
    for (const m of lm.rooms) {
      const key = `${lm.level.id}/${ownerKey(roomOwner(m.room.id))}`;
      if (seen.has(key) || noAccess.has(`${lm.level.id}/${m.room.id}`)) continue;
      // saying *why* costs nothing and is the difference between a finding an agent can
      // act on and one it has to go and investigate
      const why = ground.has(lm.level.id) || served ? "" : `; no stair, lift or ramp arrives on ${lm.level.name}`;
      f.push({
        ...on(lm.level.id),
        rule: "reach.unreachable",
        severity: "error",
        message: `${m.room.name} cannot be reached from the entrance${why}`,
        path: m.room.path,
        rooms: [m.room.id],
        at: m.labelAt,
      });
    }
  }
}

/** Everything a storey can be judged on by itself. */
function levelRules(
  model: Model,
  lm: LevelModel,
  opts: RuleOptions,
  f: Finding[],
  tag: (levelId: string, x: Finding) => Finding,
): void {
  const id = lm.level.id;
  const push = (x: Finding) => f.push(tag(id, x));
  const rooms = lm.rooms;
  const { byId, nameOf, sideName } = namesOf(lm);
  const kindOf = (rid: string): RoomKind | undefined => byId.get(rid)?.room.kind;
  const doors = lm.openings.filter((o) => o.spec.type === "door");
  const street = (o: Owner) => isStreet(o, lm.streetOutdoor);

  // Marking a courtyard door the main entrance is allowed by the schema — the door is
  // legitimate — but it is not the way in, and saying so is more useful than silence.
  for (const o of doors) {
    if (!o.spec.entrance || street(o.wall.neg) || street(o.wall.pos)) continue;
    const sky = isOpenSky(o.wall.neg) ? o.wall.neg : isOpenSky(o.wall.pos) ? o.wall.pos : undefined;
    push({
      rule: "entrance.not_street",
      severity: "warning",
      message: sky
        ? `door #${o.spec.index} is marked the main entrance but opens onto ${sideName(sky)}, which the street does not reach`
        : `door #${o.spec.index} is marked the main entrance but is an interior door between ${sideName(o.wall.neg)} and ${sideName(o.wall.pos)}`,
      path: pathTo(o.spec, "entrance"),
      at: o.center,
      opening: o.spec.id,
    });
  }

  // ---- access ----
  for (const m of rooms) {
    if ((lm.access.get(ownerKey(roomOwner(m.room.id)))?.size ?? 0) === 0) {
      push({
        rule: "space.no_access",
        severity: "error",
        message: `${m.room.name} has no door or cased opening`,
        path: m.room.path,
        rooms: [m.room.id],
        at: m.labelAt,
      });
    }
  }

  // ---- light ----
  /**
   * Where a room's daylight could come from. A rectilinear room's exterior walls face
   * one of four ways and the message names them, exactly as it always has. A room with
   * an angled or curved wall has no compass side to name, so it gets the run and the
   * bearing instead — which is the same information and is true.
   */
  const daylightFrom = (m: (typeof rooms)[number]): string => {
    if (isRectilinear(m.room))
      return m.exteriorFaces.length
        ? ` (it has an exterior wall on the ${m.exteriorFaces.join("/")})`
        : " and no exterior wall to put one on";
    const mine = lm.walls.filter((w) => w.kind === "exterior" && outwardBearing(w, m.room.id) !== undefined);
    if (mine.length === 0) return " and no exterior wall to put one on";
    const run = snap(mine.reduce((t, w) => t + w.length, 0));
    const bearings = [...new Set(mine.map((w) => outwardBearing(w, m.room.id)!))].sort((a, b) => a - b);
    return ` (it has ${run} m of exterior wall, facing ${bearings.map((b) => `${b}°`).join(", ")})`;
  };
  for (const m of rooms) {
    if (m.exteriorWindow) continue;
    if (m.room.habitable) {
      push({
        rule: "habitable.no_window",
        severity: "warning",
        message: `${m.room.name} is habitable but has no exterior window or glazed exterior door${daylightFrom(m)}`,
        path: m.room.path,
        rooms: [m.room.id],
        at: m.labelAt,
      });
    } else if (m.room.wet) {
      push({
        rule: "wet.no_window",
        severity: "warning",
        message: `${m.room.name} has no exterior window; plan mechanical extraction`,
        path: m.room.path,
        rooms: [m.room.id],
        at: m.labelAt,
      });
    }
  }

  // ---- adjacency semantics ----
  for (const o of doors) {
    // these all say something about two rooms; a door onto sky is not a route between them
    const a = o.wall.neg.kind === "room" ? o.wall.neg.id : undefined;
    const b = o.wall.pos.kind === "room" ? o.wall.pos.id : undefined;
    if (a === undefined || b === undefined) continue;
    const ka = kindOf(a);
    const kb = kindOf(b);
    const wetToKitchen = (byId.get(a)?.room.wet && kb === "kitchen") || (byId.get(b)?.room.wet && ka === "kitchen");
    if (wetToKitchen) {
      push({
        rule: "wet.opens_to_kitchen",
        severity: "warning",
        message: `${nameOf(a)} opens directly into ${nameOf(b)}; most codes want a lobby between a WC and a kitchen`,
        path: o.spec.path,
        rooms: [a, b],
        at: o.center,
        opening: o.spec.id,
      });
    }
    if (ka === "bedroom" && kb === "bedroom") {
      push({
        rule: "privacy.bedroom_through_route",
        severity: "warning",
        message: `${nameOf(a)} and ${nameOf(b)} connect directly; one bedroom is a route to the other`,
        path: o.spec.path,
        rooms: [a, b],
        at: o.center,
        opening: o.spec.id,
      });
    }
    const living = new Set<RoomKind>(["living", "kitchen"]);
    if ((ka === "bedroom" && kb && living.has(kb)) || (kb === "bedroom" && ka && living.has(ka))) {
      push({
        rule: "privacy.bedroom_off_living",
        severity: "info",
        message: `${ka === "bedroom" ? nameOf(a) : nameOf(b)} opens directly off ${ka === "bedroom" ? nameOf(b) : nameOf(a)}`,
        path: o.spec.path,
        rooms: [a, b],
        at: o.center,
        opening: o.spec.id,
      });
    }
  }

  // ---- sizes ----
  const minDim = { ...DEFAULT_MIN_DIM, ...opts.minDimension };
  for (const m of rooms) {
    const min = minDim[m.room.kind];
    if (min === undefined || m.minDimension >= min) continue;
    const r = m.clearRect;
    // "at its narrowest" describes the short side of the largest clear rectangle, which
    // is the measure a rectilinear room gets. A room with an angled or curved wall is
    // measured by the largest circle that fits instead, because an axis-aligned
    // rectangle understates a round room by √2 — so the message says which it means.
    push({
      rule: "room.min_dimension",
      severity: "warning",
      message: isRectilinear(m.room)
        ? `${m.room.name} (${m.room.kind}): ${m.minDimension} m at its narrowest; comfort minimum is ${min} m (clear floor ${r.w} × ${r.h} m)`
        : `${m.room.name} (${m.room.kind}): the largest circle that fits is ${m.minDimension} m across; comfort minimum is ${min} m (largest clear rectangle ${r.w} × ${r.h} m${m.bearing === 0 ? "" : ` at ${m.bearing}°`})`,
      path: pathTo(m.room, "poly", "rect"),
      rooms: [m.room.id],
      at: m.labelAt,
      // the same numbers the message states, so a fix needs no prose parsing
      measured: m.minDimension,
      minimum: min,
      rect: [r.x0, r.y0, r.w, r.h],
    });
  }
  const dmw = { interior: 0.7, entrance: 0.9, ...opts.doorMinWidth };
  for (const o of doors) {
    const ext = o.wall.kind === "exterior";
    const min = ext ? dmw.entrance : dmw.interior;
    if (o.spec.width < min) {
      push({
        rule: "door.min_width",
        severity: "warning",
        message: `door #${o.spec.index} (${o.spec.width} m) between ${sideName(o.wall.neg)} and ${sideName(o.wall.pos)} is narrower than ${min} m`,
        path: pathTo(o.spec, "width"),
        at: o.center,
        opening: o.spec.id,
      });
    }
  }

  // ---- circulation ----
  // per level, because a stair landing is circulation on its own floor and the threshold
  // means a different thing at the two scales
  const circ = rooms.filter((m) => m.room.circulation);
  const circArea = circ.reduce((s, m) => s + m.area, 0);
  const share = lm.interiorArea > 0 ? circArea / lm.interiorArea : 0;
  const maxShare = opts.circulationShare ?? 0.1;
  if (share > maxShare) {
    push({
      rule: "circulation.share",
      severity: "info",
      message: `${circ.map((m) => m.room.name).join(" + ")} take ${Math.round(share * 100)} % of the interior (${snap(circArea)} m²); above ${Math.round(maxShare * 100)} % is worth questioning`,
      // about the balance between several rooms, so it names the collection they are in
      path: inLevel(lm.level, "rooms"),
      rooms: circ.map((m) => m.room.id),
    });
  }

  // ---- door swings ----
  const swings = doors.map((o) => ({ o, s: doorSwing(o) })).filter((x) => x.s !== undefined);
  for (let i = 0; i < swings.length; i++) {
    for (let j = i + 1; j < swings.length; j++) {
      const a = swings[i]!;
      const b = swings[j]!;
      if (a.o.swingRoom !== b.o.swingRoom) continue;
      const A = a.s!.box;
      const B = b.s!.box;
      if (A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1) {
        push({
          rule: "door.swing_collision",
          severity: "info",
          message: `doors #${a.o.spec.index} and #${b.o.spec.index} swing into the same corner of ${nameOf(a.o.swingRoom!)}`,
          path: pathTo(a.o.spec, "hinge"),
          rooms: [a.o.swingRoom!],
          at: a.s!.hinge,
        });
      }
    }
  }

  // ---- fixtures ----
  const minClearance = opts.minClearance ?? 0.6;
  for (let i = 0; i < lm.fixtures.length; i++) {
    for (let j = i + 1; j < lm.fixtures.length; j++) {
      const a = lm.fixtures[i]!;
      const b = lm.fixtures[j]!;
      if (a.fixture.in !== b.fixture.in) continue;
      const gap = snap(shapeGap(a.fixture, b.fixture));
      // touching units are one run; only a gap too narrow to walk through is a problem
      if (gap <= 0 || gap >= minClearance) continue;
      push({
        rule: "fixture.clearance",
        severity: "warning",
        message: `only ${gap} m between ${a.fixture.name} and ${b.fixture.name} in ${nameOf(a.fixture.in)}; leave ≥ ${minClearance} m to walk through`,
        path: pathTo(a.fixture, "poly", "at"),
        at: [snap((a.bbox.x1 + b.bbox.x0) / 2), snap((a.bbox.y0 + b.bbox.y1) / 2)],
        rooms: [a.fixture.in],
        ...occupantRef(a.fixture),
      });
    }
  }

  for (const o of doors) {
    const swing = doorSwing(o);
    if (!swing || o.swingRoom === undefined) continue;
    const radius = o.to - o.from;
    for (const fm of lm.fixtures) {
      if (fm.fixture.in !== o.swingRoom) continue;
      // bounding boxes as a cheap reject, then the exact predicate: does the sector the
      // leaf sweeps meet the fixture? The rectangle test this replaces was only ever
      // right for an axis-aligned door against an axis-aligned box.
      if (swing.box.x1 <= fm.bbox.x0 || fm.bbox.x1 <= swing.box.x0) continue;
      if (swing.box.y1 <= fm.bbox.y0 || fm.bbox.y1 <= swing.box.y0) continue;
      if (!sectorMeetsShape(swing.hinge, swing.closed, swing.open, fm.fixture)) continue;
      void radius;
      push({
        rule: "door.swing_hits_fixture",
        severity: "warning",
        message: `door #${o.spec.index} swings into ${fm.fixture.name} in ${nameOf(fm.fixture.in)}; rehang it or move the fixture`,
        path: pathTo(o.spec, "hinge"),
        at: swing.hinge,
        rooms: [fm.fixture.in],
        opening: o.spec.id,
        ...occupantRef(fm.fixture),
      });
    }
  }
  void model;
}

/**
 * The seam between levels: which levels anything arrives on, whether a flight lands where
 * it says it does, whether consecutive flights are the same shaft, and what stands over
 * open sky. All of these exist only because a vertical element is matched by its own id
 * (§2.2.3) — matching by footprint overlap would make "misaligned" unexpressible.
 */
function verticalRules(
  model: Model,
  opts: RuleOptions,
  f: Finding[],
  on: (levelId: string) => { level?: string },
): void {
  const stair = { ...STAIR_DEFAULTS, ...opts.stairPitch, ...(opts.minHeadroom === undefined ? {} : { headroom: opts.minHeadroom }) };
  const plan = model.plan;
  if (plan.levels.length < 2 && plan.vertical.length === 0) return;
  const byLevel = new Map(model.levels.map((m) => [m.level.id, m]));
  const index = new Map(plan.levels.map((l, i) => [l.id, i]));

  for (const level of plan.levels) {
    if (level.ground) continue;
    if (plan.vertical.some((v) => v.at.some((a) => a.level === level.id))) continue;
    f.push({
      ...on(level.id),
      rule: "level.unreachable",
      severity: "error",
      message: `${level.name} has no stair, lift or ramp: nothing arrives on it`,
      // the element that is missing would be written here, at the document root
      path: "vertical",
    });
  }

  for (const v of plan.vertical) {
    if (v.at.length === 1) {
      const only = v.at[0]!;
      f.push({
        ...on(only.level),
        rule: "stair.no_arrival",
        severity: "error",
        message: `${v.name} ${plan.levelled ? `stands on ${byLevel.get(only.level)?.level.name ?? only.level} and ` : ""}goes nowhere; a vertical element needs a footprint on each of the levels it joins`,
        path: `${v.path}.at`,
        at: centre(only.poly),
        vertical: v.id,
      });
    }
    for (const at of v.at) {
      const lm = byLevel.get(at.level);
      if (!lm) continue;
      const host: Shape | undefined =
        lm.rooms.find((m) => m.room.id === at.in)?.room ?? lm.level.outdoor.find((o) => o.id === at.in);
      if (host && !shapeWithin(at, host)) {
        f.push({
          ...on(at.level),
          rule: "stair.no_arrival",
          severity: "error",
          message: `${v.name} is not fully inside ${at.in} on ${lm.level.name}; that is the space you are meant to step off it into`,
          path: at.path,
          at: centre(at.poly),
          rooms: [at.in],
          vertical: v.id,
        });
      }
    }
    for (let i = 1; i < v.at.length; i++) {
      const a = v.at[i - 1]!;
      const b = v.at[i]!;
      const over = overlapArea(a, b);
      const smaller = Math.min(shapeArea(a), shapeArea(b));
      if (over >= smaller / 2 - 1e-9) continue;
      f.push({
        ...on(b.level),
        rule: "stair.misaligned",
        severity: "warning",
        message:
          over === 0
            ? `${v.name} does not sit over itself: its footprints on ${name(byLevel, a.level)} and ${name(byLevel, b.level)} do not overlap at all`
            : `${v.name} overlaps itself by only ${snap(over)} m² between ${name(byLevel, a.level)} and ${name(byLevel, b.level)}; a shaft that steps sideways needs a landing`,
        path: b.path,
        at: centre(b.poly),
        vertical: v.id,
      });
    }

    // Pitch and headroom are opt-in: they cost the author `risers` and the level's
    // `height`, and each unlocks exactly one check. Both are conventions, not code, so
    // they report the numbers and let the reader judge.
    for (let i = 1; i < v.at.length; i++) {
      const lower = v.at[i - 1]!;
      const upper = v.at[i]!;
      const height = plan.levels[index.get(lower.level) ?? 0]?.height;
      if (v.risers === undefined || height === undefined) continue;
      const axis = flightAxis(v.up, lower.poly);
      const b = bbox(lower.poly);
      const length = axis === 0 ? b.x1 - b.x0 : b.y1 - b.y0;
      const rise = height / v.risers;
      const going = length / (v.risers - 1);
      const pitch = (Math.atan2(rise, going) * 180) / Math.PI;
      if (pitch < stair.min || pitch > stair.max || going < stair.going) {
        f.push({
          ...on(lower.level),
          rule: "stair.pitch",
          severity: "info",
          message: `${v.name}: ${snap(Math.round(pitch * 10) / 10)}° pitch — ${v.risers} risers of ${snap(Math.round(rise * 1000) / 1000)} m over a ${snap(length)} m flight gives a ${snap(Math.round(going * 1000) / 1000)} m going; ${stair.min}–${stair.max}° and a going of ${stair.going} m upwards is the comfortable range`,
          path: pathTo(v, "risers"),
          at: centre(lower.poly),
          vertical: v.id,
        });
      }
      // Headroom needs to know which end is the bottom, so it also needs `up`.
      if (v.up === undefined) continue;
      const above = byLevel.get(upper.level);
      if (!above) continue;
      const dOpen = slabRun(lower, above.level.voids, axis, v.up);
      const headroom = height - (rise * dOpen) / going;
      if (headroom < stair.headroom) {
        f.push({
          ...on(upper.level),
          rule: "stair.headroom",
          severity: "info",
          message: `${v.name} passes under the ${upper.level === lower.level ? "slab" : name(byLevel, upper.level) + " slab"} with ${snap(Math.round(Math.max(0, headroom) * 100) / 100)} m of headroom: the floor above stays closed for ${snap(dOpen)} m of the flight; open it sooner, or declare a void, to keep ${stair.headroom} m`,
          // the fix is a void on the level above, which is where the flight breaks through
          path: inLevel(above.level, "voids"),
          at: centre(lower.poly),
          vertical: v.id,
        });
      }
    }
  }

  // ---- what stands over open sky ----
  // A cantilever is a real building, so this is a warning and not an error: it says the
  // engineering exists, not that the plan is wrong.
  for (let k = 1; k < model.levels.length; k++) {
    const upper = model.levels[k]!;
    const lower = model.levels[k - 1]!;
    const support = supportOn(lower);
    for (const m of upper.rooms) {
      const un = uncovered(m.room, support.map((s) => s.shape));
      if (un.area <= 1e-6) continue;
      // what it *does* stand on, so the reader can see whether 2 m² of overhang is the
      // porch being a metre short or the room being in the wrong place entirely
      const on_ = support.filter((s) => overlapArea(m.room, s.shape) > 1e-6);
      const below = on_.map((s) => ({ kind: s.kind, id: s.id }));
      const rest = on_.length === 0 ? "nothing below it at all" : `the rest on ${on_.map((s) => s.name).join(", ")}`;
      f.push({
        ...on(upper.level.id),
        rule: "structure.over_open_sky",
        severity: "warning",
        message: `${m.room.name} has ${snap(un.area)} m² standing over open sky on ${lower.level.name}, ${rest}; a cantilever is real, but so is a room that has lost its support`,
        path: m.room.path,
        at: un.at,
        rooms: [m.room.id],
        below,
      });
    }
  }
}

/** A floor plate on the level below, and what it is called in the document. */
interface Support {
  kind: "room" | "outdoor" | "void";
  id: string;
  name: string;
  shape: Shape;
}

/**
 * What can hold a room up from one level down.
 *
 * A room is the obvious case. A `covered` outdoor space is a roof by definition
 * (`SCHEMA`, src/parse.ts), and a roof is the floor of whatever stands on it — a bedroom
 * over a porch is the commonest first floor there is. A `void` is a hole in *that*
 * level's slab, not in this one: by the INVARIANT on `isVoid` (src/types.ts) a declared
 * void has the building over it, which is why the wall beside a stairwell derives as a
 * partition, so the structure that surrounds it is still there to carry this floor.
 *
 * What is left out is open sky: the street, and an outdoor space with no roof.
 */
function supportOn(lower: LevelModel): Support[] {
  return [
    ...lower.rooms.map((r): Support => ({ kind: "room", id: r.room.id, name: r.room.name, shape: r.room })),
    ...lower.level.outdoor
      .filter((o) => o.covered)
      .map((o): Support => ({ kind: "outdoor", id: o.id, name: o.name, shape: o })),
    ...lower.level.voids.map((v): Support => ({ kind: "void", id: v.id, name: v.name, shape: v })),
  ];
}

const name = (byLevel: Map<string, LevelModel>, id: string) => byLevel.get(id)?.level.name ?? id;

const centre = (poly: Pt[]): Pt => {
  const b = bbox(poly);
  return [snap((b.x0 + b.x1) / 2), snap((b.y0 + b.y1) / 2)];
};

/** Which axis a flight runs along: 0 for x, 1 for y. `up` is a bearing, north-up. */
function flightAxis(up: number | undefined, poly: Pt[]): 0 | 1 {
  if (up !== undefined) return up < 45 || up >= 315 || (up >= 135 && up < 225) ? 1 : 0;
  const b = bbox(poly);
  return b.x1 - b.x0 >= b.y1 - b.y0 ? 0 : 1;
}

/**
 * How far along the flight, from its foot, the floor above is still closed.
 *
 * Walking up, your head is a headroom above the tread, so the slab has to be open by
 * the time the tread has risen to `height − HEADROOM_MIN`. This measures the run that is
 * still under slab: zero when a void covers the foot of the flight, the whole flight when
 * nothing above is opened at all — which is exactly the case that needs saying.
 */
function slabRun(footprint: Shape, voids: Shape[], axis: 0 | 1, up: number): number {
  const b = bbox(footprint.poly);
  const lo = axis === 0 ? b.x0 : b.y0;
  const hi = axis === 0 ? b.x1 : b.y1;
  // y grows south, so travelling north (bearing 0) or west (270) means decreasing coordinate
  const ascending = axis === 1 ? up >= 135 && up < 225 : up >= 45 && up < 135;
  const foot = ascending ? lo : hi;
  let open = hi - lo;
  for (const v of voids) {
    if (overlapArea(v, footprint) <= 0) continue;
    const vb = bbox(v.poly);
    const near = ascending ? Math.max(lo, axis === 0 ? vb.x0 : vb.y0) : Math.min(hi, axis === 0 ? vb.x1 : vb.y1);
    open = Math.min(open, Math.abs(near - foot));
  }
  return snap(open);
}

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.rule.localeCompare(b.rule));
}
