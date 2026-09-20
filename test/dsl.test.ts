import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DslError, floorplan, isDslText, lint, parse, parseDsl, toDsl } from "../src/index.ts";
import { twoStoreys } from "./helpers.ts";

const doc = (text: string) => parseDsl(text).doc;
const load = (name: string, ext: "json" | "dsl") => readFileSync(new URL(`../fixtures/${name}.${ext}`, import.meta.url), "utf8");

/**
 * A parsed plan with every `authored` list sorted. `authored` records *which* fields a
 * document wrote, and `pathTo` only ever asks whether one is in it (src/types.ts) — the
 * order is the order the keys happened to be written in, so two documents that differ
 * only there mean the same thing.
 */
const sortAuthored = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (k, x) => (k === "authored" && Array.isArray(x) ? [...(x as string[])].sort() : x)));

/** Parse and assert it threw, returning the issues so a test can read their text. */
function issuesOf(text: string) {
  try {
    parseDsl(text);
  } catch (e) {
    assert.ok(e instanceof DslError, `expected a DslError, got ${String(e)}`);
    return e.issues;
  }
  assert.fail(`expected ${JSON.stringify(text)} to fail`);
}

describe("the grammar: one entity per line", () => {
  it("compiles the header onto the document root", () => {
    assert.deepEqual(doc('plan "Casa" units:m walls 0.3/0.12 north 15 stack a,b'), {
      title: "Casa",
      units: "m",
      walls: { exterior: 0.3, partition: 0.12 },
      north: 15,
      stack: ["a", "b"],
    });
  });

  it("accepts walls and north as statements of their own", () => {
    assert.deepEqual(doc("walls 0.25/0.1\nnorth 90"), { walls: { exterior: 0.25, partition: 0.1 }, north: 90 });
    assert.deepEqual(doc("walls partition:0.1"), { walls: { partition: 0.1 } });
  });

  it("reads the shared track grid", () => {
    assert.deepEqual(doc("grid cols 4.9,1.2 rows 1.4,1.8,2"), { grid: { cols: [4.9, 1.2], rows: [1.4, 1.8, 2] } });
  });

  it("reads a room's id, name, kind, zone and geometry, in that order", () => {
    assert.deepEqual(doc('room sala "Sala" living day rect 0,0 4.6x4.4'), {
      rooms: { sala: { name: "Sala", kind: "living", zone: "day", rect: [0, 0, 4.6, 4.4] } },
    });
  });

  it("treats a bare word as the kind when it is one and as the zone otherwise", () => {
    assert.deepEqual(doc("room a bedroom"), { rooms: { a: { kind: "bedroom" } } });
    assert.deepEqual(doc("room a night"), { rooms: { a: { zone: "night" } } });
    // a zone that is spelled like a kind needs the prefix, and gets it back on the way out
    assert.deepEqual(doc("room a bedroom zone:bath"), { rooms: { a: { kind: "bedroom", zone: "bath" } } });
    assert.equal(toDsl({ rooms: { a: { kind: "bedroom", zone: "bath" } } }), "room a bedroom zone:bath\n");
  });

  it("reads a polygon, and the boolean overrides in both directions", () => {
    assert.deepEqual(doc("room a poly 0,0 4,0 4,3 0,3 wet circulation:false"), {
      rooms: { a: { poly: [[0, 0], [4, 0], [4, 3], [0, 3]], wet: true, circulation: false } },
    });
  });

  it("reads outdoor spaces and voids", () => {
    assert.deepEqual(doc('outdoor deck "Deck" covered rect 0,4 5x2'), { outdoor: { deck: { name: "Deck", covered: true, rect: [0, 4, 5, 2] } } });
    assert.deepEqual(doc('void vazio "Caixa"'), { voids: { vazio: { name: "Caixa" } } });
  });

  it("reads a layout as an indented ASCII block", () => {
    assert.deepEqual(doc("layout cols 3,4 rows 5\n  hall sala"), { layout: { cols: [3, 4], rows: [5], areas: ["hall sala"] } });
    // with no tracks of its own, the level sits on the shared grid
    assert.deepEqual(doc("layout\n  a b\n  a c"), { layout: { areas: ["a b", "a c"] } });
  });

  it("reads an opening's spaces, placement, width and flags in any token order", () => {
    const a = doc("door hall>wc @0.6 w0.8 hinge:end swing:wc entrance glazed id:porta");
    const b = doc("door hall>wc w0.8 @0.6 id:porta glazed entrance swing:wc hinge:end");
    assert.deepEqual(a, b);
    assert.deepEqual(a, {
      openings: [{ id: "porta", type: "door", between: ["hall", "wc"], width: 0.8, position: 0.6, hinge: "end", swingInto: "wc", entrance: true, glazed: true }],
    });
  });

  it("measures @-<d> from the run's end and @<d> from its start", () => {
    assert.deepEqual((doc("door a>b @-0.7 w1")["openings"] as Array<Record<string, unknown>>)[0]!["position"], { from: "end", distance: 0.7 });
    assert.equal((doc("door a>b @0.7 w1")["openings"] as Array<Record<string, unknown>>)[0]!["position"], 0.7);
  });

  it("expands `<room>[.<side>]` to a street opening with an `on`", () => {
    assert.deepEqual(doc("window suite.north @2.3 w2.2"), {
      openings: [{ type: "window", between: ["exterior", "suite"], width: 2.2, position: 2.3, on: { room: "suite", side: "north" } }],
    });
    assert.deepEqual(doc("window quarto1 w1.8"), { openings: [{ type: "window", between: ["exterior", "quarto1"], width: 1.8 }] });
  });

  it("takes `-` as well as `>` between two spaces, the way the review's sample wrote it", () => {
    assert.deepEqual(doc("cased hall-distrib w1.4"), doc("cased hall>distrib w1.4"));
  });

  it("reads absolute placement, on: and near:", () => {
    assert.deepEqual(doc("door a>b at:0.9,4 w0.9"), { openings: [{ type: "door", between: ["a", "b"], width: 0.9, at: [0.9, 4] }] });
    // gaps-design.md §1.2 writes the same thing with a space; both are accepted
    assert.deepEqual(doc("door a>b at 0.9,4 w0.9"), doc("door a>b at:0.9,4 w0.9"));
    assert.deepEqual(doc("window a>b w1 on:b.east near:3,4"), {
      openings: [{ type: "window", between: ["a", "b"], width: 1, on: { room: "b", side: "east", near: [3, 4] } }],
    });
  });

  it("reads a fixture in either geometry form", () => {
    assert.deepEqual(doc('fixture sink in:cozinha at 7.7,0.3 size 3.8x0.6 "Bancada" depth:0.6 id:banc'), {
      fixtures: [{ id: "banc", type: "sink", in: "cozinha", at: [7.7, 0.3], size: [3.8, 0.6], depth: 0.6, name: "Bancada" }],
    });
    assert.deepEqual(doc("fixture pool in:deck poly 0,0 4,0 4,2 0,2"), {
      fixtures: [{ type: "pool", in: "deck", poly: [[0, 0], [4, 0], [4, 2], [0, 2]] }],
    });
  });

  it("reads vertical circulation with one indented footprint per level", () => {
    const text = 'stairs escada "Escada" up:0 risers:15\n  at piso0 in:hall rect 4.95,0.2 1.1x3.64\n  at piso1 in:hall_sup poly 0,0 1,0 1,1 0,1';
    assert.deepEqual(doc(text), {
      vertical: [
        {
          id: "escada",
          type: "stairs",
          name: "Escada",
          at: [
            { level: "piso0", in: "hall", rect: [4.95, 0.2, 1.1, 3.64] },
            { level: "piso1", in: "hall_sup", poly: [[0, 0], [1, 0], [1, 1], [0, 1]] },
          ],
          up: 0,
          risers: 15,
        },
      ],
    });
    // `vertical <id> <type>` is the same statement spelled out
    assert.deepEqual(doc("vertical escada stairs\n  at p in:h rect 0,0 1x1"), doc("stairs escada\n  at p in:h rect 0,0 1x1"));
  });

  it("makes a level header a section: every statement after it belongs to that level", () => {
    const text = 'level piso0 "Piso 0" h2.7 ground\nroom hall rect 0,0 3x5\n\nlevel piso1 h2.6\nroom quarto rect 0,0 3x5';
    assert.deepEqual(doc(text), {
      levels: {
        piso0: { name: "Piso 0", height: 2.7, ground: true, rooms: { hall: { rect: [0, 0, 3, 5] } } },
        piso1: { height: 2.6, rooms: { quarto: { rect: [0, 0, 3, 5] } } },
      },
    });
  });

  it("drops comments and blank lines", () => {
    assert.deepEqual(doc("# the ground floor\n\nroom a rect 0,0 1x1  # square\n"), { rooms: { a: { rect: [0, 0, 1, 1] } } });
  });

  it("carries an arc token inside poly, so curves need no new production", () => {
    assert.deepEqual(doc("room r poly 5,2 5,5 arc 11,5 r3.5 ccw large 11,2"), {
      rooms: { r: { poly: [[5, 2], [5, 5], { arc: [11, 5], r: 3.5, sweep: "ccw", large: true }, [11, 2]] } },
    });
    assert.equal(toDsl(doc("room r poly 5,2 5,5 arc 11,5 r3.5 ccw 11,2")), "room r poly 5,2 5,5 arc 11,5 r3.5 ccw 11,2\n");
  });
});

