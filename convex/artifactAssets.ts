import { deleteStorageIfNoOtherBinding } from "./durableStorageBindings";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./functions";
import { writeAuditEvent } from "./auditShared";
import { recordMeterEvent } from "./metering";
import { requireArtifactCapability } from "./spectraShared";
import { getAuthenticatedActor, type AuthenticatedActor } from "./identityShared";
import { canReadPinnedContent } from "./retainedContentAccess";
import { isDurableContentRef } from "../shared/durable-content";
import { validateIntakeAttestation, vIntakeAttestation } from "./intakeAttestation";
import type { IntakeAttestation } from "../shared/intake-attestation";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { MAX_ASSET_BYTES } from "../shared/intake-limits";
import {
  normalizeMediaType,
  normalizeSha256,
  isSafeIntakeMediaType,
} from "../shared/intake-integrity";

// Technical abuse/integrity ceilings, not commercial product quotas. Metering and
// future school policies remain authoritative for any later enforceable limits.
const MAX_RETAINED_ASSET_BYTES = 2_000_000_000;

function snapshotContainsAsset(value: unknown, assetId: string, depth = 0): boolean {
  if (isDurableContentRef(value)) return value.spectraContentRef.dependencies?.assetIds.includes(assetId) === true;
  if (depth > 14 || value === null || value === undefined) return false;
  if (Array.isArray(value))
    return value.some((child) => snapshotContainsAsset(child, assetId, depth + 1));
  if (typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.assetId === assetId) return true;
  return Object.values(candidate).some((child) =>
    snapshotContainsAsset(child, assetId, depth + 1),
  );
}

/**
 * A pinned document owns its durable image after the source is tombstoned.
 * Reads require independent current source authority and an authorized exact
 * placement. Retention ownership is separate and is never changed here.
 */
async function canReadRetainedPinnedAsset(
  ctx: QueryCtx,
  actor: AuthenticatedActor,
  asset: Doc<"artifactAssets">,
) {
  return canReadPinnedContent(ctx, actor, asset.artifactId,
    snapshot => snapshotContainsAsset(snapshot, String(asset._id)));
}

function cleanPath(value: string) {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (
    !parts.length ||
    parts.some(
      (part) =>
        part === ".." || /[\u0000-\u001f]/.test(part) || part.length > 180,
    )
  ) {
    throw new Error("ASSET_PATH_INVALID");
  }
  const path = parts.join("/");
  if (path.length > 500) throw new Error("ASSET_PATH_INVALID");
  return path;
}

function cleanMediaType(value: string) {
  const mediaType = normalizeMediaType(value);
  if (!isSafeIntakeMediaType(mediaType)) throw new Error("ASSET_MEDIA_UNSAFE");
  return mediaType;
}

function cleanDigest(value: string) {
  const digest = normalizeSha256(value);
  if (!digest) throw new Error("ASSET_DIGEST_INVALID");
  return digest;
}

function cleanBytes(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ASSET_BYTES)
    throw new Error("ASSET_SIZE_INVALID");
  return value;
}

