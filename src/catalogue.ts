// The rule catalogue. This is the source the documentation reads, so a rule cannot be
// added, renamed or re-graded without the docs following: catalogue.test.ts fails when
// the ids here and the ids emitted by src/ disagree.
import type { Severity } from "./types.ts";

export interface RuleDoc {
  id: string;
  severity: Severity;
  /** what it catches, in one line */
  catches: string;
  /** the option on analyze(plan, rules) that moves the threshold, if any */
  option?: string;
}

export const RULES: readonly RuleDoc[] = [
  // geometry and topology, produced by derive()
  { id: "tiling.gap", severity: "error", catches: "a hole in the plan: somewhere inside the footprint no room covers the floor (one finding per contiguous hole, however many cells it spans)" },
  { id: "tiling.overlap", severity: "error", catches: "two or more rooms claim the same area (one finding per contiguous overlap, however many cells it spans)" },
  { id: "wall.unresolved", severity: "error", catches: "an opening names two spaces that share no wall" },
  { id: "wall.ambiguous", severity: "error", catches: "the two spaces share several walls; say which with `on`" },
  { id: "opening.overflow", severity: "error", catches: "the opening is wider than the wall it sits on, at that position" },
  { id: "opening.collision", severity: "error", catches: "two openings overlap on the same wall" },
  { id: "opening.near_corner", severity: "warning", catches: "a sliver of wall under 0.1 m is left beside an opening" },
  { id: "fixture.outside_space", severity: "error", catches: "a fixture is not fully inside the room or outdoor space it names" },
  { id: "fixture.overlap", severity: "error", catches: "two fixtures in the same space collide" },
  { id: "outdoor.overlap", severity: "error", catches: "a room is built over an outdoor space, which is open sky" },

  // semantics, produced by checkRules()
  { id: "window.not_exterior", severity: "error", catches: "a window sits on an interior wall" },
  { id: "entrance.missing", severity: "error", catches: "no door leads to the street: to `\"exterior\"`, or to an outdoor space the street reaches. A door onto an enclosed courtyard is allowed and does not count" },
  { id: "space.no_access", severity: "error", catches: "a room has no door or cased opening" },
  { id: "reach.unreachable", severity: "error", catches: "a room cannot be reached from the street, walking through rooms and through the outdoor spaces the street reaches" },
  { id: "habitable.no_window", severity: "warning", catches: "a living space has no daylight" },
  { id: "wet.no_window", severity: "warning", catches: "a bathroom or WC has no window; plan extraction" },
  { id: "wet.opens_to_kitchen", severity: "warning", catches: "a WC door opens straight into a kitchen" },
  { id: "privacy.bedroom_through_route", severity: "warning", catches: "a bedroom is the route to another bedroom" },
  { id: "room.min_dimension", severity: "warning", catches: "a room is narrower than its kind wants, measured between the wall faces and clear of fixtures", option: "minDimension" },
  { id: "door.min_width", severity: "warning", catches: "a door is narrower than its role wants", option: "doorMinWidth" },
  { id: "fixture.clearance", severity: "warning", catches: "the gap between two fixtures is too narrow to walk through", option: "minClearance" },
  { id: "door.swing_hits_fixture", severity: "warning", catches: "a door leaf sweeps into a fixture" },
  { id: "entrance.not_street", severity: "warning", catches: "a door marked `\"entrance\": true` does not lead to the street — it opens onto an enclosed courtyard, or onto another room" },
  { id: "circulation.share", severity: "info", catches: "halls and corridors take more of the interior than expected", option: "circulationShare" },
  { id: "privacy.bedroom_off_living", severity: "info", catches: "a bedroom opens directly off the living room" },
  { id: "entrance.multiple", severity: "info", catches: "more than one door leads outside" },
  { id: "door.swing_collision", severity: "info", catches: "two door leaves sweep the same corner" },
];

export const ruleById = (id: string): RuleDoc | undefined => RULES.find((r) => r.id === id);
