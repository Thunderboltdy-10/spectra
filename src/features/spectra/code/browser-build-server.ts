import "server-only";

import generate from "@babel/generator";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { build, type BuildFailure, type Loader, type Plugin } from "esbuild";
import { posix } from "path";
import type { CodeFile } from "./model";

type BrowserSourceFile = {
  id?: string;
  path: string;
  language?: string;
  source: string;
  lineIds?: string[];
  mediaType?: string;
  generated?: boolean;
};

const MAX_BROWSER_SOURCE_BYTES = 900_000;
const MAX_BROWSER_OUTPUT_BYTES = 2_500_000;

export type BrowserBuildIssue = {
  message: string;
  file?: string;
  line?: number;
  column?: number;
};

export class BrowserArtifactBuildError extends Error {
  readonly issues: BrowserBuildIssue[];

  constructor(issues: BrowserBuildIssue[]) {
    super(issues[0]?.message || "The browser source could not be prepared.");
    this.name = "BrowserArtifactBuildError";
    this.issues = issues;
  }
}

function guardStatement() {
  return t.expressionStatement(
    t.callExpression(
      t.memberExpression(
        t.identifier("globalThis"),
        t.identifier("__spectraGuard"),
      ),
      [],
    ),
  );
}

export function instrumentJavaScript(source: string, file: string) {
  try {
    const ast = parse(source, {
      sourceType: "unambiguous",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: false,
      plugins: [
        "topLevelAwait",
        ...(/\.tsx?$/i.test(file) ? (["typescript"] as const) : []),
        ...(/\.(?:tsx|jsx)$/i.test(file) ? (["jsx"] as const) : []),
      ],
    });
    traverse(ast, {
      Loop(path) {
        const body = path.node.body;
        path.node.body = t.isBlockStatement(body)
          ? t.blockStatement([guardStatement(), ...body.body])
          : t.blockStatement([guardStatement(), body]);
      },
    });
    return generate(ast, {
      comments: true,
      compact: false,
      retainLines: true,
      sourceFileName: file,
    }).code;
  } catch (error) {
    const candidate = error as {
      message?: string;
      loc?: { line?: number; column?: number };
    };
    throw new BrowserArtifactBuildError([
      {
        message: (candidate.message || "Invalid JavaScript source.").slice(
          0,
          1_600,
        ),
        file,
        ...(candidate.loc?.line ? { line: candidate.loc.line } : {}),
        ...(typeof candidate.loc?.column === "number"
          ? { column: candidate.loc.column }
          : {}),
      },
    ]);
  }
}

function instrumentHtml(source: string, file: string) {
  let scriptIndex = 0;
  return source.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    (match, attributes: string, script: string) => {
      if (/\bdata-spectra-guarded\b/i.test(attributes)) return match;
      if (/\bsrc\s*=/i.test(attributes) || !script.trim()) return match;
      const type =
        /\btype\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2]?.toLowerCase() ??
        "text/javascript";
      if (
        ![
          "text/javascript",
          "application/javascript",
          "module",
          "text/ecmascript",
          "application/ecmascript",
        ].includes(type)
      )
        return match;
      scriptIndex += 1;
      const instrumented = instrumentJavaScript(
        script,
        `${file}#inline-${scriptIndex}`,
      ).replace(/<\/script/gi, "<\\/script");
      return `<script${attributes}>${instrumented}</script>`;
    },
  );
}