export const beginUpload = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    path: v.string(),
    name: v.string(),
    mediaType: v.string(),
    bytes: v.number(),
    sha256: v.string(),
    uploadReceipt: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    altText: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    if (
      artifact.status !== "active" ||
      ![
        "code",
        "document",
        "flashcard_deck",
        "presentation",
        "planner_task",
        "quiz",
        "whiteboard",
      ].includes(artifact.blueprintKey)
    )
      throw new Error("ASSET_ARTIFACT_INVALID");
    const path = cleanPath(args.path);
    const mediaType = cleanMediaType(args.mediaType);
    const bytes = cleanBytes(args.bytes);
    const sha256 = cleanDigest(args.sha256);
    const normalizedName = args.name.trim().slice(0, 240) || path.split("/").at(-1) || "asset";
    if (args.uploadReceipt) {
      const attempt = await ctx.db
        .query("artifactAssets")
        .withIndex("by_artifact_path", (q) => q.eq("artifactId", artifact._id))
        .filter((q) => q.eq(q.field("uploadReceipt"), args.uploadReceipt))
        .first();
      if (!attempt || attempt.uploadedByAccountId !== actor.accountId)
        throw new Error("ASSET_UPLOAD_ATTEMPT_INVALID");
      if (
        attempt.path !== path ||
        attempt.name !== normalizedName ||
        attempt.mediaType !== mediaType ||
        attempt.bytes !== bytes ||
        attempt.sha256 !== sha256
      ) throw new Error("ASSET_UPLOAD_ATTEMPT_MISMATCH");
      if (attempt.status !== "uploading")
        return {
          assetId: attempt._id,
          reused: true as const,
          status: attempt.status,
          storageId: attempt.storageId,
        };
      return {
        assetId: attempt._id,
        reused: false as const,
        uploadReceipt: attempt.uploadReceipt,
        uploadUrl: await ctx.storage.generateUploadUrl(),
      };
    }
    const retained = await ctx.db
      .query("artifactAssets")
      .withIndex("by_artifact_status", (q) =>
        q.eq("artifactId", artifact._id).eq("status", "active"),
      )
      .collect();
    const duplicate = retained.find(
      (candidate) =>
        candidate.sha256 === sha256 &&
        candidate.bytes === bytes &&
        candidate.mediaType === mediaType &&
        candidate.storageId,
    );
    if (duplicate) return { assetId: duplicate._id, reused: true as const };
    const pending = await ctx.db
      .query("artifactAssets")
      .withIndex("by_artifact_digest", (q) => q.eq("artifactId", artifact._id).eq("sha256", sha256))
      .filter((q) => q.and(q.eq(q.field("status"), "uploading"), q.eq(q.field("uploadedByAccountId"), actor.accountId)))
      .first();
    if (pending && pending.bytes === bytes && pending.mediaType === mediaType && pending.path === path && pending.name === normalizedName && pending.uploadReceipt) {
      return { assetId: pending._id, reused: false as const, uploadReceipt: pending.uploadReceipt, uploadUrl: await ctx.storage.generateUploadUrl() };
    }
    const retainedBytes = retained.reduce(
      (total, candidate) => total + candidate.bytes,
      0,
    );
    if (retainedBytes + bytes > MAX_RETAINED_ASSET_BYTES)
      throw new Error("ASSET_ARTIFACT_BUDGET_EXCEEDED");
    const now = Date.now();
    const uploadReceipt = crypto.randomUUID();
    const assetId = await ctx.db.insert("artifactAssets", {
      artifactId: artifact._id,
      schoolId: artifact.schoolId,
      uploadedByAccountId: actor.accountId,
      path,
      name: normalizedName,
      mediaType,
      bytes,
      sha256,
      status: "uploading",
      createdAt: now,
      updatedAt: now,
      uploadReceipt,
      ...(args.width !== undefined ? { width: args.width } : {}),
      ...(args.height !== undefined ? { height: args.height } : {}),
      ...(args.altText !== undefined ? { altText: args.altText.slice(0, 1_000) } : {}),
      ...(args.sourceRef !== undefined ? { sourceRef: args.sourceRef.slice(0, 500) } : {}),
    });
    return {
      assetId,
      reused: false as const,
      uploadReceipt,
      uploadUrl: await ctx.storage.generateUploadUrl(),
    };
  },
});

export const getUploadIntent = query({
  args: { assetId: v.id("artifactAssets"), uploadReceipt: v.string(), expectedStorageId: v.optional(v.id("_storage")) },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.uploadReceipt !== args.uploadReceipt)
      throw new Error("ASSET_UPLOAD_RECEIPT_INVALID");
    const { actor, artifact } = await requireArtifactCapability(ctx, asset.artifactId, "modify");
    if (artifact.status !== "active") throw new Error("ASSET_ARTIFACT_INVALID");
    if (asset.uploadedByAccountId !== actor.accountId) throw new Error("ASSET_UPLOAD_UPLOADER_INVALID");
    if (asset.status === "uploading" && !asset.uploadReceipt) throw new Error("ASSET_UPLOAD_RECEIPT_INVALID");
    if (args.expectedStorageId && asset.status !== "uploading" && asset.storageId !== args.expectedStorageId && asset.candidateStorageId !== args.expectedStorageId)
      return { assetId: asset._id, bytes: asset.bytes, sha256: asset.sha256, mediaType: asset.mediaType, path: asset.path, name: asset.name, status: asset.status, storageId: asset.storageId ?? null, candidateStorageId: asset.candidateStorageId ?? null, uploadedByAccountId: asset.uploadedByAccountId };
    return { assetId: asset._id, bytes: asset.bytes, sha256: asset.sha256, mediaType: asset.mediaType, path: asset.path, name: asset.name, status: asset.status, storageId: asset.storageId ?? null, candidateStorageId: asset.candidateStorageId ?? null, uploadedByAccountId: asset.uploadedByAccountId };
  },
});

