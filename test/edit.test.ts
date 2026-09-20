import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  analyze,
  applyDrag,
  applyMove,
  draggableFixtureEdges,
  draggableOutdoorEdges,
  draggableWalls,
  movableFixtures,
  parse,
} from "../src/index.ts";

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

  it("does not carry a detached polygon that only coincidentally shares the coordinate", () => {
    // quinta's grid east edge is x = 10.2; the detached shack arrecadacao (poly-authored,
    // 1 m south of the house) also has two vertices at x = 10.2, purely by coincidence —
    // it shares no track with the grid on the other axis. Dragging the house's east wall
    // must resize the grid column and leave the shack's polygon untouched.
    const text = load("quinta");
    const model = modelOf(text);
    const east = model.walls.find((w) => w.axis === "v" && w.pos === "exterior" && w.neg === "cozinha")!;
    const d = draggableWalls(text, model).get(east.id)!;
    assert.match(d.writes, /^layout\.cols\[\d+\]/);
    const before = JSON.parse(text);
    const after = JSON.parse(applyDrag(text, d, 10.7));
    assert.deepEqual(after.rooms.arrecadacao.poly, before.rooms.arrecadacao.poly, "the shack must not stretch with the house");
    assert.notDeepEqual(after.layout.cols, before.layout.cols, "the grid column still resizes");
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

describe("edit: outdoor spaces resize by their own edges", () => {
  it("offers every edge of a poly-authored outdoor space", () => {
    const text = load("casa-piscina");
    const model = modelOf(text);
    const edges = draggableOutdoorEdges(text, model);
    assert.equal(edges.size, 4, "a rectangular deck has four edges");
    for (const d of edges.values()) assert.match(d.writes, /^Deck's (north|south|east|west) edge$/);
  });

  it("grows the deck without touching anything else", () => {
    const text = load("casa-piscina");
    const model = modelOf(text);
    const south = [...draggableOutdoorEdges(text, model).values()].find((d) => d.writes.includes("south"))!;
    const before = JSON.parse(text);
    const after = JSON.parse(applyDrag(text, south, south.c + 1.5));
    assert.deepEqual(after.rooms, before.rooms, "rooms are untouched");
    assert.deepEqual(after.layout, before.layout, "the grid is untouched");
    const area = (poly: [number, number][]) =>
      Math.abs(poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * p[1], 0) / 2);
    assert.ok(area(after.outdoor.deck.poly) > area(before.outdoor.deck.poly), "the deck got bigger");
  });

  it("keeps the ring rectilinear however far it is dragged", () => {
    const text = load("casa-piscina");
    const model = modelOf(text);
    for (const d of draggableOutdoorEdges(text, model).values())
      for (const target of [d.c + 50, d.c - 50, d.c + 0.3]) {
        const poly = JSON.parse(applyDrag(text, d, target)).outdoor.deck.poly as [number, number][];
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i]!;
          const b = poly[(i + 1) % poly.length]!;
          assert.ok(a[0] === b[0] || a[1] === b[1], `edge ${i} went diagonal`);
        }
        assert.doesNotThrow(() => parse(JSON.parse(applyDrag(text, d, target))));
      }
  });

  it("leaves a grid-placed outdoor space to its tracks", () => {
    // quinta's jardim comes from layout.areas and has no poly to edit
    const text = load("quinta");
    const edges = draggableOutdoorEdges(text, modelOf(text));
    assert.ok(![...edges.values()].some((d) => d.writes.startsWith("Jardim")));
    assert.ok([...edges.values()].some((d) => d.writes.startsWith("Terraço")));
  });
});

