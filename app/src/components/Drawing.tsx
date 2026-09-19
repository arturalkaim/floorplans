import { projection } from "floorplan";
import type { Model } from "floorplan";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyDrag, draggableWalls } from "floorplan";
import type { Draggable } from "floorplan";

interface Props {
  svg: string;
  model: Model;
  text: string;
  scale: number;
  onChange: (next: string) => void;
}

/**
 * The drawing, with its walls draggable. A drag never touches the model: it works out
 * the new coordinate, rewrites the source, and the ordinary pipeline redraws — so what
 * you see is always a pure function of the text in the editor.
 */
export function Drawing({ svg, model, text, scale, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);
  // the drag in flight, kept in a ref so pointermove never re-subscribes
  const drag = useRef<{ d: Draggable; svg: SVGSVGElement } | null>(null);

  const walls = draggableWalls(text, model);

  // mark what can be grabbed, after every redraw
  useEffect(() => {
    const root = host.current?.querySelector("svg");
    if (!root) return;
    for (const el of root.querySelectorAll<SVGElement>("[data-wall]")) {
      const id = el.dataset["wall"]!;
      const d = walls.get(id);
      el.style.cursor = d ? (d.axis === "v" ? "ew-resize" : "ns-resize") : "";
      el.style.pointerEvents = "stroke";
      if (d) el.dataset["draggable"] = "true";
      else delete el.dataset["draggable"];
    }
  }, [svg, text]);

  /** client pixels to metres, through the SVG's own transform so CSS scaling is handled */
  const toMetres = useCallback(
    (root: SVGSVGElement, clientX: number, clientY: number) => {
      const ctm = root.getScreenCTM();
      if (!ctm) return null;
      const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return projection(model, { scale }).toModel(pt.x, pt.y);
    },
    [model, scale],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as SVGElement;
    const id = target.dataset?.["wall"];
    const d = id ? walls.get(id) : undefined;
    if (!d) return;
    const root = host.current?.querySelector("svg");
    if (!root) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { d, svg: root };
    setHint(`${d.axis === "v" ? "x" : "y"} = ${d.c} m · writes ${d.writes}`);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const active = drag.current;
    if (!active) {
      const d = walls.get((e.target as SVGElement).dataset?.["wall"] ?? "");
      setHint(d ? `drag to move · writes ${d.writes}` : null);
      return;
    }
    const m = toMetres(active.svg, e.clientX, e.clientY);
    if (!m) return;
    const wanted = active.d.axis === "v" ? m[0] : m[1];
    const next = applyDrag(text, active.d, wanted, e.altKey);
    setHint(`${active.d.axis === "v" ? "x" : "y"} = ${Math.round(wanted * 100) / 100} m · ${active.d.writes}`);
    if (next !== text) onChange(next);
  };

  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
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
