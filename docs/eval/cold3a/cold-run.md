# Cold-agent authoring eval — run cold3a (JSON first)

Commit base: `3d3a9da` (merged into worktree at `93eed9a..3d3a9da`, `feature/artur_courtyards-and-fixtures`).
Files read: `docs/eval/briefs.md`, `docs/eval/cold3a/rules.txt` (from `--rules`), `docs/eval/cold3a/schema.txt` (from `--schema`), `docs/eval/cold3a/schema-dsl.txt` (from `--schema=dsl`). No other repo file was opened. JSON files were not reopened while writing DSL, or vice versa.

## Table

| # | Brief | JSON exit | JSON `schema.*` | DSL exit | DSL `schema.*` |
|---|-------|-----------|------------------|----------|----------------|
| 01 | Studio | 1 | 0 | 1 | 0 |
| 02 | One-bedroom flat | 1 | 0 | 1 | 0 |
| 03 | Two-bedroom flat | 1 | 0 | 1 | 0 |
| 04 | Cottage with a porch | 1 | 0 | 1 | 0 |
| 05 | Garage workshop | 1 | 0 | 1 | 0 |
| 06 | Bungalow | 1 | 0 | 1 | 0 |
| 07 | Cabin with a sleeping loft | 1 | 0 | **2** | **5** |
| 08 | Townhouse | 1 | 0 | **2** | **18** |
| 09 | Courtyard house | 1 | 0 | 1 | 0 |
| 10 | Guest house | 1 | 0 | 1 | 0 |
| 11 | Kitchen extension | 1 | 0 | 1 | 0 |
| 12 | Flat on a grid | 1 | 0 | 1 | 0 |
| 13 | Pool house | 0 | 0 | 0 | 0 |
| 14 | Office suite | 1 | 0 | 1 | 0 |
| 15 | Long narrow house | 1 | 0 | 1 | 0 |
| 16 | House with a utility | 0 | 0 | 0 | 0 |
| 17 | Loft conversion | 1 | 0 | 1 | 0 |
| 18 | Shop | 1 | 0 | 1 | 0 |
| 19 | Holiday let | 1 | 0 | 1 | 0 |
| 20 | Semi-detached with a void | 1 | 0 | **2** | **16** |

Exit code convention observed empirically (not documented anywhere I read): `0` when the only findings are `info`-severity; `1` when any `error`- or `warning`-severity rule finding exists; `2` when the document fails to *parse* at all (a document-level syntax error, returned as `{"error":{"issues":[...]}}` instead of `{"summary":...,"findings":...}`).

## Totals

