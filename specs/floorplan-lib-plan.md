# Declarative floor-plan renderer — plan (v2)

**Pitch:** schedule in, drawing out, with lint. "Mermaid for floor plans."
A JSON description of rooms and openings becomes a scaled SVG, and a
validator tells you what is wrong with the house before you draw it.

Seeded 2026-09-08 from the `casa-t3.html` artifact. v1 of this plan was
reviewed (Claude + GPT-5.5 via PAL, same day); v2 records the decisions and
the state of the build. **Status: M0–M3 built, tests green.** Sections
marked ▶ are open.

---

## 1. Why this and not another editor

Every existing tool is an **editor**: a canvas a human drags walls onto.
None takes a room schedule and renders it. None checks the result. The gap
is a **declarative renderer + validator**: text in, drawing out, findings as
a first-class output, framework-agnostic string output.

Audience: developers and design-literate owners talking to an architect.
Niche by construction. The validator alone would have caught three
functional errors in the first casa-t3 draft, and did catch one more while
porting it (a pantry door addressed to a wall pair that shares two segments).

## 2. Goals and non-goals

**v1 (built)**

- Rectilinear plans, single level, house scale.
- Rooms → derived walls → openings on walls → validated → SVG.
- Zero runtime dependencies. Node 22.18+ runs the TypeScript directly.
- Validator with severities and per-rule tests.
- casa-t3 is fixture #1; its findings match the seed's own narrative.

**Non-goals**

- No interactive editor. Ever. Point at Sweet Home 3D.
- No 3D, no arbitrary angles, no structural/thermal/code compliance.
- No furniture. Fixture symbols are v2; furnishing is never.
- No DXF in v1 (see §10 — decided against after review).
- No auto-layout from an adjacency graph: plausible nonsense, not design.

## 3. Authoring model — decision

Five candidates were weighed: A rooms-first coordinate polygons; B walls-first
CAD; C track-grid area map; D relative-placement DSL; E constraint solver.

**Decision: layered A + C.** Canonical geometry is A (centreline room
polygons). C is authoring sugar that compiles to A in the parser; render and
validate never see grids. B, D, E rejected for v1: B authors the wrong thing
(walls, when both authors and rules think in rooms), D turns into a
constraint system the moment plans have corridors, E is not design.

```jsonc
"layout": {
  "cols": [3.2, 1.1, 2.0, 2.4],
  "rows": [3.2, 1.3, 1.5, 3.4],
  "areas": ["quarto1 hall quarto2 quarto2",
            "quarto1 hall wc      quarto2",
            "sala    hall wc      lavandaria",
            "sala    sala cozinha cozinha"]
}
```

Same token in several cells forms one rectilinear room (L-shapes fall out);
`.` is void; a room must be one connected piece without holes. Polygons and
grid cells may be mixed in one plan; a room may not have both.

## 4. Coordinate contract — decision

Authored coordinates are **wall centrelines**. Rooms tile the footprint
exactly. This is what the seed already did, and it makes wall derivation,
gap/overlap detection and opening attachment exact and cheap.

Consequence: the polygon area over-reports usable space. The model therefore
reports both `area` (centreline) and `clearArea` — polygon area minus half of
every bounding wall's thickness, with corner corrections (convex +t₁t₂/4,
reflex −t₁t₂/4). Exact for rectilinear rooms. Labels show clear area. The
seed's "clear internal areas, before wall thickness" caption was wrong and is
not carried over.

## 5. Openings — decision

```jsonc
{ "type": "door", "between": ["hall", "escritorio"],
  "on": { "room": "hall", "side": "south" },           // only when ambiguous
  "position": { "from": "start", "distance": 1.6 },    // metres, to opening CENTRE
  "width": 0.8, "hinge": "start", "swingInto": "escritorio" }
```

- Openings address a **pair of spaces**, never coordinates. Moving a room
  drags its doors; a door on no wall is a finding, not a drawing bug.
- **Metres, not fractions.** A fraction silently moves the door when the
  wall changes length. `"center"` is the one shorthand.
- **Canonical wall direction**: west→east, north→south. `hinge` names the
  start or end jamb; `swingInto` names the room. No angles in the DSL.
- **Ambiguity is an error, not a guess.** When a pair shares several
  segments (L-shaped rooms, exterior faces), `wall.ambiguous` lists them and
  the fix (`on.side`, or `on.near` as a coordinate tie-breaker).

## 6. Pipeline (as built)

```
parse ──────► derive ────────────────► rules ────► renderSvg
schema,       arrangement grid,        entrance,   walls split at openings,
grid→poly,    cell owners, flood fill  reach,      swings, glazing, labels,
normalise     (exterior vs gap),       light,      dims, north, scale bar,
              wall segments, openings  sizes,      key, finding markers
              on walls, clear area,    privacy,
              access graph             circulation
```

Derivation uses the arrangement grid of all distinct x and y coordinates:
every cell has 0, 1 or 2+ owners. Zero-owner cells reachable from the border
are exterior; enclosed ones are gaps. Wall pieces sit between cells with
different owners and merge into maximal collinear segments per owner pair.
No spatial index; tens of rooms is trivial.

