// floorplan <plan.json> [--out plan.svg] [--level id] [--lint]
//                       [--json[=findings|all|schedule|walls]] [--scale N]
//                       [--theme auto|light|dark] [--labels auto|full|index]
//                       [--areas clear|centreline|none] [--mark error|warning|info|none]
// floorplan set <plan.json> <path> <value> [--json] [--dry-run]
// floorplan patch <plan.json> <patch.json|-> [--patch <patch.json|->] [--json] [--dry-run]
// floorplan fmt <plan> [--to json|dsl] [--out file] [--stdout] [--dry-run]
// floorplan --schema[=full|md|dsl]
// Exit codes: 0 clean (or only info), 1 findings at warning or above, 2 usage / parse error.
// The executable entry point is bin.ts, which wires stdio/fs onto `run` unconditionally;
// this module stays a plain, IO-free function so tests can drive it with a fake CliIo.
//
// `set`/`patch` exist because re-emitting a whole plan to move one door costs ~2000
// tokens; a splice costs ~20 regardless of plan size (docs/agent-review.md §B3).
//
// Everything goes through `lint()`, which never throws: a schema problem and a geometry
// problem reach the caller as findings of the same shape (§B8). `--json` defaults to
// findings-first — `{ summary, findings }` — so a read-back grows with the number of
// *problems* and not with the number of storeys: a clean three-level house costs ~60
// tokens instead of ~780 of schedule (docs/gaps-design.md §2.4). The schedule and the
// derived walls are behind `--json=all`, or selected on their own.
//
// `--schema` exists so an agent can load the field list instead of the README's prose
// (docs/agent-review.md B10). The default is a terse typed-signature line per object, no
// docs, 568 tokens for all 14 objects/73 fields; `--schema=full` is the same table as
// compact JSON with one-sentence docs (2 554 tokens), and `--schema=md` is the Markdown
// form for a human reader. All three are printed from SCHEMA — see schemaTerse below.
// `--schema=dsl` is the same idea for the line DSL: its grammar and every field's token,
// printed from DSL_SCHEMA (src/dsl.ts).
//
// Every input path reads *source text*, and `lint()`/`floorplan()` decide from its first
// non-space character whether it is JSON or DSL — so `floorplan plan.dsl --lint` and
// `floorplan plan.dsl --json` need nothing here. `fmt` is the converter between the two.

import { appendAt, insertKey, JsonPosError, removeAt, spliceAt } from "./jsonpos.ts";
import { COMPASS_LINE, DslPosError, dslSchemaText, dslSpliceAt, isDslText, readSource, toDsl } from "./dsl.ts";
import { formatPlan } from "./format.ts";
import {
  FIXTURE_TYPES,
  floorplan,
  ID_RE,
  isSchemaFinding,
  lint,
  OPENING_TYPES,
  ROOM_KINDS,
  SCHEMA,
  schedule,
  SIDES,
  summarize,
  VERTICAL_TYPES,
  walls,
  worstSeverity,
} from "./index.ts";
import type { FieldDoc, LintResult, ObjectDoc } from "./index.ts";
import type { JsonPath } from "./jsonpos.ts";
import type { Finding, Severity } from "./types.ts";
import type { RenderOptions } from "./svg.ts";

export interface CliIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  readFile: (p: string) => string;
  writeFile: (p: string, s: string) => void;
  /** Only called by `patch` when its patch document is given as `-`. */
  readStdin: () => string;
}

const USAGE = `usage: floorplan <plan.json> [--out plan.svg] [--level id] [--lint]
                 [--json[=findings|all|schedule|walls]]
                 [--scale N] [--theme auto|light|dark] [--labels auto|full|index]
                 [--areas clear|centreline|none] [--mark error|warning|info|none]
       floorplan set <plan.json> <path> <value> [--json] [--dry-run]
       floorplan patch <plan.json> <patch.json|-> [--json] [--dry-run]
       floorplan fmt <plan> [--to json|dsl] [--out file] [--stdout] [--dry-run]
       floorplan --schema[=full|md|dsl]

A plan file may be JSON or the line DSL; the first non-space character says which.
--level picks which storey to draw (default: the ground level), and scopes --json=walls.
--out may contain {level}, and then one file per level is written.
--json alone is { summary, findings }; =all adds schedule and walls; =schedule and
       =walls select one section.
--schema prints one typed-signature line per object, no docs, plus a legend
         (id format, compass axes); =full prints the same table as compact JSON with docs;
         =md prints it as a Markdown table for a human reader;
         =dsl prints the line DSL's grammar and the same legend. Needs no input file.`;

