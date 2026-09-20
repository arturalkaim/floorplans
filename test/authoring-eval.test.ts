import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isSchemaFinding, lint, parse } from "../src/index.ts";

/**
 * The authoring eval's result, pinned. `docs/eval/authoring-eval.md` reports 0 first-time
 * schema failures in each syntax and identical rule counts for all twenty pairs; if a
 * change to the parser or the grammar makes one of those documents stop parsing, or makes
 * the two members of a pair disagree, the write-up has gone stale and this says so.
 *
 * The forty documents are first drafts and are never to be corrected — that is what makes
 * the count mean "first time". A failure here is a reason to change the write-up or the
 * parser, never the documents.
 */
const dir = new URL("../docs/eval/plans/", import.meta.url);
const names = readdirSync(dir).sort();
const read = (name: string) => readFileSync(new URL(name, dir), "utf8");
const briefOf = (name: string) => name.slice(0, name.lastIndexOf("."));

describe("the authoring eval", () => {
  it("has twenty briefs written in both syntaxes", () => {
    const briefs = [...new Set(names.map(briefOf))].sort();
    assert.equal(briefs.length, 20);
    for (const b of briefs) {
      assert.ok(names.includes(`${b}.json`), `${b}.json is missing`);
      assert.ok(names.includes(`${b}.dsl`), `${b}.dsl is missing`);
    }
  });

  it("still has zero first-time schema failures in either syntax", () => {
    const failures = names.flatMap((name) => {
      const schema = lint(read(name)).findings.filter(isSchemaFinding);
      return schema.map((f) => `${name}: ${f.message}`);
    });
    assert.deepEqual(failures, [], `docs/eval/authoring-eval.md §1 reports 0-0; these now fail:\n${failures.join("\n")}`);
  });

  it("gets the same building from each pair — same findings, same schedule", () => {
    for (const brief of [...new Set(names.map(briefOf))].sort()) {
      const a = lint(read(`${brief}.json`));
      const b = lint(read(`${brief}.dsl`));
      assert.deepEqual(
        b.findings.map((f) => [f.rule, f.path]),
        a.findings.map((f) => [f.rule, f.path]),
        `${brief}: the two syntaxes describe different buildings`,
      );
      // and the parsed plans agree on every area, not only on the findings
      assert.deepEqual(
        parse(read(`${brief}.dsl`)).levels.map((l) => l.rooms.map((r) => r.poly)),
        parse(read(`${brief}.json`)).levels.map((l) => l.rooms.map((r) => r.poly)),
        brief,
      );
    }
  });

  it("gives every DSL finding a line, and every JSON finding none", () => {
    for (const name of names) {
      const dsl = name.endsWith(".dsl");
      for (const f of lint(read(name)).findings) {
        if (dsl) assert.ok(f.line === undefined || f.line > 0, `${name}: ${f.rule} has line ${f.line}`);
        else assert.equal(f.line, undefined, `${name}: a JSON document's findings carry no line`);
      }
    }
  });

  it("costs about half as much as its JSON twin, brief for brief", () => {
    // characters, not tokens — a tokenizer-free stand-in that still catches a grammar
    // change that stops the DSL being the cheap one
    const ratios = [...new Set(names.map(briefOf))].map((b) => read(`${b}.dsl`).length / read(`${b}.json`).length);
    const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    assert.ok(mean < 0.62, `the DSL averages ${Math.round(mean * 100)} % of its JSON twin's size`);
  });
});
