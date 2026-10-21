import { loadVersionAfter } from "./artifactSnapshots";
import { v } from "convex/values";
import { validateContentAdoption } from "./collaborationDurablePayload";
import { action, query } from "./functions";
import { mutation, internalMutation } from "./orgNodeMutation";
import { api, internal } from "./_generated/api";
import { writeAuditEvent } from "./auditShared";
import { recordMeterEvent, assertSchoolStorageCeiling } from "./metering";
import { isHollowDefaultContent, requireArtifactCapability } from "./spectraShared";
import { getAuthenticatedActor } from "./identityShared";
import { validateIntakeAttestation, vIntakeAttestation } from "./intakeAttestation";
import type { IntakeAttestation } from "../shared/intake-attestation";
import { MAX_IMPORT_ORIGINAL_BYTES, MAX_PERSISTED_CONTENT_BYTES } from "../shared/intake-limits";
import { normalizeMediaType, normalizeSha256, verifyContentSignature } from "../shared/intake-integrity";

const fidelityLevel = v.union(
  v.literal("exact"),
  v.literal("adapted"),
  v.literal("unsupported"),
);
const SUPPORTED_IMPORT_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/pdf",
  "text/plain",
]);

function cleanMimeType(value: string) {
  const mimeType = normalizeMediaType(value);
  if (!SUPPORTED_IMPORT_MIME_TYPES.has(mimeType)) throw new Error("IMPORT_MIME_UNSUPPORTED");
  return mimeType;
}

function cleanDigest(value: string) {
  const digest = normalizeSha256(value);
  if (!digest) throw new Error("IMPORT_DIGEST_INVALID");
  return digest;
}

function cleanBytes(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_IMPORT_ORIGINAL_BYTES)
    throw new Error("IMPORT_SIZE_INVALID");
  return value;
}

async function contentHash(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const begin = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    typeKey: v.string(),
    format: v.string(),
    name: v.string(),
    mimeType: v.string(),
    bytes: v.number(),
    sha256: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    if (artifact.status !== "active" || artifact.blueprintKey !== args.typeKey)
      throw new Error("IMPORT_ARTIFACT_INVALID");
    const bytes = cleanBytes(args.bytes);
    const mimeType = cleanMimeType(args.mimeType);
    const sha256 = cleanDigest(args.sha256);
    const rootRoom = await ctx.db
      .query("collaborationRooms")
      .withIndex("by_artifact_partition", (q) =>
        q.eq("artifactId", artifact._id).eq("partitionKey", "root"),
      )
      .unique();
    const now = Date.now();
    const jobId = await ctx.db.insert("artifactImportJobs", {
      artifactId: artifact._id,
      schoolId: artifact.schoolId,
      ownerAccountId: actor.accountId,
      ...(artifact.currentVersionId ? { targetVersionId: artifact.currentVersionId } : {}),
      ...(artifact.liveStateVectorHash ? { targetStateVectorHash: artifact.liveStateVectorHash } : {}),
      ...(rootRoom
        ? {
            targetRoomId: rootRoom._id,
            targetAppendHead: rootRoom.nextSequence - 1,
            targetProjectionHead: rootRoom.lastProjectionSequence ?? 0,
          }
        : {}),
      baseRevisionCaptured: true,
      typeKey: args.typeKey.slice(0, 80),
      format: args.format.slice(0, 80),
      originalAssetRef: `pending:${sha256}`,
      originalName: args.name.trim().slice(0, 240) || "import-source",
      originalMimeType: mimeType,
      originalBytes: bytes,
      originalSha256: sha256,
      uploadReceipt: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      status: "uploading",
      unsupportedFeatures: [],
      parserVersion: "spectra-imports/1",
      createdAt: now,
      updatedAt: now,
    });
    return { jobId };
  },
});

export const prepareUpload = mutation({
  args: { jobId: v.id("artifactImportJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || !job.artifactId)
      throw new Error("IMPORT_UPLOAD_NOT_ACTIVE");
    const { actor } = await requireArtifactCapability(
      ctx,
      job.artifactId,
      "modify",
    );
    if (job.ownerAccountId !== actor.accountId)
      throw new Error(
        "AUTH_NO_ACCESS: Only the importing user can upload this original.",
      );
    if (job.status !== "uploading") {
      return {
        jobId: job._id,
        status: job.status,
        storageId: job.originalStorageId ?? job.candidateStorageId ?? null,
      };
    }
    await assertSchoolStorageCeiling(ctx, actor.schoolId, job.originalBytes ?? 0);
    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      uploadReceipt: job.uploadReceipt,
      bytes: job.originalBytes!,
      sha256: job.originalSha256!,
      mimeType: job.originalMimeType || "application/octet-stream",
    };
  },
});

