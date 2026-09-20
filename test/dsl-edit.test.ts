import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { run } from "../src/cli.ts";
import type { CliIo } from "../src/cli.ts";
import {
  applyDrag,
  applyMove,
  draggableFixtureEdges,
  draggableOutdoorEdges,
  draggableWalls,
  dslSpliceAll,
  DslPosError,
  lint,
  movableFixtures,
  parse,
  parseDsl,
  toDsl,
} from "../src/index.ts";

const load = (name: string, ext: "json" | "dsl") => readFileSync(new URL(`../fixtures/${name}.${ext}`, import.meta.url), "utf8");

function fakeIo(files: Record<string, string>, stdin = "") {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const io: CliIo = {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readFile: (p) => {
      const f = files[p];
      if (f === undefined) throw new Error("ENOENT");
      return f;
    },
    writeFile: (p, s) => {
      written[p] = s;
    },
    readStdin: () => stdin,
  };
  return { io, out: () => out.join(""), err: () => err.join(""), written };
}

const model = (text: string) => lint(text).model!;

describe("a splice into a DSL document touches one token and nothing else", () => {
  const text = load("cabin", "dsl");

  it("replaces a number in place, leaving the rest of the line intact", () => {
    const out = dslSpliceAll(text, [{ path: ["rooms", "sala", "rect", 2], literal: "5.5" }]);
    assert.equal(out.split("\n")[2], 'room sala "Sala e cozinha" living rect 0,0 5.5x4');
    // every other line is character-for-character what it was
    const a = text.split("\n");
    const b = out.split("\n");
    for (let i = 0; i < a.length; i++) if (i !== 2) assert.equal(b[i], a[i], `line ${i + 1} changed`);
  });

  it("replaces a string, an enum and a flag in their own spellings", () => {
    assert.match(dslSpliceAll(text, [{ path: ["rooms", "wc", "name"], literal: '"Lavabo"' }]), /^room wc "Lavabo" wc rect/m);
    assert.match(dslSpliceAll(text, [{ path: ["openings", 1, "hinge"], literal: '"start"' }]), /^door sala>wc @-0.5 w0.7 hinge:start swing:wc$/m);
    // a boolean written false takes its token — and the space before it — away
    const covered = dslSpliceAll(load("casa-t3", "dsl"), [{ path: ["outdoor", "alpendre", "covered"], literal: "false" }]);
    assert.match(covered, /^outdoor alpendre "Alpendre" covered:false rect/m);
  });

  it("applies several edits at once, right to left", () => {
    const out = dslSpliceAll(text, [
      { path: ["rooms", "sala", "rect", 2], literal: "5.5" },
      { path: ["openings", 0, "width"], literal: "1.1" },
    ]);
    assert.match(out, /rect 0,0 5.5x4/);
    assert.match(out, /door deck>sala at 0.9,4 w1.1 /);
  });

  it("says so when the path names nothing on any line", () => {
    assert.throws(() => dslSpliceAll(text, [{ path: ["rooms", "sala", "zone"], literal: '"day"' }]), DslPosError);
    assert.throws(() => dslSpliceAll(text, [{ path: ["rooms", "nowhere"], literal: "{}" }]), /no value at rooms.nowhere/);
  });

  it("keeps the document meaning the same as the equivalent JSON edit", () => {
    const dsl = dslSpliceAll(text, [{ path: ["openings", 0, "width"], literal: "1.1" }]);
    const json = JSON.parse(load("cabin", "json"));
    json.openings[0].width = 1.1;
    assert.deepEqual(parse(dsl).openings[0]!.width, parse(json).openings[0]!.width);
  });
});

/**
 * docs/agent-review.md B11: a short-form opening's `between` span covers the whole
 * selector token, side included (`suite.south`), because that is where the side lives in
 * the source — there is no separate token for it. Splicing a plain `a>b` into that whole
 * span used to erase the side with no trace: `set openings[0].between ["exterior","wc"]`
 * on `window suite.north …` produced `window exterior>wc …`, silently widening "the north
 * wall" into "any of wc's four walls" (`wall.ambiguous`).
 */
