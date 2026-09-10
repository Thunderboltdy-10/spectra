import { Gunzip, strFromU8, strToU8, zipSync } from "fflate";
import { normalizeCodeNetworkOrigins } from "./network-policy";
import { DEFAULT_ARCHIVE_LIMITS, readBoundedArchive } from "../../../../shared/parser-limits";

export type CodeRuntime = "browser" | "react" | "python" | "none";

export const SPECTRA_CODE_RUNTIME_VERSIONS = Object.freeze({
  browser: "spectra-browser-es2022-v2",
  react: "spectra-react-es2022-v2",
  python: "pyodide-314.0.2",
  none: "source-only-v1",
} satisfies Record<CodeRuntime, string>);

export function codeRuntimeVersion(runtime: CodeRuntime) {
  return SPECTRA_CODE_RUNTIME_VERSIONS[runtime];
}

export type CodeFile = {
  id: string;
  path: string;
  language: string;
  source: string;
  lineIds?: string[];
  mediaType?: string;
  generated?: boolean;
};

export type CodeTest = {
  id: string;
  name: string;
  fileId?: string;
  source: string;
  enabled?: boolean;
};

export type CodeParameter = {
  id: string;
  key: string;
  label: string;
  description?: string;
  type: "number" | "text" | "boolean" | "select";
  value: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
};

export type CodeAssetReference = {
  id: string;
  assetId: string;
  path: string;
  name: string;
  mediaType: string;
  bytes: number;
  sha256: string;
};

export type CodeContent = {
  runtime: CodeRuntime;
  runtimeVersion?: string;
  entryFileId: string;
  files: CodeFile[];
  visualisation: {
    enabled: boolean;
    title?: string;
    description?: string;
    openMode?: "source" | "preview" | "split";
    aspectRatio?: number;
  };
  dependencies?: Record<string, string>;
  preview?: {
    orientation?: "horizontal" | "vertical";
    autoRun?: boolean;
    height?: number;
  };
  networkPolicy?: {
    mode: "none" | "allowlist";
    allowlist?: string[];
  };
  environmentSchema?: Array<{
    key: string;
    description?: string;
    required?: boolean;
  }>;
  tests?: CodeTest[];
  parameters?: CodeParameter[];
  assets?: CodeAssetReference[];
  resourceBindings?: Array<{
    id: string;
    artifactId: string;
    kind: "artifact" | "sheets_range" | "asset";
    range?: string;
    label?: string;
  }>;
  accessibility?: {
    title?: string;
    description?: string;
    reducedMotion?: boolean;
  };
};

export type CodeImportReport = {
  imported: number;
  skipped: string[];
  warnings: string[];
  runtime: CodeRuntime;
  sourceLabel: string;
};

export type CodeImportedAsset = {
  path: string;
  name: string;
  mediaType: string;
  bytes: Uint8Array;
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  json5: "json",
  py: "python",
  md: "markdown",
  mdx: "markdown",
  txt: "text",
  csv: "text",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  rb: "ruby",
  php: "php",
  lua: "lua",
  r: "r",
  sh: "shell",
  ps1: "powershell",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
};

const MAX_FILES = 500;
const MAX_FILE_BYTES = 700_000;
const MAX_IMPORT_BYTES = 900_000;
const MAX_IMPORTED_ASSET_BYTES = 8_000_000;
const MAX_EXPANDED_IMPORT_BYTES = MAX_IMPORT_BYTES + MAX_IMPORTED_ASSET_BYTES;
const MAX_ARCHIVE_CONTAINER_BYTES = 20_000_000;
const MAX_RECOVERY_ASSET_BYTES = 25_000_000;
const SENSITIVE_SOURCE_PATH =
  /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials?(?:\.[^/]*)?|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:pem|p12|pfx|key|keystore))$/i;
const BINARY_SOURCE_PATH =
  /\.(?:exe|dll|so|dylib|class|jar|war|wasm|bin|dat|db|sqlite\d*|png|jpe?g|gif|webp|avif|ico|pdf|docx?|xlsx?|pptx?|mp[34]|mov|avi|wav|flac|woff2?|ttf|otf)$/i;
const ASSET_MEDIA_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

function assetMediaType(path: string) {
  return ASSET_MEDIA_BY_EXTENSION[path.toLowerCase().split(".").pop() ?? ""];
}

function uid(prefix: string) {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
}

