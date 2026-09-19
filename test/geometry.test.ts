import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cellsToPolygons, largestRect, normalizePoly, pointInPoly, shoelace, snap } from "../src/geometry.ts";
import type { Pt } from "../src/types.ts";
import { rect } from "./helpers.ts";

describe("normalizePoly", () => {
  it("accepts a rectangle in either winding", () => {
    const cw = normalizePoly(rect(0, 0, 4, 3));
    const ccw = normalizePoly([...rect(0, 0, 4, 3)].reverse());
    assert.ok("poly" in cw && "poly" in ccw);
    assert.equal(cw.poly.length, 4);
    assert.equal(ccw.poly.length, 4);
  });
  it("drops a repeated closing point and collinear midpoints", () => {
    const res = normalizePoly([[0, 0], [2, 0], [4, 0], [4, 3], [0, 3], [0, 0]]);
    assert.ok("poly" in res);
    assert.deepEqual(res.poly, [[0, 0], [4, 0], [4, 3], [0, 3]]);
  });
  it("snaps float noise to 1 mm", () => {
    const res = normalizePoly([[0, 0], [4.0000001, 0], [4, 2.9999999], [0, 3]]);
    assert.ok("poly" in res);
    assert.deepEqual(res.poly, [[0, 0], [4, 0], [4, 3], [0, 3]]);
  });
  it("rejects a diagonal edge", () => {
    const res = normalizePoly([[0, 0], [4, 0], [4, 3], [1, 2]]);
    assert.ok("problem" in res && res.problem.kind === "not_rectilinear");
  });
  it("rejects fewer than four corners and zero area", () => {
    const few = normalizePoly([[0, 0], [4, 0], [4, 0]]);
    assert.ok("problem" in few && few.problem.kind === "too_few_points");
    const flat = normalizePoly([[0, 0], [4, 0], [4, 0], [0, 0]]);
    assert.ok("problem" in flat);
  });
  it("rejects a self-intersecting (bow-tie) loop", () => {
    const res = normalizePoly([[0, 0], [4, 0], [4, 3], [2, 3], [2, -1], [0, -1]]);
    assert.ok("problem" in res && res.problem.kind === "self_intersecting");
  });
  it("keeps an L shape", () => {
    const L: Pt[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    const res = normalizePoly(L);
    assert.ok("poly" in res);
    assert.equal(res.poly.length, 6);
  });
});

describe("shoelace / pointInPoly", () => {
  it("measures area regardless of winding", () => {
    assert.equal(Math.abs(shoelace(rect(0, 0, 4, 3))), 12);
    assert.equal(Math.abs(shoelace([...rect(0, 0, 4, 3)].reverse())), 12);
  });
  it("classifies points in an L", () => {
    const L: Pt[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    assert.equal(pointInPoly([1, 1], L), true);
    assert.equal(pointInPoly([3, 3], L), false);
    assert.equal(pointInPoly([1, 3], L), true);
  });
});

describe("cellsToPolygons", () => {
  const xs = [0, 1, 2, 3];
  const ys = [0, 1, 2, 3];
  it("outlines a single cell", () => {
    const loops = cellsToPolygons([[0, 0]], xs, ys);
    assert.equal(loops.length, 1);
    assert.equal(Math.abs(shoelace(loops[0]!)), 1);
  });
  it("merges an L of cells into one 6-corner polygon", () => {
    const loops = cellsToPolygons([[0, 0], [1, 0], [0, 1]], xs, ys);
    assert.equal(loops.length, 1);
    assert.equal(loops[0]!.length, 6);
    assert.equal(Math.abs(shoelace(loops[0]!)), 3);
  });
  it("returns two loops for disconnected cells", () => {
    const loops = cellsToPolygons([[0, 0], [2, 2]], xs, ys);
    assert.equal(loops.length, 2);
  });
  it("returns an extra loop for a ring with a hole", () => {
    const ring: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
    const loops = cellsToPolygons(ring, xs, ys);
    assert.equal(loops.length, 2);
  });
  it("separates two cells that only touch at a corner", () => {
    const loops = cellsToPolygons([[0, 0], [1, 1]], xs, ys);
    assert.equal(loops.length, 2);
  });
});

describe("largestRect", () => {
  it("finds the fat arm of an L", () => {
    const xs = [0, 2, 4];
    const ys = [0, 1, 3];
    // cells: (0,0) (1,0) (0,1)  → top row 4×1, left column 2×3
    const owned = (i: number, j: number) => !(i === 1 && j === 1);
    const r = largestRect(owned, xs, ys);
    assert.deepEqual(r, { x0: 0, y0: 0, x1: 2, y1: 3 });
  });
});

describe("snap", () => {
  it("rounds to millimetres", () => {
    assert.equal(snap(1.23456), 1.235);
    assert.equal(snap(0.1 + 0.2), 0.3);
  });
});
