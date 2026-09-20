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
  /**
   * Set only on a node that is an object member's value: the index of the opening
   * quote of its key, i.e. where the *member* (key, not just the value) begins in
   * the source. removeAt/insertKey use this to splice a whole "key": value pair.
   */
  keyStart?: number;
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
        const memberValue = value();
        memberValue.keyStart = keyStart;
        members.set(key, memberValue);
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
 * Like `nodeAt`, but throws a `JsonPosError` — with line/column pointing at the last
 * ancestor that *did* resolve — instead of returning undefined. Every editing
 * primitive below uses this so a missing path is always reported with position info,
 * never a bare "no value at ..." with nothing to locate it by.
 */
function requireNode(root: JsonNode, path: JsonPath, text: string): JsonNode {
  let node = root;
  for (const step of path) {
    const next = typeof step === "number" ? node.items?.[step] : node.members?.get(step);
    if (next === undefined) throw new JsonPosError(`no value at ${pathToString(path)}`, text, node.start);
    node = next;
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
  const node = requireNode(root, path, text);
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
    const node = requireNode(root, path, text);
    return { start: node.start, end: node.end, literal };
  });
  resolved.sort((a, b) => b.start - a.start);
  for (let k = 1; k < resolved.length; k++)
    if (resolved[k]!.end > resolved[k - 1]!.start) throw new Error("overlapping edits");
  let out = text;
  for (const r of resolved) out = out.slice(0, r.start) + r.literal + out.slice(r.end);
  return out;
}

/**
 * The whitespace/comma "joint" a new sibling would be inserted after, learned from how
 * the *last* existing sibling is already attached to the one before it (or, for a lone
 * sibling, to the opening bracket). Reusing that joint verbatim is what makes an append
 * match "the sibling's separator style": same indentation, same one-per-line-ness.
 */
function trailingJoint(text: string, openBracket: number, siblings: Array<{ start: number; end: number }>): string {
  const lastStart = siblings[siblings.length - 1]!.start;
  const prevEnd = siblings.length >= 2 ? siblings[siblings.length - 2]!.end : openBracket + 1;
  const between = text.slice(prevEnd, lastStart);
  // for >=2 siblings `between` is "," + whitespace (the comma separating the previous
  // sibling from the last one); for a lone sibling it is whitespace only, with no comma
  // yet to strip.
  const comma = between.indexOf(",");
  return comma === -1 ? between : between.slice(comma + 1);
}

/**
 * Delete the array element or object member at `path`, eating the separating comma and
 * its surrounding whitespace so the result stays valid JSON, one entity per line:
 * removing the last sibling eats the *preceding* comma, removing any other sibling eats
 * the comma (and newline/indentation) that *follows* it, and removing the only sibling
 * collapses the collection to `[]`/`{}`. Throws `JsonPosError` if `path` does not exist.
 */
export function removeAt(text: string, path: JsonPath, root = parseWithPositions(text)): string {
  if (path.length === 0) throw new Error("cannot remove the root value");
  const parentPath = path.slice(0, -1);
  const parent = requireNode(root, parentPath, text);
  const last = path[path.length - 1]!;

  if (typeof last === "number") {
    if (parent.kind !== "array" || !parent.items)
      throw new JsonPosError(`no value at ${pathToString(path)}`, text, parent.start);
    const items = parent.items;
    if (last < 0 || last >= items.length)
      throw new JsonPosError(`no value at ${pathToString(path)}`, text, parent.start);
    if (items.length === 1) return text.slice(0, parent.start) + "[]" + text.slice(parent.end);
    const node = items[last]!;
    if (last === items.length - 1) {
      const prev = items[last - 1]!;
      return text.slice(0, prev.end) + text.slice(node.end);
    }
    const next = items[last + 1]!;
    return text.slice(0, node.start) + text.slice(next.start);
  }

  if (parent.kind !== "object" || !parent.members)
    throw new JsonPosError(`no value at ${pathToString(path)}`, text, parent.start);
  const entries = [...parent.members.entries()];
  const idx = entries.findIndex(([key]) => key === last);
  if (idx === -1) throw new JsonPosError(`no value at ${pathToString(path)}`, text, parent.start);
  if (entries.length === 1) return text.slice(0, parent.start) + "{}" + text.slice(parent.end);
  const node = entries[idx]![1];
  if (idx === entries.length - 1) {
    const prevNode = entries[idx - 1]![1];
    return text.slice(0, prevNode.end) + text.slice(node.end);
  }
  const nextKeyStart = entries[idx + 1]![1].keyStart!;
  return text.slice(0, node.keyStart!) + text.slice(nextKeyStart);
}

/**
 * Insert `literal` as a new element after the array's last one, on its own line at the
 * last sibling's indentation and with its separator style (see `trailingJoint`). An
 * empty array becomes `[literal]`. Throws `JsonPosError` if `path` is not an array.
 */
export function appendAt(text: string, path: JsonPath, literal: string, root = parseWithPositions(text)): string {
  const node = requireNode(root, path, text);
  if (node.kind !== "array" || !node.items)
    throw new JsonPosError(`not an array at ${describePath(path)}`, text, node.start);
  const items = node.items;
  if (items.length === 0) return text.slice(0, node.start) + `[${literal}]` + text.slice(node.end);
  const lastItem = items[items.length - 1]!;
  const joint = trailingJoint(text, node.start, items);
  return text.slice(0, lastItem.end) + "," + joint + literal + text.slice(lastItem.end);
}

/**
 * Insert a new member `key: literal` after the object's last one, on its own line at
 * the last sibling's indentation and with its separator style. An empty object becomes
 * `{ "key": literal }`. Throws `JsonPosError` if `path` is not an object, or if `key`
 * is already a member (an agent should never silently overwrite a sibling this way —
 * use `spliceAt`/`set` for that).
 */
export function insertKey(
  text: string,
  path: JsonPath,
  key: string,
  literal: string,
  root = parseWithPositions(text),
): string {
  const node = requireNode(root, path, text);
  if (node.kind !== "object" || !node.members)
    throw new JsonPosError(`not an object at ${describePath(path)}`, text, node.start);
  if (node.members.has(key))
    throw new JsonPosError(`${JSON.stringify(key)} already exists at ${describePath(path)}`, text, node.start);
  const entryText = `${JSON.stringify(key)}: ${literal}`;
  const values = [...node.members.values()];
  if (values.length === 0) return text.slice(0, node.start) + `{ ${entryText} }` + text.slice(node.end);
  const lastValue = values[values.length - 1]!;
  const joint = trailingJoint(
    text,
    node.start,
    values.map((v) => ({ start: v.keyStart!, end: v.end })),
  );
  return text.slice(0, lastValue.end) + "," + joint + entryText + text.slice(lastValue.end);
}

export const pathToString = (path: JsonPath): string =>
  path.map((s) => (typeof s === "number" ? `[${s}]` : `.${s}`)).join("").replace(/^\./, "");

/** `pathToString`, but readable when `path` is `[]` — the document root itself. */
const describePath = (path: JsonPath): string => (path.length === 0 ? "the document root" : pathToString(path));

/** Metres formatted the way the fixtures write them: no trailing zeros, mm precision. */
export const metres = (n: number): string => String(Math.round(n * 1000) / 1000);
