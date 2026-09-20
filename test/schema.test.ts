import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FIXTURE_TYPES, ID_RE, OPENING_TYPES, ROOM_KINDS, SCHEMA, SIDES, SWEEPS, VERTICAL_TYPES } from "../src/index.ts";

const SRC = readFileSync(new URL("../src/parse.ts", import.meta.url), "utf8");
// Everything from here on is document-parsing logic: `obj["key"]`-style bracket access
// below this point is always a JSON field read. Above it, SCHEMA and the TypeScript types
// that describe it also contain bracket syntax (e.g. `ObjectDoc["object"]`), which is a
// type-level lookup, not a document read, and must not be mistaken for one.
const PARSE_LOGIC = SRC.slice(SRC.indexOf("\ntype J = Record<string, unknown>;"));

/**
 * Every `checkKeys(path, obj, known, bad)` call site in parse.ts, as the raw source text
 * of its `known` (3rd) argument. Parens/brackets are balanced by hand rather than matched
 * with a single regex, because that argument itself contains a ternary with a spread
 * (`hasLevels ? PLAN_FIELDS : [...PLAN_FIELDS, ...LEVEL_CONTENT_FIELDS]`).
 */
function checkKeysCallSites(): string[] {
  const calls: string[] = [];
  const re = /checkKeys\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SRC))) {
    // skip the function's own declaration: `function checkKeys(path: string, obj: J, ...)`
    const before = SRC.slice(Math.max(0, m.index - 9), m.index);
    if (before.includes("function ")) continue;
    let depth = 1;
    let i = m.index + "checkKeys(".length;
    const start = i;
    for (; i < SRC.length && depth > 0; i++) {
      if (SRC[i] === "(") depth++;
      else if (SRC[i] === ")") depth--;
    }
    const argsText = SRC.slice(start, i - 1);
    // split on top-level commas only (depth-0 w.r.t. (), [], {})
    const args: string[] = [];
    let d = 0;
    let last = 0;
    for (let j = 0; j < argsText.length; j++) {
      const c = argsText[j];
      if (c === "(" || c === "[" || c === "{") d++;
      else if (c === ")" || c === "]" || c === "}") d--;
      else if (c === "," && d === 0) {
        args.push(argsText.slice(last, j));
        last = j + 1;
      }
    }
    args.push(argsText.slice(last));
    assert.equal(args.length, 4, `checkKeys call at offset ${m.index} has ${args.length} args, expected 4: ${argsText}`);
    calls.push(args[2]!.trim());
  }
  return calls;
}

