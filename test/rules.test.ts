import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyze, schedule } from "../src/index.ts";
import { parse } from "../src/parse.ts";
import { has, rect, twoRooms } from "./helpers.ts";
import type { Finding } from "../src/types.ts";

const run = (input: unknown, rules = {}) => analyze(parse(input), rules).findings;
const only = (findings: Finding[], rule: string) => findings.filter((f) => f.rule === rule);

describe("rules: a sound two-room plan is clean", () => {
  it("has no findings", () => {
    assert.deepEqual(run(twoRooms()), []);
  });
});

describe("rules: entrance & reachability", () => {
  it("entrance.missing is an error and suppresses reach.unreachable noise", () => {
    const f = run(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8 }] }));
    assert.ok(has(f, "entrance.missing"));
    assert.ok(!has(f, "reach.unreachable"));
  });
  it("entrance.multiple is info", () => {
    const f = run(twoRooms({ openings: [...twoRooms().openings, { type: "door", between: ["exterior", "b"], on: { room: "b", side: "north" }, width: 0.9 }] }));
    assert.equal(only(f, "entrance.multiple")[0]!.severity, "info");
  });
  it("space.no_access for a room with no door, and reach.unreachable for an isolated group", () => {
    const f = run({
      rooms: {
        a: { kind: "living", poly: rect(0, 0, 4, 3) },
        b: { kind: "bedroom", poly: rect(4, 0, 3, 3) },
        c: { kind: "bedroom", poly: rect(7, 0, 3, 3) },
        d: { kind: "storage", poly: rect(0, 3, 10, 2) },
      },
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9 },
        { type: "door", between: ["b", "c"], width: 0.8 },
      ],
    });
    assert.deepEqual(only(f, "space.no_access").map((x) => x.rooms), [["d"]]);
    assert.deepEqual(only(f, "reach.unreachable").map((x) => x.rooms![0]).sort(), ["b", "c"]);
  });
  it("cased openings count as access", () => {
    const f = run(twoRooms({ openings: [twoRooms().openings[0], { type: "cased", between: ["a", "b"], width: 1.2 }] }));
    assert.ok(!has(f, "reach.unreachable"));
  });
});

