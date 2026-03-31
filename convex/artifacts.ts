import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { adjustWorkstreamArtifactCount, getUserByClerkId } from "./helpers";

const vArtifactSourceType = v.union(
  v.literal("user_manual"),
  v.literal("ai_generated"),
  v.literal("managebac_sync"),
);
const vEditorMode = v.union(
  v.literal("standard"),
  v.literal("ai_enhanced"),
  v.literal("simple"),
  v.literal("notion"),
  v.literal("agentic"),
);

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

function normalizeString(value: string | null | undefined) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalPatchValue<T>(value: T | null | undefined): T | undefined {
  if (value === null) return undefined;
  return value;
}

function normalizeEditorMode(mode: string | null | undefined): Doc<"artifacts">["editorMode"] {
  if (mode === "agentic") return "ai_enhanced";
  if (mode === "standard" || mode === "ai_enhanced" || mode === "simple" || mode === "notion") {
    return mode;
  }
  return "standard";
}

async function validateWorkstream(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  workstreamId: Id<"workstreams"> | undefined,
) {
  if (!workstreamId) return;
  const workstream = await ctx.db.get(workstreamId);
  if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
    throw new Error("Workstream not found");
  }
}

async function validateChat(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  chatId: Id<"chats"> | undefined,
) {
  if (!chatId) return;
  const chat = await ctx.db.get(chatId);
  if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId || chat.deletedAt) {
    throw new Error("Chat not found");
  }
}

async function assertArtifactOwnership(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  artifactId: Id<"artifacts">,
) {
  const artifact = await ctx.db.get(artifactId);
  if (!artifact || artifact.ownerUserId !== actor._id || artifact.orgId !== actor.orgId) {
    throw new Error("Artifact not found");
  }
  return artifact;
}

async function countArtifactVersions(
  ctx: Pick<MutationCtx, "db">,
  artifactId: Id<"artifacts">,
) {
  const versions = await ctx.db
    .query("artifactVersions")
    .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
    .collect();
  return versions.length;
}

async function createArtifactVersion(
  ctx: Pick<MutationCtx, "db">,
  params: {
    artifactId: Id<"artifacts">;
    diff: unknown;
    snapshot?: unknown;
    authorType: "user" | "agent" | "system";
    authorAgentId?: Id<"agents">;
    sourceChatId?: Id<"chats">;
    sourceMessageId?: Id<"messages">;
    description?: string;
    status?: Doc<"artifactVersions">["status"];
    createdAt?: number;
  },
) {
  return ctx.db.insert("artifactVersions", {
    artifactId: params.artifactId,
    diff: params.diff,
    snapshot: params.snapshot,
    authorType: params.authorType,
    authorAgentId: params.authorAgentId,
    sourceChatId: params.sourceChatId,
    sourceMessageId: params.sourceMessageId,
    description: params.description,
    status: params.status,
    createdAt: params.createdAt ?? Date.now(),
  });
}

function matchesArtifactSearch(row: Doc<"artifacts">, search: string) {
  const q = search.toLowerCase();
  return row.title.toLowerCase().includes(q)
    || (row.contentPlaintext?.toLowerCase().includes(q) ?? false)
    || (row.tags?.some((tag) => tag.toLowerCase().includes(q)) ?? false);
}

