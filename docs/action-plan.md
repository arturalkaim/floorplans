# Action plan — from `agent-review.md`

Branch of record: `feature/artur_courtyards-and-fixtures`. Each work item runs in its own
worktree on its own branch and is merged back here by the lead. Waves are ordered by file
overlap and dependency, not by effort; nothing was dropped for being expensive.

Model tiering: **opus** for items that need a design decision or touch the data model;
**sonnet** for items whose fix is already specified in the review.

## Wave 1 — independent, land first

| id | item | files | model |
|---|---|---|---|
| W1a | **A1** CLI inert through bin symlink; **A6** `--json` error envelope | `src/cli.ts`, new `src/bin.ts`, `package.json` bin, `test/cli.test.ts` | sonnet |
| W1b | **A4** reject unknown keys with "did you mean"; **A7** honest message for outdoor ids in `between` | `src/parse.ts`, `test/parse.test.ts` | sonnet |
| W1c | **A3** grid drag carries off-grid vertices; **A5** one finding per gap/overlap component | `src/edit.ts`, `src/derive.ts`, `src/geometry.ts`, tests | sonnet |
| W1d | **E1** delete `demo/`; **E2** stale prose (84→179, formatter claims); **F2–F4** app fixes incl. finding↔marker linking | `demo/`, `scripts/build-demo.ts`, `test/demo.test.ts`, README, `specs/`, `app/src/**` | sonnet |
| W1e | **Gap design study** (missing from the review): non-rectilinear and multi-level. Design doc only, no code. | `docs/gaps-design.md` | opus |

## Resequenced (twice)

First after the review's §G/§H; then after `docs/gaps-design.md` (W1e), which dissents from
the review on sequencing with evidence and is adopted: **levels before the geometry core**.
The claimed dependency (levels need the general predicates) is false — `polysOverlap` /
`polyInside` already answer cross-level footprint questions exactly for rectilinear plans —
and levels are what freeze the contract surfaces (finding paths, `--json` shape, DSL
grammar) that Wave 3/4 build. The geometry core is the long, risky piece and must not gate
everything. A5 was merged before this verdict arrived; its tests survive faces, so it stays.

## Wave 2 — independent of the level shape (in flight)

| id | item | files | model | status |
|---|---|---|---|---|
| W2a | **A2** outdoor space as first-class owner — as a **tagged-union `Owner`**, stop reserving ids; openings may name outdoor ids; entrance = street or border-touching outdoor | `derive`, `parse`, `rules`, `catalogue`, tests | opus | running |
| W2b | **B1/B6** formatter → one entity per line, container/entity decided by shape (so `levels` blocks work unchanged); `rect` | `format`, `parse` (readPoly), fixtures, tests | opus | running |
| W3b | **B3** `set` / `patch` CLI verbs; `jsonpos` remove/append/insert; refuse to write a file that fails schema | `jsonpos`, `cli`, tests | sonnet | running |

## Wave 3 — levels (after W2a: the owner union changes `between`)

Per `gaps-design.md` §2: `stack: string[]`, `levels: Record<id, Level>`, `vertical: Vertical[]`,
per-level `voids`; optional shared `grid`; stairs by explicit id with one footprint + `in` per
level (never matched by footprint overlap); `derive(level)` + combined access graph +
entrance on the ground level; `edit.ts` path prefixing (`jsonpos` needs nothing); per-level
SVG with the level below ghosted (needs a real envelope outline); CLI `--level`,
`--out plan-{level}.svg`. Also **W3c** `at:[x,y]` for openings, glazed doors, D3 as
"deduct only fully-contained fixtures" (exact intersection waits for the geometry core).

## Wave 4 — the agent contract, built once (after levels)

**W3a** with three changes from the design doc: `Finding.path` derived from the parsed
document's positions, never a template; findings-first is the `--json` **default**, schedule
behind `--json=all`, `walls` keyed by wall id never by `axis`/`c`; `Finding.opening` becomes a
string id in the same change. Plus `lint()` that never throws.

