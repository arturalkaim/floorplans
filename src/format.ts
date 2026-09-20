// Canonical formatting for plan documents. A drag edits the source in place via
// jsonpos/edit splices — it does not reformat — so this is a separate, on-demand
// canonicalization: given a parsed value, formatPlan always produces the same text
// (indent 2, wrap at column 140, deterministic key order from the object), so it is
// idempotent — formatting already-canonical output changes nothing.
// JSON.stringify(v, null, 2) is unusable here: it puts every number on its own line,
// exploding a four-corner polygon into thirteen. Coordinates are read as rows, so
// arrays of numbers and arrays of points stay on one line while they fit.

export interface FormatOptions {
  /** spaces per level (default 2) */
  indent?: number;
  /** wrap anything wider than this (default 140) */
  width?: number;
}

const isPoint = (v: unknown): boolean =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");

const isFlat = (v: unknown[]): boolean =>
  v.every((x) => typeof x === "number" || typeof x === "string" || typeof x === "boolean" || x === null);

const isPointList = (v: unknown[]): boolean => v.length > 0 && v.every(isPoint);

/** Format a parsed plan into its canonical form (see header comment); not how any shipped fixture is written today. */
export function formatPlan(value: unknown, opts: FormatOptions = {}): string {
  const step = " ".repeat(opts.indent ?? 2);
  const width = opts.width ?? 140;

  const scalar = (v: unknown): string => JSON.stringify(v) ?? "null";

  const inline = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
    if (v && typeof v === "object")
      return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }`;
    return scalar(v);
  };

  /** `lead` is the text already on the line before this value, e.g. a key and colon. */
  const emit = (v: unknown, depth: number, lead = 0): string => {
    const pad = step.repeat(depth);
    const inner = step.repeat(depth + 1);

    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      // a point, a row of numbers, or a short ring of points reads best on one line
      const one = inline(v);
      if (pad.length + lead + one.length <= width) return one;
      // a ring too long for one line becomes one point per line, never one number per line
      if (isPointList(v)) {
        const rows = v.map((p) => `${inner}${inline(p)}`).join(",\n");
        return `[\n${rows}\n${pad}]`;
      }
      const items = v.map((x) => `${inner}${emit(x, depth + 1)}`).join(",\n");
      return `[\n${items}\n${pad}]`;
    }

    if (v && typeof v === "object") {
      const entries = Object.entries(v);
      if (entries.length === 0) return "{}";
      // a room, an opening, a fixture: keep it on one line while it fits, nested
      // `on` and `position` objects included — that is how the plans read best
      const one = inline(v);
      if (pad.length + lead + one.length <= width) return one;
      const body = entries
        .map(([k, x]) => `${inner}${JSON.stringify(k)}: ${emit(x, depth + 1, JSON.stringify(k).length + 2)}`)
        .join(",\n");
      return `{\n${body}\n${pad}}`;
    }

    return scalar(v);
  };

  return emit(value, 0) + "\n";
}

/** Reformat source text; throws whatever JSON.parse throws when the text is not valid. */
export const formatText = (text: string, opts?: FormatOptions): string =>
  formatPlan(JSON.parse(text), opts);
