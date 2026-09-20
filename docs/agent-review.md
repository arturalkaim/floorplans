# floorplan — end-to-end review, with LLM agents as the primary user

Reviewed 2026-09-20 on branch `feature/artur_courtyards-and-fixtures` (HEAD `2ebc3f0`).
Everything below was checked by running code; nothing is taken from the README.
Token counts use the `o200k_base` BPE via `gpt-tokenizer`; `cl100k_base` was within ±3 % on
every sample, so the numbers are a fair proxy for any modern tokenizer. Baseline:
`npm run check` → 179 tests, 0 failures; `npm run check:all` passes; `npm run build:app`
builds (385 kB JS, 121 kB gzip).

Scope, as corrected by the lead: rectilinear-only and single-level are **gaps to close**, not
design decisions; implementation effort is **reported for sequencing, never used as a
verdict**; zero runtime dependencies remain a design choice, so writing geometry from
scratch is a legitimate recommendation.

## Verdict

**What is genuinely good.** The pipeline `parse → derive → rules → renderSvg` is small
(≈3 000 lines), pure, fast (0.72 ms for the 13-room seed house; 400 rooms in 44 ms), and
zero-dependency in fact, not just in `package.json`. The arrangement-grid derivation
(`src/derive.ts:39-159`) is exactly the right *idea* — build a planar subdivision, assign
each face an owner, read walls off the face boundaries — and `clearArea` is exact rather
than approximate. Finding messages are unusually well written: they name the room, the
wall, the number and the fix. The rule catalogue is tested against the rules that actually
emit (`test/catalogue.test.ts`); the app is tested for not reaching into `src/`
(`test/boundary.test.ts`). `src/jsonpos.ts` + `src/edit.ts` — a position-recording JSON
parser and path-addressed splices — are the primitives an agent-facing editor needs, and
they already exist. The renderer escapes every plan-authored string.

**The things that most deserve attention.**

1. **The published CLI does not run.** `npm pack` → install → `node_modules/.bin/floorplan
   broken.json --lint` prints nothing and exits 0 (`src/cli.ts:126`).
2. **A courtyard is the street.** Cells inside a declared outdoor space become owner
   `"exterior"` (`src/derive.ts:76-85`); a house whose only door opens onto an enclosed patio
   passes `entrance.missing`, and openings cannot name an outdoor space at all.
3. **Unknown keys are silently ignored.** A door with `"positon"` lands at centre with no
   diagnostic. For an agent this is the most expensive failure mode: valid and wrong.
4. **The geometry core is built on axis alignment at every layer** — the arrangement grid,
   the wall type (`axis`, `c`, `from`, `to`), the clear-area formula, label placement,
   opening selectors (`north|south|east|west`), the renderer's corner trick, and the whole
   drag layer. Lifting the rectilinear limit is not an extension of `derive.ts`; it is a
   replacement of its first 160 lines by a general planar-arrangement builder plus new
   predicates, offsetting and label placement — all writable without dependencies, with the
   genuine difficulty in robustness rather than in size (§G).
5. **Everything is one storey.** `Plan` and `Model` are flat, there is one access graph rooted
   at `"exterior"`, one envelope, one SVG, and `stairs` is a word in a vocabulary
   (`src/parse.ts:43`) that draws a dashed rectangle. Levels are an additive wrapper with a
   cross-level pass (§H), and their shape should be fixed *before* the paths, the CLI output
   and the DSL are built, or all three change twice.
6. **Token economics are left on the table.** Openings are 55 % of casa-t3's 2 322 tokens;
   one door costs 61 tokens in JSON and 14 in a line syntax. `--json` is 1 263 tokens, 83 %
   of it a schedule the agent rarely wants. The library can splice one value; the CLI offers
   no way to use it, so an agent re-emits ~2 k tokens to move a door. Findings carry
   `opening: 3`, never `openings[3].position` — the path `spliceAt` consumes.

Plus one real editing bug: dragging quinta's east grid wall also rewrites the detached
shack's polygon because it shares the coordinate (`src/edit.ts:69-81`).

**Representation, in one line:** keep JSON as the canonical model and interchange — it
extends cleanly to arcs and to levels — and add a line-oriented DSL as the agent-facing
authoring surface (−68 % tokens today, and it extends to `arc` tokens and `level` sections
at the same ratio). The grid-ASCII syntax stays as rectilinear sugar; it is a dead end for
angled walls and should not be grown further.

---

## A. Correctness

### A1. CLI is inert when installed as a package (critical)

- **Evidence.** `src/cli.ts:126`:
  `const isMain = process.argv[1] !== undefined && /cli\.(ts|js)$/.test(process.argv[1]);`
  ```
  npm pack --pack-destination $T && cd $T && npm i floorplan-0.1.0.tgz
  ls -l node_modules/.bin/floorplan   # -> ../floorplan/dist/cli.js (symlink)
  ./node_modules/.bin/floorplan fixtures/broken.json --lint | wc -l   # 0
  echo $?                                                            # 0
  ```
  Node does not realpath `process.argv[1]`; it is the symlink path, the regex fails, `run()`
  is never called. `node dist/cli.js …` works, which is why nothing noticed.
- **Why it matters.** `npx floorplan plan.json --json` returns success and empty output for
  every plan, including invalid ones.
- **Fix.** A `src/bin.ts` that unconditionally calls `run()` (the guard exists only because
  `test/cli.test.ts` imports `run`), or compare `realpathSync(process.argv[1])` with
  `fileURLToPath(import.meta.url)`. Test the built CLI through a symlink. Effort: minutes.

### A2. Courtyards and outdoor spaces are indistinguishable from the street

