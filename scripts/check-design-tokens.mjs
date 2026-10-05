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
const tokensPath = join(ROOT, "src/styles/spectra-tokens.css");
const appCssPath = join(ROOT, "src/styles/spectra-app.css");
const appCss = readFileSync(appCssPath, "utf8");

/* 1. The canonical :root lives in spectra-app.css.
      globals.css became an import manifest (tokens moved to src/styles/ during
      the wave-Y redesign); the property is unchanged — exactly one light :root
      block declaring --brand-primary, plus its one dark remap. */
const canonicalRoots = [
  ...appCss.matchAll(/^[ \t]*:root\s*\{[^}]*--brand-primary\s*:/gms),
];
if (canonicalRoots.length !== 1) {
  failures.push(
    `spectra-app.css must hold exactly one :root block declaring --brand-primary; found ${canonicalRoots.length}`,
  );
}

/* 2. Dead palette system stays dead */
if (globals.includes("data-theme-palette")) {
  failures.push(
    "globals.css re-introduces the removed data-theme-palette system",
  );
}

/* 5. --brand-primary declared once per theme */
const brandDecls = appCss.match(/--brand-primary\s*:/g) ?? [];
if (brandDecls.length > 2) {
  failures.push(
    `--brand-primary declared ${brandDecls.length} times (allowed: light + dark)`,
  );
}

/* 6. The stacking contract (ARCHITECTURE-PLATFORM §3): seven named layers,
      exact values, strict order, plus the Tailwind v4 --z-index-* theme wiring
      that makes z-modal & co. exist. */
const LAYERS = [
  ["base", 0],
  ["chrome", 40],
  ["dropdown", 60],
  ["panel", 80],
  ["modal", 100],
  ["composer-dock", 120],
  ["toast", 140],
];
const tokens = readFileSync(tokensPath, "utf8");
for (let index = 0; index < LAYERS.length; index += 1) {
  const [name, value] = LAYERS[index];
  if (!new RegExp(`--z-${name}\\s*:\\s*${value}(?:px)?\\s*;`).test(tokens)) {
    failures.push(
      `spectra-tokens.css is missing the --z-${name}: ${value} layer token`,
    );
  }
  if (!new RegExp(`--z-index-${name}\\s*:`).test(tokens)) {
    failures.push(
      `spectra-tokens.css is missing the @theme wiring --z-index-${name} (z-${name} would not exist)`,
    );
  }
}

/* 7. The global input focus suppression (DS-4) never comes back. */
for (const match of appCss.matchAll(
  /^(input|textarea|select):focus-visible[^{]*\{[^}]*outline:\s*none\s*!important/gms,
)) {
  const line = appCss.slice(0, match.index).split("\n").length;
  failures.push(
    `spectra-app.css:${line} re-introduces the global :focus-visible suppression (DS-4: keyboard-invisible inputs)`,
  );
}

const files = walk(join(ROOT, "src"));
const tinyUtility = /text-\[(\d+(?:\.\d+)?)px\]/g;

/* 8. Spectra draws its own icons (docs/design/ICONS.md). Generic line icons
      belong to editor workbars only: their commands, studios and menus, the
      slash menu, and their tests. Everything else imports glyphs. */
const WORKBAR_ICON_PATHS = [
  /^src\/components\/icons\//,
  /^src\/features\/spectra\/commands\/(office|shared)\//,
  /^src\/features\/spectra\/editor\//,
  /^src\/features\/spectra\/components\/[a-z-]*-studio\.tsx$/,
  /^src\/features\/spectra\/components\/(artifact-workbar|workbar-controls)\.tsx$/,
  /(^|\/)__tests__\//,
  /\.test\.tsx?$/,
];
for (const file of files) {
  if (file.endsWith(".css")) continue;
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  if (WORKBAR_ICON_PATHS.some((pattern) => pattern.test(rel))) continue;
  const text = readFileSync(file, "utf8");
  const match = text.match(/from\s+["']lucide-react["']/);
  if (match) {
    const line = text.slice(0, match.index).split("\n").length;
    failures.push(
      `${rel}:${line} imports lucide-react outside editor workbars (use @/components/icons or glyph-icons)`,
    );
  }
}
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
