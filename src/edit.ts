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

  const bounds = boundaries(tracks as number[]);
  const i = bounds.findIndex((b) => near(b, wall.c));
  if (i <= 0 || i >= bounds.length - 1) return undefined; // the outer edge is the building, not a boundary

  const before = (tracks as number[])[i - 1]!;
  const after = (tracks as number[])[i]!;
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

  for (const kind of ["rooms", "outdoor"] as const) {
    const group = asObj(doc[kind]);
    if (!group) continue;
    for (const id of Object.keys(group)) {
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
