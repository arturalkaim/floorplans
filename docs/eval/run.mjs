// The authoring eval's measurement. Reads every document in ./plans, runs lint() once,
// and prints a row per document: the schema findings (the thing being counted) and the
// rule findings (reported beside them, because a syntax cannot be blamed for a room that
// does not tile). Run from the repository root:
//
//   node docs/eval/run.mjs            # the table
//   node docs/eval/run.mjs --json     # the same thing as JSON, for test/authoring-eval.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { isSchemaFinding, lint } from "../../src/index.ts";

const dir = new URL("./plans/", import.meta.url);
const names = readdirSync(dir).sort();

const rows = names.map((name) => {
  const text = readFileSync(new URL(name, dir), "utf8");
  const { findings } = lint(text);
  const schema = findings.filter(isSchemaFinding);
  return {
    name,
    syntax: name.endsWith(".dsl") ? "dsl" : "json",
    brief: name.slice(0, name.lastIndexOf(".")),
    schema: schema.map((f) => ({ rule: f.rule, path: f.path, line: f.line, message: f.message })),
    rules: findings.filter((f) => !isSchemaFinding(f)).map((f) => f.rule),
  };
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  for (const r of rows) {
    const mark = r.schema.length === 0 ? "ok  " : `FAIL`;
    console.log(`${mark} ${r.name.padEnd(28)} schema ${String(r.schema.length).padStart(2)}  rules ${String(r.rules.length).padStart(2)}`);
    for (const f of r.schema) console.log(`       ${f.line !== undefined ? `line ${f.line}` : f.path}: ${f.message}`);
  }
  for (const syntax of ["json", "dsl"]) {
    const mine = rows.filter((r) => r.syntax === syntax);
    const failed = mine.filter((r) => r.schema.length > 0);
    console.log(`\n${syntax}: ${failed.length}/${mine.length} documents failed the schema first time, ${mine.reduce((s, r) => s + r.schema.length, 0)} findings total`);
  }
}
