import "server-only";

import { createHash } from "crypto";
import { build, type BuildFailure, type Loader, type Plugin } from "esbuild";
import { join, posix, relative, resolve } from "path";
import ts from "typescript";
import { instrumentJavaScript } from "./browser-build-server";

export type ReactSourceFile = {
  id?: string;
  path: string;
  language?: string;
  source: string;
};

export type ReactBuildIssue = {
  message: string;
  file?: string;
  line?: number;
  column?: number;
  sourceLine?: string;
};

export type ReactArtifactBuild = {
  js: string;
  css: string;
  sourceBytes: number;
  outputBytes: number;
  lockedDependencies: Record<string, string>;
  warnings: ReactBuildIssue[];
};

export class ReactArtifactBuildError extends Error {
  readonly issues: ReactBuildIssue[];
  readonly warnings: ReactBuildIssue[];

  constructor(issues: ReactBuildIssue[], warnings: ReactBuildIssue[] = []) {
    super(issues[0]?.message || "The React source could not be bundled.");
    this.name = "ReactArtifactBuildError";
    this.issues = issues;
    this.warnings = warnings;
  }
}

export const REACT_MAX_SOURCE_BYTES = 900_000;
export const REACT_MAX_OUTPUT_BYTES = 2_500_000;
export const REACT_MAX_FILES = 300;
const CORE_DEPENDENCIES = new Set(["react", "react-dom"]);
export const OPTIONAL_DEPENDENCIES = new Map([
  ["recharts", "2.15.4"],
  ["d3", "7.9.0"],
  ["lucide-react", "0.563.0"],
  ["date-fns", "4.1.0"],
]);
const TYPECHECK_CACHE = new Map<
  string,
  { errors: ReactBuildIssue[]; warnings: ReactBuildIssue[] }
>();

export function cleanReactSourcePath(value: string) {
  const normalized = posix
    .normalize(value.replaceAll("\\", "/"))
    .replace(/^\/+/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(
      "INVALID_SOURCE_PATH: Source paths must remain inside the artifact.",
    );
  }
  return normalized;
}

function loaderFor(path: string): Loader {
  if (/\.tsx$/i.test(path)) return "tsx";
  if (/\.ts$/i.test(path)) return "ts";
  if (/\.jsx$/i.test(path)) return "jsx";
  if (/\.css$/i.test(path)) return "css";
  if (/\.json$/i.test(path)) return "json";
  if (/\.txt$/i.test(path)) return "text";
  return "js";
}