describe("edit: fixtures move and resize, in whichever form they are authored", () => {
  const PISCINA = "casa-piscina";

  it("offers a body and four edges for every fixture", () => {
    const text = load(PISCINA);
    const model = modelOf(text);
    assert.equal(movableFixtures(text, model).size, model.fixtures.length);
    assert.equal(draggableFixtureEdges(text, model).size, model.fixtures.length * 4);
  });

  it("moves an at/size fixture by rewriting `at`, leaving `size` alone", () => {
    const text = load(PISCINA);
    const model = modelOf(text);
    // the exterior pool is authored as at + size
    const i = model.fixtures.findIndex((f) => f.fixture.name === "Piscina exterior");
    const m = movableFixtures(text, model).get(`fixture:${i}`)!;
    const after = JSON.parse(applyMove(text, m, [m.at[0] + 1, m.at[1] + 2]));
    const before = JSON.parse(text);
    assert.deepEqual(after.fixtures[i].size, before.fixtures[i].size, "size is unchanged by a move");
    assert.deepEqual(after.fixtures[i].at, [before.fixtures[i].at[0] + 1, before.fixtures[i].at[1] + 2]);
  });

  it("moves a poly fixture by shifting every corner", () => {
    const text = load(PISCINA);
    const model = modelOf(text);
    const i = model.fixtures.findIndex((f) => f.fixture.name === "Piscina interior");
    const m = movableFixtures(text, model).get(`fixture:${i}`)!;
    const before = JSON.parse(text).fixtures[i].poly as [number, number][];
    const after = JSON.parse(applyMove(text, m, [m.at[0] + 0.5, m.at[1]])).fixtures[i].poly as [number, number][];
    assert.deepEqual(after, before.map(([x, y]) => [x + 0.5, y]));
  });

  it("resizes an at/size fixture from either side correctly", () => {
    const text = load(PISCINA);
    const model = modelOf(text);
    const i = model.fixtures.findIndex((f) => f.fixture.name === "Piscina exterior");
    const edges = draggableFixtureEdges(text, model);
    const before = JSON.parse(text).fixtures[i];

    // the east edge only grows the width
    const east = edges.get(`fixture:${i}:east`)!;
    const grown = JSON.parse(applyDrag(text, east, east.c + 1)).fixtures[i];
    assert.deepEqual(grown.at, before.at, "the far side does not move the origin");
    assert.equal(grown.size[0], before.size[0] + 1);

    // the west edge moves the origin and keeps the far side still
    const west = edges.get(`fixture:${i}:west`)!;
    const pulled = JSON.parse(applyDrag(text, west, west.c - 1)).fixtures[i];
    assert.equal(pulled.at[0], before.at[0] - 1);
    assert.equal(pulled.size[0], before.size[0] + 1);
    assert.equal(pulled.at[0] + pulled.size[0], before.at[0] + before.size[0], "the east side stayed put");
  });

  it("never shrinks a fixture to nothing", () => {
    const text = load(PISCINA);
    const model = modelOf(text);
    for (const [key, d] of draggableFixtureEdges(text, model)) {
      const i = Number(key.split(":")[1]);
      for (const wild of [-1000, 1000]) {
        const f = JSON.parse(applyDrag(text, d, wild)).fixtures[i];
        const size = f.size ?? [
          Math.max(...(f.poly as [number, number][]).map((p) => p[0])) - Math.min(...(f.poly as [number, number][]).map((p) => p[0])),
          Math.max(...(f.poly as [number, number][]).map((p) => p[1])) - Math.min(...(f.poly as [number, number][]).map((p) => p[1])),
        ];
        assert.ok(size[0] >= 0.2 - 1e-9 && size[1] >= 0.2 - 1e-9, `${key} collapsed to ${JSON.stringify(size)}`);
      }
    }
  });

  it("keeps the document valid through a move and a resize", () => {
    const text = load(PISCINA);
    const model = modelOf(text);
    const m = [...movableFixtures(text, model).values()][0]!;
    const moved = applyMove(text, m, [m.at[0] + 0.3, m.at[1] + 0.3]);
    assert.doesNotThrow(() => parse(JSON.parse(moved)));
    const d = [...draggableFixtureEdges(moved, modelOf(moved)).values()][0]!;
    assert.doesNotThrow(() => parse(JSON.parse(applyDrag(moved, d, d.c + 0.4))));
  });
});
