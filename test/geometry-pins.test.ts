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
/** the model as the cell grid derived it, recorded before the rewrite began */
const PINS = new URL("./__snapshots__/geometry-pins.json", import.meta.url);
/** the same record for the fixtures the rewrite itself added, which have no "before" */
const SINCE = new URL("./__snapshots__/geometry-pins-arcs.json", import.meta.url);

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

const pinsFor = (only: ReadonlySet<string>) =>
  `${JSON.stringify(
    Object.fromEntries(
      names
        .filter((n) => only.has(n))
        .map((name) => {
          const { model } = analyze(parse(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), "utf8"))));
          return [name, model.levels.map(pinLevel)];
        }),
    ),
    null,
    1,
  )}\n`;

const before = new Set(Object.keys(JSON.parse(readFileSync(PINS, "utf8")) as Record<string, unknown>));
const since = names.filter((n) => !before.has(n));

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

/** as much of a pinned level as the structural correction below has to read */
interface PinnedLevel {
  id: string;
  walls: Array<{ id: string; axis?: string; c?: number; from: number; to: number; neg: { kind: string }; pos: { kind: string } }>;
  openings: Array<{ wall: string }>;
}

/**
 * The one wall the pins recorded that was never built, and the ids that close over it.
 *
 * moradia's piso1 has two voids side by side — `vazio_sala`, the double-height space over
 * the living room, and `vazio_escada`, the stairwell — meeting along x = 4.9 between
 * y 3.2 and 5.2. The pins recorded a 0.12 partition there, `w19`. Both sides are holes in
 * the same slab: there is no floor on either side for a wall to stand on, so nothing is
 * built between them and the pin was wrong.
 *
 * Wall ids are handed out after the sort, `w${i + 1}`, so removing the nineteenth of
 * twenty-eight moves every wall after it down one: w20…w28 → w19…w27, and the four
 * openings that named one of those walls follow their wall. That is the whole change:
 * 28 − 1 = 27 walls, 9 renumbered, 4 openings repointed, and not one coordinate, owner,
 * thickness or room metric moves.
 *
 * It is written on the parsed pins rather than as thirteen string pairs because it is one
 * structural correction, and thirteen pairs would hide the arithmetic that makes it one.
 */
function dropVoidVoidWall(pins: Record<string, PinnedLevel[]>): Record<string, PinnedLevel[]> {
  const all = Object.entries(pins).flatMap(([name, ls]) => ls.map((l) => [name, l] as const));
  const voidVoid = all.filter(([, l]) => l.walls.some((w) => w.neg.kind === "void" && w.pos.kind === "void"));
  assert.deepEqual(voidVoid.map(([n, l]) => `${n}/${l.id}`), ["moradia-2-pisos/piso1"], "only one level pinned a void–void wall");

  const piso1 = voidVoid[0]![1];
  assert.equal(piso1.walls.length, 28);
  const gone = piso1.walls.filter((w) => w.neg.kind === "void" && w.pos.kind === "void");
  assert.deepEqual(
    gone.map((w) => [w.id, w.axis, w.c, w.from, w.to]),
    [["w19", "v", 4.9, 3.2, 5.2]],
    "the wall that goes is the one between the two voids, and only it",
  );

  const renamed = new Map<string, string>();
  piso1.walls = piso1.walls.filter((w) => !gone.includes(w));
  piso1.walls.forEach((w, i) => {
    const id = `w${i + 1}`;
    if (id !== w.id) renamed.set(w.id, id);
    w.id = id;
  });
  assert.equal(piso1.walls.length, 27);
  assert.deepEqual(
    [...renamed],
    [["w20", "w19"], ["w21", "w20"], ["w22", "w21"], ["w23", "w22"], ["w24", "w23"], ["w25", "w24"], ["w26", "w25"], ["w27", "w26"], ["w28", "w27"]],
  );
  const moved = piso1.openings.filter((o) => renamed.has(o.wall));
  assert.equal(moved.length, 4);
  for (const o of moved) o.wall = renamed.get(o.wall)!;
  return pins;
}

describe("geometry pins: the derived model the arrangement rewrite must reproduce", () => {
  it("reproduces every pinned room metric, wall, opening and envelope", () => {
    let want = readFileSync(PINS, "utf8");
    for (const [was, now] of CORRECTIONS) {
      const hits = want.split(was).length - 1;
      assert.equal(hits, 1, `the correction ${was} matched ${hits} times, expected exactly one`);
      want = want.replace(was, now);
    }
    // the pins were written by `JSON.stringify(…, null, 1)`, so a round trip through the
    // parser is a no-op — which is what lets the structural correction below be written
    // on the object instead of on the text
    assert.equal(`${JSON.stringify(JSON.parse(want), null, 1)}\n`, want, "the pins do not round-trip");
    want = `${JSON.stringify(dropVoidVoidWall(JSON.parse(want) as Record<string, PinnedLevel[]>), null, 1)}\n`;
    assert.equal(
      pinsFor(before),
      want,
      "the derived model moved; if that is intended, say exactly which numbers moved and why before adding a correction",
    );
  });

  it("pins the fixtures the rewrite added too", () => {
    const actual = pinsFor(new Set(since));
    if (process.env["UPDATE_SNAPSHOTS"] || !existsSync(SINCE)) {
      writeFileSync(SINCE, actual);
      return;
    }
    assert.equal(actual, readFileSync(SINCE, "utf8"), `the derived model of ${since.join(", ")} moved`);
  });

  it("covers every fixture", () => {
    assert.ok(names.length >= 12, `expected every fixture pinned, saw ${names.join(", ")}`);
    assert.deepEqual(
      names.filter((n) => !before.has(n) && !since.includes(n)),
      [],
    );
  });
});
