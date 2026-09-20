// The three fixtures the geometry core added, and the rules only it can report.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyze, floorplan, parse } from "../src/index.ts";
import { snap } from "../src/geometry.ts";
import { has, rulesOf } from "./helpers.ts";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));

describe("fixture: casa-angulo (a 45° wing and a canted bay)", () => {
  const r = floorplan(load("casa-angulo"));

  it("lints clean: an angled house is not a defective one", () => {
    assert.deepEqual(rulesOf(r.findings), []);
  });

  it("derives walls that are neither horizontal nor vertical", () => {
    const angled = r.model.walls.filter((w) => w.axis === undefined);
    assert.equal(angled.length, 4, "two bay cheeks and two 45° wing walls");
    assert.deepEqual(
      angled.map((w) => Math.round(w.length * 1000)).sort((a, b) => a - b),
      [1166, 1166, 4243, 4243],
      "√(0.6² + 1²) twice and 3√2 twice",
    );
    for (const w of angled) assert.equal(w.geometry.kind, "segment");
  });

  it("tiles exactly, bay and wing included", () => {
    assert.ok(!rulesOf(r.findings).some((x) => x.startsWith("tiling.")));
    assert.equal(r.model.rooms.find((m) => m.room.id === "sala")!.area, 26.4, "24 m² plus a 2.4 m² bay");
    assert.equal(r.model.rooms.find((m) => m.room.id === "estudio")!.area, 18);
  });

  it("puts an opening on an angled wall through `at`", () => {
    const win = r.model.openings.find((o) => o.spec.at?.[0] === 11.5)!;
    assert.ok(win, "the study's window is on the 45° wall");
    assert.equal(win.wall.axis, undefined);
    assert.equal(win.wall.kind, "exterior");
    // it lands on the wall, not beside it
    const [x, y] = win.center;
    assert.ok(Math.abs(y - 8 - (x - 10)) < 1e-6, `(${x}, ${y}) is not on the line y = x − 2`);
  });

  it("measures a room with an angled wall by the circle that fits, not the axis-aligned box", () => {
    const estudio = r.model.rooms.find((m) => m.room.id === "estudio")!;
    assert.equal(estudio.minDimension, 2.79);
    assert.equal(estudio.minDimension, Math.round(2 * estudio.inscribed.r * 1000) / 1000);
    // the parallelogram is 3 m between its long walls, less 0.15 of wall face on each
    assert.ok(Math.abs(estudio.inscribed.r - 1.395) < 1e-9);
  });

  it("refuses `on.side` on an angled wall, and says to use `at` instead", () => {
    const doc = load("casa-angulo");
    doc.openings.push({ type: "window", between: ["exterior", "estudio"], on: { room: "estudio", side: "east" }, width: 1 });
    const f = analyze(parse(doc)).findings.find((x) => x.rule === "wall.ambiguous");
    assert.ok(f, `expected wall.ambiguous, got ${rulesOf(analyze(parse(doc)).findings).join(", ")}`);
    assert.match(f.message, /cannot pick out a wall that is not axis-aligned/);
    assert.match(f.message, /Use "at": \[x, y\] instead/);
  });
});

