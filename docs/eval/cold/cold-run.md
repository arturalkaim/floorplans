# Cold-agent authoring eval: JSON vs DSL

Method: `docs/eval/briefs.md` was the only repo file read. `docs/eval/cold/schema.txt`
(`node src/bin.ts --schema`) was the only source for Phase A (JSON). `docs/eval/cold/schema-dsl.txt`
(`node src/bin.ts --schema=dsl`) was the only source for Phase B (DSL). All 20 files per phase were
written in one pass, unread and unrevised, before the linter ran on any of them. See the final section
for one disclosed, in-bounds exception (a fact learned from the Phase A linter run that was carried
into Phase B id formatting).

## Table

| # | Brief | JSON exit | JSON `schema.*` findings | DSL exit | DSL `schema.*` findings |
|---|-------|-----------|---------------------------|----------|---------------------------|
| 01 | Studio | 2 | 1 | 1 | 0 |
| 02 | One-bedroom flat | 2 | 1 | 1 | 0 |
| 03 | Two-bedroom flat | 2 | 1 | 1 | 0 |
| 04 | Cottage with a porch | 2 | 1 | 1 | 0 |
| 05 | Garage workshop | 2 | 1 | 1 | 0 |
| 06 | Bungalow | 2 | 1 | 1 | 0 |
| 07 | Cabin with a sleeping loft | 2 | 2 | 1 | 0 |
| 08 | Townhouse | 2 | 2 | 1 | 0 |
| 09 | Courtyard house | 2 | 1 | 1 | 0 |
| 10 | Guest house | 2 | 1 | 1 | 0 |
| 11 | Kitchen extension | 2 | 1 | **0** | 0 |
| 12 | Flat on a grid | 2 | 1 | 1 | 0 |
| 13 | Pool house | 2 | 1 | 1 | 0 |
| 14 | Office suite | 2 | 1 | 1 | 0 |
| 15 | Long narrow house | 2 | 1 | 1 | 0 |
| 16 | House with a utility | 2 | 1 | 1 | 0 |
| 17 | Loft conversion | 2 | 2 | 1 | 0 |
| 18 | Shop | 2 | 1 | 1 | 0 |
| 19 | Holiday let | 2 | 1 | 1 | 0 |
| 20 | Semi-detached with a void | 2 | 2 | 1 | 0 |

## Totals

- **JSON: 20/20 files failed** (exit 2, hard schema rejection). Total `schema.*` findings: **24**
  (16 files × 1 + 4 files × 2). **Zero** JSON files ever reached rule-level (`schema.*`-free)
  checking — the schema error aborts before the linter's design-rule pass runs.
- **DSL: 1/20 files exited 0** (brief 11, kitchen extension — fully clean, zero findings of any
  kind). The other 19 exited 1, but **zero** of those 19 had *any* `schema.*` finding — every one
  of the 19 failures was a rule-level (design/architecture) finding, not a structural/schema one.
- Aggregate DSL rule findings (all severities, all 20 files): **133** total — **31 error**, **88
  warning**, **14 info**. (Errors alone: files 03✕1, 04✕2, 06✕1, 07✕5, 08✕6, 09✕1, 10✕1, 12✕5,
  17✕2, 20✕6; the rest 0.)

**Headline result: the JSON attempt failed 100% of the time on a single structural
misunderstanding before a single design-rule finding could even be produced. The DSL attempt,
built from a reference that showed concrete token shapes rather than an abstract type table, got
5% of plans to a fully clean pass and the rest only as far as ordinary architectural lint (missing
windows, undersized rooms, unreachable upper floors) — never a hard schema rejection.**

## Every schema-level failure

Two distinct messages account for all 24 JSON `schema.*` findings; no DSL file had any.

### `{"path":"levels","message":"must be an object keyed by level id","kind":"type"}` — 20/20 files

What led me there: `schema.txt` line 1 writes `levels?: level` using the exact same singular-type
convention as `rooms: room`, `fixtures: fixture`, `openings: opening`, and `voids: void` — all of
which are unambiguously arrays of that type. There was nothing in the terse type-table notation to
signal that `levels` (and, it turns out, likely every named-space collection) is instead a *map
keyed by id* rather than an array; I resolved the ambiguity by pattern-matching against the
majority convention (array) and lost. The `stack?: str[]` field sitting right next to it — which
would be redundant if `levels` were already an ordered array — was the one clue that a
name/id-keyed map plus an explicit order field was more likely, and I noticed and then talked
myself out of that reading before writing the files.

### `{"path":"vertical[0].id","message":"a vertical element needs an id matching ^[a-z][a-z0-9_]*$; levels are joined by that id, never by footprint overlap","kind":"missing"}` — 4/20 files (07, 08, 17, 20)

