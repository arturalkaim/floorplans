# Cold-agent eval, round 2 — after the schema references were fixed

Files read for this eval, and only these: `docs/eval/briefs.md`, my own generated
`docs/eval/cold2/schema-dsl.txt` and `docs/eval/cold2/schema.txt`, and the `.out.json`
lint outputs I produced by running the tool. I did not open `README.md`, `src/`,
`fixtures/`, `test/`, `app/`, any other file under `docs/`, or `docs/eval/cold/`. I did
not grep the repo. I never used `Read` on a `.dsl` file while writing `.json` files or
vice versa.

One honest caveat that bears on how to read the results below: because Phase A (DSL)
ran before Phase B (JSON) *in the same session*, by the time I wrote the JSON files I
already knew, empirically, several rule-engine facts learned only from running the DSL
linter (e.g. that a plan needs a door to the exterior, that ambiguous shared walls need
`on`, that doors under 0.9 m to an outdoor space get flagged). I did not read any DSL
*file*, but I did carry forward that *rule knowledge* into JSON authoring, and applied
it (extra entrance doors, wall disambiguation, wider doors) in five or six JSON files
where the DSL analog has no such fix. That makes JSON's clean-pass rate look better than
"JSON syntax is easier" alone would justify — some of the gap is "second attempt with
institutional memory," not "better reference." I flag every case below.

## Summary table

| Brief | DSL exit | DSL `schema.*` | JSON exit | JSON `schema.*` |
|---|---|---|---|---|
| 1 Studio | 2 | 2 | 1 | 0 |
| 2 One-bed flat | 1 | 0 | 1 | 0 |
| 3 Two-bed flat | 1 | 0 | 1 | 0 |
| 4 Cottage | 1 | 0 | 1 | 0 |
| 5 Garage workshop | 1 | 0 | 1 | 0 |
| 6 Bungalow | 1 | 0 | 1 | 0 |
| 7 Cabin+loft | 2 | 2 | 1 | 0 |
| 8 Townhouse | 2 | 5 | 1 | 0 |
| 9 Courtyard house | 1 | 0 | 1 | 0 |
| 10 Guest house | 1 | 0 | 1 | 0 |
| 11 Kitchen extension | 0 | 0 | 0 | 0 |
| 12 Flat on a grid | 1 | 0 | 1 | 0 |
| 13 Pool house | 2 | 1 | 1 | 0 |
| 14 Office suite | 2 | 2 | 1 | 0 |
| 15 Long narrow house | 1 | 0 | 1 | 0 |
| 16 Utility house | 1 | 0 | 1 | 0 |
| 17 Loft conversion | 1 | 0 | 1 | 0 |
| 18 Shop | 2 | 1 | 1 | 0 |
| 19 Holiday let | 1 | 0 | 1 | 0 |
| 20 Semi-detached+void | 2 | 5 | 1 | 0 |

**Totals** — DSL: exit 0 ×1, exit 1 ×12, exit 2 ×7; `schema.*` findings = **18**, across 7
of 20 briefs. JSON: exit 0 ×1, exit 1 ×19, exit 2 ×0; `schema.*` findings = **0**.

`schema.*` here means "the document failed to parse/validate before the rule engine
could even run" — the top-level `{"error":{"issues":[...]}}` shape (`kind`:
syntax/reference/conflict/type), as opposed to the `{"summary","findings"}` shape where
`rule` values like `habitable.no_window` or `entrance.missing` are ordinary design/rule
findings, some with `severity:"error"`. The tool's rule names never literally start with
`schema.`, so this is my interpretation of the brief's term, made explicit here so it can
be checked.

## Every `schema.*` failure, verbatim, with what led me there