describe("fixture: casa-redonda (two wings and a round hall)", () => {
  const r = floorplan(load("casa-redonda"));

  it("has nothing above info: a curved plan tiles as exactly as a rectilinear one", () => {
    assert.deepEqual(rulesOf(r.findings.filter((f) => f.severity !== "info")), []);
    assert.ok(!rulesOf(r.findings).some((x) => x.startsWith("tiling.")));
  });

  it("measures the round hall as π r², not as a polygon", () => {
    const hall = r.model.rooms.find((m) => m.room.id === "rotunda")!;
    assert.equal(hall.area, 19.635);
    assert.ok(Math.abs(hall.area - Math.PI * 2.5 * 2.5) < 0.001);
  });

  it("gives the two wings the same area, each the rectangle less the hall's bite", () => {
    const sala = r.model.rooms.find((m) => m.room.id === "sala")!;
    const cozinha = r.model.rooms.find((m) => m.room.id === "cozinha")!;
    assert.equal(sala.area, cozinha.area);
    // 24 m² less a circular segment of 2 × 1.5 m half-chord on r = 2.5
    const seg = (2.5 * 2.5 * (1.2870022175865685 - Math.sin(1.2870022175865685))) / 2;
    assert.ok(Math.abs(sala.area - (24 - seg)) < 0.001, `${sala.area} vs ${24 - seg}`);
  });

  it("derives four arc walls, two shared and two onto the street", () => {
    const arcs = r.model.walls.filter((w) => w.geometry.kind === "arc");
    assert.equal(arcs.length, 4);
    assert.deepEqual(
      arcs.map((w) => `${w.kind} ${w.length}`).sort(),
      ["exterior 4.636", "exterior 4.636", "partition 3.218", "partition 3.218"].sort(),
    );
    for (const w of arcs) assert.equal(w.geometry.kind === "arc" && w.geometry.r, 2.5);
  });

  it("leaves no sliver where the wings meet the hall", () => {
    assert.equal(r.model.faces.filter((f) => f.owner.kind === "gap").length, 0);
    assert.equal(r.model.faces.length, 3, "three rooms, three faces");
  });

  it("offsets the round hall's clear floor to a smaller circle, exactly", () => {
    const hall = r.model.rooms.find((m) => m.room.id === "rotunda")!;
    // four arcs: 2.5 − 0.15 onto the street and 2.5 − 0.06 against a wing
    assert.deepEqual([...new Set(hall.clearRing.arcs.map((a) => a?.r))].sort(), [2.35, 2.44, undefined]);
    assert.equal(hall.minDimension, 4.697);
  });

  it("draws its arcs as arcs", () => {
    assert.ok(/<path data-wall="w1[1-4]"[^>]* d="M[^"]*A2\.5/.test(r.svg.replace(/A100 100/g, "")) || r.svg.includes("A100 100"));
    const arcCommands = (r.svg.match(/ A\d/g) ?? []).length;
    assert.ok(arcCommands >= 4, `expected the curved walls to be A commands, saw ${arcCommands}`);
  });

  it("puts a door on an arc through `at`", () => {
    const door = r.model.openings.find((o) => o.spec.entrance)!;
    assert.equal(door.wall.geometry.kind, "arc");
    const [x, y] = door.center;
    assert.ok(Math.abs(Math.hypot(x - 8, y - 3) - 2.5) < 0.002, `(${x}, ${y}) is not on the circle`);
  });
});

describe("fixture: broken-geometria (what angled geometry gets wrong)", () => {
  const r = floorplan(load("broken-geometria"));

  it("gives the overlap a face of its own, named by both claimants", () => {
    const overlap = r.model.faces.filter((f) => f.owner.kind === "overlap");
    assert.equal(overlap.length, 1);
    assert.deepEqual(overlap[0]!.owner.kind === "overlap" && overlap[0]!.owner.ids, ["sala", "estufa"]);
    assert.equal(overlap[0]!.area, 4);
    const f = r.findings.find((x) => x.rule === "tiling.overlap")!;
    assert.match(f.message, /rooms sala, estufa overlap over 4 m²/);
  });

  it("finds the shallow wedge two nearly-parallel edges leave", () => {
    const gap = r.findings.find((x) => x.rule === "tiling.gap")!;
    assert.ok(gap);
    assert.match(gap.message, /0\.015 m²/);
    assert.match(gap.message, /from \(9, 4\) to \(12, 4\.01\)/);
  });

  it("says how much of a sharp corner is wall rather than floor", () => {
    const f = r.findings.find((x) => x.rule === "room.acute_corner")!;
    assert.ok(f, `expected room.acute_corner, got ${rulesOf(r.findings).join(", ")}`);
    assert.match(f.message, /Bico has a 8° corner at \(3, 6\)/);
    assert.match(f.message, /the wall faces meet 2\.26 m along each arm/);
  });

  it("still draws", () => {
    assert.ok(r.svg.startsWith("<svg "));
    assert.ok(r.svg.includes('class="finding"'));
  });
});

