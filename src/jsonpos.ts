// JSON parsed with source positions, so an edit can replace exactly the characters of
// one value and leave the rest of the document — indentation, key order, the column
// alignment people hand-tune — untouched. The playground needs this because the text is
// the single source of truth: dragging a wall rewrites the source the author is typing in.

export type JsonKind = "object" | "array" | "string" | "number" | "boolean" | "null";
export type JsonPath = Array<string | number>;

export interface JsonNode {
  kind: JsonKind;
  /** character range of the value itself, excluding surrounding whitespace */
  start: number;
  end: number;
  /** objects: member name -> value node, in source order */
  members?: Map<string, JsonNode>;
  /** arrays: element nodes */
  items?: JsonNode[];
}

export class JsonPosError extends Error {
  readonly index: number;
  readonly line: number;
  readonly column: number;
  constructor(message: string, text: string, index: number) {
    const upto = text.slice(0, index);
    const line = upto.split("\n").length;
    const column = index - (upto.lastIndexOf("\n") + 1) + 1;
    super(`${message} at line ${line}, column ${column}`);
    this.name = "JsonPosError";
    this.index = index;
    this.line = line;
    this.column = column;
  }
}

const WS = new Set([" ", "\t", "\n", "\r"]);

/** Parse JSON text into a tree of nodes carrying their source ranges. */
export function parseWithPositions(text: string): JsonNode {
  let i = 0;

  const fail = (msg: string): never => {
    throw new JsonPosError(msg, text, Math.min(i, text.length));
  };
  const ws = () => {
    while (i < text.length && WS.has(text[i]!)) i++;
  };
  const expect = (ch: string) => {
    if (text[i] !== ch) fail(`expected ${JSON.stringify(ch)}`);
    i++;
  };

  const readString = (): void => {
    expect('"');
    while (i < text.length) {
      const c = text[i]!;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        return;
      }
      if (c === "\n") fail("unterminated string");
      i++;
    }
    fail("unterminated string");
  };

  const value = (): JsonNode => {
    ws();
    const start = i;
    const c = text[i];
    if (c === undefined) return fail("unexpected end of input");

    if (c === "{") {
      i++;
      const members = new Map<string, JsonNode>();
      ws();
      if (text[i] === "}") return { kind: "object", start, end: ++i, members };
      for (;;) {
        ws();
        const keyStart = i;
        readString();
        const key = JSON.parse(text.slice(keyStart, i)) as string;
        ws();
        expect(":");
        members.set(key, value());
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") return { kind: "object", start, end: ++i, members };
        return fail("expected , or }");
      }
    }

    if (c === "[") {
      i++;
      const items: JsonNode[] = [];
      ws();
      if (text[i] === "]") return { kind: "array", start, end: ++i, items };
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") return { kind: "array", start, end: ++i, items };
        return fail("expected , or ]");
      }
    }

    if (c === '"') {
      readString();
      return { kind: "string", start, end: i };
    }

    for (const [word, kind] of [["true", "boolean"], ["false", "boolean"], ["null", "null"]] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return { kind, start, end: i };
      }
    }

    const num = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (num) {
      i += num[0].length;
      return { kind: "number", start, end: i };
    }
    return fail(`unexpected ${JSON.stringify(c)}`);
  };

  const root = value();
  ws();
  if (i !== text.length) fail("trailing content");
  return root;
}

/** The node at a path, or undefined if the path does not exist. */
export function nodeAt(root: JsonNode, path: JsonPath): JsonNode | undefined {
  let node: JsonNode | undefined = root;
  for (const step of path) {
    if (node === undefined) return undefined;
    node = typeof step === "number" ? node.items?.[step] : node.members?.get(step);
  }
  return node;
}

/**
 * Replace the value at `path` with `literal`, returning the new text and the change
 * so a caller can keep a caret in place. Throws if the path does not exist — a drag
 * must never silently write nothing.
 */
export function spliceAt(
  text: string,
  path: JsonPath,
  literal: string,
  root = parseWithPositions(text),
): { text: string; start: number; removed: number; inserted: number } {
  const node = nodeAt(root, path);
  if (!node) throw new Error(`no value at ${pathToString(path)}`);
  return {
    text: text.slice(0, node.start) + literal + text.slice(node.end),
    start: node.start,
    removed: node.end - node.start,
    inserted: literal.length,
  };
}

/** Apply several edits at once; ranges must not overlap. Applied right to left. */
export function spliceAll(text: string, edits: Array<{ path: JsonPath; literal: string }>): string {
  const root = parseWithPositions(text);
  const resolved = edits.map(({ path, literal }) => {
    const node = nodeAt(root, path);
    if (!node) throw new Error(`no value at ${pathToString(path)}`);
    return { start: node.start, end: node.end, literal };
  });
  resolved.sort((a, b) => b.start - a.start);
  for (let k = 1; k < resolved.length; k++)
    if (resolved[k]!.end > resolved[k - 1]!.start) throw new Error("overlapping edits");
  let out = text;
  for (const r of resolved) out = out.slice(0, r.start) + r.literal + out.slice(r.end);
  return out;
}

export const pathToString = (path: JsonPath): string =>
  path.map((s) => (typeof s === "number" ? `[${s}]` : `.${s}`)).join("").replace(/^\./, "");

/** Metres formatted the way the fixtures write them: no trailing zeros, mm precision. */
export const metres = (n: number): string => String(Math.round(n * 1000) / 1000);
