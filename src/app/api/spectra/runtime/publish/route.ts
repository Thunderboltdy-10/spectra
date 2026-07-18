import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  codeRuntimeVersion,
  normalizeCodeContent,
  type CodeContent,
  type CodeFile,
} from "@/features/spectra/code/model";
import {
  runtimeSourceString,
  SPECTRA_RUNTIME_BUILD_FORMAT,
  SPECTRA_RUNTIME_BUILD_VERSION,
  type PublishedCodeBuildPayload,
  type PublishedCodeAsset,
  type PublishedCodeBuildProjection,
} from "@/features/spectra/code/published-build";
import {
  compileReactArtifact,
  ReactArtifactBuildError,
} from "@/features/spectra/code/react-build-server";
import {
  BrowserArtifactBuildError,
  compileBrowserArtifact,
} from "@/features/spectra/code/browser-build-server";
import { SPECTRA_EMBED_SDK_VERSION } from "@/features/spectra/embed/sandbox-protocol";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArtifactProjection = {
  _id: string;
  blueprintKey: string;
  title: string;
  content: unknown;
  status: string;
  accessLevel: "read" | "modify" | null;
  currentVersionId?: string;
  updatedAt: number;
};

const MAX_PUBLISHED_PAYLOAD_BYTES = 14_000_000;

type AssetProjection = {
  assetId: string;
  path?: string;
  mediaType?: string;
  bytes?: number;
  sha256?: string;
  status: "active" | "quarantined" | "revoked" | "missing";
  downloadUrl?: string | null;
};

function hashSource(content: CodeContent) {
  return createHash("sha256")
    .update(runtimeSourceString(content))
    .digest("hex");
}

function sourceBytes(files: readonly CodeFile[]) {
  return files.reduce(
    (total, file) => total + Buffer.byteLength(file.source, "utf8"),
    0,
  );
}

function compiledFiles(js: string, css: string): CodeFile[] {
  return [
    {
      id: "spectra-build-document",
      path: "index.html",
      language: "html",
      source: '<main id="root"></main>',
      generated: true,
    },
    ...(css
      ? [
          {
            id: "spectra-build-styles",
            path: "styles.css",
            language: "css",
            source: css,
            generated: true,
          },
        ]
      : []),
    {
      id: "spectra-build-script",
      path: "bundle.js",
      language: "javascript",
      source: js,
      generated: true,
    },
  ];
}

