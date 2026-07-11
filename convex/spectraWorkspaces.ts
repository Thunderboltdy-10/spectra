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

function liveWorkspace<T extends { title: string; description?: string; icon?: string; color?: string; aiState?: string; aiStateExpiresAt?: number; aiPreview?: { title?: string; description?: string; icon?: string; color?: string } }>(workspace: T) {
  if (workspace.aiState === "edited" && workspace.aiStateExpiresAt && workspace.aiStateExpiresAt <= Date.now()) return { ...workspace, aiState: undefined };
  return workspace.aiState === "updating" && workspace.aiPreview ? { ...workspace, title: workspace.aiPreview.title ?? workspace.title, description: workspace.aiPreview.description ?? workspace.description, icon: workspace.aiPreview.icon ?? workspace.icon, color: workspace.aiPreview.color ?? workspace.color } : workspace;
}

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
      .slice(0, limit)
      .map(liveWorkspace);
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
    runId: v.optional(v.id("spectraAiRuns")),
    executionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireOwnedWorkspace(ctx, args.actorClerkId, args.workspaceId);
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (!run || run.ownerUserId !== workspace.ownerUserId || run.status !== "running" || !args.executionId || run.executionId !== args.executionId) throw new Error("AI run not found");
    }
    const patch: {
      title?: string;
      description?: string;
      icon?: string;
      color?: string;
      defaultView?: "cards" | "canvas" | "timeline" | "library";
      updatedAt: number;
      lastActivityAt: number;
      aiState?: "edited";
      aiRunId?: undefined;
      aiExecutionId?: undefined;
      aiPreview?: undefined;
      aiStateExpiresAt?: number;
    } = {
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
      aiState: args.runId ? "edited" : undefined,
      aiRunId: undefined,
      aiExecutionId: undefined,
      aiPreview: undefined,
      aiStateExpiresAt: args.runId ? Date.now() + 8_000 : undefined,
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

export const createPending = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), executionId: v.string(), title: v.string(), description: v.optional(v.string()), icon: v.optional(v.string()), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx, args.actorClerkId);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerUserId !== actor._id || run.orgId !== actor.orgId || run.status !== "running" || run.executionId !== args.executionId) throw new Error("AI run not found");
    const now = Date.now();
    const workspaceId = await ctx.db.insert("spectraWorkspaces", { ownerUserId: actor._id, orgId: actor.orgId, title: args.title.trim() || "New workspace", description: args.description?.trim() || "Awaiting your approval", icon: args.icon ?? "Sparkles", color: args.color ?? "cyan", status: "active", defaultView: "library", aiState: "creating", aiRunId: args.runId, aiExecutionId: args.executionId, aiPending: true, createdAt: now, updatedAt: now, lastActivityAt: now });
    return { workspaceId };
  },
});

export const finalizePending = mutation({
  args: { actorClerkId: v.string(), workspaceId: v.id("spectraWorkspaces"), runId: v.id("spectraAiRuns"), executionId: v.string(), title: v.string(), description: v.optional(v.string()), icon: v.optional(v.string()), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { workspace } = await requireOwnedWorkspace(ctx, args.actorClerkId, args.workspaceId);
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running" || run.executionId !== args.executionId || workspace.aiRunId !== args.runId || workspace.aiExecutionId !== args.executionId || workspace.aiState !== "creating") throw new Error("This pending workspace is no longer available.");
    const now = Date.now();
    await ctx.db.patch(args.workspaceId, { title: args.title.trim() || workspace.title, description: args.description?.trim() || undefined, icon: args.icon ?? workspace.icon, color: args.color ?? workspace.color, aiState: "edited", aiStateExpiresAt: now + 8_000, aiRunId: undefined, aiExecutionId: undefined, aiPending: undefined, aiPreview: undefined, updatedAt: now, lastActivityAt: now });
    return { workspaceId: args.workspaceId };
  },
});

export const stageAiPatch = mutation({
  args: { actorClerkId: v.string(), workspaceId: v.id("spectraWorkspaces"), runId: v.id("spectraAiRuns"), executionId: v.string(), title: v.optional(v.string()), description: v.optional(v.string()), icon: v.optional(v.string()), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { workspace } = await requireOwnedWorkspace(ctx, args.actorClerkId, args.workspaceId);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerUserId !== workspace.ownerUserId || run.status !== "running" || run.executionId !== args.executionId) throw new Error("AI run not found");
    await ctx.db.patch(args.workspaceId, { aiState: "updating", aiRunId: args.runId, aiExecutionId: args.executionId, aiPreview: { title: args.title, description: args.description, icon: args.icon, color: args.color, startedAt: Date.now() }, updatedAt: Date.now() });
    return { workspaceId: args.workspaceId };
  },
});

export const settleForRun = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), executionId: v.string(), outcome: v.union(v.literal("clear"), v.literal("failed")) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx, args.actorClerkId);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerUserId !== actor._id || run.orgId !== actor.orgId || run.executionId !== args.executionId) throw new Error("This run attempt is no longer active.");
    const rows = await ctx.db.query("spectraWorkspaces").withIndex("by_owner_activity", (q) => q.eq("ownerUserId", actor._id)).collect();
    const affected = rows.filter((workspace) => workspace.orgId === actor.orgId && workspace.aiRunId === args.runId && workspace.aiExecutionId === args.executionId);
    const now = Date.now();
    for (const workspace of affected) {
      if (workspace.aiPending) {
        await ctx.db.delete(workspace._id);
      } else await ctx.db.patch(workspace._id, args.outcome === "clear" ? { aiState: undefined, aiRunId: undefined, aiExecutionId: undefined, aiPreview: undefined, updatedAt: now } : { aiState: "failed", updatedAt: now });
    }
    return { settled: affected.length };
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
          const [outgoingLinks, incomingLinks, versions] = await Promise.all([
            ctx.db.query("spectraArtifactLinks").withIndex("by_source", (q) => q.eq("sourceArtifactId", artifact)).collect(),
            ctx.db.query("spectraArtifactLinks").withIndex("by_target", (q) => q.eq("targetArtifactId", artifact)).collect(),
            ctx.db.query("spectraArtifactVersions").withIndex("by_artifact_created", (q) => q.eq("artifactId", artifact)).collect(),
          ]);
          const linkedRows = [...new Map([...outgoingLinks, ...incomingLinks].map((link) => [link._id, link])).values()];
          await Promise.all([...linkedRows.map((link) => ctx.db.delete(link._id)), ...versions.map((version) => ctx.db.delete(version._id))]);
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
