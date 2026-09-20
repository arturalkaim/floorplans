// Shared types. Coordinates are metres on wall centrelines, y grows downwards
// (plan-view screen convention: north is up).

export type Pt = [number, number];
export type Side = "north" | "south" | "east" | "west";
export type Axis = "h" | "v";

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

export interface Room {
  id: string;
  /** where in the document this room was authored: `rooms.sala`, `levels.piso1.rooms.sala` */
  path: string;
  /** the keys the document actually wrote on it; see `pathTo` */
  authored: readonly string[];
  name: string;
  kind: RoomKind;
  zone: string | undefined;
  poly: Pt[];
  habitable: boolean;
  wet: boolean;
  circulation: boolean;
}

export interface Outdoor {
  id: string;
  path: string;
  authored: readonly string[];
  name: string;
  poly: Pt[];
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
export interface Fixture {
  index: number; // position in the authored list, for error messages
  /**
   * Stable handle, and what a finding names. Authored `id`, or synthesised as
   * `<type>:<in>:<n>` where `n` counts earlier fixtures of the same type standing in the
   * same space — so deleting `fixtures[2]` renumbers only that group's later siblings,
   * never the whole list. A synthesised id always contains ":", which an authored id may
   * not (`^[a-z][a-z0-9_]*$`), so the two can never collide.
   */
  id: string;
  /** where in the document it was authored: `fixtures[2]`, `levels.piso1.fixtures[2]` */
  path: string;
  /** the keys the document actually wrote on it; see `pathTo` */
  authored: readonly string[];
  type: FixtureType;
  name: string;
  /** id of the room that contains it */
  in: string;
  poly: Pt[];
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
  /**
   * Stable handle, and what a finding names. Authored `id`, or synthesised as
   * `<type>:<a>-<b>:<n>` from the *sorted* pair in `between`, where `n` counts earlier
   * openings of the same type between the same pair — so deleting `openings[2]` renumbers
   * only its own pair's later siblings, and swapping `between` renames nothing. A
   * synthesised id always contains ":", which an authored id may not
   * (`^[a-z][a-z0-9_]*$`), so the two can never collide.
   */
  id: string;
  /** where in the document it was authored: `openings[3]`, `levels.piso1.openings[3]` */
  path: string;
  /** the keys the document actually wrote on it; see `pathTo` */
  authored: readonly string[];
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
export interface Void {
  id: string;
  path: string;
  authored: readonly string[];
  name: string;
  poly: Pt[];
}

/** One storey. Everything that is drawn lives on exactly one of these. */
export interface Level {
  id: string;
  /**
   * Where this level's content lives in the document: `""` for a document that never
   * authored `levels`, `levels.piso1` otherwise. Every path under it is built from this
   * prefix, which is what keeps a single-level document's paths byte-identical to the
   * ones it had before levels existed (docs/gaps-design.md §2.5).
   */
  path: string;
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
export interface VerticalAt {
  /**
   * `vertical[i].at[j]` with the **authored** j. The parser sorts `at` into stack order,
   * so the position in this array is not the position in the document; the path is
   * recorded where it was read instead of being recomputed from an index that moved.
   */
  path: string;
  level: string;
  /** the room or outdoor space you step off it into, on that level */
  in: string;
  poly: Pt[];
}

/**
 * Vertical circulation: the only entity that spans levels. Matched between levels by its
 * own `id` and never by footprint overlap — which is what lets `stair.misaligned` exist as
 * a rule at all, and what stops a lift and the duct beside it being silently joined.
 */
export interface Vertical {
  index: number; // position in the authored list, for error messages
  /** always `vertical[i]`: a vertical element spans levels, so it sits at the document root */
  path: string;
  /** the keys the document actually wrote on it; see `pathTo` */
  authored: readonly string[];
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

export interface WallSegment {
  id: string;
  axis: Axis;
  /** fixed coordinate: y for horizontal, x for vertical */
  c: number;
  from: number;
  to: number;
  /** owner on the negative side (north for h, west for v) and positive side (south / east) */
  neg: Owner;
  pos: Owner;
  kind: "exterior" | "partition";
  thickness: number;
}

export interface ResolvedOpening {
  spec: Opening;
  wall: WallSegment;
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
  /** area after deducting half the adjacent wall thickness on every edge */
  clearArea: number;
  /** largest axis-aligned rectangle of unoccupied floor, on centrelines */
  largestRect: { x0: number; y0: number; x1: number; y1: number };
  /** largestRect brought in to the wall faces: the floor you can actually stand in */
  clearRect: { x0: number; y0: number; x1: number; y1: number; w: number; h: number };
  /** short side of clearRect */
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
  walls: WallSegment[];
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

/** One of the wall segments `wall.ambiguous` had to choose between. */
export interface WallCandidate {
  /** the derived wall's id, as `walls` in the JSON output names it */
  wall: string;
  /** which side of the room the opening names it lies on, where that is meaningful */
  side?: Side;
  from: Pt;
  to: Pt;
}

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /**
   * The JSON path of the thing the rule is about — `openings[3]`, `rooms.sala`,
   * `levels.piso1.fixtures[2]`, `vertical[0].at[1]` — and, where the rule knows which
   * field is at fault *and the document actually wrote it*, the field: `openings[3].width`.
   *
   * INVARIANT: a path names a node that exists in the source document, or — when the
   * finding is about an *absence*, and names the collection a fix would be written into —
   * a node whose parent exists, so one `patch` `insert` creates it. It is never deeper
   * than that. This is why a field is only appended when the author wrote it: an opening
   * that let `position` default to "center" has no `position` node to splice, so its
   * findings stop at `openings[3]`.
   */
  path: string;
  /**
   * Which level produced it. Absent on a building-wide finding, and absent on *every*
   * finding of a document that did not author `levels` — a single-level plan's findings
   * are byte-identical to what they were before levels existed.
   */
  level?: string;
  at?: Pt;
  rooms?: string[];
  /** `Opening.id`, never an index: an index shifts when a sibling is deleted */
  opening?: string;
  /** `Fixture.id`, never an index */
  fixture?: string;
  /** id of the vertical element a stair rule is about */
  vertical?: string;
  /** `wall.ambiguous`: the segments the message lists, structured */
  candidates?: WallCandidate[];
  /** `room.min_dimension`: the short side measured, the minimum wanted, the clear floor */
  measured?: number;
  minimum?: number;
  /** `[x, y, width, height]` — the shape a room's `rect` shorthand takes, so it reads back */
  rect?: [number, number, number, number];
  /** `opening.off_wall`: the id of the nearest wall and how far the point is from it */
  nearest?: string;
  distance?: number;
}

/** A thing in the document that knows where it was written and what keys it carries. */
export interface Authored {
  path: string;
  authored: readonly string[];
}

/**
 * `e.path`, plus the first of `fields` the document actually authored on `e`.
 *
 * This is the whole of "derive the path from the parsed document, never from a template"
 * (docs/gaps-design.md §2.5): the parser records what it read, and a rule asks for the
 * field it cares about — `pathTo(room, "poly", "rect")` for a room's geometry, whichever
 * form the author chose — instead of guessing a key that may not be there.
 */
export const pathTo = (e: Authored, ...fields: string[]): string => {
  const f = fields.find((k) => e.authored.includes(k));
  return f === undefined ? e.path : `${e.path}.${f}`;
};

/** A path under one level's content: `openings` or `levels.piso1.openings`. */
export const inLevel = (level: { path: string }, suffix: string): string =>
  level.path === "" ? suffix : `${level.path}.${suffix}`;

export interface Analysis {
  model: Model;
  findings: Finding[];
}