describe("the rules only curved and angled geometry can reach", () => {
  it("room.no_clear_floor: a room narrower than its own walls", () => {
    const { findings } = analyze(
      parse({
        walls: { exterior: 0.3, partition: 0.12 },
        rooms: { a: { kind: "living", rect: [0, 0, 6, 3] }, slot: { kind: "storage", rect: [0, 3, 6, 0.2] } },
        openings: [
          { type: "door", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1, entrance: true },
          { type: "door", between: ["a", "slot"], width: 0.7 },
        ],
      }),
    );
    const f = findings.find((x) => x.rule === "room.no_clear_floor")!;
    assert.ok(f, `expected room.no_clear_floor, got ${rulesOf(findings).join(", ")}`);
    assert.match(f.message, /has no floor left once its walls are built/);
  });

  it("geometry.sliver: a face too small to be a hole, reported rather than screamed about", () => {
    // three rooms round a wedge 2 cm long and a millimetre deep: 10 mm²
    const { findings } = analyze(
      parse({
        rooms: {
          a: { kind: "living", poly: [[0, 0], [4, 0], [4, 2], [0, 2]] },
          b: { kind: "living", poly: [[0, 2], [4, 2], [4, 4], [0, 4]] },
          // c's west edge is notched a millimetre east over a 0.1 m run: 50 mm² of floor
          c: { kind: "storage", poly: [[4, 0], [4.5, 0], [4.5, 4], [4, 4], [4, 2.05], [4.001, 2], [4, 1.95]] },
        },
        openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1, entrance: true }],
      }),
    );
    const f = findings.find((x) => x.rule === "geometry.sliver");
    assert.ok(f, `expected geometry.sliver, got ${rulesOf(findings).join(", ")}`);
    assert.match(f.message, /a sliver of floor \d+ mm² across is covered by nothing/);
    assert.ok(!has(findings, "tiling.gap"), "a sliver is not reported as a hole as well");
  });

  it("arc.too_shallow: a curve that is a straight line written expensively", () => {
    const { findings } = analyze(
      parse({
        rooms: {
          a: {
            kind: "living",
            poly: [[0, 0], [4, 0], { arc: [4, 3], r: 500, sweep: "cw" }, [0, 3]],
          },
        },
        openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1, entrance: true }],
      }),
    );
    const f = findings.find((x) => x.rule === "arc.too_shallow")!;
    assert.ok(f, `expected arc.too_shallow, got ${rulesOf(findings).join(", ")}`);
    assert.match(f.message, /bulges [\d.]+ mm past its chord/);
  });
});


describe("the predicates that used to measure bounding boxes", () => {
  const room = (fixtures: unknown[]) => ({
    walls: { exterior: 0.3, partition: 0.12 },
    rooms: { a: { kind: "living", rect: [0, 0, 6, 6] } },
    openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1, entrance: true }],
    fixtures,
  });

  it("measures the gap between two L-shaped runs, not between their boxes", () => {
    // two L counters whose bounding boxes are 0.2 m apart but whose limbs are far apart
    const { findings } = analyze(
      parse(
        room([
          { type: "counter", in: "a", name: "West", poly: [[0.5, 0.5], [2, 0.5], [2, 0.9], [0.9, 0.9], [0.9, 3], [0.5, 3]] },
          { type: "counter", in: "a", name: "East", poly: [[2.2, 2.6], [4, 2.6], [4, 3], [2.6, 3], [2.6, 5], [2.2, 5]] },
        ]),
      ),
    );
    assert.ok(!has(findings, "fixture.clearance"), rulesOf(findings).join(", "));
  });

  it("still reports two runs that really are too close", () => {
    const { findings } = analyze(
      parse(
        room([
          { type: "counter", in: "a", name: "West", at: [1, 1], size: [1, 2] },
          { type: "counter", in: "a", name: "East", at: [2.3, 1], size: [1, 2] },
        ]),
      ),
    );
    const f = findings.find((x) => x.rule === "fixture.clearance")!;
    assert.ok(f, rulesOf(findings).join(", "));
    assert.match(f.message, /only 0\.3 m between West and East/);
  });

  it("only reports a swing that actually reaches the fixture", () => {
    const withFixture = (fixture: unknown) =>
      analyze(
        parse({
          walls: { exterior: 0.3, partition: 0.12 },
          rooms: { a: { kind: "living", rect: [0, 0, 6, 6] } },
          openings: [
            {
              type: "door",
              between: ["exterior", "a"],
              on: { room: "a", side: "north" },
              position: 1,
              width: 1.4,
              hinge: "start",
              swingInto: "a",
              entrance: true,
            },
          ],
          fixtures: [fixture],
        }),
      ).findings;

    // just inside the swing's bounding box, just outside the quarter disc itself
    const missed = withFixture({
      type: "counter",
      in: "a",
      name: "Bench",
      poly: [[1.6, 1.3], [1.75, 1.3], [1.75, 1.45], [1.6, 1.45]],
    });
    assert.ok(!has(missed, "door.swing_hits_fixture"), rulesOf(missed).join(", "));

    const hit = withFixture({ type: "counter", in: "a", name: "Bench", at: [0.5, 0.5], size: [0.6, 0.6] });
    assert.ok(has(hit, "door.swing_hits_fixture"), rulesOf(hit).join(", "));
  });
});