**Brief 1 (Studio)** — 2 issues, DSL exit 2:
- `{"path":"openings[0]","message":"has both \"at\" and \"on\"/\"position\"; use one","kind":"conflict"}` — I wrote `door studio.south at:2,4 w0.9 entrance`. The reference states `<room>[.<side>]` is shorthand for `exterior><room>` "with an `on`"; I didn't realize that shorthand's implicit `on` collides with an explicit `at:`, and nothing in the grammar template flags the two as mutually exclusive.
- `{"path":"fixtures[0].type","message":"must be one of pool, bath, shower, wc, sink, counter, island, stairs, other","kind":"type"}` — I wrote `fixture kitchenette in:studio ...`. The DSL reference gives the fixture line's shape but never lists valid `<type>` values, so I invented "kitchenette" straight from the brief's word.

**Brief 7 (Cabin+loft)** — 2 issues, DSL exit 2:
- `{"path":"levels.loft.openings[0].between[1]","message":"unknown space \"main\"; expected a room id, an outdoor space id, or \"exterior\"","kind":"reference"}` (and an identical one for `[1]`) — I placed `door main.south` and `window main.north` (which belong to the ground-floor room `main`) *after* the `level loft` line. The reference is explicit that "every statement after [a level header] belongs to that level, until the next one" — this is my own ordering mistake, not a reference gap.

**Brief 8 (Townhouse)** — 5 issues, DSL exit 2:
- `unknown space "hall"` (×2), `unknown space "living"`, `unknown space "kitchen"` — same root cause as brief 7: the ground-floor doors (`hall.west`, `hall>living`, `hall>kitchen`) were written after `level first`, so the parser looked for those rooms on the first floor, where they don't exist.

**Brief 13 (Pool house)** — 1 issue, DSL exit 2:
- `"line 3: room changing: \"changing\" is not a room kind; one of bedroom, living, kitchen, office, bath, wc, hall, corridor, storage, utility, garage, other — a zone is written zone:<z>"` — I guessed `changing` as a room kind for the changing room. This error is the *only* place either reference ever states the room-kind enum for DSL; the schema-dsl.txt reference never lists it.

**Brief 14 (Office suite)** — 2 issues, DSL exit 2:
- `"reception" is not a room kind` and `"meeting" is not a room kind` — same cause: guessed kind words not in the (undocumented, for DSL) enum.

**Brief 18 (Shop)** — 1 issue, DSL exit 2:
- `"shop" is not a room kind` — same cause.

**Brief 20 (Semi-detached+void)** — 5 issues, DSL exit 2:
- `unknown space "hall"` (×2), `"living"`, `"kitchen"` — identical mistake to brief 8: ground-floor doors written after `level first`.

JSON produced zero `schema.*` failures. Every one of the above building's *intents*
parses cleanly in JSON — briefs 1/13/14/18 because the JSON schema.txt spells out
`ROOM_KINDS` and `FIXTURE_TYPES` explicitly (I used `"other"` for changing/reception/
meeting/shop, and `"counter"` for the kitchenette), and briefs 7/8/20 because JSON's
per-level nesting (`levels.ground.openings` vs `levels.first.openings`) makes it
structurally hard to misfile an opening under the wrong level — there is no "everything
after this line belongs here until further notice" convention to trip over.

## Non-`schema.*` rule findings per pair

| Brief | DSL findings | JSON findings | Match? |
|---|---|---|---|
| 1 | 0 (parse failed) | 2 | No — DSL never reached the rule engine |
| 2 | 6 | 6 | Yes, byte-for-byte identical findings |
| 3 | 7 (incl. `entrance.missing`) | 6 | No — JSON has a front door, DSL doesn't |
| 4 | 4 | 4 | Yes (message text differs, see below) |
| 5 | 4 (incl. 2 errors) | 2 | No — JSON disambiguated the garage/office wall |
| 6 | 10 (incl. `entrance.missing`) | 9 | No — JSON has a front door, DSL doesn't |
| 7 | 0 (parse failed) | 3 (incl. `space.no_access`) | No — DSL never reached the rule engine |
| 8 | 0 (parse failed) | 16 (incl. 6 errors) | No — DSL never reached the rule engine |
| 9 | 8 (incl. `entrance.missing` + 2× `door.min_width`) | 5 | No — JSON added an entrance and widened the courtyard doors |
| 10 | 11 (incl. `entrance.missing`) | 10 | No — JSON has a front door, DSL doesn't |
| 11 | 0 | 0 | Yes — both clean |
| 12 | 8 (incl. 3 errors) | 6 | No — see below, genuinely different topology |
| 13 | 0 (parse failed) | 2 | No — DSL never reached the rule engine |
| 14 | 0 (parse failed) | 3 | No — DSL never reached the rule engine |
| 15 | 8 | 8 | Yes, identical findings |
| 16 | 4 (incl. 2 errors) | 2 | No — JSON reordered the rooms so kitchen/living touch |
| 17 | 8 (incl. 2 errors) | 7 | No — different composition, see below |
| 18 | 0 (parse failed) | 1 | No — DSL never reached the rule engine |
| 19 | 4 | 4 | Yes (message text differs, see below) |
| 20 | 0 (parse failed) | 17 (incl. 6 errors) | No — DSL never reached the rule engine |

