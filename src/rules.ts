import { doorSwing } from "./doors.ts";
import { boxGap, snap } from "./geometry.ts";
import type { Finding, Model, ResolvedOpening, RoomKind } from "./types.ts";

export interface RuleOptions {
  /** share of interior area above which circulation is flagged (default 0.10) */
  circulationShare?: number;
  /** comfort minimum for the short side of a room's largest clear rectangle, per kind (metres) */
  minDimension?: Partial<Record<RoomKind, number>>;
  /** minimum door widths (metres) */
  doorMinWidth?: { interior?: number; entrance?: number };
  /** walkable gap required between two fixtures in the same room (default 0.6 m) */
  minClearance?: number;
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

/**
 * Semantic rules over the derived model. Geometry/topology errors are already
 * produced by derive(); these are the "is this a good house" checks.
 */
export function checkRules(model: Model, opts: RuleOptions = {}): Finding[] {
  const f: Finding[] = [];
  const rooms = model.rooms;
  const byId = new Map(rooms.map((m) => [m.room.id, m]));
  const kindOf = (id: string): RoomKind | undefined => byId.get(id)?.room.kind;
  const nameOf = (id: string) => byId.get(id)?.room.name ?? id;
  const doors = model.openings.filter((o) => o.spec.type === "door");
  const otherSide = (o: ResolvedOpening, id: string) => (o.wall.neg === id ? o.wall.pos : o.wall.neg);

  // ---- entrance ----
  const exteriorDoors = doors.filter((o) => o.wall.kind === "exterior");
  const hasEntrance = exteriorDoors.length > 0;
  if (!hasEntrance) {
    f.push({ rule: "entrance.missing", severity: "error", message: "no door leads outside; the house cannot be entered" });
  } else if (exteriorDoors.length > 1) {
    f.push({
      rule: "entrance.multiple",
      severity: "info",
      message: `${exteriorDoors.length} doors lead outside (${exteriorDoors.map((o) => nameOf(otherSide(o, "exterior"))).join(", ")}); mark the main one with "entrance": true`,
    });
  }

  // ---- access & reachability ----
  const noAccess = new Set<string>();
  for (const m of rooms) {
    if ((model.access.get(m.room.id)?.size ?? 0) === 0) {
      noAccess.add(m.room.id);
      f.push({
        rule: "space.no_access",
        severity: "error",
        message: `${m.room.name} has no door or cased opening`,
        rooms: [m.room.id],
        at: m.labelAt,
      });
    }
  }
  if (hasEntrance) {
    const seen = new Set<string>(["exterior"]);
    const queue = ["exterior"];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of model.access.get(cur) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    }
    for (const m of rooms) {
      if (!seen.has(m.room.id) && !noAccess.has(m.room.id)) {
        f.push({
          rule: "reach.unreachable",
          severity: "error",
          message: `${m.room.name} cannot be reached from the entrance`,
          rooms: [m.room.id],
          at: m.labelAt,
        });
      }
    }
  }

  // ---- light ----
  for (const m of rooms) {
    if (m.exteriorWindow) continue;
    if (m.room.habitable) {
      f.push({
        rule: "habitable.no_window",
        severity: "warning",
        message: `${m.room.name} is habitable but has no exterior window${m.exteriorFaces.length ? ` (it has an exterior wall on the ${m.exteriorFaces.join("/")})` : " and no exterior wall to put one on"}`,
        rooms: [m.room.id],
        at: m.labelAt,
      });
    } else if (m.room.wet) {
      f.push({
        rule: "wet.no_window",
        severity: "warning",
        message: `${m.room.name} has no exterior window; plan mechanical extraction`,
        rooms: [m.room.id],
        at: m.labelAt,
      });
    }
  }

  // ---- adjacency semantics ----
  for (const o of doors) {
    const [a, b] = [o.wall.neg, o.wall.pos];
    const ka = kindOf(a);
    const kb = kindOf(b);
    const wetToKitchen = (byId.get(a)?.room.wet && kb === "kitchen") || (byId.get(b)?.room.wet && ka === "kitchen");
    if (wetToKitchen) {
      f.push({
        rule: "wet.opens_to_kitchen",
        severity: "warning",
        message: `${nameOf(a)} opens directly into ${nameOf(b)}; most codes want a lobby between a WC and a kitchen`,
        rooms: [a, b],
        at: o.center,
        opening: o.spec.index,
      });
    }
    if (ka === "bedroom" && kb === "bedroom") {
      f.push({
        rule: "privacy.bedroom_through_route",
        severity: "warning",
        message: `${nameOf(a)} and ${nameOf(b)} connect directly; one bedroom is a route to the other`,
        rooms: [a, b],
        at: o.center,
        opening: o.spec.index,
      });
    }
    const living = new Set<RoomKind>(["living", "kitchen"]);
    if ((ka === "bedroom" && kb && living.has(kb)) || (kb === "bedroom" && ka && living.has(ka))) {
      f.push({
        rule: "privacy.bedroom_off_living",
        severity: "info",
        message: `${ka === "bedroom" ? nameOf(a) : nameOf(b)} opens directly off ${ka === "bedroom" ? nameOf(b) : nameOf(a)}`,
        rooms: [a, b],
        at: o.center,
        opening: o.spec.index,
      });
    }
  }

