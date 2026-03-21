import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { LIMITS } from "./constants";
import { getUserByClerkId } from "./helpers";
import { vScope } from "./shared";
import { internal } from "./_generated/api";
import {
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
  RESOURCE_PROCESSING_STALE_MS,
} from "../shared/resource-processing";

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
      if (count.length >= LIMITS.maxTeacherFilesPerPack) {
        throw new Error(`Agent file limit reached (${LIMITS.maxTeacherFilesPerPack})`);
      }
    }

    if (args.scope === "personal") {
      const mine = await ctx.db
        .query("resources")
        .withIndex("by_owner_scope", (q) => q.eq("ownerUserId", actor._id).eq("scope", "personal"))
        .collect();
      if (!args.ignorePersonalLimit && mine.length >= LIMITS.maxStudentPersonalFiles) {
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
    }

    const now = Date.now();
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
      saveToLibrary: args.saveToLibrary ?? true,
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
  args: {},
  handler: async () => {
    return { ok: true, deletedCount: 0 };
  },
});