export function run(argv: string[], io: CliIo): number {
  if (argv[0] === "set") return runSet(argv.slice(1), io);
  if (argv[0] === "patch") return runPatch(argv.slice(1), io);
  if (argv[0] === "fmt") return runFmt(argv.slice(1), io);
  const args = parseArgs(argv);
  if (args instanceof Error) {
    io.stderr(`${args.message}\n${USAGE}\n`);
    return 2;
  }
  if (args.schema !== undefined) {
    io.stdout(printSchema(args.schema));
    return 0;
  }
  if (!args.input) {
    io.stderr(`${USAGE}\n`);
    return 2;
  }
  let raw: string;
  try {
    raw = io.readFile(args.input);
  } catch (e) {
    io.stderr(`cannot read ${args.input}: ${(e as Error).message}\n`);
    return 2;
  }
  // One channel: schema problems come back as `schema.*` findings rather than an
  // exception, and the JSON error envelope is rebuilt from them (§A6 keeps its shape).
  const linted = lint(raw);
  if (linted.findings.some(isSchemaFinding)) {
    reportSchema(linted, io, args.json !== undefined);
    return 2;
  }
  const model = linted.model!;
  const findings = linted.findings;
  const levelIds = model.levels.map((lm) => lm.level.id);
  if (args.level !== undefined && !levelIds.includes(args.level)) {
    io.stderr(`unknown level ${args.level}; this plan has ${levelIds.join(", ")}\n`);
    return 2;
  }

  // Rendering is the only thing that needs the whole pipeline, so it is the only thing
  // that pays for it; `--lint` and `--json` stop at the findings `lint()` already has.
  const needsDrawing = args.out !== undefined || (!args.lint && args.json === undefined);
  if (needsDrawing) {
    const render: RenderOptions = {};
    if (args.scale !== undefined) render.scale = args.scale;
    if (args.theme !== undefined) render.theme = args.theme;
    if (args.labels !== undefined) render.labels = args.labels;
    if (args.areas !== undefined) render.areas = args.areas;
    const result = floorplan(raw, args.mark === undefined ? { render } : { render, markFindings: args.mark });
    // no --level means the ground level, which is not necessarily the bottom of the stack:
    // a house on a slope has a cellar under the floor the street meets
    const chosen = result.levels.find((l) => l.id === (args.level ?? result.model.level.id))!;
    if (args.out) {
      // `{level}` says "one sheet per storey", which is how a set of plans is drawn;
      // without it the one selected level is written, as a single-level plan always was.
      if (args.out.includes("{level}")) for (const l of result.levels) io.writeFile(args.out.replace(/\{level\}/g, l.id), l.svg);
      else io.writeFile(args.out, chosen.svg);
    } else io.stdout(chosen.svg);
  }

  if (args.json !== undefined) io.stdout(formatPlan(jsonPayload(args.json, model, findings, args.level)));
  else if (args.lint || args.out) io.stdout(formatFindings(findings, levelIds.length > 1));
  const worst = worstSeverity(findings);
  return worst === "error" || worst === "warning" ? 1 : 0;
}

/**
 * What `--json` prints. Findings-first is the default because a read-back should grow
 * with the number of problems, not with the size of the building (docs/gaps-design.md
 * §2.4); `schedule` and `walls` are there when they are asked for.
 */
function jsonPayload(mode: JsonMode, model: Parameters<typeof walls>[0], findings: Finding[], level: string | undefined): unknown {
  switch (mode) {
    case "schedule":
      return { schedule: schedule(model) };
    case "walls":
      return { walls: walls(model, level) };
    case "all":
      return { summary: summarize(findings), findings, schedule: schedule(model), walls: walls(model, level) };
    default:
      return { summary: summarize(findings), findings };
  }
}

