import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireActor } from "@/lib/auth-server";
import { convexMutation } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import type { Id } from "../../../../../convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 80_000_000;

function text(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`RESOURCE_${name.toUpperCase()}_REQUIRED`);
  return value.trim();
}

function nativeFormatFromName(name: string, mimeType: string) {
  const extension = name.includes(".")
    ? name.split(".").pop()!.toLowerCase()
    : "";
  if (extension && /^[a-z0-9][a-z0-9._-]{0,31}$/.test(extension))
    return extension;
  if (mimeType.startsWith("image/")) return mimeType.slice("image/".length) || "img";
  if (mimeType === "application/pdf") return "pdf";
  return "bin";
}

async function discardHollowImport(artifactId: string) {
  try {
    await convexMutation("spectraArtifacts:permanentlyDelete", {
      artifactId,
    });
  } catch {
    // Best-effort compensation: never mask the original upload failure.
  }
}

/**
 * Library Import for ordinary files (CANON D29).
 * Creates a resource citizen and preserves the uploaded bytes as a cloud payload.
 * Citizen creation happens before upload (issueUpload needs workId); on any
 * post-create failure the hollow artifact+org node are deleted so Library stays
 * free of content:null orphans.
 */
export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1)
      throw new Error("RESOURCE_FILE_REQUIRED");
    if (file.size > MAX_BYTES) throw new Error("RESOURCE_FILE_TOO_LARGE");

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const title =
      text(form.get("title") ?? file.name.replace(/\.[^.]+$/, ""), "title") ||
      "Untitled file";
    const mimeType =
      (typeof form.get("mimeType") === "string" && String(form.get("mimeType")).trim()) ||
      file.type ||
      "application/octet-stream";
    const nativeFormat = nativeFormatFromName(file.name, mimeType);
    const workspaceId =
      typeof form.get("workspaceId") === "string" && String(form.get("workspaceId")).trim()
        ? String(form.get("workspaceId")).trim()
        : undefined;
    const parentNodeId =
      typeof form.get("parentNodeId") === "string" && String(form.get("parentNodeId")).trim()
        ? String(form.get("parentNodeId")).trim()
        : undefined;

    const created = await convexMutation<
      {
        title: string;
        nativeFormat: string;
        bytes: number;
        contentHash: string;
        mimeType: string;
        tags: string[];
        workspaceId?: string;
        parentNodeId?: string;
      },
      { artifactId: string; nodeId: string }
    >("spectraArtifacts:createImportedResource", {
      title,
      nativeFormat,
      bytes: buffer.byteLength,
      contentHash: sha256,
      mimeType,
      tags: ["imported"],
      ...(workspaceId ? { workspaceId } : {}),
      ...(parentNodeId ? { parentNodeId } : {}),
    });

    const workId = created.artifactId as Id<"spectraArtifacts">;
    try {
      const uploadUrl = await convexMutation<{ workId: Id<"spectraArtifacts"> }, string>(
        "payloads:issueUpload",
        { workId },
      );
      const uploaded = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: buffer,
      });
      const stored = (await uploaded.json().catch(() => null)) as {
        storageId?: string;
      } | null;
      if (!uploaded.ok || !stored?.storageId)
        throw new Error("RESOURCE_PAYLOAD_UPLOAD_FAILED");

      const payload = await convexMutation<
        {
          workId: Id<"spectraArtifacts">;
          hash: string;
          storageId: Id<"_storage">;
          bytes: number;
          mediaType: string;
        },
        { payloadRef: string; deduplicated: boolean }
      >("payloads:put", {
        workId,
        hash: sha256,
        storageId: stored.storageId as Id<"_storage">,
        bytes: buffer.byteLength,
        mediaType: mimeType.slice(0, 120),
      });

      await convexMutation(
        "replicas:attachPortablePayload",
        {
          workId,
          payloadRef: payload.payloadRef,
          contentHash: sha256,
          nativeFormat,
        },
      );

      return NextResponse.json({
        ok: true,
        artifactId: created.artifactId,
        nodeId: created.nodeId,
        nativeFormat,
        bytes: buffer.byteLength,
        sha256,
      });
    } catch (error) {
      await discardHollowImport(created.artifactId);
      throw error;
    }
  }, request);
}
