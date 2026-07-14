import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  normalizeArtifactId,
  requireArtifactCapability,
  requireWorkspaceCapability,
  requireSpectraActor,
} from "./spectraShared";
import { evaluateAccess } from "./authorityShared";

async function hydrateWorkspaceItem(ctx: Parameters<typeof requireSpectraActor>[0], item: {
  _id: Id<"spectraWorkspaceItems">;
  workspaceId: Id<"spectraWorkspaces">;
  sourceType: "artifact" | "thread" | "task" | "widget" | "custom";
  sourceId: string;
  viewData: {
    titleOverride?: string;
    compactSummary?: string;
    cardVariant?: string;
    pinned?: boolean;
    hidden?: boolean;
  };
  layout: {
    view: "cards" | "canvas" | "timeline";
    position?: { x: number; y: number };
    size?: { w: number; h: number };
    zIndex?: number;
    collapsed?: boolean;
  };
  createdAt: number;
  updatedAt: number;
}, workspaceTitle?: string) {
  if (item.sourceType === "artifact") {
    const artifactId = normalizeArtifactId(ctx, item.sourceId);
    const candidate = artifactId ? await ctx.db.get(artifactId) : null;
    const resourceType = candidate?.blueprintKey === "agent" ? "agent" as const : "artifact" as const;
    const decision = artifactId ? await evaluateAccess(ctx, resourceType, artifactId) : null;
    const artifact = decision?.allowed ? decision.loaded.resource : null;
    const actor = await requireSpectraActor(ctx);
    const ownership = artifact?.ownerAccountId === actor.accountId ? "owned" as const : "shared" as const;
    const invitations = artifact
      ? await ctx.db.query("shareInvitations").withIndex("by_resource", (q) => q.eq("resourceType", resourceType).eq("resourceId", artifact._id)).collect()
      : [];
    const activeInvitations = invitations.filter((invitation) => (invitation.status === "pending" || invitation.status === "accepted") && (!invitation.expiresAt || invitation.expiresAt > Date.now()));
    return {
      ...item,
      thread: null,
      artifact: artifact && artifact.status !== "deleted" ? {
        ...artifact,
        ownership,
        accessLevel: decision?.level ?? null,
        accessReason: decision?.reason,
        isShared: ownership === "shared" || activeInvitations.length > 0,
        sharedWithCount: ownership === "owned" ? new Set(activeInvitations.map((invitation) => invitation.inviteeAccountId)).size : undefined,
        placements: [{
          workspaceId: item.workspaceId,
          workspaceTitle: workspaceTitle ?? "Workspace",
          workspaceItemId: item._id,
        }],
        placementStatus: "workspace" as const,
      } : null,
    };
  }
  if (item.sourceType === "thread") {
    const threadId = ctx.db.normalizeId("spectraThreads", item.sourceId);
    const thread = threadId ? await ctx.db.get(threadId) : null;
    const run = thread?.lastRunId ? await ctx.db.get(thread.lastRunId) : null;
    return {
      ...item,
      artifact: null,
      thread: thread && thread.status !== "deleted" && thread.workspaceId === item.workspaceId
        ? { ...thread, run }
        : null,
    };
  }
  return {
    ...item,
    artifact: null,
    thread: null,
  };
}

async function listAccessibleWorkspaceItems(
  ctx: Parameters<typeof requireSpectraActor>[0],
  workspaceId: Id<"spectraWorkspaces">,
  includeHidden?: boolean,
) {
  const { workspace } = await requireWorkspaceCapability(ctx, workspaceId);
  const items = await ctx.db
    .query("spectraWorkspaceItems")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .order("desc")
    .collect();
  const hydrated = await Promise.all(
    items
      .filter((item) => includeHidden || item.viewData.hidden !== true)
      .map((item) => hydrateWorkspaceItem(ctx, item, workspace.title)),
  );
  const settledWorkspace = workspace.aiState === "edited" && workspace.aiStateExpiresAt && workspace.aiStateExpiresAt <= Date.now() ? { ...workspace, aiState: undefined } : workspace;
  const visibleWorkspace = settledWorkspace.aiState === "updating" && settledWorkspace.aiPreview ? { ...settledWorkspace, title: settledWorkspace.aiPreview.title ?? settledWorkspace.title, description: settledWorkspace.aiPreview.description ?? settledWorkspace.description, icon: settledWorkspace.aiPreview.icon ?? settledWorkspace.icon, color: settledWorkspace.aiPreview.color ?? settledWorkspace.color } : settledWorkspace;
  return {
    workspace: visibleWorkspace,
    items: hydrated
      .filter((item) => item.sourceType === "artifact" ? item.artifact : item.sourceType === "thread" ? item.thread : true)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

export const listForWorkspace = query({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    includeHidden: v.optional(v.boolean()),
  },
  handler: (ctx, args) => listAccessibleWorkspaceItems(ctx, args.workspaceId, args.includeHidden),
});

// HTTP query-string ids are untrusted. Normalize before entering a table-typed
// validator so a stale widget/item id becomes a controlled miss, not a Convex
// ArgumentValidationError for spectraWorkspaces.
export const listForWorkspacePublic = query({
  args: {
    workspaceId: v.string(),
    includeHidden: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const workspaceId = ctx.db.normalizeId("spectraWorkspaces", args.workspaceId);
    if (!workspaceId) return null;
    try {
      return await listAccessibleWorkspaceItems(ctx, workspaceId, args.includeHidden);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("workspace not found")) return null;
      throw error;
    }
  },
});