**Totals**: DSL rule findings = 82 (across the 13 briefs that reached the rule engine);
JSON rule findings = 113 (across all 20).

Where they differ, which one is what the brief meant:

- **Briefs 3, 6, 9, 10, 17**: DSL's first attempt has no door to the real exterior at
  all (`entrance.missing`); the JSON version does. Every one of these is a self-
  contained dwelling, so JSON is what the brief meant — DSL's omission is a plain
  authoring gap, not a different building. (Caveat: I added these doors in JSON *because*
  I'd already seen `entrance.missing` fire in DSL — this is the "institutional memory"
  effect flagged above.)
- **Brief 5**: JSON's door carries `"on":{"room":"garage","side":"north"}` to
  disambiguate which of the L-shaped garage's two walls it sits on; DSL's doesn't, and
  fails with `wall.ambiguous` + a cascading `space.no_access` for the office. Same
  building, JSON's is complete.
- **Brief 9**: same entrance gap as above, plus DSL's west/east courtyard doors are
  0.8 m (`door.min_width`, minimum for an outdoor-facing door appears to be 0.9 m); JSON
  widened them. Same building, JSON's is complete.
- **Brief 12**: this is the one *real* topology divergence. DSL wired a hall in a 2×2
  grid to touch all three other rooms — geometrically impossible, since one grid cell
  has at most two neighbours — and failed with `wall.unresolved` (hall/bedroom share no
  wall) plus a cascading `space.no_access`. JSON instead chains `living↔hall`,
  `living↔bedroom`, `hall↔bathroom`, which *is* buildable on that grid. DSL's first
  attempt isn't under-specified here, it's flatly wrong; JSON's is the corrected,
  buildable interpretation of "four rooms on a grid."
- **Brief 16**: DSL wired `kitchen>living` directly, but `utility` sits between them on
  the x-axis — `wall.unresolved` + cascading `space.no_access`. JSON reordered the rooms
  (utility–kitchen–living in a line) so they actually touch. Same intended building,
  JSON's is buildable.
- **Brief 17**: DSL is missing the ground-floor door entirely (`entrance.missing` +
  `space.no_access` on the 2×2 hall). JSON added that door — but the 2×2 hall is so
  small that the new door's swing collides with the stair already crammed into the same
  corner (`door.swing_hits_fixture`, a new warning DSL never had a chance to show).
  Neither version is fully right: the real fix the brief calls for ("stair arriving in
  the corner") needs a slightly bigger hall, not just a door.
- **Briefs 7, 8, 20**: these are the important counter-example to "JSON is just better."
  DSL never got far enough to reveal these because of the level-scoping parse failure,
  but the *underlying geometry is identical in both files* (same rects, same room
  graph), and JSON's run shows it's broken in both: brief 7's loft has no door, only a
  stair (`space.no_access`); briefs 8 and 20's landing/hall is only wide enough to reach
  its immediate neighbour, so `landing↔bed2`, `landing↔bathroom`, and `hall↔kitchen`
  reference rooms that don't share a wall (`wall.unresolved`, cascading into three more
  `space.no_access` errors each). Both syntaxes encode the *same mistake* here; JSON
  just didn't hide it behind an earlier, unrelated failure. Neither file is "what the
  brief meant" for these three — both need a wider landing/hall.
