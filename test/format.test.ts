import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseDsl, toDsl } from "../src/dsl.ts";
import { formatPlan, formatText } from "../src/format.ts";
import { parseWithPositions, spliceAt } from "../src/jsonpos.ts";
import { parse } from "../src/parse.ts";

const FIXTURES = ["casa-t3", "casa-piscina", "quinta", "cabin", "broken", "apartment-t2", "casa-patio", "moradia-2-pisos", "broken-levels", "casa-angulo", "casa-redonda", "broken-geometria", "casa-v"];
const load = (n: string) => readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), "utf8");
const loadDsl = (n: string) => readFileSync(new URL(`../fixtures/${n}.dsl`, import.meta.url), "utf8");

describe("format: the document keeps its meaning", () => {
  it("round trips every fixture", () => {
    for (const n of FIXTURES)
      assert.deepEqual(JSON.parse(formatText(load(n))), JSON.parse(load(n)), n);
  });
  it("is idempotent, so formatting on every edit never drifts", () => {
    for (const n of FIXTURES) {
      const once = formatText(load(n));
      assert.equal(formatText(once), once, n);
    }
  });
  it("parses to the same plan before and after formatting", () => {
    for (const n of FIXTURES)
      assert.deepEqual(parse(JSON.parse(formatText(load(n)))), parse(JSON.parse(load(n))), n);
  });
});

describe("format: every fixture is already in canonical form", () => {
  // the anti-drift gate: a fixture edited by hand into some other shape fails here rather
  // than quietly making the shipped examples disagree with the form the README teaches
  for (const n of FIXTURES)
    it(`${n} is byte-identical to its own canonical form`, () => {
      const text = load(n);
      assert.equal(formatText(text), text);
    });
});

