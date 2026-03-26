import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

const ARTIFACT_TYPES = [
  "study_plan",
  "timetable",
  "note",
  "flashcard_deck",
  "document",
  "code_project",
  "diagram",
  "image",
  "bookmark",
  "collection",
] as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const list = query({
  args: {
    actorClerkId: v.string(),
    type: v.optional(v.string()),
    status: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = args.limit ?? 100;

    let rows = await ctx.db
      .query("artifacts")
      .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
      .order("desc")
      .collect();

    // Filter by status (default: active)
    const statusFilter = args.status ?? "active";
    if (statusFilter !== "all") {
      rows = rows.filter((r) => r.status === statusFilter);
    }

    // Filter by type
    if (args.type) {
      rows = rows.filter((r) => r.type === args.type);
    }

    // Search by title or tags
    if (args.search) {
      const q = args.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.tags && r.tags.some((tag: string) => tag.toLowerCase().includes(q))),
      );
    }

    return rows.slice(0, limit);
  },
});

export const get = query({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.ownerUserId !== actor._id) {
      throw new Error("Artifact not found");
    }
    return artifact;
  },
});

export const getVersions = query({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.ownerUserId !== actor._id) {
      throw new Error("Artifact not found");
    }

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

    const active = all.filter((a) => a.status === "active");
    const pinned = active.filter((a) => a.pinnedAt);

    const byType: Record<string, number> = {};
    for (const a of active) {
      byType[a.type] = (byType[a.type] ?? 0) + 1;
    }

    // Recent activity: artifacts updated in last 7 days
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentlyActive = active.filter((a) => a.updatedAt > weekAgo).length;

    return {
      total: active.length,
      pinned: pinned.length,
      archived: all.length - active.length,
      recentlyActive,
      byType,
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    type: v.string(),
    title: v.string(),
    content: v.any(),
    tags: v.optional(v.array(v.string())),
    linkedAgentId: v.optional(v.id("agents")),
    linkedChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const now = Date.now();

    const artifactId = await ctx.db.insert("artifacts", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      type: args.type,
      title: args.title,
      content: args.content,
      tags: args.tags,
      linkedAgentId: args.linkedAgentId,
      linkedChatId: args.linkedChatId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    // Create initial version snapshot
    await ctx.db.insert("artifactVersions", {
      artifactId,
      diff: { op: "create" },
      snapshot: args.content,
      authorType: "user",
      sourceChatId: args.linkedChatId,
      sourceMessageId: args.sourceMessageId,
      description: "Created artifact",
      createdAt: now,
    });

    return artifactId;
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
    title: v.optional(v.string()),
    content: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    authorType: v.optional(v.string()),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.ownerUserId !== actor._id) {
      throw new Error("Artifact not found");
    }

    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (args.title !== undefined) updates.title = args.title;
    if (args.content !== undefined) updates.content = args.content;
    if (args.tags !== undefined) updates.tags = args.tags;

    await ctx.db.patch(args.artifactId, updates);

    // Create version entry if content changed
    if (args.content !== undefined) {
      // Count existing versions to decide if we store a snapshot
      const versionCount = await ctx.db
        .query("artifactVersions")
        .withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId))
        .collect()
        .then((v) => v.length);

      const storeSnapshot = versionCount % 10 === 0;

      await ctx.db.insert("artifactVersions", {
        artifactId: args.artifactId,
        diff: { op: "update", previous: artifact.content },
        snapshot: storeSnapshot ? args.content : undefined,
        authorType: (args.authorType as "user" | "agent" | "system") ?? "user",
        sourceChatId: args.sourceChatId,
        sourceMessageId: args.sourceMessageId,
        description: args.description ?? "Updated artifact",
        createdAt: now,
      });
    }

    return { success: true };
  },
});

export const archive = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("artifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.ownerUserId !== actor._id) {
      throw new Error("Artifact not found");
    }

    await ctx.db.patch(args.artifactId, {
      status: "archived",
      updatedAt: Date.now(),
    });

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
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.ownerUserId !== actor._id) {
      throw new Error("Artifact not found");
    }

    await ctx.db.patch(args.artifactId, {
      status: "active",
      updatedAt: Date.now(),
    });

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
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.ownerUserId !== actor._id) {
      throw new Error("Artifact not found");
    }

    // Delete all versions
    const versions = await ctx.db
      .query("artifactVersions")
      .withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId))
      .collect();

    for (const version of versions) {
      await ctx.db.delete(version._id);
    }

    await ctx.db.delete(args.artifactId);

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
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.ownerUserId !== actor._id) {
      throw new Error("Artifact not found");
    }

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
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.ownerUserId !== actor._id) {
      throw new Error("Artifact not found");
    }

    const version = await ctx.db.get(args.versionId);
    if (!version || version.artifactId !== args.artifactId) {
      throw new Error("Version not found");
    }

    // Use snapshot if available, otherwise use the diff's previous content
    let restoredContent = version.snapshot;
    if (!restoredContent && version.diff?.op === "update") {
      restoredContent = version.diff.previous;
    }
    if (!restoredContent && version.diff?.op === "create") {
      // For the initial version, the snapshot should be available
      restoredContent = version.snapshot ?? artifact.content;
    }

    const now = Date.now();

    await ctx.db.patch(args.artifactId, {
      content: restoredContent,
      updatedAt: now,
    });

    // Record the restoration as a new version
    await ctx.db.insert("artifactVersions", {
      artifactId: args.artifactId,
      diff: { op: "restore", fromVersionId: args.versionId },
      snapshot: restoredContent,
      authorType: "user",
      description: "Restored to earlier version",
      createdAt: now,
    });

    return { success: true };
  },
});
