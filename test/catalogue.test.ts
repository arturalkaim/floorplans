import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { RULES, ruleById } from "../src/catalogue.ts";
import { floorplan } from "../src/index.ts";

const SRC = new URL("../src/", import.meta.url);
const FIXTURES = ["casa-t3", "casa-piscina", "quinta", "cabin", "broken", "apartment-t2", "casa-patio", "moradia-2-pisos", "broken-levels", "casa-angulo", "casa-redonda", "broken-geometria", "casa-v"];

/**
 * Every rule id written in the library. A rule is named in exactly two places: as the
 * `rule` property of a Finding, or as the first argument to a fail() helper that builds
 * one. Matching those two shapes rather than any dotted string keeps JSON paths that
 * appear in messages — "layout.areas", "walls.exterior" — out of the set.
 */
function emittedIds(): Set<string> {
  const ids = new Set<string>();
  for (const f of readdirSync(SRC)) {
    if (!f.endsWith(".ts") || f === "catalogue.ts") continue;
    const src = readFileSync(new URL(f, SRC), "utf8");
    for (const m of src.matchAll(/(?:rule:\s*|\bfail\()\s*"([a-z]+\.[a-z_]+)"/g)) ids.add(m[1]!);
  }
  return ids;
}

describe("rule catalogue is the documentation source", () => {
  it("documents every rule the library can emit", () => {
    const undocumented = [...emittedIds()].filter((id) => !ruleById(id)).sort();
    assert.deepEqual(undocumented, [], `add these to src/catalogue.ts: ${undocumented.join(", ")}`);
  });

  it("documents no rule the library cannot emit", () => {
    const emitted = emittedIds();
    const phantom = RULES.map((r) => r.id).filter((id) => !emitted.has(id)).sort();
    assert.deepEqual(phantom, [], `these are documented but never emitted: ${phantom.join(", ")}`);
  });

  it("has no duplicate ids and every entry is filled in", () => {
    assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
    for (const r of RULES) {
      assert.match(r.id, /^[a-z]+\.[a-z_]+$/, `${r.id} is not group.name`);
      assert.ok(r.catches.length > 20, `${r.id} needs a real description`);
      assert.ok(["error", "warning", "info"].includes(r.severity));
    }
  });

  it("grades each rule the way the fixtures actually report it", () => {
    for (const name of FIXTURES) {
      const json = JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
      for (const f of floorplan(json).findings) {
        const doc = ruleById(f.rule);
        assert.ok(doc, `${name}: ${f.rule} is not in the catalogue`);
        assert.equal(doc.severity, f.severity, `${name}: ${f.rule} is documented ${doc.severity} but reported ${f.severity}`);
      }
    }
  });

  it("names a real option where it claims one is tunable", () => {
    const known = new Set(["circulationShare", "minDimension", "doorMinWidth", "minClearance", "stairPitch", "minHeadroom"]);
    for (const r of RULES) if (r.option) assert.ok(known.has(r.option), `${r.id}: unknown option ${r.option}`);
  });
});
