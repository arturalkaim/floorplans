// Regression pins for the geometry core rewrite (docs/gaps-design.md §1.3, P5).
//
// Every number the arrangement rewrite could move, recorded before it starts:
// per room the centreline area, the clear area, minDimension, largestRect, clearRect,
// labelAt, fixtureArea, usableArea and the exterior faces; per level the whole wall
// table and the envelope. `test/__snapshots__/geometry-pins.json` is generated from the
// cell-grid implementation and must survive the rewrite unchanged.
//
// It is deliberately separate from `levels-compat`: that harness pins the *output*
// (findings, schedule, drags, text), this one pins the *derived model*, which has far
// more surface and fails earlier and more precisely when the arrangement drifts.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyze, parse } from "../src/index.ts";
import type { LevelModel } from "../src/types.ts";

const FIXTURES = new URL("../fixtures/", import.meta.url);
const PINS = new URL("./__snapshots__/geometry-pins.json", import.meta.url);

const names = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

/** Everything about one storey that the arrangement rewrite could move. */
function pinLevel(lm: LevelModel) {
  return {
    id: lm.level.id,
    rooms: lm.rooms.map((m) => ({
      id: m.room.id,
      corners: m.room.poly.length,
      area: m.area,
      clearArea: m.clearArea,
      minDimension: m.minDimension,
      largestRect: m.largestRect,
      clearRect: m.clearRect,
      labelAt: m.labelAt,
      fixtureArea: m.fixtureArea,
      usableArea: m.usableArea,
      exteriorFaces: [...m.exteriorFaces].sort(),
      exteriorWindow: m.exteriorWindow,
    })),
    walls: lm.walls.map((w) => ({
      id: w.id,
      axis: w.axis,
      c: w.c,
      from: w.from,
      to: w.to,
      kind: w.kind,
      thickness: w.thickness,
      neg: w.neg,
      pos: w.pos,
    })),
    openings: lm.openings.map((o) => ({
      index: o.spec.index,
      wall: o.wall.id,
      from: o.from,
      to: o.to,
      center: o.center,
      hinge: o.hinge,
      swingRoom: o.swingRoom,
    })),
    envelope: lm.envelope,
    interiorArea: lm.interiorArea,
    streetOutdoor: [...lm.streetOutdoor].sort(),
    access: [...lm.access].map(([k, v]) => [k, [...v].sort()] as const).sort((a, b) => a[0].localeCompare(b[0])),
  };
}

const actual = `${JSON.stringify(
  Object.fromEntries(
    names.map((name) => {
      const { model } = analyze(parse(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), "utf8"))));
      return [name, model.levels.map(pinLevel)];
    }),
  ),
  null,
  1,
)}\n`;

/**
 * The seven rooms whose clear area the arrangement corrected, and nothing else.
 *
 * `clearArea` used to come from the closed form `A − Σ len·t/2 + Σ ±t₁t₂/4`, whose
 * corner term looked up the thickness at the **far** end of the outgoing edge. Where a
 * room's edge carries an exterior wall along part of its run and a partition along the
 * rest, that reads the wrong thickness at that corner. The constructed mitred offset
 * (`offsetRing`) has no such choice to make. quinta's `quarto` is the worked example:
 * its clear floor is (0.15,0.15) (3.34,0.15) (3.34,3.4) (3.25,3.4) (3.25,6.54)
 * (0.15,6.54) = 3.19 × 3.25 + 3.10 × 3.14 = 20.1015 m², not 20.115.
 *
 * broken's `store` moves further because the closed form also deducted a wall that runs
 * *through* the room — the kitchen/store partition, which is inside store's own
 * rectangle because the two overlap — rather than along its ring.
 *
 * Every other number in this file, including every wall, every opening, every largest
 * rectangle, every label point and every minDimension, is unchanged.
 */
const CORRECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['"clearArea": 3.384,', '"clearArea": 3.522,'],
  ['"usableArea": 3.384,', '"usableArea": 3.522,'],
  ['"clearArea": 24.014,', '"clearArea": 24.02,'],
  ['"usableArea": 24.014,', '"usableArea": 24.02,'],
  ['"clearArea": 21.294,', '"clearArea": 21.289,'],
  ['"usableArea": 21.294,', '"usableArea": 21.289,'],
  ['"clearArea": 11.565,', '"clearArea": 11.552,'],
  ['"usableArea": 11.565,', '"usableArea": 11.552,'],
  ['"clearArea": 13.428,', '"clearArea": 13.423,'],
  ['"usableArea": 13.428,', '"usableArea": 13.423,'],
  ['"clearArea": 20.115,', '"clearArea": 20.102,'],
  ['"usableArea": 20.115,', '"usableArea": 20.102,'],
  ['"clearArea": 27.314,', '"clearArea": 27.32,'],
  ['"usableArea": 27.314,', '"usableArea": 27.32,'],
];

describe("geometry pins: the derived model the arrangement rewrite must reproduce", () => {
  if (process.env["UPDATE_SNAPSHOTS"] && !existsSync(PINS)) writeFileSync(PINS, actual);

  it("reproduces every pinned room metric, wall, opening and envelope", () => {
    let want = readFileSync(PINS, "utf8");
    for (const [was, now] of CORRECTIONS) {
      const hits = want.split(was).length - 1;
      assert.equal(hits, 1, `the correction ${was} matched ${hits} times, expected exactly one`);
      want = want.replace(was, now);
    }
    assert.equal(
      actual,
      want,
      "the derived model moved; if that is intended, say exactly which numbers moved and why before adding a correction",
    );
  });

  it("covers every fixture", () => {
    assert.ok(names.length >= 9, `expected every fixture pinned, saw ${names.join(", ")}`);
  });
});
