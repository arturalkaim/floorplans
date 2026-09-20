import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse, PlanError } from "../src/parse.ts";
import { shoelace } from "../src/geometry.ts";
import { rect, twoRooms } from "./helpers.ts";

const issuesOf = (input: unknown): string[] => {
  try {
    parse(input);
    return [];
  } catch (e) {
    if (e instanceof PlanError) return e.issues.map((i) => i.path);
    throw e;
  }
};

/** The full issue list (path + message), for tests that check message text. */
const issueListOf = (input: unknown): { path: string; message: string }[] => {
  try {
    parse(input);
    return [];
  } catch (e) {
    if (e instanceof PlanError) return e.issues;
    throw e;
  }
};

const loadFixture = (name: string): any => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));

describe("parse: basics", () => {
  it("parses a minimal plan and applies defaults", () => {
    const plan = parse(twoRooms());
    assert.equal(plan.walls.exterior, 0.3);
    assert.equal(plan.rooms.length, 2);
    const a = plan.rooms.find((r) => r.id === "a")!;
    assert.equal(a.habitable, true); // living
    assert.equal(a.wet, false);
    assert.equal(plan.openings[0]!.position, "center");
    assert.equal(plan.openings[1]!.swingInto, "b"); // defaults to the last-named room
    assert.equal(plan.openings[1]!.hinge, "start");
  });
  it("accepts a JSON string", () => {
    const plan = parse(JSON.stringify(twoRooms()));
    assert.equal(plan.rooms.length, 2);
  });
  it("rejects invalid JSON text", () => {
    assert.throws(() => parse("{ nope"), PlanError);
  });
  it("kind drives habitable / wet / circulation, flags override", () => {
    const plan = parse({
      rooms: {
        h: { kind: "hall", poly: rect(0, 0, 2, 2) },
        w: { kind: "wc", poly: rect(2, 0, 2, 2), wet: false },
        s: { kind: "storage", poly: rect(4, 0, 2, 2), habitable: true },
      },
    });
    const by = Object.fromEntries(plan.rooms.map((r) => [r.id, r]));
    assert.equal(by["h"]!.circulation, true);
    assert.equal(by["w"]!.wet, false);
    assert.equal(by["s"]!.habitable, true);
  });
});

