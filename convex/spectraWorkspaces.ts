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

export const permanentlyDelete = mutation({
  args: {
    actorClerkId: v.string(),
    workspaceId: v.id("spectraWorkspaces"),
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireOwnedWorkspace(ctx, args.actorClerkId, args.workspaceId);
    const expected = `Remove ${workspace.title} permanently`;
    if (args.confirmation !== expected) throw new Error(`Type “${expected}” to confirm`);

    const items = await ctx.db
      .query("spectraWorkspaceItems")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const artifactIds = Array.from(new Set(items.filter((item) => item.sourceType === "artifact").map((item) => item.sourceId)));

    let deletedArtifactCount = 0;
    for (const sourceId of artifactIds) {
      const allPlacements = await ctx.db
        .query("spectraWorkspaceItems")
        .withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", sourceId))
        .collect();
      const otherVisiblePlacements = allPlacements.filter((placement) => placement.workspaceId !== args.workspaceId && placement.viewData.hidden !== true);
      const artifact = ctx.db.normalizeId("spectraArtifacts", sourceId);
      if (artifact && otherVisiblePlacements.length === 0) {
        const document = await ctx.db.get(artifact);
        if (document) {
          const artifactRuns = await ctx.db.query("spectraAiRuns").withIndex("by_artifact", (q) => q.eq("artifactId", artifact)).collect();
          for (const run of artifactRuns) {
            const [operations, cards] = await Promise.all([
              ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
              ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
            ]);
            await Promise.all([...operations.map((operation) => ctx.db.delete(operation._id)), ...cards.map((card) => ctx.db.delete(card._id))]);
            await ctx.db.delete(run._id);
          }
          await Promise.all(allPlacements.map((placement) => ctx.db.delete(placement._id)));
          await ctx.db.delete(artifact);
          deletedArtifactCount += 1;
        }
      } else if (artifact) {
        const document = await ctx.db.get(artifact);
        if (document?.createdFrom?.workspaceId === args.workspaceId) {
          await ctx.db.patch(artifact, { createdFrom: { ...document.createdFrom, workspaceId: undefined } });
        }
      }
    }

    await Promise.all(items.map(async (item) => {
      const current = await ctx.db.get(item._id);
      if (current) await ctx.db.delete(item._id);
    }));

    const runs = await ctx.db
      .query("spectraAiRuns")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const run of runs) {
      const [operations, cards] = await Promise.all([
        ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
        ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
      ]);
      await Promise.all([...operations.map((operation) => ctx.db.delete(operation._id)), ...cards.map((card) => ctx.db.delete(card._id))]);
      await ctx.db.delete(run._id);
    }

    await ctx.db.delete(args.workspaceId);
    return { workspaceId: args.workspaceId, deletedArtifactCount, deletedRunCount: runs.length };
  },
});
