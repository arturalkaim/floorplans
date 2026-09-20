// floorplan — declarative floor-plan renderer and linter.
//
//   const plan = parse(json);                 // throws PlanError on schema problems
//   const { model, findings } = analyze(plan); // geometry + rules, never throws
//   const svg = renderSvg(model, { findings });
//
// or in one go: floorplan(json) → { plan, model, findings, svg, schedule }

import { derive } from "./derive.ts";
import { polyInside, shoelace } from "./geometry.ts";
import { parse, PlanError } from "./parse.ts";
import { checkRules, sortFindings } from "./rules.ts";
import { renderSvg } from "./svg.ts";
import type { Analysis, Finding, Model, Plan, Severity } from "./types.ts";
import type { RuleOptions } from "./rules.ts";
import type { RenderOptions } from "./svg.ts";

export { parse, PlanError, derive, checkRules, renderSvg, sortFindings };
// the parser's own vocabularies, so documentation cannot drift from what it accepts
export { FIXTURE_TYPES, OPENING_TYPES, ROOM_KINDS, SIDES } from "./parse.ts";
export { RULES, ruleById } from "./catalogue.ts";
// owner classes: rooms, outdoor spaces, the street and holes, plus the predicates that
// tell them apart — a consumer reading model.walls or model.access needs these
export { EXTERIOR, GAP, isOpenSky, isStreet, isVoid, outdoorOwner, ownerId, ownerKey, roomOwner, sameOwner } from "./types.ts";
export {
  applyDrag,
  applyMove,
  draggableFixtureEdges,
  draggableOutdoorEdges,
  draggableWalls,
  movableFixtures,
} from "./edit.ts";
export type { Draggable, Movable } from "./edit.ts";
export { projection } from "./svg.ts";
export type { Projection } from "./svg.ts";
export type { RuleDoc } from "./catalogue.ts";
// authoring support: keep a document canonical, and edit one value in place
export { formatPlan, formatText } from "./format.ts";
export { JsonPosError, metres, nodeAt, parseWithPositions, pathToString, spliceAll, spliceAt } from "./jsonpos.ts";
export type { FormatOptions } from "./format.ts";
export type { JsonKind, JsonNode, JsonPath } from "./jsonpos.ts";
export type * from "./types.ts";
export type { PlanIssue } from "./parse.ts";
export type { RuleOptions } from "./rules.ts";
export type { RenderOptions } from "./svg.ts";

/** Derive geometry and run every rule. Findings are sorted error → warning → info. */
export function analyze(plan: Plan, rules: RuleOptions = {}): Analysis {
  const { model, findings } = derive(plan);
  return { model, findings: sortFindings([...findings, ...checkRules(model, rules)]) };
}

export interface ScheduleRow {
  id: string;
  name: string;
  kind: string;
  zone: string | undefined;
  /** centreline polygon area, m² */
  area: number;
  /** area net of half the bounding walls, m² */
  clearArea: number;
  /** floor taken by fixtures standing in the room, m² */
  fixtureArea: number;
  /** clearArea less fixtureArea: floor you can stand on, m² */
  usableArea: number;
}

export interface Schedule {
  rooms: ScheduleRow[];
  interiorArea: number;
  interiorClearArea: number;
  footprint: number;
  /** total pool surface, m² */
  waterArea: number;
  outdoor: Array<{
    id: string;
    name: string;
    area: number;
    /** floor taken by fixtures standing in this outdoor space, m² */
    fixtureArea: number;
    /** area less fixtureArea: a deck net of its pool */
    usableArea: number;
    covered: boolean;
    /** can you walk here from the street? false for an enclosed courtyard */
    streetConnected: boolean;
  }>;
}

export function schedule(model: Model): Schedule {
  const rooms = model.rooms.map((m) => ({
    id: m.room.id,
    name: m.room.name,
    kind: m.room.kind,
    zone: m.room.zone,
    area: m.area,
    clearArea: m.clearArea,
    fixtureArea: m.fixtureArea,
    usableArea: m.usableArea,
  }));
  return {
    rooms,
    interiorArea: model.interiorArea,
    interiorClearArea: Math.round(rooms.reduce((s, r) => s + r.clearArea, 0) * 1000) / 1000,
    footprint: model.envelope.area,
    waterArea: Math.round(model.fixtures.filter((f) => f.fixture.type === "pool").reduce((s, f) => s + f.area, 0) * 1000) / 1000,
    outdoor: model.plan.outdoor.map((o) => {
      const area = Math.abs(polyArea(o.poly));
      // INVARIANT: deducts only fixtures fully contained in the outdoor space's own polygon
      // (D3, same stopgap as RoomModel.fixtureArea in derive.ts) — one straddling the
      // boundary deducts nothing here, and fixture.outside_space already told the author
      // why. The exact intersection waits for the geometry core (docs/gaps-design.md
      // §1.3.2).
      const fixtureArea =
        Math.round(
          model.fixtures
            .filter((f) => f.fixture.in === o.id && polyInside(f.fixture.poly, o.poly))
            .reduce((s, f) => s + f.area, 0) * 1000,
        ) / 1000;
      return {
        id: o.id,
        name: o.name,
        area,
        fixtureArea,
        usableArea: Math.round(Math.max(0, area - fixtureArea) * 1000) / 1000,
        covered: o.covered,
        streetConnected: model.streetOutdoor.has(o.id),
      };
    }),
  };
}

export interface FloorplanResult {
  plan: Plan;
  model: Model;
  findings: Finding[];
  svg: string;
  schedule: Schedule;
}

export interface FloorplanOptions {
  render?: RenderOptions;
  rules?: RuleOptions;
  /** draw markers for findings at or above this severity (default: "warning") */
  markFindings?: Severity | "none";
}

/** Everything in one call. Throws PlanError only for schema problems. */
export function floorplan(input: unknown, opts: FloorplanOptions = {}): FloorplanResult {
  const plan = parse(input);
  const { model, findings } = analyze(plan, opts.rules);
  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const mark = opts.markFindings ?? "warning";
  const marked = mark === "none" ? [] : findings.filter((f) => rank[f.severity] <= rank[mark]);
  const svg = renderSvg(model, { ...opts.render, findings: marked });
  return { plan, model, findings, svg, schedule: schedule(model) };
}

export function worstSeverity(findings: Finding[]): Severity | undefined {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.length) return "info";
  return undefined;
}

const polyArea = (poly: Array<[number, number]>): number => Math.round(shoelace(poly) * 1000) / 1000;