describe("errors carry the line, and every bad line is reported", () => {
  it("names the line and says what was wanted", () => {
    const [i] = issuesOf("room a rect 0,0 4x3\ndoor w0.8");
    assert.equal(i!.line, 2);
    assert.equal(i!.message, 'line 2: door needs two spaces separated by ">"; got "w0.8"');
  });

  it("reports every bad line rather than stopping at the first", () => {
    const issues = issuesOf("room a rect nonsense\ndoor a>b w-\nfixture pool");
    assert.deepEqual([...new Set(issues.map((i) => i.line))], [1, 2, 3]);
  });

  it("gives a column, and suggests the statement vocabulary for an unknown verb", () => {
    const [i] = issuesOf("  \nrooom a rect 0,0 1x1");
    assert.equal(i!.line, 2);
    assert.equal(i!.column, 1);
    assert.match(i!.message, /unknown statement "rooom"; expected one of plan, walls, north, grid, level, room/);
  });

  it("refuses an indented line with no statement above it", () => {
    assert.match(issuesOf("  at piso0 in:hall rect 0,0 1x1")[0]!.message, /an indented line continues the statement above it/);
  });

  it("refuses an unterminated name", () => {
    assert.match(issuesOf('room a "Sala')[0]!.message, /unterminated quoted name/);
  });

  it("reaches lint() as schema.syntax findings that carry their line", () => {
    const r = lint("room a rect 0,0 4x3\ndoor w0.8");
    assert.equal(r.plan, undefined);
    assert.deepEqual(r.findings.map((f) => [f.rule, f.line]), [["schema.syntax", 2]]);
  });

  it("gives a schema problem its line too, though the text itself parsed", () => {
    // the grammar is happy — `hall` is simply not a room anyone declared, which is the
    // one schema checker's business, and its path resolves back to the line
    const r = lint("room a rect 0,0 4x3\ndoor hall w0.8");
    assert.deepEqual(r.findings.map((f) => [f.rule, f.path, f.line]), [["schema.reference", "openings[0].between[1]", 2]]);
  });
});

