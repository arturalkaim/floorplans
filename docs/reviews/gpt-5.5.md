# External review — gpt-5.5 (via PAL chat, 2026-09-20)

Brief: the same review brief used for the in-house review, sent with the complete library
source, app source, README and four fixtures. The model could not run code; it says so.
Verbatim below, HTML entities unescaped.

---

# Independent review of `floorplan` — library + playground

Scope: reviewed the attached source, fixtures, app files, README, and package metadata. I did **not** run the code, tests, CLI, app, renderer, tokenizer, or benchmarks. Any runtime/performance/token/test-pass claim below is either directly marked as README-stated/not independently verified, or framed as a risk inferred from code.

## Executive summary

`floorplan` is unusually well aligned with an LLM-agent primary user. The strongest choices are:

- **Findings-first workflow**: `lint()` returns schema, geometry, and semantic problems through one `Finding` shape (`src/index.ts:319-338`), while the CLI default JSON output stays bounded by number of problems (`src/cli.ts:171-180`).
- **Canonical JSON + line DSL**: JSON remains the interchange model, while the DSL is an authoring syntax compiled into that same shape (`src/dsl.ts:1-10`). This is the right direction for agent token economics.
- **Generated references**: schema/rules/DSL grammar are exported from parser/catalogue data (`src/parse.ts:167-327`, `src/catalogue.ts:15-71`, `src/dsl.ts:86-312`) and consumed by CLI/app docs (`src/cli.ts:588-620`, `app/src/routes/reference.tsx:1-2`). This directly addresses doc drift.
- **Edit-by-splice model**: JSON and DSL source spans are preserved for `set`, `patch set`, drags, and findings paths (`src/jsonpos.ts:182-210`, `src/dsl.ts:1763-1813`, `src/edit.ts:81-82`). That is exactly the right primitive for agents editing one thing.

The main issues I found by reading are concentrated in **recently added surfaces**:

1. **Playground gallery likely crashes on the DSL fixture**: it imports `cabin.dsl` but always calls `JSON.parse(e.source)` (`app/src/lib/plans.ts:12`; `app/src/routes/gallery.tsx:17`).
2. **DSL handle edits are inconsistent**: normal drags route through syntax-aware `applyEdits`, but `applyHandle()` and `applyVertexHandle()` always call JSON `spliceAll`, so applying offset/radius/vertex handles to DSL text will try to parse DSL as JSON (`src/edit.ts:81-82`, `src/edit.ts:936-950`).
3. **`toDsl()` only rejects private `_` / `x-` keys at document root**, despite docs saying DSL conversion refuses private keys rather than dropping them. Nested private keys are likely silently lost because printers only emit known fields (`src/dsl.ts:1652-1657`; compare `README.md:923-929`).
4. **Void overlap semantics appear wrong for explicit voids inside rooms**: face ownership prioritizes rooms before voids, and there is no void-overlap check parallel to `outdoor.overlap` (`src/derive.ts:374-382`; `src/derive.ts:502-516`). A room rect containing a void rect likely treats the void face as room-owned.
5. **Non-rectilinear `room.min_dimension` ignores fixtures**: rectilinear largest-rectangle cells exclude busy fixture cells (`src/derive.ts:613-627`, `src/derive.ts:646-650`), but the non-rectilinear metric uses the inscribed circle of the `clear` wall-offset ring only (`src/derive.ts:668-709`). An angled/round room with a central island can over-report usable narrowness.
6. **CLI `set` cannot set negative numbers** because `runSet()` treats any positional token starting with `-` as an option (`src/cli.ts:429-435`). Negative coordinates are common in the fixtures (`fixtures/casa-v.dsl:7-9`).
7. **Playground undo batching for typing likely stores the penultimate text, not the start of the typing burst** (`app/src/routes/playground.tsx:144-155`; timer captures `before` on every keystroke).

None of those undermine the core architecture. They are fixable, high-value correctness issues.

---

## 1. Agent experience

### 1.1 Discovery and onboarding

The project explicitly optimizes for agents: README tells agents to load schemas instead of prose (`README.md:21-25`); CLI supports compact schema/rules outputs (`README.md:27-34`); `--schema` is generated from `SCHEMA` (`src/cli.ts:736-789`; `src/parse.ts:167-327`); `--rules` is generated from `RULES` (`src/cli.ts:618-620`; `src/catalogue.ts:15-71`).

**Token economics, from README only; not independently verified:**

