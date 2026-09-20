# floorplan

Declarative floor-plan renderer and linter. A description of rooms and openings
becomes a scaled SVG, and a validator tells you what is wrong with the house
before you draw it. "Mermaid for floor plans."

Write the plan as JSON, or in the [line DSL](#the-line-dsl) — one entity per
line, about half the tokens, and the same document either way.

- Rooms in, walls derived, openings attached to walls, findings out.
- Zero runtime dependencies. ESM + TypeScript. `render` returns a string; no DOM.
- Any simple polygon, straight or curved, one level or many. See `specs/floorplan-lib-plan.md` for scope.

```
npm install          # dev deps only (typescript)
npm run check        # typecheck + tests (node --test)
npm run examples     # renders fixtures/*.json → examples/*.svg
node src/bin.ts fixtures/casa-t3.json --out casa.svg --lint
```

**If you are an agent authoring or editing a plan**, load one of the generated
schemas instead of this README's prose, and then `floorplan <plan> --lint` for
what is wrong with a document you already have (105 tokens on casa-t3's two
findings) or `--json` for the same thing as data (174; see "What an agent pays
to read a plan back" below).

| load | what it is | tokens |
|---|---|---:|
| `floorplan --schema` | one compact typed-signature line per object (with cardinality — `{id: room}`, `opening[]`), a legend, and a worked example — all 15 objects and 77 fields | 1 181 |
| `floorplan --schema=dsl` | the line DSL's grammar — every statement and its tokens — plus the same legend and worked example, without the field-by-field index below | 1 363 |
| `floorplan --schema=dsl-full` | `--schema=dsl` plus the field-by-field token index for all 77 fields | 2 016 |
| `floorplan --schema=full` | the same JSON table with types, enums, cardinality and a one-sentence doc per field | 2 806 |
| `floorplan --schema=md` | the full table as Markdown, for a human | 2 407 |
| `floorplan --rules` | every rule id and its one-line `catches`, compact | 1 119 |

Take `--schema` when you are editing a document you already have, and
`--schema=dsl` when you are writing one from scratch: the documents the DSL
teaches you to write are still about half the size, so it still pays for
itself on the first house even though its own reference costs a little more
to load — `--schema=dsl` now carries the same legend `--schema` does (every
room kind, fixture type, opening type, vertical type and side, spelled out
once) plus worked examples for `level` and `layout`, the two statements a
cold-agent eval (`docs/eval/cold2/cold-run.md`) found under-specified. All six
are generated from the library itself, so none can list a field, a token or a
rule the parser and linter do not actually have; `--rules` is what both
schemas now point an agent at for the rules — a habitable room needs a
window, a room needs a door — that only `--lint` can teach.

## Playground app

A separate React app under `app/` — a demo of the library and a place to try the plan
language. It depends on the library as a package (`node_modules/floorplan` is a symlink
to this repo), so it can only use what the library exports; a test enforces that it never
reaches into `src/`.

```
npm run dev:app      # build the library, then vite dev on :5173
npm run build:app    # production build into app/dist
npm run check:all    # library checks, then the app typechecks against the built library
```

Routes: a gallery of the example plans, `/plan/$id` for the editor, and `/reference` —
the DSL documentation, which renders the parser's own vocabularies and the library's rule
catalogue rather than a copy of them.

A plan with more than one level gets a tab per storey, ground-up, above the drawing (the
ground one is marked). Selecting a level draws it with the level below ghosted, scopes the
findings panel to that level's findings plus the building-wide ones (the ones with no
`level`), scopes every drag to it, and shows its own room-schedule section alongside the
building's totals. The selected level survives text edits as long as it still exists, and
falls back to the ground level the moment it does not. A single-level plan shows no tabs
and nothing else changes. The gallery marks a multi-level plan with an "n levels" badge on
its ground-level thumbnail; opening it goes to the same editor as any other plan.

### Dragging walls

Walls in the drawing can be dragged, and a drag **edits the source**. The text stays the
single source of truth: moving a wall works out the new coordinate, splices it into the
document, and the ordinary pipeline redraws — text → parse → derive → rules → SVG, which
measures 1.5–5.2 ms over this repository's fixtures (21 ms for `casa-redonda`, whose round
hall is flattened to a hundred chords), so the whole plan is recomputed on every pointer
move rather than patched. Nothing is held in two places, so the drawing and the editor
cannot drift.

A wall is offered for dragging only when the move has a representation in the source:

| authored as | a drag writes | offered when |
|---|---|---|
| a `layout` grid | `cols[i]` and `cols[i+1]`, one growing by what the other loses | the wall sits on a track boundary |
| a `layout` grid, far edge | the last track, so the building grows or shrinks | the wall is the far edge of the grid |
| room polygons | the shared coordinate in the two spaces the wall separates | the wall spans the whole of each edge it touches |
| a room `rect` | `x`/`width` or `y`/`height`: the near side moves the origin, the far side resizes | as above |
| an outdoor `poly` or `rect` | the coordinate shared by the edge's two corners, or the matching `rect` pair | the space authored its own geometry rather than being placed on the grid |
| a fixture | its body moves, its four sides resize it | always; written back as `poly`, or as `at`/`size`, whichever the source uses |
| a shared `grid` boundary | `grid.cols[i]` and `[i+1]` — **and the wall moves on every level using the grid**, which the status line says | the wall sits on a shared track boundary |

A grid drag is offered only where the grid is what *placed* one of the spaces the wall
separates. A poly-authored room whose wall happens to sit on a track line — quinta's
detached shack does, a metre south of where the grid ends — is dragged by its own
coordinates instead, or the drag would resize the house and leave the shack alone.

A space is always written back **in the form it was authored in** — a `rect` room stays a
`rect`, a `poly` room stays a `poly` — so a drag never reformats a document someone is
still typing in. That is the contract fixtures have kept for `poly` versus `at`+`size`.

### Handles: dragging what is not a grid line

`wallHandles(text, model)` is the general form beside `draggableWalls`, for walls that
are not one coordinate on one axis.

| kind | what it moves | what it writes |
|---|---|---|
| `offset` | a straight wall along its own normal; the corners on it move and the edges running into them pivot | both coordinates of each moved corner — or, where the normal is on an axis, exactly what the coordinate drag writes |
| `radius` | a curved wall's bulge | the `r` of the arc that made it: one number, in place |
| `vertex` | one corner, in two dimensions | `poly[v][0]` and `poly[v][1]`, only the one that changes if only one does |

An offset is refused when the wall's end is incident to a *third* space — a T-junction on
its edge, or its corner — and the wall's normal does not run along that boundary: the end
would come off a boundary it was sitting on and tear the plan. `applyHandle` (offset and
radius) and `applyVertexHandle` snap and clamp exactly as `applyDrag` does.

An outdoor space has no walls — nothing derives from it — so its own edges are the
handles, and dragging one resizes the deck or terrace without touching the house. A
fixture can be picked up and carried, or resized by a side; moving one rewrites only
`at`, so a pool keeps its size when you put it somewhere else.

The last condition is the interesting one: if one of those two spaces has a vertex on
that line outside the wall's run, moving it would need the edge split and vertices
inserted, which is a different operation than a drag — so the wall is simply not
draggable. Only the two spaces a wall separates ever move; a room that merely shares the
coordinate stays where it is. The one edge that never moves is the near edge of a grid,
because the grid is anchored at 0 and shifting it would rewrite every coordinate in the
document. A grid boundary also carries any space anchored to it, so a courtyard
declared with an absolute `poly` or `rect` travels with the tracks instead of tearing open. Everything else is
clamped rather than forbidden, and because `derive()` reports problems as findings rather
than throwing, a drag that makes the plan invalid turns the findings red live instead of
being blocked. Drags land on 5 cm; hold Alt for millimetres.

While the source does not parse — halfway through typing a number, say — the last valid
drawing stays on screen, dimmed, with the parse error in the panel header rather than in
place of the drawing; a short *Updated* confirms when a new one lands.

A press only becomes a drag after 3 px, so clicking a wall changes nothing, and each
move re-applies from the document as it was when the gesture began — so however many
moves arrive, the wall lands where the pointer is rather than accumulating. Undo
(⌘Z) and redo (⇧⌘Z) take one step per gesture, and Reset returns the plan to the example.