export const storeOriginalAuthorized = action({
  args: { jobId: v.id("artifactImportJobs"), bytes: v.bytes(), sha256: v.string(), mimeType: v.string() },
  handler: async (ctx, args): Promise<{ jobId: string; status: string; committed?: boolean; errorCode?: string }> => {
    const intent = await ctx.runMutation(api.artifactImports.prepareUpload, { jobId: args.jobId });
    if (intent.status) return { jobId: String(args.jobId), status: intent.status, committed: true };
    if (args.bytes.byteLength !== intent.bytes) throw new Error("IMPORT_UPLOAD_SIZE_MISMATCH");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", args.bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== cleanDigest(args.sha256) || digest !== intent.sha256) throw new Error("IMPORT_UPLOAD_DIGEST_MISMATCH");
    const mimeType = cleanMimeType(args.mimeType);
    if (mimeType !== normalizeMediaType(intent.mimeType)) throw new Error("IMPORT_UPLOAD_MIME_MISMATCH");
    verifyContentSignature(mimeType, new Uint8Array(args.bytes));
    const storageId = await ctx.storage.store(new Blob([args.bytes], { type: mimeType }), { sha256: digest });
    return ctx.runMutation(internal.artifactImports.finalizeStoredOriginal, { jobId: args.jobId, storageId, uploadReceipt: intent.uploadReceipt ?? "" });
  },
});

export const getUploadIntent = query({
  args: { jobId: v.id("artifactImportJobs"), uploadReceipt: v.string(), expectedStorageId: v.optional(v.id("_storage")) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job?.artifactId || job.uploadReceipt !== args.uploadReceipt) throw new Error("IMPORT_UPLOAD_RECEIPT_INVALID");
    const { actor, artifact } = await requireArtifactCapability(ctx, job.artifactId, "modify");
    if (artifact.status !== "active") throw new Error("IMPORT_ARTIFACT_INVALID");
    if (job.ownerAccountId !== actor.accountId) throw new Error("IMPORT_UPLOAD_UPLOADER_INVALID");
    return { jobId: job._id, bytes: job.originalBytes!, sha256: job.originalSha256!, mimeType: job.originalMimeType!, status: job.status, storageId: job.originalStorageId ?? null, candidateStorageId: job.candidateStorageId ?? null, ownerAccountId: job.ownerAccountId };
  },
});

export const finalizeStoredOriginal = internalMutation({
  args: { jobId: v.id("artifactImportJobs"), storageId: v.id("_storage"), uploadReceipt: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job?.artifactId || job.status !== "uploading" || job.uploadReceipt !== args.uploadReceipt) throw new Error("IMPORT_UPLOAD_RECEIPT_INVALID");
    const actor = await getAuthenticatedActor(ctx);
    if (!actor || actor.accountId !== job.ownerAccountId) throw new Error("IMPORT_UPLOAD_UPLOADER_INVALID");
    const { artifact } = await requireArtifactCapability(ctx, job.artifactId, "modify");
    if (artifact.status !== "active") throw new Error("IMPORT_ARTIFACT_INVALID");
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata || metadata.size !== job.originalBytes || normalizeSha256(metadata.sha256) !== job.originalSha256) {
      await ctx.db.patch(job._id, { status: "quarantined", candidateStorageId: args.storageId, quarantineReason: "The server-created original did not match its receipt.", updatedAt: Date.now(), completedAt: Date.now() });
      return { jobId: job._id, status: "quarantined" as const, committed: true as const, errorCode: "IMPORT_UPLOAD_INTEGRITY_FAILED" as const };
    }
    const now = Date.now();
    await ctx.db.patch(job._id, { originalStorageId: args.storageId, originalAssetRef: `storage:${args.storageId}`, status: "uploaded", updatedAt: now });
    await recordMeterEvent(ctx, { schoolId: artifact.schoolId, accountId: job.ownerAccountId, category: "storage_bytes", quantity: job.originalBytes ?? 0, sourceType: "artifact_import_original", sourceId: String(job._id), idempotencyKey: `artifact-import:${job._id}:storage:created`, dimensions: { typeKey: job.typeKey, format: job.format }, occurredAt: now });
    return { jobId: job._id, status: "uploaded" as const, committed: true as const };
  },
});

