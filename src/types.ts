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
  between: [string, string]; // room ids, or "exterior"
  on: WallSelector | undefined;
  position: "center" | OpeningPosition;
  width: number;
  hinge: Jamb; // doors only
  swingInto: string; // doors only: room id or "exterior"
  entrance: boolean; // doors only: marks the main entrance
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

export type Owner = string | "exterior" | "gap";

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
  swingRoom: Owner | undefined;
}

export interface RoomModel {
  room: Room;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** shoelace area of the centreline polygon */
  area: number;
  /** area after deducting half the adjacent wall thickness on every edge */
  clearArea: number;
  /** largest axis-aligned rectangle fully inside the room */
  largestRect: { x0: number; y0: number; x1: number; y1: number };
  /** short side of largestRect */
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
  /** access graph: room id -> set of neighbouring room ids (or "exterior") through doors/cased openings */
  access: Map<string, Set<string>>;
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
