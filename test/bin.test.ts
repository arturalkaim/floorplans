// Regression test for A1: npm's bin symlink (node_modules/.bin/floorplan -> dist/bin.js)
// must still run the CLI. The old isMain guard in src/cli.ts matched process.argv[1]
// against /cli\.(ts|js)$/, which is never true through a symlink named "floorplan",
// so `run()` was never called: empty stdout, exit 0, for every plan including broken ones.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let dir: string;

describe("bin (published CLI entry point)", () => {
  before(() => {
    // Build once; the whole point of this test is to exercise the compiled dist output
    // the way npm's bin wiring does, not the .ts source.
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
    dir = mkdtempSync(join(tmpdir(), "floorplan-bin-"));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs through a symlink named after the package, not the file", () => {
    const link = join(dir, "floorplan");
    symlinkSync(resolve(root, "dist/bin.js"), link);
    const res = spawnSync(process.execPath, [link, "fixtures/broken.json", "--lint"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(res.stdout.trim(), "", `expected findings on stdout; stderr: ${res.stderr}`);
    assert.notEqual(res.status, 0, "broken.json has lint errors; exit code must reflect that");
    assert.match(res.stdout, /tiling\.gap/);
  });
});
