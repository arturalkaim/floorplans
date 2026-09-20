// The headline count (first-time schema failures) came out 0–0, so it discriminates
// nothing. This is the follow-up that does: take the *same* five authoring slips, make
// each one in both syntaxes, and record what the document says back. What matters to an
// agent is not only whether it makes a mistake but whether one read of the message is
// enough to fix it.
//
//   node docs/eval/slips.mjs
import { readFileSync } from "node:fs";
import { isSchemaFinding, lint } from "../../src/index.ts";

const dir = new URL("./plans/", import.meta.url);
const base = (ext) => readFileSync(new URL(`03-two-bed.${ext}`, dir), "utf8");

/** [name, what the slip is, json edit, dsl edit] */
const SLIPS = [
  [
    "misspelt field",
    "the width of a door, typed wrong",
    (t) => t.replace('"between":["corredor","sala"],"width":0.9', '"between":["corredor","sala"],"widht":0.9'),
    (t) => t.replace("door corredor>sala w0.9", "door corredor>sala wd0.9"),
  ],
  [
    "value outside an enum",
    "a room kind that is not one",
    (t) => t.replace('"kind":"living"', '"kind":"livingroom"'),
    (t) => t.replace('room sala "Living room" living', 'room sala "Living room" livingroom'),
  ],
  [
    "required value missing",
    "a door with no width at all",
    (t) => t.replace('{"type":"door","between":["corredor","q1"],"width":0.8,"swingInto":"q1"}', '{"type":"door","between":["corredor","q1"],"swingInto":"q1"}'),
    (t) => t.replace("door corredor>q1 w0.8 swing:q1", "door corredor>q1 swing:q1"),
  ],
  [
    "reference to nothing",
    "a door to a room that was never declared",
    (t) => t.replace('"between":["corredor","q2"]', '"between":["corredor","quarto2"]'),
    (t) => t.replace("door corredor>q2 ", "door corredor>quarto2 "),
  ],
  [
    "geometry half written",
    "a rectangle with its size left off",
    (t) => t.replace('"rect":[0,4.7,3.5,3.3]', '"rect":[0,4.7]'),
    (t) => t.replace("rect 0,4.7 3.5x3.3", "rect 0,4.7"),
  ],
];

for (const [name, what, editJson, editDsl] of SLIPS) {
  console.log(`\n## ${name} — ${what}`);
  for (const [syntax, text] of [
    ["json", editJson(base("json"))],
    ["dsl", editDsl(base("dsl"))],
  ]) {
    const schema = lint(text).findings.filter(isSchemaFinding);
    // a tokenizer message already opens with `line N:` (the house style), so the locator
    // column shows the JSON path in that case rather than saying the line twice
    const where = (f) => (f.message.startsWith("line ") ? f.path || "—" : f.line !== undefined ? `line ${f.line}` : f.path || "(root)");
    console.log(`${syntax.padEnd(5)} ${schema.length} finding(s)`);
    for (const f of schema) console.log(`        ${where(f)}: ${f.message}`);
  }
}