export const quarantineUntrustedUpload = internalMutation({
  args: { assetId: v.id("artifactAssets"), storageId: v.optional(v.id("_storage")), uploadReceipt: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.status !== "uploading" || asset.uploadReceipt !== args.uploadReceipt) return { quarantined: false };
    await ctx.db.patch(asset._id, { status: "quarantined", ...(args.storageId ? { candidateStorageId: args.storageId } : {}), quarantineReason: args.reason.slice(0, 1_000), updatedAt: Date.now() });
    return { quarantined: true };
  },
});

export const commitVerifiedUpload = internalMutation({
  args: { assetId: v.id("artifactAssets"), storageId: v.id("_storage"), uploadReceipt: v.string(), attestation: vIntakeAttestation },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.uploadReceipt !== args.uploadReceipt) throw new Error("ASSET_UPLOAD_RECEIPT_INVALID");
    const attestation = args.attestation as IntakeAttestation;
    validateIntakeAttestation(attestation, { kind: "asset", targetId: String(asset._id), attemptId: args.uploadReceipt }, { allowExpired: true });
    if (attestation.storageId !== String(args.storageId) || attestation.bytes !== asset.bytes || attestation.sha256 !== asset.sha256 || attestation.mediaType !== asset.mediaType)
      throw new Error("INTAKE_ATTESTATION_TARGET_CHANGED");
    const actor = await getAuthenticatedActor(ctx);
    if (!actor || actor.accountId !== asset.uploadedByAccountId) throw new Error("ASSET_UPLOAD_UPLOADER_INVALID");
    const { artifact } = await requireArtifactCapability(ctx, asset.artifactId, "modify");
    if (artifact.status !== "active") throw new Error("ASSET_ARTIFACT_INVALID");
    const replay = await ctx.db.query("secretBridgeNonces").withIndex("by_nonce", (q) => q.eq("nonce", attestation.nonce)).unique();
    if (asset.status === "active" && asset.storageId === args.storageId)
      return { assetId: asset._id, status: "active" as const, committed: true as const, storageId: args.storageId };
    if (asset.status === "active" && asset.storageId !== args.storageId) {
      if (!replay) throw new Error("ASSET_UPLOAD_REPLAY_UNPROVEN");
      await ctx.storage.delete(args.storageId);
      return { assetId: asset._id, status: "active" as const, committed: true as const, reused: true as const, storageId: asset.storageId };
    }
    if (asset.status !== "uploading") throw new Error("ASSET_UPLOAD_NOT_ACTIVE");
    if (replay) throw new Error("ASSET_UPLOAD_REPLAYED");
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata || metadata.size !== asset.bytes || normalizeSha256(metadata.sha256) !== asset.sha256 || (metadata.contentType && normalizeMediaType(metadata.contentType) !== asset.mediaType))
      throw new Error("ASSET_UPLOAD_INTEGRITY_FAILED");
    await ctx.db.insert("secretBridgeNonces", { nonce: attestation.nonce, operation: "spectra-intake-asset", accountId: actor.accountId, expiresAt: attestation.expiresAt, createdAt: Date.now() });
    const now = Date.now();
    await ctx.db.patch(asset._id, { storageId: args.storageId, status: "active", activatedAt: now, updatedAt: now });
    await recordMeterEvent(ctx, { schoolId: artifact.schoolId, accountId: asset.uploadedByAccountId, category: "storage_bytes", quantity: asset.bytes, sourceType: "artifact_asset", sourceId: String(asset._id), idempotencyKey: `artifact-asset:${asset._id}:storage:active`, dimensions: { mediaType: asset.mediaType }, occurredAt: now });
    await writeAuditEvent(ctx, { actorAccountId: asset.uploadedByAccountId, schoolId: artifact.schoolId, action: "artifact.asset.uploaded", targetType: "artifact_asset", targetId: String(asset._id), metadata: { artifactId: String(artifact._id), path: asset.path, mediaType: asset.mediaType, bytes: asset.bytes }, retentionClass: "operational" });
    return { assetId: asset._id, status: "active" as const, committed: true as const, storageId: args.storageId };
  },
});

export const listForArtifact = query({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.artifactId, "read");
    const assets = await ctx.db
      .query("artifactAssets")
      .withIndex("by_artifact_path", (q) => q.eq("artifactId", args.artifactId))
      .collect();
    return Promise.all(
      assets
        .filter((asset) => asset.status !== "uploading")
        .sort((left, right) => right.createdAt - left.createdAt)
        .map(async (asset) => ({
          assetId: asset._id,
          path: asset.path,
          name: asset.name,
          mediaType: asset.mediaType,
          bytes: asset.bytes,
          sha256: asset.sha256,
          status: asset.status,
          quarantineReason: asset.quarantineReason,
          downloadUrl:
            asset.status === "active" && asset.storageId
              ? await ctx.storage.getUrl(asset.storageId)
              : null,
          createdAt: asset.createdAt,
          revokedAt: asset.revokedAt,
        })),
    );
  },
});