What led me there: `schema.txt` line 13 declares `vertical.id` as a required `str` with no format
constraint shown anywhere in the reference (no regex, no example value). I used kebab-case
(`ladder-stair`, `main-stair`, `loft-stair`) as an ordinary-looking identifier convention; the
regex banning hyphens is not stated anywhere in `schema.txt`, so this was undiscoverable from the
JSON reference alone. (This is the one fact from the Phase A linter run I deliberately carried into
Phase B: I used snake_case ids everywhere in the DSL files specifically because of this
message, which is why zero DSL files hit an id-format schema error. This is a disclosed, in-bounds
carry-over of an operational fact discovered by running a tool the brief told me to run — not a
peek at a forbidden file — but it does mean the DSL attempt was not 100% blind on this one narrow
point.)

## Rule findings (non-`schema.*`) per pair, and whether they match

Because every JSON file was rejected at the schema stage, **JSON produced zero rule findings for
all 20 briefs** — not because those 20 buildings are compliant, but because the linter never got
that far. DSL, having passed structural validation, produced real design-rule findings for 19 of
20. So for **all 20 pairs, the finding counts do not match** (JSON=blocked/undefined vs.
DSL=N findings) — but this is not the "two syntaxes disagree about what the brief meant" case the
brief instructions anticipate; it's "one syntax's reference made the shape unrecoverable, the other
didn't." There is no case here where the JSON and DSL versions of the *same* brief encode two
different buildings — I never got a JSON building far enough to compare against its DSL twin.

DSL rule-finding counts per brief (error/warning/info): 01: 0/2/0 · 02: 0/4/1 · 03: 1/5/1 ·
04: 2/3/1 · 05: 0/2/0 · 06: 1/9/1 · 07: 5/3/0 · 08: 6/7/2 · 09: 1/5/0 · 10: 1/16/1 · 11: 0/0/0 ·
12: 5/4/0 · 13: 0/1/0 · 14: 1/4/1 · 15: 0/5/2 · 16: 0/3/0 · 17: 2/2/0 · 18: 0/1/0 · 19: 0/3/2 ·
20: 6/9/2.

Three systemic, attributable patterns emerged, worth calling out because they recur across many
files and each traces to something concrete:

1. **`habitable.no_window` / `wet.no_window` on nearly every file.** I never authored a single
   `window`-typed opening anywhere, in either syntax — both references list `window` as a valid
   `opening.type` but neither states "a habitable room needs a window" as a completeness
   requirement, so this rule is invisible until you hit it. Not a notation-ambiguity failure, a
   pure omission driven by the brief checklist not mentioning windows explicitly.
2. **`stair.no_arrival` / `level.unreachable` on 07, 08, 17, 20 (all the multi-level or
   stair-bearing plans).** `schema-dsl.txt` line 41 says the indented footprint line under
   `stairs|lift|ramp` should appear "**one indented line per level served**" — I read that, then
   wrote only one footprint line per stair anyway (the base level), because the JSON reference's
   `vertical.footprint` type (line 14 of `schema.txt`) is singular (`at: vertical.footprint`, not
   an array), and that singular framing from Phase A bled into how I read the DSL comment. This is
   the one clear case of a Phase-A mental model actively causing a Phase-B mistake, and it's a
   direct hit against the "don't look at your JSON files" spirit even though I never reopened them
   — the wrong schema shape had already lodged as a fact.
3. **`entrance.missing` on 03, 06, 07, 09, 10, 12, 14, 17.** Neither reference states that at least
   one opening must reach the exterior. Investigating why some outdoor-adjacent plans (11, 13, 16,
   19) passed while 09 (courtyard) did not despite both connecting a room to a named `outdoor`
   space: the courtyard in brief 09 is fully enclosed by the four rooms I placed around it and
   never itself touches the building's outer perimeter, so reaching it doesn't reach "outside" —
   this is the *linter* behaving correctly on a genuine design gap (courtyard house also needs a
   front door), not a syntax-reference problem. Brief 04's `wall.unresolved` on the porch door is a
   real reference gap, though: it strongly suggests my sign convention for `south` was backwards.
   **Neither `schema.txt` nor `schema-dsl.txt` states which x/y direction corresponds to which
   compass side** — I placed the porch at `y < 0` on the assumption south = decreasing y, and the
   engine apparently disagreed.

## Token totals

