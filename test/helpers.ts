import type { Pt } from "../src/types.ts";

export const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** Two rooms side by side: a (0..4 × 0..3) and b (4..7 × 0..3), entrance on a's west wall. */
export function twoRooms(extra: Record<string, unknown> = {}) {
  return {
    walls: { exterior: 0.3, partition: 0.12 },
    rooms: {
      a: { name: "A", kind: "living", poly: rect(0, 0, 4, 3) },
      b: { name: "B", kind: "office", poly: rect(4, 0, 3, 3) },
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
