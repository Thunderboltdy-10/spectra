import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
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

export const list = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.union(v.id("workstreams"), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);

    if (args.workstreamId) {
      return ctx.db
        .query("workspaceItems")
        .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId!))
        .filter((q) => q.eq(q.field("status"), "active"))
        .collect();
    }

    return ctx.db
      .query("workspaceItems")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
  },
});

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    type: v.union(
      v.literal("thread"),
      v.literal("document"),
      v.literal("planner"),
      v.literal("board"),
      v.literal("visualization"),
      v.literal("media"),
      v.literal("reference"),
      v.literal("custom"),
      v.literal("utility"),
    ),
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
      title: args.title.trim() || "Untitled Item",
      contentSummary: args.contentSummary,
      x: args.x,
      y: args.y,
      width: args.width,
      height: args.height,
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
    if (args.x !== undefined) updates.x = args.x;
    if (args.y !== undefined) updates.y = args.y;
    if (args.width !== undefined) updates.width = args.width;
    if (args.height !== undefined) updates.height = args.height;
    if (args.title !== undefined) updates.title = args.title.trim() || "Untitled Item";
    if (args.contentSummary !== undefined) updates.contentSummary = args.contentSummary;
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

    for (const item of args.positions) {
      try {
        await assertOwnership(ctx, actor, item.itemId);
        const updates: {
          x: number;
          y: number;
          updatedAt: number;
          width?: number;
          height?: number;
        } = {
          x: Math.round(item.x),
          y: Math.round(item.y),
          updatedAt: now,
        };
        if (item.width !== undefined) updates.width = Math.round(item.width);
        if (item.height !== undefined) updates.height = Math.round(item.height);
        
        await ctx.db.patch(item.itemId, updates);
      } catch {
        // Skip items that don't belong to the user or don't exist
      }
    }

    return { success: true, count: args.positions.length };
  },
});