describe("sniffing: `{` is JSON, anything else is the DSL", () => {
  it("classifies by the first non-space character only", () => {
    assert.equal(isDslText('{"rooms":{}}'), false);
    assert.equal(isDslText("\n  { }"), false);
    assert.equal(isDslText("room a rect 0,0 1x1"), true);
    assert.equal(isDslText("  "), false);
  });

  it("leaves a JSON document byte-identical in every entry point", () => {
    const json = load("casa-t3", "json");
    assert.deepEqual(parse(json), parse(JSON.parse(json)));
    assert.equal(floorplan(json).svg, floorplan(JSON.parse(json)).svg);
    // and a JSON document's findings gain nothing: `line` belongs to the DSL alone
    assert.ok(lint(json).findings.every((f) => f.line === undefined));
  });

  it("keeps JSON's own message for a document that is neither", () => {
    assert.throws(() => parse("{ not json"), /not valid JSON/);
  });
});

describe("round-trip", () => {
  const texts = ["casa-t3", "moradia-2-pisos", "cabin"].map((n) => load(n, "dsl"));

  it("prints back byte-identically from canonical text", () => {
    for (const t of texts) assert.equal(toDsl(parseDsl(t).doc), t);
  });

  it("loses no value from a document the parser produced", () => {
    for (const t of texts) {
      const d = parseDsl(t).doc;
      assert.deepEqual(parseDsl(toDsl(d)).doc, d);
    }
  });

  it("preserves the meaning of any JSON document, synonyms folded", () => {
    for (const name of ["casa-t3", "apartment-t2", "casa-piscina", "quinta", "casa-patio", "cabin", "moradia-2-pisos"]) {
      const json = JSON.parse(load(name, "json"));
      assert.deepEqual(sortAuthored(parse(parseDsl(toDsl(json)).doc)), sortAuthored(parse(json)), name);
    }
  });

  it("is idempotent", () => {
    for (const t of texts) assert.equal(toDsl(parseDsl(toDsl(parseDsl(t).doc)).doc), t);
  });

  it("round-trips the two-storey helper, vertical element and all", () => {
    const d = twoStoreys();
    assert.deepEqual(sortAuthored(parse(parseDsl(toDsl(d)).doc)), sortAuthored(parse(d)));
  });

  it("refuses to print a document whose private key it cannot spell", () => {
    // `_`/`x-` keys are the one thing the DSL cannot express, so a document carrying one
    // is refused outright rather than silently losing it. broken-levels.json has one.
    assert.throws(() => toDsl({ _note: "mine", rooms: {} }), /no spelling for the private key "_note"/);
    assert.throws(() => toDsl(JSON.parse(load("broken-levels", "json"))), /no spelling for the private key "_note"/);
  });
});

