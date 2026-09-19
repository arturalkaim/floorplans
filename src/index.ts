// floorplan — declarative floor-plan renderer and linter.
//
//   const plan = parse(json);                 // throws PlanError on schema problems
//   const { model, findings } = analyze(plan); // geometry + rules, never throws
//   const svg = renderSvg(model, { findings });
//
// or in one go: floorplan(json) → { plan, model, findings, svg, schedule }

import { derive } from "./derive.ts";
import { shoelace } from "./geometry.ts";
import { parse, PlanError } from "./parse.ts";
import { checkRules, sortFindings } from "./rules.ts";
import { renderSvg } from "./svg.ts";
import type { Analysis, Finding, Model, Plan, Severity } from "./types.ts";
import type { RuleOptions } from "./rules.ts";
import type { RenderOptions } from "./svg.ts";

export { parse, PlanError, derive, checkRules, renderSvg, sortFindings };
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
}

export interface Schedule {
  rooms: ScheduleRow[];
  interiorArea: number;
  interiorClearArea: number;
  footprint: number;
  outdoor: Array<{ id: string; name: string; area: number; covered: boolean }>;
}

export function schedule(model: Model): Schedule {
  const rooms = model.rooms.map((m) => ({
    id: m.room.id,
    name: m.room.name,
    kind: m.room.kind,
    zone: m.room.zone,
    area: m.area,
    clearArea: m.clearArea,
  }));
  return {
    rooms,
    interiorArea: model.interiorArea,
    interiorClearArea: Math.round(rooms.reduce((s, r) => s + r.clearArea, 0) * 1000) / 1000,
    footprint: model.envelope.area,
    outdoor: model.plan.outdoor.map((o) => ({ id: o.id, name: o.name, area: Math.abs(polyArea(o.poly)), covered: o.covered })),
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
