import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { formatPlan, formatText } from "../src/format.ts";
import { parseWithPositions, spliceAt } from "../src/jsonpos.ts";

const FIXTURES = ["casa-t3", "casa-piscina", "quinta", "cabin", "broken", "apartment-t2", "casa-patio"];
const load = (n: string) => readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), "utf8");

describe("format: the document keeps its meaning", () => {
  it("round trips every fixture", () => {
    for (const n of FIXTURES)
      assert.deepEqual(JSON.parse(formatText(load(n))), JSON.parse(load(n)), n);
  });
  it("is idempotent, so formatting on every edit never drifts", () => {
    for (const n of FIXTURES) {
      const once = formatText(load(n));
      assert.equal(formatText(once), once, n);
    }
  });
  it("keeps every line inside the width", () => {
    for (const n of FIXTURES)
      for (const line of formatText(load(n)).split("\n"))
        assert.ok(line.length <= 140, `${n}: ${line.length} chars`);
  });
});

describe("format: coordinates read as rows", () => {
  it("keeps a point and a ring on one line", () => {
    const out = formatPlan({ poly: [[0, 0], [4.6, 0], [4.6, 4.4], [0, 4.4]] });
    assert.equal(out.trim(), '{ "poly": [[0, 0], [4.6, 0], [4.6, 4.4], [0, 4.4]] }');
  });
  it("breaks a long ring one point per line, never one number per line", () => {
    const ring = Array.from({ length: 24 }, (_, i) => [i * 1.125, i * 2.375]);
    const lines = formatPlan({ poly: ring }).split("\n");
    const points = lines.filter((l) => l.trim().startsWith("["));
    assert.equal(points.length, ring.length, "one line per point");
    for (const l of points) assert.match(l.trim(), /^\[-?[\d.]+, -?[\d.]+\],?$/);
  });
  it("keeps a room and an opening with nested on/position on one line", () => {
    const out = formatPlan({
      openings: [
        { type: "door", between: ["exterior", "hall"], on: { room: "hall", side: "north" }, width: 1 },
      ],
    });
    assert.equal(out.split("\n").filter((l) => l.includes('"door"')).length, 1);
  });
});

describe("format + splice: a drag only rewrites numbers", () => {
  it("a spliced number leaves the document canonical", () => {
    const text = formatText(load("quinta"));
    const after = spliceAt(text, ["layout", "cols", 1], "3.85").text;
    assert.equal(formatText(after), after, "still canonical, no reformat needed");
    assert.equal(JSON.parse(after).layout.cols[1], 3.85);
  });
  it("touches only the characters of that number", () => {
    const text = formatText(load("quinta"));
    const r = spliceAt(text, ["layout", "cols", 1], "3.85");
    assert.equal(r.text.slice(0, r.start), text.slice(0, r.start));
    assert.equal(r.text.slice(r.start + r.inserted), text.slice(r.start + r.removed));
  });
  it("positions still resolve after formatting", () => {
    for (const n of FIXTURES) {
      const text = formatText(load(n));
      assert.doesNotThrow(() => parseWithPositions(text), n);
    }
  });
});