describe("`set … between` on a short-form opening keeps its side (B11)", () => {
  const text = "room hall rect 0,0 3x3\nroom suite rect 3,0 3x3\nroom wc rect 0,3 3x3\nwindow suite.south w1.5\n";

  it("moves the side onto the new room when the pair is still exterior-anchored", () => {
    const out = dslSpliceAll(text, [{ path: ["openings", 0, "between"], literal: JSON.stringify(["exterior", "wc"]) }]);
    assert.match(out, /^window wc\.south w1\.5$/m);
    assert.deepEqual(parseDsl(out).doc, {
      rooms: { hall: { rect: [0, 0, 3, 3] }, suite: { rect: [3, 0, 3, 3] }, wc: { rect: [0, 3, 3, 3] } },
      openings: [{ type: "window", between: ["exterior", "wc"], width: 1.5, on: { room: "wc", side: "south" } }],
    });
  });

  it("keeps the side for a short-form door too", () => {
    const doorText = "room hall rect 0,0 3x3\nroom suite rect 3,0 3x3\nroom wc rect 0,3 3x3\ndoor suite.south w0.9\n";
    const out = dslSpliceAll(doorText, [{ path: ["openings", 0, "between"], literal: JSON.stringify(["exterior", "wc"]) }]);
    assert.match(out, /^door wc\.south w0\.9$/m);
  });

  it("falls back to the long form, with no dangling side, when the new pair drops \"exterior\"", () => {
    const out = dslSpliceAll(text, [{ path: ["openings", 0, "between"], literal: JSON.stringify(["hall", "suite"]) }]);
    assert.match(out, /^window hall>suite w1\.5$/m);
    assert.deepEqual(parseDsl(out).doc, {
      rooms: { hall: { rect: [0, 0, 3, 3] }, suite: { rect: [3, 0, 3, 3] }, wc: { rect: [0, 3, 3, 3] } },
      openings: [{ type: "window", between: ["hall", "suite"], width: 1.5 }],
    });
  });

  it("between[1] alone already kept the side untouched (regression guard, not the bug)", () => {
    const out = dslSpliceAll(text, [{ path: ["openings", 0, "between", 1], literal: '"wc"' }]);
    assert.match(out, /^window wc\.south w1\.5$/m);
    assert.deepEqual((parseDsl(out).doc as { openings: Array<{ on?: unknown }> }).openings[0]!.on, { room: "wc", side: "south" });
  });
});

describe("drags write back to the DSL line", () => {
  it("moves a wall by rewriting the rect on each room's line", () => {
    const text = load("cabin", "dsl");
    const walls = draggableWalls(text, model(text));
    // the east wall of the wc and the store room: dragging it resizes both rects
    const d = [...walls.values()].find((w) => w.writes === "1 coordinates in wc")!;
    assert.equal(d.c, 6.2);
    const out = applyDrag(text, d, 6.5);
    assert.match(out, /^room wc "Casa de banho" wc rect 5,0 1.5x2$/m);
    // no other line moved, and the result is still canonical
    assert.match(out, /^room arrumos "Arrumos" storage rect 5,2 1.2x2$/m);
    assert.match(out, /^room sala "Sala e cozinha" living rect 0,0 5x4$/m);
    assert.equal(toDsl(parseDsl(out).doc), out);
  });

  it("offers the same handles, and the same writes, as the JSON twin", () => {
    for (const name of ["cabin", "casa-t3"]) {
      const j = load(name, "json");
      const d = load(name, "dsl");
      const jw = draggableWalls(j, model(j));
      const dw = draggableWalls(d, model(d));
      assert.deepEqual([...dw.keys()].sort(), [...jw.keys()].sort(), name);
      for (const [id, w] of dw) assert.equal(w.writes, jw.get(id)!.writes, `${name} ${id}`);
    }
  });

  it("drags an outdoor edge and a fixture, and both end up the same plan as in JSON", () => {
    const d = load("casa-t3", "dsl");
    const j = load("casa-t3", "json");
    const edge = draggableOutdoorEdges(d, model(d)).get("alpendre:2")!;
    const jedge = draggableOutdoorEdges(j, model(j)).get("alpendre:2")!;
    assert.deepEqual(parse(applyDrag(d, edge, 13.2)).outdoor.map((o) => o.poly), parse(applyDrag(j, jedge, 13.2)).outdoor.map((o) => o.poly));

    const m = load("moradia-2-pisos", "dsl");
    const mj = load("moradia-2-pisos", "json");
    const move = movableFixtures(m, model(m), "piso1").get("fixture:0")!;
    const jmove = movableFixtures(mj, model(mj), "piso1").get("fixture:0")!;
    const moved = applyMove(m, move, [9.5, 3.4]);
    assert.match(moved, /^fixture bath in:wc_suite at 9.5,3.4 size 1.7x0.75$/m);
    assert.deepEqual(parse(moved).levels[1]!.fixtures[0]!.poly, parse(applyMove(mj, jmove, [9.5, 3.4])).levels[1]!.fixtures[0]!.poly);

    const side = draggableFixtureEdges(m, model(m), "piso1").get("fixture:1:east")!;
    assert.match(applyDrag(m, side, 1.5), /^fixture shower in:wc_sup at 0.3,8.5 size 1.2x0.9$/m);
  });

  it("drags a shared grid track, which is a document-level statement", () => {
    const text = 'grid cols 3,4 rows 5\n\nlevel g ground\nroom hall hall\nroom sala living\n\nlayout\n  hall sala\n\ndoor hall.north @1 w1 entrance\nwindow sala.east w1.2';
    const walls = draggableWalls(text, model(text));
    const d = [...walls.values()].find((w) => w.axis === "v" && Math.abs(w.c - 3) < 1e-6)!;
    assert.match(d.writes, /^grid\.cols\[0\] and \[1\]/);
    assert.match(applyDrag(text, d, 3.5), /^grid cols 3.5,3.5 rows 5$/m);
  });

  it("leaves a JSON document's drags byte-identical", () => {
    const j = load("casa-t3", "json");
    const walls = draggableWalls(j, model(j));
    const d = [...walls.values()][0]!;
    assert.equal(applyDrag(j, d, d.c + 0.1), applyDrag(j, d, d.c + 0.1));
    assert.ok(applyDrag(j, d, d.c + 0.1).startsWith("{"));
  });
});

