import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { syncWorkspaceItemForArtifact } from "./workspaceItemSync";
import {
  assertWorkspaceItemOwnership,
  normalizeWorkspaceTitle,
  recordWorkspaceMutation,
  requireWorkspaceActor,
  resolveCanonicalWorkspaceItemType,
  normalizeCanonicalWorkspaceItemType,
  resolveWorkspaceCategory,
  resolveWorkspaceSourceId,
  resolveWorkspaceSourceKind,
  summarizeWorkspaceContent,
  validateWorkspaceSourceArtifact,
  validateWorkspaceSourceChat,
  validateWorkspaceSourcePlannerItem,
  validateWorkspaceWorkstream,
} from "./workspaceHelpers";

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

const vCanonicalWorkspaceItemType = v.union(
  v.literal("thread"),
  v.literal("artifact"),
  v.literal("planner"),
  v.literal("utility"),
  v.literal("custom"),
);

const vWorkspaceItemCategory = v.union(
  v.literal("threads"),
  v.literal("documents"),
  v.literal("planner"),
  v.literal("boards"),
  v.literal("visualizations"),
  v.literal("media"),
  v.literal("references"),
  v.literal("custom"),
);

const vWorkspaceMutationSource = v.union(
  v.literal("user"),
  v.literal("ai"),
  v.literal("system"),
);

const vWorkspaceMutationStatus = v.union(
  v.literal("active"),
  v.literal("archived"),
);

function normalizeLegacyWorkspaceType(
  value: Doc<"workspaceItems">["type"] | undefined,
): Doc<"workspaceItems">["type"] {
  return value ?? "custom";
}

function buildWorkspaceItemFields(params: {
  type: Doc<"workspaceItems">["type"];
  itemType?: Doc<"workspaceItems">["itemType"];
  renderMode?: string;
  sourceChatId?: Id<"chats">;
  sourceArtifactId?: Id<"artifacts">;
  sourcePlannerItemId?: Id<"plannerItems">;
  title: string;
  contentSummary?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  zIndex?: number;
  category?: Doc<"workspaceItems">["category"];
  pinned?: boolean;
  collapsed?: boolean;
  hidden?: boolean;
  visualGroup?: string;
  renderProps?: unknown;
  provenanceSource?: Doc<"workspaceItems">["provenanceSource"];
  provenanceAction?: string;
}) {
  const itemType = resolveCanonicalWorkspaceItemType({
    legacyType: params.type,
    itemType: params.itemType,
    sourceChatId: params.sourceChatId,
    sourceArtifactId: params.sourceArtifactId,
    sourcePlannerItemId: params.sourcePlannerItemId,
  });

  return {
    type: normalizeLegacyWorkspaceType(params.type),
    itemType,
    sourceKind: resolveWorkspaceSourceKind({
      sourceChatId: params.sourceChatId,
      sourceArtifactId: params.sourceArtifactId,
      sourcePlannerItemId: params.sourcePlannerItemId,
      itemType,
    }),
    sourceId: resolveWorkspaceSourceId({
      sourceChatId: params.sourceChatId,
      sourceArtifactId: params.sourceArtifactId,
      sourcePlannerItemId: params.sourcePlannerItemId,
    }),
    renderMode: params.renderMode,
    sourceChatId: params.sourceChatId,
    sourceArtifactId: params.sourceArtifactId,
    sourcePlannerItemId: params.sourcePlannerItemId,
    title: normalizeWorkspaceTitle(params.title),
    contentSummary: summarizeWorkspaceContent(params.contentSummary),
    x: Math.round(params.x),
    y: Math.round(params.y),
    width: params.width !== undefined ? Math.round(params.width) : undefined,
    height: params.height !== undefined ? Math.round(params.height) : undefined,
    zIndex: params.zIndex,
    category: resolveWorkspaceCategory({
      explicitCategory: params.category,
      legacyType: params.type,
      renderMode: params.renderMode,
      itemType,
    }),
    pinned: params.pinned ?? false,
    collapsed: params.collapsed,
    hidden: params.hidden,
    visualGroup: params.visualGroup,
    renderProps: params.renderProps,
    provenanceSource: params.provenanceSource,
    provenanceAction: params.provenanceAction?.trim() || undefined,
  };
}

