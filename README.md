# floorplan

Declarative floor-plan renderer and linter. A JSON description of rooms and
openings becomes a scaled SVG, and a validator tells you what is wrong with the
house before you draw it. "Mermaid for floor plans."

- Rooms in, walls derived, openings attached to walls, findings out.
- Zero runtime dependencies. ESM + TypeScript. `render` returns a string; no DOM.
- Rectilinear plans, single level. See `specs/floorplan-lib-plan.md` for scope.

```
npm install          # dev deps only (typescript)
npm run check        # typecheck + tests (node --test, 84 tests)
npm run examples     # renders fixtures/*.json → examples/*.svg
node src/cli.ts fixtures/casa-t3.json --out casa.svg --lint
```

## CLI

```
floorplan <plan.json> [--out plan.svg] [--lint] [--json] [--scale N]
                      [--theme auto|light|dark] [--labels auto|full|index]
                      [--areas clear|centreline|none] [--mark error|warning|info|none]
```

Exit codes: `0` clean or info only, `1` findings at warning or above, `2` usage or schema error.

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

```jsonc
{
  "title": "Casa T3",
  "walls": { "exterior": 0.30, "partition": 0.12 },
  "rooms": {
    "hall":  { "name": "Hall",  "kind": "hall",    "zone": "day",   "poly": [[0,4.4],[4.6,4.4],[4.6,8],[0,8]] },
    "suite": { "name": "Suite", "kind": "bedroom", "zone": "night", "poly": [[0,0],[4.6,0],[4.6,4.4],[0,4.4]] }
  },
  "outdoor": { "porch": { "name": "Alpendre", "poly": [[6.6,10.6],[12,10.6],[12,13.4],[6.6,13.4]], "covered": true } },
  "openings": [
    { "type": "door", "between": ["exterior", "hall"], "position": { "from": "start", "distance": 1.7 },
      "width": 1.0, "hinge": "end", "swingInto": "hall", "entrance": true },
    { "type": "door", "between": ["hall", "suite"], "position": 3.45, "width": 0.9, "hinge": "end", "swingInto": "suite" },
    { "type": "window", "between": ["exterior", "suite"], "on": { "room": "suite", "side": "north" }, "position": 2.3, "width": 2.2 }
  ]
}
```

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

### Rooms

| Field | Meaning |
|---|---|
| `kind` | `bedroom` `living` `kitchen` `office` `bath` `wc` `hall` `corridor` `storage` `utility` `garage` `other` |
| `habitable` / `wet` / `circulation` | derived from `kind`; set explicitly to override |
| `zone` | free label used for fill colour (e.g. `night`, `day`) |
| `poly` | rectilinear polygon, any winding; omit when placed via `layout` |

### Openings

| Field | Meaning |
|---|---|
| `type` | `door`, `window`, `cased` |
| `between` | the two spaces the opening joins; `"exterior"` for outside |
| `on` | disambiguates when the pair shares several walls: `{ "room", "side": north\|south\|east\|west, "near": [x,y] }` |
| `position` | `"center"` (default), a number (metres from the wall's start to the opening centre), or `{ "from": "start"\|"end", "distance" }` |
| `width` | metres |
| `hinge` | doors: `"start"` or `"end"` jamb. Walls run west→east and north→south. |
| `swingInto` | doors: room the leaf opens into (default: last room in `between`) |
| `entrance` | doors: mark the main entrance |

### Findings

Every finding is `{ rule, severity, message, at?, rooms?, opening? }`.

| Rule | Severity | Catches |
|---|---|---|
| `tiling.gap` / `tiling.overlap` | error | hole in the plan / two rooms share area |
| `wall.unresolved` / `wall.ambiguous` | error | opening names rooms with no (or several) shared walls |
| `opening.overflow` / `opening.collision` | error | opening wider than its wall / two openings overlap |
| `window.not_exterior` | error | window on an interior wall |
| `entrance.missing` | error | no door leads outside |
| `space.no_access` / `reach.unreachable` | error | room without a door / not reachable from the entrance |
| `habitable.no_window` / `wet.no_window` | warning | living space without daylight / WC needing extraction |
| `wet.opens_to_kitchen` | warning | WC door straight into a kitchen |
| `privacy.bedroom_through_route` | warning | bedroom is the route to another bedroom |
| `room.min_dimension` / `door.min_width` | warning | comfort minimums per room kind and door role |
| `opening.near_corner` | warning | sliver of wall < 0.1 m beside an opening |
| `circulation.share` | info | halls and corridors above 10 % of the interior |
| `privacy.bedroom_off_living` / `entrance.multiple` / `door.swing_collision` | info | worth a look |

Thresholds are options on `analyze(plan, rules)`.

## Areas

Room polygons are centrelines, so the polygon area over-reports usable space.
The model carries both: `area` (centreline) and `clearArea` (after deducting
half of every bounding wall, exact for rectilinear rooms). Labels show clear
area by default; `--areas centreline` switches.

## Layout

```
src/parse.ts      schema → Plan (+ grid compiler)
src/derive.ts     Plan → walls, openings, room metrics, access graph, geometry findings
src/rules.ts      semantic rules over the model
src/svg.ts        Model → SVG string
src/cli.ts        command line
fixtures/         casa-t3 (seed house), apartment-t2 (grid), cabin, broken
```
