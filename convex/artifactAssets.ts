import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAuditEvent } from "./auditShared";
import { recordMeterEvent } from "./metering";
import { requireArtifactCapability } from "./spectraShared";

// Technical abuse/integrity ceilings, not commercial product quotas. Metering and
// future school policies remain authoritative for any later enforceable limits.
const MAX_ASSET_BYTES = 100_000_000;
const MAX_RETAINED_ASSET_BYTES = 2_000_000_000;
const SAFE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "video/mp4",
  "video/webm",
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
  "application/font-woff",
  "application/pdf",
  "application/json",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/tab-separated-values",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);

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
  const mediaType = value.trim().toLowerCase().split(";", 1)[0] ?? "";
  if (!SAFE_MEDIA_TYPES.has(mediaType)) throw new Error("ASSET_MEDIA_UNSAFE");
  return mediaType;
}

function cleanDigest(value: string) {
  const digest = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("ASSET_DIGEST_INVALID");
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
    const retainedBytes = retained.reduce(
      (total, candidate) => total + candidate.bytes,
      0,
    );
    if (retainedBytes + bytes > MAX_RETAINED_ASSET_BYTES)
      throw new Error("ASSET_ARTIFACT_BUDGET_EXCEEDED");
    const now = Date.now();
    const assetId = await ctx.db.insert("artifactAssets", {
      artifactId: artifact._id,
      schoolId: artifact.schoolId,
      uploadedByAccountId: actor.accountId,
      path,
      name: args.name.trim().slice(0, 240) || path.split("/").at(-1) || "asset",
      mediaType,
      bytes,
      sha256,
      status: "uploading",
      createdAt: now,
      updatedAt: now,
    });
    return {
      assetId,
      reused: false as const,
      uploadUrl: await ctx.storage.generateUploadUrl(),
    };
  },
});

export const finalizeUpload = mutation({
  args: {
    assetId: v.id("artifactAssets"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.status !== "uploading")
      throw new Error("ASSET_UPLOAD_NOT_ACTIVE");
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      asset.artifactId,
      "modify",
    );
    if (asset.uploadedByAccountId !== actor.accountId)
      throw new Error("ASSET_UPLOAD_OWNER_MISMATCH");
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    let storedMediaType = "";
    try {
      storedMediaType = cleanMediaType(metadata?.contentType ?? "");
    } catch {
      storedMediaType = "";
    }
    if (
      !metadata ||
      metadata.size !== asset.bytes ||
      metadata.sha256.toLowerCase() !== asset.sha256 ||
      storedMediaType !== asset.mediaType
    ) {
      if (metadata) await ctx.storage.delete(args.storageId);
      await ctx.db.patch(asset._id, {
        status: "quarantined",
        quarantineReason:
          "The uploaded bytes did not match the declared asset.",
        updatedAt: Date.now(),
      });
      throw new Error("ASSET_UPLOAD_INTEGRITY_FAILED");
    }
    const now = Date.now();
    await ctx.db.patch(asset._id, {
      storageId: args.storageId,
      status: "active",
      activatedAt: now,
      updatedAt: now,
    });
    await recordMeterEvent(ctx, {
      schoolId: artifact.schoolId,
      accountId: actor.accountId,
      category: "storage_bytes",
      quantity: asset.bytes,
      sourceType: "artifact_asset",
      sourceId: String(asset._id),
      idempotencyKey: `artifact-asset:${asset._id}:storage:active`,
      dimensions: { mediaType: asset.mediaType },
      occurredAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: artifact.schoolId,
      action: "artifact.asset.uploaded",
      targetType: "artifact_asset",
      targetId: String(asset._id),
      metadata: {
        artifactId: String(artifact._id),
        path: asset.path,
        mediaType: asset.mediaType,
        bytes: asset.bytes,
      },
      retentionClass: "operational",
    });
    return { assetId: asset._id, status: "active" as const };
  },
});

export const failUpload = mutation({
  args: {
    assetId: v.id("artifactAssets"),
    reason: v.string(),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.status !== "uploading") return { failed: false };
    const { actor } = await requireArtifactCapability(
      ctx,
      asset.artifactId,
      "modify",
    );
    if (asset.uploadedByAccountId !== actor.accountId) return { failed: false };
    if (args.storageId) {
      const metadata = await ctx.db.system.get("_storage", args.storageId);
      if (metadata) await ctx.storage.delete(args.storageId);
    }
    await ctx.db.patch(asset._id, {
      status: "quarantined",
      quarantineReason: args.reason.trim().slice(0, 1_000) || "Upload failed.",
      updatedAt: Date.now(),
    });
    return { failed: true };
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
    if (asset.storageId) await ctx.storage.delete(asset.storageId);
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