`draggableWalls(text, model, level?)` and `applyDrag(text, draggable, metres)` are library
functions — the app only turns pointer events into coordinates. On a document that
authored `levels`, every path a drag writes gains a `levels.<id>.` prefix and nothing
else changes; on one that did not, the paths are the ones they always were.

## CLI

```
floorplan <plan.json> [--out plan.svg] [--level id] [--lint]
                      [--json[=findings|all|schedule|walls]] [--scale N]
                      [--theme auto|light|dark] [--labels auto|full|index]
                      [--areas clear|centreline|none] [--mark error|warning|info|none]
floorplan set <plan.json> <path> <value> [--json] [--dry-run]
floorplan patch <plan.json> <patch.json|-> [--patch <patch.json|->] [--json] [--dry-run]
floorplan fmt <plan> [--to json|dsl] [--out file] [--stdout] [--dry-run]
floorplan --schema[=full|md|dsl|dsl-full]
```

A plan file may be JSON or the line DSL, and every command takes either: the first
non-space character decides, so `floorplan plan.dsl --lint` and `--json` need no flag.

Exit codes: `0` clean or info only, `1` findings at warning or above, `2` usage or schema error.

`--level` picks which storey to draw; the default is the ground level, so a single-level
plan needs it never. `--out` may contain `{level}`, and then one sheet per storey is
written (`--out plan-{level}.svg` → `plan-piso0.svg`, `plan-piso1.svg`). `--lint` prefixes
each finding with the level it is about once there is more than one, and a building-wide
finding shows `—`.

`--schema` needs no input file: it prints every object's field list, read straight from
the table the parser itself validates against (see "Plan format" below). Default is one
typed-signature line per object — name, required/`?`, type, every enum as a `enum(NAME)`
reference resolved once in a trailing legend, cardinality on every nested-object field
(`{id: room}` for an id-keyed map, `opening[]` for a list, bare `opening.on` for a single
nested object) — plus the id format, the x/y ↔ compass axes, a worked example for `layout`
(`fixtures/apartment-t2.json`'s own, the one element neither reference used to demonstrate),
and one small worked example for the whole document (`fixtures/cabin.json`, canonical form)
at the end: no per-field doc text, 1 181 tokens for all 15 objects/77 fields. `--schema=full`
prints the same table as compact JSON with name, type, required, enum values, cardinality
and the one-sentence doc, one field per line, 2 806 tokens. `--schema=md` prints the full
table as Markdown. `--schema=dsl` prints the line DSL's grammar instead, from its own table
(see "The line DSL" below), sharing `--schema`'s own legend so a vocabulary cannot drift
between the two, plus worked examples for `level` (two levels, so the statement-scoping rule
is shown as well as told) and `layout`, 1 363 tokens; `--schema=dsl-full` adds the
field-by-field token index `--schema=dsl` omits, 2 016 tokens. `--rules` prints the rule
catalogue — every rule id and its one-line `catches`, compact, 1 119 tokens — which both
schemas' preambles now point at for a rule (a habitable room needs a window; a room reached
only by a stair still needs a door) that only `--lint` can teach.

`fmt` canonicalises a plan and converts it between the two syntaxes. Without `--to` the
file keeps the syntax it is in; `--out` writes somewhere else, which is what a conversion
usually wants (`floorplan fmt plan.json --to dsl --out plan.dsl`); `--stdout` and
`--dry-run` print the result and write nothing. Like `set` and `patch`, it validates
before it writes, so a file is replaced only once its replacement is known good.

#### `--json`: findings first

```jsonc
// floorplan casa-t3.json --json
{
  "summary": {"error":0,"warning":2,"info":1},
  "findings": [
    {"rule":"wet.no_window","severity":"warning","message":"WC suite has no exterior window; plan mechanical extraction","path":"rooms.wc_suite","rooms":["wc_suite"],"at":[5.7,1.1]}
  ]
}
```

| mode | prints |
|---|---|
| `--json` (= `--json=findings`) | `{ summary, findings }` |
| `--json=all` | `{ summary, findings, schedule, walls }` |
| `--json=schedule` | `{ schedule }` |
| `--json=walls` | `{ walls }`, scoped by `--level` |

Findings-first is the default because a read-back should grow with the number of
**problems**, not with the size of the building. The schedule of a clean three-storey
house is ~780 tokens before a single finding; the findings are ~60. Everything is printed
through the same one-entity-per-line formatter as the canonical plan form, so a finding is
one line and a coordinate never gets a line of its own.

`walls` is the derived wall list — how an agent sees where a wall runs *before* placing an
opening on it, instead of learning its extent by tripping `wall.ambiguous`:

```jsonc
{"id":"w5","kind":"partition","from":[6,2],"to":[8,2],"neg":{"kind":"room","id":"living"},"pos":{"kind":"room","id":"kitchen"}}
```

Endpoints are points, never `axis` + `c`: those two fields describe an axis-aligned
segment and nothing else, and two endpoints describe any segment. `neg`/`pos` are the
owner union (`{"kind":"room","id"}`, `{"kind":"outdoor","id"}`, `{"kind":"exterior"}`,
`{"kind":"void","id"}`, `{"kind":"gap"}`). A wall id is unique **within its level**; on a
document that authored `levels` each row also carries `level`.

On a schema error (exit `2`), `--json` prints
`{"error":{"issues":[{"path","message","kind"}]}}` to stdout instead of the text form on
stderr; without `--json` the text form is unchanged. `kind` is the same vocabulary the
`schema.*` findings use (see **Findings**).

#### What an agent pays to read a plan back

Measured with `gpt-tokenizer`'s `o200k_base`, before this change and after:

| read-back | before | after |
|---|---:|---:|
| casa-t3 `--json` (was findings + schedule, pretty) | 1 270 | **174** |
| moradia-2-pisos (two storeys) `--json` | 1 771 | **191** |
| broken `--json` (20 findings) | 1 985 | **1 343** |
| broken, the findings alone, pretty-printed | 1 490 | 1 955 |
| broken, the same findings through the formatter | — | **1 292** |
| casa-t3 `--lint` text | 105 | 105 |
| casa-t3 `--json=all` | — | 3 020 |

Two things moved at once. The formatter takes 34 % off the same payload (broken's findings
go 1 955 → 1 292), and dropping the schedule from the default takes off the rest: a clean
plan now costs what its problems cost. Findings themselves grew — `path`, a stable
`opening`/`fixture` id and the structured fix data are new — and that is the trade the
numbers were measured to make: broken's findings are 40 % bigger and still arrive for less
than the old default, and a clean plan of any size reads back in under 200 tokens.

### `set` and `patch`: editing without re-emitting the document

Re-emitting a whole plan to move one door costs on the order of 2000 tokens for a
house-sized document; a splice costs about 20, regardless of plan size — so `set` and
`patch` are how an agent should make small edits, not printing and rewriting the JSON.

`set` changes one value at a path (the same dotted/bracketed form `pathToString` prints,
and the same form every finding's `path` is in, e.g. `openings[3].position`,
`rooms.sala.poly[2][0]`, `layout.cols[1]` — and, on a document that authored `levels`,
`levels.piso1.rooms.suite.rect[3]`). A finding's `path` is accepted verbatim:

```
floorplan set plan.json "$(floorplan plan.json --json | jq -r '.findings[0].path')" 0.9
```

```
floorplan set plan.json openings[3].position 2.1
floorplan set plan.json rooms.sala.name Sala        # not valid JSON → treated as the string "Sala"
floorplan set plan.json openings[3].position 2.1 --dry-run   # preview the new text, don't write
```

`patch` applies several operations at once, all-or-nothing — if any op fails, nothing is
written and the CLI reports which one and why:

```
floorplan patch plan.json patch.json
floorplan patch plan.json --patch -    # read the patch document from stdin
```

`patch.json` is a JSON array of `{ "op": "set" | "remove" | "append" | "insert", "path": "...", "value"?: <any>, "key"?: "..." }`
(`op` defaults to `"set"`). `remove` deletes an array element or object member;
`append` adds a new array element after the last one; `insert` adds `key: value` to an
object (e.g. a new room in `rooms`). Example, deleting one opening and adding a room in
one call:

