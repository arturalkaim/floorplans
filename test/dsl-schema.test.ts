import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMPASS_LINE, DSL_SCHEMA, dslSchemaText, parseDsl, SCHEMA, toDsl } from "../src/index.ts";

/** Every `<object>.<field>` the JSON schema has. */
const schemaFields = SCHEMA.flatMap((o) => o.fields.map((f) => `${o.object}.${f.name}`));
/** Every field some DSL token claims to write. */
const covered = new Set(DSL_SCHEMA.flatMap((s) => s.tokens.map((t) => t.field)));

describe("the DSL grammar covers the whole schema", () => {
  it("has a token for every field in SCHEMA", () => {
    // This is the drift guard the JSON side gets from `checkKeys` reading SCHEMA: add a
    // field to the parser without a DSL spelling for it and this fails, so a document can
    // never express something in one syntax that it cannot express in the other.
    const missing = schemaFields.filter((f) => !covered.has(f));
    assert.deepEqual(missing, [], `no DSL token writes: ${missing.join(", ")}`);
  });

  it("names no field the schema does not have", () => {
    const known = new Set(schemaFields);
    const strays = [...covered].filter((f) => !known.has(f));
    assert.deepEqual(strays, [], `DSL tokens name fields SCHEMA has no entry for: ${strays.join(", ")}`);
  });

  it("gives every statement a syntax line and every token a doc sentence", () => {
    for (const s of DSL_SCHEMA) {
      assert.ok(s.syntax.length > 0, `${s.statement} has no syntax`);
      assert.ok(s.doc.length > 0, `${s.statement} has no doc`);
      for (const t of s.tokens) assert.ok(t.doc.length > 0, `${s.statement}/${t.token} has no doc`);
    }
  });

  it("prints every statement by default, but the field index only under {fieldIndex: true} (--schema=dsl-full)", () => {
    const terse = dslSchemaText();
    for (const s of DSL_SCHEMA) assert.ok(terse.includes(s.syntax.split("\n")[0]!), `--schema=dsl omits ${s.statement}`);
    for (const f of schemaFields) assert.doesNotMatch(terse, new RegExp(`^${f.replace(/\./g, "\\.")}\\s`, "m"), `--schema=dsl (default) should no longer carry the field index, but still has ${f}`);

    const full = dslSchemaText({ fieldIndex: true });
    for (const s of DSL_SCHEMA) assert.ok(full.includes(s.syntax.split("\n")[0]!), `--schema=dsl-full omits ${s.statement}`);
    for (const f of schemaFields) assert.match(full, new RegExp(`^${f.replace(/\./g, "\\.")}\\s`, "m"), `--schema=dsl-full omits ${f}`);
  });

  it("puts the stairs statement's worked multi-level example before its doc sentence, not after", () => {
    const text = dslSchemaText();
    const stairs = DSL_SCHEMA.find((s) => s.statement === "stairs | lift | ramp")!;
    assert.ok(stairs.example, "the stairs statement should have a worked example");
    const exampleAt = text.indexOf(stairs.example!);
    const docAt = text.indexOf(`— ${stairs.doc}`);
    assert.ok(exampleAt !== -1 && docAt !== -1 && exampleAt < docAt, "the worked example should appear before the doc sentence");
    // and it actually shows one `at` line per level, the fact 4/20 cold-agent DSL files got
    // wrong (docs/eval/cold/cold-run.md item 2 under "Rule findings")
    const atLines = stairs.example!.split("\n").filter((l) => l.trim().startsWith("at "));
    assert.equal(atLines.length, 2, `the stairs example should show 2 "at" lines (one per level served), found ${atLines.length}`);
  });

  it("states the x/y ↔ compass convention (docs/eval/cold/cold-run.md item 3)", () => {
    assert.ok(dslSchemaText().includes(COMPASS_LINE));
  });

  it("ends with a worked example when one is given, converted through toDsl", () => {
    const doc = { rooms: { a: { rect: [0, 0, 3, 3] } } };
    const text = dslSchemaText({ example: doc });
    assert.match(text, /## example\n\nroom a rect 0,0 3x3\n?$/);
  });
});

describe("every documented token actually parses", () => {
  // One line per statement kind, exercising the tokens the table advertises. If a token is
  // renamed in the grammar but not here the line stops compiling to what it claims.
  const cases: Array<[string, unknown]> = [
    ['plan "T" units:m walls 0.3/0.12 north 5 stack a,b', { title: "T", units: "m", walls: { exterior: 0.3, partition: 0.12 }, north: 5, stack: ["a", "b"] }],
    ["grid cols 1,2 rows 3", { grid: { cols: [1, 2], rows: [3] } }],
    ['level g "G" h2.7 ground', { levels: { g: { name: "G", height: 2.7, ground: true } } }],
    [
      'room r "R" bath zone:z rect 1,2 3x4 habitable wet:false circulation',
      { rooms: { r: { name: "R", kind: "bath", zone: "z", rect: [1, 2, 3, 4], habitable: true, wet: false, circulation: true } } },
    ],
    ['outdoor o "O" covered poly 0,0 1,0 1,1 0,1', { outdoor: { o: { name: "O", covered: true, poly: [[0, 0], [1, 0], [1, 1], [0, 1]] } } }],
    ['void v "V" rect 0,0 1x1', { voids: { v: { name: "V", rect: [0, 0, 1, 1] } } }],
    ["layout cols 1,2 rows 3\n  a b", { layout: { cols: [1, 2], rows: [3], areas: ["a b"] } }],
    [
      "door a>b @-1.5 w0.9 on:a.east near:1,2 hinge:end swing:b entrance glazed id:p",
      { openings: [{ id: "p", type: "door", between: ["a", "b"], width: 0.9, position: { from: "end", distance: 1.5 }, on: { room: "a", side: "east", near: [1, 2] }, hinge: "end", swingInto: "b", entrance: true, glazed: true }] },
    ],
    ["window a>b at:1,2 w1", { openings: [{ type: "window", between: ["a", "b"], width: 1, at: [1, 2] }] }],
    ["cased a>b w1", { openings: [{ type: "cased", between: ["a", "b"], width: 1 }] }],
    ['fixture pool in:deck at 1,2 size 3x4 "P" depth:1.4 id:f', { fixtures: [{ id: "f", type: "pool", in: "deck", at: [1, 2], size: [3, 4], depth: 1.4, name: "P" }] }],
    ["fixture bath in:wc poly 0,0 1,0 1,1 0,1", { fixtures: [{ type: "bath", in: "wc", poly: [[0, 0], [1, 0], [1, 1], [0, 1]] }] }],
    [
      'lift l "L" up:90 risers:2\n  at g in:hall rect 0,0 1x1\n  at h in:hall poly 0,0 1,0 1,1 0,1',
      { vertical: [{ id: "l", type: "lift", name: "L", at: [{ level: "g", in: "hall", rect: [0, 0, 1, 1] }, { level: "h", in: "hall", poly: [[0, 0], [1, 0], [1, 1], [0, 1]] }], up: 90, risers: 2 }] },
    ],
    ["ramp r\n  at g in:h rect 0,0 1x1", { vertical: [{ id: "r", type: "ramp", at: [{ level: "g", in: "h", rect: [0, 0, 1, 1] }] }] }],
    ["# nothing but a comment", {}],
  ];

  for (const [text, expected] of cases)
    it(JSON.stringify(text.split("\n")[0]), () => {
      assert.deepEqual(parseDsl(text).doc, expected);
      // and the printer writes the same document back out
      assert.deepEqual(parseDsl(toDsl(expected)).doc, expected);
    });
});