describe("parse: schema errors carry paths", () => {
  it("reports several problems at once", () => {
    const paths = issuesOf({
      walls: { exterior: -1 },
      rooms: { "Bad Id": { poly: rect(0, 0, 1, 1) }, ok: { poly: [[0, 0], [4, 0], [4, 3], [2, 3], [2, -1], [0, -1]] } },
      openings: [{ type: "door", between: ["ok", "nope"], width: 0.8 }],
    });
    assert.ok(paths.includes("walls.exterior"));
    assert.ok(paths.includes("rooms.Bad Id"));
    assert.ok(paths.includes("rooms.ok.poly"));
    assert.ok(paths.includes("openings[0].between[1]"));
  });
  it("rejects bad kinds and bad opening fields", () => {
    const paths = issuesOf({
      rooms: { exterior: { poly: rect(0, 0, 1, 1) }, a: { kind: "ballroom", poly: rect(1, 0, 1, 1) } },
      openings: [
        { type: "window", between: ["exterior", "a"], width: 1, hinge: "start" },
        { type: "door", between: ["a", "a"], width: 1 },
        { type: "door", between: ["exterior", "a"], width: 1, swingInto: "b" },
        { type: "door", between: ["exterior", "a"], width: 0 },
        { type: "door", between: ["exterior", "a"], width: 1, position: { from: "middle", distance: 1 } },
        { type: "door", between: ["exterior", "a"], width: 1, on: { room: "b" } },
        { type: "arch", between: ["exterior", "a"], width: 1 },
      ],
    });
    // "exterior" is no longer a reserved room id: Owner is a tagged union, so a room
    // called "exterior" cannot be confused with the street
    assert.ok(!paths.includes("rooms.exterior"), paths.join(", "));
    for (const p of [
      "rooms.a.kind",
      "openings[0].hinge",
      "openings[1].between",
      "openings[2].swingInto",
      "openings[3].width",
      "openings[4].position",
      "openings[5].on.room",
      "openings[6].type",
    ])
      assert.ok(paths.includes(p), `expected issue at ${p}, got ${paths.join(", ")}`);
  });
  it("requires geometry for every room", () => {
    assert.deepEqual(issuesOf({ rooms: { a: { name: "A" } } }), ["rooms.a"]);
  });
  it("reports a bad poly once, not also as missing geometry", () => {
    // a bow tie: the one shape a ring may not be, now that any simple polygon is legal
    const bowTie = [[0, 0], [4, 0], [4, 3], [2, 3], [2, -1], [0, -1]];
    assert.deepEqual(issuesOf({ rooms: { a: { poly: bowTie } } }), ["rooms.a.poly"]);
    assert.deepEqual(
      issuesOf({ rooms: { a: { poly: rect(0, 0, 2, 2) } }, outdoor: { p: { poly: bowTie } } }),
      ["outdoor.p.poly"],
    );
  });

  it("accepts an angled room, which it used to refuse outright", () => {
    // `rooms.sala.poly: edge [6,4]→[3,6] is not axis-aligned` was the whole gap
    const plan = parse({ rooms: { sala: { poly: [[0, 0], [6, 0], [6, 4], [3, 6], [0, 4]] } } });
    assert.equal(plan.rooms[0]!.poly.length, 5);
    assert.deepEqual(plan.rooms[0]!.arcs, [undefined, undefined, undefined, undefined, undefined]);
  });

  it("accepts a triangle", () => {
    assert.equal(parse({ rooms: { a: { poly: [[0, 0], [4, 0], [0, 3]] } } }).rooms[0]!.poly.length, 3);
  });
  it("accepts a numeric position as metres from start", () => {
    const plan = parse(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8, position: 1.25 }] }));
    assert.deepEqual(plan.openings[0]!.position, { from: "start", distance: 1.25 });
  });
});

