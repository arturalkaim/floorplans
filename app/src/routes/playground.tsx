import { Link, useParams } from "@tanstack/react-router";
import { formatPlan, formatText, isDslText, parseDsl, readSource, toDsl } from "floorplan";
import type { Finding, LevelSchedule, Schedule, Severity } from "floorplan";
import { useCallback, useEffect, useRef, useState } from "react";
import { Drawing } from "../components/Drawing";
import { EXAMPLES, byId } from "../lib/plans";
import { useFloorplan } from "../lib/useFloorplan";
import type { Options, Outcome, Syntax } from "../lib/useFloorplan";

/**
 * `fmt` semantics, in the browser: canonicalise in the syntax asked for, whatever the
 * source is written in now. Returns the text unchanged when it does not parse — a
 * half-typed document must never be replaced by an error.
 */
function convert(text: string, to: Syntax): string {
  try {
    const doc = readSource(text).doc;
    return to === "dsl" ? toDsl(doc) : formatPlan(doc);
  } catch {
    return text;
  }
}

/** Canonicalise in whichever syntax the source already is. */
function canonicalise(text: string): string {
  try {
    return isDslText(text) ? toDsl(parseDsl(text).doc) : formatText(text);
  } catch {
    return text;
  }
}

const DEFAULTS: Omit<Options, "theme"> = { scale: 40, areas: "clear", labels: "auto", mark: "warning" };
/** how many steps of history to keep, each way */
const HISTORY = 50;
const EMPTY_HISTORY = { past: [] as string[], future: [] as string[] };
/** mirrors src/rules.ts's SEVERITY_RANK: lower sorts first, and is what `markFindings`
 *  filters against, so this is also the ordering `sortFindings` already returned findings in. */
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Follows the page's resolved theme so the drawing inverts with it. */
function useResolvedTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const stamped = document.documentElement.dataset["theme"];
      setTheme(stamped === "dark" || stamped === "light" ? stamped : mq.matches ? "dark" : "light");
    };
    sync();
    mq.addEventListener("change", sync);
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", sync);
      mo.disconnect();
    };
  }, []);
  return theme;
}