```json
[
  { "op": "remove", "path": "openings[9]" },
  { "op": "insert", "path": "rooms", "key": "garagem", "value": { "name": "Garagem", "kind": "garage", "poly": [[0, -3], [4.6, -3], [4.6, 0], [0, 0]] } }
]
```

Both verbs run the full pipeline on the result before writing anything: a change that
fails schema validation (`PlanError`) leaves the file untouched and reports the error
(as the JSON envelope above under `--json`) with exit `2`; a change that validates but
still has findings is written, and those findings are printed exactly as `--lint` would
(or as `{ summary, findings }` under `--json`).

## Library

```ts
import { floorplan, lint, parse, analyze, renderSvg, walls } from "floorplan";

const { svg, findings, schedule } = floorplan(json);   // one call
const { levels } = floorplan(json);                    // [{ id, name, svg, findings }, …]

const plan = parse(json);                 // throws PlanError listing every schema problem
const { model, findings } = analyze(plan); // never throws; geometry problems are findings
const svg = renderSvg(model, { findings, theme: "auto" });
const rows = walls(model);                // [{ id, kind, level?, from, to, neg, pos }, …]
```

### `lint()`: one channel, and it never throws

```ts
const { findings, plan, model } = lint(json);
```

`lint()` folds schema problems into the findings instead of throwing them: each becomes
`{ rule: "schema.<kind>", severity: "error", message, path }`, with the same document
`path` a geometry finding would carry, so one loop over `findings` handles every problem a
document can have. `plan` and `model` are present exactly when the document passed the
schema; `error` carries the `PlanError` that `parse()` would have thrown, for a caller
that wants its message.

`parse()` and `floorplan()` still throw, so nothing that relied on that changed. The CLI
goes through `lint()`, which is why `--lint` prints schema and geometry problems in one
list — `--json` keeps its separate error envelope on schema failure, because a caller that
cannot get a plan at all should be told so unmistakably.

## Plan format

