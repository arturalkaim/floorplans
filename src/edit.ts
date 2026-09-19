// Editing support: which walls a drawing can offer to drag, and what moving one writes
// back to the source. The document is the single source of truth, so an edit is always
// expressed as a splice into its text, never as a mutation of the derived model.
import { metres, spliceAll } from "./jsonpos.ts";
import type { JsonPath } from "./jsonpos.ts";
import type { Model, WallSegment } from "./types.ts";

/** Rooms and tracks may not be dragged below this, in metres. */
const MIN_TRACK = 0.4;
/** Drags land on 5 cm unless a modifier asks for free movement. */
const SNAP = 0.05;

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
const safeParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

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
function fromGrid(doc: Doc, wall: WallSegment): Draggable | undefined {
  const layout = asObj(doc["layout"]);
  if (!layout) return undefined;
  const key = wall.axis === "v" ? "cols" : "rows";
  const tracks: unknown = layout[key];
  if (!Array.isArray(tracks) || !tracks.every((t) => typeof t === "number")) return undefined;

  const list = tracks as number[];
  const bounds = boundaries(list);
  const axis = wall.axis === "v" ? 0 : 1;

  /**
   * A grid boundary is a line right across the plan, but a space may still be authored
   * with an absolute poly — casa-patio's courtyard is. Those coordinates are anchored to
   * the boundary, so they have to travel with it or the plan tears open behind them.
   */
  const anchored: JsonPath[] = [];
  for (const kind of ["rooms", "outdoor"] as const) {
    const group = asObj(doc[kind]);
    if (!group) continue;
    for (const id of Object.keys(group)) {
      const poly = asObj(group[id])?.["poly"];
      if (!Array.isArray(poly)) continue;
      poly.forEach((pt, v) => {
        if (Array.isArray(pt) && typeof pt[axis] === "number" && near(pt[axis] as number, wall.c))
          anchored.push([kind, id, "poly", v, axis]);
      });
    }
  }
  const carry = (next: number) => anchored.map((path) => ({ path, literal: metres(next) }));
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
      writes: `layout.${key}[${i - 1}]`,
      edits: (next) => [
        { path: ["layout", key, i - 1], literal: metres(before + Math.round((next - wall.c) * 1000) / 1000) },
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
    writes: `layout.${key}[${i - 1}] and [${i}]`,
    edits: (next) => {
      const d = Math.round((next - wall.c) * 1000) / 1000;
      return [
        { path: ["layout", key, i - 1], literal: metres(before + d) },
        { path: ["layout", key, i], literal: metres(after - d) },
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
function fromPolys(doc: Doc, wall: WallSegment): Draggable | undefined {
  const axis = wall.axis === "v" ? 0 : 1;
  const along = 1 - axis;
  const edits: Array<{ path: JsonPath; literal: string }> = [];
  let lower = -Infinity;
  let upper = Infinity;

  // only the two spaces this wall separates move. Scanning every space that happens to
  // have a vertex on the same line would drag unrelated rooms along with it — and would
  // refuse an exterior wall outright, because some far-off room shares its coordinate.
  const owners = new Set([wall.neg, wall.pos].filter((o) => o !== "exterior" && o !== "gap"));
  if (owners.size === 0) return undefined;

  for (const kind of ["rooms", "outdoor"] as const) {
    const group = asObj(doc[kind]);
    if (!group) continue;
    for (const id of Object.keys(group)) {
      if (!owners.has(id)) continue;
      const poly: unknown = asObj(group[id])?.["poly"];
      if (!Array.isArray(poly)) continue;
      for (let v = 0; v < poly.length; v++) {
        const pt = poly[v];
        if (!Array.isArray(pt) || pt.length !== 2 || pt.some((n) => typeof n !== "number")) return undefined;
        if (near(pt[axis] as number, wall.c)) {
          // a vertex on this line but off the wall's run would need the edge split
          if ((pt[along] as number) < wall.from - 1e-6 || (pt[along] as number) > wall.to + 1e-6) return undefined;
          edits.push({ path: [kind, id, "poly", v, axis], literal: "" });
        } else {
          const v = pt[axis] as number;
          if (v < wall.c) lower = Math.max(lower, v);
          else upper = Math.min(upper, v);
        }
      }
    }
  }
  if (edits.length === 0) return undefined;

  const rooms = new Set(edits.map((e) => String(e.path[1])));
  return {
    wallId: wall.id,
    axis: wall.axis,
    c: wall.c,
    min: lower === -Infinity ? wall.c - 20 : lower + MIN_TRACK,
    max: upper === Infinity ? wall.c + 20 : upper - MIN_TRACK,
    writes: `${edits.length} coordinates in ${[...rooms].join(", ")}`,
    edits: (next) => edits.map((e) => ({ path: e.path, literal: metres(next) })),
  };
}

/** Every wall in the model that a drag can express as an edit to the source. */
export function draggableWalls(text: string, model: Model): Map<string, Draggable> {
  const doc = asObj(safeParse(text));
  if (!doc) return new Map();
  const out = new Map<string, Draggable>();
  for (const wall of model.walls) {
    const d = fromGrid(doc, wall) ?? fromPolys(doc, wall);
    if (d && d.max > d.min) out.set(wall.id, d);
  }
  return out;
}

export function applyDrag(text: string, d: Draggable, rawNext: number, free = false): string {
  const clamped = Math.min(Math.max(rawNext, d.min), d.max);
  const snapped = free ? Math.round(clamped * 1000) / 1000 : Math.round(clamped / SNAP) * SNAP;
  const next = Math.round(Math.min(Math.max(snapped, d.min), d.max) * 1000) / 1000;
  if (near(next, d.c)) return text;
  return spliceAll(text, d.edits(next));
}

/**
 * Outdoor spaces have no walls — nothing derives from them — so their own edges are the
 * handles. Dragging one moves the coordinate shared by the two vertices at its ends,
 * which for a rectilinear ring is the whole edge.
 */
export function draggableOutdoorEdges(text: string, model: Model): Map<string, Draggable> {
  const doc = asObj(safeParse(text));
  const out = new Map<string, Draggable>();
  if (!doc) return out;

  for (const space of model.plan.outdoor) {
    // only an outdoor space authored with a poly can be edited this way; one placed by
    // the track grid moves when its tracks do
    const poly = asObj(asObj(doc["outdoor"])?.[space.id])?.["poly"];
    if (!Array.isArray(poly) || poly.length !== space.poly.length) continue;

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
        edits: (next) =>
          [k, (k + 1) % space.poly.length].map((v) => ({
            path: ["outdoor", space.id, "poly", v, axis] as JsonPath,
            literal: metres(next),
          })),
      });
    });
  }
  return out;
}