const vAttachmentItem = v.object({
  type: v.optional(vWorkspaceItemType),
  itemType: v.optional(vCanonicalWorkspaceItemType),
  sourceChatId: v.optional(v.id("chats")),
  sourceArtifactId: v.optional(v.id("artifacts")),
  sourcePlannerItemId: v.optional(v.id("plannerItems")),
  title: v.optional(v.string()),
  contentSummary: v.optional(v.string()),
  renderMode: v.optional(v.string()),
  category: v.optional(vWorkspaceItemCategory),
  x: v.optional(v.number()),
  y: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  visualGroup: v.optional(v.string()),
});

function summarizeSearchText(value: string | undefined, max = 180) {
  return summarizeWorkspaceContent(value, max);
}

export const list = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 300));

    if (args.workstreamId) {
      await validateWorkspaceWorkstream(ctx, actor, args.workstreamId);
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
    itemType: v.optional(vCanonicalWorkspaceItemType),
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
    zIndex: v.optional(v.number()),
    category: v.optional(vWorkspaceItemCategory),
    pinned: v.optional(v.boolean()),
    collapsed: v.optional(v.boolean()),
    hidden: v.optional(v.boolean()),
    visualGroup: v.optional(v.string()),
    renderProps: v.optional(v.any()),
    provenanceSource: v.optional(vWorkspaceMutationSource),
    provenanceAction: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);

    await validateWorkspaceWorkstream(ctx, actor, args.workstreamId);
    await validateWorkspaceSourceChat(ctx, actor, args.sourceChatId);
    await validateWorkspaceSourceArtifact(ctx, actor, args.sourceArtifactId);
    await validateWorkspaceSourcePlannerItem(ctx, actor, args.sourcePlannerItemId);

    const now = Date.now();
    const itemId = await ctx.db.insert("workspaceItems", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      status: "active",
      ...buildWorkspaceItemFields({
        type: args.type,
        itemType: args.itemType,
        renderMode: args.renderMode,
        sourceChatId: args.sourceChatId,
        sourceArtifactId: args.sourceArtifactId,
        sourcePlannerItemId: args.sourcePlannerItemId,
        title: args.title,
        contentSummary: args.contentSummary,
        x: args.x,
        y: args.y,
        width: args.width,
        height: args.height,
        zIndex: args.zIndex,
        category: args.category,
        pinned: args.pinned,
        collapsed: args.collapsed,
        hidden: args.hidden,
        visualGroup: args.visualGroup,
        renderProps: args.renderProps,
        provenanceSource: args.provenanceSource,
        provenanceAction: args.provenanceAction,
      }),
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
    zIndex: v.optional(v.number()),
    title: v.optional(v.string()),
    contentSummary: v.optional(v.string()),
    category: v.optional(vWorkspaceItemCategory),
    itemType: v.optional(vCanonicalWorkspaceItemType),
    renderMode: v.optional(v.string()),
    status: v.optional(vWorkspaceMutationStatus),
    pinned: v.optional(v.boolean()),
    collapsed: v.optional(v.boolean()),
    hidden: v.optional(v.boolean()),
    visualGroup: v.optional(v.string()),
    renderProps: v.optional(v.any()),
    provenanceSource: v.optional(vWorkspaceMutationSource),
    provenanceAction: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    const existing = await assertWorkspaceItemOwnership(ctx, actor, args.itemId);

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.x !== undefined) updates.x = Math.round(args.x);
    if (args.y !== undefined) updates.y = Math.round(args.y);
    if (args.width !== undefined) updates.width = Math.round(args.width);
    if (args.height !== undefined) updates.height = Math.round(args.height);
    if (args.zIndex !== undefined) updates.zIndex = Math.round(args.zIndex);
    if (args.title !== undefined) updates.title = normalizeWorkspaceTitle(args.title);
    if (args.contentSummary !== undefined) {
      updates.contentSummary = summarizeWorkspaceContent(args.contentSummary);
    }
    if (args.itemType !== undefined) {
      updates.itemType = normalizeCanonicalWorkspaceItemType(args.itemType);
      updates.sourceKind = resolveWorkspaceSourceKind({
        sourceChatId: existing.sourceChatId,
        sourceArtifactId: existing.sourceArtifactId,
        sourcePlannerItemId: existing.sourcePlannerItemId,
        itemType: updates.itemType as Doc<"workspaceItems">["itemType"],
      });
    }
    if (args.category !== undefined) updates.category = args.category;
    if (args.renderMode !== undefined) updates.renderMode = args.renderMode;
    if (args.status !== undefined) updates.status = args.status;
    if (args.pinned !== undefined) updates.pinned = args.pinned;
    if (args.collapsed !== undefined) updates.collapsed = args.collapsed;
    if (args.hidden !== undefined) updates.hidden = args.hidden;
    if (args.visualGroup !== undefined) updates.visualGroup = args.visualGroup.trim() || undefined;
    if (args.renderProps !== undefined) updates.renderProps = args.renderProps;
    if (args.provenanceSource !== undefined) updates.provenanceSource = args.provenanceSource;
    if (args.provenanceAction !== undefined) updates.provenanceAction = args.provenanceAction.trim() || undefined;
    if (args.itemType !== undefined || args.category !== undefined || args.renderMode !== undefined) {
      updates.category = resolveWorkspaceCategory({
        explicitCategory: args.category ?? existing.category,
        legacyType: existing.type,
        renderMode: args.renderMode ?? existing.renderMode,
        itemType: args.itemType ?? existing.itemType,
      });
    }

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
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    await assertWorkspaceItemOwnership(ctx, actor, args.itemId);
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
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    const now = Date.now();
    let updated = 0;

    for (const item of args.positions) {
      try {
        await assertWorkspaceItemOwnership(ctx, actor, item.itemId);
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

export const listMutations = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));

    if (args.workstreamId) {
      await validateWorkspaceWorkstream(ctx, actor, args.workstreamId);
      return ctx.db
        .query("workspaceMutations")
        .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
        .order("desc")
        .take(limit);
    }

    return ctx.db
      .query("workspaceMutations")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
      .order("desc")
      .take(limit);
  },
});