export function normalizeCodePath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error("Paths cannot leave the artifact root.");
    if (/^[\u0000-\u001f]/.test(part))
      throw new Error("Paths cannot contain control characters.");
    parts.push(part);
  }
  const path = parts.join("/");
  if (!path || path.length > 500)
    throw new Error("File paths must be between 1 and 500 characters.");
  return path;
}

export function languageForPath(path: string) {
  const extension = path.toLowerCase().split(".").pop() ?? "";
  return LANGUAGE_BY_EXTENSION[extension] ?? "text";
}

function lineIdsFor(source: string, fileId?: string) {
  return source
    .split("\n")
    .map((_, index) => (fileId ? `${fileId}:line:${index + 1}` : uid("line")));
}

export function reconcileLineIds(
  previousSource: string,
  previousIds: readonly string[] | undefined,
  nextSource: string,
) {
  const before = previousSource.split("\n");
  const after = nextSource.split("\n");
  const ids =
    previousIds?.length === before.length
      ? [...previousIds]
      : lineIdsFor(previousSource);
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix += 1;
  const beforeMiddle = before.length - prefix - suffix;
  const afterMiddle = after.length - prefix - suffix;
  const reusedMiddle = Math.min(beforeMiddle, afterMiddle);
  return [
    ...ids.slice(0, prefix),
    ...ids.slice(prefix, prefix + reusedMiddle),
    ...Array.from({ length: afterMiddle - reusedMiddle }, () => uid("line")),
    ...(suffix ? ids.slice(ids.length - suffix) : []),
  ];
}

export function normalizeCodeContent(value: unknown): CodeContent {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const rawFiles = Array.isArray(input.files) ? input.files : [];
  const paths = new Set<string>();
  const files = rawFiles.flatMap((entry, index): CodeFile[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    let path: string;
    try {
      path = normalizeCodePath(
        typeof row.path === "string" ? row.path : `file-${index + 1}.txt`,
      );
    } catch {
      path = `file-${index + 1}.txt`;
    }
    let uniquePath = path;
    let duplicate = 2;
    while (paths.has(uniquePath.toLowerCase())) {
      const dot = path.lastIndexOf(".");
      uniquePath =
        dot > 0
          ? `${path.slice(0, dot)}-${duplicate}${path.slice(dot)}`
          : `${path}-${duplicate}`;
      duplicate += 1;
    }
    paths.add(uniquePath.toLowerCase());
    const source =
      typeof row.source === "string" ? row.source.replaceAll("\r\n", "\n") : "";
    const incomingIds =
      Array.isArray(row.lineIds) &&
      row.lineIds.every((id) => typeof id === "string")
        ? (row.lineIds as string[])
        : undefined;
    const fileId = typeof row.id === "string" && row.id ? row.id : uid("file");
    return [
      {
        id: fileId,
        path: uniquePath,
        language:
          typeof row.language === "string" && row.language
            ? row.language
            : languageForPath(uniquePath),
        source,
        lineIds:
          incomingIds?.length === source.split("\n").length
            ? incomingIds
            : lineIdsFor(source, fileId),
        ...(typeof row.mediaType === "string"
          ? { mediaType: row.mediaType }
          : {}),
        ...(row.generated === true ? { generated: true } : {}),
      },
    ];
  });
  if (!files.length) {
    const fileId = uid("file");
    files.push({
      id: fileId,
      path: "index.html",
      language: "html",
      source: "<main></main>",
      lineIds: [`${fileId}:line:1`],
    });
  }
  const requestedRuntime = input.runtime;
  const runtime: CodeRuntime =
    requestedRuntime === "browser" ||
    requestedRuntime === "react" ||
    requestedRuntime === "python" ||
    requestedRuntime === "none"
      ? requestedRuntime
      : inferRuntime(files);
  const visual =
    input.visualisation &&
    typeof input.visualisation === "object" &&
    !Array.isArray(input.visualisation)
      ? (input.visualisation as Record<string, unknown>)
      : {};
  const preview =
    input.preview &&
    typeof input.preview === "object" &&
    !Array.isArray(input.preview)
      ? (input.preview as Record<string, unknown>)
      : {};
  const entryFileId =
    typeof input.entryFileId === "string" &&
    files.some((file) => file.id === input.entryFileId)
      ? input.entryFileId
      : preferredEntry(files, runtime).id;
  return {
    runtime,
    runtimeVersion: codeRuntimeVersion(runtime),
    entryFileId,
    files,
    visualisation: {
      enabled: visual.enabled !== false,
      ...(typeof visual.title === "string" ? { title: visual.title } : {}),
      ...(typeof visual.description === "string"
        ? { description: visual.description }
        : {}),
      ...(visual.openMode === "source" ||
      visual.openMode === "preview" ||
      visual.openMode === "split"
        ? { openMode: visual.openMode }
        : {}),
      ...(typeof visual.aspectRatio === "number"
        ? { aspectRatio: visual.aspectRatio }
        : {}),
    },
    dependencies: normalizeDependencies(input.dependencies, runtime),
    preview: {
      orientation:
        preview.orientation === "vertical" ? "vertical" : "horizontal",
      autoRun: preview.autoRun !== false,
      height:
        typeof preview.height === "number"
          ? Math.max(240, Math.min(1_400, Math.round(preview.height)))
          : 580,
    },
    networkPolicy:
      runtime === "browser" || runtime === "react"
        ? normalizeNetworkPolicy(input.networkPolicy)
        : { mode: "none" },
    ...(Array.isArray(input.environmentSchema)
      ? {
          environmentSchema: normalizeEnvironmentSchema(
            input.environmentSchema,
          ),
        }
      : {}),
    ...(Array.isArray(input.tests)
      ? { tests: normalizeCodeTests(input.tests, files) }
      : {}),
    parameters: normalizeParameters(input.parameters),
    assets: normalizeAssetReferences(input.assets),
    ...(Array.isArray(input.resourceBindings)
      ? {
          resourceBindings: normalizeResourceBindings(input.resourceBindings),
        }
      : {}),
    ...(input.accessibility && typeof input.accessibility === "object"
      ? { accessibility: input.accessibility as CodeContent["accessibility"] }
      : {}),
  };
}