describe("rules: light", () => {
  it("habitable.no_window names the exterior faces available", () => {
    const f = run(twoRooms({ openings: twoRooms().openings.slice(0, 2) }));
    const w = only(f, "habitable.no_window");
    assert.equal(w.length, 2);
    assert.match(w.find((x) => x.rooms![0] === "b")!.message, /north\/south\/east|exterior wall/);
  });
  it("a window onto a courtyard counts as daylight", () => {
    const plan = (outdoor: Record<string, unknown> | undefined, bedWindow = "exterior") => ({
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: {
        hall: { kind: "hall", poly: rect(0, 0, 3, 1) },
        bed: { kind: "bedroom", poly: rect(0, 1, 1, 1) },
        kit: { kind: "kitchen", poly: rect(2, 1, 1, 1) },
        liv: { kind: "living", poly: rect(0, 2, 3, 1) },
      },
      ...(outdoor ? { outdoor } : {}),
      openings: [
        { type: "door", between: ["exterior", "hall"], on: { room: "hall", side: "north" }, width: 0.9, entrance: true },
        { type: "door", between: ["hall", "bed"], width: 0.8 },
        { type: "door", between: ["hall", "kit"], width: 0.8 },
        { type: "door", between: ["kit", "liv"], width: 0.8 },
        // bed's ONLY window faces the courtyard
        { type: "window", between: [bedWindow, "bed"], on: { room: "bed", side: "east" }, width: 0.6 },
        { type: "window", between: ["exterior", "kit"], on: { room: "kit", side: "east" }, width: 0.6 },
        { type: "window", between: ["exterior", "liv"], on: { room: "liv", side: "south" }, width: 1.2 },
      ],
    });
    const withPatio = run(plan({ patio: { poly: rect(1, 1, 1, 1) } }, "patio"));
    assert.ok(!has(withPatio, "habitable.no_window"), "courtyard window lights the bedroom");
    assert.ok(!has(withPatio, "window.not_exterior"));
    assert.ok(!has(withPatio, "tiling.gap"));
    // without the courtyard declared, that same wall is interior and the void is a hole
    const without = run(plan(undefined));
    assert.ok(has(without, "tiling.gap"));
  });
  it("a glazed exterior door counts as daylight, same as a window (D1)", () => {
    const plan = {
      rooms: { a: { kind: "living", poly: rect(0, 0, 4, 4) } },
      openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 0.9, entrance: true, glazed: true }],
    };
    const { model, findings } = analyze(parse(plan));
    assert.equal(model.rooms[0]!.exteriorWindow, true);
    assert.ok(!has(findings, "habitable.no_window"));
  });
  it("the same door without glazed fails habitable.no_window", () => {
    const plan = {
      rooms: { a: { kind: "living", poly: rect(0, 0, 4, 4) } },
      openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 0.9, entrance: true }],
    };
    const { model, findings } = analyze(parse(plan));
    assert.equal(model.rooms[0]!.exteriorWindow, false);
    assert.ok(has(findings, "habitable.no_window"));
  });
  it("a glazed interior door does not count as daylight", () => {
    const plan = {
      rooms: { a: { kind: "living", poly: rect(0, 0, 4, 4) }, b: { kind: "hall", poly: rect(4, 0, 2, 4) } },
      openings: [
        { type: "door", between: ["exterior", "b"], on: { room: "b", side: "south" }, width: 0.9, entrance: true },
        { type: "door", between: ["a", "b"], width: 0.9, glazed: true },
      ],
    };
    const { model, findings } = analyze(parse(plan));
    const roomA = model.rooms.find((m) => m.room.id === "a")!;
    assert.equal(roomA.exteriorWindow, false);
    assert.ok(has(findings, "habitable.no_window"));
  });
  it("a glazed door onto a courtyard counts as daylight too", () => {
    const plan = {
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: {
        hall: { kind: "hall", poly: rect(0, 0, 3, 1) },
        bed: { kind: "bedroom", poly: rect(0, 1, 1, 1) },
        kit: { kind: "kitchen", poly: rect(2, 1, 1, 1) },
        liv: { kind: "living", poly: rect(0, 2, 3, 1) },
      },
      outdoor: { patio: { poly: rect(1, 1, 1, 1) } },
      openings: [
        { type: "door", between: ["exterior", "hall"], on: { room: "hall", side: "north" }, width: 0.9, entrance: true },
        { type: "door", between: ["hall", "bed"], width: 0.8 },
        { type: "door", between: ["hall", "kit"], width: 0.8 },
        { type: "door", between: ["kit", "liv"], width: 0.8 },
        // bed's ONLY daylight is a glazed door onto the courtyard, not a window
        { type: "door", between: ["patio", "bed"], on: { room: "bed", side: "east" }, width: 0.6, glazed: true },
        { type: "window", between: ["exterior", "kit"], on: { room: "kit", side: "east" }, width: 0.6 },
        { type: "window", between: ["exterior", "liv"], on: { room: "liv", side: "south" }, width: 1.2 },
      ],
    };
    const f = run(plan);
    assert.ok(!has(f, "habitable.no_window"), "glazed door onto courtyard lights the bedroom");
    assert.ok(!has(f, "tiling.gap"));
  });
  it("wet.no_window is a warning and habitable wins over wet", () => {
    const f = run({
      rooms: { a: { kind: "living", poly: rect(0, 0, 4, 3) }, w: { kind: "wc", poly: rect(4, 0, 2, 3) } },
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9 },
        { type: "door", between: ["a", "w"], width: 0.7 },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1 },
      ],
    });
    assert.deepEqual(only(f, "wet.no_window").map((x) => [x.rooms![0], x.severity]), [["w", "warning"]]);
  });
});

