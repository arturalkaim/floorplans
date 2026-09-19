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
        const r = floorplan(JSON.parse(e.source), {
          render: { scale: 16, labels: "index", areas: "none", dimensions: false, title: "" },
          markFindings: "none",
        });
        return { ...e, svg: r.svg, counts: tally(r.findings) };
      }),
    [],
  );

  return (
    <>
      <p style={{ color: "var(--muted)", margin: "0 0 16px" }}>
        Seven example plans. Open one to edit it and watch the drawing, the schedule and the findings follow.
      </p>
      <div className="gallery">
        {cards.map((c) => (
          <Link key={c.id} to="/plan/$id" params={{ id: c.id }} className="card">
            <div className="thumb" dangerouslySetInnerHTML={{ __html: c.svg }} />
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
