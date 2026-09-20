# floorplan

Declarative floor-plan renderer and linter. A JSON description of rooms and
openings becomes a scaled SVG, and a validator tells you what is wrong with the
house before you draw it. "Mermaid for floor plans."

- Rooms in, walls derived, openings attached to walls, findings out.
- Zero runtime dependencies. ESM + TypeScript. `render` returns a string; no DOM.
- Rectilinear plans, single level. See `specs/floorplan-lib-plan.md` for scope.

```
npm install          # dev deps only (typescript)
npm run check        # typecheck + tests (node --test)
npm run examples     # renders fixtures/*.json → examples/*.svg
node src/bin.ts fixtures/casa-t3.json --out casa.svg --lint
```

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

`draggableWalls(text, model)` and `applyDrag(text, draggable, metres)` are library
functions — the app only turns pointer events into coordinates.

## CLI

```
floorplan <plan.json> [--out plan.svg] [--lint] [--json] [--scale N]
                      [--theme auto|light|dark] [--labels auto|full|index]
                      [--areas clear|centreline|none] [--mark error|warning|info|none]
```

Exit codes: `0` clean or info only, `1` findings at warning or above, `2` usage or schema error.

On a schema error (exit `2`), `--json` prints `{"error":{"issues":[{"path","message"}]}}`
to stdout instead of the text form on stderr; without `--json` the text form is unchanged.

## Library

```ts
import { floorplan, parse, analyze, renderSvg } from "floorplan";

const { svg, findings, schedule } = floorplan(json);   // one call

const plan = parse(json);                 // throws PlanError listing every schema problem
const { model, findings } = analyze(plan); // never throws; geometry problems are findings
const svg = renderSvg(model, { findings, theme: "auto" });
```

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
| `type` | `door`, `window`, `cased` |
| `between` | the two spaces the opening joins: room ids, an outdoor space id, or `"exterior"` for the street. At least one end must be a room — nothing is built between two outdoor spaces |
| `on` | disambiguates when the pair shares several walls: `{ "room", "side": north\|south\|east\|west, "near": [x,y] }` |
| `position` | `"center"` (default), a number (metres from the wall's start to the opening centre), or `{ "from": "start"\|"end", "distance" }` |
| `at` | `[x, y]`: place the opening by an absolute point instead of `on` + `position` — picks the nearest wall between the two spaces in `between` and projects the point onto it |
| `width` | metres |
| `hinge` | doors: `"start"` or `"end"` jamb. Walls run west→east and north→south. |
| `swingInto` | doors: room the leaf opens into (default: the room in `between`, never the street or a terrace) |
| `entrance` | doors: mark the main entrance. It must lead to the street, or you get `entrance.not_street` |

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

A pool is a `pool` whether it sits in a spa room or on a terrace — that is why `in`
accepts an outdoor id. Model the terrace as the `outdoor` space and the water as a
fixture standing on it, rather than calling the pool itself an outdoor space; otherwise
the same object is a fixture indoors and an anonymous polygon outdoors.

### Findings

Every finding is `{ rule, severity, message, at?, rooms?, opening? }`.

| Rule | Severity | Catches |
|---|---|---|
| `tiling.gap` / `tiling.overlap` | error | hole in the plan / two rooms share area |
| `wall.unresolved` / `wall.ambiguous` | error | opening names rooms with no (or several) shared walls, or `at` names a point equidistant from more than one |
| `opening.overflow` / `opening.collision` | error | opening wider than its wall / two openings overlap |
| `opening.off_wall` | error | an opening's `at` point is farther from the nearest wall than half its thickness plus a small tolerance |
| `window.not_exterior` | error | window on an interior wall |
| `entrance.missing` | error | no door leads to the street |
| `space.no_access` / `reach.unreachable` | error | room without a door / not reachable from the street |
| `habitable.no_window` / `wet.no_window` | warning | living space without daylight / WC needing extraction |
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

Thresholds are options on `analyze(plan, rules)`.

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
src/jsonpos.ts    JSON with source positions, to edit one value in place
src/edit.ts       which walls can be dragged, and what moving one writes
src/cli.ts        command line (IO-free; takes a CliIo so tests can fake stdio/fs)
src/bin.ts        the published executable ("bin" in package.json); wires real stdio/fs onto cli.ts
app/              the playground (React, TanStack Router, Vite)
fixtures/         casa-t3 (seed house), apartment-t2 (grid), cabin,
                  casa-patio (courtyard), quinta (garden + pool + shack),
                  casa-piscina (fixtures), broken
```
