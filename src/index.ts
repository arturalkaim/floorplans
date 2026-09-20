// floorplan — declarative floor-plan renderer and linter.
//
//   const plan = parse(json);                 // throws PlanError on schema problems
//   const { model, findings } = analyze(plan); // geometry + rules, never throws
//   const svg = renderSvg(model, { findings });
//
// or in one go: floorplan(json) → { plan, model, findings, svg, levels, schedule }
//
// and, for a caller that wants every problem a document can have through one channel and
// no exceptions at all: lint(json) → { findings, plan?, model? }, where a schema problem
// is a `schema.*` finding carrying the same document path a geometry finding carries.

import { derive, pointOn } from "./derive.ts";
import { polyInside, shoelace } from "./geometry.ts";
import { parse, PlanError } from "./parse.ts";
import { DslError, lineOf, readSource } from "./dsl.ts";
import type { DslPositions } from "./dsl.ts";
import { checkRules, sortFindings } from "./rules.ts";
import { renderSvg } from "./svg.ts";
import type { Analysis, Finding, LevelModel, Model, Owner, Plan, Pt, Severity } from "./types.ts";
import type { IssueKind } from "./parse.ts";
import type { RuleOptions } from "./rules.ts";
import type { RenderOptions } from "./svg.ts";

export { parse, PlanError, derive, checkRules, renderSvg, sortFindings };
// the parser's own vocabularies, so documentation cannot drift from what it accepts
export { FIXTURE_TYPES, OPENING_TYPES, ROOM_KINDS, SIDES, VERTICAL_TYPES } from "./parse.ts";
// the parser's own field table, so documentation cannot drift from what it accepts either —
// `floorplan --schema` prints this
export { SCHEMA } from "./parse.ts";
export type { FieldDoc, ObjectDoc } from "./parse.ts";
export { RULES, ruleById } from "./catalogue.ts";
// owner classes: rooms, outdoor spaces, the street and holes, plus the predicates that
// tell them apart — a consumer reading model.walls or model.access needs these
export { EXTERIOR, GAP, GROUND_LEVEL, inLevel, isOpenSky, isStreet, isVoid, outdoorOwner, ownerId, ownerKey, pathTo, roomOwner, sameOwner, voidOwner } from "./types.ts";
export {
  applyDrag,
  applyMove,
  draggableFixtureEdges,
  draggableOutdoorEdges,
  draggableWalls,
  movableFixtures,
} from "./edit.ts";
export type { Draggable, Movable } from "./edit.ts";
export { levelOf, projection } from "./svg.ts";
export type { Projection } from "./svg.ts";
export type { RuleDoc } from "./catalogue.ts";
// authoring support: keep a document canonical, and edit one value in place
export { formatPlan, formatText } from "./format.ts";
// the line DSL: the authoring front-end, and its grammar as data
export { ARC_SYNTAX, DSL_SCHEMA, DslError, DslPosError, dslSchemaText, dslSpliceAll, dslSpliceAt, isDslText, lineOf, parseDsl, readSource, toDsl } from "./dsl.ts";
export type { DslDocument, DslIssue, DslPositions, DslSpan, DslStatementDoc, DslTokenDoc } from "./dsl.ts";
export {
  appendAt,
  insertKey,
  JsonPosError,
  metres,
  nodeAt,
  parseWithPositions,
  pathToString,
  removeAt,
  spliceAll,
  spliceAt,
} from "./jsonpos.ts";
export type { FormatOptions } from "./format.ts";
export type { JsonKind, JsonNode, JsonPath } from "./jsonpos.ts";
export type * from "./types.ts";
export type { IssueKind, PlanIssue } from "./parse.ts";
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

export interface OutdoorRow {
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
}

/** One storey's numbers. The same shape a single-level schedule has always had. */
export interface LevelSchedule {
  rooms: ScheduleRow[];
  interiorArea: number;
  interiorClearArea: number;
  footprint: number;
  /** total pool surface, m² */
  waterArea: number;
  outdoor: OutdoorRow[];
}

export interface Schedule extends LevelSchedule {
  /**
   * Per level, ground-up, and the building's totals — present only on a document that
   * authored `levels`. A single-level plan's schedule is byte-identical to what it was
   * before levels existed, and the top-level numbers are always the ground level's.
   */
  levels?: Array<{ id: string; name: string } & LevelSchedule>;
  building?: {
    storeys: number;
    /** every level's floor plate summed: gross floor area, m² */
    grossArea: number;
    /** the largest single plate: what the building stands on, m² */
    footprint: number;
    interiorArea: number;
    interiorClearArea: number;
    waterArea: number;
  };
}