/**
 * The findings, one per line. `withLevel` prefixes each with the storey it is about —
 * only worth the column when there is more than one, and a building-wide finding shows a
 * dash because it is about all of them.
 */
export function formatFindings(findings: Finding[], withLevel = false): string {
  if (findings.length === 0) return "✓ no findings\n";
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const w = withLevel ? Math.max(...findings.map((f) => (f.level ?? "—").length)) : 0;
  const lines = findings.map((f, i) => {
    const where = f.at ? ` @ (${f.at[0]}, ${f.at[1]})` : "";
    const lvl = withLevel ? `${(f.level ?? "—").padEnd(w)}  ` : "";
    return `${String(i + 1).padStart(2)}. ${lvl}${f.severity.padEnd(7)} ${f.rule.padEnd(28)} ${f.message}${where}`;
  });
  return `${lines.join("\n")}\n${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info\n`;
}

/** which sections `--json` prints; `findings` is what bare `--json` means */
export type JsonMode = "findings" | "all" | "schedule" | "walls";
const JSON_MODES: readonly JsonMode[] = ["findings", "all", "schedule", "walls"];

interface Args {
  input: string | undefined;
  out: string | undefined;
  level: string | undefined;
  lint: boolean;
  json: JsonMode | undefined;
  scale: number | undefined;
  theme: "auto" | "light" | "dark" | undefined;
  labels: "auto" | "full" | "index" | undefined;
  areas: "clear" | "centreline" | "none" | undefined;
  mark: Severity | "none" | undefined;
  /**
   * `--schema` (terse, default), `--schema=full` (JSON+docs), `--schema=md`, or
   * `--schema=dsl` (the line DSL's grammar); needs no input file.
   */
  schema: SchemaMode | undefined;
}

function parseArgs(argv: string[]): Args | Error {
  const a: Args = { input: undefined, out: undefined, level: undefined, lint: false, json: undefined, scale: undefined, theme: undefined, labels: undefined, areas: undefined, mark: undefined, schema: undefined };
  const oneOf = <T extends string>(flag: string, v: string | undefined, allowed: readonly T[]): T | Error =>
    v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : new Error(`${flag} must be one of ${allowed.join("|")}`);
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    const next = () => argv[++i];
    if (t === "--out") a.out = next();
    else if (t === "--level") a.level = next();
    else if (t === "--lint") a.lint = true;
    else if (t === "--json") a.json = "findings";
    else if (t.startsWith("--json=")) {
      const v = oneOf("--json", t.slice("--json=".length), JSON_MODES);
      if (v instanceof Error) return v;
      a.json = v;
    } else if (t === "--scale") {
      const n = Number(next());
      if (!Number.isFinite(n) || n <= 0) return new Error("--scale must be a positive number");
      a.scale = n;
    } else if (t === "--theme") {
      const v = oneOf("--theme", next(), ["auto", "light", "dark"] as const);
      if (v instanceof Error) return v;
      a.theme = v;
    } else if (t === "--labels") {
      const v = oneOf("--labels", next(), ["auto", "full", "index"] as const);
      if (v instanceof Error) return v;
      a.labels = v;
    } else if (t === "--areas") {
      const v = oneOf("--areas", next(), ["clear", "centreline", "none"] as const);
      if (v instanceof Error) return v;
      a.areas = v;
    } else if (t === "--mark") {
      const v = oneOf("--mark", next(), ["error", "warning", "info", "none"] as const);
      if (v instanceof Error) return v;
      a.mark = v;
    } else if (t === "--schema") a.schema = "terse";
    else if (t === "--schema=full") a.schema = "full";
    else if (t === "--schema=md") a.schema = "md";
    else if (t === "--schema=dsl") a.schema = "dsl";
    else if (t.startsWith("-")) return new Error(`unknown option ${t}`);
    else if (a.input === undefined) a.input = t;
    else return new Error(`unexpected argument ${t}`);
  }
  return a;
}

/**
 * A document that fails the schema. Under `--json` this is still the error envelope
 * `{"error":{"issues":[…]}}` and not a findings list (§A6): a caller that cannot get a
 * plan at all wants to be told so in one unmistakable shape, and the issues carry the
 * same paths the `schema.*` findings do.
 */
