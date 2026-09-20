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
  // schema, produced by lint() from the issues parse() would have thrown. Every one is an
  // error and every one carries the issue's own document path, so a schema problem and a
  // geometry problem reach an agent through the same channel (docs/agent-review.md §B8).
  { id: "schema.syntax", severity: "error", catches: "the text is not JSON at all, or the document is not a JSON object" },
  { id: "schema.unknown_field", severity: "error", catches: "a key the schema does not have, with the nearest known key when there is one within two edits" },
  { id: "schema.missing", severity: "error", catches: "something required is absent: a room's geometry, a vertical element's id, a plan with no rooms" },
  { id: "schema.type", severity: "error", catches: "present but the wrong type, or a value outside a fixed vocabulary such as a room kind or a side" },
  { id: "schema.reference", severity: "error", catches: "names something that is not declared: a space, a level, a void used as if it were a room" },
  { id: "schema.geometry", severity: "error", catches: "a polygon or rectangle that cannot be a shape: too few corners, zero area, crossing edges, a space in several pieces" },
  { id: "schema.conflict", severity: "error", catches: "two mutually exclusive forms given together, or an id used twice: `poly` and `rect`, `at` and `on`" },

  // geometry and topology, produced by derive()
  { id: "tiling.gap", severity: "error", catches: "a hole in the plan: somewhere inside the footprint no room covers the floor (one finding per contiguous hole, however many cells it spans)" },
  { id: "tiling.overlap", severity: "error", catches: "two or more rooms claim the same area (one finding per contiguous overlap, however many cells it spans)" },
  { id: "wall.unresolved", severity: "error", catches: "an opening names two spaces that share no wall" },
  { id: "wall.ambiguous", severity: "error", catches: "the two spaces share several walls; say which with `on`, or `at` names a point equidistant from more than one — and `on.side` cannot name a wall that is not axis-aligned, where `at` must be used" },
  { id: "opening.off_wall", severity: "error", catches: "an opening's `at` point is farther from the nearest candidate wall than half its thickness plus a small tolerance" },
  { id: "opening.overflow", severity: "error", catches: "the opening is wider than the wall it sits on, at that position" },
  { id: "opening.collision", severity: "error", catches: "two openings overlap on the same wall" },
  { id: "opening.near_corner", severity: "warning", catches: "a sliver of wall under 0.1 m is left beside an opening" },
  { id: "fixture.outside_space", severity: "error", catches: "a fixture is not fully inside the room or outdoor space it names" },
  { id: "fixture.overlap", severity: "error", catches: "two fixtures in the same space collide" },
  { id: "outdoor.overlap", severity: "error", catches: "a room is built over an outdoor space, which is open sky" },
  { id: "geometry.sliver", severity: "info", catches: "a face smaller than 100 mm² that nothing covers: two edges meant to meet are a fraction apart, named with the spaces either side" },
  { id: "room.no_clear_floor", severity: "error", catches: "a room whose walls leave it no floor at all: the inward offset of its ring turns itself inside out" },
  { id: "arc.too_shallow", severity: "warning", catches: "an arc that bulges less than 5 mm past its chord: a straight edge written as a curve" },

  // semantics, produced by checkRules()
  { id: "window.not_exterior", severity: "error", catches: "a window sits on an interior wall" },
  { id: "entrance.missing", severity: "error", catches: "no door leads to the street: to `\"exterior\"`, or to an outdoor space the street reaches. A door onto an enclosed courtyard is allowed and does not count" },
  { id: "space.no_access", severity: "error", catches: "a room has no door or cased opening" },
  { id: "reach.unreachable", severity: "error", catches: "a room cannot be reached from the street, walking through rooms, through the outdoor spaces the street reaches, and up every stair, lift and ramp" },

  // levels and vertical circulation, produced by checkRules()
  { id: "level.unreachable", severity: "error", catches: "a level no stair, lift or ramp arrives on; the defining multi-level failure" },
  { id: "stair.no_arrival", severity: "error", catches: "a vertical element's footprint is not inside the space its `in` names on that level, or it stands on one level only and joins nothing" },
  { id: "stair.misaligned", severity: "warning", catches: "a vertical element's footprints on consecutive levels barely overlap, or do not overlap at all — it is not one shaft" },
  { id: "structure.over_open_sky", severity: "warning", catches: "a room stands over open sky on the level below — over no room, no covered outdoor space and no void: a cantilever, or a room that has lost its support" },
  { id: "stair.pitch", severity: "info", catches: "with `risers` and the level's `height`: the flight's pitch or going is outside the comfortable range", option: "stairPitch" },
  { id: "stair.headroom", severity: "info", catches: "with `risers`, `height` and `up`: the floor above stays closed too far up the flight to keep headroom", option: "minHeadroom" },
  { id: "entrance.not_ground", severity: "info", catches: "a door opens to the outside on a level the street does not meet; mark that level `\"ground\": true` if the site slopes" },
  { id: "habitable.no_window", severity: "warning", catches: "a living space has no daylight: no exterior window or glazed door" },
  { id: "wet.no_window", severity: "warning", catches: "a bathroom or WC has no window; plan extraction" },
  { id: "wet.opens_to_kitchen", severity: "warning", catches: "a WC door opens straight into a kitchen" },
  { id: "privacy.bedroom_through_route", severity: "warning", catches: "a bedroom lies on every path from the entrance to another bedroom: close its door and the second one cannot be reached. A door between two bedrooms is not enough on its own — a jack-and-jill pair that both open off the hall is deliberate, and quiet" },
  { id: "room.min_dimension", severity: "warning", catches: "a room is narrower than its kind wants — the short side of its largest clear rectangle, or, for a room with an angled or curved wall, the diameter of the largest circle that fits", option: "minDimension" },
  { id: "room.acute_corner", severity: "info", catches: "a corner under 25°: the mitred wall faces meet so far along each arm that the point of the room is wall rather than floor" },
  { id: "door.min_width", severity: "warning", catches: "a door is narrower than its role wants", option: "doorMinWidth" },
  { id: "fixture.clearance", severity: "warning", catches: "the gap between two fixtures is too narrow to walk through", option: "minClearance" },
  { id: "door.swing_hits_fixture", severity: "warning", catches: "a door leaf sweeps into a fixture; never fires for a sliding door, which has no leaf swing" },
  { id: "entrance.not_street", severity: "warning", catches: "a door marked `\"entrance\": true` does not lead to the street — it opens onto an enclosed courtyard, or onto another room" },
  { id: "circulation.share", severity: "info", catches: "halls and corridors take more of the interior than expected", option: "circulationShare" },
  { id: "privacy.bedroom_off_living", severity: "info", catches: "a bedroom opens directly off the living room" },
  { id: "entrance.multiple", severity: "info", catches: "more than one door leads outside" },
  { id: "door.swing_collision", severity: "info", catches: "two door leaves sweep the same corner" },
];

export const ruleById = (id: string): RuleDoc | undefined => RULES.find((r) => r.id === id);
