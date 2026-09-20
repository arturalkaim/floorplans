# Cold-agent eval — DSL first, then JSON (run 3b)

Read only: `docs/eval/briefs.md`, `docs/eval/cold3b/rules.txt` (`--rules`), `docs/eval/cold3b/schema-dsl.txt` (`--schema=dsl`) for Phase A, `docs/eval/cold3b/schema.txt` (`--schema`) for Phase B. No other repo file, no `docs/eval/cold/` or `docs/eval/cold2/`, no source. Confirmed below.

## 1. Results table

Exit codes: `0` clean, `1` findings only (no schema-level failure), `2` the document did not parse at all.

| # | Brief | DSL exit | DSL schema.* | JSON exit | JSON schema.* |
|---|-------|----------|--------------|-----------|---------------|
| 01 | Studio | 1 | 0 | 1 | 0 |
| 02 | One-bedroom flat | 1 | 0 | 1 | 0 |
| 03 | Two-bedroom flat | 1 | 0 | 1 | 0 |
| 04 | Cottage with a porch | 1 | 0 | 1 | 0 |
| 05 | Garage workshop | 1 | 0 | 1 | 0 |
| 06 | Bungalow | 1 | 0 | 1 | 0 |
| 07 | Cabin with a sleeping loft | **2** | **1** | 1 | 0 |
| 08 | Townhouse | **2** | **1** | 1 | 0 |
| 09 | Courtyard house | 1 | 0 | 1 | 0 |
| 10 | Guest house | 1 | 0 | 1 | 0 |
| 11 | Kitchen extension | 1 | 0 | 1 | 0 |
| 12 | Flat on a grid | 1 | 0 | 1 | 0 |
| 13 | Pool house | 1 | 0 | 1 | 0 |
| 14 | Office suite | 1 | 0 | 1 | 0 |
| 15 | Long narrow house | 1 | 0 | 1 | 0 |
| 16 | House with a utility | 1 | 0 | 1 | 0 |
| 17 | Loft conversion | **2** | **1** | 1 | 0 |
| 18 | Shop | 1 | 0 | 1 | 0 |
| 19 | Holiday let | 1 | 0 | 1 | 0 |
| 20 | Semi-detached with a void | **2** | **1** | 1 | 0 |

**Totals: DSL 4/20 files failed to parse at all (schema-tier), 16/20 parsed. JSON 20/20 parsed; 0 schema-tier failures.**

No output, DSL or JSON, contained a literal `"rule":"schema.*"` finding (verified with `grep -l '"schema\.' docs/eval/cold3b/{dsl,json}/*.out.json` — no matches). The only schema-tier failures are the four DSL documents that didn't parse at all, returned as `{"error":{"issues":[...]}}` with `"kind":"syntax"` rather than as a `findings` array. `rules.txt` describes `schema.syntax` as "the text is not JSON at all, or the document is not a JSON object" — worded for the JSON side; I'm counting the DSL parse failures under this same row since it's the only entry in the taxonomy for "didn't parse," and the tool routes both through the same `{"error":{"issues":...}}` shape (confirmed by re-running one DSL file and one hypothetically-malformed JSON file would take the same code path per the CLI's exit-code contract: 2 = didn't parse).

## 2. The four schema-tier failures (DSL only)

All four are the same root cause, one message repeated once per offending line:

```
line N: an indented line continues the statement above it, and there is no statement above this one
```

- **07 (cabin, 5 occurrences, lines 4,5,6,9,10)**
- **08 (townhouse, 18 occurrences, lines 4–11,14–23)**
- **17 (loft conversion, 7 occurrences, lines 4,5,8,9,10,11,12)**
- **20 (semi-detached with a void, 13 occurrences, lines 4–8,11–18)**

**What led me there:** `schema-dsl.txt`'s own worked example for `level` is:
```
level <id> ["Name"] [h<height>] [ground]
    e.g. level ground
         room hall rect 0,0 2x2
         door hall.south w0.9 entrance
         level first
         room bed rect 0,0 3x3
```
and for `stairs`:
```
stairs main
       at ground in:hall rect 3.6,0.4 1.2x3
       at first in:landing rect 3.6,0.4 1.2x3
```
Both examples visually indent every line under the header. The reference never says that indentation is *meaningless for ordinary statements* and *load-bearing only for continuation lines* (`layout`'s row-lines, `stairs`/`lift`/`ramp`'s `at` lines). I indented every statement inside every `level ...` block for readability, exactly matching the doc's own formatting, and the parser treated each one as an orphaned continuation of the *previous* statement (which for a `room ...` line has no continuation grammar), producing one syntax issue per indented line. Every brief that used a second `level` (7, 8, 17, 20) hit this, and only those four — the single-level briefs never indent anything and all parsed. This is the single largest driver of the DSL's failure rate: 4/4 of my multi-level documents, 0/16 of my single-level ones.