describe("rules: adjacency semantics", () => {
  const base = (kb: string, extra: Record<string, unknown> = {}) =>
    run({
      rooms: { a: { kind: "living", poly: rect(0, 0, 4, 3) }, b: { kind: kb, poly: rect(4, 0, 3, 3) }, ...extra },
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9 },
        { type: "door", between: ["a", "b"], width: 0.8 },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1 },
        { type: "window", between: ["exterior", "b"], on: { room: "b", side: "north" }, width: 1 },
      ],
    });
  it("wet.opens_to_kitchen", () => {
    const f = run({
      rooms: { k: { kind: "kitchen", poly: rect(0, 0, 4, 3) }, w: { kind: "wc", poly: rect(4, 0, 2, 3) } },
      openings: [
        { type: "door", between: ["exterior", "k"], on: { room: "k", side: "west" }, width: 0.9 },
        { type: "door", between: ["k", "w"], width: 0.7 },
        { type: "window", between: ["exterior", "k"], on: { room: "k", side: "north" }, width: 1 },
        { type: "window", between: ["exterior", "w"], on: { room: "w", side: "north" }, width: 0.6 },
      ],
    });
    assert.ok(has(f, "wet.opens_to_kitchen"));
  });
  it("privacy.bedroom_off_living is info", () => {
    assert.equal(only(base("bedroom"), "privacy.bedroom_off_living")[0]!.severity, "info");
    assert.ok(!has(base("office"), "privacy.bedroom_off_living"));
  });
  it("privacy.bedroom_through_route is a warning", () => {
    const f = run({
      rooms: { h: { kind: "hall", poly: rect(0, 0, 2, 3) }, b1: { kind: "bedroom", poly: rect(2, 0, 3, 3) }, b2: { kind: "bedroom", poly: rect(5, 0, 3, 3) } },
      openings: [
        { type: "door", between: ["exterior", "h"], on: { room: "h", side: "west" }, width: 0.9 },
        { type: "door", between: ["h", "b1"], width: 0.8 },
        { type: "door", between: ["b1", "b2"], width: 0.8 },
        { type: "window", between: ["exterior", "b1"], on: { room: "b1", side: "north" }, width: 1 },
        { type: "window", between: ["exterior", "b2"], on: { room: "b2", side: "north" }, width: 1 },
      ],
    });
    assert.equal(only(f, "privacy.bedroom_through_route")[0]!.severity, "warning");
  });
});

describe("rules: sizes", () => {
  it("room.min_dimension uses the largest clear rectangle and per-kind thresholds", () => {
    // a is 3.79 x 3.30 clear and passes living's 3 m; b is 1.79 m across and fails bedroom's 2.4 m
    const f = run(twoRooms({ rooms: { a: { kind: "living", poly: rect(0, 0, 4, 3.6) }, b: { kind: "bedroom", poly: rect(4, 0, 2, 3.6) } } }));
    const m = only(f, "room.min_dimension");
    assert.deepEqual(m.map((x) => x.rooms![0]), ["b"]);
    assert.match(m[0]!.message, /b \(bedroom\): 1\.79 m at its narrowest; comfort minimum is 2\.4 m/);
  });
  it("thresholds are configurable", () => {
    const f = run(twoRooms(), { minDimension: { living: 5 } });
    assert.deepEqual(only(f, "room.min_dimension").map((x) => x.rooms![0]), ["a"]);
  });
  it("door.min_width distinguishes entrance from interior doors", () => {
    const f = run(twoRooms({ openings: [{ ...twoRooms().openings[0], width: 0.8 }, { type: "door", between: ["a", "b"], width: 0.6 }, ...twoRooms().openings.slice(2)] }));
    assert.equal(only(f, "door.min_width").length, 2);
  });
});

describe("rules: circulation & swings", () => {
  it("circulation.share fires above the threshold with the share in the message", () => {
    const f = run({
      rooms: { h: { kind: "hall", poly: rect(0, 0, 2, 3) }, a: { kind: "living", poly: rect(2, 0, 4, 3) } },
      openings: [
        { type: "door", between: ["exterior", "h"], on: { room: "h", side: "west" }, width: 0.9 },
        { type: "cased", between: ["h", "a"], width: 1.2 },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1 },
      ],
    });
    const c = only(f, "circulation.share")[0]!;
    assert.equal(c.severity, "info");
    assert.match(c.message, /33 %/);
  });
  it("door.swing_collision when two leaves sweep the same corner", () => {
    const f = run({
      rooms: { a: { kind: "living", poly: rect(0, 0, 4, 4) }, b: { kind: "bedroom", poly: rect(4, 0, 3, 4) }, c: { kind: "bedroom", poly: rect(0, 4, 4, 3) } },
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, position: 1 },
        { type: "door", between: ["a", "b"], width: 0.8, position: { from: "end", distance: 0.5 }, hinge: "end", swingInto: "a" },
        { type: "door", between: ["a", "c"], width: 0.8, position: { from: "end", distance: 0.5 }, hinge: "end", swingInto: "a" },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1 },
        { type: "window", between: ["exterior", "b"], on: { room: "b", side: "north" }, width: 1 },
        { type: "window", between: ["exterior", "c"], on: { room: "c", side: "south" }, width: 1 },
      ],
    });
    assert.equal(only(f, "door.swing_collision").length, 1);
  });
});

