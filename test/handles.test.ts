// Handles: what a wall that is not a grid line can be dragged by (docs/gaps-design.md §1.3.8).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  analyze,
  applyDrag,
  applyHandle,
  applyVertexHandle,
  draggableWalls,
  lint,
  parse,
  parseDsl,
  toDsl,
  wallHandles,
} from "../src/index.ts";
import type { OffsetHandle, RadiusHandle, VertexHandle } from "../src/edit.ts";
import { rulesOf } from "./helpers.ts";

const load = (n: string, ext: "json" | "dsl" = "json") => readFileSync(new URL(`../fixtures/${n}.${ext}`, import.meta.url), "utf8");
const modelOf = (text: string) => analyze(parse(JSON.parse(text))).model;
const offsets = (m: Map<string, unknown>) => [...m.values()].filter((h): h is OffsetHandle => (h as OffsetHandle).kind === "offset");

describe("handles: an offset writes what the coordinate drag writes", () => {
  it("matches draggableWalls path for path on every poly-authored wall", () => {
    for (const name of ["casa-t3", "cabin", "broken"]) {
      const text = load(name);
      const model = modelOf(text);
      const drags = draggableWalls(text, model);
      const handles = wallHandles(text, model);
      let checked = 0;
      for (const [wallId, d] of drags) {
        // only the poly/rect drags are comparable: a grid drag resizes tracks instead
        if (d.writes.startsWith("layout.") || d.writes.startsWith("grid.")) continue;
        const h = handles.get(`offset:${wallId}`);
        assert.ok(h && h.kind === "offset", `${name}: no offset handle for ${wallId}`);
        // the same move, expressed as a coordinate and as a distance along the normal
        const sign = h.normal[0] !== 0 ? h.normal[0] : h.normal[1];
        const byDrag = applyDrag(text, d, d.c + 0.25);
        const byHandle = applyHandle(text, h, h.at + 0.25 * sign);
        assert.equal(byHandle, byDrag, `${name}: ${wallId} moved differently`);
        checked++;
      }
      assert.ok(checked > 0, `${name}: nothing to compare`);
    }
  });

  it("declines the same walls the coordinate drag declines", () => {
    const text = load("casa-t3");
    const model = modelOf(text);
    const drags = draggableWalls(text, model);
    const handles = wallHandles(text, model);
    for (const w of model.walls) {
      if (drags.has(w.id)) continue;
      assert.equal(handles.has(`offset:${w.id}`), false, `${w.id} was refused a drag but offered a handle`);
    }
  });
});

describe("handles: an angled wall slides along its own normal", () => {
  const NAME = "casa-angulo";

  /** the bay's west cheek, from (2, 0) up to (2.6, −1) */
  const cheek = (model: ReturnType<typeof modelOf>) =>
    model.walls.find(
      (w) => w.axis === undefined && w.geometry.kind === "segment" && w.geometry.a[0] === 2 && w.geometry.a[1] === 0,
    )!;

  it("offers one for a canted wall, whose normal is neither axis", () => {
    const text = load(NAME);
    const model = modelOf(text);
    const h = wallHandles(text, model).get(`offset:${cheek(model).id}`);
    assert.ok(h && h.kind === "offset", "the bay's cheek has an offset handle");
    assert.ok(Math.abs(h.normal[0]) > 1e-9 && Math.abs(h.normal[1]) > 1e-9, `normal ${h.normal} is on an axis`);
  });

  it("moves both coordinates of every corner on it, and the neighbours pivot", () => {
    const text = load(NAME);
    const model = modelOf(text);
    const h = wallHandles(text, model).get(`offset:${cheek(model).id}`) as OffsetHandle;
    assert.ok(h);
    assert.equal(h.edits(h.at + 0.2).length, 4, "two corners, both coordinates each");
    // free movement: the 5 cm snap applies to the projection, not to the delta
    const out = JSON.parse(applyHandle(text, h, h.at + 0.2, true)) as {
      rooms: { sala: { poly: [number, number][] } };
    };
    const poly = out.rooms.sala.poly;
    // the far ends of the two edges running into the cheek do not move
    assert.deepEqual(poly[0], [0, 0]);
    assert.deepEqual(poly[3], [4.4, -1]);
    // and the two corners on it moved together, by 0.2 along the cheek's normal
    const d0: [number, number] = [poly[1]![0] - 2, poly[1]![1] - 0];
    const d1: [number, number] = [poly[2]![0] - 2.6, poly[2]![1] + 1];
    assert.ok(Math.abs(Math.hypot(...d0) - 0.2) < 0.003, `${d0}`);
    assert.ok(Math.abs(d0[0] - d1[0]) < 0.003 && Math.abs(d0[1] - d1[1]) < 0.003, "both corners travelled the same way");
  });

  it("refuses the wall whose end is a T-junction it would travel away from", () => {
    // the 45° wing's north-east wall ends at (10, 8), on the arrumos' south edge; it
    // travels at 45° to that edge, so sliding it would tear the plan open
    const text = load(NAME);
    const model = modelOf(text);
    const wing = model.walls.find(
      (w) => w.axis === undefined && w.geometry.kind === "segment" && w.geometry.a[0] === 10 && w.geometry.a[1] === 8,
    )!;
    assert.ok(wing);
    assert.equal(wallHandles(text, model).has(`offset:${wing.id}`), false);
  });

  it("keeps the plan tiling through every offset it offers", () => {
    for (const name of [NAME, "casa-t3", "cabin"]) {
      const text = load(name);
      const model = modelOf(text);
      const before = analyze(parse(JSON.parse(text))).findings.filter((f) => f.rule.startsWith("tiling.")).length;
      for (const h of offsets(wallHandles(text, model)))
        for (const delta of [0.1, -0.1]) {
          const out = applyHandle(text, h, h.at + delta);
          const after = analyze(parse(JSON.parse(out))).findings.filter((f) => f.rule.startsWith("tiling."));
          assert.equal(after.length, before, `${name}: ${h.id} by ${delta} produced ${after.map((f) => f.rule).join(", ")}`);
        }
    }
  });
});

