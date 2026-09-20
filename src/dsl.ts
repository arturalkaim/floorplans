// The line-oriented DSL: the authoring front-end. JSON stays the canonical model and
// interchange — this module only turns text into the *same JSON document shape* the JSON
// parser already accepts, and back again.
//
//   parseDsl(text) → { doc, positions }   →   parse(doc)   →   Plan
//   toDsl(doc)     → text                                      (the canonical printer)
//
// Every schema rule therefore lives in exactly one place (src/parse.ts). What this file
// owns is the *spelling*: how a door, a room or a level is written on one line, where each
// value sits in that line, and how to write a new value back into it without disturbing
// anything else.
//
// Why a second syntax at all (docs/agent-review.md §C, measured): casa-t3 is 1 501 tokens
// as canonical JSON and 733 in this grammar. 55 % of a plan's tokens are its openings, and
// one door costs 61 tokens as JSON against 14 here. The ratio holds for the two things
// that are coming — arcs (§1.5) and levels (§2.6) — because an arc is one more token
// inside `poly` and a level is a section *header*, not a nesting level.
//
// Three properties, all tested in test/dsl.test.ts:
//
//   1. `toDsl(parseDsl(t).doc) === t` for canonical `t` — the printer is the inverse of
//      the parser on its own output, byte for byte.
//   2. `parseDsl(toDsl(x)).doc` deep-equals `x` for every `x` the parser produced — no
//      value is lost on the way out.
//   3. `parse(parseDsl(toDsl(doc)).doc)` deep-equals `parse(doc)` for any JSON document —
//      the printer preserves *meaning*, not the author's choice between synonyms. JSON has
//      pairs of spellings that `parse()` folds together (`"position": 2` and
//      `{"from":"start","distance":2}`; `"position":"center"` and no `position` at all),
//      and the DSL deliberately has only one spelling for each, so a conversion picks it.
//
// The grammar is DSL_SCHEMA below, and it is the single source of the `--schema=dsl`
// table, the README section and the app's reference page — there is no hand-written prose
// copy of it anywhere, for the same reason SCHEMA has none (docs/agent-review.md B10).

import { FIXTURE_TYPES, OPENING_TYPES, ROOM_KINDS, SCHEMA, SIDES, VERTICAL_TYPES } from "./parse.ts";
import type { ObjectDoc } from "./parse.ts";

// ---------------------------------------------------------------------------
// the grammar, machine-readable
// ---------------------------------------------------------------------------

export interface DslTokenDoc {
  /** how the token is written, e.g. `w<width>` or `hinge:start|end` */
  token: string;
  /** the SCHEMA field it writes, as `<object>.<field>` — the coverage test walks these */
  field: string;
  required: boolean;
  doc: string;
}

export interface DslStatementDoc {
  /** the statement's leading verb, or the set of verbs that introduce it */
  statement: string;
  /** the whole line, `[…]` around what may be left out */
  syntax: string;
  doc: string;
  tokens: readonly DslTokenDoc[];
  /**
   * True for a thing that is not a line of its own but an element inside another
   * statement's token — today only `arc`, which lives inside a `poly`. It is in this
   * table so the coverage test can see the SCHEMA fields it writes, and the grammar
   * printer lists it under "poly elements" rather than among the statements.
   */
  element?: boolean;
  /**
   * A concrete worked snippet, printed between `syntax` and `doc` — before the prose, not
   * after it, so the shape it demonstrates cannot be skimmed past as a parenthetical. Only
   * the "stairs | lift | ramp" statement has one: `docs/eval/cold/cold-run.md` found 4 of 20
   * cold-agent DSL authors wrote a single `at` line for a multi-level stair despite the
   * syntax's own "(one indented line per level served)" aside, because a sentence about
   * cardinality is exactly the fact a worked example removes any doubt about.
   */
  example?: string;
}

const GEOM = "rect <x>,<y> <w>x<h> | poly <x>,<y> …";

/** An `arc` element inside a `poly`, spelled out once for the grammar table and the docs. */
export const ARC_SYNTAX = "arc <x>,<y> r<radius> [cw|ccw] [large]";

/**
 * Every statement kind, with every token it accepts and the SCHEMA field that token
 * writes. `test/dsl-schema.test.ts` walks SCHEMA and fails if a field has no token here,
 * so a field added to the parser without a DSL spelling cannot ship.
 */
