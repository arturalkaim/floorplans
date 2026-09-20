# Closing the two gaps: non-rectilinear plans, and multiple levels

A design document, not a plan of work. It answers two questions the library currently
answers by refusing: *what if the walls are not axis-aligned* and *what if there is more
than one storey*. Both are gaps, not decisions. Effort appears only where it changes the
**order** of work, never as a reason to prefer a smaller design.

**Relationship to `docs/agent-review.md`.** That review's §G and §H are a first draft of
this. Where its evidence holds I cite it and move on. Where I would decide differently I
say so under a **Dissent** heading, with the experiment that made me change my mind. The
substantive dissents are listed in §0.3; the largest are that **a general boolean-operation
library is not needed** (§1.3.2), that **pole-of-inaccessibility does not reproduce today's
`minDimension`** (§1.3.5, measured), that **`shared.cores` and footprint matching are the
wrong model for vertical circulation** (§2.2.3), and that **levels are not blocked by the
geometry core and should land first** (§3.1).

**Method.** Every claim below is either a `file:line` citation or the output of a script in
`scratch/` (not committed; §A lists them and how to re-run). Baseline on this worktree,
branch `worktree-agent-ac41dba20e5268d9f` at `2ebc3f0`: `npm ci && npm run check` →
**175 tests, 0 failures** (the review says 179; `npm run check` reports 175 on this commit —
`# tests 175 # suites 46 # pass 175`. Minor, but the count in prose is wrong in both
documents, which is E2's point). Token counts are `o200k_base` via `gpt-tokenizer`
installed outside the repo; my count for `fixtures/casa-t3.json` is **2 322**, identical to
the review's, so the two documents' numbers are comparable.

---

## 0. Summary

### 0.1 The shape of the answer

**Geometry.** One primitive: a **planar arrangement of edges with face owners**, built from
integer-millimetre coordinates, with straight segments and true circular arcs. It replaces
`derive.ts:39-159` and subsumes the current grid exactly — for an all-axis-aligned plan the
arrangement introduces *no constructed coordinates at all* (§1.3.1), so there is nothing to
keep a "fast exact rectilinear path" for. Boolean operations (union, intersection,
difference) are not a separate library: they are the same arrangement with a different face
predicate (§1.3.2). Exactness policy: integers in, exact degree-2 predicates, **snap-rounding
with hot pixels** for constructed intersection points, arcs kept exact for area and
rendering and flattened *deterministically* for topology (§1.3.3).

**Levels.** A `Plan` grows `stack: string[]` (ground-up order), `levels: Record<id, Level>`
and `vertical: Vertical[]`. Levels are **not** an array (§2.2.1: an array renumbers every
cached path the first time someone adds a basement). Vertical circulation is a **first-class
top-level entity with an explicit id and one footprint per level it serves**, not a fixture
matched to its counterpart by footprint overlap (§2.2.3). A `void` on a level is the exact
dual of an `outdoor` space: a declared hole that legalises what would otherwise be
`tiling.gap`, and it gives double-height spaces and stairwells for free (§2.2.4).

**Sequencing.** The two gaps are **independent**. Levels first (§3.1).

### 0.2 Where I agree with the review, and why the evidence holds

| §G/§H claim | Verdict | Why |
|---|---|---|
| The arrangement-with-owners idea is right and should be generalised, not patched | **Agree** | The grid *is* a planar arrangement restricted to axis-parallel lines; every downstream consumer reads owners and walls, not cells (`derive.ts:120-131, 247-290`) |
| `WallSegment { axis, c, from, to }` cannot represent a sloped or curved wall — new data model | **Agree** | `types.ts:110-122`; 21 `axis` references in `derive.ts`, 35 in `edit.ts`, 12 in `svg.ts` (counted, §1.1) |
| Flatten arcs for topology, keep them exact for area and rendering | **Agree**, with a determinism requirement the review omits | §1.3.3: two neighbours flattening the same arc half a step out of phase produce **61 sliver faces totalling 277 cm²** on an R = 3 m semicircle (measured) |
| `at: [x, y]` becomes the primary opening selector; `on.side` degrades to rectilinear sugar | **Agree** | `derive.ts:484-487` `sideOf` is defined only for `axis === "h" \| "v"`; `distToWall` (`:497`) already generalises |
| Grid ASCII (`layout`) stays as rectilinear sugar and must not be grown | **Agree** | `parse.ts:362-435` compiles tracks to polygons; it is an *input* sugar and never reaches `derive` |
| Levels are an additive wrapper with a cross-level pass, and `derive` runs per level | **Agree** | `derive(plan)` already takes everything it needs from one `Plan` (`derive.ts:35-37`) |
| `stairs` is a word in a vocabulary with no behaviour | **Agree, with a correction** | Only `parse.ts:43` and `types.ts:54` mention it — but a `stairs` fixture is *not* inert: it marks cells occupied (`derive.ts:220-227`), so it shrinks `largestRect`, `minDimension` and `usableArea`, and it participates in `fixture.clearance` and `door.swing_hits_fixture` (`rules.ts:228-273`). It behaves as an obstacle, which is right; it just has no vertical meaning |
| Findings must carry `path`, and its shape must be settled with levels in mind | **Agree** — and it is safe to do now (§3.2) | `edit.ts` already constructs document paths at 14 sites; `Finding` has none (`types.ts:178-186`) |

### 0.3 Dissents

| # | The review says | I say | Evidence |
|---|---|---|---|
| D1 | Integer millimetres "remove the floating-point class of bugs for straight edges" | Integer mm are right, for a different and stronger reason — the code *already* simulates them in doubles with four tolerance constants — but they do **not** make the arrangement consistent, because constructed intersections are not integral. Snap-rounding with hot pixels is the missing mechanism | §1.3.3; `scratch/floats.mjs`, `scratch/robustness.mjs` |
| D2 | Build a Martínez–Rueda boolean sweep (~800 lines) after the arrangement, for outlines, stacking and DXF | Do not build one. Union/intersection/difference are the *same* arrangement with a different face predicate. The sweep is ~800 lines of duplicated robustness risk for capability you already have | §1.3.2 |
| D3 | `minDimension = 2·inradius`, "which equals the short side for a rectangle, so today's numbers are preserved" | False as stated. On the 7 fixtures, **45 of 46 rooms** change, because `minDimension` is measured at the wall *faces* and the inradius is not; and even on the centreline **9 of 46** differ because `largestRect` excludes overlapped and fixture-occupied cells. Keep both measures, with different names and different jobs | §1.3.5; `scratch/polylabel.mjs`, `scratch/mindim-flip.mjs` |
| D4 | `clearArea`'s corner term is a "mechanical" generalisation | It needs a different algorithm. Today's `±t₁t₂/4` is exact only for right angles: on an isoceles triangle it is **−0.63 % at a 90° apex, −4.2 % at 20°, −28 % at 10°**. The fix is not a better closed form; it is to *construct* the mitred offset polygon and take its shoelace | §1.3.4; `scratch/clear-area.mjs`, `scratch/angle-sweep.mjs` |
| D5 | `"levels": [ … ]` (array) at §H2 — while §C calls it "a `levels` map" and §B2 writes paths as `levels.first.rooms.suite` | The review says three things in three places; the map is right. An array renumbers every path when a basement is inserted, which is the single most likely structural edit | §2.2.1 |
| D6 | `shared.layout` + `shared.cores`, stamped into every level that uses them | `shared` saves **74 tokens (8 %)** on a realistic two-storey house — too little to justify a second resolution mechanism. Keep the shared *grid* (it is about alignment, not tokens); replace `shared.cores` with a first-class `vertical[]` | §2.2.2–2.2.3; `scratch/count.mjs` |
| D7 | Stairs are matched to their counterpart on the target level "by plan-view footprint overlap — the agent never has to cross-reference by hand" | The building's most important topological edge must not depend on a geometric coincidence. An explicit id costs ~4 tokens and turns "misaligned" from a silent failure into a rule that can fire | §2.2.3 |
| D8 | The geometry core comes first "because §H's cross-level checks and D3 need its predicates" | Cross-level footprint tests are exactly what `polysOverlap`/`polyInside` (`geometry.ts:77-84`) already do exactly for rectilinear plans. Levels are independent, they are what freezes the contract surfaces Wave 3 is about to build, and they are far less risky. Levels first | §3.1 |
| D9 | Keep a fast exact rectilinear path? (open question in §G4) | No — but for a reason the review does not give: an arrangement of axis-parallel edges has **zero** constructed coordinates, so the general algorithm is *bit-for-bit as exact* on today's plans. There is nothing to preserve | §1.4 |

---

# Part 1 — Non-rectilinear plans

## 1.1 Inventory: where axis alignment is load-bearing

Classification: **M** = mechanical edit (same idea, different arithmetic), **A** = needs a
different algorithm, **D** = needs a different data model.

Vocabulary census (`grep -c` per file, this worktree):

| file | `axis` | `"h"`/`"v"` | compass | `bbox`/`x0` |
|---|---:|---:|---:|---:|
| `src/derive.ts` | 21 | 18 | 16 | 17 |
| `src/edit.ts` | 35 | 6 | 7 | 10 |
| `src/svg.ts` | 12 | 11 | 7 | 18 |
| `src/geometry.ts` | 3 | 0 | 0 | 26 |
| `src/types.ts` | 3 | 1 | 4 | 5 |
| `src/parse.ts` | 1 | 0 | 8 | 0 |
| `src/rules.ts` | 0 | 0 | 1 | 10 |
| `src/doors.ts` | 2 | 2 | 0 | 4 |
| `app/src/components/Drawing.tsx` | 3 | 3 | 0 | 0 |

Site by site:

| # | Site | `file:line` | Assumption | Class |
|---|---|---|---|---|
| 1 | `normalizePoly` | `geometry.ts:101-105` | every edge has `eq(a[0],b[0])` or `eq(a[1],b[1])`; rejects anything else. Verified: `node src/cli.ts scratch/angled.json --lint` → `Invalid plan:\n  rooms.sala.poly: edge [6,4]→[3,6] is not axis-aligned`, exit 2 | **A** |
| 2 | `selfIntersection` / `segmentsTouch` | `geometry.ts:123-144` | tests **bbox overlap** and calls it segment intersection. Correct only for axis-aligned segments; for sloped ones it is a gross over-approximation that would reject valid polygons | **A** |
| 3 | Arrangement grid | `derive.ts:39-59` | `xset`/`yset` of every distinct x and y; a cell's owner is decided by probing its centre. Only exact when every edge lies on a grid line | **D** (the grid *is* the model) |
| 4 | Border flood fill | `derive.ts:60-70` | 4-neighbour flood over the cell lattice | **A** (faces + dual graph) |
| 5 | Courtyard marking | `derive.ts:76-85` | per-cell `pointInPoly` against each outdoor poly | **M** once faces exist (probe one interior point per face) |
| 6 | `owner(i, j)` | `derive.ts:86-91` | owner is a function of cell indices; `Owner = string \| "exterior" \| "gap"` (`types.ts:108`) — a string union so leaky that `parse.ts:115` has to *reserve* the ids `exterior` and `gap` | **D** |
| 7 | `tiling.gap` / `tiling.overlap` | `derive.ts:94-114` | one finding per cell (this is A5) | **A**, and it disappears: one finding per face |
| 8 | Wall extraction | `derive.ts:116-131` | walls are the boundaries between horizontally/vertically adjacent cells; `neg` is fixed to mean north/west | **A** |
| 9 | Wall merging | `derive.ts:134-153` | groups on the key `` `${axis}|${c}|${neg}|${pos}` `` and merges when `eq(cur.to, p.from)` | **M** on a general chain (group on owner pair, join on shared vertex, merge when collinear *or* co-circular) |
| 10 | `WallSegment` | `types.ts:110-122` | `{ axis, c, from, to }`. Cannot express a sloped or curved wall, and its `neg`/`pos` are compass-defined | **D** |
| 11 | `clearArea` | `derive.ts:376-407` | `A − Σ len·t/2 + Σ ±t₁t₂/4`; the corner term assumes 90° | **A** (§1.3.4 — measured error up to −28 %) |
| 12 | `thicknessAt` | `derive.ts:401-407` | derives the edge's axis from `eq(a[1],b[1])` | **M** (carry the thickness on the edge instead of re-deriving it) |
| 13 | `halfWallAlong` | `derive.ts:235-244` | matches walls by `axis` and `c` | **M** (match by the edge the offset is taken from) |
| 14 | `largestRect` | `geometry.ts:221-250`, called at `derive.ts:249-253` | largest **axis-aligned** rectangle of fully-owned unoccupied cells | **A** (§1.3.5) |
| 15 | `clearRect` / `minDimension` / `labelAt` | `derive.ts:254-284` | all three derived from `largestRect`; `labelAt` is its centre | **A** |
| 16 | `exteriorFaces` | `derive.ts:268-275` | a set of four compass names, from `wall.axis` and which side the room is on | **M** (wall ids, or bearings) |
| 17 | `polysOverlap` / `polyInside` | `geometry.ts:66-84` | cell decomposition over the union of both polygons' x and y values; exact for rectilinear only | **A** (face classification) |
| 18 | `boxGap` | `geometry.ts:87-91`, used by `fixture.clearance` at `rules.ts:233` | distance between two **axis-aligned boxes** — already wrong for any L-shaped fixture today | **A** (polygon–polygon distance) |
| 19 | `cellsToPolygons` | `geometry.ts:151-219` | builds an outline from a set of grid cells | **M** — retained for `layout` compilation only (§1.4) |
| 20 | Opening placement | `derive.ts:440-448` | a 1-D parameter along `[wall.from, wall.to]` | **already general** — becomes arc length |
| 21 | `sideOf` / `pointOn` / `describe` / `distToWall` | `derive.ts:484-502` | all four branch on `axis === "h"` | **M** (`pointOn`, `distToWall`) / **A** (`sideOf`, `describe` — they have no meaning on a sloped wall) |
| 22 | Door swing | `doors.ts:24-26` | `along` and `normal` are picked from the axis by table | **M** (unit tangent at the hinge, and its perpendicular) |
| 23 | Swing collision, swing-hits-fixture | `rules.ts:212-262` | rectangle–rectangle overlap, then a nearest-point test on the overlap box | **A** (sector ∩ polygon) |
| 24 | Fixture geometry | `parse.ts:305-328` | `at`/`size` is an axis-aligned rectangle; `poly` goes through `normalizePoly` | **M** (accept the same edge list as rooms; add `rotate`) |
| 25 | Wall rendering | `svg.ts:161-185` | each run is a `<line>` with `stroke-width = t` and each true end extended by `t/2` — a trick that closes **only right-angled** corners | **A** (one `<path>` per chain, `stroke-linejoin="miter"`) |
| 26 | Window glazing | `svg.ts:194-198` | two lines offset by `±t/4` along the axis | **M** (offset along the edge normal) |
| 27 | Entrance tag placement | `svg.ts:209-213` | outward direction from the axis; rotates text by −90° for vertical walls | **M** (bearing) |
| 28 | Label-fits test | `svg.ts:221-225` | compares the room name's pixel width against `largestRect`'s width | **A** — it *needs* a rectangle, which is why §1.3.5 keeps one |
| 29 | Finding-marker anchoring | `svg.ts:289` | finds the room whose `labelAt` is **exactly equal** to `f.at` | **M**, but fragile: it will silently stop matching the moment `labelAt` moves |
| 30 | `projection` / dimensions | `svg.ts:48-70, 239-251` | bounding box of all points | **unchanged** |
| 31 | Grid drag | `edit.ts:53-123` | a wall is one coordinate on one axis; a drag resizes two tracks and carries anchored vertices | **D** for poly walls; **unchanged** for grid walls (§1.4) |
| 32 | Poly drag | `edit.ts:131-178` | rewrites `poly[v][axis]`, one coordinate; refuses when a vertex on the line lies outside the wall's run | **D** |
| 33 | Outdoor edge drag | `edit.ts:205-250` | `axis = near(p0[0],p1[0]) ? 0 : near(p0[1],p1[1]) ? 1 : -1` — a non-axis edge is skipped outright (`:223`) | **D** |
| 34 | Fixture edge drag | `edit.ts:296-312` | moves one side by matching `p[axis] === from` | **D** |
| 35 | Pointer plumbing | `Drawing.tsx:77`, `:95` | cursor from `d.axis`; `along(d, m) = d.axis === "v" ? m[0] : m[1]` — the drag is fundamentally 1-D along a global axis | **M** (a dot product with the handle's normal) |
| 36 | `layout` grid | `parse.ts:362-435` | inherently rectilinear | **unchanged, by design** |

Summary: 3 sites need a new **data model** (`Owner`, `WallSegment`, the drag handle), 13
need a **different algorithm**, 13 are **mechanical**, 3 are unchanged, 1 is already general.

## 1.2 Target scope and authoring syntax

Two capabilities, in this order.

**Angled walls** — arbitrary simple polygons. Authoring is unchanged except that
`normalizePoly` stops rejecting them: `"poly": [[0,0],[6,0],[6,4],[3,6],[0,4]]` becomes
legal. `rect` (B6) stays and remains the common case: measured, one room as
`"rect": [5,2,6,3]` is **35 tokens** against **96** for the same room with two arcs and
**62** as four explicit points.

**Curved walls** — true circular arcs. The owner's "-0-" (two wings joined by a round
middle) is the motivating case. A `poly` element becomes *either* a point *or* an arc to
the next point:

```jsonc
"poly": [[5,2], [5,5], { "arc": [11,5], "r": 3.5, "sweep": "ccw" }, [11,2],
         { "arc": [5,2], "r": 3.5, "sweep": "ccw" }]
```

`{ "arc": [x,y], "r": r, "sweep": "cw"|"ccw" }` means *an arc from the previous vertex to
`[x,y]`, of radius `r`, turning that way*. Three arguments, each of which an agent can
compute or copy; contrast SVG's seven-argument `A` command, which the review rightly calls
a dead end (`agent-review.md:300`, 65 tokens and opaque to `jsonpos`).

`"large": true` is needed for the reflex case (an arc subtending more than 180°) and should
be accepted from day one rather than bolted on, because omitting it silently picks the minor
arc. Centre and radius are **not** both stored: `r` + endpoints + `sweep` + `large` is the
minimal non-redundant description, and it is the one a `spliceAt` can edit one value at a
time.

Measured (`scratch/count.mjs`, o200k):

| the same round-ended room | tokens |
|---|---:|
| as a rectangle (`rect`) | 35 |
| with two inline arc objects | 96 |
| hand-flattened to 20 points (what an agent must do today if arcs never arrive) | 169 |
| line-DSL form `poly 5,2 5,5 arc 11,5 r3.5 ccw 11,2 arc 5,2 r3.5 ccw` | 43 |

First-class arcs are therefore **43 % cheaper than hand-flattening** *and* accurate; the
hand-flattened version is not even 1 mm-correct. Note that today an agent cannot express a
curve at all — `normalizePoly` rejects the flattened version too, because its chords are not
axis-aligned.

**What a future line DSL needs.** The grammar must contain `arc` from the start, since
retro-fitting it changes the `poly` production:

```
room rotunda "Rotunda" living poly 5,2 5,5 arc 11,5 r3.5 ccw 11,2 arc 5,2 r3.5 ccw
```

and an opening on a curved or sloped wall needs the absolute selector, so `at x,y` must be
in the grammar beside `on:room.side`:

```
door exterior>rotunda at 8,8.5 w1.2 entrance
```

This is the same conclusion as the review's §C recommendation 2; I am agreeing, and noting
that `large` needs a token too (`arc 11,5 r3.5 ccw large`).

## 1.3 Algorithm design

### 1.3.1 The core: one planar arrangement, one owner per face

Replace `derive.ts:39-159` with:

1. **Edge list.** Every room, outdoor space, void and fixture contributes its boundary edges,
   each tagged with the space it came from and which side is interior.
2. **Flatten arcs for topology only** (§1.3.3); the exact `Arc` record travels alongside.
3. **Intersect pairwise, split, snap-round** (§1.3.3). casa-t3 has 60 edges over 14 spaces
   (measured); 100 rooms is ≈600 edges, 180 k pairs — trivial. Bentley–Ottmann is not needed
   and I agree with the review that it should not be written.
4. **Build a half-edge (DCEL) structure.** Sort the outgoing half-edges at each vertex by
   bearing; walk `next` pointers to enumerate faces; the face with negative signed area is
   the outer face.
5. **Own each face.** Probe one interior point per face and collect containing spaces. This
   is the same trick as today's cell centres (`derive.ts:55-57`), applied to faces. The safe
   probe is *not* "a boundary midpoint nudged inward by 0.5 mm" as the review suggests —
   on a face 0.3 mm wide that lands outside. Use the pole of inaccessibility of the face
   (§1.3.5 gives the routine anyway), which is by construction the point furthest from every
   boundary.
6. **Owner classes.** A tagged union, replacing the leaky string union at `types.ts:108`:

```ts
export type Owner =
  | { kind: "room";     id: string }
  | { kind: "outdoor";  id: string }   // A2: a courtyard is not the street
  | { kind: "void";     id: string }   // §2.2.4: a declared hole in this level's slab
  | { kind: "exterior" }
  | { kind: "gap" }
  | { kind: "overlap";  ids: string[] };
```

`tiling.gap` becomes one finding per `gap` face and `tiling.overlap` one per `overlap`
face — A5 is not "merged", it ceases to exist. `parse.ts:115` can stop reserving ids.

7. **Walls.** Every half-edge whose face owner differs from its twin's, grouped by the
   unordered owner pair, chained through shared vertices, and merged where consecutive edges
   are collinear or co-circular. Openings keep their 1-D parameterisation, now arc length.

Everything downstream — opening resolution, the access graph, the rules, the schedule —
reads owners and walls exactly as it does today.

**A migration hazard the review does not mention.** Today `neg` means *north or west* and
`pos` means *south or east* (`types.ts:117-118`, produced at `derive.ts:122,129`). On a
directed half-edge the natural meaning is *left* and *right*, and for an axis-aligned edge
which of those is north depends on the edge's direction. `sideOf` (`derive.ts:484-487`),
door swing (`doors.ts:26`), window glazing (`svg.ts:194-198`) and the entrance tag
(`svg.ts:209`) all read `neg`/`pos`. To keep today's outputs byte-identical the wall's
canonical direction must be fixed so that left = north for a horizontal wall and left = west
for a vertical one — i.e. orient each wall so its start is the lexicographically smaller
endpoint, which reproduces `derive.ts:122,129` exactly. Pin this with a test over all seven
fixtures before touching anything else.

### 1.3.2 Boolean operations — Dissent D2: do not build a separate clipper

The review recommends a Martínez–Rueda sweep (~800 lines) for wall outlines, exact fixture
intersections, the stacking checks and DXF, and offers Greiner–Hormann and Vatti as
alternatives (`agent-review.md:433-440`).

**Do not build one.** Every consumer it lists is a face-classification query on an
arrangement you have already built:

| wanted | arrangement query |
|---|---|
| union of A and B | faces covered by ≥ 1 input |
| intersection | faces covered by ≥ 2 |
| difference A − B | faces covered by A and not by B |
| area of the overlap of two fixtures (D3) | Σ area of faces owned by both |
| a room's footprint over the level below (§2.3) | arrange both levels' edges together, classify |
| the union outline of all buffered wall chains | arrange the offset edges, keep faces whose cover count ≥ 1, trace their outer rings |

This is the standard *overlay* formulation of boolean operations, and it is how a planar
arrangement library exposes them. Choosing a clipper instead means writing, testing and
debugging a **second** sweep with its own degeneracy handling for exactly the cases that
break clippers — shared vertices and collinear overlapping edges, which is what wall
junctions *are*. The review says this itself about Greiner–Hormann (`:436-437`) and then
recommends a different sweep rather than noticing that the objection applies to the whole
category.

Cost of the dissent: one function, roughly

```ts
function overlay(inputs: Array<{ tag: string; rings: Ring[] }>): Arrangement;
function facesWhere(a: Arrangement, p: (tags: Set<string>) => boolean): Ring[];
```

plus ring-tracing back out of the DCEL (which the face walk already does). Perhaps 120 lines
on top of the arrangement, against ~800 for a sweep, and — the real argument — **one**
robustness story instead of two.

The one case where a dedicated clipper would win is very large inputs, where an O(n log n)
sweep beats pairwise intersection. At house scale (60 edges for casa-t3; 0.72 ms for the
whole pipeline today) that is irrelevant, and the review's own "would not do: performance
work of any kind" applies.

**DXF.** Does not need booleans either; it needs the offset arrangement's face rings, which
the above produces. Parked, as the spec already parks it.

### 1.3.3 Exactness — Dissent D1: integers, yes; but they are not the whole story

**Where I agree, with a better reason.** Store coordinates as **integer millimetres**. The
review's reason ("removes the floating-point class of bugs") is not the strong one. The
strong one is that *the code already does integer-millimetre arithmetic, badly simulated in
doubles*:

- `snap()` rounds to mm and returns a **double** (`geometry.ts:4`), and is called **33 times
  in `derive.ts` alone**, once after nearly every arithmetic operation;
- and even so, residue accumulates — measured, `scratch/floats.mjs`:
  `[0.1,0.2,0.3,0.4,1.1,2.2]` summed unsnapped gives `4.3000000000000007105`, and the
  snapped running sum `4.3`; `4.8 + 3.0` gives `7.7999999999999998224`;
- so equality needs a tolerance, and there are **six different ones for one concept**:
  `eq()` at 1e-6 (`geometry.ts:6`), `near()` at 1e-6 (`edit.ts:31`), `MM` at 1e-3
  (`derive.ts:18`), `segmentsTouch` at 1e-9 (`geometry.ts:143`), `snap()` at 1e-3
  (`geometry.ts:4`), `snapMm()` at 1e-3 (`edit.ts:14`).

With integer millimetres all six collapse to `===`, `snap()` moves to the parser boundary
and never appears again, and `parse()` becomes lossless (`4.95 m` → `4950`, not `4.95` as
the nearest double).

**Where I dissent.** The review writes:

> Coordinates snapped to 1 mm and held as integers in millimetres; with plans under 100 m,
> cross products fit in 2⁵³ exactly, so orientation and segment–segment intersection
> predicates are **exact** without BigInt. (`agent-review.md:391-393`)

Two problems.

*First, the range claim is true only for degree-2 predicates.* Measured
(`scratch/robustness.mjs`): at a 100 m span, `|cross| ≤ 4.0 × 10¹⁰` against 2⁵³ ≈ 9.0 × 10¹⁵
— 2.3 × 10⁵ headroom, so orientation and "do these two segments cross" are exact. But a
degree-4 predicate — e.g. deciding whether the intersection of edges A and B lies on edge C
*without constructing it* — reaches (2 × 10⁵)⁴, which **overflows 2⁵³**. Such predicates are
exactly what a careful arrangement wants. State the qualifier, or plan to lower the working
span (a 20 m plan leaves degree-4 at 3.2 × 10¹³, comfortably exact).

*Second, and more important: exact predicates on integers do not give you a consistent
arrangement,* because the *constructed* intersection points are not integers. Measured, same
script: a near-horizontal edge from (0, 0) to (12000, 7) mm crossing the line x = 5000 meets
it at y = 2.916667 mm; snapping to the mm grid moves it 0.083 mm to y = 3. A vertex that sat
at (5000, 3) — strictly on one side of the original edge — is now **exactly collinear with
the snapped sub-edge**. That is a new incidence created by rounding, and it is not
hypothetical: the seven fixtures already contain **70 T-junctions** (a vertex of one space
lying strictly inside another's edge) over 250 vertices, concentrated in casa-t3 (23) and
broken (13). Every one of them is a place where a snapped intersection can create or destroy
an incidence.

The review's remedy — "snap the new vertices, then re-check for new coincidences"
(`:419-420`) — is snap-rounding without its guarantee: re-checking can create further
coincidences, and nothing bounds the iteration.

**Recommendation.** Use **snap-rounding with hot pixels** (Greene/Hobby; Goodrich–Guibas–
Hershberger–Tanenbaum for the batched form):

1. Every input vertex and every computed intersection point claims the 1 mm pixel containing
   it — a *hot pixel*.
2. Every edge that passes through a hot pixel is bent to pass through that pixel's centre.
3. The output is by construction a valid planar subdivision on the mm grid: no edge crosses
   another except at a shared vertex, and no vertex lies in an edge's interior.

Cost: one extra pass and a spatial index of hot pixels (a `Map` keyed by `${x},${y}` at
house scale). Guarantee: termination, and a topologically valid result. The displacement is
bounded by half a pixel — 0.5 mm, an order of magnitude below anything the rules measure
(`CORNER_SLIVER` is 0.1 m, `derive.ts:19`).

**Slivers.** Snap-rounding can still collapse a very thin face to zero area or leave one a
few square millimetres in size. Two of the seven fixtures already have sub-decimetre tracks
— `casa-piscina` has a **0.05 m** minimum track and `broken` 0.1 m — so slivers are not a
hypothetical of the new design; they are in the corpus. Policy: after face construction,
dissolve any face whose area is below 100 mm² into the neighbour with which it shares the
longest boundary, and *report it*: a new `geometry.sliver` info finding naming the two
spaces. Silently dissolving is how a 3 mm authoring slip becomes an invisible wrong area.

**Duplicate and partially-overlapping edges.** Two rooms sharing a wall each contribute the
same edge in opposite directions. Measured across the fixtures: casa-t3 has **10 exactly
shared edges and 17 partially overlapping ones**; apartment-t2 5/8; broken 0/10. Partial
overlap is the common case — a long room abutting two short ones — and it must be handled by
splitting at the overlap endpoints during the arrangement, not by a dedupe pass. Exact
duplicates are removed by vertex identity after snapping, which integer coordinates make a
`===` test.

**Arcs: flatten, but deterministically.** I agree with the review that an exact
circle–circle/circle–line arrangement (algebraic numbers) buys nothing at 1 mm. But
flattening has a requirement the review omits. Measured (`scratch/robustness.mjs`): at a 1 mm
sagitta an R = 3 m semicircle needs **61 chords** (2.96° each); R = 0.6 m needs 28, R = 6 m
needs 87. If two neighbouring spaces flatten *the same* shared arc half a step out of phase,
the result is **61 sliver faces totalling 277 cm²**, the largest 4.6 cm² — far above the
100 mm² dissolve threshold, so they would all survive as spurious gap faces and produce 61
findings.

The fix is a canonical flattening function with no free parameters:

```ts
/** Chord points for an arc, identical for both spaces that share it. */
function flattenArc(arc: Arc): Pt[] {
  // canonical orientation: always subdivide from the lexicographically smaller endpoint
  // toward the larger, so a neighbour authoring the same arc the other way round gets the
  // identical point list.
  // canonical step: n = ceil(sweepAngle / (2 * acos(1 - SAGITTA_MM / r))), from the
  // integer-mm radius only — never from a float tolerance the caller may vary.
}
```

Then the two spaces' chords coincide exactly and no sliver arises. This is an invariant
worth a comment and a test: *the same arc, authored in either direction by either neighbour,
flattens to the same point list*.

**Summary of the exactness policy.** Integer millimetres in the model; degree-2 predicates
exact in doubles (with the span caveat); snap-rounding with hot pixels for constructed
points; arcs exact in an `Arc` record for area, offsetting and rendering, flattened by a
canonical parameter-free function for topology; slivers dissolved above a declared threshold
and reported.

### 1.3.4 Clear area under mitred corners — Dissent D4

The review classes this "mechanical for straight corners (`t₁t₂/4 · cot(θ/2)`-type term)"
(`agent-review.md:373`). It is not mechanical, and no closed form is worth chasing.

Measured (`scratch/angle-sweep.mjs`): an isoceles triangle with 5 m arms, all edges offset
inward by 0.15 m, today's formula against the true mitred offset polygon's area:

| apex angle | true clear m² | `A − Σ len·t/2 + Σ ±t₁t₂/4` | error | error % |
|---:|---:|---:|---:|---:|
| 150° | 3.6489 | 3.3686 | −0.2803 | −7.7 % |
| 120° | 8.2072 | 8.0938 | −0.1134 | −1.4 % |
| 90° | 10.0705 | 10.0068 | −0.0636 | −0.6 % |
| 60° | 8.6922 | 8.6428 | −0.0494 | −0.6 % |
| 45° | 6.8865 | 6.8323 | −0.0542 | −0.8 % |
| 20° | 2.6960 | 2.5823 | −0.1137 | −4.2 % |
| 10° | 0.8462 | 0.6074 | −0.2388 | **−28.2 %** |

(The 90° row is a *right* triangle — its other two corners are 45° — which is why it is not
exact. On genuinely rectilinear shapes the formula is exact to 1.8 × 10⁻¹⁵: verified on a
4 × 4 square, a 6 × 3 rectangle with mixed thicknesses, and an L-shape with a reflex corner,
`scratch/clear-area.mjs`.)

I also tested the natural generalisation the review gestures at — replacing `d₁d₂` with
`d₁d₂ / sin θ` — and it is **worse**: on a 45°-cut pentagon it errs by +0.039 m² against
today's +0.028 m². A correct closed form exists but has to account for the offset edges'
*changed lengths* as well as the corner wedges, and it fails entirely once an edge is shorter
than the offsets meeting on it.

**Recommendation: stop computing a formula; construct the polygon.**

```ts
/** Inward offset of a ring with a per-edge distance, mitred at the corners. */
function offsetRing(ring: Edge[], dist: (e: Edge) => Mm): Edge[];
```

`clearArea` becomes `area(offsetRing(room.ring, halfThicknessOfWallOn))`. This:

- reproduces today's numbers **exactly** on every rectilinear room (verified to 1e-15,
  including the reflex L-shape case);
- is correct at any angle;
- for an arc, offsets to the same arc with the radius reduced (convex) or increased (concave)
  by t/2 — a one-line case, and its area is still exact;
- is the *same function* that gives the clear polygon for `minDimension` (§1.3.5), the wall
  outlines (§1.3.2) and, eventually, DXF. One offsetter, four consumers.

**The degenerate case, which today's code already half-handles.** When an edge is shorter
than the offsets meeting on it, the mitred ring self-intersects. Measured: a 6 × 0.2 m slot
offset inward by 0.15 m produces the ring `[0.15,0.15] [5.85,0.15] [5.85,0.05] [0.15,0.05]`
— **orientation inverted**, signed area −0.57. Today the closed form produces −0.57 and
`Math.max(0, …)` at `derive.ts:397` clamps it to 0. That clamp is doing real work and is not
documented as such. The constructed version must do the equivalent explicitly: detect edges
whose offset ring reverses direction, collapse them, and if the whole ring inverts, report
zero — and emit a finding, because a room whose clear area is zero is a room the author
should hear about. Candidate: `room.no_clear_floor` (error).

### 1.3.5 `largestRect`, `minDimension` and the label — Dissent D3

The review proposes replacing `largestRect` with "pole of inaccessibility on the room polygon
minus fixture polygons; `minDimension = 2·inradius`, which equals the short side for a
rectangle, **so today's numbers are preserved**" (`agent-review.md:374`).

I implemented a polylabel-style pole-of-inaccessibility search at 0.5 mm precision and ran it
against every room in every fixture (`scratch/polylabel.mjs`, `scratch/mindim-flip.mjs`).
Today's numbers are **not** preserved.

**Finding 1 — the wall faces.** `minDimension` is the short side of `clearRect`, which is
`largestRect` brought in by half the thickness of the wall on each side (`derive.ts:254-265`).
The inradius of the centreline polygon is not. On the fixtures **45 of 46 rooms** differ, by
exactly the two half-thicknesses involved — casa-t3 `suite` 4.19 vs 4.4 (Δ 0.21 = 0.15 +
0.06); `quarto1` 3.48 vs 3.6 (Δ 0.12 = 0.06 + 0.06). Fixable by taking the inradius of the
*offset* polygon from §1.3.4 rather than the centreline one — but the review's claim as
written is wrong, and the fix is precisely the offsetter it classes as "mechanical".

**Finding 2 — the semantics differ even on the centreline.** `largestRect` counts only cells
that the room owns *alone* and that no fixture occupies (`derive.ts:250`). The inradius of the
raw polygon ignores both. On the fixtures, **9 of 46 rooms** disagree:

| plan / room | corners | short side of `largestRect` | 2 × inradius (centreline) | why |
|---|---:|---:|---:|---|
| broken / kitchen | 4 | 1.0 | 2.0 | overlapping rooms — those cells are excluded today |
| broken / store | 4 | 1.0 | 2.0 | same |
| casa-piscina / spa | 4 | 1.8 | 4.8 | a 3.2 × 7.4 m indoor pool occupies the middle |
| casa-piscina / cozinha | 4 | 2.75 | 3.6 | counter + island |
| casa-piscina / wc | 4 | 2.25 | 3.0 | bath, WC, basin |
| apartment-t2 / sala | 6 | 3.2 | 3.87 | L-shape |
| apartment-t2 / quarto2 | 6 | 3.2 | 3.361 | L-shape |
| casa-patio / sala | 6 | 3.6 | 4.104 | L-shape |
| casa-t3 / cozinha | 6 | 3.0 | 3.514 | L-shape |

Subtracting the fixtures as holes repairs the fixture rows exactly (spa: 2r on free space =
1.8, matching `largestRect`). The **overlap** rows and the **L-shape** rows do not repair:
they are genuine semantic differences.

**Finding 3 — the verdicts happen not to flip, but only just.** With a conservative uniform
inset by the largest bounding half-thickness, `room.min_dimension` fires on the same 6 rooms
before and after; **0 verdicts flip** over 46 rooms. But **30 of 46 printed numbers change**,
and one is a near miss: `broken / kitchen` moves from 0.94 m to 1.70 m against a 1.8 m
threshold. A slightly different plan flips silently.

**Finding 4 — the rule's own wording is already wrong.** Neither measure is a minimum.
`largestRect`'s short side is the short side of the *largest furnishable rectangle*; the
inradius is the radius of the *largest circle that fits*. Both are max-type quantities. The
message says "2.79 m at its narrowest" (`rules.ts:171`), which is neither.

**Finding 5 — a rectangle is load-bearing elsewhere.** `svg.ts:221-225` decides whether a
room's name fits by comparing its pixel width against `largestRect`'s width, and
`rules.ts:171` quotes "clear floor `w` × `h` m" from `clearRect`. Deleting the rectangle
breaks both.

**Finding 6 — a circle is where the rectangle is worst.** For a round room of diameter D the
largest *axis-aligned* inscribed rectangle has short side D/√2 = 0.707 D. A 3.4 m round
room would report 2.4 m today. For the owner's "-0-" this is not an edge case; it is the
whole point of the shape.

**Recommendation: keep both, name them for what they are, give them different jobs.**

```ts
export interface RoomModel {
  // ...
  /** the clear polygon: the room's ring offset inward to the wall faces, less fixtures */
  clearRing: Ring[];
  clearArea: Mm2;                       // = area(clearRing); reproduces today exactly
  /** largest circle inscribed in clearRing; rotation-invariant */
  inscribed: { at: Pt; r: Mm };
  /** 2 * inscribed.r — the narrowness proxy that survives angles and arcs */
  minDimension: Mm;
  /** largest inscribed rectangle in clearRing, axis-aligned in the ROOM's frame */
  clearRect: { at: Pt; w: Mm; h: Mm; bearing: number };
  /** inscribed.at — the point furthest from every wall */
  labelAt: Pt;
}
```

- `minDimension := 2 × inscribed.r` drives `room.min_dimension`. Rotation-invariant, defined
  for arcs, cheap, and honest about what it measures once the message is reworded ("the
  largest circle that fits is 2.79 m across; a bedroom wants 2.4 m").
- `clearRect` keeps the furnishable figure in the message and the label-fits test. It
  generalises by rotating into the room's own frame — the bearing of its longest wall — and
  running the existing `largestRect` cell sweep in that frame. That is an approximation (the
  true largest inscribed rectangle at arbitrary orientation has no simple exact algorithm),
  and it should be documented as one. For every rectilinear room the frame is 0° and the
  result is bit-identical to today.
- `labelAt := inscribed.at` — better than the rectangle centre for L-shapes, and defined for
  any shape. **Consequence to fix in the same change:** `svg.ts:289` matches finding markers
  to rooms by testing `r.labelAt[0] === f.at[0] && r.labelAt[1] === f.at[1]`. That equality
  survives only if the rules keep anchoring at `labelAt`; make the finding carry the room id
  instead and delete the coordinate comparison.

**Migration.** Implement the per-edge offset first (§1.3.4), so rectangles reproduce today
exactly; accept the change on the 9 non-rectangular rooms as a correction (today's L-shaped
rooms are *understated*: casa-t3 `cozinha` 2.79 → ≈3.2, casa-patio `sala` 3.3 → ≈3.9); pin
the rectangle cases with a regression test before the change, not after.

### 1.3.6 Openings, doors and the access graph

**Selection.** `at: [x, y]` becomes primary (B5): nearest wall among the candidates, projected
to give the centre. `distToWall` (`derive.ts:497`) generalises to segments (clamp the
parameter) and arcs (distance to the circle, clamped to the arc's angular span). `on.side`
survives as sugar and must *refuse* on a non-axis wall with a message that says so, rather
than silently matching nothing — today `sideOf` would return a compass name for any wall
because it only asks `axis === "h"`.

**Placement.** Already general: a 1-D parameter on `[0, length]` (`derive.ts:440-448`), where
`length` becomes arc length. `opening.overflow` and `opening.near_corner` need no change.

**Door swing.** `doors.ts:24-26` picks `along` and `normal` from a table indexed by axis.
Mechanical: `along` = unit tangent at the hinge (for an arc, the tangent to the circle),
`normal` = its perpendicular pointing into the swing room, sign from which side the swing
room is on. Two subtleties: on a curved wall the leaf is straight while the wall is not, so
the *closed* leaf no longer lies in the wall — the drawing must show the chord; and the swept
region is still a circular sector about the hinge, so the geometry is unchanged, only its
orientation is.

**Swing collisions and swing-hits-fixture.** `rules.ts:212-262` uses rectangle overlap plus a
nearest-point test. The exact predicate is *sector ∩ polygon ≠ ∅*, which is: does any fixture
vertex lie in the sector, or does any fixture edge intersect either sector radius or the arc.
That is ~30 lines and needs no arrangement. Keep the bounding-box test as a cheap reject.

**Fixture clearance.** `boxGap` (`geometry.ts:87-91`) is the weakest thing in this list: it
measures between *bounding boxes*, so an L-shaped counter already reports the wrong gap
today, before any angles exist. Replace with polygon–polygon distance (minimum over
edge-pairs; for arcs, the segment-to-circle distance clamped to the span).

**Access graph.** Untouched by geometry (`derive.ts:336-348`): it links `wall.neg` to
`wall.pos` through each non-window opening. The owner union from §1.3.1 improves it for free
(A2: an outdoor space becomes its own node instead of collapsing into `exterior`).

**Courtyard detection.** Becomes: the outer face is `exterior`; a zero-owner face is
`exterior` if it is connected to the outer face through zero-owner faces, otherwise it is a
declared `outdoor` face (open sky) or a `gap` (an error). The INVARIANT comment at
`derive.ts:71-75` moves to the face classifier and stays true verbatim.

### 1.3.7 Rendering

**Walls.** `svg.ts:161-185` draws each run as a `<line>` with `stroke-width = t` and extends
every true end by `t/2` to "fill the corner". That extension closes a right angle exactly and
nothing else: at 45° it overshoots, at 150° it leaves a notch. Replace with **one `<path>`
per wall chain**, `stroke-linejoin="miter"`, `stroke-linecap="butt"`, and a `stroke-miterlimit`
so an acute corner degrades to a bevel rather than a spike. Arcs become `A` commands; because
the *rendered* arc uses the exact `Arc` record and not the flattened chords, the drawing stays
smooth at any zoom. Jambs keep butt caps, as today.

Openings still split the chain, so the run-splitting logic at `svg.ts:164-172` survives with
`from`/`to` reinterpreted as arc length along the chain.

**Window glazing** (`svg.ts:194-198`): the ±t/4 offset becomes an offset along the edge
normal; for an arc, two concentric arcs at r ± t/4.

**What still needs a true outline.** Stroked paths with mitre joins are enough for the SVG.
Filled wall polygons are needed only for print-quality output and DXF, and §1.3.2 supplies
them from the offset arrangement — no separate clipper.

### 1.3.8 Editing: what a "wall handle" is when walls are not grid lines

Today a `Draggable` is a scalar on an axis (`edit.ts:16-27`) and a drag rewrites one
coordinate per vertex (`edit.ts:176`). Generalised:

```ts
export type Handle =
  | { kind: "offset"; id: string; normal: [number, number]; at: Mm; min: Mm; max: Mm;
      writes: string; edits(next: Mm): Edit[] }       // slide a wall along its normal
  | { kind: "radius"; id: string; at: Mm; min: Mm; max: Mm;
      writes: string; edits(next: Mm): Edit[] }       // change a curved wall's radius
  | { kind: "vertex"; id: string; at: Pt;
      writes: string; edits(next: Pt): Edit[] };      // move one corner in 2-D
```

**Offset.** Moving a wall along its normal moves the vertices on it; each *adjacent* edge
keeps its far vertex and pivots, so the new corner is the intersection of the moved supporting
line with the neighbour's supporting line (line∩line, or line∩circle when the neighbour is an
arc). This is the review's design (`agent-review.md:454-462`) and I agree with it. Three
things it does not say:

1. **A general drag writes both coordinates of every moved vertex.** Today it writes one
   (`edit.ts:157`, `path: [kind, id, "poly", v, axis]`). To keep today's documents' diffs
   unchanged, `spliceAll` must drop no-op edits: when the normal is axis-aligned the other
   coordinate is unchanged, and dropping it reproduces today's splice byte for byte. Worth an
   explicit test on `quinta` and `casa-patio`, which are the two fixtures the current drag
   tests cover.
2. **The existing refusal generalises, and should be strengthened.** `edit.ts:156` refuses
   when a vertex on the wall's line lies outside the wall's run, because moving it would need
   the edge split. The general condition is *a vertex of the wall chain is incident to a third
   owner* — i.e. moving it would change the topology, not just the geometry. That is a
   property of the arrangement (the vertex's half-edge degree), so the drag layer should ask
   the arrangement rather than re-deriving it from the document as it does today.
3. **A5's sibling bug in the drag layer.** `fromPolys` scans only the two owners the wall
   separates (`edit.ts:141`) — correct — but `fromGrid`'s `anchored` scan (`edit.ts:69-81`)
   scans *every* room and outdoor space for a matching coordinate, which is the quinta bug
   (A3). Under the arrangement the anchored set is exactly "vertices incident to this grid
   line inside the grid's span", which the arrangement knows. A3's fix and the rewrite want
   the same information.

**Radius.** A curved wall gets two handles: an offset (which changes the radius keeping the
endpoints, i.e. the bulge) and endpoint vertex handles. Both are single-value splices into
`{ "arc": [x,y], "r": … }` — the inline-arc-object encoding chosen in §1.2 is what makes this
possible; an SVG path string would not be splice-addressable.

**App.** `Drawing.tsx:95` `along(d, m) = d.axis === "v" ? m[0] : m[1]` becomes a dot product
with `handle.normal`; `Drawing.tsx:77`'s cursor picks from the normal's dominant component.
Three lines, as the review says.

## 1.4 Keep the grid? — Dissent D9: no, and the usual reason is wrong

The question is whether a general planar arrangement should coexist with the cell grid so
rectilinear plans keep an "exact, fast path".

**Speed is not the issue**: 0.72 ms for casa-t3, 44 ms for 400 synthetic rooms
(`agent-review.md:158`), and "performance work of any kind" is already on the would-not-do
list.

**Exactness is not the issue either, and this is the part the review does not say.** The
intersection of an axis-parallel edge with another axis-parallel edge is at
(x of the vertical, y of the horizontal) — **both authored coordinates**. So for a plan whose
every edge is axis-aligned, a planar arrangement constructs **no new coordinate values at
all**: no rounding, no snap-rounding, no hot pixels. It is bit-for-bit as exact as the cell
grid, on exactly the inputs the cell grid handles. Constructed points appear only where an
edge is sloped or curved — i.e. only in the plans the grid cannot represent anyway.

So: **one general algorithm, no dual path.** A dual path would mean two owner
classifications, two wall extractors and two sets of findings to keep in agreement, for no
exactness and no speed.

**What *does* stay.** The `layout` track-grid **authoring** syntax (`parse.ts:362-435`) is
unaffected: it compiles tracks to polygons before `derive` ever runs, and `cellsToPolygons`
(`geometry.ts:151-219`) stays as its compiler. It is input sugar, it is genuinely good for
apartments, and it should not be grown toward angles — agreeing with the review. Likewise the
**grid drag** (`edit.ts:53-123`) stays: a grid wall's handle resizes two tracks, which is a
different and better edit than moving vertices, and it is expressed entirely in document
terms. Under levels it gains one new property (§2.5).

## 1.5 Representation impact

**Nothing in the JSON schema becomes a dead end.** The two extension points are inside a
`poly` (a point becomes *point or arc object*) and on a fixture (`rotate`). Both are additive:
every existing document stays valid and means the same thing.

**`rect` stays and matters more, not less.** Measured: 35 tokens vs 62 for four explicit
points vs 96 with arcs. 11 of casa-t3's 13 rooms are rectangles. It also removes the most
common way to author a broken polygon by accident.

**Grid shorthand stays**, unchanged, as rectilinear sugar (§1.4).

**What a curved room costs.** Measured (§1.2): +61 tokens for two arcs over the `rect` form
of the same room, and −73 against hand-flattening it to 20 points. In the line DSL an arc is
+20 tokens (43 vs ~23 for the rectilinear equivalent), matching the review's measurement.
Whole-document: `scratch/curved.json` — a three-room "-0-" house with two arcs and five
openings — is **404 tokens**.

**One thing that does become a dead end**, and it is not in the JSON: the *implicit* claim,
made by `on.side` and by every compass-named field, that a wall has a compass side. That
vocabulary (`Side` at `types.ts:5`, `SIDES` at `parse.ts:33`, `exteriorFaces` at
`types.ts:151`) is meaningful only for axis-aligned walls, and it appears in authored input
(`on.side`), in the model (`exteriorFaces`) and in messages. It should stop growing now:
`at: [x,y]` for input, wall ids or bearings in the model, and bearings in prose.

## 1.6 Findings and rules impact

| rule | change |
|---|---|
| `tiling.gap`, `tiling.overlap` | one per **face**, with its outline, not one per cell. A5 ceases to exist rather than being fixed |
| `wall.ambiguous` | `describe(w)` prints `y=5.8 x 4.6→6.6` (`derive.ts:494`) — meaningless for a sloped or curved wall. Becomes endpoints, or `wall w17, 4.2 m, bearing 143°`. The structured `candidates` array (B2) matters more here than the prose |
| `wall.unresolved` | unchanged (topological) |
| `habitable.no_window` | the message names compass faces (`rules.ts:108`, from `exteriorFaces`). Becomes wall ids and bearings: "it has 4.2 m of exterior wall on its south-east face" |
| `room.min_dimension` | value changes on 30 of 46 fixture rooms (§1.3.5); the wording "at its narrowest" is wrong today and must be reworded; the quoted clear floor comes from the new oriented `clearRect` |
| `window.not_exterior` | unchanged |
| `opening.near_corner` | unchanged (arc length) |
| `opening.overflow` | unchanged; the message's "the 2.4 m wall" becomes arc length |
| `fixture.clearance` | currently measured between bounding boxes (`rules.ts:233`); becomes true polygon distance, which changes values on any non-rectangular fixture **today**, before angles exist |
| `door.swing_hits_fixture`, `door.swing_collision` | exact sector∩polygon instead of box overlap |
| `fixture.outside_space`, `fixture.overlap`, `outdoor.overlap` | exact via face classification; D3's "deduct only the intersection" falls out |
| `entrance.*`, `reach.unreachable`, `space.no_access`, `privacy.*`, `wet.*`, `circulation.share`, `door.min_width` | unchanged — all topological or scalar |

**New rules that become possible, and are worth having:**

- `corner.unusable` (info). At an acute corner the mitred wall faces meet far from the
  authored apex. Measured (`scratch/angle-sweep.mjs`) for t = 0.3 m: at 60° the clear corner
  sits 0.26 m along each arm; at 30°, 0.56 m; at 20°, 0.85 m; at 10°, **1.72 m**. Fire when
  the interior angle is below ~25°, quoting the lost run: an agent that draws a sharp corner
  has no other way to learn that a metre of each wall is unreachable.
- `room.no_clear_floor` (error). The offset ring inverts — today silently clamped to 0
  (`derive.ts:397`).
- `geometry.sliver` (info). A face below the dissolve threshold was merged into a neighbour,
  naming both. Guards against a 3 mm authoring slip becoming an invisible area change.
- `arc.too_shallow` (warning). An arc whose sagitta is under a few millimetres is a straight
  wall written expensively; say so rather than flattening it to 2 chords.

**Not worth having:** a rule for "wall not orthogonal to its neighbours". Angled walls are the
feature, not the defect.

---

# Part 2 — Multiple levels

## 2.1 Inventory: where one storey is assumed

| # | Site | `file:line` | Assumption | Class |
|---|---|---|---|---|
| 1 | `Plan` | `types.ts:95-104` | `rooms`, `outdoor`, `openings`, `fixtures` are flat top-level collections | **D** |
| 2 | `Model` | `types.ts:164-174` | one `rooms`/`walls`/`openings`/`fixtures`/`access`/`envelope`/`interiorArea` | **D** |
| 3 | Consumers of those collections | 46 sites: `svg.ts` 15, `rules.ts` 11, `derive.ts` 10, `index.ts` 5, `edit.ts` 4, `Drawing.tsx` 1 | each reads `model.rooms` etc. directly | **M** once the level is threaded |
| 4 | `derive()` | `derive.ts:35-370` | builds one arrangement, one access map, one envelope | **M** — it already takes one `Plan` and needs nothing global; it becomes `derive(level, walls)` |
| 5 | Access graph root | `derive.ts:343`, `rules.ts:81-99` | one BFS from the single node `"exterior"` | **A** — nodes become `level/room`; the BFS runs once over the union |
| 6 | Entrance rules | `rules.ts:43-65` | any door on an exterior wall is a way in | **A** — an exterior door on the second floor is a window with ambitions |
| 7 | `envelope` | `derive.ts:351-355` | one bbox and one footprint over all rooms | **M** per level, plus a building total. Note it is a **bbox**, not an outline — the ghosting in §2.4 needs a real outline, which `cellsToPolygons` can already produce from owned cells |
| 8 | `schedule()` | `index.ts:84-115` | flat `rooms[]`, one `interiorArea`, one `footprint`, one `waterArea` | **M** — `levels[]` plus totals |
| 9 | `floorplan()` | `index.ts:133-141` | returns one `svg` | **D** (the return shape changes) |
| 10 | CLI | `cli.ts:22-63` | one input, one `--out`, `{findings, schedule}` on `--json` | **M** + a new `--level` |
| 11 | `edit.ts` paths | 14 path-literal sites (`:78, 100, 117, 118, 157, 243, 286, 287, 291, 292, 303, 304, 306, 311`) and 5 document-root lookups (`:54, 70, 144, 213, 274`) | every path starts at the document root: `["rooms", id, …]`, `["fixtures", i, …]`, `["layout", key, i]` | **M** — one prefix parameter, but it must be threaded through all 19 |
| 12 | `Finding` | `types.ts:178-186` | no `level`; `opening`/`fixture` are array indices, ambiguous across levels | **D** |
| 13 | App | `playground.tsx`, `Drawing.tsx` | one text, one model, one drawing | **M** + level tabs |
| 14 | `stairs` | `parse.ts:43`, `types.ts:54` | a `FixtureType` with no vertical meaning. It *is* an obstacle (`derive.ts:220-227`, `rules.ts:228-273`) — correctly — but nothing connects it to anything | **D** |

Summary: 5 sites need a new **data model**, 2 need a **different algorithm** (access graph,
entrance), the rest are mechanical once the level is threaded. This is a much shallower
inventory than Part 1's — which is the whole argument in §3.1.

## 2.2 The model

### 2.2.1 Levels are a record, not an array — Dissent D5

The review says three different things in three places: §H2 writes `"levels": [ { "id":
"ground", … } ]` — an array (`agent-review.md:492`); §C's comparison table calls it "a
`levels` map" (`:284`, repeated at `:311`); §B2 writes the path `"levels.first.rooms.suite"`
— also a map (`:216`). They cannot all be right.

**The object is right**, and the argument is about edit locality, which is a first-class
criterion here. With an array, every `Finding.path`, every drag path and every `--patch`
target contains `levels[0]`, `levels[1]`. The single most likely structural edit to a
finished two-storey house is **adding a basement**, which goes at the front and renumbers
everything. This is exactly B7's complaint about opening indices, one level up, and it is
worse because it invalidates paths the agent is holding across turns.

Order still matters (levels stack), so it is stated once, explicitly:

```jsonc
{
  "stack": ["cave", "piso0", "piso1"],        // ground-up; the only source of order
  "levels": { "piso0": { … }, "piso1": { … }, "cave": { … } }
}
```

`stack` costs ~10 tokens and inserting a basement is two splices: one array element, one new
object. Everything else — every cached path — is untouched.

### 2.2.2 What is shared — Dissent D6

The review proposes a `shared` block holding `layout` (the track grid) and `cores` (stairs,
lifts, shafts), "stamped into every level that uses it", and says "that is where multi-level
token cost is saved" (`agent-review.md:487-511`).

I built a realistic two-storey house — four rooms and six openings per floor, on a 4 × 3 track
grid, with a stair — in three forms and measured it (`scratch/count.mjs`, o200k):

| form | tokens |
|---|---:|
| `levels` with each level repeating `cols`/`rows` and its own `stairs` fixture | 958 |
| `levels` with `shared.layout` + `shared.cores` | 884 |
| line DSL with `grid`/`core` headers and `level` sections | 360 |

**`shared` saves 74 tokens, 8 %.** For comparison, the second level's own block is 346 tokens
in the shared-grid JSON, against 310 for the same floor written as a standalone single-level
document — so the wrapper's marginal cost is ~36 tokens, and the review's "wrapper is 15
tokens" understates it only because its sample was a tiny plan. (The review's absolute figures
— 334 tokens for two levels, 143 in the DSL — come from a much smaller house; mine are not a
contradiction, they are a more realistic scale. Both agree the DSL is ~2.5× cheaper.)

8 % is not enough to justify a second resolution mechanism. And a shared block is not free:
it needs stamping order, override semantics, a rule for what a level may override, and it
breaks id scoping (a `shared.cores` entry named in a level's `layout.areas` is neither a room
nor an outdoor space, so `parse.ts:413`'s token check — *"which is not declared in rooms or
outdoor"* — rejects it; a third namespace must be threaded through the grid compiler).

**Recommendation.** Keep exactly one shared thing, and justify it on *alignment*, not tokens:

```jsonc
"grid": { "cols": [4.2, 1.4, 3.6, 2.8], "rows": [3.6, 1.2, 4.2] }
```

A shared track grid is the mechanism that makes upper-floor walls land on lower-floor walls,
which is what a two-storey house actually needs and what no per-level grid guarantees. Each
level supplies only `areas`. A level may still author its own `layout` with its own
`cols`/`rows` (a set-back top floor), and then it simply does not participate in the shared
grid.

Drop `shared.cores`. Vertical elements get their own home (next section).

### 2.2.3 Vertical circulation is a first-class entity — Dissent D7

The review makes a stair a fixture (or a `shared.core`) and matches it to its counterpart on
the target level **by plan-view footprint overlap**: "the agent never has to cross-reference
by hand" (`agent-review.md:504-506`).

**This is the wrong trade.** The edge between two levels is the most important piece of
topology in a multi-storey building — `reach.unreachable`, `level.unreachable` and fire egress
all hang off it. Deriving it from a geometric coincidence means:

- two adjacent shafts (a stair and a lift 0.2 m apart, or a stair and the duct beside it)
  whose footprints happen to touch are matched to each other, silently;
- a switchback stair whose upper flight sits *beside* the lower one — the normal domestic
  arrangement — may overlap its counterpart only partly, or not at all, and the building
  becomes "unreachable" with no way for the author to say "yes, these are the same stair";
- "misaligned" can never be a *rule*, because misalignment is the thing that breaks the
  matching. The check the review lists as `stair.misaligned` cannot fire when it is needed
  most.

An explicit id costs ~4 tokens and turns all three failures into findings.

```ts
export interface Vertical {
  id: string;
  type: "stairs" | "lift" | "ramp";
  name: string;
  /** one footprint per level it serves, at least two, in stack order */
  at: Array<{
    level: string;
    /** the footprint on that level, in that level's coordinates (shared origin) */
    poly: Pt[];
    /** the room or outdoor space you step off it into, on that level */
    in: string;
  }>;
  /** bearing of travel upward, degrees clockwise from north; stairs and ramps */
  up: number | undefined;
  /** number of risers between the two levels: gives going, pitch and headroom */
  risers: number | undefined;
}
```

Authored:

```jsonc
"vertical": [
  { "id": "escada", "type": "stairs", "name": "Escada", "risers": 16, "up": 0,
    "at": [{ "level": "piso0", "in": "hall",    "rect": [4.2, 3.6, 1.4, 4.2] },
           { "level": "piso1", "in": "patamar", "rect": [4.2, 3.6, 1.4, 4.2] }] }
]
```

**What a stair needs to be more than a rectangle**, and what each thing buys:

| field | buys |
|---|---|
| a footprint on **each** level it serves | the access edge; the obstacle on both levels; the void in the upper slab |
| `in` per level | which room the edge actually connects — not "whichever room contains the footprint", which is undefined when the stair sits on a wall |
| `up` (bearing) | which end is the bottom; whether a door opens onto the top step; the drawing's direction arrow and break line |
| `risers` | with the level's `height`: going = footprint length / (risers − 1), pitch = atan(rise/going), and headroom against the slab above |
| level `height` | rise per riser; headroom |

Everything on that list except the footprints is optional, and each optional field unlocks
one rule and nothing else — so an agent pays only for the checks it wants.

**A stair is also still an obstacle.** On each level it serves, its footprint behaves exactly
as a `stairs` fixture does today (occupies floor, blocks swings). That behaviour is already
correct (`derive.ts:220-227`) and should be reused rather than re-implemented: a `Vertical`
contributes a synthetic fixture to each level it touches.

### 2.2.4 A `void` is the dual of an `outdoor` space

An upper level needs a way to say "there is deliberately no floor here": a stairwell, a
double-height living room, a light well. Today, on any level, a cell inside the footprint with
no room is `tiling.gap` — an error (`derive.ts:105-111`).

This is precisely the problem `outdoor` already solves one axis over. An `outdoor` space is a
declared absence of *roof*; a `void` is a declared absence of *floor*. Same mechanism, same
owner union (§1.3.1), no new concept:

```jsonc
"voids": { "vazio_sala": { "name": "Pé-direito duplo da sala" } }   // placed in layout.areas, or with a poly
```

What falls out for free:

- **double-height space** = a `void` on the upper level whose footprint matches a room below.
  No new field; a rule can *name* it ("Sala is double-height") instead of the author declaring
  it twice.
- **stairwell** = the void the `Vertical` implies in the upper slab; derive it rather than
  make the author write it, and warn when an author declares a void that a stair already
  implies.
- **floor opening / light well** = a void that matches nothing below.
- **cantilever** = the converse: a room whose footprint sits over `exterior` below.

### 2.2.5 The types, concretely

```ts
// ---------- authored ----------
export type Mm = number;              // integer millimetres (§1.3.3)
export type Pt = [Mm, Mm];

export interface Plan {
  title: string | undefined;
  units: "m";
  walls: { exterior: Mm; partition: Mm };
  north: number;
  /** ground-up order; the single source of stacking order (§2.2.1) */
  stack: string[];
  levels: Record<string, Level>;
  /** the only cross-level entities (§2.2.3) */
  vertical: Vertical[];
  /** optional shared track grid; levels using it supply only `areas` (§2.2.2) */
  grid: { cols: Mm[]; rows: Mm[] } | undefined;
}

export interface Level {
  id: string;
  name: string;
  /** floor-to-floor, mm */
  height: Mm | undefined;
  /** the level the street meets; exactly one level has it (default: stack[0]) */
  ground: boolean;
  rooms: Room[];
  outdoor: Outdoor[];
  voids: Void[];          // §2.2.4
  openings: Opening[];    // openings live per level, always
  fixtures: Fixture[];
}

export interface Void { id: string; name: string; poly: Pt[]; }

// ---------- derived ----------
export interface Model {
  plan: Plan;
  /** in stack order */
  levels: LevelModel[];
  /** nodes: `${levelId}/${roomId}`, plus "exterior" and `${levelId}/${outdoorId}` */
  access: Map<string, Set<string>>;
  building: { footprint: Mm2; grossArea: Mm2; storeys: number };
}

export interface LevelModel {
  level: Level;
  rooms: RoomModel[];
  walls: Wall[];
  openings: ResolvedOpening[];
  fixtures: FixtureModel[];
  /** faces, kept so cross-level queries need no re-derivation (§2.3) */
  arrangement: Arrangement;
  /** a real outline, not a bbox — the ghost layer needs it (§2.4) */
  envelope: { outline: Ring[]; bbox: BBox; area: Mm2 };
  interiorArea: Mm2;
}

export interface Wall {
  id: string;
  /** canonical direction: start is the lexicographically smaller endpoint (§1.3.1) */
  geometry: Edge;                 // Seg | Arc
  length: Mm;                     // arc length; openings parameterise on [0, length]
  neg: Owner;                     // left of start→end
  pos: Owner;                     // right
  kind: "exterior" | "partition";
  thickness: Mm;
}

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /** absent for building-wide findings; present on everything a level produced */
  level?: string;
  /** a document path ready for spliceAt (§2.5) */
  path?: string;
  at?: Pt;
  /** ids, level-scoped only when the finding crosses levels */
  rooms?: string[];
  opening?: string;               // id, not index (B7)
  fixture?: string;
  vertical?: string;
}
```

**Backward compatibility.** A document with no `stack`/`levels` is one level with id
`"ground"` and `ground: true`, holding today's top-level collections. `parse()` normalises;
every existing fixture, test and README example keeps working and — crucially — keeps its
document paths (§2.5).

## 2.3 Vertical circulation, rules, and what stays per level

**Derivation.** `derive` runs unchanged per level (each is its own arrangement). Then one
cross-level pass:

1. **Combined access graph.** Nodes `level/room` plus `exterior` and `level/outdoor`. Doors
   and cased openings link within a level; each `Vertical` links `at[i].level/at[i].in` to
   `at[i+1].level/at[i+1].in` for consecutive entries. `reach.unreachable` then runs **once**
   over the union (replacing `rules.ts:81-99`), and its message can say *why*: "Quarto cannot
   be reached from the entrance — no stair or lift arrives on piso1".
2. **Entrance.** An entrance is a door to `exterior` **on the ground level**. Today any
   exterior door counts (`rules.ts:44`), which on an upper floor is a hole in the wall. A
   street door on a non-ground level is `entrance.not_ground` (info; a sloping site is real,
   so a level may set `ground: true` and more than one may do so).
3. **Footprint queries.** Overlay two levels' arrangements and classify faces (§1.3.2). Note
   for §3.1: for rectilinear plans `polysOverlap`/`polyInside` (`geometry.ts:77-84`) already
   answer these **exactly, today** — they build the cell decomposition over the union of both
   polygons' coordinates, which does not care that the polygons came from different levels.

**Rules by scope:**

| stays per level | becomes building-wide | new, cross-level |
|---|---|---|
| `tiling.*`, `wall.*`, `opening.*`, `window.not_exterior`, `space.no_access`, `habitable.no_window`, `wet.*`, `privacy.*`, `room.min_dimension`, `door.*`, `fixture.*`, `outdoor.overlap` | `entrance.missing`, `entrance.multiple`, `reach.unreachable` | see below |
| `circulation.share` — **per level and as a building total**: a stair landing is circulation on its own floor, and the 10 % threshold means different things at the two scales | | |

New rules, with a verdict on each:

| rule | severity | what it catches | worth having? |
|---|---|---|---|
| `level.unreachable` | error | a level no `Vertical` reaches | **Yes** — the defining multi-level failure |
| `stair.no_arrival` | error | a `Vertical`'s `at[i].in` names a room that does not contain its footprint on that level | **Yes** — catches the copy-paste error the explicit-id design makes possible to catch at all |
| `stair.misaligned` | warning | consecutive footprints overlap only partly, or not at all | **Yes** — and only expressible because matching is by id (§2.2.3) |
| `stair.no_void` | error | the upper level has floor where the stair arrives | **Yes** — you cannot walk into a slab |
| `stair.pitch` | warning | `risers` + `height` + footprint length give a pitch outside ~30–42°, or a going under 0.25 m | **Yes**, when `risers` is given — this is the single most common real defect in an amateur plan |
| `stair.headroom` | warning | clear height under the slab above at the stair's midpoint below ~2.0 m | **Yes**, when `height` and `risers` are given |
| `stair.no_landing` | warning | a door swing overlaps the top or bottom step | **Yes** — cheap once swings are polygons (§1.3.6) |
| `void.unaligned` | info | a void sits over `exterior` or over another void | Marginal — keep, it is two lines |
| `structure.over_open_sky` | info / error | a room's footprint sits over `exterior` or `outdoor` below (cantilever — info) or over a `gap` (error) | **Yes** for the `gap` case; the cantilever info will be noisy on any house with a porch and should be off by default |
| `stack.wet_over_habitable` | info | a bathroom above a bedroom | **No.** It is normal construction, an agent cannot act on it, and it will fire on nearly every real house. The review flags it "worth having?" — my answer is no |
| `stack.walls_unaligned` | info | an upper-level wall carrying no wall or beam below | **Not yet.** It needs a load-bearing/partition distinction the model does not have. Do not add one speculatively; note it as what `walls.exterior/partition` would have to grow into |

**Fire egress**: out of scope, as the spec's non-goals stand — it needs travel distances,
occupancy and protected routes, none of which the model has. But note that once the combined
access graph exists, "every level has two independent routes to the street" is a *graph*
question (2-vertex-connectivity from `exterior`), not a code-compliance question, and is a
defensible future rule.

## 2.4 Output

**Library.**

```ts
floorplan(input) → {
  plan, model,
  findings: Finding[],                 // every finding, each with `level` where it applies
  levels: Array<{ id, name, svg, findings }>,   // per level, in stack order
  schedule: { levels: Array<{ id, name, rooms, interiorArea, … }>, building: { … } },
}
```

**Drawing.** One SVG per level is the convention architects read, and it is also the
token-cheap answer (an agent asks for the level it is working on). The level below should be
**ghosted**: its envelope outline plus its `Vertical` footprints, dashed at low opacity. Two
notes:

- ghosting needs a real outline, and `envelope` is currently a **bbox** (`derive.ts:351`).
  `cellsToPolygons` (`geometry.ts:151-219`) already produces an outline from owned cells, and
  the arrangement produces one directly; either way this is a new field, not a reuse.
- ghost *walls* rather than just the envelope if `stack.walls_unaligned` is ever wanted; until
  then the outline plus cores is enough to see alignment, which is the purpose.

`--stack` renders all levels on one sheet. Useful for a human, never for an agent.

**CLI.** `--level piso1` selects; `--out plan-{level}.svg` expands; `--json` gains `level` on
findings and a `levels[]` schedule.

**What an agent pays to read a three-level house back** (measured, `scratch/count.mjs`):

| read-back | tokens |
|---|---:|
| one level's schedule, `JSON.stringify(…, null, 2)` (today's format) | 261 |
| × 3 levels | **781** |
| the same, compact / `formatPlan` style | 160 |
| × 3 levels, compact | **480** |
| findings-first summary for 3 levels, no schedule | **61** |

So a naive three-level `--json` costs 781 tokens of schedule before a single finding. **Keep
it flat by composition, not by compression**: B4's findings-first default (`{summary,
findings}`) makes read-back grow with *problems*, not with levels — 61 tokens for a clean
three-storey house against 781. The schedule moves behind `--json=all`, and `--level` scopes
it. This is the single most important interaction between §H and the review's §B4, and it
means B4's shape must know about levels (§3.2).

**What `level` and `path` cost on a finding** (measured):

| finding | tokens |
|---|---:|
| as today, compact | 68 |
| plus `level` and a full path `levels.piso1.rooms.quarto` | 84 (+24 %) |
| plus one **scoped** path `piso1/rooms.quarto` (level and path in one field) | 78 (+15 %) |

The scoped form is cheaper and reads better, but it is **not** what `spliceAt` consumes
(`jsonpos.ts:158` takes a `JsonPath` array). Recommendation: keep `level` and `path` as two
fields (84 tokens), because a path that needs unpacking before use is the kind of near-miss
that costs an agent a turn. 16 tokens per finding is the right price for "paste this into
`--patch`".

## 2.5 Editing and paths

**Paths.** `edit.ts` constructs document paths at 14 sites and reads the document root at 5
(§2.1 #11). With levels they become `["levels", levelId, "rooms", id, "poly", v, axis]`.
Three consequences:

1. **`jsonpos` needs no change at all.** `JsonPath = Array<string|number>` (`jsonpos.ts:7`)
   already addresses arbitrary depth, `nodeAt` walks it (`:144-151`), `spliceAt`/`spliceAll`
   are depth-agnostic (`:158-188`), and `pathToString` renders `levels.piso1.rooms.sala.poly[2][0]`
   correctly today. This is the part of the codebase that is *already* ready for levels, and
   it is worth saying so: the positioned-JSON layer was built at the right level of
   generality.
2. **The prefix must be a parameter, not a literal.** All 19 sites take a
   `root: JsonPath` (`[]` for a single-level document, `["levels", id]` otherwise) and
   prepend it. Mechanical, but it must be done in one change or the layer will be half
   converted.
3. **Single-level documents keep byte-identical paths.** With `root = []`, `rooms.sala.poly[0][0]`
   is unchanged. That is what makes B2 (`Finding.path`) safe to ship before levels — **provided
   B2 derives the path from the document it parsed, not from a fixed template**. If B2 hard-codes
   `` `rooms.${id}` `` it will be rewritten; if it asks the parser where the room came from, it
   will not. This is a concrete instruction for W3a.

**Does a drag propagate to shared structure?** Yes, in exactly one case, and it is the case
the shared grid exists for. Dragging a wall that sits on a **shared** track boundary rewrites
`grid.cols[i]` and `grid.cols[i+1]` — and therefore moves that wall on *every* level using the
grid. This must be visible, not surprising. `Draggable.writes` already exists for precisely
this purpose (`edit.ts:98, 113, 175`: "layout.cols[2] and [3]"), and it becomes
`"grid.cols[2] and [3] — moves this wall on piso0 and piso1"`. A wall authored as polygon
edges on one level moves only that level, as today. A `Vertical`'s footprint is shared by
construction: dragging it on either level writes `vertical[0].at[i].rect` for the level being
dragged, and the *other* level does not move — which is what makes `stair.misaligned` able to
fire immediately, giving the author instant feedback instead of a silent break.

**The splice, concretely.** Moving `piso1`'s `sala`/`cozinha` wall from x = 8.4 to 8.9 in a
two-level document with poly-authored rooms:

```
levels.piso1.rooms.sala.poly[1][0]     8.4 -> 8.9
levels.piso1.rooms.sala.poly[2][0]     8.4 -> 8.9
levels.piso1.rooms.cozinha.poly[0][0]  8.4 -> 8.9
levels.piso1.rooms.cozinha.poly[3][0]  8.4 -> 8.9
```

Four splices, same as today plus a two-element prefix, through the same `spliceAll`. On the
shared grid it is instead two splices into `grid.cols`, and the status line names both levels.

## 2.6 Representation impact, and the review's "nesting is where JSON pays" claim

**Nothing becomes a dead end.** `stack`, `levels`, `vertical`, `voids` and `grid` are all
additive; a document without them is a one-level plan and stays valid.

**The claim.** The review's §C holds that JSON "extends to arcs (an object among points) and
levels (a map) without strain" and that this generality is what earns it the model role
(`agent-review.md:310-313`); the earlier draft put it more strongly — nesting is "exactly the
case where JSON's generality starts to pay" against a line grammar, which "starts to sprout
sub-syntax". Assessed concretely on my two-storey house (`scratch/two-level-*.json`,
`scratch/two-level.dsl`):

| | tokens | lines | one-entity-per-line? | targeted edit |
|---|---:|---:|---|---|
| JSON, repeated grids | 958 | 51 | yes | path splice |
| JSON, shared grid + cores | 884 | 46 | yes | path splice |
| line DSL with `level` sections | **360** | 32 | yes | replace line N |

**The claim does not hold.** The DSL is **59 % cheaper** on the two-level house — the same
ratio the review measured on the single-level casa-t3 (−68 %). Nesting does not erode the
DSL's advantage because a level is a *section header*, not a nesting level: `level piso1 "1.º
andar" h2.6` is one line and every statement under it is flat. Meanwhile the JSON pays the
nesting twice, in indentation and in the repeated key names of a second `rooms`/`openings`
block.

Where JSON *does* pay, and it is a real point the review is reaching for: a `Vertical` with a
per-level footprint list is genuinely a nested structure, and its DSL form starts to sprout
sub-syntax —

```
vertical escada stairs "Escada" risers16 up:0
  at piso0 in:hall rect 4.2,3.6 1.4x4.2
  at piso1 in:patamar rect 4.2,3.6 1.4x4.2
```

— which is an indented continuation, i.e. the DSL growing a second level of structure. One
such construct is tolerable; a second would be the signal to stop. So the honest version of
the review's claim is narrower: *nesting is where a line DSL starts to need continuation
lines, and `vertical` is the first place it happens.* That is a reason to design the grammar
with `vertical` in it from day one — which is already the recommendation — not a reason to
prefer JSON for authoring.

**Recommendation unchanged from the review's §C:** JSON stays the canonical model and
interchange (it takes `levels`, `arc` and `vertical` without strain, and `jsonpos` already
addresses them); the DSL is the authoring surface, and its grammar must contain `arc`, `at`,
`level`, `vertical` and `id` before a line of it is written.

---

# Part 3 — Sequencing

## 3.1 Which gap first — Dissent D8: levels

The review sequences the geometry core (item 10) before levels (item 12), "because §H's
cross-level checks and D3 need its predicates, and because it changes `Model.walls`, which the
ghosted-level rendering and the drag layer consume" (`agent-review.md:637-638`).

**The two gaps are independent.** Geometry is *within* a level: it changes the first 160 lines
of `derive.ts`, the `Wall` type, the offsetter, the label/min-dimension pair, the renderer's
wall path and the drag handle. Levels are *around* a level: they change the `Plan`/`Model`
shape, the access graph root, the entrance rules, the paths, the CLI and the app's
composition. The intersection is two items, both small (below).

**And the stated dependency is not real.** The cross-level checks need polygon overlap and
containment between two levels' footprints. `polysOverlap` and `polyInside`
(`geometry.ts:77-84`) already do exactly that, **exactly**, for rectilinear polygons, by cell
decomposition over the union of both inputs' coordinates — and they do not care that the two
polygons came from different levels. So every cross-level rule in §2.3 can ship today,
rectilinear-only, and inherit generality for free when the core lands — which is precisely how
every *other* rule in the codebase relates to the geometry layer.

**Four reasons to do levels first.**

1. **Levels are what freeze the contract surfaces Wave 3 is about to build.** W3a (finding
   paths, `--json` shape, ids) and W3b (`set`/`--patch`) are all about addressing things in a
   document. If levels land after them, `Finding.opening: number` (an array index, ambiguous
   across levels), the `--json` envelope and the `walls` payload are all rebuilt. The review
   sees this — it inserts a "design step" at item 9 to fix the shapes on paper — but a shape
   fixed on paper and not exercised is a guess. Implementing levels *is* the design step, and
   it is not a large one (§2.1: 5 data-model sites, 2 algorithms, the rest mechanical).
2. **The geometry core is the riskiest, longest single piece**, and everything behind it in the
   review's order waits for it. Put it last among the two and the rest of the roadmap is not
   hostage to it.
3. **The level layer is a stable boundary for the rewrite.** Once `derive(level, walls) →
   LevelModel`, the arrangement rewrite happens entirely inside that call. Do it the other way
   round and the geometry work lands against a `Plan` shape that is about to change.
4. **The evidence for the reverse order is thin.** The only genuine coupling is that ghosting
   and the drag layer consume `Wall`. Ghosting consumes the *envelope outline*, not the walls
   (§2.4). The drag layer is the real overlap, and it is one function.

**What levels-first costs, honestly.** Three things get touched twice:

- the **ghost renderer** if it draws walls rather than the envelope outline — so draw the
  outline (one function, and it is the better drawing anyway);
- the **level tabs' drag plumbing**, because `Draggable.axis` becomes `Handle.normal` — three
  lines in `Drawing.tsx` (§1.3.8), already counted;
- `LevelModel.envelope` gains `outline` twice if the rectilinear version uses
  `cellsToPolygons` and the general one uses the arrangement — the *field* is stable, the
  producer changes.

That is a small, enumerable rework bill, against the alternative of rebuilding W3a and W3b.

**Verdict: levels first, geometry second.** They can also run in parallel on separate
branches — they touch almost disjoint files (`derive.ts:39-159` + `geometry.ts` + `svg.ts`
walls vs `types.ts` + `index.ts` + `cli.ts` + `rules.ts` + paths) — but if they must be
ordered, this is the order.

## 3.2 What in Waves 2–4 changes because the gaps are coming

Assessed against `docs/action-plan.md`.

| item | verdict | what to do instead, now |
|---|---|---|
| **W1a** A1 CLI bin, A6 `--json` error shape | **Unaffected.** Do it. | The error envelope `{"error":{"issues":[{path,message}]}}` is level-agnostic |
| **W1b** A4 unknown keys, A7 outdoor message | **Unaffected, and load-bearing.** Do it. | The `known`-set machinery is what will validate `levels`, `vertical`, `voids` and `arc` later. Build it as a reusable helper, not as inline sets, precisely because five more schemas are coming |
| **W1c** A3 grid drag, A5 gap merging | **A3: do it** (it is a live bug and the fix is an hour). **A5: do not do it.** | A5's merging of gap cells into components is thrown away entirely by faces (§1.3.1) — it is not "implementation replaced later", it is code written to be deleted. Spend the hour on A3 and let A5 be fixed by the arrangement. The review reaches the same conclusion in its "defer" list but W1c still schedules it |
| **W1d** delete `demo/`, stale prose, app fixes | **Unaffected.** Do it. Deleting `demo/` matters *more* now: it is a second renderer that will not follow §G or §H |
| **W2a** A2 outdoor as an owner class | **Do it, with one change.** | Model `Owner` as the **tagged union** of §1.3.1 from the start, not as a widened string union. It is the same work, it is what faces need, and it also makes `void` (§2.2.4) a one-line addition rather than a second special case. Do **not** re-reserve ids in `parse.ts:115` — the union removes the need |
| **W2b** B1/B6 formatter + `rect` | **Do it.** | `rect` is more valuable with angles, not less (§1.5). One instruction: the one-entity-per-line rule must treat a `level` block as a container, so a two-level document formats as two blocks of one-entity lines, not one 900-token line |
| **W3a** B2 `path`, B4 `--json`, B8 `lint()`, B7 ids | **Needs changing in three specific ways.** | (a) **B2**: derive `path` from the parsed document's own positions, never from a template — then single-level paths stay byte-identical when levels arrive (§2.5). (b) **B4**: make findings-first the default *now*, and put `schedule` behind `--json=all` — this is what keeps a three-level read-back at 61 tokens instead of 781 (§2.4); the `walls` payload must be keyed by wall id, never by `axis`/`c`, since those fields do not survive §1.3.1. (c) **B7**: `Finding.opening` must become a **string id, not a number**, in this change — with levels, an index is ambiguous, and changing it later invalidates every cached path |
| **W3b** B3 `set`/`--patch`, `jsonpos` remove/append | **Unaffected.** Do it. | `jsonpos` is already depth-agnostic (§2.5); nothing about `levels` touches it. This is the highest-value item in the whole plan for per-turn cost and nothing blocks it |
| **W3c** B5 `at:[x,y]`, D1 glazed doors, D3 usable area | **B5: do it, it is the selector that survives §1.3.6. D1: do it. D3: defer the exact part.** | D3's "deduct only the intersection" needs face classification; deducting only *fully contained* fixtures is a correct, cheap stopgap that is not thrown away (it is the common case and the exact version subsumes it) |
| **W4a** the line DSL | **Do it after the level model is fixed, not after the geometry core.** | The grammar needs `arc`, `at`, `level`, `vertical` and `id`. Of those, `level` and `vertical` are the ones that shape the *grammar* (sections and continuation lines, §2.6); `arc` and `at` are single tokens. So the DSL is gated on §H, not on §G |
| **W4b** B10 `--schema` | **Unaffected**, but it must read the vocabularies from the parser (as `/reference` already does) so it cannot drift as five new schemas land | |
| **W5** geometry core | Rescoped by Part 1; **moves after W6** | |
| **W6** levels | Rescoped by Part 2; **moves before W5** | |

**Things in the review's "defer" list I would move earlier:** none. **Things I would add to
it:** any further work on `exteriorFaces` or `on.side` (§1.5 — the compass vocabulary is a
dead end and should stop growing today), and `stack.wet_over_habitable` (§2.3 — a rule that
will fire on every real house).

## 3.3 The phased plan

Dependencies only. No estimates.

```
P0  W1a, W1b, W1c(A3 only), W1d          — independent, land first, none is undone later
     └─ W1b's schema helper is a prerequisite for P2 and P4

P1  W2a  owner as a tagged union (A2)    — after W1b
    W2b  formatter + rect                — independent of everything
    W3b  set/--patch                     — independent; biggest per-turn win
    W3c  at:[x,y], glazed doors          — after W2a (owner union changes `between`)

P2  LEVELS  (Part 2)                     — after P1's owner union
     ├─ stack/levels/vertical/voids in parse + types   (needs W1b's schema helper)
     ├─ derive(level) + combined access graph + entrance-on-ground
     ├─ path prefixing: 19 sites in edit.ts             (needs nothing new in jsonpos)
     ├─ per-level SVG + ghosted envelope outline
     └─ CLI --level, --out plan-{level}.svg

P3  W3a  finding paths, --json shape, ids — after P2, so `level`, the scoped id scheme
                                            and the findings-first envelope are built once
P4  W4a  the line DSL                     — after P3 (grammar needs `level` and `vertical`)
    W4b  --schema                         — after P3

P5  GEOMETRY CORE (Part 1)                — after P2; parallel with P3/P4 if staffed
     ├─ integer mm + snap-rounding with hot pixels     [§1.3.3]
     ├─ arrangement + DCEL + face owners               [§1.3.1]  (deletes A5 outright)
     ├─ offsetRing: clearArea, clearRing               [§1.3.4]
     ├─ inscribed circle + oriented clearRect + labelAt[§1.3.5]  (regression-pin first)
     ├─ Wall { geometry } + canonical direction        [§1.3.1]
     ├─ arcs: parse, canonical flatten, exact render   [§1.2, §1.3.3, §1.3.7]
     ├─ renderer: path chains with mitre joins         [§1.3.7]
     ├─ handles: offset / radius / vertex              [§1.3.8]
     └─ overlay() + facesWhere(): booleans for free    [§1.3.2]  (replaces D3's stopgap)

P6  new rules                             — after P5 for corner.unusable, room.no_clear_floor,
                                            geometry.sliver; after P2 for the stair rules
```

The one hard ordering claim inside P5: **`offsetRing` before the min-dimension change**, so
that rectangles reproduce today's numbers exactly and only the 9 genuinely-different rooms
move (§1.3.5). Pin all 46 fixture rooms' current `minDimension` in a test *before* starting.

---

## Appendix A — experiments

All under `scratch/` on this branch, deliberately **not committed**. Run from the worktree
root with `node scratch/<file>`.

| script | what it establishes | key output |
|---|---|---|
| `angled.json` | today's refusal, verbatim | `rooms.sala.poly: edge [6,4]→[3,6] is not axis-aligned`, exit 2 |
| `polylabel.mjs` | pole of inaccessibility (0.5 mm precision) vs `largestRect`/`minDimension` on all 46 fixture rooms | 45/46 differ from `minDimension`; 9/46 differ from `largestRect`'s short side |
| `mindim-flip.mjs` | would any `room.min_dimension` verdict change? | 0 flips, 30/46 printed numbers change, `broken/kitchen` 0.94 → 1.70 against a 1.8 threshold |
| `robustness.mjs` | T-junctions, coincident/partial edges, arc chord counts, snap-rounding, integer range | 70 T-junctions / 250 vertices; casa-t3 10 exact + 17 partial shared edges; R=3 m semicircle = 61 chords; out-of-phase flattening = 61 slivers / 277 cm²; degree-2 exact with 2.3×10⁵ headroom, degree-4 overflows 2⁵³ |
| `clear-area.mjs` | today's corner formula vs the true mitred offset | exact to 1.8e-15 on rectilinear (incl. a reflex L); +0.028 m² on a 45° cut; the `d₁d₂/sin θ` generalisation is worse; a 6 × 0.2 m slot inverts orientation |
| `angle-sweep.mjs` | how the error scales with corner angle; acute-corner unusability | −0.6 % at 90°, −4.2 % at 20°, −28.2 % at 10°; at 20° a 0.85 m run of each arm is lost to the mitre |
| `floats.mjs` | that the code already simulates integer mm in doubles | `[0.1,0.2,0.3,0.4,1.1,2.2]` sums to `4.3000000000000007105`; six tolerance constants for one concept |
| `count.mjs`, `two-level-*.json`, `two-level.dsl`, `curved.json` | token economics | casa-t3 2 322 (matches the review); 958 / 884 / 360 for the two-storey house; arcs 96 vs 35 vs 169 vs 43; findings 68 / 84 / 78; 3-level read-back 781 / 480 / 61 |

**Token method.** `gpt-tokenizer`'s `o200k_base` (`model/gpt-4o`), installed outside the
repository (the library's zero-dependency guarantee is untouched). `fixtures/casa-t3.json`
counts 2 322, identical to `agent-review.md`, so the two documents' figures are directly
comparable. Where my absolute numbers differ from §H's (two-storey 884 vs 334) it is because I
measured a realistic four-rooms-per-floor house rather than a minimal one; the *ratios* agree.

## Appendix B — what is inconclusive

- **The largest inscribed rectangle at arbitrary orientation.** §1.3.5 recommends rotating
  into the room's own frame (the bearing of its longest wall) and reusing the cell sweep. That
  is an approximation, and I did not test how far it can be from the true optimum on a room
  with two dominant bearings (an L-shape with one 30° limb). `inconclusive` — resolved by
  running the rotated sweep at, say, 2° increments over a few synthetic rooms and comparing
  against the single-frame answer. It matters only for the furnishable figure quoted in a
  message, never for a verdict, so it is not on the critical path.
- **Snap-rounding displacement under repeated editing.** Each drag re-parses and re-derives, so
  hot-pixel displacement does not accumulate in the *document* (the document holds authored
  coordinates; §1.3.3's rounding happens downstream). I believe there is no drift, but I did
  not build a fuzz harness that drags a sloped wall a thousand times and checks the authored
  coordinates. `inconclusive` — resolved by exactly that harness, which is worth writing as
  part of P5.
- **Whether `stair.pitch` and `stair.headroom` earn their thresholds.** I recommend them, but
  their default values (30–42°, 2.0 m) are conventions I did not check against any specific
  code, and the library is explicit that it is not a compliance checker. `inconclusive` on the
  numbers; the rules are still worth having as options with documented, changeable defaults —
  which is how every other threshold in `RuleOptions` (`rules.ts:5-14`) already works.
- **The `ground: true` multi-level case** (a sloping site where two levels meet the street).
  I have modelled it as a per-level flag, but I did not work through what `entrance.multiple`
  should say when two levels each have a street door. `inconclusive` — it needs one worked
  example, and it is a message question, not a model question.
