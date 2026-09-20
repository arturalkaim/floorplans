// B2: every finding carries the JSON path of the thing the rule is about.
//
// The contract is stronger than "there is a string": the path must address a node that
// *exists in the source document*, so `floorplan set <plan> <finding.path> <value>` can
// never fail on a path this library emitted. That is why the path is derived from the
// parsed document and not from a template (docs/gaps-design.md §2.5, W3a instruction (a)).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { run } from "../src/cli.ts";
import type { CliIo } from "../src/cli.ts";
import { floorplan, nodeAt, parseWithPositions } from "../src/index.ts";
import type { Finding } from "../src/types.ts";
import { twoRooms, twoStoreys } from "./helpers.ts";

const FIXTURES = new URL("../fixtures/", import.meta.url);
const fixtureNames = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

/** `"levels.piso1.openings[3].width"` → `["levels","piso1","openings",3,"width"]` */
function toJsonPath(s: string): Array<string | number> {
  const path: Array<string | number> = [];
  for (const part of s.split(".")) {
    for (const [, key, idx] of part.matchAll(/([^[\]]+)|\[(\d+)\]/g)) {
      if (key !== undefined) path.push(key);
      else path.push(Number(idx));
    }
  }
  return path;
}

function fakeIo(files: Record<string, string>) {
  const out: string[] = [];
  const written: Record<string, string> = {};
  const io: CliIo = {
    stdout: (s) => out.push(s),
    stderr: () => {},
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
  return { io, out: () => out.join(""), written };
}

describe("finding paths address a node that is really in the document", () => {
  for (const name of fixtureNames) {
    it(`${name}: every path resolves`, () => {
      const text = readFileSync(new URL(name, FIXTURES), "utf8");
      const findings = floorplan(text).findings;
      assert.ok(findings.length >= 0);
      const doc = parseWithPositions(text);
      for (const f of findings) {
        assert.equal(typeof f.path, "string", `${f.rule} has no path`);
        assert.ok(f.path.length > 0, `${f.rule} has an empty path`);
        const path = toJsonPath(f.path);
        if (nodeAt(doc, path) !== undefined) continue;
        // a finding about an absence may name a collection the document has not got yet
        // (`voids` on a level with none); it may never be deeper than one new key, so one
        // `patch` `insert` is always enough to act on it
        assert.ok(
          nodeAt(doc, path.slice(0, -1)) !== undefined,
          `${name}: ${f.rule} points at ${f.path}, and neither it nor its parent is in the document`,
        );
      }
    });
  }
});

describe("finding paths name the field only when the author wrote it", () => {
  const openings = [
    { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: true },
    // no `position`: it defaults to "center", so there is no node to splice
    { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1 },
    { type: "window", between: ["exterior", "a"], on: { room: "a", side: "north" }, width: 1, position: 2.2 },
  ];

  it("stops at the entity when the field defaulted, and names it when it did not", () => {
    const { findings } = floorplan(twoRooms({ openings }));
    const collisions = findings.filter((f) => f.rule === "opening.collision");
    assert.equal(collisions.length, 1);
    // openings[2] authored `position`, so the path may name it
    assert.equal(collisions[0]!.path, "openings[2].position");
  });

  it("names the geometry the author chose: rect for one document, poly for the other", () => {
    const viaRect = floorplan({
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: { a: { kind: "living", rect: [0, 0, 6, 1.5] } },
      openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: true }],
    });
    const viaPoly = floorplan({
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: { a: { kind: "living", poly: [[0, 0], [6, 0], [6, 1.5], [0, 1.5]] } },
      openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: true }],
    });
    const dim = (r: { findings: Finding[] }) => r.findings.find((f) => f.rule === "room.min_dimension")!.path;
    assert.equal(dim(viaRect), "rooms.a.rect");
    assert.equal(dim(viaPoly), "rooms.a.poly");
  });
});

