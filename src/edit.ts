// Editing support: which walls a drawing can offer to drag, and what moving one writes
// back to the source. The document is the single source of truth, so an edit is always
// expressed as a splice into its text, never as a mutation of the derived model.
import { pointOnShapeBoundary } from "./derive.ts";
import { metres, spliceAll } from "./jsonpos.ts";
import type { JsonPath } from "./jsonpos.ts";
import { dslSpliceAll, isDslText, readSource } from "./dsl.ts";
import { levelOf } from "./svg.ts";
import type { Axis, LevelModel, Model, Pt, Shape, Wall } from "./types.ts";
import { ownerId } from "./types.ts";

/**
 * A wall that is a straight axis-parallel segment, and so can be moved by rewriting one
 * coordinate. Angled and curved walls move along their own normal instead, which is a
 * different edit (`handles`).
 */
type AxisWall = Wall & { axis: Axis; c: number };
const axisWall = (w: Wall): AxisWall | undefined =>
  w.axis !== undefined && w.c !== undefined ? (w as AxisWall) : undefined;

/** Rooms and tracks may not be dragged below this, in metres. */
const MIN_TRACK = 0.4;
/** Drags land on 5 cm unless a modifier asks for free movement. */
const SNAP = 0.05;
/** A fixture may not be shrunk below this in either direction, in metres. */
const MIN_SIZE = 0.2;
const snapMm = (n: number) => Math.round(n * 1000) / 1000;

export interface Draggable {
  wallId: string;
  axis: "h" | "v";
  /** the wall's current centreline coordinate, metres */
  c: number;
  /** clamp range so a drag cannot make the document nonsense */
  min: number;
  max: number;
  /** what moving it rewrites, said plainly enough for a status line */
  writes: string;
  edits: (next: number) => Array<{ path: JsonPath; literal: string }>;
}

type Doc = Record<string, unknown>;

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const asObj = (v: unknown): Doc | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : undefined;
/** Walk a path of object keys from the document root. */
const at = (doc: Doc, path: JsonPath): Doc | undefined => {
  let cur: Doc | undefined = doc;
  for (const k of path) cur = cur === undefined ? undefined : asObj(cur[k as string]);
  return cur;
};

/** Every group of the document a wall's owner can be declared in. */
const SPACE_KINDS = ["rooms", "outdoor", "voids"] as const;

/** A path as a reader of a status line would write it: `levels.piso1.layout`. */
const label = (path: JsonPath): string => path.join(".");

/**
 * The document behind the source text, in whichever syntax it is written. A drag is
 * computed from the *document* — which keys a space authored, where its corners are — and
 * both syntaxes compile to the same document, so everything below this line is unchanged
 * by the DSL's arrival.
 */
const safeParse = (text: string): unknown => {
  try {
    return readSource(text).doc;
  } catch {
    return undefined;
  }
};

/**
 * The one place an edit becomes characters. A `{ path, literal }` edit is syntax-neutral:
 * `spliceAll` finds the JSON node, `dslSpliceAll` finds the token on the DSL line, and
 * both replace exactly that value and nothing else. Routing here rather than inside each
 * writer is what keeps `spaceForm` and `fixtureWriter` — and therefore every path this
 * module produces for a JSON document — byte-identical to what they were.
 */
const applyEdits = (text: string, edits: Array<{ path: JsonPath; literal: string }>): string =>
  isDslText(text) ? dslSpliceAll(text, edits) : spliceAll(text, edits);

/**
 * A room or outdoor space is authored either as a `poly` or as a `rect: [x, y, w, h]`, and
 * an edit has to be written back in whichever form the source uses — rewriting one into the
 * other would reformat a document the author is still typing in. This is the same contract
 * `fixtureWriter` keeps for a fixture's `poly` versus its `at` + `size`.
 */
interface SpaceForm {
  /** the ring's corners, in the order the document has them */
  vertices: Pt[];
  /** move every corner whose `axis` coordinate is `from` onto `to` */
  edge: (axis: 0 | 1, from: number, to: number) => Array<{ path: JsonPath; literal: string }>;
  /** move the corners at these indices into `vertices`, along `axis`, onto `to` */
  corners: (indices: number[], axis: 0 | 1, to: number) => Array<{ path: JsonPath; literal: string }>;
  /** move one corner to a point, writing only the coordinates that actually change */
  corner: (index: number, to: Pt) => Array<{ path: JsonPath; literal: string }>;
}

/**
 * The write-back form for one space. `undefined` means nothing is authored here — a
 * grid-placed space moves when its tracks do. `null` means geometry is there but is not
 * readable, and the caller must decline the edit rather than write half of it.
 */
type SpaceKind = "rooms" | "outdoor" | "voids";

