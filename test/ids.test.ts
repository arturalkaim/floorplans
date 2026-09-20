// B7: openings and fixtures have a stable id, and findings name it instead of an index.
//
// The property that matters is not "an id exists" but "deleting a sibling does not rename
// anything else" — an array index fails exactly there, and that is what these test.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse, PlanError } from "../src/index.ts";
import { rect, twoRooms, twoStoreys } from "./helpers.ts";

const idsOf = (doc: unknown) => parse(doc).openings.map((o) => o.id);
const issuesOf = (doc: unknown): Array<{ path: string; message: string }> => {
  try {
    parse(doc);
    return [];
  } catch (e) {
    if (e instanceof PlanError) return e.issues;
    throw e;
  }
};

describe("ids: openings", () => {
  it("synthesises <type>:<a>-<b>:<n> from the sorted pair", () => {
    assert.deepEqual(idsOf(twoRooms()), ["door:a-exterior:0", "door:a-b:0", "window:a-exterior:0", "window:b-exterior:0"]);
  });

  it("numbers same-type same-pair openings in document order", () => {
    const doc = twoRooms({
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: true },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 1, position: 0.5 },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 1, position: 2.5 },
      ],
    });
    assert.deepEqual(idsOf(doc), ["door:a-exterior:0", "window:a-exterior:0", "window:a-exterior:1"]);
  });

  it("swapping `between` renames nothing, because the pair is sorted", () => {
    const one = twoRooms({ openings: [{ type: "cased", between: ["a", "b"], width: 1.2 }] });
    const other = twoRooms({ openings: [{ type: "cased", between: ["b", "a"], width: 1.2 }] });
    assert.deepEqual(idsOf(one), idsOf(other));
  });

  it("deleting an opening renumbers only its own pair's later siblings", () => {
    const openings = [
      { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: true },
      { type: "window", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 1, position: 0.5 },
      { type: "window", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 1, position: 2.5 },
      { type: "window", between: ["exterior", "b"], on: { room: "b", side: "east" }, width: 1.2 },
    ];
    const before = idsOf(twoRooms({ openings }));
    const after = idsOf(twoRooms({ openings: [openings[0]!, openings[2]!, openings[3]!] }));
    // the b window kept its name although every index after it moved down by one
    assert.equal(before[3], "window:b-exterior:0");
    assert.equal(after[2], "window:b-exterior:0");
    // and the surviving a window took the deleted one's number, which is the whole point:
    // only its own pair is affected
    assert.deepEqual(after, ["door:a-exterior:0", "window:a-exterior:0", "window:b-exterior:0"]);
  });

  it("an authored id wins, and counts towards its pair's numbering so no sibling moves", () => {
    const doc = twoRooms({
      openings: [
        { id: "porta", type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: true },
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 0.9 },
      ],
    });
    assert.deepEqual(idsOf(doc), ["porta", "door:a-exterior:1"]);
  });

  it("an authored id can never collide with a synthesised one: ID_RE forbids ':'", () => {
    assert.deepEqual(
      issuesOf(twoRooms({ openings: [{ id: "door:a-b:0", type: "door", between: ["a", "b"], width: 0.8 }] })),
      [{ path: "openings[0].id", message: "id must match ^[a-z][a-z0-9_]*$", kind: "type" }],
    );
  });

  it("rejects the same authored id twice on one level", () => {
    const doc = twoRooms({
      openings: [
        { id: "porta", type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: true },
        { id: "porta", type: "door", between: ["a", "b"], width: 0.8 },
      ],
    });
    assert.deepEqual(issuesOf(doc), [
      { path: "openings[1].id", message: 'id "porta" is already used by another opening on this level', kind: "conflict" },
    ]);
  });

  it("scopes ids per level: the same id may be used once on each storey", () => {
    const doc = twoStoreys();
    (doc.levels["baixo"] as { openings: Array<Record<string, unknown>> }).openings[0]!["id"] = "porta";
    (doc.levels["cima"] as { openings: Array<Record<string, unknown>> }).openings[0]!["id"] = "porta";
    const plan = parse(doc);
    assert.deepEqual(plan.levels.map((l) => l.openings[0]!.id), ["porta", "porta"]);
    // and the path, which is what disambiguates them, does name the level
    assert.deepEqual(plan.levels.map((l) => l.openings[0]!.path), ["levels.baixo.openings[0]", "levels.cima.openings[0]"]);
  });
});

describe("ids: fixtures", () => {
  const withFixtures = (fixtures: unknown[]) => twoRooms({ fixtures });

  it("synthesises <type>:<in>:<n>, counted per type and host space", () => {
    const plan = parse(
      withFixtures([
        { type: "sink", in: "a", at: [0.2, 0.2], size: [0.6, 0.5] },
        { type: "sink", in: "a", at: [1.2, 0.2], size: [0.6, 0.5] },
        { type: "sink", in: "b", at: [4.2, 0.2], size: [0.6, 0.5] },
        { type: "counter", in: "a", at: [0.2, 2.2], size: [1.6, 0.6] },
      ]),
    );
    assert.deepEqual(plan.fixtures.map((f) => f.id), ["sink:a:0", "sink:a:1", "sink:b:0", "counter:a:0"]);
  });

  it("an authored id wins and must be unique", () => {
    const plan = parse(withFixtures([{ id: "lava", type: "sink", in: "a", at: [0.2, 0.2], size: [0.6, 0.5] }]));
    assert.equal(plan.fixtures[0]!.id, "lava");
    assert.deepEqual(
      issuesOf(
        withFixtures([
          { id: "lava", type: "sink", in: "a", at: [0.2, 0.2], size: [0.6, 0.5] },
          { id: "lava", type: "sink", in: "b", at: [4.2, 0.2], size: [0.6, 0.5] },
        ]),
      ),
      [{ path: "fixtures[1].id", message: 'id "lava" is already used by another fixture on this level', kind: "conflict" }],
    );
  });

  it("a vertical element's synthetic fixture is named for the element, not for fixtures[-1]", () => {
    const plan = parse({
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: { hall: { kind: "hall", poly: rect(0, 0, 3, 4) } },
      openings: [{ type: "door", between: ["exterior", "hall"], on: { room: "hall", side: "north" }, width: 1, entrance: true }],
      vertical: [{ id: "escada", type: "stairs", at: [{ level: "ground", in: "hall", rect: [0.5, 0.5, 1, 2] }] }],
    });
    assert.deepEqual(plan.vertical[0]!.path, "vertical[0]");
    assert.deepEqual(plan.vertical[0]!.at[0]!.path, "vertical[0].at[0]");
  });
});