describe("handles: a curved wall has a radius", () => {
  const NAME = "casa-redonda";

  it("offers one per arc wall, writing the arc's own `r`", () => {
    const text = load(NAME);
    const model = modelOf(text);
    const handles = wallHandles(text, model);
    const radii = [...handles.values()].filter((h): h is RadiusHandle => h.kind === "radius");
    assert.ok(radii.length >= 2, `expected a radius handle per authored arc, got ${radii.length}`);
    for (const h of radii) {
      assert.equal(h.at, 2.5);
      assert.ok(h.min <= 2.5 && h.max > 2.5);
      assert.equal(h.edits(3)[0]!.path[h.edits(3)[0]!.path.length - 1], "r");
    }
  });

  it("changing the radius changes exactly one number, and the plan still parses", () => {
    const text = load(NAME);
    const model = modelOf(text);
    const h = [...wallHandles(text, model).values()].find((x): x is RadiusHandle => x.kind === "radius")!;
    const out = applyHandle(text, h, 3);
    assert.equal(out.split("\n").length, text.split("\n").length, "one value, in place");
    assert.doesNotThrow(() => parse(JSON.parse(out)));
    assert.notEqual(out, text);
  });

  it("will not shrink an arc below the chord it has to span", () => {
    const text = load(NAME);
    const model = modelOf(text);
    const h = [...wallHandles(text, model).values()].find((x): x is RadiusHandle => x.kind === "radius")!;
    const out = applyHandle(text, h, 0.1);
    assert.doesNotThrow(() => parse(JSON.parse(out)), "clamped to half the chord, so it still resolves");
  });
});

describe("handles: a vertex moves in two dimensions", () => {
  it("offers one per corner of every poly-authored space", () => {
    const text = load("casa-angulo");
    const model = modelOf(text);
    const vertices = [...wallHandles(text, model).values()].filter((h): h is VertexHandle => h.kind === "vertex");
    // sala has 8 corners, estudio 4; the rect-authored rooms have none
    assert.deepEqual(
      [...new Set(vertices.map((v) => v.space))].sort(),
      ["estudio", "sala"],
    );
    assert.equal(vertices.filter((v) => v.space === "sala").length, 8);
  });

  it("writes both coordinates, and only the ones that move", () => {
    const text = load("casa-angulo");
    const model = modelOf(text);
    const h = [...wallHandles(text, model).values()].find(
      (x): x is VertexHandle => x.kind === "vertex" && x.space === "estudio" && x.index === 2,
    )!;
    assert.deepEqual(h.at, [13, 11]);
    assert.equal(h.edits([13.5, 11.5]).length, 2);
    assert.equal(h.edits([13.5, 11]).length, 1, "a corner that only moves in x writes one number");
    const out = JSON.parse(applyVertexHandle(text, h, [13.5, 11.5])) as {
      rooms: { estudio: { poly: [number, number][] } };
    };
    assert.deepEqual(out.rooms.estudio.poly[2], [13.5, 11.5]);
  });

  it("a moved corner is still a plan", () => {
    const text = load("casa-angulo");
    const model = modelOf(text);
    const h = [...wallHandles(text, model).values()].find(
      (x): x is VertexHandle => x.kind === "vertex" && x.space === "estudio" && x.index === 2,
    )!;
    const out = applyVertexHandle(text, h, [14, 12]);
    assert.doesNotThrow(() => parse(JSON.parse(out)));
    assert.ok(!rulesOf(analyze(parse(JSON.parse(out))).findings).some((r) => r.startsWith("tiling.")));
  });
});