export const addArtifact = mutation({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireWorkspaceCapability(ctx, args.workspaceId, "modify");
    const { artifact, capabilities } = await requireArtifactCapability(ctx, args.artifactId);
    const canProjectAccess = capabilities.includes("share");
    const now = Date.now();
    const existing = await ctx.db
      .query("spectraWorkspaceItems")
      .withIndex("by_workspace_source", (q) => q
        .eq("workspaceId", args.workspaceId)
        .eq("sourceType", "artifact")
        .eq("sourceId", args.artifactId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        placedByAccountId: existing.placedByAccountId ?? actor.accountId,
        // Never downgrade a deliberate owner/sharer projection, and never let
        // a recipient placement promote itself into an access grant.
        accessProjection: existing.accessProjection === true || canProjectAccess,
        viewData: {
          ...existing.viewData,
          compactSummary: existing.viewData.compactSummary ?? artifact.summary,
          hidden: false,
        },
        updatedAt: now,
      });
      await ctx.db.patch(args.workspaceId, { updatedAt: now, lastActivityAt: now });
      return { workspaceItemId: existing._id, created: false };
    }

    const workspaceItemId = await ctx.db.insert("spectraWorkspaceItems", {
      workspaceId: args.workspaceId,
      sourceType: "artifact",
      sourceId: args.artifactId,
      placedByAccountId: actor.accountId,
      accessProjection: canProjectAccess,
      viewData: {
        compactSummary: artifact.summary,
        hidden: false,
      },
      layout: {
        view: "cards",
      },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.workspaceId, { updatedAt: now, lastActivityAt: now });
    return { workspaceItemId, created: true };
  },
});

export const hide = mutation({
  args: {
    workspaceItemId: v.id("spectraWorkspaceItems"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.workspaceItemId);
    if (!item) throw new Error("Workspace item not found");
    await requireWorkspaceCapability(ctx, item.workspaceId, "modify");
    const now = Date.now();
    await ctx.db.patch(args.workspaceItemId, {
      viewData: {
        ...item.viewData,
        hidden: true,
      },
      updatedAt: now,
    });
    await ctx.db.patch(item.workspaceId, { updatedAt: now, lastActivityAt: now });

    let artifactStillExists = true;
    if (item.sourceType === "artifact") {
      const artifactId = normalizeArtifactId(ctx, item.sourceId);
      const artifact = artifactId ? await ctx.db.get(artifactId) : null;
      artifactStillExists = Boolean(artifact && artifact.status !== "deleted");
    }

    return {
      workspaceItemId: args.workspaceItemId,
      workspaceId: item.workspaceId,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      artifactStillExists,
    };
  },
});

export const setPinned = mutation({
  args: {
    workspaceItemId: v.id("spectraWorkspaceItems"),
    pinned: v.boolean(),
    exclusive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.workspaceItemId);
    if (!item) throw new Error("Workspace item not found");
    await requireWorkspaceCapability(ctx, item.workspaceId, "modify");
    const now = Date.now();
    if (args.pinned && args.exclusive) {
      const siblings = await ctx.db.query("spectraWorkspaceItems").withIndex("by_workspace", (q) => q.eq("workspaceId", item.workspaceId)).collect();
      await Promise.all(siblings.filter((sibling) => sibling._id !== item._id && sibling.viewData.pinned).map((sibling) => ctx.db.patch(sibling._id, { viewData: { ...sibling.viewData, pinned: false }, updatedAt: Date.now() })));
    }
    await ctx.db.patch(args.workspaceItemId, {
      viewData: { ...item.viewData, pinned: args.pinned },
      updatedAt: now,
    });
    await ctx.db.patch(item.workspaceId, { updatedAt: now, lastActivityAt: now });
    return { workspaceItemId: args.workspaceItemId, pinned: args.pinned };
  },
});
