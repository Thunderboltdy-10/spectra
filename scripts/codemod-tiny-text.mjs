#!/usr/bin/env node
/**
 * Phase 13.2 codemod: replace sub-11px typography with the approved scale.
 *
 *  - TSX/TS className utilities: any `text-[Npx]` (or `*-:text-[Npx]`) with
 *    N < 11 becomes the same variant prefix + `text-micro` (11px token).
 *  - CSS: any `font-size: Npx` with 0 < N < 11 becomes `var(--text-micro)`.
 *
 * Prints per-file replacement counts. Re-runnable (idempotent).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith("."))
      continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(path);
  }
  return out;
}

const utilityPattern = /((?:[a-z-]+:)*?)text-\[(\d+(?:\.\d+)?)px\]/g;
const cssPattern = /font-size\s*:\s*(\d+(?:\.\d+)?)px/g;

let totalUtility = 0;
let totalCss = 0;
let changedFiles = 0;

for (const file of walk(join(ROOT, "src"))) {
  const original = readFileSync(file, "utf8");
  let text = original;
  let count = 0;

  if (file.endsWith(".css")) {
    text = text.replace(cssPattern, (whole, sizeText) => {
      const size = Number.parseFloat(sizeText);
      if (size > 0 && size < 11) {
        count += 1;
        return "font-size: var(--text-micro)";
      }
      return whole;
    });
    totalCss += count;
  } else {
    text = text.replace(utilityPattern, (whole, prefix, sizeText) => {
      const size = Number.parseFloat(sizeText);
      if (size < 11) {
        count += 1;
        return `${prefix}text-micro`;
      }
      return whole;
    });
    totalUtility += count;
  }

  if (text !== original) {
    changedFiles += 1;
    if (!DRY) writeFileSync(file, text);
    console.log(`${String(count).padStart(4)}  ${relative(ROOT, file)}`);
  }
}

console.log(
  `${DRY ? "[dry] " : ""}${totalUtility + totalCss} replacements across ${changedFiles} files ` +
    `(${totalUtility} className, ${totalCss} css)`,
);
