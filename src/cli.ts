// floorplan <plan.json> [--out plan.svg] [--level id] [--lint]
//                       [--json[=findings|all|schedule|walls]] [--scale N]
//                       [--theme auto|light|dark] [--labels auto|full|index]
//                       [--areas clear|centreline|none] [--mark error|warning|info|none]
// floorplan set <plan.json> <path> <value> [--json] [--dry-run]
// floorplan patch <plan.json> <patch.json|-> [--patch <patch.json|->] [--json] [--dry-run]
// floorplan fmt <plan> [--to json|dsl] [--out file] [--stdout] [--dry-run]
// floorplan --schema[=md|=dsl]
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
// `--schema` exists so an agent can load the field list (~600 tokens) instead of the
// README's prose (~2400 tokens) — see docs/agent-review.md B10. `--schema=dsl` is the
// same idea for the line DSL: the grammar's coverage table, generated from DSL_SCHEMA.
//
// Every input path reads *source text*, and `lint()`/`floorplan()` decide from its first
// non-space character whether it is JSON or DSL — so `floorplan plan.dsl --lint` and
// `floorplan plan.dsl --json` need nothing here. `fmt` is the converter between the two.

import { appendAt, insertKey, JsonPosError, removeAt, spliceAt } from "./jsonpos.ts";
import { DslPosError, dslSchemaText, dslSpliceAt, isDslText, readSource, toDsl } from "./dsl.ts";
import { formatPlan } from "./format.ts";
import { floorplan, isSchemaFinding, lint, SCHEMA, schedule, summarize, walls, worstSeverity } from "./index.ts";
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
       floorplan --schema[=md|=dsl]

A plan file may be JSON or the line DSL; the first non-space character says which.
--level picks which storey to draw (default: the ground level), and scopes --json=walls.
--out may contain {level}, and then one file per level is written.
--json alone is { summary, findings }; =all adds schedule and walls; =schedule and
       =walls select one section.
--schema prints the document's field table as JSON (default) or, with =md,
         as Markdown; =dsl prints the line DSL's grammar. Needs no input file.`;

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
    io.stdout(args.schema === "md" ? schemaMarkdown() : args.schema === "dsl" ? dslSchemaText() : schemaJson());
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
  /** `--schema` (JSON, default), `--schema=md` or `--schema=dsl`; needs no input file. */
  schema: "json" | "md" | "dsl" | undefined;
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
    } else if (t === "--schema") a.schema = "json";
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

/**
 * `--schema`: the document's field table as compact JSON, one field per line — the same
 * one-entity-per-line convention `formatPlan` (src/format.ts) already uses for a plan
 * document, reused here because a field is exactly that kind of entity. `enum` prints as
 * an array; SCHEMA holds it as a reference to the vocabulary Set itself (JSON has no set
 * type to print it as).
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
    doc: f.doc,
  };
}

/** `--schema=md`: the same field table as one Markdown table per object, for a human reader. */
function schemaMarkdown(): string {
  const section = (o: ObjectDoc): string => {
    const rows = o.fields.map((f) => {
      const enumCol = f.enum ? [...f.enum].join(", ") : "";
      return `| \`${f.name}\` | ${f.type} | ${f.required ? "yes" : "no"} | ${enumCol} | ${f.doc.replace(/\|/g, "\\|")} |`;
    });
    const oneOf = o.oneOf && o.oneOf.length > 0 ? `\n\n${o.oneOf.map((s) => `_${s}_`).join("\n")}` : "";
    return `## ${o.object}\n\n| field | type | required | enum | doc |\n|---|---|---|---|---|\n${rows.join("\n")}${oneOf}\n`;
  };
  return `${SCHEMA.map(section).join("\n")}\n`;
}
