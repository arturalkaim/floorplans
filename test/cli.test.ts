import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { formatFindings, run } from "../src/cli.ts";
import type { CliIo } from "../src/cli.ts";
import { SCHEMA } from "../src/index.ts";
import { twoRooms } from "./helpers.ts";

function fakeIo(files: Record<string, string>, stdin = "") {
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
    readStdin: () => stdin,
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
  it("--json is findings-first: a summary and the findings, and no schedule", () => {
    const t = fakeIo({ "plan.json": clean });
    assert.equal(run(["plan.json", "--json"], t.io), 0);
    const parsed = JSON.parse(t.out());
    assert.deepEqual(parsed, { summary: { error: 0, warning: 0, info: 0 }, findings: [] });
  });

  it("--json=all adds the schedule and the derived walls", () => {
    const t = fakeIo({ "plan.json": clean });
    assert.equal(run(["plan.json", "--json=all"], t.io), 0);
    const parsed = JSON.parse(t.out());
    assert.equal(parsed.schedule.rooms.length, 2);
    assert.ok(parsed.walls.length > 0);
    assert.deepEqual(Object.keys(parsed), ["summary", "findings", "schedule", "walls"]);
  });

  it("--json=schedule and --json=walls select one section", () => {
    const s = fakeIo({ "plan.json": clean });
    run(["plan.json", "--json=schedule"], s.io);
    assert.deepEqual(Object.keys(JSON.parse(s.out())), ["schedule"]);
    const w = fakeIo({ "plan.json": clean });
    run(["plan.json", "--json=walls"], w.io);
    const walls = JSON.parse(w.out()).walls;
    // endpoints as points and owners as tagged unions: no `axis`, no `c`
    assert.deepEqual(Object.keys(walls[0]), ["id", "kind", "from", "to", "neg", "pos"]);
    assert.equal(walls[0].from.length, 2);
  });

  it("rejects an unknown --json mode", () => {
    assert.equal(run(["plan.json", "--json=everything"], fakeIo({ "plan.json": clean }).io), 2);
  });

  it("prints JSON one entity per line, not one coordinate per line", () => {
    const t = fakeIo({ "plan.json": broken });
    run(["plan.json", "--json"], t.io);
    const lines = t.out().trimEnd().split("\n");
    const findings = JSON.parse(t.out()).findings.length;
    // `{`, summary, `"findings": [`, one line per finding, `]`, `}`
    assert.equal(lines.length, findings + 5, t.out());
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

describe("cli: --schema", () => {
  it("needs no input file and exits 0", () => {
    const t = fakeIo({});
    assert.equal(run(["--schema"], t.io), 0);
    assert.notEqual(t.out(), "");
    assert.equal(t.err(), "");
  });

  it("prints JSON that parses, and round-trips SCHEMA (modulo enum sets becoming arrays)", () => {
    const t = fakeIo({});
    run(["--schema"], t.io);
    const printed = JSON.parse(t.out());
    assert.ok(Array.isArray(printed));
    const plain = SCHEMA.map((o) => ({
      object: o.object,
      fields: o.fields.map((f) => ({
        name: f.name,
        type: f.type,
        required: f.required,
        ...(f.enum ? { enum: [...f.enum] } : {}),
        doc: f.doc,
      })),
      ...(o.oneOf ? { oneOf: o.oneOf } : {}),
    }));
    assert.deepEqual(printed, plain);
  });

  it("documents every object the parser's checkKeys calls need", () => {
    const t = fakeIo({});
    run(["--schema"], t.io);
    const objects = JSON.parse(t.out()).map((o: { object: string }) => o.object);
    for (const name of ["plan", "room", "outdoor", "void", "opening", "opening.on", "opening.position", "fixture", "vertical", "vertical.footprint", "walls", "grid", "layout", "level"])
      assert.ok(objects.includes(name), `--schema is missing ${name}`);
  });

  it("--schema=md prints a Markdown table per object and needs no input file", () => {
    const t = fakeIo({});
    assert.equal(run(["--schema=md"], t.io), 0);
    assert.match(t.out(), /^## plan\b/m);
    assert.match(t.out(), /^## room\b/m);
    assert.match(t.out(), /\| field \| type \| required \| enum \| doc \|/);
  });
});

describe("cli: set", () => {
  it("splices a door width, writes the file, and prints the new findings", () => {
    // openings[1] (door a↔b, 0.8 m) is above the 0.7 m interior minimum, so `clean`
    // has no findings; narrowing it below that trips door.min_width.
    const t = fakeIo({ "plan.json": clean });
    assert.equal(run(["set", "plan.json", "openings[1].width", "0.5"], t.io), 1);
    assert.match(t.out(), /door\.min_width/);
    assert.equal(JSON.parse(t.written["plan.json"]!).openings[1].width, 0.5);
  });

  it("treats a value that is not valid JSON as a string", () => {
    const t = fakeIo({ "plan.json": clean });
    assert.equal(run(["set", "plan.json", "rooms.a.name", "Sala"], t.io), 0);
    assert.equal(JSON.parse(t.written["plan.json"]!).rooms.a.name, "Sala");
  });

  it("refuses to write a value that fails schema, and reports why", () => {
    const t = fakeIo({ "plan.json": clean });
    assert.equal(run(["set", "plan.json", "rooms.a.kind", "potato"], t.io), 2);
    assert.equal(t.written["plan.json"], undefined, "file must be left untouched");
    assert.match(t.err(), /unknown kind/);
  });

  it("--json reports a JsonPosError as a JSON envelope with line/column, file untouched", () => {
    const t = fakeIo({ "plan.json": clean });
    assert.equal(run(["set", "plan.json", "nope.field", "1", "--json"], t.io), 2);
    assert.equal(t.written["plan.json"], undefined);
    const parsed = JSON.parse(t.out());
    assert.match(parsed.error.message, /no value at nope\.field/);
    assert.equal(typeof parsed.error.line, "number");
  });

  it("--dry-run prints the new text without writing", () => {
    const t = fakeIo({ "plan.json": clean });
    const status = run(["set", "plan.json", "openings[1].width", "0.5", "--dry-run"], t.io);
    assert.equal(t.written["plan.json"], undefined, "dry-run must not write");
    assert.equal(JSON.parse(t.out()).openings[1].width, 0.5);
    assert.equal(status, 1, "exit code still reflects findings under dry-run");
  });
});

describe("cli: patch", () => {
  const threeOps = JSON.stringify([
    { op: "set", path: "walls.exterior", value: 0.35 },
    { op: "append", path: "openings", value: { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1.0 } },
    { op: "insert", path: "", key: "_note", value: "patched" },
  ]);

  it("applies three ops in order and writes once", () => {
    const t = fakeIo({ "plan.json": clean, "patch.json": threeOps });
    const status = run(["patch", "plan.json", "patch.json"], t.io);
    assert.notEqual(status, 2, t.err());
    const patched = JSON.parse(t.written["plan.json"]!);
    assert.equal(patched.walls.exterior, 0.35);
    assert.equal(patched.openings.length, JSON.parse(clean).openings.length + 1);
    assert.deepEqual(patched.openings.at(-1), { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1 });
    assert.equal(patched._note, "patched");
  });

  it("a failing second op leaves the file untouched and names the op", () => {
    const patch = JSON.stringify([
      { op: "set", path: "walls.exterior", value: 0.35 },
      { op: "set", path: "nope.field", value: 1 },
      { op: "set", path: "title", value: "should not apply" },
    ]);
    const t = fakeIo({ "plan.json": clean, "patch.json": patch });
    assert.equal(run(["patch", "plan.json", "patch.json"], t.io), 2);
    assert.equal(t.written["plan.json"], undefined);
    assert.match(t.err(), /op 1/);
    assert.match(t.err(), /nope\.field/);
  });

  it("--json reports the failing op with its line/column", () => {
    const patch = JSON.stringify([{ op: "set", path: "nope.field", value: 1 }]);
    const t = fakeIo({ "plan.json": clean, "patch.json": patch });
    assert.equal(run(["patch", "plan.json", "patch.json", "--json"], t.io), 2);
    assert.equal(t.written["plan.json"], undefined);
    const parsed = JSON.parse(t.out());
    assert.equal(parsed.error.op, 0);
    assert.equal(parsed.error.kind, "set");
    assert.equal(typeof parsed.error.line, "number");
    assert.equal(typeof parsed.error.column, "number");
  });

  it("refuses to write when the patched result fails schema", () => {
    const patch = JSON.stringify([{ op: "set", path: "rooms.a.kind", value: "potato" }]);
    const t = fakeIo({ "plan.json": clean, "patch.json": patch });
    assert.equal(run(["patch", "plan.json", "patch.json"], t.io), 2);
    assert.equal(t.written["plan.json"], undefined);
    assert.match(t.err(), /unknown kind/);
  });

  it("reads the patch document from stdin with --patch -", () => {
    const t = fakeIo({ "plan.json": clean }, threeOps);
    const status = run(["patch", "plan.json", "--patch", "-"], t.io);
    assert.notEqual(status, 2, t.err());
    assert.equal(JSON.parse(t.written["plan.json"]!).walls.exterior, 0.35);
  });

  it("--dry-run prints the new text without writing", () => {
    const t = fakeIo({ "plan.json": clean, "patch.json": threeOps });
    run(["patch", "plan.json", "patch.json", "--dry-run"], t.io);
    assert.equal(t.written["plan.json"], undefined);
    assert.equal(JSON.parse(t.out()).walls.exterior, 0.35);
  });
});

describe("cli: set/patch through bin.ts (real process, temp copy of a fixture)", () => {
  let dir: string;
  let planPath: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "floorplan-cli-"));
    planPath = join(dir, "casa-t3.json");
    copyFileSync(new URL("../fixtures/casa-t3.json", import.meta.url), planPath);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("set writes the change to the real file on disk", () => {
    const res = spawnSync(
      process.execPath,
      ["src/bin.ts", "set", planPath, "openings[0].position.distance", "2.0"],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    assert.equal(res.status, 1, res.stderr); // casa-t3 still has its usual warnings/info
    assert.match(res.stdout, /habitable\.no_window|wet\.no_window|circulation\.share/);
    const written = readFileSync(planPath, "utf8");
    assert.equal(JSON.parse(written).openings[0].position.distance, 2.0);
    // formatting outside the edited value is untouched: the document is still in its
    // canonical form once the edited number is put back
    const original = readFileSync(new URL("../fixtures/casa-t3.json", import.meta.url), "utf8");
    assert.equal(written.replace('"distance":2.0', '"distance":1.7'), original);
  });
});
