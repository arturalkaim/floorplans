import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyze, floorplan, parse, renderSvg, schedule } from "../src/index.ts";
import { has, rulesOf } from "./helpers.ts";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));

/** Snapshot helper: compare to test/__snapshots__/<name>; regenerate with UPDATE_SNAPSHOTS=1. */
function matchSnapshot(name: string, actual: string) {
  const dir = new URL("./__snapshots__/", import.meta.url);
  const file = new URL(name, dir);
  if (process.env["UPDATE_SNAPSHOTS"] || !existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  assert.equal(actual, readFileSync(file, "utf8"), `snapshot ${name} differs; run with UPDATE_SNAPSHOTS=1 to accept`);
}

describe("fixture: casa-t3 (the seed house)", () => {
  const plan = parse(load("casa-t3"));
  const { model, findings } = analyze(plan);

  it("tiles the envelope exactly: 13 rooms, no gaps, no overlaps", () => {
    assert.equal(model.rooms.length, 13);
    assert.equal(model.interiorArea, 178.08); // 16.8 × 10.6
    assert.equal(model.envelope.area, 178.08);
    assert.ok(!rulesOf(findings).some((r) => r.startsWith("tiling.")));
  });
  it("resolves every opening onto a wall", () => {
    assert.equal(model.openings.length, plan.openings.length);
    assert.equal(model.openings.filter((o) => o.spec.type === "door").length, 10);
    assert.equal(model.openings.filter((o) => o.spec.type === "cased").length, 3);
    assert.equal(model.openings.filter((o) => o.spec.type === "window").length, 10);
  });
  it("reproduces the seed's centreline areas", () => {
    const by = Object.fromEntries(model.rooms.map((m) => [m.room.id, m.area]));
    assert.equal(by["suite"], 20.24);
    assert.equal(by["sala"], 31.52); // 5.4×4.8 + 2×2.8
    assert.equal(by["cozinha"], 19.8);
    assert.equal(by["distrib"], 17.08);
  });
  it("yields exactly the findings the seed narrative expected", () => {
    assert.deepEqual(rulesOf(findings), ["circulation.share", "wet.no_window", "wet.no_window"]);
    assert.deepEqual(
      findings.filter((f) => f.rule === "wet.no_window").map((f) => f.rooms![0]).sort(),
      ["wc_social", "wc_suite"],
    );
    assert.match(findings.find((f) => f.rule === "circulation.share")!.message, /19 %/);
  });
  it("every room is reachable from the single entrance", () => {
    assert.ok(!rulesOf(findings).includes("reach.unreachable"));
    assert.ok(!rulesOf(findings).includes("entrance.multiple"));
  });
  it("schedule sums match", () => {
    const s = schedule(model);
    assert.equal(s.rooms.length, 13);
    assert.equal(s.interiorArea, 178.08);
    assert.ok(s.interiorClearArea < s.interiorArea);
    assert.deepEqual(s.outdoor.map((o) => [o.id, o.area, o.covered]), [["alpendre", 15.12, true]]);
  });
  it("renders a stable SVG", () => {
    const svg = renderSvg(model, { findings });
    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.includes('aria-label="Floor plan Casa T3, 16.80 by 10.60 metres, 13 rooms"'));
    assert.equal((svg.match(/<g class="door">/g) ?? []).length, 10);
    assert.equal((svg.match(/<g class="window">/g) ?? []).length, 10);
    assert.ok(svg.includes(">ENTRANCE<"));
    matchSnapshot("casa-t3.svg", svg);
  });
});

describe("fixture: apartment-t2 (grid-authored)", () => {
  it("compiles from a track grid, is clean except the interior WC and a pinched hall, and renders", () => {
    const r = floorplan(load("apartment-t2"));
    assert.equal(r.model.rooms.length, 7);
    assert.deepEqual(rulesOf(r.findings), ["room.min_dimension", "wet.no_window"]);
    // the 1.1 m hall track leaves 0.99 m between the wall faces, just under the 1 m minimum
    const hall = r.model.rooms.find((m) => m.room.kind === "hall")!;
    assert.equal(hall.minDimension, 0.99);
    assert.ok(r.svg.includes("Sala"));
  });
});

describe("fixture: cabin (tiny plan, label fallback)", () => {
  it("falls back to a numbered key for rooms too small for their name", () => {
    const r = floorplan(load("cabin"));
    assert.deepEqual(rulesOf(r.findings), []);
    assert.ok(r.svg.includes('class="rk"'), "expected an indexed label");
  });
});