function reportSchema(linted: LintResult, io: CliIo, json: boolean): void {
  if (json) io.stdout(formatPlan({ error: { issues: linted.error!.issues } }));
  else io.stderr(`${linted.error!.message}\n`);
}

function reportPosError(e: JsonPosError | DslPosError, io: CliIo, json: boolean): void {
  if (json) io.stdout(formatPlan({ error: { message: e.message, line: e.line, column: e.column } }));
  else io.stderr(`${e.message}\n`);
}

/**
 * The inverse of `pathToString`: turns `"openings[3].position"` or
 * `"rooms.sala.poly[2][0]"` back into the `JsonPath` jsonpos expects. No step is
 * special-cased — a leading key, a leading index, and any depth all parse the same way,
 * so a future `levels.<id>.` prefix (docs/gaps-design.md §3.2 W3b) needs no change here.
 */
function parsePath(s: string): JsonPath | Error {
  const path: JsonPath = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === ".") {
      i++;
      continue;
    }
    if (s[i] === "[") {
      const close = s.indexOf("]", i);
      if (close === -1) return new Error(`malformed path ${JSON.stringify(s)}: unmatched [`);
      const digits = s.slice(i + 1, close);
      if (!/^\d+$/.test(digits)) return new Error(`malformed path ${JSON.stringify(s)}: expected a number in [${digits}]`);
      path.push(Number(digits));
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
    if (j === i) return new Error(`malformed path ${JSON.stringify(s)}`);
    path.push(s.slice(i, j));
    i = j;
  }
  return path;
}

/** `value` is spliced verbatim if it already parses as JSON; otherwise it is a bare
 * word an agent meant as a string (`set plan.json rooms.sala.name Sala`). */
function literalFor(raw: string): string {
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return JSON.stringify(raw);
  }
}

/**
 * Validate against the schema and, only if that passes, either write `text` back to
 * `planPath` and print findings, or — under `--dry-run` — print `text` itself without
 * writing. Shared by `set` and `patch` so both give an agent the same guarantee: a file
 * is written only once its replacement is known-good, never partially or speculatively.
 */
function finish(text: string, planPath: string, io: CliIo, opts: { json: boolean; dryRun: boolean }): number {
  const linted = lint(text);
  if (linted.findings.some(isSchemaFinding)) {
    reportSchema(linted, io, opts.json);
    return 2;
  }
  if (opts.dryRun) {
    io.stdout(text);
  } else {
    io.writeFile(planPath, text);
    if (opts.json) io.stdout(formatPlan({ summary: summarize(linted.findings), findings: linted.findings }));
    else io.stdout(formatFindings(linted.findings, linted.model!.levels.length > 1));
  }
  const worst = worstSeverity(linted.findings);
  return worst === "error" || worst === "warning" ? 1 : 0;
}

const FMT_USAGE = `usage: floorplan fmt <plan> [--to json|dsl] [--out file] [--stdout] [--dry-run]

Canonicalises a plan, and converts it between the two syntaxes. Without --to the
file keeps the syntax it is already in. --out writes somewhere else, which is what
a conversion usually wants (\`fmt plan.json --to dsl --out plan.dsl\`). --stdout and
--dry-run both print the result and write nothing.`;

/**
 * `fmt`: one canonical form per syntax, and a lossless conversion between them.
 *
 * The result is validated before anything is written — the same guarantee `set` and
 * `patch` give through `finish`, and it matters more here because a conversion rewrites
 * the whole file rather than one value.
 */