export const listMergeCandidates = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    topic: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    if (args.workstreamId) {
      await validateWorkspaceWorkstream(ctx, actor, args.workstreamId);
    }
    const limit = Math.max(1, Math.min(args.limit ?? 12, 50));
    const topic = args.topic?.trim().toLowerCase();

    const [items, chats, artifacts, plannerItems] = await Promise.all([
      ctx.db
        .query("workspaceItems")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
        .collect(),
      ctx.db
        .query("chats")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
        .collect(),
      ctx.db
        .query("artifacts")
        .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
        .order("desc")
        .take(200),
      ctx.db
        .query("plannerItems")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
        .collect(),
    ]);

    const attachedSourceKeys = new Set(
      items
        .filter((item) => item.workstreamId === args.workstreamId && item.status === "active")
        .map((item) => `${item.sourceKind ?? "unknown"}:${item.sourceId ?? item._id}`),
    );

    const matchesTopic = (...parts: Array<string | undefined>) => {
      if (!topic) return true;
      const haystack = parts.filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(topic);
    };

    const candidates = [
      ...chats
        .filter((chat) => chat.orgId === actor.orgId && !chat.deletedAt)
        .filter((chat) => matchesTopic(chat.title, chat.latestUserPrompt, chat.contextSummary))
        .map((chat) => ({
          sourceKind: "chat" as const,
          sourceId: chat._id,
          title: chat.title,
          summary: summarizeSearchText(chat.latestUserPrompt ?? chat.contextSummary ?? undefined),
          updatedAt: chat.updatedAt,
          alreadyAttached: attachedSourceKeys.has(`chat:${chat._id}`),
        })),
      ...artifacts
        .filter((artifact) => artifact.orgId === actor.orgId && artifact.status === "active")
        .filter((artifact) => artifact.workstreamId !== args.workstreamId)
        .filter((artifact) => matchesTopic(artifact.title, artifact.contentPlaintext, artifact.type))
        .map((artifact) => ({
          sourceKind: "artifact" as const,
          sourceId: artifact._id,
          title: artifact.title,
          summary: summarizeSearchText(artifact.contentPlaintext),
          updatedAt: artifact.updatedAt,
          alreadyAttached: attachedSourceKeys.has(`artifact:${artifact._id}`),
        })),
      ...plannerItems
        .filter((item) => item.orgId === actor.orgId)
        .filter((item) => item.workstreamId !== args.workstreamId)
        .filter((item) => matchesTopic(item.title, item.description))
        .map((item) => ({
          sourceKind: "plannerItem" as const,
          sourceId: item._id,
          title: item.title,
          summary: summarizeSearchText(item.description),
          updatedAt: item.updatedAt,
          alreadyAttached: attachedSourceKeys.has(`plannerItem:${item._id}`),
        })),
    ]
      .filter((candidate) => !candidate.alreadyAttached)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);

    return { candidates };
  },
});

