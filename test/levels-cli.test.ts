import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyze, parse, schedule } from "../src/index.ts";
import { run } from "../src/cli.ts";
import type { CliIo } from "../src/cli.ts";
import { twoStoreys } from "./helpers.ts";

describe("levels: schedule and CLI", () => {
  it("adds per-level sections and building totals", () => {
    const s = schedule(analyze(parse(twoStoreys())).model);
    assert.deepEqual(s.levels!.map((l) => l.id), ["baixo", "cima"]);
    assert.equal(s.rooms.length, s.levels![0]!.rooms.length, "the top-level rows stay the ground level's");
    assert.equal(s.building!.storeys, 2);
    assert.equal(s.building!.interiorArea, s.levels!.reduce((t, l) => t + l.interiorArea, 0));
  });

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
      readStdin: () => "",
    };
    return { io, out: () => out.join(""), err: () => err.join(""), written };
  }
  const plan = JSON.stringify(twoStoreys());

  it("--level picks the storey to draw", () => {
    const t = fakeIo({ "p.json": plan });
    assert.equal(run(["p.json", "--level", "cima"], t.io), 0);
    assert.ok(t.out().includes("Quarto"));
    assert.ok(!t.out().includes("Sala"));
  });

  it("--level rejects an id the plan does not have", () => {
    const t = fakeIo({ "p.json": plan });
    assert.equal(run(["p.json", "--level", "cave"], t.io), 2);
    assert.match(t.err(), /unknown level cave; this plan has baixo, cima/);
  });

  it("--out expands {level} into one sheet per storey", () => {
    const t = fakeIo({ "p.json": plan });
    run(["p.json", "--out", "plan-{level}.svg"], t.io);
    assert.deepEqual(Object.keys(t.written).sort(), ["plan-baixo.svg", "plan-cima.svg"]);
    assert.ok(t.written["plan-cima.svg"]!.startsWith("<svg "));
  });

  it("--out without the placeholder writes the one selected level", () => {
    const t = fakeIo({ "p.json": plan });
    run(["p.json", "--out", "x.svg", "--level", "cima"], t.io);
    assert.deepEqual(Object.keys(t.written), ["x.svg"]);
    assert.ok(t.written["x.svg"]!.includes("Quarto"));
  });

  it("--lint prefixes each finding with its level once there is more than one", () => {
    const t = fakeIo({ "p.json": JSON.stringify(twoStoreys({ vertical: [] })) });
    assert.equal(run(["p.json", "--lint"], t.io), 1);
    assert.match(t.out(), /\bcima\s+error\s+level\.unreachable/);
  });

  it("--json carries the level on findings and the sections in the schedule", () => {
    const t = fakeIo({ "p.json": plan });
    run(["p.json", "--json"], t.io);
    const parsed = JSON.parse(t.out());
    assert.ok(Array.isArray(parsed.schedule.levels));
    assert.equal(parsed.schedule.building.storeys, 2);
  });
});
