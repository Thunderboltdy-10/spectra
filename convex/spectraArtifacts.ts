import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  buildArtifactTextIndex,
  defaultArtifactContent,
  fallbackArtifactSummary,
  normalizeArtifactId,
  requireOwnedArtifact,
  requireOwnedWorkspace,
  requireSpectraActor,
  vArtifactStatus,
  vBlueprintKey,
  vCreatedFromSource,
  type BlueprintKey,
} from "./spectraShared";

async function listPlacementsForArtifact(ctx: Parameters<typeof requireSpectraActor>[0], artifactId: Id<"spectraArtifacts">) {
  const items = await ctx.db
    .query("spectraWorkspaceItems")
    .withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", artifactId))
    .collect();

  const visibleItems = items.filter((item) => item.viewData.hidden !== true);
  const placements = await Promise.all(
    visibleItems.map(async (item) => {
      const workspace = await ctx.db.get(item.workspaceId);
      if (!workspace || workspace.status !== "active") return null;
      return {
        workspaceId: workspace._id,
        workspaceTitle: workspace.title,
        workspaceItemId: item._id,
        pinned: item.viewData.pinned === true,
      };
    }),
  );
  return placements.filter((placement): placement is NonNullable<typeof placement> => Boolean(placement));
}

export const list = query({
  args: {
    actorClerkId: v.string(),
    status: v.optional(vArtifactStatus),
    blueprintKey: v.optional(vBlueprintKey),
    placement: v.optional(v.union(v.literal("all"), v.literal("inbox"), v.literal("workspace"))),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 80, 150));
    const baseStatus = args.status ?? "active";
    const blueprintKey = args.blueprintKey;
    const rows = blueprintKey
      ? await ctx.db
        .query("spectraArtifacts")
        .withIndex("by_owner_blueprint", (q) => q.eq("ownerUserId", actor._id).eq("blueprintKey", blueprintKey))
        .order("desc")
        .take(limit * 3)
      : await ctx.db
        .query("spectraArtifacts")
        .withIndex("by_owner_status_updated", (q) => q.eq("ownerUserId", actor._id).eq("status", baseStatus))
        .order("desc")
        .take(limit * 3);

    const needle = args.search?.trim().toLowerCase();
    const activeWorkspaces = await ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_owner_status", (q) => q.eq("ownerUserId", actor._id).eq("status", "active"))
      .collect();
    const placementRows = (await Promise.all(activeWorkspaces
      .filter((workspace) => workspace.orgId === actor.orgId)
      .map(async (workspace) => ({
        workspace,
        items: await ctx.db.query("spectraWorkspaceItems").withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id)).collect(),
      })))).flatMap(({ workspace, items }) => items
        .filter((item) => item.sourceType === "artifact" && item.viewData.hidden !== true)
        .map((item) => ({ sourceId: item.sourceId, workspaceId: workspace._id, workspaceTitle: workspace.title, workspaceItemId: item._id, pinned: item.viewData.pinned === true })));
    const placementsByArtifact = new Map<string, typeof placementRows>();
    for (const placement of placementRows) placementsByArtifact.set(placement.sourceId, [...(placementsByArtifact.get(placement.sourceId) ?? []), placement]);

    const artifacts = rows
        .filter((artifact) => artifact.orgId === actor.orgId)
        .filter((artifact) => artifact.status === baseStatus)
        .filter((artifact) => !needle || `${artifact.title}\n${artifact.summary ?? ""}\n${artifact.blueprintKey}\n${artifact.textIndex ?? ""}\n${(placementsByArtifact.get(artifact._id) ?? []).map((placement) => placement.workspaceTitle).join("\n")}`.toLowerCase().includes(needle))
        .map((artifact) => {
          const placements = placementsByArtifact.get(artifact._id) ?? [];
          return {
            ...artifact,
            placements,
            placementStatus: placements.length > 0 ? "workspace" : "inbox",
          };
        });

    return artifacts
      .filter((artifact) => {
        if (!args.placement || args.placement === "all") return true;
        return artifact.placementStatus === args.placement;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  },
});