export const getReferenced = query({
  args: {
    artifactId: v.id("spectraArtifacts"),
    assetIds: v.array(v.id("artifactAssets")),
  },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.artifactId, "read");
    const ids = [...new Set(args.assetIds)].slice(0, 100);
    const assets = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return Promise.all(
      assets.map(async (asset, index) => {
        if (!asset || asset.artifactId !== args.artifactId)
          return { assetId: ids[index], status: "missing" as const };
        return {
          assetId: asset._id,
          path: asset.path,
          name: asset.name,
          mediaType: asset.mediaType,
          bytes: asset.bytes,
          sha256: asset.sha256,
          status: asset.status,
          downloadUrl:
            asset.status === "active" && asset.storageId
              ? await ctx.storage.getUrl(asset.storageId)
              : null,
        };
      }),
    );
  },
});

export const getContent = query({
  args: { assetId: v.id("artifactAssets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    try {
      await requireArtifactCapability(ctx, asset.artifactId, "read");
    } catch (error) {
      const actor = await getAuthenticatedActor(ctx);
      if (!actor || !(await canReadRetainedPinnedAsset(ctx, actor, asset)))
        throw error;
    }
    if (asset.status !== "active" || !asset.storageId) throw new Error("ASSET_NOT_AVAILABLE");
    return { url: await ctx.storage.getUrl(asset.storageId), mediaType: asset.mediaType, name: asset.name, bytes: asset.bytes, sha256: asset.sha256, assetId: asset._id };
  },
});

export const revoke = mutation({
  args: { assetId: v.id("artifactAssets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      asset.artifactId,
      "modify",
    );
    if (asset.status !== "active") return { revoked: false };
    const now = Date.now();
    if (asset.storageId) await deleteStorageIfNoOtherBinding(ctx, asset.storageId, {table: "artifactAssets", id: String(asset._id)});
    await ctx.db.patch(asset._id, {
      status: "revoked",
      storageId: undefined,
      revokedAt: now,
      revokedByAccountId: actor.accountId,
      updatedAt: now,
    });
    await recordMeterEvent(ctx, {
      schoolId: artifact.schoolId,
      accountId: actor.accountId,
      category: "storage_bytes",
      quantity: -asset.bytes,
      sourceType: "artifact_asset",
      sourceId: String(asset._id),
      idempotencyKey: `artifact-asset:${asset._id}:storage:revoked`,
      dimensions: { mediaType: asset.mediaType, state: "revoked" },
      occurredAt: now,
    });
    const buildGroups = await Promise.all(
      (["uploading", "published", "superseded", "failed"] as const).map(
        (status) =>
          ctx.db
            .query("spectraRuntimeBuilds")
            .withIndex("by_artifact_status", (q) =>
              q.eq("artifactId", asset.artifactId).eq("status", status),
            )
            .collect(),
      ),
    );
    const affectedBuilds = buildGroups
      .flat()
      .filter((build) => !build.assetIds || build.assetIds.includes(asset._id));
    for (const build of affectedBuilds) {
      if (build.storageId) await ctx.storage.delete(build.storageId);
      if (build.storageId && build.payloadBytes) {
        await recordMeterEvent(ctx, {
          schoolId: build.schoolId,
          accountId: build.createdByAccountId,
          category: "storage_bytes",
          quantity: -build.payloadBytes,
          sourceType: "runtime_build",
          sourceId: String(build._id),
          idempotencyKey: `runtime-build:${build._id}:storage:asset-revoked:${asset._id}`,
          dimensions: { runtime: build.runtime, state: "asset_revoked" },
          occurredAt: now,
        });
      }
      await ctx.db.patch(build._id, {
        status: build.status === "uploading" ? "failed" : "superseded",
        storageId: undefined,
        supersededAt: build.status === "uploading" ? undefined : now,
        updatedAt: now,
        failureReason:
          "Retained package removed because an immutable runtime asset was revoked.",
      });
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: artifact.schoolId,
      action: "artifact.asset.revoked",
      targetType: "artifact_asset",
      targetId: String(asset._id),
      metadata: {
        artifactId: String(artifact._id),
        path: asset.path,
        removedBuildCount: affectedBuilds.length,
        bytesPurged: asset.bytes,
      },
      retentionClass: "operational",
    });
    return { revoked: true };
  },
});