- **JSON**: 20/20 files parsed and linted. **0 `schema.*` findings** across all 20 files (verified by `grep -o '"rule":"schema\.[a-z_]*"'` over every `*.out.json` — zero matches). Total non-schema findings: 14 error + 58 warning + 22 info = 94, across 20 files.
- **DSL**: 17/20 files parsed and linted with **0 `schema.*` findings**, and their findings are byte-for-byte identical in rule/message/coordinates to the matching JSON file (see "Non-schema findings" below). **3/20 files failed to parse** (briefs 07, 08, 20) with a total of **39 syntax issues** (5 + 18 + 16) — every one of them the identical message template, one per indented line.
- **First-attempt pass rate on `schema.*`**: JSON 20/20 (100%). DSL 17/20 (85%) parsed at all; of those, 17/17 had 0 `schema.*` findings. Counting the 3 parse failures as `schema.*`-equivalent failures (a document-level syntax error is the DSL analogue of JSON's `schema.syntax`), DSL's effective pass rate is **17/20 (85%)**.

## Schema.\* / syntax failures — exact messages and cause

JSON produced no `schema.*` findings, so this section is entirely about the three DSL parse failures.

**Brief 07 (`docs/eval/cold3a/dsl/07.dsl`) — 5 syntax issues:**
```
line 4: an indented line continues the statement above it, and there is no statement above this one
line 5: an indented line continues the statement above it, and there is no statement above this one
line 6: an indented line continues the statement above it, and there is no statement above this one
line 9: an indented line continues the statement above it, and there is no statement above this one
line 10: an indented line continues the statement above it, and there is no statement above this one
```
Lines 4-6 are `room main ...`, `door main.south ...`, `window main.north ...` — the statements I indented two spaces under `level ground h2.6 ground`. Lines 9-10 are the equivalent lines under `level loft h1.9`.

**Brief 08 (`docs/eval/cold3a/dsl/08.dsl`) — 18 syntax issues** on every indented line under both `level ground` and `level upper` (lines 4-11, 14-23) — same cause, larger level bodies.

**Brief 20 (`docs/eval/cold3a/dsl/20.dsl`) — 16 syntax issues** on every indented line under `level ground` and `level upper` (lines 4-11, 14-21) — same cause. Note: this file's `stairs stair1 ...` block at the end, which is *also* indented the same way, did not error — because by that point the parser had already dropped every indented statement in the file (it never advances past `level`, so the trailing `stairs` block was likely folded into whatever the last accepted top-level statement was, or itself continues nothing at that point — the linter output only reports the 16 lines it flagged, so I cannot confirm without opening the file, which the brief forbids me from doing now).

**What in the reference led me to write it that way**: `schema-dsl.txt` lines 19-25 document the `level` statement as: *"a storey header: statements belong to the most recent level line, until the next one"* — a purely sequential/positional rule, no indentation implied. But immediately above that sentence, the reference's own worked example for `level` is rendered with the follow-on statements visually indented under the `level` line:
```
e.g. level ground
     room hall rect 0,0 2x2
     door hall.south w0.9 entrance
     level first
     room bed rect 0,0 3x3
```
I treated that visual indentation as if it were syntactically load-bearing — consistent with how `layout` (line 36-37: *"one indented row per grid row"*) and `stairs`/`vertical` (line 51: *"one indented line per level served"*) explicitly require indentation for their sub-lines. The reference never states that indentation is *cosmetic* for `level` specifically while being *mandatory* for `layout`/`stairs`; it uses the same visual device for both cases, and only the surrounding prose (which I under-weighted against the picture) actually disambiguates them. Every other indented block I wrote (the `layout` grid rows in brief 12, and the `stairs`/`vertical` `at` lines in briefs 07/08/20) parsed without complaint — it was specifically the `level`-body indentation that broke, confirming the rule is real: indentation is a continuation marker everywhere, and `level` scoping is purely sequential with no indentation at all.

## Non-schema.\* rule findings — per pair, do counts match

For the 17 pairs where DSL parsed (all except 07, 08, 20), I compared every finding's `rule`, `message`, `at`, and coordinates between the JSON and DSL output for the same brief. **All 17 pairs match exactly** — same rule, same message text, same coordinates, same counts (the DSL output additionally carries a `line` field the JSON output doesn't, which is the only difference). This is strong evidence the two documents describe the *same building* in each case, since the linter's geometry/adjacency/fixture-placement analysis produced identical results from independently authored (though not independently *designed* — see carryover note below) text.

Per-brief total findings (error+warning+info, JSON = DSL for these 17):
- 01: 5, 02: 7, 03: 4, 04: 5, 05: 1, 06: 4, 09: 10, 10: 13, 11: 1, 12: 3, 13: 0, 14: 5, 15: 5, 16: 2, 17: 2, 18: 1, 19: 4.

For briefs 07, 08, 20, no comparison is possible — DSL never reached the semantic linter, so there is no "different building" question, only "no building at all."

## Reference gaps vs. my own mistakes

**Reference gaps** (facts I needed that neither `schema.txt`/`schema-dsl.txt` nor `rules.txt` stated, and I had to infer from the one worked example each reference provided):

