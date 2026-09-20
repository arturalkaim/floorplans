import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  appendAt,
  insertKey,
  JsonPosError,
  metres,
  nodeAt,
  parseWithPositions,
  pathToString,
  removeAt,
  spliceAll,
  spliceAt,
} from "../src/jsonpos.ts";

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

  it("now reports line/column on a missing path too, like every other jsonpos error", () => {
    try {
      spliceAt(`{ "a": 1 }`, ["b"], "2");
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof JsonPosError);
      assert.equal(e.line, 1);
    }
  });
});

describe("jsonpos: removeAt", () => {
  describe("arrays", () => {
    const inline = `{ "cols": [3, 4, 5] }`;

    it("eats the following comma when removing a middle element", () => {
      assert.equal(removeAt(inline, ["cols", 1]), `{ "cols": [3, 5] }`);
    });

    it("eats the following comma when removing the first element", () => {
      assert.equal(removeAt(inline, ["cols", 0]), `{ "cols": [4, 5] }`);
    });

    it("eats the preceding comma when removing the last element", () => {
      assert.equal(removeAt(inline, ["cols", 2]), `{ "cols": [3, 4] }`);
    });

    it("collapses to [] when removing the only element", () => {
      assert.equal(removeAt(`{ "cols": [3] }`, ["cols", 0]), `{ "cols": [] }`);
    });

    it("stays one-entity-per-line for a multi-line array", () => {
      const doc = `{\n  "items": [\n    "a",\n    "b",\n    "c"\n  ]\n}`;
      assert.equal(removeAt(doc, ["items", 1]), `{\n  "items": [\n    "a",\n    "c"\n  ]\n}`);
      assert.equal(removeAt(doc, ["items", 0]), `{\n  "items": [\n    "b",\n    "c"\n  ]\n}`);
      assert.equal(removeAt(doc, ["items", 2]), `{\n  "items": [\n    "a",\n    "b"\n  ]\n}`);
    });

    it("round-trips: the result is valid JSON with one fewer element", () => {
      const doc = `{\n  "items": [\n    "a",\n    "b",\n    "c"\n  ]\n}`;
      assert.deepEqual(JSON.parse(removeAt(doc, ["items", 1])).items, ["a", "c"]);
    });

    it("is depth-agnostic: works the same nested inside a room's poly as at the top level", () => {
      const text = load("casa-t3");
      const before = JSON.parse(text);
      const out = removeAt(text, ["rooms", "sala", "poly", 2]);
      const after = JSON.parse(out);
      assert.equal(after.rooms.sala.poly.length, before.rooms.sala.poly.length - 1);
      assert.deepEqual(after.rooms.sala.poly, before.rooms.sala.poly.filter((_: unknown, i: number) => i !== 2));
    });
  });

  describe("objects", () => {
    const doc = `{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}`;

    it("eats the following comma when removing a middle member", () => {
      assert.equal(removeAt(doc, ["b"]), `{\n  "a": 1,\n  "c": 3\n}`);
    });

    it("eats the following comma when removing the first member", () => {
      assert.equal(removeAt(doc, ["a"]), `{\n  "b": 2,\n  "c": 3\n}`);
    });

    it("eats the preceding comma when removing the last member", () => {
      assert.equal(removeAt(doc, ["c"]), `{\n  "a": 1,\n  "b": 2\n}`);
    });

    it("collapses to {} when removing the only member", () => {
      assert.equal(removeAt(`{ "a": 1 }`, ["a"]), `{}`);
    });
  });

  describe("on fixtures/casa-t3.json", () => {
    const text = load("casa-t3");
    const before = JSON.parse(text);

    it("removes the first opening and preserves every other character", () => {
      const root = parseWithPositions(text);
      const node0 = nodeAt(root, ["openings", 0])!;
      const node1 = nodeAt(root, ["openings", 1])!;
      const out = removeAt(text, ["openings", 0]);
      assert.equal(out, text.slice(0, node0.start) + text.slice(node1.start));
      assert.equal(JSON.parse(out).openings.length, before.openings.length - 1);
    });

    it("removes the last opening and preserves every other character", () => {
      const root = parseWithPositions(text);
      const last = before.openings.length - 1;
      const nodeLast = nodeAt(root, ["openings", last])!;
      const nodePrev = nodeAt(root, ["openings", last - 1])!;
      const out = removeAt(text, ["openings", last]);
      assert.equal(out, text.slice(0, nodePrev.end) + text.slice(nodeLast.end));
      assert.equal(JSON.parse(out).openings.length, before.openings.length - 1);
    });

    it("removes a middle room (an object member nested under rooms) cleanly", () => {
      const out = removeAt(text, ["rooms", "closet"]);
      const parsed = JSON.parse(out);
      assert.equal("closet" in parsed.rooms, false);
      assert.equal(Object.keys(parsed.rooms).length, Object.keys(before.rooms).length - 1);
      // every other room is untouched
      for (const id of Object.keys(before.rooms)) {
        if (id !== "closet") assert.deepEqual(parsed.rooms[id], before.rooms[id]);
      }
    });
  });

  describe("errors", () => {
    it("throws JsonPosError with line/column for a top-level path that does not exist", () => {
      try {
        removeAt(`{ "a": 1 }`, ["nope"]);
        assert.fail("should have thrown");
      } catch (e) {
        assert.ok(e instanceof JsonPosError);
        assert.equal(e.line, 1);
        assert.match(e.message, /no value at nope/);
      }
    });

    it("throws JsonPosError for a nested path that does not exist", () => {
      assert.throws(() => removeAt(`{ "a": { "b": 1 } }`, ["a", "c"]), (e: unknown) => e instanceof JsonPosError && /no value at a\.c/.test((e as Error).message));
    });

    it("throws for an out-of-range array index", () => {
      assert.throws(() => removeAt(`{ "cols": [1, 2] }`, ["cols", 5]), JsonPosError);
    });
  });
});