describe("floorplan set / patch on a DSL file", () => {
  const dsl = load("cabin", "dsl");

  it("set splices the token and writes the file back", () => {
    const t = fakeIo({ "p.dsl": dsl });
    assert.equal(run(["set", "p.dsl", "openings[0].width", "1.1"], t.io), 0);
    assert.match(t.written["p.dsl"]!, /^door deck>sala at 0.9,4 w1.1 hinge:start swing:sala$/m);
    assert.equal(t.written["p.dsl"]!.split("\n").length, dsl.split("\n").length);
  });

  it("set takes a bare word as a string, as it does for JSON", () => {
    const t = fakeIo({ "p.dsl": dsl });
    assert.equal(run(["set", "p.dsl", "rooms.wc.name", "Lavabo", "--dry-run"], t.io), 0);
    assert.match(t.out(), /^room wc "Lavabo" wc rect 5,0 1.2x2$/m);
  });

  it("refuses a path no line holds, with a position", () => {
    const t = fakeIo({ "p.dsl": dsl });
    assert.equal(run(["set", "p.dsl", "rooms.nowhere.name", "X"], t.io), 2);
    assert.match(t.err(), /no value at rooms\.nowhere\.name/);
  });

  it("will not write a document the edit broke", () => {
    const t = fakeIo({ "p.dsl": dsl });
    assert.equal(run(["set", "p.dsl", "openings[0].width", "-1"], t.io), 2);
    assert.deepEqual(t.written, {});
  });

  it("patch applies a list of set ops", () => {
    const t = fakeIo({ "p.dsl": dsl, "patch.json": JSON.stringify([{ path: "openings[0].width", value: 1.1 }, { path: "rooms.sala.rect[2]", value: 5.4 }]) });
    // 1: the narrower sala now trips a finding, which is the point of validating after
    assert.equal(run(["patch", "p.dsl", "patch.json"], t.io), 1);
    assert.match(t.written["p.dsl"]!, /w1.1 /);
    assert.match(t.written["p.dsl"]!, /rect 0,0 5.4x4/);
  });

  it("says plainly that the structural ops are JSON-only, and writes nothing", () => {
    const t = fakeIo({ "p.dsl": dsl, "patch.json": JSON.stringify([{ op: "remove", path: "openings[0]" }]) });
    assert.equal(run(["patch", "p.dsl", "patch.json"], t.io), 2);
    assert.match(t.err(), /"remove" is not supported on a DSL document; convert it with `floorplan fmt <file> --to json` first/);
    assert.deepEqual(t.written, {});
  });
});