1. **Single-level shorthand isn't in the grammar.** `schema.txt`'s `plan` grammar line lists only `title?, units?, walls?, north?, stack?, levels?, vertical?, grid?` — no `rooms`, `outdoor`, `openings`, `fixtures`. Yet the worked JSON example puts `rooms`/`outdoor`/`openings` directly on the root object with no `levels` wrapper at all. I inferred (and used throughout, for every single-level plan) that a plan with no `levels` behaves as one implicit level, taking a `level`'s body keys directly. This isn't stated anywhere, only demonstrated. The DSL reference has the same gap in reverse direction (a `level` header is optional per its own grammar line, and the full example never uses one) — but the DSL text is more explicit here ("a plan may have no plan line at all" / statements belong to levels sequentially), so this gap is JSON-specific.
2. **`position`'s shape is inconsistent between grammar and example (JSON).** `schema.txt` line 13/15 declares `opening.position { from: str; distance: num }` — an object. But the worked example uses `"position": 2.5` (a bare number) whenever `"on"` is also present, and only uses the `{from,distance}` object form when `"on"` is absent. Neither the grammar text nor prose explains this split; I had to infer "bare number when paired with `on`, object form otherwise" purely from the four `position`-using lines in the one example.
3. **DSL indentation semantics for `level`** — covered in detail above; the decisive gap of this run, since it cost 3/20 first-attempt DSL files a parse failure.
4. **`plan.grid` / DSL `grid cols... rows...`'s relationship to a level's own `layout cols/rows` is never explained.** Both exist as separate constructs; `layout` is fully self-contained (its own `cols`/`rows`), so I could not determine what the plan-level `grid` adds, and left it unused in every file rather than guess.
5. **Default anchor when an opening's position is omitted** (e.g. `window sala.west w1.2` with no `@d`/`position`) is never stated — I assumed "centered on the wall," matching the *visual* implication of the one example but never verified.
6. **The anchor corner for a bare `@d`/numeric `position`** (measured from which end of the wall) is never stated; I assumed "from the axis-lower (west/north) corner of that wall," consistent with the `{from:"start",distance}` naming convention but not confirmed against a case where it mattered.

**My own mistakes** (not reference gaps — the reference had the answer, I misapplied it):

