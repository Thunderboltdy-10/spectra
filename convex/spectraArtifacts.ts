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
        .withIndex("by_owner_status", (q) => q.eq("ownerUserId", actor._id).eq("status", baseStatus))
        .order("desc")
        .take(limit * 3);

    const needle = args.search?.trim().toLowerCase();
    const artifacts = await Promise.all(
      rows
        .filter((artifact) => artifact.orgId === actor.orgId)
        .filter((artifact) => artifact.status === baseStatus)
        .filter((artifact) => !needle || `${artifact.title}\n${artifact.summary ?? ""}\n${artifact.textIndex ?? ""}`.toLowerCase().includes(needle))
        .map(async (artifact) => {
          const placements = await listPlacementsForArtifact(ctx, artifact._id);
          return {
            ...artifact,
            placements,
            placementStatus: placements.length > 0 ? "workspace" : "inbox",
          };
        }),
    );

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
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx, args.actorClerkId);
    if (args.workspaceId) {
      await requireOwnedWorkspace(ctx, args.actorClerkId, args.workspaceId);
    }

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
      textIndex: buildArtifactTextIndex({ title, summary, tags: args.tags }),
      tags: args.tags ?? [],
      status: "active",
      createdFrom: {
        source: args.source ?? (args.workspaceId ? "workspace" : "manual"),
        workspaceId: args.workspaceId,
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

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    artifactId: v.id("spectraArtifacts"),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    content: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { artifact } = await requireOwnedArtifact(ctx, args.actorClerkId, args.artifactId);
    const title = args.title === undefined ? artifact.title : args.title.trim() || "Untitled artifact";
    const summary = args.summary === undefined ? artifact.summary : args.summary.trim() || undefined;
    const tags = args.tags ?? artifact.tags;
    await ctx.db.patch(args.artifactId, {
      title,
      summary,
      content: args.content === undefined ? artifact.content : args.content,
      tags,
      textIndex: buildArtifactTextIndex({ title, summary, tags }),
      updatedAt: Date.now(),
    });
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
