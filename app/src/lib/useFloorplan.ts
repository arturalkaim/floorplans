import { PlanError, floorplan, isDslText, worstSeverity } from "floorplan";
import type { Finding, FloorplanResult, RenderOptions, Severity } from "floorplan";
import { useMemo } from "react";

export interface PlanIssueLike {
  path: string;
  message: string;
  /** 1-based line, on a document written in the DSL */
  line?: number;
}

export interface Options {
  scale: number;
  areas: NonNullable<RenderOptions["areas"]>;
  labels: NonNullable<RenderOptions["labels"]>;
  mark: Severity | "none";
  theme: "light" | "dark";
}

/** The render options that shaped `result.svg`, kept as one object so a consumer that
 *  needs to agree with the drawing's pixel math (e.g. `projection`) uses the exact same
 *  values rather than reconstructing them and risking drift. */
export type RenderSettings = Pick<Options, "scale" | "areas" | "labels" | "theme">;

/** Which syntax the source is written in — the library's own sniff, never a guess here. */
export type Syntax = "json" | "dsl";

export type Outcome =
  | { ok: true; syntax: Syntax; result: FloorplanResult; exit: 0 | 1; worst: Severity | undefined; render: RenderSettings }
  | { ok: false; syntax: Syntax; title: string; issues: PlanIssueLike[]; exit: 2 };

/**
 * The whole pipeline, recomputed from the text. Measured at 0.3-1.2 ms end to end, so
 * there is no reason to cache anything finer than the text and the render options.
 *
 * The text is handed to `floorplan()` as text, not as a parsed value: the library decides
 * from its first non-space character whether it is JSON or the line DSL, so the editor
 * accepts either without knowing anything about the grammar.
 */
export function useFloorplan(text: string, opts: Options): Outcome {
  return useMemo(() => {
    const syntax: Syntax = isDslText(text) ? "dsl" : "json";
    const render: RenderSettings = { scale: opts.scale, areas: opts.areas, labels: opts.labels, theme: opts.theme };
    try {
      const result = floorplan(text, { render, markFindings: opts.mark });
      const worst = worstSeverity(result.findings);
      const exit = worst === "error" || worst === "warning" ? 1 : 0;
      return { ok: true, syntax, result, exit, worst, render };
    } catch (e) {
      if (e instanceof PlanError) {
        // a document that did not even tokenize gets the syntax's name; one that did but
        // failed the schema gets the schema's, because that is the thing to go and fix
        const title = e.issues.every((i) => i.kind === "syntax") ? (syntax === "dsl" ? "Not valid DSL" : "Not valid JSON") : "Invalid plan";
        return { ok: false, syntax, title, issues: e.issues, exit: 2 };
      }
      return { ok: false, syntax, title: "Render failed", issues: [{ path: "", message: (e as Error).message }], exit: 2 };
    }
  }, [text, opts.scale, opts.areas, opts.labels, opts.mark, opts.theme]);
}

export const countBy = (findings: Finding[], severity: Severity): number =>
  findings.filter((f) => f.severity === severity).length;
