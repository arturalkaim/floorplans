import { cellsToPolygons, normalizePoly, snap } from "./geometry.ts";
import type { Fixture, FixtureType, Jamb, Opening, OpeningType, Outdoor, Plan, Pt, Room, RoomKind, Side } from "./types.ts";
import { CIRCULATION_KINDS, HABITABLE_KINDS, WET_KINDS } from "./types.ts";

export interface PlanIssue {
  path: string;
  message: string;
}

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
const ID_RE = /^[a-z][a-z0-9_]*$/;

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
function checkKeys(path: string, obj: J, known: readonly string[], bad: (path: string, message: string) => void): void {
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
  const bad = (path: string, message: string) => issues.push({ path, message });
  // ids whose poly was supplied but rejected; readPoly already reported why
  const badPoly = new Set<string>();

  const doc: J = isObj(input) ? input : {};
  if (!isObj(input)) bad("", "plan must be a JSON object");
  if (typeof input === "string") {
    try {
      return parse(JSON.parse(input));
    } catch (e) {
      if (e instanceof PlanError) throw e;
      throw new PlanError([{ path: "", message: `not valid JSON: ${(e as Error).message}` }]);
    }
  }

  checkKeys("", doc, ["title", "units", "walls", "north", "rooms", "outdoor", "layout", "openings", "fixtures"], bad);

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

  // ---- rooms & outdoor (declarations) ----
  const roomsIn = isObj(doc["rooms"]) ? doc["rooms"] : {};
  if (!isObj(doc["rooms"])) bad("rooms", "must be an object keyed by room id");
  const outdoorIn = isObj(doc["outdoor"]) ? doc["outdoor"] : {};
  if (doc["outdoor"] !== undefined && !isObj(doc["outdoor"])) bad("outdoor", "must be an object keyed by id");

  const polys = new Map<string, Pt[]>();
  /** which form a space's geometry was authored in, so later messages name what was written */
  const geometry = new Map<string, "poly" | "rect">();
  const readPoly = (path: string, v: unknown): Pt[] | undefined => {
    if (!Array.isArray(v) || !v.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))) {
      bad(path, "must be an array of [x, y] number pairs");
      return undefined;
    }
    const res = normalizePoly(v as Pt[]);
    if ("problem" in res) {
      const p = res.problem;
      const msg =
        p.kind === "too_few_points"
          ? `needs at least 4 distinct corners, has ${p.count}`
          : p.kind === "not_rectilinear"
            ? `edge ${JSON.stringify(p.edge[0])}→${JSON.stringify(p.edge[1])} is not axis-aligned`
            : p.kind === "zero_area"
              ? "has zero area"
              : `edges ${p.edges[0]} and ${p.edges[1]} cross or overlap`;
      bad(path, msg);
      return undefined;
    }
    return res.poly;
  };

  /** `rect: [x, y, w, h]` — the same convenience a fixture spells `at` + `size`. */
  const readRect = (path: string, v: unknown): Pt[] | undefined => {
    if (!Array.isArray(v) || v.length !== 4 || !v.every(isNum)) {
      bad(path, "must be [x, y, width, height] numbers");
      return undefined;
    }
    const [x, y, w, h] = v as [number, number, number, number];
    if (!(w > 0) || !(h > 0)) {
      bad(path, "width and height must both be > 0");
      return undefined;
    }
    return [
      [snap(x), snap(y)],
      [snap(x + w), snap(y)],
      [snap(x + w), snap(y + h)],
      [snap(x), snap(y + h)],
    ];
  };

  /**
   * A space's geometry: an explicit `poly`, or a `rect` as a convenience rectangle —
   * one or the other, never both, exactly as a fixture takes `poly` or `at` + `size`.
   */
  const readGeometry = (path: string, id: string, v: J): void => {
    const hasPoly = v["poly"] !== undefined;
    const hasRect = v["rect"] !== undefined;
    if (hasPoly && hasRect) {
      bad(path, "has both a poly and a rect; use one");
      badPoly.add(id);
      return;
    }
    if (!hasPoly && !hasRect) return;
    const p = hasPoly ? readPoly(`${path}.poly`, v["poly"]) : readRect(`${path}.rect`, v["rect"]);
    if (!p) {
      badPoly.add(id);
      return;
    }
    polys.set(id, p);
    geometry.set(id, hasPoly ? "poly" : "rect");
  };

  for (const [id, v] of Object.entries(roomsIn)) {
    if (!ID_RE.test(id)) bad(`rooms.${id}`, "id must match ^[a-z][a-z0-9_]*$");
    if (id === "exterior" || id === "gap") bad(`rooms.${id}`, "reserved id");
    if (!isObj(v)) {
      bad(`rooms.${id}`, "must be an object");
      continue;
    }
    checkKeys(`rooms.${id}`, v, ["poly", "rect", "kind", "name", "zone", "habitable", "wet", "circulation"], bad);
    readGeometry(`rooms.${id}`, id, v);
  }
  for (const [id, v] of Object.entries(outdoorIn)) {
    if (!ID_RE.test(id)) bad(`outdoor.${id}`, "id must match ^[a-z][a-z0-9_]*$");
    if (id in roomsIn) bad(`outdoor.${id}`, "id also used as a room");
    if (!isObj(v)) {
      bad(`outdoor.${id}`, "must be an object");
      continue;
    }
    checkKeys(`outdoor.${id}`, v, ["poly", "rect", "name", "covered"], bad);
    readGeometry(`outdoor.${id}`, id, v);
  }

  // ---- optional track-grid layout, compiled to polygons ----
  if (doc["layout"] !== undefined) {
    compileLayout(doc["layout"], roomsIn, outdoorIn, polys, geometry, bad);
  }

  const rooms: Room[] = [];
  for (const [id, v] of Object.entries(roomsIn)) {
    if (!isObj(v)) continue;
    const poly = polys.get(id);
    if (!poly) {
      if (!badPoly.has(id)) bad(`rooms.${id}`, "has no geometry: give a poly or a rect, or place it in layout.areas");
      continue;
    }
    const kindRaw = v["kind"] ?? "other";
    const kind = (ROOM_KINDS.has(kindRaw as string) ? kindRaw : "other") as RoomKind;
    if (!ROOM_KINDS.has(kindRaw as string)) bad(`rooms.${id}.kind`, `unknown kind ${JSON.stringify(kindRaw)}; one of ${[...ROOM_KINDS].join(", ")}`);
    const name = typeof v["name"] === "string" ? v["name"] : id;
    const zone = typeof v["zone"] === "string" ? v["zone"] : undefined;
    const flag = (k: string, dflt: boolean) => {
      const f = v[k];
      if (f === undefined) return dflt;
      if (typeof f !== "boolean") bad(`rooms.${id}.${k}`, "must be boolean");
      return f === true;
    };
    rooms.push({
      id,
      name,
      kind,
      zone,
      poly,
      habitable: flag("habitable", HABITABLE_KINDS.has(kind)),
      wet: flag("wet", WET_KINDS.has(kind)),
      circulation: flag("circulation", CIRCULATION_KINDS.has(kind)),
    });
  }

  const outdoor: Outdoor[] = [];
  for (const [id, v] of Object.entries(outdoorIn)) {
    if (!isObj(v)) continue;
    const poly = polys.get(id);
    if (!poly) {
      if (!badPoly.has(id)) bad(`outdoor.${id}`, "has no geometry: give a poly or a rect, or place it in layout.areas");
      continue;
    }
    outdoor.push({ id, name: typeof v["name"] === "string" ? v["name"] : id, poly, covered: v["covered"] === true });
  }

  // ---- openings ----
  const openings: Opening[] = [];
  const openingsIn = doc["openings"] ?? [];
  if (!Array.isArray(openingsIn)) bad("openings", "must be an array");
  const roomIds = new Set(Object.keys(roomsIn));
  const spaceIds = new Set([...Object.keys(roomsIn), ...Object.keys(outdoorIn)]);
  const spaceRef = (path: string, v: unknown): string | undefined => {
    if (typeof v !== "string") {
      bad(path, "must be a room id or \"exterior\"");
      return undefined;
    }
    if (v !== "exterior" && !roomIds.has(v)) {
      if (spaceIds.has(v))
        bad(path, `${JSON.stringify(v)} is an outdoor space; an opening onto it is written between the room and "exterior"`);
      else bad(path, `unknown room ${JSON.stringify(v)}`);
      return undefined;
    }
    return v;
  };
  (Array.isArray(openingsIn) ? openingsIn : []).forEach((o: unknown, i: number) => {
    const p = `openings[${i}]`;
    if (!isObj(o)) {
      bad(p, "must be an object");
      return;
    }
    checkKeys(p, o, ["type", "between", "width", "position", "on", "hinge", "swingInto", "entrance"], bad);
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
    if (a === b) bad(`${p}.between`, "both ends name the same space");
    if (a === "exterior" && b === "exterior") bad(`${p}.between`, "an opening needs at least one room");
    const width = o["width"];
    if (!isNum(width) || width <= 0) bad(`${p}.width`, "must be a positive number (metres)");

    let position: Opening["position"] = "center";
    const pos = o["position"];
    if (pos === undefined || pos === "center") position = "center";
    else if (isNum(pos)) position = { from: "start", distance: snap(pos) };
    else if (isObj(pos)) {
      checkKeys(`${p}.position`, pos, ["from", "distance"], bad);
      if ((pos["from"] === "start" || pos["from"] === "end") && isNum(pos["distance"]) && pos["distance"] >= 0)
        position = { from: pos["from"] as Jamb, distance: snap(pos["distance"]) };
      else bad(`${p}.position`, '"center", a number (metres from start to centre) or { from: "start"|"end", distance }');
    } else bad(`${p}.position`, '"center", a number (metres from start to centre) or { from: "start"|"end", distance }');

    let on: Opening["on"];
    if (o["on"] !== undefined) {
      const s = o["on"];
      if (isObj(s)) checkKeys(`${p}.on`, s, ["room", "side", "near"], bad);
      if (!isObj(s) || typeof s["room"] !== "string" || (s["room"] !== a && s["room"] !== b) || s["room"] === "exterior")
        bad(`${p}.on.room`, "must name one of the rooms in `between`");
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

    let hinge: Jamb = "start";
    let swingInto = b === "exterior" ? a : b;
    let entrance = false;
    if (type === "door") {
      if (o["hinge"] !== undefined) {
        if (o["hinge"] === "start" || o["hinge"] === "end") hinge = o["hinge"];
        else bad(`${p}.hinge`, '"start" | "end"');
      }
      if (o["swingInto"] !== undefined) {
        if (o["swingInto"] === a || o["swingInto"] === b) swingInto = o["swingInto"] as string;
        else bad(`${p}.swingInto`, "must be one of the spaces in `between`");
      }
      if (o["entrance"] !== undefined) {
        if (typeof o["entrance"] === "boolean") entrance = o["entrance"];
        else bad(`${p}.entrance`, "must be boolean");
      }
    } else {
      for (const k of ["hinge", "swingInto", "entrance"]) if (o[k] !== undefined) bad(`${p}.${k}`, `only valid on doors`);
    }

    openings.push({
      index: i,
      type: type as OpeningType,
      between: [a, b],
      on,
      position,
      width: isNum(width) ? snap(width) : 0,
      hinge,
      swingInto,
      entrance,
    });
  });

  // ---- fixtures: things standing inside a room ----
  const fixtures: Fixture[] = [];
  const fixturesIn = doc["fixtures"] ?? [];
  if (!Array.isArray(fixturesIn) && doc["fixtures"] !== undefined) bad("fixtures", "must be an array");
  (Array.isArray(fixturesIn) ? fixturesIn : []).forEach((v: unknown, i: number) => {
    const path = `fixtures[${i}]`;
    if (!isObj(v)) {
      bad(path, "must be an object");
      return;
    }
    checkKeys(path, v, ["type", "in", "poly", "at", "size", "depth", "name"], bad);
    const type = v["type"];
    if (!FIXTURE_TYPES.has(type as string))
      bad(`${path}.type`, `must be one of ${[...FIXTURE_TYPES].join(", ")}`);
    const host = v["in"];
    if (typeof host !== "string" || !spaceIds.has(host))
      bad(`${path}.in`, `must name a room or outdoor space; got ${JSON.stringify(host)}`);

    // geometry: either an explicit poly, or at + size as a convenience rectangle
    const hasPoly = v["poly"] !== undefined;
    const hasRect = v["at"] !== undefined || v["size"] !== undefined;
    let poly: Pt[] | undefined;
    if (hasPoly && hasRect) bad(path, "has both a poly and at/size; use one");
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
    } else bad(path, "has no geometry: give a poly, or at and size");

    const depthRaw = v["depth"];
    let depth: number | undefined;
    if (depthRaw !== undefined) {
      if (typeof depthRaw !== "number" || !(depthRaw > 0)) bad(`${path}.depth`, "must be a number > 0");
      else depth = snap(depthRaw);
    }

    if (!poly || typeof host !== "string" || !spaceIds.has(host) || !FIXTURE_TYPES.has(type as string)) return;
    const name = typeof v["name"] === "string" ? v["name"] : (type as string).replace(/^./, (c) => c.toUpperCase());
    fixtures.push({ index: i, type: type as FixtureType, name, in: host, poly, depth });
  });

  if (rooms.length === 0 && issues.length === 0) bad("rooms", "a plan needs at least one room");
  if (issues.length) throw new PlanError(issues);

  return {
    title,
    units: "m",
    walls: { exterior: snap(exterior as number), partition: snap(partition as number) },
    north: north as number,
    rooms,
    outdoor,
    openings,
    fixtures,
  };
}