function normalizeAssetReferences(value: unknown): CodeAssetReference[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const assetIds = new Set<string>();
  const paths = new Set<string>();
  const result: CodeAssetReference[] = [];
  for (const candidate of value.slice(0, 100)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      !row.id.trim() ||
      typeof row.assetId !== "string" ||
      !row.assetId.trim() ||
      typeof row.path !== "string" ||
      typeof row.mediaType !== "string" ||
      typeof row.bytes !== "number" ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 1 ||
      typeof row.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(row.sha256)
    )
      continue;
    let path: string;
    try {
      path = normalizeCodePath(row.path);
    } catch {
      continue;
    }
    const id = row.id.trim().slice(0, 180);
    const assetId = row.assetId.trim().slice(0, 180);
    const pathKey = path.toLowerCase();
    if (ids.has(id) || assetIds.has(assetId) || paths.has(pathKey)) continue;
    ids.add(id);
    assetIds.add(assetId);
    paths.add(pathKey);
    result.push({
      id,
      assetId,
      path,
      name:
        typeof row.name === "string" && row.name.trim()
          ? row.name.trim().slice(0, 240)
          : path.split("/").at(-1) || "asset",
      mediaType: row.mediaType.trim().toLowerCase().slice(0, 150),
      bytes: Math.min(8_000_000, row.bytes),
      sha256: row.sha256.toLowerCase(),
    });
  }
  return result;
}

function normalizeEnvironmentSchema(
  value: unknown,
): NonNullable<CodeContent["environmentSchema"]> {
  if (!Array.isArray(value)) return [];
  const keys = new Set<string>();
  const schema: NonNullable<CodeContent["environmentSchema"]> = [];
  for (const candidate of value.slice(0, 50)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const row = candidate as Record<string, unknown>;
    const rawKey =
      typeof row.key === "string"
        ? row.key
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9_]/g, "_")
            .slice(0, 80)
        : "";
    if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(rawKey) || keys.has(rawKey)) continue;
    keys.add(rawKey);
    schema.push({
      key: rawKey,
      ...(typeof row.description === "string"
        ? { description: row.description.slice(0, 500) }
        : {}),
      ...(typeof row.required === "boolean" ? { required: row.required } : {}),
    });
  }
  return schema;
}