describe("jsonpos: appendAt", () => {
  describe("arrays", () => {
    it("appends inline, matching the sibling's comma-space style", () => {
      assert.equal(appendAt(`{ "cols": [3, 4, 5] }`, ["cols"], "6"), `{ "cols": [3, 4, 5, 6] }`);
    });

    it("appends on its own line, matching indentation, when siblings are one-per-line", () => {
      const doc = `{\n  "items": [\n    "a",\n    "b"\n  ]\n}`;
      assert.equal(appendAt(doc, ["items"], '"c"'), `{\n  "items": [\n    "a",\n    "b",\n    "c"\n  ]\n}`);
    });

    it("learns the style from a single, lone sibling", () => {
      const doc = `{\n  "items": [\n    "a"\n  ]\n}`;
      assert.equal(appendAt(doc, ["items"], '"b"'), `{\n  "items": [\n    "a",\n    "b"\n  ]\n}`);
    });

    it("produces a sensible single-line form for an empty array", () => {
      assert.equal(appendAt(`{ "items": [] }`, ["items"], '"a"'), `{ "items": ["a"] }`);
    });

    it("is depth-agnostic: appending a root-level array works exactly like a nested one", () => {
      assert.equal(appendAt(`[\n  1,\n  2\n]`, [], "3"), `[\n  1,\n  2,\n  3\n]`);
    });

    it("appends to a poly nested three levels deep and round-trips", () => {
      const text = load("casa-t3");
      const before = JSON.parse(text);
      const out = appendAt(text, ["rooms", "sala", "poly"], "[6.6, 5.8]");
      const after = JSON.parse(out);
      assert.equal(after.rooms.sala.poly.length, before.rooms.sala.poly.length + 1);
      assert.deepEqual(after.rooms.sala.poly.slice(0, -1), before.rooms.sala.poly);
      assert.deepEqual(after.rooms.sala.poly.at(-1), [6.6, 5.8]);
    });
  });

  describe("on fixtures/casa-t3.json", () => {
    it("appends a new opening after the last one, on its own line at the sibling indentation", () => {
      const text = load("casa-t3");
      const before = JSON.parse(text);
      const literal = '{ "type": "window", "between": ["exterior", "despensa"], "position": 1.5, "width": 1.0 }';
      const out = appendAt(text, ["openings"], literal);
      const after = JSON.parse(out);
      assert.equal(after.openings.length, before.openings.length + 1);
      assert.deepEqual(after.openings.at(-1), JSON.parse(literal));
      // exact-text invariant: everything up to the old last opening's end is untouched,
      // and the new element lands right after it with a comma + the same indentation
      // the previous element used before it.
      const root = parseWithPositions(text);
      const items = nodeAt(root, ["openings"])!.items!;
      const secondLast = items[items.length - 2]!;
      const last = items[items.length - 1]!;
      const joint = text.slice(secondLast.end, last.start).replace(/^,/, "");
      assert.equal(out, text.slice(0, last.end) + "," + joint + literal + text.slice(last.end));
    });
  });

  describe("errors", () => {
    it("throws JsonPosError when the path is not an array", () => {
      assert.throws(() => appendAt(`{ "a": 1 }`, ["a"], "2"), (e: unknown) => e instanceof JsonPosError && /not an array at a/.test((e as Error).message));
    });

    it("throws JsonPosError with line/column for a path that does not exist", () => {
      try {
        appendAt(`{ "a": 1 }`, ["nope"], "2");
        assert.fail("should have thrown");
      } catch (e) {
        assert.ok(e instanceof JsonPosError);
        assert.equal(e.line, 1);
      }
    });
  });
});

