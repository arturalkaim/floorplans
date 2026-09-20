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

describe("geometry pins: the derived model the arrangement rewrite must reproduce", () => {
  if (process.env["UPDATE_SNAPSHOTS"] && !existsSync(PINS)) writeFileSync(PINS, actual);

  it("reproduces every pinned room metric, wall, opening and envelope", () => {
    assert.equal(
      actual,
      readFileSync(PINS, "utf8"),
      "the derived model moved; if that is intended, say exactly which numbers moved and why before regenerating",
    );
  });

  it("covers every fixture", () => {
    assert.ok(names.length >= 9, `expected every fixture pinned, saw ${names.join(", ")}`);
  });
});