export const quarantineUntrustedOriginal = internalMutation({
  args: { jobId: v.id("artifactImportJobs"), storageId: v.optional(v.id("_storage")), uploadReceipt: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "uploading" || job.uploadReceipt !== args.uploadReceipt) return { quarantined: false };
    await ctx.db.patch(job._id, { status: "quarantined", ...(args.storageId ? { candidateStorageId: args.storageId } : {}), quarantineReason: args.reason.slice(0, 1_000), updatedAt: Date.now(), completedAt: Date.now() });
    return { quarantined: true };
  },
});

export const commitVerifiedOriginal = internalMutation({
  args: { jobId: v.id("artifactImportJobs"), storageId: v.id("_storage"), uploadReceipt: v.string(), attestation: vIntakeAttestation },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job?.artifactId || job.uploadReceipt !== args.uploadReceipt) throw new Error("IMPORT_UPLOAD_RECEIPT_INVALID");
    const attestation = args.attestation as IntakeAttestation;
    validateIntakeAttestation(attestation, { kind: "original", targetId: String(job._id), attemptId: args.uploadReceipt }, { allowExpired: true });
    if (attestation.storageId !== String(args.storageId) || attestation.bytes !== job.originalBytes || attestation.sha256 !== job.originalSha256 || attestation.mediaType !== normalizeMediaType(job.originalMimeType ?? "")) throw new Error("INTAKE_ATTESTATION_TARGET_CHANGED");
    const actor = await getAuthenticatedActor(ctx);
    if (!actor || actor.accountId !== job.ownerAccountId) throw new Error("IMPORT_UPLOAD_UPLOADER_INVALID");
    const { artifact } = await requireArtifactCapability(ctx, job.artifactId, "modify");
    if (artifact.status !== "active") throw new Error("IMPORT_ARTIFACT_INVALID");
    const replay = await ctx.db.query("secretBridgeNonces").withIndex("by_nonce", (q) => q.eq("nonce", attestation.nonce)).unique();
    if (job.status === "uploaded" && job.originalStorageId === args.storageId)
      return { jobId: job._id, status: "uploaded" as const, committed: true as const };
    if (job.status === "uploaded" && job.originalStorageId !== args.storageId) {
      if (!replay) throw new Error("IMPORT_UPLOAD_REPLAY_UNPROVEN");
      await ctx.storage.delete(args.storageId);
      return { jobId: job._id, status: "uploaded" as const, committed: true as const, reused: true as const };
    }
    if (job.status !== "uploading") throw new Error("IMPORT_UPLOAD_NOT_ACTIVE");
    if (replay) throw new Error("IMPORT_UPLOAD_REPLAYED");
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata || metadata.size !== job.originalBytes || normalizeSha256(metadata.sha256) !== job.originalSha256 || (metadata.contentType && normalizeMediaType(metadata.contentType) !== normalizeMediaType(job.originalMimeType ?? ""))) throw new Error("IMPORT_UPLOAD_INTEGRITY_FAILED");
    await ctx.db.insert("secretBridgeNonces", { nonce: attestation.nonce, operation: "spectra-intake-original", accountId: actor.accountId, expiresAt: attestation.expiresAt, createdAt: Date.now() });
    const now = Date.now();
    await ctx.db.patch(job._id, { originalStorageId: args.storageId, originalAssetRef: `storage:${args.storageId}`, status: "uploaded", updatedAt: now });
    await recordMeterEvent(ctx, { schoolId: artifact.schoolId, accountId: job.ownerAccountId, category: "storage_bytes", quantity: job.originalBytes ?? 0, sourceType: "artifact_import_original", sourceId: String(job._id), idempotencyKey: `artifact-import:${job._id}:storage:created`, dimensions: { typeKey: job.typeKey, format: job.format }, occurredAt: now });
    return { jobId: job._id, status: "uploaded" as const, committed: true as const };
  },
});

