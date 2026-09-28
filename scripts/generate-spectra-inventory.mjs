import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const root = process.cwd();
const ignored = new Set([".git", ".next", "node_modules", "dist", "coverage"]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(absolute)));
    else paths.push(absolute);
  }
  return paths;
}

function normalized(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function extension(path) {
  return path.slice(path.lastIndexOf("."));
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function lineHits(path, source, expression) {
  return source
    .split(/\r?\n/)
    .flatMap((line, index) =>
      expression.test(line)
        ? [`${normalized(path)}:${index + 1}`]
        : [],
    );
}

function routeFrom(path) {
  return normalized(path)
    .replace(/^src\/app/, "")
    .replace(/\/(page|route)\.(tsx?|jsx?)$/, "") || "/";
}

const files = await walk(root);
const sources = [];
for (const path of files) {
  if (!sourceExtensions.has(extension(path))) continue;
  sources.push({ path, source: await readFile(path, "utf8") });
}

const pageFiles = sources.filter(({ path }) => /src[\\/]app[\\/].*[\\/]page\.tsx?$/.test(path));
const apiFiles = sources.filter(({ path }) => /src[\\/]app[\\/]api[\\/].*[\\/]route\.ts$/.test(path));
const convexFiles = sources.filter(({ path }) => /[\\/]convex[\\/].*\.ts$/.test(path) && !/[\\/]_generated[\\/]/.test(path));

const inventory = {
  schemaVersion: 1,
  routes: unique(pageFiles.map(({ path }) => routeFrom(path))),
  apiActions: unique(
    apiFiles.flatMap(({ path, source }) =>
      [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)]
        .map((match) => `${match[1]} ${routeFrom(path)}`),
    ),
  ),
  convex: {
    tables: unique(
      convexFiles.flatMap(({ source }) =>
        [...source.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*:\s*defineTable\s*\(/g)].map((match) => match[1]),
      ),
    ),
    indexes: unique(
      convexFiles.flatMap(({ path, source }) =>
        [...source.matchAll(/\.index\(\s*["']([^"']+)["']/g)].map(
          (match) => `${normalized(path)}#${match[1]}`,
        ),
      ),
    ),
    actions: unique(
      convexFiles.flatMap(({ path, source }) =>
        [...source.matchAll(/export\s+const\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\s*\(/g)].map(
          (match) => `${normalized(path)}#${match[1]}:${match[2]}`,
        ),
      ),
    ),
  },
  workTypes: unique(
    sources.flatMap(({ source }) =>
      [...source.matchAll(/(?:ARTIFACT_TYPE_KEYS|WORK_TYPE_KEYS)[\s\S]{0,600}?\[([\s\S]*?)\]/g)]
        .flatMap((match) => [...match[1].matchAll(/["']([a-z][a-z0-9_-]+)["']/g)].map((item) => item[1])),
    ),
  ),
  tools: unique(
    sources.flatMap(({ source }) =>
      [...source.matchAll(/(?:type|id)\s*:\s*["']([a-z][a-z0-9_.-]+)["'][\s\S]{0,120}?(?:purpose|description)/g)].map((match) => match[1]),
    ),
  ),
  customEvents: unique(
    sources.flatMap(({ source }) =>
      [...source.matchAll(/(?:CustomEvent|Event)\(\s*["']([^"']+)["']/g)].map((match) => match[1]),
    ),
  ),
  preferenceSources: unique(
    sources.flatMap(({ path, source }) =>
      /preference|localStorage|theme/i.test(source) ? [normalized(path)] : [],
    ),
  ),
  legacyCopy: {
    artifact: unique(sources.flatMap(({ path, source }) => lineHits(path, source, /["'`][^"'`]*\bartifacts?\b/i))),
    timetable: unique(sources.flatMap(({ path, source }) => lineHits(path, source, /["'`][^"'`]*\btimetable\b/i))),
  },
  richContentRenderers: unique(
    sources.flatMap(({ path, source }) =>
      /react-markdown|ReactMarkdown|markdown|rich.?text|tiptap|katex/i.test(source)
        ? [normalized(path)]
        : [],
    ),
  ),
  synchronizationHotPaths: {
    setContent: unique(sources.flatMap(({ path, source }) => lineHits(path, source, /\bsetContent\s*\(/))),
    wholeSerialization: unique(sources.flatMap(({ path, source }) => lineHits(path, source, /JSON\.stringify\s*\(/))),
    collaborationFlush: unique(sources.flatMap(({ path, source }) => lineHits(path, source, /\b(?:transport\.)?flush\s*\(/))),
  },
  silentFallbacks: unique(
    sources.flatMap(({ path, source }) => lineHits(path, source, /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[^*]*\*\/\s*)?\}/)),
  ),
  adminMetricSources: unique(
    convexFiles.flatMap(({ path, source }) =>
      /metric|analytics|administration|superadmin/i.test(`${path}\n${source}`)
        ? [normalized(path)]
        : [],
    ),
  ),
  manageBac: {
    files: unique(sources.flatMap(({ path }) => /managebac/i.test(path) ? [normalized(path)] : [])),
    capabilities: unique(
      sources.flatMap(({ source }) =>
        [...source.matchAll(/["'](memberships|classes|class_detail|tasks|timetable|resources|cas|discussions|announcements|feedback|assessment_results|attendance|messages)["']/gi)]
          .map((match) => match[1].toLowerCase()),
      ),
    ),
  },
};

const serialized = `${JSON.stringify(inventory, null, 2)}\n`;
const writeIndex = process.argv.indexOf("--write");
if (writeIndex >= 0) {
  const destination = resolve(root, process.argv[writeIndex + 1] ?? "docs/archive/spectra-definitive/generated/baseline-inventory.json");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, serialized, "utf8");
} else {
  process.stdout.write(serialized);
}
