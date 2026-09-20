// Canonical formatting for plan documents. The primary reader and writer of a plan is an
// agent paying for every token, so the canonical form is the cheap one: **one entity per
// line, compact separators inside the entity**. A room, an outdoor space, an opening, a
// fixture is exactly one line, however long — never wrapped — because an entity on one
// line is what makes a plan skimmable, diffable and addressable ("replace line 14").
//
// Measured on casa-t3 (o200k_base): 2 322 tokens as the fixtures used to be written,
// 2 302 through the old width-140 wrapping formatter, 1 687 in this form — 27 % cheaper
// and 49 lines instead of 141. Pretty separators (`": "`, `", "`) alone were 28 % of the
// document, so they are spent only where they buy structure: after a key on a block line.
// Column alignment was measured at 4 % of the document and is gone.
//
// The container/entity decision is a function of the value's **shape**, never of its depth
// or its key, so it does not have to be revisited when the schema grows a level:
//
//   - a value is a BLOCK when it holds a collection of entities (every member is an
//     object), or when something inside it is a block;
//   - anything else is an ENTITY and prints on one line.
//
// That makes `rooms`, `outdoor`, `openings`, `fixtures` blocks and a room one line today;
// it will make a `levels` map a block of per-level blocks of one-entity lines tomorrow,
// with no change here. `walls` holds two numbers, so it stays on one line, and so does a
// room's `poly`, which is a list of rows rather than a collection of entities.
//
// `layout.areas` is the single exception, and it is a key, not a shape: it is an ASCII
// picture whose rows must line up under each other, so its strings print one per line —
// exactly as a point stays on one line because it is a row.

import { isDslText, parseDsl, toDsl } from "./dsl.ts";

export interface FormatOptions {
  /** spaces per block level (default 2) */
  indent?: number;
}

/** Keys whose array-of-strings value is a picture: its rows print one per line. */
const PICTURE_KEYS = new Set(["areas"]);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isContainer = (v: unknown): v is object => typeof v === "object" && v !== null;

const isPicture = (v: unknown, key: string | undefined): boolean =>
  key !== undefined &&
  PICTURE_KEYS.has(key) &&
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((x) => typeof x === "string");

/** The members of an object or array, as [key, value] pairs; the key is undefined for an array. */
const membersOf = (v: object): Array<[string | undefined, unknown]> =>
  Array.isArray(v) ? v.map((x) => [undefined, x] as [undefined, unknown]) : Object.entries(v);

/** Whether a value breaks across lines: see the header — shape, not depth. */
function isBlock(v: unknown, key?: string): boolean {
  if (isPicture(v, key)) return true;
  if (!isContainer(v)) return false;
  const members = membersOf(v);
  if (members.length === 0) return false;
  // a map or list of entities: `rooms`, `openings`, and one day `levels`
  if (members.every(([, x]) => isPlainObject(x))) return true;
  // otherwise a block only because it carries one: the document, or a level
  return members.some(([k, x]) => isBlock(x, k));
}

/** One entity, one line: `{"type":"door","between":["hall","wc"],"width":0.8}`. */
function compact(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(compact).join(",")}]`;
  if (isPlainObject(v))
    return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${compact(x)}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/**
 * Print a JSON document in canonical form. This is a *document* printer: it emits exactly
 * the keys it is given, so a document authored with `rect` keeps its `rect` and one
 * authored with `poly` keeps its `poly`. A parsed `Plan` has already had `rect` expanded
 * to `poly`, so `formatPlan(plan)` cannot recover the shorthand — `formatText`, which goes
 * from source text to source text, is the one that preserves the author's form.
 */
export function formatPlan(value: unknown, opts: FormatOptions = {}): string {
  const step = " ".repeat(opts.indent ?? 2);

  // the document itself always reads one key per line, even when it holds no entities yet
  const emit = (v: unknown, depth: number, key?: string, force = false): string => {
    if (!force && !isBlock(v, key)) return compact(v);
    if (!isContainer(v) || membersOf(v).length === 0) return compact(v);
    const pad = step.repeat(depth);
    const inner = step.repeat(depth + 1);
    if (Array.isArray(v))
      return `[\n${v.map((x) => `${inner}${emit(x, depth + 1)}`).join(",\n")}\n${pad}]`;
    const body = Object.entries(v)
      .map(([k, x]) => `${inner}${JSON.stringify(k)}: ${emit(x, depth + 1, k)}`)
      .join(",\n");
    return `{\n${body}\n${pad}}`;
  };

  return emit(value, 0, undefined, true) + "\n";
}

/**
 * Reformat source text into canonical form, in whichever syntax it is already written —
 * the same sniffing every other entry point does (`isDslText`; see src/index.ts's
 * `source()` and the CLI's `runFmt`), so this text-to-text round trip needs no syntax flag
 * either. Throws whatever the read throws when the text is not valid: `JSON.parse`'s error
 * for JSON, a `DslError` for the DSL. `opts` only affects the JSON form — the DSL has one
 * canonical layout, with no indent to configure.
 */
export const formatText = (text: string, opts?: FormatOptions): string =>
  isDslText(text) ? toDsl(parseDsl(text).doc) : formatPlan(JSON.parse(text), opts);
