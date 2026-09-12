import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireActor } from "@/lib/auth-server";
import { signTrustedIntakeAttestation } from "@/lib/server-secrets";
import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { validateArtifactContent } from "@/features/spectra/artifacts/registry";
import { MAX_IMPORT_REQUEST_BYTES, MAX_PERSISTED_CONTENT_BYTES } from "../../../../../shared/intake-limits";
import { normalizeMediaType } from "../../../../../shared/intake-integrity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`IMPORT_${name.toUpperCase()}_REQUIRED`);
  return value.trim();
}

function imageDimensions(mediaType: string, bytes: Buffer) {
  if (mediaType === "image/png" && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mediaType === "image/gif" && bytes.length >= 10) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (mediaType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1] ?? 0;
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < bytes.length)
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return undefined;
}

const MAX_IMPORT_BODY_BYTES = MAX_IMPORT_REQUEST_BYTES;

async function materializeImportedMedia(value: unknown, artifactId: string, actor: Awaited<ReturnType<typeof requireActor>>): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((item) => materializeImportedMedia(item, artifactId, actor)));
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === "src" && typeof child === "string" && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(child)) {
      const match = child.match(/^data:([^;]+);base64,(.*)$/i);
      if (!match) throw new Error("IMPORT_MEDIA_INVALID");
      const bytes = Buffer.from(match[2]!, "base64");
      const digest = createHash("sha256").update(bytes).digest("hex");
      const dimensions = imageDimensions(match[1]!.toLowerCase(), bytes);
      const altText = typeof source.alt === "string" ? source.alt : typeof source.altText === "string" ? source.altText : undefined;
      const beginning = await convexMutation<{ artifactId: string; path: string; name: string; mediaType: string; bytes: number; sha256: string; width?: number; height?: number; altText?: string; sourceRef?: string }, { assetId: string; reused: boolean; uploadReceipt?: string; uploadUrl?: string }>("artifactAssets:beginUpload", {
        artifactId,
        path: `imports/${digest}.${match[1]!.split("/")[1]}`,
        name: `import-${digest.slice(0, 12)}`,
        mediaType: match[1]!,
        bytes: bytes.byteLength,
        sha256: digest,
        ...(dimensions?.width !== undefined ? { width: dimensions.width } : {}),
        ...(dimensions?.height !== undefined ? { height: dimensions.height } : {}),
        ...(altText !== undefined ? { altText } : {}),
        sourceRef: "imported-rich-content",
      });
      const assetId = beginning.assetId;
      if (!beginning.reused) {
        if (!beginning.uploadUrl || !beginning.uploadReceipt) throw new Error("IMPORT_MEDIA_INTENT_MISSING");
        const uploaded = await fetch(beginning.uploadUrl, { method: "POST", headers: { "Content-Type": match[1]!, "Content-Length": String(bytes.byteLength) }, body: bytes });
        if (!uploaded.ok) throw new Error("IMPORT_MEDIA_UPLOAD_FAILED");
        const payload = (await uploaded.json()) as { storageId?: string };
        if (!payload.storageId) throw new Error("IMPORT_MEDIA_STORAGE_ID_MISSING");
        const attestation = signTrustedIntakeAttestation({
          kind: "asset",
          actorClerkId: actor.clerkId,
          actorAccountId: actor.accountId,
          targetId: beginning.assetId,
          attemptId: beginning.uploadReceipt!,
          storageId: payload.storageId,
          bytes: bytes.byteLength,
          sha256: digest,
          mediaType: normalizeMediaType(match[1]!),
        });
        await convexAction<{ assetId: string; storageId: string; uploadReceipt: string; attestation: typeof attestation }, { assetId: string; status?: string }>("artifactIntakeActions:verifyUploadedStorage", { assetId: beginning.assetId, storageId: payload.storageId, uploadReceipt: beginning.uploadReceipt!, attestation });
      }
      output[key] = `/api/spectra/assets/content?assetId=${encodeURIComponent(assetId)}`;
      output.assetId = assetId;
      continue;
    }
    if ((key === "href" || key === "url") && typeof child === "string" && /^data:/i.test(child)) {
      output[key] = child;
      continue;
    }
    output[key] = await materializeImportedMedia(child, artifactId, actor);
  }
  return output;
}

async function readBoundedJson(request: Request, limit = MAX_IMPORT_BODY_BYTES) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("IMPORT_REQUEST_TOO_LARGE");
  if (!request.body) return {} as Record<string, unknown>;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > limit) {
      await reader.cancel("import request byte limit reached");
      throw new Error("IMPORT_REQUEST_TOO_LARGE");
    }
    chunks.push(next.value);
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length).toString("utf8")) as Record<string, unknown>;
}

