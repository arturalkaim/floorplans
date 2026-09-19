import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PLANS, buildDemo } from "../scripts/build-demo.ts";

describe("demo build", () => {
  const out = mkdtempSync(join(tmpdir(), "floorplan-demo-"));
  const r = buildDemo(out);
  const page = readFileSync(join(out, "index.html"), "utf8");

  it("inlines every plan so the page needs no fetch", () => {
    assert.equal(r.plans, PLANS.length);
    assert.ok(!page.includes("__FIXTURES__"), "placeholder was substituted");
    for (const [id, label] of PLANS) {
      assert.ok(page.includes(JSON.stringify(label)), `missing tab ${label}`);
      assert.ok(page.includes(`"${id}":`), `missing plan ${id}`);
    }
  });

  it("opens on the first plan", () => {
    assert.ok(page.includes(`let current = ${JSON.stringify(PLANS[0]![0])};`));
  });

  it("ships the library the page imports, and no node-only module", () => {
    assert.ok(page.includes('from "./lib/index.js"'));
    for (const m of ["index", "derive", "parse", "rules", "svg", "geometry", "doors", "types"])
      assert.ok(existsSync(join(out, "lib", `${m}.js`)), `missing lib/${m}.js`);
    assert.ok(!existsSync(join(out, "lib", "cli.js")), "cli.js needs node: builtins");
  });

  it("copies a library free of node imports, so it runs in a browser", () => {
    for (const m of ["index", "derive", "parse", "rules", "svg", "geometry", "doors", "types"]) {
      const src = readFileSync(join(out, "lib", `${m}.js`), "utf8");
      assert.ok(!/from ["']node:/.test(src), `lib/${m}.js imports a node builtin`);
      assert.ok(!/\brequire\(/.test(src), `lib/${m}.js uses require()`);
    }
  });
});