describe("parse: rect shorthand", () => {
  it("expands a room rect to the same polygon the four points would give", () => {
    const viaRect = parse({ rooms: { a: { kind: "living", rect: [0, 0, 4.6, 4.4] } } });
    const viaPoly = parse({ rooms: { a: { kind: "living", poly: rect(0, 0, 4.6, 4.4) } } });
    assert.deepEqual(viaRect.rooms[0]!.poly, viaPoly.rooms[0]!.poly);
    // `authored` is the one difference, and it is the *point*: a finding about this room's
    // geometry has to say `rooms.a.rect` for one document and `rooms.a.poly` for the other
    assert.deepEqual(viaRect.rooms[0]!.authored, ["kind", "rect"]);
    assert.deepEqual(viaPoly.rooms[0]!.authored, ["kind", "poly"]);
    const forget = (p: unknown) => JSON.parse(JSON.stringify(p, (k, v: unknown) => (k === "authored" ? undefined : v)));
    assert.deepEqual(forget(viaRect), forget(viaPoly), "otherwise the Plan is identical: rect is authoring sugar only");
  });

  it("expands an outdoor rect too", () => {
    const plan = parse(twoRooms({ outdoor: { deck: { name: "Deck", rect: [0, 4, 6, 3] } } }));
    assert.deepEqual(plan.outdoor[0]!.poly, rect(0, 4, 6, 3));
  });

  it("snaps to the millimetre like every other coordinate", () => {
    const plan = parse({ rooms: { a: { rect: [0.00049, 0, 4.0004, 3] } } });
    assert.deepEqual(plan.rooms[0]!.poly, [[0, 0], [4.001, 0], [4.001, 3], [0, 3]]);
  });

  it("rejects a rect that is not four numbers, or has a non-positive side", () => {
    assert.deepEqual(issuesOf({ rooms: { a: { rect: [0, 0, 4] } } }), ["rooms.a.rect"]);
    assert.deepEqual(issuesOf({ rooms: { a: { rect: "4x3" } } }), ["rooms.a.rect"]);
    assert.deepEqual(issuesOf({ rooms: { a: { rect: [0, 0, 4, 0] } } }), ["rooms.a.rect"]);
    assert.deepEqual(issuesOf({ rooms: { a: { rect: [0, 0, -4, 3] } } }), ["rooms.a.rect"]);
    assert.match(
      issueListOf({ rooms: { a: { rect: [0, 0, 4, 0] } } })[0]!.message,
      /width and height must both be > 0/,
    );
  });

  it("rejects poly and rect together, the way a fixture rejects poly and at/size", () => {
    const issues = issueListOf({ rooms: { a: { poly: rect(0, 0, 2, 2), rect: [0, 0, 2, 2] } } });
    assert.deepEqual(issues.map((i) => i.path), ["rooms.a"]);
    assert.equal(issues[0]!.message, "has both a poly and a rect; use one");
    assert.deepEqual(
      issueListOf({
        rooms: { a: { rect: [0, 0, 2, 2] } },
        outdoor: { p: { poly: rect(0, 4, 2, 2), rect: [0, 4, 2, 2] } },
      }).map((i) => i.message),
      ["has both a poly and a rect; use one"],
    );
  });

  it("names rect when a rect-authored space is also placed in the grid", () => {
    const issues = issueListOf({
      layout: { cols: [3], rows: [3], areas: ["a"] },
      rooms: { a: { kind: "hall", rect: [0, 0, 3, 3] } },
    });
    assert.deepEqual(issues, [{ path: "rooms.a", message: "has both a rect and cells in layout.areas; use one", kind: "conflict" }]);
  });

  it("offers rect in the has-no-geometry message and accepts it as a known key", () => {
    assert.match(issueListOf({ rooms: { a: { name: "A" } } })[0]!.message, /give a poly or a rect/);
    assert.deepEqual(issuesOf({ rooms: { a: { rect: [0, 0, 2, 2] }, b: { rekt: [2, 0, 2, 2] } } }), [
      "rooms.b.rekt",
      "rooms.b",
    ]);
  });

  it("reports a bad rect once, not also as missing geometry", () => {
    assert.deepEqual(issuesOf({ rooms: { a: { rect: [0, 0, 0, 2] } } }), ["rooms.a.rect"]);
  });
});