function toLegacyDocumentShape(artifact: Doc<"artifacts">) {
  return {
    _id: artifact._id,
    workstreamId: artifact.workstreamId,
    artifactId: undefined,
    title: artifact.title,
    content: artifact.content,
    contentPlaintext: artifact.contentPlaintext,
    editorMode: normalizeEditorMode(artifact.editorMode),
    sourceType: artifact.sourceType,
    managebacItemId: artifact.managebacItemId,
    sourceDeleted: artifact.sourceDeleted,
    sourceUpdatedAt: artifact.sourceUpdatedAt,
    syncConflictSummary: artifact.syncConflictSummary,
    lastAiEditId: artifact.lastAiEditId,
    pendingDiffs: artifact.pendingDiffs,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

function getVersionPlaintext(
  version: Doc<"artifactVersions">,
  fallback: string | undefined,
) {
  if (typeof version.diff?.nextPlaintext === "string") return version.diff.nextPlaintext;
  if (typeof version.diff?.previousPlaintext === "string") return version.diff.previousPlaintext;
  return fallback;
}

export const list = query({
  args: {
    actorClerkId: v.string(),
    type: v.optional(v.string()),
    status: v.optional(v.string()),
    workstreamId: v.optional(v.id("workstreams")),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 300));

    let rows = await ctx.db
      .query("artifacts")
      .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
      .order("desc")
      .take(Math.max(limit * 4, 200));

    const statusFilter = args.status ?? "active";
    if (statusFilter !== "all") {
      rows = rows.filter((row) => row.status === statusFilter);
    }
    if (args.type) {
      rows = rows.filter((row) => row.type === args.type);
    }
    if (args.workstreamId !== undefined) {
      rows = rows.filter((row) => row.workstreamId === args.workstreamId);
    }

    const search = normalizeString(args.search);
    if (search) {
      rows = rows.filter((row) => matchesArtifactSearch(row, search));
    }

    return rows.slice(0, limit);
  },
});

export const listHubArtifacts = query({
  args: {
    actorClerkId: v.string(),
    type: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 300));
    let rows = await ctx.db
      .query("artifacts")
      .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
      .order("desc")
      .take(Math.max(limit * 3, 120));

    rows = rows.filter((row) => row.status === "active" && row.workstreamId === undefined);
    if (args.type) {
      rows = rows.filter((row) => row.type === args.type);
    }
    return rows.slice(0, limit);
  },
});

export const searchByContent = query({
  args: {
    actorClerkId: v.string(),
    query: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const queryText = normalizeString(args.query);
    if (!queryText) return [];

    const hits = await ctx.db
      .query("artifacts")
      .withSearchIndex("search_content", (q) =>
        q
          .search("contentPlaintext", queryText)
          .eq("ownerUserId", actor._id)
          .eq("type", "document")
          .eq("status", "active"),
      )
      .take(Math.max(1, Math.min(args.limit ?? 20, 50)));

    return hits.filter((row) => (
      args.workstreamId === undefined ? true : row.workstreamId === args.workstreamId
    ));
  },
});

export const get = query({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    return assertArtifactOwnership(ctx, actor, args.artifactId);
  },
});

export const getOrMigrateFromNote = mutation({
  args: {
    actorClerkId: v.string(),
    noteId: v.id("notes"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);

    const existingArtifact = await ctx.db
      .query("artifacts")
      .withIndex("by_legacy_note", (q) => q.eq("legacyNoteId", args.noteId))
      .first();
    if (existingArtifact) {
      if (existingArtifact.ownerUserId !== actor._id || existingArtifact.orgId !== actor.orgId) {
        throw new Error("Artifact not found");
      }
      return { artifactId: existingArtifact._id };
    }

    const note = await ctx.db.get(args.noteId);
    if (!note || note.ownerUserId !== actor._id || note.orgId !== actor.orgId) {
      throw new Error("Legacy note not found");
    }

    const duplicate = await ctx.db
      .query("artifacts")
      .withIndex("by_owner_type", (q) => q.eq("ownerUserId", actor._id).eq("type", "document"))
      .collect()
      .then((artifacts) => artifacts.find((artifact) =>
        artifact.workstreamId === note.workstreamId
        && artifact.title === note.title
        && artifact.managebacItemId === note.managebacItemId
        && artifact.createdAt === note.createdAt,
      ));

    if (duplicate) {
      await ctx.db.patch(duplicate._id, {
        legacyNoteId: duplicate.legacyNoteId ?? note._id,
        updatedAt: Date.now(),
      });
      return { artifactId: duplicate._id };
    }

    const artifactId = await ctx.db.insert("artifacts", {
      ownerUserId: note.ownerUserId,
      orgId: note.orgId,
      workstreamId: note.workstreamId,
      type: "document",
      title: note.title,
      content: note.content,
      contentPlaintext: note.contentPlaintext,
      editorMode: normalizeEditorMode(note.editorMode),
      sourceType: note.sourceType ?? "user_manual",
      managebacItemId: note.managebacItemId,
      sourceDeleted: note.sourceDeleted,
      sourceUpdatedAt: note.sourceUpdatedAt,
      syncConflictSummary: note.syncConflictSummary,
      lastAiEditId: note.lastAiEditId,
      pendingDiffs: note.pendingDiffs,
      legacyNoteId: note._id,
      layout: undefined,
      tags: undefined,
      linkedAgentId: undefined,
      linkedChatId: undefined,
      status: "active",
      pinnedAt: undefined,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });

    await createArtifactVersion(ctx, {
      artifactId,
      diff: { op: "create" },
      snapshot: note.content,
      authorType: "user",
      description: "Migrated from legacy note",
      status: "confirmed",
      createdAt: note.createdAt,
    });
    await adjustWorkstreamArtifactCount(ctx, note.workstreamId, 1);

    return { artifactId };
  },
});

