import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyze, floorplan, parse, PlanError } from "../src/index.ts";
import { has, rulesOf, sharedGridPlan, twoStoreys } from "./helpers.ts";

const issuesOf = (doc: unknown): string[] => {
  try {
    parse(doc);
    return [];
  } catch (e) {
    return (e as PlanError).issues.map((i) => `${i.path}: ${i.message}`);
  }
};

describe("levels: the shape of a multi-level document", () => {
  it("parses a stack, a level's own content, and one vertical element", () => {
    const plan = parse(twoStoreys());
    assert.equal(plan.levelled, true);
    assert.deepEqual(plan.levels.map((l) => l.id), ["baixo", "cima"]);
    assert.deepEqual(plan.levels.map((l) => l.ground), [true, false]);
    assert.equal(plan.levels[1]!.voids.length, 1);
    assert.equal(plan.vertical[0]!.at.length, 2);
    // the plan's own collections are the ground level's, so a single-level consumer reads on
    assert.equal(plan.rooms, plan.levels[0]!.rooms);
  });

  it("is clean: two storeys, a stair, and a void where the stair comes up", () => {
    const r = floorplan(twoStoreys());
    assert.deepEqual(rulesOf(r.findings.filter((f) => f.severity !== "info")), []);
  });

  it("names the level in every finding a level produced, and leaves it off a building-wide one", () => {
    const doc = twoStoreys();
    doc.levels.cima = { ...(doc.levels.cima as object), openings: [] };
    const { findings } = analyze(parse(doc));
    const perLevel = findings.filter((f) => f.rule === "space.no_access");
    assert.ok(perLevel.length > 0);
    for (const f of perLevel) assert.equal(f.level, "cima");
    // entrance.* is about the building, so it names no level
    const entrance = findings.find((f) => f.rule.startsWith("entrance."));
    if (entrance) assert.equal(entrance.level, undefined);
  });

  it("rejects top-level rooms in a document that has levels", () => {
    const doc = { ...twoStoreys(), rooms: { x: { rect: [0, 0, 1, 1] } } };
    assert.match(issuesOf(doc).join("\n"), /unknown field "rooms"/);
  });

  it("points an error at the level the author wrote it on", () => {
    const doc = twoStoreys();
    doc.levels.cima = { rooms: { quarto: { kind: "bedroom", poly: [[0, 0], [1, 1], [0, 1]] } } };
    assert.match(issuesOf(doc).join("\n"), /levels\.cima\.rooms\.quarto\.poly/);
  });

  it("insists that `stack` names every level exactly once", () => {
    assert.match(issuesOf(twoStoreys({ stack: ["baixo"] })).join("\n"), /"cima" is not in the stack/);
    assert.match(issuesOf(twoStoreys({ stack: ["baixo", "cave"] })).join("\n"), /unknown level "cave"/);
    assert.match(issuesOf(twoStoreys({ stack: ["baixo", "baixo", "cima"] })).join("\n"), /listed twice/);
  });

  it("falls back to the document's own key order when there is no stack", () => {
    const doc = twoStoreys();
    delete (doc as { stack?: unknown }).stack;
    assert.deepEqual(parse(doc).levels.map((l) => l.id), ["baixo", "cima"]);
  });

  it("refuses a vertical element without an id, an unknown level, or a space that is not there", () => {
    const bad = (v: unknown) => issuesOf(twoStoreys({ vertical: [v] })).join("\n");
    assert.match(bad({ type: "stairs", at: [{ level: "baixo", in: "hall", rect: [0, 0, 1, 1] }] }), /needs an id/);
    assert.match(bad({ id: "e", type: "stairs", at: [{ level: "cave", in: "hall", rect: [0, 0, 1, 1] }] }), /must name a level/);
    assert.match(bad({ id: "e", type: "stairs", at: [{ level: "baixo", in: "nope", rect: [0, 0, 1, 1] }] }), /must name a room or outdoor space on baixo/);
    assert.match(bad({ id: "e", type: "escalator", at: [{ level: "baixo", in: "hall", rect: [0, 0, 1, 1] }] }), /must be one of stairs, lift, ramp/);
    assert.match(bad({ id: "e", type: "stairs", at: [] }), /must be a non-empty array/);
  });

  it("sorts a vertical element's footprints into stack order however they were written", () => {
    const doc = twoStoreys({
      vertical: [
        {
          id: "escada",
          type: "stairs",
          at: [
            { level: "cima", in: "patamar", rect: [0.5, 0.6, 1, 1.1] },
            { level: "baixo", in: "hall", rect: [0.5, 0.6, 1, 3.64] },
          ],
        },
      ],
    });
    assert.deepEqual(parse(doc).vertical[0]!.at.map((a) => a.level), ["baixo", "cima"]);
  });

  it("will not let an opening name a void: there is no floor on its side of the wall", () => {
    const doc = twoStoreys();
    doc.levels.cima = {
      ...(doc.levels.cima as { openings: unknown[] }),
      openings: [{ type: "door", between: ["patamar", "vazio"], width: 0.8 }],
    };
    assert.match(issuesOf(doc).join("\n"), /is a void: there is no floor on its side/);
  });
});