export const createWidget = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    type: vWorkspaceItemType,
    itemType: v.optional(vCanonicalWorkspaceItemType),
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
    zIndex: v.optional(v.number()),
    category: v.optional(vWorkspaceItemCategory),
    pinned: v.optional(v.boolean()),
    collapsed: v.optional(v.boolean()),
    hidden: v.optional(v.boolean()),
    visualGroup: v.optional(v.string()),
    renderProps: v.optional(v.any()),
    provenanceSource: v.optional(vWorkspaceMutationSource),
    provenanceAction: v.optional(v.string()),
    mutationSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    await validateWorkspaceWorkstream(ctx, actor, args.workstreamId);
    await validateWorkspaceSourceChat(ctx, actor, args.sourceChatId);
    await validateWorkspaceSourceArtifact(ctx, actor, args.sourceArtifactId);
    await validateWorkspaceSourcePlannerItem(ctx, actor, args.sourcePlannerItemId);

    const now = Date.now();
    const itemId = await ctx.db.insert("workspaceItems", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      status: "active",
      ...buildWorkspaceItemFields(args),
      provenanceSource: args.provenanceSource ?? "ai",
      provenanceAction: args.provenanceAction ?? "created",
      createdAt: now,
      updatedAt: now,
    });

    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      targetItemIds: [itemId],
      mutationType: "create_widget",
      source: args.provenanceSource ?? "ai",
      summary: args.mutationSummary ?? `Created widget ${args.title}`,
      after: { itemId },
      revertData: { kind: "delete_items", itemIds: [itemId] },
    });

    return { itemId, mutationId };
  },
});

export const updateWidget = mutation({
  args: {
    actorClerkId: v.string(),
    itemId: v.id("workspaceItems"),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    zIndex: v.optional(v.number()),
    title: v.optional(v.string()),
    contentSummary: v.optional(v.string()),
    category: v.optional(vWorkspaceItemCategory),
    itemType: v.optional(vCanonicalWorkspaceItemType),
    renderMode: v.optional(v.string()),
    status: v.optional(vWorkspaceMutationStatus),
    pinned: v.optional(v.boolean()),
    collapsed: v.optional(v.boolean()),
    hidden: v.optional(v.boolean()),
    visualGroup: v.optional(v.string()),
    renderProps: v.optional(v.any()),
    provenanceSource: v.optional(vWorkspaceMutationSource),
    provenanceAction: v.optional(v.string()),
    mutationSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    const existing = await assertWorkspaceItemOwnership(ctx, actor, args.itemId);

    const before = {
      x: existing.x,
      y: existing.y,
      width: existing.width,
      height: existing.height,
      zIndex: existing.zIndex,
      title: existing.title,
      contentSummary: existing.contentSummary,
      category: existing.category,
      itemType: existing.itemType,
      renderMode: existing.renderMode,
      status: existing.status,
      pinned: existing.pinned,
      collapsed: existing.collapsed,
      hidden: existing.hidden,
      visualGroup: existing.visualGroup,
      renderProps: existing.renderProps,
    };

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.x !== undefined) updates.x = Math.round(args.x);
    if (args.y !== undefined) updates.y = Math.round(args.y);
    if (args.width !== undefined) updates.width = Math.round(args.width);
    if (args.height !== undefined) updates.height = Math.round(args.height);
    if (args.zIndex !== undefined) updates.zIndex = Math.round(args.zIndex);
    if (args.title !== undefined) updates.title = normalizeWorkspaceTitle(args.title);
    if (args.contentSummary !== undefined) updates.contentSummary = summarizeWorkspaceContent(args.contentSummary);
    if (args.category !== undefined) updates.category = args.category;
    if (args.itemType !== undefined) {
      updates.itemType = normalizeCanonicalWorkspaceItemType(args.itemType);
      updates.sourceKind = resolveWorkspaceSourceKind({
        sourceChatId: existing.sourceChatId,
        sourceArtifactId: existing.sourceArtifactId,
        sourcePlannerItemId: existing.sourcePlannerItemId,
        itemType: updates.itemType as Doc<"workspaceItems">["itemType"],
      });
    }
    if (args.renderMode !== undefined) updates.renderMode = args.renderMode;
    if (args.status !== undefined) updates.status = args.status;
    if (args.pinned !== undefined) updates.pinned = args.pinned;
    if (args.collapsed !== undefined) updates.collapsed = args.collapsed;
    if (args.hidden !== undefined) updates.hidden = args.hidden;
    if (args.visualGroup !== undefined) updates.visualGroup = args.visualGroup.trim() || undefined;
    if (args.renderProps !== undefined) updates.renderProps = args.renderProps;
    if (args.provenanceSource !== undefined) updates.provenanceSource = args.provenanceSource;
    if (args.provenanceAction !== undefined) updates.provenanceAction = args.provenanceAction.trim() || undefined;
    if (args.itemType !== undefined || args.category !== undefined || args.renderMode !== undefined) {
      updates.category = resolveWorkspaceCategory({
        explicitCategory: args.category ?? existing.category,
        legacyType: existing.type,
        renderMode: args.renderMode ?? existing.renderMode,
        itemType: args.itemType ?? existing.itemType,
      });
    }

    await ctx.db.patch(args.itemId, updates);

    const refreshed = await ctx.db.get(args.itemId);
    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: existing.workstreamId,
      targetItemIds: [existing._id],
      mutationType: "update_widget",
      source: args.provenanceSource ?? "ai",
      summary: args.mutationSummary ?? `Updated widget ${existing.title}`,
      before,
      after: refreshed,
      revertData: { kind: "patch_items", patches: [{ itemId: existing._id, fields: before }] },
    });

    return { success: true, mutationId };
  },
});

