// Shared types. Coordinates are metres on wall centrelines, y grows downwards
// (plan-view screen convention: north is up).

export type Pt = [number, number];
export type Side = "north" | "south" | "east" | "west";
export type Axis = "h" | "v";

/**
 * A curved edge of a ring, as the document authors it:
 * `{ "arc": [x, y], "r": 3.5, "sweep": "ccw" }` is *an arc from the previous corner to
 * [x, y], of radius r, turning that way*. The centre is derived and never stored, so
 * `r` can be edited on its own and the record cannot become inconsistent.
 */
export interface ArcSpec {
  /** radius, metres; at least half the chord */
  r: number;
  /** which way it turns, seen on the page (y grows south) */
  sweep: "cw" | "ccw";
  /** the arc subtends more than 180°; without it the minor arc is meant */
  large: boolean;
}

export type RoomKind =
  | "bedroom"
  | "living"
  | "kitchen"
  | "office"
  | "bath"
  | "wc"
  | "hall"
  | "corridor"
  | "storage"
  | "utility"
  | "garage"
  | "other";

export const HABITABLE_KINDS: ReadonlySet<RoomKind> = new Set(["bedroom", "living", "kitchen", "office"]);
export const WET_KINDS: ReadonlySet<RoomKind> = new Set(["bath", "wc"]);
export const CIRCULATION_KINDS: ReadonlySet<RoomKind> = new Set(["hall", "corridor"]);

// ---------- authored (after parse) ----------

/**
 * A closed boundary as the document authors it: corners, plus an optional arc on any
 * edge. `arcs[i]` curves the edge from `poly[i]` to `poly[i+1]`. A ring with no arcs is
 * exactly the polygon the library had before arcs existed, which is why `poly` keeps its
 * name and its indices — every cached document path into it still means what it meant.
 */
export interface Shape {
  poly: Pt[];
  arcs: Array<ArcSpec | undefined>;
}

/** Is any edge of this shape curved or off-axis? Decides which measures a room gets. */
export const isRectilinear = (s: Shape): boolean => {
  if (s.arcs.some((a) => a !== undefined)) return false;
  for (let i = 0; i < s.poly.length; i++) {
    const a = s.poly[i]!;
    const b = s.poly[(i + 1) % s.poly.length]!;
    if (a[0] !== b[0] && a[1] !== b[1]) return false;
  }
  return true;
};

export interface Room extends Shape {
  id: string;
  name: string;
  kind: RoomKind;
  zone: string | undefined;
  habitable: boolean;
  wet: boolean;
  circulation: boolean;
}

export interface Outdoor extends Shape {
  id: string;
  name: string;
  covered: boolean;
}

export type FixtureType =
  | "pool"
  | "bath"
  | "shower"
  | "wc"
  | "sink"
  | "counter"
  | "island"
  | "stairs"
  | "other";

/** A thing standing inside a room: sanitary ware, a kitchen run, a pool, stairs. */
export interface Fixture extends Shape {
  index: number; // position in the authored list, for error messages
  type: FixtureType;
  name: string;
  /** id of the room that contains it */
  in: string;
  /** pools only, metres */
  depth: number | undefined;
  /**
   * Set when this fixture is not authored in `fixtures` at all but stands for a `Vertical`
   * on this level. A stair is an obstacle exactly as a `stairs` fixture is, so it reuses
   * that machinery — but `index` then addresses nothing in the document, so an edit or a
   * finding must name the vertical element instead.
   */
  vertical: string | undefined;
}

export type OpeningType = "door" | "window" | "cased";
export type Jamb = "start" | "end";

export interface OpeningPosition {
  from: Jamb;
  distance: number; // metres from that jamb of the wall segment to the opening centre
}

export interface WallSelector {
  room: string;
  side: Side | undefined;
  near: Pt | undefined;
}

export interface Opening {
  index: number; // position in the authored list, for error messages
  type: OpeningType;
  between: [string, string]; // room ids, outdoor space ids, or the literal "exterior"
  on: WallSelector | undefined;
  position: "center" | OpeningPosition;
  /** absolute placement: [x, y] on the nearest wall between the two spaces in `between`.
   * Mutually exclusive with `on` and `position` — the selector that survives angled walls. */
  at: Pt | undefined;
  width: number;
  hinge: Jamb; // doors only
  swingInto: string; // doors only: one of the ids in `between`
  entrance: boolean; // doors only: marks the main entrance
  glazed: boolean; // doors only: a glazed door counts as daylight, same as a window
}