describe("format: one entity per line, compact inside", () => {
  it("never wraps an entity, however long", () => {
    // casa-t3's longest opening is well past any sensible print width
    const lines = formatText(load("casa-t3")).split("\n");
    const openings = lines.filter((l) => l.trim().startsWith('{"type":'));
    assert.equal(openings.length, 23, "one line per opening");
    assert.ok(Math.max(...openings.map((l) => l.length)) > 140, "and no width cut them short");
    for (const l of openings) assert.match(l, /^ {4}\{"type":.*\},?$/);
  });

  it("spends separators on structure and nothing else", () => {
    const out = formatPlan({ rooms: { a: { name: "A", rect: [0, 0, 4, 3] } } });
    assert.equal(out, '{\n  "rooms": {\n    "a": {"name":"A","rect":[0,0,4,3]}\n  }\n}\n');
  });

  it("keeps a short top-level value on its own line rather than exploding it", () => {
    const out = formatPlan({ walls: { exterior: 0.3, partition: 0.12 } });
    assert.equal(out, '{\n  "walls": {"exterior":0.3,"partition":0.12}\n}\n');
  });

  it("keeps points inline and prints numbers shortest-round-trip", () => {
    const out = formatPlan({ rooms: { l: { poly: [[0, 0], [4.6, 0], [4.6, 4.4], [0, 4.4]] } } });
    assert.ok(out.includes('"l": {"poly":[[0,0],[4.6,0],[4.6,4.4],[0,4.4]]}'), out);
    assert.ok(!out.includes("4.60"));
  });

  it("keeps the layout grid as a picture, one row per line", () => {
    const lines = formatText(load("apartment-t2")).split("\n");
    const rows = lines.filter((l) => l.trim().startsWith('"quarto1 ') || l.trim().startsWith('"sala '));
    assert.equal(rows.length, 4, "the areas grid still reads as a grid");
    for (const l of rows) assert.match(l, /^ {6}"/);
  });

  it("is a block whenever it holds entities, however deeply nested", () => {
    // the container/entity decision is a function of shape, not of depth: a schema that
    // grows a `levels` map must format as blocks of one-entity lines, never as one
    // enormous line per level. Nothing in the formatter knows the word "levels".
    const doc = {
      title: "Two storeys",
      walls: { exterior: 0.3, partition: 0.12 },
      levels: {
        ground: {
          rooms: { hall: { kind: "hall", poly: [[0, 0], [4, 0], [4, 3], [0, 3]] } },
          openings: [{ type: "door", between: ["exterior", "hall"], width: 0.9 }],
        },
        first: { rooms: { suite: { kind: "bedroom", poly: [[0, 0], [9, 0], [9, 3], [0, 3]] } }, openings: [] },
      },
    };
    assert.equal(
      formatPlan(doc),
      [
        "{",
        '  "title": "Two storeys",',
        '  "walls": {"exterior":0.3,"partition":0.12},',
        '  "levels": {',
        '    "ground": {',
        '      "rooms": {',
        '        "hall": {"kind":"hall","poly":[[0,0],[4,0],[4,3],[0,3]]}',
        "      },",
        '      "openings": [',
        '        {"type":"door","between":["exterior","hall"],"width":0.9}',
        "      ]",
        "    },",
        '    "first": {',
        '      "rooms": {',
        '        "suite": {"kind":"bedroom","poly":[[0,0],[9,0],[9,3],[0,3]]}',
        "      },",
        '      "openings": []',
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("has no column alignment to maintain", () => {
    // padding to line values up was measured at 4 % of the document; entity lines carry none
    for (const n of FIXTURES)
      for (const line of formatText(load(n)).split("\n"))
        if (line.trim().startsWith("{")) assert.ok(!/ {2}/.test(line.trim()), `${n}: ${line}`);
  });
});

describe("format + splice: a drag only rewrites numbers", () => {
  it("a spliced number leaves the document canonical", () => {
    const text = formatText(load("quinta"));
    const after = spliceAt(text, ["layout", "cols", 1], "3.85").text;
    assert.equal(formatText(after), after, "still canonical, no reformat needed");
    assert.equal(JSON.parse(after).layout.cols[1], 3.85);
  });
  it("touches only the characters of that number", () => {
    const text = formatText(load("quinta"));
    const r = spliceAt(text, ["layout", "cols", 1], "3.85");
    assert.equal(r.text.slice(0, r.start), text.slice(0, r.start));
    assert.equal(r.text.slice(r.start + r.inserted), text.slice(r.start + r.removed));
  });
  it("splices a number inside a rect the same way", () => {
    const text = formatText(load("cabin"));
    const after = spliceAt(text, ["rooms", "sala", "rect", 2], "5.4").text;
    assert.equal(formatText(after), after);
    assert.deepEqual(JSON.parse(after).rooms.sala.rect, [0, 0, 5.4, 4]);
  });
  it("positions still resolve after formatting", () => {
    for (const n of FIXTURES) {
      const text = formatText(load(n));
      assert.doesNotThrow(() => parseWithPositions(text), n);
    }
  });
});

/**
 * README says `formatText(source)` "puts a document into canonical form" (README.md:491)
 * with no mention that this is JSON-only, and `floorplan fmt` already sniffs the syntax
 * (`isDslText` in src/cli.ts's `runFmt`) rather than assuming JSON — so `formatText` should
 * too, instead of throwing `JSON.parse`'s "unexpected token" on a DSL document.
 */
describe("formatText sniffs the syntax, the way `fmt` already does", () => {
  const DSL_TWINS = ["cabin", "casa-t3", "moradia-2-pisos", "casa-v"];

  it("formats DSL text as canonical DSL, not JSON.parse's error", () => {
    for (const n of DSL_TWINS) {
      const text = loadDsl(n);
      assert.equal(formatText(text), toDsl(parseDsl(text).doc), n);
    }
  });

  it("is idempotent on DSL text", () => {
    for (const n of DSL_TWINS) {
      const once = formatText(loadDsl(n));
      assert.equal(formatText(once), once, n);
    }
  });

  it("every canonical .dsl fixture is already its own formatText output", () => {
    for (const n of DSL_TWINS) assert.equal(formatText(loadDsl(n)), loadDsl(n), n);
  });

  it("still formats JSON text as canonical JSON — both spellings, same document", () => {
    for (const n of DSL_TWINS) assert.equal(formatText(load(n)), formatPlan(JSON.parse(load(n))), n);
  });
});