describe("a wall that runs smoothly from straight into curved is one wall", () => {
  // two rooms split by a line that goes down, round a quarter circle tangentially, and
  // on east: three pieces, no corner between any of them, so one `chain` wall
  const plan = {
    walls: { exterior: 0.3, partition: 0.12 },
    rooms: {
      a: { kind: "living", poly: [[0, 0], [0, 3], { arc: [3, 6], r: 3, sweep: "ccw" }, [8, 6], [8, 10], [-5, 10], [-5, 0]] },
      b: { kind: "living", poly: [[0, 0], [8, 0], [8, 6], [3, 6], { arc: [0, 3], r: 3, sweep: "cw" }] },
    },
    openings: [
      { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 1, entrance: true },
      { type: "door", between: ["a", "b"], at: [0, 1.5], width: 0.9 },
    ],
  };

  it("chains the three pieces into one wall of the right length", () => {
    const { model, findings } = analyze(parse(plan));
    assert.ok(!rulesOf(findings).some((r) => r.startsWith("tiling.")), rulesOf(findings).join(", "));
    const chained = model.walls.filter((w) => w.geometry.kind === "chain");
    assert.equal(chained.length, 1);
    const w = chained[0]!;
    assert.equal(w.kind, "partition");
    assert.deepEqual(
      w.geometry.kind === "chain" && w.geometry.parts.map((p) => p.kind),
      ["segment", "arc", "segment"],
    );
    // 3 m straight, a quarter of a 3 m circle, 5 m straight
    assert.ok(Math.abs(w.length - (3 + (Math.PI * 3) / 2 + 5)) < 0.001, `${w.length}`);
  });

  it("splits a corner apart even when the pieces share two owners", () => {
    // the same two rooms, but with a right angle where the arc was
    const square = {
      ...plan,
      rooms: {
        a: { kind: "living", poly: [[0, 0], [0, 6], [8, 6], [8, 10], [-5, 10], [-5, 0]] },
        b: { kind: "living", poly: [[0, 0], [8, 0], [8, 6], [0, 6]] },
      },
      openings: [plan.openings[0]],
    };
    const { model } = analyze(parse(square));
    const shared = model.walls.filter((w) => w.kind === "partition");
    assert.equal(shared.length, 2, "a corner is two walls, not one — which is what wall.ambiguous rests on");
    assert.equal(shared.filter((w) => w.geometry.kind === "chain").length, 0);
  });

  it("places an opening on the straight part of a chain by arc length", () => {
    const { model } = analyze(parse(plan));
    const door = model.openings.find((o) => o.spec.at !== undefined)!;
    assert.equal(door.wall.geometry.kind, "chain");
    assert.deepEqual(door.center, [0, 1.5]);
    assert.ok(door.from >= 0 && door.to <= door.wall.length);
  });
});

/**
 * B9: the clear rectangle used to deduct nothing at all from an angled room.
 *
 * `buildGrid` snaps every rotated coordinate to the millimetre before it sweeps, but
 * `halfWallAlong` rotated each wall's endpoints *unsnapped* and asked for equality at
 * 1e-6. A rotation by 30° or 45° leaves sub-millimetre residue, so no wall ever matched
 * the grid line it runs along and `clearRect === largestRect` — a centreline rectangle
 * quoted as clear floor, overstated by half a wall on each of the four sides.
 */