/**
 * A declared absence of floor on one level: a stairwell, a double-height room, the
 * underside of a cantilever. The dual of an `Outdoor` space, which is a declared absence
 * of roof — same mechanism, same owner union, so a cell inside the footprint that a void
 * covers is not a `tiling.gap`.
 */
export interface Void extends Shape {
  id: string;
  name: string;
}

/** One storey. Everything that is drawn lives on exactly one of these. */
export interface Level {
  id: string;
  name: string;
  /** floor to floor, metres; only `stair.pitch`/`stair.headroom` need it */
  height: number | undefined;
  /** the level the street meets. Exactly one by default: `stack[0]` */
  ground: boolean;
  rooms: Room[];
  outdoor: Outdoor[];
  voids: Void[];
  openings: Opening[];
  fixtures: Fixture[];
}

export type VerticalType = "stairs" | "lift" | "ramp";

/** One footprint of a vertical element, on one of the levels it serves. */
export interface VerticalAt extends Shape {
  level: string;
  /** the room or outdoor space you step off it into, on that level */
  in: string;
}

/**
 * Vertical circulation: the only entity that spans levels. Matched between levels by its
 * own `id` and never by footprint overlap — which is what lets `stair.misaligned` exist as
 * a rule at all, and what stops a lift and the duct beside it being silently joined.
 */
export interface Vertical {
  index: number; // position in the authored list, for error messages
  id: string;
  type: VerticalType;
  name: string;
  /** one footprint per level it serves, in stack order */
  at: VerticalAt[];
  /** bearing of travel upward, degrees clockwise from north */
  up: number | undefined;
  /** risers between the levels it joins: with `height`, gives going, pitch and headroom */
  risers: number | undefined;
}

export interface Plan {
  title: string | undefined;
  units: "m";
  walls: { exterior: number; partition: number };
  north: number; // degrees clockwise from up
  /**
   * Did the document author a `levels` block? A document without one is normalised to a
   * single level with the id GROUND_LEVEL, and this stays false — which is what keeps its
   * findings, its schedule and every document path byte-identical to a plan written
   * before levels existed. Nothing else may branch on the number of levels.
   */
  levelled: boolean;
  /** every level, ground-up: the authored `stack` order */
  levels: Level[];
  vertical: Vertical[];
  /** optional shared track grid; a level using it supplies only `layout.areas` */
  grid: { cols: number[]; rows: number[] } | undefined;
  // The ground (or only) level's collections, so a single-level consumer reads a Plan
  // exactly as it did before levels existed.
  rooms: Room[];
  outdoor: Outdoor[];
  openings: Opening[];
  fixtures: Fixture[];
}

/** The id a document with no `levels` block is normalised onto. */
export const GROUND_LEVEL = "ground";

// ---------- derived ----------

/**
 * Who owns a face of the arrangement. A tagged union rather than a widened string, so a
 * room whose id happens to be "exterior" can never be mistaken for the street and every
 * consumer has to say which kind of space it means.
 *
 * `overlap` is declared but not produced yet: a cell claimed by several rooms still takes
 * the first of them as its owner and the region is reported as `tiling.overlap`. The
 * variant is here so the planar-arrangement rewrite can start producing it without this
 * type changing under its consumers.
 */
export type Owner =
  | { kind: "room"; id: string }
  | { kind: "outdoor"; id: string }
  | { kind: "void"; id: string }
  | { kind: "exterior" }
  | { kind: "gap" }
  | { kind: "overlap"; ids: string[] };

export const EXTERIOR: Owner = { kind: "exterior" };
export const GAP: Owner = { kind: "gap" };
export const roomOwner = (id: string): Owner => ({ kind: "room", id });
export const outdoorOwner = (id: string): Owner => ({ kind: "outdoor", id });
export const voidOwner = (id: string): Owner => ({ kind: "void", id });

/** every owner kind that names a declared space in the document */
const DECLARED = new Set(["room", "outdoor", "void"]);

/** the space id an owner names, or undefined for the exterior, a gap or an overlap */
export const ownerId = (o: Owner): string | undefined => (DECLARED.has(o.kind) ? (o as { id: string }).id : undefined);

/** Stable key for maps and sets. Kinds are distinct, so a room "exterior" is not the street. */
export const ownerKey = (o: Owner): string =>
  DECLARED.has(o.kind)
    ? `${o.kind}:${(o as { id: string }).id}`
    : o.kind === "overlap"
      ? `overlap:${[...o.ids].sort().join("+")}`
      : o.kind;