This section is the JSON document: the canonical model, and what both syntaxes mean. The
[line DSL](#the-line-dsl) is the other way to write exactly this, and compiles to it.

Coordinates are metres on **wall centrelines**, y grows downwards (north up).
Rooms must tile the footprint exactly; walls are derived from shared edges.
A void on the boundary is simply the shape of the building; an *enclosed* void is a
`tiling.gap` error unless you declare it as an outdoor space (see below).

### What shapes are allowed

Any **simple polygon**: three corners or more, any winding, edges at any angle, and any
edge may be a true **circular arc** (see below). What is refused, with the reason: fewer
than three distinct corners, zero area, an arc whose radius cannot span its chord, and a
boundary that crosses or touches itself.

Rooms, outdoor spaces, voids, fixtures and stair footprints all take the same shape.
`rect` and the `layout` track grid stay exactly as they were — they are sugar for the
rectangles most rooms are, and they compile to polygons before anything else sees them.

Inside, the library works in **integer millimetres**: the parser converts metres once at
the boundary, and the geometry core compares with `===` instead of the six different
tolerances it used to need. The API is metres throughout — `Room.poly`, `Wall.start`,
`RoomModel.area` and everything else you can read are metres, exactly as before.

Every object below (the top-level document, `walls`, `layout`, each room, each outdoor
space, each opening and its `on`/`position`, each fixture) is checked against its known
fields; a key that isn't one of them is a schema error, with a "did you mean" when it's
close to a real field (`"positon"` → `did you mean "position"?`). A key prefixed with
`_` or `x-` is exempt — use it for private notes or authoring-tool metadata
(`"_note"`, `"x-generator"`) and it is silently ignored.

The prose and examples below teach the shape; **`floorplan --schema` is the authoritative
field list** — every object, field, type, cardinality (a single object, a list, or an
id-keyed map) and mutual exclusion, terse, read directly from the same table `checkKeys`
validates against, so it cannot list a field the parser does not also accept. `--schema=full`
adds each field's one-sentence doc (units, defaults, what reads it) as compact JSON;
`--schema=md` prints that same detail as Markdown for a human reader.

```jsonc
{
  "title": "Casa T3",
  "walls": { "exterior": 0.30, "partition": 0.12 },
  "rooms": {
    "hall":  { "name": "Hall",  "kind": "hall",    "zone": "day",   "rect": [0, 4.4, 4.6, 3.6] },
    "suite": { "name": "Suite", "kind": "bedroom", "zone": "night", "rect": [0, 0, 4.6, 4.4] },
    "sala":  { "name": "Sala",  "kind": "living",  "zone": "day",   "poly": [[6.6,5.8],[12,5.8],[12,10.6],[4.6,10.6],[4.6,7.8],[6.6,7.8]] }
  },
  "outdoor": { "porch": { "name": "Alpendre", "covered": true, "rect": [6.6, 10.6, 5.4, 2.8] } },
  "openings": [
    { "type": "door", "between": ["exterior", "hall"], "position": { "from": "start", "distance": 1.7 },
      "width": 1.0, "hinge": "end", "swingInto": "hall", "entrance": true },
    { "type": "door", "between": ["hall", "suite"], "position": 3.45, "width": 0.9, "hinge": "end", "swingInto": "suite" },
    { "type": "window", "between": ["exterior", "suite"], "on": { "room": "suite", "side": "north" }, "position": 2.3, "width": 2.2 }
  ]
}
```

### Levels

A document with no `levels` block is a single-level plan and always will be: it parses,
lints, renders, formats and edits exactly as it did before levels existed, down to the
byte, and its document paths stay `rooms.sala.poly[2][0]`. Everything below is additive.

```jsonc
{
  "stack": ["cave", "piso0", "piso1"],          // ground-up; optional, key order otherwise
  "grid": { "cols": [4.9, 1.2, 1.3, 4.4], "rows": [1.4, 1.8, 2, 2, 1, 1.8] },
  "levels": {
    "piso0": { "name": "Piso 0", "height": 2.7, "ground": true, "rooms": { … }, "openings": [ … ] },
    "piso1": { "name": "Piso 1", "height": 2.6, "layout": { "areas": [ … ] }, "voids": { … } }
  },
  "vertical": [
    { "id": "escada", "type": "stairs", "name": "Escada", "up": 0, "risers": 15,
      "at": [{ "level": "piso0", "in": "hall",     "rect": [4.95, 0.2, 1.1, 3.64] },
             { "level": "piso1", "in": "hall_sup", "rect": [4.95, 0.2, 1.1, 1.1] }] }
  ]
}
```

| Field | Meaning |
|---|---|
| `stack` | level ids, ground first. Optional — the `levels` object's own key order says the same thing — but when given it must name every level exactly once |
| `levels` | a **map**, not an array, so adding a basement never renumbers a path someone is holding |
| `levels.<id>.ground` | the level the street meets. Default: the first in the stack. A sloping site may mark more than one |
| `levels.<id>.height` | floor to floor, metres. Only `stair.pitch` and `stair.headroom` read it |
| `levels.<id>` content | `rooms`, `outdoor`, `voids`, `layout`, `openings`, `fixtures` — the same keys a single-level document writes at the top |
| `grid` | an optional shared track grid. A level that gives only `layout.areas` sits on it, which is the mechanism that makes an upper floor's walls land on the lower floor's. A level may still author its own `layout.cols`/`rows` and opt out |
| `vertical` | stairs, lifts and ramps: the only entity that spans levels |

Levels share the plan origin and axes — there is no per-level transform — so every sheet
lines up with every other.

#### Vertical circulation

A stair is matched between levels by its **own id**, never by footprint overlap. That
costs about four tokens and buys three findings that footprint matching cannot express:
two shafts 20 cm apart are never silently joined, a switchback whose upper flight sits
beside the lower one is still one stair, and `stair.misaligned` can exist at all.

| Field | Meaning |
|---|---|
| `id` | required, and the only thing that joins the levels |
| `type` | `stairs`, `lift`, `ramp` |
| `at` | one `{ level, in, poly \| rect }` per level it serves, sorted into stack order by the parser. `in` names the room or outdoor space you step off it into on that level — not "whichever room contains the footprint", which is undefined when a stair sits on a wall |
| `up` | bearing of travel upward, degrees clockwise from north. Needed for `stair.headroom` |
| `risers` | risers between the levels it joins. With the lower level's `height`, gives the rise, the going and the pitch |

On every level it serves a vertical element is an obstacle exactly as a `stairs` fixture
is: it takes floor, it is excluded from the clear rectangle, and a door swinging into it
is reported. It has no `fixtures[i]` to address, so a finding about one carries
`vertical: "<id>"` instead of `fixture: <n>`, and the drawing tags it `data-vertical`.

The `stairs` **fixture** type is unchanged and stays: on a single-level plan it is the
right way to draw a stair that goes somewhere the model does not describe. It is a
drawing-only obstacle and joins nothing — on a multi-level plan, use `vertical`.

#### Voids

A `void` is the dual of an `outdoor` space: an outdoor space is a declared absence of
*roof*, a void is a declared absence of *floor*. Both stop a cell inside the footprint
being a `tiling.gap`, and both are owner classes, so a wall derives beside one.

```jsonc
"voids": { "vazio_sala": { "name": "Pé-direito duplo da Sala" } }   // or a poly / rect
```

A void has the building over it, so it is *not* open sky: the wall between a room and a
stairwell is an ordinary partition, a window onto a void is still `window.not_exterior`,
and the envelope wall runs past a double-height space that reaches the façade. A void's
area stays out of `interiorArea` and inside the envelope, and nothing opens into one —
naming a void in an opening's `between` is a schema error.

A void has to reach an edge of the room around it. A room enclosing one completely would
be a ring, and a single ring cannot express a hole.

### Canonical form — how a plan should be written

`formatText(source)` puts a document into the canonical form, and every fixture in this
repository is byte-identical to its own canonical form (a test enforces it). The form is
chosen for the reader who pays per token:

- **One entity per line, regardless of width.** A room, an outdoor space, an opening or a
  fixture is exactly one line and is never wrapped. That is what makes a plan skimmable,
  diffable, and addressable — "replace line 14" is a whole opening.
- **Compact separators inside the entity** (`{"type":"door","width":0.8}`): no space after
  `:` or `,`. Pretty separators were measured at 28 % of the document.
- **Container or entity is decided by shape, not by depth.** A value is a *container* when
  it holds a collection of entities (every member is an object) or when something inside it
  is one; a container opens and closes on its own lines with one member per line at a
  2-space indent. Everything else is an *entity* and prints on one line. That makes
  `rooms`, `outdoor`, `openings` and `fixtures` containers and a room one line today, and
  it will make a `levels` map a container of per-level containers of one-entity lines with
  no change to the formatter. `walls` holds two numbers, so it stays on one line, and so
  does a room's `poly`, which is a list of rows rather than a collection of entities.
  `layout.areas` is the one exception and it is a key, not a shape: it is an ASCII picture,
  so its rows print one per line and keep lining up.
- **Points stay inline**, numbers print shortest round-trip (`4.6`, never `4.60`), and
  there is no column alignment to maintain.

Measured with the `o200k_base` BPE, this repository's seven fixtures:

| fixture | before | canonical | as shipped, with `rect` | as the line DSL | lines (old formatter → now) |
|---|---:|---:|---:|---:|---|
| casa-t3 | 2 322 | 1 687 | **1 502** (−35 %) | **788** (−48 %) | 141 → 49 → 40 |
| apartment-t2 | 1 079 | 794 | 794 (−26 %) | **361** (−55 %) | 74 → 38 → 27 |
| casa-piscina | 1 169 | 868 | 866 (−26 %) | **478** (−45 %) | 47 → 46 → 30 |
| quinta | 1 042 | 791 | 767 (−26 %) | **380** (−50 %) | 50 → 44 → 29 |
| casa-patio | 805 | 607 | 585 (−27 %) | **272** (−54 %) | 42 → 36 → 22 |
| broken | 677 | 483 | 411 (−39 %) | **205** (−50 %) | 23 → 23 → 18 |
| cabin | 644 | 473 | 417 (−35 %) | **196** (−53 %) | 41 → 21 → 14 |
| **all seven** | **7 738** | **5 703** | **5 342 (−31 %)** | **2 680 (−65 %)** | 418 → 257 → 180 |
| moradia-2-pisos | — | — | **1 594** | **849** (−47 %) | 94 → 56 |
| broken-levels | — | — | **770** | — | 62 |

The DSL column is `floorplan fmt <fixture> --to dsl` on each one, measured with the same
`o200k_base` BPE. broken-levels has no DSL column because it carries an `x-`/`_` private
key, which is the one thing the DSL has no spelling for (see **The line DSL**). The
review's own hand-written casa-t3 sample (`docs/agent-review.md`, 733 tokens) parses in
this grammar and prints back at exactly 733; the shipped fixture is 788 because it also
authors `swingInto` on all thirteen doors, `units` and `north`, which the sample left out.

The two-storey house costs 1 594 tokens — 6 % more than casa-t3's single storey for twice
the building, because a level is a block header rather than a second document. A
`vertical` entry is the one place the canonical form breaks an entity across lines: its
`at` is a collection of entities, so the shape rule makes it a block, exactly as it does
`rooms`. That is the rule working, not an exception to it.

Both figures were measured with `gpt-tokenizer`'s `o200k_base` (`model/gpt-4o`), the same
BPE as the rows above; against today's fixtures that tokenizer reads casa-t3 as 1 502
rather than the 1 501 recorded when the table was written, so treat the older rows as
± 1 token rather than re-measuring them here.

The third column is what this repository ships: the canonical form plus `rect` for every
room and outdoor space that is a plain rectangle (see **Rooms**). casa-piscina's deck stays
`poly`-authored on purpose, so the poly write-back path keeps its coverage.

The old formatter wrapped anything past 140 columns, which turned casa-t3 into 141 lines
and saved 1 % (2 322 → 2 302); it was the most expensive form in the table it was meant to
improve. Three decisions in the new form were taken on measurements rather than taste:
pretty separators inside entities would cost **+28 %** (5 703 → 7 309) and are out; the one
space after a structural key (`"rooms": {` rather than `"rooms":{`) costs **1.7 %**
(95 tokens over seven fixtures) and is kept, because it is the only thing marking structure
in a document that is otherwise wall-to-wall punctuation; keeping `layout.areas` as a
picture costs **8–10 tokens** per grid plan and is kept, because a grid that does not line
up is not a grid.

Formatting is idempotent (`formatText(formatText(x)) === formatText(x)`), preserves the
parsed plan exactly, and leaves every `jsonpos` path resolvable — a drag still splices one
number in place and the document stays canonical without a reformat.

`formatPlan(value)` is the underlying *document* printer: it emits the keys it is given, so
a document authored with `rect` keeps its `rect`. A parsed `Plan` has already had `rect`
expanded to four points, so `formatPlan(plan)` cannot recover the shorthand — `formatText`,
text in and text out, is the one that preserves the author's form.

### Grid authoring (compiles to polygons)

Most house plans sit on a small track grid. Author it like CSS `grid-template-areas`;
same token in several cells makes one room, `.` is void. The grid is deliberately not
grown toward angles: it is what an apartment wants, and a room that is not on it is a
`poly` instead.

```jsonc
{
  "layout": {
    "cols": [3.2, 1.1, 2.0, 2.4],
    "rows": [3.2, 1.3, 1.5, 3.4],
    "areas": [
      "quarto1 hall quarto2 quarto2",
      "quarto1 hall wc      quarto2",
      "sala    hall wc      lavandaria",
      "sala    sala cozinha cozinha"
    ]
  },
  "rooms": { "quarto1": { "kind": "bedroom" }, "hall": { "kind": "hall" }, /* … */ }
}
```

### Outdoor spaces

`outdoor` entries are open sky, not floor: they carry `name`, `covered`, and either a
`poly`, a `rect` or a token in `layout.areas`. They stay out of `interiorArea` and appear
in `schedule.outdoor`.

Declaring one *inside* the footprint makes a courtyard. The walls around it derive as
**exterior** walls, so a window onto a patio counts as daylight
(`habitable.no_window` is satisfied, `window.not_exterior` stays quiet) — which is the
whole point of a patio house. Without the declaration the same void is a `tiling.gap`.

An outdoor space is a space in its own right: name its id in an opening's `between` to
put a door or a window on the wall that faces it, and it becomes a node of the access
graph like any room. `schedule.outdoor[].streetConnected` says whether you can walk
there from the street — true for a deck that touches the boundary, false for a courtyard
the house encloses. That distinction is what an **entrance** means (see below), and it
is why `"exterior"` never stands in for a courtyard: write the courtyard's id.

```jsonc
{
  "layout": { "cols": [3.6, 4.0, 3.6], "rows": [3.4, 4.0, 3.4],
              "areas": ["sala sala cozinha", "sala . cozinha", "hall hall hall"] },
  "outdoor": { "patio": { "name": "Pátio", "rect": [3.6, 3.4, 4.0, 4.0] } }
}
```

A pool or a terrace is the same thing with a different name — the model tracks area and
`covered`, not what the surface is made of. A garden shack is better modelled as a
detached **room**: give it a `rect` away from the house and its own exterior door, and it
derives real walls without tripping `tiling.gap` or `reach.unreachable`. Its floor does
count toward `interiorArea`, so deduct it if that matters to you.

### Rooms

| Field | Meaning |
|---|---|
| `kind` | `bedroom` `living` `kitchen` `office` `bath` `wc` `hall` `corridor` `storage` `utility` `garage` `other` |
| `habitable` / `wet` / `circulation` | derived from `kind`; set explicitly to override |
| `zone` | free label used for fill colour (e.g. `night`, `day`) |
| `poly` | any simple polygon, any winding, ≥3 corners, edges at any angle; omit when placed via `layout` |
| `rect` | `[x, y, width, height]` — the same rectangle as four points, for the common case |

`poly` and `rect` are mutually exclusive, exactly as a fixture's `poly` and `at`+`size`
are; giving both is `has both a poly and a rect; use one`. `rect` is authoring sugar and
nothing more — the parser expands it to four corners, so `derive`, the rules and the
renderer never see it — but it is worth having: it is 18 tokens cheaper per room and it is
the one way to write a rectangle you cannot get wrong. Eleven of casa-t3's thirteen rooms
are rectangles, and writing them as `rect` costs 186 tokens less.

### Curved walls

Any entry of a `poly` may be an **arc** instead of a corner:

```jsonc
{ "arc": [x, y], "r": 3.5, "sweep": "cw" | "ccw", "large": true }
```

It means *an arc from the previous corner to `[x, y]`, of radius `r`, turning that way*.
`sweep` is which way it turns seen on the page, where y grows south, so `"cw"` from the
top of a clock face goes east. `large` picks the arc of more than 180°; without it the
minor arc is meant. The centre is derived and never stored, which is what lets `r` be
edited on its own — a radius handle splices one number and the record cannot become
inconsistent. A ring may not *start* with an arc: the first entry is the corner it starts
from.

```jsonc
"rotunda": { "name": "Rotunda", "kind": "hall", "poly": [
  [6, 1.5],
  { "arc": [10, 1.5], "r": 2.5, "sweep": "cw" },
  { "arc": [10, 4.5], "r": 2.5, "sweep": "cw" },
  { "arc": [6, 4.5],  "r": 2.5, "sweep": "cw" },
  { "arc": [6, 1.5],  "r": 2.5, "sweep": "cw" }
]}
```

An arc is **exact** where it matters: a round room's area is πr², not the area of a
polygon through some number of points; the clear floor is the same arc with its radius
reduced; the drawing is an SVG `A` command, so it stays smooth at any zoom. It is
flattened into chords only to work out the topology, and by a function that takes nothing
but the arc — always subdividing from the lexicographically smaller endpoint, with a step
fixed by the radius alone — so the two rooms that share a curved wall produce the
identical chords and there is no comb of slivers between them.

Two neighbours share a curved wall by writing the same arc, each in its own direction:
one `{ "arc": [0, 3], "r": 3, "sweep": "cw" }`, the other `{ "arc": [0, -3], "r": 3,
"sweep": "ccw" }`. `fixtures/casa-redonda.json` is a worked example.

**What an arc costs.** Measured with `gpt-tokenizer`'s `o200k_base`: `casa-redonda` —
two wings joined by a round hall, four arcs — is **534 tokens**; the same three rooms
with the same areas to a hundredth of a square metre and the same seven openings, written
as three plain rectangles, is **392**. So the curve costs 142 tokens, +36 %, for the
whole house. Per room the geometry alone is 11 tokens as a `rect`, 21 as four explicit
points, **56 as two arcs**, and **169 hand-flattened to 21 points** — which is also not
1 mm correct and which the parser would have refused outright before, because its chords
are not axis-aligned.

An arc that bulges less than 5 mm past its chord is a straight edge written expensively,
and `arc.too_shallow` says so.

### Openings

| Field | Meaning |
|---|---|
| `id` | optional stable handle, `^[a-z][a-z0-9_]*$`, unique among the openings on its level. Synthesised when absent — see **Stable ids** |
| `type` | `door`, `window`, `cased` |
| `between` | the two spaces the opening joins: room ids, an outdoor space id, or `"exterior"` for the street. At least one end must be a room — nothing is built between two outdoor spaces |
| `on` | disambiguates when the pair shares several walls: `{ "room", "side": north\|south\|east\|west, "near": [x,y] }` |
| `position` | `"center"` (default), a number (metres from the wall's start to the opening centre), or `{ "from": "start"\|"end", "distance" }` |
| `at` | `[x, y]`: place the opening by an absolute point instead of `on` + `position` — picks the nearest wall between the two spaces in `between` and projects the point onto it |
| `width` | metres |
| `hinge` | doors: `"start"` or `"end"` jamb. A wall's start is its west or north end; on a wall that is neither horizontal nor vertical it is whichever end the wall runs from — eastward, or northward when the wall is vertical. |
| `swingInto` | doors: room the leaf opens into (default: the room in `between`, never the street or a terrace) |
| `entrance` | doors: mark the main entrance. It must lead to the street, or you get `entrance.not_street` |
| `glazed` | doors: `true` for a glazed door (default `false`) — counts as daylight for `habitable.no_window`, same as a window |

An **entrance** is a door to the street: to `"exterior"`, or to an outdoor space the
border flood fill reaches. A door onto an enclosed courtyard is a perfectly good door —
it is allowed, it joins the two spaces in the access graph, and it never satisfies
`entrance.missing`. `reach.unreachable` walks from the street the same way, so a room you
can only get to by crossing a courtyard is reachable exactly when the courtyard is.

`at` is mutually exclusive with `on` and `position`, exactly as a room's `poly` and `rect`
are; giving both is `has both "at" and "on"/"position"; use one`. **It is the selector to
use on an angled or curved wall**, and the only one: `on.side` names a compass side, which
says nothing about a wall at 20°, so asking for one on such a wall is `wall.ambiguous`
with a message naming `at` instead. `at` names a point, and the library finds the nearest
wall between the two spaces and projects onto it — along the arc, if the wall is curved. If that point is farther from every
candidate wall than half its thickness plus a small tolerance, that is `opening.off_wall`,
naming the nearest wall and the distance; a point equidistant from two candidates is
`wall.ambiguous`, exactly as an unresolved `on` would be.

### Fixtures

Things that stand *inside* a room — sanitary ware, a kitchen run, stairs, a pool. They
do not divide space (no walls, no openings); they take up floor.

```jsonc
"fixtures": [
  { "type": "pool", "in": "spa", "name": "Piscina interior",
    "poly": [[0.8,1.0],[4.0,1.0],[4.0,8.4],[0.8,8.4]], "depth": 1.4 },
  { "type": "bath", "in": "wc", "at": [4.95, 6.15], "size": [1.7, 0.75] },
  { "type": "island", "in": "cozinha", "at": [8.9, 3.8], "size": [2.0, 0.9] }
]
```

| Field | Meaning |
|---|---|
| `id` | optional stable handle, `^[a-z][a-z0-9_]*$`, unique among the fixtures on its level. Synthesised when absent — see **Stable ids** |
| `type` | `pool` `bath` `shower` `wc` `sink` `counter` `island` `stairs` `other` |
| `in` | id of the room **or outdoor space** that contains it; the footprint must lie inside |
| `poly` | any simple polygon, absolute metres, arcs allowed — or use `at` + `size` |
| `at` / `size` | convenience rectangle: `[x, y]` corner (absolute) and `[width, height]` |
| `name` | defaults to the capitalised type |
| `depth` | pools only, metres; shown in the tooltip |

Every room reports `clearArea`, `fixtureArea` and `usableArea` (clear less fixtures), so
an interior pool stops counting as floor you can stand on; outdoor spaces net off their
fixtures the same way, giving a deck's area clear of its pool. `schedule.waterArea`
totals the pools wherever they stand.

`fixtureArea` deducts exactly the part of a fixture that stands on the floor of the room
or outdoor space named in `in`. A fixture that straddles the boundary deducts what is
inside and nothing more, and `fixture.outside_space` still says it is not where it says it
is. The intersection is the arrangement of the two rings read with an intersection
predicate — the same machinery that finds the walls, not a second one.

A pool is a `pool` whether it sits in a spa room or on a terrace — that is why `in`
accepts an outdoor id. Model the terrace as the `outdoor` space and the water as a
fixture standing on it, rather than calling the pool itself an outdoor space; otherwise
the same object is a fixture indoors and an anonymous polygon outdoors.

### Stable ids

Rooms, outdoor spaces and voids are keyed by their own id. Openings and fixtures are
written in arrays, so they get an id too — otherwise deleting `openings[2]` silently
renames every finding, path and cached reference after it.

`id` is optional. When it is absent, one is synthesised:

| entity | id | `n` counts |
|---|---|---|
| opening | `<type>:<a>-<b>:<n>` over the **sorted** pair in `between` | earlier openings of the same type between the same pair, in document order |
| fixture | `<type>:<in>:<n>` | earlier fixtures of the same type in the same space |
| a `vertical` element's footprint | `vertical:<id>` | — it is not a `fixtures[i]` at all |

So `{"type":"door","between":["hall","wc"]}` is `door:hall-wc:0`, and a second door
between the same pair is `door:hall-wc:1`. Three consequences, and they are the reason for
the shape:

- **Deleting one opening renumbers only its own pair's later siblings.** Remove the window
  between `exterior` and `a` and the door between `hall` and `wc` keeps its name, however
  many array indices shifted.
- **Swapping `between` renames nothing**, because the pair is sorted — it is the same wall
  either way.
- **An authored id can never collide with a synthesised one.** A synthesised id always
  contains `:`, which `^[a-z][a-z0-9_]*$` forbids, so naming one opening `porta` can never
  take a name another already answers to. An authored id also *counts* towards its pair's
  numbering, so adding one renames no sibling either.

Ids are scoped per level: the same `porta` may be used once on each storey, and the
finding's `path` is what tells them apart.

### Findings

Every finding is `{ rule, severity, message, path, level?, at?, rooms?, opening?, fixture?, vertical? }`,
plus structured fix data on the three rules that already list it in prose.

`path` is the JSON path of the thing the rule is about — `openings[3]`, `rooms.sala`,
`levels.piso1.fixtures[2]`, `vertical[0].at[1]` — and, where the rule knows which field is
at fault **and the document actually wrote it**, the field: `openings[3].width`,
`rooms.sala.rect`. It is derived from the document that was parsed, never from a template,
which is what makes two guarantees hold:

- a path names a node that is really in the source, so `floorplan set <plan> <path>` never
  fails on a path this library emitted. An opening that let `position` default to
  `"center"` has no `position` node to splice, so its findings stop at `openings[3]`;
- the geometry field is the one the author chose — `rooms.sala.rect` for a document using
  the shorthand, `rooms.sala.poly` for one that spelled out the points.

The one exception is a finding about an *absence*, which names the collection a fix would
be written into (`tiling.gap` → `rooms`, `entrance.missing` → `openings`,
`stair.headroom` → the level's `voids`). That collection may not exist yet, but its parent
always does, so one `patch` `insert` is enough.

`opening` and `fixture` are **ids**, not array indices (see **Stable ids**); a finding
about a `vertical` element carries `vertical` instead, because it has no `fixtures[i]`.
`level` names the storey a finding is about; it is absent on a building-wide finding
(`entrance.*`, `reach.*`) and absent on **every** finding of a document with no `levels`
block.

Three rules carry the facts their message already states, structured, so acting on one
needs no prose parsing:

| rule | extra fields |
|---|---|
| `wall.ambiguous` | `candidates: [{ wall, side?, from, to }]` — the segments it had to choose between |
| `room.min_dimension` | `measured`, `minimum`, `rect: [x, y, width, height]` (the clear floor) |
| `opening.off_wall` | `nearest` (a wall id, as `--json=walls` prints it), `distance` |

Schema problems reach the same channel through `lint()` as `schema.*` findings, one per
issue, all `error`, each with the issue's own document path:

| rule | catches |
|---|---|
| `schema.syntax` | not JSON at all, or not a JSON object |
| `schema.unknown_field` | a key the schema has not got, with the nearest known key when there is one |
| `schema.missing` | something required is absent: a room's geometry, a vertical element's id |
| `schema.type` | present but the wrong type, or outside a fixed vocabulary |
| `schema.reference` | names something undeclared: a space, a level, a void used as a room |
| `schema.geometry` | a polygon that cannot be a shape: too few corners, zero area, crossing edges |
| `schema.conflict` | two mutually exclusive forms, or an id used twice: `poly` and `rect`, `at` and `on` |

| Rule | Severity | Catches |
|---|---|---|
| `tiling.gap` / `tiling.overlap` | error | hole in the plan / two rooms share area |
| `wall.unresolved` / `wall.ambiguous` | error | opening names rooms with no (or several) shared walls, or `at` names a point equidistant from more than one |
| `opening.overflow` / `opening.collision` | error | opening wider than its wall / two openings overlap |
| `opening.off_wall` | error | an opening's `at` point is farther from the nearest wall than half its thickness plus a small tolerance |
| `window.not_exterior` | error | window on an interior wall |
| `entrance.missing` | error | no door leads to the street |
| `space.no_access` / `reach.unreachable` | error | room without a door / not reachable from the street |
| `habitable.no_window` / `wet.no_window` | warning | living space without a window or glazed exterior door / WC needing extraction |
| `wet.opens_to_kitchen` | warning | WC door straight into a kitchen |
| `privacy.bedroom_through_route` | warning | bedroom is the route to another bedroom |
| `room.min_dimension` / `door.min_width` | warning | comfort minimums per room kind and door role |
| `opening.near_corner` | warning | sliver of wall < 0.1 m beside an opening |
| `fixture.outside_space` / `fixture.overlap` | error | fixture escapes its room / two fixtures collide |
| `outdoor.overlap` | error | a room is built over an outdoor space, which is open sky |
| `fixture.clearance` | warning | gap between two fixtures too narrow to walk through |
| `door.swing_hits_fixture` | warning | a door leaf sweeps into a fixture |
| `entrance.not_street` | warning | a door marked `"entrance": true` opens onto an enclosed courtyard, or onto another room |
| `circulation.share` | info | halls and corridors above 10 % of the interior |
| `arc.too_shallow` | warning | an arc bulging under 5 mm past its chord: a straight edge written as a curve |
| `room.no_clear_floor` | error | a room its own walls leave no floor in: the inward offset turns inside out |
| `geometry.sliver` | info | a face under 100 mm² that nothing covers: two edges meant to meet are a fraction apart |
| `room.acute_corner` | info | a corner under 25°, where the mitred wall faces meet so far along each arm that the point of the room is wall |
| `privacy.bedroom_off_living` / `entrance.multiple` / `door.swing_collision` | info | worth a look |

`room.min_dimension` measures the narrow side of the largest rectangle of *unoccupied*
floor, between the wall faces — not on centrelines and not through a fixture. A 2 × 1 m
room drawn on centrelines is 1.88 × 0.79 m to stand in. For a room with an angled or
curved wall it measures the largest circle that fits instead, and says so, because an
axis-aligned rectangle understates a round room by a factor of √2 — see **Areas**.

Across levels:

| Rule | Severity | Catches |
|---|---|---|
| `level.unreachable` | error | a storey no stair, lift or ramp arrives on |
| `stair.no_arrival` | error | a vertical element's footprint is not inside the space its `in` names, or it stands on one level and joins nothing |
| `stair.misaligned` | warning | consecutive footprints barely overlap, or do not overlap at all: not one shaft |
| `structure.over_open_sky` | warning | a room stands over no room below — a cantilever, or a room that has lost its support |
| `stair.pitch` | info | with `risers` and `height`: the pitch or the going is outside the comfortable range |
| `stair.headroom` | info | with `risers`, `height` and `up`: the floor above stays closed too far up the flight |
| `entrance.not_ground` | info | a door opens to the outside on a level the street does not meet |

`entrance.*` and `reach.unreachable` are building-wide: you enter a building once and then
walk through all of it, and the walk crosses every vertical element. An exterior door on a
level the street does not meet is never a way in, so it cannot hide a missing stair.
Everything else is judged per level.

Thresholds are options on `analyze(plan, rules)`; `stairPitch` and `minHeadroom` are
conventions rather than a code, which is exactly why they are options.

## The line DSL

The same document, one entity per line. It is an **authoring** syntax: it compiles to the
JSON above, and the geometry, the rules and the drawing never learn which one you wrote.

```
plan "Cabana" walls 0.2/0.1

room sala "Sala e cozinha" living rect 0,0 5x4
room wc "Casa de banho" wc rect 5,0 1.2x2
room arrumos "Arrumos" storage rect 5,2 1.2x2
outdoor deck "Deck" rect 0,4 5x2

door deck>sala at 0.9,4 w0.9 hinge:start swing:sala
door sala>wc @-0.5 w0.7 hinge:end swing:wc
door sala>arrumos @0.5 w0.7 hinge:start swing:arrumos
window sala.north @2.5 w2.4
window deck>sala @3.4 w2 on:sala.south
window sala.west w1.2
window wc.east w0.6
```

That is `fixtures/cabin.dsl`, the exact twin of `fixtures/cabin.json`: 196 tokens against
417, and a test renders both and compares the SVG byte for byte. `fixtures/casa-t3.dsl`
and `fixtures/moradia-2-pisos.dsl` are the other two.

**Which syntax a file is in is decided by its first non-space character**: `{` is JSON,
anything else is the DSL. Every entry point sniffs — `parse()`, `floorplan()`, `lint()`,
every CLI command, the playground editor — so a `.dsl` file needs no flag anywhere, and a
JSON document behaves exactly as it always did, down to the byte.

`floorplan fmt <file> --to json|dsl` converts, and the **JSON | DSL** toggle above the
playground editor does the same in the browser. The conversion preserves *meaning*, not
your choice between synonyms: JSON has two spellings for an opening's position (`2` and
`{"from":"start","distance":2}`) and two for a centred one (`"center"` and nothing at
all), `parse()` folds each pair together, and the DSL has one spelling for each, so a
round trip picks it. The one thing it cannot carry is a private `_`/`x-` key; `toDsl`
refuses such a document rather than dropping the key.

### Editing, findings and ids

- **A finding's `path` is unchanged** — still `openings[3].width`, still the JSON path,
  because that is the contract. A DSL document's findings gain **`line`** beside it, which
  is the address worth having when one entity is one line.
- **`set` and drags splice one token.** `floorplan set plan.dsl openings[3].width 1.1`
  resolves the JSON path to the token on its line and replaces exactly that, leaving the
  rest of the line and every other line alone — the line-based twin of what `jsonpos`
  does for JSON. `applyDrag`/`applyMove` go through the same primitive, so dragging a wall
  in the playground rewrites the room's `rect` in place.
- `patch`'s `set` op works the same way. `remove`, `append` and `insert` do not: adding or
  removing an entity in the DSL is adding or removing a whole line in a group whose place
  the printer decides, which is `fmt`'s job. They say so and write nothing.
- **Ids are identical.** A DSL document and its JSON twin synthesise the same
  `door:hall-wc:0` — the rule in **Stable ids** is applied after the compile, to the same
  document, and a test checks the ids agree fixture by fixture.

### The grammar

Printed by `floorplan --schema=dsl` (1 363 tokens, legend and worked examples included;
`--schema=dsl-full` adds the field-by-field token index below, 2 016 tokens) and generated
below from the same table, so neither can describe a token the parser does not take.
`[...]` is optional. The block below omits `--schema=dsl`'s worked examples and vocabulary
legend to stay short; load `--schema=dsl` itself for those.

<!-- generated from DSL_SCHEMA by test/readme-dsl.test.ts; run it with UPDATE_README=1 after a grammar change -->

```
plan ["Title"] [units:m] [walls <ext>/<part>] [north <deg>] [stack <id>,…]
    document header; every part is optional, so a plan may have no plan line at all

walls <ext>/<part> | walls exterior:<n> | walls partition:<n>
    wall thicknesses; the canonical printer folds this onto the plan line

north <deg>
    bearing of "up" in degrees; the canonical printer folds this onto the plan line

grid cols <n>,… rows <n>,…
    the shared track grid every level's layout may sit on

level <id> ["Name"] [h<height>] [ground]
    a storey header: statements belong to the most recent level line, until the next one

room <id> ["Name"] [<kind> [<zone>]] [rect <x>,<y> <w>x<h> | poly <x>,<y> …] [habitable] [wet] [circulation]
    one room; the two bare words are the kind then the zone, in that order — the kind must be a real one, and a zone with no kind is written zone:<z>

outdoor <id> ["Name"] [covered] [rect <x>,<y> <w>x<h> | poly <x>,<y> …]
    a terrace, courtyard or garden: outside, but not the street

void <id> ["Name"] [rect <x>,<y> <w>x<h> | poly <x>,<y> …]
    a hole in this storey's floor: a stairwell, or the void over a double-height room

layout [cols <n>,…] [rows <n>,…]
        <cell> <cell> …   (one indented row per grid row)
    an ASCII picture placing already-declared spaces on the track grid; the same id in several cells is one space spanning them, "." is empty

<type> <a>><b> | <type> <room>[.<side>]   [@<d> | @-<d> | at <x>,<y>]  w<width>
        [on:<room>[.<side>]] [near:<x>,<y>] [hinge:start|end] [swing:<space>] [entrance] [glazed] [id:<id>]
    one opening. `<room>[.<side>]` alone is short for `exterior><room>` with an `on`; that implicit `on` cannot combine with an explicit `at` — same rule as JSON's oneOf: "on"/"position" xor "at"

fixture <type> in:<space> (at <x>,<y> size <w>x<h> | poly <x>,<y> …) ["Name"] [depth:<n>] [id:<id>]
    a thing standing in a space: a pool, a bath, a counter

stairs | lift | ramp <id> ["Name"] [up:<deg>] [risers:<n>]   (or: vertical <id> <type> …)
        at <level> in:<space> rect <x>,<y> <w>x<h> | poly <x>,<y> …      (one indented line per level served)
    vertical circulation: the only entity that spans levels, joined by its id and never by overlap — one `at` line per level it serves, never one line per element

  arc <x>,<y> r<radius> [cw|ccw] [large]
    inside a poly: a circular edge from the previous corner round to <x>,<y>

# anything after a # is ignored, as is a blank line
    comments and blank lines are not part of the document and are dropped by the printer

    a poly's corners are inline on the entity's own line, never an indented block: outdoor deck poly 0,0 5,0 5,2 0,2

a poly element is a corner or an arc to it:
    <x>,<y>
    arc <x>,<y> r<radius> [cw|ccw] [large]
```

Every field of the JSON schema, and the token that writes it — all 77 of them, and
`test/dsl-schema.test.ts` fails if the parser grows a field with no spelling here.

| field | token |
|---|---|
| `plan.title` | `"Title"` |
| `plan.units` | `units:m` |
| `plan.walls` | `walls <ext>/<part>` |
| `plan.north` | `north <deg>` · `<deg>` |
| `plan.stack` | `stack <id>,…` |
| `plan.levels` | `<id>` |
| `plan.vertical` | `stairs|lift|ramp` |
| `plan.grid` | `grid` |
| `walls.exterior` | `<ext>` |
| `walls.partition` | `<part>` |
| `grid.cols` | `cols <n>,…` |
| `grid.rows` | `rows <n>,…` |
| `layout.cols` | `cols <n>,…` |
| `layout.rows` | `rows <n>,…` |
| `layout.areas` | `<cell> …` |
| `level.name` | `"Name"` |
| `level.height` | `h<height>` |
| `level.ground` | `ground` |
| `level.rooms` | `<id>` |
| `level.outdoor` | `<id>` |
| `level.voids` | `<id>` |
| `level.layout` | `layout` |
| `level.openings` | `<a>><b>` |
| `level.fixtures` | `fixture` |
| `room.poly` | `poly <x>,<y> …` |
| `room.rect` | `rect <x>,<y> <w>x<h>` |
| `room.kind` | `<kind>` |
| `room.name` | `"Name"` |
| `room.zone` | `<zone>` |
| `room.habitable` | `habitable` |
| `room.wet` | `wet` |
| `room.circulation` | `circulation` |
| `outdoor.poly` | `poly <x>,<y> …` |
| `outdoor.rect` | `rect <x>,<y> <w>x<h>` |
| `outdoor.name` | `"Name"` |
| `outdoor.covered` | `covered` |
| `void.poly` | `poly <x>,<y> …` |
| `void.rect` | `rect <x>,<y> <w>x<h>` |
| `void.name` | `"Name"` |
| `arc.arc` | `<x>,<y>` |
| `arc.r` | `r<radius>` |
| `arc.sweep` | `cw|ccw` |
| `arc.large` | `large` |
| `opening.id` | `id:<id>` |
| `opening.type` | `<type>` |
| `opening.between` | `<a>><b>` |
| `opening.width` | `w<width>` |
| `opening.position` | `@<d>` |
| `opening.on` | `on:<room>` |
| `opening.at` | `at <x>,<y>` |
| `opening.hinge` | `hinge:start|end` |
| `opening.swingInto` | `swing:<space>` |
| `opening.entrance` | `entrance` |
| `opening.glazed` | `glazed` |
| `opening.on.room` | `on:<room>` |
| `opening.on.side` | `on:<room>.<side>` |
| `opening.on.near` | `near:<x>,<y>` |
| `opening.position.from` | `@-<d>` |
| `opening.position.distance` | `@-<d>` |
| `fixture.id` | `id:<id>` |
| `fixture.type` | `<type>` |
| `fixture.in` | `in:<space>` |
| `fixture.poly` | `poly <x>,<y> …` |
| `fixture.at` | `at <x>,<y>` |
| `fixture.size` | `size <w>x<h>` |
| `fixture.depth` | `depth:<n>` |
| `fixture.name` | `"Name"` |
| `vertical.id` | `<id>` |
| `vertical.type` | `stairs|lift|ramp` |
| `vertical.name` | `"Name"` |
| `vertical.at` | `at <level> …` |
| `vertical.up` | `up:<deg>` |
| `vertical.risers` | `risers:<n>` |
| `vertical.footprint.level` | `at <level>` |
| `vertical.footprint.in` | `in:<space>` |
| `vertical.footprint.poly` | `poly <x>,<y> …` |
| `vertical.footprint.rect` | `rect <x>,<y> <w>x<h>` |

<!-- /generated -->

Numbers print shortest round-trip, in metres. A boolean is its own name for true and
`name:false` for false. `#` starts a comment; blank lines and comments are not part of the
document and the printer drops them. `layout` and the vertical statements are the only
ones that continue onto indented lines.

### What it cost, and what it is worth

`docs/eval/authoring-eval.md` is the eval `docs/agent-review.md` §C asked for: twenty
briefs written by hand in both syntaxes, schema failures counted. **0 of 20 in each**, and
the twenty pairs produced the same building every time — identical rule findings and
identical room polygons — for 9 936 tokens of JSON against 4 757 of DSL. That write-up is
also honest about why 0–0 is weaker evidence than it looks, and about the two real defects
a follow-up probe found in the grammar (one of them silent) before they were fixed.

## Areas, and what "clear" means

Room polygons are centrelines, so the polygon area over-reports usable space. The model
carries both.

- **`area`** — the centreline polygon's area. Exact over arcs: a round room measures
  πr².
- **`clearRing`** — the room's own ring brought inward to the *faces* of the walls along
  it, mitred at every corner, each edge by half the thickness of the wall on it. An
  exterior wall and a partition on the same room deduct differently, and an edge that is
  exterior wall for part of its run and partition for the rest gets a step. An arc offsets
  to the same arc on the same centre with its radius reduced or increased, so a curve
  stays a curve.
- **`clearArea`** — the area of that ring. Labels show it by default; `--areas
  centreline` switches.
- **`usableArea`** — `clearArea` less the fixtures standing on it.
- **`inscribed`** — the largest circle that fits in the clear floor, as `{ at, r }`.
- **`clearRect`** — the largest rectangle of unoccupied floor, in the room's own frame
  (the bearing of its longest straight edge; 0° for a rectilinear room). It is what the
  message quotes as "clear floor w × h", and what decides whether a room's name fits on
  the drawing.
- **`minDimension`** — how narrow the room is. For a rectilinear room it is the short
  side of `clearRect`, which is the number this library has always printed, unchanged to
  the millimetre. For a room with an angled or curved wall it is `2 × inscribed.r`,
  because an axis-aligned rectangle understates a round room by a factor of √2 — a 3.4 m
  round room would otherwise be reported as 2.4 m across. The `room.min_dimension`
  message says which of the two it means.

The clear ring is *constructed*, not estimated. The closed form it replaces —
`A − Σ len·t/2 + Σ ±t₁t₂/4` — is exact only at right angles: measured against
numerically integrated truth on an isoceles triangle with 5 m arms and 0.15 m of wall
face, it is −0.6 % at a 90° apex, −4.2 % at 20° and −28 % at 10°. It was also reading
the wrong thickness at a corner where a room's edge changes from exterior wall to
partition, which is why seven of the 63 fixture rooms' clear areas moved by 5–140 cm²
when it was replaced.

## Layout

```
src/parse.ts      schema → Plan (+ grid compiler)
src/derive.ts     Plan → walls, openings, room metrics, access graph, geometry findings
src/rules.ts      semantic rules over the model
src/svg.ts        Model → SVG string (+ the projection, for hit-testing)
src/catalogue.ts  the rule catalogue: what the documentation reads
src/format.ts     canonical formatting for plan documents
src/jsonpos.ts    JSON with source positions, to splice/remove/append/insert in place
src/edit.ts       which walls can be dragged, and what moving one writes
src/cli.ts        command line (IO-free; takes a CliIo so tests can fake stdio/fs)
src/bin.ts        the published executable ("bin" in package.json); wires real stdio/fs onto cli.ts
app/              the playground (React, TanStack Router, Vite)
src/ring.ts       rings in integer millimetres: arcs, exact areas, canonical flattening
src/arrangement.ts the planar arrangement: DCEL, faces, snap-rounding, overlay/booleans
src/offset.ts     the mitred inward offset, and the clear floor it defines
fixtures/         casa-t3 (seed house), apartment-t2 (grid), cabin,
                  casa-patio (courtyard), quinta (garden + pool + shack),
                  casa-piscina (fixtures), broken,
                  casa-angulo (a 45° wing and a canted bay),
                  casa-redonda (two wings joined by a round hall, in arcs),
                  broken-geometria (an overlap, a wedge, a corner too sharp),
                  moradia-2-pisos (two storeys, shared grid, void, stair),
                  broken-levels (one of every cross-level finding)
test/__snapshots__/before-levels/
                  what every single-level fixture produced at the commit before
                  levels landed; test/levels-compat.test.ts holds the library to it
```
