// The drawing's walls must cover the same paper after the geometry core lands as they
// did before it.
//
// `test/__snapshots__/before-levels/*.svg` were produced by the pre-arrangement renderer
// and cannot be regenerated from this repository (see levels-compat.test.ts). They are
// therefore the honest "before" side: the renderer may change how it says a wall —
// `<line>` runs whose ends are extended by half a thickness become stroked `<path>`
// chains with mitre joins — but not which square millimetres of the sheet are inked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyze, parse, renderSvg } from "../src/index.ts";
import { compareWallCoverage, strokeSolids, wallSolids } from "./svg-coverage.ts";

const FIXTURES = ["casa-t3", "apartment-t2", "casa-piscina", "quinta", "casa-patio", "broken", "cabin"];
const load = (n: string) => readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), "utf8");
const baseline = (n: string) =>
  readFileSync(new URL(`./__snapshots__/before-levels/${n}.svg`, import.meta.url), "utf8");

/** one square millimetre, in m² — the whole tolerance for ink that appears */
const ONE_MM2 = 1e-6;

/**
 * Where the two drawings are allowed to differ at all, as a share of the wall ink.
 *
 * Measured, and only in one direction: the new drawing never inks a square millimetre
 * the old one did not. What it stops inking is the spur the old trick left wherever two
 * walls of *different* thickness met end to end — an exterior wall extended half of its
 * own 0.30 m past the junction, across its full width, even though the partition
 * carrying on from there is 0.12 m wide, so 0.09 m of it stuck out either side of the
 * thinner wall. Four of the seven fixtures have such a junction; the other three —
 * casa-t3, casa-piscina and cabin — are identical to the square millimetre.
 */
const OVERDRAW_BUDGET = 0.005;

describe("svg: the walls cover the same paper as before the geometry core", () => {
  for (const name of FIXTURES) {
    it(`${name}: wall ink is unchanged, except for the old trick's spurs`, () => {
      const { model, findings } = analyze(parse(JSON.parse(load(name))));
      const now = renderSvg(model, { findings });
      const c = compareWallCoverage(baseline(name), now);
      assert.ok(c.areaA > 1, `${name}: the baseline drew no walls`);
      assert.ok(
        c.onlyB <= ONE_MM2,
        `${name}: the new drawing inks ${(c.onlyB * 1e6).toFixed(3)} mm² the old one did not — a mitre must never add ink`,
      );
      assert.ok(
        c.onlyA <= c.areaA * OVERDRAW_BUDGET,
        `${name}: the new drawing drops ${(c.onlyA * 1e4).toFixed(2)} cm² (${((c.onlyA / c.areaA) * 100).toFixed(3)} %) of the old ink, past the ${OVERDRAW_BUDGET * 100} % the old corner trick's spurs account for`,
      );
    });
  }

  it("is exact where every wall at every junction is the same thickness", () => {
    for (const name of ["casa-t3", "casa-piscina", "cabin"]) {
      const { model, findings } = analyze(parse(JSON.parse(load(name))));
      const c = compareWallCoverage(baseline(name), renderSvg(model, { findings }));
      assert.ok(
        c.difference <= ONE_MM2,
        `${name}: ${(c.difference * 1e6).toFixed(3)} mm² of wall differs (before ${c.areaA.toFixed(6)} m², after ${c.areaB.toFixed(6)} m²)`,
      );
    }
  });

  it("the spur is exactly what a thick wall used to poke past a thin one", () => {
    // 0.30 m wall running west to (0,0), 0.12 m wall running on north from there
    const thick = `<line data-wall="a" x1="-100" y1="0" x2="6" y2="0" stroke-width="12"/>`;
    const thin = `<line data-wall="b" x1="0" y1="-2.4" x2="0" y2="-100" stroke-width="4.8"/>`;
    const mitred =
      `<path data-wall="a" d="M-100 0 L0 0" stroke-width="12"/>` +
      `<path data-wall="b" d="M0 0 L0 -100" stroke-width="4.8"/>` +
      `<polygon class="wall-join" points="0,0 0,6 2.4,2.4 2.4,0"/>`;
    const c = compareWallCoverage(thick + thin, mitred, 1, 0.02);
    assert.ok(c.onlyB < 0.5, "the mitre adds nothing");
    assert.ok(c.onlyA > 20, `the old trick's spur is real: ${c.onlyA}`);
  });

  it("finds wall solids in both encodings", () => {
    const line = `<line data-wall="w1" x1="0" y1="0" x2="10" y2="0" stroke-width="4"/>`;
    const path = `<path data-wall="w1" d="M0 0 L10 0" stroke-width="4"/>`;
    assert.equal(wallSolids(line).length, 1);
    assert.equal(wallSolids(path).length, 1);
    assert.ok(compareWallCoverage(line, path).difference < 1e-9);
  });

  it("a mitred right-angle join covers exactly what two ends extended by t/2 cover", () => {
    // the identity the renderer change rests on
    const t = 4;
    const chained = `<path data-wall="w" d="M0 0 L10 0 L10 10" stroke-width="${t}"/>`;
    const extended =
      `<line data-wall="a" x1="0" y1="0" x2="${10 + t / 2}" y2="0" stroke-width="${t}"/>` +
      `<line data-wall="b" x1="10" y1="${-t / 2}" x2="10" y2="10" stroke-width="${t}"/>`;
    const c = compareWallCoverage(extended, chained, 1, 0.05);
    assert.ok(c.difference < 1e-9, `differs by ${c.difference}`);
  });

  it("a mitred 45° join is not the same as extending by t/2 — which is why the trick had to go", () => {
    const t = 4;
    const chained = `<path data-wall="w" d="M0 0 L10 0 L20 10" stroke-width="${t}"/>`;
    const extended =
      `<line data-wall="a" x1="0" y1="0" x2="${10 + t / 2}" y2="0" stroke-width="${t}"/>` +
      `<line data-wall="b" x1="${10 - (t / 2) * Math.SQRT1_2}" y1="${-(t / 2) * Math.SQRT1_2}" x2="20" y2="10" stroke-width="${t}"/>`;
    assert.ok(compareWallCoverage(extended, chained, 1, 0.05).difference > 0.5);
  });

  it("strokeSolids bevels rather than spiking past the mitre limit", () => {
    const spike = strokeSolids(
      [
        [0, 0],
        [100, 0],
        [0, 1],
      ],
      4,
      2,
    );
    for (const p of spike) for (const [x, y] of p) assert.ok(Math.abs(x) < 1e3 && Math.abs(y) < 1e3);
  });
});