- **Briefs 4, 19**: finding counts match (4=4 both), but the `entrance.multiple` message
  text differs — DSL says "none is marked the main one," JSON says "the main one is
  Living Room" — because I set `"entrance": true` on one JSON door but didn't add the
  bare `entrance` keyword in the DSL file. Same three doors, same rooms, just a leftover
  inconsistency in how carefully I flagged the primary entrance in each file.

## Reference gaps vs my own design mistakes

**Reference gaps** (a fact I needed that neither reference supplied, or that actively
contradicted the tool's real behaviour):

1. `schema-dsl.txt` never enumerates valid room `<kind>` or fixture `<type>` values,
   despite saying "the kind must be a real one." This alone caused 5 of the 18 DSL
   `schema.*` failures (briefs 1, 13, 14×2, 18). `schema.txt`, covering the identical
   underlying model, gives `ROOM_KINDS` and `FIXTURE_TYPES` explicitly — a real, fixable
   asymmetry between the two references for the same domain data.
2. `schema-dsl.txt`'s room-line template shows `[<kind>] [<zone>]` as two bare words,
   but the tool's actual error text says "a zone is written `zone:<z>`" — the reference's
   own grammar line contradicts what the parser expects. I never used `zone` so this
   never bit me directly, but it's a documented inconsistency I noticed via a side
   channel (an unrelated error message), not the reference itself.
3. DSL overloads the word "at" with two different conventions in the same document:
   `at:<x>,<y>` (colon) for door/window absolute placement, vs. bare `at <x>,<y>`
   (no colon) for fixture geometry and for a stair's per-level line. Nothing in the
   reference calls this out; I only got it right by carefully diffing the two grammar
   lines against each other.
4. `schema-dsl.txt` calls `layout` "the one multi-line statement," but the very next
   worked example shows `stairs` also spanning multiple indented lines. Minor internal
   inconsistency.
5. DSL's `room.side` shorthand silently conflicts with an explicit `at:` (see brief 1
   above) — nothing in the grammar states this exclusion. JSON's reference, by contrast,
   states its equivalent constraint explicitly: `oneOf: "on"/"position" xor "at"`. DSL
   has no equivalent stated rule for its shorthand.
6. Neither reference documents whether a room reachable only via a `stairs`/`vertical`
   footprint (no separate door) satisfies the access requirement. Empirically it does
   not (brief 7's loft, `space.no_access`), but this had to be discovered by running the
   tool, not by reading either schema document.
7. DSL's `poly` syntax is described only abstractly ("poly elements": `<x>,<y>` and
   `arc ...`); no worked example shows whether vertices are inline on the entity's single
   line or in an indented block. I inferred "inline" from the document's opening claim
   ("one entity per line") — it worked, but it was a guess, not a citation.
8. JSON's `layout.areas: str[]` is given only as a bare type with zero worked example —
   no indication of whether cells are space- or comma-separated, or how blank/void cells
   are represented. Both syntaxes leave the exact grid-layout encoding to guesswork.

**My own design mistakes** (not the reference's fault):

1. Briefs 7, 8, 20 (DSL): placed a level's doors/windows after the *next* level's
   header line, against the reference's explicit statement-scoping rule. A plain
   ordering slip, avoidable on a careful re-read — but the "no revision" rule means it
   stands as a real first-attempt failure.
2. Brief 5 (DSL): wrote `garage>office` with no `on`, despite my own L-shaped garage
   obviously sharing two wall segments with the office notch — foreseeable from my own
   coordinates.
3. Brief 9 (DSL): no door anywhere to the true exterior, even though a courtyard fully
   enclosed by four rooms cannot reach the street without one of those rooms having its
   own exterior door.
4. Brief 12 (DSL): wired a single grid cell (the hall) as if it could touch three
   neighbours in a 2×2 grid — a geometric impossibility I introduced myself, not a gap
   in the grid documentation.
5. Brief 16 (DSL): modelled kitchen and living room as directly adjacent when utility
   structurally sits between them on the x-axis.
6. Briefs 3, 6, 9, 10, 17 (DSL): no exterior/street door at all — five separate
   instances of forgetting that a habitable dwelling needs a way in.
7. Briefs 8 and 20 (both syntaxes, identical bug): the landing/hall is only as wide as
   its first neighbour, so doors to the second and third room off it reference rooms
   that don't share a wall. This one is genuinely shared between both files (same
   coordinates), not a DSL-only slip — it was just hidden in DSL by an earlier,
   unrelated parse failure.