export const getVersions = query({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertArtifactOwnership(ctx, actor, args.artifactId);
    return ctx.db
      .query("artifactVersions")
      .withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId))
      .order("desc")
      .collect();
  },
});

export const getStats = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const all = await ctx.db
      .query("artifacts")
      .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
      .collect();

    const active = all.filter((artifact) => artifact.status === "active");
    const pinned = active.filter((artifact) => artifact.pinnedAt);
    const byType: Record<string, number> = {};
    for (const artifact of active) {
      byType[artifact.type] = (byType[artifact.type] ?? 0) + 1;
    }

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      total: active.length,
      pinned: pinned.length,
      archived: all.length - active.length,
      recentlyActive: active.filter((artifact) => artifact.updatedAt > weekAgo).length,
      byType,
    };
  },
});

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    type: v.string(),
    title: v.string(),
    content: v.any(),
    contentPlaintext: v.optional(v.string()),
    workstreamId: v.optional(v.id("workstreams")),
    editorMode: v.optional(vEditorMode),
    sourceType: v.optional(vArtifactSourceType),
    managebacItemId: v.optional(v.string()),
    sourceDeleted: v.optional(v.boolean()),
    sourceUpdatedAt: v.optional(v.number()),
    syncConflictSummary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    linkedAgentId: v.optional(v.id("agents")),
    linkedChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    lastAiEditId: v.optional(v.string()),
    pendingDiffs: v.optional(v.any()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const title = normalizeString(args.title);
    if (!title) throw new Error("title is required");

    await validateWorkstream(ctx, actor, args.workstreamId);
    await validateChat(ctx, actor, args.linkedChatId);

    const now = args.createdAt ?? Date.now();
    const artifactId = await ctx.db.insert("artifacts", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      workstreamId: args.workstreamId,
      type: args.type,
      title,
      content: args.content,
      contentPlaintext: normalizeString(args.contentPlaintext),
      editorMode: args.type === "document" ? normalizeEditorMode(args.editorMode) : undefined,
      sourceType: args.sourceType ?? "user_manual",
      managebacItemId: normalizeString(args.managebacItemId),
      sourceDeleted: args.sourceDeleted,
      sourceUpdatedAt: args.sourceUpdatedAt,
      syncConflictSummary: normalizeString(args.syncConflictSummary),
      lastAiEditId: normalizeString(args.lastAiEditId),
      pendingDiffs: args.pendingDiffs,
      layout: undefined,
      tags: args.tags,
      linkedAgentId: args.linkedAgentId,
      linkedChatId: args.linkedChatId,
      status: "active",
      pinnedAt: undefined,
      createdAt: now,
      updatedAt: now,
    });

    await createArtifactVersion(ctx, {
      artifactId,
      diff: { op: "create" },
      snapshot: args.content,
      authorType: "user",
      sourceChatId: args.linkedChatId,
      sourceMessageId: args.sourceMessageId,
      description: "Created artifact",
      status: "confirmed",
      createdAt: now,
    });

    await adjustWorkstreamArtifactCount(ctx, args.workstreamId, 1);
    return artifactId;
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
    title: v.optional(v.string()),
    content: v.optional(v.any()),
    contentPlaintext: v.optional(v.union(v.string(), v.null())),
    workstreamId: v.optional(v.union(v.id("workstreams"), v.null())),
    editorMode: v.optional(vEditorMode),
    sourceType: v.optional(v.union(vArtifactSourceType, v.null())),
    managebacItemId: v.optional(v.union(v.string(), v.null())),
    sourceDeleted: v.optional(v.union(v.boolean(), v.null())),
    sourceUpdatedAt: v.optional(v.union(v.number(), v.null())),
    syncConflictSummary: v.optional(v.union(v.string(), v.null())),
    tags: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    authorType: v.optional(v.union(v.literal("user"), v.literal("agent"), v.literal("system"))),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    linkedChatId: v.optional(v.union(v.id("chats"), v.null())),
    lastAiEditId: v.optional(v.union(v.string(), v.null())),
    pendingDiffs: v.optional(v.union(v.any(), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await assertArtifactOwnership(ctx, actor, args.artifactId);

    if (args.workstreamId !== undefined) {
      await validateWorkstream(ctx, actor, args.workstreamId ?? undefined);
    }
    if (args.linkedChatId !== undefined) {
      await validateChat(ctx, actor, args.linkedChatId ?? undefined);
    }
    if (args.sourceChatId !== undefined) {
      await validateChat(ctx, actor, args.sourceChatId);
    }

    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (args.title !== undefined) {
      const title = normalizeString(args.title);
      if (!title) throw new Error("title cannot be empty");
      updates.title = title;
    }
    if (args.content !== undefined) updates.content = args.content;
    if (args.contentPlaintext !== undefined) {
      updates.contentPlaintext = normalizeString(toOptionalPatchValue(args.contentPlaintext));
    }
    if (args.workstreamId !== undefined) updates.workstreamId = toOptionalPatchValue(args.workstreamId);
    if (args.editorMode !== undefined) updates.editorMode = normalizeEditorMode(args.editorMode);
    if (args.sourceType !== undefined) updates.sourceType = toOptionalPatchValue(args.sourceType);
    if (args.managebacItemId !== undefined) {
      updates.managebacItemId = normalizeString(toOptionalPatchValue(args.managebacItemId));
    }
    if (args.sourceDeleted !== undefined) updates.sourceDeleted = toOptionalPatchValue(args.sourceDeleted);
    if (args.sourceUpdatedAt !== undefined) updates.sourceUpdatedAt = toOptionalPatchValue(args.sourceUpdatedAt);
    if (args.syncConflictSummary !== undefined) {
      updates.syncConflictSummary = normalizeString(toOptionalPatchValue(args.syncConflictSummary));
    }
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.linkedChatId !== undefined) updates.linkedChatId = toOptionalPatchValue(args.linkedChatId);
    if (args.lastAiEditId !== undefined) {
      updates.lastAiEditId = normalizeString(toOptionalPatchValue(args.lastAiEditId));
    }
    if (args.pendingDiffs !== undefined) updates.pendingDiffs = toOptionalPatchValue(args.pendingDiffs);

    await ctx.db.patch(args.artifactId, updates);

    if (args.content !== undefined) {
      const versionCount = await countArtifactVersions(ctx, args.artifactId);
      await createArtifactVersion(ctx, {
        artifactId: args.artifactId,
        diff: { op: "update", previous: artifact.content },
        snapshot: versionCount % 10 === 0 ? args.content : undefined,
        authorType: args.authorType ?? "user",
        sourceChatId: args.sourceChatId,
        sourceMessageId: args.sourceMessageId,
        description: args.description ?? "Updated artifact",
        status: "confirmed",
        createdAt: now,
      });
    }

    if (artifact.workstreamId !== args.workstreamId && artifact.status === "active") {
      await adjustWorkstreamArtifactCount(ctx, artifact.workstreamId, -1);
      await adjustWorkstreamArtifactCount(ctx, args.workstreamId ?? undefined, 1);
    }

    return { success: true };
  },
});

