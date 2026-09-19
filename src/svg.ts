import { doorSwing } from "./doors.ts";
import { snap } from "./geometry.ts";
import type { Finding, Model, Pt, ResolvedOpening, WallSegment } from "./types.ts";

export interface RenderOptions {
  /** pixels per metre (default 40) */
  scale?: number;
  theme?: "auto" | "light" | "dark";
  /** override any CSS custom property, e.g. { wall: "#000", bg: "#fff" } */
  colors?: Partial<Record<"bg" | "wall" | "ink" | "muted" | "accent", string>>;
  /** "auto": full label where it fits, numbered key otherwise */
  labels?: "auto" | "full" | "index";
  /** which area to print under the room name */
  areas?: "clear" | "centreline" | "none";
  dimensions?: boolean;
  /** draw markers for these findings */
  findings?: Finding[];
  locale?: string;
  title?: string;
}

const PALETTE = ["#2f6fdb", "#e07b1a", "#2f9e5b", "#8e5bd6", "#1fa2a6", "#d64545"];
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const px = (n: number) => String(Math.round(n * 100) / 100);

/** Render a derived model to a standalone SVG string. Pure; no DOM. */
export function renderSvg(model: Model, opts: RenderOptions = {}): string {
  const S = opts.scale ?? 40;
  const plan = model.plan;
  const env = model.envelope;
  const outdoorBox = model.plan.outdoor.flatMap((o) => o.poly);
  const allPts = [...model.rooms.flatMap((r) => r.room.poly), ...outdoorBox];
  const minX = Math.min(...allPts.map((p) => p[0]));
  const minY = Math.min(...allPts.map((p) => p[1]));
  const maxX = Math.max(...allPts.map((p) => p[0]));
  const maxY = Math.max(...allPts.map((p) => p[1]));
  const title = opts.title ?? plan.title;
  const dims = opts.dimensions ?? true;
  const fmt = new Intl.NumberFormat(opts.locale ?? "en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt2 = new Intl.NumberFormat(opts.locale ?? "en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const OX = (dims ? 78 : 24) + 0;
  const OY = (dims ? 56 : 24) + (title ? 30 : 0);
  const X = (m: number) => OX + (m - minX) * S;
  const Y = (m: number) => OY + (m - minY) * S;
  const L = (m: number) => m * S;

  // zone colours by first appearance
  const zoneColour = new Map<string, string>();
  for (const r of model.rooms) {
    const z = r.room.zone ?? r.room.kind;
    if (!zoneColour.has(z)) zoneColour.set(z, PALETTE[zoneColour.size % PALETTE.length]!);
  }

  // labels: decide full vs index per room
  const mode = opts.labels ?? "auto";
  const key: Array<{ n: number; name: string; area: string }> = [];
  const areaOf = (r: (typeof model.rooms)[number]) =>
    opts.areas === "none" ? "" : `${fmt.format(opts.areas === "centreline" ? r.area : r.clearArea)} m²`;

  let body = "";

  // ---- outdoor spaces ----
  for (const o of plan.outdoor) {
    body += `<polygon points="${pts(o.poly)}" fill="var(--accent)" fill-opacity=".08" stroke="var(--accent)" stroke-width="1" stroke-dasharray="5 4"/>`;
    const c = centroid(o.poly);
    body += text(X(c[0]), Y(c[1]) - 2, o.name, "rn") + text(X(c[0]), Y(c[1]) + 12, `${fmt.format(Math.abs(area(o.poly)))} m²${o.covered ? " covered" : ""}`, "ra");
  }

  // ---- room fills ----
  for (const r of model.rooms) {
    const col = zoneColour.get(r.room.zone ?? r.room.kind)!;
    body += `<g class="room" data-id="${esc(r.room.id)}"><title>${esc(r.room.name)} — ${esc(areaOf(r))}</title>`;
    body += `<polygon points="${pts(r.room.poly)}" fill="${col}" fill-opacity="var(--fill-alpha)"/></g>`;
  }

  // ---- walls, split at openings; partitions first so exterior walls cover their ends ----
  const openingsByWall = new Map<string, ResolvedOpening[]>();
  for (const o of model.openings) (openingsByWall.get(o.wall.id) ?? openingsByWall.set(o.wall.id, []).get(o.wall.id)!).push(o);
  const wallOrder = [...model.walls].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "partition" ? -1 : 1));
  for (const w of wallOrder) {
    const t = L(w.thickness);
    const ext = t / 2;
    const cuts = (openingsByWall.get(w.id) ?? []).map((o) => [o.from, o.to] as const).sort((a, b) => a[0] - b[0]);
    let cursor = w.from;
    const runs: Array<[number, number, boolean, boolean]> = []; // from, to, extendStart, extendEnd
    for (const [a, b] of cuts) {
      if (a > cursor) runs.push([cursor, a, cursor === w.from, false]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < w.to) runs.push([cursor, w.to, cursor === w.from, true]);
    if (cuts.length === 0) runs.splice(0, runs.length, [w.from, w.to, true, true]);
    for (const [a, b, es, ee] of runs) {
      // a real wall end extends by half its thickness to fill the corner; an opening jamb does not
      const aa = (w.axis === "h" ? X(a) : Y(a)) - (es ? ext : 0);
      const bb = (w.axis === "h" ? X(b) : Y(b)) + (ee ? ext : 0);
      const c = w.axis === "h" ? Y(w.c) : X(w.c);
      const opacity = w.kind === "exterior" ? "1" : ".9";
      body +=
        w.axis === "h"
          ? `<line x1="${px(aa)}" y1="${px(c)}" x2="${px(bb)}" y2="${px(c)}" stroke="var(--wall)" stroke-opacity="${opacity}" stroke-width="${px(t)}" stroke-linecap="butt"/>`
          : `<line x1="${px(c)}" y1="${px(aa)}" x2="${px(c)}" y2="${px(bb)}" stroke="var(--wall)" stroke-opacity="${opacity}" stroke-width="${px(t)}" stroke-linecap="butt"/>`;
    }
  }

  // ---- openings ----
  for (const o of model.openings) {
    const w = o.wall;
    const t = L(w.thickness);
    const p0 = at(w, o.from);
    const p1 = at(w, o.to);
    if (o.spec.type === "window") {
      const off = t / 4;
      const dx = w.axis === "h" ? 0 : off;
      const dy = w.axis === "h" ? off : 0;
      body += `<g class="window"><line x1="${px(X(p0[0]) - dx)}" y1="${px(Y(p0[1]) - dy)}" x2="${px(X(p1[0]) - dx)}" y2="${px(Y(p1[1]) - dy)}" stroke="var(--wall)" stroke-width="1"/>`;
      body += `<line x1="${px(X(p0[0]) + dx)}" y1="${px(Y(p0[1]) + dy)}" x2="${px(X(p1[0]) + dx)}" y2="${px(Y(p1[1]) + dy)}" stroke="var(--wall)" stroke-width="1"/></g>`;
    } else if (o.spec.type === "cased") {
      body += `<line x1="${px(X(p0[0]))}" y1="${px(Y(p0[1]))}" x2="${px(X(p1[0]))}" y2="${px(Y(p1[1]))}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 3"/>`;
    } else {
      const s = doorSwing(o);
      if (!s) continue;
      const r = L(o.to - o.from);
      body += `<g class="door"><path d="M${px(X(s.closed[0]))} ${px(Y(s.closed[1]))} A${px(r)} ${px(r)} 0 0 ${s.sweep} ${px(X(s.open[0]))} ${px(Y(s.open[1]))}" fill="none" stroke="var(--muted)" stroke-width="1"/>`;
      body += `<line x1="${px(X(s.hinge[0]))}" y1="${px(Y(s.hinge[1]))}" x2="${px(X(s.open[0]))}" y2="${px(Y(s.open[1]))}" stroke="var(--wall)" stroke-width="2"/></g>`;
      if (o.spec.entrance || (w.kind === "exterior" && model.openings.filter((d) => d.spec.type === "door" && d.wall.kind === "exterior").length === 1)) {
        const c = o.center;
        const out: Pt = w.axis === "h" ? [0, w.neg === "exterior" ? -1 : 1] : [w.neg === "exterior" ? -1 : 1, 0];
        const lx = X(c[0]) + out[0] * (t / 2 + 14);
        const ly = Y(c[1]) + out[1] * (t / 2 + 14);
        const rot = w.axis === "v" ? ` transform="rotate(-90 ${px(lx)} ${px(ly)})"` : "";
        body += `<text x="${px(lx)}" y="${px(ly + 3)}" text-anchor="middle" class="tag"${rot}>ENTRANCE</text>`;
      }
    }
  }

  // ---- labels ----
  model.rooms.forEach((r, i) => {
    const [lx, ly] = [X(r.labelAt[0]), Y(r.labelAt[1])];
    const rectW = L(r.largestRect.x1 - r.largestRect.x0) - L(r.room.circulation ? 0 : plan.walls.partition);
    const rectH = L(r.largestRect.y1 - r.largestRect.y0);
    const nameW = r.room.name.length * 12 * 0.56;
    const fits = nameW <= rectW - 6 && rectH >= 26;
    const useIndex = mode === "index" || (mode === "auto" && !fits);
    if (useIndex) {
      const n = key.length + 1;
      key.push({ n, name: r.room.name, area: areaOf(r) });
      body += `<circle cx="${px(lx)}" cy="${px(ly)}" r="8" fill="var(--bg)" stroke="var(--ink)" stroke-width="1"/>`;
      body += text(lx, ly + 3.5, String(n), "rk");
    } else {
      body += text(lx, ly - (opts.areas === "none" ? -4 : 2), r.room.name, "rn");
      if (opts.areas !== "none") body += text(lx, ly + 12, areaOf(r), "ra");
    }
    void i;
  });

  // ---- dimensions ----
  if (dims) {
    const dy = Y(minY) - 26;
    const dx = X(minX) - 34;
    body += `<g class="dims" stroke="var(--muted)" stroke-width="1">`;
    body += `<line x1="${px(X(env.x0))}" y1="${px(dy)}" x2="${px(X(env.x1))}" y2="${px(dy)}"/>`;
    body += `<line x1="${px(X(env.x0))}" y1="${px(dy - 5)}" x2="${px(X(env.x0))}" y2="${px(dy + 5)}"/><line x1="${px(X(env.x1))}" y1="${px(dy - 5)}" x2="${px(X(env.x1))}" y2="${px(dy + 5)}"/>`;
    body += `<line x1="${px(dx)}" y1="${px(Y(env.y0))}" x2="${px(dx)}" y2="${px(Y(env.y1))}"/>`;
    body += `<line x1="${px(dx - 5)}" y1="${px(Y(env.y0))}" x2="${px(dx + 5)}" y2="${px(Y(env.y0))}"/><line x1="${px(dx - 5)}" y1="${px(Y(env.y1))}" x2="${px(dx + 5)}" y2="${px(Y(env.y1))}"/>`;
    body += `</g>`;
    body += text(X((env.x0 + env.x1) / 2), dy - 7, `${fmt2.format(env.x1 - env.x0)} m`, "dim");
    const my = Y((env.y0 + env.y1) / 2);
    body += `<text x="${px(dx - 8)}" y="${px(my)}" text-anchor="middle" class="dim" transform="rotate(-90 ${px(dx - 8)} ${px(my)})">${esc(fmt2.format(env.y1 - env.y0))} m</text>`;
  }

  // ---- north arrow ----
  const nx = X(maxX) + 58;
  const ny = Y(minY) + 30;
  body += `<g transform="rotate(${plan.north} ${px(nx)} ${px(ny)})" stroke="var(--ink)" fill="var(--ink)"><line x1="${px(nx)}" y1="${px(ny + 20)}" x2="${px(nx)}" y2="${px(ny - 14)}" stroke-width="1.5"/><path d="M${px(nx)} ${px(ny - 20)} L${px(nx - 5)} ${px(ny - 9)} L${px(nx + 5)} ${px(ny - 9)} z" stroke="none"/></g>`;
  body += text(nx, ny + 34, "N", "dim");

  // ---- scale bar ----
  const span = env.x1 - env.x0;
  const barM = span >= 8 ? 5 : span >= 3 ? 2 : 1;
  const sbx = X(minX);
  const sby = Y(maxY) + 40;
  body += `<g stroke="var(--ink)"><line x1="${px(sbx)}" y1="${px(sby)}" x2="${px(sbx + L(barM))}" y2="${px(sby)}" stroke-width="2"/>`;
  for (let i = 0; i <= barM; i++) body += `<line x1="${px(sbx + L(i))}" y1="${px(sby - 4)}" x2="${px(sbx + L(i))}" y2="${px(sby + 4)}" stroke-width="1"/>`;
  body += `</g>${text(sbx, sby + 17, "0", "dim", "start")}${text(sbx + L(barM), sby + 17, `${barM} m`, "dim")}`;

  // ---- key for indexed rooms ----
  let keyH = 0;
  if (key.length) {
    const kx = sbx + L(barM) + 60;
    const perCol = Math.max(4, Math.ceil(key.length / 3));
    key.forEach((k, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const x = kx + col * 170;
      const y = sby - 4 + row * 15;
      body += text(x, y + 4, `${k.n}`, "rk", "end") + text(x + 8, y + 4, `${k.name}  ${k.area}`, "ra", "start");
    });
    keyH = Math.max(0, perCol * 15 - 20);
  }

  // ---- finding markers ----
  const marks = opts.findings ?? [];
  marks.forEach((f, i) => {
    if (!f.at) return;
    const col = f.severity === "error" ? "#d64545" : f.severity === "warning" ? "#e07b1a" : "#2f6fdb";
    // a finding anchored on a room label sits just after the room name instead of on top of it
    const room = model.rooms.find((r) => r.labelAt[0] === f.at![0] && r.labelAt[1] === f.at![1]);
    const mx = room ? X(f.at[0]) + (room.room.name.length * 12 * 0.56) / 2 + 14 : X(f.at[0]);
    const my = room ? Y(f.at[1]) - 6 : Y(f.at[1]);
    body += `<g class="finding"><title>${esc(`${f.severity} ${f.rule}: ${f.message}`)}</title><circle cx="${px(mx)}" cy="${px(my)}" r="9" fill="${col}" fill-opacity=".9"/>${text(mx, my + 3.5, String(i + 1), "mk")}</g>`;
  });

  // ---- title ----
  if (title) body += `<text x="${px(OX)}" y="${px(dims ? 24 : 18)}" class="title">${esc(title)}</text>`;

  const vw = X(maxX) + 108;
  const vh = sby + 30 + keyH;
  const theme = opts.theme ?? "auto";
  const vars = Object.entries(opts.colors ?? {})
    .map(([k, v]) => `--${k}:${v};`)
    .join("");
  const aria = `Floor plan${title ? ` ${title}` : ""}, ${fmt2.format(env.x1 - env.x0)} by ${fmt2.format(env.y1 - env.y0)} metres, ${model.rooms.length} rooms`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px(vw)} ${px(vh)}" width="${px(vw)}" height="${px(vh)}" class="floorplan theme-${theme}" role="img" aria-label="${esc(aria)}"${vars ? ` style="${vars}"` : ""}>` +
    `<style>${STYLE}</style>` +
    `<rect width="100%" height="100%" fill="var(--bg)"/>` +
    body +
    `</svg>`
  );

  function pts(poly: Pt[]) {
    return poly.map((p) => `${px(X(p[0]))},${px(Y(p[1]))}`).join(" ");
  }
  function text(x: number, y: number, s: string, cls: string, anchor = "middle") {
    return `<text x="${px(x)}" y="${px(y)}" text-anchor="${anchor}" class="${cls}">${esc(s)}</text>`;
  }
  function at(w: WallSegment, t: number): Pt {
    return w.axis === "h" ? [t, w.c] : [w.c, t];
  }
}