export const moveWidget = mutation({
  args: {
    actorClerkId: v.string(),
    itemId: v.id("workspaceItems"),
    workstreamId: v.id("workstreams"),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    mutationSummary: v.optional(v.string()),
    provenanceSource: v.optional(vWorkspaceMutationSource),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    const existing = await assertWorkspaceItemOwnership(ctx, actor, args.itemId);
    await validateWorkspaceWorkstream(ctx, actor, args.workstreamId);

    const before = {
      workstreamId: existing.workstreamId,
      x: existing.x,
      y: existing.y,
    };

    await ctx.db.patch(args.itemId, {
      workstreamId: args.workstreamId,
      x: args.x !== undefined ? Math.round(args.x) : existing.x,
      y: args.y !== undefined ? Math.round(args.y) : existing.y,
      updatedAt: Date.now(),
      provenanceSource: args.provenanceSource ?? "ai",
      provenanceAction: "moved",
    });

    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: existing.workstreamId,
      targetWorkstreamId: args.workstreamId,
      targetItemIds: [existing._id],
      mutationType: "move_widget",
      source: args.provenanceSource ?? "ai",
      summary: args.mutationSummary ?? `Moved widget ${existing.title}`,
      before,
      after: { workstreamId: args.workstreamId, x: args.x, y: args.y },
      revertData: { kind: "patch_items", patches: [{ itemId: existing._id, fields: before }] },
    });

    return { success: true, mutationId };
  },
});

export const attachItemsToWorkstream = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    items: v.array(vAttachmentItem),
    provenanceSource: v.optional(vWorkspaceMutationSource),
    mutationSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    await validateWorkspaceWorkstream(ctx, actor, args.workstreamId);

    const existingItems = await ctx.db
      .query("workspaceItems")
      .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
      .collect();

    const createdItemIds: Id<"workspaceItems">[] = [];
    const now = Date.now();

    for (const item of args.items) {
      await validateWorkspaceSourceChat(ctx, actor, item.sourceChatId);
      await validateWorkspaceSourceArtifact(ctx, actor, item.sourceArtifactId);
      await validateWorkspaceSourcePlannerItem(ctx, actor, item.sourcePlannerItemId);

      const sourceId = resolveWorkspaceSourceId(item);
      const sourceKind = resolveWorkspaceSourceKind({
        sourceChatId: item.sourceChatId,
        sourceArtifactId: item.sourceArtifactId,
        sourcePlannerItemId: item.sourcePlannerItemId,
        itemType: item.itemType,
      });

      const duplicate = existingItems.find((existing) => (
        existing.status === "active"
        && existing.sourceKind === sourceKind
        && existing.sourceId === sourceId
      ));
      if (duplicate) continue;

      const itemId = await ctx.db.insert("workspaceItems", {
        orgId: actor.orgId,
        ownerUserId: actor._id,
        workstreamId: args.workstreamId,
        status: "active",
        ...buildWorkspaceItemFields({
          type: item.type ?? "custom",
          itemType: item.itemType,
          renderMode: item.renderMode,
          sourceChatId: item.sourceChatId,
          sourceArtifactId: item.sourceArtifactId,
          sourcePlannerItemId: item.sourcePlannerItemId,
          title: item.title ?? "Attached item",
          contentSummary: item.contentSummary,
          x: item.x ?? 80 + createdItemIds.length * 32,
          y: item.y ?? 220 + createdItemIds.length * 28,
          width: item.width,
          height: item.height,
          category: item.category,
          visualGroup: item.visualGroup,
          provenanceSource: args.provenanceSource ?? "ai",
          provenanceAction: "auto-attached",
        }),
        createdAt: now,
        updatedAt: now,
      });
      createdItemIds.push(itemId);
    }

    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      targetWorkstreamId: args.workstreamId,
      targetItemIds: createdItemIds,
      mutationType: "attach_items_to_workstream",
      source: args.provenanceSource ?? "ai",
      summary: args.mutationSummary ?? `Attached ${createdItemIds.length} item${createdItemIds.length === 1 ? "" : "s"}`,
      after: { createdItemIds },
      revertData: { kind: "delete_items", itemIds: createdItemIds },
    });

    return { success: true, createdItemIds, mutationId };
  },
});