  // ---- sizes ----
  const minDim = { ...DEFAULT_MIN_DIM, ...opts.minDimension };
  for (const m of rooms) {
    const min = minDim[m.room.kind];
    if (min === undefined || m.minDimension >= min) continue;
    const r = m.clearRect;
    f.push({
      rule: "room.min_dimension",
      severity: "warning",
      message: `${m.room.name} (${m.room.kind}): ${m.minDimension} m at its narrowest; comfort minimum is ${min} m (clear floor ${r.w} × ${r.h} m)`,
      rooms: [m.room.id],
      at: m.labelAt,
    });
  }
  const dmw = { interior: 0.7, entrance: 0.9, ...opts.doorMinWidth };
  for (const o of doors) {
    const ext = o.wall.kind === "exterior";
    const min = ext ? dmw.entrance : dmw.interior;
    if (o.spec.width < min) {
      f.push({
        rule: "door.min_width",
        severity: "warning",
        message: `door #${o.spec.index} (${o.spec.width} m) between ${nameOf(o.wall.neg)} and ${nameOf(o.wall.pos)} is narrower than ${min} m`,
        at: o.center,
        opening: o.spec.index,
      });
    }
  }

  // ---- circulation ----
  const circ = rooms.filter((m) => m.room.circulation);
  const circArea = circ.reduce((s, m) => s + m.area, 0);
  const share = model.interiorArea > 0 ? circArea / model.interiorArea : 0;
  const maxShare = opts.circulationShare ?? 0.1;
  if (share > maxShare) {
    f.push({
      rule: "circulation.share",
      severity: "info",
      message: `${circ.map((m) => m.room.name).join(" + ")} take ${Math.round(share * 100)} % of the interior (${snap(circArea)} m²); above ${Math.round(maxShare * 100)} % is worth questioning`,
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
        f.push({
          rule: "door.swing_collision",
          severity: "info",
          message: `doors #${a.o.spec.index} and #${b.o.spec.index} swing into the same corner of ${nameOf(a.o.swingRoom as string)}`,
          rooms: [a.o.swingRoom as string],
          at: a.s!.hinge,
        });
      }
    }
  }

  // ---- fixtures ----
  const minClearance = opts.minClearance ?? 0.6;
  for (let i = 0; i < model.fixtures.length; i++) {
    for (let j = i + 1; j < model.fixtures.length; j++) {
      const a = model.fixtures[i]!;
      const b = model.fixtures[j]!;
      if (a.fixture.in !== b.fixture.in) continue;
      const gap = snap(boxGap(a.bbox, b.bbox));
      // touching units are one run; only a gap too narrow to walk through is a problem
      if (gap <= 0 || gap >= minClearance) continue;
      f.push({
        rule: "fixture.clearance",
        severity: "warning",
        message: `only ${gap} m between ${a.fixture.name} and ${b.fixture.name} in ${nameOf(a.fixture.in)}; leave ≥ ${minClearance} m to walk through`,
        at: [snap((a.bbox.x1 + b.bbox.x0) / 2), snap((a.bbox.y0 + b.bbox.y1) / 2)],
        rooms: [a.fixture.in],
        fixture: a.fixture.index,
      });
    }
  }

  for (const o of doors) {
    const swing = doorSwing(o);
    if (!swing || o.swingRoom === undefined) continue;
    const radius = o.to - o.from;
    for (const fm of model.fixtures) {
      if (fm.fixture.in !== o.swingRoom) continue;
      // the swept quarter disc is exactly {within radius of the hinge} ∩ swing.box,
      // so the nearest point of the overlap rectangle decides it
      const x0 = Math.max(swing.box.x0, fm.bbox.x0);
      const x1 = Math.min(swing.box.x1, fm.bbox.x1);
      const y0 = Math.max(swing.box.y0, fm.bbox.y0);
      const y1 = Math.min(swing.box.y1, fm.bbox.y1);
      if (x0 >= x1 || y0 >= y1) continue;
      const nx = Math.min(Math.max(swing.hinge[0], x0), x1);
      const ny = Math.min(Math.max(swing.hinge[1], y0), y1);
      if (Math.hypot(nx - swing.hinge[0], ny - swing.hinge[1]) >= radius) continue;
      f.push({
        rule: "door.swing_hits_fixture",
        severity: "warning",
        message: `door #${o.spec.index} swings into ${fm.fixture.name} in ${nameOf(fm.fixture.in)}; rehang it or move the fixture`,
        at: swing.hinge,
        rooms: [fm.fixture.in],
        opening: o.spec.index,
        fixture: fm.fixture.index,
      });
    }
  }

  return f;
}

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.rule.localeCompare(b.rule));
}