describe("rules: fixtures", () => {
  // twoRooms: a = 0..4 x 0..3, b = 4..7 x 0..3; the a|b door hinges at [4, 1.1]
  // and sweeps a 0.8 m quarter disc into b.
  it("door.swing_hits_fixture when a fixture stands in the leaf's path", () => {
    const hit = run(twoRooms({ fixtures: [{ type: "bath", in: "b", at: [4.2, 1.2], size: [0.5, 0.5] }] }));
    assert.equal(only(hit, "door.swing_hits_fixture").length, 1);
    assert.equal(only(hit, "door.swing_hits_fixture")[0]!.severity, "warning");

    const clear = run(twoRooms({ fixtures: [{ type: "bath", in: "b", at: [6.0, 2.4], size: [0.5, 0.4] }] }));
    assert.deepEqual(only(clear, "door.swing_hits_fixture"), []);
  });

  it("the same fixture in the same spot never hits a sliding door: no leaf, no swing", () => {
    // same a|b door and the same fixture as "door.swing_hits_fixture when a fixture stands
    // in the leaf's path" above, `sliding: true` the only difference
    const sliding = run(twoRooms({
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: true },
        { type: "door", between: ["a", "b"], width: 0.8, sliding: true },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 1.2 },
        { type: "window", between: ["exterior", "b"], on: { room: "b", side: "east" }, width: 1.2 },
      ],
      fixtures: [{ type: "bath", in: "b", at: [4.2, 1.2], size: [0.5, 0.5] }],
    }));
    assert.deepEqual(only(sliding, "door.swing_hits_fixture"), []);
  });

  it("fixture.clearance when you cannot walk between two fixtures", () => {
    const tight = run(twoRooms({ fixtures: [
      { type: "counter", in: "a", at: [0.2, 0.2], size: [1.0, 0.6] },
      { type: "island", in: "a", at: [1.5, 0.2], size: [1.0, 0.6] },
    ] }));
    assert.equal(only(tight, "fixture.clearance").length, 1);
    assert.match(only(tight, "fixture.clearance")[0]!.message, /0\.3/);

    const roomy = run(twoRooms({ fixtures: [
      { type: "counter", in: "a", at: [0.2, 0.2], size: [1.0, 0.6] },
      { type: "island", in: "a", at: [2.1, 0.2], size: [1.0, 0.6] },
    ] }));
    assert.deepEqual(only(roomy, "fixture.clearance"), []);
  });

  it("fixtures that touch are one run of units, not a blocked gap", () => {
    const abutting = run(twoRooms({ fixtures: [
      { type: "counter", in: "a", at: [0.2, 0.2], size: [1.0, 0.6] },
      { type: "sink", in: "a", at: [1.2, 0.2], size: [0.6, 0.6] },
    ] }));
    assert.deepEqual(only(abutting, "fixture.clearance"), []);
  });

  it("the threshold is an option", () => {
    const f = run(
      twoRooms({ fixtures: [
        { type: "counter", in: "a", at: [0.2, 0.2], size: [1.0, 0.6] },
        { type: "island", in: "a", at: [2.1, 0.2], size: [1.0, 0.6] },
      ] }),
      { minClearance: 1.2 },
    );
    assert.equal(only(f, "fixture.clearance").length, 1);
  });
});