describe("jsonpos: insertKey", () => {
  describe("objects", () => {
    it("inserts inline, matching the sibling's comma-space style", () => {
      assert.equal(insertKey(`{ "a": 1, "b": 2 }`, [], "c", "3"), `{ "a": 1, "b": 2, "c": 3 }`);
    });

    it("inserts on its own line, matching indentation, when members are one-per-line", () => {
      const doc = `{\n  "a": 1,\n  "b": 2\n}`;
      assert.equal(insertKey(doc, [], "c", "3"), `{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}`);
    });

    it("learns the style from a single, lone member", () => {
      const doc = `{\n  "a": 1\n}`;
      assert.equal(insertKey(doc, [], "b", "2"), `{\n  "a": 1,\n  "b": 2\n}`);
    });

    it("produces a sensible single-line form for an empty object", () => {
      assert.equal(insertKey(`{ "items": {} }`, ["items"], "a", "1"), `{ "items": { "a": 1 } }`);
    });

    it("is depth-agnostic: inserting at the document root works exactly like a nested object", () => {
      assert.equal(insertKey(`{\n  "a": 1\n}`, [], "b", "2"), `{\n  "a": 1,\n  "b": 2\n}`);
    });

    it("round-trips and preserves key order", () => {
      const doc = `{\n  "a": 1,\n  "b": 2\n}`;
      const out = insertKey(doc, [], "c", "3");
      assert.deepEqual(Object.keys(JSON.parse(out)), ["a", "b", "c"]);
      assert.deepEqual(JSON.parse(out), { a: 1, b: 2, c: 3 });
    });
  });

  describe("on fixtures/casa-t3.json", () => {
    it("adds a room to rooms, after the last one, at the sibling indentation", () => {
      const text = load("casa-t3");
      const before = JSON.parse(text);
      const literal = '{ "name": "Garagem", "kind": "garage", "poly": [[0, -3], [4.6, -3], [4.6, 0], [0, 0]] }';
      const out = insertKey(text, ["rooms"], "garagem", literal);
      const after = JSON.parse(out);
      assert.equal(Object.keys(after.rooms).length, Object.keys(before.rooms).length + 1);
      assert.deepEqual(after.rooms.garagem, JSON.parse(literal));
      // every pre-existing room is untouched
      for (const id of Object.keys(before.rooms)) assert.deepEqual(after.rooms[id], before.rooms[id]);
    });
  });

  describe("errors", () => {
    it("throws JsonPosError when the path is not an object", () => {
      assert.throws(() => insertKey(`{ "a": [1] }`, ["a"], "b", "2"), (e: unknown) => e instanceof JsonPosError && /not an object at a/.test((e as Error).message));
    });

    it("throws JsonPosError when the key already exists, rather than silently overwriting it", () => {
      assert.throws(
        () => insertKey(`{ "a": 1 }`, [], "a", "9"),
        (e: unknown) => e instanceof JsonPosError && /"a" already exists/.test((e as Error).message),
      );
    });

    it("throws JsonPosError with line/column for a path that does not exist", () => {
      try {
        insertKey(`{ "a": 1 }`, ["nope"], "b", "2");
        assert.fail("should have thrown");
      } catch (e) {
        assert.ok(e instanceof JsonPosError);
        assert.equal(e.line, 1);
      }
    });
  });
});