8. Brief 7 (both syntaxes, identical bug): the loft has no declared door, only a stair.
   Same story — present in both, visible only in JSON.
9. Brief 17 (JSON only): fixing the missing-entrance mistake by adding a door caused its
   swing to collide with the stair already occupying the same tiny 2×2 hall — a new
   mistake introduced while patching an old one, because I never widened the room.

## Token totals

`gpt-tokenizer`'s `encoding/o200k_base` module imported successfully from
`/private/tmp/claude-502/-Users-artur-Projects-floorplans/f6cca19b-471b-4aff-b212-d52c40fe43ac/scratchpad/node_modules`,
so these are real `o200k_base` token counts (not the `wc -c`/4 fallback):

- **DSL total**: 3205 tokens across 20 files (mean 160/file; range 76–325).
- **JSON total**: 7993 tokens across 20 files (mean 400/file; range 195–763).

JSON runs **~2.5×** the token cost of DSL for the same 20 buildings, consistent with
JSON's syntactic overhead (quoted keys, braces, brackets, repeated `"type"`/`"rect"`/
`"kind"` boilerplate) versus DSL's positional, keyword-light lines.

## Verdict, in my own words

**DSL was harder to get right on the first pass, and it wasn't close: 7 of 20 files
failed to parse at all, versus 0 for JSON.** But most of that gap traces to one
*specific*, fixable hole in the DSL reference (no room-kind/fixture-type enum — 5 of 7
failures) plus one *repeated* mistake of my own (level-scoping order — 2 of 7 failures,
briefs 8 and 20; brief 7 is a third instance of the same mistake but I miscounted it
above as its own row — worth restating plainly: three of the seven DSL parse failures
share the identical root cause). Strip those out and the two references are closer to
parity than the raw exit-code table suggests — brief 5's `wall.ambiguous` and brief 12's
`wall.unresolved` are rule-engine findings, not schema failures, and would have shown up
in JSON too had I not already learned to avoid them from the DSL run.

**What made DSL specifically error-prone**: it is a linear, order-sensitive format (a
level's scope runs "until the next one," with no closing marker), and it reuses tokens
with silently different conventions in different contexts (`at:` vs `at`, both spelled
identically as prose but different in the grammar). JSON's nesting makes the level-
scoping mistake structurally hard to make at all, and its explicit `oneOf: ... xor ...`
notes name the exclusion I stumbled into blind in DSL.

**What was unclear in each reference**: for DSL, the single biggest miss is the
undocumented enums — "the kind must be a real one" without saying what "real" means is
exactly the kind of thing that should be a one-line addition (`ROOM_KINDS = ...`) mirroring
what `schema.txt` already has. The second-biggest is the "at" overload — two different
colon conventions for two different uses of the same word, with no explicit callout. For
JSON, the reference is dense but precise; the only real gap is `layout.areas` having
zero worked example, which left me guessing at cell-string format for the one grid-based
brief in both syntaxes.

**What I'd change**: append the `ROOM_KINDS`/`FIXTURE_TYPES` enum line (already written,
verbatim, in `schema.txt`) to `schema-dsl.txt` — this single change would have prevented
5 of the 7 DSL parse failures outright. Second, add one line to the DSL reference stating
explicitly that a level's scope ends at the next `level` line (it's already implied, but
a bold "note: this is positional, not braces" would have made my own mistake much less
likely, especially given I'd have to write this file in one uninterrupted pass with no
chance to catch it before running the linter). Third, give `layout`/`layout.areas` one
worked example in each reference — it's the only element in either schema that ships
with zero example anywhere.