describe("parse: fixtures", () => {
  const withFix = (fixtures: unknown[]) => twoRooms({ fixtures });

  it("accepts poly and at/size geometry and defaults the name from the type", () => {
    const plan = parse(withFix([
      { type: "pool", in: "a", poly: rect(1, 1, 2, 1), depth: 1.4 },
      { type: "bath", in: "b", at: [4.2, 0.3], size: [1.7, 0.75], name: "Banheira" },
    ]));
    assert.equal(plan.fixtures.length, 2);
    const [pool, bath] = plan.fixtures;
    assert.equal(pool!.name, "Pool");
    assert.equal(pool!.depth, 1.4);
    assert.deepEqual(pool!.poly, rect(1, 1, 2, 1));
    assert.equal(bath!.name, "Banheira");
    assert.deepEqual(bath!.poly, rect(4.2, 0.3, 1.7, 0.75));
    assert.equal(bath!.depth, undefined);
  });

  it("carries the authored index for error messages", () => {
    const plan = parse(withFix([{ type: "sink", in: "a", at: [1, 1], size: [0.6, 0.5] }]));
    assert.equal(plan.fixtures[0]!.index, 0);
  });

  it("rejects bad type, unknown room, missing and doubled geometry, bad depth", () => {
    const paths = issuesOf(withFix([
      { type: "jacuzzi", in: "a", at: [1, 1], size: [1, 1] },
      { type: "bath", in: "nope", at: [1, 1], size: [1, 1] },
      { type: "bath", in: "a" },
      { type: "bath", in: "a", poly: rect(1, 1, 1, 1), at: [1, 1], size: [1, 1] },
      { type: "pool", in: "a", at: [1, 1], size: [1, 0], depth: -1 },
    ]));
    for (const expected of [
      "fixtures[0].type",
      "fixtures[1].in",
      "fixtures[2]",
      "fixtures[3]",
      "fixtures[4].size",
      "fixtures[4].depth",
    ])
      assert.ok(paths.includes(expected), `expected issue at ${expected}, got ${paths.join(", ")}`);
  });

  it("rejects a self-intersecting fixture poly once", () => {
    assert.deepEqual(
      issuesOf(withFix([{ type: "pool", in: "a", poly: [[0, 0], [4, 0], [4, 3], [2, 3], [2, -1], [0, -1]] }])),
      ["fixtures[0].poly"],
    );
  });

  it("takes an angled fixture", () => {
    const plan = parse(twoRooms({ fixtures: [{ type: "counter", in: "a", poly: [[0.5, 0.5], [2, 0.5], [2.4, 1.5], [0.5, 1.5]] }] }));
    assert.equal(plan.fixtures[0]!.poly.length, 4);
  });

  it("accepts an outdoor space as the host", () => {
    const plan = parse(twoRooms({
      outdoor: { deck: { name: "Deck", poly: rect(0, 4, 6, 3) } },
      fixtures: [{ type: "pool", in: "deck", at: [1, 4.5], size: [3, 2], depth: 1.6 }],
    }));
    assert.equal(plan.fixtures[0]!.in, "deck");
  });

  it("rejects a host that is neither a room nor an outdoor space", () => {
    assert.deepEqual(
      issuesOf(twoRooms({ fixtures: [{ type: "pool", in: "nowhere", at: [1, 1], size: [1, 1] }] })),
      ["fixtures[0].in"],
    );
  });

  it("defaults to no fixtures", () => {
    assert.deepEqual(parse(twoRooms()).fixtures, []);
  });
});

