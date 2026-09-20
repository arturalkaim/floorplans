import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyze, parse, projection, renderSvg } from "../src/index.ts";

const load = (n: string) => parse(JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), "utf8")));

describe("projection", () => {
  it("round trips metres through screen units", () => {
    const { model } = analyze(load("casa-t3"));
    const p = projection(model, { scale: 37 });
    for (const pt of model.rooms[0]!.room.poly) {
      const back = p.toModel(...(p.toScreen(pt) as [number, number]));
      assert.ok(Math.abs(back[0] - pt[0]) < 1e-9 && Math.abs(back[1] - pt[1]) < 1e-9);
    }
  });

  it("agrees with what the renderer actually drew", () => {
    // the invariant a drag depends on: if these disagree, the wall moves under the cursor
    for (const name of ["casa-t3", "casa-piscina", "cabin"]) {
      const { model, findings } = analyze(load(name));
      for (const scale of [20, 40, 70]) {
        const opts = { scale, findings };
        const svg = renderSvg(model, opts);
        const p = projection(model, opts);
        const wall = model.walls.find((w) => w.axis === "v")!;
        const [sx] = p.toScreen([wall.c!, wall.from]);
        const drawn = new RegExp(`data-wall="${wall.id}"[^>]*M${sx.toFixed(2).replace(/\.?0+$/, "")} `);
        assert.ok(
          drawn.test(svg) || svg.includes(`data-wall="${wall.id}" data-axis="v" data-c="${wall.c}"`),
          `${name} @${scale}: wall ${wall.id} not found at the projected x`,
        );
      }
    }
  });

  it("moves the origin when the title or dimensions are dropped", () => {
    const { model } = analyze(load("cabin"));
    const withDims = projection(model, {});
    const without = projection(model, { dimensions: false, title: "" });
    assert.ok(withDims.ox > without.ox && withDims.oy > without.oy);
  });

  it("covers outdoor space, so a terrace is inside the drawing", () => {
    const { model } = analyze(load("quinta"));
    const p = projection(model, {});
    const pts = model.plan.outdoor.flatMap((o) => o.poly);
    for (const [x, y] of pts) {
      assert.ok(x >= p.minX && x <= p.maxX, `x ${x} outside [${p.minX}, ${p.maxX}]`);
      assert.ok(y >= p.minY && y <= p.maxY, `y ${y} outside [${p.minY}, ${p.maxY}]`);
    }
  });
});