export const updateEditorMode = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
    editorMode: vEditorMode,
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await assertArtifactOwnership(ctx, actor, args.artifactId);
    if (artifact.type !== "document") {
      throw new Error("Only document artifacts support editorMode");
    }

    await ctx.db.patch(args.artifactId, {
      editorMode: normalizeEditorMode(args.editorMode),
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const applyAiEdit = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
    content: v.any(),
    contentPlaintext: v.optional(v.string()),
    instruction: v.string(),
    operations: v.any(),
    summary: v.optional(v.string()),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    lastAiEditId: v.optional(v.string()),
    pendingDiffs: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await assertArtifactOwnership(ctx, actor, args.artifactId);
    await validateChat(ctx, actor, args.sourceChatId);

    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      content: args.content,
      contentPlaintext: normalizeString(args.contentPlaintext),
      lastAiEditId: normalizeString(args.lastAiEditId),
      pendingDiffs: args.pendingDiffs,
      linkedChatId: args.sourceChatId ?? artifact.linkedChatId,
      sourceType: artifact.sourceType ?? "ai_generated",
      updatedAt: now,
    });

    const versionId = await createArtifactVersion(ctx, {
      artifactId: args.artifactId,
      diff: {
        op: "ai_edit",
        previous: artifact.content,
        previousPlaintext: artifact.contentPlaintext,
        nextPlaintext: normalizeString(args.contentPlaintext),
        operations: args.operations,
        instruction: args.instruction,
      },
      snapshot: args.content,
      authorType: "agent",
      sourceChatId: args.sourceChatId,
      sourceMessageId: args.sourceMessageId,
      description: args.summary ?? "Applied AI edit",
      status: "applied",
      createdAt: now,
    });

    return { success: true, versionId };
  },
});

