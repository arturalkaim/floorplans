import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DslError, floorplan, isDslText, isSchemaFinding, lint, OPENING_TYPES, parse, parseDsl, toDsl, VERTICAL_TYPES } from "../src/index.ts";
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

  it("takes two bare words as the kind then the zone, and refuses a kind that is not one", () => {
    assert.deepEqual(doc("room a bedroom"), { rooms: { a: { kind: "bedroom" } } });
    assert.deepEqual(doc("room a bedroom night"), { rooms: { a: { kind: "bedroom", zone: "night" } } });
    // a zone on a room with no kind is written out, and prints back that way
    assert.deepEqual(doc("room a zone:night"), { rooms: { a: { zone: "night" } } });
    assert.equal(toDsl({ rooms: { a: { zone: "night" } } }), "room a zone:night\n");
    // a zone spelled like a kind reads back correctly, because the kind slot is taken
    assert.deepEqual(doc("room a bedroom bath"), { rooms: { a: { kind: "bedroom", zone: "bath" } } });
    assert.equal(toDsl({ rooms: { a: { kind: "bedroom", zone: "bath" } } }), "room a bedroom bath\n");
    // and the mistake the authoring eval found: a misspelt kind is a mistake, not a zone
    assert.match(
      issuesOf('room sala "Sala" livingroom rect 0,0 4x3')[0]!.message,
      /^line 1: room sala: "livingroom" is not a room kind; one of bedroom, living, .* — a zone is written zone:<z>$/,
    );
  });

  it("reports one unexpected token, not one for every token after it", () => {
    // measured at three findings for one mistyped width before this
    const issues = issuesOf("room a living rect 0,0 4x3\ndoor a>b wd0.9 swing:b");
    assert.equal(issues.filter((i) => i.message.includes("unexpected")).length, 1);
    assert.match(issues[0]!.message, /^line 2: door: unexpected "wd0.9"; the rest of the line was not read — door takes /);
    assert.match(issues[0]!.message, /w<width>/);
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

  // docs/agent-review.md B4: a layout row is a continuation, full stop, whenever a layout
  // is pending — even when its first cell id is also a statement verb ("stairs", "door",
  // "void", "level", …, all legal room ids under ID_RE). The old rule read the row's first
  // token as a *statement* whenever it looked like a verb, which is exactly backwards while
  // a layout is still collecting rows: `  stairs hall` used to become a `vertical` element
  // named "hall", not the layout's own row.
  it("treats a layout row as a continuation even when its first cell id is a statement verb", () => {
    assert.deepEqual(doc("room stairs rect 0,0 1x1\nroom hall rect 1,0 1x1\nlayout cols 1,1 rows 1\n  stairs hall"), {
      rooms: { stairs: { rect: [0, 0, 1, 1] }, hall: { rect: [1, 0, 1, 1] } },
      layout: { cols: [1, 1], rows: [1], areas: ["stairs hall"] },
    });
    assert.deepEqual(doc("room door rect 0,0 1x1\nroom hall rect 1,0 1x1\nlayout cols 1,1 rows 1\n  door hall"), {
      rooms: { door: { rect: [0, 0, 1, 1] }, hall: { rect: [1, 0, 1, 1] } },
      layout: { cols: [1, 1], rows: [1], areas: ["door hall"] },
    });
    // a level's indented body is unaffected: nothing is pending there, so the verb rule
    // still applies and a `room`/`door` line is a statement, exactly as before
    assert.deepEqual(doc("level ground\n  room hall rect 0,0 3x3"), doc("level ground\nroom hall rect 0,0 3x3"));
  });

  it("reads an opening's spaces, placement, width and flags in any token order", () => {
    const a = doc("door hall>wc @0.6 w0.8 hinge:end swing:wc entrance glazed id:porta");
    const b = doc("door hall>wc w0.8 @0.6 id:porta glazed entrance swing:wc hinge:end");
    assert.deepEqual(a, b);
    assert.deepEqual(a, {
      openings: [{ id: "porta", type: "door", between: ["hall", "wc"], width: 0.8, position: 0.6, hinge: "end", swingInto: "wc", entrance: true, glazed: true }],
    });
  });

  it("reads and prints a sliding door: no hinge, no swing, still entrance and glazed", () => {
    const line = "door deck w2.4 entrance glazed sliding";
    const d = doc(line);
    assert.deepEqual(d, {
      openings: [{ type: "door", between: ["exterior", "deck"], width: 2.4, entrance: true, glazed: true, sliding: true }],
    });
    assert.equal(toDsl(d), `${line}\n`);
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

  it("reports the sliding/hinge and sliding/swing conflicts from the DSL path too, with their line", () => {
    // parse.ts's checkKeys-driven schema conflicts are free from the DSL side: readSource()
    // compiles the same doc parse() validates, so no DSL-specific check was needed for this.
    const hinge = lint("room a living rect 0,0 4x3\nroom b office rect 4,0 3x3\ndoor a>b w0.8 hinge:end sliding");
    assert.deepEqual(hinge.findings.map((f) => [f.rule, f.path, f.line]), [["schema.conflict", "openings[0].hinge", 3]]);
    assert.equal(hinge.findings[0]!.message, 'a sliding door has no hinge; drop "hinge" or "sliding"');

    const swing = lint("room a living rect 0,0 4x3\nroom b office rect 4,0 3x3\ndoor a>b w0.8 swing:b sliding");
    assert.deepEqual(swing.findings.map((f) => [f.rule, f.path, f.line]), [["schema.conflict", "openings[0].swingInto", 3]]);
    assert.equal(swing.findings[0]!.message, 'a sliding door has no swing; drop "swingInto" or "sliding"');
  });
});

/**
 * docs/agent-review.md B3: `groupOf(kindKey)[id] = …` (rooms/outdoor/voids) and
 * `levels[id] = …` used to overwrite silently on a repeated id — a second `room hall`
 * won outright, and a second `level a` header dropped everything the first one's body
 * had written, with the document still linting clean. `JSON.parse` has the identical
 * last-wins weakness for a duplicate object key (test/jsonpos.test.ts's sibling note),
 * but that is a property of native `JSON.parse` itself, invisible by the time any object
 * reaches `parse()`; the DSL parser sees every line as it goes and has no such excuse.
 */
describe("a duplicate id is a DslError, not last-wins (B3)", () => {
  it("names both lines for a duplicate room", () => {
    const [i] = issuesOf('room hall rect 0,0 3x3 "Hall A"\nroom hall rect 3,0 3x3 "Hall B"');
    assert.equal(i!.line, 2);
    assert.equal(i!.message, 'line 2: room "hall" was already declared on line 1');
  });

  it("names both lines for a duplicate outdoor space", () => {
    const [i] = issuesOf("outdoor deck rect 0,0 3x3\noutdoor deck rect 3,0 3x3");
    assert.equal(i!.message, 'line 2: outdoor "deck" was already declared on line 1');
  });

  it("names both lines for a duplicate void", () => {
    const [i] = issuesOf("room a rect 0,0 3x3\nvoid v rect 3,0 1x1\nvoid v rect 4,0 1x1");
    assert.equal(i!.message, 'line 3: void "v" was already declared on line 2');
  });

  it("names both lines for a duplicate level, and does not silently drop the first level's rooms", () => {
    const issues = issuesOf("level a\nroom x rect 0,0 3x3\nlevel a\nroom y rect 0,0 3x3");
    assert.ok(
      issues.some((iss) => iss.message === 'line 3: level "a" was already declared on line 1'),
      issues.map((iss) => iss.message).join("\n"),
    );
  });

  it("does not flag the first declaration, only the repeat", () => {
    assert.deepEqual(doc("room hall rect 0,0 3x3"), { rooms: { hall: { rect: [0, 0, 3, 3] } } });
    assert.deepEqual(doc("level a\nroom hall rect 0,0 3x3\nlevel b\nroom hall rect 0,0 3x3"), {
      levels: { a: { rooms: { hall: { rect: [0, 0, 3, 3] } } }, b: { rooms: { hall: { rect: [0, 0, 3, 3] } } } },
    });
  });

  // authored opening/fixture/vertical ids are arrays, never map keys, so dsl.ts never had
  // the last-wins hazard for them — parse.ts's schema-level `readId` (shared with JSON)
  // already reports a duplicate authored id as `schema.conflict`, with the right DSL line
  // via the same `path` → `line` resolution every other schema finding gets. Regression
  // guard, not a fix: this is what "cover … authored opening/fixture/vertical ids" checks.
  it("a duplicate authored id on an opening, a fixture and a vertical element already resolves to its line", () => {
    const openings = lint("room sala rect 0,0 3x3\nroom wc rect 3,0 2x2\ndoor sala>wc w0.9 id:p\ndoor sala>wc w0.9 id:p\n");
    assert.deepEqual(openings.findings.map((f) => [f.rule, f.path, f.line]), [["schema.conflict", "openings[1].id", 4]]);

    const fixtures = lint("room sala rect 0,0 3x3\nfixture counter in:sala at 0,0 size 1x1 id:c\nfixture counter in:sala at 1,1 size 1x1 id:c\n");
    assert.deepEqual(fixtures.findings.map((f) => [f.rule, f.path, f.line]), [["schema.conflict", "fixtures[1].id", 3]]);

    const vertical = lint(
      "room hall rect 0,0 3x3\nstairs main\n  at ground in:hall rect 0,0 1x1\nstairs main\n  at ground in:hall rect 1,1 1x1\n",
    );
    assert.deepEqual(vertical.findings.map((f) => [f.rule, f.path, f.line]), [["schema.conflict", "vertical[1].id", 4]]);
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

/**
 * docs/eval/cold3a/cold-run.md, "the one failure mode": a fresh agent given only
 * `--schema=dsl` indented every room/door/window line under `level`, because the
 * reference's own worked example rendered that way — and hit "an indented line continues
 * the statement above it, and there is no statement above this one" on 3 of 20 plans. The
 * fix: an indented line whose first token is a statement keyword is a statement, not a
 * continuation, so nesting under `level` means exactly what the flat form means.
 */
describe("an indented level body is accepted", () => {
  const STATEMENT_KEYWORDS = new Set<string>([
    "plan",
    "walls",
    "north",
    "grid",
    "level",
    "room",
    "outdoor",
    "void",
    "layout",
    "fixture",
    "vertical",
    ...OPENING_TYPES,
    ...VERTICAL_TYPES,
  ]);

  /**
   * The flat form of a DSL text: de-indent every line whose first token is a statement
   * keyword, leaving a genuine continuation line (a vertical element's `at` line, a
   * layout row) exactly as indented — the same distinction the parser now makes.
   */
  const flatten = (text: string): string =>
    text
      .split("\n")
      .map((line) => {
        const trimmed = line.replace(/^[ \t]+/, "");
        const first = trimmed.split(/\s+/)[0] ?? "";
        return STATEMENT_KEYWORDS.has(first) ? trimmed : line;
      })
      .join("\n");

  const loadEval = (name: string) => readFileSync(new URL(`../docs/eval/cold3a/dsl/${name}.dsl`, import.meta.url), "utf8");

  it("means exactly the flat form for room/door/window lines indented under level", () => {
    const indented =
      'level ground h2.6 ground\n  room hall rect 0,0 3x3\n  door hall.south w0.9 entrance\n  window hall.north w1.2\nlevel loft h1.9\n  room loft_room rect 0,0 3x2';
    const flat =
      'level ground h2.6 ground\nroom hall rect 0,0 3x3\ndoor hall.south w0.9 entrance\nwindow hall.north w1.2\nlevel loft h1.9\nroom loft_room rect 0,0 3x2';
    assert.equal(flatten(indented), flat, "the flatten() helper should agree with the hand-written flat form");
    assert.deepEqual(doc(indented), doc(flat));
  });

  it("is not dedent-sensitive: further nested indentation still means the same flat statement", () => {
    assert.deepEqual(doc("level ground\n    room hall rect 0,0 3x3"), doc("level ground\nroom hall rect 0,0 3x3"));
  });

  it("still refuses a genuinely orphaned continuation line (no keyword, nothing pending)", () => {
    assert.match(issuesOf("  at piso0 in:hall rect 0,0 1x1")[0]!.message, /an indented line continues the statement above it/);
    assert.match(issuesOf("  a a")[0]!.message, /an indented line continues the statement above it/);
  });

  // the three files docs/eval/cold3a/cold-run.md logged as parse failures (briefs 07/08/20,
  // 5+18+16 syntax issues) — a real agent's own indentation, not a hand-crafted repro
  for (const [name, findingCount] of [
    ["07", 4],
    ["08", 10],
    ["20", 8],
  ] as const) {
    it(`docs/eval/cold3a/dsl/${name}.dsl now parses, with no schema.* findings, and means its own flat form`, () => {
      const text = loadEval(name);
      const r = lint(text);
      assert.ok(r.plan, `${name}.dsl failed to parse: ${JSON.stringify(r.error?.issues)}`);
      assert.deepEqual(r.findings.filter(isSchemaFinding), []);
      assert.equal(r.findings.length, findingCount);

      const flat = flatten(text);
      assert.notEqual(flat, text, `${name}.dsl should actually contain lines indented under level`);
      assert.deepEqual(parseDsl(text).doc, parseDsl(flat).doc);
      assert.deepEqual(parse(parseDsl(text).doc), parse(parseDsl(flat).doc));

      // canonical stays flat: toDsl never reproduces the input's level-body indentation
      assert.doesNotMatch(toDsl(parseDsl(text).doc), /\n[ \t]+(room|door|window|void) /);
    });
  }
});