export function Playground() {
  const { id } = useParams({ from: "/plan/$id" });
  const example = byId(id);
  const [text, setText] = useState(() => example?.source ?? "");
  const [hist, setHist] = useState<{ past: string[]; future: string[] }>(EMPTY_HISTORY);
  const [opts, setOpts] = useState(DEFAULTS);
  const theme = useResolvedTheme();
  // which finding row is previewed (hover) or pinned (click); pin wins so a click survives
  // the pointer moving off the row
  const [hoverFinding, setHoverFinding] = useState<number | null>(null);
  const [pinFinding, setPinFinding] = useState<number | null>(null);
  const activeFinding = pinFinding ?? hoverFinding;
  // which level is shown, on a plan that has more than one. Kept as the id the author
  // picked, not an index, so it survives edits that reorder `stack`; falls back to the
  // ground level below once `shown` is known, if this id is no longer one of its levels.
  const [level, setLevel] = useState<string | undefined>(undefined);
  const selectLevel = useCallback((id: string) => {
    setLevel(id);
    setPinFinding(null);
    setHoverFinding(null);
  }, []);

  /**
   * The last outcome that parsed. Editing a number goes through states like `3.` that are
   * not valid JSON, and replacing the drawing with a parse error on every keystroke makes
   * the page jump and loses your place; the last good render is held and marked stale.
   */
  const lastGood = useRef<Extract<Outcome, { ok: true }> | null>(null);

  // switching plan replaces the document and starts a fresh history
  useEffect(() => {
    if (example) {
      setText(example.source);
      setHist(EMPTY_HISTORY);
      setPinFinding(null);
      setHoverFinding(null);
      setLevel(undefined);
    }
  }, [example]);

  // the live document, readable from callbacks that must not re-create on every keystroke
  const textRef = useRef(text);
  textRef.current = text;

  const histRef = useRef(hist);
  histRef.current = hist;

  /**
   * Snapshot the document before a change that should be undoable as one step. A new
   * edit abandons whatever was ahead, the way every editor behaves.
   *
   * These read the live values through refs and set state directly rather than from
   * inside an updater: React may call an updater twice, which would push twice.
   */
  const mark = useCallback(() => {
    setHist((h) => ({ past: [...h.past, textRef.current].slice(-HISTORY), future: [] }));
  }, []);

  const undo = useCallback(() => {
    const { past, future } = histRef.current;
    const prev = past[past.length - 1];
    if (prev === undefined) return;
    setHist({ past: past.slice(0, -1), future: [textRef.current, ...future].slice(0, HISTORY) });
    setText(prev);
  }, []);

  const redo = useCallback(() => {
    const { past, future } = histRef.current;
    const next = future[0];
    if (next === undefined) return;
    setHist({ past: [...past, textRef.current].slice(-HISTORY), future: future.slice(1) });
    setText(next);
  }, []);

  const reset = useCallback(() => {
    if (!example) return;
    mark();
    setText(example.source);
  }, [example, mark]);

  // typing is its own undo step, collapsed while you keep typing: `before` is captured
  // once, at the first keystroke of a burst (when no timer is pending yet), not on every
  // keystroke — otherwise it would keep sliding forward to the *previous* keystroke's
  // text, and undo would land one character short of the burst's actual start.
  const typingTimer = useRef<number | undefined>(undefined);
  const typingBefore = useRef<string | undefined>(undefined);
  const onType = useCallback(
    (next: string) => {
      if (typingTimer.current === undefined) typingBefore.current = textRef.current;
      window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => {
        typingTimer.current = undefined;
        const before = typingBefore.current;
        typingBefore.current = undefined;
        if (before !== undefined) setHist((h) => ({ past: [...h.past, before].slice(-HISTORY), future: [] }));
      }, 600);
      setText(next);
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const outcome = useFloorplan(text, { ...opts, theme });

  // cache-the-previous-value: idempotent, and it avoids the extra render an effect costs
  if (outcome.ok) lastGood.current = outcome;
  const shown = outcome.ok ? outcome : lastGood.current;
  const stale = outcome.ok
    ? undefined
    : `${outcome.title} — showing the last valid drawing · ${outcome.issues[0]?.message ?? ""}`;

  // every level of the last valid drawing, ground-up (src/index.ts's `levels`, already in
  // `stack` order); empty on a plan still parsing for the first time
  const levels = shown?.result.levels ?? [];
  const multiLevel = levels.length > 1;
  // `shown.result.model.level` is always the ground level (types.ts's `Model` doc), levels
  // or not — so this is the one id every plan has, and the fallback the switcher needs
  const groundId = shown?.result.model.level.id;
  // keep `level` across edits when it still names one of this document's levels; fall back
  // to the ground level the moment it does not (renamed level, or `stack` shrank under it)
  const activeLevelId = (level && levels.some((l) => l.id === level) ? level : groundId) ?? levels[0]?.id;
  const activeLevel = levels.find((l) => l.id === activeLevelId);
  // the selected level's findings plus the building-wide ones (no `level`), in the same
  // order src/svg.ts numbered its markers in — see FloorplanResult.levels in src/index.ts
  const levelFindings = activeLevel?.findings ?? shown?.result.findings ?? [];
  // schedule.rooms/interiorArea/etc are always the ground level's (src/index.ts's
  // `Schedule`); `schedule.levels` carries every storey's own section, keyed the same way
  const levelSchedule = shown ? (shown.result.schedule.levels?.find((l) => l.id === activeLevelId) ?? shown.result.schedule) : undefined;

  // how many leading findings (in sortFindings order) floorplan() actually marked in the
  // SVG — see src/index.ts's `marked` and src/svg.ts's marker loop; a row past this count
  // has no marker to link to
  const markThreshold = opts.mark;
  const markedFindings =
    shown && markThreshold !== "none"
      ? levelFindings.filter((f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK[markThreshold]).length
      : 0;

  // confirm the edit landed, once, when the document becomes valid again
  const [toast, setToast] = useState(false);
  const wasBroken = useRef(false);
  useEffect(() => {
    if (!outcome.ok) {
      wasBroken.current = true;
      setToast(false);
      return;
    }
    if (!wasBroken.current) return;
    wasBroken.current = false;
    setToast(true);
    const t = window.setTimeout(() => setToast(false), 1600);
    return () => window.clearTimeout(t);
  }, [outcome.ok]);
  const set = useCallback(<K extends keyof typeof opts>(k: K, v: (typeof opts)[K]) => setOpts((o) => ({ ...o, [k]: v })), []);
  const format = useCallback(() => {
    mark();
    setText(canonicalise);
  }, [mark]);

  /**
   * The JSON | DSL toggle. The document is the same either way — the toggle converts the
   * *source*, exactly as `floorplan fmt --to` does, and everything downstream (the
   * drawing, the findings, the drags) already reads whichever syntax it finds.
   */
  const toSyntax = useCallback(
    (to: Syntax) => {
      if (to === (isDslText(textRef.current) ? "dsl" : "json")) return;
      mark();
      setText((t) => convert(t, to));
    },
    [mark],
  );

  if (!example)
    return (
      <p>
        No plan called <code>{id}</code>. <Link to="/">Back to the plans</Link>.
      </p>
    );

  return (
    <>
      <div className="titleblock">
        <div className="tb-name">
          <h2>{outcome.ok ? (outcome.result.plan.title ?? example.name) : example.name}</h2>
          <p>{example.shows}</p>
        </div>
        <div className="tb-field">
          <span className="k">Scale</span>
          <span className="v">{opts.scale} px/m</span>
        </div>
        {shown && levelSchedule && (
          <>
            <div className="tb-field">
              <span className="k">Footprint</span>
              <span className="v">{levelSchedule.footprint.toFixed(2)} m²</span>
            </div>
            <div className="tb-field">
              <span className="k">Clear area</span>
              <span className="v">{levelSchedule.interiorClearArea.toFixed(2)} m²</span>
            </div>
          </>
        )}
        <div className="tb-field">
          <span className="k">Lint</span>
          <span className="exit" data-code={outcome.exit}>
            <span className="dot" />
            {outcome.ok
              ? outcome.exit === 1
                ? `exit 1 — ${outcome.result.findings.filter((f) => f.severity !== "info").length} at ${outcome.worst}+`
                : outcome.worst === "info"
                  ? "exit 0 — info only"
                  : "exit 0 — clean"
              : "exit 2 — schema"}
          </span>
        </div>
      </div>

      <div className="cols">
        <section className="panel source">
          <div className="panel-head">
            <h2>Plan source</h2>
            <span className="note">metres, wall centrelines · JSON or the line DSL</span>
          </div>
          <nav className="nav" style={{ flexWrap: "wrap", padding: "8px 10px", borderBottom: "1px solid var(--rule)" }}>
            {EXAMPLES.map((e) => (
              <Link key={e.id} to="/plan/$id" params={{ id: e.id }}>
                {({ isActive }) => <span data-active={isActive}>{e.name}</span>}
              </Link>
            ))}
          </nav>
          <div className="syntax" role="group" aria-label="Source syntax">
            {(["json", "dsl"] as const).map((sx) => (
              <button
                key={sx}
                type="button"
                data-active={outcome.syntax === sx}
                aria-pressed={outcome.syntax === sx}
                disabled={!outcome.ok && outcome.syntax !== sx}
                title={sx === "json" ? "Canonical JSON — the model and interchange format" : "The line DSL — one entity per line, about half the tokens"}
                onClick={() => toSyntax(sx)}
              >
                {sx.toUpperCase()}
              </button>
            ))}
          </div>
          <textarea
            id="plan-source"
            className="source-text"
            spellCheck={false}
            aria-label="Plan source"
            value={text}
            onChange={(e) => onType(e.target.value)}
          />
          <div className="controls">
            <div className="ctl">
              <label htmlFor="opt-scale">Scale</label>
              <div className="rangerow">
                <input id="opt-scale" type="range" min={20} max={70} step={5} value={opts.scale}
                  onChange={(e) => set("scale", Number(e.target.value))} />
                <output>{opts.scale}</output>
              </div>
            </div>
            <div className="ctl">
              <label htmlFor="opt-areas">Areas</label>
              <select id="opt-areas" value={opts.areas} onChange={(e) => set("areas", e.target.value as Options["areas"])}>
                <option value="clear">clear</option>
                <option value="centreline">centreline</option>
                <option value="none">none</option>
              </select>
            </div>
            <div className="ctl">
              <label htmlFor="opt-labels">Labels</label>
              <select id="opt-labels" value={opts.labels} onChange={(e) => set("labels", e.target.value as Options["labels"])}>
                <option value="auto">auto</option>
                <option value="full">full</option>
                <option value="index">index</option>
              </select>
            </div>
            <div className="ctl">
              <label htmlFor="opt-mark">Mark</label>
              <select id="opt-mark" value={opts.mark} onChange={(e) => set("mark", e.target.value as Severity | "none")}>
                <option value="error">error</option>
                <option value="warning">warning</option>
                <option value="info">info</option>
                <option value="none">none</option>
              </select>
            </div>
            <div className="ctl">
              <label htmlFor="opt-format">Source</label>
              <div className="rangerow">
                <button id="opt-format" type="button" onClick={format}>Format</button>
                <button type="button" onClick={undo} disabled={hist.past.length === 0} title="⌘Z">
                  Undo{hist.past.length ? ` (${hist.past.length})` : ""}
                </button>
                <button type="button" onClick={redo} disabled={hist.future.length === 0} title="⇧⌘Z">
                  Redo{hist.future.length ? ` (${hist.future.length})` : ""}
                </button>
                <button type="button" onClick={reset} disabled={text === example.source}>Reset</button>
              </div>
            </div>
          </div>
        </section>

        <div className="drawing-col">
          {shown && multiLevel && (
            <LevelSwitcher levels={levels} activeId={activeLevelId} groundId={groundId} onSelect={selectLevel} />
          )}
          {shown && activeLevel ? (
            <Drawing
              svg={activeLevel.svg}
              model={shown.result.model}
              text={text}
              render={shown.render}
              level={activeLevelId}
              highlight={activeFinding !== null ? (levelFindings[activeFinding] ?? null) : null}
              highlightNumber={activeFinding !== null && activeFinding < markedFindings ? activeFinding + 1 : null}
              stale={stale}
              onDragStart={mark}
              onChange={setText}
            />
          ) : (
            <section className="panel">
              <div className="panel-head">
                <h2>Drawing</h2>
                <span className="note">north up · y grows south</span>
              </div>
              <div className="schemaerr">
                {!outcome.ok && outcome.title}:
                <ul>
                  {!outcome.ok &&
                    outcome.issues.map((i, n) => (
                      <li key={n}>
                        <span className="path">
                          {/* a tokenizer message already opens with `line N:`, so the
                              locator shows the path rather than saying the line twice */}
                          {i.message.startsWith("line ") ? i.path || "—" : i.line !== undefined ? `line ${i.line}` : i.path || "(root)"}
                        </span>
                        : {i.message}
                      </li>
                    ))}
                </ul>
              </div>
            </section>
          )}

          {shown && levelSchedule && (
            <ScheduleTable schedule={levelSchedule} building={shown.result.schedule.building} levelName={multiLevel ? activeLevel?.name : undefined} />
          )}
          {shown && (
            <FindingsList
              findings={levelFindings}
              markedCount={markedFindings}
              active={activeFinding}
              onEnter={setHoverFinding}
              onLeave={() => setHoverFinding(null)}
              onToggle={(i) => setPinFinding((p) => (p === i ? null : i))}
            />
          )}
        </div>
      </div>
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span className="dot" />
          Updated
        </div>
      )}
    </>
  );
}

