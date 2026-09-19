import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyze, applyDrag, draggableWalls, parse } from "../src/index.ts";

const load = (n: string) => readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), "utf8");
const modelOf = (text: string) => analyze(parse(JSON.parse(text))).model;

describe("edit: which walls a drawing may offer to drag", () => {
  it("resizes tracks on a grid plan, and never the edge the grid is anchored to", () => {
    const text = load("casa-patio");
    const model = modelOf(text);
    const walls = draggableWalls(text, model);
    assert.ok(walls.size > 0);
    for (const d of walls.values()) {
      assert.match(d.writes, /^layout\.(cols|rows)\[\d+\]( and \[\d+\])?$/);
      assert.ok(d.min < d.c && d.c < d.max, `${d.wallId} has no room to move`);
      // the grid starts at 0: that edge cannot move without shifting every coordinate
      assert.notEqual(d.c, 0);
    }
    // the far edge is offered, and resizes a single track
    const far = [...walls.values()].filter((d) => !d.writes.includes(" and "));
    assert.ok(far.length > 0, "the building's far edge should be draggable");
  });

  it("declines exactly those walls whose edge would have to be split", () => {
    const text = load("casa-t3");
    const doc = JSON.parse(text) as { rooms: Record<string, { poly: [number, number][] }> };
    const model = modelOf(text);
    const walls = draggableWalls(text, model);
    const declined = model.walls.filter((w) => !walls.has(w.id));
    assert.ok(declined.length > 0 && walls.size > 0, "this fixture should show both");

    for (const w of declined) {
      const axis = w.axis === "v" ? 0 : 1;
      const owners = [w.neg, w.pos].filter((o) => o !== "exterior" && o !== "gap");
      // a wall is refused only because some space it separates has a vertex on that line
      // beyond the wall's run, which a drag would have to split the edge to handle
      const wouldSplit = owners.some((id) =>
        (doc.rooms[id]?.poly ?? []).some(
          (pt) => {
            const on = pt[axis]!;
            const at = pt[1 - axis]!;
            return Math.abs(on - w.c) < 1e-6 && (at < w.from - 1e-6 || at > w.to + 1e-6);
          },
        ),
      );
      assert.ok(wouldSplit, `${w.id} was declined for no reason a reader could name`);
    }
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

  it("no offered wall, anywhere, can tear the plan", () => {
    // the safety property the whole feature rests on: if a wall is draggable at all,
    // nudging it must not introduce a gap or an overlap
    for (const name of ["casa-t3", "casa-piscina", "casa-patio", "cabin", "quinta", "apartment-t2"]) {
      const text = load(name);
      const model = modelOf(text);
      const before = analyze(parse(JSON.parse(text))).findings.filter((f) => f.rule.startsWith("tiling.")).length;
      for (const d of draggableWalls(text, model).values())
        for (const delta of [0.1, -0.1, 0.35]) {
          const out = applyDrag(text, d, d.c + delta);
          const after = analyze(parse(JSON.parse(out))).findings.filter((f) => f.rule.startsWith("tiling."));
          assert.equal(
            after.length,
            before,
            `${name}: moving ${d.wallId} by ${delta} produced ${after.map((f) => f.rule).join(", ")}`,
          );
        }
    }
  });

  it("offers the building's outer walls", () => {
    for (const name of ["casa-t3", "cabin"]) {
      const text = load(name);
      const model = modelOf(text);
      const walls = draggableWalls(text, model);
      const exterior = model.walls.filter((w) => w.kind === "exterior");
      const offered = exterior.filter((w) => walls.has(w.id));
      assert.equal(offered.length, exterior.length, `${name}: only ${offered.length}/${exterior.length} outer walls`);
    }
  });

  it("moves only the spaces the wall actually separates", () => {
    // casa-t3's north edge is shared by several rooms at y = 0; dragging one room's
    // stretch of it must not drag the others
    const text = load("casa-t3");
    const model = modelOf(text);
    const wall = model.walls.find((w) => w.kind === "exterior" && w.axis === "h" && w.c === 0)!;
    const d = draggableWalls(text, model).get(wall.id)!;
    const before = JSON.parse(text).rooms;
    const after = JSON.parse(applyDrag(text, d, 0.4)).rooms;
    const moved = Object.keys(before).filter((k) => JSON.stringify(before[k].poly) !== JSON.stringify(after[k].poly));
    const owners = [wall.neg, wall.pos].filter((o) => o !== "exterior");
    assert.deepEqual(moved.sort(), owners.sort());
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