/**
 * layout: { cols: [w...], rows: [h...], areas: ["a b c", ...] | "a b c\n..." }
 * Each token is a room/outdoor id or "." for void. Same id in several cells
 * forms one rectilinear room; it must be a single connected piece without holes.
 */
function compileLayout(
  layout: unknown,
  roomsIn: J,
  outdoorIn: J,
  polys: Map<string, Pt[]>,
  geometry: Map<string, "poly" | "rect">,
  bad: (path: string, message: string) => void,
): void {
  if (!isObj(layout)) {
    bad("layout", "must be an object { cols, rows, areas }");
    return;
  }
  checkKeys("layout", layout, ["cols", "rows", "areas"], bad);
  const tracks = (k: string): number[] | undefined => {
    const v = layout[k];
    if (!Array.isArray(v) || v.length === 0 || !v.every((n) => isNum(n) && n > 0)) {
      bad(`layout.${k}`, "must be a non-empty array of positive track sizes (metres)");
      return undefined;
    }
    return v as number[];
  };
  const cols = tracks("cols");
  const rows = tracks("rows");
  let areasRaw = layout["areas"];
  if (typeof areasRaw === "string") areasRaw = areasRaw.split("\n").filter((l) => l.trim() !== "");
  if (!Array.isArray(areasRaw) || !areasRaw.every((r) => typeof r === "string")) {
    bad("layout.areas", "must be an array of strings (one per row) or one multi-line string");
    return;
  }
  if (!cols || !rows) return;
  const grid = (areasRaw as string[]).map((r) => r.trim().split(/\s+/));
  if (grid.length !== rows.length) {
    bad("layout.areas", `has ${grid.length} rows but layout.rows has ${rows.length}`);
    return;
  }
  let ok = true;
  grid.forEach((r, j) => {
    if (r.length !== cols.length) {
      bad(`layout.areas[${j}]`, `has ${r.length} cells but layout.cols has ${cols.length}`);
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
      if (!(tok in roomsIn) && !(tok in outdoorIn)) {
        bad(`layout.areas[${j}]`, `cell ${i} names ${JSON.stringify(tok)}, which is not declared in rooms or outdoor`);
        return;
      }
      const list = cellsById.get(tok) ?? [];
      list.push([i, j]);
      cellsById.set(tok, list);
    }),
  );
  for (const [id, cells] of cellsById) {
    const path = `${id in roomsIn ? "rooms" : "outdoor"}.${id}`;
    if (polys.has(id)) {
      bad(path, `has both a ${geometry.get(id) ?? "poly"} and cells in layout.areas; use one`);
      continue;
    }
    const loops = cellsToPolygons(cells, xs, ys);
    if (loops.length !== 1) {
      bad(path, `cells in layout.areas form ${loops.length} pieces; a space must be one connected shape without holes`);
      continue;
    }
    polys.set(id, loops[0]!);
  }
}
