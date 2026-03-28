import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { LIMITS } from "./constants";
import { getUserByClerkId } from "./helpers";
import { vScope } from "./shared";
import { internal } from "./_generated/api";
import {
  BLOCKED_RESOURCE_EXTENSIONS,
  DEFAULT_MAX_RESOURCE_FILE_SIZE_BYTES,
  MAX_RESOURCE_FILE_SIZE_BYTES,
  MIN_RESOURCE_FILE_SIZE_BYTES,
  SUPPORTED_MIME_BY_EXTENSION,
  SUPPORTED_RESOURCE_EXTENSIONS,
  VIDEO_RESOURCE_EXTENSIONS,
  fileExtension,
} from "../shared/resource-upload-policy";
import {
  canReuseResourceUpload,
  MAX_RESOURCE_PROCESSING_ATTEMPTS,
  RESOURCE_QUEUE_STALE_MS,
  RESOURCE_PROCESSING_STALE_MS,
} from "../shared/resource-processing";

const CONVERSATION_RESOURCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_AGENT_RESOURCES_TEACHER = 20;
const MAX_AGENT_RESOURCES_STUDENT = 5;

function resolveMaxResourceFileSizeBytes(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESOURCE_FILE_SIZE_BYTES;
  }
  return Math.min(
    MAX_RESOURCE_FILE_SIZE_BYTES,
    Math.max(MIN_RESOURCE_FILE_SIZE_BYTES, Math.round(value)),
  );
}

function maxFileSizeError(maxBytes: number) {
  const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  return `File exceeds maximum size (${mb}MB)`;
}

function invalidResourceTypeError(filename: string, mimeType: string) {
  const ext = fileExtension(filename);
  const normalizedMime = mimeType.trim().toLowerCase();

  if (BLOCKED_RESOURCE_EXTENSIONS.has(ext)) {
    return `Blocked file type: .${ext}. Upload documents, code, images, or audio only.`;
  }

  if (VIDEO_RESOURCE_EXTENSIONS.has(ext) || normalizedMime.startsWith("video/")) {
    return "Video uploads are not supported. Upload documents, code, images, or audio instead.";
  }

  if (!SUPPORTED_RESOURCE_EXTENSIONS.has(ext)) {
    return `Unsupported file type: .${ext || "unknown"}. Allowed: documents, code, images, and audio only.`;
  }

  if (!normalizedMime || normalizedMime === "application/octet-stream") {
    return undefined;
  }

  const allowed = SUPPORTED_MIME_BY_EXTENSION[ext] ?? [];
  if (!allowed.includes(normalizedMime)) {
    return `MIME type ${mimeType} is not valid for .${ext}`;
  }

  return undefined;
}

function isAgentCollaborator(agent: { collaborators?: string[] }, userId: string) {
  return (agent.collaborators ?? []).includes(userId);
}

function canAccessAgentResources(
  agent: { visibility: "public" | "private" | "shared"; creatorUserId: string; collaborators?: string[] },
  actor: { _id: string; role: "student" | "teacher" | "admin" },
) {
  return (
    actor.role === "admin" ||
    agent.visibility === "public" ||
    agent.creatorUserId === actor._id ||
    isAgentCollaborator(agent, actor._id)
  );
}

function canManageAgentResources(
  agent: { creatorUserId: string; collaborators?: string[] },
  actor: { _id: string; role: "student" | "teacher" | "admin" },
) {
  return actor.role === "admin" || agent.creatorUserId === actor._id || isAgentCollaborator(agent, actor._id);
}

async function resolveAgentResourceLimit(
  ctx: Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">,
  agent: { creatorUserId: Id<"users"> },
) {
  const creator = await ctx.db.get(agent.creatorUserId);
  if (!creator) {
    return MAX_AGENT_RESOURCES_TEACHER;
  }
  return creator.role === "student" ? MAX_AGENT_RESOURCES_STUDENT : MAX_AGENT_RESOURCES_TEACHER;
}

function canAccessPackResources(
  pack: { orgId: string },
  actor: { orgId: string },
) {
  return pack.orgId === actor.orgId;
}