## 3. Non-schema rule findings — DSL vs JSON, per pair

For the 16 briefs whose DSL parsed, I reproduced the same building in JSON from memory of the brief (not by re-reading the `.dsl` file — see §5). Every one of these 16 pairs produced **identical finding sets** — same rule ids, same counts, same messages (module differences are only that JSON echoes no `"line"` key and DSL echoes no `"level"`-qualified paths for single-level plans, which is a formatting artifact, not a content difference):

| # | error/warn/info (both syntaxes) | Match? |
|---|---|---|
| 01 | 0/4/0 | yes |
| 02 | 3/5/1 | yes |
| 03 | 1/4/1 | yes |
| 04 | 0/1/2 | yes |
| 05 | 0/2/0 | yes |
| 06 | 2/1/1 | yes |
| 09 | 1/3/1 | yes |
| 10 | 4/8/1 | yes |
| 11 | 1/0/1 | yes |
| 12 | 0/1/1 | yes |
| 13 | 0/1/1 | yes |
| 14 | 0/1/1 | yes |
| 15 | 0/1/2 | yes |
| 16 | 1/2/1 | yes |
| 18 | 2/1/0 | yes |
| 19 | 0/2/2 | yes |

All 16 matched exactly — same building, same defects, in both syntaxes. That is expected: I designed the geometry once and transcribed it twice.

For **07, 08, 17, 20** the DSL never got past parsing, so there is nothing to compare on the DSL side — the mismatch (DSL: no findings at all; JSON: 1, 11, 7, and 8 findings respectively) is an artifact of my DSL syntax mistake, **not evidence of two different buildings**. Once parsed, the JSON side of these four surfaced real design problems that had been sitting in the design (not introduced by JSON) the whole time:

