# floorplan

Declarative floor-plan renderer and linter. A JSON description of rooms and
openings becomes a scaled SVG, and a validator tells you what is wrong with the
house before you draw it. "Mermaid for floor plans."

- Rooms in, walls derived, openings attached to walls, findings out.
- Zero runtime dependencies. ESM + TypeScript. `render` returns a string; no DOM.
- Rectilinear plans, one or many levels. See `specs/floorplan-lib-plan.md` for scope.

```
npm install          # dev deps only (typescript)
npm run check        # typecheck + tests (node --test)
npm run examples     # renders fixtures/*.json → examples/*.svg
node src/bin.ts fixtures/casa-t3.json --out casa.svg --lint
```

**If you are an agent authoring or editing a plan**, load `floorplan --schema`
(one compact typed-signature line per object, no docs — 568 tokens `o200k_base`,
covering all 14 objects and 73 fields; `--schema=full` prints the same table
as JSON with one-sentence docs, 2 554 tokens; `--schema=md` prints it as
Markdown for a human) and `floorplan <plan.json> --lint` (what is wrong with a
document you already have — 105 tokens on casa-t3's two findings) or `--json`
(174 tokens on casa-t3: a summary plus the findings; see "What an agent pays
to read a plan back" below) instead of this README's prose. All three are
generated from the library itself, so none can list a field or a rule the
parser and linter do not actually have.

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
measures 0.3–1.2 ms, so the whole plan is recomputed on every pointer move rather than
patched. Nothing is held in two places, so the drawing and the editor cannot drift.

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

A space is always written back **in the form it was authored in** — a `rect` room stays a
`rect`, a `poly` room stays a `poly` — so a drag never reformats a document someone is
still typing in. That is the contract fixtures have kept for `poly` versus `at`+`size`.

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
floorplan --schema[=full|md]
```

Exit codes: `0` clean or info only, `1` findings at warning or above, `2` usage or schema error.

`--level` picks which storey to draw; the default is the ground level, so a single-level
plan needs it never. `--out` may contain `{level}`, and then one sheet per storey is
written (`--out plan-{level}.svg` → `plan-piso0.svg`, `plan-piso1.svg`). `--lint` prefixes
each finding with the level it is about once there is more than one, and a building-wide
finding shows `—`.

`--schema` needs no input file: it prints every object's field list, read straight from
the table the parser itself validates against (see "Plan format" below). Default is one
typed-signature line per object — name, required/`?`, type, enum values inlined at ≤6 or a
`enum(NAME)` reference otherwise, spelled out once in a trailing legend — no doc text, 568
tokens for all 14 objects/73 fields. `--schema=full` prints the same table as compact JSON
with name, type, required, enum values and the one-sentence doc, one field per line, 2 554
tokens. `--schema=md` prints the full table as Markdown.

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

Coordinates are metres on **wall centrelines**, y grows downwards (north up).
Rooms must tile the footprint exactly; walls are derived from shared edges.
A void on the boundary is simply the shape of the building; an *enclosed* void is a
`tiling.gap` error unless you declare it as an outdoor space (see below).

Every object below (the top-level document, `walls`, `layout`, each room, each outdoor
space, each opening and its `on`/`position`, each fixture) is checked against its known
fields; a key that isn't one of them is a schema error, with a "did you mean" when it's
close to a real field (`"positon"` → `did you mean "position"?`). A key prefixed with
`_` or `x-` is exempt — use it for private notes or authoring-tool metadata
(`"_note"`, `"x-generator"`) and it is silently ignored.

The prose and examples below teach the shape; **`floorplan --schema` is the authoritative
field list** — every object, field, type and mutual exclusion, terse, read directly from the
same table `checkKeys` validates against, so it cannot list a field the parser does not also
accept. `--schema=full` adds each field's one-sentence doc (units, defaults, what reads it)
as compact JSON; `--schema=md` prints that same detail as Markdown for a human reader.

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
be a ring, and a single rectilinear ring cannot express a hole.

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

| fixture | before | canonical | as shipped, with `rect` | lines (old formatter → now) |
|---|---:|---:|---:|---|
| casa-t3 | 2 322 | 1 687 | **1 501** (−35 %) | 141 → 49 |
| apartment-t2 | 1 079 | 794 | 794 (−26 %) | 74 → 38 |
| casa-piscina | 1 169 | 868 | 868 (−26 %) | 47 → 46 |
| quinta | 1 042 | 791 | 763 (−27 %) | 50 → 44 |
| casa-patio | 805 | 607 | 585 (−27 %) | 42 → 36 |
| broken | 677 | 483 | 411 (−39 %) | 23 → 23 |
| cabin | 644 | 473 | 429 (−33 %) | 41 → 21 |
| **all seven** | **7 738** | **5 703** | **5 351 (−31 %)** | 418 → 257 |
| moradia-2-pisos | — | — | **1 594** | 94 |
| broken-levels | — | — | **770** | 62 |

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
same token in several cells makes one rectilinear room, `.` is void.

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
| `poly` | rectilinear polygon, any winding; omit when placed via `layout` |
| `rect` | `[x, y, width, height]` — the same rectangle as four points, for the common case |

`poly` and `rect` are mutually exclusive, exactly as a fixture's `poly` and `at`+`size`
are; giving both is `has both a poly and a rect; use one`. `rect` is authoring sugar and
nothing more — the parser expands it to four corners, so `derive`, the rules and the
renderer never see it — but it is worth having: it is 18 tokens cheaper per room and it is
the one way to write a rectangle you cannot get wrong. Eleven of casa-t3's thirteen rooms
are rectangles, and writing them as `rect` costs 186 tokens less.

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
| `hinge` | doors: `"start"` or `"end"` jamb. Walls run west→east and north→south. |
| `swingInto` | doors: room the leaf opens into (default: the room in `between`, never the street or a terrace) |
| `entrance` | doors: mark the main entrance. It must lead to the street, or you get `entrance.not_street` |
| `glazed` | doors: `true` for a glazed door (default `false`) — counts as daylight for `habitable.no_window`, same as a window |

An **entrance** is a door to the street: to `"exterior"`, or to an outdoor space the
border flood fill reaches. A door onto an enclosed courtyard is a perfectly good door —
it is allowed, it joins the two spaces in the access graph, and it never satisfies
`entrance.missing`. `reach.unreachable` walks from the street the same way, so a room you
can only get to by crossing a courtyard is reachable exactly when the courtyard is.

`at` is mutually exclusive with `on` and `position`, exactly as a room's `poly` and `rect`
are; giving both is `has both "at" and "on"/"position"; use one`. It is the selector that
survives angled walls — `on.side` asks which compass side a *derived* wall segment starts
from, which has no meaning once walls stop being axis-aligned, while `at` just names a
point and lets the library find the nearest wall. If that point is farther from every
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
| `poly` | rectilinear polygon, absolute metres — or use `at` + `size` |
| `at` / `size` | convenience rectangle: `[x, y]` corner (absolute) and `[width, height]` |
| `name` | defaults to the capitalised type |
| `depth` | pools only, metres; shown in the tooltip |

Every room reports `clearArea`, `fixtureArea` and `usableArea` (clear less fixtures), so
an interior pool stops counting as floor you can stand on; outdoor spaces net off their
fixtures the same way, giving a deck's area clear of its pool. `schedule.waterArea`
totals the pools wherever they stand.

`fixtureArea` only deducts a fixture that is **fully inside** the room or outdoor space
named in `in`; one that straddles or misses the boundary deducts nothing there —
`fixture.outside_space` already says why — rather than silently reducing usable floor by
its whole area. Deducting just the overlapping sliver of a straddling fixture needs exact
polygon intersection, which the geometry core will add; this is the stopgap until then.

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

`room.min_dimension` measures the narrow side of the largest rectangle of *unoccupied*
floor, between the wall faces — not on centrelines and not through a fixture. A 2 × 1 m
room drawn on centrelines is 1.88 × 0.79 m to stand in.
| `opening.near_corner` | warning | sliver of wall < 0.1 m beside an opening |
| `fixture.outside_space` / `fixture.overlap` | error | fixture escapes its room / two fixtures collide |
| `outdoor.overlap` | error | a room is built over an outdoor space, which is open sky |
| `fixture.clearance` | warning | gap between two fixtures too narrow to walk through |
| `door.swing_hits_fixture` | warning | a door leaf sweeps into a fixture |
| `entrance.not_street` | warning | a door marked `"entrance": true` opens onto an enclosed courtyard, or onto another room |
| `circulation.share` | info | halls and corridors above 10 % of the interior |
| `privacy.bedroom_off_living` / `entrance.multiple` / `door.swing_collision` | info | worth a look |

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

## Areas

Room polygons are centrelines, so the polygon area over-reports usable space.
The model carries both: `area` (centreline) and `clearArea` (after deducting
half of every bounding wall, exact for rectilinear rooms). Labels show clear
area by default; `--areas centreline` switches. Fixtures are deducted again to give
`usableArea` — see **Fixtures**.

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
fixtures/         casa-t3 (seed house), apartment-t2 (grid), cabin,
                  casa-patio (courtyard), quinta (garden + pool + shack),
                  casa-piscina (fixtures), broken,
                  moradia-2-pisos (two storeys, shared grid, void, stair),
                  broken-levels (one of every cross-level finding)
test/__snapshots__/before-levels/
                  what every single-level fixture produced at the commit before
                  levels landed; test/levels-compat.test.ts holds the library to it
```
