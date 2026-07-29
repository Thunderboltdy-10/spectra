import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAuditEvent } from "./auditShared";
import { requireArtifactCapability } from "./spectraShared";
import { recordMeterEvent } from "./metering";

const runtime = v.union(
  v.literal("browser"),
  v.literal("react"),
  v.literal("python"),
);

const MAX_PAYLOAD_BYTES = 14_000_000;
const MAX_SOURCE_BYTES = 900_000;
const MAX_OUTPUT_BYTES = 2_500_000;

function boundedInteger(value: number, label: string, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label}_INVALID`);
  }
  return value;
}

function digest(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label}_INVALID`);
  return normalized;
}

function cleanDependencies(value: Record<string, string>) {
  const entries = Object.entries(value);
  if (entries.length > 32) throw new Error("RUNTIME_DEPENDENCY_LIMIT");
  return Object.fromEntries(
    entries.map(([name, version]) => {
      const cleanName = name.trim();
      const cleanVersion = version.trim();
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(cleanName)) {
        throw new Error("RUNTIME_DEPENDENCY_NAME_INVALID");
      }
      if (!cleanVersion || cleanVersion.length > 80) {
        throw new Error("RUNTIME_DEPENDENCY_VERSION_INVALID");
      }
      return [cleanName, cleanVersion];
    }),
  );
}

async function projection(
  ctx: QueryCtx | MutationCtx,
  build: Doc<"spectraRuntimeBuilds">,
) {
  const storageUrl = build.storageId
    ? await ctx.storage.getUrl(build.storageId)
    : null;
  if (!storageUrl) return null;
  return {
    buildId: build._id,
    artifactId: build.artifactId,
    artifactVersionId: build.artifactVersionId,
    runtime: build.runtime,
    runtimeVersion: build.runtimeVersion ?? "legacy-unpinned",
    status: build.status,
    sourceHash: build.sourceHash,
    payloadHash: build.payloadHash,
    sdkVersion: build.sdkVersion,
    entryFileId: build.entryFileId,
    dependencies: build.dependencies,
    sourceBytes: build.sourceBytes,
    outputBytes: build.outputBytes,
    payloadBytes: build.payloadBytes,
    publishedAt: build.publishedAt,
    storageUrl,
  };
}