function normalizeCodeTests(value: unknown, files: CodeFile[]): CodeTest[] {
  if (!Array.isArray(value)) return [];
  const fileIds = new Set(files.map((file) => file.id));
  const ids = new Set<string>();
  const tests: CodeTest[] = [];
  for (const candidate of value.slice(0, 200)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const row = candidate as Record<string, unknown>;
    const source = typeof row.source === "string" ? row.source : "";
    if (!source.trim()) continue;
    let id =
      typeof row.id === "string" && row.id.trim() ? row.id.trim() : uid("test");
    while (ids.has(id)) id = uid("test");
    ids.add(id);
    const fileId =
      typeof row.fileId === "string" && fileIds.has(row.fileId)
        ? row.fileId
        : undefined;
    tests.push({
      id,
      name:
        typeof row.name === "string" && row.name.trim()
          ? row.name.trim().slice(0, 200)
          : `Test ${tests.length + 1}`,
      ...(fileId ? { fileId } : {}),
      source: source.replaceAll("\r\n", "\n").slice(0, 900_000),
      ...(typeof row.enabled === "boolean" ? { enabled: row.enabled } : {}),
    });
  }
  return tests;
}

function normalizeResourceBindings(
  value: unknown,
): NonNullable<CodeContent["resourceBindings"]> {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const bindings: NonNullable<CodeContent["resourceBindings"]> = [];
  for (const candidate of value.slice(0, 100)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const row = candidate as Record<string, unknown>;
    if (typeof row.artifactId !== "string" || !row.artifactId.trim()) continue;
    const kind =
      row.kind === "sheets_range" || row.kind === "asset" || row.kind === "artifact"
        ? row.kind
        : "artifact";
    let id =
      typeof row.id === "string" && row.id.trim()
        ? row.id.trim()
        : uid("binding");
    while (ids.has(id)) id = uid("binding");
    ids.add(id);
    bindings.push({
      id,
      artifactId: row.artifactId.trim().slice(0, 180),
      kind,
      ...(typeof row.range === "string"
        ? { range: row.range.slice(0, 200) }
        : {}),
      ...(typeof row.label === "string"
        ? { label: row.label.slice(0, 300) }
        : {}),
    });
  }
  return bindings;
}

function normalizeParameters(value: unknown): CodeParameter[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  const parameters: CodeParameter[] = [];
  for (const candidate of value.slice(0, 80)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const row = candidate as Record<string, unknown>;
    const type = ["number", "text", "boolean", "select"].includes(
      String(row.type),
    )
      ? (row.type as CodeParameter["type"])
      : "text";
    let id =
      typeof row.id === "string" && row.id.trim()
        ? row.id.trim()
        : uid("parameter");
    while (ids.has(id)) id = uid("parameter");
    ids.add(id);
    const fallbackKey = `parameter_${parameters.length + 1}`;
    let key =
      typeof row.key === "string"
        ? row.key
            .trim()
            .replace(/[^a-zA-Z0-9_]/g, "_")
            .slice(0, 80)
        : fallbackKey;
    if (!/^[a-zA-Z_]/.test(key)) key = `_${key}`;
    if (!key) key = fallbackKey;
    let uniqueKey = key;
    let suffix = 2;
    while (keys.has(uniqueKey)) uniqueKey = `${key}_${suffix++}`.slice(0, 80);
    keys.add(uniqueKey);
    const options = Array.isArray(row.options)
      ? [
          ...new Set(
            row.options
              .filter((option): option is string => typeof option === "string")
              .map((option) => option.trim())
              .filter(Boolean),
          ),
        ].slice(0, 40)
      : [];
    const valueForType =
      type === "number"
        ? typeof row.value === "number" && Number.isFinite(row.value)
          ? row.value
          : 0
        : type === "boolean"
          ? row.value === true
          : type === "select"
            ? typeof row.value === "string" && options.includes(row.value)
              ? row.value
              : (options[0] ?? "")
            : typeof row.value === "string"
              ? row.value.slice(0, 2_000)
              : String(row.value ?? "").slice(0, 2_000);
    parameters.push({
      id,
      key: uniqueKey,
      label:
        typeof row.label === "string" && row.label.trim()
          ? row.label.trim().slice(0, 160)
          : uniqueKey.replaceAll("_", " "),
      ...(typeof row.description === "string" && row.description.trim()
        ? { description: row.description.trim().slice(0, 500) }
        : {}),
      type,
      value: valueForType,
      ...(type === "number" &&
      typeof row.min === "number" &&
      Number.isFinite(row.min)
        ? { min: row.min }
        : {}),
      ...(type === "number" &&
      typeof row.max === "number" &&
      Number.isFinite(row.max)
        ? { max: row.max }
        : {}),
      ...(type === "number" && typeof row.step === "number" && row.step > 0
        ? { step: row.step }
        : {}),
      ...(type === "select" ? { options } : {}),
    });
  }
  return parameters;
}