describe("the clear rectangle deducts wall thickness in a rotated frame (B9)", () => {
  it("takes half a wall off each side of a 45° room, exactly as it does at 0°", () => {
    const diamond = {
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: { sala: { name: "Sala", kind: "living", poly: [[5, 0], [10, 5], [5, 10], [0, 5]] } },
      openings: [{ type: "door", between: ["exterior", "sala"], at: [7.5, 2.5], width: 1, entrance: true }],
    };
    const m = analyze(parse(diamond)).model.rooms[0]!;
    assert.equal(m.bearing, 45, "the frame is the bearing of the longest edge");
    const L = m.largestRect;
    // the square's side is 5√2 = 7.0710678…, which the millimetre grid carries as
    // 7.071 one way and 7.072 the other
    assert.deepEqual([snap(L.x1 - L.x0), snap(L.y1 - L.y0)], [7.071, 7.072]);
    // four exterior walls, 0.3 thick: 0.15 off each side, 0.3 off each dimension
    assert.deepEqual([m.clearRect.w, m.clearRect.h], [7.071 - 0.3, snap(7.072 - 0.3)]);
    // and it now agrees with the wholly independent measure: the inscribed circle of the
    // offset ring, which was right all along
    assert.equal(m.minDimension, m.clearRect.w);
    assert.equal(snap(2 * m.inscribed.r), m.clearRect.h);
  });

  /**
   * casa-v's twelve angled rooms, before → after. `largest` is unchanged (the sweep grid
   * never moved); `clear` is what B9 left as a copy of it. Every deduction is a sum of
   * two half-thicknesses drawn from {0.15 exterior, 0.06 partition}, which is why every
   * entry below is one of 0.12, 0.21, 0.3 — and `sala` is 0/0 because its largest free
   * rectangle is bounded by its own counter and island, not by walls.
   */
  const CASA_V: ReadonlyArray<readonly [string, number, number, number, number]> = [
    // id, largest w, largest h, deducted along w, deducted along h
    ["sala", 7.077, 8.793, 0, 0],
    ["corr_w", 9.4, 1.399, 0.12, 0.21],
    ["wc_w", 2.399, 4.001, 0.12, 0.21],
    ["quarto1", 3.6, 4, 0.12, 0.21],
    ["quarto2", 3.401, 4, 0.12, 0.21],
    ["suite", 2.4, 5.4, 0.12, 0.3],
    ["wc_suite", 1.8, 2.8, 0.21, 0.21],
    ["corr_e", 1.4, 6.4, 0.21, 0.12],
    ["lavandaria", 4.001, 2.399, 0.12, 0.12],
    ["escritorio", 4.001, 4.001, 0.21, 0.12],
    ["brincar", 5.4, 5.599, 0.3, 0.21],
    ["garagem", 5.799, 8.6, 0.21, 0.3],
  ];

  it("deducts on eleven of casa-v's twelve angled rooms, and rightly on none of sala", () => {
    const { model } = analyze(parse(load("casa-v")));
    assert.equal(model.rooms.length, CASA_V.length);
    for (const [id, lw, lh, dw, dh] of CASA_V) {
      const m = model.rooms.find((r) => r.room.id === id)!;
      assert.ok(m.bearing !== 0, `${id} is meant to be angled`);
      const L = m.largestRect;
      assert.deepEqual([snap(L.x1 - L.x0), snap(L.y1 - L.y0)], [lw, lh], `${id}: largestRect moved`);
      assert.deepEqual([m.clearRect.w, m.clearRect.h], [snap(lw - dw), snap(lh - dh)], `${id}: clearRect`);
      for (const d of [dw, dh]) assert.ok([0, 0.12, 0.21, 0.3].includes(d), `${id}: ${d} is not two half-walls`);
    }
  });

  it("leaves the narrowest side agreeing with the inscribed circle, to the millimetre", () => {
    const { model } = analyze(parse(load("casa-v")));
    // the two measures come from different code on different geometry — the sweep grid
    // and the mitred offset ring. Before B9 not one of the twelve agreed, because the
    // rectangle was still on centrelines. The two that still differ are the two whose
    // largest free rectangle is not the thing the circle fits in: `sala`'s is bounded by
    // its counter and island, and `suite` is wider away from its narrow rectangle.
    const differ = model.rooms
      .filter((m) => Math.round(Math.abs(Math.min(m.clearRect.w, m.clearRect.h) - m.minDimension) * 1000) > 1)
      .map((m) => m.room.id);
    assert.deepEqual(differ, ["sala", "suite"]);
  });

  it("does not move a rectilinear room: casa-t3 and casa-angulo deduct exactly as before", () => {
    for (const [name, id, w, h] of [["casa-t3", "distrib", 11.99, 1.28], ["casa-angulo", "estudio", 5, 2.79]] as const) {
      const m = analyze(parse(load(name))).model.rooms.find((r) => r.room.id === id)!;
      assert.deepEqual([m.clearRect.w, m.clearRect.h], [w, h], `${name}/${id}`);
    }
  });
});

