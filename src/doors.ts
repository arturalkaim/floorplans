import { snap } from "./geometry.ts";
import type { BBox } from "./geometry.ts";
import type { Pt, ResolvedOpening } from "./types.ts";

export interface DoorSwing {
  hinge: Pt;
  /** closed leaf tip: the other jamb */
  closed: Pt;
  /** open leaf tip: 90° into the swing room */
  open: Pt;
  /** SVG arc sweep flag from closed to open (screen coordinates, y down) */
  sweep: 0 | 1;
  /** bounding box of the quarter-disc swept by the leaf */
  box: BBox;
}

/** Geometry of a door leaf opened 90° into its swing room. Undefined for non-doors. */
export function doorSwing(o: ResolvedOpening): DoorSwing | undefined {
  if (!o.hinge || o.swingRoom === undefined) return undefined;
  const w = o.wall;
  const width = o.to - o.from;
  const hingeAtStart = o.spec.hinge === "start";
  // unit vector along the wall toward the other jamb, and normal into the swing room
  const along: Pt = w.axis === "h" ? [hingeAtStart ? 1 : -1, 0] : [0, hingeAtStart ? 1 : -1];
  const intoPos = o.swingRoom === w.pos;
  const normal: Pt = w.axis === "h" ? [0, intoPos ? 1 : -1] : [intoPos ? 1 : -1, 0];
  const [hx, hy] = o.hinge;
  const closed: Pt = [snap(hx + along[0] * width), snap(hy + along[1] * width)];
  const open: Pt = [snap(hx + normal[0] * width), snap(hy + normal[1] * width)];
  const cross = along[0] * normal[1] - along[1] * normal[0];
  return {
    hinge: o.hinge,
    closed,
    open,
    sweep: cross > 0 ? 1 : 0,
    box: {
      x0: Math.min(hx, closed[0], open[0]),
      y0: Math.min(hy, closed[1], open[1]),
      x1: Math.max(hx, closed[0], open[0]),
      y1: Math.max(hy, closed[1], open[1]),
    },
  };
}
