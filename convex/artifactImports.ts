import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAuditEvent } from "./auditShared";
import { recordMeterEvent } from "./metering";
import { requireArtifactCapability } from "./spectraShared";

const MAX_ORIGINAL_BYTES = 80_000_000;
const fidelityLevel = v.union(
  v.literal("exact"),
  v.literal("adapted"),
  v.literal("unsupported"),
);

function cleanDigest(value: string) {
  const digest = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("IMPORT_DIGEST_INVALID");
  return digest;
}

function cleanBytes(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ORIGINAL_BYTES)
    throw new Error("IMPORT_SIZE_INVALID");
  return value;
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
    const sha256 = cleanDigest(args.sha256);
    const now = Date.now();
    const jobId = await ctx.db.insert("artifactImportJobs", {
      artifactId: artifact._id,
      schoolId: artifact.schoolId,
      ownerAccountId: actor.accountId,
      typeKey: args.typeKey.slice(0, 80),
      format: args.format.slice(0, 80),
      originalAssetRef: `pending:${sha256}`,
      originalName: args.name.trim().slice(0, 240) || "import-source",
      originalMimeType:
        args.mimeType.trim().slice(0, 160) || "application/octet-stream",
      originalBytes: bytes,
      originalSha256: sha256,
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
    if (!job || !job.artifactId || job.status !== "uploading")
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
    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      bytes: job.originalBytes!,
      sha256: job.originalSha256!,
      mimeType: job.originalMimeType || "application/octet-stream",
    };
  },
});

export const finalizeUpload = mutation({
  args: {
    jobId: v.id("artifactImportJobs"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || !job.artifactId || job.status !== "uploading")
      throw new Error("IMPORT_UPLOAD_NOT_ACTIVE");
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      job.artifactId,
      "modify",
    );
    if (job.ownerAccountId !== actor.accountId)
      throw new Error(
        "AUTH_NO_ACCESS: Only the importing user can finalize this upload.",
      );
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata || metadata.size !== job.originalBytes) {
      if (metadata) await ctx.storage.delete(args.storageId);
      throw new Error("IMPORT_UPLOAD_SIZE_MISMATCH");
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
    return { jobId: job._id, status: "uploaded" as const };
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
    let importedContent: unknown = undefined;
    if (args.status === "imported" && args.importedContent !== undefined) {
      const encoded = JSON.stringify(args.importedContent);
      if (encoded.length > 1_400_000)
        throw new Error("IMPORT_SNAPSHOT_TOO_LARGE");
      importedContent = JSON.parse(encoded) as unknown;
    }
    await ctx.db.patch(job._id, {
      status: args.status,
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
      updatedAt: now,
      completedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: artifact.schoolId,
      action: `artifact.import.${args.status}`,
      targetType: "artifact_import",
      targetId: String(job._id),
      metadata: {
        artifactId: String(artifact._id),
        typeKey: job.typeKey,
        format: job.format,
      },
    });
    return { jobId: job._id, status: args.status };
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