export const confirmAiEdit = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
    versionId: v.id("artifactVersions"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertArtifactOwnership(ctx, actor, args.artifactId);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.artifactId !== args.artifactId) {
      throw new Error("Version not found");
    }
    if (version.status === "discarded") {
      throw new Error("Discarded AI edits cannot be confirmed");
    }
    if (version.status === "confirmed") {
      return { success: true };
    }

    await ctx.db.patch(args.versionId, {
      status: "confirmed",
    });
    await ctx.db.patch(args.artifactId, {
      pendingDiffs: undefined,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const discardAiEdit = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
    versionId: v.id("artifactVersions"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertArtifactOwnership(ctx, actor, args.artifactId);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.artifactId !== args.artifactId) {
      throw new Error("Version not found");
    }
    if (version.status === "confirmed") {
      throw new Error("Confirmed AI edits must be reverted from version history");
    }

    const restoredContent = version.diff?.previous;
    if (restoredContent === undefined) {
      throw new Error("Version cannot be discarded");
    }

    await ctx.db.patch(args.artifactId, {
      content: restoredContent,
      contentPlaintext: version.diff?.previousPlaintext,
      pendingDiffs: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.versionId, {
      status: "discarded",
    });

    return { success: true, content: restoredContent };
  },
});

export const reapplyAiEdit = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
    versionId: v.id("artifactVersions"),
    contentPlaintext: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertArtifactOwnership(ctx, actor, args.artifactId);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.artifactId !== args.artifactId) {
      throw new Error("Version not found");
    }
    if (version.snapshot === undefined) {
      throw new Error("Version cannot be re-applied");
    }
    if (version.status === "confirmed") {
      throw new Error("Confirmed AI edits must be restored from version history");
    }

    await ctx.db.patch(args.artifactId, {
      content: version.snapshot,
      contentPlaintext: normalizeString(args.contentPlaintext) ?? version.diff?.nextPlaintext,
      pendingDiffs: version.diff?.operations,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.versionId, {
      status: "applied",
    });
    return { success: true, content: version.snapshot };
  },
});

export const archive = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await assertArtifactOwnership(ctx, actor, args.artifactId);
    await ctx.db.patch(args.artifactId, {
      status: "archived",
      updatedAt: Date.now(),
    });
    if (artifact.status === "active") {
      await adjustWorkstreamArtifactCount(ctx, artifact.workstreamId, -1);
    }
    return { success: true };
  },
});

export const restore = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await assertArtifactOwnership(ctx, actor, args.artifactId);
    await ctx.db.patch(args.artifactId, {
      status: "active",
      updatedAt: Date.now(),
    });
    if (artifact.status !== "active") {
      await adjustWorkstreamArtifactCount(ctx, artifact.workstreamId, 1);
    }
    return { success: true };
  },
});