export const updateWorkstreamLayout = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    widgets: v.array(v.object({
      itemId: v.id("workspaceItems"),
      x: v.number(),
      y: v.number(),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      zIndex: v.optional(v.number()),
    })),
    provenanceSource: v.optional(vWorkspaceMutationSource),
    mutationSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    await validateWorkspaceWorkstream(ctx, actor, args.workstreamId);
    const before: Array<{ itemId: Id<"workspaceItems">; fields: Record<string, unknown> }> = [];

    for (const widget of args.widgets) {
      const item = await assertWorkspaceItemOwnership(ctx, actor, widget.itemId);
      before.push({
        itemId: item._id,
        fields: {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          zIndex: item.zIndex,
        },
      });
      await ctx.db.patch(widget.itemId, {
        x: Math.round(widget.x),
        y: Math.round(widget.y),
        width: widget.width !== undefined ? Math.round(widget.width) : item.width,
        height: widget.height !== undefined ? Math.round(widget.height) : item.height,
        zIndex: widget.zIndex !== undefined ? Math.round(widget.zIndex) : item.zIndex,
        updatedAt: Date.now(),
        provenanceSource: args.provenanceSource ?? "ai",
        provenanceAction: "reorganized",
      });
    }

    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      targetWorkstreamId: args.workstreamId,
      targetItemIds: before.map((entry) => entry.itemId),
      mutationType: "update_workstream_layout",
      source: args.provenanceSource ?? "ai",
      summary: args.mutationSummary ?? "Updated workspace layout",
      before,
      after: args.widgets,
      revertData: { kind: "patch_items", patches: before },
    });

    return { success: true, mutationId };
  },
});

export const revertMutation = mutation({
  args: {
    actorClerkId: v.string(),
    mutationId: v.id("workspaceMutations"),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    const mutationRecord = await ctx.db.get(args.mutationId);
    if (!mutationRecord || mutationRecord.ownerUserId !== actor._id || mutationRecord.orgId !== actor.orgId) {
      throw new Error("Workspace mutation not found");
    }
    if (mutationRecord.status === "reverted") {
      return { success: true };
    }

    const revertData = mutationRecord.revertData as
      | { kind?: "delete_items"; itemIds?: Id<"workspaceItems">[] }
      | { kind?: "patch_items"; patches?: Array<{ itemId: Id<"workspaceItems">; fields: Record<string, unknown> }> }
      | { kind?: "archive_workstream"; workstreamId?: Id<"workstreams"> }
      | undefined;

    if (revertData?.kind === "delete_items") {
      for (const itemId of revertData.itemIds ?? []) {
        const item = await ctx.db.get(itemId);
        if (item && item.ownerUserId === actor._id && item.orgId === actor.orgId) {
          await ctx.db.delete(itemId);
        }
      }
    }

    if (revertData?.kind === "patch_items") {
      for (const patch of revertData.patches ?? []) {
        const item = await ctx.db.get(patch.itemId);
        if (item && item.ownerUserId === actor._id && item.orgId === actor.orgId) {
          await ctx.db.patch(patch.itemId, {
            ...patch.fields,
            updatedAt: Date.now(),
          });
        }
      }
    }

    if (revertData?.kind === "archive_workstream" && revertData.workstreamId) {
      const workstream = await ctx.db.get(revertData.workstreamId);
      if (workstream && workstream.ownerUserId === actor._id && workstream.orgId === actor.orgId) {
        await ctx.db.patch(revertData.workstreamId, {
          status: "archived",
          updatedAt: Date.now(),
        });
      }
    }

    await ctx.db.patch(args.mutationId, {
      status: "reverted",
      revertedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const syncArtifactWidgets = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    await validateWorkspaceWorkstream(ctx, actor, args.workstreamId);

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