function spaceForm(doc: Doc, root: JsonPath, kind: SpaceKind, id: string): SpaceForm | null | undefined {
  const entry = asObj(asObj(at(doc, root)?.[kind])?.[id]);
  if (!entry) return undefined;

  const poly = entry["poly"];
  if (poly !== undefined) {
    if (!Array.isArray(poly)) return null;
    const pts: Pt[] = [];
    // where each corner's coordinates live: `poly[v]` for a plain point, `poly[v].arc`
    // for an arc entry, which carries the corner the arc *ends* at
    const holder: Array<readonly (string | number)[]> = [];
    for (const [v, p] of (poly as unknown[]).entries()) {
      if (Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number")) {
        pts.push([p[0] as number, p[1] as number]);
        holder.push(["poly", v]);
        continue;
      }
      const o = asObj(p);
      const a = o?.["arc"];
      if (Array.isArray(a) && a.length === 2 && a.every((n) => typeof n === "number")) {
        pts.push([a[0] as number, a[1] as number]);
        holder.push(["poly", v, "arc"]);
        continue;
      }
      return null;
    }
    const write = (v: number, axis: 0 | 1, to: number) => ({
      path: [...root, kind, id, ...holder[v]!, axis] as JsonPath,
      literal: metres(to),
    });
    return {
      vertices: pts,
      edge: (axis, from, to) => pts.flatMap((p, v) => (near(p[axis], from) ? [write(v, axis, to)] : [])),
      corners: (indices, axis, to) => indices.map((v) => write(v, axis, to)),
      corner: (index, to) =>
        ([0, 1] as const).flatMap((axis) =>
          near(pts[index]![axis], to[axis]) ? [] : [write(index, axis, to[axis])],
        ),
    };
  }

  const r = entry["rect"];
  if (r === undefined) return undefined;
  if (!Array.isArray(r) || r.length !== 4 || r.some((n) => typeof n !== "number")) return null;
  const [x, y, w, h] = r as [number, number, number, number];
  // the corner order `readRect` expands to, so an index into `vertices` names the same
  // corner here as it does in the parsed polygon
  const vertices: Pt[] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  const edge = (axis: 0 | 1, from: number, to: number) => {
    const origin = axis === 0 ? x : y;
    const size = axis === 0 ? w : h;
    // the near side moves the origin and keeps the far side still; the far side resizes
    if (near(origin, from))
      return [
        { path: [...root, kind, id, "rect", axis] as JsonPath, literal: metres(to) },
        { path: [...root, kind, id, "rect", axis + 2] as JsonPath, literal: metres(size + (origin - to)) },
      ];
    if (near(origin + size, from))
      return [{ path: [...root, kind, id, "rect", axis + 2] as JsonPath, literal: metres(size + (to - from)) }];
    return [];
  };
  return {
    vertices,
    edge,
    corners: (indices, axis, to) => (indices.length === 0 ? [] : edge(axis, vertices[indices[0]!]![axis], to)),
    // a rect has no corner to move on its own: pushing one moves the two sides it is on
    corner: (index, to) =>
      ([0, 1] as const).flatMap((axis) =>
        near(vertices[index]![axis], to[axis]) ? [] : edge(axis, vertices[index]![axis], to[axis]),
      ),
  };
}

/** Cumulative track boundaries, matching the grid compiler: starts at 0. */
function boundaries(tracks: number[]): number[] {
  const out = [0];
  for (const t of tracks) out.push(Math.round((out[out.length - 1]! + t) * 1000) / 1000);
  return out;
}

/**
 * A wall on a track boundary moves by resizing the two tracks either side: one grows by
 * exactly what the other loses, so the grid still tiles and every other room stays put.
 */
