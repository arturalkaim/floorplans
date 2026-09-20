import {
  applyDrag,
  applyHandle,
  applyMove,
  draggableFixtureEdges,
  draggableOutdoorEdges,
  draggableWalls,
  levelOf,
  movableFixtures,
  projection,
  wallHandles,
} from "floorplan";
import type { Draggable, Finding, Model, Movable, OffsetHandle } from "floorplan";
import { useEffect, useRef, useState } from "react";
import type { RenderSettings } from "../lib/useFloorplan";

interface Props {
  svg: string;
  model: Model;
  text: string;
  /** the exact options `svg` was rendered with, so `projection` here agrees with the
   *  transform the renderer used rather than one reconstructed from a subset of them */
  render: RenderSettings;
  /** which level `svg` draws; every drag is scoped to it so a wall on `piso1` writes
   *  `levels.piso1.…` rather than the ground level's paths. Undefined on a single-level
   *  plan, where every entry point already defaults to the only level there is. */
  level?: string | undefined;
  /** the finding previewed from the findings panel (hover or click), if any: its
   *  `rooms` get a highlight class via the room `<g data-id>` the SVG already emits */
  highlight?: Finding | null;
  /** the same finding's marker number, as drawn in the SVG (`String(i + 1)` in the
   *  marker text); null when the finding fell outside `markFindings` and has no marker */
  highlightNumber?: number | null;
  /** called once per gesture, before the first change, so undo has one entry per drag */
  onDragStart: () => void;
  /** set while the source does not parse: the drawing shown is the last one that did */
  stale?: string | undefined;
  onChange: (next: string) => void;
}

/** how far the pointer must travel before a press becomes a drag, in screen pixels */
const THRESHOLD_PX = 3;

/**
 * One scalar grip, whichever kind of thing is under the pointer.
 *
 * A coordinate drag is a number on an axis; an offset handle is a distance along a
 * wall's own normal. The pointer maths is the same either way once the projection is a
 * dot product — which for an axis-aligned normal is just taking one of the two
 * coordinates, so the rectilinear path is unchanged (docs/gaps-design.md §1.3.8).
 */
interface Grip {
  at: number;
  writes: string;
  /** which way the thing travels, as a unit vector */
  normal: [number, number];
  along: (m: [number, number]) => number;
  apply: (from: string, next: number, free: boolean) => string;
  label: (next: number) => string;
}

const fromDrag = (d: Draggable): Grip => ({
  at: d.c,
  writes: d.writes,
  normal: d.axis === "v" ? [1, 0] : [0, 1],
  along: (m) => (d.axis === "v" ? m[0] : m[1]),
  apply: (from, next, free) => applyDrag(from, d, next, free),
  label: (next) => `${d.axis === "v" ? "x" : "y"} = ${(Math.round(next * 100) / 100).toFixed(2)} m · ${d.writes}`,
});

const fromOffset = (h: OffsetHandle): Grip => ({
  at: h.at,
  writes: h.writes,
  normal: h.normal,
  along: (m) => m[0] * h.normal[0] + m[1] * h.normal[1],
  apply: (from, next, free) => applyHandle(from, h, next, free),
  label: (next) => `${(Math.round((next - h.at) * 100) / 100).toFixed(2)} m along the wall's normal · ${h.writes}`,
});

/**
 * The drawing, with its walls draggable. A drag never touches the model: it works out the
 * new coordinate, rewrites the source, and the ordinary pipeline redraws — so what you see
 * is always a pure function of the text in the editor.
 */