describe("parse: unknown keys are reported (A4)", () => {
  // A copy of casa-t3 with the five misspellings the review found, plus one private
  // "_note" that must still pass. Regression guard for "a door with `positon`,
  // `swing_into`, `hinges` ... lints byte-identically to the original".
  const misspelledCasaT3 = () => {
    const doc = loadFixture("casa-t3");
    doc._note = "internal draft, ignore for review";
    const door = doc.openings[0];
    door.positon = door.position;
    delete door.position;
    door.swing_into = door.swingInto;
    delete door.swingInto;
    door.hinges = door.hinge;
    delete door.hinge;
    const closet = doc.rooms.closet;
    closet.kinds = closet.kind;
    delete closet.kind;
    closet.habitble = true;
    return doc;
  };

  it("flags all five misspellings and leaves the private _note alone", () => {
    const paths = issuesOf(misspelledCasaT3());
    for (const expected of ["openings[0].positon", "openings[0].swing_into", "openings[0].hinges", "rooms.closet.kinds", "rooms.closet.habitble"])
      assert.ok(paths.includes(expected), `expected issue at ${expected}, got ${paths.join(", ")}`);
    assert.ok(!paths.some((p) => p.includes("_note")), "a private _note must not be flagged");
  });

  it("still lints clean for the unmodified fixture (baseline for the regression above)", () => {
    assert.deepEqual(issuesOf(loadFixture("casa-t3")), []);
  });

  it('suggests the nearest known key ("did you mean") for a close misspelling', () => {
    const issues = issueListOf(misspelledCasaT3());
    const by = Object.fromEntries(issues.map((i) => [i.path, i.message]));
    assert.equal(by["openings[0].positon"], 'unknown field "positon"; did you mean "position"?');
    assert.equal(by["openings[0].swing_into"], 'unknown field "swing_into"; did you mean "swingInto"?');
    assert.equal(by["openings[0].hinges"], 'unknown field "hinges"; did you mean "hinge"?');
    assert.equal(by["rooms.closet.kinds"], 'unknown field "kinds"; did you mean "kind"?');
    assert.equal(by["rooms.closet.habitble"], 'unknown field "habitble"; did you mean "habitable"?');
  });

  it("lists every known key when nothing is close enough to suggest", () => {
    const issues = issueListOf(twoRooms({ rooms: { ...twoRooms().rooms, a: { ...twoRooms().rooms["a"], totallyUnrelatedKey: 1 } } }));
    const issue = issues.find((i) => i.path === "rooms.a.totallyUnrelatedKey");
    assert.ok(issue, `expected an issue at rooms.a.totallyUnrelatedKey, got ${issues.map((i) => i.path).join(", ")}`);
    assert.match(issue!.message, /^unknown field "totallyUnrelatedKey"; expected one of /);
    assert.match(issue!.message, /\bkind\b/);
    assert.match(issue!.message, /\bpoly\b/);
  });

  it("allows keys prefixed with _ or x- anywhere, without complaint", () => {
    const plan = parse(twoRooms({ _internal: true, "x-authoring-tool": "sketch" }));
    assert.equal(plan.rooms.length, 2);
  });

  it("rejects an unknown key on every object it reads", () => {
    const base = twoRooms();
    const cases: Array<[string, unknown, string]> = [
      ["top level", { ...base, bogus: 1 }, "bogus"],
      ["walls", { ...base, walls: { ...base.walls, bogus: 1 } }, "walls.bogus"],
      [
        "layout",
        { walls: base.walls, layout: { cols: [1], rows: [1], areas: ["a"], bogus: 1 }, rooms: { a: { kind: "hall" } } },
        "layout.bogus",
      ],
      ["room", { ...base, rooms: { ...base.rooms, a: { ...(base.rooms as any)["a"], bogus: 1 } } }, "rooms.a.bogus"],
      ["outdoor space", { ...base, outdoor: { p: { poly: rect(0, 4, 2, 2), bogus: 1 } } }, "outdoor.p.bogus"],
      ["opening", { ...base, openings: [{ ...(base.openings as any)[0], bogus: 1 }] }, "openings[0].bogus"],
      [
        "opening.on",
        { ...base, openings: [{ ...(base.openings as any)[0], on: { ...(base.openings as any)[0].on, bogus: 1 } }] },
        "openings[0].on.bogus",
      ],
      [
        "opening.position",
        { ...base, openings: [{ type: "door", between: ["a", "b"], width: 0.8, position: { from: "start", distance: 1, bogus: 1 } }] },
        "openings[0].position.bogus",
      ],
      ["fixture", { ...base, fixtures: [{ type: "sink", in: "a", at: [1, 1], size: [0.5, 0.5], bogus: 1 }] }, "fixtures[0].bogus"],
    ];
    for (const [label, doc, expectedPath] of cases) {
      const paths = issuesOf(doc);
      assert.ok(paths.includes(expectedPath), `${label}: expected ${expectedPath}, got ${paths.join(", ")}`);
    }
  });

  it("does not flag an unknown key twice as both unknown and missing geometry", () => {
    // sanity: an unknown key on a room must not suppress or duplicate the normal
    // "has no geometry" issue when the room also lacks a poly
    const paths = issuesOf({ rooms: { a: { bogus: 1 } } });
    assert.ok(paths.includes("rooms.a.bogus"));
    assert.ok(paths.includes("rooms.a"));
  });
});