- **Evidence.** `src/derive.ts:76-85` marks every cell inside a declared outdoor poly as
  `outside`, and `owner()` (`:86-91`) returns `"exterior"` for it. Consequences, all run:
  - casa-patio with the west (street) door removed, keeping only the door onto the enclosed
    patio: `0 error(s), 0 warning(s), 1 info`, exit 0. No `entrance.missing`.
  - `fixtures/casa-patio.json` as shipped: `entrance.multiple — 2 doors lead outside (Hall,
    Hall); the main one is Hall`. One of those doors leads to a 4 × 4 m courtyard.
  - `reach.unreachable` (`src/rules.ts:81-99`) starts at `"exterior"`, so a wing whose only
    door is onto the patio is "reachable from the entrance".
  - `src/parse.ts:198` accepts only room ids or `"exterior"` in `between`, so
    `["sala","deck"]` fails with `unknown room "deck"` even though `deck` is declared.
- **Why it matters.** Daylight through a courtyard is right (and carries an INVARIANT
  comment); access is not daylight. An agent modelling a patio house gets a green lint on an
  unenterable building.
- **Right design.** Owner classes become `room | outdoor(id) | exterior | gap`. Walls between
  a room and any void stay `exterior` (thickness, daylight unchanged); the access graph gets
  a node per outdoor space; `spaceRef` accepts outdoor ids; *entrance* means a door to the
  street or to an outdoor space the border flood-fill reaches. This concept survives the
  geometry rewrite in §G unchanged (faces get owners the same way cells do), so it is worth
  doing now. Effort: about a day across `derive`, `parse`, `rules`, tests.

### A3. A grid drag carries unrelated polygons that share the coordinate

- **Evidence.** `src/edit.ts:69-81` collects every `rooms.*.poly` / `outdoor.*.poly` vertex
  whose coordinate equals the boundary being dragged, with no test that the vertex is on the
  grid. In `fixtures/quinta.json` the grid's east edge is `x = 10.2` and the detached shack
  `arrecadacao` (poly-authored, south of the house) also has `x = 10.2`. Dragging `w21` to
  10.7 writes `layout.cols[2] = 4.1`, `rooms.arrecadacao.poly[1][0] = 10.7`,
  `rooms.arrecadacao.poly[2][0] = 10.7`. The intended case (casa-patio's courtyard poly
  riding its tracks) is tested; this one is not.
- **Fix.** Carry a vertex only if its other coordinate lies within the grid's span on that
  axis. Note that the whole wall-drag part of `edit.ts` is rewritten under §G; this is a
  correctness fix for the current layer, not an investment.

### A4. Unknown keys are silently ignored (agent-critical)

- **Evidence.** `src/parse.ts` reads known keys and never checks for others. casa-t3 with
  `positon`, `swing_into`, `hinges` on a door and `kinds`, `habitble` on a room produces
  byte-identical lint output: the door quietly moves to the wall's centre.
- **Fix.** Per object, a `known` set and `bad(path, 'unknown field "positon"; did you mean
  "position"?')` (edit distance ≤ 2 over known keys). Consider allowing `x-*` for private
  notes. This is schema infrastructure that every later schema (levels, arcs) reuses.

### A5. One hole becomes many findings

- **Evidence.** `src/derive.ts:94-114` emits `tiling.gap`/`tiling.overlap` per arrangement
  cell. `broken.json` reports its single hole twice; a 10 × 10 grid with one undeclared
  9 × 9 m hole yields **9** `tiling.gap` findings (plus 90 `space.no_access`, which is fair).
- **Right design.** One finding per connected void/overlap *face* with its outline. The
  arrangement in §G produces faces directly, so this comes for free there; merging cells
  today is a stopgap that the rewrite discards.

### A6. `--json` is not JSON when the plan fails schema

- **Evidence.** `src/cli.ts:47-52`: a `PlanError` prints as text to stderr; stdout empty.
- **Fix.** With `--json`, emit `{"error":{"issues":[{path,message}]}}` on stdout, exit 2.

### A7. "unknown room" for a declared outdoor space

- `src/parse.ts:198-199`. Subsumed by A2; until then the message should say `"deck" is an
  outdoor space`.

### Checked and fine

- `normalizePoly` rejects non-rectilinear, self-touching and zero-area rings with specific
  reasons; `clearArea`'s corner term is exact for right angles and tested; `pointInPoly` is
  only probed at cell centres, as its comment says.
- SVG marker numbers match `--lint` numbers even when a finding has no `at`.
- Escaping: every plan-authored string in `src/svg.ts` passes through `esc()`; only
  `opts.colors` (caller-supplied) is interpolated raw into `style`.
- Performance: 0.72 ms casa-t3; 25/100/400 synthetic rooms → 1.0/5.0/44 ms. `largestRect`
  is O(cols²·rows²) per room; `jsonpos` slices the text per number. Neither matters.

---

## B. Agent experience: API, errors, affordances

### B1. Token economics — measured

| fixture | as written | minified | canonical `formatText()` | YAML | one entity per line, compact |
|---|---:|---:|---:|---:|---:|
| casa-t3 (13 rooms, 23 openings) | 2 322 | 1 575 | 2 302 | 1 765 | 1 687 |
| apartment-t2 (grid) | 1 079 | 716 | 1 075 | 764 | 774 |
| casa-piscina | 1 169 | 775 | 1 131 | 857 | 850 |
| quinta | 1 042 | 698 | 1 011 | 733 | 771 |
| casa-patio | 805 | 532 | 786 | 572 | 587 |
| broken | 677 | 433 | 644 | 524 | 483 |
| cabin | 644 | 429 | 648 | 482 | 473 |
| **7 fixtures** | **7 738** | **5 158** | **7 597** | **5 697** | **5 625** |

Where casa-t3's tokens go (sections cut from the fixture text itself):

| slice | tokens | share |
|---|---:|---:|
| `openings` (23 entries, 27 lines) | 1 273 | 55 % |
| `rooms` (13 entries, 15 lines) | 935 | 40 % |
| `outdoor` (1 entry) | 67 | 3 % |
| column alignment padding | 97 | 4 % |
| pretty separators `": "` / `", "` | ≈650 | 28 % — the whole gap to "minified" |

