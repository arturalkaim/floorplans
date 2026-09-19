import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyze, floorplan, parse, renderSvg, schedule } from "../src/index.ts";
import { rulesOf } from "./helpers.ts";

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
  it("compiles from a track grid, is clean except the interior WC, and renders", () => {
    const r = floorplan(load("apartment-t2"));
    assert.equal(r.model.rooms.length, 7);
    assert.deepEqual(rulesOf(r.findings), ["wet.no_window"]);
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
