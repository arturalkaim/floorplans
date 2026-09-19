import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const APP = new URL("../app/src/", import.meta.url).pathname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

const SPECIFIER = /(?:^|\n)\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/g;

describe("the app depends on the library, it does not reach into it", () => {
  if (!existsSync(APP)) return;
  const files = walk(APP);

  it("finds the app's sources", () => {
    assert.ok(files.length > 3, "expected the app to have sources");
  });

  it("imports the library only by package name", () => {
    const offenders: string[] = [];
    for (const f of files)
      for (const m of readFileSync(f, "utf8").matchAll(SPECIFIER)) {
        const spec = m[1]!;
        // a relative path that climbs out of app/src is reaching into the repo
        if (!spec.startsWith(".")) continue;
        const resolved = join(f, "..", spec);
        if (resolved.startsWith(APP)) continue;
        // example plans are shared repo data, not library code, and come in as text
        if (spec.includes("/fixtures/") && spec.endsWith("?raw")) continue;
        offenders.push(`${f.slice(APP.length)} imports ${spec}`);
      }
    assert.deepEqual(offenders, [], `import from "floorplan" instead:\n  ${offenders.join("\n  ")}`);
  });

  it("uses no member the library does not export", async () => {
    const lib = await import("../src/index.ts");
    const exported = new Set(Object.keys(lib));
    const missing = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']floorplan["']/g))
        for (const raw of m[1]!.split(",")) {
          const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
          // types vanish at runtime, so only value imports can be checked this way
          if (name && !exported.has(name) && /^[a-z]/.test(name)) missing.add(name);
        }
    }
    assert.deepEqual([...missing], [], "the app wants these from the library's public API");
  });
});