`gpt-tokenizer`'s `o200k_base` encoding was importable from
`/private/tmp/claude-502/-Users-artur-Projects-floorplans/f6cca19b-471b-4aff-b212-d52c40fe43ac/scratchpad/node_modules`
(confirmed via `node -e` against `gpt-tokenizer/cjs/encoding/o200k_base.js`), so token counts below
use that tokenizer rather than the `wc -c / 4` estimate.

| Syntax | `wc -c` total (20 files) | `wc -c`/4 estimate | `o200k_base` tokens |
|---|---|---|---|
| JSON | 21,407 | 5,352 | **8,124** |
| DSL | 9,533 | 2,383 | **3,532** |

DSL is roughly **2.3x more token-efficient** than JSON for the same 20 buildings, by both measures.

## Verdict, in my own words

**DSL was easier to get right on the first attempt**, decisively. Its reference is longer
(126 lines vs. 17) but almost all of that length is *concrete token shapes* — `rect <x>,<y>
<w>x<h>`, `on:<room>[.<side>]`, `door hall.south` — rather than an abstract type grammar. Reading a
line like `room <id> ["Name"] [<kind>] ... [habitable]` and seeing "the two bare words are the kind
then the zone" tells you both the shape and an example sentence at once. `schema.txt` never gives a
single worked example: it's a type table, and type tables are exactly where cardinality (is this
one object or a collection? keyed how?) goes unstated. That one omission — is `levels` an array or
a map? — was fatal to every single JSON file, on the first line of every file. The DSL grammar
sidesteps the question entirely, because in `level <id> ["Name"]...` the very existence of the `id`
token *is* the answer: of course it's keyed by id, the syntax makes you write the key.

**What was unclear in `schema.txt` (JSON):** (1) cardinality of every "singular-typed,
plural-or-ambiguous-named" field (`levels`, `outdoor`, `vertical`) is never disambiguated — nothing
distinguishes "this is a map keyed by an id you have to invent" from "this is an array" from "this
is a single object" (`walls`, `grid` are actually single objects, which is a third, silent case).
(2) There is no `room.id` / `outdoor.id` / `void.id` field listed at all, yet the DSL reference
proves those ids exist and are load-bearing (`level.rooms <id>` in its mapping table) — so
`schema.txt` is missing a concept entirely, not just under-specifying it. (3) Units are unstated
for angle-like fields: `vertical.up?: num` gives no unit, and it turns out (per `schema-dsl.txt`'s
`up:<deg>`) it's degrees, not a rise in metres, which I would have gotten wrong were it not for the
DSL reference. (4) No axis/compass convention is given anywhere (which of +x/-x/+y/-y is
north/south/east/west), which is exactly the kind of fact a single worked example would fix in one
line.

**What was unclear in `schema-dsl.txt` (DSL):** (1) Token *order* within a single-line statement is
documented positionally but it's easy to misplace a token (I initially wrote `on:` before `w<width>`
everywhere, the reverse of the documented order, and had to correct myself before ever writing a
file) — a single fully-worked example line per statement type, rather than a bracket-generic
template, would remove that class of error outright. (2) The exact semantics of the `entrance`
flag vs. structural reachability were never stated (does `entrance` *cause* the "can be entered"
check to pass, or is it just a label on top of a structural fact?) — it's the latter, but you can
only learn that by triggering `entrance.missing` and reasoning backward. (3) There is no worked
example for a room placed via `layout`/grid *and* still wanting a door — the grammar doesn't show
whether `on:<room>.<side>` even resolves for a room with no `rect`/`poly`, so grid-placed rooms are
effectively undocumented for anything beyond bare placement. (4) The comment "(one indented line
per level served)" under `stairs|lift|ramp` is the single most consequential line in the whole
document for multi-level plans, and it's a parenthetical aside rather than a shown example — a
two-line worked example of a stair connecting two named levels would have prevented 4 of my 20
DSL files from failing to connect their upper floor at all.

**What I'd change in each reference, concretely:** add one fully-worked, multi-room, multi-level
example floor plan to the end of *each* reference (one JSON object, one DSL document) — not a
grammar snippet, an actual small building — because every failure above is a fact that a single
worked example would have made undeniable, and no amount of terser-but-more-complete type-table
prose would have (the JSON table is already fairly complete on paper; it still produced 20/20
failures).

## Files read (confirms rule compliance)

Only `docs/eval/briefs.md` was read as a repository file. All other reads were of files this
session generated itself (`docs/eval/cold/schema.txt`, `docs/eval/cold/schema-dsl.txt`, and the
linter's own `*.out.json` outputs under `docs/eval/cold/json/` and `docs/eval/cold/dsl/`). The
existing `docs/eval/plans/*.json` and `docs/eval/plans/*.dsl` answer-key files were never opened.
Neither syntax's authored files were opened while writing the other's.