function fromGrid(doc: Doc, root: JsonPath, levels: string[], wall: AxisWall): Draggable | undefined {
  // A level either authors its own `layout` tracks or sits on the document's shared
  // track grid. Dragging a shared boundary moves that wall on every level using it, so
  // the status line has to say so: the surprise is the whole risk of sharing.
  const own = asObj(at(doc, root)?.["layout"]);
  const sharedTracks = asObj(doc["grid"]);
  const key = wall.axis === "v" ? "cols" : "rows";
  const hasOwn = own !== undefined && Array.isArray(own[key]);
  const layout = hasOwn ? own : sharedTracks;
  if (!layout) return undefined;
  const base: JsonPath = hasOwn ? [...root, "layout"] : ["grid"];
  const alsoOn = hasOwn ? [] : levels;
  const tracks: unknown = layout[key];
  if (!Array.isArray(tracks) || !tracks.every((t) => typeof t === "number")) return undefined;

  const list = tracks as number[];
  const bounds = boundaries(list);
  const axis = wall.axis === "v" ? 0 : 1;
  const along = 1 - axis;

  /**
   * A grid drag resizes tracks, which moves every space the grid places and nothing
   * else. A wall both of whose sides author their own geometry has nothing to do with
   * the grid even when its coordinate happens to equal a track boundary — quinta's
   * detached shack `arrecadacao` sits on the grid's east line by coincidence, a metre
   * south of where the grid ends, and dragging its wall used to resize the *house*
   * (docs/action-plan.md, the follow-up W1c logged). Offer the grid only where the grid
   * is what put a wall there.
   */
  const gridPlaced = (id: string | undefined) => {
    if (id === undefined) return false;
    for (const kind of SPACE_KINDS) {
      const group = asObj(at(doc, root)?.[kind]);
      if (group && id in group) return spaceForm(doc, root, kind, id) === undefined;
    }
    return false;
  };
  if (![wall.neg, wall.pos].map(ownerId).some(gridPlaced)) return undefined;

  // The grid's own boundaries on the other axis — the coordinates a track edge can
  // actually land on. A polygon edge counts as riding the dragged line only if one of
  // its own endpoints sits at a genuine boundary there: a real corner of the
  // arrangement, even if the polygon then runs on past the grid's own extent (casa-
  // piscina's deck, whose outer edge starts exactly at the house wall and continues
  // south of it). A vertex that merely shares the dragged coordinate, with neither
  // endpoint at a real boundary, is a coincidence: quinta's detached shack
  // `arrecadacao` lands on the grid's east line purely by chance, sharing no corner
  // with it, a full metre south of where the grid actually ends.
  const alongTracks: unknown = layout[wall.axis === "v" ? "rows" : "cols"] ?? sharedTracks?.[wall.axis === "v" ? "rows" : "cols"];
  const alongBounds =
    Array.isArray(alongTracks) && alongTracks.every((t) => typeof t === "number")
      ? boundaries(alongTracks as number[])
      : [];
  const onBoundary = (v: number) => alongBounds.some((b) => near(b, v));

  /**
   * A grid boundary is a line right across the plan, but a space may still be authored
   * with an absolute poly — casa-patio's courtyard is. Those coordinates are anchored to
   * the boundary, so they have to travel with it or the plan tears open behind them.
   */
  const anchored: Array<{ form: SpaceForm; indices: number[] }> = [];
  for (const kind of SPACE_KINDS) {
    const group = asObj(at(doc, root)?.[kind]);
    if (!group) continue;
    for (const id of Object.keys(group)) {
      const form = spaceForm(doc, root, kind, id);
      if (!form) continue;
      const pts = form.vertices;
      const n = pts.length;
      const carried = new Set<number>();
      for (let v = 0; v < n; v++) {
        const p0 = pts[v]!;
        const p1 = pts[(v + 1) % n]!;
        if (!near(p0[axis as 0 | 1], wall.c) || !near(p1[axis as 0 | 1], wall.c)) continue;
        if (!onBoundary(p0[along as 0 | 1]) && !onBoundary(p1[along as 0 | 1])) continue;
        carried.add(v);
        carried.add((v + 1) % n);
      }
      if (carried.size) anchored.push({ form, indices: [...carried] });
    }
  }
  const carry = (next: number) => anchored.flatMap((a) => a.form.corners(a.indices, axis as 0 | 1, next));
  const i = bounds.findIndex((b) => near(b, wall.c));
  // the grid is anchored at 0, so the near edge cannot move without shifting every
  // coordinate in the document — a different operation than resizing a track
  if (i <= 0) return undefined;

  const before = list[i - 1]!;
  const last = i === bounds.length - 1;
  if (last) {
    // the far edge of the building: dragging it grows or shrinks the final track
    return {
      wallId: wall.id,
      axis: wall.axis,
      c: wall.c,
      min: wall.c - (before - MIN_TRACK),
      max: wall.c + 100,
      writes: `${label(base)}.${key}[${i - 1}]${alsoOn.length > 1 ? ` — moves this wall on ${alsoOn.join(", ")}` : ""}`,
      edits: (next) => [
        { path: [...base, key, i - 1], literal: metres(before + Math.round((next - wall.c) * 1000) / 1000) },
        ...carry(next),
      ],
    };
  }

  const after = list[i]!;
  return {
    wallId: wall.id,
    axis: wall.axis,
    c: wall.c,
    min: wall.c - (before - MIN_TRACK),
    max: wall.c + (after - MIN_TRACK),
    writes: `${label(base)}.${key}[${i - 1}] and [${i}]${alsoOn.length > 1 ? ` — moves this wall on ${alsoOn.join(", ")}` : ""}`,
    edits: (next) => {
      const d = Math.round((next - wall.c) * 1000) / 1000;
      return [
        { path: [...base, key, i - 1], literal: metres(before + d) },
        { path: [...base, key, i], literal: metres(after - d) },
        ...carry(next),
      ];
    },
  };
}

/**
 * A wall authored as polygon edges moves by rewriting the coordinate in every room that
 * shares it. Offered only when the wall spans the whole of each edge it touches: if any
 * room has a vertex on this coordinate outside the wall's span, moving it would need the
 * edge split and new vertices inserted, which is a different operation than a drag.
 */
function fromPolys(doc: Doc, root: JsonPath, wall: AxisWall): Draggable | undefined {
  const axis: 0 | 1 = wall.axis === "v" ? 0 : 1;
  const along = 1 - axis;
  let lower = -Infinity;
  let upper = Infinity;

  // only the two spaces this wall separates move. Scanning every space that happens to
  // have a vertex on the same line would drag unrelated rooms along with it — and would
  // refuse an exterior wall outright, because some far-off room shares its coordinate.
  const owners = new Set([wall.neg, wall.pos].map(ownerId).filter((id) => id !== undefined));
  if (owners.size === 0) return undefined;

  const movers: Array<{ id: string; form: SpaceForm }> = [];
  for (const kind of SPACE_KINDS) {
    const group = asObj(at(doc, root)?.[kind]);
    if (!group) continue;
    for (const id of Object.keys(group)) {
      if (!owners.has(id)) continue;
      const form = spaceForm(doc, root, kind, id);
      if (form === null) return undefined;
      if (!form) continue;
      for (const pt of form.vertices) {
        if (near(pt[axis], wall.c)) {
          // a vertex on this line but off the wall's run would need the edge split
          if (pt[along]! < wall.from - 1e-6 || pt[along]! > wall.to + 1e-6) return undefined;
        } else if (pt[axis] < wall.c) lower = Math.max(lower, pt[axis]);
        else upper = Math.min(upper, pt[axis]);
      }
      if (form.vertices.some((p) => near(p[axis], wall.c))) movers.push({ id, form });
    }
  }
  // how many numbers the drag rewrites, counted in the form each space is authored in
  const count = movers.flatMap(({ form }) => form.edge(axis, wall.c, wall.c)).length;
  if (count === 0) return undefined;

  return {
    wallId: wall.id,
    axis: wall.axis,
    c: wall.c,
    min: lower === -Infinity ? wall.c - 20 : lower + MIN_TRACK,
    max: upper === Infinity ? wall.c + 20 : upper - MIN_TRACK,
    writes: `${count} coordinates in ${movers.map((m) => m.id).join(", ")}`,
    edits: (next) => movers.flatMap(({ form }) => form.edge(axis, wall.c, next)),
  };
}