- Onboarding: terse JSON schema 1,181 tokens; DSL schema 1,376; rules catalogue 1,119; full JSON schema 2,806.
- Authoring: all seven original fixtures — canonical JSON + `rect` 5,342 tokens, DSL 2,680 (about 50 % of shipped JSON, 35 % of old pretty JSON). casa-t3: JSON 1,502, DSL 788 (−48 %). moradia-2-pisos: JSON 1,594, DSL 849 (−47 %).
- Read-back: casa-t3 `--json` 174 tokens; moradia-2-pisos `--json` 191; `--json=all` casa-t3 3,020.

This is a strong economic model: an agent can pay ~1.4k tokens once for DSL grammar, then save hundreds to thousands of tokens per plan and avoid re-emitting documents via `set`/`patch`.

### 1.2 API surface

The exported API is broad but coherent (`src/index.ts:24-75`). `parse()` throws `PlanError` on schema problems; `analyze()` derives + rules and sorts findings; `floorplan()` is the one-call renderer; `lint()` never throws for plan/schema errors and returns schema problems as findings; `walls(model, level?)` exposes derived wall extents; edit primitives are exported. For agents, `lint()` should be the preferred API.

### 1.3 Findings shape

The `Finding` type is agent-friendly: stable `rule`, `severity`, `message`, `path`; optional `level`; stable `opening` and `fixture` ids, not array indices; structured fields for ambiguous walls, min dimension, off-wall (`src/types.ts:559-608`). Schema issues become `schema.*` findings (`src/index.ts:291-301`). DSL findings get `line` while preserving JSON path (`src/index.ts:366-371`). Path construction prefers authored fields via `pathTo()` (`src/types.ts:617-628`).

**Remaining agent-experience gaps:**

1. **Findings rarely include machine-actionable fix suggestions.** Only three rules carry structured facts. High-volume rules like `habitable.no_window`, `space.no_access`, `entrance.missing`, `wall.unresolved`, and `door.min_width` would benefit from optional structured fix hints: target collection/path; candidate wall ids; suggested opening type/width; whether `set` or `patch insert` is appropriate.
2. **The CLI `set` path grammar is underpowered for id-based arrays.** Paths are index-based (`src/cli.ts:291-321`). Findings include stable `opening`/`fixture` ids, but `set` cannot address `openings[id=porta].width`.
3. **`--json=walls` should include enough selector metadata for openings** — `walls()` returns endpoints and owners (`src/index.ts:241-277`) but not length, side relative to each adjacent room, or whether the wall is curved.
4. **`formatText()` naming is misleading.** README describes it as canonicalizing a document (`README.md:486-487`), but the implementation only does `JSON.parse` (`src/format.ts:100-102`). The name invites agents to call it on DSL and fail.

---

## 2. Bugs and correctness risks

### 2.1 App bug: gallery cannot load DSL example

`plans.ts` loads Cabana from DSL (`app/src/lib/plans.ts:12`, `:40`); gallery maps examples with `JSON.parse(e.source)` (`app/src/routes/gallery.tsx:17`). Opening `/` evaluates the `cabin` example, `JSON.parse("plan \"Cabana\" ...")` throws inside `useMemo` without catch. Correct approach: pass source text directly to `floorplan(e.source, ...)`, matching library sniffing (`src/index.ts:219-221`).

### 2.2 Edit layer: `applyHandle()` / `applyVertexHandle()` break on DSL

Syntax-aware routing exists (`src/edit.ts:81-82`) and `applyDrag()`/`applyMove()` use it (`:416-422`, `:594-599`), but scalar/vertex handles bypass it (`:936-943`, `:946-950`). An agent calling `applyHandle(casaVdsl, offsetHandle, next)` hits JSON `parseWithPositions()`, which throws `unexpected "p"` (`src/jsonpos.ts:137-142`). The playground currently only wires offset handles (`app/src/components/Drawing.tsx:113-119`), so this will hit app drags on angled walls in DSL once exposed.

### 2.3 CLI `set` rejects negative numbers

`runSet()` treats any token starting `-` as an option (`src/cli.ts:429-435`). `floorplan set plan.json rooms.suite.rect[0] -1` reports `unknown option -1`. Negative coordinates are valid and used in fixtures.

### 2.4 DSL conversion may silently drop nested private keys