describe("levels: the shared track grid", () => {
    it("compiles a level that supplies only `areas`", () => {
    const plan = parse(sharedGridPlan);
    for (const l of plan.levels) assert.equal(l.rooms.length, 2);
    // the same track boundary on both levels: x = 3
    assert.equal(plan.levels[0]!.rooms[0]!.poly[1]![0], 3);
    assert.equal(plan.levels[1]!.rooms[0]!.poly[1]![0], 3);
  });

  it("says so when a level has neither its own tracks nor a shared grid", () => {
    const doc = structuredClone(sharedGridPlan) as { grid?: unknown };
    delete doc.grid;
    assert.match(issuesOf(doc).join("\n"), /levels\.baixo\.layout\.cols: .*shared grid/);
  });

});

describe("levels: what only exists between storeys", () => {
  const rules = (doc: unknown) => rulesOf(analyze(parse(doc)).findings);

  it("level.unreachable: a storey nothing arrives on", () => {
    assert.ok(!rules(twoStoreys()).includes("level.unreachable"));
    const f = analyze(parse(twoStoreys({ vertical: [] }))).findings.find((x) => x.rule === "level.unreachable")!;
    assert.ok(f, "removing the stair should strand the upper floor");
    assert.equal(f.level, "cima");
    assert.match(f.message, /Piso 1 has no stair, lift or ramp/);
  });

  it("reach.unreachable says why, when the reason is a missing stair", () => {
    const f = analyze(parse(twoStoreys({ vertical: [] }))).findings.find((x) => x.rule === "reach.unreachable")!;
    assert.match(f.message, /no stair, lift or ramp arrives on Piso 1/);
  });

  it("stair.no_arrival: the footprint is not inside the space it names", () => {
    const doc = twoStoreys({
      vertical: [
        {
          id: "escada",
          type: "stairs",
          at: [
            { level: "baixo", in: "hall", rect: [3.5, 0.6, 1, 3.64] },
            { level: "cima", in: "patamar", rect: [0.5, 0.6, 1, 1.1] },
          ],
        },
      ],
    });
    const f = analyze(parse(doc)).findings.find((x) => x.rule === "stair.no_arrival")!;
    assert.ok(f);
    assert.equal(f.vertical, "escada");
    assert.match(f.message, /not fully inside hall on Piso 0/);
  });

  it("stair.no_arrival: an element that stands on one level joins nothing", () => {
    const doc = twoStoreys({
      vertical: [{ id: "escada", type: "stairs", at: [{ level: "baixo", in: "hall", rect: [0.5, 0.6, 1, 3.64] }] }],
    });
    assert.match(
      analyze(parse(doc)).findings.find((x) => x.rule === "stair.no_arrival")!.message,
      /goes nowhere/,
    );
  });

  it("stair.misaligned: consecutive footprints are not the same shaft", () => {
    const doc = twoStoreys({
      vertical: [
        {
          id: "escada",
          type: "stairs",
          at: [
            { level: "baixo", in: "hall", rect: [0.5, 0.6, 1, 3.64] },
            { level: "cima", in: "patamar", rect: [1.8, 0.6, 1, 1.1] },
          ],
        },
      ],
    });
    const f = analyze(parse(doc)).findings.find((x) => x.rule === "stair.misaligned")!;
    assert.equal(f.severity, "warning");
    assert.match(f.message, /do not overlap at all/);
    assert.ok(!rules(twoStoreys()).includes("stair.misaligned"));
  });

  it("structure.over_open_sky: a room standing over no room below", () => {
    const doc = twoStoreys();
    // push the upper floor a metre south, out over the garden
    doc.levels.cima = {
      ...(doc.levels.cima as { rooms: Record<string, unknown> }),
      rooms: {
        patamar: { name: "Patamar", kind: "hall", rect: [0, 1, 3, 5] },
        quarto: { name: "Quarto", kind: "bedroom", rect: [3, 1, 4, 5] },
      },
      voids: {},
    };
    const f = analyze(parse(doc)).findings.find((x) => x.rule === "structure.over_open_sky")!;
    assert.ok(f, "a metre of overhang should be reported");
    assert.equal(f.severity, "warning");
    assert.match(f.message, /standing over no room on Piso 0/);
    assert.ok(!rules(twoStoreys()).includes("structure.over_open_sky"));
  });

  it("stair.pitch and stair.headroom stay quiet until the numbers are given, then report them", () => {
    const bare = twoStoreys({
      vertical: [
        {
          id: "escada",
          type: "stairs",
          at: [
            { level: "baixo", in: "hall", rect: [0.5, 0.6, 1, 3.64] },
            { level: "cima", in: "patamar", rect: [0.5, 0.6, 1, 1.1] },
          ],
        },
      ],
    });
    assert.ok(!rules(bare).includes("stair.pitch"));
    assert.ok(!rules(bare).includes("stair.headroom"));

    // the same flight squeezed into 24 risers: a ladder, and no void to put your head through
    const doc = twoStoreys({
      vertical: [
        {
          id: "escada",
          type: "stairs",
          up: 0,
          risers: 24,
          at: [
            { level: "baixo", in: "hall", rect: [0.5, 0.6, 1, 3.64] },
            { level: "cima", in: "patamar", rect: [0.5, 0.6, 1, 1.1] },
          ],
        },
      ],
    });
    doc.levels.cima = { ...(doc.levels.cima as object), voids: {} };
    const findings = analyze(parse(doc)).findings;
    const pitch = findings.find((x) => x.rule === "stair.pitch")!;
    assert.equal(pitch.severity, "info");
    assert.match(pitch.message, /24 risers of 0\.113 m over a 3\.64 m flight gives a 0\.158 m going/);
    const head = findings.find((x) => x.rule === "stair.headroom")!;
    assert.equal(head.severity, "info");
    assert.match(head.message, /headroom/);
  });

  it("an exterior door on an upper floor is a balcony door, not a way in", () => {
    const doc = twoStoreys();
    doc.levels.cima = {
      ...(doc.levels.cima as { openings: unknown[] }),
      openings: [
        { type: "door", between: ["patamar", "quarto"], width: 0.9, swingInto: "quarto" },
        { type: "door", between: ["exterior", "quarto"], on: { room: "quarto", side: "east" }, width: 0.9, swingInto: "quarto" },
      ],
    };
    const { findings } = analyze(parse(doc));
    const f = findings.find((x) => x.rule === "entrance.not_ground")!;
    assert.equal(f.severity, "info");
    assert.equal(f.level, "cima");
    // and it does not become a second way into the building
    assert.ok(!has(findings, "entrance.multiple"));
  });

  it("joins the levels in one access graph, through the stair and nothing else", () => {
    const model = analyze(parse(twoStoreys())).model;
    assert.equal(model.building.storeys, 2);
    assert.deepEqual([...model.building.access.get("baixo/room:hall")!].sort(), ["baixo/room:sala", "cima/room:patamar", "exterior"]);
    assert.ok(model.building.grossArea > model.building.footprint);
  });
});

