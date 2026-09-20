import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyze, floorplan, parse, renderSvg } from "../src/index.ts";
import { twoStoreys } from "./helpers.ts";

describe("levels: one drawing per storey", () => {
  const r = floorplan(twoStoreys());

  it("returns a level list and keeps `svg` as the ground level's", () => {
    assert.deepEqual(r.levels.map((l) => l.id), ["baixo", "cima"]);
    assert.equal(r.svg, r.levels[0]!.svg);
    assert.ok(r.levels[1]!.svg.includes("Quarto"));
    assert.ok(!r.levels[1]!.svg.includes("Sala"), "the upper sheet draws the upper floor only");
  });

  it("ghosts the level below: outline and walls, no labels", () => {
    const ground = r.levels[0]!.svg;
    const upper = r.levels[1]!.svg;
    assert.ok(!ground.includes('class="ghost"'), "nothing sits under the ground floor");
    assert.ok(upper.includes('class="ghost"'));
    const ghost = upper.slice(upper.indexOf('<g class="ghost"'), upper.indexOf("</g>", upper.indexOf('<g class="ghost"')));
    assert.ok(!ghost.includes("<text"), "a ghost carries no labels");
    assert.match(ghost, /stroke-opacity="\.28"/);
  });

  it("draws every level on the same extent, so the sheets line up", () => {
    const box = (svg: string) => /viewBox="([^"]+)"/.exec(svg)![1];
    assert.equal(box(r.levels[0]!.svg), box(r.levels[1]!.svg));
  });

  it("names the level in the title and puts a void on the sheet", () => {
    const named = floorplan({ ...twoStoreys(), title: "Casa" });
    assert.ok(named.levels[1]!.svg.includes("Casa — Piso 1"));
    assert.ok(named.levels[1]!.svg.includes('data-void="vazio"'));
  });

  it("gives a stair no fixture handles, because it is not a fixture in the document", () => {
    assert.ok(r.levels[0]!.svg.includes('data-vertical="escada"'));
    assert.ok(!r.levels[0]!.svg.includes('data-fixture="-1"'));
  });
});

describe("levels: rendering one storey directly", () => {
  it("renderSvg takes a level and defaults to the ground one", () => {
    const model = analyze(parse(twoStoreys())).model;
    assert.equal(renderSvg(model), renderSvg(model, { level: "baixo" }));
    assert.notEqual(renderSvg(model, { level: "cima" }), renderSvg(model));
  });

  it("ghosting can be turned off", () => {
    const model = analyze(parse(twoStoreys())).model;
    assert.ok(!renderSvg(model, { level: "cima", ghost: false }).includes('class="ghost"'));
  });
});