function levelSchedule(lm: LevelModel): LevelSchedule {
  const rooms = lm.rooms.map((m) => ({
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
    interiorArea: lm.interiorArea,
    interiorClearArea: round(rooms.reduce((s, r) => s + r.clearArea, 0)),
    footprint: lm.envelope.area,
    waterArea: round(lm.fixtures.filter((f) => f.fixture.type === "pool").reduce((s, f) => s + f.area, 0)),
    outdoor: lm.level.outdoor.map((o) => {
      const area = Math.abs(polyArea(o.poly));
      // INVARIANT: deducts only fixtures fully contained in the outdoor space's own polygon
      // (D3, same stopgap as RoomModel.fixtureArea in derive.ts) — one straddling the
      // boundary deducts nothing here, and fixture.outside_space already told the author
      // why. The exact intersection waits for the geometry core (docs/gaps-design.md
      // §1.3.2).
      const fixtureArea = round(
        lm.fixtures
          .filter((f) => f.fixture.in === o.id && polyInside(f.fixture.poly, o.poly))
          .reduce((s, f) => s + f.area, 0),
      );
      return {
        id: o.id,
        name: o.name,
        area,
        fixtureArea,
        usableArea: round(Math.max(0, area - fixtureArea)),
        covered: o.covered,
        streetConnected: lm.streetOutdoor.has(o.id),
      };
    }),
  };
}

export function schedule(model: Model): Schedule {
  const ground = levelSchedule(model);
  if (!model.plan.levelled) return ground;
  const levels = model.levels.map((lm) => ({ id: lm.level.id, name: lm.level.name, ...levelSchedule(lm) }));
  return {
    ...ground,
    levels,
    building: {
      storeys: model.building.storeys,
      grossArea: model.building.grossArea,
      footprint: model.building.footprint,
      interiorArea: round(levels.reduce((s, l) => s + l.interiorArea, 0)),
      interiorClearArea: round(levels.reduce((s, l) => s + l.interiorClearArea, 0)),
      waterArea: round(levels.reduce((s, l) => s + l.waterArea, 0)),
    },
  };
}

export interface FloorplanResult {
  plan: Plan;
  model: Model;
  findings: Finding[];
  /**
   * The ground (or only) level's drawing, so a single-level caller is unchanged. Use
   * `levels` to reach the others.
   */
  svg: string;
  /** every level, ground-up, each with its own drawing and its own findings */
  levels: Array<{ id: string; name: string; svg: string; findings: Finding[] }>;
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
  const src = source(input);
  const plan = parse(src.doc);
  const { model, findings: raw } = analyze(plan, opts.rules);
  const findings = withLines(raw, src.positions);
  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const mark = opts.markFindings ?? "warning";
  const marked = mark === "none" ? [] : findings.filter((f) => rank[f.severity] <= rank[mark]);
  const levels = model.levels.map((lm) => {
    // A finding with no level is building-wide, so it belongs on every sheet.
    const mine = findings.filter((f) => f.level === undefined || f.level === lm.level.id);
    return {
      id: lm.level.id,
      name: lm.level.name,
      svg: renderSvg(model, { ...opts.render, level: lm.level.id, findings: marked.filter((f) => f.level === undefined || f.level === lm.level.id) }),
      findings: mine,
    };
  });
  const ground = levels.find((l) => l.id === model.level.id) ?? levels[0]!;
  return { plan, model, findings, svg: ground.svg, levels, schedule: schedule(model) };
}

/** One derived wall, as the JSON output names it. */
export interface WallRow {
  /** unique within its level; `level` is what makes it unique in the building */
  id: string;
  kind: "exterior" | "partition";
  /** only on a document that authored `levels` */
  level?: string;
  from: Pt;
  to: Pt;
  /** owner on the negative side (north for a horizontal wall, west for a vertical one) */
  neg: Owner;
  pos: Owner;
}

/**
 * The derived walls, so an agent can see where a wall runs *before* placing an opening on
 * it — today it learns a wall's extent only by tripping `wall.ambiguous`
 * (docs/agent-review.md §B4).
 *
 * INVARIANT: endpoints, never `axis`/`c`. Those two fields describe an axis-aligned
 * segment and nothing else; two points describe any segment, so this shape survives the
 * planar-arrangement rewrite (docs/gaps-design.md §1.3.1) unchanged.
 */
export function walls(model: Model, level?: string): WallRow[] {
  const levels = level === undefined ? model.levels : model.levels.filter((lm) => lm.level.id === level);
  return levels.flatMap((lm) =>
    lm.walls.map((w) => ({
      id: w.id,
      kind: w.kind,
      ...(model.plan.levelled ? { level: lm.level.id } : {}),
      from: pointOn(w, w.from),
      to: pointOn(w, w.to),
      neg: w.neg,
      pos: w.pos,
    })),
  );
}

/** How many findings of each severity. The first thing an agent reads back. */
export function summarize(findings: Finding[]): Record<Severity, number> {
  const s: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) s[f.severity]++;
  return s;
}

/**
 * A schema problem, as a finding. The `schema.<kind>` vocabulary is `PlanIssue["kind"]`
 * and is documented in the rule catalogue like every other rule, so `catalogue.test.ts`
 * guards it.
 */
const SCHEMA_RULE: Record<IssueKind, { rule: string }> = {
  syntax: { rule: "schema.syntax" },
  unknown_field: { rule: "schema.unknown_field" },
  missing: { rule: "schema.missing" },
  type: { rule: "schema.type" },
  reference: { rule: "schema.reference" },
  geometry: { rule: "schema.geometry" },
  conflict: { rule: "schema.conflict" },
};

export const isSchemaFinding = (f: Finding): boolean => f.rule.startsWith("schema.");

export interface LintResult {
  findings: Finding[];
  /** both absent when the document failed the schema */
  plan?: Plan;
  model?: Model;
  /** what `parse()` would have thrown, for a caller that wants its message or its issues */
  error?: PlanError;
}

/**
 * Every problem with a document, through one channel and without throwing: schema
 * problems arrive as `schema.*` findings carrying the issue's own document path, geometry
 * and semantic problems as the rules' findings (docs/agent-review.md §B8).
 *
 * `parse()` and `floorplan()` keep throwing, for callers who want that.
 */
export function lint(input: unknown, opts: FloorplanOptions = {}): LintResult {
  let plan: Plan;
  // Source text is sniffed once here rather than inside `parse()`, so the DSL positions
  // survive to annotate the findings; `parse()` would have thrown them away.
  let src: { doc: unknown; positions?: DslPositions };
  try {
    src = source(input);
  } catch (e) {
    if (!(e instanceof PlanError)) throw e;
    return { findings: issueFindings(e), error: e };
  }
  try {
    plan = parse(src.doc);
  } catch (e) {
    if (!(e instanceof PlanError)) throw e;
    return { findings: issueFindings(e, src.positions), error: e };
  }
  const { model, findings } = analyze(plan, opts.rules);
  return { findings: withLines(findings, src.positions), plan, model };
}

/**
 * Read source text as a document, in whichever syntax it is written. A DSL tokenizer
 * error arrives as a `PlanError` of `schema.syntax` issues carrying their own line, so a
 * caller has one exception type to handle whatever the input was written in.
 */
function source(input: unknown): { doc: unknown; positions?: DslPositions } {
  if (typeof input !== "string") return { doc: input };
  try {
    return readSource(input);
  } catch (e) {
    if (e instanceof DslError) throw new PlanError(e.issues.map((i) => ({ path: "", message: i.message, kind: "syntax" as IssueKind, line: i.line })));
    throw new PlanError([{ path: "", message: `not valid JSON: ${(e as Error).message}`, kind: "syntax" }]);
  }
}

const issueFindings = (e: PlanError, positions?: DslPositions): Finding[] =>
  e.issues.map((i) => {
    const line = i.line ?? (positions ? lineOf(positions, i.path) : undefined);
    return { ...SCHEMA_RULE[i.kind], severity: "error" as const, message: i.message, path: i.path, ...(line === undefined ? {} : { line }) };
  });

/**
 * Attach `line` to every finding of a DSL document, by resolving its JSON path against
 * the positions the DSL parser recorded. A JSON document is returned untouched — the
 * array identity included — so nothing about its findings changes.
 */
function withLines(findings: Finding[], positions: DslPositions | undefined): Finding[] {
  if (!positions) return findings;
  return findings.map((f) => {
    const line = lineOf(positions, f.path);
    return line === undefined ? f : { ...f, line };
  });
}

export function worstSeverity(findings: Finding[]): Severity | undefined {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.length) return "info";
  return undefined;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
const polyArea = (poly: Array<[number, number]>): number => round(shoelace(poly));