export const DSL_SCHEMA: readonly DslStatementDoc[] = [
  {
    statement: "plan",
    syntax: 'plan ["Title"] [units:m] [walls <ext>/<part>] [north <deg>] [stack <id>,…]',
    doc: "document header; every part is optional, so a plan may have no plan line at all",
    tokens: [
      { token: '"Title"', field: "plan.title", required: false, doc: "display name" },
      { token: "units:m", field: "plan.units", required: false, doc: 'only "m"' },
      { token: "walls <ext>/<part>", field: "plan.walls", required: false, doc: "wall thicknesses, metres; same as the walls statement" },
      { token: "north <deg>", field: "plan.north", required: false, doc: 'bearing of "up"; same as the north statement' },
      { token: "stack <id>,…", field: "plan.stack", required: false, doc: "ground-up level order" },
    ],
  },
  {
    statement: "walls",
    syntax: "walls <ext>/<part> | walls exterior:<n> | walls partition:<n>",
    doc: "wall thicknesses; the canonical printer folds this onto the plan line",
    tokens: [
      { token: "<ext>", field: "walls.exterior", required: false, doc: "metres; default 0.3" },
      { token: "<part>", field: "walls.partition", required: false, doc: "metres; default 0.12" },
    ],
  },
  {
    statement: "north",
    syntax: "north <deg>",
    doc: 'bearing of "up" in degrees; the canonical printer folds this onto the plan line',
    tokens: [{ token: "<deg>", field: "plan.north", required: true, doc: "degrees clockwise from north" }],
  },
  {
    statement: "grid",
    syntax: "grid cols <n>,… rows <n>,…",
    doc: "the shared track grid every level's layout may sit on",
    tokens: [
      { token: "grid", field: "plan.grid", required: false, doc: "the statement itself" },
      { token: "cols <n>,…", field: "grid.cols", required: true, doc: "column widths, metres, left→right" },
      { token: "rows <n>,…", field: "grid.rows", required: true, doc: "row heights, metres, top→bottom" },
    ],
  },
  {
    statement: "level",
    syntax: 'level <id> ["Name"] [h<height>] [ground]',
    /**
     * Two levels, each with one room, and a door on the first that a careless read could
     * misfile under the second (docs/eval/cold2/cold-run.md, briefs 7/8/20: 3 of 7 DSL
     * parse failures in that eval were a ground-floor door written after the *next*
     * level's header, despite the doc sentence already saying the rule — a sentence about
     * ordering is exactly the fact a worked example removes any doubt about). Shown, then
     * told: the doc sentence below states the rule this snippet demonstrates.
     */
    example: "    e.g. level ground\n         room hall rect 0,0 2x2\n         door hall.south w0.9 entrance\n         level first\n         room bed rect 0,0 3x3",
    doc: "a storey header: statements belong to the most recent level line, until the next one",
    tokens: [
      { token: "<id>", field: "plan.levels", required: true, doc: "level id; its presence makes the document multi-level" },
      { token: '"Name"', field: "level.name", required: false, doc: "display name; default the id" },
      { token: "h<height>", field: "level.height", required: false, doc: "floor-to-floor, metres" },
      { token: "ground", field: "level.ground", required: false, doc: "street meets this level; `ground:false` to deny it" },
    ],
  },
  {
    statement: "room",
    // `[<kind> [<zone>]]` nests the zone inside the kind's own brackets, not beside them —
    // a bare zone word is only readable once a kind precedes it (parser INVARIANT above);
    // a room with no kind writes `zone:<z>` instead (docs/eval/cold2/cold-run.md gap 2: the
    // old `[<kind>] [<zone>]` template showed the two as independently optional, which is
    // exactly what the parser's own error text — "a zone is written zone:<z>" — contradicts).
    syntax: `room <id> ["Name"] [<kind> [<zone>]] [${GEOM}] [habitable] [wet] [circulation]`,
    doc: "one room; the two bare words are the kind then the zone, in that order — the kind must be a real one, and a zone with no kind is written zone:<z>",
    tokens: [
      { token: "<id>", field: "level.rooms", required: true, doc: "room id, unique on its level" },
      { token: '"Name"', field: "room.name", required: false, doc: "display name; default the id" },
      { token: "<kind>", field: "room.kind", required: false, doc: "one of the room kinds, and a word that is not one is an error, not a zone; default other" },
      { token: "<zone>", field: "room.zone", required: false, doc: "fill-colour label, after the kind; zone:<z> when the room has no kind" },
      { token: "rect <x>,<y> <w>x<h>", field: "room.rect", required: false, doc: "metres" },
      { token: "poly <x>,<y> …", field: "room.poly", required: false, doc: "corners; may contain arc tokens" },
      { token: "habitable", field: "room.habitable", required: false, doc: "override; `habitable:false` to deny it" },
      { token: "wet", field: "room.wet", required: false, doc: "override; `wet:false` to deny it" },
      { token: "circulation", field: "room.circulation", required: false, doc: "override; `circulation:false` to deny it" },
    ],
  },
  {
    statement: "outdoor",
    syntax: `outdoor <id> ["Name"] [covered] [${GEOM}]`,
    doc: "a terrace, courtyard or garden: outside, but not the street",
    tokens: [
      { token: "<id>", field: "level.outdoor", required: true, doc: "id, unique on its level" },
      { token: '"Name"', field: "outdoor.name", required: false, doc: "display name; default the id" },
      { token: "covered", field: "outdoor.covered", required: false, doc: "roofed terrace or porch; `covered:false` to deny it" },
      { token: "rect <x>,<y> <w>x<h>", field: "outdoor.rect", required: false, doc: "metres" },
      { token: "poly <x>,<y> …", field: "outdoor.poly", required: false, doc: "corners; may contain arc tokens" },
    ],
  },
  {
    statement: "void",
    syntax: `void <id> ["Name"] [${GEOM}]`,
    doc: "a hole in this storey's floor: a stairwell, or the void over a double-height room",
    tokens: [
      { token: "<id>", field: "level.voids", required: true, doc: "id, unique on its level" },
      { token: '"Name"', field: "void.name", required: false, doc: "display name; default the id" },
      { token: "rect <x>,<y> <w>x<h>", field: "void.rect", required: false, doc: "metres" },
      { token: "poly <x>,<y> …", field: "void.poly", required: false, doc: "corners; may contain arc tokens" },
    ],
  },
  {
    statement: "layout",
    syntax: "layout [cols <n>,…] [rows <n>,…]\n        <cell> <cell> …   (one indented row per grid row)",
    // `stairs` also spans indented lines (docs/eval/cold2/cold-run.md gap 4: calling this
    // "the one multi-line statement" contradicted the very next worked example), so the doc
    // no longer claims uniqueness — only what the picture means.
    example: "    e.g. layout cols 3,3 rows 3,3\n           a a\n           . b",
    doc: 'an ASCII picture placing already-declared spaces on the track grid; the same id in several cells is one space spanning them, "." is empty',
    tokens: [
      { token: "layout", field: "level.layout", required: false, doc: "the statement itself" },
      { token: "cols <n>,…", field: "layout.cols", required: false, doc: "column widths; omit to sit on the shared grid" },
      { token: "rows <n>,…", field: "layout.rows", required: false, doc: "row heights; omit to sit on the shared grid" },
      { token: "  <cell> …", field: "layout.areas", required: true, doc: 'indented rows; a cell is a space id or "." for empty' },
    ],
  },
  {
    statement: "door | window | cased",
    syntax:
      "<type> <a>><b> | <type> <room>[.<side>]   [@<d> | @-<d> | at <x>,<y>]  w<width>\n" +
      "        [on:<room>[.<side>]] [near:<x>,<y>] [hinge:start|end] [swing:<space>] [entrance] [glazed] [id:<id>]",
    // The `<room>[.<side>]` short form's implicit `on` cannot combine with an explicit
    // `at` — the same exclusion JSON's `oneOf: "on"/"position" xor "at"` already states, but
    // nothing on the DSL side did (docs/eval/cold2/cold-run.md gap 5): brief 1's cold-agent
    // author wrote `door studio.south at:2,4 w0.9` and only learned of the conflict from
    // the parser's own `schema.conflict` finding, not from either reference.
    doc: 'one opening. `<room>[.<side>]` alone is short for `exterior><room>` with an `on`; that implicit `on` cannot combine with an explicit `at` — same rule as JSON\'s oneOf: "on"/"position" xor "at"',
    tokens: [
      { token: "<type>", field: "opening.type", required: true, doc: "the verb: door, window or cased (an archway)" },
      { token: "<a>><b>", field: "level.openings", required: true, doc: "the statement itself, one opening" },
      { token: "<a>><b>", field: "opening.between", required: true, doc: 'the two spaces; "exterior" is the street' },
      { token: "w<width>", field: "opening.width", required: true, doc: "metres, > 0" },
      { token: "@<d>", field: "opening.position", required: false, doc: "metres from the wall run's start to the centre; omit for centred" },
      { token: "@-<d>", field: "opening.position.distance", required: false, doc: "the metres, measured from the run's end" },
      { token: "@-<d>", field: "opening.position.from", required: false, doc: "the minus means measured from the run's end" },
      // accepted for one release, no error: `at:<x>,<y>` was the canonical spelling before
      // this fix unified it with fixture/vertical's bare `at <x>,<y>` (docs/eval/cold2/
      // cold-run.md gap 3 — the same word spelled two ways in the same document).
      { token: "at <x>,<y>", field: "opening.at", required: false, doc: "absolute placement; picks the nearest shared wall; `at:<x>,<y>` still parses" },
      { token: "on:<room>", field: "opening.on", required: false, doc: "which wall, when the two spaces share more than one" },
      { token: "on:<room>", field: "opening.on.room", required: false, doc: "one of the two spaces" },
      { token: "on:<room>.<side>", field: "opening.on.side", required: false, doc: "north | south | east | west" },
      { token: "near:<x>,<y>", field: "opening.on.near", required: false, doc: "pick the candidate wall nearest this point" },
      { token: "hinge:start|end", field: "opening.hinge", required: false, doc: "doors only; default start" },
      { token: "swing:<space>", field: "opening.swingInto", required: false, doc: "doors only; which side the leaf sweeps" },
      { token: "entrance", field: "opening.entrance", required: false, doc: "doors only; marks the main entrance" },
      { token: "glazed", field: "opening.glazed", required: false, doc: "doors only; counts as daylight" },
      { token: "id:<id>", field: "opening.id", required: false, doc: "authored id; otherwise one is synthesised" },
    ],
  },
  {
    statement: "fixture",
    syntax: 'fixture <type> in:<space> (at <x>,<y> size <w>x<h> | poly <x>,<y> …) ["Name"] [depth:<n>] [id:<id>]',
    doc: "a thing standing in a space: a pool, a bath, a counter",
    tokens: [
      { token: "fixture", field: "level.fixtures", required: true, doc: "the statement itself, one fixture" },
      { token: "<type>", field: "fixture.type", required: true, doc: "one of the fixture types" },
      { token: "in:<space>", field: "fixture.in", required: true, doc: "the room or outdoor space it stands in" },
      { token: "at <x>,<y>", field: "fixture.at", required: false, doc: "top-left corner, metres" },
      { token: "size <w>x<h>", field: "fixture.size", required: false, doc: "width and height, metres" },
      { token: "poly <x>,<y> …", field: "fixture.poly", required: false, doc: "explicit outline instead of at + size" },
      { token: '"Name"', field: "fixture.name", required: false, doc: "display name; default the capitalised type" },
      { token: "depth:<n>", field: "fixture.depth", required: false, doc: "metres; shown on the label only" },
      { token: "id:<id>", field: "fixture.id", required: false, doc: "authored id; otherwise one is synthesised" },
    ],
  },
  {
    statement: "stairs | lift | ramp",
    // Spaced pipes, matching how `statement` itself spells the same three-way choice —
    // unspaced would read byte-identical to `VERTICAL_TYPES.join("|")` and double-count in
    // the shared legend `vocabLegend()` prints (the token entries below stay unspaced;
    // they are the compact machine form the field index uses, not this display line).
    syntax:
      'stairs | lift | ramp <id> ["Name"] [up:<deg>] [risers:<n>]   (or: vertical <id> <type> …)\n' +
      `        at <level> in:<space> ${GEOM}      (one indented line per level served)`,
    example: "    e.g. stairs main\n           at ground in:hall rect 3.6,0.4 1.2x3\n           at first in:landing rect 3.6,0.4 1.2x3",
    doc: "vertical circulation: the only entity that spans levels, joined by its id and never by overlap — one `at` line per level it serves, never one line per element",
    tokens: [
      { token: "stairs|lift|ramp", field: "plan.vertical", required: false, doc: "the statement itself" },
      { token: "stairs|lift|ramp", field: "vertical.type", required: true, doc: "the verb is the type" },
      { token: "<id>", field: "vertical.id", required: true, doc: "id; the same element on every level it serves" },
      { token: '"Name"', field: "vertical.name", required: false, doc: "display name; default the capitalised type" },
      { token: "up:<deg>", field: "vertical.up", required: false, doc: "bearing going up; needed for stair.headroom" },
      { token: "risers:<n>", field: "vertical.risers", required: false, doc: "whole number ≥ 2; drives stair.pitch" },
      { token: "  at <level> …", field: "vertical.at", required: true, doc: "one indented footprint line per level served" },
      { token: "  at <level>", field: "vertical.footprint.level", required: true, doc: "a level declared in this document" },
      { token: "in:<space>", field: "vertical.footprint.in", required: true, doc: "the space to step off into on that level" },
      { token: "rect <x>,<y> <w>x<h>", field: "vertical.footprint.rect", required: false, doc: "metres" },
      { token: "poly <x>,<y> …", field: "vertical.footprint.poly", required: false, doc: "explicit footprint" },
    ],
  },
  {
    statement: "arc",
    element: true,
    syntax: `  ${ARC_SYNTAX}`,
    doc: "inside a poly: a circular edge from the previous corner round to <x>,<y>",
    tokens: [
      { token: "<x>,<y>", field: "arc.arc", required: true, doc: "where the arc ends; it starts at the previous corner" },
      { token: "r<radius>", field: "arc.r", required: true, doc: "radius, metres; at least half the chord" },
      { token: "cw|ccw", field: "arc.sweep", required: true, doc: "which way it turns on the page, y growing south; default cw" },
      { token: "large", field: "arc.large", required: false, doc: "the arc longer than a half circle; default the minor one" },
    ],
  },
  {
    statement: "# comment",
    syntax: "# anything after a # is ignored, as is a blank line",
    doc: "comments and blank lines are not part of the document and are dropped by the printer",
    tokens: [],
  },
];

/**
 * Resolves the one thing neither reference showed a worked example of (docs/eval/cold2/
 * cold-run.md gap 7): whether a `poly`'s corners sit on the entity's own line or in an
 * indented block below it, the way `layout`'s cells and a `vertical`'s footprints do. They
 * are inline; this is the concrete counter-example to that guess, not a restatement of the
 * abstract per-element grammar below it.
 */
export const POLY_INLINE_EXAMPLE = "a poly's corners are inline on the entity's own line, never an indented block: outdoor deck poly 0,0 5,0 5,2 0,2";

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

export interface DslIssue {
  /** 1-based */
  line: number;
  /** 1-based */
  column: number;
  /** already prefixed with `line N: ` — the house style for a text-position error */
  message: string;
}