function cleanPath(value: string) {
  const normalized = posix
    .normalize(value.replaceAll("\\", "/"))
    .replace(/^\/+/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  )
    throw new Error(
      "INVALID_SOURCE_PATH: Browser source escaped the artifact.",
    );
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

function resolveLocal(
  byPath: ReadonlyMap<string, BrowserSourceFile>,
  candidate: string,
) {
  const choices = [
    candidate,
    `${candidate}.js`,
    `${candidate}.mjs`,
    `${candidate}.cjs`,
    `${candidate}.jsx`,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.json`,
    `${candidate}.css`,
    `${candidate}/index.js`,
    `${candidate}/index.mjs`,
    `${candidate}/index.jsx`,
    `${candidate}/index.ts`,
    `${candidate}/index.tsx`,
  ];
  return choices.find((choice) => byPath.has(choice));
}

function sourceReference(value: string) {
  return value.split(/[?#]/, 1)[0] ?? "";
}

function containsModuleSyntax(source: string) {
  return /(?:^|[;\n])\s*(?:import|export)\s/m.test(source);
}

function languageForPath(path: string) {
  if (/\.html?$/i.test(path)) return "html";
  if (/\.css$/i.test(path)) return "css";
  if (/\.json$/i.test(path)) return "json";
  if (/\.tsx?$/i.test(path)) return "typescript";
  if (/\.(?:m?js|cjs|jsx)$/i.test(path)) return "javascript";
  if (/\.txt$/i.test(path)) return "text";
  return "text";
}

function browserModulePlugin(files: readonly BrowserSourceFile[]): Plugin {
  const byPath = new Map(files.map((file) => [cleanPath(file.path), file]));
  return {
    name: "spectra-browser-modules",
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
        const direct = resolveLocal(byPath, cleanPath(args.path));
        return direct ? { path: direct, namespace: "spectra-source" } : null;
      });
      api.onResolve(
        { filter: /^(?:\.|\/)/, namespace: "spectra-source" },
        (args) => {
          const reference = sourceReference(args.path);
          const candidate = args.path.startsWith("/")
            ? cleanPath(reference)
            : cleanPath(posix.join(posix.dirname(args.importer), reference));
          const resolved = resolveLocal(byPath, candidate);
          return resolved
            ? { path: resolved, namespace: "spectra-source" }
            : {
                errors: [
                  {
                    text: `Local browser module not found: ${args.path} (from ${args.importer})`,
                  },
                ],
              };
        },
      );
      api.onResolve(
        { filter: /^[^./]/, namespace: "spectra-source" },
        (args) => ({
          errors: [
            {
              text: `Browser modules may import only local files or @spectra/sdk; blocked ${args.path}.`,
            },
          ],
        }),
      );
      api.onLoad({ filter: /.*/, namespace: "spectra-source" }, (args) => {
        const file = byPath.get(args.path);
        if (!file)
          return { errors: [{ text: `Source file not found: ${args.path}` }] };
        return {
          contents: /\.(?:m?js|cjs|jsx|tsx?)$/i.test(file.path)
            ? instrumentJavaScript(file.source, file.path)
            : file.source,
          loader: loaderFor(file.path),
          resolveDir: posix.dirname(file.path),
        };
      });
    },
  };
}

function buildIssue(issue: {
  text: string;
  location?: {
    file?: string;
    line?: number;
    column?: number;
  } | null;
}): BrowserBuildIssue {
  return {
    message: issue.text.slice(0, 1_600),
    ...(issue.location?.file ? { file: issue.location.file } : {}),
    ...(issue.location?.line ? { line: issue.location.line } : {}),
    ...(typeof issue.location?.column === "number"
      ? { column: issue.location.column }
      : {}),
  };
}

export async function compileBrowserArtifact(
  files: readonly BrowserSourceFile[],
  entryFileId?: unknown,
) {
  if (files.length < 1 || files.length > 300)
    throw new Error(
      "INVALID_FILES: Provide between 1 and 300 browser source files.",
    );
  const sourceBytes = files.reduce(
    (total, file) => total + Buffer.byteLength(file.source, "utf8"),
    0,
  );
  if (sourceBytes > MAX_BROWSER_SOURCE_BYTES)
    throw new Error(
      "SOURCE_LIMIT: Browser source exceeds the 900 KB build limit.",
    );
  const cleanFiles = files.map((file) => ({
    ...file,
    path: cleanPath(file.path),
  }));
  const uniquePaths = new Set(
    cleanFiles.map((file) => file.path.toLowerCase()),
  );
  if (uniquePaths.size !== cleanFiles.length)
    throw new Error(
      "DUPLICATE_SOURCE_PATH: Browser source paths must be unique.",
    );
  const selectedEntry =
    cleanFiles.find((file) => file.id === entryFileId) ??
    cleanFiles.find((file) => /(?:^|\/)index\.html?$/i.test(file.path)) ??
    cleanFiles.find((file) => /\.(?:m?js|jsx|tsx?)$/i.test(file.path));
  let moduleEntries: string[] = [];
  const inlineModules: BrowserSourceFile[] = [];
  let preparedHtmlPath: string | null = null;
  let preparedHtmlSource: string | null = null;
  const htmlEntry =
    selectedEntry && /\.html?$/i.test(selectedEntry.path)
      ? selectedEntry
      : cleanFiles.find((file) => /(?:^|\/)index\.html?$/i.test(file.path));
  if (htmlEntry) {
    preparedHtmlPath = htmlEntry.path;
    let inlineIndex = 0;
    const moduleReferenceIssues: BrowserBuildIssue[] = [];
    const filesByPath = new Map(
      cleanFiles.map((file) => [file.path, file] as const),
    );
    preparedHtmlSource = htmlEntry.source.replace(
      /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
      (match, attributes: string, inlineSource: string) => {
        const src = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2];
        const type = /\btype\s*=\s*(["'])(.*?)\1/i
          .exec(attributes)?.[2]
          ?.toLowerCase();
        const referenced = src
          ? resolveLocal(
              filesByPath,
              cleanPath(
                posix.join(posix.dirname(htmlEntry.path), sourceReference(src)),
              ),
            )
          : undefined;
        const looksLikeModule =
          type === "module" ||
          Boolean(referenced && /\.mjs$/i.test(referenced)) ||
          Boolean(
            referenced &&
            containsModuleSyntax(filesByPath.get(referenced)?.source ?? ""),
          ) ||
          (!src && containsModuleSyntax(inlineSource));
        if (!looksLikeModule) return match;
        if (src && !referenced) {
          moduleReferenceIssues.push({
            message: `Browser module not found or unavailable: ${src}`,
            file: htmlEntry.path,
          });
        } else if (referenced) moduleEntries.push(referenced);
        else if (inlineSource.trim()) {
          inlineIndex += 1;
          const path = `__spectra_inline_module_${inlineIndex}.js`;
          inlineModules.push({
            path,
            language: "javascript",
            source: inlineSource,
          });
          moduleEntries.push(path);
        }
        return "";
      },
    );
    if (moduleReferenceIssues.length)
      throw new BrowserArtifactBuildError(moduleReferenceIssues);
  } else if (
    selectedEntry &&
    /\.(?:m?js|jsx|tsx?)$/i.test(selectedEntry.path)
  ) {
    moduleEntries = [selectedEntry.path];
  }
  moduleEntries = [...new Set(moduleEntries)];
  let bundleJs = "";
  let bundleCss = "";
  if (moduleEntries.length) {
    const syntheticPath = "__spectra_browser_entry.js";
    const moduleFiles: BrowserSourceFile[] = [
      ...cleanFiles,
      ...inlineModules,
      {
        path: syntheticPath,
        language: "javascript",
        source: moduleEntries
          .map((path) => `import ${JSON.stringify(`./${path}`)};`)
          .join("\n"),
      },
    ];
    try {
      const bundled = await build({
        entryPoints: [syntheticPath],
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife",
        target: ["es2022"],
        outdir: "spectra-browser-build",
        legalComments: "none",
        treeShaking: true,
        logLevel: "silent",
        plugins: [browserModulePlugin(moduleFiles)],
      });
      bundleJs =
        bundled.outputFiles.find((file) => file.path.endsWith(".js"))?.text ??
        "";
      bundleCss =
        bundled.outputFiles.find((file) => file.path.endsWith(".css"))?.text ??
        "";
    } catch (error) {
      const failure = error as Partial<BuildFailure>;
      throw new BrowserArtifactBuildError(
        Array.isArray(failure.errors)
          ? failure.errors.map(buildIssue)
          : [{ message: "The browser modules could not be bundled." }],
      );
    }
    if (!bundleJs)
      throw new BrowserArtifactBuildError([
        { message: "The browser module build produced no executable output." },
      ]);
    const injection = `${bundleCss ? `<style>${bundleCss.replace(/<\/style/gi, "<\\/style")}</style>` : ""}<script data-spectra-guarded>${bundleJs.replace(/<\/script/gi, "<\\/script")}</script>`;
    preparedHtmlSource = preparedHtmlSource
      ? /<\/body\s*>/i.test(preparedHtmlSource)
        ? preparedHtmlSource.replace(/<\/body\s*>/i, `${injection}</body>`)
        : `${preparedHtmlSource}${injection}`
      : `<!doctype html><html><head><meta charset="utf-8"></head><body><main id="spectra-root"></main>${injection}</body></html>`;
    preparedHtmlPath ??= "index.html";
  }
  const output: CodeFile[] = cleanFiles.map((file, index) => {
    const path = file.path.toLowerCase();
    const source = /\.html?$/.test(path)
      ? instrumentHtml(
          file.path === preparedHtmlPath && preparedHtmlSource !== null
            ? preparedHtmlSource
            : file.source,
          file.path,
        )
      : /\.(?:mjs|cjs|js|jsx)$/.test(path) ||
          ["javascript", "js"].includes((file.language ?? "").toLowerCase())
        ? instrumentJavaScript(file.source, file.path)
        : file.source;
    return {
      ...file,
      id: file.id ?? `browser-file-${index + 1}`,
      language: file.language ?? languageForPath(file.path),
      source,
      ...(source !== file.source ? { generated: true } : {}),
    };
  });
  if (
    preparedHtmlPath &&
    preparedHtmlSource !== null &&
    !output.some((file) => file.path === preparedHtmlPath)
  ) {
    output.unshift({
      id: "spectra-browser-document",
      path: preparedHtmlPath,
      language: "html",
      source: instrumentHtml(preparedHtmlSource, preparedHtmlPath),
      generated: true,
    });
  }
  const outputBytes = output.reduce(
    (total, file) => total + Buffer.byteLength(file.source, "utf8"),
    0,
  );
  if (outputBytes > MAX_BROWSER_OUTPUT_BYTES)
    throw new Error(
      "BUILD_OUTPUT_LIMIT: Guarded browser output exceeds the 2.5 MB preview limit.",
    );
  return { files: output, sourceBytes, outputBytes };
}
