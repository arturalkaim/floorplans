import { Link, useParams } from "@tanstack/react-router";
import { formatText } from "floorplan";
import type { Severity } from "floorplan";
import { useCallback, useEffect, useRef, useState } from "react";
import { Drawing } from "../components/Drawing";
import { EXAMPLES, byId } from "../lib/plans";
import { useFloorplan } from "../lib/useFloorplan";
import type { Options, Outcome } from "../lib/useFloorplan";

const DEFAULTS: Omit<Options, "theme"> = { scale: 40, areas: "clear", labels: "auto", mark: "warning" };
/** how many steps of history to keep, each way */
const HISTORY = 50;
const EMPTY_HISTORY = { past: [] as string[], future: [] as string[] };

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

  // typing is its own undo step, collapsed while you keep typing
  const typingTimer = useRef<number | undefined>(undefined);
  const onType = useCallback(
    (next: string) => {
      window.clearTimeout(typingTimer.current);
      const before = textRef.current;
      typingTimer.current = window.setTimeout(
        () => setHist((h) => ({ past: [...h.past, before].slice(-HISTORY), future: [] })),
        600,
      );
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
    setText((t) => {
      try {
        return formatText(t);
      } catch {
        return t;
      }
    });
  }, [mark]);

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
        {shown && (
          <>
            <div className="tb-field">
              <span className="k">Footprint</span>
              <span className="v">{shown.result.schedule.footprint.toFixed(2)} m²</span>
            </div>
            <div className="tb-field">
              <span className="k">Clear area</span>
              <span className="v">{shown.result.schedule.interiorClearArea.toFixed(2)} m²</span>
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
            <span className="note">metres, wall centrelines</span>
          </div>
          <nav className="nav" style={{ flexWrap: "wrap", padding: "8px 10px", borderBottom: "1px solid var(--rule)" }}>
            {EXAMPLES.map((e) => (
              <Link key={e.id} to="/plan/$id" params={{ id: e.id }}>
                {({ isActive }) => <span data-active={isActive}>{e.name}</span>}
              </Link>
            ))}
          </nav>
          <textarea
            id="plan-source"
            className="source-text"
            spellCheck={false}
            aria-label="Plan JSON"
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
          {shown ? (
            <Drawing
              svg={shown.result.svg}
              model={shown.result.model}
              text={text}
              scale={opts.scale}
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
                        <span className="path">{i.path || "(root)"}</span>: {i.message}
                      </li>
                    ))}
                </ul>
              </div>
            </section>
          )}

          {shown && <ScheduleTable schedule={shown.result.schedule} />}
          {shown && <FindingsList findings={shown.result.findings} />}
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

type Sched = Extract<ReturnType<typeof useFloorplan>, { ok: true }>["result"]["schedule"];

function ScheduleTable({ schedule }: { schedule: Sched }) {
  const n = (v: number) => v.toFixed(2);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Room schedule</h2>
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
    </section>
  );
}

function FindingsList({ findings }: { findings: Sched extends never ? never : import("floorplan").Finding[] }) {
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
            <li key={i} className={f.severity}>
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
