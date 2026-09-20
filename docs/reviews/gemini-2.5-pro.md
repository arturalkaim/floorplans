# External review — gemini-2.5-pro (via PAL chat, 2026-09-20)

Brief: the same review brief used for the in-house review, sent with the complete library
source, app source, README and four fixtures. (`gemini-3-pro-preview` is retired and
`gemini-3.1-pro-preview` is not enabled on this key.) The model could not run code.
Verbatim below.

---

# Floorplan Project Review

This report provides a comprehensive review of the `floorplan` library and its accompanying playground application. The primary user of this library is assumed to be an LLM agent, so this review prioritizes **Agent Experience (AX)** and **token economics**.

## Executive Summary

`floorplan` is a well-designed and robust library with a clear purpose. Its architecture is clean, performance is excellent, and the focus on agent experience is evident in its API design, documentation, and especially its token-efficient representations and editing mechanisms. The decision to maintain JSON as a canonical model with a line-oriented DSL for authoring is a standout success, offering significant token savings without sacrificing capability.

The project's greatest strengths are its generated, non-drifting documentation (`--schema`, `--rules`), its unified error-reporting channel (`lint()`), and its machine-actionable findings and editing commands (`set`, `patch`). The custom, zero-dependency geometry kernel is impressive and fit-for-purpose.

The primary areas for improvement lie in enhancing the agent-tool feedback loop with more structured data and query/fix capabilities, and in expanding the playground's interactive editing features to fully demonstrate the library's power. A minor but critical bug exists in the playground's gallery component that prevents it from rendering DSL-based examples.

## 1. Bugs and Correctness Risks

### Library

*   **Geometry (`src/arrangement.ts`, `src/offset.ts`)**: The use of integer millimetres for internal calculations and snap-rounding for constructed points (`src/arrangement.ts:87, function crossingPoints`) is a strong foundation for geometric robustness. The INVARIANT at `src/arrangement.ts:14`, which claims no new coordinate values are constructed for axis-aligned plans, appears sound and is critical for predictable behavior. The deterministic flattening of arcs (`src/ring.ts:120, function flattenArc`) by a fixed sagitta is the correct approach to prevent gaps between adjacent curved rooms. The mitred offset implementation in `src/offset.ts` is complex; while it appears to handle degenerate cases where edges collapse (`src/offset.ts:67`), its interaction with complex sequences of short straight and curved edges is a potential risk area that is difficult to verify by reading alone.
*   **Edit Layer (`src/edit.ts`)**: The logic for determining which walls are draggable is sophisticated and safe. It correctly distinguishes between grid-based drags (`fromGrid`) and polygon-based drags (`fromPolys`), and includes crucial guards to prevent edits that would tear the plan's topology, such as refusing to drag a wall segment that doesn't span the full edge (`src/edit.ts:351`) or refusing an offset drag at a T-junction (`README.md:117`). The limitation that `patch` does not support structural edits on DSL files (`src/dsl.ts:507`) is a safe and clearly communicated trade-off.

### Playground App (`app/`)

*   **[BUG] Gallery Crash on DSL Fixtures**: The gallery page at `app/src/routes/gallery.tsx` will crash when attempting to generate a thumbnail for any plan provided in the DSL format. The code at `app/src/routes/gallery.tsx:17` calls `JSON.parse(e.source)` before passing the content to `floorplan()`. This will fail for `cabin.dsl` (`app/src/lib/plans.ts:12`), which is imported as a raw string. The fix is to pass the raw source string directly to `floorplan()`, which contains its own logic to sniff the syntax (`src/index.ts:220, function source`).

## 2. Agent Experience (AX)

*   **Onboarding and Discovery**: The `--schema` and `--rules` commands are the project's strongest AX feature. By generating documentation directly from the parser's and linter's internal tables, they provide a low-token, authoritative, and non-drifting reference. The different schema formats (`terse`, `full`, `dsl`) are well-tailored to different agent needs (`README.md:27-35`). The inclusion of worked examples (`README.md:182`) is a critical addition that significantly lowers the barrier to correct first-time use.

*   **Authoring and Editing Loop**:
    *   **Findings**: The finding structure is excellent. The use of stable, non-index-based IDs for openings and fixtures (`README.md:761`) is a crucial feature for robust editing. The JSON `path` is machine-readable and directly usable by the `set` command, creating a tight, efficient feedback loop (`README.md:276`).
    *   **Editing**: The `set` and `patch` commands are highly token-efficient, costing a fixed number of tokens regardless of plan size.
    *   **Read-back**: The default `--json` output, which includes only findings and a summary, is a brilliant design choice for token economy (`README.md:252`, casa-t3 costs 174 tokens).