function runFmt(argv: string[], io: CliIo): number {
  const positional: string[] = [];
  let to: "json" | "dsl" | undefined;
  let out: string | undefined;
  let print = false;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--to") {
      const v = argv[++i];
      if (v !== "json" && v !== "dsl") {
        io.stderr(`--to must be json or dsl\n${FMT_USAGE}\n`);
        return 2;
      }
      to = v;
    } else if (t === "--out") out = argv[++i];
    else if (t === "--stdout" || t === "--dry-run") print = true;
    else if (t.startsWith("-")) {
      io.stderr(`unknown option ${t}\n${FMT_USAGE}\n`);
      return 2;
    } else positional.push(t);
  }
  const planPath = positional[0];
  if (!planPath || positional.length > 1) {
    io.stderr(`${FMT_USAGE}\n`);
    return 2;
  }
  let text: string;
  try {
    text = io.readFile(planPath);
  } catch (e) {
    io.stderr(`cannot read ${planPath}: ${(e as Error).message}\n`);
    return 2;
  }
  // The document is read through `lint()` so a file that does not parse is reported the
  // way every other problem is, and never half-converted.
  const linted = lint(text);
  if (linted.findings.some(isSchemaFinding)) {
    reportSchema(linted, io, false);
    return 2;
  }
  const target = to ?? (isDslText(text) ? "dsl" : "json");
  let converted: string;
  try {
    const doc = readSource(text).doc;
    converted = target === "dsl" ? toDsl(doc) : formatPlan(doc);
  } catch (e) {
    io.stderr(`cannot write ${planPath} as ${target}: ${(e as Error).message}\n`);
    return 2;
  }
  return finish(converted, out ?? planPath, io, { json: false, dryRun: print });
}

const SET_USAGE = `usage: floorplan set <plan.json> <path> <value> [--json] [--dry-run]`;

function runSet(argv: string[], io: CliIo): number {
  const positional: string[] = [];
  let json = false;
  let dryRun = false;
  for (const t of argv) {
    if (t === "--json") json = true;
    else if (t === "--dry-run") dryRun = true;
    else if (t.startsWith("-")) {
      io.stderr(`unknown option ${t}\n${SET_USAGE}\n`);
      return 2;
    } else positional.push(t);
  }
  const [planPath, pathStr, value] = positional;
  if (!planPath || pathStr === undefined || value === undefined) {
    io.stderr(`${SET_USAGE}\n`);
    return 2;
  }
  const path = parsePath(pathStr);
  if (path instanceof Error) {
    io.stderr(`${path.message}\n${SET_USAGE}\n`);
    return 2;
  }
  let text: string;
  try {
    text = io.readFile(planPath);
  } catch (e) {
    io.stderr(`cannot read ${planPath}: ${(e as Error).message}\n`);
    return 2;
  }
  let spliced: string;
  try {
    // One path, two syntaxes: jsonpos finds the JSON node, dslpos finds the token on the
    // DSL line. Either way exactly that value is replaced and nothing else moves.
    spliced = isDslText(text) ? dslSpliceAt(text, path, literalFor(value)).text : spliceAt(text, path, literalFor(value)).text;
  } catch (e) {
    if (e instanceof JsonPosError || e instanceof DslPosError) {
      reportPosError(e, io, json);
      return 2;
    }
    throw e;
  }
  return finish(spliced, planPath, io, { json, dryRun });
}

interface PatchOp {
  op: "set" | "remove" | "append" | "insert";
  path: string;
  value?: unknown;
  key?: string;
}

/** Parse and validate the patch document's shape; does not touch the plan yet. */
function parsePatch(text: string): PatchOp[] | Error {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return new Error(`patch is not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(data)) return new Error("patch must be a JSON array of operations");
  const ops: PatchOp[] = [];
  for (let i = 0; i < data.length; i++) {
    const entry: unknown = data[i];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return new Error(`op ${i}: must be an object`);
    const e = entry as Record<string, unknown>;
    const op = e["op"] ?? "set";
    if (op !== "set" && op !== "remove" && op !== "append" && op !== "insert") return new Error(`op ${i}: unknown op ${JSON.stringify(op)}`);
    if (typeof e["path"] !== "string") return new Error(`op ${i} (${op}): "path" must be a string`);
    if ((op === "set" || op === "append" || op === "insert") && !("value" in e)) return new Error(`op ${i} (${op}): missing "value"`);
    if (op === "insert" && typeof e["key"] !== "string") return new Error(`op ${i} (insert): "key" must be a string`);
    const parsed: PatchOp = { op, path: e["path"] };
    if ("value" in e) parsed.value = e["value"];
    if (typeof e["key"] === "string") parsed.key = e["key"];
    ops.push(parsed);
  }
  return ops;
}

function applyOp(text: string, op: PatchOp): string {
  const path = parsePath(op.path);
  if (path instanceof Error) throw path;
  const literal = () => JSON.stringify(op.value);
  if (isDslText(text)) {
    // `set` is a token splice and works the same in both syntaxes. The three structural
    // ops are not: adding or removing an entity in the DSL is adding or removing a whole
    // line, in a group whose place in the file the printer decides — which is `fmt`'s
    // job, not a splice's. Saying so beats writing a line into the wrong section.
    if (op.op === "set") return dslSpliceAt(text, path, literal()).text;
    throw new DslPosError(`"${op.op}" is not supported on a DSL document; convert it with \`floorplan fmt <file> --to json\` first, or edit the line directly`);
  }
  switch (op.op) {
    case "set":
      return spliceAt(text, path, literal()).text;
    case "remove":
      return removeAt(text, path);
    case "append":
      return appendAt(text, path, literal());
    case "insert":
      return insertKey(text, path, op.key!, literal());
  }
}