describe("finding paths under levels", () => {
  it("a single-level document's paths carry no prefix", () => {
    for (const f of floorplan(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8 }] })).findings)
      assert.ok(!f.path.startsWith("levels."), `${f.rule}: ${f.path}`);
  });

  it("a levelled document's per-level findings are prefixed with their own level", () => {
    const doc = twoStoreys({ vertical: [] });
    const findings = floorplan(doc).findings.filter((f) => f.level !== undefined);
    assert.ok(findings.length > 0);
    for (const f of findings) {
      // a finding may legitimately point at `vertical`, which lives at the document root
      if (f.path === "vertical" || f.path.startsWith("vertical[")) continue;
      assert.ok(f.path.startsWith(`levels.${f.level}.`), `${f.rule}: ${f.path} is not under levels.${f.level}`);
    }
  });
});

describe("structured fix data repeats what the prose already says", () => {
  it("wall.ambiguous lists the candidate segments with their sides and endpoints", () => {
    const { findings } = floorplan({
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: {
        l: { kind: "living", poly: [[0, 0], [4, 0], [4, 4], [2, 4], [2, 2], [0, 2]] },
        k: { kind: "kitchen", poly: [[0, 2], [2, 2], [2, 4], [0, 4]] },
      },
      openings: [
        { type: "door", between: ["exterior", "l"], on: { room: "l", side: "north" }, width: 0.9, entrance: true },
        { type: "door", between: ["l", "k"], width: 0.8 },
      ],
    });
    const f = findings.find((x) => x.rule === "wall.ambiguous")!;
    assert.ok(f, findings.map((x) => x.rule).join(", "));
    assert.equal(f.candidates!.length, 2);
    for (const c of f.candidates!) {
      assert.match(c.wall, /^w\d+$/);
      assert.equal(c.from.length, 2);
      assert.ok(["north", "south", "east", "west"].includes(c.side!));
      // every candidate the prose lists is really in the message
      assert.ok(f.message.includes(String(c.side)));
    }
  });

  it("room.min_dimension carries the three numbers the message states", () => {
    const f = floorplan({
      walls: { exterior: 0.3, partition: 0.12 },
      rooms: { a: { kind: "living", rect: [0, 0, 6, 1.5] } },
      openings: [{ type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: true }],
    }).findings.find((x) => x.rule === "room.min_dimension")!;
    assert.equal(f.minimum, 3);
    assert.ok(f.message.includes(`${f.measured} m at its narrowest`));
    assert.ok(f.message.includes(`clear floor ${f.rect![2]} × ${f.rect![3]} m`));
  });
});

describe("set accepts a finding's path verbatim", () => {
  it("edits the node a finding pointed at, and the plan still parses", () => {
    const text = JSON.stringify(twoRooms({ openings: [{ type: "door", between: ["a", "b"], width: 0.8 }] }), null, 2);
    const f = floorplan(text).findings.find((x) => x.rule === "space.no_access" || x.rule === "reach.unreachable" || x.path.startsWith("rooms."))!;
    assert.ok(f, "expected a finding about a room");
    const t = fakeIo({ "plan.json": text });
    // `rooms.a` is a container, so an agent appends the field it means to change — which
    // is exactly what the path is for: it is a cursor into the document, not a full address
    assert.notEqual(run(["set", "plan.json", `${f.path}.name`, "Sala"], t.io), 2);
    assert.equal(JSON.parse(t.written["plan.json"]!).rooms[f.path.split(".")[1]!].name, "Sala");
  });

  it("edits an opening's width straight from the path a finding gave", () => {
    const doc = twoRooms({
      openings: [
        { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: true },
        { type: "door", between: ["a", "b"], width: 0.5 },
      ],
    });
    const text = JSON.stringify(doc, null, 2);
    const f = floorplan(text).findings.find((x) => x.rule === "door.min_width")!;
    assert.equal(f.path, "openings[1].width");
    const t = fakeIo({ "plan.json": text });
    assert.notEqual(run(["set", "plan.json", f.path, "0.9"], t.io), 2, t.out());
    assert.equal(JSON.parse(t.written["plan.json"]!).openings[1].width, 0.9);
    // and the finding it came from is gone
    assert.ok(!floorplan(t.written["plan.json"]!).findings.some((x) => x.rule === "door.min_width"));
  });
});