/**
 * Where in the document one level's content lives. A document that never authored
 * `levels` keeps the root it always had, so `rooms.sala.poly[2][0]` is still exactly that
 * — which is what makes every path an agent cached before levels existed stay valid.
 */
function rootOf(doc: Doc, model: Model, level: string | undefined): { root: JsonPath; lm: LevelModel } {
  const lm = levelOf(model, level);
  return { root: model.plan.levelled ? ["levels", lm.level.id] : [], lm };
}

/**
 * The ids of every level sitting on the shared track grid — a level whose `layout`
 * supplies `areas` and no tracks of its own. They all move together when a shared
 * boundary is dragged, so a status line has to be able to name them.
 */
const onSharedGrid = (doc: Doc, model: Model): string[] =>
  doc["grid"] === undefined
    ? []
    : model.levels
        .filter((m) => {
          const l = asObj(at(doc, ["levels", m.level.id])?.["layout"]);
          return l !== undefined && l["cols"] === undefined && l["rows"] === undefined;
        })
        .map((m) => m.level.id);

/** Every wall on one level that a drag can express as an edit to the source. */
export function draggableWalls(text: string, model: Model, level?: string): Map<string, Draggable> {
  const doc = asObj(safeParse(text));
  if (!doc) return new Map();
  const { root, lm } = rootOf(doc, model, level);
  const shared = onSharedGrid(doc, model);
  const out = new Map<string, Draggable>();
  for (const wall of lm.walls) {
    // an angled or curved wall is not a single coordinate, so it is not offered here;
    // `wallHandles` moves it along its own normal instead
    const aw = axisWall(wall);
    if (!aw) continue;
    const d = fromGrid(doc, root, shared, aw) ?? fromPolys(doc, root, aw);
    if (d && d.max > d.min) out.set(wall.id, d);
  }
  return out;
}

export function applyDrag(text: string, d: Draggable, rawNext: number, free = false): string {
  const clamped = Math.min(Math.max(rawNext, d.min), d.max);
  const snapped = free ? Math.round(clamped * 1000) / 1000 : Math.round(clamped / SNAP) * SNAP;
  const next = Math.round(Math.min(Math.max(snapped, d.min), d.max) * 1000) / 1000;
  if (near(next, d.c)) return text;
  return applyEdits(text, d.edits(next));
}

/**
 * Outdoor spaces have no walls — nothing derives from them — so their own edges are the
 * handles. Dragging one moves the coordinate shared by the two vertices at its ends,
 * which for a rectilinear ring is the whole edge.
 */
export function draggableOutdoorEdges(text: string, model: Model, level?: string): Map<string, Draggable> {
  const doc = asObj(safeParse(text));
  const out = new Map<string, Draggable>();
  if (!doc) return out;
  const { root, lm } = rootOf(doc, model, level);

  for (const space of lm.level.outdoor) {
    // only an outdoor space that authored its own geometry can be edited this way; one
    // placed by the track grid moves when its tracks do
    const form = spaceForm(doc, root, "outdoor", space.id);
    if (!form || form.vertices.length !== space.poly.length) continue;

    const xs = space.poly.map((p) => p[0]);
    const ys = space.poly.map((p) => p[1]);
    const extent = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };

    space.poly.forEach((p0, k) => {
      const p1 = space.poly[(k + 1) % space.poly.length]!;
      const axis = near(p0[0], p1[0]) ? 0 : near(p0[1], p1[1]) ? 1 : -1;
      if (axis === -1) return;
      const c = p0[axis];

      // the edge may not pass the far side of the ring, nor be dragged onto its neighbours
      const others = space.poly.filter((_, v) => v !== k && v !== (k + 1) % space.poly.length);
      const lower = Math.max(...others.map((p) => p[axis]).filter((v) => v < c - 1e-6), -Infinity);
      const upper = Math.min(...others.map((p) => p[axis]).filter((v) => v > c + 1e-6), Infinity);

      out.set(`${space.id}:${k}`, {
        wallId: `${space.id}:${k}`,
        axis: axis === 0 ? "v" : "h",
        c,
        min: lower === -Infinity ? c - 100 : lower + MIN_TRACK,
        max: upper === Infinity ? c + 100 : upper - MIN_TRACK,
        // y grows south, so the smaller coordinate is the north or west side
        writes: `${space.name}'s ${
          axis === 0 ? (near(c, extent.x0) ? "west" : "east") : near(c, extent.y0) ? "north" : "south"
        } edge`,
        edits: (next) => form.corners([k, (k + 1) % space.poly.length], axis as 0 | 1, next),
      });
    });
  }
  return out;
}