export function Drawing({ svg, model, text, render, level, highlight, highlightNumber, stale, onDragStart, onChange }: Props) {
  const scale = render.scale;
  const host = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);
  const drag = useRef<{
    d?: Grip;
    /** set instead of `d` when a whole body is being carried rather than one edge */
    body?: Movable;
    grab?: [number, number];
    /** the document as it was when the gesture began: every move re-applies from here,
     *  so a drag is idempotent however many moves arrive */
    startText: string;
    /** where on the wall it was grabbed, so the wall moves with the pointer rather than
     *  jumping its centreline to it */
    offset: number;
    moved: boolean;
  } | null>(null);

  // the level `svg` draws, so the wall count in the hint line matches what is on screen
  // rather than the ground level's
  const lm = levelOf(model, level);

  // walls come from the derived model; outdoor spaces have none, so their own edges are
  // the handles. One map, keyed by whatever the element under the pointer carries.
  const wallDrags = draggableWalls(text, model, level);
  // a wall that is not one coordinate on one axis — angled, or curved — slides along its
  // own normal instead, and only when the coordinate drag has nothing to offer for it
  const offsets = new Map<string, Grip>();
  for (const h of wallHandles(text, model, level).values())
    if (h.kind === "offset" && !wallDrags.has(h.wallId)) offsets.set(h.wallId, fromOffset(h));
  const handles = new Map<string, Grip>([
    ...[...wallDrags].map(([k, d]) => [k, fromDrag(d)] as const),
    ...[...draggableOutdoorEdges(text, model, level)].map(([k, d]) => [k, fromDrag(d)] as const),
    ...[...draggableFixtureEdges(text, model, level)].map(([k, d]) => [k, fromDrag(d)] as const),
    ...offsets,
  ]);
  const bodies = movableFixtures(text, model, level);

  /** which handle, if any, the element under the pointer stands for */
  const keyOf = (el: SVGElement | undefined): string | undefined => {
    const d = el?.dataset;
    if (!d) return undefined;
    if (d["wall"]) return d["wall"];
    if (d["outdoor"]) return `${d["outdoor"]}:${d["edge"]}`;
    if (d["fixture"] && d["side"]) return `fixture:${d["fixture"]}:${d["side"]}`;
    return undefined;
  };
  const bodyOf = (el: SVGElement | undefined): Movable | undefined =>
    el?.dataset?.["body"] ? bodies.get(`fixture:${el.dataset["fixture"]}`) : undefined;

  useEffect(() => {
    const root = host.current?.querySelector("svg");
    if (!root) return;
    for (const el of root.querySelectorAll<SVGElement>("[data-wall], [data-outdoor], [data-fixture]")) {
      const body = bodyOf(el);
      const d = body ? undefined : handles.get(keyOf(el) ?? "");
      // the cursor follows the normal's dominant component, so a 45° wall reads as the
      // resize it is rather than always as one of the two axis cursors
      el.style.cursor = body ? "move" : d ? (Math.abs(d.normal[0]) >= Math.abs(d.normal[1]) ? "ew-resize" : "ns-resize") : "";
      if (d || body) el.dataset["draggable"] = "true";
      else delete el.dataset["draggable"];
    }
  });

  // links a findings-panel row back to the drawing: the room fill already carries
  // `data-id` (src/svg.ts), and a marker's number is the text content of its `.mk`
  // label — there is no `data-*` on the marker itself, so that text is the only handle.
  useEffect(() => {
    const root = host.current?.querySelector("svg");
    if (!root) return;
    for (const el of root.querySelectorAll(".hl-room, .hl-marker")) el.classList.remove("hl-room", "hl-marker");
    for (const id of highlight?.rooms ?? []) {
      root.querySelector(`.room[data-id="${CSS.escape(id)}"]`)?.classList.add("hl-room");
    }
    if (highlightNumber != null) {
      for (const g of root.querySelectorAll(".finding")) {
        if (g.querySelector(".mk")?.textContent === String(highlightNumber)) g.classList.add("hl-marker");
      }
    }
  });

  /**
   * Client pixels to metres. The SVG node is looked up every time, never cached: each
   * redraw replaces it, and getScreenCTM() on the old detached node returns nonsense.
   */
  const toMetres = (clientX: number, clientY: number): [number, number] | null => {
    const root = host.current?.querySelector("svg");
    if (!root) return null;
    const ctm = root.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return projection(model, render).toModel(p.x, p.y) as [number, number];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (stale || e.button !== 0) return;
    const target = e.target as SVGElement;
    const m = toMetres(e.clientX, e.clientY);
    if (!m) return;
    const body = bodyOf(target);
    const d = body ? undefined : handles.get(keyOf(target) ?? "");
    if (!body && !d) return;
    e.preventDefault();
    // capture on the container, which survives every redraw, not on the line
    host.current?.setPointerCapture(e.pointerId);
    drag.current = {
      ...(d ? { d } : {}),
      ...(body ? { body, grab: [m[0] - body.at[0], m[1] - body.at[1]] as [number, number] } : {}),
      startText: text,
      offset: d ? d.along(m) - d.at : 0,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const active = drag.current;
    if (!active) {
      const el = e.target as SVGElement;
      const body = bodyOf(el);
      const d = handles.get(keyOf(el) ?? "");
      setHint(body ? `drag to move ${body.writes}` : d ? `drag to resize · ${d.writes}` : null);
      return;
    }
    const m = toMetres(e.clientX, e.clientY);
    if (!m) return;

    if (active.body && active.grab) {
      const to: [number, number] = [m[0] - active.grab[0], m[1] - active.grab[1]];
      if (!active.moved) {
        const travelled = Math.hypot(to[0] - active.body.at[0], to[1] - active.body.at[1]) * scale;
        if (travelled < THRESHOLD_PX) return;
        active.moved = true;
        onDragStart();
      }
      const out = applyMove(active.startText, active.body, to, e.altKey);
      setHint(`${active.body.writes} → ${to[0].toFixed(2)}, ${to[1].toFixed(2)} m`);
      if (out !== text) onChange(out);
      return;
    }

    if (!active.d) return;
    const next = active.d.along(m) - active.offset;
    if (!active.moved) {
      if (Math.abs(next - active.d.at) * scale < THRESHOLD_PX) return; // a click is not a drag
      active.moved = true;
      onDragStart();
    }
    // always re-apply from where the gesture started, so moves cannot compound
    const out = active.d.apply(active.startText, next, e.altKey);
    setHint(active.d.label(next));
    if (out !== text) onChange(out);
  };

  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    host.current?.releasePointerCapture(e.pointerId);
    drag.current = null;
    setHint(null);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Drawing</h2>
        <span className={stale ? "note stale-note" : "note"}>
          {stale ?? hint ?? `${wallDrags.size + offsets.size}/${lm.walls.length} walls · ${bodies.size} fixtures · drag to move, edges to resize`}
        </span>
      </div>
      <div
        ref={host}
        className={stale ? "sheet-body stale" : "sheet-body"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={() => !drag.current && setHint(null)}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </section>
  );
}