export const sameOwner = (a: Owner, b: Owner): boolean => ownerKey(a) === ownerKey(b);

/**
 * Open sky above: the street, or a declared outdoor space.
 *
 * INVARIANT: this — not "is it the street" — is what makes a wall an exterior wall. A
 * courtyard wall faces open air and is built like any other outside wall, so it keeps
 * exterior thickness and a window onto a patio satisfies habitable.no_window instead of
 * tripping window.not_exterior. Access is a separate question: see isStreet.
 */
export const isOpenSky = (o: Owner): boolean => o.kind === "exterior" || o.kind === "outdoor";

/**
 * No floor and no roof: open sky, or an undeclared hole. Two of these never have a wall
 * between them.
 *
 * INVARIANT: a declared `void` is floorless but is NOT one of these, and deliberately so.
 * It has the building over it, so the wall beside a stairwell derives as a partition, the
 * envelope wall still runs past a double-height space that reaches the façade, and a
 * window onto a void is still `window.not_exterior`.
 */
export const isVoid = (o: Owner): boolean => isOpenSky(o) || o.kind === "gap";

/**
 * Does this side open onto the street: the exterior itself, or an outdoor space the
 * border flood fill reaches (see Model.streetOutdoor)? An enclosed courtyard does not.
 */
export const isStreet = (o: Owner, streetOutdoor: ReadonlySet<string>): boolean =>
  o.kind === "exterior" || (o.kind === "outdoor" && streetOutdoor.has(o.id));

/** The exact shape of a wall, between its two ends. */
export type WallGeometry =
  | { kind: "segment"; a: Pt; b: Pt }
  | {
      kind: "arc";
      a: Pt;
      b: Pt;
      /** metres */
      r: number;
      sweep: "cw" | "ccw";
      large: boolean;
      centre: Pt;
    }
  /** straight and curved pieces that run smoothly into one another: one wall, several arcs */
  | { kind: "chain"; parts: WallGeometry[] };

/**
 * A run of built wall between two spaces.
 *
 * INVARIANT: `neg` is the space on the **left** of the wall's canonical direction, `pos`
 * the one on its right. The canonical direction is the one pointing east, or north when
 * the wall is vertical — `dx > 0, or dx = 0 and dy < 0`. For an axis-aligned wall that
 * reproduces the old convention exactly, `neg` = north for a horizontal wall and west for
 * a vertical one, which is what `sideOf`, the door swing, the window glazing and the
 * entrance tag all read.
 *
 * The design doc's migration note says lexicographic order on the endpoints reproduces
 * that convention (docs/gaps-design.md §1.3.1). It does not: under one handedness,
 * lexicographic order gives `neg` = north for a horizontal wall and **east** for a
 * vertical one. The old convention is "the side with the smaller coordinate", which is
 * not a fixed handedness at all, so the generalisation has to pick the direction rather
 * than the endpoint order — hence the rule above.
 *
 * `from`/`to` are the wall's own 1-D parameter, and are **not** tied to that direction:
 * for an axis-aligned wall they stay the coordinate along its axis, ascending, because
 * every opening's `position` and every message quoting a wall already means that.
 * Elsewhere they run 0 … `length` from `start`.
 */
export interface Wall {
  id: string;
  kind: "exterior" | "partition";
  thickness: number;
  geometry: WallGeometry;
  /** the ends, in the canonical direction */
  start: Pt;
  end: Pt;
  /** arc length, metres */
  length: number;
  from: number;
  to: number;
  /** owner on the left of the canonical direction (north for h, west for v) */
  neg: Owner;
  /** owner on its right (south for h, east for v) */
  pos: Owner;
  /** set only when the wall is a straight axis-parallel segment */
  axis?: Axis;
  /** fixed coordinate of an axis-aligned wall: y for horizontal, x for vertical */
  c?: number;
}

/** The name the library used while every wall was an axis-parallel segment. */
export type WallSegment = Wall;

export interface ResolvedOpening {
  spec: Opening;
  wall: Wall;
  /** interval along the wall axis, metres */
  from: number;
  to: number;
  center: Pt;
  /** doors only */
  hinge: Pt | undefined;
  /** doors only: id of the space the leaf sweeps into */
  swingRoom: string | undefined;
}