1. The `level`-indentation failure above is arguably half gap, half my own over-reading of a cosmetic example as prescriptive syntax — I've counted it as a gap since the text and the example genuinely point in different directions, but a more skeptical reading of "statements belong to the most recent level line" (a purely sequential description with no mention of layout) should have warned me off indenting.
2. Room-kind substitutions (`other` for "shop floor", "reception", "changing room", "loft's main room") were my judgment calls mapping brief vocabulary onto a fully-specified `ROOM_KINDS` enum — not a gap, since the enum was complete and `other` is a valid documented member.
3. Numerous `room.min_dimension`, `fixture.clearance`, `habitable.no_window`, `entrance.missing`/`entrance.multiple`, `wet.no_window`, `privacy.bedroom_off_living` etc. findings across both syntaxes reflect genuine under-sizing/design choices on my part (e.g. bedrooms/offices drawn smaller than the linter's comfort minimums, a loft conversion with no street door at all since the brief only describes the upper room). These are real design shortcomings, not syntax problems, and — being non-`schema.*` — were out of scope for "first-attempt correctness" but are worth naming since they show the linter checking real building-quality constraints beyond the schema.

## What Phase A taught me that carried into Phase B

Per the brief's note that JSON-first knowledge would leak into DSL authoring, here is what carried over (all of it *semantic/geometric* knowledge gained from the Phase A linter runs, not text copied from the JSON files, which I never reopened):
- The `walls: {"exterior":0.2,"partition":0.1}` convention from the JSON example produced no complaints, so I reused the identical `0.2/0.1` thicknesses in every DSL `plan` line without re-deriving them.
- Confirmation that abutting rectangles sharing exact boundary coordinates tile without `tiling.gap`/`tiling.overlap` findings — I reused the same room-by-room coordinate scheme in DSL rather than re-deriving tilings from scratch.
- Confirmation that small vertical-element footprints (e.g. a 0.4×0.4 m ladder "stair" or a 1.1×2.2 m stair run) placed inside the named `in:` room don't trigger `stair.no_arrival` — I reused the same footprint rectangles in the DSL `stairs ... at` blocks.
- Confirmation that `layout.areas` with a repeated id merges cells into one region (brief 12) — I reused the exact same `cols`/`rows`/area-grid numbers translating straight into DSL `layout` syntax.
- Confirmation that poly winding order for the L-shaped rooms (garage, courtyard-house rooms) produced valid, non-`schema.geometry` shapes — I reused the identical vertex lists in DSL `poly` lines.
- Awareness (from the JSON run's warnings) of exactly which rooms were under-sized or under-windowed — I did not fix these in DSL (out of scope, and the brief prohibits revising after writing), but I recognized the DSL `room.min_dimension`/`habitable.no_window` findings as expected repeats rather than new bugs when I saw them.

None of this carryover touched `schema.*` correctness directly (Phase A had zero schema findings to learn from there); it was entirely "which geometric idioms are safe," which is exactly the kind of knowledge that should *not* leak in a truly cold syntax comparison, but unavoidably does when the same agent authors both in one sitting from the same briefs.

## Token totals

`gpt-tokenizer`'s `o200k_base` encoding was importable from `/private/tmp/claude-502/-Users-artur-Projects-floorplans/f6cca19b-471b-4aff-b212-d52c40fe43ac/scratchpad/node_modules/gpt-tokenizer/esm/encoding/o200k_base.js` (found under `esm/encoding/`, not `esm/model/` as I first guessed) and was used directly — no `wc -c`/4 fallback needed.

- **JSON** (20 authored `nn.json` files, excluding `.out.json` linter outputs): **10,751 tokens**.
- **DSL** (20 authored `nn.dsl` files): **4,678 tokens**.
- DSL is **43.5%** of JSON's token count for the same 20 buildings — largely because JSON's per-object key/brace/quote overhead (`{"type":"door","between":[...],"width":...}`) is replaced by DSL's single-line `door a>b w0.9` form, and JSON's `{"room":..,"side":..}` nesting collapses to a `room.side` token.

## Verdict

**DSL was harder to get exactly right on the first attempt**, purely because of one indentation ambiguity that cost 3 of 20 files a total parse failure (15% of the DSL set), versus 0 of 20 for JSON. Excluding that one issue, the two syntaxes were equally easy to get schema-correct — every semantic rule finding (room sizing, fixture clearance, missing windows, entrance rules) that showed up in JSON showed up identically in the 17 DSL files that did parse, meaning the underlying design mistakes were mine, not syntax-induced, and both formats surfaced them identically once parsed.

What was unclear in `schema.txt` (JSON): the split between the declared `opening.position` object grammar and the example's bare-number usage when paired with `on`; and the plan-vs-level key merging for single-level plans (not documented, only demonstrated).

What was unclear in `schema-dsl.txt` (DSL): whether `level`-body statements need to be indented — the prose says no (pure sequential scoping), the one worked example visually suggests yes, and only the parser's actual behavior settles it (no indentation, ever, for `level` scoping — indentation is exclusively a line-continuation device for `layout` rows and `stairs`/`vertical` `at` lines). This single ambiguity was the entire difference between the two syntaxes' first-attempt pass rates in this run.

What I would change in the references: state explicitly, next to the `level` grammar line, "statements are not indented under `level` — indentation only continues `layout`/`stairs` sub-lines" (one sentence would have prevented all 3 DSL failures); and either fix `opening.position`'s grammar to show both accepted shapes, or drop the object form from the worked example if it's legacy.

## Confirmation of what was read

Files read this session: `docs/eval/briefs.md`, `docs/eval/cold3a/rules.txt`, `docs/eval/cold3a/schema.txt`, `docs/eval/cold3a/schema-dsl.txt`, and the linter's own `*.out.json` outputs I generated. No file under `src/`, `fixtures/`, `test/`, `docs/` (other than `briefs.md` and my own generated references), or `app/` was opened. `docs/eval/cold/` and `docs/eval/cold2/` were never opened. JSON files were not reopened while authoring DSL files, and vice versa (I verified each JSON file's Write result without a follow-up Read, and used working memory of my own prior design decisions — not file contents — for DSL authoring, which is disclosed above as the "carryover" section since the brief specifically asked for it).