async function streamStorageUpload(uploadUrl: string, request: Request, mimeType: string, bytes: number) {
  if (!request.body) throw new Error("IMPORT_BODY_REQUIRED");
  const reader = request.body.getReader();
  let seen = 0;
  const hash = createHash("sha256");
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) return controller.close();
      seen += next.value.byteLength;
      if (seen > bytes) {
        await reader.cancel("import upload byte limit reached");
        return controller.error(new Error("IMPORT_UPLOAD_TOO_LARGE"));
      }
      hash.update(next.value);
      controller.enqueue(next.value);
    },
    async cancel(reason) { await reader.cancel(reason); },
  });
  const uploaded = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!uploaded.ok) throw new Error("IMPORT_STORAGE_UPLOAD_FAILED");
  const payload = (await uploaded.json()) as { storageId?: string };
  if (!payload.storageId) throw new Error("IMPORT_STORAGE_ID_MISSING");
  return { storageId: payload.storageId, bytes: seen, sha256: hash.copy().digest("hex") };
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
    const actor = await requireActor({ fresh: true });
    const body = await readBoundedJson(request);
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
      let sanitizedContent: unknown;
      if (body.importedContent !== undefined) {
        const parsed = validateArtifactContent(typeKey, body.importedContent);
        if (!parsed.success) throw new Error("IMPORT_CONTENT_INVALID");
        const job = await convexQuery<{ jobId: string }, { artifactId: string }>("artifactImports:getForOwner", { jobId: text(body.jobId, "job_id") });
        sanitizedContent = await materializeImportedMedia(parsed.data, job.artifactId, actor);
        const encoded = Buffer.from(JSON.stringify(sanitizedContent), "utf8");
        if (encoded.byteLength > MAX_PERSISTED_CONTENT_BYTES) throw new Error("IMPORT_SNAPSHOT_TOO_LARGE");
      }
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
        ...(sanitizedContent !== undefined ? { importedContent: sanitizedContent } : {}),
      });
      if (status === "imported") {
        const committed = await convexMutation<{ artifactId: string; importJobId: string }, { versionId: string; reused?: boolean }>("changeGroups:commitImport", {
          artifactId: await convexQuery<{ jobId: string }, { artifactId: string }>("artifactImports:getForOwner", { jobId: text(body.jobId, "job_id") }).then((job) => job.artifactId),
          importJobId: text(body.jobId, "job_id"),
        });
        return NextResponse.json({ ok: true, ...result, status: "imported", ...committed });
      }
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
    const actor = await requireActor({ fresh: true });
    const jobId = text(request.nextUrl.searchParams.get("jobId"), "job_id");
    const intent = await convexMutation<
      { jobId: string },
      { uploadUrl?: string; uploadReceipt?: string; bytes?: number; sha256?: string; mimeType?: string; status?: string; storageId?: string | null }
    >("artifactImports:prepareUpload", { jobId });
    if (intent.status && intent.status !== "uploading")
      return NextResponse.json({ ok: true, jobId, status: intent.status, storageId: intent.storageId ?? undefined, reused: true });
    if (!intent.uploadUrl || !intent.uploadReceipt || intent.bytes === undefined || !intent.sha256 || !intent.mimeType)
      throw new Error("IMPORT_UPLOAD_INTENT_MISSING");
    const uploaded = await streamStorageUpload(intent.uploadUrl, request, intent.mimeType, intent.bytes);
    const attestation = signTrustedIntakeAttestation({
      kind: "original",
      actorClerkId: actor.clerkId,
      actorAccountId: actor.accountId,
      targetId: jobId,
      attemptId: intent.uploadReceipt!,
      storageId: uploaded.storageId,
      bytes: uploaded.bytes,
      sha256: uploaded.sha256,
      mediaType: normalizeMediaType(intent.mimeType),
    });
    const finalized = await convexAction<
      { jobId: string; storageId: string; uploadReceipt: string; attestation: typeof attestation },
      { jobId: string; status: string; errorCode?: string }
    >("artifactIntakeActions:verifyUploadedOriginal", { jobId, storageId: uploaded.storageId, uploadReceipt: intent.uploadReceipt ?? "", attestation });
    if (finalized.status !== "uploaded") throw new Error(finalized.errorCode || "IMPORT_UPLOAD_INTEGRITY_FAILED");
    return NextResponse.json({ ok: true, ...finalized });
  }, request);
}