function centroid(poly: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of poly) (x += p[0]), (y += p[1]);
  return [snap(x / poly.length), snap(y / poly.length)];
}
function area(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

const STYLE = `
svg.floorplan{--bg:#ffffff;--wall:#1b1b1b;--ink:#333333;--muted:#8a8a8a;--accent:#2f9e5b;--fill-alpha:.14;font-family:${FONT}}
svg.floorplan.theme-dark{--bg:#121212;--wall:#ededed;--ink:#d6d6d6;--muted:#8f8f8f;--fill-alpha:.28}
@media (prefers-color-scheme:dark){svg.floorplan.theme-auto{--bg:#121212;--wall:#ededed;--ink:#d6d6d6;--muted:#8f8f8f;--fill-alpha:.28}}
.rn{font-size:12px;font-weight:600;fill:var(--ink)}
.ra{font-size:10.5px;fill:var(--muted)}
.rk{font-size:10px;font-weight:700;fill:var(--ink)}
.dim{font-size:10.5px;fill:var(--muted);font-variant-numeric:tabular-nums}
.tag{font-size:8.5px;font-weight:700;letter-spacing:.08em;fill:var(--accent)}
.mk{font-size:10px;font-weight:700;fill:#fff}
.title{font-size:15px;font-weight:700;fill:var(--ink)}
`.trim();