export const createUploadUrl = mutation({
  args: {
    actorClerkId: v.string(),
    scope: vScope,
    packId: v.optional(v.id("packs")),
    agentId: v.optional(v.id("agents")),
    ignorePersonalLimit: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    if (args.scope === "pack") {
      if (!args.packId) {
        throw new Error("packId is required for pack uploads");
      }
      const pack = await ctx.db.get(args.packId);
      if (!pack || pack.orgId !== actor.orgId) {
        throw new Error("Pack not found");
      }

      const canUploadToPack = actor.role === "admin" || pack.ownerUserId === actor._id;
      if (!canUploadToPack) {
        throw new Error("Only pack owner/admin can upload pack resources");
      }

      const count = await ctx.db
        .query("resources")
        .withIndex("by_pack", (q) => q.eq("packId", args.packId))
        .collect();
      if (count.length >= LIMITS.maxTeacherFilesPerPack) {
        throw new Error(`Pack file limit reached (${LIMITS.maxTeacherFilesPerPack})`);
      }
    }

    if (args.scope === "agent") {
      if (!args.agentId) {
        throw new Error("agentId is required for agent uploads");
      }
      const agent = await ctx.db.get(args.agentId);
      if (!agent || agent.orgId !== actor.orgId) {
        throw new Error("Agent not found");
      }

      const canUploadToAgent = canManageAgentResources(agent, actor);
      if (!canUploadToAgent) {
        throw new Error("Only agent creator/admin can upload agent resources");
      }

      const count = await ctx.db
        .query("resources")
        .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
        .collect();
      const agentLimit = await resolveAgentResourceLimit(ctx, agent);
      if (count.length >= agentLimit) {
        throw new Error(`Agent file limit reached (${agentLimit})`);
      }
    }

    if (args.scope === "personal") {
      const mine = await ctx.db
        .query("resources")
        .withIndex("by_owner_scope", (q) => q.eq("ownerUserId", actor._id).eq("scope", "personal"))
        .collect();
      const personalLibraryCount = mine.filter((resource) => resource.saveToLibrary !== false).length;
      if (!args.ignorePersonalLimit && personalLibraryCount >= LIMITS.maxStudentPersonalFiles) {
        throw new Error(`Personal file limit reached (${LIMITS.maxStudentPersonalFiles})`);
      }
    }

    return ctx.storage.generateUploadUrl();
  },
});