const PATCH_USAGE = `usage: floorplan patch <plan.json> <patch.json|-> [--patch <patch.json|->] [--json] [--dry-run]`;

function runPatch(argv: string[], io: CliIo): number {
  const positional: string[] = [];
  let json = false;
  let dryRun = false;
  let patchArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--patch") patchArg = argv[++i];
    else if (t === "--json") json = true;
    else if (t === "--dry-run") dryRun = true;
    else if (t.startsWith("-")) {
      io.stderr(`unknown option ${t}\n${PATCH_USAGE}\n`);
      return 2;
    } else positional.push(t);
  }
  const planPath = positional[0];
  const patchPath = patchArg ?? positional[1];
  if (!planPath || !patchPath) {
    io.stderr(`${PATCH_USAGE}\n`);
    return 2;
  }
  let patchText: string;
  try {
    patchText = patchPath === "-" ? io.readStdin() : io.readFile(patchPath);
  } catch (e) {
    io.stderr(`cannot read ${patchPath}: ${(e as Error).message}\n`);
    return 2;
  }
  const ops = parsePatch(patchText);
  if (ops instanceof Error) {
    io.stderr(`${ops.message}\n`);
    return 2;
  }
  let text: string;
  try {
    text = io.readFile(planPath);
  } catch (e) {
    io.stderr(`cannot read ${planPath}: ${(e as Error).message}\n`);
    return 2;
  }
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    try {
      text = applyOp(text, op);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const position = e instanceof JsonPosError || e instanceof DslPosError ? { line: e.line, column: e.column } : {};
      if (json) io.stdout(`${JSON.stringify({ error: { op: i, kind: op.op, path: op.path, message, ...position } }, null, 2)}\n`);
      else io.stderr(`op ${i} (${op.op} ${op.path}) failed: ${message}\n`);
      return 2;
    }
  }
  return finish(text, planPath, io, { json, dryRun });
}

/** Which form `--schema` prints: terse (default), full JSON+docs, a Markdown table, or the line DSL's grammar. */
export type SchemaMode = "terse" | "full" | "md" | "dsl";

/** The one place `--schema[=full|md|dsl]` is decided, rather than a branch in `run`. */
function printSchema(mode: SchemaMode): string {
  switch (mode) {
    case "full":
      return schemaJson();
    case "md":
      return schemaMarkdown();
    case "dsl":
      // the other syntax's table, from DSL_SCHEMA rather than SCHEMA — but generated the
      // same way and for the same reason, so it cannot describe a token the parser
      // does not take
      return dslSchemaText();
    default:
      return schemaTerse();
  }
}

/** Every object name SCHEMA declares, for `objectRef` below to check a `"; see X"` or
 * dotted-name reference against — a name that fits neither convention fails loudly there
 * rather than printing a name nothing else in the table has. */
const SCHEMA_OBJECT_NAMES = new Set<string>(SCHEMA.map((o) => o.object));
const SEE_REF = /see ([\w.]+)$/;