describe("rules: a pool is a pool wherever it stands", () => {
  const plan = twoRooms({
    outdoor: { deck: { name: "Deck", poly: rect(0, 4, 6, 3) } },
    fixtures: [{ type: "pool", in: "deck", name: "Piscina", at: [1, 4.5], size: [3, 2], depth: 1.6 }],
  });

  it("an outdoor pool is still a fixture, not an anonymous polygon", () => {
    const { model } = analyze(parse(plan));
    assert.equal(model.fixtures.length, 1);
    assert.equal(model.fixtures[0]!.fixture.type, "pool");
    assert.equal(model.fixtures[0]!.area, 6);
  });

  it("a fixture escaping its outdoor space is still an error", () => {
    const f = run({ ...plan, fixtures: [{ type: "pool", in: "deck", at: [1, 4.5], size: [3, 9] }] });
    assert.equal(only(f, "fixture.outside_space").length, 1);
  });

  it("the escaping fixture is deducted only where it is actually on the deck (D3)", () => {
    // 3 x 9 m of pool from y = 4.5, on a deck that ends at y = 7: 3 x 2.5 = 7.5 m² of it
    // stands on the deck and the rest hangs off. The stopgap this replaces deducted
    // nothing at all, rather than reducing the deck by the pool's whole 27 m².
    const escaping = { ...plan, fixtures: [{ type: "pool", in: "deck", at: [1, 4.5], size: [3, 9] }] };
    const { model } = analyze(parse(escaping));
    const deck = schedule(model).outdoor.find((o) => o.id === "deck")!;
    assert.equal(deck.fixtureArea, 7.5);
    assert.equal(deck.usableArea, Math.round((deck.area - 7.5) * 1000) / 1000);
  });

  it("does not report the deck itself as a gap or a room", () => {
    const f = run(plan);
    assert.ok(!has(f, "tiling.gap"));
  });
});

describe("findings ordering", () => {
  it("sorts error → warning → info", () => {
    const f = run(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8 }] }));
    const sev = f.map((x) => x.severity);
    const rank = { error: 0, warning: 1, info: 2 };
    for (let i = 1; i < sev.length; i++) assert.ok(rank[sev[i - 1]!] <= rank[sev[i]!]);
  });
});

describe("rules: entrance.multiple says something true about the plan", () => {
  const twoWaysOut = (entrances: boolean[]) =>
    twoRooms({
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: entrances[0] },
        { type: "door", between: ["exterior", "b"], on: { room: "b", side: "east" }, width: 0.9, entrance: entrances[1] },
        { type: "door", between: ["a", "b"], width: 0.8 },
        { type: "window", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 1.2 },
        { type: "window", between: ["exterior", "b"], on: { room: "b", side: "south" }, width: 1.2 },
      ],
    });

  it("does not ask for a mark that is already there", () => {
    const m = only(run(twoWaysOut([true, false])), "entrance.multiple")[0]!.message;
    assert.match(m, /the main one is A/);
    assert.doesNotMatch(m, /mark the main one/);
  });

  it("asks for one when none is marked", () => {
    const m = only(run(twoWaysOut([false, false])), "entrance.multiple")[0]!.message;
    assert.match(m, /none is marked/);
  });

  it("points out when more than one claims to be the main door", () => {
    const m = only(run(twoWaysOut([true, true])), "entrance.multiple")[0]!.message;
    assert.match(m, /2 of them are marked/);
    assert.match(m, /only one can be the main door/);
  });
});