export const get = query({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireOwnedArtifact(ctx, args.actorClerkId, args.artifactId);
    if (artifact.orgId !== actor.orgId) throw new Error("Artifact not found");
    const placements = await listPlacementsForArtifact(ctx, args.artifactId);
    return {
      ...artifact,
      placements,
      placementStatus: placements.length > 0 ? "workspace" : "inbox",
    };
  },
});

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    blueprintKey: vBlueprintKey,
    title: v.string(),
    summary: v.optional(v.string()),
    content: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    source: v.optional(vCreatedFromSource),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    runId: v.optional(v.id("spectraAiRuns")),
    threadId: v.optional(v.id("spectraThreads")),
    sourceArtifactIds: v.optional(v.array(v.id("spectraArtifacts"))),
    sourceThreadIds: v.optional(v.array(v.id("spectraThreads"))),
    sourceAttachmentNames: v.optional(v.array(v.string())),
    contextSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx, args.actorClerkId);
    if (args.workspaceId) {
      await requireOwnedWorkspace(ctx, args.actorClerkId, args.workspaceId);
    }
    for (const sourceArtifactId of args.sourceArtifactIds ?? []) await requireOwnedArtifact(ctx, args.actorClerkId, sourceArtifactId);
    const now = Date.now();
    const title = args.title.trim() || "Untitled artifact";
    const summary = args.summary?.trim() || fallbackArtifactSummary(args.blueprintKey as BlueprintKey);
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      blueprintKey: args.blueprintKey,
      title,
      summary,
      content: args.content ?? defaultArtifactContent(args.blueprintKey as BlueprintKey),
      textIndex: buildArtifactTextIndex({ title, summary, content: args.content, tags: args.tags }),
      tags: args.tags ?? [],
      status: "active",
      createdFrom: {
        source: args.source ?? (args.workspaceId ? "workspace" : "manual"),
        workspaceId: args.workspaceId,
        runId: args.runId,
        threadId: args.threadId,
        sourceArtifactIds: args.sourceArtifactIds?.slice(0, 12),
        sourceThreadIds: args.sourceThreadIds?.slice(0, 4),
        sourceAttachmentNames: args.sourceAttachmentNames?.map((name) => name.slice(0, 180)).slice(0, 8),
        contextSummary: args.contextSummary?.slice(0, 400),
      },
      createdAt: now,
      updatedAt: now,
    });

    let workspaceItemId: Id<"spectraWorkspaceItems"> | undefined;
    if (args.workspaceId) {
      workspaceItemId = await ctx.db.insert("spectraWorkspaceItems", {
        workspaceId: args.workspaceId,
        sourceType: "artifact",
        sourceId: artifactId,
        viewData: {
          compactSummary: summary,
          hidden: false,
        },
        layout: {
          view: "cards",
        },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(args.workspaceId, {
        updatedAt: now,
        lastActivityAt: now,
      });
    }

    return { artifactId, workspaceItemId };
  },
});