/**
 * gpt-5.5 §2.6: the inscribed circle ignored everything standing on the floor.
 *
 * The rectilinear path excludes an occupied cell from its sweep (`g.busy`), so a
 * rectangular room's `clearRect` — and therefore its `minDimension` — has always gone
 * round a kitchen island. The non-rectilinear path measured the largest circle in the
 * wall-offset ring and nothing else, so a round living room with a 2 m island in the
 * middle of it reported the same narrowness empty or full.
 */
describe("the inscribed circle goes round the furniture too (gpt-5.5 §2.6)", () => {
  /** a round room, 6 m across, with a door so it lints as a room rather than a cave */
  const round = (fixtures: unknown[]) => ({
    walls: { exterior: 0.3, partition: 0.12 },
    rooms: {
      sala: {
        name: "Sala",
        kind: "living",
        poly: [[3, 0], { arc: [6, 3], r: 3, sweep: "cw" }, { arc: [3, 6], r: 3, sweep: "cw" }, { arc: [0, 3], r: 3, sweep: "cw" }, { arc: [3, 0], r: 3, sweep: "cw" }],
      },
    },
    openings: [{ type: "door", between: ["exterior", "sala"], at: [3, 0], width: 1, entrance: true }],
    fixtures,
  });
  const salaOf = (fixtures: unknown[]) => analyze(parse(round(fixtures))).model.rooms[0]!;

  it("measures the empty room by its own diameter", () => {
    const empty = salaOf([]);
    // 6 m across on centrelines, less 0.15 of wall face each side, and a millimetre off
    // that because the offset ring of a flattened circle is a polygon
    assert.equal(empty.minDimension, 5.698);
    assert.equal(empty.minDimension, snap(2 * empty.inscribed.r));
  });

  it("reports a smaller minDimension once an island stands in the middle of it", () => {
    const empty = salaOf([]);
    const busy = salaOf([{ type: "island", in: "sala", name: "Ilha", at: [2, 2], size: [2, 2] }]);
    assert.ok(
      busy.minDimension < empty.minDimension,
      `an island did not narrow the room: ${busy.minDimension} against ${empty.minDimension}`,
    );
    // the island spans x 2→4, y 2→4 in a room whose clear floor is the circle of radius
    // 2.849 about (3, 3); the biggest circle left touches one side of the island and the
    // wall opposite: 1 + ρ = 2.849 − ρ, so ρ = 0.925 and the room measures 1.849
    assert.equal(busy.minDimension, 1.849);
    assert.ok(Math.abs(busy.inscribed.at[0] - 3) < 0.001 && Math.abs(busy.inscribed.at[1] - 4.925) < 0.001, JSON.stringify(busy.inscribed.at));
    // `inscribed.r` is rounded to the millimetre before it is published, so the two
    // agree to a millimetre and not to the digit
    assert.ok(Math.round(Math.abs(busy.minDimension - 2 * busy.inscribed.r) * 1000) <= 1);
    // and the circle is no longer centred on the island
    assert.ok(Math.hypot(busy.inscribed.at[0] - 3, busy.inscribed.at[1] - 3) > 1, "the circle is no longer centred on the room");
  });

  it("is not narrowed by a fixture standing outside the room", () => {
    const empty = salaOf([]);
    const elsewhere = salaOf([{ type: "island", in: "sala", name: "Ilha", at: [20, 20], size: [2, 2] }]);
    assert.equal(elsewhere.minDimension, empty.minDimension);
  });

  it("agrees with the rectilinear path, which has always excluded fixtures", () => {
    // the same room, square: `clearRect` sweeps round the island and `minDimension` is
    // its short side. The two paths now answer the same question.
    const square = {
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: { sala: { name: "Sala", kind: "living", rect: [0, 0, 6, 6] } },
      openings: [{ type: "door", between: ["exterior", "sala"], on: { room: "sala", side: "west" }, width: 1, entrance: true }],
      fixtures: [{ type: "island", in: "sala", name: "Ilha", at: [2, 0], size: [2, 6] }],
    };
    const m = analyze(parse(square)).model.rooms[0]!;
    // the island splits the room into two strips, 1.85 and 1.85 clear
    assert.equal(m.minDimension, 1.85);
  });
});
