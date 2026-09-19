import { PlanError, floorplan, worstSeverity } from "floorplan";
import type { Finding, FloorplanResult, RenderOptions, Severity } from "floorplan";
import { useMemo } from "react";

export interface PlanIssueLike {
  path: string;
  message: string;
}

export type Outcome =
  | { ok: true; result: FloorplanResult; exit: 0 | 1; worst: Severity | undefined }
  | { ok: false; title: string; issues: PlanIssueLike[]; exit: 2 };

export interface Options {
  scale: number;
  areas: NonNullable<RenderOptions["areas"]>;
  labels: NonNullable<RenderOptions["labels"]>;
  mark: Severity | "none";
  theme: "light" | "dark";
}

/**
 * The whole pipeline, recomputed from the text. Measured at 0.3-1.2 ms end to end, so
 * there is no reason to cache anything finer than the text and the render options.
 */
export function useFloorplan(text: string, opts: Options): Outcome {
  return useMemo(() => {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      return { ok: false, title: "Not valid JSON", issues: [{ path: "", message: (e as Error).message }], exit: 2 };
    }
    try {
      const result = floorplan(doc, {
        render: { scale: opts.scale, areas: opts.areas, labels: opts.labels, theme: opts.theme },
        markFindings: opts.mark,
      });
      const worst = worstSeverity(result.findings);
      const exit = worst === "error" || worst === "warning" ? 1 : 0;
      return { ok: true, result, exit, worst };
    } catch (e) {
      if (e instanceof PlanError) return { ok: false, title: "Invalid plan", issues: e.issues, exit: 2 };
      return { ok: false, title: "Render failed", issues: [{ path: "", message: (e as Error).message }], exit: 2 };
    }
  }, [text, opts.scale, opts.areas, opts.labels, opts.mark, opts.theme]);
}

export const countBy = (findings: Finding[], severity: Severity): number =>
  findings.filter((f) => f.severity === severity).length;
