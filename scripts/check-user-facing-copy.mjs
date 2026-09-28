import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = [
  "src/features/spectra/pages/spectra-shell.tsx",
  "src/features/spectra/pages/agent-library-shell.tsx",
  "src/features/spectra/components/artifact-studio.tsx",
  "src/components/layout/app-shell.tsx",
  "src/app/layout.tsx",
];

const forbidden = [
  /["'`]Artifacts["'`]/g,
  /["'`]Artifact details["'`]/gi,
  /["'`]New artifact["'`]/gi,
  /["'`]Search artifacts["'`]/gi,
  /["'`]Artifact type["'`]/gi,
  /["'`]Timetable(?: Items)?["'`]/g,
  />\s*Artifacts\s*</g,
  />\s*Timetable\s*</g,
  /\bNo artifacts\b/gi,
  /\bSelect multiple artifacts\b/gi,
];

const issues = [];
for (const relative of files) {
  const absolute = path.join(root, relative);
  const source = fs.readFileSync(absolute, "utf8");
  for (const pattern of forbidden) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      issues.push(`${relative}:${line}: ${match[0]}`);
    }
  }
}

/* CANON D15: "artifact" is an internal word. Every surface a student or
   teacher reads says "work" or the type name. These rules cover the places
   copy lives in UI code: JSX text, labelling attributes, toasts, failure
   fallbacks and command hints. Operator diagnostics (superadmin), API routes,
   model prompts and tests are out of scope. */
const uiRoots = [
  "src/app",
  "src/components",
  "src/features/spectra/components",
  "src/features/spectra/pages",
  "src/features/spectra/commands",
  "src/features/spectra/runs",
];
const uiExcluded = [/[\\/]__tests__[\\/]/, /\.test\.tsx?$/, /[\\/]superadmin/, /^src[\\/]app[\\/]api[\\/]/];
const word = /\bartifacts?\b/i;
// Strip template holes so `${artifact.title}` never counts as copy.
const text = (value) => value.replace(/\$\{[^}]*\}/g, "");
const uiRules = [
  {
    name: "JSX text",
    pattern: />([^<>{}]*)</g,
    test: (value) => /[A-Za-z]{2,} /.test(value.trim()) || /^\s*Artifacts?\s*$/i.test(value),
  },
  {
    name: "label attribute",
    pattern: /\b(?:label|placeholder|title|aria-label|ariaLabel|alt|description|detail|hint|emptyLabel)\s*[=:]\s*\{?\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g,
    group: 2,
  },
  {
    name: "toast",
    pattern: /\btoast(?:\.\w+)?\(\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g,
    group: 2,
  },
  {
    name: "failure fallback",
    pattern: /\bfallback\s*:\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g,
    group: 2,
  },
  {
    name: "status sentence",
    pattern: /\bset(?:\w*Message|\w*Error|Status|Notice)\(\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g,
    group: 2,
  },
];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return /\.(tsx?|mjs)$/.test(entry.name) ? [absolute] : [];
  });
}

for (const uiRoot of uiRoots) {
  for (const absolute of walk(path.join(root, uiRoot))) {
    const relative = path.relative(root, absolute);
    if (uiExcluded.some((pattern) => pattern.test(relative))) continue;
    const source = fs.readFileSync(absolute, "utf8");
    for (const rule of uiRules) {
      rule.pattern.lastIndex = 0;
      for (const match of source.matchAll(rule.pattern)) {
        const value = text(match[rule.group ?? 1] ?? "");
        if (!word.test(value)) continue;
        if (rule.test && !rule.test(value)) continue;
        // JSX text that is really code (generics, arrows) is not copy.
        if (rule.name === "JSX text" && /=>|[;()]|&&|\|\|/.test(value)) continue;
        const line = source.slice(0, match.index).split(/\r?\n/).length;
        issues.push(`${relative}:${line}: ${rule.name}: ${value.trim().replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
  }
}

if (issues.length) {
  console.error("User-facing legacy terminology found:\n" + issues.join("\n"));
  process.exit(1);
}
console.log("User-facing copy check passed.");