export const remove = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await assertArtifactOwnership(ctx, actor, args.artifactId);
    const versions = await ctx.db
      .query("artifactVersions")
      .withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId))
      .collect();
    for (const version of versions) {
      await ctx.db.delete(version._id);
    }
    const linkedChats = await ctx.db
      .query("chats")
      .withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId))
      .collect();
    for (const chat of linkedChats) {
      await ctx.db.patch(chat._id, {
        artifactId: undefined,
        threadType: chat.threadType === "artifact_edit" ? "conversation" : chat.threadType,
        updatedAt: Date.now(),
      });
    }
    const plannerItems = await ctx.db
      .query("plannerItems")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
      .collect();
    for (const item of plannerItems) {
      if (item.sourceArtifactId === args.artifactId) {
        await ctx.db.patch(item._id, {
          sourceArtifactId: undefined,
          updatedAt: Date.now(),
        });
      }
    }
    await ctx.db.delete(args.artifactId);
    if (artifact.status === "active") {
      await adjustWorkstreamArtifactCount(ctx, artifact.workstreamId, -1);
    }
    return { success: true };
  },
});

export const togglePin = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await assertArtifactOwnership(ctx, actor, args.artifactId);
    const pinned = !artifact.pinnedAt;
    await ctx.db.patch(args.artifactId, {
      pinnedAt: pinned ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return { pinned };
  },
});

export const restoreVersion = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
    versionId: v.id("artifactVersions"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await assertArtifactOwnership(ctx, actor, args.artifactId);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.artifactId !== args.artifactId) {
      throw new Error("Version not found");
    }

    let restoredContent = version.snapshot;
    if (!restoredContent && version.diff?.op === "update") {
      restoredContent = version.diff.previous;
    }
    if (!restoredContent && version.diff?.op === "create") {
      restoredContent = version.snapshot ?? artifact.content;
    }

    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      content: restoredContent,
      contentPlaintext: getVersionPlaintext(version, artifact.contentPlaintext),
      pendingDiffs: undefined,
      updatedAt: now,
    });
    await createArtifactVersion(ctx, {
      artifactId: args.artifactId,
      diff: { op: "restore", fromVersionId: args.versionId },
      snapshot: restoredContent,
      authorType: "user",
      description: "Restored to earlier version",
      status: "confirmed",
      createdAt: now,
    });
    const refreshed = await ctx.db.get(args.artifactId);
    return {
      success: true,
      artifact: refreshed
        ? {
            _id: refreshed._id,
            title: refreshed.title,
            content: refreshed.content,
            contentPlaintext: refreshed.contentPlaintext,
            updatedAt: refreshed.updatedAt,
          }
        : undefined,
    };
  },
});

export const migrateLegacyNotes = mutation({
  args: {
    actorClerkId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 500, 1000));
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
      .order("desc")
      .take(limit);
    const existingArtifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
      .collect();

    let migrated = 0;
    let skipped = 0;
    for (const note of notes) {
      const duplicate = existingArtifacts.find((artifact) =>
        artifact.type === "document"
        && artifact.workstreamId === note.workstreamId
        && artifact.title === note.title
        && artifact.managebacItemId === note.managebacItemId
        && artifact.createdAt === note.createdAt,
      );
      if (duplicate) {
        if (!duplicate.legacyNoteId) {
          await ctx.db.patch(duplicate._id, {
            legacyNoteId: note._id,
            updatedAt: Date.now(),
          });
        }
        skipped += 1;
        continue;
      }

      const artifactId = await ctx.db.insert("artifacts", {
        ownerUserId: note.ownerUserId,
        orgId: note.orgId,
        workstreamId: note.workstreamId,
        type: "document",
        title: note.title,
        content: note.content,
        contentPlaintext: note.contentPlaintext,
        editorMode: normalizeEditorMode(note.editorMode),
        sourceType: note.sourceType ?? "user_manual",
        managebacItemId: note.managebacItemId,
        sourceDeleted: note.sourceDeleted,
        sourceUpdatedAt: note.sourceUpdatedAt,
        syncConflictSummary: note.syncConflictSummary,
        lastAiEditId: note.lastAiEditId,
        pendingDiffs: note.pendingDiffs,
        legacyNoteId: note._id,
        layout: undefined,
        tags: undefined,
        linkedAgentId: undefined,
        linkedChatId: undefined,
        status: "active",
        pinnedAt: undefined,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      });

      await createArtifactVersion(ctx, {
        artifactId,
        diff: { op: "create" },
        snapshot: note.content,
        authorType: "user",
        description: "Migrated from legacy note",
        status: "confirmed",
        createdAt: note.createdAt,
      });

      migrated += 1;
      existingArtifacts.push({
        ...note,
        _id: artifactId,
        _creationTime: note._creationTime,
        type: "document",
        status: "active",
        linkedAgentId: undefined,
        linkedChatId: undefined,
        tags: undefined,
        layout: undefined,
        pinnedAt: undefined,
        editorMode: normalizeEditorMode(note.editorMode),
      } as Doc<"artifacts">);
      await adjustWorkstreamArtifactCount(ctx, note.workstreamId, 1);
    }

    return { migrated, skipped, total: notes.length };
  },
});

