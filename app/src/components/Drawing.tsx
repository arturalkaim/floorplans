import {
  applyDrag,
  applyMove,
  draggableFixtureEdges,
  draggableOutdoorEdges,
  draggableWalls,
  movableFixtures,
  projection,
} from "floorplan";
import type { Draggable, Model, Movable } from "floorplan";
import { useEffect, useRef, useState } from "react";

interface Props {
  svg: string;
  model: Model;
  text: string;
  scale: number;
  /** called once per gesture, before the first change, so undo has one entry per drag */
  onDragStart: () => void;
  /** set while the source does not parse: the drawing shown is the last one that did */
  stale?: string | undefined;
  onChange: (next: string) => void;
}

/** how far the pointer must travel before a press becomes a drag, in screen pixels */
const THRESHOLD_PX = 3;

/**
 * The drawing, with its walls draggable. A drag never touches the model: it works out the
 * new coordinate, rewrites the source, and the ordinary pipeline redraws — so what you see
 * is always a pure function of the text in the editor.
 */
export function Drawing({ svg, model, text, scale, stale, onDragStart, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);
  const drag = useRef<{
    d?: Draggable;
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

  // walls come from the derived model; outdoor spaces have none, so their own edges are
  // the handles. One map, keyed by whatever the element under the pointer carries.
  const wallHandles = draggableWalls(text, model);
  const handles = new Map<string, Draggable>([
    ...wallHandles,
    ...draggableOutdoorEdges(text, model),
    ...draggableFixtureEdges(text, model),
  ]);
  const bodies = movableFixtures(text, model);

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
      el.style.cursor = body ? "move" : d ? (d.axis === "v" ? "ew-resize" : "ns-resize") : "";
      if (d || body) el.dataset["draggable"] = "true";
      else delete el.dataset["draggable"];
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
    return projection(model, { scale }).toModel(p.x, p.y) as [number, number];
  };

  const along = (d: Draggable, m: [number, number]) => (d.axis === "v" ? m[0] : m[1]);

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
      offset: d ? along(d, m) - d.c : 0,
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
    const next = along(active.d, m) - active.offset;
    if (!active.moved) {
      if (Math.abs(next - active.d.c) * scale < THRESHOLD_PX) return; // a click is not a drag
      active.moved = true;
      onDragStart();
    }
    // always re-apply from where the gesture started, so moves cannot compound
    const out = applyDrag(active.startText, active.d, next, e.altKey);
    setHint(`${active.d.axis === "v" ? "x" : "y"} = ${(Math.round(next * 100) / 100).toFixed(2)} m · ${active.d.writes}`);
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
          {stale ?? hint ?? `${wallHandles.size}/${model.walls.length} walls · ${bodies.size} fixtures · drag to move, edges to resize`}
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
