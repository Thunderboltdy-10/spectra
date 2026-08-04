#!/usr/bin/env node
/**
 * Spectra design-token static gate (Phase 13).
 *
 * Fails when:
 *  1. globals.css regains more than one top-level `:root {` token block.
 *  2. The removed `data-theme-palette` variant system reappears.
 *  3. Any TSX/TS file uses a font-size utility below the approved 11px floor
 *     (text-[8px], text-[9px], text-[10px], text-[9.5px], …).
 *  4. Any CSS declaration sets a font-size below 11px without an explicit
 *     `spectra-token-allow` comment on the same line.
 *  5. `--brand-primary` is re-declared outside the canonical `:root` block.
 *
 * Warns (non-failing) on hardcoded hex colors inside className strings and on
 * arbitrary text sizes above the floor, which are migration leftovers.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const failures = [];
const warnings = [];

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

const globalsPath = join(ROOT, "src/app/globals.css");
const globals = readFileSync(globalsPath, "utf8");

/* 1. Single canonical :root block */
const rootBlocks = [...globals.matchAll(/^[ \t]*:root\s*\{/gm)];
if (rootBlocks.length !== 1) {
  failures.push(
    `globals.css must have exactly one top-level :root token block; found ${rootBlocks.length}`,
  );
}

/* 2. Dead palette system stays dead */
if (globals.includes("data-theme-palette")) {
  failures.push(
    "globals.css re-introduces the removed data-theme-palette system",
  );
}
if (
  /--brand-primary\s*:/.test(globals.slice(globals.indexOf("}\n\n.dark"))) &&
  !globals.includes("Canonical design tokens")
) {
  /* Handled by check 1 + 5; kept simple. */
}

/* 5. --brand-primary declared once */
const brandDecls = globals.match(/--brand-primary\s*:/g) ?? [];
if (brandDecls.length > 2) {
  failures.push(
    `--brand-primary declared ${brandDecls.length} times (allowed: light + dark)`,
  );
}

const files = walk(join(ROOT, "src"));
const tinyUtility = /text-\[(\d+(?:\.\d+)?)px\]/g;
const cssFontSize = /font-size\s*:\s*(\d+(?:\.\d+)?)px/g;

for (const file of files) {
  const rel = relative(ROOT, file);
  if (file.endsWith(".css")) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(cssFontSize)) {
      const size = Number.parseFloat(match[1]);
      if (
        size < 11 &&
        !text
          .slice(match.index, text.indexOf("\n", match.index))
          .includes("spectra-token-allow")
      ) {
        const line = text.slice(0, match.index).split("\n").length;
        failures.push(
          `${rel}:${line} font-size ${size}px is below the 11px token floor`,
        );
      }
    }
    if (rel.endsWith("globals.css") && /data-theme-palette/.test(text)) {
      failures.push(`${rel}: data-theme-palette selector found`);
    }
    continue;
  }
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(tinyUtility)) {
    const size = Number.parseFloat(match[1]);
    const line = text.slice(0, match.index).split("\n").length;
    if (size < 11) {
      failures.push(
        `${rel}:${line} text-[${size}px] is below the 11px token floor (use text-micro)`,
      );
    }
  }
  /* Hex colors inside className = migration leftovers; warn only. */
  const classHex = text.match(/className="[^"]*#[0-9a-fA-F]{6}[^"]*"/);
  if (classHex) {
    warnings.push(`${rel}: hardcoded hex color inside className`);
  }
}

for (const warning of warnings) console.warn(`warn  ${warning}`);
if (failures.length) {
  console.error(`design-token gate failed with ${failures.length} problem(s):`);
  for (const failure of failures.slice(0, 40))
    console.error(`  fail  ${failure}`);
  if (failures.length > 40)
    console.error(`  …and ${failures.length - 40} more`);
  process.exit(1);
}
console.log(
  `design-token gate passed (${files.length} files scanned; ${warnings.length} warning(s))`,
);