export const migrateLegacyNotesBatch = internalMutation({
  args: {
    ownerUserId: v.optional(v.id("users")),
    orgId: v.optional(v.id("orgs")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 1000, 5000));
    let notes = await ctx.db.query("notes").collect();
    if (args.ownerUserId) {
      notes = notes.filter((note) => note.ownerUserId === args.ownerUserId);
    }
    if (args.orgId) {
      notes = notes.filter((note) => note.orgId === args.orgId);
    }

    let migrated = 0;
    for (const note of notes.slice(0, limit)) {
      const existing = await ctx.db
        .query("artifacts")
        .withIndex("by_owner_type", (q) => q.eq("ownerUserId", note.ownerUserId).eq("type", "document"))
        .collect();
      const duplicate = existing.find((artifact) =>
        artifact.title === note.title
        && artifact.workstreamId === note.workstreamId
        && artifact.managebacItemId === note.managebacItemId
        && artifact.createdAt === note.createdAt,
      );
      if (duplicate) {
        if (!duplicate.legacyNoteId) {
          await ctx.db.patch(duplicate._id, {
            legacyNoteId: note._id,
            updatedAt: Date.now(),
          });
        }
        continue;
      }

      const artifactId = await ctx.db.insert("artifacts", {
        ownerUserId: note.ownerUserId,
        orgId: note.orgId,
        workstreamId: note.workstreamId,
        type: "document",
        title: note.title,
        content: note.content,
        contentPlaintext: note.contentPlaintext,
        editorMode: normalizeEditorMode(note.editorMode),
        sourceType: note.sourceType ?? "user_manual",
        managebacItemId: note.managebacItemId,
        sourceDeleted: note.sourceDeleted,
        sourceUpdatedAt: note.sourceUpdatedAt,
        syncConflictSummary: note.syncConflictSummary,
        lastAiEditId: note.lastAiEditId,
        pendingDiffs: note.pendingDiffs,
        legacyNoteId: note._id,
        layout: undefined,
        tags: undefined,
        linkedAgentId: undefined,
        linkedChatId: undefined,
        status: "active",
        pinnedAt: undefined,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      });

      await createArtifactVersion(ctx, {
        artifactId,
        diff: { op: "create" },
        snapshot: note.content,
        authorType: "user",
        description: "Migrated from legacy note",
        status: "confirmed",
        createdAt: note.createdAt,
      });
      await adjustWorkstreamArtifactCount(ctx, note.workstreamId, 1);
      migrated += 1;
    }

    return { migrated };
  },
});

export const listDocumentCompat = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 300));
    let rows = await ctx.db
      .query("artifacts")
      .withIndex("by_owner_type", (q) => q.eq("ownerUserId", actor._id).eq("type", "document"))
      .collect();

    rows = rows.filter((row) => row.status === "active");
    if (args.workstreamId !== undefined) {
      rows = rows.filter((row) => row.workstreamId === args.workstreamId);
    }
    const search = normalizeString(args.search);
    if (search) {
      rows = rows.filter((row) => matchesArtifactSearch(row, search));
    }
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(toLegacyDocumentShape);
  },
});

export const getDocumentCompat = query({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await assertArtifactOwnership(ctx, actor, args.artifactId);
    if (artifact.type !== "document") {
      throw new Error("Document not found");
    }
    return toLegacyDocumentShape(artifact);
  },
});