export const finalizeUpload = mutation({
  args: {
    jobId: v.id("artifactImportJobs"),
    storageId: v.id("_storage"),
    uploadReceipt: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || !job.artifactId) {
      throw new Error("IMPORT_UPLOAD_NOT_ACTIVE");
    }
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      job.artifactId,
      "modify",
    );
    if (job.ownerAccountId !== actor.accountId)
      throw new Error(
        "AUTH_NO_ACCESS: Only the importing user can finalize this upload.",
      );
    if (!job.uploadReceipt || job.uploadReceipt !== args.uploadReceipt) throw new Error("IMPORT_UPLOAD_RECEIPT_INVALID");
    if (job.status === "uploaded" && job.originalStorageId === args.storageId)
      return { jobId: job._id, status: "uploaded" as const, committed: true as const };
    if (job.status !== "uploading") throw new Error("IMPORT_UPLOAD_NOT_ACTIVE");
    // Only an object recorded by the trusted storage path can reach this
    // compatibility finalizer. A caller's failed candidate is not cleanup authority.
    if (job.candidateStorageId !== args.storageId)
      throw new Error("IMPORT_UPLOAD_ORIGIN_INVALID");
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata || metadata.size !== job.originalBytes || normalizeSha256(metadata.sha256) !== job.originalSha256 || (metadata.contentType && job.originalMimeType && normalizeMediaType(metadata.contentType) !== normalizeMediaType(job.originalMimeType))) {
      await ctx.db.patch(job._id, { status: "quarantined", candidateStorageId: args.storageId, quarantineReason: "The original upload did not match its receipt.", updatedAt: Date.now(), completedAt: Date.now() });
      return { jobId: job._id, status: "quarantined" as const, committed: true as const, errorCode: "IMPORT_UPLOAD_INTEGRITY_FAILED" as const };
    }
    const now = Date.now();
    await ctx.db.patch(job._id, {
      originalStorageId: args.storageId,
      originalAssetRef: `storage:${args.storageId}`,
      status: "uploaded",
      updatedAt: now,
    });
    await recordMeterEvent(ctx, {
      schoolId: artifact.schoolId,
      accountId: actor.accountId,
      category: "storage_bytes",
      quantity: metadata.size,
      sourceType: "artifact_import_original",
      sourceId: String(job._id),
      idempotencyKey: `artifact-import:${job._id}:storage:created`,
      dimensions: { typeKey: job.typeKey, format: job.format },
      occurredAt: now,
    });
    return { jobId: job._id, status: "uploaded" as const, committed: true as const };
  },
});

export const complete = mutation({
  args: {
    jobId: v.id("artifactImportJobs"),
    typeKey: v.string(),
    status: v.union(
      v.literal("imported"),
      v.literal("quarantined"),
      v.literal("failed"),
    ),
    fidelityReport: v.array(
      v.object({
        scope: v.string(),
        level: fidelityLevel,
        message: v.string(),
      }),
    ),
    unsupportedFeatures: v.array(v.string()),
    quarantineReason: v.optional(v.string()),
    importedContent: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      !job.artifactId ||
      job.typeKey !== args.typeKey ||
      !["uploaded", "parsing", "preview"].includes(job.status)
    )
      throw new Error("IMPORT_JOB_NOT_COMPLETABLE");
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      job.artifactId,
      "modify",
    );
    if (job.ownerAccountId !== actor.accountId)
      throw new Error(
        "AUTH_NO_ACCESS: Only the importing user can complete this import.",
      );
    const now = Date.now();
    if (args.status === "imported" && args.importedContent === undefined)
      throw new Error("IMPORT_CONTENT_REQUIRED");
    if (args.status === "imported" && job.uploadReceipt && !job.originalStorageId)
      throw new Error("IMPORT_ORIGINAL_REQUIRED");
    let importedContent: unknown = undefined;
    if (args.status === "imported" && args.importedContent !== undefined) {
      await validateContentAdoption(ctx, artifact._id, actor.accountId, args.importedContent);
      const encoded = JSON.stringify(args.importedContent);
      if (new TextEncoder().encode(encoded).byteLength > MAX_PERSISTED_CONTENT_BYTES)
        throw new Error("IMPORT_SNAPSHOT_TOO_LARGE");
      importedContent = JSON.parse(encoded) as unknown;
      if (isHollowDefaultContent(job.typeKey, importedContent))
        throw new Error("IMPORT_CONTENT_EMPTY");
    }
    const importedContentHash = importedContent === undefined ? undefined : await contentHash(importedContent);
    const nextStatus = args.status === "imported" ? "awaiting_commit" as const : args.status;
    await ctx.db.patch(job._id, {
      status: nextStatus,
      fidelityReport: args.fidelityReport.slice(0, 200).map((item) => ({
        scope: item.scope.slice(0, 180),
        level: item.level,
        message: item.message.slice(0, 1_000),
      })),
      unsupportedFeatures: args.unsupportedFeatures
        .slice(0, 200)
        .map((item) => item.slice(0, 300)),
      quarantineReason: args.quarantineReason?.slice(0, 1_000),
      importedContent,
      importedContentHash,
      updatedAt: now,
      completedAt: nextStatus === "awaiting_commit" ? undefined : now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: artifact.schoolId,
      action: `artifact.import.${nextStatus}`,
      targetType: "artifact_import",
      targetId: String(job._id),
      metadata: {
        artifactId: String(artifact._id),
        typeKey: job.typeKey,
        format: job.format,
      },
    });
    return { jobId: job._id, status: nextStatus };
  },
});