/** A body that moves in both axes at once, rather than one coordinate along an axis. */
export interface Movable {
  id: string;
  /** the body's north-west corner today, metres */
  at: Pt;
  writes: string;
  edits: (to: Pt) => Array<{ path: JsonPath; literal: string }>;
}

/** The corners of a rectilinear ring. */
function extentOf(poly: Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * A fixture is authored either as a poly or as `at` + `size`, and an edit has to be
 * written back in whichever form the source uses — rewriting one into the other would
 * reformat a document the author is still typing in.
 */
function fixtureWriter(doc: Doc, root: JsonPath, index: number, poly: Pt[]) {
  const group = at(doc, root)?.["fixtures"];
  // index -1 is a vertical element's synthetic footprint: it addresses nothing here, so
  // there is nothing to write back and the handle is simply not offered
  const entry = index < 0 || !Array.isArray(group) ? undefined : asObj((group as unknown[])[index]);
  if (!entry) return undefined;
  const hasPoly = Array.isArray(entry["poly"]);
  const hasRect = Array.isArray(entry["at"]) && Array.isArray(entry["size"]);
  if (!hasPoly && !hasRect) return undefined;

  return {
    /** shift every corner by the same amount */
    move: (dx: number, dy: number): Array<{ path: JsonPath; literal: string }> => {
      if (hasRect) {
        const at = entry["at"] as number[];
        return [
          { path: [...root, "fixtures", index, "at", 0], literal: metres(at[0]! + dx) },
          { path: [...root, "fixtures", index, "at", 1], literal: metres(at[1]! + dy) },
        ];
      }
      return poly.flatMap((p, v) => [
        { path: [...root, "fixtures", index, "poly", v, 0] as JsonPath, literal: metres(p[0] + dx) },
        { path: [...root, "fixtures", index, "poly", v, 1] as JsonPath, literal: metres(p[1] + dy) },
      ]);
    },
    /** move one side of the footprint, leaving the opposite side where it is */
    edge: (axis: 0 | 1, from: number, to: number): Array<{ path: JsonPath; literal: string }> => {
      if (hasRect) {
        const at = entry["at"] as number[];
        const size = entry["size"] as number[];
        const near0 = Math.abs(at[axis]! - from) < 1e-6;
        return near0
          ? [
              { path: [...root, "fixtures", index, "at", axis], literal: metres(to) },
              { path: [...root, "fixtures", index, "size", axis], literal: metres(size[axis]! + (at[axis]! - to)) },
            ]
          : [{ path: [...root, "fixtures", index, "size", axis], literal: metres(size[axis]! + (to - from)) }];
      }
      return poly
        .map((p, v) => ({ p, v }))
        .filter(({ p }) => Math.abs(p[axis] - from) < 1e-6)
        .map(({ v }) => ({ path: [...root, "fixtures", index, "poly", v, axis] as JsonPath, literal: metres(to) }));
    },
  };
}

/** Each side of every fixture, so a pool can be made bigger or smaller. */
export function draggableFixtureEdges(text: string, model: Model, level?: string): Map<string, Draggable> {
  const doc = asObj(safeParse(text));
  const out = new Map<string, Draggable>();
  if (!doc) return out;
  const { root, lm } = rootOf(doc, model, level);

  for (const fm of lm.fixtures) {
    const i = fm.fixture.index;
    const w = fixtureWriter(doc, root, i, fm.fixture.poly);
    if (!w) continue;
    const e = extentOf(fm.fixture.poly);
    const sides = [
      { axis: 0 as const, c: e.x0, name: "west", min: -100, max: e.x1 - MIN_SIZE },
      { axis: 0 as const, c: e.x1, name: "east", min: e.x0 + MIN_SIZE, max: 100 },
      { axis: 1 as const, c: e.y0, name: "north", min: -100, max: e.y1 - MIN_SIZE },
      { axis: 1 as const, c: e.y1, name: "south", min: e.y0 + MIN_SIZE, max: 100 },
    ];
    for (const side of sides)
      out.set(`fixture:${i}:${side.name}`, {
        wallId: `fixture:${i}:${side.name}`,
        axis: side.axis === 0 ? "v" : "h",
        c: side.c,
        min: side.min,
        max: side.max,
        writes: `${fm.fixture.name}'s ${side.name} edge`,
        edits: (next) => w.edge(side.axis, side.c, next),
      });
  }
  return out;
}

/** Every fixture's body, so a pool can be picked up and put somewhere else. */
export function movableFixtures(text: string, model: Model, level?: string): Map<string, Movable> {
  const doc = asObj(safeParse(text));
  const out = new Map<string, Movable>();
  if (!doc) return out;
  const { root, lm } = rootOf(doc, model, level);

  for (const fm of lm.fixtures) {
    const i = fm.fixture.index;
    const w = fixtureWriter(doc, root, i, fm.fixture.poly);
    if (!w) continue;
    const e = extentOf(fm.fixture.poly);
    out.set(`fixture:${i}`, {
      id: `fixture:${i}`,
      at: [e.x0, e.y0],
      writes: fm.fixture.name,
      edits: (to) => w.move(snapMm(to[0] - e.x0), snapMm(to[1] - e.y0)),
    });
  }
  return out;
}

export function applyMove(text: string, m: Movable, to: Pt, free = false): string {
  const grid = free ? 0.001 : SNAP;
  const at: Pt = [Math.round(to[0] / grid) * grid, Math.round(to[1] / grid) * grid];
  if (near(at[0], m.at[0]) && near(at[1], m.at[1])) return text;
  return applyEdits(text, m.edits(at));
}


// ---------- handles: what a wall that is not a grid line can be dragged by ----------

/**
 * A grip on the drawing, generalised past "a coordinate on an axis" (docs/gaps-design.md
 * §1.3.8). Three kinds, because three is what the geometry has:
 *
 * - **offset** slides a wall along its own normal. The vertices on it move; the edges
 *   running into them keep their far ends and pivot. On an axis-aligned wall this writes
 *   exactly what `draggableWalls` writes, which is the property `handlesMatchDrags` pins.
 * - **radius** changes a curved wall's bulge by splicing the `r` of the arc that made it.
 *   That this is one number in one place is why §1.2 chose an inline arc object over an
 *   SVG path string, which no `spliceAt` could address.
 * - **vertex** moves one corner in two dimensions.
 *
 * `draggableWalls` is not replaced: a grid wall resizes tracks, which is a different and
 * better edit than moving vertices, and it is expressed entirely in document terms.
 */
export type Handle = OffsetHandle | RadiusHandle | VertexHandle;

export interface OffsetHandle {
  kind: "offset";
  id: string;
  wallId: string;
  /** unit normal the wall slides along, pointing at its `pos` side */
  normal: Pt;
  /** where the wall is now, as a projection onto that normal, metres */
  at: number;
  min: number;
  max: number;
  writes: string;
  edits: (next: number) => Array<{ path: JsonPath; literal: string }>;
}

export interface RadiusHandle {
  kind: "radius";
  id: string;
  wallId: string;
  /** the arc's radius now, metres */
  at: number;
  min: number;
  max: number;
  writes: string;
  edits: (next: number) => Array<{ path: JsonPath; literal: string }>;
}

export interface VertexHandle {
  kind: "vertex";
  id: string;
  /** which space and which corner of its `poly` */
  space: string;
  index: number;
  at: Pt;
  writes: string;
  edits: (to: Pt) => Array<{ path: JsonPath; literal: string }>;
}

const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];