export class DslError extends Error {
  readonly issues: DslIssue[];
  constructor(issues: DslIssue[]) {
    super(issues.map((i) => i.message).join("\n"));
    this.name = "DslError";
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// positions
// ---------------------------------------------------------------------------

/**
 * Where one JSON path's value sits in the DSL text, and how to write a new one there.
 * The line-based twin of a `jsonpos` node: `start`/`end` are absolute character offsets,
 * so a splice is the same operation it is for JSON, and `line` is what a finding carries
 * so an agent can act on the line rather than reconstruct it.
 */
export interface DslSpan {
  line: number;
  column: number;
  start: number;
  end: number;
  /** render a replacement JSON value as the DSL text for this span */
  write: (value: unknown) => string;
}

/** JSON path (as `pathToString` writes it) → where it is in the text. */
export type DslPositions = Map<string, DslSpan>;

export interface DslDocument {
  /** the JSON document, exactly the shape `parse()` accepts */
  doc: Record<string, unknown>;
  positions: DslPositions;
}

// ---------------------------------------------------------------------------
// value printing
// ---------------------------------------------------------------------------

type J = Record<string, unknown>;

const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Shortest round-trip, which is what `String(number)` already gives in JS. */
export const numText = (n: unknown): string => {
  if (!isNum(n)) throw new TypeError(`expected a number, got ${JSON.stringify(n)}`);
  return String(n);
};

const quote = (s: unknown): string => JSON.stringify(String(s));

const pointText = (v: unknown): string => {
  if (!Array.isArray(v) || v.length !== 2) throw new TypeError(`expected [x, y], got ${JSON.stringify(v)}`);
  return `${numText(v[0])},${numText(v[1])}`;
};

const sizeText = (v: unknown): string => {
  if (!Array.isArray(v) || v.length !== 2) throw new TypeError(`expected [width, height], got ${JSON.stringify(v)}`);
  return `${numText(v[0])}x${numText(v[1])}`;
};

const rectText = (v: unknown): string => {
  if (!Array.isArray(v) || v.length !== 4) throw new TypeError(`expected [x, y, width, height], got ${JSON.stringify(v)}`);
  return `${numText(v[0])},${numText(v[1])} ${numText(v[2])}x${numText(v[3])}`;
};

const listText = (v: unknown): string => {
  if (!Array.isArray(v)) throw new TypeError(`expected a list, got ${JSON.stringify(v)}`);
  return v.map((n) => (typeof n === "number" ? numText(n) : String(n))).join(",");
};

/**
 * One `poly` element: a point, or an arc to the next point. The arc form is
 * `{ arc: [x,y], r, sweep?, large? }` (docs/gaps-design.md §1.2) and is in the grammar
 * from day one precisely so that retro-fitting it would not change the `poly` production.
 */
const polyElementText = (v: unknown): string => {
  if (isObj(v) && v["arc"] !== undefined) {
    const parts = [`arc ${pointText(v["arc"])}`, `r${numText(v["r"])}`];
    if (v["sweep"] !== undefined) parts.push(String(v["sweep"]));
    if (v["large"] === true) parts.push("large");
    else if (v["large"] === false) parts.push("large:false");
    return parts.join(" ");
  }
  return pointText(v);
};

const polyText = (v: unknown): string => {
  if (!Array.isArray(v)) throw new TypeError(`expected a list of points, got ${JSON.stringify(v)}`);
  return v.map(polyElementText).join(" ");
};

// ---------------------------------------------------------------------------
// lexing
// ---------------------------------------------------------------------------

interface Tok {
  text: string;
  /** absolute offset of the first character (the opening quote, for a quoted token) */
  start: number;
  /** absolute offset one past the last character */
  end: number;
  quoted: boolean;
}

/** Split one line into tokens. A `#` starting a token ends the line. */
function lex(line: string, lineStart: number): { toks: Tok[]; bad?: { at: number; message: string } } {
  const toks: Tok[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === " " || line[i] === "\t") {
      i++;
      continue;
    }
    if (line[i] === "#") break;
    if (line[i] === '"') {
      const start = i;
      i++;
      let out = "";
      let closed = false;
      while (i < line.length) {
        if (line[i] === "\\" && i + 1 < line.length) {
          out += line[i + 1] === "n" ? "\n" : line[i + 1];
          i += 2;
          continue;
        }
        if (line[i] === '"') {
          i++;
          closed = true;
          break;
        }
        out += line[i];
        i++;
      }
      if (!closed) return { toks, bad: { at: start, message: "unterminated quoted name; a name needs a closing '\"'" } };
      toks.push({ text: out, start: lineStart + start, end: lineStart + i, quoted: true });
      continue;
    }
    const start = i;
    while (i < line.length && line[i] !== " " && line[i] !== "\t") i++;
    toks.push({ text: line.slice(start, i), start: lineStart + start, end: lineStart + i, quoted: false });
  }
  return { toks };
}

// ---------------------------------------------------------------------------
// the parser
// ---------------------------------------------------------------------------

const NUM_RE = /^-?\d+(\.\d+)?$/;
const ID_RE = /^[a-z][a-z0-9_]*$/;

const SPACE_STATEMENTS = { room: "rooms", outdoor: "outdoor", void: "voids" } as const;

/**
 * Field order inside every emitted object: SCHEMA's own, so the JSON a DSL document
 * compiles to reads in the same order as one written by hand.
 *
 * INVARIANT: built on first use, never at module load. This module and parse.ts import
 * each other — parse() routes DSL text here, and the grammar's vocabularies live there —
 * so whichever of the two node evaluates second would otherwise read the other's exports
 * before they are initialised.
 */
let ORDER: Record<string, readonly string[]> | undefined;
const orderOf = (object: string): readonly string[] => {
  ORDER ??= Object.fromEntries(SCHEMA.map((o: ObjectDoc) => [o.object, o.fields.map((f) => f.name)]));
  return ORDER[object] ?? [];
};

/** Build an object with SCHEMA's field order, dropping anything left undefined. */
function ordered(object: ObjectDoc["object"], values: Record<string, unknown>): J {
  const out: J = {};
  for (const name of orderOf(object)) if (values[name] !== undefined) out[name] = values[name];
  // anything not in SCHEMA would be an unknown field; `parse()` is the one that says so
  for (const k of Object.keys(values)) if (!(k in out) && values[k] !== undefined) out[k] = values[k];
  return out;
}

/**
 * Compile DSL text to the JSON document `parse()` accepts, collecting *every* line that
 * does not parse rather than stopping at the first — an agent that mistyped three doors
 * should learn about three doors.
 */
export function parseDsl(text: string): DslDocument {
  const issues: DslIssue[] = [];
  const positions: DslPositions = new Map();

  const rawLines = text.split("\n");
  const lineStarts: number[] = [];
  {
    let off = 0;
    for (const l of rawLines) {
      lineStarts.push(off);
      off += l.length + 1;
    }
  }

  let lineNo = 0;
  let lineStart = 0;

  const colOf = (abs: number) => abs - lineStart + 1;
  const fail = (abs: number, message: string): void => {
    issues.push({ line: lineNo, column: colOf(abs), message: `line ${lineNo}: ${message}` });
  };
  const record = (path: string, start: number, end: number, write: (v: unknown) => string): void => {
    positions.set(path, { line: lineNo, column: colOf(start), start, end, write });
  };

  // ---- the document under construction ----
  const head: J = {};
  const levels: J = {};
  const vertical: J[] = [];
  let levelled = false;
  /** where level content goes, and the document path it sits at */
  let content: J = {};
  let contentPath = "";
  let sawContent = false;
  /** the statement an indented line continues */
  let pending: { kind: "layout"; areas: string[]; path: string } | { kind: "vertical"; at: J[]; path: string } | undefined;

  const groupOf = (key: string): J => {
    const g = content[key];
    if (isObj(g)) return g;
    const made: J = {};
    content[key] = made;
    return made;
  };
  const arrayOf = (key: string): J[] => {
    const a = content[key];
    if (Array.isArray(a)) return a as J[];
    const made: J[] = [];
    content[key] = made;
    return made;
  };
  const P = (s: string) => (contentPath === "" ? s : `${contentPath}.${s}`);

  // ------------------------------------------------------------------
  // token readers — each records its own span so a splice can find it
  // ------------------------------------------------------------------

  /** A bare number token; records `path` so `set … <path> <n>` can splice it. */
  const readNum = (t: Tok, path: string, what: string): number | undefined => {
    if (!NUM_RE.test(t.text)) {
      fail(t.start, `${what} must be a number, got ${JSON.stringify(t.text)}`);
      return undefined;
    }
    record(path, t.start, t.end, numText);
    return Number(t.text);
  };

  /** A number that carries a one-character prefix, e.g. `w0.9` or `h2.7`. */
  const readPrefixedNum = (t: Tok, prefix: string, path: string, what: string): number | undefined => {
    const body = t.text.slice(prefix.length);
    if (!NUM_RE.test(body)) {
      fail(t.start, `${what} must be written ${prefix}<number>, got ${JSON.stringify(t.text)}`);
      return undefined;
    }
    record(path, t.start + prefix.length, t.end, numText);
    return Number(body);
  };

  /** `x,y` — records the pair and each coordinate, so a drag can splice one number. */
  const readPoint = (t: Tok, body: string, bodyAt: number, path: string, what: string): [number, number] | undefined => {
    const parts = body.split(",");
    if (parts.length !== 2 || !parts.every((p) => NUM_RE.test(p))) {
      fail(t.start, `${what} must be written <x>,<y>, got ${JSON.stringify(t.text)}`);
      return undefined;
    }
    record(path, bodyAt, bodyAt + body.length, pointText);
    record(`${path}[0]`, bodyAt, bodyAt + parts[0]!.length, numText);
    record(`${path}[1]`, bodyAt + parts[0]!.length + 1, bodyAt + body.length, numText);
    return [Number(parts[0]), Number(parts[1])];
  };

  /** `<w>x<h>` — records the pair and each of the two numbers. */
  const readSize = (t: Tok, path: string, what: string): [number, number] | undefined => {
    const parts = t.text.split("x");
    if (parts.length !== 2 || !parts.every((p) => NUM_RE.test(p))) {
      fail(t.start, `${what} must be written <width>x<height>, got ${JSON.stringify(t.text)}`);
      return undefined;
    }
    record(path, t.start, t.end, sizeText);
    record(`${path}[0]`, t.start, t.start + parts[0]!.length, numText);
    record(`${path}[1]`, t.start + parts[0]!.length + 1, t.end, numText);
    return [Number(parts[0]), Number(parts[1])];
  };

  /** `a,b,c` — a track list. */
  const readList = (t: Tok, path: string, what: string): number[] | undefined => {
    const parts = t.text.split(",");
    if (!parts.every((p) => NUM_RE.test(p))) {
      fail(t.start, `${what} must be a comma-separated list of numbers, got ${JSON.stringify(t.text)}`);
      return undefined;
    }
    record(path, t.start, t.end, listText);
    let at = t.start;
    parts.forEach((p, k) => {
      record(`${path}[${k}]`, at, at + p.length, numText);
      at += p.length + 1;
    });
    return parts.map(Number);
  };

  /**
   * A geometry clause: `rect <x>,<y> <w>x<h>` or `poly <pt|arc> …`, whichever the line
   * uses. Returns the key it wrote so the caller can keep the author's form, exactly as
   * `spaceForm` in edit.ts does for JSON.
   */
  const readGeometry = (toks: Tok[], cursor: { i: number }, base: string, what: string): { key: "rect" | "poly"; value: unknown } | undefined => {
    const verb = toks[cursor.i]!;
    if (verb.text === "rect") {
      cursor.i++;
      const at = toks[cursor.i];
      const size = toks[cursor.i + 1];
      if (!at || !size) {
        fail(verb.start, `${what}: rect needs <x>,<y> then <width>x<height>`);
        cursor.i = toks.length;
        return undefined;
      }
      cursor.i += 2;
      const p = readPoint(at, at.text, at.start, `${base}.rect#origin`, `${what}: rect origin`);
      const s = readSize(size, `${base}.rect#size`, `${what}: rect size`);
      if (!p || !s) return undefined;
      // the four numbers of `rect: [x, y, w, h]`, each addressable on its own — the
      // origin pair and the size pair sit in different tokens, so they are recorded from
      // the two helper spans above rather than from one contiguous range
      positions.set(`${base}.rect[0]`, positions.get(`${base}.rect#origin[0]`)!);
      positions.set(`${base}.rect[1]`, positions.get(`${base}.rect#origin[1]`)!);
      positions.set(`${base}.rect[2]`, positions.get(`${base}.rect#size[0]`)!);
      positions.set(`${base}.rect[3]`, positions.get(`${base}.rect#size[1]`)!);
      for (const k of ["#origin", "#origin[0]", "#origin[1]", "#size", "#size[0]", "#size[1]"]) positions.delete(`${base}.rect${k}`);
      record(`${base}.rect`, at.start, size.end, rectText);
      return { key: "rect", value: [p[0], p[1], s[0], s[1]] };
    }
    if (verb.text === "poly") {
      cursor.i++;
      const start = toks[cursor.i]?.start ?? verb.end;
      const out: unknown[] = [];
      let end = verb.end;
      while (cursor.i < toks.length) {
        const t = toks[cursor.i]!;
        if (t.text === "arc") {
          const to = toks[cursor.i + 1];
          const r = toks[cursor.i + 2];
          if (!to || !r || !r.text.startsWith("r")) {
            fail(t.start, `${what}: arc needs <x>,<y> then r<radius> (${ARC_SYNTAX})`);
            cursor.i = toks.length;
            return undefined;
          }
          const idx = out.length;
          const pt = readPoint(to, to.text, to.start, `${base}.poly[${idx}].arc`, `${what}: arc end point`);
          const radius = readPrefixedNum(r, "r", `${base}.poly[${idx}].r`, `${what}: arc radius`);
          cursor.i += 3;
          end = r.end;
          const arc: J = { arc: pt, r: radius };
          // `sweep` and `large` are optional, and both are in the grammar from day one
          // (docs/gaps-design.md §1.2) so that adding curves later changes no production
          while (cursor.i < toks.length) {
            const x = toks[cursor.i]!;
            if (x.text === "cw" || x.text === "ccw") {
              record(`${base}.poly[${idx}].sweep`, x.start, x.end, (v) => String(v));
              arc["sweep"] = x.text;
              cursor.i++;
              end = x.end;
            } else if (x.text === "large" || x.text === "large:true" || x.text === "large:false") {
              const val = x.text !== "large:false";
              record(`${base}.poly[${idx}].large`, x.start - 1, x.end, (v) => (v === true ? " large" : v === false ? " large:false" : ""));
              arc["large"] = val;
              cursor.i++;
              end = x.end;
            } else break;
          }
          out.push(arc);
          continue;
        }
        if (!/^-?\d/.test(t.text)) break;
        const pt = readPoint(t, t.text, t.start, `${base}.poly[${out.length}]`, `${what}: corner ${out.length + 1}`);
        if (!pt) {
          cursor.i = toks.length;
          return undefined;
        }
        out.push(pt);
        end = t.end;
        cursor.i++;
      }
      if (out.length === 0) {
        fail(verb.start, `${what}: poly needs at least one <x>,<y> corner`);
        return undefined;
      }
      record(`${base}.poly`, start, end, polyText);
      return { key: "poly", value: out };
    }
    return undefined;
  };

  /** `name` → true, `name:false` → false, `name:true` → true. */
  const readFlag = (t: Tok, name: string, path: string): boolean => {
    const value = t.text !== `${name}:false`;
    // the span eats the space before the token, so writing `false` for a flag that has no
    // negative spelling in the source simply removes it and leaves the line tidy
    record(path, t.start - 1, t.end, (v) => (v === true ? ` ${name}` : v === false ? ` ${name}:false` : ""));
    return value;
  };

  /** the text after `key:` in a `key:value` token */
  const valueOf = (t: Tok, key: string) => ({ body: t.text.slice(key.length + 1), at: t.start + key.length + 1 });

  const readWord = (t: Tok, body: string, bodyAt: number, path: string): string => {
    record(path, bodyAt, bodyAt + body.length, (v) => String(v));
    return body;
  };

  const readName = (t: Tok, path: string): string => {
    record(path, t.start, t.end, quote);
    return t.text;
  };

  // ------------------------------------------------------------------
  // statements
  // ------------------------------------------------------------------

  /** `walls <ext>/<part>` or `walls exterior:<n>` / `walls partition:<n>`. */
  const readWalls = (toks: Tok[], cursor: { i: number }): void => {
    const w = isObj(head["walls"]) ? (head["walls"] as J) : {};
    head["walls"] = w;
    while (cursor.i < toks.length) {
      const t = toks[cursor.i]!;
      if (t.text.includes("/")) {
        const parts = t.text.split("/");
        if (parts.length !== 2 || !parts.every((p) => NUM_RE.test(p))) {
          fail(t.start, `walls must be written <exterior>/<partition>, got ${JSON.stringify(t.text)}`);
          cursor.i++;
          return;
        }
        record("walls.exterior", t.start, t.start + parts[0]!.length, numText);
        record("walls.partition", t.start + parts[0]!.length + 1, t.end, numText);
        w["exterior"] = Number(parts[0]);
        w["partition"] = Number(parts[1]);
        cursor.i++;
        continue;
      }
      if (t.text.startsWith("exterior:") || t.text.startsWith("partition:")) {
        const key = t.text.startsWith("exterior:") ? "exterior" : "partition";
        const { body, at } = valueOf(t, key);
        if (!NUM_RE.test(body)) fail(t.start, `walls.${key} must be a number, got ${JSON.stringify(body)}`);
        else {
          record(`walls.${key}`, at, at + body.length, numText);
          w[key] = Number(body);
        }
        cursor.i++;
        continue;
      }
      break;
    }
    head["walls"] = ordered("walls", w);
  };

  const statement = (toks: Tok[]): void => {
    const verb = toks[0]!;
    const cursor = { i: 1 };
    const rest = () => toks[cursor.i];

    /**
     * The statement stopped reading here. Report the token it stopped on — once — and
     * name what this statement does take, from DSL_SCHEMA so the list cannot drift.
     *
     * INVARIANT: one finding, not one per leftover token. A single mistyped token used
     * to produce a finding for itself and one for every token after it (the authoring
     * eval measured three for one mistyped `w0.9`), which buries the one that matters.
     */
    const unexpected = (): void => {
      const t = toks[cursor.i];
      if (!t) return;
      const takes = acceptedTokens(verb.text);
      fail(
        t.start,
        `${verb.text}: unexpected ${JSON.stringify(t.text)}; the rest of the line was not read${takes.length ? ` — ${verb.text} takes ${takes.join(", ")}` : ""}`,
      );
      cursor.i = toks.length;
    };

    switch (true) {
      // ---- plan ----------------------------------------------------
      case verb.text === "plan": {
        const first = rest();
        if (first?.quoted) {
          head["title"] = readName(first, "title");
          cursor.i++;
        }
        while (cursor.i < toks.length) {
          const t = toks[cursor.i]!;
          if (t.text.startsWith("units:")) {
            const { body, at } = valueOf(t, "units");
            head["units"] = readWord(t, body, at, "units");
            cursor.i++;
          } else if (t.text === "walls") {
            cursor.i++;
            readWalls(toks, cursor);
          } else if (t.text === "north") {
            cursor.i++;
            const n = rest();
            if (!n) fail(t.start, "north needs a bearing in degrees");
            else {
              const v = readNum(n, "north", "north");
              if (v !== undefined) head["north"] = v;
              cursor.i++;
            }
          } else if (t.text === "stack") {
            cursor.i++;
            const s = rest();
            if (!s) fail(t.start, "stack needs a comma-separated list of level ids, ground first");
            else {
              const ids = s.text.split(",");
              record("stack", s.start, s.end, (v) => (Array.isArray(v) ? v.join(",") : String(v)));
              let at = s.start;
              ids.forEach((id, k) => {
                record(`stack[${k}]`, at, at + id.length, (v) => String(v));
                at += id.length + 1;
              });
              head["stack"] = ids;
              cursor.i++;
            }
          } else break;
        }
        unexpected();
        return;
      }

      case verb.text === "walls":
        readWalls(toks, cursor);
        unexpected();
        return;

      case verb.text === "north": {
        const n = rest();
        if (!n) fail(verb.start, "north needs a bearing in degrees");
        else {
          const v = readNum(n, "north", "north");
          if (v !== undefined) head["north"] = v;
          cursor.i++;
        }
        unexpected();
        return;
      }

      case verb.text === "grid": {
        const g: J = {};
        while (cursor.i < toks.length) {
          const t = toks[cursor.i]!;
          if (t.text === "cols" || t.text === "rows") {
            const key = t.text;
            cursor.i++;
            const v = rest();
            if (!v) {
              fail(t.start, `grid ${key} needs a comma-separated list of track sizes`);
              break;
            }
            const list = readList(v, `grid.${key}`, `grid.${key}`);
            if (list) g[key] = list;
            cursor.i++;
          } else break;
        }
        head["grid"] = ordered("grid", g);
        unexpected();
        return;
      }

      // ---- level header --------------------------------------------
      case verb.text === "level": {
        const idTok = rest();
        if (!idTok || idTok.quoted) {
          fail(verb.start, 'level needs an id: `level piso1 "1.º andar" h2.6`');
          return;
        }
        if (!levelled && sawContent) {
          fail(verb.start, "a level header may not follow content written at the top of the document; put every room, opening and fixture under a level");
          return;
        }
        levelled = true;
        cursor.i++;
        const id = idTok.text;
        record(`levels.${id}#id`, idTok.start, idTok.end, (v) => String(v));
        const lv: J = {};
        while (cursor.i < toks.length) {
          const t = toks[cursor.i]!;
          if (t.quoted) {
            lv["name"] = readName(t, `levels.${id}.name`);
            cursor.i++;
          } else if (/^h-?\d/.test(t.text)) {
            const v = readPrefixedNum(t, "h", `levels.${id}.height`, "level height");
            if (v !== undefined) lv["height"] = v;
            cursor.i++;
          } else if (t.text === "ground" || t.text === "ground:true" || t.text === "ground:false") {
            lv["ground"] = readFlag(t, "ground", `levels.${id}.ground`);
            cursor.i++;
          } else break;
        }
        unexpected();
        const made = ordered("level", lv);
        levels[id] = made;
        content = made;
        contentPath = `levels.${id}`;
        return;
      }

      // ---- rooms, outdoor spaces, voids -----------------------------
      case verb.text in SPACE_STATEMENTS: {
        const kindKey = SPACE_STATEMENTS[verb.text as keyof typeof SPACE_STATEMENTS];
        const object = (verb.text === "room" ? "room" : verb.text === "outdoor" ? "outdoor" : "void") as ObjectDoc["object"];
        const idTok = rest();
        if (!idTok || idTok.quoted) {
          fail(verb.start, `${verb.text} needs an id: \`${verb.text} sala "Sala" ${verb.text === "room" ? "living " : ""}rect 0,0 4x3\``);
          return;
        }
        cursor.i++;
        sawContent = true;
        const id = idTok.text;
        const base = P(`${kindKey}.${id}`);
        record(`${base}#id`, idTok.start, idTok.end, (v) => String(v));
        const e: J = {};
        let sawKind = false;
        while (cursor.i < toks.length) {
          const t = toks[cursor.i]!;
          if (t.quoted) {
            e["name"] = readName(t, `${base}.name`);
            cursor.i++;
            continue;
          }
          if (t.text === "rect" || t.text === "poly") {
            const g = readGeometry(toks, cursor, base, `${verb.text} ${id}`);
            if (g) e[g.key] = g.value;
            continue;
          }
          if (verb.text === "outdoor" && (t.text === "covered" || t.text === "covered:true" || t.text === "covered:false")) {
            e["covered"] = readFlag(t, "covered", `${base}.covered`);
            cursor.i++;
            continue;
          }
          if (verb.text === "room") {
            const flag = ["habitable", "wet", "circulation"].find((f) => t.text === f || t.text === `${f}:true` || t.text === `${f}:false`);
            if (flag) {
              e[flag] = readFlag(t, flag, `${base}.${flag}`);
              cursor.i++;
              continue;
            }
            if (t.text.startsWith("zone:")) {
              const { body, at } = valueOf(t, "zone");
              e["zone"] = readWord(t, body, at, `${base}.zone`);
              cursor.i++;
              continue;
            }
            if (t.text.startsWith("kind:")) {
              const { body, at } = valueOf(t, "kind");
              e["kind"] = readWord(t, body, at, `${base}.kind`);
              sawKind = true;
              cursor.i++;
              continue;
            }
            // Two bare words, in order: the kind, then the zone. The *first* must be a
            // real room kind — a misspelt one is a mistake, not a new zone name.
            //
            // INVARIANT: this is what stops `room sala "Sala" livingroom` reading as a
            // room of kind "other" in a zone called "livingroom". The authoring eval
            // (docs/eval/authoring-eval.md) caught exactly that: JSON reported the bad
            // kind and the DSL said nothing, because a zone is free text and swallowed
            // it. A zone on a room with no kind is therefore written `zone:<z>`.
            if (ID_RE.test(t.text)) {
              if (!sawKind && e["zone"] === undefined) {
                if (!ROOM_KINDS.has(t.text)) {
                  fail(t.start, `room ${id}: ${JSON.stringify(t.text)} is not a room kind; one of ${[...ROOM_KINDS].join(", ")} — a zone is written zone:<z>`);
                  cursor.i++;
                  continue;
                }
                e["kind"] = readWord(t, t.text, t.start, `${base}.kind`);
                sawKind = true;
              } else if (e["zone"] === undefined) {
                e["zone"] = readWord(t, t.text, t.start, `${base}.zone`);
              } else break;
              cursor.i++;
              continue;
            }
          }
          break;
        }
        unexpected();
        record(base, verb.start, toks[toks.length - 1]!.end, (v) => spaceLine(verb.text as "room" | "outdoor" | "void", id, v as J));
        groupOf(kindKey)[id] = ordered(object, e);
        return;
      }

      // ---- layout ---------------------------------------------------
      case verb.text === "layout": {
        sawContent = true;
        const l: J = {};
        while (cursor.i < toks.length) {
          const t = toks[cursor.i]!;
          if (t.text === "cols" || t.text === "rows") {
            const key = t.text;
            cursor.i++;
            const v = rest();
            if (!v) {
              fail(t.start, `layout ${key} needs a comma-separated list of track sizes`);
              break;
            }
            const list = readList(v, P(`layout.${key}`), `layout.${key}`);
            if (list) l[key] = list;
            cursor.i++;
          } else break;
        }
        unexpected();
        const areas: string[] = [];
        l["areas"] = areas;
        content["layout"] = ordered("layout", l);
        pending = { kind: "layout", areas, path: P("layout") };
        return;
      }

      // ---- openings -------------------------------------------------
      case OPENING_TYPES.has(verb.text): {
        sawContent = true;
        const list = arrayOf("openings");
        const index = list.length;
        const base = P(`openings[${index}]`);
        const spaces = rest();
        if (!spaces || spaces.quoted) {
          fail(verb.start, `${verb.text} needs two spaces separated by ">"; got ${JSON.stringify(spaces?.text ?? "")}`);
          return;
        }
        cursor.i++;
        const o: J = { type: verb.text };
        record(`${base}.type`, verb.start, verb.end, (v) => String(v));
        let on: J | undefined;
        let onSpans: { room: [number, number]; side?: [number, number] } | undefined;

        const sep = spaces.text.includes(">") ? ">" : spaces.text.includes("-") ? "-" : undefined;
        if (sep) {
          const parts = spaces.text.split(sep);
          if (parts.length !== 2 || parts.some((p) => p === "")) {
            fail(spaces.start, `${verb.text} needs two spaces separated by ">"; got ${JSON.stringify(spaces.text)}`);
            return;
          }
          record(`${base}.between`, spaces.start, spaces.end, (v) => (Array.isArray(v) ? `${String(v[0])}>${String(v[1])}` : String(v)));
          record(`${base}.between[0]`, spaces.start, spaces.start + parts[0]!.length, (v) => String(v));
          record(`${base}.between[1]`, spaces.start + parts[0]!.length + 1, spaces.end, (v) => String(v));
          o["between"] = parts;
        } else {
          // `window suite.north` — the short form: between the street and one room, with
          // the side, if given, as the `on` that picks the wall
          const dot = spaces.text.indexOf(".");
          const room = dot === -1 ? spaces.text : spaces.text.slice(0, dot);
          const side = dot === -1 ? undefined : spaces.text.slice(dot + 1);
          // Only a plain id, optionally with a real compass side, can be the short form.
          // Without this, a line that forgot its spaces altogether (`door w0.8`) would
          // read `w0` as a room and `8` as a side, and the author would be told about a
          // missing width instead of the missing wall that is actually the problem.
          if (!ID_RE.test(room) || (side !== undefined && !SIDES.has(side))) {
            fail(spaces.start, `${verb.text} needs two spaces separated by ">"; got ${JSON.stringify(spaces.text)}`);
            return;
          }
          record(`${base}.between`, spaces.start, spaces.end, (v) => (Array.isArray(v) ? `${String(v[0])}>${String(v[1])}` : String(v)));
          record(`${base}.between[1]`, spaces.start, spaces.start + room.length, (v) => String(v));
          o["between"] = ["exterior", room];
          if (side !== undefined) {
            on = { room, side };
            onSpans = { room: [spaces.start, spaces.start + room.length], side: [spaces.start + room.length + 1, spaces.end] };
          } else {
            onSpans = { room: [spaces.start, spaces.start + room.length] };
          }
        }

        let near: [number, number] | undefined;
        let nearSpan: [number, number] | undefined;
        while (cursor.i < toks.length) {
          const t = toks[cursor.i]!;
          if (t.quoted) break;
          if (t.text.startsWith("@")) {
            const body = t.text.slice(1);
            const fromEnd = body.startsWith("-");
            const digits = fromEnd ? body.slice(1) : body;
            if (!NUM_RE.test(digits)) {
              fail(t.start, `${verb.text}: position must be written @<metres> from the run's start, or @-<metres> from its end; got ${JSON.stringify(t.text)}`);
              cursor.i++;
              continue;
            }
            if (fromEnd) {
              o["position"] = { from: "end", distance: Number(digits) };
              record(`${base}.position`, t.start, t.end, (v) =>
                isObj(v) && v["from"] === "end" ? `@-${numText(v["distance"])}` : isObj(v) ? `@${numText(v["distance"])}` : `@${numText(v)}`,
              );
              record(`${base}.position.from`, t.start + 1, t.start + 2, (v) => (v === "end" ? "-" : ""));
              record(`${base}.position.distance`, t.start + 2, t.end, numText);
            } else {
              // `@<d>` is the number form: one spelling for what `parse()` folds together
              o["position"] = Number(digits);
              record(`${base}.position`, t.start, t.end, (v) =>
                isObj(v) ? `@${v["from"] === "end" ? "-" : ""}${numText(v["distance"])}` : `@${numText(v)}`,
              );
            }
            cursor.i++;
            continue;
          }
          if (/^w-?\d/.test(t.text)) {
            const v = readPrefixedNum(t, "w", `${base}.width`, `${verb.text} width`);
            if (v !== undefined) o["width"] = v;
            cursor.i++;
            continue;
          }
          // Canonical is bare `at <x>,<y>`, matching fixture/vertical (docs/eval/cold2/
          // cold-run.md gap 3); `at:<x>,<y>` is still accepted here, silently, for one
          // release — the printer (openingLine below) never emits it again.
          if (t.text === "at" || t.text.startsWith("at:")) {
            let tok = t;
            let body: string;
            let at: number;
            if (t.text === "at") {
              const n = toks[cursor.i + 1];
              if (!n) {
                fail(t.start, `${verb.text}: at needs <x>,<y>`);
                cursor.i++;
                continue;
              }
              tok = n;
              body = n.text;
              at = n.start;
              cursor.i++;
            } else {
              const v = valueOf(t, "at");
              body = v.body;
              at = v.at;
            }
            const p = readPoint(tok, body, at, `${base}.at`, `${verb.text} at`);
            if (p) o["at"] = p;
            cursor.i++;
            continue;
          }
          if (t.text.startsWith("on:")) {
            const { body, at } = valueOf(t, "on");
            const dot = body.indexOf(".");
            const room = dot === -1 ? body : body.slice(0, dot);
            const side = dot === -1 ? undefined : body.slice(dot + 1);
            on = side === undefined ? { room } : { room, side };
            onSpans = side === undefined ? { room: [at, at + room.length] } : { room: [at, at + room.length], side: [at + room.length + 1, at + body.length] };
            cursor.i++;
            continue;
          }
          if (t.text.startsWith("near:")) {
            const { body, at } = valueOf(t, "near");
            const parts = body.split(",");
            if (parts.length !== 2 || !parts.every((p) => NUM_RE.test(p))) {
              fail(t.start, `${verb.text}: near must be written near:<x>,<y>, got ${JSON.stringify(t.text)}`);
              cursor.i++;
              continue;
            }
            near = [Number(parts[0]), Number(parts[1])];
            nearSpan = [at, at + body.length];
            cursor.i++;
            continue;
          }
          if (t.text.startsWith("hinge:")) {
            const { body, at } = valueOf(t, "hinge");
            o["hinge"] = readWord(t, body, at, `${base}.hinge`);
            cursor.i++;
            continue;
          }
          if (t.text.startsWith("swing:")) {
            const { body, at } = valueOf(t, "swing");
            o["swingInto"] = readWord(t, body, at, `${base}.swingInto`);
            cursor.i++;
            continue;
          }
          if (t.text.startsWith("id:")) {
            const { body, at } = valueOf(t, "id");
            o["id"] = readWord(t, body, at, `${base}.id`);
            cursor.i++;
            continue;
          }
          const flag = ["entrance", "glazed"].find((f) => t.text === f || t.text === `${f}:true` || t.text === `${f}:false`);
          if (flag) {
            o[flag] = readFlag(t, flag, `${base}.${flag}`);
            cursor.i++;
            continue;
          }
          break;
        }
        unexpected();
        if (o["width"] === undefined) fail(verb.start, `${verb.text} needs a width, written w<metres>`);
        if (near !== undefined) {
          if (!on) {
            if (onSpans) on = { room: o["between"] ? (o["between"] as string[])[1] : "" };
            else fail(verb.start, `${verb.text}: near:<x>,<y> needs an on:<room> (or the short \`${verb.text} <room>\` form) to say which space's wall it picks`);
          }
          if (on) {
            on["near"] = near;
            record(`${base}.on.near`, nearSpan![0], nearSpan![1], pointText);
            record(`${base}.on.near[0]`, nearSpan![0], nearSpan![0] + String(near[0]).length, numText);
            record(`${base}.on.near[1]`, nearSpan![0] + String(near[0]).length + 1, nearSpan![1], numText);
          }
        }
        if (on) {
          o["on"] = ordered("opening.on", on);
          if (onSpans) {
            record(`${base}.on.room`, onSpans.room[0], onSpans.room[1], (v) => String(v));
            if (onSpans.side) record(`${base}.on.side`, onSpans.side[0], onSpans.side[1], (v) => String(v));
          }
        }
        record(base, verb.start, toks[toks.length - 1]!.end, (v) => openingLine(v));
        list.push(ordered("opening", o));
        return;
      }

      // ---- fixtures -------------------------------------------------
      case verb.text === "fixture": {
        sawContent = true;
        const list = arrayOf("fixtures");
        const index = list.length;
        const base = P(`fixtures[${index}]`);
        const typeTok = rest();
        if (!typeTok || typeTok.quoted) {
          fail(verb.start, `fixture needs a type: one of ${[...FIXTURE_TYPES].join(", ")}`);
          return;
        }
        cursor.i++;
        const f: J = { type: typeTok.text };
        record(`${base}.type`, typeTok.start, typeTok.end, (v) => String(v));
        while (cursor.i < toks.length) {
          const t = toks[cursor.i]!;
          if (t.quoted) {
            f["name"] = readName(t, `${base}.name`);
            cursor.i++;
            continue;
          }
          if (t.text.startsWith("in:")) {
            const { body, at } = valueOf(t, "in");
            f["in"] = readWord(t, body, at, `${base}.in`);
            cursor.i++;
            continue;
          }
          if (t.text === "at") {
            const n = toks[cursor.i + 1];
            if (!n) {
              fail(t.start, "fixture: at needs <x>,<y>");
              cursor.i++;
              continue;
            }
            const p = readPoint(n, n.text, n.start, `${base}.at`, "fixture at");
            if (p) f["at"] = p;
            cursor.i += 2;
            continue;
          }
          if (t.text === "size") {
            const n = toks[cursor.i + 1];
            if (!n) {
              fail(t.start, "fixture: size needs <width>x<height>");
              cursor.i++;
              continue;
            }
            const s = readSize(n, `${base}.size`, "fixture size");
            if (s) f["size"] = s;
            cursor.i += 2;
            continue;
          }
          if (t.text === "poly") {
            const g = readGeometry(toks, cursor, base, "fixture");
            if (g) f[g.key] = g.value;
            continue;
          }
          if (t.text.startsWith("depth:")) {
            const { body, at } = valueOf(t, "depth");
            if (!NUM_RE.test(body)) fail(t.start, `fixture depth must be a number, got ${JSON.stringify(body)}`);
            else {
              record(`${base}.depth`, at, at + body.length, numText);
              f["depth"] = Number(body);
            }
            cursor.i++;
            continue;
          }
          if (t.text.startsWith("id:")) {
            const { body, at } = valueOf(t, "id");
            f["id"] = readWord(t, body, at, `${base}.id`);
            cursor.i++;
            continue;
          }
          break;
        }
        unexpected();
        if (f["in"] === undefined) fail(verb.start, "fixture needs in:<space> — the room or outdoor space it stands in");
        record(base, verb.start, toks[toks.length - 1]!.end, (v) => fixtureLine(v));
        list.push(ordered("fixture", f));
        return;
      }

      // ---- vertical circulation --------------------------------------
      case verb.text === "vertical" || VERTICAL_TYPES.has(verb.text): {
        const index = vertical.length;
        const base = `vertical[${index}]`;
        let idTok: Tok | undefined;
        let typeTok: Tok | undefined;
        if (verb.text === "vertical") {
          idTok = toks[1];
          typeTok = toks[2];
          cursor.i = 3;
          if (!idTok || !typeTok) {
            fail(verb.start, `vertical needs an id and a type: \`vertical escada stairs\` (or just \`stairs escada\`)`);
            return;
          }
        } else {
          typeTok = verb;
          idTok = toks[1];
          cursor.i = 2;
          if (!idTok) {
            fail(verb.start, `${verb.text} needs an id: \`${verb.text} escada "Escada" risers:15\``);
            return;
          }
        }
        const v: J = { id: idTok.text, type: typeTok.text };
        record(`${base}.id`, idTok.start, idTok.end, (x) => String(x));
        record(`${base}.type`, typeTok.start, typeTok.end, (x) => String(x));
        while (cursor.i < toks.length) {
          const t = toks[cursor.i]!;
          if (t.quoted) {
            v["name"] = readName(t, `${base}.name`);
            cursor.i++;
            continue;
          }
          if (t.text.startsWith("up:")) {
            const { body, at } = valueOf(t, "up");
            if (!NUM_RE.test(body)) fail(t.start, `up must be a bearing in degrees, got ${JSON.stringify(body)}`);
            else {
              record(`${base}.up`, at, at + body.length, numText);
              v["up"] = Number(body);
            }
            cursor.i++;
            continue;
          }
          if (t.text.startsWith("risers:")) {
            const { body, at } = valueOf(t, "risers");
            if (!NUM_RE.test(body)) fail(t.start, `risers must be a whole number, got ${JSON.stringify(body)}`);
            else {
              record(`${base}.risers`, at, at + body.length, numText);
              v["risers"] = Number(body);
            }
            cursor.i++;
            continue;
          }
          break;
        }
        unexpected();
        const at: J[] = [];
        v["at"] = at;
        vertical.push(ordered("vertical", v));
        pending = { kind: "vertical", at, path: base };
        return;
      }

      default:
        fail(verb.start, `unknown statement ${JSON.stringify(verb.text)}; expected one of ${statementVerbs().join(", ")}`);
    }
  };

  /** An indented line: an `areas` row, or one `at` footprint of a vertical element. */
  const continuation = (raw: string, toks: Tok[]): void => {
    if (!pending) {
      fail(toks[0]!.start, "an indented line continues the statement above it, and there is no statement above this one");
      return;
    }
    if (pending.kind === "layout") {
      const row = raw.replace(/^\s+/, "");
      const index = pending.areas.length;
      const at = lineStart + (raw.length - row.length);
      record(`${pending.path}.areas[${index}]`, at, at + row.length, (v) => String(v));
      pending.areas.push(row);
      return;
    }
    const verb = toks[0]!;
    if (verb.text !== "at") {
      fail(verb.start, `a vertical element's indented lines are its footprints: \`at <level> in:<space> rect <x>,<y> <w>x<h>\`; got ${JSON.stringify(verb.text)}`);
      return;
    }
    const index = pending.at.length;
    const base = `${pending.path}.at[${index}]`;
    const cursor = { i: 1 };
    const lvl = toks[cursor.i];
    if (!lvl || lvl.text.includes(":")) {
      fail(verb.start, "at needs the level it serves: `at piso1 in:patamar rect 4.2,3.6 1.4x4.2`");
      return;
    }
    cursor.i++;
    const a: J = { level: lvl.text };
    record(`${base}.level`, lvl.start, lvl.end, (v) => String(v));
    while (cursor.i < toks.length) {
      const t = toks[cursor.i]!;
      if (t.text.startsWith("in:")) {
        const { body, at } = valueOf(t, "in");
        a["in"] = readWord(t, body, at, `${base}.in`);
        cursor.i++;
        continue;
      }
      if (t.text === "rect" || t.text === "poly") {
        const g = readGeometry(toks, cursor, base, "at");
        if (g) a[g.key] = g.value;
        continue;
      }
      fail(t.start, `at: unexpected ${JSON.stringify(t.text)}`);
      cursor.i++;
    }
    if (a["in"] === undefined) fail(verb.start, "at needs in:<space> — the room or outdoor space to step off into");
    record(base, verb.start, toks[toks.length - 1]!.end, (v) => footprintLine(v));
    pending.at.push(ordered("vertical.footprint", a));
  };

  // ---- drive the lines ----
  for (let k = 0; k < rawLines.length; k++) {
    const raw = rawLines[k]!;
    lineNo = k + 1;
    lineStart = lineStarts[k]!;
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const { toks, bad } = lex(raw, lineStart);
    if (bad) {
      fail(lineStart + bad.at, bad.message);
      continue;
    }
    if (toks.length === 0) continue;
    if (/^[ \t]/.test(raw)) {
      continuation(raw, toks);
      continue;
    }
    pending = undefined;
    statement(toks);
  }

  if (issues.length) throw new DslError(issues);

  // ---- assemble, in SCHEMA's own field order ----
  const doc: J = {};
  for (const k of ["title", "units", "walls", "north", "stack"]) if (head[k] !== undefined) doc[k] = head[k];
  if (head["grid"] !== undefined) doc["grid"] = head["grid"];
  if (levelled) doc["levels"] = levels;
  else for (const [k, v] of Object.entries(content)) doc[k] = v;
  if (vertical.length) doc["vertical"] = vertical;
  return { doc, positions };
}

/**
 * The tokens one statement accepts, read out of the grammar table itself so an error
 * message can never list a token the parser no longer takes, or miss one it does.
 */
function acceptedTokens(verb: string): string[] {
  const st = DSL_SCHEMA.find((s) => s.statement.split(" | ").includes(verb));
  if (!st) return [];
  // the first token is the statement's own subject (its id, or the statement itself);
  // what an author needs listed is the rest, which is what may follow it
  return [...new Set(st.tokens.slice(1).map((t) => t.token))];
}

/** Every verb a statement may start with. A function for the same reason `orderOf` is. */
const statementVerbs = (): string[] => [
  "plan",
  "walls",
  "north",
  "grid",
  "level",
  "room",
  "outdoor",
  "void",
  "layout",
  ...OPENING_TYPES,
  "fixture",
  "vertical",
  ...VERTICAL_TYPES,
];

// ---------------------------------------------------------------------------
// the canonical printer
// ---------------------------------------------------------------------------

const flagText = (v: unknown, name: string): string => (v === true ? ` ${name}` : v === false ? ` ${name}:false` : "");

function geometryText(e: J): string {
  if (e["rect"] !== undefined) return ` rect ${rectText(e["rect"])}`;
  if (e["poly"] !== undefined) return ` poly ${polyText(e["poly"])}`;
  return "";
}

function spaceLine(verb: "room" | "outdoor" | "void", id: string, e: J): string {
  let s = `${verb} ${id}`;
  if (e["name"] !== undefined) s += ` ${quote(e["name"])}`;
  if (verb === "room") {
    if (e["kind"] !== undefined) s += ROOM_KINDS.has(String(e["kind"])) ? ` ${String(e["kind"])}` : ` kind:${String(e["kind"])}`;
    if (e["zone"] !== undefined) {
      // A bare zone is only readable as one when a kind precedes it (see the parser's
      // INVARIANT). Otherwise, and for a zone that is not a plain word, it keeps `zone:`.
      const z = String(e["zone"]);
      s += e["kind"] === undefined || !ID_RE.test(z) ? ` zone:${z}` : ` ${z}`;
    }
  }
  if (verb === "outdoor") s += flagText(e["covered"], "covered");
  s += geometryText(e);
  if (verb === "room") for (const f of ["habitable", "wet", "circulation"]) s += flagText(e[f], f);
  return s;
}

function positionText(p: unknown): string {
  if (p === undefined || p === "center") return "";
  if (isNum(p)) return ` @${numText(p)}`;
  if (isObj(p)) return ` @${p["from"] === "end" ? "-" : ""}${numText(p["distance"])}`;
  throw new TypeError(`cannot write position ${JSON.stringify(p)} in the DSL`);
}

function openingLine(value: unknown): string {
  const o = value as J;
  const between = o["between"];
  if (!Array.isArray(between) || between.length !== 2) throw new TypeError(`an opening needs between: [a, b], got ${JSON.stringify(between)}`);
  const [a, b] = between as [string, string];
  const on = isObj(o["on"]) ? (o["on"] as J) : undefined;
  // `exterior>room` with an `on` naming that same room is the short form the appendix
  // uses: `window suite.north`. Everything else is written out.
  const short = a === "exterior" && b !== "exterior" && (on === undefined || on["room"] === b);
  let s = String(o["type"]);
  if (short) {
    s += ` ${b}`;
    if (on?.["side"] !== undefined) s += `.${String(on["side"])}`;
  } else {
    s += ` ${a}>${b}`;
  }
  s += positionText(o["position"]);
  if (o["at"] !== undefined) s += ` at ${pointText(o["at"])}`;
  s += ` w${numText(o["width"])}`;
  if (on && !short) {
    s += ` on:${String(on["room"])}`;
    if (on["side"] !== undefined) s += `.${String(on["side"])}`;
  }
  if (on?.["near"] !== undefined) s += ` near:${pointText(on["near"])}`;
  if (o["hinge"] !== undefined) s += ` hinge:${String(o["hinge"])}`;
  if (o["swingInto"] !== undefined) s += ` swing:${String(o["swingInto"])}`;
  s += flagText(o["entrance"], "entrance");
  s += flagText(o["glazed"], "glazed");
  if (o["id"] !== undefined) s += ` id:${String(o["id"])}`;
  return s;
}

function fixtureLine(value: unknown): string {
  const f = value as J;
  let s = `fixture ${String(f["type"])} in:${String(f["in"])}`;
  if (f["poly"] !== undefined) s += ` poly ${polyText(f["poly"])}`;
  else {
    if (f["at"] !== undefined) s += ` at ${pointText(f["at"])}`;
    if (f["size"] !== undefined) s += ` size ${sizeText(f["size"])}`;
  }
  if (f["name"] !== undefined) s += ` ${quote(f["name"])}`;
  if (f["depth"] !== undefined) s += ` depth:${numText(f["depth"])}`;
  if (f["id"] !== undefined) s += ` id:${String(f["id"])}`;
  return s;
}

function footprintLine(value: unknown): string {
  const a = value as J;
  return `at ${String(a["level"])} in:${String(a["in"])}${geometryText(a)}`;
}

/** The statements one level's content produces, in SCHEMA's field order. */
function levelBody(level: J): string[][] {
  const groups: string[][] = [];
  const spaces: string[] = [];
  for (const [key, verb] of [
    ["rooms", "room"],
    ["outdoor", "outdoor"],
    ["voids", "void"],
  ] as const) {
    const g = level[key];
    if (!isObj(g)) continue;
    for (const [id, e] of Object.entries(g)) {
      if (!isObj(e)) throw new TypeError(`${key}.${id} must be an object`);
      spaces.push(spaceLine(verb, id, e));
    }
  }
  if (spaces.length) groups.push(spaces);

  const layout = level["layout"];
  if (isObj(layout)) {
    let head = "layout";
    if (layout["cols"] !== undefined) head += ` cols ${listText(layout["cols"])}`;
    if (layout["rows"] !== undefined) head += ` rows ${listText(layout["rows"])}`;
    const areasRaw = layout["areas"];
    const areas = typeof areasRaw === "string" ? areasRaw.split("\n").filter((l) => l.trim() !== "") : areasRaw;
    if (!Array.isArray(areas)) throw new TypeError("layout.areas must be an array of strings or one multi-line string");
    groups.push([head, ...areas.map((r) => `  ${String(r).replace(/^\s+/, "")}`)]);
  }

  const openings = level["openings"];
  if (Array.isArray(openings) && openings.length) groups.push(openings.map(openingLine));

  const fixtures = level["fixtures"];
  if (Array.isArray(fixtures) && fixtures.length) groups.push(fixtures.map(fixtureLine));

  return groups;
}

/**
 * Print a JSON plan document as canonical DSL. Like `formatPlan`, this is a *document*
 * printer: it writes the fields it is given, so a document authored with `rect` keeps its
 * `rect`. The two synonym pairs `parse()` folds together (`position` as a number versus
 * `{from:"start",distance}`; an explicit `"center"` versus none) have one DSL spelling
 * each, so a conversion picks it — see the header.
 */
export function toDsl(doc: unknown): string {
  if (!isObj(doc)) throw new TypeError("a plan document must be a JSON object");
  for (const key of Object.keys(doc)) {
    if (/^(_|x-)/.test(key))
      throw new DslError([{ line: 1, column: 1, message: `line 1: the DSL has no spelling for the private key ${JSON.stringify(key)}; keep that document as JSON` }]);
  }

  const groups: string[][] = [];

  // ---- the plan line, and the shared grid ----
  const headTokens: string[] = [];
  if (doc["title"] !== undefined) headTokens.push(quote(doc["title"]));
  if (doc["units"] !== undefined) headTokens.push(`units:${String(doc["units"])}`);
  const w = doc["walls"];
  if (isObj(w)) {
    if (w["exterior"] !== undefined && w["partition"] !== undefined) headTokens.push(`walls ${numText(w["exterior"])}/${numText(w["partition"])}`);
    else if (w["exterior"] !== undefined) headTokens.push(`walls exterior:${numText(w["exterior"])}`);
    else if (w["partition"] !== undefined) headTokens.push(`walls partition:${numText(w["partition"])}`);
  } else if (w !== undefined) throw new TypeError("walls must be an object { exterior, partition }");
  if (doc["north"] !== undefined) headTokens.push(`north ${numText(doc["north"])}`);
  const stack = doc["stack"];
  if (stack !== undefined) {
    if (!Array.isArray(stack)) throw new TypeError("stack must be an array of level ids");
    headTokens.push(`stack ${stack.map(String).join(",")}`);
  }
  const header: string[] = [];
  if (headTokens.length) header.push(`plan ${headTokens.join(" ")}`);
  const grid = doc["grid"];
  if (isObj(grid)) {
    let g = "grid";
    if (grid["cols"] !== undefined) g += ` cols ${listText(grid["cols"])}`;
    if (grid["rows"] !== undefined) g += ` rows ${listText(grid["rows"])}`;
    header.push(g);
  } else if (grid !== undefined) throw new TypeError("grid must be an object { cols, rows }");
  if (header.length) groups.push(header);

  // ---- levels ----
  const levels = doc["levels"];
  if (levels !== undefined) {
    if (!isObj(levels)) throw new TypeError("levels must be an object keyed by level id");
    for (const [id, lv] of Object.entries(levels)) {
      if (!isObj(lv)) throw new TypeError(`levels.${id} must be an object`);
      let head = `level ${id}`;
      if (lv["name"] !== undefined) head += ` ${quote(lv["name"])}`;
      if (lv["height"] !== undefined) head += ` h${numText(lv["height"])}`;
      head += flagText(lv["ground"], "ground");
      groups.push([head]);
      groups.push(...levelBody(lv));
    }
  } else {
    groups.push(...levelBody(doc));
  }

  // ---- vertical circulation, last: it is the one statement that spans levels ----
  const vertical = doc["vertical"];
  if (vertical !== undefined) {
    if (!Array.isArray(vertical)) throw new TypeError("vertical must be an array");
    for (const v of vertical) {
      if (!isObj(v)) throw new TypeError("a vertical element must be an object");
      let head = `${String(v["type"])} ${String(v["id"])}`;
      if (v["name"] !== undefined) head += ` ${quote(v["name"])}`;
      if (v["up"] !== undefined) head += ` up:${numText(v["up"])}`;
      if (v["risers"] !== undefined) head += ` risers:${numText(v["risers"])}`;
      const at = v["at"];
      if (!Array.isArray(at)) throw new TypeError("a vertical element needs an `at` array of footprints");
      groups.push([head, ...at.map((a) => `  ${footprintLine(a)}`)]);
    }
  }

  return `${groups.filter((g) => g.length).map((g) => g.join("\n")).join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// sniffing, and the line-based twin of jsonpos
// ---------------------------------------------------------------------------

/**
 * Which syntax a source text is in: the first non-space character, and nothing else. `{`
 * is JSON, anything else is the DSL — so a JSON document behaves byte-identically to the
 * way it always has, and an empty file keeps JSON's own "not valid JSON" message rather
 * than becoming an empty plan.
 */
export function isDslText(text: string): boolean {
  const first = text.replace(/^﻿/, "").trimStart()[0];
  return first !== undefined && first !== "{";
}

/**
 * Read a source text (or pass a value straight through) as the JSON document shape.
 * `positions` is present only for a DSL document, and is what gives a finding its `line`
 * and an edit its splice range.
 */
export function readSource(input: unknown): { doc: unknown; positions?: DslPositions } {
  if (typeof input !== "string") return { doc: input };
  if (!isDslText(input)) return { doc: JSON.parse(input) };
  const { doc, positions } = parseDsl(input);
  return { doc, positions };
}

/** Error raised when a JSON path names nothing the DSL text can splice. */
export class DslPosError extends Error {
  readonly line: number | undefined;
  readonly column: number | undefined;
  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = "DslPosError";
    this.line = line;
    this.column = column;
  }
}

/**
 * Replace the value at `path` with `literal` (a JSON literal, as `set` and the drag layer
 * produce) in a DSL document, leaving every other character of the line — and every other
 * line — exactly as it was. The line-based twin of `jsonpos.spliceAt`.
 */
export function dslSpliceAt(text: string, path: Array<string | number>, literal: string): { text: string; start: number; removed: number; inserted: number } {
  const out = dslSpliceAll(text, [{ path, literal }], true);
  return out;
}

const pathText = (path: Array<string | number>): string =>
  path.map((s) => (typeof s === "number" ? `[${s}]` : `.${s}`)).join("").replace(/^\./, "");

export function dslSpliceAll(text: string, edits: Array<{ path: Array<string | number>; literal: string }>, detail?: false): string;
export function dslSpliceAll(
  text: string,
  edits: Array<{ path: Array<string | number>; literal: string }>,
  detail: true,
): { text: string; start: number; removed: number; inserted: number };
export function dslSpliceAll(
  text: string,
  edits: Array<{ path: Array<string | number>; literal: string }>,
  detail = false,
): string | { text: string; start: number; removed: number; inserted: number } {
  const { positions } = parseDsl(text);
  const resolved = edits.map(({ path, literal }) => {
    const key = pathText(path);
    const span = positions.get(key);
    if (!span) throw new DslPosError(`no value at ${key} in this DSL document`);
    let value: unknown;
    try {
      value = JSON.parse(literal);
    } catch {
      throw new DslPosError(`${key}: ${JSON.stringify(literal)} is not a JSON value`, span.line, span.column);
    }
    let written: string;
    try {
      written = span.write(value);
    } catch (e) {
      throw new DslPosError(`cannot write ${literal} at ${key} (line ${span.line}): ${(e as Error).message}`, span.line, span.column);
    }
    return { start: span.start, end: span.end, written, line: span.line, column: span.column };
  });
  resolved.sort((a, b) => b.start - a.start);
  for (let k = 1; k < resolved.length; k++) if (resolved[k]!.end > resolved[k - 1]!.start) throw new DslPosError("overlapping edits");
  let out = text;
  for (const r of resolved) out = out.slice(0, r.start) + r.written + out.slice(r.end);
  if (!detail) return out;
  const one = resolved[0]!;
  return { text: out, start: one.start, removed: one.end - one.start, inserted: one.written.length };
}

/**
 * The line a document path sits on, walking up the path until something matches — a
 * finding about `openings[3].width` lands on the opening's line even when only the whole
 * statement was recorded, and one about `rooms.sala` lands on the room's line.
 */
export function lineOf(positions: DslPositions, path: string): number | undefined {
  let p = path;
  for (;;) {
    const hit = positions.get(p);
    if (hit) return hit.line;
    const cut = Math.max(p.lastIndexOf("."), p.lastIndexOf("["));
    if (cut <= 0) return positions.get(`${p}#id`)?.line;
    const parent = p.slice(0, cut);
    const withId = positions.get(`${p}#id`);
    if (withId) return withId.line;
    p = parent;
  }
}

// ---------------------------------------------------------------------------
// the coverage table, rendered
// ---------------------------------------------------------------------------

/** The x/y ↔ compass fact neither reference used to state at all (docs/eval/cold/cold-run.md
 * item 3: brief 04's cold-agent porch placement guessed the wrong sign for south). Source:
 * `derive.ts`'s per-room wall search reads a room's north wall off its *minimum* y and its
 * south wall off its *maximum* y (`rect.y0`/`rect.y1`), and its west/east the same way on x —
 * so y increases southward and x increases eastward. Shared verbatim by `schemaTerse` (cli.ts)
 * and this function so the two references cannot state it two different ways. */
export const COMPASS_LINE = "axes: x east, y south; north = -y";

export interface DslSchemaOptions {
  /** include the 77-row `<object>.<field> → token` index (`--schema=dsl-full`); the default
   * omits it — it is what took `--schema=dsl` from 1 388 to well past a terse reference's
   * budget, and every field it lists is already implied by the statement grammar above it. */
  fieldIndex?: boolean;
  /** appended, converted through `toDsl`, as `example:` — a real, already-lint-clean
   * document (fix 4 for docs/eval/cold/cold-run.md: neither reference had one, and every
   * failure the eval logged is a fact a worked example would have settled). */
  example?: Record<string, unknown>;
  /**
   * The id format and every enum vocabulary, printed as a `## legend` section right after
   * "poly elements" — the same lines `cli.ts`'s shared `vocabLegend()` appends to the JSON
   * terse schema, passed in from there rather than built here, so this module never needs
   * to import the vocabularies twice or the two legends can't say two different things
   * (fix 1, docs/eval/cold2/cold-run.md: `--schema=dsl` never enumerated a room kind or a
   * fixture type at all, which alone caused 5 of 7 DSL parse failures in that eval).
   */
  legend?: readonly string[];
}

/** `--schema=dsl`: one line per statement kind with its tokens; `--schema=dsl-full` adds the
 * field index. Both end with a worked example when `opts.example` is given. */
export function dslSchemaText(opts: DslSchemaOptions = {}): string {
  const out: string[] = [
    "# floorplan DSL — one entity per line; `{` as the first character means JSON instead",
    `# ${COMPASS_LINE}`,
    // fix 6, docs/eval/cold2/cold-run.md: a semantic rule (a habitable room needs a window,
    // a room needs a door) is only learnable by running the tool; this points at the one
    // place every such rule is listed rather than leaving it to be tripped over.
    "# run --lint; every rule is listed by floorplan --rules",
    "",
    "## statements",
    "",
  ];
  for (const s of DSL_SCHEMA) {
    if (s.element) continue;
    out.push(s.syntax.split("\n").join("\n"));
    if (s.example) out.push(s.example);
    out.push(`  — ${s.doc}`, "");
  }
  out.push("## poly elements", "", `  ${POLY_INLINE_EXAMPLE}`, "", "  <x>,<y>");
  for (const s of DSL_SCHEMA) {
    if (!s.element) continue;
    out.push(s.syntax, `  — ${s.doc}`);
  }
  if (opts.legend?.length) out.push("", "## legend", "", ...opts.legend);
  if (opts.fieldIndex) {
    out.push("", "## every schema field, and the token that writes it", "");
    for (const o of SCHEMA) {
      for (const f of o.fields) {
        const tokens = DSL_SCHEMA.flatMap((s) => s.tokens.filter((t) => t.field === `${o.object}.${f.name}`).map((t) => t.token));
        out.push(`${`${o.object}.${f.name}`.padEnd(28)} ${[...new Set(tokens)].join(" | ")}`);
      }
    }
  }
  // `toDsl` already ends its text with "\n"; strip it so the join below controls spacing.
  if (opts.example) out.push("", "## example", "", toDsl(opts.example).replace(/\n$/, ""));
  return `${out.join("\n")}\n`;
}