Walls render as centreline strokes with butt caps; a real wall end extends
by half its thickness to close the corner, an opening jamb does not. This
gives clean corners and jambs without mitring.

## 7. Validator (as built)

| Rule | Sev | Catches |
|---|---|---|
| `tiling.gap`, `tiling.overlap` | error | hole / shared area |
| `wall.unresolved`, `wall.ambiguous` | error | opening on no wall / on several |
| `opening.overflow`, `opening.collision` | error | does not fit / overlaps |
| `window.not_exterior` | error | window on a partition |
| `entrance.missing` | error | no exterior door (suppresses reach noise) |
| `space.no_access`, `reach.unreachable` | error | no door / cut off from entrance |
| `habitable.no_window`, `wet.no_window` | warning | daylight / extraction |
| `wet.opens_to_kitchen` | warning | lobby expected |
| `privacy.bedroom_through_route` | warning | bedroom ↔ bedroom door |
| `room.min_dimension` | warning | short side of largest clear rectangle, per kind |
| `door.min_width` | warning | 0.7 interior, 0.9 entrance |
| `opening.near_corner` | warning | 0 < sliver < 0.1 m |
| `circulation.share` | info | halls + corridors > 10 % |
| `privacy.bedroom_off_living`, `entrance.multiple`, `door.swing_collision` | info | worth a look |

Changes from v1 of this plan after review: `room.no_door` became
`space.no_access` (cased openings count); `entrance.count` split into
`missing` (error) and `multiple` (info); added `wet.no_window`,
`door.min_width`, `opening.near_corner`, `wall.ambiguous`, the privacy
pair; room `kind` drives habitable/wet/circulation instead of bare flags.
Thresholds are options, phrased as comfort heuristics, not code compliance.

casa-t3 yields exactly: `wet.no_window` ×2 (WC suite, WC social),
`circulation.share` (19 %). v1 of this plan claimed "WC social no window"
under `habitable.no_window`; a WC is not habitable, hence the new rule.

## 8. API (as built)

```ts
import { floorplan, parse, analyze, renderSvg } from "floorplan";
const { svg, findings, schedule } = floorplan(json);
// or stepwise: parse → analyze → renderSvg
```

CLI: `floorplan plan.json --out plan.svg --lint`; exit 0 clean, 1 warning+,
2 usage/schema. `--json` emits findings and the room schedule.

## 9. Testing (as built)

Tests under `node --test` cover: geometry primitives, schema errors with paths,
grid compilation (L-shapes, voids, split rooms), wall derivation (segment
splitting, T-junction merging, gaps vs exterior), clear-area exactness,
opening resolution and every error, one minimal plan per rule, CLI exit
codes, and four fixtures: casa-t3 (SVG snapshot), apartment-t2 (grid),
cabin (label fallback), broken (one of every error).

## 10. Decisions log

- **DXF: out of v1.** A minimal DXF sets expectations (layers, blocks,
  text, real wall outlines) it cannot meet; architects will trace from a
  dimensioned SVG/PDF anyway. Revisit as experimental `toDXF` once
  geometry is stable, with `A-WALL`, `A-DOOR`, `A-WIND`, `A-ROOM` layers.
- **Fractions for `position`: rejected.** See §5.
- **Room `kind` over boolean flags.** Semantics in one place; flags remain
  as overrides.
- **Label position = centre of the largest inscribed rectangle**, not the
  vertex centroid (which can fall outside an L). Same rectangle feeds
  `room.min_dimension`, so the message can say "largest clear rectangle
  is 2 × 4 m".
- **Text width is estimated** (0.56 em per character) since there is no
  DOM. Rooms whose name does not fit get a numbered key under the plan.
- **Snapshot of casa-t3 is a regression guard, not a contract.** New rules
  may add findings to it deliberately.

## 11. ▶ Open

- **Clear area for rooms against outdoor spaces.** A covered porch wall is
  treated as exterior thickness. Probably right; unverified against a
  real schedule.
- **Per-wall thickness override** (load-bearing partitions). Data model
  slot exists in spirit (`WallSegment.thickness`), no authoring syntax.
- **Mitred wall outlines** for print. Butt-cap extension is fine on screen.
- **Locale.** Numbers use `Intl` with an `en` default; `pt-PT` decimal comma
  works via the `locale` option but the CLI does not expose it yet.

## 12. Milestones

| M | Deliverable | State |
|---|---|---|
| M0 | Seed extracted; schema; casa-t3 fixture | done |
| M1 | Wall derivation | done |
| M2 | Openings on walls; error-tier rules | done |
| M3 | Dimensions, label fallback, warning/info rules, grid authoring | done |
| M4 | Fixture symbols; experimental DXF | open |
| M5 | Multi-level, stairs | only if a real plan needs it |

## 13. Risks

- **Scope creep toward an editor.** Say no.
- **Non-rectilinear demand.** The first 45° wall breaks derivation. Hold.
- **Niche audience.** Built for our own house first.
