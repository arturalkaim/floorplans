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
  type: FixtureType;
  name: string;
  /** id of the room that contains it */
  in: string;
  poly: Pt[];
  /** pools only, metres */
  depth: number | undefined;
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

export interface Plan {
  title: string | undefined;
  units: "m";
  walls: { exterior: number; partition: number };
  north: number; // degrees clockwise from up
  rooms: Room[];
  outdoor: Outdoor[];
  openings: Opening[];
  fixtures: Fixture[];
}

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
  | { kind: "exterior" }
  | { kind: "gap" }
  | { kind: "overlap"; ids: string[] };

export const EXTERIOR: Owner = { kind: "exterior" };
export const GAP: Owner = { kind: "gap" };
export const roomOwner = (id: string): Owner => ({ kind: "room", id });
export const outdoorOwner = (id: string): Owner => ({ kind: "outdoor", id });

/** the space id an owner names, or undefined for the exterior, a gap or an overlap */
export const ownerId = (o: Owner): string | undefined => (o.kind === "room" || o.kind === "outdoor" ? o.id : undefined);

/** Stable key for maps and sets. Kinds are distinct, so a room "exterior" is not the street. */
export const ownerKey = (o: Owner): string =>
  o.kind === "room" || o.kind === "outdoor"
    ? `${o.kind}:${o.id}`
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

/** No floor: open sky, or an undeclared hole. Two voids never have a wall between them. */
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

export interface Model {
  plan: Plan;
  rooms: RoomModel[];
  walls: WallSegment[];
  openings: ResolvedOpening[];
  fixtures: FixtureModel[];
  envelope: { x0: number; y0: number; x1: number; y1: number; area: number };
  /**
   * Access graph, keyed by `ownerKey(owner)`: every room, every outdoor space and the
   * street ("exterior") is a node; doors and cased openings are the edges.
   */
  access: Map<string, Set<string>>;
  /**
   * Ids of the outdoor spaces the border flood fill reaches — open sky you can walk to
   * from the street. A deck on the boundary is in; an enclosed courtyard is not.
   */
  streetOutdoor: ReadonlySet<string>;
  interiorArea: number;
}

export type Severity = "error" | "warning" | "info";

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  at?: Pt;
  rooms?: string[];
  opening?: number;
  fixture?: number;
}

export interface Analysis {
  model: Model;
  findings: Finding[];
}
