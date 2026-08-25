import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import {
  cleanReactSourcePath,
  compileReactArtifact,
  ReactArtifactBuildError,
  type ReactSourceFile,
} from "@/features/spectra/code/react-build-server";
import {
  BrowserArtifactBuildError,
  compileBrowserArtifact,
} from "@/features/spectra/code/browser-build-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 4_000_000;
const MAX_FILES = 300;
const MAX_SOURCE_BYTES = 900_000;
const MAX_FILE_BYTES = 400_000;
const MAX_DEPENDENCIES = 32;
const BUILD_TIMEOUT_MS = 15_000;

function sourceFiles(value: unknown) {
  if (!Array.isArray(value))
    throw new Error("INVALID_FILES: Source files are required.");
  if (value.length > MAX_FILES)
    throw new Error(`FILE_LIMIT: A build may contain at most ${MAX_FILES} files.`);
  let sourceBytes = 0;
  const files = value.map((entry): ReactSourceFile => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("INVALID_FILE: Every source file must be an object.");
    const row = entry as Record<string, unknown>;
    if (typeof row.path !== "string" || typeof row.source !== "string") {
      throw new Error(
        "INVALID_FILE: Every source file needs a path and source text.",
      );
    }
    const bytes = new TextEncoder().encode(row.source).byteLength;
    if (bytes > MAX_FILE_BYTES)
      throw new Error("SOURCE_LIMIT: One source file exceeds the per-file budget.");
    sourceBytes += bytes;
    return {
      ...(typeof row.id === "string" ? { id: row.id } : {}),
      path: cleanReactSourcePath(row.path),
      ...(typeof row.language === "string" ? { language: row.language } : {}),
      source: row.source,
    };
  });
  if (sourceBytes > MAX_SOURCE_BYTES)
    throw new Error("SOURCE_LIMIT: The build exceeds the 900KB source budget.");
  return files;
}

function dependencies(value: unknown) {
  if (value === undefined) return {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_DEPENDENCIES)
      throw new Error(`DEPENDENCY_LIMIT: A build may declare at most ${MAX_DEPENDENCIES} dependencies.`);
    if (entries.every(([key, entry]) =>
      /^[a-zA-Z0-9@_./-]{1,120}$/.test(key) &&
      typeof entry === "string" && entry.length <= 80,
    ))
      return Object.fromEntries(entries) as Record<string, string>;
  }
  throw new Error("INVALID_DEPENDENCIES: Dependencies must be bounded package names and versions.");
}

async function withinBuildBudget<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("BUILD_TIMEOUT: The build exceeded its 15 second time budget.")),
          BUILD_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const declaredBytes = Number(request.headers.get("content-length") ?? 0);
    if (declaredBytes > MAX_REQUEST_BYTES)
      throw new Error("REQUEST_LIMIT: The build request is too large.");
    const body = (await request.json()) as Record<string, unknown>;
    if (body.runtime !== "react" && body.runtime !== "browser") {
      throw new Error(
        "INVALID_RUNTIME: This build endpoint accepts the Browser or React/TypeScript profile.",
      );
    }
    try {
      const files = sourceFiles(body.files);
      if (body.runtime === "browser") {
        const build = await withinBuildBudget(
          compileBrowserArtifact(files, body.entryFileId),
        );
        return NextResponse.json(
          { ok: true, build },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      const build = await withinBuildBudget(
        compileReactArtifact({
          files,
          entryFileId: body.entryFileId,
          dependencies: dependencies(body.dependencies),
          sourceMap: true,
        }),
      );
      return NextResponse.json(
        {
          ok: true,
          build: {
            js: build.js,
            css: build.css,
            sourceBytes: build.sourceBytes,
            outputBytes: build.outputBytes,
          },
          lockedDependencies: build.lockedDependencies,
          warnings: build.warnings,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (
        error instanceof ReactArtifactBuildError ||
        error instanceof BrowserArtifactBuildError
      ) {
        return NextResponse.json(
          {
            ok: false,
            errors: error.issues,
            warnings:
              error instanceof ReactArtifactBuildError ? error.warnings : [],
          },
          { status: 422, headers: { "Cache-Control": "no-store" } },
        );
      }
      throw error;
    }
  }, request);
}
