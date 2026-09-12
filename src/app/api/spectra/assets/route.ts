import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { signTrustedIntakeAttestation } from "@/lib/server-secrets";
import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { MAX_ASSET_BYTES } from "../../../../../shared/intake-limits";
import { normalizeMediaType } from "../../../../../shared/intake-integrity";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Integrity ceiling only. Product usage limits remain disabled and metered.

function boundedBody(body: ReadableStream<Uint8Array>, limit: number) {
  const reader = body.getReader();
  let seen = 0;
  const hash = createHash("sha256");
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) return controller.close();
      seen += next.value.byteLength;
      if (seen > limit) {
        await reader.cancel("asset byte limit reached");
        return controller.error(new Error("ASSET_SIZE_INVALID"));
      }
      hash.update(next.value);
      controller.enqueue(next.value);
    },
    async cancel(reason) { await reader.cancel(reason); },
  });
  return { stream, stats: () => ({ bytes: seen, sha256: hash.copy().digest("hex") }) };
}

function required(value: unknown, code: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
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
    const actor = await requireActor({ fresh: true });
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
    );
    const declaredBytes = Number(request.headers.get("content-length") ?? request.headers.get("x-spectra-bytes"));
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 1 || declaredBytes > MAX_ASSET_BYTES)
      throw new Error("ASSET_SIZE_INVALID");
    const retryReceipt = request.nextUrl.searchParams.get("uploadReceipt") ?? request.headers.get("x-spectra-upload-receipt") ?? undefined;
    const beginning = await convexMutation<
      { artifactId: string; path: string; name: string; mediaType: string; bytes: number; sha256: string; uploadReceipt?: string },
      { assetId: string; reused: boolean; status?: string; storageId?: string; uploadReceipt?: string; uploadUrl?: string }
    >("artifactAssets:beginUpload", { artifactId, path, name, mediaType, bytes: declaredBytes, sha256: expectedDigest, ...(retryReceipt ? { uploadReceipt: retryReceipt } : {}) });
    if (beginning.reused && beginning.status !== "uploading") return NextResponse.json({ ok: true, assetId: beginning.assetId, reused: true, status: beginning.status, storageId: beginning.storageId });
    if (!beginning.uploadUrl || !beginning.uploadReceipt) throw new Error("ASSET_UPLOAD_INTENT_MISSING");
    if (!request.body) throw new Error("ASSET_BODY_REQUIRED");
    const requestBody = boundedBody(request.body, declaredBytes);
    const uploaded = await fetch(beginning.uploadUrl, {
      method: "POST",
      headers: { "Content-Type": mediaType },
      body: requestBody.stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!uploaded.ok) throw new Error("ASSET_STORAGE_UPLOAD_FAILED");
    const payload = (await uploaded.json()) as { storageId?: string };
    if (!payload.storageId) throw new Error("ASSET_STORAGE_ID_MISSING");
    const stats = requestBody.stats();
    const attestation = signTrustedIntakeAttestation({
      kind: "asset",
      actorClerkId: actor.clerkId,
      actorAccountId: actor.accountId,
      targetId: beginning.assetId,
      attemptId: beginning.uploadReceipt!,
      storageId: payload.storageId,
      bytes: stats.bytes,
      sha256: stats.sha256,
      mediaType: normalizeMediaType(mediaType),
    });
    const stored = await convexAction<
      { assetId: string; storageId: string; uploadReceipt: string; attestation: typeof attestation },
      { assetId: string; status?: string; reused?: boolean; errorCode?: string; storageId?: string }
    >("artifactIntakeActions:verifyUploadedStorage", { assetId: beginning.assetId, storageId: payload.storageId, uploadReceipt: beginning.uploadReceipt!, attestation });
    if (stored.status && stored.status !== "active") throw new Error(stored.errorCode || "ASSET_UPLOAD_INTEGRITY_FAILED");
    return NextResponse.json({ ok: true, assetId: stored.assetId, reused: Boolean(stored.reused), uploadReceipt: beginning.uploadReceipt, status: stored.status });
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
