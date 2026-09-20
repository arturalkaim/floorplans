import type { Pt } from "../src/types.ts";

export const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** Two rooms side by side: a (0..4 × 0..3.4) and b (4..7 × 0..3.4), entrance on a's west wall. */
export function twoRooms(extra: Record<string, unknown> = {}) {
  return {
    walls: { exterior: 0.3, partition: 0.12 },
    rooms: {
      a: { name: "A", kind: "living", poly: rect(0, 0, 4, 3.4) },
      b: { name: "B", kind: "office", poly: rect(4, 0, 3, 3.4) },
    },
    openings: [
      { type: "door", between: ["exterior", "a"], on: { room: "a", side: "west" }, width: 0.9, entrance: true },
      { type: "door", between: ["a", "b"], width: 0.8 },
      { type: "window", between: ["exterior", "a"], on: { room: "a", side: "south" }, width: 1.2 },
      { type: "window", between: ["exterior", "b"], on: { room: "b", side: "east" }, width: 1.2 },
    ],
    ...extra,
  };
}

export const rulesOf = (findings: Array<{ rule: string }>) => findings.map((f) => f.rule).sort();
export const has = (findings: Array<{ rule: string }>, rule: string) => findings.some((f) => f.rule === rule);

export type Doc = Record<string, unknown> & { levels: Record<string, unknown> };

/**
 * Two storeys of one room each, joined by a stair. Small enough to read, complete enough
 * to lint clean — every levels test breaks exactly one thing in it.
 */
export function twoStoreys(over: Partial<Doc> = {}): Doc {
  const base: Doc = {
    walls: { exterior: 0.3, partition: 0.12 },
    stack: ["baixo", "cima"],
    levels: {
      baixo: {
        name: "Piso 0",
        height: 2.7,
        ground: true,
        rooms: {
          hall: { name: "Hall", kind: "hall", rect: [0, 0, 3, 5] },
          sala: { name: "Sala", kind: "living", rect: [3, 0, 4, 5] },
        },
        openings: [
          { type: "door", between: ["exterior", "hall"], on: { room: "hall", side: "north" }, position: { from: "end", distance: 0.7 }, width: 1, entrance: true },
          { type: "door", between: ["hall", "sala"], width: 0.9, swingInto: "sala" },
          { type: "window", between: ["exterior", "sala"], on: { room: "sala", side: "east" }, width: 1.2 },
        ],
      },
      cima: {
        name: "Piso 1",
        height: 2.6,
        rooms: {
          // an L around the stairwell: a void has to reach an edge, or the room enclosing
          // it would be a ring, which a single rectilinear ring cannot express
          patamar: { name: "Patamar", kind: "hall", poly: [[0, 0], [3, 0], [3, 5], [1.5, 5], [1.5, 2.2], [0, 2.2]] },
          quarto: { name: "Quarto", kind: "bedroom", rect: [3, 0, 4, 5] },
        },
        voids: { vazio: { name: "Caixa de escada", rect: [0, 2.2, 1.5, 2.8] } },
        openings: [
          { type: "door", between: ["patamar", "quarto"], width: 0.9, swingInto: "quarto" },
          { type: "window", between: ["exterior", "quarto"], on: { room: "quarto", side: "east" }, width: 1.2 },
        ],
      },
    },
    vertical: [
      {
        id: "escada",
        type: "stairs",
        name: "Escada",
        up: 0,
        risers: 15,
        at: [
          { level: "baixo", in: "hall", rect: [0.5, 0.6, 1, 3.64] },
          { level: "cima", in: "patamar", rect: [0.5, 0.6, 1, 1.1] },
        ],
      },
    ],
  };
  return { ...base, ...over, levels: { ...base.levels, ...(over.levels ?? {}) } };
}

/**
 * Two storeys that both take their tracks from one shared grid, so their walls line up
 * and a drag on a boundary moves the same wall on both.
 */
export const sharedGridPlan = {
    walls: { exterior: 0.3, partition: 0.12 },
    stack: ["baixo", "cima"],
    grid: { cols: [3, 4], rows: [5] },
    levels: {
      baixo: {
        name: "Piso 0",
        ground: true,
        layout: { areas: ["hall sala"] },
        rooms: { hall: { kind: "hall" }, sala: { kind: "living" } },
        openings: [
          { type: "door", between: ["exterior", "hall"], on: { room: "hall", side: "north" }, position: { from: "end", distance: 0.7 }, width: 1, entrance: true },
          { type: "door", between: ["hall", "sala"], width: 0.9, swingInto: "sala" },
          { type: "window", between: ["exterior", "sala"], on: { room: "sala", side: "east" }, width: 1.2 },
        ],
      },
      cima: {
        name: "Piso 1",
        layout: { areas: ["patamar quarto"] },
        rooms: { patamar: { kind: "hall" }, quarto: { kind: "bedroom" } },
        openings: [
          { type: "door", between: ["patamar", "quarto"], width: 0.9, swingInto: "quarto" },
          { type: "window", between: ["exterior", "quarto"], on: { room: "quarto", side: "east" }, width: 1.2 },
        ],
      },
      // both levels take their tracks from the shared grid, so their walls line up
    },
    vertical: [
      {
        id: "escada",
        type: "stairs",
        at: [
          { level: "baixo", in: "hall", rect: [0.5, 0.5, 1, 3] },
          { level: "cima", in: "patamar", rect: [0.5, 0.5, 1, 1] },
        ],
      },
    ],
  };