export interface RoomModel {
  room: Room;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** shoelace area of the centreline polygon */
  area: number;
  /** the ring brought in to the faces of the walls along it: the floor you can stand on */
  clearRing: Shape;
  /** area of clearRing */
  clearArea: number;
  /** largest rectangle of unoccupied floor, on centrelines, in the room's own frame */
  largestRect: { x0: number; y0: number; x1: number; y1: number };
  /** largestRect brought in to the wall faces: the floor you can actually stand in */
  clearRect: { x0: number; y0: number; x1: number; y1: number; w: number; h: number };
  /** bearing of the room's own frame, degrees clockwise from east; 0 for a rectilinear room */
  bearing: number;
  /**
   * The largest circle that fits in the clear floor. Rotation-invariant and defined for
   * a curved room, which is what makes it the narrowness measure a rectangle cannot be.
   */
  inscribed: { at: Pt; r: number };
  /**
   * How narrow the room is. For a rectilinear room this is the short side of
   * `clearRect` — the measure the library has always printed, unchanged to the
   * millimetre. For a room with an angled or curved wall it is `2 × inscribed.r`,
   * because an axis-aligned rectangle understates a round room by a factor of √2
   * (docs/gaps-design.md §1.3.5, finding 6) and no rectangle describes the fit.
   */
  minDimension: number;
  labelAt: Pt;
  exteriorWindow: boolean;
  exteriorFaces: Side[];
  /** floor taken by fixtures standing in this room */
  fixtureArea: number;
  /** clearArea less fixtureArea: floor you can actually stand on */
  usableArea: number;
}

export interface FixtureModel {
  fixture: Fixture;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  area: number;
}

/** One level, derived. Everything here is computed from that level alone. */
export interface LevelModel {
  level: Level;
  rooms: RoomModel[];
  walls: Wall[];
  openings: ResolvedOpening[];
  /** authored fixtures, plus one per `Vertical` standing on this level */
  fixtures: FixtureModel[];
  /**
   * The level's outline and bounding box. `outline` is the real boundary of the floor
   * plate — one ring per connected piece — which is what the ghost layer under an upper
   * level needs and what a bbox cannot give.
   */
  envelope: { x0: number; y0: number; x1: number; y1: number; area: number; outline: Pt[][] };
  /**
   * Access graph within this level, keyed by `ownerKey(owner)`: every room, every outdoor
   * space and the street ("exterior") is a node; doors and cased openings are the edges.
   */
  access: Map<string, Set<string>>;
  /**
   * Ids of the outdoor spaces the border flood fill reaches — open sky you can walk to
   * from the street. A deck on the boundary is in; an enclosed courtyard is not.
   */
  streetOutdoor: ReadonlySet<string>;
  interiorArea: number;
  /**
   * The regions the arrangement found, each with exactly one owner. A consumer that
   * wants the truth about an overlap — which faces are claimed twice, and by whom —
   * reads these; the walls do not (see `wallOwner` in derive.ts).
   */
  faces: FaceModel[];
}

/** One region of the plan, with its owner. */
export interface FaceModel {
  owner: Owner;
  /** m² */
  area: number;
  /** a point inside it, as far from its boundary as the face allows */
  at: Pt;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** boundary rings, outer first */
  rings: Pt[][];
}

/**
 * The whole building. Its own `rooms`, `walls`, `openings`, `fixtures`, `envelope`,
 * `access`, `streetOutdoor` and `interiorArea` are the **ground level's**, so a
 * single-level plan reads exactly as it did before levels existed; `levels` holds every
 * storey and `building` holds what only exists across them.
 */
export interface Model extends LevelModel {
  plan: Plan;
  /** every level, ground-up */
  levels: LevelModel[];
  building: {
    /**
     * The combined access graph. Nodes are `${levelId}/${ownerKey(owner)}` except the
     * street, which is the single node "exterior" however many levels reach it; each
     * vertical element joins the nodes of the levels it serves.
     */
    access: Map<string, Set<string>>;
    /** the levels' footprints, unioned per level then summed: gross floor area */
    grossArea: number;
    /** the largest single level footprint: what the building stands on */
    footprint: number;
    storeys: number;
  };
}

export type Severity = "error" | "warning" | "info";

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /**
   * Which level produced it. Absent on a building-wide finding, and absent on *every*
   * finding of a document that did not author `levels` — a single-level plan's findings
   * are byte-identical to what they were before levels existed.
   */
  level?: string;
  at?: Pt;
  rooms?: string[];
  opening?: number;
  fixture?: number;
  /** id of the vertical element a stair rule is about */
  vertical?: string;
}

export interface Analysis {
  model: Model;
  findings: Finding[];
}
