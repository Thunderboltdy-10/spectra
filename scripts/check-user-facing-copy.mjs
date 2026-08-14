import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = [
  "src/features/spectra/pages/artifacts-shell.tsx",
  "src/features/spectra/pages/workspace-shell.tsx",
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

if (issues.length) {
  console.error("User-facing legacy terminology found:\n" + issues.join("\n"));
  process.exit(1);
}
console.log("User-facing copy check passed.");