/**
 * The object a `type: "object"` field's doc points at — the word after a trailing
 * `"; see X"`, the convention SCHEMA's docs already use to point at a nested shape — or,
 * for the one field that has no such doc (`opening.position`), the dotted-name convention
 * SCHEMA itself uses for a nested shape with no id of its own (`${object}.${field}`).
 * Shared by `schemaTerse` and `schemaMarkdown` so both surfaces resolve a reference
 * identically and cannot describe it two different ways.
 */
function objectRef(owner: ObjectDoc["object"], f: FieldDoc): string {
  const name = SEE_REF.exec(f.doc)?.[1] ?? `${owner}.${f.name}`;
  if (!SCHEMA_OBJECT_NAMES.has(name)) throw new Error(`objectRef: ${owner}.${f.name} is type "object" but resolves to unknown object ${JSON.stringify(name)}`);
  return name;
}

/**
 * How a `type: "object"` field's cardinality (`f.shape`, src/parse.ts) prints: bare for a
 * single nested object (`opening.on`), `X[]` for a list (`opening[]`), `{id: X}` for an
 * id-keyed map (`{id: room}`). This is the fix for docs/eval/cold/cold-run.md's headline
 * failure: `type: "object"` alone cannot distinguish "a map keyed by an id you invent" from
 * "an array" from "a single nested object", and every one of 20 cold-agent JSON authoring
 * attempts guessed "array" for `levels` — the majority shape in the old table — and lost.
 * The `id` placeholder in the map form is the same word the legend's `id = …` line (below)
 * defines, so it doubles as a pointer to the id constraint on that key.
 */
function objectFieldType(owner: ObjectDoc["object"], f: FieldDoc): string {
  const name = objectRef(owner, f);
  return f.shape === "map" ? `{id: ${name}}` : f.shape === "list" ? `${name}[]` : name;
}

/**
 * `--schema` (default): one typed-signature line per object, generated from SCHEMA with no
 * doc text — required fields bare, optional `name?`, and no per-field prose — plus a short
 * legend (id format, compass axes, spelled-out enum vocabularies). `--schema=full` below
 * still carries every doc string for the cases that need it.
 *
 * An enum with ≤6 values is spelled out inline (`enum(door|window|cased)`); a bigger one
 * (room.kind, fixture.type) is a name (`enum(ROOM_KINDS)`) resolved against VOCABULARIES
 * and spelled out once, in the trailing legend — never twice, and never copied by hand.
 *
 * A field typed `"object"` names another line of this same table (`opening.on`, `level`)
 * rather than printing `object`, and its cardinality besides (`objectFieldType` above) —
 * `object` alone is what made every cold-agent JSON authoring attempt in
 * docs/eval/cold/cold-run.md guess wrong about `levels`.
 *
 * A field literally named `id` (`opening.id`, `fixture.id`, `vertical.id`) prints as type
 * `id` instead of `str`, pointing at the same legend line the `{id: X}` map notation does —
 * both are the one constraint parse.ts's `ID_RE` enforces on every id in the document,
 * including the map keys (`room`/`outdoor`/`void`/`level` ids) that have no field of their
 * own to attach a doc string to.
 */
