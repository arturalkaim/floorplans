// floorplan <plan.json> [--out plan.svg] [--level id] [--lint] [--json] [--scale N]
//                       [--theme auto|light|dark] [--labels auto|full|index]
//                       [--areas clear|centreline|none] [--mark error|warning|info|none]
// floorplan set <plan.json> <path> <value> [--json] [--dry-run]
// floorplan patch <plan.json> <patch.json|-> [--patch <patch.json|->] [--json] [--dry-run]
// Exit codes: 0 clean (or only info), 1 findings at warning or above, 2 usage / parse error.
// The executable entry point is bin.ts, which wires stdio/fs onto `run` unconditionally;
// this module stays a plain, IO-free function so tests can drive it with a fake CliIo.
//
// `set`/`patch` exist because re-emitting a whole plan to move one door costs ~2000
// tokens; a splice costs ~20 regardless of plan size (docs/agent-review.md §B3).

import { appendAt, insertKey, JsonPosError, removeAt, spliceAt } from "./jsonpos.ts";
import { floorplan, PlanError, worstSeverity } from "./index.ts";
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

const USAGE = `usage: floorplan <plan.json> [--out plan.svg] [--level id] [--lint] [--json]
                 [--scale N] [--theme auto|light|dark] [--labels auto|full|index]
                 [--areas clear|centreline|none] [--mark error|warning|info|none]
       floorplan set <plan.json> <path> <value> [--json] [--dry-run]
       floorplan patch <plan.json> <patch.json|-> [--json] [--dry-run]

--level picks which storey to draw (default: the ground level).
--out may contain {level}, and then one file per level is written.`;

export function run(argv: string[], io: CliIo): number {
  if (argv[0] === "set") return runSet(argv.slice(1), io);
  if (argv[0] === "patch") return runPatch(argv.slice(1), io);
  const args = parseArgs(argv);
  if (args instanceof Error) {
    io.stderr(`${args.message}\n${USAGE}\n`);
    return 2;
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
  let result;
  try {
    const render: RenderOptions = {};
    if (args.scale !== undefined) render.scale = args.scale;
    if (args.theme !== undefined) render.theme = args.theme;
    if (args.labels !== undefined) render.labels = args.labels;
    if (args.areas !== undefined) render.areas = args.areas;
    result = floorplan(raw, args.mark === undefined ? { render } : { render, markFindings: args.mark });
  } catch (e) {
    if (e instanceof PlanError) {
      reportPlanError(e, io, args.json);
      return 2;
    }
    throw e;
  }
  if (args.level !== undefined && !result.levels.some((l) => l.id === args.level)) {
    io.stderr(`unknown level ${args.level}; this plan has ${result.levels.map((l) => l.id).join(", ")}\n`);
    return 2;
  }
  // no --level means the ground level, which is not necessarily the bottom of the stack:
  // a house on a slope has a cellar under the floor the street meets
  const chosen = result.levels.find((l) => l.id === (args.level ?? result.model.level.id))!;

  if (args.out) {
    // `{level}` says "one sheet per storey", which is how a set of plans is drawn; without
    // it the one selected level is written, exactly as a single-level plan always was.
    if (args.out.includes("{level}")) for (const l of result.levels) io.writeFile(args.out.replace(/\{level\}/g, l.id), l.svg);
    else io.writeFile(args.out, chosen.svg);
  } else if (!args.lint && !args.json) io.stdout(chosen.svg);

  if (args.json) {
    io.stdout(`${JSON.stringify({ findings: result.findings, schedule: result.schedule }, null, 2)}\n`);
  } else if (args.lint || args.out) {
    io.stdout(formatFindings(result.findings, result.levels.length > 1));
  }
  const worst = worstSeverity(result.findings);
  return worst === "error" || worst === "warning" ? 1 : 0;
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

interface Args {
  input: string | undefined;
  out: string | undefined;
  level: string | undefined;
  lint: boolean;
  json: boolean;
  scale: number | undefined;
  theme: "auto" | "light" | "dark" | undefined;
  labels: "auto" | "full" | "index" | undefined;
  areas: "clear" | "centreline" | "none" | undefined;
  mark: Severity | "none" | undefined;
}

function parseArgs(argv: string[]): Args | Error {
  const a: Args = { input: undefined, out: undefined, level: undefined, lint: false, json: false, scale: undefined, theme: undefined, labels: undefined, areas: undefined, mark: undefined };
  const oneOf = <T extends string>(flag: string, v: string | undefined, allowed: readonly T[]): T | Error =>
    v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : new Error(`${flag} must be one of ${allowed.join("|")}`);
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    const next = () => argv[++i];
    if (t === "--out") a.out = next();
    else if (t === "--level") a.level = next();
    else if (t === "--lint") a.lint = true;
    else if (t === "--json") a.json = true;
    else if (t === "--scale") {
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
    } else if (t.startsWith("-")) return new Error(`unknown option ${t}`);
    else if (a.input === undefined) a.input = t;
    else return new Error(`unexpected argument ${t}`);
  }
  return a;
}

function reportPlanError(e: PlanError, io: CliIo, json: boolean): void {
  if (json) io.stdout(`${JSON.stringify({ error: { issues: e.issues } }, null, 2)}\n`);
  else io.stderr(`${e.message}\n`);
}

function reportJsonPosError(e: JsonPosError, io: CliIo, json: boolean): void {
  if (json) io.stdout(`${JSON.stringify({ error: { message: e.message, line: e.line, column: e.column } }, null, 2)}\n`);
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
  let result;
  try {
    result = floorplan(text, {});
  } catch (e) {
    if (e instanceof PlanError) {
      reportPlanError(e, io, opts.json);
      return 2;
    }
    throw e;
  }
  if (opts.dryRun) {
    io.stdout(text);
  } else {
    io.writeFile(planPath, text);
    if (opts.json) io.stdout(`${JSON.stringify({ findings: result.findings, schedule: result.schedule }, null, 2)}\n`);
    else io.stdout(formatFindings(result.findings));
  }
  const worst = worstSeverity(result.findings);
  return worst === "error" || worst === "warning" ? 1 : 0;
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
    spliced = spliceAt(text, path, literalFor(value)).text;
  } catch (e) {
    if (e instanceof JsonPosError) {
      reportJsonPosError(e, io, json);
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
      const position = e instanceof JsonPosError ? { line: e.line, column: e.column } : {};
      if (json) io.stdout(`${JSON.stringify({ error: { op: i, kind: op.op, path: op.path, message, ...position } }, null, 2)}\n`);
      else io.stderr(`op ${i} (${op.op} ${op.path}) failed: ${message}\n`);
      return 2;
    }
  }
  return finish(text, planPath, io, { json, dryRun });
}
