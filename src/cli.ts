#!/usr/bin/env node
// floorplan <plan.json> [--out plan.svg] [--lint] [--json] [--scale N] [--theme auto|light|dark]
//                       [--labels auto|full|index] [--areas clear|centreline|none] [--mark error|warning|info|none]
// Exit codes: 0 clean (or only info), 1 findings at warning or above, 2 usage / parse error.

import { readFileSync, writeFileSync } from "node:fs";
import { floorplan, PlanError, worstSeverity } from "./index.ts";
import type { Finding, Severity } from "./types.ts";
import type { RenderOptions } from "./svg.ts";

export interface CliIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  readFile: (p: string) => string;
  writeFile: (p: string, s: string) => void;
}

const USAGE = `usage: floorplan <plan.json> [--out plan.svg] [--lint] [--json] [--scale N]
                 [--theme auto|light|dark] [--labels auto|full|index]
                 [--areas clear|centreline|none] [--mark error|warning|info|none]`;

export function run(argv: string[], io: CliIo): number {
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
      io.stderr(`${e.message}\n`);
      return 2;
    }
    throw e;
  }
  if (args.out) io.writeFile(args.out, result.svg);
  else if (!args.lint && !args.json) io.stdout(result.svg);

  if (args.json) {
    io.stdout(`${JSON.stringify({ findings: result.findings, schedule: result.schedule }, null, 2)}\n`);
  } else if (args.lint || args.out) {
    io.stdout(formatFindings(result.findings));
  }
  const worst = worstSeverity(result.findings);
  return worst === "error" || worst === "warning" ? 1 : 0;
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "✓ no findings\n";
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const lines = findings.map((f, i) => {
    const where = f.at ? ` @ (${f.at[0]}, ${f.at[1]})` : "";
    return `${String(i + 1).padStart(2)}. ${f.severity.padEnd(7)} ${f.rule.padEnd(28)} ${f.message}${where}`;
  });
  return `${lines.join("\n")}\n${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info\n`;
}

interface Args {
  input: string | undefined;
  out: string | undefined;
  lint: boolean;
  json: boolean;
  scale: number | undefined;
  theme: "auto" | "light" | "dark" | undefined;
  labels: "auto" | "full" | "index" | undefined;
  areas: "clear" | "centreline" | "none" | undefined;
  mark: Severity | "none" | undefined;
}

function parseArgs(argv: string[]): Args | Error {
  const a: Args = { input: undefined, out: undefined, lint: false, json: false, scale: undefined, theme: undefined, labels: undefined, areas: undefined, mark: undefined };
  const oneOf = <T extends string>(flag: string, v: string | undefined, allowed: readonly T[]): T | Error =>
    v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : new Error(`${flag} must be one of ${allowed.join("|")}`);
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    const next = () => argv[++i];
    if (t === "--out") a.out = next();
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

const isMain = process.argv[1] !== undefined && /cli\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  const code = run(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    readFile: (p) => readFileSync(p, "utf8"),
    writeFile: (p, s) => writeFileSync(p, s),
  });
  process.exitCode = code;
}