export const registerResource = mutation({
  args: {
    actorClerkId: v.string(),
    scope: vScope,
    packId: v.optional(v.id("packs")),
    agentId: v.optional(v.id("agents")),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    contentHash: v.optional(v.string()),
    storageId: v.id("_storage"),
    saveToLibrary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const org = await ctx.db.get(actor.orgId);
    if (!org) {
      throw new Error("Org not found");
    }

    const maxResourceFileSizeBytes = resolveMaxResourceFileSizeBytes(org.maxResourceFileSizeBytes);
    if (!Number.isFinite(args.size) || args.size <= 0) {
      throw new Error("File size must be greater than zero");
    }
    if (args.size > maxResourceFileSizeBytes) {
      throw new Error(maxFileSizeError(maxResourceFileSizeBytes));
    }

    const typeError = invalidResourceTypeError(args.filename, args.mimeType);
    if (typeError) {
      throw new Error(typeError);
    }

    if (args.scope === "pack" && !args.packId) {
      throw new Error("packId required for pack resources");
    }

    if (args.scope === "agent" && !args.agentId) {
      throw new Error("agentId required for agent resources");
    }

    if (args.scope === "pack" && args.packId) {
      const pack = await ctx.db.get(args.packId);
      if (!pack || pack.orgId !== actor.orgId) {
        throw new Error("Pack not found");
      }
      const canUploadToPack = actor.role === "admin" || pack.ownerUserId === actor._id;
      if (!canUploadToPack) {
        throw new Error("Only pack owner/admin can upload pack resources");
      }
    }

    if (args.scope === "agent" && args.agentId) {
      const agent = await ctx.db.get(args.agentId);
      if (!agent || agent.orgId !== actor.orgId) {
        throw new Error("Agent not found");
      }
      const canUploadToAgent = canManageAgentResources(agent, actor);
      if (!canUploadToAgent) {
        throw new Error("Only agent creator/admin can upload agent resources");
      }
      const count = await ctx.db
        .query("resources")
        .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
        .collect();
      const agentLimit = await resolveAgentResourceLimit(ctx, agent);
      if (count.length >= agentLimit) {
        throw new Error(`Agent file limit reached (${agentLimit})`);
      }
    }

    const now = Date.now();
    const saveToLibrary = args.saveToLibrary ?? true;
    const expiresAt =
      args.scope === "personal" && !saveToLibrary
        ? now + CONVERSATION_RESOURCE_TTL_MS
        : undefined;
    const resourceId = await ctx.db.insert("resources", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      packId: args.packId,
      agentId: args.agentId,
      scope: args.scope,
      filename: args.filename,
      mimeType: args.mimeType,
      size: args.size,
      contentHash: args.contentHash,
      storageId: args.storageId,
      parsedCharCount: 0,
      status: "uploaded",
      processingAttempts: 0,
      saveToLibrary,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    if (args.scope === "agent" && args.agentId) {
      const count = await ctx.db
        .query("resources")
        .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
        .collect();
      await ctx.db.patch(args.agentId, {
        resourceCount: count.length,
        updatedAt: now,
      });
    }

    return { resourceId, ownerUserId: actor._id, orgId: actor.orgId };
  },
});

export const completeResourceIngestion = mutation({
  args: {
    actorClerkId: v.string(),
    resourceId: v.id("resources"),
    parsedCharCount: v.number(),
    chunks: v.array(
      v.object({
        text: v.string(),
        embedding: v.array(v.float64()),
        page: v.optional(v.number()),
      }),
    ),
    failedReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const resource = await ctx.db.get(args.resourceId);
    if (!resource || resource.orgId !== actor.orgId) {
      throw new Error("Resource not found");
    }

    if (resource.scope === "pack") {
      const pack = resource.packId ? await ctx.db.get(resource.packId) : null;
      const canModify = actor.role === "admin" || (pack && pack.ownerUserId === actor._id);
      if (!canModify) {
        throw new Error("No permission for this pack resource");
      }
    } else if (resource.scope === "agent") {
      const agent = resource.agentId ? await ctx.db.get(resource.agentId) : null;
      const canModify = agent ? canManageAgentResources(agent, actor) : false;
      if (!canModify) {
        throw new Error("No permission for this agent resource");
      }
    } else if (resource.ownerUserId !== actor._id) {
      throw new Error("No permission for personal resource");
    }

    await ctx.db
      .query("chunks")
      .withIndex("by_resource", (q) => q.eq("resourceId", args.resourceId))
      .collect()
      .then(async (rows) => {
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
      });

    if (args.failedReason) {
      await ctx.db.patch(args.resourceId, {
        parsedCharCount: 0,
        status: "failed",
        error: args.failedReason,
        updatedAt: Date.now(),
      });
      return { ok: false };
    }

    const capped = args.chunks.slice(0, LIMITS.maxChunksPerFile);
    const now = Date.now();
    for (const chunk of capped) {
      await ctx.db.insert("chunks", {
        orgId: resource.orgId,
        packId: resource.packId,
        agentId: resource.agentId,
        ownerUserId: resource.scope === "personal" ? resource.ownerUserId : undefined,
        scope: resource.scope,
        resourceId: resource._id,
        filename: resource.filename,
        page: chunk.page,
        text: chunk.text,
        embedding: chunk.embedding,
        createdAt: now,
      });
    }

    await ctx.db.patch(args.resourceId, {
      parsedCharCount: args.parsedCharCount,
      status: "processed",
      error: undefined,
      updatedAt: now,
    });

    return { ok: true, chunkCount: capped.length };
  },
});

export const finalizeGeneratedResource = mutation({
  args: {
    actorClerkId: v.string(),
    resourceId: v.id("resources"),
    parsedCharCount: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const resource = await ctx.db.get(args.resourceId);
    if (!resource || resource.orgId !== actor.orgId) {
      throw new Error("Resource not found");
    }

    if (resource.ownerUserId !== actor._id && actor.role !== "admin") {
      throw new Error("Unauthorized");
    }

    await ctx.db.patch(args.resourceId, {
      status: "processed",
      error: undefined,
      parsedCharCount: Math.max(0, Math.round(args.parsedCharCount)),
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const completeResourceIngestionInternal = internalMutation({
  args: {
    resourceId: v.id("resources"),
    parsedCharCount: v.number(),
    chunks: v.array(
      v.object({
        text: v.string(),
        embedding: v.array(v.float64()),
        page: v.optional(v.number()),
      }),
    ),
    failedReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) {
      throw new Error("Resource not found");
    }

    await ctx.db
      .query("chunks")
      .withIndex("by_resource", (q) => q.eq("resourceId", args.resourceId))
      .collect()
      .then(async (rows) => {
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
      });

    if (args.failedReason) {
      await ctx.db.patch(args.resourceId, {
        parsedCharCount: 0,
        status: "failed",
        error: args.failedReason,
        updatedAt: Date.now(),
      });
      return { ok: false };
    }

    const capped = args.chunks.slice(0, LIMITS.maxChunksPerFile);
    const now = Date.now();
    for (const chunk of capped) {
      await ctx.db.insert("chunks", {
        orgId: resource.orgId,
        packId: resource.packId,
        agentId: resource.agentId,
        ownerUserId: resource.scope === "personal" ? resource.ownerUserId : undefined,
        scope: resource.scope,
        resourceId: resource._id,
        filename: resource.filename,
        page: chunk.page,
        text: chunk.text,
        embedding: chunk.embedding,
        createdAt: now,
      });
    }

    await ctx.db.patch(args.resourceId, {
      parsedCharCount: args.parsedCharCount,
      status: "processed",
      error: undefined,
      updatedAt: now,
    });

    return { ok: true, chunkCount: capped.length };
  },
});

export const touchResourceForProcessingInternal = internalMutation({
  args: {
    resourceId: v.id("resources"),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    if (!resource || resource.status === "processed") {
      return { ok: false };
    }

    await ctx.db.patch(args.resourceId, {
      status: "processing",
      error: undefined,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const markResourceProcessingHeartbeatInternal = internalMutation({
  args: {
    resourceId: v.id("resources"),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    if (!resource || resource.status !== "processing") {
      return { ok: false };
    }

    await ctx.db.patch(args.resourceId, {
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const deferResourceForMissingApiKeyInternal = internalMutation({
  args: {
    resourceId: v.id("resources"),
    nextAttemptAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) {
      return { ok: false };
    }

    const currentAttempts = resource.processingAttempts ?? 0;
    const nextAttempts = Math.max(0, currentAttempts - 1);
    const now = Date.now();
    const baseUpdatedAt = typeof args.nextAttemptAt === "number" && Number.isFinite(args.nextAttemptAt)
      ? args.nextAttemptAt
      : now;

    await ctx.db.patch(args.resourceId, {
      status: "uploaded",
      processingAttempts: nextAttempts,
      error: "OPENROUTER_API_KEY is missing. Processing is queued and will retry automatically.",
      updatedAt: baseUpdatedAt,
    });

    return { ok: true };
  },
});

export const enqueueResourceProcessing = mutation({
  args: {
    actorClerkId: v.string(),
    resourceId: v.id("resources"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const resource = await ctx.db.get(args.resourceId);
    if (!resource || resource.orgId !== actor.orgId) {
      throw new Error("Resource not found");
    }

    let allowed = false;
    if (resource.scope === "personal" && resource.ownerUserId === actor._id) allowed = true;
    if (resource.scope === "pack" && resource.packId) {
      const pack = await ctx.db.get(resource.packId);
      if (pack && (pack.ownerUserId === actor._id || actor.role === "teacher" || actor.role === "admin")) {
        allowed = true;
      }
    }
    if (resource.scope === "agent" && resource.agentId) {
      const agent = await ctx.db.get(resource.agentId);
      if (agent && (canManageAgentResources(agent, actor) || actor.role === "teacher")) {
        allowed = true;
      }
    }
    if (!allowed) {
      throw new Error("No permission to process resource");
    }

    if (resource.status === "processed") {
      return { ok: true, skipped: true };
    }

    const now = Date.now();
    const attempts = resource.processingAttempts ?? 0;
    const stalled = resource.status === "processing" && now - resource.updatedAt > RESOURCE_PROCESSING_STALE_MS;
    if (resource.status === "processing" && !stalled) {
      return { ok: true, skipped: true, reason: "already_processing" as const };
    }
    const nextAttempts = attempts + 1;
    if (nextAttempts > MAX_RESOURCE_PROCESSING_ATTEMPTS) {
      await ctx.db.patch(resource._id, {
        status: "failed",
        error: "Processing failed repeatedly. Remove the file and upload it again.",
        updatedAt: now,
      });
      return { ok: false, stalled, reason: "max_attempts_exhausted" as const };
    }

    await ctx.db.patch(resource._id, {
      status: "processing",
      error: undefined,
      processingAttempts: nextAttempts,
      updatedAt: now,
    });

    try {
      await ctx.scheduler.runAfter(0, internal.ingestQueue.processResource, {
        resourceId: resource._id,
      });
      return { ok: true };
    } catch (error) {
      await ctx.db.patch(resource._id, {
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 400) : "Unable to schedule file processing.",
        updatedAt: Date.now(),
      });
      return { ok: false, scheduled: false };
    }
  },
});

export const retryStaleResourcesInternal = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.max(1, Math.min(Math.round(args.limit ?? 24), 100));
    const maxUploadedUpdatedAt = now - RESOURCE_QUEUE_STALE_MS;
    const maxProcessingUpdatedAt = now - RESOURCE_PROCESSING_STALE_MS;

    const staleUploaded = await ctx.db
      .query("resources")
      .withIndex("by_status_updated", (q) => q.eq("status", "uploaded").lt("updatedAt", maxUploadedUpdatedAt))
      .take(limit);

    const remaining = Math.max(0, limit - staleUploaded.length);
    const staleProcessing =
      remaining > 0
        ? await ctx.db
            .query("resources")
            .withIndex("by_status_updated", (q) => q.eq("status", "processing").lt("updatedAt", maxProcessingUpdatedAt))
            .take(remaining)
        : [];

    const candidates = [...staleUploaded, ...staleProcessing];
    let requeued = 0;
    let exhausted = 0;
    let failed = 0;
    const pendingScheduleResources: typeof candidates = [];

    for (const resource of candidates) {
      if (resource.status !== "uploaded" && resource.status !== "processing") {
        continue;
      }

      const attempts = resource.processingAttempts ?? 0;
      const nextAttempts = attempts + 1;
      if (nextAttempts > MAX_RESOURCE_PROCESSING_ATTEMPTS) {
        await ctx.db.patch(resource._id, {
          status: "failed",
          error: "Processing failed repeatedly. Remove the file and upload it again.",
          updatedAt: now,
        });
        exhausted += 1;
        continue;
      }

      if (!resource.storageId) {
        await ctx.db.patch(resource._id, {
          status: "failed",
          error: "Resource file unavailable in storage.",
          updatedAt: now,
        });
        failed += 1;
        continue;
      }

      await ctx.db.patch(resource._id, {
        status: "processing",
        error: undefined,
        processingAttempts: nextAttempts,
        updatedAt: now,
      });
      pendingScheduleResources.push(resource);
    }

    const scheduleResults = await Promise.allSettled(
      pendingScheduleResources.map((resource) =>
        ctx.scheduler.runAfter(0, internal.ingestQueue.processResource, {
          resourceId: resource._id,
        })
      ),
    );

    for (let index = 0; index < scheduleResults.length; index += 1) {
      const scheduleResult = scheduleResults[index];
      const resource = pendingScheduleResources[index];
      if (!resource) continue;
      if (scheduleResult?.status === "fulfilled") {
        requeued += 1;
        continue;
      }

      await ctx.db.patch(resource._id, {
        status: "failed",
        error:
          scheduleResult?.reason instanceof Error
            ? scheduleResult.reason.message.slice(0, 400)
            : "Unable to schedule file processing.",
        updatedAt: Date.now(),
      });
      failed += 1;
    }

    return {
      ok: true,
      scanned: candidates.length,
      requeued,
      exhausted,
      failed,
    };
  },
});

export const togglePin = mutation({
  args: {
    actorClerkId: v.string(),
    resourceId: v.id("resources"),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const resource = await ctx.db.get(args.resourceId);
    if (!resource || resource.orgId !== actor.orgId) {
      throw new Error("Resource not found");
    }
    if (resource.scope !== "personal" || resource.ownerUserId !== actor._id) {
      throw new Error("Only personal resources can be pinned");
    }

    await ctx.db.patch(resource._id, {
      pinned: args.pinned,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const listPersonalResources = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const rows = await ctx.db
      .query("resources")
      .withIndex("by_owner_scope", (q) => q.eq("ownerUserId", actor._id).eq("scope", "personal"))
      .collect();
    return rows
      .filter((row) => row.saveToLibrary !== false)
      .map((row) => ({
        _id: row._id,
        filename: row.filename,
        mimeType: row.mimeType,
        size: row.size,
        status: row.status,
        error: row.error,
        processingAttempts: row.processingAttempts,
        pinned: row.pinned,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
  },
});

export const listAgentResources = query({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) {
      throw new Error("Agent not found");
    }
    if (!canAccessAgentResources(agent, actor)) {
      throw new Error("Not authorized for this agent");
    }

    return ctx.db
      .query("resources")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
  },
});

export const listPersonalTextsByIds = query({
  args: {
    actorClerkId: v.string(),
    resourceIds: v.array(v.id("resources")),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const uniqueIds = Array.from(new Set(args.resourceIds));
    const rows: Array<{
      resourceId: string;
      filename: string;
      status: "uploaded" | "processing" | "processed" | "failed";
      text: string;
    }> = [];

    for (const resourceId of uniqueIds) {
      const resource = await ctx.db.get(resourceId);
      if (!resource || resource.orgId !== actor.orgId) {
        continue;
      }
      if (resource.scope !== "personal") {
        continue;
      }
      if (resource.ownerUserId !== actor._id && actor.role !== "admin") {
        continue;
      }

      const chunks = await ctx.db
        .query("chunks")
        .withIndex("by_resource", (q) => q.eq("resourceId", resource._id))
        .collect();
      const text = chunks
        .map((chunk) => chunk.text)
        .join("\n")
        .slice(0, 16_000);
      rows.push({
        resourceId: resource._id,
        filename: resource.filename,
        status: resource.status,
        text,
      });
    }

    return rows;
  },
});

export const assignResourcesToAgent = mutation({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
    resourceIds: v.array(v.id("resources")),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) {
      throw new Error("Agent not found");
    }
    if (!canManageAgentResources(agent, actor)) {
      throw new Error("Only agent creator/admin can assign resources");
    }

    const requestedIds = Array.from(new Set(args.resourceIds));
    if (requestedIds.length === 0) {
      return { assigned: 0, skipped: 0, limit: await resolveAgentResourceLimit(ctx, agent) };
    }

    const existingAgentResources = await ctx.db
      .query("resources")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    const agentLimit = await resolveAgentResourceLimit(ctx, agent);
    const capacity = Math.max(0, agentLimit - existingAgentResources.length);
    if (capacity <= 0) {
      throw new Error(`Agent file limit reached (${agentLimit})`);
    }

    let assigned = 0;
    let skipped = 0;
    const now = Date.now();
    for (const resourceId of requestedIds.slice(0, capacity)) {
      const resource = await ctx.db.get(resourceId);
      if (!resource || resource.orgId !== actor.orgId) {
        skipped += 1;
        continue;
      }
      if (resource.scope === "agent" && resource.agentId === args.agentId) {
        skipped += 1;
        continue;
      }
      if (resource.scope !== "personal") {
        skipped += 1;
        continue;
      }
      if (resource.ownerUserId !== actor._id && actor.role !== "admin") {
        skipped += 1;
        continue;
      }

      await ctx.db.patch(resource._id, {
        scope: "agent",
        agentId: args.agentId,
        packId: undefined,
        saveToLibrary: true,
        expiresAt: undefined,
        updatedAt: now,
      });

      const chunks = await ctx.db
        .query("chunks")
        .withIndex("by_resource", (q) => q.eq("resourceId", resource._id))
        .collect();
      for (const chunk of chunks) {
        await ctx.db.patch(chunk._id, {
          scope: "agent",
          agentId: args.agentId,
          packId: undefined,
          ownerUserId: undefined,
        });
      }

      assigned += 1;
    }

    const updatedCount = await ctx.db
      .query("resources")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    await ctx.db.patch(args.agentId, {
      resourceCount: updatedCount.length,
      updatedAt: now,
    });

    if (requestedIds.length > capacity) {
      skipped += requestedIds.length - capacity;
    }

    return { assigned, skipped, limit: agentLimit };
  },
});

export const listPackResources = query({
  args: {
    actorClerkId: v.string(),
    packId: v.id("packs"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const pack = await ctx.db.get(args.packId);
    if (!pack || pack.orgId !== actor.orgId) {
      throw new Error("Pack not found");
    }
    if (!canAccessPackResources(pack, actor)) {
      throw new Error("Not authorized for this pack");
    }

    return ctx.db
      .query("resources")
      .withIndex("by_pack", (q) => q.eq("packId", args.packId))
      .collect();
  },
});

export const deleteResource = mutation({
  args: {
    actorClerkId: v.string(),
    resourceId: v.id("resources"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const resource = await ctx.db.get(args.resourceId);
    if (!resource || resource.orgId !== actor.orgId) {
      throw new Error("Resource not found");
    }

    let allowed = false;
    if (resource.scope === "personal" && resource.ownerUserId === actor._id) {
      allowed = true;
    }
    if (resource.scope === "pack" && resource.packId) {
      const pack = await ctx.db.get(resource.packId);
      if (pack && canAccessPackResources(pack, actor)) {
        allowed = true;
      }
    }
    if (resource.scope === "agent" && resource.agentId) {
      const agent = await ctx.db.get(resource.agentId);
      if (agent && canManageAgentResources(agent, actor)) {
        allowed = true;
      }
    }

    if (!allowed) {
      throw new Error("No permission to delete resource");
    }

    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_resource", (q) => q.eq("resourceId", args.resourceId))
      .collect();
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }

    if (resource.storageId) {
      await ctx.storage.delete(resource.storageId);
    }
    await ctx.db.delete(resource._id);

    if (resource.scope === "agent" && resource.agentId) {
      const remaining = await ctx.db
        .query("resources")
        .withIndex("by_agent", (q) => q.eq("agentId", resource.agentId!))
        .collect();
      await ctx.db.patch(resource.agentId, {
        resourceCount: remaining.length,
        updatedAt: Date.now(),
      });
    }

    return { ok: true };
  },
});

export const getResourceDownloadUrl = query({
  args: {
    actorClerkId: v.string(),
    resourceId: v.id("resources"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const resource = await ctx.db.get(args.resourceId);
    if (!resource || resource.orgId !== actor.orgId) {
      throw new Error("Resource not found");
    }

    let allowed = false;
    if (resource.scope === "personal" && resource.ownerUserId === actor._id) {
      allowed = true;
    }
    if (resource.scope === "pack" && resource.packId) {
      const pack = await ctx.db.get(resource.packId);
      if (pack && canAccessPackResources(pack, actor)) {
        allowed = true;
      }
    }
    if (resource.scope === "agent" && resource.agentId) {
      const agent = await ctx.db.get(resource.agentId);
      if (agent && canAccessAgentResources(agent, actor)) {
        allowed = true;
      }
    }

    if (!allowed) {
      throw new Error("No permission to access resource");
    }

    if (!resource.storageId) {
      throw new Error("Resource file unavailable");
    }

    const url = await ctx.storage.getUrl(resource.storageId);
    if (!url) {
      throw new Error("Download URL unavailable");
    }

    return {
      url,
      filename: resource.filename,
    };
  },
});

export const getResourcesByIds = query({
  args: {
    actorClerkId: v.string(),
    resourceIds: v.array(v.id("resources")),
    maxQuickExtractChars: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const maxChars = Math.max(400, Math.min(args.maxQuickExtractChars ?? 4000, 8000));
    const results: Array<{
      _id: string;
      filename: string;
      mimeType: string;
      size: number;
      scope: "pack" | "personal" | "agent";
      status: "uploaded" | "processing" | "processed" | "failed";
      storageId?: string;
      quickExtractText?: string;
      createdAt: number;
      pinned?: boolean;
      processingAttempts?: number;
      error?: string;
    }> = [];

    for (const resourceId of args.resourceIds) {
      const resource = await ctx.db.get(resourceId);
      if (!resource || resource.orgId !== actor.orgId) continue;

      let allowed = false;
      if (resource.scope === "personal" && resource.ownerUserId === actor._id) {
        allowed = true;
      }
      if (resource.scope === "pack" && resource.packId) {
        const pack = await ctx.db.get(resource.packId);
        if (pack && canAccessPackResources(pack, actor)) {
          allowed = true;
        }
      }
      if (resource.scope === "agent" && resource.agentId) {
        const agent = await ctx.db.get(resource.agentId);
        if (
          agent &&
          (canAccessAgentResources(agent, actor) || actor.role === "teacher")
        ) {
          allowed = true;
        }
      }
      if (!allowed) continue;

      let quickExtractText: string | undefined;
      if (resource.status === "processed") {
        const chunks = await ctx.db
          .query("chunks")
          .withIndex("by_resource", (q) => q.eq("resourceId", resource._id))
          .collect();
        const preview = chunks
          .sort((a, b) => (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER))
          .map((chunk) => chunk.text)
          .join("\n")
          .slice(0, maxChars)
          .trim();
        if (preview) quickExtractText = preview;
      }

      results.push({
        _id: resource._id,
        filename: resource.filename,
        mimeType: resource.mimeType,
        size: resource.size,
        scope: resource.scope,
        status: resource.status,
        storageId: resource.storageId,
        quickExtractText,
        createdAt: resource.createdAt,
        pinned: resource.pinned,
        processingAttempts: resource.processingAttempts,
        error: resource.error,
      });
    }

    return results;
  },
});

export const getResourceNamesByIds = query({
  args: {
    actorClerkId: v.string(),
    resourceIds: v.array(v.id("resources")),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const rows: Array<{
      _id: string;
      filename: string;
      status: "uploaded" | "processing" | "processed" | "failed";
    }> = [];

    for (const resourceId of args.resourceIds) {
      const resource = await ctx.db.get(resourceId);
      if (!resource || resource.orgId !== actor.orgId) continue;

      let allowed = false;
      if (resource.scope === "personal" && resource.ownerUserId === actor._id) allowed = true;
      if (resource.scope === "pack" && resource.packId) {
        const pack = await ctx.db.get(resource.packId);
        if (pack && canAccessPackResources(pack, actor)) allowed = true;
      }
      if (resource.scope === "agent" && resource.agentId) {
        const agent = await ctx.db.get(resource.agentId);
        if (
          agent &&
          (canAccessAgentResources(agent, actor) || actor.role === "teacher")
        ) {
          allowed = true;
        }
      }
      if (!allowed) continue;

      rows.push({
        _id: resource._id,
        filename: resource.filename,
        status: resource.status,
      });
    }

    return rows;
  },
});

export const findReusablePersonalResourcesByHashes = query({
  args: {
    actorClerkId: v.string(),
    hashes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const hashSet = new Set(args.hashes.filter((hash) => hash.trim().length > 0));
    if (hashSet.size === 0) return [];

    const personal = await ctx.db
      .query("resources")
      .withIndex("by_owner_scope", (q) => q.eq("ownerUserId", actor._id).eq("scope", "personal"))
      .collect();

    return personal
      .filter((resource) => resource.saveToLibrary !== false)
      .filter((resource) => resource.contentHash && hashSet.has(resource.contentHash))
      .filter((resource) =>
        canReuseResourceUpload({
          status: resource.status,
          updatedAt: resource.updatedAt,
        }),
      )
      .map((resource) => ({
        resourceId: resource._id,
        contentHash: resource.contentHash as string,
        filename: resource.filename,
        status: resource.status,
      }));
  },
});

export const listPackTexts = query({
  args: {
    actorClerkId: v.string(),
    packId: v.id("packs"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || (actor.role !== "teacher" && actor.role !== "admin")) {
      throw new Error("Only teacher/admin can build guidelines");
    }

    const pack = await ctx.db.get(args.packId);
    if (!pack || pack.orgId !== actor.orgId) {
      throw new Error("Pack not found");
    }

    const resources = await ctx.db
      .query("resources")
      .withIndex("by_pack", (q) => q.eq("packId", args.packId))
      .collect();

    const chunks: Array<{ filename: string; text: string }> = [];
    for (const resource of resources) {
      const resourceChunks = await ctx.db
        .query("chunks")
        .withIndex("by_resource", (q) => q.eq("resourceId", resource._id))
        .collect();
      const joined = resourceChunks.map((chunk) => chunk.text).join("\n").slice(0, 16_000);
      chunks.push({ filename: resource.filename, text: joined });
    }

    return chunks;
  },
});

export const listAgentTexts = query({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) {
      throw new Error("Agent not found");
    }

    if (!canManageAgentResources(agent, actor)) {
      throw new Error("Only creator/admin can build agent guidelines");
    }

    const resources = await ctx.db
      .query("resources")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();

    const chunks: Array<{ filename: string; text: string }> = [];
    for (const resource of resources) {
      const resourceChunks = await ctx.db
        .query("chunks")
        .withIndex("by_resource", (q) => q.eq("resourceId", resource._id))
        .collect();
      const joined = resourceChunks.map((chunk) => chunk.text).join("\n").slice(0, 16_000);
      chunks.push({ filename: resource.filename, text: joined });
    }

    return chunks;
  },
});

export const cleanupExpired = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.max(1, Math.min(Math.round(args.limit ?? 200), 500));
    const expired = await ctx.db
      .query("resources")
      .withIndex("by_expires", (q) => q.gte("expiresAt", 0).lt("expiresAt", now))
      .take(limit);

    let deletedCount = 0;
    let deletedChunkCount = 0;
    let deletedStorageCount = 0;

    for (const resource of expired) {
      if (typeof resource.expiresAt !== "number" || resource.expiresAt > now) continue;
      if (resource.scope !== "personal") continue;
      if (resource.saveToLibrary !== false) continue;

      const chunks = await ctx.db
        .query("chunks")
        .withIndex("by_resource", (q) => q.eq("resourceId", resource._id))
        .collect();
      for (const chunk of chunks) {
        await ctx.db.delete(chunk._id);
        deletedChunkCount += 1;
      }

      if (resource.storageId) {
        await ctx.storage.delete(resource.storageId).catch(() => {});
        deletedStorageCount += 1;
      }

      await ctx.db.delete(resource._id);
      deletedCount += 1;
    }

    return {
      ok: true,
      scanned: expired.length,
      deletedCount,
      deletedChunkCount,
      deletedStorageCount,
    };
  },
});
