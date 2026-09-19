import { Link, useParams } from "@tanstack/react-router";
import { formatText } from "floorplan";
import type { Severity } from "floorplan";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Drawing } from "../components/Drawing";
import { EXAMPLES, byId } from "../lib/plans";
import { useFloorplan } from "../lib/useFloorplan";
import type { Options } from "../lib/useFloorplan";

const DEFAULTS: Omit<Options, "theme"> = { scale: 40, areas: "clear", labels: "auto", mark: "warning" };

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
  const [opts, setOpts] = useState(DEFAULTS);
  const theme = useResolvedTheme();

  // switching plan replaces the document
  useEffect(() => {
    if (example) setText(example.source);
  }, [example]);

  const outcome = useFloorplan(text, { ...opts, theme });
  const set = useCallback(<K extends keyof typeof opts>(k: K, v: (typeof opts)[K]) => setOpts((o) => ({ ...o, [k]: v })), []);
  const format = useCallback(() => setText((t) => { try { return formatText(t); } catch { return t; } }), []);

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
        {outcome.ok && (
          <>
            <div className="tb-field">
              <span className="k">Footprint</span>
              <span className="v">{outcome.result.schedule.footprint.toFixed(2)} m²</span>
            </div>
            <div className="tb-field">
              <span className="k">Clear area</span>
              <span className="v">{outcome.result.schedule.interiorClearArea.toFixed(2)} m²</span>
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
            onChange={(e) => setText(e.target.value)}
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
              <button id="opt-format" type="button" onClick={format}>Format</button>
            </div>
          </div>
        </section>

        <div className="drawing-col">
          {outcome.ok ? (
            <Drawing
              svg={outcome.result.svg}
              model={outcome.result.model}
              text={text}
              scale={opts.scale}
              onChange={setText}
            />
          ) : (
            <section className="panel">
              <div className="panel-head">
                <h2>Drawing</h2>
                <span className="note">north up · y grows south</span>
              </div>
              <div className="schemaerr">
                {outcome.title}:
                <ul>
                  {outcome.issues.map((i, n) => (
                    <li key={n}>
                      <span className="path">{i.path || "(root)"}</span>: {i.message}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {outcome.ok && <ScheduleTable schedule={outcome.result.schedule} />}
          {outcome.ok && <FindingsList findings={outcome.result.findings} />}
        </div>
      </div>
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