describe("parse: an opening may name a declared outdoor space", () => {
  it("accepts an outdoor id in `between`", () => {
    const plan = parse(
      twoRooms({
        outdoor: { deck: { poly: rect(0, 3.4, 4, 2) } },
        openings: [...twoRooms().openings, { type: "door", between: ["a", "deck"], width: 0.9 }],
      }),
    );
    assert.deepEqual(plan.openings.at(-1)!.between, ["a", "deck"]);
  });

  it("accepts it on either side, and swings the leaf indoors by default", () => {
    const plan = parse(
      twoRooms({
        outdoor: { deck: { poly: rect(0, 3.4, 4, 2) } },
        openings: [...twoRooms().openings, { type: "door", between: ["deck", "a"], width: 0.9 }],
      }),
    );
    const door = plan.openings.at(-1)!;
    assert.deepEqual(door.between, ["deck", "a"]);
    assert.equal(door.swingInto, "a");
  });

  it("lets `on.room` name the outdoor space", () => {
    const plan = parse(
      twoRooms({
        outdoor: { deck: { poly: rect(0, 3.4, 4, 2) } },
        openings: [
          ...twoRooms().openings,
          { type: "door", between: ["a", "deck"], on: { room: "deck", side: "north" }, width: 0.9 },
        ],
      }),
    );
    assert.equal(plan.openings.at(-1)!.on!.room, "deck");
  });

  it("says the id is unknown only when it really is", () => {
    const issues = issueListOf(twoRooms({ openings: [{ type: "door", between: ["a", "nope"], width: 0.9 }] }));
    const issue = issues.find((i) => i.path === "openings[0].between[1]");
    assert.ok(issue);
    assert.equal(issue!.message, 'unknown space "nope"; expected a room id, an outdoor space id, or "exterior"');
  });

  it("refuses an opening with a room on neither side", () => {
    for (const between of [
      ["deck", "exterior"],
      ["deck", "patio"],
    ]) {
      const issues = issueListOf(
        twoRooms({
          outdoor: { deck: { poly: rect(0, 3.4, 4, 2) }, patio: { poly: rect(0, 5.4, 4, 2) } },
          openings: [{ type: "door", between, width: 0.9 }],
        }),
      );
      const issue = issues.find((i) => i.path === "openings[0].between");
      assert.ok(issue, `expected an issue for ${between.join("/")}`);
      assert.match(issue!.message, /needs a room on at least one side/);
    }
  });

  it("accepts a room whose id is \"exterior\": the street is a different owner kind", () => {
    const plan = parse({
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: { exterior: { name: "Odd", kind: "living", poly: rect(0, 0, 4, 3) } },
      openings: [],
    });
    assert.deepEqual(plan.rooms.map((r) => r.id), ["exterior"]);
  });
});