/** The unit normal of a straight wall, pointing at its `pos` side. */
function wallNormal(w: Wall): Pt | undefined {
  if (w.geometry.kind !== "segment") return undefined;
  const dx = w.geometry.b[0] - w.geometry.a[0];
  const dy = w.geometry.b[1] - w.geometry.a[1];
  const l = Math.hypot(dx, dy);
  if (l === 0) return undefined;
  return [-dy / l, dx / l];
}

/**
 * Every handle one level offers. Offsets for straight walls, a radius for each curved
 * one, and a vertex for every corner of every space authored as a `poly`.
 */
export function wallHandles(text: string, model: Model, level?: string): Map<string, Handle> {
  const doc = asObj(safeParse(text));
  const out = new Map<string, Handle>();
  if (!doc) return out;
  const { root, lm } = rootOf(doc, model, level);

  for (const wall of lm.walls) {
    const h = offsetHandle(doc, root, lm, wall) ?? radiusHandle(doc, root, lm, wall);
    if (h) out.set(h.id, h);
  }
  for (const kind of SPACE_KINDS) {
    const group = asObj(at(doc, root)?.[kind]);
    if (!group) continue;
    for (const id of Object.keys(group)) {
      const entry = asObj(group[id]);
      // only a `poly` has corners to address; a `rect` is moved by its edges
      if (!entry || !Array.isArray(entry["poly"])) continue;
      const form = spaceForm(doc, root, kind, id);
      if (!form) continue;
      form.vertices.forEach((v, i) => {
        const h: VertexHandle = {
          kind: "vertex",
          id: `vertex:${id}:${i}`,
          space: id,
          index: i,
          at: v,
          writes: `corner ${i} of ${id}`,
          edits: (to) => form.corner(i, to),
        };
        out.set(h.id, h);
      });
    }
  }
  return out;
}

/**
 * Slide a straight wall along its normal. Refused, exactly as the coordinate drag is,
 * when a space it separates has a corner on the wall's own line but outside its run:
 * moving that corner would need the edge split, which is a different operation.
 *
 * INVARIANT: where the normal is axis-aligned this writes through the very same
 * `SpaceForm.edge` the coordinate drag uses, so a `rect`-authored room stays a rect and
 * the splice is byte for byte what it was. Only an angled wall takes the general path,
 * and an angled wall can never bound a rect.
 */