describe("rules: an entrance is a door to the street", () => {
  /** Four rooms round a 2 x 1 m void at (1, 1); what the void is depends on `outdoor`. */
  const ring = (openings: unknown[], outdoor: Record<string, unknown> = { patio: { name: "Pátio", poly: rect(1, 1, 2, 1) } }) => ({
    walls: { exterior: 0.3, partition: 0.12 },
    rooms: {
      hall: { name: "Hall", kind: "hall", poly: rect(0, 0, 4, 1) },
      west: { name: "West", kind: "storage", poly: rect(0, 1, 1, 1) },
      east: { name: "East", kind: "storage", poly: rect(3, 1, 1, 1) },
      south: { name: "South", kind: "storage", poly: rect(0, 2, 4, 1) },
    },
    outdoor,
    openings,
  });
  const streetDoor = { type: "door", between: ["exterior", "hall"], on: { room: "hall", side: "north" }, width: 0.9 };
  const patioDoor = { type: "door", between: ["hall", "patio"], width: 0.9 };

  it("a door onto an enclosed courtyard does not let anyone in", () => {
    const f = run(ring([patioDoor, { type: "door", between: ["hall", "west"], width: 0.8 }]));
    assert.ok(has(f, "entrance.missing"), `expected entrance.missing in ${f.map((x) => x.rule).join(", ")}`);
  });

  it("the same plan with a street door has its entrance", () => {
    const f = run(ring([streetDoor, patioDoor, { type: "door", between: ["hall", "west"], width: 0.8 }]));
    assert.ok(!has(f, "entrance.missing"));
    assert.ok(!has(f, "entrance.multiple"), "the courtyard door is not a second way out");
  });

  it("a door onto an enclosed courtyard is allowed and silent", () => {
    const f = run(ring([streetDoor, patioDoor]));
    assert.ok(!has(f, "wall.unresolved"));
    assert.ok(!has(f, "entrance.not_street"));
  });

  it("marking it the main entrance is a warning, not a refusal", () => {
    const f = run(ring([streetDoor, { ...patioDoor, entrance: true }, { type: "door", between: ["hall", "west"], width: 0.8 }]));
    const w = only(f, "entrance.not_street");
    assert.equal(w.length, 1);
    assert.equal(w[0]!.severity, "warning");
    assert.match(w[0]!.message, /opens onto Pátio, which the street does not reach/);
    assert.ok(!has(f, "entrance.missing"), "the street door still counts");
  });

  it("a room reached only across the courtyard, from a street door, is reachable", () => {
    const f = run(ring([streetDoor, patioDoor, { type: "door", between: ["patio", "south"], width: 0.9 }]));
    assert.ok(!only(f, "reach.unreachable").some((x) => x.rooms![0] === "south"));
  });

  it("a room reached only across a courtyard nothing else opens onto is not", () => {
    const f = run(ring([streetDoor, { type: "door", between: ["patio", "south"], width: 0.9 }]));
    const unreachable = only(f, "reach.unreachable").map((x) => x.rooms![0]);
    assert.ok(unreachable.includes("south"), `expected south unreachable, got ${unreachable.join(", ")}`);
  });

  it("a deck on the boundary is the street side", () => {
    const deckSide = { type: "door", between: ["south", "deck"], on: { room: "south", side: "south" }, width: 1, entrance: true };
    const plan = ring([deckSide, { type: "door", between: ["hall", "south"], width: 0.9 }], {
      deck: { name: "Deck", poly: rect(0, 3, 4, 1) },
    });
    const { model, findings } = analyze(parse(plan));
    assert.deepEqual([...model.streetOutdoor], ["deck"]);
    assert.ok(!has(findings, "entrance.missing"), "a door onto a deck that touches the street is a way in");
    assert.ok(!has(findings, "entrance.not_street"));
    assert.ok(!only(findings, "reach.unreachable").some((x) => x.rooms![0] === "hall"));
  });

  it("the schedule says which outdoor spaces the street reaches", () => {
    const { model } = analyze(parse(ring([streetDoor])));
    assert.deepEqual([...model.streetOutdoor], []);
    assert.equal(schedule(model).outdoor[0]!.streetConnected, false);
  });

  it("a door onto an outdoor space joins it to the access graph", () => {
    const { model } = analyze(parse(ring([streetDoor, patioDoor])));
    assert.deepEqual([...model.access.get("outdoor:patio")!], ["room:hall"]);
    assert.ok(model.access.get("room:hall")!.has("outdoor:patio"));
  });
});

/**
 * B13: a door between two bedrooms is not a through route.
 *
 * The rule used to fire on any bedroom-bedroom door, so a jack-and-jill pair — two
 * bedrooms that each open off the hall and also connect to one another — was told "one
 * bedroom is a route to the other", which is false: close the connecting door and both
 * are still reached from the hall. The test is now the one the name always meant: is one
 * of them an articulation point, on *every* path from the street to the other?
 */
