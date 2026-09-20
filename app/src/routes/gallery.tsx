import { Link } from "@tanstack/react-router";
import { floorplan } from "floorplan";
import type { Finding } from "floorplan";
import { useMemo } from "react";
import { EXAMPLES } from "../lib/plans";

const tally = (findings: Finding[]) => ({
  error: findings.filter((f) => f.severity === "error").length,
  warning: findings.filter((f) => f.severity === "warning").length,
  info: findings.filter((f) => f.severity === "info").length,
});

export function Gallery() {
  const cards = useMemo(
    () =>
      EXAMPLES.map((e) => {
        // e.source is raw text in whichever syntax the fixture is written (JSON or DSL);
        // floorplan() sniffs it itself (src/index.ts), so it is passed through untouched
        // rather than JSON.parse()d — the DSL example (Cabana) is not valid JSON.
        const r = floorplan(e.source, {
          render: { scale: 16, labels: "index", areas: "none", dimensions: false, title: "" },
          markFindings: "none",
        });
        // the gallery always shows the ground level — `r.svg` is exactly that (src/index.ts)
        return { ...e, svg: r.svg, counts: tally(r.findings), levels: r.levels.length };
      }),
    [],
  );

  return (
    <>
      <p style={{ color: "var(--muted)", margin: "0 0 16px" }}>
        {cards.length} example plans. Open one to edit it and watch the drawing, the schedule and the findings follow.
      </p>
      <div className="gallery">
        {cards.map((c) => (
          <Link key={c.id} to="/plan/$id" params={{ id: c.id }} className="card">
            <div className="thumb">
              {c.levels > 1 && <span className="badge">{c.levels} levels</span>}
              <div dangerouslySetInnerHTML={{ __html: c.svg }} />
            </div>
            <div className="meta">
              <h3>{c.name}</h3>
              <p>{c.shows}</p>
              <div className="tally">
                {c.counts.error > 0 && <span className="error">{c.counts.error} error</span>}
                {c.counts.warning > 0 && <span className="warning">{c.counts.warning} warning</span>}
                {c.counts.info > 0 && <span className="info">{c.counts.info} info</span>}
                {c.counts.error + c.counts.warning + c.counts.info === 0 && <span className="ok">clean</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