function normalizeNetworkPolicy(value: unknown): CodeContent["networkPolicy"] {
  const row =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (row.mode !== "allowlist") return { mode: "none" };
  return {
    mode: "allowlist",
    allowlist: normalizeCodeNetworkOrigins(
      Array.isArray(row.allowlist)
        ? row.allowlist.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
    ),
  };
}

function normalizeDependencies(value: unknown, runtime: CodeRuntime) {
  if (runtime !== "react" || !isStringRecord(value)) return {};
  const pinned: Record<string, string> = {
    recharts: "2.15.4",
    d3: "7.9.0",
    "lucide-react": "0.563.0",
    "date-fns": "4.1.0",
  };
  return Object.fromEntries(
    Object.keys(value as Record<string, string>)
      .filter((name) => Object.hasOwn(pinned, name))
      .map((name) => [name, pinned[name]!] as const),
  );
}

function isStringRecord(value: unknown) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string"),
  );
}

function tarEntries(bytes: Uint8Array) {
  const entries: Array<{ path: string; bytes: Uint8Array }> = [];
  const decoder = new TextDecoder();
  const field = (offset: number, length: number) =>
    decoder
      .decode(bytes.slice(offset, offset + length))
      .replace(/\0[\s\S]*$/, "")
      .trim();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = field(offset, 100);
    const prefix = field(offset + 345, 155);
    const sizeText = field(offset + 124, 12).replace(/[^0-7]/g, "");
    const size = Number.parseInt(sizeText || "0", 8);
    const type = String.fromCharCode(bytes[offset + 156] ?? 0);
    if (
      !Number.isFinite(size) ||
      size < 0 ||
      offset + 512 + size > bytes.length
    )
      throw new Error("The TAR archive contains an invalid file boundary.");
    const path = prefix ? `${prefix}/${name}` : name;
    if ((type === "\0" || type === "0" || type === "7") && path)
      entries.push({
        path,
        bytes: bytes.slice(offset + 512, offset + 512 + size),
      });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function gunzipWithLimit(bytes: Uint8Array) {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const decoder = new Gunzip((chunk) => {
    total += chunk.byteLength;
    if (total > MAX_EXPANDED_IMPORT_BYTES)
      throw new Error("Expanded archive exceeds the safe import budget.");
    chunks.push(chunk);
  });
  decoder.push(bytes, true);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function inferRuntime(files: readonly CodeFile[]): CodeRuntime {
  if (
    files.some(
      (file) =>
        /\.(?:tsx|jsx)$/i.test(file.path) ||
        /^(?:typescriptreact|javascriptreact)$/i.test(file.language),
    )
  )
    return "react";
  if (
    files.some(
      (file) => /\.html?$/i.test(file.path) || file.language === "html",
    )
  )
    return "browser";
  if (
    files.some((file) => /\.py$/i.test(file.path) || file.language === "python")
  )
    return "python";
  return "none";
}

export function preferredEntry(
  files: readonly CodeFile[],
  runtime: CodeRuntime,
) {
  const patterns =
    runtime === "react"
      ? [/^(?:src\/)?(?:main|index)\.(?:tsx|jsx|ts|js)$/i, /\.(?:tsx|jsx)$/i]
      : runtime === "python"
        ? [/^(?:main|app)\.py$/i, /\.py$/i]
        : [/^index\.html?$/i, /\.html?$/i, /^(?:main|index)\.(?:js|mjs)$/i];
  return (
    patterns.flatMap((pattern) =>
      files.filter((file) => pattern.test(file.path)),
    )[0] ?? files[0]!
  );
}

export async function importCodeFiles(selected: readonly File[]) {
  const imported: CodeFile[] = [];
  const importedAssets: CodeImportedAsset[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const importedPaths = new Set<string>();
  let totalBytes = 0;
  let totalAssetBytes = 0;
  const append = (
    pathValue: string,
    bytes: Uint8Array,
    sourceLabel: string,
  ) => {
    if (imported.length + importedAssets.length >= MAX_FILES) {
      skipped.push(`${sourceLabel}: file-count limit reached`);
      return;
    }
    let path: string;
    try {
      path = normalizeCodePath(pathValue);
    } catch (error) {
      skipped.push(
        `${sourceLabel}: ${error instanceof Error ? error.message : "unsafe path"}`,
      );
      return;
    }
    if (SENSITIVE_SOURCE_PATH.test(path)) {
      skipped.push(
        `${sourceLabel}: secret-bearing configuration is quarantined and never enters browser-visible artifact content`,
      );
      return;
    }
    if (BINARY_SOURCE_PATH.test(path)) {
      const mediaType = assetMediaType(path);
      if (!mediaType) {
        skipped.push(
          `${sourceLabel}: executable, document, database, or unsupported binary content was quarantined`,
        );
        return;
      }
      if (bytes.byteLength > MAX_IMPORTED_ASSET_BYTES) {
        skipped.push(`${sourceLabel}: asset exceeds the 8 MB runtime limit`);
        return;
      }
      if (totalAssetBytes + bytes.byteLength > MAX_IMPORTED_ASSET_BYTES) {
        skipped.push(
          `${sourceLabel}: current live assets would exceed the 8 MB runtime budget`,
        );
        return;
      }
      if (importedPaths.has(path.toLowerCase())) {
        skipped.push(`${sourceLabel}: duplicates ${path}`);
        return;
      }
      totalAssetBytes += bytes.byteLength;
      importedPaths.add(path.toLowerCase());
      importedAssets.push({
        path,
        name: path.split("/").at(-1) || "asset",
        mediaType,
        bytes,
      });
      return;
    }
    if (bytes.byteLength > MAX_FILE_BYTES) {
      skipped.push(`${sourceLabel}: exceeds the 700 KB live-source limit`);
      return;
    }
    if (importedPaths.has(path.toLowerCase())) {
      skipped.push(`${sourceLabel}: duplicates ${path}`);
      return;
    }
    if (bytes.slice(0, 8_192).includes(0)) {
      skipped.push(
        `${sourceLabel}: binary files are quarantined rather than opened as source`,
      );
      return;
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_IMPORT_BYTES)
      throw new Error("The import exceeds Spectra's 900 KB live-source limit.");
    const source = strFromU8(bytes).replaceAll("\r\n", "\n");
    importedPaths.add(path.toLowerCase());
    const fileId = uid("file");
    imported.push({
      id: fileId,
      path,
      language: languageForPath(path),
      source,
      lineIds: lineIdsFor(source, fileId),
    });
  };

  for (const file of selected) {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_ARCHIVE_CONTAINER_BYTES)
      throw new Error(`${file.name} exceeds the 20 MB import-container limit.`);
    if (/\.zip$/i.test(file.name)) {
      let archive: Record<string, Uint8Array>;
      try {
        archive = (
          await readBoundedArchive(bytes, {
            ...DEFAULT_ARCHIVE_LIMITS,
            maxEntries: MAX_FILES,
            maxExpandedBytes: MAX_EXPANDED_IMPORT_BYTES,
            maxEntryBytes: MAX_IMPORTED_ASSET_BYTES,
            maxInputBytes: MAX_ARCHIVE_CONTAINER_BYTES,
            maxWorkBytes: MAX_ARCHIVE_CONTAINER_BYTES + MAX_EXPANDED_IMPORT_BYTES,
            maxCompressionRatio: 120,
          })
        ).entries;
      } catch {
        throw new Error(`${file.name} is not a readable ZIP archive.`);
      }
      for (const [path, value] of Object.entries(archive))
        if (!path.endsWith("/")) append(path, value, `${file.name}/${path}`);
      warnings.push(
        "Archive dependencies are source-only until they pass the supported runtime allowlist.",
      );
      continue;
    }
    if (/\.(?:tar|tgz|tar\.gz)$/i.test(file.name)) {
      let archiveBytes = bytes;
      try {
        if (/\.(?:tgz|tar\.gz)$/i.test(file.name))
          archiveBytes = gunzipWithLimit(bytes);
        else if (archiveBytes.byteLength > MAX_EXPANDED_IMPORT_BYTES)
          throw new Error("Expanded archive exceeds the safe import budget.");
        const entries = tarEntries(archiveBytes);
        if (!entries.length)
          throw new Error("No regular source files were found.");
        for (const entry of entries)
          append(entry.path, entry.bytes, `${file.name}/${entry.path}`);
      } catch (error) {
        throw new Error(
          `${file.name} is not a readable TAR archive: ${error instanceof Error ? error.message : "invalid archive"}`,
        );
      }
      warnings.push(
        "Archive symlinks, device entries, permissions, and executable metadata were quarantined.",
      );
      continue;
    }
    if (/\.ipynb$/i.test(file.name)) {
      try {
        const notebook = JSON.parse(strFromU8(bytes)) as {
          cells?: Array<{ cell_type?: string; source?: string[] | string }>;
        };
        const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
        const source = cells
          .flatMap((cell, index) =>
            cell.cell_type === "code"
              ? [
                  `# %% Cell ${index + 1}\n`,
                  ...(Array.isArray(cell.source)
                    ? cell.source
                    : [cell.source ?? ""]),
                  "\n",
                ]
              : [],
          )
          .join("");
        append(
          file.name.replace(/\.ipynb$/i, ".py"),
          strToU8(source),
          file.name,
        );
        warnings.push(
          `${file.name}: code cells were staged as Python; notebook outputs and rich metadata remain unsupported.`,
        );
      } catch {
        skipped.push(`${file.name}: invalid notebook JSON`);
      }
      continue;
    }
    append(relativePath, bytes, file.name);
  }
  if (!imported.length)
    throw new Error(skipped[0] ?? "No supported source files were found.");
  let manifestRuntime: CodeRuntime | null = null;
  let manifestEntryPath: string | null = null;
  let manifestParameters: CodeParameter[] = [];
  let manifestVisualisation: CodeContent["visualisation"] | undefined;
  const spectraManifestIndex = imported.findIndex(
    (file) => file.path.toLowerCase() === "spectra.manifest.json",
  );
  if (spectraManifestIndex >= 0) {
    const [manifestFile] = imported.splice(spectraManifestIndex, 1);
    try {
      const manifest = JSON.parse(manifestFile!.source) as Record<
        string,
        unknown
      >;
      if (manifest.format === "spectra-code") {
        if (
          manifest.runtime === "browser" ||
          manifest.runtime === "react" ||
          manifest.runtime === "python" ||
          manifest.runtime === "none"
        )
          manifestRuntime = manifest.runtime;
        if (typeof manifest.entryFile === "string")
          manifestEntryPath = normalizeCodePath(manifest.entryFile);
        manifestParameters = normalizeParameters(manifest.parameters);
        if (
          manifest.visualisation &&
          typeof manifest.visualisation === "object" &&
          !Array.isArray(manifest.visualisation)
        ) {
          const visual = manifest.visualisation as Record<string, unknown>;
          manifestVisualisation = {
            enabled: visual.enabled !== false,
            ...(typeof visual.title === "string"
              ? { title: visual.title.slice(0, 300) }
              : {}),
            ...(typeof visual.description === "string"
              ? { description: visual.description.slice(0, 2_000) }
              : {}),
            ...(visual.openMode === "source" ||
            visual.openMode === "preview" ||
            visual.openMode === "split"
              ? { openMode: visual.openMode }
              : {}),
            ...(typeof visual.aspectRatio === "number" &&
            visual.aspectRatio > 0 &&
            visual.aspectRatio <= 5
              ? { aspectRatio: visual.aspectRatio }
              : {}),
          };
        }
        const importedNetwork = manifest.networkPolicy as
          { mode?: unknown; allowlist?: unknown } | undefined;
        if (importedNetwork?.mode === "allowlist") {
          warnings.push(
            "Imported network origins were not activated. Review and approve each origin in Settings.",
          );
        }
      } else
        warnings.push(
          "An unrecognized Spectra manifest was preserved only in the original archive.",
        );
    } catch {
      warnings.push(
        "The Spectra manifest was invalid and its runtime settings were ignored.",
      );
    }
  }
  const packageFile = imported.find(
    (file) => file.path.toLowerCase() === "package.json",
  );
  const dependencies: Record<string, string> = {};
  if (packageFile) {
    try {
      const manifest = JSON.parse(packageFile.source) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
        scripts?: Record<string, unknown>;
      };
      const requested = {
        ...(manifest.dependencies ?? {}),
        ...(manifest.devDependencies ?? {}),
      };
      const supportedDependencies: Record<string, string> = {
        recharts: "2.15.4",
        d3: "7.9.0",
        "lucide-react": "0.563.0",
        "date-fns": "4.1.0",
      };
      for (const [name, version] of Object.entries(supportedDependencies))
        if (typeof requested[name] === "string") dependencies[name] = version;
      const unsupported = Object.keys(requested).filter(
        (name) =>
          ![
            "react",
            "react-dom",
            ...Object.keys(supportedDependencies),
          ].includes(name),
      );
      if (unsupported.length)
        warnings.push(
          `Dependencies not available in the initial browser profile: ${unsupported.slice(0, 12).join(", ")}${unsupported.length > 12 ? "…" : ""}. Source was preserved.`,
        );
      if (manifest.scripts && Object.keys(manifest.scripts).length)
        warnings.push(
          "package.json scripts were preserved as source but are never executed by Spectra.",
        );
    } catch {
      warnings.push(
        "package.json could not be parsed; source was preserved without dependency activation.",
      );
    }
  }
  if (!imported.length)
    throw new Error("The archive contained a manifest but no source files.");
  const runtime = manifestRuntime ?? inferRuntime(imported);
  return {
    files: imported,
    assets: importedAssets,
    dependencies,
    entryPath: manifestEntryPath,
    parameters: manifestParameters,
    visualisation: manifestVisualisation,
    report: {
      imported: imported.length,
      skipped,
      warnings,
      runtime,
      sourceLabel:
        selected.length === 1
          ? selected[0]!.name
          : `${selected.length} selected items`,
    } satisfies CodeImportReport,
  };
}

export async function createCodeImportRecoveryAsset(selected: readonly File[]) {
  if (!selected.length) throw new Error("Choose source to import.");
  const totalBytes = selected.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_RECOVERY_ASSET_BYTES)
    throw new Error("The recoverable original exceeds the 25 MB import limit.");
  if (selected.length === 1) {
    const file = selected[0]!;
    return {
      blob: file as Blob,
      name: file.name.slice(0, 240),
      mimeType: file.type || "application/octet-stream",
      format: file.name.toLowerCase().split(".").pop()?.slice(0, 80) || "file",
    };
  }
  const entries: Record<string, Uint8Array> = {};
  for (const [index, file] of selected.entries()) {
    const relative =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name ||
      `source-${index + 1}`;
    let path: string;
    try {
      path = normalizeCodePath(relative);
    } catch {
      path = `quarantined/source-${index + 1}`;
    }
    if (entries[path]) path = `duplicates/${index + 1}-${path}`;
    entries[path] = new Uint8Array(await file.arrayBuffer());
  }
  const bytes = zipSync(entries, { level: 1 });
  if (bytes.byteLength > MAX_RECOVERY_ASSET_BYTES)
    throw new Error(
      "The recoverable source bundle exceeds the 25 MB import limit.",
    );
  return {
    blob: new Blob([bytes], { type: "application/zip" }),
    name: "spectra-original-source.zip",
    mimeType: "application/zip",
    format: "source-folder-zip",
  };
}

