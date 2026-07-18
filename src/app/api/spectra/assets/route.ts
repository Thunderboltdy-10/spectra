import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Integrity ceiling only. Product usage limits remain disabled and metered.
const MAX_ASSET_BYTES = 100_000_000;

function required(value: unknown, code: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function hasPrefix(bytes: Buffer, prefix: readonly number[], offset = 0) {
  return prefix.every((value, index) => bytes[offset + index] === value);
}

function hasAscii(bytes: Buffer, value: string, offset = 0) {
  return (
    bytes.subarray(offset, offset + value.length).toString("ascii") === value
  );
}

function verifyAssetBytes(mediaType: string, bytes: Buffer) {
  const isZip =
    hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08]);
  const isSafeText =
    !bytes.includes(0) &&
    bytes.subarray(0, Math.min(bytes.length, 64 * 1024)).toString("utf8")
      .length > 0;
  const valid =
    (mediaType === "image/png" &&
      hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mediaType === "image/jpeg" && hasPrefix(bytes, [0xff, 0xd8, 0xff])) ||
    (mediaType === "image/gif" &&
      (hasAscii(bytes, "GIF87a") || hasAscii(bytes, "GIF89a"))) ||
    (mediaType === "image/webp" &&
      hasAscii(bytes, "RIFF") &&
      hasAscii(bytes, "WEBP", 8)) ||
    (mediaType === "image/avif" &&
      hasAscii(bytes, "ftyp", 4) &&
      ["avif", "avis"].includes(bytes.subarray(8, 12).toString("ascii"))) ||
    (mediaType === "audio/wav" &&
      hasAscii(bytes, "RIFF") &&
      hasAscii(bytes, "WAVE", 8)) ||
    (mediaType === "audio/ogg" && hasAscii(bytes, "OggS")) ||
    (mediaType === "audio/mpeg" &&
      (hasAscii(bytes, "ID3") ||
        (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))) ||
    (mediaType === "video/mp4" && hasAscii(bytes, "ftyp", 4)) ||
    (mediaType === "video/webm" &&
      hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])) ||
    ((mediaType === "font/woff" || mediaType === "application/font-woff") &&
      hasAscii(bytes, "wOFF")) ||
    (mediaType === "font/woff2" && hasAscii(bytes, "wOF2")) ||
    (mediaType === "font/ttf" && hasPrefix(bytes, [0x00, 0x01, 0x00, 0x00])) ||
    (mediaType === "font/otf" && hasAscii(bytes, "OTTO"));
  const documentValid =
    (mediaType === "application/pdf" && hasAscii(bytes, "%PDF-")) ||
    ([
      "text/plain",
      "text/csv",
      "text/markdown",
      "text/tab-separated-values",
    ].includes(mediaType) &&
      isSafeText) ||
    (mediaType === "application/json" &&
      isSafeText &&
      (() => {
        try {
          JSON.parse(bytes.toString("utf8"));
          return true;
        } catch {
          return false;
        }
      })()) ||
    ([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.spreadsheet",
      "application/vnd.oasis.opendocument.presentation",
    ].includes(mediaType) &&
      isZip);
  if (!valid && !documentValid) throw new Error("ASSET_CONTENT_MISMATCH");
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const artifactId = required(
      request.nextUrl.searchParams.get("artifactId"),
      "ASSET_ARTIFACT_ID_REQUIRED",
    );
    const requestedIds = request.nextUrl.searchParams
      .getAll("assetId")
      .map((value) => value.trim())
      .filter(Boolean);
    const assets = requestedIds.length
      ? await convexQuery<
          { artifactId: string; assetIds: string[] },
          unknown[]
        >("artifactAssets:getReferenced", {
          artifactId,
          assetIds: requestedIds,
        })
      : await convexQuery<{ artifactId: string }, unknown[]>(
          "artifactAssets:listForArtifact",
          { artifactId },
        );
    return NextResponse.json(
      { ok: true, assets },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }, request);
}

export async function PUT(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const artifactId = required(
      request.nextUrl.searchParams.get("artifactId"),
      "ASSET_ARTIFACT_ID_REQUIRED",
    );
    const path = required(
      request.nextUrl.searchParams.get("path"),
      "ASSET_PATH_REQUIRED",
    );
    const name = required(
      request.nextUrl.searchParams.get("name"),
      "ASSET_NAME_REQUIRED",
    );
    const mediaType = required(
      request.headers.get("content-type")?.split(";", 1)[0],
      "ASSET_MEDIA_TYPE_REQUIRED",
    ).toLowerCase();
    const expectedDigest = required(
      request.headers.get("x-spectra-sha256"),
      "ASSET_DIGEST_REQUIRED",
    ).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedDigest))
      throw new Error("ASSET_DIGEST_INVALID");
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_ASSET_BYTES)
      throw new Error("ASSET_SIZE_INVALID");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== expectedDigest) throw new Error("ASSET_DIGEST_MISMATCH");
    verifyAssetBytes(mediaType, bytes);
    const beginning = await convexMutation<
      {
        artifactId: string;
        path: string;
        name: string;
        mediaType: string;
        bytes: number;
        sha256: string;
      },
      | { assetId: string; reused: true }
      | { assetId: string; reused: false; uploadUrl: string }
    >("artifactAssets:beginUpload", {
      artifactId,
      path,
      name,
      mediaType,
      bytes: bytes.byteLength,
      sha256: digest,
    });
    if (beginning.reused) return NextResponse.json({ ok: true, ...beginning });
    let storageId: string | undefined;
    try {
      const upload = await fetch(beginning.uploadUrl, {
        method: "POST",
        headers: { "Content-Type": mediaType },
        body: bytes,
      });
      const stored = (await upload.json().catch(() => null)) as {
        storageId?: string;
      } | null;
      storageId = stored?.storageId;
      if (!upload.ok || !storageId) throw new Error("ASSET_STORAGE_FAILED");
      await convexMutation<
        { assetId: string; storageId: string },
        { assetId: string; status: "active" }
      >("artifactAssets:finalizeUpload", {
        assetId: beginning.assetId,
        storageId,
      });
      return NextResponse.json({
        ok: true,
        assetId: beginning.assetId,
        reused: false,
      });
    } catch (error) {
      await convexMutation<
        { assetId: string; reason: string; storageId?: string },
        { failed: boolean }
      >("artifactAssets:failUpload", {
        assetId: beginning.assetId,
        reason: error instanceof Error ? error.message : "Asset upload failed.",
        ...(storageId ? { storageId } : {}),
      }).catch(() => undefined);
      throw error;
    }
  }, request);
}

export async function DELETE(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const assetId = required(
      request.nextUrl.searchParams.get("assetId"),
      "ASSET_ID_REQUIRED",
    );
    const result = await convexMutation<
      { assetId: string },
      { revoked: boolean }
    >("artifactAssets:revoke", { assetId });
    return NextResponse.json({ ok: true, ...result });
  }, request);
}
