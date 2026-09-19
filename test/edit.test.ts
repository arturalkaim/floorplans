import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyze, applyDrag, draggableWalls, parse } from "../src/index.ts";

const load = (n: string) => readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), "utf8");
const modelOf = (text: string) => analyze(parse(JSON.parse(text))).model;

describe("edit: which walls a drawing may offer to drag", () => {
  it("offers the interior track boundaries of a grid plan, never the outer edge", () => {
    const text = load("casa-patio");
    const model = modelOf(text);
    const walls = draggableWalls(text, model);
    assert.ok(walls.size > 0);
    for (const d of walls.values()) {
      assert.match(d.writes, /^layout\.(cols|rows)\[\d+\] and \[\d+\]$/);
      assert.ok(d.min < d.c && d.c < d.max, `${d.wallId} has no room to move`);
    }
    // the building's own outline is not a boundary between two tracks
    const env = model.envelope;
    for (const d of walls.values())
      assert.ok(d.c !== env.x0 && d.c !== env.x1 && d.c !== env.y0 && d.c !== env.y1);
  });

  it("declines a wall whose edge would have to be split", () => {
    const text = load("casa-t3");
    const model = modelOf(text);
    const walls = draggableWalls(text, model);
    // most of a hand-authored plan is not a pure coordinate change
    assert.ok(walls.size > 0 && walls.size < model.walls.length / 2);
  });

  it("declines everything when the source will not parse", () => {
    const model = modelOf(load("cabin"));
    assert.equal(draggableWalls("{ not json", model).size, 0);
  });
});

describe("edit: moving a wall rewrites the source and nothing else", () => {
  it("grows one track by exactly what its neighbour loses", () => {
    const text = load("casa-patio");
    const model = modelOf(text);
    const d = [...draggableWalls(text, model).values()].find((x) => x.axis === "h")!;
    const before = JSON.parse(text).layout.rows as number[];
    const after = JSON.parse(applyDrag(text, d, d.c + 1)).layout.rows as number[];
    assert.equal(before.length, after.length);
    const sum = (a: number[]) => Math.round(a.reduce((s, n) => s + n, 0) * 1000) / 1000;
    assert.equal(sum(after), sum(before), "the building keeps its overall size");
    assert.equal(after.filter((v, i) => v !== before[i]).length, 2, "exactly two tracks move");
  });

  it("moves both rooms that share a polygon wall, so the plan still tiles", () => {
    const text = load("casa-t3");
    const model = modelOf(text);
    const d = [...draggableWalls(text, model).values()][0]!;
    const out = applyDrag(text, d, d.c - 0.2);
    const after = analyze(parse(JSON.parse(out)));
    const tiling = after.findings.filter((f) => f.rule.startsWith("tiling."));
    assert.deepEqual(tiling, [], "a drag must not tear the tiling");
  });

  it("clamps rather than letting a track collapse", () => {
    const text = load("casa-patio");
    const model = modelOf(text);
    const d = [...draggableWalls(text, model).values()][0]!;
    for (const wild of [-1000, 1000]) {
      const out = JSON.parse(applyDrag(text, d, wild));
      const tracks: number[] = d.axis === "v" ? out.layout.cols : out.layout.rows;
      for (const t of tracks) assert.ok(t >= 0.4 - 1e-9, `track collapsed to ${t}`);
    }
  });

  it("snaps to 5 cm, and to the millimetre when asked", () => {
    const text = load("casa-patio");
    const model = modelOf(text);
    const d = [...draggableWalls(text, model).values()].find((x) => x.axis === "h")!;
    const snapped = JSON.parse(applyDrag(text, d, d.c + 0.123)).layout.rows as number[];
    const free = JSON.parse(applyDrag(text, d, d.c + 0.123, true)).layout.rows as number[];
    assert.notDeepEqual(snapped, free);
    for (const v of snapped) assert.equal(Math.round(v * 100) % 5, 0, `${v} is not on a 5 cm step`);
  });

  it("returns the text unchanged when the wall has not actually moved", () => {
    const text = load("casa-patio");
    const model = modelOf(text);
    const d = [...draggableWalls(text, model).values()][0]!;
    assert.equal(applyDrag(text, d, d.c), text);
  });

  it("re-applying from the gesture's start never compounds", () => {
    // a drag sends many moves; the UI re-applies each one from the text as it was when
    // the gesture began, so the tenth move must land exactly where one move to the same
    // place would. Applying move-on-top-of-move instead would double the travel.
    const text = load("casa-patio");
    const model = modelOf(text);
    const d = [...draggableWalls(text, model).values()].find((x) => x.axis === "v")!;
    const target = d.c + 0.8;
    const direct = applyDrag(text, d, target);
    let stepwise = text;
    for (let i = 1; i <= 10; i++) stepwise = applyDrag(text, d, d.c + (0.8 * i) / 10);
    assert.equal(stepwise, direct, "ten moves must land where one move lands");
  });

  it("is stable when the same target is applied twice", () => {
    const text = load("casa-patio");
    const model = modelOf(text);
    const d = [...draggableWalls(text, model).values()][0]!;
    const once = applyDrag(text, d, d.c + 0.35);
    assert.equal(applyDrag(text, d, d.c + 0.35), once);
  });

  it("keeps the document parseable and canonical through a long drag", () => {
    let text = load("casa-patio");
    for (let i = 0; i < 12; i++) {
      const model = modelOf(text);
      const d = [...draggableWalls(text, model).values()].find((x) => x.axis === "v");
      if (!d) break;
      text = applyDrag(text, d, d.c + (i % 2 ? -0.1 : 0.15));
      assert.doesNotThrow(() => parse(JSON.parse(text)), `broke on step ${i}`);
    }
  });
});
