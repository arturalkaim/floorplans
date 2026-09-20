// Builds the playground: the library runs unmodified in the browser, so the compiled
// dist modules are copied beside the page and the fixtures are inlined into it.
// Usage: node scripts/build-demo.ts [outDir]   (default demo/build)
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, process.argv[2] ?? "demo/build");

/** Plans shown as tabs, in order; the first is the one the page opens on. */
export const PLANS: Array<[string, string]> = [
  ["casa-piscina", "Casa com Piscina"],
  ["casa-t3", "Casa T3"],
  ["casa-patio", "Casa com Pátio"],
  ["quinta", "Quinta"],
  ["apartment-t2", "Apartamento T2 (grid)"],
  ["cabin", "Cabana"],
  ["broken", "Broken on purpose"],
];

/** Every dist module the page imports; cli.js and bin.js are deliberately absent
 *  (bin.js needs node:fs; cli.js exists only to be wired up by it). */
const LIB = ["index", "derive", "parse", "rules", "svg", "geometry", "doors", "types"];

export function buildDemo(outDir: string = out) {
  const missing = LIB.filter((m) => !readdirSync(join(root, "dist")).includes(`${m}.js`));
  if (missing.length) throw new Error(`dist is missing ${missing.join(", ")} — run npm run build first`);

  const fixtures = Object.fromEntries(
    PLANS.map(([id, label]) => [id, { label, json: readFileSync(join(root, "fixtures", `${id}.json`), "utf8").trimEnd() }]),
  );
  const tpl = readFileSync(join(root, "demo", "index.html"), "utf8");
  const page = tpl
    .replace("__FIXTURES__", JSON.stringify(fixtures, null, 2))
    .replace('let current = "casa-piscina";', `let current = ${JSON.stringify(PLANS[0]![0])};`);

  mkdirSync(join(outDir, "lib"), { recursive: true });
  for (const m of LIB) cpSync(join(root, "dist", `${m}.js`), join(outDir, "lib", `${m}.js`));
  writeFileSync(join(outDir, "index.html"), page);
  return { outDir, plans: PLANS.length, bytes: page.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = buildDemo();
  console.log(`demo → ${r.outDir}  (${r.plans} plans, ${r.bytes} bytes)`);
}