function offsetHandle(doc: Doc, root: JsonPath, lm: LevelModel, wall: Wall): OffsetHandle | undefined {
  const n = wallNormal(wall);
  if (!n || wall.geometry.kind !== "segment") return undefined;
  const a = wall.geometry.a;
  const b = wall.geometry.b;
  const t: Pt = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(t[0], t[1]);
  if (len === 0) return undefined;
  const unit: Pt = [t[0] / len, t[1] / len];
  const here = dot(a, n);
  /** the coordinate axis the normal runs along, when it runs along one */
  const flat: 0 | 1 | undefined = wall.axis === "v" ? 0 : wall.axis === "h" ? 1 : undefined;

  const owners = new Set([wall.neg, wall.pos].map(ownerId).filter((id) => id !== undefined));
  if (owners.size === 0) return undefined;

  const movers: Array<{ id: string; kind: SpaceKind; form: SpaceForm; indices: number[] }> = [];
  let lower = -Infinity;
  let upper = Infinity;
  for (const kind of SPACE_KINDS) {
    const group = asObj(at(doc, root)?.[kind]);
    if (!group) continue;
    for (const id of Object.keys(group)) {
      if (!owners.has(id)) continue;
      const form = spaceForm(doc, root, kind, id);
      if (form === null) return undefined;
      if (!form) continue;
      const indices: number[] = [];
      let onLine = 0;
      for (const [i, p] of form.vertices.entries()) {
        const across = dot(p, n) - here;
        if (Math.abs(across) < 1e-6) {
          onLine++;
          const alongP = dot([p[0] - a[0], p[1] - a[1]], unit);
          if (alongP < -1e-6 || alongP > len + 1e-6) continue;
          indices.push(i);
          continue;
        }
        // How far it may go. On an axis-aligned wall every other corner is a line the
        // wall must not cross, which is what the coordinate drag has always used. On a
        // canted wall that projection means nothing — a corner across the room can be
        // "nearer" along the normal than the edge the wall actually pivots on — so only
        // the corners the moving ones hinge against count.
        if (flat === undefined) continue;
        if (across < 0) lower = Math.max(lower, dot(p, n));
        else upper = Math.min(upper, dot(p, n));
      }
      if (flat === undefined) {
        const m = form.vertices.length;
        for (const i of indices)
          for (const j of [(i - 1 + m) % m, (i + 1) % m]) {
            if (indices.includes(j)) continue;
            const across = dot(form.vertices[j]!, n) - here;
            if (across < 0) lower = Math.max(lower, dot(form.vertices[j]!, n));
            else upper = Math.min(upper, dot(form.vertices[j]!, n));
          }
      }
      // a corner on the line but off the run: the edge would have to be split
      if (onLine !== indices.length) return undefined;
      if (indices.length) movers.push({ id, kind, form, indices });
    }
  }
  if (movers.length === 0) return undefined;

  /**
   * What the coordinate drag's "a vertex outside the run" refusal is a special case of,
   * stated the way the arrangement states it. A wall's end may be incident to a *third*
   * space — a T-junction on its edge, or its corner. Sliding the wall moves that end,
   * and the boundary it was sitting on stays put, so the two come apart — unless the
   * wall's *normal*, which is the direction the end travels in, runs along that
   * boundary: then the end merely slides down it and the plan is still a plan. casa-t3's
   * wc/closet wall ends on the suite's east edge and moves along it, so it may move;
   * casa-angulo's 45° wing ends at a T-junction on the quarto's south edge and travels
   * at 45° to it, so sliding it opens a 0.12 m² overlap.
   */
  for (const shape of thirdParties(lm, owners))
    for (const end of [a, b]) {
      if (!pointOnShapeBoundary(end, shape)) continue;
      if (!boundaryRunsAlong(shape, end, n)) return undefined;
    }

  const write = (next: number): Array<{ path: JsonPath; literal: string }> => {
    if (flat !== undefined) return movers.flatMap(({ form }) => form.edge(flat, here, next));
    const d = next - here;
    return movers.flatMap(({ form, indices }) =>
      indices.flatMap((i) => {
        const p = form.vertices[i]!;
        const to: Pt = [p[0] + n[0] * d, p[1] + n[1] * d];
        return form.corner(i, to);
      }),
    );
  };
  const count = flat === undefined ? movers.reduce((t2, m) => t2 + m.indices.length, 0) : write(here).length;
  if (count === 0) return undefined;
  const min = lower === -Infinity ? here - 20 : lower + MIN_TRACK;
  const max = upper === Infinity ? here + 20 : upper - MIN_TRACK;
  if (max <= min) return undefined;
  return {
    kind: "offset",
    id: `offset:${wall.id}`,
    wallId: wall.id,
    normal: n,
    at: here,
    min,
    max,
    writes:
      flat === undefined
        ? `${count} corner${count === 1 ? "" : "s"} in ${movers.map((m) => m.id).join(", ")}`
        : `${count} coordinates in ${movers.map((m) => m.id).join(", ")}`,
    edits: write,
  };
}