Per entity: one rectangular room 62 tokens (JSON) / 44 (`rect` shorthand) / 21 (line
syntax); one door 61 / — / 14.

What an agent reads back:

| output | casa-t3 | broken |
|---|---:|---:|
| `--lint` text | 105 | 795 |
| `--json` (findings + schedule, `JSON.stringify(…, null, 2)`) | 1 263 | 2 013 |
| … of which schedule | 1 047 | 482 |
| … findings only, pretty | 203 | 1 518 |
| … findings only, compact | 128 | 988 |
| SVG | 8 728 | 6 231 |
| README "Plan format" section (onboarding prose) | 2 358 | |

Observations. A casa-t3-sized edit costs ≈2.3 k (re-emit) + 1.3 k (read back) ≈ 3.6 k
tokens per turn; the findings themselves are 130–200. Pretty-printed findings cost 2× because
`JSON.stringify` puts each coordinate on its own line — the problem `src/format.ts` solves
for plans and is not used for output. The canonical formatter is pessimal: casa-t3 goes from
52 lines to 136 (long openings wrap past `width: 140`) and saves 20 tokens; no fixture is in
canonical form, so `src/format.ts:22` ("the way the fixtures are written") and `:2-3` ("the
playground rewrites the source on every drag") are both false — drags splice. Never hand an
agent the SVG.

### B2. Findings must carry a source path

`src/types.ts:178-186`: `Finding { rule, severity, message, at?, rooms?, opening?, fixture? }`.
Add `path` (`"openings[3]"`, `"rooms.sala"`, `"fixtures[2]"`, `"layout.cols[1]"`; with
levels, `"levels.first.rooms.suite"` — design the shape with §H in mind) and, where the rule
knows the field, the field. Where the prose already lists a fix (`wall.ambiguous` lists
candidates with coordinates), emit it structured too: `candidates: [{ side, wall, from, to }]`.

### B3. Expose the edit primitive on the CLI

`spliceAt`/`spliceAll` exist and are tested; the CLI has no verb for them. Add
`floorplan set plan.json openings[3].position 2.1` and `--patch patch.json` (`[{op, path,
value}]`, with `remove`/`append` needing a small extension to `jsonpos` to eat commas),
writing back with formatting intact and printing new findings. One edit ≈ 20 tokens
regardless of syntax. This matters more for per-turn cost than the syntax choice itself.

### B4. `--json` composition and format

Default to `{ summary, findings }`; `--json=all` adds `schedule` and `walls` (`id, geometry,
neg, pos, kind`; ≈20 tokens each) so an agent can see the derived walls before placing an
opening — today it learns wall extents only by tripping `wall.ambiguous`. Emit through
`formatPlan` (points on one line): broken's findings drop from 1 518 to ≈990 tokens.

### B5. Absolute placement for openings — the mechanism that survives angled walls

`on.side ∈ {north,south,east,west}` + `position` from the derived segment's start asks the
agent to reason about orientation it did not author, and it has no meaning on a wall at
30°. Add `"at": [x, y]`: choose the nearest candidate wall (`distToWall`, `src/derive.ts:497`,
generalises to any segment/arc), project to get the centre. `on.near` is half of this
already. Measured: 37 tokens (JSON) / 13 (DSL) per opening. After §G, `at` is the primary
selector and `on.side` is sugar that only applies to axis-aligned walls.

### B6. `rect` shorthand

11 of casa-t3's 13 rooms are rectangles written as four points. `"rect": [x, y, w, h]`
mirrors the fixture `at`/`size` convenience, saves 18 tokens per room, and removes the most
common way to write a broken polygon. Still useful when angles exist; a rectangle is still
the common case.

### B7. Stable identifiers

Openings and fixtures are addressed by array index everywhere. Deleting `openings[2]`
renumbers every later finding and path. Allow optional `id` on openings and fixtures;
findings and paths prefer it. With levels, ids are scoped per level (§H).

### B8. One channel: schema problems as findings

Add `lint(input)` that never throws and folds schema issues in as
`{ rule: "schema.<what>", severity: "error", path }`. Keep `parse()`/`floorplan()` throwing.

### B9. Public surface

`src/index.ts` is discoverable and typed; `floorplan()` is the right one-call entry. Three
tiers are exported without being named: pipeline, editing, JSON plumbing. Say so in the
header. The traps are in the data (A4) and the CLI (A1), not in the API.

### B10. Onboarding cost

The README's plan-format prose is 2 358 tokens. The `/reference` route already reads the
vocabularies from the library; expose the same as `floorplan --schema` so an agent loads
≈600 tokens of facts instead, and so field names cannot drift (rules already cannot).

---

## C. Is JSON the right representation? — judged against today's plans *and* against
## angles, arcs and levels

Measured on casa-t3. Every variant was generated or hand-written; the grid variant was
verified to produce identical areas, findings and wall count through `floorplan()`.

| representation | tokens (casa-t3) | vs current | extends to angles/arcs | extends to levels |
|---|---:|---:|---|---|
| JSON as written | 2 322 | — | yes: an arc is a value inside the point list | yes: a `levels` map, 15 tokens of wrapper (measured) |
| JSON canonical `formatText()` | 2 302 | −1 % | same | same |
| JSON + `rect` | 2 093 | −10 % | same | same |
| YAML (flow entries) | 1 765 | −24 % | same as JSON | same; needs a parser (dependency or hand-rolled), `on:` is a YAML 1.1 boolean |
| JSON one entity per line, compact separators | 1 687 | −27 % | same | same |
| JSON minified | 1 575 | −32 % | same | same; one line, hostile to targeted edits |
| JSON grid-authored (`layout`) | 1 551 | −33 % | **no** — a track grid cannot hold a 30° wall or an arc | per-level grids with shared tracks: yes |
| JSON + `rect` + one-string openings | 1 172 | −50 % | openings are 1-D along a wall, so the string grammar is unchanged; rooms still JSON | yes |
| line DSL | 733 | −68 % | yes: an `arc x,y rR` token inside `poly` (measured 40 vs 59 tokens for the same arc room) | yes: `level <id>` section headers (measured 143 vs 334 tokens for the same two-storey plan) |

Encodings for the new geometry itself (one room with a 45° cut and a bay-window arc):

| encoding | tokens | notes |
|---|---:|---|
| JSON poly, arc as inline `{"arc":[x,y],"r":1.2}` | 59 | self-describing; splice-friendly (one value) |
| JSON poly, DXF bulge triples `[x,y,b]` | 53 | compact, standard, but `b = tan(θ/4)` is not something an agent computes reliably |
| JSON SVG-path string `"M0 0 L6 0 … A1.2 1.2 0 0 1 6 5 …"` | 65 | opaque to `jsonpos`, seven-argument arc command; **dead end** |
| DSL `poly 0,0 6,0 6,3 arc 6,5 r1.2 6,8 1,8 0,7` | 40 | |
| same room rectilinear-only, JSON / DSL | 37 / 15 | the cost of one arc ≈ 20 tokens either way |

Two-storey wrapper (same tiny plan): JSON `levels: { ground: {…}, first: {…} }` 334 tokens,
of which the wrapper is 15; DSL with `level` headers 143. A finding gains `level` and `path`
fields: 50 vs 32 tokens compact — the price of being actionable.

### The candidates, on all criteria

- **JSON (canonical).** Highest authoring prior, exact round-trip through `jsonpos`, best
  tooling already present, extends to arcs (an object among points) and levels (a map)
  without strain. Its cost is separators and key repetition, ≈50 % of the file, paid every
  turn. **Keep as the model and interchange.**
- **YAML / TOML.** 24 % cheaper than pretty JSON, but: a parser (dependency or a subset
  written by hand, which is a bad place to spend robustness effort), YAML 1.1 treats the
  field literally named `on` as a boolean, TOML's `[[openings]]` makes the noisiest section
  longer. **Wrong direction.**
- **Positional arrays.** Cheap and unreadable; agents transpose arguments; arcs and levels
  make the positions ambiguous. **Wrong.**
- **SVG-path strings for geometry.** Familiar to agents from HTML, but opaque to the
  positioned parser, the formatter and the drag layer, and the arc command's seven arguments
  (radii, rotation, large-arc, sweep) are a known source of errors. **Dead end.**
- **Grid ASCII (`layout`).** Right for apartments and rectilinear subsets; requires the plan
  to share tracks (casa-t3 needs an 8 × 7 grid with 0.2 m slivers); cannot express openings;
  cannot express a non-axis wall. **Keep as sugar; do not grow it.** With levels, allow
  shared `cols/rows` across levels (that is where its reuse value lies).
- **DSL inside JSON strings (openings only).** −50 % with an 80-line grammar and every
  existing tool intact; but two grammars in one file, schema errors that must point at a
  column inside a string literal, and no help for rooms. **A compromise**: it captures most
  of the opening saving now and costs a second migration later if the full DSL lands.
- **Line-oriented DSL.** −68 % now, the same ratio for arcs and levels, one entity per line
  (best edit locality: replace line N; best diffs), a regular grammar an agent can hold in
  ≈1 k tokens of docs, `line: message` errors. Costs: a parser and a printer (`toDsl`), a
  weaker pretraining prior than JSON, and two syntaxes to document. **The right agent-facing
  authoring surface.** It compiles in `parse()` to the JSON `Plan`, exactly as `layout`
  compiles to polygons; render and rules never see either syntax.

### Recommendation

1. **Keep JSON as the canonical model and interchange.** It extends to everything in §G and
   §H. Fix the formatter (one entity per line, compact separators: −27 %, 50 lines) and add
   `rect`. Use `formatPlan` for output too.
2. **Add the line DSL as the authoring surface**, with the grammar designed now to include
   `arc` tokens, `at` placement, `level` sections and `id`s, so it does not change when §G and
   §H land. `parse()` sniffs the first non-space character; `fmt --to json|dsl` converts; the
   app keeps JSON (it needs positions for drags; a line splice for the DSL is trivial if
   wanted later).
3. **Do not do the strings-in-JSON hybrid as well.** If it is done first as a stopgap, it is a
   compromise whose cost is a second migration of every opening.

If the recommendation depended on the gaps: it does not change direction, only the grammar's
day-one contents. What would change it: an authoring eval (twenty briefs per syntax, count
schema failures) showing agents produce more first-time errors in the DSL than in JSON; or
`--patch` landing and agents no longer emitting whole documents, which shrinks the DSL's
advantage to initial authoring and readability.

---

## G. Lifting the rectilinear limit

### G1. Where axis alignment is load-bearing

Occurrences of the axis vocabulary (`axis`, `"h"|"v"`, `north|south|east|west`, `bbox`/`Rect`)
per file: `derive.ts` 21/18/6/23, `edit.ts` 35/6/5/14, `svg.ts` 12/11/5/18, `geometry.ts`
3/0/0/24, `rules.ts` 0/0/0/11, `types.ts` 3/1/1/7. The app touches it in three places
(`Drawing.tsx:78,97,154`). Concretely:

| layer | assumption | file:line | mechanical edit or new algorithm |
|---|---|---|---|
| polygon acceptance | every edge must be axis-aligned | `geometry.ts:104`; `selfIntersection` uses bbox overlap as segment intersection (`:134-144`), which is only correct for axis-aligned segments | new: a real segment/arc intersection test |
| **coverage / tiling** | arrangement = all distinct x × all distinct y; a cell has one owner set; exact only when every edge lies on a grid line | `derive.ts:39-114` | **new algorithm** (G2) |
| wall extraction | walls are pieces between cells with different owners, merged when collinear on the same `c` | `derive.ts:116-159`; `WallSegment { axis, c, from, to }` (`types.ts:110-122`) cannot represent a sloped or curved wall | new type + new extraction from arrangement edges |
| clear area | `A − Σ len·t/2 + Σ ±t₁t₂/4` — the corner term is for right angles | `derive.ts:376-407` | mechanical for straight corners (`t₁t₂/4 · cot(θ/2)`-type term), new for arcs (offset an arc = change its radius; area by integration of the offset) |
| label position / min dimension | largest inscribed **axis-aligned** rectangle over grid cells | `geometry.ts:221-250`, `derive.ts:249-266` | new: pole of inaccessibility on the room polygon minus fixture polygons; `minDimension = 2·inradius`, which equals the short side for a rectangle, so today's numbers are preserved |
| exterior faces | a room's exterior sides are a set of four compass names | `derive.ts:268-275`, `RoomModel.exteriorFaces` | mechanical: list the exterior wall ids, or bearings |
| opening selection | `on.side` is a compass side; `sideOf` | `derive.ts:484-487`, `parse.ts:243` | keep as sugar for axis walls; `at: [x,y]` (B5) becomes primary |
| opening placement | 1-D parameter along the wall | `derive.ts:440-448` | already general: arc length works for arcs |
| door swing | along/normal vectors picked from the axis | `doors.ts:24-26`; swing collisions and swing-hits-fixture use rectangles (`rules.ts:212-262`) | mechanical (unit tangent and normal); the fixture test becomes sector ∩ polygon |
| fixture clearance | `boxGap` of bboxes | `rules.ts:233` | polygon–polygon distance (segments and arcs) |
| fixture geometry | `at`/`size` rectangles; `poly` rectilinear | `parse.ts:305-328` | mechanical: accept the same edge list as rooms; add `rotate` |
| renderer | walls are `<line>`s with `stroke-width = t`, and a real wall end extends by t/2 to "fill the corner" — a trick that only closes right-angled corners | `svg.ts:161-185`; window glazing lines offset ±t/4 along the axis (`:194-198`) | new: draw each merged wall chain as one `<path>` (lines and arcs) with `stroke-linejoin="miter"`; jambs stay butt. True outlines (mitred polygons) need offsetting — see G3 |
| projection / dimensions | bbox | `svg.ts:48-70, 239-251` | unchanged |
| **drag layer** | a wall is one coordinate on one axis; a drag rewrites that coordinate in every vertex on the line | `edit.ts:53-198`, `Draggable { axis, c }`; outdoor and fixture edges likewise | **new**: a drag moves a wall along its normal, rewriting both coordinates of its end vertices and re-solving the adjacent edges' intersections; a curved wall's drag is a radius change |
| grid authoring | inherently rectilinear | `parse.ts:362-435` | unchanged, by design |

### G2. The right core: a planar arrangement with face owners

Replace `derive.ts:39-159` with:

1. **Edge list.** Rooms, outdoor spaces and fixtures contribute boundary edges: straight
   segments and circular arcs (see G4 for authoring). Coordinates snapped to 1 mm and held
   as integers in millimetres; with plans under 100 m, cross products fit in 2⁵³ exactly, so
   orientation and segment–segment intersection predicates are **exact** without BigInt.
2. **Arcs in topology.** Flatten each arc to chords at a 1 mm sagitta tolerance for the
   arrangement only; keep the true arc for rendering, area and clear area. This is a
   deliberate choice: an exact circle–circle / circle–segment arrangement needs algebraic
   numbers or careful ε-handling and is where such libraries spend most of their robustness
   effort; at 1 mm the flattened topology is identical for any realistic plan. (Listed under
   "would not do" below.)
3. **Arrangement.** Pairwise intersection of all edges (≈600 edges for 100 rooms → 180 k
   pairs, trivial; Bentley–Ottmann is not needed), split at intersection points, snap the
   new vertices, then build a half-edge structure: at each vertex sort outgoing half-edges
   by angle; walk faces. The outer face is the one with negative signed area.
4. **Owners.** For each bounded face take an interior sample point (e.g. midpoint of a
   boundary edge nudged inward by 0.5 mm along the face normal, then verified by
   `pointInPoly` — the same probe idea as today's cell centres) and collect the rooms that
   contain it. Owner classes: room, outdoor id, exterior (faces connected to the outer face
   through zero-owner faces), gap. `tiling.gap` and `tiling.overlap` become one finding per
   face — A5 disappears.
5. **Walls.** Every half-edge pair separating faces with different owners; merge consecutive
   collinear / co-circular edges with the same owner pair into a wall chain. New type:
   `Wall { id, geometry: Segment | Arc, neg, pos, kind, thickness }`, with `from/to` as arc
   length so openings and their positions are unchanged.

Everything downstream — opening resolution, access graph, rules, schedule — reads owners and
walls exactly as today. The rewrite is ≈600–900 lines with tests; the difficulty is entirely
in robustness: near-parallel edges meeting at a shallow angle (tiny faces), T-junctions where
a sloped wall hits an orthogonal one between its vertices (the arrangement splits the edge;
the snapped split point must be re-checked for new coincidences), slivers under 1 mm
(dissolve faces below a threshold area into a neighbour and report them), and duplicate edges
from two rooms sharing a wall (dedupe after snapping). Integer millimetres remove the
floating-point class of bugs for straight edges; arcs reintroduce it only in flattening,
which is why flattening is the right choice.

### G3. Offsetting: clear area, wall outlines, DXF

- **Clear area** for straight-edged rooms: offset each edge inward by half its wall
  thickness, intersect adjacent offset lines (mitre), area of the result; this is exactly
  today's formula generalised, and it breaks the same way — when an edge is shorter than the
  offsets meeting on it, the mitred polygon self-intersects. Handle by detecting the
  inverted edge and collapsing it (the standard "straight skeleton lite" for small
  offsets). For arcs the inward offset is the same arc with radius reduced by t/2.
- **Wall outlines** as filled polygons (needed for print-quality output and any DXF, not for
  the SVG, where stroked chains with mitre joins suffice): buffer each wall chain by t/2 and
  union. Union is polygon boolean ops. Writing one without dependencies is legitimate here:
  a Martínez–Rueda sweep (≈800 lines) is the robust choice; Greiner–Hormann is shorter but
  fails on shared vertices and collinear overlaps, which is precisely what wall junctions
  are. Integer coordinates again make the sweep's predicates exact. Recommend building it
  after the arrangement, for outlines and DXF; it also gives exact fixture–fixture and
  room-over-outdoor intersections for §H.

### G4. Authoring geometry

A room's `poly` becomes a list where each element is a point `[x, y]` or an arc
`{ "arc": [x, y], "r": 1.2, "sweep": "ccw" }` meaning "arc from the previous point to this
one with radius r"; `rect` stays; add `"rotate": deg` for rectangular fixtures. In the DSL:
`poly 0,0 6,0 6,3 arc 6,5 r1.2 …`. Both are ≈20 tokens per arc (measured). Opening syntax is
unchanged (1-D along the wall); `at: [x,y]` becomes the way to pick a sloped wall. Rules that
speak of compass sides (`habitable.no_window` "exterior wall on the south") report bearings
or wall ids instead.

### G5. Editing angled and curved walls

`Draggable` becomes `{ wallId, normal: [nx, ny], offset0, min, max, edits(offset) }`: a drag
moves the wall along its normal; the two rooms it separates have their vertices on that
wall moved, and each adjacent edge's far vertex stays put, so the adjacent edges pivot (the
intersection of the moved supporting line with each neighbouring supporting line is the new
vertex — solve two lines, or line/circle for a neighbouring arc). The "vertex on the line
outside the wall's run" refusal generalises unchanged. Curved walls expose radius drags and
end-point drags. The app's pointer code needs the normal instead of `axis` (three lines).
This replaces ≈200 lines of `edit.ts`; outdoor-edge and fixture drags reuse the same
mechanism.

---

## H. Adding levels

### H1. Where single-storey is assumed

- `Plan` and `Model` are flat: `rooms`, `outdoor`, `openings`, `fixtures` at the top level
  (`types.ts:95-104, 164-174`); 37 consumers of those collections across `src/` and the app.
- `derive()` builds one arrangement, one `access` map rooted at `"exterior"`, one `envelope`,
  one `interiorArea` (`derive.ts:336-368`); `checkRules` runs one BFS from `"exterior"`
  (`rules.ts:81-99`) and one entrance check.
- `schedule()` is flat (`index.ts:84-115`); `floorplan()` returns one `svg`.
- The CLI writes one file; `edit.ts` hard-codes 17 top-level paths (`["rooms", id, …]`,
  `["fixtures", index, …]`, `["layout", …]`); the app shows one drawing.
- `stairs` is a `FixtureType` (`parse.ts:43`, `types.ts:54`) with no behaviour: it is drawn as
  a dashed rectangle with a label and participates in `fixture.*` and `door.swing_hits_fixture`
  like a bath.

### H2. The right shape

```jsonc
{
  "title": "Casa T3", "walls": { "exterior": 0.3, "partition": 0.12 },
  "shared": {                       // authored once, stamped into every level that uses it
    "layout": { "cols": [...], "rows": [...] },
    "cores": { "stair": { "type": "stairs", "rect": [0.2, 0.2, 1.0, 3.0], "serves": ["ground", "first"] },
               "lift":  { "type": "lift",   "rect": [1.4, 0.2, 1.6, 1.8], "serves": ["ground", "first", "second"] } }
  },
  "levels": [
    { "id": "ground", "name": "Rés-do-chão", "height": 2.7,
      "rooms": {...}, "outdoor": {...}, "openings": [...], "fixtures": [...],
      "layout": { "areas": [...] } },       // rows/cols from shared.layout
    { "id": "first", "name": "1.º andar", "height": 2.5, "rooms": {...}, ... }
  ]
}
```

- A document without `levels` is a single level `ground` (backward compatible).
- Levels stack on one shared origin and north; `elevation` derives from the heights below.
- **Ids are scoped per level**; cross-level references use `level/room` and are only needed
  in cross-level findings, never in authoring: a `stairs`/`lift` fixture with `to:
  "first"` (or a `shared.core` with `serves`) is matched to its counterpart on the target
  level by plan-view footprint overlap — the agent never has to cross-reference by hand.
- **What carries across** and is expressed once: wall thicknesses; the track grid (`rows`/
  `cols` in `shared.layout`, each level supplies only `areas`); cores (stair, lift, service
  shaft) stamped into every served level. That is where multi-level token cost is saved: an
  upper floor on a shared grid is one `areas` block per level. Measured wrapper cost: 15
  tokens in JSON; the DSL's `level first` header is 2.
- Per-level `height` enables the headroom rules below; optional.

### H3. Derivation and rules

`derive` runs per level unchanged (each level is its own arrangement). A cross-level pass
then:

- builds the **combined access graph**: nodes `level/room`, plus `exterior`; doors link
  within a level; each stair/lift links the rooms containing its footprint on the levels it
  serves; `reach.unreachable` runs once on the combined graph and its message says why
  ("no stair reaches level first").
- **Entrance** is a door to the street on the level whose outdoor is the ground
  (default: the first level); a street door on an upper level is `entrance.not_ground`
  (info) unless that level is marked `ground: true` (sloping sites).

Rules by scope:

| stays per level | becomes cross-level | new |
|---|---|---|
| `tiling.*`, `wall.*`, `opening.*`, `window.not_exterior`, `space.no_access`, `habitable.no_window`, `wet.*`, `privacy.*`, `room.min_dimension`, `door.*`, `fixture.*`, `outdoor.overlap`, `circulation.share` (per level, plus a total) | `entrance.missing`, `entrance.multiple`, `reach.unreachable` | `level.unreachable` (no stair or lift arrives), `stair.no_arrival` (a stair's footprint has no counterpart on the level it names), `stair.misaligned` (footprints overlap only partly), `stair.headroom` (needs `height` and the stair's run: rise/run against the floor above), `structure.over_open_sky` (a room's footprint sits over cells that are outdoor/exterior on the level below — cantilever, info; over a *gap* is an error), `stack.wet_over_habitable` (info: services above a bedroom), `stair.no_landing` (door opens onto the stair's top or bottom step) |

The cross-level footprint checks need polygon intersection between levels — the general
predicates from §G. Built on today's cell-centre predicates they would be rectilinear-only
and rewritten; that is the sequencing dependency.

### H4. Output

- **Library.** `floorplan()` returns `{ plan, levels: [{ id, model, svg, findings }],
  findings, schedule }` where top-level `findings` is every finding with a `level` field and
  the cross-level ones; `schedule` has `levels[]` and totals (interior, clear, usable, water,
  outdoor per level; gross above ground).
- **Rendering.** One SVG per level; the level below ghosted (its envelope outline dashed at
  low opacity, stair and lift footprints shown so alignment is visible). A `--stack` option
  renders all levels in one sheet, side by side or vertically. One drawing per level is the
  convention architects read; a stacked composite is for overview.
- **CLI.** `--level first` selects; `--out plan-{level}.svg` expands; `--json` findings carry
  `level` and `path`. Measured cost of that actionability: 50 tokens per finding compact
  versus 32 today. Findings-first `--json` (B4) keeps read-back linear in problems, not in
  levels.
- **App.** Level tabs over one drawing; drags splice under `levels[i]…` paths; the ghosted
  level below is not draggable.

### H5. What the agent pays

For a two-storey plan on a shared grid, the second level costs its `areas`, rooms and
openings — roughly what a single-level plan of that floor costs today minus the tracks. The
wrapper is negligible (15 tokens). Read-back grows with findings, not levels, provided B4.
In the DSL the same two-storey sample is 143 tokens against 334 in JSON.

---

## D. Rules engine

- **D1.** Daylight counts only `window` (`derive.ts:318-334`); a glazed exterior door does
  not satisfy `habitable.no_window`. Add `glazed: true` on doors.
- **D2.** `entrance.multiple` on casa-patio lists the courtyard door as "outside" — fixed by A2.
- **D3.** `usableArea` deducts fixtures by `in`, not by containment (`derive.ts:216-217`), so
  a fixture flagged `fixture.outside_space` still reduces the room's usable floor. Deduct
  the intersection (exact once §G3's boolean ops exist).
- **D4.** Messages are the project's best feature; B2 asks only for the same facts in fields.
- **D5.** Thresholds are options with sane defaults; `other` has no minimum by design.

## E. Architecture, tests, docs

- **E1. Two playgrounds.** `demo/index.html` (397 lines, vanilla, `scripts/build-demo.ts`,
  `test/demo.test.ts`) and `app/`. The README describes only `app/`. Remove `demo/`; it is a
  second implementation that will not follow §G/§H.
- **E2. Stale claims.** README and `specs/floorplan-lib-plan.md` §9: "84 tests" (179).
  `src/format.ts:2-3, 22` (see B1). Nothing guards prose numbers; drop them.
- **E3. Tests.** Breadth is good. Missing, each of which would have caught a finding above:
  CLI through a symlink (A1); unknown keys (A4); a courtyard-only door (A2); a grid drag with
  a detached poly (A3); `formatText(fixture)` stability; `examples/*.svg` are committed but
  never checked against the renderer.
- **E4. Git hygiene** is fine (`dist/`, `demo/build`, `app/dist`, `node_modules` ignored).

## F. The app

- **F1.** `Drawing.tsx:52-58` recomputes four handle maps per render, each parsing the text
  again. Harmless today; with levels and a general drag layer, compute once per document.
- **F2.** `playground.tsx:378`: `findings: Sched extends never ? never : import("floorplan").Finding[]`
  — a no-op conditional; write `Finding[]`.
- **F3.** `Drawing.toMetres` builds `projection(model, { scale })` while the render used
  `{ scale, areas, labels, theme }`; it works because `ox/oy` depend only on `dimensions` and
  `title`. Have the render result carry its projection.
- **F4.** Finding markers are numbered in the drawing; the findings panel is not, and
  nothing links them. Hover/click linking is the missing half of the "act on findings" loop.
- **F5.** Textarea and SVG are labelled; the toast is `role="status"`; handles are
  pointer-only (the source is the accessible path).
- **F6.** `dangerouslySetInnerHTML` receives SVG built from user text; every authored string
  is escaped in `src/svg.ts`; ids are regex-bound. Acceptable.
- **Not verified:** dragging, undo/redo and the stale-drawing behaviour in a browser. The
  library side is tested (`edit.test.ts`, 321 lines); the pointer plumbing was not exercised.

---

## Prioritised plan — by value and dependency, with effort as information

**Now, independent of both gaps (each is wrong today, and none is undone later):**

1. A1 — CLI through its bin link, with a symlink test. *Minutes.*
2. A4 — reject unknown keys with "did you mean". *Hours.* Schema infrastructure that levels
   and arcs reuse.
3. A6, A7 — `--json` error envelope; honest outdoor message. *Minutes.*
4. A2 — outdoor spaces as an owner class; entrance means the street; openings may name
   outdoor ids. *A day.* The concept carries into the new core unchanged.
5. B3, B4 — `set`/`--patch`; findings-first `--json` through `formatPlan`, `walls` on
   request. *A day.* Halves per-turn read-back cost regardless of everything else.
6. B1/B6 — formatter to one entity per line with compact separators; `rect`. *Hours.*
7. B5 — `at: [x, y]` for openings. *Hours.* The selector that survives angled walls.
8. E1, E2, F2–F4, A3 — delete `demo/`, fix stale prose, small app fixes, the quinta drag
   bug (as a correctness fix, knowing the layer is replaced). *A day.*

**Design step before building further (do once, for both gaps and the DSL):**

9. Fix the target `Plan`/`Model` shapes: `levels[]`, `shared`, scoped ids, `Wall { geometry }`,
   the edge list with `arc`, `Finding.path` and `level` — and write the DSL grammar with
   `arc`, `at`, `level`, `id` in it from day one. *Days of design, no code.* Then B2 (paths)
   and B7 (ids) are implemented against the final shape.

**Then, in dependency order:**

10. **§G — the geometry core**: integer-mm predicates, planar arrangement with face owners,
    wall chains with segment/arc geometry, pole-of-inaccessibility labels and min dimension,
    generalised clear area, stroked-path renderer, `edit.ts` wall drags along normals. *Two
    to four weeks with tests.* Comes first because §H's cross-level checks and D3 need its
    predicates, and because it changes `Model.walls`, which the ghosted-level rendering and
    the drag layer consume.
11. **§G3 — polygon boolean ops** (Martínez–Rueda on integer coordinates): wall outlines,
    exact fixture and stacking intersections, DXF. *One to two weeks.* Independent of §H's
    data shape; used by it.
12. **§H — levels**: wrapper, shared layout and cores, combined access graph, the new rules,
    per-level SVG with ghosting, CLI `--level`, app tabs. *Two to three weeks.* Additive over
    a per-level `derive`; all of its geometry questions are answered by 10–11.
13. **§C — the line DSL** with `toDsl`, `fmt --to`, `--schema`. *One to two weeks.* Can start
    right after 9 in parallel with 10; its grammar does not depend on the core's internals.
14. D1 (glazed doors), B8 (`lint()` never throws), B10 (`--schema`), F4 (marker ↔ list
    linking) — as the pieces above land.

**Defer until after the core lands (would be built on the grid and thrown away):**

- A5 merging gap cells (faces make it moot); any refinement of `largestRect`, `clearArea`'s
  corner handling, `exteriorFaces` or `on.side`; any extension of the outdoor-edge or
  fixture-edge drag code beyond bug fixes.

**Would not do (wrong or low value, not merely large):**

- YAML or TOML as the format; positional arrays; SVG-path strings for room geometry.
- Replacing JSON as the model and interchange.
- An exact circle arrangement (algebraic intersections) instead of flattened arcs: the
  robustness cost buys nothing at 1 mm.
- The strings-in-JSON hybrid *in addition to* the DSL.
- Growing the grid syntax toward non-rectilinear shapes.
- Auto-layout from an adjacency graph, 3-D, structural or thermal compliance (the spec's
  non-goals stand).
- Performance work of any kind.

---

## Appendix: the DSL sample used for the measurement (casa-t3, 733 tokens)

Counts were made with `gpt-tokenizer` (`o200k_base`). The grid-authored variant is the
same house on `cols [4.6, 2.0, 0.2, 3.6, 1.6, 2, 1, 1.8]`, `rows [2.2, 2.2, 1.4, 1.8, 0.2,
0.2, 2.6]` with the original 23 openings; `floorplan()` returns identical areas, findings
and walls for it.

```
plan "Casa T3" walls 0.3/0.12

room suite "Suite parental" bedroom night rect 0,0 4.6x4.4
room wc_suite "WC suite" bath night rect 4.6,0 2.2x2.2
room closet "Closet" storage night rect 4.6,2.2 2.2x2.2
room quarto1 "Quarto 1" bedroom night rect 6.8,0 3.6x4.4
room quarto2 "Quarto 2" bedroom night rect 10.4,0 3.6x4.4
room wc_comum "WC comum" bath night rect 14,0 2.8x4.4
room distrib "Distribuidor" corridor night rect 4.6,4.4 12.2x1.4
room hall "Hall" hall day rect 0,4.4 4.6x3.6
room escritorio "Escritório" office work rect 0,8 4.6x2.6
room wc_social "WC social" wc day rect 4.6,5.8 2x2
room sala "Sala comum" living day poly 6.6,5.8 12,5.8 12,10.6 4.6,10.6 4.6,7.8 6.6,7.8
room cozinha "Cozinha" kitchen day poly 12,5.8 15,5.8 15,7.6 16.8,7.6 16.8,10.6 12,10.6
room despensa "Despensa" storage work rect 15,5.8 1.8x1.8
outdoor alpendre "Alpendre" covered rect 6.6,10.6 5.4x2.8

door exterior>hall @1.7 w1 hinge:end entrance
door hall>wc_social @0.6 w0.8 hinge:end
door hall>escritorio @1.6 w0.8
door hall>suite @3.45 w0.9 hinge:end
door suite>wc_suite @1 w0.8 hinge:end
door suite>closet @0.8 w0.8 hinge:end
door distrib>quarto1 @1.05 w0.9 hinge:end
door distrib>quarto2 @1.05 w0.9 hinge:end
door distrib>wc_comum @1.05 w0.9 hinge:end
door despensa>cozinha on:despensa.south @1 w0.8
cased hall-distrib w1.4
cased distrib-sala @1.2 w1.6
cased sala-cozinha @2 w1.6
window suite.north @2.3 w2.2
window quarto1 @1.9 w1.8
window quarto2 @1.9 w1.8
window wc_comum.north @1.5 w1
window sala @1 w1.2
window sala @4.6 w3.6
window cozinha.south @2 w2
window escritorio.south @2.1 w2.2
window escritorio.west @1.3 w1.4
window despensa @0.9 w1
```

With the grammar extended for §G and §H, the same statements gain `arc x,y rR` inside
`poly`, `at x,y` on openings, `level <id>` section headers, and `stairs in:<room> … to:<level>`.
