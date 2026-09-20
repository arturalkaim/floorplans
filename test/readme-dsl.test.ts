import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ARC_SYNTAX, DSL_SCHEMA, SCHEMA } from "../src/index.ts";

/**
 * The README's DSL grammar is generated from `DSL_SCHEMA`, not written by hand — the same
 * rule `--schema=dsl` and `app/src/routes/reference.tsx` follow, and for the same reason
 * (docs/agent-review.md B10: a hand-written table drifts from the parser).
 *
 * This test is both the generator and the guard. Run it with UPDATE_README=1 to rewrite
 * the block after a grammar change; run it normally and it fails when the two disagree.
 */
const README = new URL("../README.md", import.meta.url);
const OPEN = "<!-- generated from DSL_SCHEMA by test/readme-dsl.test.ts; run it with UPDATE_README=1 after a grammar change -->";
const CLOSE = "<!-- /generated -->";

/** The grammar, as the README prints it: the statements, then every field's token. */
export function readmeBlock(): string {
  const statements = DSL_SCHEMA.map((s) => `${s.syntax}\n${s.doc.split("\n").map((l) => `    ${l}`).join("\n")}`).join("\n\n");
  const rows = SCHEMA.flatMap((o) =>
    o.fields.map((f) => {
      const key = `${o.object}.${f.name}`;
      const tokens = [...new Set(DSL_SCHEMA.flatMap((s) => s.tokens.filter((t) => t.field === key).map((t) => t.token)))];
      return `| \`${key}\` | ${tokens.map((t) => `\`${t.trim()}\``).join(" · ")} |`;
    }),
  );
  return [
    "```",
    statements,
    "",
    "a poly element is a corner or an arc to it:",
    "    <x>,<y>",
    `    ${ARC_SYNTAX}`,
    "```",
    "",
    `Every field of the JSON schema, and the token that writes it — all ${rows.length} of them, and`,
    "`test/dsl-schema.test.ts` fails if the parser grows a field with no spelling here.",
    "",
    "| field | token |",
    "|---|---|",
    ...rows,
  ].join("\n");
}

describe("the README's DSL grammar is generated, not written", () => {
  it("matches DSL_SCHEMA", () => {
    const text = readFileSync(README, "utf8");
    const from = text.indexOf(OPEN);
    const to = text.indexOf(CLOSE);
    assert.ok(from !== -1 && to > from, "README.md has no generated DSL-grammar block");
    const current = text.slice(from + OPEN.length, to).trim();
    const wanted = readmeBlock();
    if (current !== wanted && process.env["UPDATE_README"]) {
      writeFileSync(README, `${text.slice(0, from + OPEN.length)}\n\n${wanted}\n\n${text.slice(to)}`);
      return;
    }
    assert.equal(current, wanted, "README's DSL grammar is stale; re-run with UPDATE_README=1");
  });
});