## Wave 5 — authoring surface (after W4)

**W4a** the line DSL (grammar needs `level` and `vertical`; `arc`/`at` are single tokens),
`toDsl`, `fmt --to`, authoring eval. **W4b** `--schema`.

## Wave 6 — geometry core (after Wave 3; can run parallel with 4/5 if staffed)

`gaps-design.md` §1: integer mm + snap-rounding with hot pixels; planar arrangement + DCEL +
face owners (deletes A5 outright); `offsetRing` for clearArea/clearRing (the `±t₁t₂/4` formula
is −28 % at 10°); inscribed circle **and** oriented clear rectangle (pole-of-inaccessibility
alone changes 30/46 printed numbers); `Wall { geometry }` with canonical direction; arcs with
parameter-free `flattenArc`; renderer path chains with mitre joins; offset/radius/vertex
handles; `overlay()` + `facesWhere()` instead of a Martínez–Rueda library.

## Rules for every agent

- Work in the assigned worktree; commit on its branch; **never push**; never touch `main`.
- `git add` explicit paths only (a hook blocks `-A`/`.`).
- Conventional commits; tests in the same commit as the change; `npm run check` green before
  reporting. `npm run check:all` for anything touching `app/`.
- Regression = failing test first.
- Report: branch name, worktree path, commits, test count, anything left undone and why.

## Status log

- 2026-09-20 — W1a, W1b, W1c, W1d merged into `feature/artur_courtyards-and-fixtures`
  (`8ad317d`); 192 tests, `check:all` green. W1e merged (`docs/gaps-design.md`). W2a, W2b, W3b in flight.
- Follow-up found by W1c, not yet scheduled: `fromGrid` in `src/edit.ts` offers a detached
  poly-authored room's wall (quinta `w23`) as a grid-track drag because its coordinate happens
  to equal a track boundary. Fold into the drag-layer rebuild (Wave 5) unless it bites first.
- W2b merged (formatter + `rect`, fixtures canonical, −31 % tokens over the seven fixtures);
  `edit.ts` conflict resolved by combining W2b's `spaceForm` with W1c's grid-corner carry
  criterion. 218 tests, `check:all` green.
- Pending chore: `examples/*.svg` are stale vs `src/svg.ts` (missing drag-handle attributes).
  Regenerate with `npm run examples` after W2a lands, since A2 may change outdoor rendering.
- W2a merged (outdoor owner as tagged union, openings may name outdoor spaces,
  `entrance.not_street`, `streetConnected`). Fixture conflicts resolved by re-applying W2a's
  opening edits onto W2b's canonical fixtures and re-running `formatText`. 232 tests,
  `check:all` green. `examples/*.svg` regenerated by W2a. Wave 3 (levels) + W3c launched.