export function exportCodeArchive(
  content: CodeContent,
  title: string,
  assets: Array<{
    id: string;
    path: string;
    mediaType: string;
    dataUrl: string;
  }> = [],
) {
  const entries: Record<string, Uint8Array> = {};
  for (const file of content.files)
    entries[normalizeCodePath(file.path)] = strToU8(file.source);
  for (const asset of assets) {
    const marker = ";base64,";
    const offset = asset.dataUrl.indexOf(marker);
    if (offset < 0)
      throw new Error(
        `Runtime asset ${asset.path} has an invalid data envelope.`,
      );
    const binary = atob(asset.dataUrl.slice(offset + marker.length));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    entries[normalizeCodePath(asset.path)] = bytes;
  }
  entries["spectra.manifest.json"] = strToU8(
    JSON.stringify(
      {
        format: "spectra-code",
        version: 1,
        title,
        runtime: content.runtime,
        runtimeVersion:
          content.runtimeVersion ?? codeRuntimeVersion(content.runtime),
        entryFile: content.files.find((file) => file.id === content.entryFileId)
          ?.path,
        dependencies: content.dependencies ?? {},
        networkPolicy: content.networkPolicy ?? { mode: "none" },
        visualisation: content.visualisation,
        parameters: content.parameters ?? [],
        assets: (content.assets ?? []).map((asset) => ({
          id: asset.id,
          path: asset.path,
          name: asset.name,
          mediaType: asset.mediaType,
          bytes: asset.bytes,
          sha256: asset.sha256,
        })),
      },
      null,
      2,
    ),
  );
  return new Blob([zipSync(entries, { level: 6 })], {
    type: "application/zip",
  });
}

export function codeContentKey(content: CodeContent) {
  return JSON.stringify(content);
}

export function codeParameterSnapshot(
  content: Pick<CodeContent, "parameters">,
) {
  return Object.fromEntries(
    (content.parameters ?? []).map((parameter) => [
      parameter.key,
      parameter.value,
    ]),
  ) as Record<string, string | number | boolean>;
}