function sourceReference(value: string) {
  return value.split(/[?#]/, 1)[0] ?? "";
}

function dependencyRoot(specifier: string) {
  if (specifier.startsWith("@"))
    return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] ?? specifier;
}

function assertAllowedImports(
  files: readonly ReactSourceFile[],
  requestedDependencies: Record<string, string>,
) {
  for (const dependency of Object.keys(requestedDependencies)) {
    if (!OPTIONAL_DEPENDENCIES.has(dependency)) {
      throw new Error(
        `DEPENDENCY_NOT_ALLOWED: ${dependency} is not in the Spectra browser-runtime allowlist.`,
      );
    }
  }
  const pattern =
    /(?:\bimport\s*(?:[^"']*?\sfrom\s*)?|\bexport\s+[^"']*?\sfrom\s*|\brequire\s*\(|\bimport\s*\()\s*["']([^"']+)["']/g;
  for (const file of files) {
    for (const match of file.source.matchAll(pattern)) {
      const specifier = match[1]!;
      if (
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        specifier === "@spectra/sdk"
      )
        continue;
      const root = dependencyRoot(specifier);
      if (
        !CORE_DEPENDENCIES.has(root) &&
        !(
          OPTIONAL_DEPENDENCIES.has(root) &&
          Object.hasOwn(requestedDependencies, root)
        )
      ) {
        throw new Error(
          `DEPENDENCY_NOT_DECLARED: Add ${root} to this artifact's allowlisted dependencies before importing it.`,
        );
      }
    }
  }
}

function sourcePlugin(files: readonly ReactSourceFile[]): Plugin {
  const byPath = new Map(
    files.map((file) => [cleanReactSourcePath(file.path), file]),
  );
  const resolveSource = (candidate: string) => {
    const options = [
      candidate,
      `${candidate}.tsx`,
      `${candidate}.ts`,
      `${candidate}.jsx`,
      `${candidate}.js`,
      `${candidate}.json`,
      `${candidate}.css`,
      `${candidate}/index.tsx`,
      `${candidate}/index.ts`,
      `${candidate}/index.jsx`,
      `${candidate}/index.js`,
    ];
    return options.find((path) => byPath.has(path));
  };
  return {
    name: "spectra-artifact-source",
    setup(api) {
      api.onResolve({ filter: /^@spectra\/sdk$/ }, () => ({
        path: "@spectra/sdk",
        namespace: "spectra-sdk",
      }));
      api.onLoad({ filter: /.*/, namespace: "spectra-sdk" }, () => ({
        loader: "js",
        contents: `
          const bridge = window.SpectraEmbed;
          export const version = bridge?.version ?? "1.2";
          export const tokens = bridge?.tokens ?? Object.freeze({});
          export const getResource = (id) => bridge?.getResource(id);
          export const listResources = () => bridge?.listResources() ?? [];
          export const getAsset = (id) => bridge?.getAsset(id);
          export const listAssets = () => bridge?.listAssets() ?? [];
          export const getParameter = (key) => bridge?.getParameter(key);
          export const listParameters = () => bridge?.listParameters() ?? [];
          export const emit = (name, detail) => bridge?.emit(name, detail);
          export const onHostChange = (listener) => bridge?.onHostChange(listener) ?? (() => {});
        `,
      }));
      api.onResolve({ filter: /.*/, namespace: "" }, (args) => {
        const direct = resolveSource(cleanReactSourcePath(args.path));
        return direct ? { path: direct, namespace: "spectra-source" } : null;
      });
      api.onResolve(
        { filter: /^(?:\.|\/)/, namespace: "spectra-source" },
        (args) => {
          const reference = sourceReference(args.path);
          const candidate = args.path.startsWith("/")
            ? cleanReactSourcePath(reference)
            : cleanReactSourcePath(
                posix.join(posix.dirname(args.importer), reference),
              );
          const resolved = resolveSource(candidate);
          return resolved
            ? { path: resolved, namespace: "spectra-source" }
            : {
                errors: [
                  {
                    text: `Local module not found: ${args.path} (from ${args.importer})`,
                  },
                ],
              };
        },
      );
      api.onResolve(
        { filter: /^[^./]/, namespace: "spectra-source" },
        async (args) =>
          api.resolve(args.path, {
            kind: args.kind,
            resolveDir: process.cwd(),
            namespace: "file",
          }),
      );
      api.onLoad({ filter: /.*/, namespace: "spectra-source" }, (args) => {
        const file = byPath.get(args.path);
        if (!file)
          return { errors: [{ text: `Source file not found: ${args.path}` }] };
        return {
          contents: file.source,
          loader: loaderFor(file.path),
          resolveDir: posix.dirname(file.path),
        };
      });
    },
  };
}

function typecheckReactSource(files: readonly ReactSourceFile[]) {
  if (!files.some((file) => /\.tsx?$/i.test(file.path)))
    return {
      errors: [] as ReactBuildIssue[],
      warnings: [] as ReactBuildIssue[],
    };
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify(
        files.map((file) => [file.path, file.language ?? "", file.source]),
      ),
    )
    .digest("hex");
  const cached = TYPECHECK_CACHE.get(cacheKey);
  if (cached) return cached;
  const virtualRoot = resolve(process.cwd(), ".spectra-code-typecheck");
  const sdkPath = join(virtualRoot, "spectra-sdk.d.ts");
  const virtualFiles = new Map<string, string>();
  const key = (value: string) => resolve(value).toLowerCase();
  for (const file of files) {
    if (!/\.(?:tsx?|jsx?|json)$/i.test(file.path)) continue;
    virtualFiles.set(key(join(virtualRoot, file.path)), file.source);
  }
  virtualFiles.set(
    key(sdkPath),
    `declare module "@spectra/sdk" {
      export const version: string;
      export const tokens: Readonly<Record<string, string>>;
      export function getResource(id: string): unknown;
      export function listResources(): string[];
      export function getAsset(id: string): { id: string; path: string; mediaType: string; url: string } | undefined;
      export function listAssets(): string[];
      export function getParameter(key: string): string | number | boolean | undefined;
      export function listParameters(): string[];
      export function emit(name: string, detail?: unknown): void;
      export function onHostChange(listener: (message: unknown) => void): () => void;
    }`,
  );
  const options: ts.CompilerOptions = {
    allowJs: true,
    allowSyntheticDefaultImports: true,
    checkJs: false,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    isolatedModules: true,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const baseHost = ts.createCompilerHost(options, true);
  const host: ts.CompilerHost = {
    ...baseHost,
    getCurrentDirectory: () => virtualRoot,
    fileExists: (fileName) =>
      virtualFiles.has(key(fileName)) || baseHost.fileExists(fileName),
    readFile: (fileName) =>
      virtualFiles.get(key(fileName)) ?? baseHost.readFile(fileName),
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNew) => {
      const source = virtualFiles.get(key(fileName));
      return source !== undefined
        ? ts.createSourceFile(fileName, source, languageVersion, true)
        : baseHost.getSourceFile(
            fileName,
            languageVersion,
            onError,
            shouldCreateNew,
          );
    },
  };
  const roots = [
    ...files
      .filter((file) => /\.(?:tsx?|jsx?)$/i.test(file.path))
      .map((file) => join(virtualRoot, file.path)),
    sdkPath,
  ];
  const program = ts.createProgram({ rootNames: roots, options, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const payload = (diagnostic: ts.Diagnostic): ReactBuildIssue => {
    const message = ts
      .flattenDiagnosticMessageText(diagnostic.messageText, "\n")
      .slice(0, 1_600);
    if (!diagnostic.file || diagnostic.start === undefined) return { message };
    const position = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start,
    );
    const file = relative(virtualRoot, diagnostic.file.fileName).replaceAll(
      "\\",
      "/",
    );
    const sourceLine = diagnostic.file.text.split(/\r?\n/)[position.line];
    return {
      message,
      ...(file && !file.startsWith("..") ? { file } : {}),
      line: position.line + 1,
      column: position.character,
      ...(sourceLine ? { sourceLine: sourceLine.slice(0, 500) } : {}),
    };
  };
  const result = {
    errors: diagnostics
      .filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      )
      .map(payload),
    warnings: diagnostics
      .filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Warning,
      )
      .map(payload),
  };
  if (TYPECHECK_CACHE.size >= 80)
    TYPECHECK_CACHE.delete(TYPECHECK_CACHE.keys().next().value!);
  TYPECHECK_CACHE.set(cacheKey, result);
  return result;
}

function issuePayload(issue: {
  text: string;
  location?: {
    file?: string;
    line?: number;
    column?: number;
    lineText?: string;
  } | null;
}): ReactBuildIssue {
  return {
    message: issue.text.slice(0, 1_600),
    ...(issue.location?.file ? { file: issue.location.file } : {}),
    ...(issue.location?.line ? { line: issue.location.line } : {}),
    ...(typeof issue.location?.column === "number"
      ? { column: issue.location.column }
      : {}),
    ...(issue.location?.lineText
      ? { sourceLine: issue.location.lineText.slice(0, 500) }
      : {}),
  };
}

export async function compileReactArtifact({
  files: inputFiles,
  entryFileId,
  dependencies: inputDependencies = {},
  sourceMap = false,
}: {
  files: readonly ReactSourceFile[];
  entryFileId?: unknown;
  dependencies?: Record<string, string>;
  sourceMap?: boolean;
}): Promise<ReactArtifactBuild> {
  if (inputFiles.length < 1 || inputFiles.length > REACT_MAX_FILES) {
    throw new Error("INVALID_FILES: Provide between 1 and 300 source files.");
  }
  const files = inputFiles.map((file) => ({
    ...(file.id ? { id: file.id } : {}),
    path: cleanReactSourcePath(file.path),
    ...(file.language ? { language: file.language } : {}),
    source: file.source,
  }));
  const uniquePaths = new Set(files.map((file) => file.path.toLowerCase()));
  if (uniquePaths.size !== files.length) {
    throw new Error(
      "DUPLICATE_SOURCE_PATH: React source paths must be unique.",
    );
  }
  const sourceBytes = files.reduce(
    (total, file) => total + Buffer.byteLength(file.source, "utf8"),
    0,
  );
  if (sourceBytes > REACT_MAX_SOURCE_BYTES) {
    throw new Error(
      "SOURCE_LIMIT: React preview source exceeds the 900 KB build limit.",
    );
  }
  const entry =
    files.find((file) => file.id === entryFileId) ??
    files.find((file) =>
      /^(?:src\/)?(?:main|index)\.(?:tsx|jsx|ts|js)$/i.test(file.path),
    );
  if (!entry) {
    throw new Error(
      "ENTRY_FILE_REQUIRED: Choose a JavaScript, TypeScript, JSX, or TSX entry file.",
    );
  }
  assertAllowedImports(files, inputDependencies);
  const typecheck = typecheckReactSource(files);
  if (typecheck.errors.length)
    throw new ReactArtifactBuildError(typecheck.errors, typecheck.warnings);
  const guardedFiles = files.map((file) =>
    /\.(?:tsx?|jsx?)$/i.test(file.path)
      ? {
          ...file,
          source: instrumentJavaScript(file.source, file.path),
        }
      : file,
  );
  let result;
  try {
    result = await build({
      entryPoints: [entry.path],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      target: ["es2022"],
      jsx: "automatic",
      sourcemap: sourceMap ? "inline" : false,
      legalComments: "none",
      treeShaking: true,
      outdir: "spectra-build",
      plugins: [sourcePlugin(guardedFiles)],
      define: { "process.env.NODE_ENV": '"production"' },
      logLevel: "silent",
    });
  } catch (error) {
    const failure = error as Partial<BuildFailure>;
    throw new ReactArtifactBuildError(
      Array.isArray(failure.errors)
        ? failure.errors.map(issuePayload)
        : [{ message: "The React source could not be bundled." }],
      Array.isArray(failure.warnings) ? failure.warnings.map(issuePayload) : [],
    );
  }
  const js =
    result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
  const css =
    result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  const outputBytes =
    Buffer.byteLength(js, "utf8") + Buffer.byteLength(css, "utf8");
  if (!js) {
    throw new Error(
      "BUILD_OUTPUT_MISSING: The React build did not produce browser JavaScript.",
    );
  }
  if (outputBytes > REACT_MAX_OUTPUT_BYTES) {
    throw new Error(
      "BUILD_OUTPUT_LIMIT: The browser bundle exceeds Spectra's 2.5 MB preview limit.",
    );
  }
  return {
    js,
    css,
    sourceBytes,
    outputBytes,
    lockedDependencies: Object.fromEntries(
      Object.keys(inputDependencies).map((name) => [
        name,
        OPTIONAL_DEPENDENCIES.get(name)!,
      ]),
    ),
    warnings: [...typecheck.warnings, ...result.warnings.map(issuePayload)],
  };
}