README states `toDsl` refuses private keys (`README.md:923-929`); the implementation checks top-level keys only (`src/dsl.ts:1652-1657`), then emits known schema fields only. `{"rooms":{"sala":{"rect":[0,0,4,4],"_note":"keep"}}}` passes the check and is likely omitted from DSL output — silent data loss.

### 2.5 Explicit voids inside rooms are likely mishandled

Code permits explicit void geometry (`src/parse.ts:242-249`, `:916-923`), but arrangement face owner prioritizes rooms over outdoor over void (`src/derive.ts:374-382`). There is an `outdoor.overlap` check (`:502-516`) but no analogous void overlap check. A void face tagged by both room and void is returned as room-owned. At minimum, schema/derive should reject explicit room/void overlap unless the void is authored through layout cells no room also claims.

### 2.6 Non-rectilinear minimum dimension ignores fixtures

The rectilinear clear rectangle excludes fixtures (`src/derive.ts:613`, `:626`, `:646-649`); the non-rectilinear path uses the inscribed circle of the wall-offset ring only (`:668`, `:709`). A circular/angled living room with a large central island can report an acceptable `minDimension` even when no circle of that diameter fits in unoccupied floor.

### 2.7 Arrangement robustness: bounded snap-round passes are a risk

`snapRound()` silently stops after 8 passes (`src/arrangement.ts:155-181`). I cannot prove 8 is always sufficient. No fallback finding or assertion when stabilization is not reached. Probably rare architecturally, but this is the single geometry kernel; silent non-convergence should be surfaced.

### 2.8 Arc/simple-polygon validation is conservative but can surprise

Self-intersection checks flatten arcs to canonical chords (`src/geometry.ts:140-164`). A true arc that grazes/crosses another edge between chord samples may be missed. Exact arc/segment and arc/arc intersection predicates would be high-value later.

### 2.9 Playground undo batching likely does not collapse a typing burst

`before` is captured on every keystroke (`app/src/routes/playground.tsx:147-155`). Type `B`, then `C` within 600 ms: undo returns to `AB`, not `A`.

### 2.10 App does not expose radius/vertex handles

The library has `RadiusHandle` and `VertexHandle` (`src/edit.ts:635-656`) and applies them (`:935-950`), but the app only converts offset handles (`app/src/components/Drawing.tsx:113-119`). README's handles section describes all three (`README.md:111-116`).

---

## 3. Geometry and rules review

### 3.1 Planar arrangement

Sound: one DCEL arrangement handles topology, walls, booleans, overlaps, and fixture intersections. Integer millimetres reduce tolerance sprawl (`src/ring.ts:1-9`); shared curved walls flatten canonically (`:29-35`, `:120-130`); wall grouping merges straight/circular runs (`src/derive.ts:847-888`, `:978-1006`); exact arc area in `ringArea()` (`src/ring.ts:179-195`). Risks: the snap-round pass cap; chord-based arc validation; `facesWhere()`/`traceBoundary()` return polylines only (`src/arrangement.ts:718-759`), so boolean outputs lose exact arc geometry.

### 3.2 Mitred offset / clear area

Good replacement for a closed-form approximation (`src/offset.ts:1-12`); per-edge distances split where wall thickness changes (`src/derive.ts:1216-1274`). `offsetRing()` drops reversed elements iteratively and returns empty if orientation flips (`src/offset.ts:66-94`); `room.no_clear_floor` reports it. It uses floating geometry internally after integer inputs — acceptable, but exactness claims over complex arc/line mitres are implementation intent, not verified here.

### 3.3 Openings and angled/curved walls

`at` is the right selector (`src/derive.ts:1448-1476`); `on.side` rejects angled candidates with a targeted message (`:1478-1492`); `wall.ambiguous` carries structured candidates. Risks: `paramAt()` uses a 1 cm sweep and ternary refinement (`:1669-1702`) — approximate on multi-modal chains; `opening.off_wall` tolerance is fixed at 5 cm plus half thickness (`:1465-1473`) and could be surfaced structurally.

### 3.4 Rules engine

Well scoped: building-wide entrance/reach (`src/rules.ts:89-200`); per-level (`:202-464`); cross-level (`:466-614`). Building access uses one street node and per-level exterior nodes for non-ground exterior doors (`src/derive.ts:141-169`); `entrance.not_ground` distinguishes balcony doors; vertical elements are synthetic fixtures but findings name `vertical`. Gaps: `structure.over_open_sky` does not distinguish cantilever over terrace vs over gap — structured `unsupportedArea`/`belowOwner` would help; `stair.headroom` is a bbox heuristic, correctly framed as a convention.