describe("handles: the grid keeps its own drag", () => {
  it("does not offer a grid wall as an offset, because resizing tracks is the better edit", () => {
    const text = load("casa-patio");
    const model = modelOf(text);
    const drags = draggableWalls(text, model);
    const handles = wallHandles(text, model);
    const gridWalls = [...drags.entries()].filter(([, d]) => d.writes.startsWith("layout."));
    assert.ok(gridWalls.length > 0);
    for (const [id] of gridWalls) {
      const h = handles.get(`offset:${id}`);
      // a grid-placed space has no poly to rewrite, so there is nothing for an offset to do
      if (h) assert.ok((h as OffsetHandle).writes.includes("patio"), `${id} offered ${(h as OffsetHandle).writes}`);
    }
  });

  it("no longer offers a detached room's wall as a grid drag", () => {
    // quinta's arrecadacao sits on the grid's east line by coincidence; the grid drag
    // used to resize the house and leave the shack where it was
    const text = load("quinta");
    const model = modelOf(text);
    const shackWall = model.walls.find(
      (w) => w.axis === "v" && w.c === 10.2 && (w.neg.kind === "room" ? w.neg.id : "") === "arrecadacao",
    )!;
    assert.ok(shackWall, "quinta still has the shack's east wall");
    const d = draggableWalls(text, model).get(shackWall.id)!;
    assert.match(d.writes, /arrecadacao/);
    const after = JSON.parse(applyDrag(text, d, 10.7)) as {
      rooms: { arrecadacao: { rect: number[] } };
      layout: { cols: number[] };
    };
    const before = JSON.parse(text) as { rooms: { arrecadacao: { rect: number[] } }; layout: { cols: number[] } };
    assert.deepEqual(after.layout.cols, before.layout.cols, "the house does not move");
    assert.notDeepEqual(after.rooms.arrecadacao.rect, before.rooms.arrecadacao.rect, "the shack does");
  });
});

/**
 * `applyHandle()` and `applyVertexHandle()` used to call `spliceAll()` directly (src/
 * edit.ts:942, :950) instead of the syntax-aware `applyEdits()` that `applyDrag()`/
 * `applyMove()` already route through (:82, :421, :598). `spliceAll` is `jsonpos`'s own
 * splice, which parses its input with `JSON.parse`-shaped position tracking — so calling
 * it on DSL text throws where the DSL's first token isn't valid JSON. casa-v is all
 * poly-authored angled walls (fixtures/casa-v.dsl), so it has both an offset handle and a
 * vertex handle to exercise.
 */
describe("handles: applyHandle/applyVertexHandle work on DSL text too", () => {
  const modelOfText = (text: string) => lint(text).model!;
  // `authored` records each entity's own field order, which differs between a
  // hand-written JSON document and one the DSL compiler produced; sort it away before
  // comparing, the same way test/dsl-edit.test.ts's `fmt` round-trip test does.
  const strip = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => (k === "authored" ? [...(x as string[])].sort() : x)));

  it("applyHandle on an offset handle produces the same Plan from DSL as from JSON", () => {
    const json = load("casa-v", "json");
    const dsl = load("casa-v", "dsl");
    const jModel = modelOfText(json);
    const dModel = modelOfText(dsl);
    const jHandles = wallHandles(json, jModel);
    const dHandles = wallHandles(dsl, dModel);
    const jOffset = offsets(jHandles)[0] as OffsetHandle;
    const dOffset = dHandles.get(jOffset.id) as OffsetHandle;
    assert.ok(jOffset && dOffset, "both syntaxes offer the same offset handle id");

    // before the fix, this throws inside jsonpos's spliceAll trying to parse DSL as JSON
    const outDsl = applyHandle(dsl, dOffset, dOffset.at + 0.2);
    const outJson = applyHandle(json, jOffset, jOffset.at + 0.2);
    assert.deepEqual(strip(parse(parseDsl(outDsl).doc)), strip(parse(JSON.parse(outJson))));
    // still canonical DSL, apart from the edited numbers
    assert.equal(toDsl(parseDsl(outDsl).doc), outDsl);
  });

  it("applyVertexHandle produces the same Plan from DSL as from JSON", () => {
    const json = load("casa-v", "json");
    const dsl = load("casa-v", "dsl");
    const jModel = modelOfText(json);
    const dModel = modelOfText(dsl);
    const jHandles = wallHandles(json, jModel);
    const dHandles = wallHandles(dsl, dModel);
    const jVertex = [...jHandles.values()].find((h): h is VertexHandle => h.kind === "vertex")!;
    const dVertex = dHandles.get(jVertex.id) as VertexHandle;
    assert.ok(jVertex && dVertex, "both syntaxes offer the same vertex handle id");

    // before the fix, this throws inside jsonpos's spliceAll trying to parse DSL as JSON
    const to: [number, number] = [jVertex.at[0] + 0.3, jVertex.at[1] - 0.2];
    const outDsl = applyVertexHandle(dsl, dVertex, to);
    const outJson = applyVertexHandle(json, jVertex, to);
    assert.deepEqual(strip(parse(parseDsl(outDsl).doc)), strip(parse(JSON.parse(outJson))));
    // still canonical DSL, apart from the edited numbers
    assert.equal(toDsl(parseDsl(outDsl).doc), outDsl);
  });
});