describe("floorplan fmt", () => {
  it("converts JSON to DSL and back without changing the plan", () => {
    const json = load("casa-t3", "json");
    const t = fakeIo({ "p.json": json });
    assert.equal(run(["fmt", "p.json", "--to", "dsl", "--out", "p.dsl"], t.io), 1); // casa-t3 has warnings
    assert.equal(t.written["p.dsl"], load("casa-t3", "dsl"));

    const back = fakeIo({ "p.dsl": t.written["p.dsl"]! });
    assert.equal(run(["fmt", "p.dsl", "--to", "json", "--out", "p.json"], back.io), 1);
    // the same plan, down to every area and finding; only the order of the keys each
    // entity happened to be written in can differ, and `authored` records exactly that
    const strip = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => (k === "authored" ? [...(x as string[])].sort() : x)));
    assert.deepEqual(strip(parse(back.written["p.json"]!)), strip(parse(json)));
  });

  it("canonicalises in place when --to is left out", () => {
    const messy = "# a cabin\n\n\nroom  sala   living  rect 0,0 5x4\ndoor  sala  w0.9  entrance\n";
    const t = fakeIo({ "p.dsl": messy });
    assert.equal(run(["fmt", "p.dsl"], t.io), 1);
    assert.equal(t.written["p.dsl"], "room sala living rect 0,0 5x4\n\ndoor sala w0.9 entrance\n");
  });

  it("--stdout and --dry-run print and write nothing", () => {
    for (const flag of ["--stdout", "--dry-run"]) {
      const t = fakeIo({ "p.json": load("cabin", "json") });
      run(["fmt", "p.json", "--to", "dsl", flag], t.io);
      assert.equal(t.out(), load("cabin", "dsl"));
      assert.deepEqual(t.written, {});
    }
  });

  it("refuses a document that does not parse, and writes nothing", () => {
    const t = fakeIo({ "p.dsl": "room a rect 0,0 4x3\ndoor w0.8\n" });
    assert.equal(run(["fmt", "p.dsl", "--to", "json"], t.io), 2);
    assert.deepEqual(t.written, {});
    assert.match(t.err(), /line 2: door needs two spaces/);
  });

  it("refuses a JSON document the DSL cannot spell, rather than losing the key", () => {
    const t = fakeIo({ "p.json": load("broken-levels", "json") });
    assert.equal(run(["fmt", "p.json", "--to", "dsl"], t.io), 2);
    assert.match(t.err(), /no spelling for the private key "_note"/);
    assert.deepEqual(t.written, {});
  });

  it("reports usage for a bad --to and for extra arguments", () => {
    assert.equal(run(["fmt", "p.dsl", "--to", "yaml"], fakeIo({ "p.dsl": "" }).io), 2);
    assert.equal(run(["fmt", "a", "b"], fakeIo({}).io), 2);
    assert.equal(run(["fmt"], fakeIo({}).io), 2);
  });

  it("-- ends option parsing, so a dash-led filename after it is a positional, not an option", () => {
    const t = fakeIo({ "-cabin.dsl": load("cabin", "dsl") });
    const status = run(["fmt", "--to", "json", "--stdout", "--", "-cabin.dsl"], t.io);
    assert.doesNotMatch(t.err(), /unknown option/);
    assert.notEqual(status, 2, t.err());
  });
});

describe("the main command reads a DSL file with no extra flags", () => {
  it("--lint and --json work on a .dsl file", () => {
    const t = fakeIo({ "p.dsl": load("casa-t3", "dsl") });
    assert.equal(run(["p.dsl", "--lint"], t.io), 1);
    assert.match(t.out(), /2 warning\(s\), 1 info/);

    const j = fakeIo({ "p.dsl": load("casa-t3", "dsl") });
    assert.equal(run(["p.dsl", "--json"], j.io), 1);
    assert.match(j.out(), /"line":4/);
  });

  it("draws the same SVG from either syntax", () => {
    const a = fakeIo({ "p.dsl": load("cabin", "dsl") });
    const b = fakeIo({ "p.json": load("cabin", "json") });
    run(["p.dsl", "--out", "a.svg"], a.io);
    run(["p.json", "--out", "b.svg"], b.io);
    assert.equal(a.written["a.svg"], b.written["b.svg"]);
  });

  it("reports a DSL syntax error with its line and exits 2", () => {
    const t = fakeIo({ "p.dsl": "room a rect 0,0 4x3\nrooom b rect 0,0 1x1\n" });
    assert.equal(run(["p.dsl", "--lint"], t.io), 2);
    assert.match(t.err(), /line 2: unknown statement "rooom"/);
  });
});

describe("--schema=dsl", () => {
  it("prints the grammar, but not the field-by-field token index (that is --schema=dsl-full's job)", () => {
    const t = fakeIo({});
    assert.equal(run(["--schema=dsl"], t.io), 0);
    assert.match(t.out(), /^## statements$/m);
    assert.match(t.out(), /^ +arc <x>,<y> r<radius> \[cw\|ccw\] \[large\]$/m);
    assert.ok(!t.out().includes("opening.swingInto"), "--schema=dsl should no longer carry the 77-row field index by default");
  });
});

describe("--schema=dsl-full", () => {
  it("prints the grammar and every schema field's token", () => {
    const t = fakeIo({});
    assert.equal(run(["--schema=dsl-full"], t.io), 0);
    assert.match(t.out(), /^## statements$/m);
    assert.match(t.out(), /^opening\.swingInto\s+swing:<space>$/m);
    assert.match(t.out(), /^ +arc <x>,<y> r<radius> \[cw\|ccw\] \[large\]$/m);
  });
});
