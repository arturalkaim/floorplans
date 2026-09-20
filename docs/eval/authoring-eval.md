# Authoring eval: does an agent make more first-time mistakes in the DSL than in JSON?

`docs/agent-review.md` §C names exactly one thing that would change its recommendation:

> an authoring eval (twenty briefs per syntax, count schema failures) showing agents
> produce more first-time errors in the DSL than in JSON

This is that eval. **It does not change the recommendation, and it is weaker evidence than
the count suggests** — the headline number came out 0–0, which discriminates nothing. The
useful result is in §3, the follow-up probe, which found two real defects in the grammar.

## Method

- Twenty briefs, `docs/eval/briefs.md`, written before either set of documents and never
  changed afterwards. Two to six rooms each. Between them they use levels, a stair, a
  void, a track grid, fixtures with `depth`, outdoor spaces, a courtyard, `covered`,
  `glazed`, `entrance`, an authored `id`, `at` placement and a `poly` room.
- Each brief authored **by hand in both syntaxes**, once, straight through. The
  first-written syntax alternates: odd-numbered briefs JSON first, even-numbered DSL
  first, because whichever is written second gets the benefit of having thought about the
  building already.
- The forty documents are committed in `docs/eval/plans/` **exactly as first written**.
  None was corrected before measuring, and none has been corrected since — the two parser
  fixes in §3 came from the separate probe, not from these.
- `node docs/eval/run.mjs` runs `lint()` over all forty and counts `schema.*` findings.
  `test/authoring-eval.test.ts` pins the result so it cannot quietly rot.

Geometry and rule findings are reported beside the schema count but not counted as
failures: a room that does not tile the footprint is a mistake about *buildings*, and no
syntax can be blamed for it.

## 1. The headline count

| syntax | documents failing the schema first time | schema findings |
|---|---:|---:|
| JSON | **0 / 20** | 0 |
| line DSL | **0 / 20** | 0 |

Neither syntax produced a single first-time schema failure. On the review's own criterion,
**the DSL did not produce more first-time errors than JSON, and the recommendation to ship
it as the authoring surface stands.**

## 2. The twenty pairs, side by side

The rule-finding counts are the more interesting column: they are **identical for all
twenty pairs**. Writing the same brief in the two syntaxes produced the same building
twenty times out of twenty — not merely two documents that both parse, but two documents
that the geometry and the rules cannot tell apart.

| brief | JSON schema | DSL schema | rule findings (both) |
|---|---:|---:|---:|
| 01 studio | 0 | 0 | 0 |
| 02 one-bedroom flat | 0 | 0 | 3 |
| 03 two-bedroom flat | 0 | 0 | 1 |
| 04 cottage with a porch | 0 | 0 | 3 |
| 05 garage workshop | 0 | 0 | 3 |
| 06 bungalow | 0 | 0 | 7 |
| 07 cabin with a sleeping loft | 0 | 0 | 4 |
| 08 townhouse | 0 | 0 | 5 |
| 09 courtyard house | 0 | 0 | 3 |
| 10 guest house | 0 | 0 | 9 |
| 11 kitchen extension | 0 | 0 | 6 |
| 12 flat on a grid | 0 | 0 | 1 |
| 13 pool house | 0 | 0 | 0 |
| 14 office suite | 0 | 0 | 2 |
| 15 long narrow house | 0 | 0 | 3 |
| 16 house with a utility | 0 | 0 | 2 |
| 17 loft conversion | 0 | 0 | 4 |
| 18 shop | 0 | 0 | 0 |
| 19 holiday let | 0 | 0 | 7 |
| 20 semi-detached with a void | 0 | 0 | 8 |
| **total** | **0** | **0** | 71 each |

Token cost of the same forty documents, `gpt-tokenizer` `o200k_base`: **9 936** for the
twenty JSON documents and **4 757** for the twenty DSL ones — **−52 %** over a set written
to describe the same twenty buildings, which is the same ratio the review measured on
casa-t3 alone (1 502 → 788, −48 %).

## 3. The probe that actually found something

A 0–0 result means the briefs were too easy, or the author too warm, or both — see §4. So
the same five realistic authoring slips were made in **both** syntaxes of brief 03 and the
messages compared (`node docs/eval/slips.mjs`). What matters is not only whether a mistake
is made but whether one read of the reply is enough to fix it.

Run the first time, this found **two real defects in the DSL**, both now fixed:

| slip | JSON said | DSL said, before | verdict |
|---|---|---|---|
| `"widht": 0.9` / `wd0.9` | `openings[1].widht: unknown field "widht"; did you mean "width"?` + one more | **three** findings, the first being `door: unexpected "wd0.9"` and the next two cascading from it | **defect**: one mistyped token produced a finding for itself *and* one for every token after it, burying the one that mattered |
| `"kind":"livingroom"` / `livingroom` | `rooms.sala.kind: unknown kind "livingroom"; one of bedroom, living, …` | **nothing at all** | **defect, the serious one**: a bare word that was not a room kind fell through to the *zone* slot, so a misspelt kind silently became a room of kind `other` in a zone called `livingroom` |
| door with no width | `openings[3].width: must be a positive number (metres)` | `line 13: door needs a width, written w<metres>` | equivalent |
| door to a room never declared | `openings[4].between[1]: unknown space "quarto2"; …` | same message, with `line 14` | equivalent — it is literally the same check, because the DSL compiles to the document the schema checker reads |
| `"rect":[0,4.7]` / `rect 0,4.7` | `rooms.q1.rect: must be [x, y, width, height] numbers` | `line 6: room q1: rect needs <x>,<y> then <width>x<height>` | equivalent |

### The two fixes

1. **A bare word in the kind slot must be a kind.** The grammar took two bare words in
   order — kind, then zone — and accepted anything for either. It now requires the first
   to be one of `ROOM_KINDS` and says so when it is not, listing them and pointing at
   `zone:<z>`. A zone on a room with no kind is therefore written `room a zone:night`
   rather than `room a night`. This costs two tokens in the one case where a room has a
   zone and no kind, and none at all in the case the review's sample uses
   (`room suite "Suite parental" bedroom night …`), where the kind is present.
   `src/dsl.ts` carries the INVARIANT comment; `test/dsl.test.ts` carries the case.
2. **One unexpected-token finding, not one per leftover token.** The statement now reports
   the token it stopped on, says the rest of the line was not read, and lists what that
   statement takes — from `DSL_SCHEMA`, so the list cannot drift from the parser.

After both fixes, all five slips are caught in both syntaxes with comparable counts, and
the DSL's message for the misspelt token is the more actionable of the two, because it
enumerates the alternatives:

```
door: unexpected "wd0.9"; the rest of the line was not read — door takes <a>><b>,
w<width>, @<d>, @-<d>, at:<x>,<y>, on:<room>, on:<room>.<side>, near:<x>,<y>,
hinge:start|end, swing:<space>, entrance, glazed, id:<id>
```

## 4. Why this is weaker evidence than 0–0 looks

Stated plainly, because the number invites over-reading:

- **The author is not a cold agent.** These were written by the same session that had just
  written the parser, with the whole grammar in working memory and every fixture already
  read. That is close to a best case for the DSL and an ordinary case for JSON, which any
  agent knows from pretraining regardless. A cold agent given only `--schema=dsl` would
  plausibly do worse; this eval cannot say how much worse.
- **Twenty small briefs is a small sample**, and they were written to be fair rather than
  hard. The one thing that saturates a count at zero is easy tasks.
- **JSON has the stronger prior and the DSL the smaller surface.** Those pull in opposite
  directions and this eval cannot separate them.

What it does establish, and these are not nothing:

- The DSL expresses every one of twenty ordinary briefs, including two-storey ones, a
  void, a stair, a grid layout and fixtures, with no field left unreachable.
- The two syntaxes produced the **same building** on all twenty briefs, which is the claim
  `fmt` rests on.
- The probe is repeatable and it found two genuine defects, one of which was a **silent**
  wrong answer — the worst kind for an agent, since nothing tells it to look again.

## 5. What would change the conclusion

A cold-agent run: give a fresh session only `floorplan --schema=dsl` (1 387 tokens) and the
same twenty briefs, and count again. If the DSL's first-time failure rate is materially
worse than JSON's there, the right response is not to drop the DSL but to spend the
difference on the schema output — the two defects found here were both cases where the
grammar let a mistake through quietly, and both were fixable without changing the syntax.

## Reproducing

```
node docs/eval/run.mjs          # the table in §1 and §2
node docs/eval/run.mjs --json   # the same, as data
node docs/eval/slips.mjs        # the probe in §3
node --test test/authoring-eval.test.ts
```