export const beginUpload = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    artifactVersionId: v.id("spectraArtifactVersions"),
    expectedArtifactUpdatedAt: v.number(),
    runtime,
    runtimeVersion: v.string(),
    sourceHash: v.string(),
    sdkVersion: v.string(),
    entryFileId: v.string(),
    dependencies: v.record(v.string(), v.string()),
    assetIds: v.array(v.id("artifactAssets")),
    sourceBytes: v.number(),
    outputBytes: v.number(),
    buildDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    if (artifact.status !== "active" || artifact.blueprintKey !== "code") {
      throw new Error("RUNTIME_ARTIFACT_NOT_PUBLISHABLE");
    }
    if (artifact.updatedAt !== args.expectedArtifactUpdatedAt) {
      throw new Error(
        "RUNTIME_SOURCE_CHANGED: The artifact changed while the build was being prepared. Run it again before publishing.",
      );
    }
    if (artifact.currentVersionId !== args.artifactVersionId) {
      throw new Error("RUNTIME_VERSION_STALE");
    }
    const version = await ctx.db.get(args.artifactVersionId);
    if (!version || version.artifactId !== artifact._id) {
      throw new Error("RUNTIME_VERSION_INVALID");
    }
    const sourceHash = digest(args.sourceHash, "RUNTIME_SOURCE_HASH");
    const sourceBytes = boundedInteger(
      args.sourceBytes,
      "RUNTIME_SOURCE_BYTES",
      MAX_SOURCE_BYTES,
    );
    const outputBytes = boundedInteger(
      args.outputBytes,
      "RUNTIME_OUTPUT_BYTES",
      MAX_OUTPUT_BYTES,
    );
    const buildDurationMs =
      args.buildDurationMs === undefined
        ? undefined
        : boundedInteger(
            args.buildDurationMs,
            "RUNTIME_BUILD_DURATION",
            120_000,
          );
    const sdkVersion = args.sdkVersion.trim().slice(0, 40);
    const runtimeVersion = args.runtimeVersion.trim().slice(0, 80);
    const entryFileId = args.entryFileId.trim().slice(0, 180);
    if (!sdkVersion || !runtimeVersion || !entryFileId)
      throw new Error("RUNTIME_BUILD_METADATA_INVALID");
    const assetIds = [...new Set(args.assetIds)];
    if (assetIds.length > 100) throw new Error("RUNTIME_ASSET_LIMIT");
    const assets = await Promise.all(
      assetIds.map((assetId) => ctx.db.get(assetId)),
    );
    if (
      assets.some(
        (asset) =>
          !asset ||
          asset.artifactId !== artifact._id ||
          asset.status !== "active" ||
          !asset.storageId,
      )
    ) {
      throw new Error("RUNTIME_ASSET_UNAVAILABLE");
    }

    const current = await ctx.db
      .query("spectraRuntimeBuilds")
      .withIndex("by_artifact_status", (q) =>
        q.eq("artifactId", artifact._id).eq("status", "published"),
      )
      .order("desc")
      .first();
    if (
      current &&
      current.sourceHash === sourceHash &&
      current.runtime === args.runtime &&
      current.runtimeVersion === runtimeVersion &&
      current.sdkVersion === sdkVersion &&
      current.storageId
    ) {
      return { buildId: current._id, reused: true as const };
    }

    const pending = await ctx.db
      .query("spectraRuntimeBuilds")
      .withIndex("by_artifact_status", (q) =>
        q.eq("artifactId", artifact._id).eq("status", "uploading"),
      )
      .collect();
    const now = Date.now();
    await Promise.all(
      pending.map((candidate) =>
        ctx.db.patch(candidate._id, {
          status: "failed",
          failureReason: "Superseded by a newer publish attempt.",
          updatedAt: now,
        }),
      ),
    );
    const buildId = await ctx.db.insert("spectraRuntimeBuilds", {
      artifactId: artifact._id,
      artifactVersionId: args.artifactVersionId,
      schoolId: artifact.schoolId,
      createdByAccountId: actor.accountId,
      runtime: args.runtime,
      runtimeVersion,
      status: "uploading",
      sourceHash,
      sdkVersion,
      entryFileId,
      dependencies: cleanDependencies(args.dependencies),
      assetIds,
      sourceBytes,
      outputBytes,
      buildDurationMs,
      createdAt: now,
      updatedAt: now,
    });
    return {
      buildId,
      reused: false as const,
      uploadUrl: await ctx.storage.generateUploadUrl(),
    };
  },
});

export const finalize = mutation({
  args: {
    buildId: v.id("spectraRuntimeBuilds"),
    storageId: v.id("_storage"),
    payloadHash: v.string(),
    payloadBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const build = await ctx.db.get(args.buildId);
    if (!build || build.status !== "uploading") {
      throw new Error("RUNTIME_UPLOAD_NOT_ACTIVE");
    }
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      build.artifactId,
      "modify",
    );
    if (build.createdByAccountId !== actor.accountId) {
      throw new Error("RUNTIME_UPLOAD_OWNER_MISMATCH");
    }
    const payloadHash = digest(args.payloadHash, "RUNTIME_PAYLOAD_HASH");
    const payloadBytes = boundedInteger(
      args.payloadBytes,
      "RUNTIME_PAYLOAD_BYTES",
      MAX_PAYLOAD_BYTES,
    );
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (
      !metadata ||
      metadata.size !== payloadBytes ||
      metadata.sha256.toLowerCase() !== payloadHash
    ) {
      if (metadata) await ctx.storage.delete(args.storageId);
      await ctx.db.patch(build._id, {
        status: "failed",
        failureReason: "Uploaded build failed its integrity check.",
        updatedAt: Date.now(),
      });
      throw new Error("RUNTIME_UPLOAD_INTEGRITY_FAILED");
    }
    const now = Date.now();
    const published = await ctx.db
      .query("spectraRuntimeBuilds")
      .withIndex("by_artifact_status", (q) =>
        q.eq("artifactId", build.artifactId).eq("status", "published"),
      )
      .collect();
    await Promise.all(
      published.map((candidate) =>
        ctx.db.patch(candidate._id, {
          status: "superseded",
          supersededAt: now,
          updatedAt: now,
        }),
      ),
    );
    await ctx.db.patch(build._id, {
      status: "published",
      storageId: args.storageId,
      payloadHash,
      payloadBytes,
      publishedAt: now,
      updatedAt: now,
    });
    await recordMeterEvent(ctx, {
      schoolId: build.schoolId,
      accountId: build.createdByAccountId,
      category: "storage_bytes",
      quantity: payloadBytes,
      sourceType: "runtime_build",
      sourceId: String(build._id),
      idempotencyKey: `runtime-build:${build._id}:storage:published`,
      dimensions: { runtime: build.runtime, state: "retained" },
      occurredAt: now,
    });
    if (build.buildDurationMs && build.buildDurationMs > 0) {
      await recordMeterEvent(ctx, {
        schoolId: build.schoolId,
        accountId: build.createdByAccountId,
        category: "render_milliseconds",
        quantity: build.buildDurationMs,
        sourceType: "runtime_build",
        sourceId: String(build._id),
        idempotencyKey: `runtime-build:${build._id}:render:published`,
        dimensions: { runtime: build.runtime, phase: "publish_build" },
        occurredAt: now,
      });
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: artifact.schoolId,
      action: "artifact.runtime.published",
      targetType: "runtime_build",
      targetId: build._id,
      metadata: {
        artifactId: String(build.artifactId),
        artifactVersionId: String(build.artifactVersionId),
        runtime: build.runtime,
        sourceBytes: build.sourceBytes,
        outputBytes: build.outputBytes,
        payloadBytes,
      },
      retentionClass: "operational",
    });
    return { buildId: build._id, publishedAt: now };
  },
});

