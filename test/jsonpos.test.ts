import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { JsonPosError, metres, nodeAt, parseWithPositions, pathToString, spliceAll, spliceAt } from "../src/jsonpos.ts";

const load = (name: string) => readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8");

describe("jsonpos: parsing", () => {
  it("records the range of every value", () => {
    const text = `{ "a": 12.5, "b": [1, 2], "c": "hi", "d": true, "e": null }`;
    const root = parseWithPositions(text);
    const slice = (p: Parameters<typeof nodeAt>[1]) => {
      const n = nodeAt(root, p)!;
      return text.slice(n.start, n.end);
    };
    assert.equal(slice(["a"]), "12.5");
    assert.equal(slice(["b"]), "[1, 2]");
    assert.equal(slice(["b", 1]), "2");
    assert.equal(slice(["c"]), '"hi"');
    assert.equal(slice(["d"]), "true");
    assert.equal(slice(["e"]), "null");
  });

  it("agrees with JSON.parse on every fixture", () => {
    for (const name of ["casa-t3", "casa-piscina", "quinta", "broken"]) {
      const text = load(name);
      assert.doesNotThrow(() => parseWithPositions(text), name);
      const root = parseWithPositions(text);
      assert.deepEqual(JSON.parse(text.slice(root.start, root.end)), JSON.parse(text));
    }
  });

  it("handles escapes and negative exponents", () => {
    const text = `{ "s": "a\\"b\\\\", "n": -1.5e-3 }`;
    const root = parseWithPositions(text);
    assert.equal(JSON.parse(text.slice(nodeAt(root, ["s"])!.start, nodeAt(root, ["s"])!.end)), 'a"b\\');
    assert.equal(text.slice(nodeAt(root, ["n"])!.start, nodeAt(root, ["n"])!.end), "-1.5e-3");
  });

  it("reports line and column on bad input", () => {
    try {
      parseWithPositions('{\n  "a": 1,\n  "b": oops\n}');
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof JsonPosError);
      assert.equal(e.line, 3);
      assert.match(e.message, /line 3, column 8/);
    }
  });

  it("returns undefined for a path that is not there", () => {
    const root = parseWithPositions(`{ "a": { "b": 1 } }`);
    assert.equal(nodeAt(root, ["a", "nope"]), undefined);
    assert.equal(nodeAt(root, ["a", "b", "deeper"]), undefined);
  });
});

describe("jsonpos: editing preserves everything it does not touch", () => {
  it("replaces one number and changes nothing else", () => {
    const text = load("quinta");
    const before = parseWithPositions(text);
    const col = nodeAt(before, ["layout", "cols", 1])!;
    assert.equal(text.slice(col.start, col.end), "3.2");

    const r = spliceAt(text, ["layout", "cols", 1], "3.85");
    assert.equal(JSON.parse(r.text).layout.cols[1], 3.85);
    // every other character is identical
    assert.equal(r.text.slice(0, r.start), text.slice(0, r.start));
    assert.equal(r.text.slice(r.start + r.inserted), text.slice(r.start + r.removed));
    assert.equal(r.text.length - text.length, r.inserted - r.removed);
  });

  it("keeps key order and indentation byte for byte", () => {
    const text = load("casa-piscina");
    const out = spliceAt(text, ["walls", "partition"], "0.15").text;
    const strip = (s: string) => s.replace(/"partition":\s*[\d.]+/, "");
    assert.equal(strip(out), strip(text));
    assert.deepEqual(Object.keys(JSON.parse(out)), Object.keys(JSON.parse(text)));
  });

  it("applies several edits at once, right to left", () => {
    const text = `{ "cols": [3, 4, 5] }`;
    const out = spliceAll(text, [
      { path: ["cols", 0], literal: "3.5" },
      { path: ["cols", 2], literal: "4.5" },
    ]);
    assert.equal(out, `{ "cols": [3.5, 4, 4.5] }`);
  });

  it("refuses an unknown path rather than writing nothing", () => {
    assert.throws(() => spliceAt(`{ "a": 1 }`, ["b"], "2"), /no value at b/);
  });

  it("names paths the way a person would", () => {
    assert.equal(pathToString(["layout", "cols", 2]), "layout.cols[2]");
  });

  it("writes metres without trailing noise", () => {
    assert.equal(metres(3.8000000000000003), "3.8");
    assert.equal(metres(1 / 3), "0.333");
    assert.equal(metres(4), "4");
  });
});