/** Change a curved wall's bulge by splicing the radius of the arc that produced it. */
function radiusHandle(doc: Doc, root: JsonPath, lm: LevelModel, wall: Wall): RadiusHandle | undefined {
  if (wall.geometry.kind !== "arc") return undefined;
  const g = wall.geometry;
  const owners = new Set([wall.neg, wall.pos].map(ownerId).filter((id) => id !== undefined));
  for (const kind of SPACE_KINDS) {
    const group = asObj(at(doc, root)?.[kind]);
    if (!group) continue;
    for (const id of Object.keys(group)) {
      if (!owners.has(id)) continue;
      const entry = asObj(group[id]);
      const poly = entry?.["poly"];
      if (!Array.isArray(poly)) continue;
      const shape = shapeOf(lm, id);
      if (!shape) continue;
      for (let i = 0; i < poly.length; i++) {
        const item = asObj(poly[i]);
        if (!item || item["arc"] === undefined || typeof item["r"] !== "number") continue;
        // the authored arc that carries this wall: same circle to the millimetre
        const spec = shape.arcs[centreIndex(shape, poly, i)];
        if (!spec) continue;
        const resolved = arcCircle(shape, centreIndex(shape, poly, i));
        if (!resolved) continue;
        if (Math.abs(resolved.r - g.r) > 1e-3) continue;
        if (Math.hypot(resolved.c[0] - g.centre[0], resolved.c[1] - g.centre[1]) > 1e-3) continue;
        const chord = Math.hypot(...(chordOf(shape, centreIndex(shape, poly, i)) ?? [0, 0]));
        return {
          kind: "radius",
          id: `radius:${wall.id}`,
          wallId: wall.id,
          at: item["r"],
          min: Math.round((chord / 2) * 1000) / 1000,
          max: 100,
          writes: `${id}'s arc radius`,
          edits: (next) => [{ path: [...root, kind, id, "poly", i, "r"] as JsonPath, literal: metres(next) }],
        };
      }
    }
  }
  return undefined;
}

/** Which edge of the parsed shape the document's `poly[i]` arc object describes. */
const centreIndex = (shape: Shape, poly: unknown[], i: number): number => {
  // an arc entry at document index i is the parsed edge that *ends* at parsed corner i,
  // and the parser keeps one corner per entry, so the edge index is i − 1
  void poly;
  return (i - 1 + shape.poly.length) % shape.poly.length;
};

function chordOf(shape: Shape, edge: number): [number, number] | undefined {
  const a = shape.poly[edge];
  const b = shape.poly[(edge + 1) % shape.poly.length];
  return a && b ? [b[0] - a[0], b[1] - a[1]] : undefined;
}

function arcCircle(shape: Shape, edge: number): { c: Pt; r: number } | undefined {
  const spec = shape.arcs[edge];
  const a = shape.poly[edge];
  const b = shape.poly[(edge + 1) % shape.poly.length];
  if (!spec || !a || !b) return undefined;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return undefined;
  const r = Math.max(spec.r, chord / 2);
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const side = (spec.sweep === "cw") !== spec.large ? 1 : -1;
  return { c: [(a[0] + b[0]) / 2 + (side * h * -dy) / chord, (a[1] + b[1]) / 2 + (side * h * dx) / chord], r };
}

/** Does a boundary edge of `shape` through `p` run along `dir`? */
function boundaryRunsAlong(shape: Shape, p: Pt, dir: Pt): boolean {
  const n = shape.poly.length;
  for (let i = 0; i < n; i++) {
    // an arc through the point runs along no fixed direction, so it never qualifies
    if (shape.arcs[i] !== undefined) continue;
    const a = shape.poly[i]!;
    const b = shape.poly[(i + 1) % n]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    if (Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t) > 1e-6) continue;
    if (Math.abs(dx * dir[1] - dy * dir[0]) / Math.sqrt(l2) < 1e-6) return true;
  }
  return false;
}

/** Every declared space on the level except the ones named. */
const thirdParties = (lm: LevelModel, owners: ReadonlySet<string>): Shape[] => [
  ...lm.rooms.filter((m) => !owners.has(m.room.id)).map((m) => m.room as Shape),
  ...lm.level.outdoor.filter((o) => !owners.has(o.id)).map((o) => o as Shape),
  ...lm.level.voids.filter((v) => !owners.has(v.id)).map((v) => v as Shape),
];

const shapeOf = (lm: LevelModel, id: string): Shape | undefined =>
  lm.rooms.find((m) => m.room.id === id)?.room ??
  lm.level.outdoor.find((o) => o.id === id) ??
  lm.level.voids.find((v) => v.id === id);

/** Apply a scalar handle — an offset or a radius — with the same snapping a drag uses. */
export function applyHandle(text: string, h: OffsetHandle | RadiusHandle, rawNext: number, free = false): string {
  const clamped = Math.min(Math.max(rawNext, h.min), h.max);
  const snapped = free ? Math.round(clamped * 1000) / 1000 : Math.round(clamped / SNAP) * SNAP;
  const next = Math.round(Math.min(Math.max(snapped, h.min), h.max) * 1000) / 1000;
  if (near(next, h.at)) return text;
  const edits = h.edits(next);
  return edits.length === 0 ? text : spliceAll(text, edits);
}

/** Apply a vertex handle: a corner moves in both directions at once. */
export function applyVertexHandle(text: string, h: VertexHandle, to: Pt, free = false): string {
  const grid = free ? 0.001 : SNAP;
  const at2: Pt = [Math.round(to[0] / grid) * grid, Math.round(to[1] / grid) * grid];
  const edits = h.edits([snapMm(at2[0]), snapMm(at2[1])]);
  return edits.length === 0 ? text : spliceAll(text, edits);
}
