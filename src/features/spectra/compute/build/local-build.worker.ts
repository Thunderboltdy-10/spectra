/// <reference lib="webworker" />

import * as esbuild from "esbuild-wasm";
import type { CachedBuildDependency, LocalBuildDiagnostic, LocalBuildFile, LocalBuildOutput } from "./local-build";

declare const self: DedicatedWorkerGlobalScope;
let initialized: Promise<void> | null = null;

function loader(file: LocalBuildFile): esbuild.Loader {
  if (file.language) return file.language === "javascript" ? "js" : file.language === "typescript" ? "ts" : file.language;
  if (/\.tsx$/i.test(file.path)) return "tsx";
  if (/\.ts$/i.test(file.path)) return "ts";
  if (/\.jsx$/i.test(file.path)) return "jsx";
  if (/\.css$/i.test(file.path)) return "css";
  if (/\.json$/i.test(file.path)) return "json";
  return "js";
}

self.onmessage = async (event: MessageEvent<{
  requestId: string;
  files: LocalBuildFile[];
  entryPath: string;
  dependencies: Record<string, CachedBuildDependency>;
  sourceBytes: number;
  maximumOutputBytes: number;
}>) => {
  const startedAt = performance.now();
  const { requestId, files, entryPath, dependencies, sourceBytes, maximumOutputBytes } = event.data;
  try {
    initialized ??= esbuild.initialize({ wasmURL: "/api/spectra/runtime/build/esbuild.wasm", worker: false });
    await initialized;
    const byPath = new Map(files.map((file) => [file.path, file]));
    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      target: ["es2022"],
      jsx: "automatic",
      sourcemap: "external",
      outdir: "spectra-local-build",
      legalComments: "none",
      treeShaking: true,
      plugins: [{
        name: "spectra-virtual-project",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (dependencies[args.path]) return { path: args.path, namespace: "dependency" };
            const base = args.importer ? args.importer.slice(0, Math.max(0, args.importer.lastIndexOf("/") + 1)) : "";
            const raw = args.path.startsWith("./") ? `${base}${args.path.slice(2)}` : args.path;
            const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}.js`, `${raw}.jsx`, `${raw}.json`, `${raw}.css`, `${raw}/index.ts`, `${raw}/index.tsx`, `${raw}/index.js`];
            const match = candidates.find((candidate) => byPath.has(candidate));
            return match ? { path: match, namespace: "project" } : { errors: [{ text: `Module not found or not cached: ${args.path}` }] };
          });
          build.onLoad({ filter: /.*/, namespace: "project" }, (args) => {
            const file = byPath.get(args.path)!;
            return { contents: file.source, loader: loader(file) };
          });
          build.onLoad({ filter: /.*/, namespace: "dependency" }, (args) => ({ contents: dependencies[args.path]!.source, loader: "js" }));
        },
      }],
      logLevel: "silent",
    });
    const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
    const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    const sourceMap = result.outputFiles.find((file) => file.path.endsWith(".js.map"))?.text ?? "";
    const outputBytes = new TextEncoder().encode(javascript + css + sourceMap).byteLength;
    if (!javascript) throw new Error("The local build produced no JavaScript output.");
    if (outputBytes > maximumOutputBytes) throw new Error("The local build output exceeds 2.5 MB.");
    const diagnostics: LocalBuildDiagnostic[] = result.warnings.map((warning) => ({
      level: "warning",
      message: warning.text,
      ...(warning.location?.file ? { file: warning.location.file } : {}),
      ...(warning.location?.line ? { line: warning.location.line } : {}),
      ...(typeof warning.location?.column === "number" ? { column: warning.location.column } : {}),
    }));
    const output: LocalBuildOutput = {
      javascript,
      css,
      sourceMap,
      diagnostics,
      sourceBytes,
      outputBytes,
      durationMs: performance.now() - startedAt,
      sandbox: { scripts: "allow-scripts", network: "blocked_by_spectra_bridge", origin: "opaque" },
    };
    self.postMessage({ requestId, ok: true, output });
  } catch (error) {
    const failure = error as { message?: string; errors?: Array<{ text: string; location?: { file?: string; line?: number; column?: number } | null }> };
    const diagnostics: LocalBuildDiagnostic[] = (failure.errors ?? []).map((issue) => ({ level: "error", message: issue.text, ...(issue.location?.file ? { file: issue.location.file } : {}), ...(issue.location?.line ? { line: issue.location.line } : {}), ...(typeof issue.location?.column === "number" ? { column: issue.location.column } : {}) }));
    self.postMessage({ requestId, ok: false, error: failure.message ?? "The local build failed.", diagnostics });
  }
};

export {};