describe("stable ids are the same for a DSL document as for its JSON twin", () => {
  it("synthesises the same opening and fixture ids on both sides", () => {
    for (const name of ["casa-t3", "moradia-2-pisos", "cabin"]) {
      const a = parse(load(name, "json"));
      const b = parse(load(name, "dsl"));
      for (let i = 0; i < a.levels.length; i++) {
        assert.deepEqual(b.levels[i]!.openings.map((o) => o.id), a.levels[i]!.openings.map((o) => o.id), name);
        assert.deepEqual(b.levels[i]!.fixtures.map((f) => f.id), a.levels[i]!.fixtures.map((f) => f.id), name);
      }
    }
  });

  it("keeps an authored id, and the sorted pair, through the DSL", () => {
    const p = parse("room hall rect 0,0 3x3\nroom wc rect 3,0 2x3\ndoor wc>hall w0.8 id:porta\ndoor hall>wc w0.7");
    assert.deepEqual(p.openings.map((o) => o.id), ["porta", "door:hall-wc:1"]);
  });
});

describe("findings carry the line an agent can act on", () => {
  it("resolves a finding's JSON path to its DSL line", () => {
    const text = load("casa-t3", "dsl");
    const r = lint(text);
    const lines = text.split("\n");
    for (const f of r.findings) {
      if (f.line === undefined) continue;
      // the line a finding names is the statement its path is about
      assert.ok(lines[f.line - 1]!.trim().length > 0, `finding ${f.rule} points at a blank line ${f.line}`);
    }
    const wc = r.findings.find((f) => f.path === "rooms.wc_suite");
    assert.equal(lines[wc!.line! - 1], 'room wc_suite "WC suite" bath night rect 4.6,0 2.2x2.2');
  });

  it("leaves `path` exactly as the JSON contract defines it", () => {
    const a = lint(load("cabin", "json")).findings.map((f) => f.path);
    const b = lint(load("cabin", "dsl")).findings.map((f) => f.path);
    assert.deepEqual(b, a);
  });
});