export const fail = mutation({
  args: {
    buildId: v.id("spectraRuntimeBuilds"),
    reason: v.string(),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const build = await ctx.db.get(args.buildId);
    if (!build) return { failed: false };
    const { actor } = await requireArtifactCapability(
      ctx,
      build.artifactId,
      "modify",
    );
    if (
      build.createdByAccountId !== actor.accountId ||
      build.status !== "uploading"
    ) {
      return { failed: false };
    }
    if (args.storageId) {
      const metadata = await ctx.db.system.get("_storage", args.storageId);
      if (metadata) await ctx.storage.delete(args.storageId);
    }
    await ctx.db.patch(build._id, {
      status: "failed",
      failureReason: args.reason.trim().slice(0, 500) || "Publish failed.",
      updatedAt: Date.now(),
    });
    return { failed: true };
  },
});

export const getPublished = query({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.artifactId, "read");
    const build = await ctx.db
      .query("spectraRuntimeBuilds")
      .withIndex("by_artifact_status", (q) =>
        q.eq("artifactId", args.artifactId).eq("status", "published"),
      )
      .order("desc")
      .first();
    return build ? projection(ctx, build) : null;
  },
});

export const getForVersion = query({
  args: {
    artifactId: v.id("spectraArtifacts"),
    artifactVersionId: v.id("spectraArtifactVersions"),
  },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.artifactId, "read");
    const builds = await ctx.db
      .query("spectraRuntimeBuilds")
      .withIndex("by_artifact_version", (q) =>
        q
          .eq("artifactId", args.artifactId)
          .eq("artifactVersionId", args.artifactVersionId),
      )
      .collect();
    const build = builds
      .filter(
        (candidate) =>
          (candidate.status === "published" ||
            candidate.status === "superseded") &&
          candidate.storageId,
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    return build ? projection(ctx, build) : null;
  },
});

export const unpublish = mutation({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    const published = await ctx.db
      .query("spectraRuntimeBuilds")
      .withIndex("by_artifact_status", (q) =>
        q.eq("artifactId", artifact._id).eq("status", "published"),
      )
      .collect();
    if (!published.length) return { unpublished: false };
    const now = Date.now();
    await Promise.all(
      published.map((build) =>
        ctx.db.patch(build._id, {
          status: "superseded",
          supersededAt: now,
          updatedAt: now,
        }),
      ),
    );
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: artifact.schoolId,
      action: "artifact.runtime.unpublished",
      targetType: "artifact",
      targetId: artifact._id,
      metadata: { buildCount: published.length },
      retentionClass: "operational",
    });
    return { unpublished: true };
  },
});
