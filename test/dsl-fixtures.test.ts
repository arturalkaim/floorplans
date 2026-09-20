import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { floorplan, parseDsl, schedule, toDsl } from "../src/index.ts";

/**
 * The committed `.dsl` twins. Each is `toDsl` of its `.json` sibling, so this file is the
 * guard that the two stay the same building: same findings, same schedule, same SVG — the
 * only difference being the `line` a DSL finding carries and a JSON one does not.
 */
const TWINS = ["casa-t3", "moradia-2-pisos", "cabin"];
const load = (name: string, ext: "json" | "dsl") => readFileSync(new URL(`../fixtures/${name}.${ext}`, import.meta.url), "utf8");

describe("the .dsl fixtures are canonical and mean their .json twins", () => {
  for (const name of TWINS) {
    it(`${name}.dsl is exactly what toDsl writes`, () => {
      assert.equal(load(name, "dsl"), toDsl(JSON.parse(load(name, "json"))), `regenerate with toDsl(${name}.json)`);
    });

    it(`${name}.dsl is its own canonical form`, () => {
      const text = load(name, "dsl");
      assert.equal(toDsl(parseDsl(text).doc), text);
    });

    it(`${name}.dsl renders byte-identically to ${name}.json`, () => {
      const a = floorplan(load(name, "json"));
      const b = floorplan(load(name, "dsl"));
      assert.equal(b.svg, a.svg);
      assert.deepEqual(b.levels.map((l) => l.svg), a.levels.map((l) => l.svg));
      assert.deepEqual(schedule(b.model), schedule(a.model));
      // findings match field for field; `line` is the one thing the DSL adds
      assert.deepEqual(b.findings.map(({ line, ...f }) => f), a.findings);
      assert.ok(a.findings.every((f) => f.line === undefined));
    });
  }

  it("costs what the review measured: the DSL is roughly half its JSON twin", () => {
    // a cheap, tokenizer-free stand-in for the o200k count in the README — characters
    // track tokens closely enough to catch a grammar change that doubles the document
    for (const name of TWINS) {
      const ratio = load(name, "dsl").length / load(name, "json").length;
      assert.ok(ratio < 0.7, `${name}.dsl is ${Math.round(ratio * 100)} % of its JSON twin's size`);
    }
  });
});
