# floorplan — an independent review, optimised for the agent that will use it

Reviewer: Claude Fable 5.1. Tree: `4644b5f` (`feat: casa-v — a double garage on the east flank…`), 105 commits, all dated 2026‑09‑19/20.
`npm ci && npm run build && npm run check:all` is green: **725 tests, 0 failures, 2.3 s**; the playground also builds with vite (525 kB chunk).

Every claim below is marked **reproduced** (a command or script I ran, output quoted) or **by reading** (a `file:line` I read). Token counts are `gpt-tokenizer` `o200k_base`, measured on this tree; they agree with the README's tables to within ±20 tokens.

I did not read `docs/agent-review.md`, `docs/gaps-design.md`, `docs/action-plan.md`, `docs/reviews/` or `docs/eval/` before writing sections 0–9. Section 10 was added afterwards.

---

## 0. Verdict in ten lines

1. The geometry core (`arrangement.ts`, `ring.ts`, `offset.ts`) is the best part of the project: integer‑millimetre snap‑rounded planar arrangement, exact arcs, mitred offset, degeneracy tests. It is correct on everything I threw at it, and it is *fast* (400 rooms in 145 ms).
2. The agent‑facing contract — `path` on every finding, stable ids, `lint()` never throwing, `set`/`patch`, generated `--schema*`/`--rules` — is unusually well thought through and mostly delivers. Read‑back of a clean house is 25–190 tokens; that is the right shape.
3. The DSL halves authoring cost (−48 % on casa‑t3, −53 % on cabin) and is the right *kind* of front‑end. It has four real defects: silent last‑wins on duplicate ids (rooms and **levels**), a layout row whose first cell is `stairs`/`lift`/`ramp`/`void`/… is parsed as a statement, `applyHandle`/`applyVertexHandle` throw on any DSL document, and a grammar line that documents a default the parser refuses.
4. **The playground's index route crashes at load** (`gallery.tsx:17` does `JSON.parse(e.source)`; `plans.ts:12` has served `cabin.dsl` since commit `a9546de`). No app test exists to catch it.
5. The hardest problem for an agent authoring an angled plan is not documented or tolerated: a 1 mm slip on a shared angled edge yields `tiling.overlap` (error) one way and, the other way, a hairline *street* between the two rooms and a misleading `wall.unresolved … share no wall`. Nothing says "these two edges are 1 mm apart".
6. Multi‑level is additive and byte‑compatible as promised; `structure.over_open_sky` is wrong for the two commonest cases (a room over a covered porch, a room over a stairwell void).
7. For non‑rectilinear rooms the *clear rectangle* deducts no wall thickness at all (rotated‑frame `halfWallAlong` never matches): the `rect` a `room.min_dimension` finding publishes is a centreline rectangle. The verdict is still right because it uses the inscribed circle; the number an agent would act on is not.
8. `--lint` text output carries neither `path`, `id` nor `line`; only `--json` is actionable. `--json=walls` costs more than the plan it describes (2 148 vs 1 502 tokens on casa‑t3).
9. Representation: JSON‑canonical + line DSL is the right call. What is missing is not another syntax but **local frames** (author a 60° wing in its own rectilinear coordinates and let the compiler place it) — that is where both the tokens and the 1 mm slips in casa‑v come from.
10. Docs are generated from the source where it matters (schema, grammar, rules), and hand‑written where drift has already happened (`specs/floorplan-lib-plan.md` still lists "no arbitrary angles" as a non‑goal; the README's CLI block omits `--rules`).

---

## 1. Bugs and correctness risks

Ordered by how likely an agent is to hit them, not by module.

### B1. Playground index route crashes on load — **reproduced (JS level), by reading (React consequence)**

`app/src/routes/gallery.tsx:17` renders every example through `floorplan(JSON.parse(e.source), …)`. `app/src/lib/plans.ts:12` imports `fixtures/cabin.dsl?raw` (since `a9546de`, 37 commits ago; `gallery.tsx` was last touched in `8e70f97`, 51 commits ago).

```
$ node -e 'JSON.parse(fs.readFileSync("fixtures/cabin.dsl","utf8"))'
gallery JSON.parse(cabin.dsl): Unexpected token 'p', "plan "Caba"... is not valid JSON
```

`useMemo` throws during render of `/`; there is no error boundary in `router.tsx`. The playground route works because it hands text to `floorplan()` untouched (`useFloorplan.ts`). Fix: pass `e.source` (the library sniffs). The deeper problem is §6: the app has zero tests and `check:all` only typechecks it.

### B2. `applyHandle` / `applyVertexHandle` throw on any DSL document — **reproduced**

`edit.ts:81-82` defines `applyEdits`, which routes to `dslSpliceAll` or `spliceAll` by sniffing the text, and `applyDrag`/`applyMove` use it (`:421`, `:598`). `applyHandle` (`:942`) and `applyVertexHandle` (`:950`) call `spliceAll` directly. `Drawing.tsx:71-78` wraps every offset handle in `applyHandle`, and `:114` offers one for every wall the coordinate drag declines — i.e. every angled wall.

```
=== 3 applyHandle on a DSL document (angled wall offset handle) — casa-angulo converted to DSL
handle: offset:w24 2 corners in sala normal [ 0.857…, 0.514… ]
THROWS: JsonPosError unexpected "p" at line 1, column 1
```

In the app: toggle casa‑angulo or casa‑v to DSL, drag any angled wall → exception in the pointer handler, no edit. `test/dsl-edit.test.ts:102` ("offers the same handles, and the same writes, as the JSON twin") checks the *handles*, never applies one.

### B3. DSL: duplicate ids are silently last‑wins — rooms, outdoor, voids and **levels** — **reproduced**

`dsl.ts:1025` `groupOf(kindKey)[id] = ordered(object, e)` and `dsl.ts:938` `levels[id] = made; content = made;` overwrite without a check.

```
=== 1a  room hall … twice          → rooms:["hall"], hallName:"Hall B"
=== 1b  level a … level a          → levels:["a"], roomsOnA:["y"]   (room x is gone)
```

1b is the dangerous one: an agent that pastes a second `level piso0` header (a very natural edit mistake when appending a floor) loses the whole ground floor's content and the document still lints. JSON has the same weakness via `JSON.parse` (1c), which is inherent to JSON; the DSL parser sees every line and has no excuse. `jsonpos.ts:97` (`members.set(key, …)`) is last‑wins too, so a `set` on a duplicated key edits the *second* occurrence while `parse()` read… also the second — consistent, at least.

### B4. DSL: a layout row (or any continuation) whose first cell is a statement verb is parsed as a statement — **reproduced**

`dsl.ts:1469`: an indented line is a continuation *unless* `statementVerbs().includes(toks[0].text)`. `statementVerbs()` (`:1502-1516`) contains `plan walls north grid level room outdoor void layout door window cased fixture vertical stairs lift ramp` — every one a legal room id (`ID_RE`, `parse.ts:99`). Room ids `stairs`, `lift`, `void`, `level` are entirely plausible.

```
=== 2  layout … \n  stairs hall   → layoutAreas: [], vertical: [{id:"hall",type:"stairs",at:[]}]
=== 2b room lift … layout … \n  lift hall
  error schema.geometry layout.areas: has 0 rows but layout.rows has 1
  error schema.missing rooms.lift L1: has no geometry …
  error schema.missing vertical[0].at: must be a non-empty array …
```

The errors point everywhere except at the cause. The escape hatch for indented level bodies (the cold‑eval fix the comment at `:1461-1468` describes) bought this. Fix options: only treat an indented line as a statement when `pending` is `undefined`; or reserve the verbs as ids in `parse.ts` (which also fixes B7).

### B5. DSL grammar documents a default the parser refuses — **reproduced**

`dsl.ts:302`: `arc.sweep` token doc says `"…; default cw"` and `required: true` in the same line. `parse.ts:700-703` rejects a missing sweep.

```
=== 10 room sala … poly 0,0 4,0 arc 4,4 r2.5 0,4
  error schema.type rooms.sala.poly[2].sweep L1: must be "cw" or "ccw"
```

Either make `cw` the default in `parseDsl` (`dsl.ts:693` builds the arc object without it) or fix the doc. Given the arc's other flag (`large`) defaults, defaulting `sweep` is the consistent choice — but note that `toDsl` (`:418`) then has to keep printing it, or round‑trips change.

### B6. Hairline slips on shared angled edges: the failure mode nobody names — **reproduced**

An agent computing the far end of a 45°/60° wall by hand lands 1–20 mm off. Three outcomes, none of which say "these two edges nearly coincide":

```
=== 19  a: […,[5,5.001],[0,5]] over b: [[0,5],[5,5],…]   (1 mm overlap)
  error tiling.overlap rooms.a: rooms a, b overlap over 0.003 m² from (0, 5) to (5, 5.001)
=== 19b same, 20 mm → error tiling.overlap … 0.05 m²
=== 19c a: […,[5,4.999],[0,5]]  (1 mm gap, open to the boundary at both ends)
  error wall.unresolved openings[1].between: opening #1 (door): a and b share no wall.
        a touches: the exterior; b touches: the exterior
```

19c is the bad one: the wedge reaches the outline, so the flood fill at `derive.ts:394-411` reclassifies it as **the street**, both rooms grow an *exterior* wall 0.3 m thick along the slip (`thicknessOf`, `:495-496`), a window there would pass `window.not_exterior`, and the door fails with a message that is false to the eye. `geometry.sliver` (`derive.ts:447-465`, threshold `SLIVER_M2 = 1e-4`) only fires for *enclosed* faces under 100 mm², and `tiling.overlap` has no sliver tier at all. A 1 mm × 5 m overlap (5 000 mm²) is reported at the same severity as a room drawn on top of another.

This is the single most important thing to fix for angled/curved authoring, because the arrangement already knows the answer: it has the two edges, their distance, and the fact that the face is thinner than any wall. See §5.1 (weld / `geometry.near_coincident`) and §4.2 (frames, which remove the cause).

### B7. A room may be called `exterior`; it can then never be referenced — **reproduced**

`parse.ts:826` only checks `ID_RE`; `spaceRef` (`parse.ts:943`) treats the literal `"exterior"` as the street before it looks at `spaceIds`. `types.ts:280-282` promises "a room whose id happens to be `exterior` can never be mistaken for the street" — true for the *owner union*, false for the *document*: `door exterior>sala` addresses the street and the room `exterior` gets `space.no_access`. Reserve the word (schema error with a hint), and while there, reserve the DSL verbs (B4).

### B8. `structure.over_open_sky` only looks at the rooms below — **reproduced**

`rules.ts:601`: `uncovered(m.room, lower.rooms.map((r) => r.room))`. A `covered: true` outdoor space is a roof by definition (`SCHEMA` doc, `parse.ts:237`), and a `void` on the level below is a hole in *that* slab, not in this one.

```
=== 5  bedroom over a covered porch  → warning structure.over_open_sky … 18 m² standing over no room on p0
=== m  bedroom over a stairwell void → warning structure.over_open_sky … 4.5 m² standing over no room on p0
```

Both are false positives in the two commonest multi‑level configurations (a porch under a bedroom; a basement stair). The predicate should be "over floor plate or roof": rooms ∪ covered outdoor ∪ voids (a void has floor *somewhere* below — or better, recurse to the first level that has anything there).

### B9. Non‑rectilinear rooms: the clear rectangle never deducts wall thickness — **reproduced**

`derive.ts:600-613` builds the rotated sweep grid with `snap()`ed coordinates; `halfWallAlong` (`:1150-1175`) rotates each wall's endpoints *unsnapped* and requires `eq(wc, c)` at 1e‑6 (`:1166`). A rotation by 30° or 60° leaves sub‑millimetre residue, so no wall ever matches.

```
casa-v: sala bearing 30 → largestRect [7.077, 8.793], clearRect [7.077, 8.793], deducted 0/0
        … all 12 angled rooms: deducted 0/0
casa-angulo estudio bearing 0 → deducted 0/0.21   (works at bearing 0)
```

Consequence: `room.min_dimension` on an angled room quotes "largest clear rectangle w × h at 60°" and publishes `rect` — both centreline numbers, overstated by half a wall on each side. The verdict itself uses `2 × inscribed.r` on the true offset ring (`:709`), so it is right. `labelAt` is fine. Fix: snap the rotated wall coordinates the same way the grid was snapped, or compare with a 1 mm tolerance in the rotated frame.

### B10. `Wall.start`/`Wall.end` disagree with everything else the agent sees — **reproduced**

`types.ts:361-383` documents the canonical direction as "east, or north when vertical", so for a vertical wall `Wall.start` is the *south* end. But `from`/`to` ascend (`:379-382`), `walls()` prints `from: pointOn(w, w.from)` (`index.ts:271`), `hinge: "start"` is at `from` (`derive.ts:1560`), and the README says "a wall's start is its west or north end" (`README.md:697`).

```
=== 13  w6: Wall.start [0,4]  Wall.end [0,0]   walls().from [0,0]  walls().to [0,4]
```

So a library consumer who reads `Wall.start` to place a door at `hinge: "start"` gets the wrong jamb on every vertical wall. Internally it is consistent (`arcLengthAt`, `derive.ts:1728`), but the public field name is a trap. Rename to `Wall.canonicalStart` or make `start` = `pointOn(w, w.from)` and keep the direction private.

### B11. `set openings[i].between` on a DSL short‑form opening drops its side — **reproduced**

`dsl.ts:1098` records the `between` span over the whole `suite.north` token; the writer prints `a>b` (`:1080`), so the `on.side` that lived in the same token vanishes and the opening's meaning changes (from "the north wall" to "any of four walls" → `wall.ambiguous`).

```
=== 9  window sala.north @2 w1.5  --set between ["exterior","wc"]-->  window exterior>wc @2 w1.5
```

Either the writer should keep the short form when `a === "exterior"` and re‑emit the side, or the span should exclude `.side`.

### B12. `movableFixtures` cannot move a fixture whose `poly` contains an arc — **reproduced**

`edit.ts:514-517` writes `poly[v][0]`/`[1]` for every entry; an arc entry's corner lives at `poly[v].arc[0]`. `spaceForm` (`:117-133`) handles this for rooms with a `holder` array; `fixtureWriter` does not.

```
=== 4  THROWS: JsonPosError no value at fixtures[0].poly[2][0]
```

### B13. `privacy.bedroom_through_route` is not a through‑route test — **reproduced**

`rules.ts:310-320` fires on any door between two bedrooms. Two bedrooms that both open off the hall and *also* connect (a jack‑and‑jill arrangement) are flagged "one bedroom is a route to the other", which is false. The access graph exists (`LevelModel.access`); the right test is "is B reachable from the street without passing through A" (articulation point). Same class: `wet.opens_to_kitchen` (`:298`) only checks doors, not `cased` openings.

### B14. Two adjacent voids get a partition between them — **reproduced, questionable rather than wrong**

`derive.ts:859` suppresses walls only between two `isVoid` (open sky/gap) owners; a `void`‑`void` boundary derives a partition (`w19` on moradia piso1, `vazio_sala`|`vazio_escada`). Sometimes that is a real double‑height wall continuing up; sometimes it is a wall drawn in mid‑air between one hole and another. The model cannot tell, so at minimum the README's void section should say so; better, let a void say `open: true` to its neighbour, or derive void‑void walls only where the level below has a wall there (it does in moradia: sala|hall at x=4.9).

### B15. Smaller items — **by reading**

- `rules.ts:441` computes `radius` and `:450` `void radius`; `:463` `void model` — dead parameters left after a refactor.
- `svg.ts:532-540` `area()` is unused; `svg.ts:401` `void i`.
- `svg.ts:80-83` the projection's extent is rooms ∪ outdoor only; a fixture or a void outside every room (which `fixture.outside_space` permits) is drawn off‑sheet.
- `rules.ts:395-413` `door.swing_collision` intersects the *bounding boxes* of two quarter‑discs — a false positive for two doors on opposite walls of a narrow room whose boxes touch; info‑level, so tolerable.
- `rules.ts:556-561` `stair.pitch` measures the flight as the bbox extent of the lower footprint along `flightAxis`; a switchback or an angled flight is measured wrong, silently.
- `cli.ts:576` the `patch` error envelope is `JSON.stringify(…, null, 2)`, the only pretty‑printed JSON the CLI emits; everything else goes through `formatPlan`.
- `parse.ts:1063-1066` a sliding door with `hinge` is a `schema.conflict`, but the DSL's `readFlag` for `sliding:false` still records a `hinge` span — harmless.
- `arrangement.ts:155-182` `snapRound` is O(n²) per pass over *all* chords with a bbox pre‑test only; casa‑redonda (four 100‑chord arcs) is already 23 ms per pipeline, 8× casa‑t3. A sweep or a grid bucket over segments (there is one for hot pixels, `:190-216`) would keep curved plans in the same band as straight ones. Not urgent at house scale.

---

## 2. Agent experience

### 2.1 What is good and should be protected

- **`path` is derived from the parsed document, never templated** (`types.ts:563-575`, `pathTo`, `authored`). This is the property that makes `set "$(… | jq -r '.findings[0].path')" 0.9` safe, and it holds in every case I tried.
- **Stable ids with a colon namespace** (`parse.ts:1069-1075`, `types.ts:144-152`). Deleting `openings[2]` renames only its own pair's siblings; authored ids can't collide. Correct design.
- **`lint()` one channel, never throws** (`index.ts:319-338`). Schema and geometry problems have the same shape.
- **Generated references** (`SCHEMA` at `parse.ts:167`, `DSL_SCHEMA` at `dsl.ts:86`, `RULES` at `catalogue.ts:15`) with tests that fail when the parser grows a field the doc lacks (`test/dsl-schema.test.ts`, `test/schema.test.ts`, `test/catalogue.test.ts`). This is how documentation should be built for an agent.
- **Error messages** carry the fix: `did you mean "position"?`, `door takes <a>><b>, w<width>, …` (the whole token list from the grammar table, `dsl.ts:809-818`), `wall.ambiguous` lists candidates with endpoints, `wall.unresolved` lists what each room *does* touch.
- **Findings-first `--json`**: casa‑t3 clean read‑back 174 tokens, cabin 25.

### 2.2 What an agent gets wrong first time

1. **`--lint` output is not actionable.** `formatFindings` (`cli.ts:189-200`) prints severity, rule, message and `@ (x, y)` — no `path`, no `opening`/`fixture` id, no `line`. An agent that reads `--lint` (105 tokens, the README's headline number) then has to run `--json` (174) to act. Add `path` (and `line` for DSL) to the text row; it costs ~6 tokens per finding and saves a round trip.
2. **Positions on a wall** — `@1.7` is metres from the wall's west/north end, where "the wall" is the *derived* segment between the two spaces, whose extent the agent has not seen. The README knows this (`--json=walls` "before placing an opening"), but the walls read‑back costs 2 148 tokens on casa‑t3 — more than the whole plan. Three cheaper answers: `--json=walls --between hall,wc` (one row); `at:x,y` as the *recommended* default in `--schema=dsl` for anything but a room's exterior side; and printing the wall's extent in the `opening.overflow` message (it already does: "does not fit the 2 m wall"). I would go further and make `@` relative to the *room's* edge rather than the derived segment when the opening is `room.side` short form — but that changes the contract; see §9.
3. **Which end is `start`** on a vertical or angled wall (B10). The README states it; the type lies.
4. **Hairline slips** (B6). The messages send the agent to the wrong place.
5. **`set` on a key the document did not author** → `no value at openings[3].hinge` (exit 2). The finding's `path` correctly stops at `openings[3]`, but the natural next move (`set openings[3].hinge end`) fails; the agent must know to use `patch insert` with `key`. `set` should upsert a *scalar leaf* under an existing entity (`jsonpos.insertKey` already exists; the DSL writer knows the token to append). The README's promise ("`set` never fails on a path this library emitted") is kept, but the ergonomics are not.
6. **DSL structural edits** (`remove`/`append`/`insert`) are refused (`cli.ts:507-513`). The message is honest, but the alternative — `fmt --to json`, patch, `fmt --to dsl` — rewrites the file and loses comments. For an agent, "delete line 14" and "append a line to the openings group" are *easier* than in JSON. `dsl.ts` already knows every entity's line (`record(base, …)` at `:1024`, `:1244`, `:1325`) and `levelBody` knows the group order; `remove` = delete that line, `append` = insert after the last line of that group (or at end of level section). Ship them.
7. **Duplicate ids** (B3) and **verb‑named ids** (B4/B7) — silent or misleading.
8. **`layout` cell count errors** name the row (`layout.areas[j]`) but not the cell; fine. **`levels` as an array** was the cold‑eval killer and the terse schema now prints `{id: level}` — good.
9. **Exit code 1 on warnings after a successful `set`** is documented but surprising; the JSON envelope makes it unambiguous. Keep.

### 2.3 Missing from the API surface

- `walls(model)` rows have no `length` and no `thickness`; an agent placing an opening needs both (it can subtract endpoints, but why make it). Add `length`; consider dropping the `neg`/`pos` object form for a string (`"room:living"`, `"exterior"`) in the CLI row — the tagged union is right in TypeScript and 9 tokens per side in JSON.
- No **“describe” view** cheaper than SVG: an adjacency list (`room → [doors to …, windows to …]`) or a coarse ASCII raster. SVG read‑back is 3.6–12.6 k tokens (below), which is *the* budget breaker if an agent ever looks. See §5.
- No `lint()` option to **suppress or downgrade a rule** per document (`_lint: {"circulation.share": "off"}` or a CLI `--ignore rule`). `circulation.share` fires on every small plan (100 % of a one‑room plan) and is noise an agent will learn to skip — which teaches it to skip.
- `RuleOptions` are available in the library but not from the CLI (`--rules-opts '{…}'` or per‑document `_rules`).
- No **JSON Schema** export (`--schema=json-schema`). `SCHEMA` has everything needed; many agent harnesses validate against JSON Schema natively, and structured‑output modes can take one directly. Cheap, high leverage for authoring.

### 2.4 Token economics, measured

| what | tokens | note |
|---|---:|---|
| `--schema` | 1 199 | README 1 181 |
| `--schema=dsl` | 1 381 | |
| `--schema=dsl-full` | 2 040 | |
| `--schema=full` | 2 861 | |
| `--rules` | 1 132 | |
| README.md | 18 859 | never load |
| casa‑t3 JSON / DSL | 1 502 / 788 | −48 % |
| cabin JSON / DSL | 417 / 196 | −53 % |
| moradia‑2‑pisos JSON / DSL | 1 594 / 849 | −47 % |
| casa‑redonda JSON / DSL | 534 / 276 | −48 % |
| casa‑v JSON / DSL | 1 927 / 1 248 | **−35 %** — coordinates dominate |
| casa‑t3 `--json` / `--lint` | 174 / 105 | clean plan |
| broken `--json` / `--lint` | 1 343 / 793 | 20 findings |
| casa‑t3 `--json=walls` | 2 148 | > the plan |
| casa‑t3 `--json=all` | 3 020 | |
| casa‑t3 / casa‑v / cabin SVG | 9 454 / 12 641 / 3 605 | never read |

Per‑turn cost model for an agent, casa‑t3‑sized house:

- **Onboard once**: `--schema=dsl` + `--rules` ≈ 2.5 k. Reasonable. (Against 18.9 k for the README.)
- **Author**: 788 output tokens (DSL) vs 1 502 (JSON). casa‑v shows the ceiling: once rooms are polys with 3‑decimal coordinates the DSL saves only a third; frames (§4.2) are what would halve casa‑v.
- **Read back**: 105–174 clean; ~65 tokens per finding when broken.
- **Edit one thing**: `set` ≈ 25 tokens in + read‑back. Good. But the *decision* often needs `--json=walls` (2 148) first — the most expensive step in the loop today.
- **Recover**: a schema error costs one `--json` (envelope ≈ 40 tokens) and one `set`.

The economics are right in shape; the two outliers are `walls` and anything that makes the agent look at the drawing.

---

## 3. Representation

### 3.1 The choice made

JSON is the canonical model, the interchange, the thing paths address and `patch` edits; a line‑oriented DSL compiles to the *same document* with positions recorded per token (`dsl.ts:1-33`). Findings keep the JSON `path` and add `line`. I think this is right, for reasons the code already states well: one schema, one set of messages, one splice primitive per syntax, and the DSL never has to grow a semantics of its own.

### 3.2 Against the alternatives

- **YAML**: fewer quotes and braces (~−20 % on JSON, well short of the DSL's −48 %), but indentation‑significant, ambiguous scalars (`no`, `1e3`), anchors nobody wants, and no line‑as‑entity property; a coordinate list still costs a row per point unless flow style is used, at which point it *is* JSON. No.
- **TOML**: arrays of tables (`[[openings]]`) turn every opening into 4–6 lines. Worse than JSON for the entity that is 55 % of the tokens. No.
- **S‑expressions**: as compact as the DSL, uniform, trivially parseable; but LLMs still miscount parentheses over 40‑line documents, there is no natural line addressing, and an s‑expr reader still needs the same per‑field validation. It would trade the DSL's one weakness (positional grammar per statement) for a worse one.
- **Positional arrays** (`["door","hall","wc",0.6,0.8]`): about the DSL's size, but silent on field order errors (swap width and position and the plan still parses) and unreadable in a finding. The DSL's prefixed tokens (`w0.8`, `@0.6`) are exactly the cheap fix for that. No.
- **Grid/ASCII notation**: already present as `layout.areas`, and it is the right tool for what it does (apartments, upper floors sharing a grid). It cannot express angles, arcs, openings or fixtures, so it can only ever be a sub‑language. Keep it as one.
- **A different DSL design** — relative placement (`room wc east of hall 2x2`) or constraints: the spec's rejection (`specs/floorplan-lib-plan.md` §3, "turns into a constraint system the moment plans have corridors") holds for general placement. But there is a narrower version that is not a constraint system and pays for itself immediately: **local frames** (§4.2).

### 3.3 Arcs and levels in both spellings

- Arcs: `{ "arc": [x,y], "r", "sweep", "large" }` inline in `poly` (`parse.ts:671-744`) is the right object — endpoints + radius + two flags, editable one number at a time, no stored centre. The DSL's `arc x,y r2.5 cw` is fine. The one defect is B5.
- Levels: a `levels` *map* with `stack` optional (`parse.ts:465-524`) keeps paths stable when a basement is added — right. The DSL's "statements belong to the most recent `level` header" (`dsl.ts:144`) is the correct linear form and the cold‑eval fixes (flush example, indentation allowed) are sound; B3‑b (duplicate `level` header) is its remaining sharp edge.

### 3.4 What would change my mind

If measured agent runs showed that (a) agents author angled plans rarely, and (b) when they do they succeed from `--schema=dsl` without frames, then the DSL as is would be finished and the effort should go to the app instead. Conversely, if agents keep producing B6‑class slips (which I would bet on), the representation is not done until the compiler owns the shared coordinates.

---

## 4. Feature gaps and what to build next

No budget assumed. Ordered by value; effort noted only as sequencing.

### 4.1 Library

1. **Near‑coincidence as a first‑class finding, plus an opt‑in weld.** `geometry.near_coincident` (error) whenever two edges of different spaces run within *w* mm (default 5) of each other without sharing a vertex, whether the gap is enclosed, open to the street, or an overlap; the message names both spaces, both edges' `path`s and the distance, and `candidates`‑style structured fields carry them. Then `--weld 5mm` (CLI) / `{ weld: 0.005 }` (library) snaps the offending vertices onto the other edge *in the document* (a `patch` the agent can review with `--dry-run`). This replaces the misleading trio in B6 and makes hand‑authored angles survivable. Depends on nothing; the arrangement already has the geometry.
2. **Frames** (authoring sugar, compiles to polygons like `rect` and `layout`): `frame ala_este at 12,4 rotate 60` followed by rooms authored in that frame's own rectilinear coordinates (`rect 0,0 3.6x4`), and `layout` inside a frame. casa‑v's wings become two frames of `rect` rooms; the compiler computes the shared edge exactly, so B6 does not arise, and the document shrinks toward casa‑t3's per‑room cost (11 tokens per `rect` vs ~40 per 3‑decimal poly). Findings keep absolute paths (`levels.x.frames.ala_este.rooms.quarto1.rect[2]`); drags write back in frame coordinates through the same `spaceForm` mechanism. This is the single largest authoring win left. Do 1 first anyway — frames don't help someone who authors a poly.
3. **Fix the multi‑level rules' model of "what is below"** (B8): support = rooms ∪ covered outdoor ∪ (voids → whatever is under them). Add `roof` as a concept only if a real plan needs it.
4. **`set` upserts scalar leaves; DSL `remove`/`append`/`insert`** (§2.2 items 5–6). The DSL structural ops are pure line surgery on data the parser already records.
5. **Cheaper reads**: `--json=walls --between a,b` / `--room x` filters; `length` on wall rows; a `--json=adjacency` (per room: doors, windows, neighbours, area) of ~10 tokens per room; and a coarse **ASCII raster** (`--ascii`, 0.5 m cells, letters per room, `#` walls, `|`/`=` doors/windows) so an agent can "see" a house for 300–600 tokens instead of 10 k of SVG or a screenshot round‑trip.
6. **Per‑wall thickness override** (spec §11 lists it as open): `walls: { partition, exterior, between: [{a, b, thickness}] }`, or on the room (`walls: { north: 0.2 }`). Load‑bearing partitions are the first thing a real plan wants and the clear area is wrong without them.
7. **Openings across levels and roofs**: a hatch/skylight (`between: ["exterior", room]` on an upper level is currently "a hole in the wall"); a `window` in a roof is how an attic gets daylight. `habitable.no_window` will mis‑fire on every converted attic until then.
8. **Rule configuration from the document** (`_rules`/`x-rules` private key is already exempt from `checkKeys` — use it, or a `rules` block) and `--ignore <rule>`.
9. **JSON Schema export** (`--schema=json-schema`) generated from `SCHEMA` — the oneOf clauses are already listed as prose per object.
10. **Locale on the CLI** (`--locale pt-PT`), trivial; the option exists on `renderSvg`.
11. Later: DXF/PDF output (the spec's own argument against a *minimal* DXF still holds), dimension strings per room, door schedule.

### 4.2 Non‑rectilinear and multi‑level: how well were they done?

**Non‑rectilinear**: the core is excellent — exact predicates on integers (`arrangement.ts:26-38`), hot‑pixel snap‑rounding, canonical arc flattening so two neighbours agree (`ring.ts:115-130`), an exact per‑edge area for arcs (`ring.ts:184-195`), the mitred offset with reversed‑element pruning (`offset.ts:66-72`), a pole‑of‑inaccessibility with a pattern search that solved a measured performance problem (`arrangement.ts:554-711`). The test suite pins degeneracies explicitly (`test/robustness.test.ts`). What it lacks is on the *authoring* and *reporting* side: B6 (slips), B9 (clear rect), frames, and `on.side` being unusable on angled walls so `at` is the only selector — fine, but `--schema=dsl` should say so up front rather than let the agent find `wall.ambiguous`.

**Multi‑level**: the invariants are the right ones and are held — `levelled` gates every output difference (`parse.ts:253-259`), paths gain a `levels.<id>.` prefix and nothing else (`test/levels-compat.test.ts` against pre‑levels snapshots), vertical elements are matched by id, the ghost layer uses the real outline. Gaps: B8; `height` is per level but wall thickness, `north` and `title` are not (a per‑level `title`/`name` exists; per‑level thickness does not, and a basement wall is not a partition wall); no way to say a level is *below* ground except by stack order; `stair.pitch` bbox axis; no opening between levels; `--json=walls` ids are per level, so a building‑wide wall reference is `(level, id)` — the row carries `level`, fine, but findings' `candidates[].wall` do not.

### 4.3 App

1. Fix B1 and B2. Then **add tests**: a `node --test` that renders every route's data path (`EXAMPLES.map(floorplan)`), and a Playwright smoke test that loads `/`, `/plan/casa-v`, toggles DSL, drags one angled wall.
2. **Findings → source**: clicking a finding should select its `line` (DSL) or its `path`'s span (JSON, via `parseWithPositions`) in the textarea. Everything needed is exported.
3. **Walls read‑out on hover**: id, extent, `neg`/`pos`, length — the app is where a human learns what an agent gets from `--json=walls`.
4. **An "agent console"**: a text box that runs `set`/`patch` against the current document and shows the resulting findings diff. It would make the CLI contract visible and testable in the browser, and it is 100 lines.
5. Share/permalink (document in the URL hash; the app has no persistence at all), and an export menu (SVG per level, JSON, DSL).
6. Undo history is per gesture already; a **"why is this wall not draggable"** hint (the refusal reasons in `edit.ts` are precise) would remove the main confusion in the playground.

---

## 5. Architecture, tests, docs

### 5.1 Module boundaries — **by reading**

- `parse.ts` ⇄ `dsl.ts` import each other (`parse.ts:23-26`, `dsl.ts:35`), guarded by "only inside function bodies" and a lazily built `ORDER` (`dsl.ts:497-506`). It works, but the cycle exists only because `parse()` routes strings to `readSource` (`parse.ts:421-434`); `index.ts:source()` already does the same routing. Make `parse()` take a document only and let `index.ts` own sniffing; the cycle disappears.
- `derive.ts` (1 894 lines) is the module doing four jobs: the level pipeline, wall chaining, opening resolution, and a geometry‑for‑SVG toolkit (`shapePath`, `geometryPath`, `offsetGeometry`, `wallSubGeometry`, `:1779-1892`). The last group belongs in a `wallgeom.ts` that `svg.ts` and `doors.ts` import; `rules.ts` would then not import `derive.ts` for `overlapArea`/`sectorMeetsShape` either.
- `edit.ts` reaches into `svg.ts` for `levelOf` (`edit.ts:8`); `levelOf` belongs in `types.ts`/a `model.ts`.
- `Wall` carries private `edges` through a cast (`derive.ts:499-500`, `:1043`) — fine as a local trick, but it is the kind of thing that leaks; a `wallsOf` return type `{ wall, edges }[]` costs nothing.
- Nothing downstream of `parse` mutates a `Shape`, and two `WeakMap` caches depend on it (`derive.ts:183-196`, `ring.ts:207-223`). That invariant is stated but not enforced; `Object.freeze` in `readPolyAt` would make it structural.
- The CLI is IO‑free with a `CliIo` (`cli.ts:65-72`) — good, it is why 62 CLI tests exist.

### 5.2 Tests — **by reading + run**

725 tests. Strong: parser (61), CLI (62), DSL (48+31), jsonpos (48), rules (42), arrangement degeneracies, geometry pins (8 245‑line snapshot of the derived model), pre‑levels compatibility snapshots, DSL/JSON fixture twins rendered byte‑for‑byte, the README's DSL grammar block regenerated by a test. Gaps that the bugs above map onto:

- No test applies a `Handle` to a DSL document (B2). `test/handles.test.ts` and `test/dsl-edit.test.ts:102` stop at "offers the same handles".
- No test for duplicate ids in the DSL (B3), for an id that is a verb (B4/B7), or for `arc` without `sweep` (B5).
- No **property/fuzz** test on the arrangement: random simple polygons tiled and perturbed by ±1 mm, asserting "the sum of face areas equals the union area" and "no face thinner than 1 mm is silently owned". `robustness.test.ts` is hand‑picked cases; the code is exactly the kind that a 1 000‑iteration fuzz finds new cases in.
- No test on angled rooms' `clearRect` (B9) — the pins recorded the wrong values and now guard them.
- No app tests (B1).
- `rules.test.ts` tests each rule fires; few test that a rule *does not* fire on the legitimate configuration (B8, B13 would have shown up).

### 5.3 Docs — where they drift

- `specs/floorplan-lib-plan.md:39` "no arbitrary angles" and `:215` "M5 multi‑level … only if a real plan needs it" — both superseded; the README (`README.md:12`) still points at the spec "for scope".
- `README.md:155-163` CLI block omits `--rules`; the `USAGE` in `cli.ts:74-94` has it.
- `dsl.ts:302` (B5).
- `types.ts:280-282` promises what `parse.ts` does not enforce (B7).
- `README.md:697` ("a wall's start is its west or north end") vs `types.ts:361-383` (`Wall.start`) (B10).
- The README's "Layout" section (`:1147-1176`) is a good map; the header comment in `arrangement.ts:10` still references "`derive.ts:39`" which no longer exists at that line.
- The README is 18.9 k tokens and mixes contract, measurement history and design rationale. The generated parts (`--schema*`, `--rules`) are the agent's docs; the README should say so in its first 20 lines (it does) and then move the measurement narratives to `docs/`.

---

## 6. Anything else

- **Performance envelope** (reproduced): 25 rooms 6 ms, 100 rooms 21 ms, 225 rooms 67 ms, 400 rooms 145 ms; casa‑redonda 23 ms, casa‑v 13 ms, casa‑t3 2.7 ms, moradia 6 ms. Fine for anything called a house. The `fixture.overlap`/`overlapArea` pairwise arrangements (`derive.ts:558-574`) are O(F²) *arrangements*; a kitchen with 30 fixtures is 435 of them — still fast, but the cheap fix is one arrangement of all fixtures per host.
- **Security**: SVG output escapes text (`svg.ts:38`); ids are `ID_RE`‑constrained so `data-*` attributes cannot be injected. The app uses `dangerouslySetInnerHTML` on library output only.
- **Zero dependencies**: the choice is legitimate and the hand‑written geometry is better than what a clipper dependency would have given (the overlay‑as‑predicate argument at `arrangement.ts:772-781` is right). Keep it.
- **Node ≥ 22.18 type stripping**: `node src/bin.ts` works; `dist/` is what `npm` publishes. Fine.
- **`tiling.overlap` keeps the first claimant as wall owner** (`derive.ts:413-424`) — a defensible choice, explained; but the SVG then draws both rooms' fills over each other with no wall and the finding marker is the only signal. A hatched overlay for `overlap` faces (`LevelModel.faces` has them) would make the drawing honest.

---

## 7. Prioritised list (value and dependency order)

1. **B1** gallery crash — one line; then an app smoke test so it cannot recur.
2. **B2** route `applyHandle`/`applyVertexHandle` through `applyEdits`; add the DSL handle‑apply test.
3. **B3/B4/B7** DSL: refuse duplicate ids (rooms/outdoor/voids/levels/openings' `id:`), reserve the statement verbs and `exterior` as ids in `parse.ts` (both syntaxes), and make an indented line a continuation whenever a statement is pending.
4. **B6 → §4.1‑1** `geometry.near_coincident` for gaps, overlaps *and* boundary‑open slips, with structured fields; then `--weld`.
5. **B8** fix `structure.over_open_sky`'s notion of support (covered outdoor, voids).
6. **B9** clear rectangle in rotated frames (snap the rotated wall coordinates).
7. **B10** rename/redefine `Wall.start`/`end`; **B5** arc `sweep` default; **B11**, **B12**.
8. `--lint` rows carry `path`/`line`; `walls` rows carry `length`; `--json=walls --between`.
9. `set` upsert of leaves; DSL `remove`/`append`/`insert`.
10. **Frames** (§4.1‑2) — the largest remaining authoring win; after 4 so slips are reported either way.
11. `--json=adjacency` and `--ascii`; JSON Schema export; `--ignore`/document‑level rule options; `--locale`.
12. Per‑wall thickness; openings between levels/roof windows; `privacy.bedroom_through_route` via articulation points; `wet.opens_to_kitchen` for cased openings.
13. Architecture: break the `parse`⇄`dsl` cycle; split wall‑geometry helpers out of `derive.ts`; freeze shapes; fuzz the arrangement.
14. App: findings → source selection; wall hover read‑out; agent console; permalinks.
15. Docs: retire or annotate the spec's non‑goals; README CLI block; move measurement history to `docs/`.

## 8. What I would not do

- **Not** replace JSON as the canonical model with the DSL, YAML, TOML or S‑expressions. The paths, the splices and the schema all hang off JSON, and the DSL already captures the token win.
- **Not** add a general relative‑placement or constraint language. Frames are the bounded version that pays; "wc east of hall" is the unbounded one that does not.
- **Not** auto‑fix slips silently (a default weld). Report by default; weld on request, as a reviewable patch.
- **Not** make `tiling.overlap` derive walls around the overlap (the INVARIANT at `derive.ts:413-424` is right).
- **Not** widen `layout` to angles. It is the rectilinear sub‑language; frames + `layout` inside a frame covers the case.
- **Not** add a runtime dependency for clipping, SVG rasterising or tokenising. The only thing a rasteriser would buy is a PNG for a multimodal agent, and an ASCII raster gives 80 % of that for zero deps.
- **Not** pretty‑print any CLI output, ever (the one exception at `cli.ts:576` should go the other way).
- **Not** make `--lint` the JSON output's equal; keep it human‑first, just give each row an address.
- **Not** spend effort on DXF before frames, weld and the multi‑level support rule; the spec's own argument against a minimal DXF still holds.

---

## 10. After reading the prior review, the design doc, the action plan and the evals

Read afterwards: `docs/agent-review.md` (HEAD `2ebc3f0`, 179 tests), `docs/gaps-design.md`, `docs/action-plan.md`, `docs/eval/authoring-eval.md`, `docs/eval/cold3b/cold-run.md`.

- **Everything the prior review asked for has shipped.** Its A1–A7 and B1–B10 (bin entry, unknown keys, outdoor owner, `path`, stable ids, `lint()`, `set`/`patch`, the formatter, `rect`, `at`, `--schema`, the DSL) and its §G/§H (the arrangement core, levels) are all in this tree. My review is therefore of the *residue* of that programme, and most of what I found sits on the seams between waves that ran in parallel worktrees: B1 (W5's `plans.ts` change vs a `gallery.tsx` nobody re‑ran), B2 (W6's handles + W5's DSL splice, never applied together), B4 (W4g's indentation escape hatch), B9 and B10 (W6's rotated frame and canonical direction). That is the expected failure shape of the process, and the fix is the missing test tier (§5.2), not a different process.
- **B6 is where the design doc and the code diverge.** `gaps-design.md` §1.3.3 planned to *dissolve* sub‑threshold slivers and report them; what shipped reports only enclosed faces under 100 mm² and leaves boundary‑open slips to the street flood fill and overlaps to `tiling.overlap`. The prior review's own G2 item 4 ("dissolve faces below a threshold area into a neighbour and report them") is closer to what an agent needs than what landed.
- **The action plan already lists two of my items as deferred**: DSL `remove`/`append`/`insert` (my §2.2‑6, §7‑9) and `stair.no_landing`. It does not list B8; `structure.over_open_sky` was specified in the prior review's H3 table as "over cells that are outdoor/exterior on the level below", which would have excluded covered outdoor had `covered` been read — it was not.
- **The evals never exercised angled authoring.** All 20 briefs in `authoring-eval.md` and the cold runs are rectilinear (one `poly` room), so the 0/40 schema result says nothing about the B6 class, which is a *geometry* failure the eval explicitly does not count. The eval that would change my mind on frames (§3.4) is: five angled briefs, cold, DSL, counting `tiling.overlap`/`wall.unresolved` on the first attempt.
- **One number to put beside the prior review's**: it measured `--json` at 1 263 tokens and the SVG at 8 728; today `--json` is 174 and the SVG 9 454 — the read‑back problem is solved for findings and unchanged for drawings, which is why §4.1‑5 (adjacency/ASCII views) is on my list and was not on theirs.