---

## 4. Parsing, validation, and DSL

### 4.1 JSON schema validation

Unknown fields rejected with suggestions (`src/parse.ts:383-409`); private keys allowed (`:363-365`); shape/cardinality in `SCHEMA` (`:123-139`); one id regex (`:96-99`). Risk: some checks continue after conflicts and may produce secondary messages; the DSL parser explicitly fixed cascades (`src/dsl.ts:801-818`), the JSON parser could use similar attention.

### 4.2 DSL grammar

Compact and mostly agent-friendly: one entity per line (`src/dsl.ts:349-365`); error messages list accepted tokens (`:1489-1499`); misspelled room kinds are caught (`:997-1019`); indented level bodies accepted (`:1461-1474`). Concerns: first-time agents will still likely confuse `door room.side at ...` with implicit `on`; `@-<d>` vs negative coordinates; `at <x>,<y>` vs old `at:<x>,<y>` accepted silently (`:1146-1173`). Comments are dropped by the printer (`:306-310`, `:1721`).

### 4.3 `formatText()` vs DSL

`formatText()` is JSON-only (`src/format.ts:100-102`) while `fmt` handles both (`src/cli.ts:411-420`). Either add a sniffing `formatSourceText()` or document `formatText()` as JSON-only.

---

## 5. CLI review

Strengths: IO-free `run(argv, io)` (`src/cli.ts:65-72`, `src/bin.ts:9-15`); `--json` findings-first (`:171-180`); `set`/`patch` validate before writing (`:340-355`); `patch` all-or-nothing (`:569-581`); `fmt` validates before writing (`:404-420`).

Issues: negative `set` values; inconsistent missing-argument handling (`parseArgs()` sets `a.out = next()` unchecked at `:233-235`; `runFmt()` `out = argv[++i]` at `:385`); `patch --json` failure path uses `JSON.stringify(..., null, 2)` (`:576`) while other JSON outputs use compact `formatPlan()`.

---

## 6. Playground app review

Strengths: depends on exported package APIs only; text is the single source of truth, drags rewrite text (`app/src/components/Drawing.tsx:80-84`); last good drawing preserved during parse errors (`app/src/routes/playground.tsx:86-91`, `:177-182`); multi-level UI scopes drawing/findings/schedule (`:184-200`, `:378-420`); exact render options passed to projection.

Issues and gaps: gallery DSL crash; undo batching; radius/vertex handles not exposed; findings list shows severity/rule/message only (`:568-583`) — no `path`, `line`, ids, structured fields; plain `<textarea>` (`:319-326`) — line numbers for DSL findings, click finding → select line/token, copy `floorplan set`/patch from a finding would all help.

---

## 7. Representation: JSON canonical model + line DSL

### Verdict

Keeping **JSON as canonical model** and offering a **line-oriented DSL as an authoring front-end** is the right call. Parser/schema/rules operate on one document shape; DSL compiles to JSON before parse validation (`src/dsl.ts:1744-1748`); edit paths remain JSON paths even for DSL; JSON preserves private metadata.

### Compared to alternatives

- **YAML/TOML** — not recommended: grammar ambiguity, dependency pressure, bad for agents (many equivalent spellings, indentation failure modes, implicit types); would not solve repetitive opening keys as well as the DSL.
- **S-expressions** — not recommended: compact and regular but alien to typical tooling; paths/splices less naturally aligned with JSON fields.
- **Positional arrays** — not recommended except for internal transport: agents confuse field positions; findings need schema context to decode rows; `opening[3][4]` is less meaningful than `openings[3].width`.
- **Grid/ASCII as primary** — not sufficient: `layout.areas` is excellent for rectilinear grid plans, but arbitrary polygons, arcs, fixtures, outdoor spaces, multi-level vertical circulation need geometric records.
- **Different DSL design** — adjust rather than replace: more explicit disambiguators in generated examples for openings on angled/curved walls; copyable canonical snippets for common fixes; a machine-readable statement id/path index for DSL so agents can patch by line/entity id when array indices shift.

### What would change my mind

Only if: multi-level/arc/fixture complexity grows until the DSL grammar is as long as JSON schema plus prose; agents keep making syntax mistakes at material rates after loading `--schema=dsl`; structured patches become the primary authoring mode. README's eval claims 0/20 schema failures in both syntaxes after fixes (`README.md:1104-1109`) — not verified here.