- Open: `Owner.overlap` is declared but never constructed (W2a's call); the arrangement
  rewrite emits it. `docs/gaps-design.md` §1.3 item 6.
- W3b merged (`set`/`patch` verbs, `removeAt`/`appendAt`/`insertKey`); one semantic conflict
  with W2b's canonical fixtures fixed in the test. 281 tests, `check:all` green.
- W3c merged (`at:[x,y]` placement + `opening.off_wall`, glazed doors as daylight, D3
  containment stopgap). Clean merge. 301 tests, `check:all` green. Only levels in flight.
- Levels merged (`e4576d6`): `stack`/`levels`/`vertical`/`voids`/shared `grid`, seven new
  rules, per-level SVG with ghosting, `--level`, path prefixing; single-level plans held
  byte-identical by `test/levels-compat.test.ts`. 371 tests. Wave 4 launched: findings
  contract (W4a), `--schema` (W4b), app level switcher (W4c).
- Deferred by the levels agent with reasons: `stair.no_void` (design wording would fire on
  every correct stair), `stair.no_landing`, `void.unaligned`; gallery openings onto voids.
- W4c merged (playground/gallery level switcher, browser-verified on moradia-2-pisos and
  broken-levels). W4a and W4b still running.
- W4b merged (`SCHEMA` table drives `checkKeys`; `--schema` / `--schema=md`; reference page
  renders it and throws on drift). 381 tests. `--schema` measures 2 459 tokens for 71 fields,
  not the review's ≈600 — that estimate predates levels/vertical/voids/grid. A terser
  presentation (types only, docs behind `--schema=md`) is a candidate follow-up.
- W4a merged (`Finding.path`, string ids with a documented synthesis rule, findings-first
  `--json` with `=all|schedule|walls`, `lint()` + `schema.*` findings, compact output).
  casa-t3 `--json` 1 270 → 174 tokens. 432 tests. W5 DSL + terse `--schema` launched; W6
  geometry core running.
- W4d merged (terse `--schema` default: 568 tokens; `=full` 2 554; `=md`). 439 tests.
  Remaining in flight: W5 DSL, W6 geometry core.
- W5 merged (line DSL: `parseDsl`/`toDsl`, `fmt --to`, `set`/drags on `.dsl`, playground
  toggle, `--schema=dsl`, authoring eval + slips probe that found two DSL defects). casa-t3
  788 DSL vs 1 502 JSON. 539 tests. Cold-agent eval launched (sonnet, references only).
- DSL follow-ups left by W5: `patch remove/append/insert` on DSL (refused, points at
  `fmt --to json`); `--schema=dsl` at 1 388 tokens wants a terse form; `_note` keys have no
  DSL spelling; arcs round-trip once W6 lands.
- Cold-agent eval merged: JSON 20/20 first-time schema failures, DSL 0/20, tokens 8 124 vs
  3 532. Root cause is the terse `--schema` reference, not JSON: `levels?: level` reads as an
  array; the id regex and compass convention are unstated. W4e fixes the references; cold
  eval re-run with a fresh agent afterwards.
- W4e merged (cardinality in the terse schema, id regex, compass line, worked example,
  `--schema=dsl` trimmed). `--schema` 1 035 tokens (616 without the example), `=dsl` 1 045.
  551 tests. Second cold eval launched with a fresh agent and different briefs order.
- Cold eval 2 merged: DSL 7/20 schema failures (5 = `--schema=dsl` lacks the vocabularies,
  3 = level scoping shown only as a sentence), JSON 0/20 (with a DSL-first order effect).
  Tokens DSL 3 205 vs JSON 7 993. W4f closes the 8 listed reference gaps; final paired cold
  run (JSON-first + DSL-first, two fresh agents) after it.
- Wave 6 merged (geometry core): the cell grid is a planar arrangement with face owners,
  integer millimetres and snap-rounding; rings may be any simple polygon and any edge a
  true circular arc; `offsetRing` replaces the `±t₁t₂/4` closed form; walls carry
  `geometry` with a canonical direction and `axis`/`c` only where they mean something;
  the renderer draws stroked path chains with mitred junctions; offset/radius/vertex
  handles sit beside the grid drag; `overlay`/`facesWhere` supply D3's exact intersection
  and the envelope outline. Four new rules (`room.acute_corner`, `room.no_clear_floor`,
  `geometry.sliver`, `arc.too_shallow`) and three new fixtures (`casa-angulo`,
  `casa-redonda`, `broken-geometria`). 513 tests, `check:all` green. casa-t3 derives in
  4.7 ms against 0.88 ms, 4-9x across the fixtures. The `fromGrid` quirk above is fixed:
  a grid drag is offered only where the grid placed one of the wall's spaces.
- Knowingly moved, each with its arithmetic in the test that allows it: seven fixture
  rooms' `clearArea` (the closed form read the thickness at the far end of the outgoing
  edge), quinta's `w23` drag target, and every drawing's wall elements (same ink, to the
  square millimetre on casa-t3, casa-piscina and cabin; the rest lose only the spur a
  0.30 m wall poked past a 0.12 m one).