type Levels = Extract<ReturnType<typeof useFloorplan>, { ok: true }>["result"]["levels"];

/** Tabs for the levels of a multi-level plan, ground-up (`levels` is already in `stack`
 *  order — src/index.ts). Rendered only when there is more than one to choose from. */
function LevelSwitcher({
  levels,
  activeId,
  groundId,
  onSelect,
}: {
  levels: Levels;
  activeId: string | undefined;
  groundId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="levels" role="tablist" aria-label="Level">
      {levels.map((l) => (
        <button
          key={l.id}
          type="button"
          role="tab"
          aria-selected={l.id === activeId}
          data-active={l.id === activeId}
          onClick={() => onSelect(l.id)}
        >
          {l.name}
          {l.id === groundId && <span className="ground-badge">ground</span>}
        </button>
      ))}
    </div>
  );
}

function ScheduleTable({
  schedule,
  building,
  levelName,
}: {
  /** the section for one level — the selected one, or the ground/only level's when the
   *  plan has no others (`Schedule` itself satisfies this shape: src/index.ts) */
  schedule: LevelSchedule;
  /** present only on a plan that authored `levels` (src/index.ts's `Schedule.building`) */
  building?: Schedule["building"] | undefined;
  /** the selected level's name, shown in the header on a multi-level plan */
  levelName?: string | undefined;
}) {
  const n = (v: number) => v.toFixed(2);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Room schedule{levelName ? ` — ${levelName}` : ""}</h2>
        <span className="note">m²</span>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Room</th><th>Kind</th><th>Clear</th><th>Fixtures</th><th>Usable</th></tr>
          </thead>
          <tbody>
            {schedule.rooms.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="num dim">{r.kind}</td>
                <td className="num">{n(r.clearArea)}</td>
                <td className={r.fixtureArea ? "num" : "num nil"}>{r.fixtureArea ? n(r.fixtureArea) : "—"}</td>
                <td className="num">{n(r.usableArea)}</td>
              </tr>
            ))}
            {schedule.outdoor.map((o) => (
              <tr key={o.id}>
                <td>{o.name}</td>
                <td className="num dim">{o.covered ? "covered" : "open sky"}</td>
                <td className="num">{n(o.area)}</td>
                <td className={o.fixtureArea ? "num" : "num nil"}>{o.fixtureArea ? n(o.fixtureArea) : "—"}</td>
                <td className="num">{n(o.usableArea)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Interior</td><td />
              <td>{n(schedule.interiorClearArea)}</td>
              <td>{schedule.waterArea ? n(schedule.waterArea) : "—"}</td>
              <td>{n(schedule.rooms.reduce((s, r) => s + r.usableArea, 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {building && (
        <div className="building-totals">
          <span><strong>{building.storeys}</strong> storeys</span>
          <span>gross <strong>{n(building.grossArea)}</strong> m²</span>
          <span>footprint <strong>{n(building.footprint)}</strong> m²</span>
          <span>interior <strong>{n(building.interiorClearArea)}</strong> m²</span>
          {building.waterArea > 0 && <span>water <strong>{n(building.waterArea)}</strong> m²</span>}
        </div>
      )}
    </section>
  );
}

interface FindingsListProps {
  findings: Finding[];
  /** how many leading findings (sortFindings order) got a numbered marker in the SVG */
  markedCount: number;
  active: number | null;
  onEnter: (i: number) => void;
  onLeave: () => void;
  onToggle: (i: number) => void;
}

function FindingsList({ findings, markedCount, active, onEnter, onLeave, onToggle }: FindingsListProps) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Findings</h2>
        <span className="note">{findings.length === 0 ? "none" : `${findings.length} total`}</span>
      </div>
      {findings.length === 0 ? (
        <p className="clean">
          <strong>Clean.</strong> Every room has a door and daylight, the plan tiles without gaps, and the entrance reaches everywhere.
        </p>
      ) : (
        <ul className="findings">
          {findings.map((f, i) => (
            <li
              key={i}
              className={active === i ? `${f.severity} active` : f.severity}
              onMouseEnter={() => onEnter(i)}
              onMouseLeave={onLeave}
              onClick={() => onToggle(i)}
            >
              {i < markedCount && <span className="num">{i + 1}</span>}
              <span className="chip">{f.severity}</span>
              <span className="rule">{f.rule}</span>
              <span className="msg">{f.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
