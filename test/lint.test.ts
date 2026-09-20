// B8: one channel. `lint()` never throws — a schema problem arrives as a `schema.*`
// finding with the issue's own document path, next to the geometry and semantic findings
// — while `parse()` and `floorplan()` keep throwing for callers who want that.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RULES } from "../src/catalogue.ts";
import { floorplan, isSchemaFinding, lint, parse, PlanError, summarize, walls } from "../src/index.ts";
import { rect, twoRooms, twoStoreys } from "./helpers.ts";

const rulesFor = (doc: unknown) => lint(doc).findings.map((f) => f.rule);

describe("lint never throws", () => {
  it("turns a schema failure into findings, where parse() throws", () => {
    const bad = { rooms: { a: { poly: [[0, 0], [1, 1], [0, 1]] } } };
    assert.throws(() => parse(bad), PlanError);
    assert.throws(() => floorplan(bad), PlanError);
    const { findings, plan, model } = lint(bad);
    assert.ok(findings.length > 0);
    assert.ok(findings.every(isSchemaFinding));
    assert.ok(findings.every((f) => f.severity === "error"));
    assert.equal(plan, undefined, "there is no plan to return");
    assert.equal(model, undefined);
  });

  it("carries the issue's own document path onto the finding", () => {
    const f = lint({ rooms: { a: { poly: [[0, 0], [1, 1], [0, 1]] } } }).findings[0]!;
    assert.equal(f.path, "rooms.a.poly");
  });

  it("survives input that is not JSON at all", () => {
    assert.deepEqual(rulesFor("{ not json"), ["schema.syntax"]);
    assert.equal(rulesFor(42)[0], "schema.syntax");
  });

  it("returns the plan and the model when the document is good", () => {
    const { findings, plan, model } = lint(twoRooms());
    assert.deepEqual(findings, []);
    assert.equal(plan!.rooms.length, 2);
    assert.ok(model!.walls.length > 0);
  });

  it("also keeps the PlanError, for a caller that wants its message", () => {
    const { error } = lint({ rooms: {} });
    assert.ok(error instanceof PlanError);
    assert.match(error.message, /^Invalid plan:/);
  });
});

describe("the schema.* vocabulary", () => {
  const only = (doc: unknown) => [...new Set(rulesFor(doc))];

  it("unknown_field: a key the schema has not got", () => {
    assert.ok(only({ rooms: { a: { rect: [0, 0, 2, 2], kinde: "living" } } }).includes("schema.unknown_field"));
  });
  it("missing: geometry that was never given", () => {
    assert.ok(only({ rooms: { a: { kind: "living" } } }).includes("schema.missing"));
  });
  it("type: a value outside a fixed vocabulary", () => {
    assert.ok(only({ rooms: { a: { rect: [0, 0, 2, 2], kind: "dungeon" } } }).includes("schema.type"));
  });
  it("reference: an opening naming a space nobody declared", () => {
    assert.ok(only(twoRooms({ openings: [{ type: "door", between: ["a", "nowhere"], width: 0.8 }] })).includes("schema.reference"));
  });
  it("geometry: a polygon that cannot be a shape", () => {
    assert.ok(only({ rooms: { a: { poly: [[0, 0], [1, 1], [0, 1]] } } }).includes("schema.geometry"));
  });
  it("conflict: two mutually exclusive forms", () => {
    assert.ok(only({ rooms: { a: { poly: rect(0, 0, 2, 2), rect: [0, 0, 2, 2] } } }).includes("schema.conflict"));
  });
  it("syntax: text that is not JSON", () => {
    assert.deepEqual(only("nope"), ["schema.syntax"]);
  });

  it("is documented in the catalogue, every member of it", () => {
    const documented = RULES.filter((r) => r.id.startsWith("schema.")).map((r) => r.id).sort();
    assert.deepEqual(documented, [
      "schema.conflict",
      "schema.geometry",
      "schema.missing",
      "schema.reference",
      "schema.syntax",
      "schema.type",
      "schema.unknown_field",
    ]);
  });
});

describe("summarize", () => {
  it("counts each severity", () => {
    assert.deepEqual(summarize([]), { error: 0, warning: 0, info: 0 });
    assert.deepEqual(summarize(lint(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8 }] })).findings).error > 0, true);
  });
});

describe("walls", () => {
  it("names every wall by id, with endpoints as points and owners as tagged unions", () => {
    const model = lint(twoRooms()).model!;
    const rows = walls(model);
    assert.equal(rows.length, model.walls.length);
    const partition = rows.find((w) => w.kind === "partition")!;
    assert.deepEqual(Object.keys(partition), ["id", "kind", "from", "to", "neg", "pos"]);
    assert.deepEqual([partition.neg, partition.pos].map((o) => o.kind).sort(), ["room", "room"]);
    // no `axis`/`c`: those do not survive the geometry rewrite (gaps-design §1.3.1)
    for (const w of rows) assert.ok(!("axis" in w) && !("c" in w));
  });

  it("names the level on a levelled document, and can be scoped to one", () => {
    const model = lint(twoStoreys()).model!;
    assert.deepEqual([...new Set(walls(model).map((w) => w.level))], ["baixo", "cima"]);
    assert.deepEqual([...new Set(walls(model, "cima").map((w) => w.level))], ["cima"]);
    // a single-level document never grows the field
    assert.ok(walls(lint(twoRooms()).model!).every((w) => !("level" in w)));
  });

  it("gives an opening's two endpoints, so a wall can be read before placing one on it", () => {
    const rows = walls(lint(twoRooms()).model!);
    const w = rows.find((x) => x.from[0] === x.to[0] && x.from[0] === 4)!;
    assert.ok(w, "expected the partition at x=4");
    assert.deepEqual([w.from, w.to], [[4, 0], [4, 3.4]]);
  });
});