describe("parse: layout grid compiles to polygons", () => {
  const grid = {
    walls: { exterior: 0.3, partition: 0.12 },
    layout: {
      cols: [3, 1, 3],
      rows: [3, 2],
      areas: ["bed hall bath", "living living living"],
    },
    rooms: {
      bed: { kind: "bedroom" },
      hall: { kind: "hall" },
      bath: { kind: "bath" },
      living: { kind: "living" },
    },
  };
  it("produces one rectilinear polygon per token", () => {
    const plan = parse(grid);
    const by = Object.fromEntries(plan.rooms.map((r) => [r.id, r]));
    assert.deepEqual(by["bed"]!.poly, [[0, 0], [3, 0], [3, 3], [0, 3]]);
    assert.deepEqual(by["hall"]!.poly, [[3, 0], [4, 0], [4, 3], [3, 3]]);
    assert.equal(Math.abs(shoelace(by["living"]!.poly)), 14);
  });
  it("accepts a multi-line string for areas and '.' for void", () => {
    const plan = parse({ ...grid, layout: { ...grid.layout, areas: "bed hall bath\nliving living ." } });
    assert.equal(Math.abs(shoelace(plan.rooms.find((r) => r.id === "living")!.poly)), 8);
  });
  it("builds L-shaped rooms from cells", () => {
    const plan = parse({
      layout: { cols: [2, 2], rows: [2, 2], areas: ["l l", "l x"] },
      rooms: { l: { kind: "living" }, x: { kind: "wc" } },
    });
    assert.equal(plan.rooms.find((r) => r.id === "l")!.poly.length, 6);
  });
  it("lets outdoor spaces sit on the grid too", () => {
    const plan = parse({
      layout: { cols: [3, 3], rows: [3], areas: ["room porch"] },
      rooms: { room: { kind: "living" } },
      outdoor: { porch: { covered: true } },
    });
    assert.equal(plan.outdoor.length, 1);
    assert.deepEqual(plan.outdoor[0]!.poly, [[3, 0], [6, 0], [6, 3], [3, 3]]);
  });
  it("rejects ragged rows, unknown tokens, split rooms, and double geometry", () => {
    assert.ok(issuesOf({ ...grid, layout: { ...grid.layout, areas: ["bed hall", "living living living"] } }).includes("layout.areas[0]"));
    assert.ok(issuesOf({ ...grid, layout: { ...grid.layout, areas: ["bed hall attic", "living living living"] } }).includes("layout.areas[0]"));
    assert.ok(issuesOf({ ...grid, layout: { ...grid.layout, areas: ["bed hall bed", "living living living"] } }).includes("rooms.bed"));
    assert.ok(issuesOf({ ...grid, rooms: { ...grid.rooms, bed: { kind: "bedroom", poly: rect(0, 0, 3, 3) } } }).includes("rooms.bed"));
    assert.ok(issuesOf({ ...grid, layout: { ...grid.layout, rows: [3] } }).includes("layout.areas"));
  });
});

describe("parse: opening `at` (absolute placement)", () => {
  it("accepts [x, y] and snaps it like any other coordinate", () => {
    const plan = parse(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8, at: [4.00049, 1] }] }));
    const door = plan.openings.find((o) => o.between.includes("b") && o.type === "door")!;
    assert.deepEqual(door.at, [4, 1]);
    assert.equal(door.on, undefined);
    assert.equal(door.position, "center");
  });

  it("rejects at together with on, the way a room rejects poly and rect together", () => {
    const issues = issueListOf(
      twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8, at: [4, 1], on: { room: "a", side: "east" } }] }),
    );
    assert.deepEqual(issues.map((i) => i.path), ["openings[0]"]);
    assert.equal(issues[0]!.message, 'has both "at" and "on"/"position"; use one');
  });

  it("rejects at together with position", () => {
    const issues = issueListOf(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8, at: [4, 1], position: 1 }] }));
    assert.deepEqual(issues.map((i) => i.path), ["openings[0]"]);
    assert.equal(issues[0]!.message, 'has both "at" and "on"/"position"; use one');
  });

  it("rejects a malformed at", () => {
    assert.deepEqual(issuesOf(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8, at: [4] }] })), ["openings[0].at"]);
    assert.deepEqual(issuesOf(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8, at: "4,1" }] })), ["openings[0].at"]);
  });

  it("is a known key (not flagged as unknown)", () => {
    assert.deepEqual(issuesOf(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8, at: [4, 1] }] })), []);
  });
});

describe("parse: opening `glazed`", () => {
  it("defaults to false and is a known key", () => {
    const plan = parse(twoRooms());
    assert.equal(plan.openings[0]!.glazed, false);
  });

  it("accepts true on a door", () => {
    const plan = parse(twoRooms({ openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, glazed: true }] }));
    assert.equal(plan.openings[0]!.glazed, true);
  });

  it("rejects a non-boolean value", () => {
    assert.deepEqual(
      issuesOf(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8, glazed: "yes" }] })),
      ["openings[0].glazed"],
    );
  });

  it("is only valid on doors", () => {
    const issues = issueListOf(twoRooms({ openings: [{ type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1, glazed: true }] }));
    assert.deepEqual(issues, [{ path: "openings[0].glazed", message: "only valid on doors", kind: "conflict" }]);
  });
});