export const listVersions = query({
  args: { actorClerkId: v.string(), artifactId: v.id("spectraArtifacts"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOwnedArtifact(ctx, args.actorClerkId, args.artifactId);
    return ctx.db.query("spectraArtifactVersions")
      .withIndex("by_artifact_created", (q) => q.eq("artifactId", args.artifactId))
      .order("desc")
      .take(Math.max(1, Math.min(args.limit ?? 30, 100)));
  },
});

export const revertVersion = mutation({
  args: { actorClerkId: v.string(), artifactId: v.id("spectraArtifacts"), versionId: v.id("spectraArtifactVersions") },
  handler: async (ctx, args) => {
    const { artifact } = await requireOwnedArtifact(ctx, args.actorClerkId, args.artifactId);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.artifactId !== args.artifactId || version.ownerUserId !== artifact.ownerUserId) throw new Error("Artifact version not found");
    const target = version.before as { title: string; summary?: string; content: unknown; tags: string[] };
    const now = Date.now();
    await ctx.db.insert("spectraArtifactVersions", {
      artifactId: args.artifactId,
      ownerUserId: artifact.ownerUserId,
      source: "revert",
      before: { title: artifact.title, summary: artifact.summary, content: artifact.content, tags: artifact.tags },
      after: target,
      summary: `Reverted change from ${new Date(version.createdAt).toISOString()}`,
      createdAt: now,
    });
    await ctx.db.patch(args.artifactId, {
      title: target.title,
      summary: target.summary,
      content: target.content,
      tags: target.tags,
      textIndex: buildArtifactTextIndex(target),
      updatedAt: now,
    });
    return { artifactId: args.artifactId };
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("spectraArtifacts"),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    content: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    source: v.optional(v.union(v.literal("manual"), v.literal("ai"), v.literal("revert"))),
    runId: v.optional(v.id("spectraAiRuns")),
  },
  handler: async (ctx, args) => {
    const { artifact } = await requireOwnedArtifact(ctx, args.actorClerkId, args.artifactId);
    const title = args.title === undefined ? artifact.title : args.title.trim() || "Untitled artifact";
    const summary = args.summary === undefined ? artifact.summary : args.summary.trim() || undefined;
    const tags = args.tags ?? artifact.tags;
    const now = Date.now();
    const before = { title: artifact.title, summary: artifact.summary, content: artifact.content, tags: artifact.tags };
    const after = { title, summary, content: args.content === undefined ? artifact.content : args.content, tags };
    if (JSON.stringify(before) === JSON.stringify(after)) return { artifactId: args.artifactId };
    await ctx.db.insert("spectraArtifactVersions", {
      artifactId: args.artifactId,
      ownerUserId: artifact.ownerUserId,
      source: args.source ?? "manual",
      runId: args.runId,
      before,
      after,
      summary: args.source === "ai" ? "AI-applied artifact edit" : args.source === "revert" ? "Reverted artifact version" : "Manual artifact edit",
      createdAt: now,
    });
    await ctx.db.patch(args.artifactId, {
      title,
      summary,
      content: args.content === undefined ? artifact.content : args.content,
      tags,
      textIndex: buildArtifactTextIndex({ title, summary, content: after.content, tags }),
      updatedAt: now,
    });
    const placements = await ctx.db
      .query("spectraWorkspaceItems")
      .withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", args.artifactId))
      .collect();
    await Promise.all(placements.filter((placement) => placement.viewData.hidden !== true).flatMap((placement) => [
      ctx.db.patch(placement._id, { updatedAt: now }),
      ctx.db.patch(placement.workspaceId, { updatedAt: now, lastActivityAt: now }),
    ]));
    return { artifactId: args.artifactId };
  },
});

export const archive = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    await requireOwnedArtifact(ctx, args.actorClerkId, args.artifactId);
    await ctx.db.patch(args.artifactId, {
      status: "archived",
      updatedAt: Date.now(),
    });
    return { artifactId: args.artifactId };
  },
});

export const permanentlyDelete = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    await requireOwnedArtifact(ctx, args.actorClerkId, args.artifactId);

    const placements = await ctx.db
      .query("spectraWorkspaceItems")
      .withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", args.artifactId))
      .collect();
    await Promise.all(placements.map((placement) => ctx.db.delete(placement._id)));

    const versions = await ctx.db.query("spectraArtifactVersions").withIndex("by_artifact_created", (q) => q.eq("artifactId", args.artifactId)).collect();
    const [outgoingLinks, incomingLinks] = await Promise.all([
      ctx.db.query("spectraArtifactLinks").withIndex("by_source", (q) => q.eq("sourceArtifactId", args.artifactId)).collect(),
      ctx.db.query("spectraArtifactLinks").withIndex("by_target", (q) => q.eq("targetArtifactId", args.artifactId)).collect(),
    ]);
    const linkRows = [...new Map([...outgoingLinks, ...incomingLinks].map((link) => [link._id, link])).values()];
    await Promise.all([...versions.map((version) => ctx.db.delete(version._id)), ...linkRows.map((link) => ctx.db.delete(link._id))]);

    const runs = await ctx.db
      .query("spectraAiRuns")
      .withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId))
      .collect();
    for (const run of runs) {
      const [operations, cards] = await Promise.all([
        ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
        ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
      ]);
      await Promise.all([...operations.map((operation) => ctx.db.delete(operation._id)), ...cards.map((card) => ctx.db.delete(card._id))]);
      await ctx.db.delete(run._id);
    }

    await ctx.db.delete(args.artifactId);
    return { artifactId: args.artifactId, placementCount: placements.length, runCount: runs.length };
  },
});

export const artifactStillExists = query({
  args: {
    actorClerkId: v.string(),
    artifactId: v.string(),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeArtifactId(ctx, args.artifactId);
    if (!normalized) return false;
    const { artifact } = await requireOwnedArtifact(ctx, args.actorClerkId, normalized);
    return artifact.status !== "deleted";
  },
});
