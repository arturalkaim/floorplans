import { geometryPath, normalOn, offsetGeometry, pointOn, wallSubGeometry } from "./derive.ts";
import { doorSwing } from "./doors.ts";
import { snap } from "./geometry.ts";
import type { Finding, LevelModel, Model, Owner, Pt, ResolvedOpening } from "./types.ts";
import { isStreet } from "./types.ts";

export interface RenderOptions {
  /**
   * Which level to draw (default: the ground level). One SVG per level is the convention
   * architects read and the token-cheap answer for an agent, which asks for the level it
   * is working on.
   */
  level?: string;
  /**
   * Draw the level below in outline under this one (default true). It is what makes it
   * possible to see at a glance whether the walls upstairs land on the walls downstairs.
   */
  ghost?: boolean;
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

/**
 * Where the drawing puts a point. Exported because a caller that wants to interact with
 * the SVG — hit-testing a wall, dragging it — has to turn client pixels back into metres,
 * and must use the very same transform the renderer used or the two will disagree.
 */
export interface Projection {
  /** pixels per metre */
  scale: number;
  /** drawing origin in SVG units */
  ox: number;
  oy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  toScreen(p: Pt): Pt;
  /** SVG user units back to metres */
  toModel(x: number, y: number): Pt;
}

/**
 * The level a drawing is about: the one `opts.level` names, or the ground level. An
 * unknown id falls back to the ground level rather than throwing — a render is never the
 * right place to fail a plan that parsed.
 */
export function levelOf(model: Model, level: string | undefined): LevelModel {
  // always a member of `model.levels`, never the Model itself, so callers can ask what
  // sits under it by position in the stack
  const want = level ?? model.level.id;
  return model.levels.find((m) => m.level.id === want) ?? model.levels[0]!;
}

export function projection(model: Model, opts: RenderOptions = {}): Projection {
  const scale = opts.scale ?? 40;
  // Every level is measured against the same extent, because they share the plan origin
  // and axes: two levels of one house must line up sheet to sheet, and the ghost of the
  // level below may reach past the level being drawn.
  const allPts = [
    ...model.levels.flatMap((m) => m.rooms.flatMap((r) => r.room.poly)),
    ...model.levels.flatMap((m) => m.level.outdoor.flatMap((o) => o.poly)),
  ];
  const minX = Math.min(...allPts.map((p) => p[0]));
  const minY = Math.min(...allPts.map((p) => p[1]));
  const maxX = Math.max(...allPts.map((p) => p[0]));
  const maxY = Math.max(...allPts.map((p) => p[1]));
  const title = opts.title ?? model.plan.title;
  const dims = opts.dimensions ?? true;
  const ox = (dims ? 78 : 24) + 0;
  const oy = (dims ? 56 : 24) + (title ? 30 : 0);
  return {
    scale,
    ox,
    oy,
    minX,
    minY,
    maxX,
    maxY,
    toScreen: (p) => [ox + (p[0] - minX) * scale, oy + (p[1] - minY) * scale],
    toModel: (x, y) => [(x - ox) / scale + minX, (y - oy) / scale + minY],
  };
}

/** Render a derived model to a standalone SVG string. Pure; no DOM. */
export function renderSvg(model: Model, opts: RenderOptions = {}): string {
  const proj = projection(model, opts);
  const S = proj.scale;
  const plan = model.plan;
  const lm = levelOf(model, opts.level);
  const below = model.levels[model.levels.indexOf(lm) - 1];
  const env = lm.envelope;
  const { minX, minY, maxX, maxY } = proj;
  const planTitle = plan.title === undefined ? undefined : plan.levelled ? `${plan.title} — ${lm.level.name}` : plan.title;
  const title = opts.title ?? planTitle;
  const dims = opts.dimensions ?? true;
  const fmt = new Intl.NumberFormat(opts.locale ?? "en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt2 = new Intl.NumberFormat(opts.locale ?? "en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const OX = proj.ox;
  const OY = proj.oy;
  const X = (m: number) => OX + (m - minX) * S;
  const Y = (m: number) => OY + (m - minY) * S;
  const L = (m: number) => m * S;

  // zone colours by first appearance
  const zoneColour = new Map<string, string>();
  for (const r of lm.rooms) {
    const z = r.room.zone ?? r.room.kind;
    if (!zoneColour.has(z)) zoneColour.set(z, PALETTE[zoneColour.size % PALETTE.length]!);
  }

  // labels: decide full vs index per room
  const mode = opts.labels ?? "auto";
  const key: Array<{ n: number; name: string; area: string }> = [];
  const areaOf = (r: (typeof lm.rooms)[number]) =>
    opts.areas === "none" ? "" : `${fmt.format(opts.areas === "centreline" ? r.area : r.clearArea)} m²`;

  let body = "";

  // ---- the level below, ghosted ----
  // Outline and walls only, no labels and no fills: enough to see whether this floor
  // lands on the one under it, quiet enough never to be mistaken for this floor.
  if (below && (opts.ghost ?? true)) {
    body += `<g class="ghost" aria-hidden="true" fill="none" stroke="var(--muted)" stroke-opacity=".28">`;
    for (const ring of below.envelope.outline)
      body += `<polygon points="${pts(ring)}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    for (const w of below.walls) {
      if (w.kind === "exterior") continue;
      body += `<path d="${geometryPath(w.geometry, X, Y, S)}" stroke-width="1" stroke-dasharray="4 4"/>`;
    }
    body += `</g>`;
  }

  // ---- voids: floor that is deliberately not there ----
  for (const v of lm.level.voids) {
    const c = centroid(v.poly);
    body += `<g class="void" data-void="${esc(v.id)}"><title>${esc(v.name)} — no floor</title>`;
    body += `<polygon points="${pts(v.poly)}" fill="var(--ink)" fill-opacity=".05" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3"/>`;
    body += `</g>${text(X(c[0]), Y(c[1]) + 4, v.name, "ra")}`;
  }

  // ---- outdoor spaces ----
  for (const o of lm.level.outdoor) {
    body += `<polygon points="${pts(o.poly)}" fill="var(--accent)" fill-opacity=".08" stroke="var(--accent)" stroke-width="1" stroke-dasharray="5 4"/>`;
    // an outdoor space has no walls, so each edge gets its own handle to grab; drawn
    // transparent over the outline, wide enough to hit without hunting for it
    o.poly.forEach((p0, k) => {
      const p1 = o.poly[(k + 1) % o.poly.length]!;
      const vertical = snap(p0[0]) === snap(p1[0]);
      body +=
        `<line data-outdoor="${esc(o.id)}" data-edge="${k}" data-axis="${vertical ? "v" : "h"}"` +
        ` x1="${px(X(p0[0]))}" y1="${px(Y(p0[1]))}" x2="${px(X(p1[0]))}" y2="${px(Y(p1[1]))}"` +
        ` stroke="transparent" stroke-width="9" stroke-linecap="butt" pointer-events="stroke"/>`;
    });
    const c = centroid(o.poly);
    body += text(X(c[0]), Y(c[1]) - 2, o.name, "rn") + text(X(c[0]), Y(c[1]) + 12, `${fmt.format(Math.abs(area(o.poly)))} m²${o.covered ? " covered" : ""}`, "ra");
  }

  // ---- room fills ----
  for (const r of lm.rooms) {
    const col = zoneColour.get(r.room.zone ?? r.room.kind)!;
    body += `<g class="room" data-id="${esc(r.room.id)}"><title>${esc(r.room.name)} — ${esc(areaOf(r))}</title>`;
    body += `<polygon points="${pts(r.room.poly)}" fill="${col}" fill-opacity="var(--fill-alpha)"/></g>`;
  }

  // ---- fixtures standing in rooms ----
  for (const fm of lm.fixtures) {
    const f = fm.fixture;
    const water = f.type === "pool";
    const fill = water ? "var(--water)" : "var(--muted)";
    const alpha = water ? ".30" : ".16";
    const b = fm.bbox;
    const label = `${f.name}${f.depth ? ` · ${fmt.format(f.depth)} m deep` : ""} — ${fmt2.format(fm.area)} m²`;
    // A vertical element stands on the floor like a fixture but is not one in the
    // document, so it is tagged by its own id: nothing may offer it as `fixtures[-1]`.
    const ref = f.vertical === undefined ? `data-fixture="${f.index}"` : `data-vertical="${esc(f.vertical)}"`;
    body += `<g class="fixture" ${ref} data-type="${esc(f.type)}"><title>${esc(label)}</title>`;
    body += `<polygon ${ref} data-body="1" points="${pts(f.poly)}" fill="${fill}" fill-opacity="${alpha}" stroke="${fill}" stroke-width="1"${water ? "" : ' stroke-dasharray="3 2"'} pointer-events="fill"/>`;
    // name it only where the shape can hold the text, and sit the label at the top of the
    // footprint: a fixture that fills most of its room would otherwise land on the room name
    if ((b.x1 - b.x0) * S > 54 && (b.y1 - b.y0) * S > 18)
      body += text(X((b.x0 + b.x1) / 2), Y(b.y0) + 13, f.name, "fx");
    // a handle per side to resize, over a body that can be picked up and moved
    for (const [side, x1v, y1v, x2v, y2v] of f.vertical !== undefined
      ? []
      : ([
          ["west", b.x0, b.y0, b.x0, b.y1],
          ["east", b.x1, b.y0, b.x1, b.y1],
          ["north", b.x0, b.y0, b.x1, b.y0],
          ["south", b.x0, b.y1, b.x1, b.y1],
        ] as const))
      body +=
        `<line data-fixture="${f.index}" data-side="${side}" data-axis="${side === "west" || side === "east" ? "v" : "h"}"` +
        ` x1="${px(X(x1v))}" y1="${px(Y(y1v))}" x2="${px(X(x2v))}" y2="${px(Y(y2v))}"` +
        ` stroke="transparent" stroke-width="8" pointer-events="stroke"/>`;
    body += `</g>`;
  }

  // ---- walls, split at openings; partitions first so exterior walls cover their ends ----
  //
  // Each run is one stroked <path>, butt-capped, its own geometry followed exactly: an
  // arc is an `A` command, so a curved wall stays smooth at any zoom instead of showing
  // the chords the topology was built from. The old trick — a <line> whose every true
  // end was extended by half a thickness — closed a right angle exactly and nothing
  // else, overshooting at 45° and leaving a notch at 150° (docs/gaps-design.md §1.3.7).
  // What it was standing in for is the mitre at the junction, which is drawn here as the
  // wedge two wall ends leave between them, at whatever angle and whatever two
  // thicknesses they have. `test/svg-coverage.test.ts` measures that the paper covered is
  // the same to within a square millimetre on every fixture.
  const openingsByWall = new Map<string, ResolvedOpening[]>();
  for (const o of lm.openings) (openingsByWall.get(o.wall.id) ?? openingsByWall.set(o.wall.id, []).get(o.wall.id)!).push(o);
  const wallOrder = [...lm.walls].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "partition" ? -1 : 1));
  /** the true (un-cut) ends of every wall, so the junctions between them can be mitred */
  const ends = new Map<string, Array<{ w: (typeof lm.walls)[number]; at: Pt; away: Pt }>>();
  const endKey = (p: Pt) => `${px(p[0])},${px(p[1])}`;
  for (const w of wallOrder) {
    const t = L(w.thickness);
    const cuts = (openingsByWall.get(w.id) ?? []).map((o) => [o.from, o.to] as const).sort((a, b) => a[0] - b[0]);
    let cursor = w.from;
    const runs: Array<[number, number, boolean, boolean]> = []; // from, to, trueStart, trueEnd
    for (const [a, b] of cuts) {
      if (a > cursor) runs.push([cursor, a, cursor === w.from, false]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < w.to) runs.push([cursor, w.to, cursor === w.from, true]);
    if (cuts.length === 0) runs.splice(0, runs.length, [w.from, w.to, true, true]);
    const opacity = w.kind === "exterior" ? "1" : ".9";
    const tag =
      `data-wall="${w.id}"` + (w.axis === undefined ? "" : ` data-axis="${w.axis}" data-c="${w.c}"`);
    for (const [a, b, ts, te] of runs) {
      const g = wallSubGeometry(w, a, b);
      body +=
        `<path ${tag} d="${geometryPath(g, X, Y, S)}" fill="none" stroke="var(--wall)" stroke-opacity="${opacity}"` +
        ` stroke-width="${px(t)}" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="8"/>`;
      // record the two ends that a junction can be mitred at
      for (const [isTrue, param, other] of [
        [ts, a, Math.min(b, a + 0.001)],
        [te, b, Math.max(a, b - 0.001)],
      ] as const) {
        if (!isTrue) continue;
        const at = pointOn(w, param);
        const near = pointOn(w, other);
        const d: Pt = [at[0] - near[0], at[1] - near[1]];
        const l = Math.hypot(d[0], d[1]) || 1;
        const k = endKey(at);
        (ends.get(k) ?? ends.set(k, []).get(k)!).push({ w, at, away: [d[0] / l, d[1] / l] });
      }
    }
  }
  // the wedge two wall ends leave between them: mitred where the mitre is reasonable,
  // bevelled where it would spike, and nothing at all where three or more walls meet,
  // because their own bands already cover that junction
  for (const list of ends.values()) {
    if (list.length !== 2) continue;
    const [p, q] = list as [(typeof list)[number], (typeof list)[number]];
    const wedge = mitreWedge(
      [X(p.at[0]), Y(p.at[1])],
      p.away,
      L(p.w.thickness) / 2,
      q.away,
      L(q.w.thickness) / 2,
    );
    if (wedge) body += `<polygon class="wall-join" points="${wedge.map(([x, y]) => `${px(x)},${px(y)}`).join(" ")}" fill="var(--wall)" fill-opacity="${p.w.kind === "exterior" || q.w.kind === "exterior" ? "1" : ".9"}" stroke="none"/>`;
  }

  // ---- openings ----
  const street = (o: Owner) => isStreet(o, lm.streetOutdoor);
  const streetDoors = lm.openings.filter(
    (d) => d.spec.type === "door" && (street(d.wall.neg) || street(d.wall.pos)),
  ).length;
  for (const o of lm.openings) {
    const w = o.wall;
    const t = L(w.thickness);
    const p0 = pointOn(w, o.from);
    const p1 = pointOn(w, o.to);
    if (o.spec.type === "window") {
      // two lines offset along the wall's own normal — concentric arcs on a curved wall
      const off = w.thickness / 4;
      const g = wallSubGeometry(w, o.from, o.to);
      body += `<g class="window">`;
      for (const s of [-1, 1])
        body += `<path d="${geometryPath(offsetGeometry(g, s * off), X, Y, S)}" fill="none" stroke="var(--wall)" stroke-width="1"/>`;
      body += `</g>`;
    } else if (o.spec.type === "cased") {
      body += `<path d="${geometryPath(wallSubGeometry(w, o.from, o.to), X, Y, S)}" fill="none" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 3"/>`;
    } else {
      const s = doorSwing(o);
      if (!s) continue;
      const r = L(o.to - o.from);
      body += `<g class="door"><path d="M${px(X(s.closed[0]))} ${px(Y(s.closed[1]))} A${px(r)} ${px(r)} 0 0 ${s.sweep} ${px(X(s.open[0]))} ${px(Y(s.open[1]))}" fill="none" stroke="var(--muted)" stroke-width="1"/>`;
      const [hx, hy] = [X(s.hinge[0]), Y(s.hinge[1])];
      const [ox, oy] = [X(s.open[0]), Y(s.open[1])];
      body += `<line x1="${px(hx)}" y1="${px(hy)}" x2="${px(ox)}" y2="${px(oy)}" stroke="var(--wall)" stroke-width="2"/>`;
      if (o.spec.glazed) {
        // D1: a short tick across the leaf, at its midpoint, marks the glazing
        const leafLen = Math.hypot(ox - hx, oy - hy) || 1;
        const nx = (-(oy - hy) / leafLen) * 4;
        const ny = ((ox - hx) / leafLen) * 4;
        const mx = (hx + ox) / 2;
        const my = (hy + oy) / 2;
        body += `<line x1="${px(mx - nx)}" y1="${px(my - ny)}" x2="${px(mx + nx)}" y2="${px(my + ny)}" stroke="var(--wall)" stroke-width="1"/>`;
      }
      body += `</g>`;
      // only a door to the street is an entrance: one onto an enclosed courtyard is an
      // exterior door that leads nowhere, so it gets no tag
      const toStreet = street(w.neg) || street(w.pos);
      if (toStreet && (o.spec.entrance || streetDoors === 1)) {
        const c = o.center;
        // outward along the wall's own normal, away from whichever side the street is on
        const n = normalOn(w, (o.from + o.to) / 2);
        const sgn = street(w.neg) ? -1 : 1;
        const out: Pt = [n[0] * sgn, n[1] * sgn];
        const lx = X(c[0]) + out[0] * (t / 2 + 14);
        const ly = Y(c[1]) + out[1] * (t / 2 + 14);
        // keep the word readable: upright, unless the wall runs more north-south than east-west
        const turn = Math.abs(out[0]) > Math.abs(out[1]) ? -90 : 0;
        const rot = turn === 0 ? "" : ` transform="rotate(${turn} ${px(lx)} ${px(ly)})"`;
        body += `<text x="${px(lx)}" y="${px(ly + 3)}" text-anchor="middle" class="tag"${rot}>ENTRANCE</text>`;
      }
    }
  }

  // ---- labels ----
  lm.rooms.forEach((r, i) => {
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
    const room = lm.rooms.find((r) => r.labelAt[0] === f.at![0] && r.labelAt[1] === f.at![1]);
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
  const aria = `Floor plan${title ? ` ${title}` : ""}, ${fmt2.format(env.x1 - env.x0)} by ${fmt2.format(env.y1 - env.y0)} metres, ${lm.rooms.length} rooms`;

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
}

/**
 * The wedge two wall ends leave between them at a junction: the quadrilateral from the
 * corner out to each butt cap's outer corner and on to where the two outer faces meet.
 *
 * INVARIANT: for two equal-thickness walls meeting at a right angle this is exactly the
 * square that the old renderer filled by extending each end by half a thickness, which
 * is what keeps every existing drawing's ink unchanged (test/svg-coverage.test.ts). At
 * any other angle, or between two different thicknesses, it is the mitre and the old
 * trick was not.
 */
function mitreWedge(
  c: [number, number],
  awayA: Pt,
  hA: number,
  awayB: Pt,
  hB: number,
): Array<[number, number]> | undefined {
  const u: [number, number] = [awayA[0], awayA[1]];
  const v: [number, number] = [-awayB[0], -awayB[1]];
  const cr = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(cr) < 1e-9) return undefined; // collinear: the two bands already meet
  const s = cr > 0 ? -1 : 1;
  const a: [number, number] = [c[0] - u[1] * hA * s, c[1] + u[0] * hA * s];
  const b: [number, number] = [c[0] - v[1] * hB * s, c[1] + v[0] * hB * s];
  const den = u[0] * v[1] - u[1] * v[0];
  const t = ((b[0] - a[0]) * v[1] - (b[1] - a[1]) * v[0]) / den;
  const apex: [number, number] = [a[0] + u[0] * t, a[1] + u[1] * t];
  const limit = 8 * Math.max(hA, hB);
  return Math.hypot(apex[0] - c[0], apex[1] - c[1]) <= limit ? [c, a, apex, b] : [c, a, b];
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
svg.floorplan{--bg:#ffffff;--wall:#1b1b1b;--ink:#333333;--muted:#8a8a8a;--accent:#2f9e5b;--water:#2f7fd0;--fill-alpha:.14;font-family:${FONT}}
svg.floorplan.theme-dark{--bg:#121212;--wall:#ededed;--ink:#d6d6d6;--muted:#8f8f8f;--water:#4f9ae8;--fill-alpha:.28}
@media (prefers-color-scheme:dark){svg.floorplan.theme-auto{--bg:#121212;--wall:#ededed;--ink:#d6d6d6;--muted:#8f8f8f;--water:#4f9ae8;--fill-alpha:.28}}
.rn{font-size:12px;font-weight:600;fill:var(--ink)}
.ra{font-size:10.5px;fill:var(--muted)}
.rk{font-size:10px;font-weight:700;fill:var(--ink)}
.dim{font-size:10.5px;fill:var(--muted);font-variant-numeric:tabular-nums}
.tag{font-size:8.5px;font-weight:700;letter-spacing:.08em;fill:var(--accent)}
.fx{font-size:9.5px;font-weight:600;fill:var(--muted)}
.mk{font-size:10px;font-weight:700;fill:#fff}
.title{font-size:15px;font-weight:700;fill:var(--ink)}
`.trim();