describe("privacy.bedroom_through_route is a through-route test (B13)", () => {
  const plan = (openings: unknown[]) => ({
    walls: { exterior: 0.3, partition: 0.12 },
    rooms: {
      hall: { name: "Hall", kind: "hall", rect: [0, 0, 3, 6] },
      q1: { name: "Quarto 1", kind: "bedroom", rect: [3, 0, 4, 3] },
      q2: { name: "Quarto 2", kind: "bedroom", rect: [3, 3, 4, 3] },
    },
    openings: [
      { type: "door", between: ["exterior", "hall"], on: { room: "hall", side: "west" }, width: 1, entrance: true },
      { type: "window", between: ["exterior", "hall"], on: { room: "hall", side: "north" }, width: 1.2 },
      { type: "window", between: ["exterior", "q1"], on: { room: "q1", side: "east" }, width: 1.2 },
      { type: "window", between: ["exterior", "q2"], on: { room: "q2", side: "east" }, width: 1.2 },
      ...openings,
    ],
  });
  const hits = (openings: unknown[]) => only(run(plan(openings)), "privacy.bedroom_through_route");
  const jack = { type: "door", between: ["q1", "q2"], width: 0.8 };
  const off = (room: string) => ({ type: "door", between: ["hall", room], width: 0.8 });

  it("stays quiet on a jack-and-jill pair: both bedrooms also open off the hall", () => {
    const f = hits([off("q1"), off("q2"), jack]);
    assert.deepEqual(f.map((x) => x.message), []);
  });

  it("counts a cased opening as a way in, because the access graph does", () => {
    const f = hits([off("q1"), { type: "cased", between: ["hall", "q2"], width: 1 }, jack]);
    assert.deepEqual(f.map((x) => x.message), []);
  });

  it("reports the bedroom that really is the only way in, and says which it is", () => {
    const f = hits([off("q1"), jack]);
    assert.equal(f.length, 1);
    assert.equal(f[0]!.severity, "warning");
    assert.equal(f[0]!.message, "the only way into Quarto 2 is through Quarto 1; a bedroom is a room to be in, not a corridor");
    // the route first, the room behind it second — the order a fix is written in
    assert.deepEqual(f[0]!.rooms, ["q1", "q2"]);
  });

  it("reports it whichever side of the door the through room is on", () => {
    const f = hits([off("q2"), jack]);
    assert.equal(f.length, 1);
    assert.equal(f[0]!.message, "the only way into Quarto 1 is through Quarto 2; a bedroom is a room to be in, not a corridor");
    assert.deepEqual(f[0]!.rooms, ["q2", "q1"]);
  });

  it("stays quiet when neither bedroom can be reached at all: reach.unreachable says that", () => {
    const f = run(plan([jack]));
    assert.deepEqual(only(f, "privacy.bedroom_through_route"), []);
    assert.equal(only(f, "reach.unreachable").length, 2);
  });

  it("walks a chain of three bedrooms and reports both links", () => {
    const ids = ["hall", "q1", "q2", "q3"];
    const three = {
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: {
        hall: { name: "Hall", kind: "hall", rect: [0, 0, 3, 3] },
        q1: { name: "Quarto 1", kind: "bedroom", rect: [3, 0, 3, 3] },
        q2: { name: "Quarto 2", kind: "bedroom", rect: [6, 0, 3, 3] },
        q3: { name: "Quarto 3", kind: "bedroom", rect: [9, 0, 3, 3] },
      },
      openings: [
        { type: "door", between: ["exterior", "hall"], on: { room: "hall", side: "west" }, width: 1, entrance: true },
        { type: "door", between: ["hall", "q1"], width: 0.8 },
        { type: "door", between: ["q1", "q2"], width: 0.8 },
        { type: "door", between: ["q2", "q3"], width: 0.8 },
        ...ids.map((r) => ({ type: "window", between: ["exterior", r], on: { room: r, side: "north" }, width: 1.2 })),
      ],
    };
    const f = only(run(three), "privacy.bedroom_through_route");
    assert.deepEqual(f.map((x) => x.rooms), [["q1", "q2"], ["q2", "q3"]]);
  });
});
