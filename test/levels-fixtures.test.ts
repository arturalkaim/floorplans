import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { floorplan, formatText } from "../src/index.ts";
import { rulesOf } from "./helpers.ts";

const load = (n: string) => readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), "utf8");

describe("fixture: moradia-2-pisos (two storeys, a shared grid, a void and a stair)", () => {
  const text = load("moradia-2-pisos");
  const r = floorplan(JSON.parse(text));

  it("is written in canonical form", () => {
    assert.equal(formatText(text), text);
  });

  it("has nothing above info on either storey", () => {
    assert.deepEqual(rulesOf(r.findings.filter((f) => f.severity !== "info")), []);
  });

  it("stacks two levels whose plates match, with the upper floor on the shared grid", () => {
    assert.equal(r.schedule.building!.storeys, 2);
    assert.equal(r.schedule.levels![0]!.footprint, r.schedule.levels![1]!.footprint);
    assert.equal(r.plan.grid!.cols.length, 4);
    // piso0 authors rects and a poly; piso1 supplies only `areas`
    assert.equal(JSON.parse(text).levels.piso1.layout.cols, undefined);
  });

  it("carries the double-height void and the stairwell, and neither counts as floor", () => {
    const upper = r.model.levels[1]!;
    assert.deepEqual(upper.level.voids.map((v) => v.id), ["vazio_sala", "vazio_escada"]);
    assert.equal(upper.interiorArea, 75.52);
    assert.equal(upper.envelope.area, 89.88);
  });

  it("joins the storeys with one stair, which is an obstacle on both", () => {
    assert.deepEqual(r.plan.vertical.map((v) => v.id), ["escada"]);
    for (const lm of r.model.levels)
      assert.equal(lm.fixtures.filter((f) => f.fixture.vertical === "escada").length, 1);
  });

  it("draws one sheet per storey and ghosts the ground floor under the first", () => {
    assert.equal(r.levels.length, 2);
    assert.ok(r.levels[1]!.svg.includes('class="ghost"'));
    assert.ok(r.levels[0]!.svg.includes("Alpendre"));
  });
});

describe("fixture: broken-levels (one of every cross-level error)", () => {
  it("reports each new rule at least once and still draws", () => {
    const r = floorplan(JSON.parse(load("broken-levels")));
    const rules = new Set(rulesOf(r.findings));
    for (const expected of [
      "level.unreachable",
      "stair.no_arrival",
      "stair.misaligned",
      "stair.pitch",
      "stair.headroom",
      "structure.over_open_sky",
      "entrance.not_ground",
    ])
      assert.ok(rules.has(expected), `expected ${expected} in ${[...rules].join(", ")}`);
    assert.equal(r.levels.length, 3);
    for (const l of r.levels) assert.ok(l.svg.startsWith("<svg "));
  });

  it("is written in canonical form", () => {
    assert.equal(formatText(load("broken-levels")), load("broken-levels"));
  });
});
