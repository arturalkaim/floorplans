import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { formatFindings, run } from "../src/cli.ts";
import type { CliIo } from "../src/cli.ts";
import { twoRooms } from "./helpers.ts";

function fakeIo(files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const io: CliIo = {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readFile: (p) => {
      const f = files[p];
      if (f === undefined) throw new Error("ENOENT");
      return f;
    },
    writeFile: (p, s) => {
      written[p] = s;
    },
  };
  return { io, out: () => out.join(""), err: () => err.join(""), written };
}

const clean = JSON.stringify(twoRooms());
const warn = JSON.stringify(twoRooms({ openings: twoRooms().openings.slice(0, 2) })); // no windows → warnings
const broken = JSON.stringify(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8 }] })); // no entrance → error

describe("cli", () => {
  it("prints usage and exits 2 without an input", () => {
    const t = fakeIo({});
    assert.equal(run([], t.io), 2);
    assert.match(t.err(), /usage:/);
  });
  it("exits 2 on unknown options, bad option values, and unreadable files", () => {
    assert.equal(run(["plan.json", "--bogus"], fakeIo({ "plan.json": clean }).io), 2);
    assert.equal(run(["plan.json", "--theme", "sepia"], fakeIo({ "plan.json": clean }).io), 2);
    assert.equal(run(["plan.json", "--scale", "-1"], fakeIo({ "plan.json": clean }).io), 2);
    assert.equal(run(["missing.json"], fakeIo({}).io), 2);
  });
  it("exits 2 with the issue list on a schema error", () => {
    const t = fakeIo({ "plan.json": JSON.stringify({ rooms: { a: { poly: [[0, 0], [1, 1], [0, 1]] } } }) });
    assert.equal(run(["plan.json"], t.io), 2);
    assert.match(t.err(), /rooms\.a\.poly/);
    assert.equal(t.out(), "", "text form belongs on stderr only; stdout must stay empty");
  });
  it("--json emits a JSON error envelope on stdout on a schema error, not text on stderr", () => {
    const t = fakeIo({ "plan.json": JSON.stringify({ rooms: { a: { poly: [[0, 0], [1, 1], [0, 1]] } } }) });
    assert.equal(run(["plan.json", "--json"], t.io), 2);
    assert.equal(t.err(), "", "schema errors under --json must not also print text to stderr");
    const parsed = JSON.parse(t.out());
    assert.ok(Array.isArray(parsed.error.issues) && parsed.error.issues.length > 0);
    assert.match(parsed.error.issues[0].path, /rooms\.a\.poly/);
    assert.equal(typeof parsed.error.issues[0].message, "string");
  });
  it("writes SVG to stdout by default and exits 0 when clean", () => {
    const t = fakeIo({ "plan.json": clean });
    assert.equal(run(["plan.json"], t.io), 0);
    assert.ok(t.out().startsWith("<svg "));
  });
  it("--out writes the file and prints findings; exit 1 at warning or above", () => {
    const t = fakeIo({ "plan.json": warn });
    assert.equal(run(["plan.json", "--out", "x.svg"], t.io), 1);
    assert.ok(t.written["x.svg"]!.startsWith("<svg "));
    assert.match(t.out(), /habitable\.no_window/);
    assert.match(t.out(), /2 warning\(s\)/);
  });
  it("--lint prints findings only, exit 1 on errors", () => {
    const t = fakeIo({ "plan.json": broken });
    assert.equal(run(["plan.json", "--lint"], t.io), 1);
    assert.ok(!t.out().includes("<svg"));
    assert.match(t.out(), /entrance\.missing/);
  });
  it("--json emits findings and schedule", () => {
    const t = fakeIo({ "plan.json": clean });
    assert.equal(run(["plan.json", "--json"], t.io), 0);
    const parsed = JSON.parse(t.out());
    assert.deepEqual(parsed.findings, []);
    assert.equal(parsed.schedule.rooms.length, 2);
  });
  it("render options reach the SVG", () => {
    const t = fakeIo({ "plan.json": clean });
    run(["plan.json", "--theme", "dark", "--labels", "index", "--scale", "20"], t.io);
    assert.ok(t.out().includes('class="floorplan theme-dark"'));
    assert.ok(t.out().includes('class="rk"'));
  });
  it("formatFindings reports a clean plan", () => {
    assert.equal(formatFindings([]), "✓ no findings\n");
  });
  it("runs as a real process against the seed fixture", () => {
    // src/cli.ts is IO-free and exports only `run`; src/bin.ts is the real entry point.
    const res = spawnSync(process.execPath, ["src/bin.ts", "fixtures/casa-t3.json", "--lint"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stdout, /circulation\.share/);
  });
});