describe("levels: a void is the dual of an outdoor space", () => {
  it("is not a hole in the plan, and owns the wall beside it", () => {
    const model = analyze(parse(twoStoreys())).model;
    const upper = model.levels[1]!;
    assert.ok(!rulesOf(analyze(parse(twoStoreys())).findings).includes("tiling.gap"));
    const beside = upper.walls.filter((w) => w.neg.kind === "void" || w.pos.kind === "void");
    assert.ok(beside.length > 0, "a stairwell has walls around it");
    // A void has the building over it, so it is not open sky: the wall to the room beside
    // it is an ordinary partition, and the envelope wall still runs past where the void
    // reaches the facade.
    const other = (w: (typeof beside)[number]) => (w.neg.kind === "void" ? w.pos : w.neg);
    for (const w of beside)
      assert.equal(w.kind, other(w).kind === "exterior" ? "exterior" : "partition", JSON.stringify(other(w)));
    assert.ok(beside.some((w) => other(w).kind === "room" && w.kind === "partition"));
  });

  it("keeps its floor out of the interior but inside the envelope", () => {
    const model = analyze(parse(twoStoreys())).model;
    const upper = model.levels[1]!;
    assert.equal(upper.interiorArea, 30.8); // 35 less the 4.2 m2 stairwell, which is not floor
    assert.equal(upper.envelope.area, 35);
    assert.equal(upper.envelope.outline.length, 1);
  });
});
