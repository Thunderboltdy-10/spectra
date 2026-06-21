import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  requireOwnedWorkspace,
  requireSpectraActor,
} from "./spectraShared";

const vDefaultView = v.union(
  v.literal("cards"),
  v.literal("canvas"),
  v.literal("timeline"),
  v.literal("library"),
);

export const list = query({
  args: {
    actorClerkId: v.string(),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 30, 100));
    const workspaces = await ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_owner_activity", (q) => q.eq("ownerUserId", actor._id))
      .order("desc")
      .take(limit * 2);
    return workspaces
      .filter((workspace) => workspace.orgId === actor.orgId)
      .filter((workspace) => args.includeArchived || workspace.status === "active")
      .slice(0, limit);
  },
});

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    defaultView: v.optional(vDefaultView),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx, args.actorClerkId);
    const now = Date.now();
    return ctx.db.insert("spectraWorkspaces", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      title: args.title.trim() || "Untitled workspace",
      description: args.description?.trim() || undefined,
      icon: args.icon?.trim() || "Sparkles",
      color: args.color?.trim() || "cyan",
      status: "active",
      defaultView: args.defaultView ?? "library",
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    workspaceId: v.id("spectraWorkspaces"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    defaultView: v.optional(vDefaultView),
  },
  handler: async (ctx, args) => {
    await requireOwnedWorkspace(ctx, args.actorClerkId, args.workspaceId);
    const patch: {
      title?: string;
      description?: string;
      icon?: string;
      color?: string;
      defaultView?: "cards" | "canvas" | "timeline" | "library";
      updatedAt: number;
      lastActivityAt: number;
    } = {
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    if (args.title !== undefined) patch.title = args.title.trim() || "Untitled workspace";
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.icon !== undefined) patch.icon = args.icon.trim() || undefined;
    if (args.color !== undefined) patch.color = args.color.trim() || undefined;
    if (args.defaultView !== undefined) patch.defaultView = args.defaultView;
    await ctx.db.patch(args.workspaceId, patch);
    return { workspaceId: args.workspaceId };
  },
});

export const archive = mutation({
  args: {
    actorClerkId: v.string(),
    workspaceId: v.id("spectraWorkspaces"),
  },
  handler: async (ctx, args) => {
    await requireOwnedWorkspace(ctx, args.actorClerkId, args.workspaceId);
    await ctx.db.patch(args.workspaceId, {
      status: "archived",
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    return { workspaceId: args.workspaceId };
  },
});