export const abortUpload = mutation({
  args: { jobId: v.id("artifactImportJobs"), reason: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || !job.artifactId || job.status !== "uploading")
      return { aborted: false };
    const { actor } = await requireArtifactCapability(
      ctx,
      job.artifactId,
      "modify",
    );
    if (job.ownerAccountId !== actor.accountId)
      throw new Error(
        "AUTH_NO_ACCESS: Only the importing user can abort this upload.",
      );
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "failed",
      quarantineReason: args.reason.slice(0, 1_000),
      updatedAt: now,
      completedAt: now,
    });
    return { aborted: true };
  },
});

export const listForArtifact = query({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    const jobs = (
      await ctx.db
        .query("artifactImportJobs")
        .withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId))
        .order("desc")
        .take(50)
    ).filter(
      (job) =>
        job.ownerAccountId === actor.accountId ||
        artifact.ownerAccountId === actor.accountId,
    );
    return Promise.all(
      jobs.map(async (job) => ({
        jobId: job._id,
        artifactVersionId: job.artifactVersionId,
        format: job.format,
        name: job.originalName,
        bytes: job.originalBytes,
        status: job.status,
        fidelityReport: job.fidelityReport,
        unsupportedFeatures: job.unsupportedFeatures,
        quarantineReason: job.quarantineReason,
        downloadUrl: job.originalStorageId
          ? await ctx.storage.getUrl(job.originalStorageId)
          : null,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      })),
    );
  },
});

export const getForOwner = query({
  args: { jobId: v.id("artifactImportJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job?.artifactId) throw new Error("IMPORT_JOB_NOT_FOUND");
    const { actor } = await requireArtifactCapability(ctx, job.artifactId, "modify");
    if (job.ownerAccountId !== actor.accountId) throw new Error("AUTH_NO_ACCESS");
    return { jobId: job._id, artifactId: job.artifactId, status: job.status, ownerAccountId: job.ownerAccountId };
  },
});

/** Read the verified imported base through current artifact authority. */
export const nativeOriginal = query({
  args:{artifactId:v.id("spectraArtifacts")},
  handler:async(ctx,args) => {
    await requireArtifactCapability(ctx,args.artifactId,"modify");
    const jobs = await ctx.db.query("artifactImportJobs").withIndex("by_artifact",q=>q.eq("artifactId",args.artifactId)).order("desc").take(50);
    const job = jobs.find(row => row.status === "imported" && row.originalStorageId && row.artifactVersionId && /^(docx|xlsx|xlsm|xltx|xltm|xlam|pptx|pptm|potx|potm|ppsx|ppsm|ppam)$/.test(row.format));
    if (!job?.originalStorageId || !job.artifactVersionId) return null;
    const version = await ctx.db.get(job.artifactVersionId);
    if (!version || version.artifactId !== args.artifactId) return null;
    const snapshot = await loadVersionAfter(ctx,version) as {content?:unknown};
    return {url:await ctx.storage.getUrl(job.originalStorageId),hash:job.originalSha256,bytes:job.originalBytes,nativeFormat:job.format,content:snapshot.content};
  },
});
