import { cellsToPolygons, normalizePoly, snap } from "./geometry.ts";
import type {
  Fixture,
  FixtureType,
  Jamb,
  Level,
  Opening,
  OpeningType,
  Outdoor,
  Plan,
  Pt,
  Room,
  RoomKind,
  Side,
  Vertical,
  VerticalAt,
  VerticalType,
  Void,
} from "./types.ts";
import { CIRCULATION_KINDS, GROUND_LEVEL, HABITABLE_KINDS, WET_KINDS } from "./types.ts";

/**
 * What kind of schema problem this is. The vocabulary is the one the existing messages
 * already fall into, and `lint()` turns each into a `schema.<kind>` finding — so an agent
 * that reads findings sees schema problems and geometry problems through one channel.
 *
 *  - `syntax`        the text is not JSON, or the document is not an object
 *  - `unknown_field` a key the schema does not have (checkKeys)
 *  - `missing`       a required thing is absent: geometry, an id, a room, a footprint
 *  - `type`          present but the wrong type, or outside a fixed vocabulary
 *  - `reference`     names something that is not declared: a space, a level, a side
 *  - `geometry`      a polygon or rectangle that cannot be a shape
 *  - `conflict`      two mutually exclusive forms, or an id used twice
 */
export type IssueKind = "syntax" | "unknown_field" | "missing" | "type" | "reference" | "geometry" | "conflict";

export interface PlanIssue {
  path: string;
  message: string;
  kind: IssueKind;
}

/** Report a problem. `type` is the default because "present but wrong" is the common case. */
type Bad = (path: string, message: string, kind?: IssueKind) => void;

