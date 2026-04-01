import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";
import { syncWorkspaceItemForArtifact } from "./workspace-item-sync";

const vWorkspaceItemType = v.union(
  v.literal("thread"),
  v.literal("document"),
  v.literal("planner"),
  v.literal("board"),
  v.literal("visualization"),
  v.literal("media"),
  v.literal("reference"),
  v.literal("custom"),
  v.literal("utility"),
);

async function requireActor(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actorClerkId: string,
) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function assertOwnership(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  itemId: Id<"workspaceItems">,
) {
  const item = await ctx.db.get(itemId);
  if (!item || item.ownerUserId !== actor._id || item.orgId !== actor.orgId) {
    throw new Error("Workspace item not found");
  }
  return item;
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

async function validateSourceChat(
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

async function validateSourceArtifact(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  artifactId: Id<"artifacts"> | undefined,
) {
  if (!artifactId) return;
  const artifact = await ctx.db.get(artifactId);
  if (!artifact || artifact.ownerUserId !== actor._id || artifact.orgId !== actor.orgId) {
    throw new Error("Artifact not found");
  }
}

async function validateSourcePlannerItem(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  plannerItemId: Id<"plannerItems"> | undefined,
) {
  if (!plannerItemId) return;
  const plannerItem = await ctx.db.get(plannerItemId);
  if (!plannerItem || plannerItem.ownerUserId !== actor._id || plannerItem.orgId !== actor.orgId) {
    throw new Error("Planner item not found");
  }
}

function normalizeTitle(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Untitled Item";
}

export const list = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 300));

    if (args.workstreamId) {
      await validateWorkstream(ctx, actor, args.workstreamId);
      return ctx.db
        .query("workspaceItems")
        .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
        .filter((q) => q.eq(q.field("status"), "active"))
        .take(limit);
    }

    return ctx.db
      .query("workspaceItems")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
      .filter((q) => q.eq(q.field("status"), "active"))
      .take(limit);
  },
});

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    type: vWorkspaceItemType,
    renderMode: v.optional(v.string()),
    sourceChatId: v.optional(v.id("chats")),
    sourceArtifactId: v.optional(v.id("artifacts")),
    sourcePlannerItemId: v.optional(v.id("plannerItems")),
    title: v.string(),
    contentSummary: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);

    await validateWorkstream(ctx, actor, args.workstreamId);
    await validateSourceChat(ctx, actor, args.sourceChatId);
    await validateSourceArtifact(ctx, actor, args.sourceArtifactId);
    await validateSourcePlannerItem(ctx, actor, args.sourcePlannerItemId);

    const now = Date.now();
    const itemId = await ctx.db.insert("workspaceItems", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      type: args.type,
      renderMode: args.renderMode,
      sourceChatId: args.sourceChatId,
      sourceArtifactId: args.sourceArtifactId,
      sourcePlannerItemId: args.sourcePlannerItemId,
      title: normalizeTitle(args.title),
      contentSummary: args.contentSummary?.trim() || undefined,
      x: Math.round(args.x),
      y: Math.round(args.y),
      width: args.width ? Math.round(args.width) : undefined,
      height: args.height ? Math.round(args.height) : undefined,
      status: "active",
      pinned: args.pinned ?? false,
      createdAt: now,
      updatedAt: now,
    });

    return { itemId };
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    itemId: v.id("workspaceItems"),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    title: v.optional(v.string()),
    contentSummary: v.optional(v.string()),
    renderMode: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertOwnership(ctx, actor, args.itemId);

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.x !== undefined) updates.x = Math.round(args.x);
    if (args.y !== undefined) updates.y = Math.round(args.y);
    if (args.width !== undefined) updates.width = Math.round(args.width);
    if (args.height !== undefined) updates.height = Math.round(args.height);
    if (args.title !== undefined) updates.title = normalizeTitle(args.title);
    if (args.contentSummary !== undefined) {
      updates.contentSummary = args.contentSummary.trim() || undefined;
    }
    if (args.renderMode !== undefined) updates.renderMode = args.renderMode;
    if (args.status !== undefined) updates.status = args.status;
    if (args.pinned !== undefined) updates.pinned = args.pinned;

    await ctx.db.patch(args.itemId, updates);
    return { success: true };
  },
});

export const remove = mutation({
  args: {
    actorClerkId: v.string(),
    itemId: v.id("workspaceItems"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertOwnership(ctx, actor, args.itemId);
    await ctx.db.delete(args.itemId);
    return { success: true };
  },
});

export const batchUpdatePositions = mutation({
  args: {
    actorClerkId: v.string(),
    positions: v.array(v.object({
      itemId: v.id("workspaceItems"),
      x: v.number(),
      y: v.number(),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const now = Date.now();
    let updated = 0;

    for (const item of args.positions) {
      try {
        await assertOwnership(ctx, actor, item.itemId);
        await ctx.db.patch(item.itemId, {
          x: Math.round(item.x),
          y: Math.round(item.y),
          width: item.width !== undefined ? Math.round(item.width) : undefined,
          height: item.height !== undefined ? Math.round(item.height) : undefined,
          updatedAt: now,
        });
        updated += 1;
      } catch {
        // Ignore foreign or missing items so bulk drag stays resilient.
      }
    }

    return { success: true, count: updated };
  },
});

export const syncArtifactWidgets = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await validateWorkstream(ctx, actor, args.workstreamId);

    const [artifacts, items] = await Promise.all([
      ctx.db
        .query("artifacts")
        .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
        .collect(),
      ctx.db
        .query("workspaceItems")
        .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
        .collect(),
    ]);

    const activeArtifacts = artifacts.filter((artifact) => (
      artifact.ownerUserId === actor._id
      && artifact.orgId === actor.orgId
      && artifact.status === "active"
    ));
    const artifactIds = new Set(activeArtifacts.map((artifact) => artifact._id));
    let createdCount = 0;
    let updatedCount = 0;

    for (const artifact of activeArtifacts) {
      const existing = items.find((item) => (
        item.ownerUserId === actor._id
        && item.orgId === actor.orgId
        && item.sourceArtifactId === artifact._id
      ));
      await syncWorkspaceItemForArtifact(ctx, {
        artifactId: artifact._id,
        ownerUserId: actor._id,
        orgId: actor.orgId,
        workstreamId: args.workstreamId,
        status: artifact.status,
        title: artifact.title,
        artifactType: artifact.type,
        contentPlaintext: artifact.contentPlaintext,
      });
      if (existing) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }
    }

    const now = Date.now();
    for (const item of items) {
      if (
        item.ownerUserId !== actor._id
        || item.orgId !== actor.orgId
        || !item.sourceArtifactId
        || !item.workstreamId
        || item.status === "archived"
        || artifactIds.has(item.sourceArtifactId)
      ) {
        continue;
      }
      await ctx.db.patch(item._id, {
        status: "archived",
        updatedAt: now,
      });
      updatedCount += 1;
    }

    return { success: true, createdCount, updatedCount };
  },
});