function schemaTerse(): string {
  const usedVocabularies = new Set<string>();
  const enumType = (owner: ObjectDoc["object"], f: FieldDoc): string => {
    const values = [...f.enum!];
    if (values.length <= 6) return `enum(${values.join("|")})`;
    const vocab = VOCABULARIES.find((v) => v.values === f.enum);
    if (!vocab) throw new Error(`schemaTerse: ${owner}.${f.name}'s enum is not one of VOCABULARIES`);
    usedVocabularies.add(vocab.name);
    return `enum(${vocab.name})`;
  };

  const TYPE_TAG: Record<Exclude<FieldDoc["type"], "object" | "enum">, string> = {
    number: "num",
    "number[]": "num[]",
    string: "str",
    "string[]": "str[]",
    boolean: "bool",
    "[x,y]": "[x,y]",
    "[x,y,w,h]": "[x,y,w,h]",
    "point[]": "point[]",
  };
  // INVARIANT: every field literally named "id" matches ID_RE — the one place that fact is
  // read off a field's *name* rather than an explicit SCHEMA flag, mirrored by the `{id: X}`
  // map notation above using the same bare word for the constraint on a map's own keys.
  let usesIdTag = false;
  const fieldType = (owner: ObjectDoc["object"], f: FieldDoc): string => {
    if (f.type === "object") return objectFieldType(owner, f);
    if (f.type === "enum") return enumType(owner, f);
    if (f.type === "string" && f.name === "id") {
      usesIdTag = true;
      return "id";
    }
    return TYPE_TAG[f.type];
  };

  const lines = SCHEMA.map((o) => {
    const fields = o.fields.map((f) => `${f.name}${f.required ? "" : "?"}: ${fieldType(o.object, f)}`).join(" ; ");
    const oneOf = o.oneOf && o.oneOf.length > 0 ? ` oneOf: ${o.oneOf.join("; ")}` : "";
    return `${o.object} { ${fields} }${oneOf}`;
  });
  const usesMapShape = SCHEMA.some((o) => o.fields.some((f) => f.shape === "map"));
  const legend = [
    ...(usesIdTag || usesMapShape ? [`id = ${ID_RE}`] : []),
    COMPASS_LINE,
    ...VOCABULARIES.filter((v) => usedVocabularies.has(v.name)).map((v) => `${v.name} = ${[...v.values].join("|")}`),
  ];
  return `${[...lines, "", ...legend].join("\n")}\n`;
}

/** Every enum vocabulary SCHEMA's fields point at, named for `schemaTerse`'s legend. */
const VOCABULARIES: readonly { name: string; values: ReadonlySet<string> }[] = [
  { name: "ROOM_KINDS", values: ROOM_KINDS },
  { name: "SIDES", values: SIDES },
  { name: "OPENING_TYPES", values: OPENING_TYPES },
  { name: "FIXTURE_TYPES", values: FIXTURE_TYPES },
  { name: "VERTICAL_TYPES", values: VERTICAL_TYPES },
];

/**
 * `--schema=full`: the document's field table as compact JSON, one field per line — the
 * same one-entity-per-line convention `formatPlan` (src/format.ts) already uses for a plan
 * document, reused here because a field is exactly that kind of entity. `enum` prints as
 * an array; SCHEMA holds it as a reference to the vocabulary Set itself (JSON has no set
 * type to print it as). `shape` (fix 1, docs/eval/cold/cold-run.md) prints only when the
 * field has one, i.e. only for `type: "object"` fields.
 */
function schemaJson(): string {
  const plain = SCHEMA.map((o) => ({
    object: o.object,
    fields: o.fields.map(fieldToJson),
    ...(o.oneOf ? { oneOf: o.oneOf } : {}),
  }));
  return formatPlan(plain);
}

function fieldToJson(f: FieldDoc): Record<string, unknown> {
  return {
    name: f.name,
    type: f.type,
    required: f.required,
    ...(f.enum ? { enum: [...f.enum] } : {}),
    ...(f.shape ? { shape: f.shape } : {}),
    doc: f.doc,
  };
}

/** `--schema=md`: the same field table as one Markdown table per object, for a human reader.
 * A `type: "object"` field's type column shows `objectFieldType`'s cardinality-aware label
 * (`{id: room}`, `opening[]`) instead of the bare word `object`, for the same reason the
 * terse form does (fix 1, docs/eval/cold/cold-run.md). */
function schemaMarkdown(): string {
  const section = (o: ObjectDoc): string => {
    const rows = o.fields.map((f) => {
      const enumCol = f.enum ? [...f.enum].join(", ") : "";
      const typeCol = f.type === "object" ? objectFieldType(o.object, f) : f.type;
      return `| \`${f.name}\` | ${typeCol} | ${f.required ? "yes" : "no"} | ${enumCol} | ${f.doc.replace(/\|/g, "\\|")} |`;
    });
    const oneOf = o.oneOf && o.oneOf.length > 0 ? `\n\n${o.oneOf.map((s) => `_${s}_`).join("\n")}` : "";
    return `## ${o.object}\n\n| field | type | required | enum | doc |\n|---|---|---|---|---|\n${rows.join("\n")}${oneOf}\n`;
  };
  return `${SCHEMA.map(section).join("\n")}\n`;
}