describe("fixture: broken (one of every error)", () => {
  it("reports each geometry and topology error and still renders", () => {
    const r = floorplan(load("broken"));
    const rules = new Set(rulesOf(r.findings));
    for (const expected of ["tiling.gap", "tiling.overlap", "wall.unresolved", "opening.overflow", "opening.collision", "window.not_exterior", "space.no_access", "reach.unreachable", "habitable.no_window", "room.min_dimension"])
      assert.ok(rules.has(expected), `expected ${expected} in ${[...rules].join(", ")}`);
    assert.ok(r.svg.includes('class="finding"'));
  });

  it("reports its one hole once, not once per arrangement-grid cell it spans", () => {
    // the hole is a single 2 x 3 m area, but the grid line at y = 4 (from store/tiny)
    // cuts it into two cells; without flood-fill merging that is two findings
    const r = floorplan(load("broken"));
    const gaps = r.findings.filter((f) => f.rule === "tiling.gap");
    assert.equal(gaps.length, 1, `expected one tiling.gap, got ${gaps.length}: ${gaps.map((f) => f.message).join(" | ")}`);
    assert.equal(gaps[0]!.at![0], 5);
    assert.equal(gaps[0]!.at![1], 3.5);
    assert.match(gaps[0]!.message, /6 m²/);
  });
});

describe("fixture: casa-patio (courtyard)", () => {
  const r = floorplan(load("casa-patio"));

  it("has no findings above info: the courtyard is not a hole", () => {
    assert.deepEqual(rulesOf(r.findings.filter((f) => f.severity !== "info")), []);
  });
  it("lights the Sala through the courtyard and keeps the patio out of the interior", () => {
    const sala = r.model.rooms.find((m) => m.room.id === "sala")!;
    assert.ok(sala.exteriorWindow, "Sala's only window faces the patio");
    assert.deepEqual(r.schedule.outdoor.map((o) => o.name), ["Pátio"]);
    const patio = r.schedule.outdoor[0]!;
    assert.equal(patio.area, 16);
    assert.ok(!r.schedule.rooms.some((x) => x.name === "Pátio"), "the patio is not a room");
    assert.ok(r.schedule.interiorClearArea < 111, "patio area is excluded from the interior");
  });

  it("counts only the street door as a way in", () => {
    // the plan has two exterior doors; the second opens onto the enclosed patio, so it
    // is not a second way out and entrance.multiple has nothing to report
    const exteriorDoors = r.model.openings.filter((o) => o.spec.type === "door" && o.wall.kind === "exterior");
    assert.equal(exteriorDoors.length, 2);
    assert.deepEqual(rulesOf(r.findings), ["circulation.share"]);
    assert.equal(r.schedule.outdoor[0]!.streetConnected, false);
  });

  it("without its street door the house cannot be entered", () => {
    // regression: with the patio indistinguishable from the street, the remaining door
    // onto the courtyard passed entrance.missing and the plan linted clean
    const doc = load("casa-patio");
    doc.openings = doc.openings.filter((o: { entrance?: boolean }) => o.entrance !== true);
    const findings = floorplan(doc).findings;
    assert.ok(has(findings, "entrance.missing"), `got ${rulesOf(findings).join(", ")}`);
  });
});

describe("fixture: quinta (inner garden, pool, detached shack)", () => {
  const r = floorplan(load("quinta"));

  it("has no findings above info", () => {
    assert.deepEqual(rulesOf(r.findings.filter((f) => f.severity !== "info")), []);
  });
  it("carries the garden and terrace as outdoor, the pool as a fixture on it", () => {
    assert.deepEqual(r.schedule.outdoor.map((o) => o.name).sort(), ["Jardim interior", "Terraço"]);
    const pool = r.model.fixtures.find((f) => f.fixture.type === "pool")!;
    assert.equal(pool.fixture.in, "terraco");
    assert.equal(r.schedule.waterArea, pool.area);
    const shack = r.schedule.rooms.find((x) => x.id === "arrecadacao")!;
    assert.equal(shack.kind, "storage");
    // detached from the house, yet still walled and reachable through its own door
    assert.ok(!rulesOf(r.findings).includes("reach.unreachable"));
    assert.ok(!rulesOf(r.findings).includes("tiling.gap"));
  });
  it("places the inner garden from the track grid, not a poly", () => {
    assert.equal(load("quinta").outdoor.jardim.poly, undefined);
    assert.equal(r.model.plan.outdoor.find((o) => o.id === "jardim")!.poly.length, 4);
  });
});

