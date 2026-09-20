#!/usr/bin/env node
// The published executable (package.json "bin"). Kept separate from cli.ts so the
// CLI logic stays a plain, testable module: this file's only job is to wire real
// stdio/fs onto `run` and call it unconditionally — no argv[1] sniffing, so it works
// the same whether invoked directly or through npm's node_modules/.bin symlink.
import { readFileSync, writeFileSync } from "node:fs";
import { run } from "./cli.ts";

process.exitCode = run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, s) => writeFileSync(p, s),
});
