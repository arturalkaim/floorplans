import { applyDrag, draggableWalls, projection } from "floorplan";
import type { Draggable, Model } from "floorplan";
import { useEffect, useRef, useState } from "react";

interface Props {
  svg: string;
  model: Model;
  text: string;
  scale: number;
  /** called once per gesture, before the first change, so undo has one entry per drag */
  onDragStart: () => void;
  onChange: (next: string) => void;
}

/** how far the pointer must travel before a press becomes a drag, in screen pixels */
const THRESHOLD_PX = 3;

/**
 * The drawing, with its walls draggable. A drag never touches the model: it works out the
 * new coordinate, rewrites the source, and the ordinary pipeline redraws — so what you see
 * is always a pure function of the text in the editor.
 */
export function Drawing({ svg, model, text, scale, onDragStart, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);
  const drag = useRef<{
    d: Draggable;
    /** the document as it was when the gesture began: every move re-applies from here,
     *  so a drag is idempotent however many moves arrive */
    startText: string;
    /** where on the wall it was grabbed, so the wall moves with the pointer rather than
     *  jumping its centreline to it */
    offset: number;
    moved: boolean;
  } | null>(null);

  const walls = draggableWalls(text, model);

  useEffect(() => {
    const root = host.current?.querySelector("svg");
    if (!root) return;
    for (const el of root.querySelectorAll<SVGElement>("[data-wall]")) {
      const d = walls.get(el.dataset["wall"]!);
      el.style.cursor = d ? (d.axis === "v" ? "ew-resize" : "ns-resize") : "";
      el.style.pointerEvents = "stroke";
      if (d) el.dataset["draggable"] = "true";
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
    const d = walls.get((e.target as SVGElement).dataset?.["wall"] ?? "");
    if (!d || e.button !== 0) return;
    const m = toMetres(e.clientX, e.clientY);
    if (!m) return;
    e.preventDefault();
    // capture on the container, which survives every redraw, not on the line
    host.current?.setPointerCapture(e.pointerId);
    drag.current = { d, startText: text, offset: along(d, m) - d.c, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const active = drag.current;
    if (!active) {
      const d = walls.get((e.target as SVGElement).dataset?.["wall"] ?? "");
      setHint(d ? `drag to move · writes ${d.writes}` : null);
      return;
    }
    const m = toMetres(e.clientX, e.clientY);
    if (!m) return;
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
        <span className="note">{hint ?? `${walls.size} of ${model.walls.length} walls draggable`}</span>
      </div>
      <div
        ref={host}
        className="sheet-body"
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