describe("fixture: casa-piscina (fixtures layer)", () => {
  const r = floorplan(load("casa-piscina"));

  it("has no findings above info", () => {
    assert.deepEqual(rulesOf(r.findings.filter((f) => f.severity !== "info")), []);
  });
  it("deducts the interior pool from usable floor and totals it as water", () => {
    const spa = r.schedule.rooms.find((x) => x.id === "spa")!;
    assert.equal(spa.fixtureArea, 23.68);
    assert.equal(spa.usableArea, Math.round((spa.clearArea - spa.fixtureArea) * 1000) / 1000);
    assert.ok(spa.usableArea < spa.clearArea / 2, "water is most of that room");
  });
  it("leaves rooms without fixtures untouched", () => {
    const hall = r.schedule.rooms.find((x) => x.id === "hall")!;
    assert.equal(hall.fixtureArea, 0);
    assert.equal(hall.usableArea, hall.clearArea);
  });
  it("renders each fixture and marks both pools as water", () => {
    assert.equal((r.svg.match(/class="fixture"/g) ?? []).length, 7);
    assert.equal((r.svg.match(/data-type="pool"/g) ?? []).length, 2);
    assert.equal((r.svg.match(/fill="var\(--water\)"/g) ?? []).length, 2);
  });
  it("a pool on the deck is a fixture too, and the deck nets it off", () => {
    const deck = r.schedule.outdoor.find((o) => o.id === "deck")!;
    assert.equal(deck.fixtureArea, 11.04);
    assert.equal(deck.usableArea, Math.round((deck.area - deck.fixtureArea) * 1000) / 1000);
    // waterArea counts pools wherever they stand
    assert.equal(r.schedule.waterArea, 34.72);
  });
});

describe("svg: a glazed door gets a glazing line across its leaf (D1)", () => {
  const base = {
    rooms: { a: { kind: "living", poly: [[0, 0], [4, 0], [4, 4], [0, 4]] } },
    openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 0.9, entrance: true }],
  };
  const doorGroup = (svg: string) => svg.match(/<g class="door">[\s\S]*?<\/g>/)![0];

  it("adds a second <line> to the door's <g> only when glazed", () => {
    const plain = renderSvg(analyze(parse(base)).model);
    const glazed = renderSvg(analyze(parse({ ...base, openings: [{ ...base.openings[0], glazed: true }] })).model);
    assert.equal((doorGroup(plain).match(/<line/g) ?? []).length, 1);
    assert.equal((doorGroup(glazed).match(/<line/g) ?? []).length, 2);
  });
  // casa-t3 has no glazed doors, so its own snapshot test (above, "fixture: casa-t3") is
  // the check that this feature leaves it byte-identical.
});

describe("svg: a sliding door draws two panels instead of a leaf and an arc", () => {
  const base = {
    rooms: { a: { kind: "living", poly: [[0, 0], [4, 0], [4, 4], [0, 4]] } },
    openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 0.9, entrance: true, sliding: true }],
  };
  const doorGroup = (svg: string) => svg.match(/<g class="door">[\s\S]*?<\/g>/)![0];

  it("emits two panel <path> elements and no swing arc", () => {
    const svg = renderSvg(analyze(parse(base)).model);
    const group = doorGroup(svg);
    assert.equal((group.match(/<path/g) ?? []).length, 2, "two panels, one per side of the centreline");
    assert.ok(!group.includes(" A"), "a sliding door has no arc: swing geometry never applies to it");
  });

  it("still gets a glazing tick when glazed, and still tags the entrance", () => {
    const svg = renderSvg(analyze(parse({ ...base, openings: [{ ...base.openings[0], glazed: true }] })).model);
    const group = doorGroup(svg);
    assert.equal((group.match(/<line/g) ?? []).length, 1); // the glazing tick — there is no leaf line to add it to
    assert.match(svg, /ENTRANCE/);
  });
  // casa-t3 has no sliding doors, so its own snapshot test (above, "fixture: casa-t3") is
  // the check that this feature leaves it byte-identical.
});