async function preparePublishedAssets(
  artifactId: string,
  content: CodeContent,
): Promise<PublishedCodeAsset[]> {
  const references = content.assets ?? [];
  if (!references.length) return [];
  const projections = await convexQuery<
    { artifactId: string; assetIds: string[] },
    AssetProjection[]
  >("artifactAssets:getReferenced", {
    artifactId,
    assetIds: references.map((reference) => reference.assetId),
  });
  const byId = new Map(
    projections.map((projection) => [projection.assetId, projection]),
  );
  const assets: PublishedCodeAsset[] = [];
  let totalBytes = 0;
  for (const reference of references) {
    const projection = byId.get(reference.assetId);
    if (
      !projection ||
      projection.status !== "active" ||
      !projection.downloadUrl ||
      projection.mediaType !== reference.mediaType ||
      projection.bytes !== reference.bytes ||
      projection.sha256 !== reference.sha256
    ) {
      throw new Error(
        `RUNTIME_ASSET_UNAVAILABLE: ${reference.path} is missing, revoked, or no longer matches its immutable reference.`,
      );
    }
    totalBytes += reference.bytes;
    if (totalBytes > 8_000_000)
      throw new Error("RUNTIME_ASSET_LIMIT: Published assets exceed 8 MB.");
    const response = await fetch(projection.downloadUrl, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok)
      throw new Error(`RUNTIME_ASSET_UNAVAILABLE: ${reference.path}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== reference.bytes || digest !== reference.sha256)
      throw new Error(`RUNTIME_ASSET_INTEGRITY_FAILED: ${reference.path}`);
    assets.push({
      id: reference.id,
      path: reference.path,
      mediaType: reference.mediaType,
      bytes: reference.bytes,
      sha256: reference.sha256,
      dataUrl: `data:${reference.mediaType};base64,${bytes.toString("base64")}`,
    });
  }
  return assets;
}

async function getArtifact(artifactId: string) {
  const artifact = await convexQuery<
    { artifactId: string },
    ArtifactProjection
  >("spectraArtifacts:get", { artifactId });
  if (
    artifact.blueprintKey !== "code" ||
    artifact.status !== "active" ||
    artifact.accessLevel !== "modify"
  ) {
    throw new Error(
      "AUTH_NO_ACCESS: Modify access to an active Code artifact is required.",
    );
  }
  return artifact;
}

async function currentBuild(artifactId: string) {
  return convexQuery<
    { artifactId: string },
    PublishedCodeBuildProjection | null
  >("spectraRuntimeBuilds:getPublished", { artifactId });
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const artifactId = request.nextUrl.searchParams.get("artifactId")?.trim();
    if (!artifactId) throw new Error("RUNTIME_ARTIFACT_ID_REQUIRED");
    const artifact = await convexQuery<
      { artifactId: string },
      ArtifactProjection
    >("spectraArtifacts:get", { artifactId });
    if (artifact.blueprintKey !== "code")
      throw new Error("RUNTIME_ARTIFACT_INVALID");
    const build = await currentBuild(artifactId);
    const content = normalizeCodeContent(artifact.content);
    return NextResponse.json(
      {
        ok: true,
        build,
        sourceMatchesCurrent: Boolean(
          build && build.sourceHash === hashSource(content),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const artifactId =
      typeof body.artifactId === "string" ? body.artifactId.trim() : "";
    if (!artifactId) throw new Error("RUNTIME_ARTIFACT_ID_REQUIRED");
    if (body.action === "unpublish") {
      await getArtifact(artifactId);
      const result = await convexMutation<
        { artifactId: string },
        { unpublished: boolean }
      >("spectraRuntimeBuilds:unpublish", { artifactId });
      return NextResponse.json(
        { ok: true, ...result },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (body.action !== "publish") throw new Error("RUNTIME_ACTION_INVALID");

    const initialArtifact = await getArtifact(artifactId);
    const initialContent = normalizeCodeContent(initialArtifact.content);
    if (initialContent.runtime === "none") {
      throw new Error(
        "RUNTIME_PROFILE_REQUIRED: Choose Browser, React/TypeScript, or Python before publishing.",
      );
    }
    if (
      initialContent.visualisation.enabled &&
      (!initialContent.accessibility?.title?.trim() ||
        !initialContent.accessibility?.description?.trim())
    ) {
      throw new Error(
        "RUNTIME_ACCESSIBILITY_REQUIRED: Published visualisations require an accessible title and text alternative.",
      );
    }
    const sourceHash = hashSource(initialContent);
    const expectedSourceHash =
      typeof body.expectedSourceHash === "string"
        ? body.expectedSourceHash.trim().toLowerCase()
        : "";
    if (!/^[a-f0-9]{64}$/.test(expectedSourceHash)) {
      throw new Error("RUNTIME_EXPECTED_SOURCE_HASH_INVALID");
    }
    if (expectedSourceHash !== sourceHash) {
      throw new Error(
        "RUNTIME_SOURCE_CHANGED: The latest live edits have not reached the publishing service yet. Wait for synchronization, then publish again.",
      );
    }
    const existing = await currentBuild(artifactId);
    if (existing?.sourceHash === sourceHash) {
      return NextResponse.json(
        { ok: true, build: existing, reused: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    let publishedFiles: CodeFile[] = initialContent.files;
    let buildSourceBytes = sourceBytes(initialContent.files);
    let outputBytes = buildSourceBytes;
    let buildDurationMs = 0;
    let lockedDependencies = initialContent.dependencies ?? {};
    if (initialContent.runtime === "browser") {
      try {
        const buildStartedAt = performance.now();
        const compiled = await compileBrowserArtifact(
          initialContent.files,
          initialContent.entryFileId,
        );
        publishedFiles = compiled.files;
        buildSourceBytes = compiled.sourceBytes;
        outputBytes = compiled.outputBytes;
        buildDurationMs = Math.max(
          1,
          Math.round(performance.now() - buildStartedAt),
        );
      } catch (error) {
        if (error instanceof BrowserArtifactBuildError) {
          return NextResponse.json(
            {
              ok: false,
              error: {
                code: "RUNTIME_BUILD_FAILED",
                message: error.message,
                issues: error.issues,
              },
            },
            { status: 422, headers: { "Cache-Control": "no-store" } },
          );
        }
        throw error;
      }
    }
    if (initialContent.runtime === "react") {
      try {
        const buildStartedAt = performance.now();
        const compiled = await compileReactArtifact({
          files: initialContent.files,
          entryFileId: initialContent.entryFileId,
          dependencies: initialContent.dependencies,
          sourceMap: false,
        });
        publishedFiles = compiledFiles(compiled.js, compiled.css);
        buildSourceBytes = compiled.sourceBytes;
        outputBytes = compiled.outputBytes;
        lockedDependencies = compiled.lockedDependencies;
        buildDurationMs = Math.max(
          1,
          Math.round(performance.now() - buildStartedAt),
        );
      } catch (error) {
        if (error instanceof ReactArtifactBuildError) {
          return NextResponse.json(
            {
              ok: false,
              error: {
                code: "RUNTIME_BUILD_FAILED",
                message: error.message,
                issues: error.issues,
                warnings: error.warnings,
              },
            },
            { status: 422, headers: { "Cache-Control": "no-store" } },
          );
        }
        throw error;
      }
    }

    const checkpoint = await convexMutation<
      { artifactId: string; name: string },
      { versionId: string; createdAt: number }
    >("changeGroups:createNamedCheckpoint", {
      artifactId,
      name: `Published ${initialArtifact.title}`,
    });
    const artifact = await getArtifact(artifactId);
    const content = normalizeCodeContent(artifact.content);
    if (
      hashSource(content) !== sourceHash ||
      artifact.currentVersionId !== checkpoint.versionId
    ) {
      throw new Error(
        "RUNTIME_SOURCE_CHANGED: The artifact changed while the published build was being prepared. Review the new source and publish again.",
      );
    }
    if (content.runtime === "none") {
      throw new Error("RUNTIME_PROFILE_REQUIRED");
    }
    const executableRuntime = content.runtime;
    const publishedAssets = await preparePublishedAssets(artifactId, content);

    const beginning = await convexMutation<
      {
        artifactId: string;
        artifactVersionId: string;
        expectedArtifactUpdatedAt: number;
        runtime: "browser" | "react" | "python";
        runtimeVersion: string;
        sourceHash: string;
        sdkVersion: string;
        entryFileId: string;
        dependencies: Record<string, string>;
        assetIds: string[];
        sourceBytes: number;
        outputBytes: number;
        buildDurationMs?: number;
      },
      | { buildId: string; reused: true }
      | { buildId: string; reused: false; uploadUrl: string }
    >("spectraRuntimeBuilds:beginUpload", {
      artifactId,
      artifactVersionId: checkpoint.versionId,
      expectedArtifactUpdatedAt: artifact.updatedAt,
      runtime: executableRuntime,
      runtimeVersion: codeRuntimeVersion(executableRuntime),
      sourceHash,
      sdkVersion: SPECTRA_EMBED_SDK_VERSION,
      entryFileId: content.entryFileId,
      dependencies: lockedDependencies,
      assetIds: (content.assets ?? []).map((asset) => asset.assetId),
      sourceBytes: buildSourceBytes,
      outputBytes,
      ...(buildDurationMs ? { buildDurationMs } : {}),
    });
    if (beginning.reused) {
      return NextResponse.json(
        { ok: true, build: await currentBuild(artifactId), reused: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    let storageId: string | undefined;
    try {
      const payload: PublishedCodeBuildPayload = {
        format: SPECTRA_RUNTIME_BUILD_FORMAT,
        version: SPECTRA_RUNTIME_BUILD_VERSION,
        sdkVersion: SPECTRA_EMBED_SDK_VERSION,
        artifactId,
        artifactVersionId: checkpoint.versionId,
        title: artifact.title,
        sourceHash,
        runtime: executableRuntime,
        runtimeVersion: codeRuntimeVersion(executableRuntime),
        entryFileId:
          executableRuntime === "react"
            ? "spectra-build-document"
            : content.entryFileId,
        dependencies: lockedDependencies,
        networkPolicy: content.networkPolicy ?? { mode: "none" },
        parameters: content.parameters ?? [],
        assets: publishedAssets,
        files: publishedFiles,
        visualisation: content.visualisation,
        accessibility: content.accessibility,
        createdAt: Date.now(),
      };
      const encoded = Buffer.from(JSON.stringify(payload), "utf8");
      if (encoded.byteLength > MAX_PUBLISHED_PAYLOAD_BYTES) {
        throw new Error(
          "RUNTIME_PAYLOAD_LIMIT: The reproducible build package exceeds 14 MB.",
        );
      }
      const payloadHash = createHash("sha256").update(encoded).digest("hex");
      const upload = await fetch(beginning.uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/vnd.spectra.runtime+json" },
        body: encoded,
      });
      const uploadResult = (await upload.json().catch(() => null)) as {
        storageId?: string;
      } | null;
      storageId = uploadResult?.storageId;
      if (!upload.ok || !storageId) {
        throw new Error(
          "RUNTIME_UPLOAD_FAILED: The build package could not be stored.",
        );
      }
      await convexMutation<
        {
          buildId: string;
          storageId: string;
          payloadHash: string;
          payloadBytes: number;
        },
        { buildId: string; publishedAt: number }
      >("spectraRuntimeBuilds:finalize", {
        buildId: beginning.buildId,
        storageId,
        payloadHash,
        payloadBytes: encoded.byteLength,
      });
    } catch (error) {
      await convexMutation<
        { buildId: string; reason: string; storageId?: string },
        { failed: boolean }
      >("spectraRuntimeBuilds:fail", {
        buildId: beginning.buildId,
        reason: error instanceof Error ? error.message : "Publish failed.",
        ...(storageId ? { storageId } : {}),
      }).catch(() => undefined);
      throw error;
    }
    return NextResponse.json(
      { ok: true, build: await currentBuild(artifactId), reused: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }, request);
}
