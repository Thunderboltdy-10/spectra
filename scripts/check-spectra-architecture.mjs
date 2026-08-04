import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = process.cwd();
const sourceRoot = resolve(root, "src");
const baseline = JSON.parse(
  await readFile(
    resolve(root, "docs/spectra-definitive/generated/baseline-inventory.json"),
    "utf8",
  ),
);
const baselineEvents = new Set(baseline.customEvents);
const ignored = new Set(["node_modules", ".next"]);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const violations = [];
for (const path of await walk(sourceRoot)) {
  const source = await readFile(path, "utf8");
  const repoPath = relative(root, path).replaceAll("\\", "/");
  if (repoPath.endsWith("events/legacy-window-bridge.ts")) continue;
  for (const match of source.matchAll(/(?:CustomEvent|Event)\(\s*["']([^"']+)["']/g)) {
    if (!baselineEvents.has(match[1]))
      violations.push(`${repoPath}: unregistered global event ${match[1]}`);
  }
}

const runRoute = await readFile(
  resolve(root, "src/app/api/spectra/run/route.ts"),
  "utf8",
);
const embeddedToolDefinitions = [
  ...runRoute.matchAll(/name\s*:\s*["'][a-z][a-z0-9_.-]+["']/g),
].length;
if (embeddedToolDefinitions > 11)
  violations.push(
    `src/app/api/spectra/run/route.ts: embedded tool definitions grew from the Phase 0 baseline (11 → ${embeddedToolDefinitions})`,
  );

if (violations.length) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Architecture guard passed (${baselineEvents.size} legacy event names frozen; embedded run-route tools did not grow).\n`,
  );
}