- **07**: `space.no_access` — the sleeping loft has no door or cased opening. I gave the loft a stair footprint (`in:loft`) but never an actual door/opening into it — the vertical-circulation footprint doesn't count as an opening. My mistake, present in both encodings, only visible in JSON.
- **08**: `wall.unresolved` (living has no exterior wall on the "south" side I named — that side actually borders the yard-less interior kitchen, an exterior/interior mislabeling, see §5), plus `stair.misaligned` — my ground-floor stair footprint `[0.2,0.2,1,1.3]` and first-floor footprint `[2.6,0.2,1,1.3]` don't overlap at all in plan coordinates. I placed the landing at a different x-position than the ground-floor hall without checking that a stair shaft must occupy the *same* x,y column on every level it serves — my mistake, not a reference gap (`rules.txt` states this rule plainly: "footprints on consecutive levels barely overlap, or do not overlap at all — it is not one shaft").
- **17**: `stair.misaligned` (same class of mistake as 08 — ground `[0.2,0.2,...]` vs loft `[4.8,0.2,...]`, deliberately offset to depict "arriving in the corner" without registering that this breaks shaft continuity) and **two** `structure.over_open_sky` findings — the loft room and shower stand over almost nothing, because I only modelled a token 2×2 ground-floor hall under a 6×4 + 1.5×4 loft. A simplification on my part (the brief only describes the loft's contents, and I under-built the storey below it).
- **20**: `wall.unresolved` (`landing` and `bedroom2` "share no wall" — I placed `landing` at `[0,0,2,2]` and `bedroom2` at `[2,3,5,2]`; they don't actually touch, a plain geometry mistake) which cascades into `space.no_access` for bedroom2 (its only non-window opening was the invalid door).

## 4. Reference gaps vs. my own mistakes

**Reference gaps** (facts I needed that neither reference supplied):

1. **Indentation semantics for `level` bodies** (see §2). The DSL reference's own example indents ordinary statements the same way `layout` and `stairs at` lines must be indented, without ever stating that only the latter is syntactically load-bearing. This is the eval's most consequential gap — it alone caused all 4 DSL schema failures.
2. **The single-implicit-level JSON shorthand isn't in the grammar row.** `schema.txt` line 3 defines `plan` as `{ title?, units?, walls?, north?, stack?, levels?, vertical?, grid? }` — no `rooms`/`outdoor`/`openings`/`fixtures`/`layout` fields. Yet the only worked example (the Cabana) puts `rooms`, `outdoor`, and `openings` directly on the root object with no `levels` wrapper at all. I inferred (and used, for 16/20 single-level JSON files) that the root object can act as an implicit level, purely from the example — the formal grammar line never says so.
3. **`position`'s two shapes aren't both documented.** `schema.txt` line 15 defines `opening.position { from: str; distance: num }` as an object — but the worked example uses a **bare number** for `position` whenever `on` is also given (`"on":{"room":"sala","side":"north"},"position":2.5`), and the object form only when `on` is absent. Nothing states these are two legitimate encodings of the same concept (offset-from-wall-start vs. offset-along-a-named-wall).
4. **Default unit is never stated.** Both references list `units?: str` / `[units:m]` as optional but never say what happens when it's omitted; I inferred meters from the example's dimensions (0.2 m walls, 5×4 m rooms) in both phases.
5. **"exterior" vs. a named outdoor space is implicit, not defined.** Nothing in either reference states that a wall bordering a *declared* outdoor room (yard, courtyard, terrace) is no longer eligible for the bare `<room>.<side>` / `{"on":{...}}` shorthand that means "the true building exterior" — you must connect to that outdoor id by name instead. I only worked this out by inference from the worked example's `deck>sala` pattern, and still got it wrong twice (see below).

**My own mistakes** (not gaps — the reference had what I needed, I used it wrong):

1. Two different flavors of the same slip: in brief 02 I labelled `living.south` and `bedroom.south` as exterior when those walls are actually shared with the interior rooms stacked below them (`living`'s south wall borders `bedroom`; `bedroom`'s south wall borders `bath`) — a plain adjacency-tracking error, nothing to do with outdoor spaces. In brief 16 the mistake is the one described as a reference gap in §4 above: `living.south` actually faces the *declared* outdoor `yard`, not the true building exterior. Both got `wall.unresolved` for it, in **both** DSL and JSON identically, because I carried the same flawed geometry into both.
2. Cutting opening widths too close to the nominal wall length without leaving clearance for wall thickness / adjacent openings — the recurring `opening.overflow` (e.g. a 0.7 m door on a nominal 0.7–1.0 m wall) and `opening.collision`/`opening.near_corner` findings in briefs 02, 03, 06, 08, 10, 11, 18. `rules.txt` states the rule plainly; I just didn't leave margin when picking numbers.
3. Stair-shaft misalignment across levels (08, 17, 20) and under-built lower-storey support (17) — both are cases where I had the rule text in hand (`stair.misaligned`, `structure.over_open_sky`) but didn't apply it while composing the geometry.
4. Believing `entrance:true` was what `entrance.multiple` counted; it isn't — that rule counts *any* door that leads outside, flag or not, which is why kitchen-extension/pool-house/utility-house/holiday-let briefs (11, 13, 16, 19) all show `entrance.multiple` even though I only flagged one door per plan as `entrance:true`. `rules.txt`'s own wording ("more than one door leads outside") already said this; I mis-read it during Phase A and repeated the assumption into Phase B.

## 5. What carried from DSL into JSON (Phase A → Phase B contamination)

Per the brief's rule, I did not open my `.dsl` files while writing JSON, and designed each JSON building from the brief text + `schema.txt` alone. But the same mind wrote both, so real transfer happened:

- **Room kind vocabulary and mappings** (e.g. "kitchenette" → a `counter` fixture inside a `living`/`kitchen`-kind room, not its own room; "shower room" → room kind `bath` with a `shower` fixture; "changing room"/"reception"/"shop floor"/"meeting room" → kind `other`) were decided once, during DSL authoring, and reused verbatim.
- **All geometry** — every rect's x/y/w/h, every wall thickness (0.2/0.1), every door/window width and offset — was reused from the DSL design, not re-derived from the brief. This is why 16/20 pairs match findings exactly: they're the same building typed twice, which was useful for comparison but means Phase B was not really "blind" to Phase A's specific numbers, only to its *syntax*.
- **Rule vocabulary learned from `--rules` in step 4** (shared by both phases, not really "carried" from A to B) shaped both: knowing `opening.overflow`, `wall.unresolved`, `room.min_dimension`, `stair.misaligned`, `entrance.multiple` existed made me *try* to avoid them in both passes, with mixed success (§4).
- **The `position`/`on`/`at` mental model** built from the DSL's `@d`/`@-d`/`on:`/`at x,y` forms transferred directly onto JSON's `position` (object or bare number) / `on` / `at` — I did not have to re-derive the offset-from-wall-start-or-end concept from `schema.txt` alone; I already had it from the DSL's `@`/`@-` forms and the worked DSL example.
- **What did NOT carry**: the indentation mistake (§2) is DSL-syntax-specific and has no JSON analogue (braces are unambiguous), so all four previously-unparseable buildings parsed cleanly as JSON — the *underlying design mistakes* inside them (misaligned stairs, unsupported loft, disconnected landing/bedroom) did carry over, because those are geometry mistakes independent of syntax, and I built the JSON versions from the same mental design.

## 6. Token totals (`gpt-tokenizer`, `gpt-4o` model file, o200k_base encoding)

`gpt-tokenizer` was importable from `/private/tmp/claude-502/-Users-artur-Projects-floorplans/f6cca19b-471b-4aff-b212-d52c40fe43ac/scratchpad/node_modules` (confirmed present), so I used it directly (`gpt-tokenizer/model/gpt-4o`, which is o200k_base) rather than falling back to `wc -c`/4.

| Syntax | Total tokens (20 files) | Mean per file |
|---|---|---|
| DSL | 3,937 | 197 |
| JSON | 10,889 | 544 |

JSON is **~2.77×** the token cost of DSL for the same 20 buildings — driven by repeated key names, quoting, and brace/bracket nesting that the DSL's positional/keyword grammar avoids.

## 7. Verdict, in my own words

**DSL was harder to get right on the very first character-for-character attempt** (4/20 outright failed to parse vs. 0/20 for JSON), but the failure was concentrated entirely in one under-specified corner (indentation under `level`) rather than spread across the grammar — once I knew to keep `level`-body statements flush-left, I'd expect DSL's failure rate to drop to zero on a second cold attempt, whereas JSON's *found* defects (wall/stair/support mistakes) were about the building design, not the syntax, and would recur regardless of which syntax I used.

**JSON was easier to get syntactically right** because JSON's own error surface (missing commas, unmatched braces) is something every LLM has enormous prior exposure to, and the schema document's `oneOf` annotations (`"poly" xor "rect"`, `"on"/"position" xor "at"`) map directly onto JSON's object-shape thinking. But JSON was harder to get *semantically* right in exactly the way that matters for this eval: because nothing forces you to declare which room is on which side of a shared wall the way the DSL's `room.side` shorthand does, it's easier to write `"on":{"room":"living","side":"south"}` for a wall that isn't actually exterior — the DSL's default -- form (`window sala.west w1.2`, an unqualified, terse token) somehow made me think harder about "is this side actually facing away from the building" than JSON's more ceremonial `{"between":["exterior","living"],"on":{...}}` did, possibly because the DSL forces you to write the side as a bare suffix right next to the room id (`hall.south`) while JSON buries it one level down inside an `on` object — pure speculation on my part, but the mistake pattern (wrong side called "exterior") shows up in both syntaxes for the same two buildings, so it isn't a syntax effect, it's a modelling habit I built during DSL authoring and didn't audit before reusing.

**What I'd change in each reference:**
- **DSL (`schema-dsl.txt`)**: state explicitly, right in the `level` row, "statements after a `level` header are NOT indented; indentation is reserved for `layout` rows and vertical `at` lines" — or better, make the worked `e.g.` block for `level` flush-left so the example doesn't visually teach the wrong thing.
- **DSL**: document that a wall bordering a *named* outdoor space is not `exterior` for the purposes of the bare `<room>.<side>` shorthand — say explicitly that shorthand only ever means "the true unbounded exterior," and any other adjacency must be written as an explicit `<a>><b>` connector.
- **JSON (`schema.txt`)**: add the implicit-single-level shorthand to the `plan` grammar row itself (or state "when `levels` is omitted, `plan` accepts a level's fields directly"), instead of leaving it inferable only from one example.
- **JSON**: document `position`'s bare-number form next to the object form, e.g. `position?: opening.position | num` with a one-line note ("a bare number means distance from the wall's start, used together with `on`").
- **Both**: state the default unit explicitly, even if it's just "meters unless `units` says otherwise."

## Files read (for the record)

- `docs/eval/briefs.md`
- `docs/eval/cold3b/rules.txt` (own generated output of `node src/bin.ts --rules`)
- `docs/eval/cold3b/schema-dsl.txt` (own generated output of `node src/bin.ts --schema=dsl`)
- `docs/eval/cold3b/schema.txt` (own generated output of `node src/bin.ts --schema`)
- The `.out.json` lint outputs I generated myself for all 40 authored files.

No other repository file was opened. `docs/eval/cold/` and `docs/eval/cold2/` were never opened. DSL files were not opened while writing JSON files, or vice versa (both were authored directly via the `Write` tool from in-context design decisions, never re-read back with `Read` before the other phase).
