#!/usr/bin/env node
/**
 * Design-token adoption census (P0 → P6 burn-down meter).
 *
 * Runs the three `spectra/*` baseline rules over `src/**` and prints the
 * escape count per directory, top-offender-first — exactly the queue the P6
 * adoption sweep (ARCHITECTURE-PLATFORM §3) is meant to drain. Never fails:
 * the gate for a directory is flipping its rules to `error` in
 * `eslint.config.mjs` once it reads zero.
 */
import { ESLint } from "eslint";
import { relative } from "node:path";

const eslint = new ESLint();
const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);

const perDirectory = new Map();
let total = 0;
const byRule = new Map();

for (const result of results) {
  const spectra = result.messages.filter((message) =>
    message.ruleId?.startsWith("spectra/"),
  );
  if (!spectra.length) continue;
  const directory = relative(process.cwd(), result.filePath)
    .split(/[\\/]/)
    .slice(0, 3)
    .join("/");
  perDirectory.set(
    directory,
    (perDirectory.get(directory) ?? 0) + spectra.length,
  );
  for (const message of spectra) {
    total += 1;
    byRule.set(message.ruleId, (byRule.get(message.ruleId) ?? 0) + 1);
  }
}

console.log(`design census: ${total} token escapes`);
for (const [rule, count] of [...byRule].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${rule}: ${count}`);
}
for (const [directory, count] of [...perDirectory]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)) {
  console.log(`  ${count.toString().padStart(5)}  ${directory}`);
}
process.exit(0);