export class PlanError extends Error {
  readonly issues: PlanIssue[];
  constructor(issues: PlanIssue[]) {
    super(`Invalid plan:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
    this.name = "PlanError";
    this.issues = issues;
  }
}

export const ROOM_KINDS: ReadonlySet<string> = new Set<RoomKind>([
  "bedroom",
  "living",
  "kitchen",
  "office",
  "bath",
  "wc",
  "hall",
  "corridor",
  "storage",
  "utility",
  "garage",
  "other",
]);
export const SIDES: ReadonlySet<string> = new Set<Side>(["north", "south", "east", "west"]);
export const OPENING_TYPES: ReadonlySet<string> = new Set<OpeningType>(["door", "window", "cased"]);
export const FIXTURE_TYPES: ReadonlySet<string> = new Set<FixtureType>([
  "pool",
  "bath",
  "shower",
  "wc",
  "sink",
  "counter",
  "island",
  "stairs",
  "other",
]);
export const VERTICAL_TYPES: ReadonlySet<string> = new Set<VerticalType>(["stairs", "lift", "ramp"]);
const ID_RE = /^[a-z][a-z0-9_]*$/;

/** the keys a level block may hold — also the keys a single-level document holds inline */
const LEVEL_CONTENT_KEYS = ["rooms", "outdoor", "voids", "layout", "openings", "fixtures"] as const;

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// A key starting with "_" or "x-" is a private note or authoring-tool annotation:
// always allowed, never reported as unknown. Documented in README's Plan format section.
const PRIVATE_KEY_RE = /^(_|x-)/;

/** Levenshtein edit distance (insert/delete/substitute), used for "did you mean" suggestions. */
function levenshtein(a: string, b: string): number {
  const dp: number[] = [];
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/**
 * Report, through `bad`, every key of `obj` that is not in `known`. Keys starting with
 * `_` or `x-` are exempt (see PRIVATE_KEY_RE). A key within edit distance 2 of exactly
 * one known key gets "did you mean"; otherwise the message lists every known key.
 */
function checkKeys(path: string, obj: J, known: readonly string[], bad: Bad): void {
  for (const key of Object.keys(obj)) {
    if (PRIVATE_KEY_RE.test(key) || known.includes(key)) continue;
    let best: string | undefined;
    let bestDist = Infinity;
    for (const k of known) {
      const d = levenshtein(key, k);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    const keyPath = path === "" ? key : `${path}.${key}`;
    bad(
      keyPath,
      best !== undefined && bestDist <= 2
        ? `unknown field ${JSON.stringify(key)}; did you mean ${JSON.stringify(best)}?`
        : `unknown field ${JSON.stringify(key)}; expected one of ${known.join(", ")}`,
      "unknown_field",
    );
  }
}

/**
 * Parse and normalise a plan document. Throws PlanError listing every schema
 * problem found. Geometry/topology problems are NOT raised here — they become
 * validator findings so the caller can still render a partial drawing.
 */
export function parse(input: unknown): Plan {
  const issues: PlanIssue[] = [];
  const bad: Bad = (path, message, kind = "type") => issues.push({ path, message, kind });
  const doc: J = isObj(input) ? input : {};
  if (!isObj(input)) bad("", "plan must be a JSON object", "syntax");
  if (typeof input === "string") {
    try {
      return parse(JSON.parse(input));
    } catch (e) {
      if (e instanceof PlanError) throw e;
      throw new PlanError([{ path: "", message: `not valid JSON: ${(e as Error).message}`, kind: "syntax" }]);
    }
  }

  const hasLevels = doc["levels"] !== undefined;
  checkKeys(
    "",
    doc,
    hasLevels
      ? ["title", "units", "walls", "north", "stack", "levels", "vertical", "grid"]
      : ["title", "units", "walls", "north", "stack", "levels", "vertical", "grid", ...LEVEL_CONTENT_KEYS],
    bad,
  );

  const title = typeof doc["title"] === "string" ? doc["title"] : undefined;
  if (doc["units"] !== undefined && doc["units"] !== "m") bad("units", 'only "m" is supported');
  const wallsIn = isObj(doc["walls"]) ? doc["walls"] : {};
  checkKeys("walls", wallsIn, ["exterior", "partition"], bad);
  const exterior = wallsIn["exterior"] ?? 0.3;
  const partition = wallsIn["partition"] ?? 0.12;
  if (!isNum(exterior) || exterior <= 0) bad("walls.exterior", "must be a positive number (metres)");
  if (!isNum(partition) || partition <= 0) bad("walls.partition", "must be a positive number (metres)");
  const north = doc["north"] ?? 0;
  if (!isNum(north)) bad("north", "must be degrees clockwise from up");

  // ---- the shared track grid: the one thing levels hold in common (§2.2.2) ----
  // It exists to make an upper floor's walls land on the lower floor's, which is what a
  // two-storey house needs and what no per-level grid can guarantee.
  let grid: { cols: number[]; rows: number[] } | undefined;
  if (doc["grid"] !== undefined) {
    const g = doc["grid"];
    if (!isObj(g)) bad("grid", "must be an object { cols, rows }");
    else {
      checkKeys("grid", g, ["cols", "rows"], bad);
      const cols = readTracks("grid.cols", g["cols"], bad);
      const rows = readTracks("grid.rows", g["rows"], bad);
      if (cols && rows) grid = { cols, rows };
    }
  }

  // ---- levels ----
  const levels: Level[] = [];
  if (!hasLevels) {
    // A document with no `levels` block is one level, normalised onto GROUND_LEVEL. It
    // keeps every document path it had — `rooms.sala.poly[2][0]`, never
    // `levels.ground.rooms…` — which is what makes every plan written before levels
    // existed lint, render, format and edit byte-identically.
    levels.push(parseLevelContent("", doc, GROUND_LEVEL, "Ground", undefined, true, grid, bad));
  } else {
    const levelsIn = doc["levels"];
    if (!isObj(levelsIn)) {
      bad("levels", "must be an object keyed by level id");
    } else {
      const ids = Object.keys(levelsIn);
      if (ids.length === 0) bad("levels", "a plan needs at least one level", "missing");
      for (const lid of ids) if (!ID_RE.test(lid)) bad(`levels.${lid}`, "id must match ^[a-z][a-z0-9_]*$");

      // `stack` is ground-up order and the only source of it. It is optional because the
      // document's own key order already says the same thing; when it is given it must
      // name every level exactly once, so a typo cannot silently reorder the building.
      let order = ids;
      if (doc["stack"] !== undefined) {
        const st = doc["stack"];
        if (!Array.isArray(st) || !st.every((v) => typeof v === "string")) {
          bad("stack", "must be an array of level ids, ground first");
        } else {
          const seen = new Set<string>();
          (st as string[]).forEach((v, i) => {
            if (!ids.includes(v)) bad(`stack[${i}]`, `unknown level ${JSON.stringify(v)}; expected one of ${ids.join(", ")}`, "reference");
            else if (seen.has(v)) bad(`stack[${i}]`, `level ${JSON.stringify(v)} is listed twice`, "conflict");
            seen.add(v);
          });
          for (const lid of ids) if (!seen.has(lid)) bad("stack", `level ${JSON.stringify(lid)} is not in the stack`, "missing");
          if (seen.size === ids.length && (st as string[]).length === ids.length) order = st as string[];
        }
      }

      // the street meets stack[0] unless a level says otherwise; a sloping site may
      // legitimately mark more than one
      const marked = order.filter((lid) => isObj(levelsIn[lid]) && (levelsIn[lid] as J)["ground"] === true);
      for (const lid of order) {
        const v = levelsIn[lid];
        if (!isObj(v)) {
          bad(`levels.${lid}`, "must be an object");
          continue;
        }
        const path = `levels.${lid}`;
        checkKeys(path, v, ["name", "height", "ground", ...LEVEL_CONTENT_KEYS], bad);
        const levelName = typeof v["name"] === "string" ? v["name"] : lid;
        let height: number | undefined;
        if (v["height"] !== undefined) {
          if (!isNum(v["height"]) || v["height"] <= 0) bad(`${path}.height`, "must be a positive number (metres, floor to floor)");
          else height = snap(v["height"] as number);
        }
        if (v["ground"] !== undefined && typeof v["ground"] !== "boolean") bad(`${path}.ground`, "must be boolean");
        const ground = marked.length > 0 ? v["ground"] === true : lid === order[0];
        levels.push(parseLevelContent(path, v, lid, levelName, height, ground, grid, bad));
      }
    }
  }

  // ---- vertical circulation: the only entity that spans levels (§2.2.3) ----
  const levelIds = levels.map((l) => l.id);
  const spacesOn = new Map(levels.map((l) => [l.id, new Set([...l.rooms.map((r) => r.id), ...l.outdoor.map((o) => o.id)])]));
  const vertical: Vertical[] = [];
  const verticalIn = doc["vertical"] ?? [];
  if (!Array.isArray(verticalIn) && doc["vertical"] !== undefined) bad("vertical", "must be an array");
  const verticalIds = new Set<string>();
  (Array.isArray(verticalIn) ? verticalIn : []).forEach((v: unknown, i: number) => {
    const path = `vertical[${i}]`;
    if (!isObj(v)) {
      bad(path, "must be an object");
      return;
    }
    checkKeys(path, v, ["id", "type", "name", "at", "up", "risers"], bad);
    const authored = Object.keys(v);
    const vid = v["id"];
    if (typeof vid !== "string" || !ID_RE.test(vid)) {
      bad(`${path}.id`, "a vertical element needs an id matching ^[a-z][a-z0-9_]*$; levels are joined by that id, never by footprint overlap", "missing");
      return;
    }
    if (verticalIds.has(vid)) bad(`${path}.id`, `id ${JSON.stringify(vid)} is already used by another vertical element`, "conflict");
    verticalIds.add(vid);
    const type = v["type"];
    if (!VERTICAL_TYPES.has(type as string)) bad(`${path}.type`, `must be one of ${[...VERTICAL_TYPES].join(", ")}`);
    const vName = typeof v["name"] === "string" ? v["name"] : String(type ?? vid).replace(/^./, (c) => c.toUpperCase());

    let up: number | undefined;
    if (v["up"] !== undefined) {
      if (!isNum(v["up"])) bad(`${path}.up`, "must be a bearing in degrees clockwise from north");
      else up = (((v["up"] as number) % 360) + 360) % 360;
    }
    let risers: number | undefined;
    if (v["risers"] !== undefined) {
      if (!isNum(v["risers"]) || !Number.isInteger(v["risers"]) || (v["risers"] as number) < 2)
        bad(`${path}.risers`, "must be a whole number of risers, at least 2");
      else risers = v["risers"] as number;
    }

    const atIn = v["at"];
    if (!Array.isArray(atIn) || atIn.length === 0) {
      bad(`${path}.at`, "must be a non-empty array of { level, in, rect | poly }, one per level it serves", "missing");
      return;
    }
    const at: VerticalAt[] = [];
    const seenLevels = new Set<string>();
    atIn.forEach((a: unknown, j: number) => {
      const ap = `${path}.at[${j}]`;
      if (!isObj(a)) {
        bad(ap, "must be an object { level, in, rect | poly }");
        return;
      }
      checkKeys(ap, a, ["level", "in", "poly", "rect"], bad);
      const lv = a["level"];
      if (typeof lv !== "string" || !levelIds.includes(lv)) {
        bad(`${ap}.level`, `must name a level; expected one of ${levelIds.join(", ")}`, "reference");
        return;
      }
      if (seenLevels.has(lv)) bad(`${ap}.level`, `level ${JSON.stringify(lv)} is already served by this element`, "conflict");
      seenLevels.add(lv);
      const host = a["in"];
      if (typeof host !== "string" || !spacesOn.get(lv)!.has(host)) {
        bad(`${ap}.in`, `must name a room or outdoor space on ${lv}; got ${JSON.stringify(host)}`, "reference");
        return;
      }
      const hasPoly = a["poly"] !== undefined;
      const hasRect = a["rect"] !== undefined;
      if (hasPoly && hasRect) {
        bad(ap, "has both a poly and a rect; use one", "conflict");
        return;
      }
      if (!hasPoly && !hasRect) {
        bad(ap, "has no footprint: give a poly or a rect", "missing");
        return;
      }
      const poly = hasPoly ? readPolyAt(`${ap}.poly`, a["poly"], bad) : readRectAt(`${ap}.rect`, a["rect"], bad);
      if (!poly) return;
      at.push({ path: ap, level: lv, in: host, poly });
    });
    if (!VERTICAL_TYPES.has(type as string)) return;
    // stack order, whatever order they were written in, so "consecutive" means what the
    // building means by it and `stair.misaligned` is well defined
    at.sort((p, q) => levelIds.indexOf(p.level) - levelIds.indexOf(q.level));
    vertical.push({ index: i, path, authored, id: vid, type: type as VerticalType, name: vName, at, up, risers });
  });

  if (levels.length > 0 && levels.every((l) => l.rooms.length === 0) && issues.length === 0)
    bad(hasLevels ? "levels" : "rooms", "a plan needs at least one room", "missing");
  if (issues.length) throw new PlanError(issues);

  const groundIndex = Math.max(0, levels.findIndex((l) => l.ground));
  const ground = levels[groundIndex]!;
  return {
    title,
    units: "m",
    walls: { exterior: snap(exterior as number), partition: snap(partition as number) },
    north: north as number,
    levelled: hasLevels,
    levels,
    vertical,
    grid,
    rooms: ground.rooms,
    outdoor: ground.outdoor,
    openings: ground.openings,
    fixtures: ground.fixtures,
  };
}

/**
 * An optional authored `id` on an opening or a fixture, validated and claimed.
 *
 * INVARIANT: an authored id matches ID_RE and therefore can never contain ":", while a
 * synthesised one always does — so the two namespaces cannot collide and adding an id to
 * one entity can never take the name another entity already answers to.
 */
function readId(path: string, v: J, taken: Set<string>, what: string, bad: Bad): string | undefined {
  const raw = v["id"];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !ID_RE.test(raw)) {
    bad(path, "id must match ^[a-z][a-z0-9_]*$");
    return undefined;
  }
  if (taken.has(raw)) {
    bad(path, `id ${JSON.stringify(raw)} is already used by another ${what} on this level`, "conflict");
    return undefined;
  }
  taken.add(raw);
  return raw;
}

/** `cols` / `rows`: a non-empty list of positive track sizes. */
function readTracks(path: string, v: unknown, bad: Bad): number[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || !v.every((n) => isNum(n) && n > 0)) {
    bad(path, "must be a non-empty array of positive track sizes (metres)");
    return undefined;
  }
  return v as number[];
}

function readPolyAt(path: string, v: unknown, bad: Bad): Pt[] | undefined {
  if (!Array.isArray(v) || !v.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))) {
    bad(path, "must be an array of [x, y] number pairs");
    return undefined;
  }
  const res = normalizePoly(v as Pt[]);
  if ("problem" in res) {
    const p = res.problem;
    bad(
      path,
      p.kind === "too_few_points"
        ? `needs at least 4 distinct corners, has ${p.count}`
        : p.kind === "not_rectilinear"
          ? `edge ${JSON.stringify(p.edge[0])}→${JSON.stringify(p.edge[1])} is not axis-aligned`
          : p.kind === "zero_area"
            ? "has zero area"
            : `edges ${p.edges[0]} and ${p.edges[1]} cross or overlap`,
      "geometry",
    );
    return undefined;
  }
  return res.poly;
}

/** `rect: [x, y, w, h]` — the same convenience a fixture spells `at` + `size`. */
function readRectAt(path: string, v: unknown, bad: Bad): Pt[] | undefined {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(isNum)) {
    bad(path, "must be [x, y, width, height] numbers");
    return undefined;
  }
  const [x, y, w, h] = v as [number, number, number, number];
  if (!(w > 0) || !(h > 0)) {
    bad(path, "width and height must both be > 0", "geometry");
    return undefined;
  }
  return [
    [snap(x), snap(y)],
    [snap(x + w), snap(y)],
    [snap(x + w), snap(y + h)],
    [snap(x), snap(y + h)],
  ];
}

/**
 * Everything that lives on one storey: rooms, outdoor spaces, voids, the optional track
 * grid, openings and fixtures. `base` is the document path this content sits at — `""`
 * for a single-level document and `levels.<id>` for a level — so an error message always
 * names the place in the document the author actually wrote.
 */
function parseLevelContent(
  base: string,
  src: J,
  id: string,
  name: string,
  height: number | undefined,
  ground: boolean,
  sharedGrid: { cols: number[]; rows: number[] } | undefined,
  bad: Bad,
): Level {
  const P = (s: string) => (base === "" ? s : `${base}.${s}`);
  // ids whose poly was supplied but rejected; readPoly already reported why
  const badPoly = new Set<string>();

  // ---- rooms, outdoor spaces & voids (declarations) ----
  const roomsIn = isObj(src["rooms"]) ? src["rooms"] : {};
  if (!isObj(src["rooms"])) bad(P("rooms"), "must be an object keyed by room id");
  const outdoorIn = isObj(src["outdoor"]) ? src["outdoor"] : {};
  if (src["outdoor"] !== undefined && !isObj(src["outdoor"])) bad(P("outdoor"), "must be an object keyed by id");
  const voidsIn = isObj(src["voids"]) ? src["voids"] : {};
  if (src["voids"] !== undefined && !isObj(src["voids"])) bad(P("voids"), "must be an object keyed by id");

  const polys = new Map<string, Pt[]>();
  /** which form a space's geometry was authored in, so later messages name what was written */
  const geometry = new Map<string, "poly" | "rect">();
  const readPoly = (path: string, v: unknown): Pt[] | undefined => readPolyAt(path, v, bad);

  /**
   * A space's geometry: an explicit `poly`, or a `rect` as a convenience rectangle —
   * one or the other, never both, exactly as a fixture takes `poly` or `at` + `size`.
   */
  const readGeometry = (path: string, key: string, v: J): void => {
    const hasPoly = v["poly"] !== undefined;
    const hasRect = v["rect"] !== undefined;
    if (hasPoly && hasRect) {
      bad(path, "has both a poly and a rect; use one", "conflict");
      badPoly.add(key);
      return;
    }
    if (!hasPoly && !hasRect) return;
    const p = hasPoly ? readPolyAt(`${path}.poly`, v["poly"], bad) : readRectAt(`${path}.rect`, v["rect"], bad);
    if (!p) {
      badPoly.add(key);
      return;
    }
    polys.set(key, p);
    geometry.set(key, hasPoly ? "poly" : "rect");
  };

  for (const [rid, v] of Object.entries(roomsIn)) {
    if (!ID_RE.test(rid)) bad(P(`rooms.${rid}`), "id must match ^[a-z][a-z0-9_]*$");
    if (!isObj(v)) {
      bad(P(`rooms.${rid}`), "must be an object");
      continue;
    }
    checkKeys(P(`rooms.${rid}`), v, ["poly", "rect", "kind", "name", "zone", "habitable", "wet", "circulation"], bad);
    readGeometry(P(`rooms.${rid}`), rid, v);
  }
  for (const [oid, v] of Object.entries(outdoorIn)) {
    if (!ID_RE.test(oid)) bad(P(`outdoor.${oid}`), "id must match ^[a-z][a-z0-9_]*$");
    if (oid in roomsIn) bad(P(`outdoor.${oid}`), "id also used as a room", "conflict");
    if (!isObj(v)) {
      bad(P(`outdoor.${oid}`), "must be an object");
      continue;
    }
    checkKeys(P(`outdoor.${oid}`), v, ["poly", "rect", "name", "covered"], bad);
    readGeometry(P(`outdoor.${oid}`), oid, v);
  }
  for (const [vid, v] of Object.entries(voidsIn)) {
    if (!ID_RE.test(vid)) bad(P(`voids.${vid}`), "id must match ^[a-z][a-z0-9_]*$");
    if (vid in roomsIn) bad(P(`voids.${vid}`), "id also used as a room", "conflict");
    if (vid in outdoorIn) bad(P(`voids.${vid}`), "id also used as an outdoor space", "conflict");
    if (!isObj(v)) {
      bad(P(`voids.${vid}`), "must be an object");
      continue;
    }
    checkKeys(P(`voids.${vid}`), v, ["poly", "rect", "name"], bad);
    readGeometry(P(`voids.${vid}`), vid, v);
  }

  // ---- optional track-grid layout, compiled to polygons ----
  // A level may author its own `layout` with its own tracks, or give only `areas` and sit
  // on the shared `grid` — which is what makes an upper floor's walls land on the lower
  // floor's. A level with neither simply has no grid.
  if (src["layout"] !== undefined) {
    compileLayout(base, src["layout"], sharedGrid, roomsIn, outdoorIn, voidsIn, polys, geometry, bad);
  }

  const rooms: Room[] = [];
  for (const [rid, v] of Object.entries(roomsIn)) {
    if (!isObj(v)) continue;
    const poly = polys.get(rid);
    if (!poly) {
      if (!badPoly.has(rid)) bad(P(`rooms.${rid}`), "has no geometry: give a poly or a rect, or place it in layout.areas", "missing");
      continue;
    }
    const kindRaw = v["kind"] ?? "other";
    const kind = (ROOM_KINDS.has(kindRaw as string) ? kindRaw : "other") as RoomKind;
    if (!ROOM_KINDS.has(kindRaw as string)) bad(P(`rooms.${rid}.kind`), `unknown kind ${JSON.stringify(kindRaw)}; one of ${[...ROOM_KINDS].join(", ")}`);
    const roomName = typeof v["name"] === "string" ? v["name"] : rid;
    const zone = typeof v["zone"] === "string" ? v["zone"] : undefined;
    const flag = (k: string, dflt: boolean) => {
      const f = v[k];
      if (f === undefined) return dflt;
      if (typeof f !== "boolean") bad(P(`rooms.${rid}.${k}`), "must be boolean");
      return f === true;
    };
    rooms.push({
      id: rid,
      path: P(`rooms.${rid}`),
      authored: Object.keys(v),
      name: roomName,
      kind,
      zone,
      poly,
      habitable: flag("habitable", HABITABLE_KINDS.has(kind)),
      wet: flag("wet", WET_KINDS.has(kind)),
      circulation: flag("circulation", CIRCULATION_KINDS.has(kind)),
    });
  }

  const outdoor: Outdoor[] = [];
  for (const [oid, v] of Object.entries(outdoorIn)) {
    if (!isObj(v)) continue;
    const poly = polys.get(oid);
    if (!poly) {
      if (!badPoly.has(oid)) bad(P(`outdoor.${oid}`), "has no geometry: give a poly or a rect, or place it in layout.areas", "missing");
      continue;
    }
    outdoor.push({
      id: oid,
      path: P(`outdoor.${oid}`),
      authored: Object.keys(v),
      name: typeof v["name"] === "string" ? v["name"] : oid,
      poly,
      covered: v["covered"] === true,
    });
  }

  const voids: Void[] = [];
  for (const [vid, v] of Object.entries(voidsIn)) {
    if (!isObj(v)) continue;
    const poly = polys.get(vid);
    if (!poly) {
      if (!badPoly.has(vid)) bad(P(`voids.${vid}`), "has no geometry: give a poly or a rect, or place it in layout.areas", "missing");
      continue;
    }
    voids.push({ id: vid, path: P(`voids.${vid}`), authored: Object.keys(v), name: typeof v["name"] === "string" ? v["name"] : vid, poly });
  }

  // ---- openings ----
  const openings: Opening[] = [];
  const openingsIn = src["openings"] ?? [];
  if (!Array.isArray(openingsIn)) bad(P("openings"), "must be an array");
  const roomIds = new Set(Object.keys(roomsIn));
  const spaceIds = new Set([...Object.keys(roomsIn), ...Object.keys(outdoorIn)]);
  // An opening may name a room, an outdoor space, or the street. "exterior" is the street
  // and only the street: a door onto a courtyard names the courtyard.
  const spaceRef = (path: string, v: unknown): string | undefined => {
    if (typeof v !== "string") {
      bad(path, 'must be a room id, an outdoor space id, or "exterior"');
      return undefined;
    }
    if (v in voidsIn) {
      bad(path, `${JSON.stringify(v)} is a void: there is no floor on its side of that wall, so nothing opens into it`, "reference");
      return undefined;
    }
    if (v !== "exterior" && !spaceIds.has(v)) {
      bad(path, `unknown space ${JSON.stringify(v)}; expected a room id, an outdoor space id, or "exterior"`, "reference");
      return undefined;
    }
    return v;
  };
  /**
   * Stable ids (docs/agent-review.md §B7). An authored `id` wins; otherwise the id is
   * `<type>:<a>-<b>:<n>` over the *sorted* pair, with `n` counting earlier openings of the
   * same type between the same pair. Deleting `openings[2]` therefore renumbers only its
   * own pair's later siblings — not, as an array index does, every opening after it.
   * `sequence` counts authored-id openings too, so giving one an id renames no other.
   */
  const openingIds = new Set<string>();
  const openingSeq = new Map<string, number>();
  (Array.isArray(openingsIn) ? openingsIn : []).forEach((o: unknown, i: number) => {
    const p = P(`openings[${i}]`);
    if (!isObj(o)) {
      bad(p, "must be an object");
      return;
    }
    checkKeys(p, o, ["id", "type", "between", "width", "position", "on", "at", "hinge", "swingInto", "entrance", "glazed"], bad);
    const type = o["type"];
    if (!OPENING_TYPES.has(type as string)) {
      bad(`${p}.type`, `must be one of door, window, cased`);
      return;
    }
    const bt = o["between"];
    if (!Array.isArray(bt) || bt.length !== 2) {
      bad(`${p}.between`, "must be [spaceA, spaceB]");
      return;
    }
    const a = spaceRef(`${p}.between[0]`, bt[0]);
    const b = spaceRef(`${p}.between[1]`, bt[1]);
    if (a === undefined || b === undefined) return;
    if (a === b) bad(`${p}.between`, "both ends name the same space", "conflict");
    // Two voids have no wall between them, so there is nothing for the opening to sit in.
    // A gate in a garden wall would need the wall to be modelled first; it is not.
    if (!roomIds.has(a) && !roomIds.has(b))
      bad(
        `${p}.between`,
        `an opening needs a room on at least one side; ${JSON.stringify(a)} and ${JSON.stringify(b)} are both outside, and nothing is built between two outdoor spaces`,
        "reference",
      );
    const width = o["width"];
    if (!isNum(width) || width <= 0) bad(`${p}.width`, "must be a positive number (metres)");

    // `at` is absolute placement: an alternative to `on` + `position`, mutually exclusive
    // with both, exactly as a room's `poly` and `rect` are one or the other.
    const hasAt = o["at"] !== undefined;
    const hasOn = o["on"] !== undefined;
    const hasPosition = o["position"] !== undefined;
    if (hasAt && (hasOn || hasPosition)) bad(p, 'has both "at" and "on"/"position"; use one', "conflict");

    let position: Opening["position"] = "center";
    let on: Opening["on"];
    let at: Opening["at"];
    if (hasAt) {
      const av = o["at"];
      if (Array.isArray(av) && av.length === 2 && isNum(av[0]) && isNum(av[1])) at = [snap(av[0]), snap(av[1])];
      else bad(`${p}.at`, "must be [x, y] numbers");
    } else {
      const pos = o["position"];
      if (pos === undefined || pos === "center") position = "center";
      else if (isNum(pos)) position = { from: "start", distance: snap(pos) };
      else if (isObj(pos)) {
        checkKeys(`${p}.position`, pos, ["from", "distance"], bad);
        if ((pos["from"] === "start" || pos["from"] === "end") && isNum(pos["distance"]) && pos["distance"] >= 0)
          position = { from: pos["from"] as Jamb, distance: snap(pos["distance"]) };
        else bad(`${p}.position`, '"center", a number (metres from start to centre) or { from: "start"|"end", distance }');
      } else bad(`${p}.position`, '"center", a number (metres from start to centre) or { from: "start"|"end", distance }');

      if (o["on"] !== undefined) {
        const s = o["on"];
        if (isObj(s)) checkKeys(`${p}.on`, s, ["room", "side", "near"], bad);
        if (!isObj(s) || typeof s["room"] !== "string" || (s["room"] !== a && s["room"] !== b) || s["room"] === "exterior")
          bad(`${p}.on.room`, "must name one of the spaces in `between`, and not \"exterior\"", "reference");
        else {
          const side = s["side"];
          if (side !== undefined && !SIDES.has(side as string)) bad(`${p}.on.side`, "north | south | east | west");
          const near = s["near"];
          if (near !== undefined && !(Array.isArray(near) && near.length === 2 && isNum(near[0]) && isNum(near[1])))
            bad(`${p}.on.near`, "must be [x, y]");
          on = {
            room: s["room"],
            side: SIDES.has(side as string) ? (side as Side) : undefined,
            near: Array.isArray(near) ? ([snap(near[0]), snap(near[1])] as Pt) : undefined,
          };
        }
      }
    }

    let hinge: Jamb = "start";
    // a leaf sweeps indoors by default: never out into the street, nor onto a terrace
    let swingInto = roomIds.has(b) ? b : a;
    let entrance = false;
    let glazed = false;
    if (type === "door") {
      if (o["hinge"] !== undefined) {
        if (o["hinge"] === "start" || o["hinge"] === "end") hinge = o["hinge"];
        else bad(`${p}.hinge`, '"start" | "end"');
      }
      if (o["swingInto"] !== undefined) {
        if (o["swingInto"] === a || o["swingInto"] === b) swingInto = o["swingInto"] as string;
        else bad(`${p}.swingInto`, "must be one of the spaces in `between`", "reference");
      }
      if (o["entrance"] !== undefined) {
        if (typeof o["entrance"] === "boolean") entrance = o["entrance"];
        else bad(`${p}.entrance`, "must be boolean");
      }
      if (o["glazed"] !== undefined) {
        if (typeof o["glazed"] === "boolean") glazed = o["glazed"];
        else bad(`${p}.glazed`, "must be boolean");
      }
    } else {
      for (const k of ["hinge", "swingInto", "entrance", "glazed"]) if (o[k] !== undefined) bad(`${p}.${k}`, `only valid on doors`, "conflict");
    }

    // sorted, so swapping `between` renames nothing: it is the same wall either way
    const key = `${type as string}:${[a, b].slice().sort().join("-")}`;
    const n = openingSeq.get(key) ?? 0;
    openingSeq.set(key, n + 1);
    openings.push({
      index: i,
      id: readId(`${p}.id`, o, openingIds, "opening", bad) ?? `${key}:${n}`,
      path: p,
      authored: Object.keys(o),
      type: type as OpeningType,
      between: [a, b],
      on,
      position,
      at,
      width: isNum(width) ? snap(width) : 0,
      hinge,
      swingInto,
      entrance,
      glazed,
    });
  });

  // ---- fixtures: things standing inside a room ----
  const fixtures: Fixture[] = [];
  const fixturesIn = src["fixtures"] ?? [];
  if (!Array.isArray(fixturesIn) && src["fixtures"] !== undefined) bad(P("fixtures"), "must be an array");
  /** same rule as openings: `<type>:<in>:<n>`, counted per type and host space */
  const fixtureIds = new Set<string>();
  const fixtureSeq = new Map<string, number>();
  (Array.isArray(fixturesIn) ? fixturesIn : []).forEach((v: unknown, i: number) => {
    const path = P(`fixtures[${i}]`);
    if (!isObj(v)) {
      bad(path, "must be an object");
      return;
    }
    checkKeys(path, v, ["id", "type", "in", "poly", "at", "size", "depth", "name"], bad);
    const type = v["type"];
    if (!FIXTURE_TYPES.has(type as string))
      bad(`${path}.type`, `must be one of ${[...FIXTURE_TYPES].join(", ")}`);
    const host = v["in"];
    if (typeof host !== "string" || !spaceIds.has(host))
      bad(`${path}.in`, `must name a room or outdoor space; got ${JSON.stringify(host)}`, "reference");

    // geometry: either an explicit poly, or at + size as a convenience rectangle
    const hasPoly = v["poly"] !== undefined;
    const hasRect = v["at"] !== undefined || v["size"] !== undefined;
    let poly: Pt[] | undefined;
    if (hasPoly && hasRect) bad(path, "has both a poly and at/size; use one", "conflict");
    else if (hasPoly) poly = readPoly(`${path}.poly`, v["poly"]);
    else if (hasRect) {
      const at = v["at"];
      const size = v["size"];
      const okAt = Array.isArray(at) && at.length === 2 && at.every((n) => typeof n === "number" && isFinite(n));
      const okSize = Array.isArray(size) && size.length === 2 && size.every((n) => typeof n === "number" && n > 0);
      if (!okAt) bad(`${path}.at`, "must be [x, y] numbers");
      if (!okSize) bad(`${path}.size`, "must be [width, height], both > 0");
      if (okAt && okSize) {
        const [x, y] = at as [number, number];
        const [w, h] = size as [number, number];
        poly = [
          [snap(x), snap(y)],
          [snap(x + w), snap(y)],
          [snap(x + w), snap(y + h)],
          [snap(x), snap(y + h)],
        ];
      }
    } else bad(path, "has no geometry: give a poly, or at and size", "missing");

    const depthRaw = v["depth"];
    let depth: number | undefined;
    if (depthRaw !== undefined) {
      if (typeof depthRaw !== "number" || !(depthRaw > 0)) bad(`${path}.depth`, "must be a number > 0");
      else depth = snap(depthRaw);
    }

    if (!poly || typeof host !== "string" || !spaceIds.has(host) || !FIXTURE_TYPES.has(type as string)) return;
    const fName = typeof v["name"] === "string" ? v["name"] : (type as string).replace(/^./, (c) => c.toUpperCase());
    const key = `${type as string}:${host}`;
    const n = fixtureSeq.get(key) ?? 0;
    fixtureSeq.set(key, n + 1);
    fixtures.push({
      index: i,
      id: readId(`${path}.id`, v, fixtureIds, "fixture", bad) ?? `${key}:${n}`,
      path,
      authored: Object.keys(v),
      type: type as FixtureType,
      name: fName,
      in: host,
      poly,
      depth,
      vertical: undefined,
    });
  });

  return { id, path: base, name, height, ground, rooms, outdoor, voids, openings, fixtures };
}

/**
 * layout: { cols: [w...], rows: [h...], areas: ["a b c", ...] | "a b c\n..." }
 * Each token is a room, outdoor or void id, or "." for a cell nothing claims. The same id
 * in several cells forms one rectilinear space; it must be a single connected piece
 * without holes.
 *
 * `cols` and `rows` may be omitted when the document declares a shared `grid`, and then
 * the level supplies only `areas` — which is the mechanism that makes an upper floor's
 * walls land on the lower floor's (§2.2.2).
 */
function compileLayout(
  base: string,
  layout: unknown,
  sharedGrid: { cols: number[]; rows: number[] } | undefined,
  roomsIn: J,
  outdoorIn: J,
  voidsIn: J,
  polys: Map<string, Pt[]>,
  geometry: Map<string, "poly" | "rect">,
  bad: Bad,
): void {
  const P = (s: string) => (base === "" ? s : `${base}.${s}`);
  if (!isObj(layout)) {
    bad(P("layout"), "must be an object { cols, rows, areas }");
    return;
  }
  checkKeys(P("layout"), layout, ["cols", "rows", "areas"], bad);
  const tracks = (k: "cols" | "rows"): number[] | undefined => {
    if (layout[k] === undefined && sharedGrid) return sharedGrid[k];
    const v = layout[k];
    if (!Array.isArray(v) || v.length === 0 || !v.every((n) => isNum(n) && n > 0)) {
      bad(
        P(`layout.${k}`),
        "must be a non-empty array of positive track sizes (metres), or be left out so the level sits on the shared grid",
      );
      return undefined;
    }
    return v as number[];
  };
  const cols = tracks("cols");
  const rows = tracks("rows");
  let areasRaw = layout["areas"];
  if (typeof areasRaw === "string") areasRaw = areasRaw.split("\n").filter((l) => l.trim() !== "");
  if (!Array.isArray(areasRaw) || !areasRaw.every((r) => typeof r === "string")) {
    bad(P("layout.areas"), "must be an array of strings (one per row) or one multi-line string");
    return;
  }
  if (!cols || !rows) return;
  const grid = (areasRaw as string[]).map((r) => r.trim().split(/\s+/));
  if (grid.length !== rows.length) {
    bad(P("layout.areas"), `has ${grid.length} rows but ${layout["rows"] === undefined ? "grid.rows" : "layout.rows"} has ${rows.length}`, "geometry");
    return;
  }
  let ok = true;
  grid.forEach((r, j) => {
    if (r.length !== cols.length) {
      bad(P(`layout.areas[${j}]`), `has ${r.length} cells but ${layout["cols"] === undefined ? "grid.cols" : "layout.cols"} has ${cols.length}`, "geometry");
      ok = false;
    }
  });
  if (!ok) return;

  const xs = [0];
  for (const w of cols) xs.push(snap(xs[xs.length - 1]! + w));
  const ys = [0];
  for (const h of rows) ys.push(snap(ys[ys.length - 1]! + h));

  const cellsById = new Map<string, Array<[number, number]>>();
  grid.forEach((r, j) =>
    r.forEach((tok, i) => {
      if (tok === ".") return;
      if (!(tok in roomsIn) && !(tok in outdoorIn) && !(tok in voidsIn)) {
        bad(P(`layout.areas[${j}]`), `cell ${i} names ${JSON.stringify(tok)}, which is not declared in rooms, outdoor or voids`, "reference");
        return;
      }
      const list = cellsById.get(tok) ?? [];
      list.push([i, j]);
      cellsById.set(tok, list);
    }),
  );
  for (const [id, cells] of cellsById) {
    const path = P(`${id in roomsIn ? "rooms" : id in outdoorIn ? "outdoor" : "voids"}.${id}`);
    if (polys.has(id)) {
      bad(path, `has both a ${geometry.get(id) ?? "poly"} and cells in layout.areas; use one`, "conflict");
      continue;
    }
    const loops = cellsToPolygons(cells, xs, ys);
    if (loops.length !== 1) {
      bad(path, `cells in layout.areas form ${loops.length} pieces; a space must be one connected shape without holes`, "geometry");
      continue;
    }
    polys.set(id, loops[0]!);
  }
}