describe("SCHEMA is the source checkKeys reads its known keys from", () => {
  it("every checkKeys call site draws its known-key list from SCHEMA-derived identifiers, never an inline string literal", () => {
    const sites = checkKeysCallSites();
    assert.ok(sites.length >= 14, `expected at least 14 checkKeys call sites, found ${sites.length}`);
    for (const known of sites) {
      assert.ok(!known.includes('"'), `checkKeys known-key argument looks like an inline literal, not a SCHEMA-derived constant: ${known}`);
    }
  });

  it("has exactly the objects the parser's checkKeys call sites need", () => {
    const objects = SCHEMA.map((o) => o.object).sort();
    assert.deepEqual(
      objects,
      [
        "arc",
        "fixture",
        "grid",
        "layout",
        "level",
        "opening",
        "opening.on",
        "opening.position",
        "outdoor",
        "plan",
        "room",
        "vertical",
        "vertical.footprint",
        "void",
        "walls",
      ].sort(),
    );
  });

  it("every enum field points at one of the parser's own exported vocabularies, by reference", () => {
    const vocabularies = [ROOM_KINDS, SIDES, OPENING_TYPES, FIXTURE_TYPES, VERTICAL_TYPES, SWEEPS];
    for (const o of SCHEMA) {
      for (const f of o.fields) {
        if (f.type !== "enum") {
          assert.equal(f.enum, undefined, `${o.object}.${f.name} has type ${f.type} but also an enum`);
          continue;
        }
        assert.ok(f.enum, `${o.object}.${f.name} has type "enum" but no enum set`);
        assert.ok(
          vocabularies.some((v) => v === f.enum),
          `${o.object}.${f.name}.enum is not === one of ROOM_KINDS/SIDES/OPENING_TYPES/FIXTURE_TYPES/VERTICAL_TYPES/SWEEPS — looks like a copy`,
        );
      }
    }
  });

  // Fix 2, docs/eval/cold/cold-run.md: every field literally named "id" (opening.id,
  // fixture.id, vertical.id) is documented as matching ID_RE, and its doc string carries
  // the regex's own source text rather than a hand-typed copy that could drift from it —
  // `floorplan --schema`'s legend takes the same constant (test/cli.test.ts).
  it("documents every field named \"id\" with parse.ts's own ID_RE source, not a copy", () => {
    for (const o of SCHEMA) for (const f of o.fields) if (f.name === "id") assert.ok(f.doc.startsWith(ID_RE.source), `${o.object}.id's doc does not start with ID_RE.source (${ID_RE.source}): ${f.doc}`);
  });

  it("has no duplicate field name within one object, and every object has at least one field", () => {
    for (const o of SCHEMA) {
      assert.ok(o.fields.length > 0, `${o.object} has no fields`);
      assert.equal(new Set(o.fields.map((f) => f.name)).size, o.fields.length, `${o.object} has a duplicate field name`);
    }
  });

  // Fix 1, docs/eval/cold/cold-run.md: `type: "object"` alone cannot say whether a field is
  // a single nested object, an array, or an id-keyed map — the ambiguity that made every
  // cold-agent JSON authoring attempt guess "array" for `levels` and fail schema on line
  // one. `shape` is the fact SCHEMA now carries for exactly this, and it means nothing for
  // any other field type — so this asserts the two sets (object-typed, shape-carrying)
  // coincide exactly in both directions.
  it("gives every `type: \"object\"` field a shape, and no other field one", () => {
    for (const o of SCHEMA) {
      for (const f of o.fields) {
        if (f.type === "object") assert.ok(f.shape, `${o.object}.${f.name} is type "object" but has no shape`);
        else assert.equal(f.shape, undefined, `${o.object}.${f.name} has type ${f.type} but also a shape`);
      }
    }
  });

  // ---- cross-check against what parse.ts actually reads (both directions) ----

  const allFieldNames = new Set(SCHEMA.flatMap((o) => o.fields.map((f) => f.name)));

  /** Keys parse.ts reads via `obj["key"]` bracket-literal access. */
  function bracketAccessedKeys(): Set<string> {
    const keys = new Set<string>();
    for (const m of PARSE_LOGIC.matchAll(/\["([a-zA-Z][a-zA-Z0-9_]*)"\]/g)) keys.add(m[1]!);
    return keys;
  }

  it("documents no field parse.ts does not read (a SCHEMA field with no reader)", () => {
    // A reader is either `obj["name"]` (most fields) or `flag("name", ...)` (the three
    // boolean overrides on a room, read through a variable-keyed helper) — searched only in
    // the parsing logic, never in SCHEMA's own `{ name: "poly", ... }` literals, or every
    // field would trivially "have a reader" just by being documented.
    const undocumented = [...allFieldNames].filter((name) => !PARSE_LOGIC.includes(`"${name}"`)).sort();
    assert.deepEqual(undocumented, [], `SCHEMA documents these fields but parse.ts never reads them: ${undocumented.join(", ")}`);
  });

  it("reads no field SCHEMA does not document (a reader with no SCHEMA entry)", () => {
    const undocumented = [...bracketAccessedKeys()].filter((k) => !allFieldNames.has(k)).sort();
    assert.deepEqual(undocumented, [], `parse.ts reads these keys but SCHEMA does not document them: ${undocumented.join(", ")}`);
  });
});
