import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyze, draggableFixtureEdges, draggableWalls, parse } from "../src/index.ts";
import { sharedGridPlan, twoStoreys } from "./helpers.ts";

describe("levels: editing a document that has them", () => {
  const text = JSON.stringify(twoStoreys(), null, 2);
  const model = analyze(parse(JSON.parse(text))).model;

  it("prefixes every path with the level it belongs to", () => {
    const d = [...draggableWalls(text, model, "cima").values()].find((x) => x.axis === "v" && x.c === 3)!;
    assert.ok(d, "the wall between patamar and quarto should be draggable");
    for (const e of d.edits(3.4)) assert.deepEqual(e.path.slice(0, 2), ["levels", "cima"]);
    assert.ok(d.edits(3.4).some((e) => e.path.includes("patamar")));
    assert.ok(!d.edits(3.4).some((e) => e.path.includes("sala")), "the other storey stays where it is");
  });

  it("offers each level its own walls and nothing else", () => {
    const below = draggableWalls(text, model, "baixo");
    const above = draggableWalls(text, model, "cima");
    assert.ok(below.size > 0 && above.size > 0);
    for (const d of below.values()) for (const e of d.edits(d.c + 0.1)) assert.equal(e.path[1], "baixo");
  });

  it("defaults to the ground level", () => {
    const [a, b] = [draggableWalls(text, model), draggableWalls(text, model, "baixo")];
    assert.deepEqual([...a.keys()], [...b.keys()]);
  });

  it("never offers a handle on a vertical element's synthetic footprint", () => {
    for (const level of ["baixo", "cima"])
      for (const [key, d] of draggableFixtureEdges(text, model, level)) {
        assert.ok(!key.includes("-1"), key);
        for (const e of d.edits(1)) assert.ok(!e.path.includes(-1), key);
      }
    assert.equal(draggableFixtureEdges(text, model, "baixo").size, 0, "the only thing on that floor is the stair");
  });
});

describe("levels: a drag on a shared track boundary", () => {
  it("rewrites grid.cols, and says which levels it moves", () => {
    // the whole point of a shared grid is that one boundary is one wall on every level
    // using it; a status line that did not say so would make that a nasty surprise
    const text = JSON.stringify(sharedGridPlan, null, 2);
    const model = analyze(parse(JSON.parse(text))).model;
    const d = [...draggableWalls(text, model, "baixo").values()].find((x) => x.axis === "v" && x.c === 3)!;
    assert.ok(d, "the shared boundary should be draggable");
    assert.match(d.writes, /^grid\.cols\[0\] and \[1\] — moves this wall on baixo, cima$/);
    assert.deepEqual(d.edits(3.5).map((e) => e.path), [["grid", "cols", 0], ["grid", "cols", 1]]);
  });
});