---

## 8. Feature gaps: what to build next

### Library

1. **Structured fixes / candidate actions.** Extend `Finding` with optional `fixes: PatchOp[]` for high-confidence cases: `door.min_width` (set width); `opening.off_wall` (set `at` to projected point or switch to `on`); `habitable.no_window` (candidate wall ids + opening patch skeleton); `space.no_access` (candidate adjacent walls); `entrance.missing` (candidate street walls).
2. **Id-addressed edit paths for array entities** — `openings#porta.width`, `fixtures#pool:deck:0.at`, or `--id opening:porta width 1.0`. Stable ids exist (`src/parse.ts:949-955`); editing should exploit them.
3. **Exact arc intersection predicates.**
4. **Robust arrangement diagnostics** — emit a geometry finding or an invariant error when snap-rounding does not stabilize.
5. **Subtract fixtures from the non-rectilinear inscribed-circle metric.**
6. **Void overlap validation** — reject or model room/void overlap explicitly.
7. **Multi-level structural semantics** — support area by lower owner type; overhang geometry; shaft continuity with void alignment.
8. **Schema for machine consumers** — `--schema=full` exists (`src/cli.ts:591-593`) but the name sounds human; add or alias `--schema=json`.

### App

1. Fix gallery DSL crash.
2. Show finding `path`, `line`, stable ids, structured fields; copy buttons for `set`/patch skeletons.
3. Click finding → focus/select source line/token, especially for DSL.
4. Expose radius and vertex handles, or explicitly document their absence.
5. Fix undo batching.
6. Add a "CLI equivalent" panel: `floorplan <tmp> --json`, `set`, `patch` for current edits/findings.
7. Add an agent-mode reference drawer displaying `--schema=dsl`/`--rules` outputs from library data.

---

## 9. Architecture, tests, docs

### Architecture

Module boundaries are good and match README's map (`README.md:1149-1163`): parse/schema/grid compile; geometry derivation; rules; SVG; format; JSON/DSL source positions; edits/drags; CLI separated from bin IO. Package exports only `dist/index.js` and types (`package.json:7-12`), supporting the "app depends on package, not src" contract.

### Tests

I could not inspect test files. README/code claim: `node --test "test/**/*.test.ts"`; app does not reach into `src/`; canonical fixtures byte-identical to formatter output; DSL/JSON twins render the same SVG; generated schema/README sections tested; pre-level snapshots preserve single-level behavior; catalogue ids match emitted rule ids.

Suggested test additions: gallery renders every `EXAMPLES` source including DSL; `applyHandle()`/`applyVertexHandle()` on DSL source; `toDsl()` rejects nested private keys; CLI `set` accepts negative literals; explicit void inside room rejected or modeled consistently; non-rectilinear min dimension with central fixture; undo batches from start of burst.

### Docs drift risks

`formatText(source)` wording vs JSON-only implementation; DSL private-key refusal at all depths; gallery JSON-parses despite "every entry point sniffs"; handles docs describe radius/vertex, app exposes offset only.

---

## 10. Prioritized list

1. **Fix source-sniffing in gallery**: replace `JSON.parse(e.source)` with raw `floorplan(e.source, ...)`.
2. **Route `applyHandle()` / `applyVertexHandle()` through syntax-aware `applyEdits()`**.
3. **Fix `toDsl()` private-key detection recursively.**
4. **Allow negative values in CLI `set`** — stop option parsing after `<value>`.
5. **Clarify or fix `formatText()`** — sniff, or rename/document as JSON-only.
6. **Validate/model explicit void overlap with rooms.**
7. **Make non-rectilinear `minDimension` account for fixtures.**
8. **Expose more structured fix data** on findings.
9. **Add id-addressed edit commands.**
10. **Add snap-round non-convergence diagnostics** and adversarial arrangement tests.
11. **Expose path/line/copy-edit affordances in the app findings panel.**
12. **Expose radius/vertex handles in the app** or scope them as library-only.
13. **Add exact arc intersection validation.**

---

## What I would not do

- **Do not replace JSON with the DSL as the canonical model.**
- **Do not adopt YAML as an agent syntax.**
- **Do not switch to positional arrays for compactness.**
- **Do not add a runtime geometry dependency just to avoid maintaining the arrangement.**
- **Do not pretty-print canonical JSON.**
- **Do not block live drags on semantic findings.**
- **Do not make grid authoring handle angled grids.**