*   **Potential First-Time Mistakes**:
    *   An agent's first attempt at a non-rectilinear wall might incorrectly use `on.side` instead of `at`. The resulting `wall.ambiguous` finding (`README.md:712`) is helpful but reactive. The `--schema` documentation should more forcefully guide the agent towards `at` for any non-axis-aligned wall.
    *   The distinction between `outdoor` (no roof) and `void` (no floor) is subtle (`README.md:467`). An agent might use them interchangeably.
    *   An agent using the library programmatically might not be aware that dragging a shared `grid` boundary affects multiple levels. The CLI provides no structured output indicating this side-effect.

## 3. Representation

The decision to use JSON as the canonical model and a line-oriented DSL as an authoring front-end is the correct one.

*   **JSON as Canonical Model**: stable, universal, machine-readable; verbosity solved by the DSL and the canonical formatter.
*   **Line-Oriented DSL**: a clear success — ~50 % token reduction compared to canonical JSON (`README.md:519`); "one entity per line" is simple to parse, easy to generate, and enables line-based edits via `set`.
*   **Alternatives**: YAML/TOML — improved human readability, no significant token gains, added parsing complexity. S-Expressions — token-efficient but unconventional, no clear advantage over the purpose-built DSL. Grid/ASCII — wisely used for its ideal case (`layout`) without forcing it onto non-rectilinear geometry.

I would only reconsider this if the domain's complexity grew to a point where the DSL's grammar became unwieldy, at which point a programmatic builder API might become a better alternative for agent-based authoring.

## 4. Feature Gaps and What to Build Next

### Library

1.  **Enhanced Agent API — Queries and Fixes**: a query function or CLI command (`"list exterior walls of rooms.living"`, `"get dimensions of wall w5"`) with a targeted, low-token response; a mechanism to suggest or apply fixes for findings (valid walls and positions for a window; a `patch` to move an offending wall by the required amount).
2.  **More Structured Data in Findings**: e.g. `habitable.no_window` with `validWalls: string[]`; `door.swing_hits_fixture` with the swing arc and fixture footprint.
3.  **Structural Elements**: `column` and `beam` as new top-level objects, acting as obstacles for `room.min_dimension` and `door.swing_hits_fixture`.
4.  **3D and Advanced Geometry**: a `roofs` collection (`pitch`, `eaves`, `type: 'hip' | 'gable'`); optional `elevation` on a `level` or `room` for split-levels/mezzanines.

### Playground App

1.  **Full Interactive Editing**: vertex and radius handles via the existing `wallHandles` (`src/edit.ts:674`); opening drag/resize along a wall; add/delete tools that append via `patch`.
2.  **Enhanced Finding Visualization**: on click, draw the `clearRect` for `room.min_dimension`, the swing arc for `door.swing_hits_fixture`.
3.  **3D Preview**: a simple extruded view for multi-level plans, voids and future roofs, isolated within the app.

## 5. Architecture, Tests, and Docs

*   **Architecture**: clean unidirectional pipeline (`parse` → `derive` → `rules` → `svg`); strict separation library/app and CLI logic/IO; the zero-dependency choice executed well through the custom geometry kernel.
*   **Tests**: as inferred from the README — canonical form enforcement, DSL-JSON round-tripping, cross-syntax SVG byte-matching, snapshot testing; generated documentation as a form of integration testing. Geometry predicate coverage could not be verified by reading alone.
*   **Documentation**: generating schemas and rule lists from source is exemplary; README prose is the only part at risk of going stale.

## Prioritized Recommendations

1.  **Fix Gallery Bug** — correct the `JSON.parse` call in `app/src/routes/gallery.tsx:17`.
2.  **Implement Query/Fix-it API** — the most significant leap in Agent Experience.
3.  **Expand Structured Findings** — prioritising the most common or hardest-to-parse rules.
4.  **Implement Full Interactive Editing in App** — vertex, handle and opening drags.
5.  **Model Structural Elements** — columns first.
6.  **Model Roofs** — after the core interaction model and structural elements.

## What I Would Not Do

*   **Do not replace the DSL or the JSON+DSL strategy.**
*   **Do not add external geometry dependencies.**
*   **Do not introduce a backend or database.**
*   **Do not prematurely optimize SVG rendering.**
