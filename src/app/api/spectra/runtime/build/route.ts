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

function sourceFiles(value: unknown) {
  if (!Array.isArray(value))
    throw new Error("INVALID_FILES: Source files are required.");
  return value.map((entry): ReactSourceFile => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("INVALID_FILE: Every source file must be an object.");
    const row = entry as Record<string, unknown>;
    if (typeof row.path !== "string" || typeof row.source !== "string") {
      throw new Error(
        "INVALID_FILE: Every source file needs a path and source text.",
      );
    }
    return {
      ...(typeof row.id === "string" ? { id: row.id } : {}),
      path: cleanReactSourcePath(row.path),
      ...(typeof row.language === "string" ? { language: row.language } : {}),
      source: row.source,
    };
  });
}

function dependencies(value: unknown) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
    ? (value as Record<string, string>)
    : {};
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    if (body.runtime !== "react" && body.runtime !== "browser") {
      throw new Error(
        "INVALID_RUNTIME: This build endpoint accepts the Browser or React/TypeScript profile.",
      );
    }
    try {
      const files = sourceFiles(body.files);
      if (body.runtime === "browser") {
        const build = await compileBrowserArtifact(files, body.entryFileId);
        return NextResponse.json(
          { ok: true, build },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      const build = await compileReactArtifact({
        files,
        entryFileId: body.entryFileId,
        dependencies: dependencies(body.dependencies),
        sourceMap: true,
      });
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
