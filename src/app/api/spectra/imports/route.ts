import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { validateArtifactContent } from "@/features/spectra/artifacts/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`IMPORT_${name.toUpperCase()}_REQUIRED`);
  return value.trim();
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const artifactId = text(
      request.nextUrl.searchParams.get("artifactId"),
      "artifact_id",
    );
    const imports = await convexQuery<{ artifactId: string }, unknown[]>(
      "artifactImports:listForArtifact",
      { artifactId },
    );
    return NextResponse.json(
      { ok: true, imports },
      { headers: { "Cache-Control": "no-store" } },
    );
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const action = text(body.action, "action");
    if (action === "begin") {
      const result = await convexMutation<
        {
          artifactId: string;
          typeKey: string;
          format: string;
          name: string;
          mimeType: string;
          bytes: number;
          sha256: string;
        },
        { jobId: string }
      >("artifactImports:begin", {
        artifactId: text(body.artifactId, "artifact_id"),
        typeKey: text(body.typeKey, "type_key"),
        format: text(body.format, "format"),
        name: text(body.name, "name"),
        mimeType: text(body.mimeType, "mime_type"),
        bytes: Number(body.bytes),
        sha256: text(body.sha256, "sha256"),
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "complete") {
      const status = text(body.status, "status");
      const typeKey = text(body.typeKey, "type_key");
      if (!["imported", "quarantined", "failed"].includes(status))
        throw new Error("IMPORT_STATUS_INVALID");
      const result = await convexMutation<
        {
          jobId: string;
          typeKey: string;
          status: "imported" | "quarantined" | "failed";
          fidelityReport: Array<{
            scope: string;
            level: "exact" | "adapted" | "unsupported";
            message: string;
          }>;
          unsupportedFeatures: string[];
          quarantineReason?: string;
          importedContent?: unknown;
        },
        { jobId: string; status: string }
      >("artifactImports:complete", {
        jobId: text(body.jobId, "job_id"),
        typeKey,
        status: status as "imported" | "quarantined" | "failed",
        fidelityReport: Array.isArray(body.fidelityReport)
          ? (body.fidelityReport as Array<{
              scope: string;
              level: "exact" | "adapted" | "unsupported";
              message: string;
            }>)
          : [],
        unsupportedFeatures: Array.isArray(body.unsupportedFeatures)
          ? body.unsupportedFeatures.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
        ...(typeof body.quarantineReason === "string"
          ? { quarantineReason: body.quarantineReason }
          : {}),
        ...(body.importedContent !== undefined
          ? (() => {
              const parsed = validateArtifactContent(
                typeKey,
                body.importedContent,
              );
              if (!parsed.success) throw new Error("IMPORT_CONTENT_INVALID");
              return { importedContent: parsed.data };
            })()
          : {}),
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "abort") {
      const result = await convexMutation<
        { jobId: string; reason: string },
        { aborted: boolean }
      >("artifactImports:abortUpload", {
        jobId: text(body.jobId, "job_id"),
        reason: text(body.reason, "reason"),
      });
      return NextResponse.json({ ok: true, ...result });
    }
    throw new Error("IMPORT_ACTION_INVALID");
  }, request);
}

export async function PUT(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const jobId = text(request.nextUrl.searchParams.get("jobId"), "job_id");
    const intent = await convexMutation<
      { jobId: string },
      { uploadUrl: string; bytes: number; sha256: string; mimeType: string }
    >("artifactImports:prepareUpload", { jobId });
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.byteLength !== intent.bytes)
      throw new Error("IMPORT_UPLOAD_SIZE_MISMATCH");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== intent.sha256)
      throw new Error("IMPORT_UPLOAD_DIGEST_MISMATCH");
    const upload = await fetch(intent.uploadUrl, {
      method: "POST",
      headers: { "Content-Type": intent.mimeType },
      body: bytes,
    });
    const stored = (await upload.json().catch(() => null)) as {
      storageId?: string;
    } | null;
    if (!upload.ok || !stored?.storageId)
      throw new Error("IMPORT_STORAGE_UPLOAD_FAILED");
    const finalized = await convexMutation<
      { jobId: string; storageId: string },
      { jobId: string; status: string }
    >("artifactImports:finalizeUpload", {
      jobId,
      storageId: stored.storageId,
    });
    return NextResponse.json({ ok: true, ...finalized });
  }, request);
}
