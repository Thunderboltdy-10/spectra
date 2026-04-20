/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";
import {
  buildWorkspaceSearchText,
  computeWorkspaceItemDefaultFrame,
  recordWorkspaceMutation,
  resolveCanonicalWorkspaceItemType,
  resolveWorkspaceCategory,
  type WorkspaceSearchResultSource,
} from "./workspaceHelpers";

const ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE: Record<string, string> = {
  document: "export",
  note: "note",
  board: "board",
  diagram: "visual",
  concept_map: "visual",
  timeline: "visual",
  image: "visual",
  visualization: "visual",
  flashcard_deck: "flashcard_deck",
  quiz: "quiz",
  code_output: "code",
  code_project: "code",
  bookmark: "export",
  reference: "export",
  table: "export",
  custom: "export",
};

const LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE: Record<string, string> = {
  thread: "thread",
  document: "export",
  planner: "planner",
  board: "board",
  visualization: "visual",
  media: "visual",
  reference: "export",
  custom: "export",
  utility: "export",
};

function canonicalWorkspaceTypeForArtifactType(artifactType: string) {
  return ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE[artifactType] ?? "export";
}

function canonicalWorkspaceTypeForLegacyType(legacyType: string) {
  return LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE[legacyType] ?? "export";
}

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function requireOwnedWorkstream(ctx: { db: { get: Function } }, actor: { _id: Id<"users">; orgId: Id<"orgs"> }, workstreamId: Id<"workstreams">) {
  const workstream = await ctx.db.get(workstreamId);
  if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
    throw new Error("Workstream not found");
  }
  return workstream;
}

async function requireOwnedItem(ctx: { db: { get: Function } }, actor: { _id: Id<"users">; orgId: Id<"orgs"> }, itemId: Id<"workspaceItems">) {
  const item = await ctx.db.get(itemId);
  if (!item || item.ownerUserId !== actor._id || item.orgId !== actor.orgId) {
    throw new Error("Workspace item not found");
  }
  return item;
}

type WorkspaceMutationCtx = {
  db: {
    get: Function;
    insert: Function;
    patch: Function;
    query: Function;
  };
};

function workspaceFacingTypeForItem(item: Doc<"workspaceItems">) {
  if (item.itemType === "planner" || item.type === "planner") return "planner" as const;
  if (item.itemType === "thread" || item.type === "thread") return "thread" as const;
  if (item.renderMode) return canonicalWorkspaceTypeForArtifactType(item.renderMode);
  return canonicalWorkspaceTypeForLegacyType(item.type);
}

function normalizeText(value: string | null | undefined, max = 280) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed.slice(0, max) : undefined;
}

function searchTextForWorkspaceItem(params: {
  title?: string | null;
  contentSummary?: string | null;
  renderMode?: string | null;
  category?: string | null;
}) {
  return buildWorkspaceSearchText(params.title, params.contentSummary, params.renderMode, params.category);
}

function isActiveThreadChat(chat: Doc<"chats">, actorId: Id<"users">, orgId: Id<"orgs">, workstreamId: Id<"workstreams">) {
  return chat.ownerUserId === actorId && chat.orgId === orgId && chat.workstreamId === workstreamId && !chat.deletedAt;
}


function inferTopicCluster(parts: Array<string | null | undefined>) {
  const tokens = parts
    .flatMap((part) => (typeof part === "string" ? part.toLowerCase().split(/[^a-z0-9]+/g) : []))
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
  return tokens[0];
}

function deriveTimelineEntry(params: {
  kind: "item" | "planner" | "chat" | "result";
  id: string;
  title: string;
  timestamp: number;
  status?: string | null;
  itemType?: string | null;
  topicCluster?: string | null;
  summary?: string | null;
  linkedItemId?: Id<"workspaceItems"> | null;
}) {
  return {
    id: `${params.kind}:${params.id}`,
    kind: params.kind,
    title: params.title,
    timestamp: params.timestamp,
    status: params.status ?? null,
    itemType: params.itemType ?? null,
    topicCluster: params.topicCluster ?? null,
    summary: normalizeText(params.summary, 220) ?? null,
    linkedItemId: params.linkedItemId ?? null,
  };
}

function defaultLegacyTypeForItemType(itemType: string): Doc<"workspaceItems">["type"] {
  switch (itemType) {
    case "thread": return "thread";
    case "planner": return "planner";
    case "utility": return "utility";
    case "custom": return "custom";
    default: return "document";
  }
}

export const getWorkspaceContent = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const workstream = await ctx.db.get(args.workstreamId);
    if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
      throw new Error("Workstream not found");
    }

    const [items, artifacts, plannerItems, chats, latestMutation] = await Promise.all([
      ctx.db.query("workspaceItems").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).collect(),
      ctx.db.query("artifacts").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).collect(),
      ctx.db.query("plannerItems").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).collect(),
      ctx.db.query("chats").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).collect(),
      ctx.db.query("workspaceMutations").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).order("desc").first(),
    ]);

    const activeItems = items
      .filter((item) => item.ownerUserId === actor._id && item.orgId === actor.orgId && item.status === "active")
      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0) || a.createdAt - b.createdAt)
      .map((item) => ({ ...item, workspaceType: workspaceFacingTypeForItem(item) }));

    return {
      workstream,
      items: activeItems,
      artifacts: artifacts.filter((artifact) => artifact.ownerUserId === actor._id && artifact.orgId === actor.orgId && artifact.status === "active"),
      plannerItems: plannerItems.filter((item) => item.ownerUserId === actor._id && item.orgId === actor.orgId && item.status !== "cancelled"),
      chats: chats.filter((chat) => isActiveThreadChat(chat, actor._id, actor.orgId, args.workstreamId)),
      revision: workstream.workspaceRevision ?? latestMutation?.updatedAt ?? workstream.updatedAt,
      revisionKey: workstream.workspaceRevisionKey ?? latestMutation?.revisionKey ?? `${args.workstreamId}:${workstream.updatedAt}`,
      lastMutationId: workstream.lastWorkspaceMutationId ?? latestMutation?._id,
    };
  },
});

export const getWorkspacePageData = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    includeDismissedResults: v.optional(v.boolean()),
    commandResultLimit: v.optional(v.number()),
    widgetLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const workstream = await requireOwnedWorkstream(ctx, actor, args.workstreamId);
    const commandResultLimit = Math.max(1, Math.min(args.commandResultLimit ?? 25, 100));
    const widgetLimit = Math.max(1, Math.min(args.widgetLimit ?? 25, 100));

    const [items, artifacts, plannerItems, chats, latestMutation, commandResults, widgets, messages] = await Promise.all([
      ctx.db.query("workspaceItems").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).collect(),
      ctx.db.query("artifacts").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).collect(),
      ctx.db.query("plannerItems").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).collect(),
      ctx.db.query("chats").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).collect(),
      ctx.db.query("workspaceMutations").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).order("desc").first(),
      ctx.db
        .query("workspaceCommandResults")
        .withIndex("by_workstream_updated", (q) => q.eq("workstreamId", args.workstreamId))
        .order("desc")
        .take(args.includeDismissedResults ? commandResultLimit : Math.min(commandResultLimit * 3, 300)),
      ctx.db
        .query("workspaceWidgets")
        .withIndex("by_workstream_updated", (q) => q.eq("workstreamId", args.workstreamId))
        .order("desc")
        .take(widgetLimit * 3),
      ctx.db
        .query("messages")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ]);

    const activeItems = items
      .filter((item) => item.ownerUserId === actor._id && item.orgId === actor.orgId && item.status === "active")
      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0) || a.createdAt - b.createdAt)
      .map((item) => ({ ...item, workspaceType: workspaceFacingTypeForItem(item) }));
    const liveArtifacts = artifacts.filter((artifact) => artifact.ownerUserId === actor._id && artifact.orgId === actor.orgId && artifact.status === "active");
    const livePlannerItems = plannerItems.filter((item) => item.ownerUserId === actor._id && item.orgId === actor.orgId && item.status !== "cancelled");
    const liveChats = chats.filter((chat) => isActiveThreadChat(chat, actor._id, actor.orgId, args.workstreamId));
    const chatById = new Map(liveChats.map((chat) => [chat._id, chat]));
    const liveMessages = messages.filter((message) => {
      const chat = chatById.get(message.chatId);
      return Boolean(chat && message.userId === actor._id);
    });
    const liveWidgets = widgets
      .filter((widget) => widget.ownerUserId === actor._id && widget.orgId === actor.orgId && !widget.hidden)
      .slice(0, widgetLimit);
    const visibleCommandResults = commandResults
      .filter((row) => row.ownerUserId === actor._id && row.orgId === actor.orgId)
      .filter((row) => args.includeDismissedResults ? true : row.status !== "dismissed")
      .slice(0, commandResultLimit);

    const itemByArtifactId = new Map(activeItems.filter((item) => item.sourceArtifactId).map((item) => [item.sourceArtifactId, item]));
    const itemByPlannerId = new Map(activeItems.filter((item) => item.sourcePlannerItemId).map((item) => [item.sourcePlannerItemId, item]));
    const itemByChatId = new Map(activeItems.filter((item) => item.sourceChatId).map((item) => [item.sourceChatId, item]));
    const itemById = new Map(activeItems.map((item) => [item._id, item]));
    const artifactById = new Map(liveArtifacts.map((artifact) => [artifact._id, artifact]));
    const plannerById = new Map(livePlannerItems.map((item) => [item._id, item]));

    const itemSignals = activeItems.map((item) => ({
      ...item,
      linkedArtifact: item.sourceArtifactId ? artifactById.get(item.sourceArtifactId) ?? null : null,
      linkedPlannerItem: item.sourcePlannerItemId ? plannerById.get(item.sourcePlannerItemId) ?? null : null,
      linkedChat: item.sourceChatId ? chatById.get(item.sourceChatId) ?? null : null,
      dueAt: item.sourcePlannerItemId ? plannerById.get(item.sourcePlannerItemId)?.dueAt : undefined,
      scheduledAt: item.sourcePlannerItemId ? plannerById.get(item.sourcePlannerItemId)?.dueAt : undefined,
      relevantTimestamp: item.sourcePlannerItemId
        ? plannerById.get(item.sourcePlannerItemId)?.dueAt ?? item.updatedAt
        : item.updatedAt,
      topicCluster: item.topicCluster ?? inferTopicCluster([item.title, item.contentSummary, item.renderMode]),
    }));

    const chatSignalMap = new Map(liveChats.map((chat) => {
      const chatMessages = liveMessages
        .filter((message) => message.chatId === chat._id)
        .sort((a, b) => b.createdAt - a.createdAt);
      const assistantReplies = chatMessages.filter((message) => message.role === "assistant").length;
      const userTurns = chatMessages.filter((message) => message.role === "user").length;
      const unresolved =
        chatMessages.length === 0
          ? false
          : chatMessages[0]?.role === "user";
      return [chat._id, {
        assistantReplies,
        userTurns,
        unresolved,
        latestMessageAt: chatMessages[0]?.createdAt ?? chat.updatedAt,
      }];
    }));

    const workspaceHealth = {
      itemCount: activeItems.length,
      artifactCount: liveArtifacts.length,
      plannerCount: livePlannerItems.length,
      threadCount: liveChats.length,
      activeWidgetCount: liveWidgets.length,
      openCommandCount: visibleCommandResults.filter((row) => row.status === "processing").length,
      blockedThreadCount: visibleCommandResults.filter((row) => row.threadStatus === "blocked").length,
      overduePlannerCount: livePlannerItems.filter((item) => typeof item.dueAt === "number" && item.dueAt < Date.now() && item.status !== "completed").length,
      unresolvedThreadCount: liveChats.filter((chat) => chatSignalMap.get(chat._id)?.unresolved).length,
      revision: workstream.workspaceRevision ?? latestMutation?.updatedAt ?? workstream.updatedAt,
    };

    const topicAccumulator = new Map<string, {
      topic: string;
      itemCount: number;
      plannerCount: number;
      chatCount: number;
      resultCount: number;
      latestTimestamp: number;
      overdueCount: number;
      unresolvedCount: number;
    }>();
    const bumpTopic = (topic: string | null | undefined, patch: Partial<{
      itemCount: number;
      plannerCount: number;
      chatCount: number;
      resultCount: number;
      latestTimestamp: number;
      overdueCount: number;
      unresolvedCount: number;
    }>) => {
      if (!topic) return;
      const current = topicAccumulator.get(topic) ?? {
        topic,
        itemCount: 0,
        plannerCount: 0,
        chatCount: 0,
        resultCount: 0,
        latestTimestamp: 0,
        overdueCount: 0,
        unresolvedCount: 0,
      };
      current.itemCount += patch.itemCount ?? 0;
      current.plannerCount += patch.plannerCount ?? 0;
      current.chatCount += patch.chatCount ?? 0;
      current.resultCount += patch.resultCount ?? 0;
      current.overdueCount += patch.overdueCount ?? 0;
      current.unresolvedCount += patch.unresolvedCount ?? 0;
      current.latestTimestamp = Math.max(current.latestTimestamp, patch.latestTimestamp ?? 0);
      topicAccumulator.set(topic, current);
    };

    itemSignals.forEach((item) => bumpTopic(item.topicCluster, { itemCount: 1, latestTimestamp: item.relevantTimestamp ?? item.updatedAt }));
    livePlannerItems.forEach((item) => bumpTopic(inferTopicCluster([item.title, item.description, item.type]), {
      plannerCount: 1,
      overdueCount: typeof item.dueAt === "number" && item.dueAt < Date.now() && item.status !== "completed" ? 1 : 0,
      latestTimestamp: item.dueAt ?? item.updatedAt,
    }));
    liveChats.forEach((chat) => {
      const signal = chatSignalMap.get(chat._id);
      bumpTopic(inferTopicCluster([chat.title, chat.latestUserPrompt, chat.contextSummary]), {
        chatCount: 1,
        unresolvedCount: signal?.unresolved ? 1 : 0,
        latestTimestamp: signal?.latestMessageAt ?? chat.updatedAt,
      });
    });
    visibleCommandResults.forEach((row) => bumpTopic(row.topicCluster ?? inferTopicCluster([row.title, row.summary, row.detail]), {
      resultCount: 1,
      unresolvedCount: row.threadStatus === "blocked" || row.threadStatus === "open" ? 1 : 0,
      latestTimestamp: row.timelineAt ?? row.updatedAt,
    }));

    const topicSignals = Array.from(topicAccumulator.values())
      .map((topic) => ({
        ...topic,
        state:
          topic.overdueCount > 0 || topic.unresolvedCount > 1
            ? "attention"
            : topic.resultCount > 0 || topic.chatCount > 0
              ? "active"
              : "stable",
      }))
      .sort((a, b) => b.latestTimestamp - a.latestTimestamp || (b.itemCount + b.chatCount + b.plannerCount) - (a.itemCount + a.chatCount + a.plannerCount));

    const timelineSignals = [
      ...itemSignals.map((item) => deriveTimelineEntry({
        kind: "item",
        id: item._id,
        title: item.title,
        timestamp: item.relevantTimestamp ?? item.updatedAt,
        status: item.status,
        itemType: item.workspaceType ?? item.itemType,
        topicCluster: item.topicCluster,
        summary: item.contentSummary,
        linkedItemId: item._id,
      })),
      ...livePlannerItems.map((item) => deriveTimelineEntry({
        kind: "planner",
        id: item._id,
        title: item.title,
        timestamp: item.dueAt ?? item.updatedAt,
        status: item.status,
        itemType: item.type,
        topicCluster: inferTopicCluster([item.title, item.description]),
        summary: item.description,
        linkedItemId: itemByPlannerId.get(item._id)?._id ?? null,
      })),
      ...liveChats.map((chat) => deriveTimelineEntry({
        kind: "chat",
        id: chat._id,
        title: chat.title,
        timestamp: chatSignalMap.get(chat._id)?.latestMessageAt ?? chat.updatedAt,
        status: chatSignalMap.get(chat._id)?.unresolved ? "open" : "resolved",
        itemType: "thread",
        topicCluster: inferTopicCluster([chat.title, chat.latestUserPrompt, chat.contextSummary]),
        summary: chat.contextSummary ?? chat.latestUserPrompt,
        linkedItemId: itemByChatId.get(chat._id)?._id ?? null,
      })),
      ...visibleCommandResults.map((row: typeof visibleCommandResults[number]) => deriveTimelineEntry({
        kind: "result",
        id: row._id,
        title: row.title,
        timestamp: row.timelineAt ?? row.updatedAt,
        status: row.threadStatus ?? row.status,
        itemType: row.variant ?? row.intent,
        topicCluster: row.topicCluster ?? inferTopicCluster([row.title, row.summary, row.detail]),
        summary: row.summary,
        linkedItemId:
          row.targetKind === "artifact" && row.targetId
            ? itemByArtifactId.get(row.targetId as Id<"artifacts">)?._id ?? null
            : row.targetKind === "plannerItem" && row.targetId
              ? itemByPlannerId.get(row.targetId as Id<"plannerItems">)?._id ?? null
              : row.targetKind === "chat" && row.targetId
                ? itemByChatId.get(row.targetId as Id<"chats">)?._id ?? null
                : row.targetKind === "workspaceItem" && row.targetId
                  ? itemById.get(row.targetId as Id<"workspaceItems">)?._id ?? null
                  : null,
      })),
    ]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 120);

    return {
      workstream,
      items: itemSignals,
      artifacts: liveArtifacts,
      plannerItems: livePlannerItems.map((item) => ({
        ...item,
        scheduledAt: item.dueAt,
        relevantTimestamp: item.dueAt ?? item.updatedAt,
        topicCluster: inferTopicCluster([item.title, item.description, item.type]),
      })),
      chats: liveChats.map((chat) => ({
        ...chat,
        relevantTimestamp: chat.updatedAt,
        topicCluster: inferTopicCluster([chat.title, chat.latestUserPrompt, chat.contextSummary]),
      })),
      widgets: liveWidgets,
      commandResults: visibleCommandResults.map((row) => ({
        ...row,
        targetRecord:
          row.targetKind === "artifact" && row.targetId
            ? artifactById.get(row.targetId as Id<"artifacts">) ?? null
            : row.targetKind === "plannerItem" && row.targetId
              ? plannerById.get(row.targetId as Id<"plannerItems">) ?? null
              : row.targetKind === "chat" && row.targetId
                ? chatById.get(row.targetId as Id<"chats">) ?? null
                : row.targetKind === "workspaceItem" && row.targetId
                  ? itemById.get(row.targetId as Id<"workspaceItems">) ?? null
                  : null,
        relatedWorkspaceItem:
          row.targetKind === "artifact" && row.targetId
            ? itemByArtifactId.get(row.targetId as Id<"artifacts">) ?? null
            : row.targetKind === "plannerItem" && row.targetId
              ? itemByPlannerId.get(row.targetId as Id<"plannerItems">) ?? null
              : row.targetKind === "chat" && row.targetId
                ? itemByChatId.get(row.targetId as Id<"chats">) ?? null
                : row.targetKind === "workspaceItem" && row.targetId
                  ? itemById.get(row.targetId as Id<"workspaceItems">) ?? null
                  : null,
      })),
      signals: {
        workspaceHealth,
        topicSignals,
        timelineSignals,
      },
      revision: workstream.workspaceRevision ?? latestMutation?.updatedAt ?? workstream.updatedAt,
      revisionKey: workstream.workspaceRevisionKey ?? latestMutation?.revisionKey ?? `${args.workstreamId}:${workstream.updatedAt}`,
      lastMutationId: workstream.lastWorkspaceMutationId ?? latestMutation?._id,
    };
  },
});

export const updateItemLayout = mutation({
  args: {
    actorClerkId: v.string(),
    itemId: v.id("workspaceItems"),
    x: v.number(),
    y: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    zIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const item = await requireOwnedItem(ctx, actor, args.itemId);

    const patch = {
      x: args.x,
      y: args.y,
      width: args.width ?? item.width,
      height: args.height ?? item.height,
      zIndex: args.zIndex ?? item.zIndex,
      updatedAt: Date.now(),
    };

    await ctx.db.patch(args.itemId, patch);
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: item.workstreamId,
      mutationType: "update_item_layout",
      source: "user",
      targetItemIds: [item._id],
      before: {
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        zIndex: item.zIndex,
      },
      after: patch,
      summary: `Updated layout for ${item.title}`,
    });

    return { success: true };
  },
});

export const createWidget = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    title: v.string(),
    type: v.optional(v.union(v.literal("thread"), v.literal("document"), v.literal("planner"), v.literal("board"), v.literal("visualization"), v.literal("media"), v.literal("reference"), v.literal("custom"), v.literal("utility"))),
    itemType: v.optional(v.union(v.literal("thread"), v.literal("artifact"), v.literal("planner"), v.literal("utility"), v.literal("custom"))),
    renderMode: v.optional(v.string()),
    contentSummary: v.optional(v.string()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    category: v.optional(v.string()),
    provenanceSource: v.optional(v.union(v.literal("user"), v.literal("ai"), v.literal("system"))),
    provenanceAction: v.optional(v.string()),
    mutationSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await requireOwnedWorkstream(ctx, actor, args.workstreamId);
    const now = Date.now();
    const itemType = resolveCanonicalWorkspaceItemType({ itemType: args.itemType, legacyType: args.type });
    const legacyType = args.type ?? defaultLegacyTypeForItemType(itemType);
    const category = resolveWorkspaceCategory({ category: args.category, itemType, renderMode: args.renderMode, legacyType });

    const itemId = await ctx.db.insert("workspaceItems", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      type: legacyType,
      itemType,
      sourceKind: itemType === "thread" ? "chat" : itemType === "planner" ? "plannerItem" : itemType === "utility" ? "utility" : "custom",
      sourceId: undefined,
      renderMode: args.renderMode,
      title: args.title.trim(),
      contentSummary: normalizeText(args.contentSummary),
      searchText: searchTextForWorkspaceItem({
        title: args.title,
        contentSummary: normalizeText(args.contentSummary),
        renderMode: args.renderMode,
        category,
      }),
      x: args.x ?? 120,
      y: args.y ?? 120,
      width: args.width ?? 320,
      height: args.height ?? 200,
      zIndex: 0,
      category,
      status: "active",
      pinned: false,
      collapsed: false,
      hidden: false,
      provenanceSource: args.provenanceSource ?? "user",
      provenanceAction: args.provenanceAction,
      createdAt: now,
      updatedAt: now,
    });

    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      mutationType: "create_widget",
      source: args.provenanceSource ?? "user",
      targetItemIds: [itemId],
      after: { itemId },
      summary: args.mutationSummary ?? `Created widget ${args.title}`,
    });

    return { itemId, mutationId };
  },
});

export const updateWidget = mutation({
  args: {
    actorClerkId: v.string(),
    itemId: v.id("workspaceItems"),
    title: v.optional(v.string()),
    contentSummary: v.optional(v.string()),
    renderMode: v.optional(v.string()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    hidden: v.optional(v.boolean()),
    collapsed: v.optional(v.boolean()),
    pinned: v.optional(v.boolean()),
    category: v.optional(v.string()),
    zIndex: v.optional(v.number()),
    provenanceSource: v.optional(v.union(v.literal("user"), v.literal("ai"), v.literal("system"))),
    provenanceAction: v.optional(v.string()),
    mutationSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const item = await requireOwnedItem(ctx, actor, args.itemId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.contentSummary !== undefined) patch.contentSummary = normalizeText(args.contentSummary);
    if (args.renderMode !== undefined) patch.renderMode = args.renderMode;
    if (args.x !== undefined) patch.x = args.x;
    if (args.y !== undefined) patch.y = args.y;
    if (args.width !== undefined) patch.width = args.width;
    if (args.height !== undefined) patch.height = args.height;
    if (args.zIndex !== undefined) patch.zIndex = args.zIndex;
    if (args.hidden !== undefined) patch.hidden = args.hidden;
    if (args.collapsed !== undefined) patch.collapsed = args.collapsed;
    if (args.pinned !== undefined) patch.pinned = args.pinned;
    if (args.category !== undefined) patch.category = resolveWorkspaceCategory({
      category: args.category,
      itemType: item.itemType,
      renderMode: (patch.renderMode as string | undefined) ?? item.renderMode,
      legacyType: item.type,
    });
    if (args.provenanceSource !== undefined) patch.provenanceSource = args.provenanceSource;
    if (args.provenanceAction !== undefined) patch.provenanceAction = args.provenanceAction;
    patch.searchText = searchTextForWorkspaceItem({
      title: (patch.title as string | undefined) ?? item.title,
      contentSummary: (patch.contentSummary as string | undefined) ?? item.contentSummary,
      renderMode: (patch.renderMode as string | undefined) ?? item.renderMode,
      category: (patch.category as string | undefined) ?? item.category,
    });

    await ctx.db.patch(args.itemId, patch);
    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: item.workstreamId,
      mutationType: "update_widget",
      source: args.provenanceSource ?? "user",
      targetItemIds: [item._id],
      before: item,
      after: patch,
      summary: args.mutationSummary ?? `Updated widget ${item.title}`,
    });
    return { success: true, mutationId };
  },
});

export const moveWidget = mutation({
  args: {
    actorClerkId: v.string(),
    itemId: v.id("workspaceItems"),
    targetWorkstreamId: v.id("workstreams"),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    provenanceSource: v.optional(v.union(v.literal("user"), v.literal("ai"), v.literal("system"))),
    mutationSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const item = await requireOwnedItem(ctx, actor, args.itemId);
    await requireOwnedWorkstream(ctx, actor, args.targetWorkstreamId);
    const patch = {
      workstreamId: args.targetWorkstreamId,
      x: args.x ?? item.x,
      y: args.y ?? item.y,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(args.itemId, patch);
    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: item.workstreamId,
      targetWorkstreamId: args.targetWorkstreamId,
      mutationType: "move_widget",
      source: args.provenanceSource ?? "user",
      targetItemIds: [item._id],
      before: item,
      after: patch,
      summary: args.mutationSummary ?? `Moved widget ${item.title}`,
    });
    return { success: true, mutationId };
  },
});

export const setPinned = mutation({
  args: {
    actorClerkId: v.string(),
    itemId: v.id("workspaceItems"),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const item = await requireOwnedItem(ctx, actor, args.itemId);
    if ((item.pinned ?? false) === args.pinned) {
      return { success: true, itemId: item._id, pinned: args.pinned };
    }

    const patch = {
      pinned: args.pinned,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(item._id, patch);
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: item.workstreamId,
      mutationType: args.pinned ? "pin_workspace_item" : "unpin_workspace_item",
      source: "user",
      targetItemIds: [item._id],
      before: item,
      after: patch,
      summary: `${args.pinned ? "Pinned" : "Unpinned"} ${item.title}`,
    });
    return { success: true, itemId: item._id, pinned: args.pinned };
  },
});

export const archiveItem = mutation({
  args: {
    actorClerkId: v.string(),
    itemId: v.id("workspaceItems"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const item = await requireOwnedItem(ctx, actor, args.itemId);
    if (item.status === "archived") {
      return { success: true, itemId: item._id, status: "archived" };
    }

    const patch = {
      status: "archived" as const,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(item._id, patch);
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: item.workstreamId,
      mutationType: "archive_workspace_item",
      source: "user",
      targetItemIds: [item._id],
      before: item,
      after: patch,
      summary: `Archived ${item.title}`,
    });
    return { success: true, itemId: item._id, status: "archived" };
  },
});

async function duplicateArtifactWorkspaceItem(
  ctx: WorkspaceMutationCtx,
  actor: { _id: Id<"users">; orgId: Id<"orgs"> },
  item: Doc<"workspaceItems">,
) {
  if (!item.sourceArtifactId) throw new Error("Workspace item is not linked to an artifact");
  const artifact = await ctx.db.get(item.sourceArtifactId);
  if (!artifact || artifact.ownerUserId !== actor._id || artifact.orgId !== actor.orgId) {
    throw new Error("Artifact not found");
  }

  const now = Date.now();
  const clonedArtifactId = await ctx.db.insert("artifacts", {
    ownerUserId: artifact.ownerUserId,
    orgId: artifact.orgId,
    workstreamId: artifact.workstreamId,
    type: artifact.type,
    title: `${artifact.title} copy`,
    content: artifact.content,
    editorMode: artifact.editorMode,
    contentPlaintext: artifact.contentPlaintext,
    sourceType: artifact.sourceType,
    managebacItemId: undefined,
    sourceDeleted: artifact.sourceDeleted,
    sourceUpdatedAt: artifact.sourceUpdatedAt,
    syncConflictSummary: artifact.syncConflictSummary,
    lastAiEditId: artifact.lastAiEditId,
    pendingDiffs: artifact.pendingDiffs,
    legacyNoteId: undefined,
    layout: artifact.layout,
    tags: artifact.tags,
    linkedAgentId: artifact.linkedAgentId,
    linkedChatId: artifact.linkedChatId,
    status: "active",
    pinnedAt: item.pinned ? now : undefined,
    createdAt: now,
    updatedAt: now,
  });

  const frame = computeWorkspaceItemDefaultFrame({
    itemType: "artifact",
    renderMode: artifact.type,
    pinned: item.pinned ?? false,
  });
  const duplicateItemId = await ctx.db.insert("workspaceItems", {
    orgId: actor.orgId,
    ownerUserId: actor._id,
    workstreamId: item.workstreamId,
    type: item.type,
    itemType: "artifact",
    sourceKind: "artifact",
    sourceId: clonedArtifactId as unknown as string,
    sourceArtifactId: clonedArtifactId,
    renderMode: item.renderMode,
    title: `${item.title} copy`,
    contentSummary: item.contentSummary,
    searchText: searchTextForWorkspaceItem({
      title: `${item.title} copy`,
      contentSummary: item.contentSummary,
      renderMode: item.renderMode,
      category: item.category,
    }),
    x: item.x + 48,
    y: item.y + 48,
    width: item.width ?? frame.width,
    height: item.height ?? frame.height,
    zIndex: (item.zIndex ?? 0) + 1,
    category: item.category,
    status: "active",
    pinned: item.pinned,
    collapsed: item.collapsed,
    hidden: item.hidden,
    provenanceSource: item.provenanceSource,
    provenanceAction: "duplicate",
    topicCluster: item.topicCluster,
    clusterOverride: item.clusterOverride,
    createdAt: now,
    updatedAt: now,
  });

  await recordWorkspaceMutation(ctx, {
    orgId: actor.orgId,
    ownerUserId: actor._id,
    workstreamId: item.workstreamId,
    mutationType: "duplicate_workspace_item",
    source: "user",
    targetItemIds: [item._id, duplicateItemId],
    before: item,
    after: { duplicateItemId, clonedArtifactId },
    summary: `Duplicated ${item.title}`,
  });

  return { itemId: duplicateItemId, artifactId: clonedArtifactId };
}

export const duplicateItem = mutation({
  args: {
    actorClerkId: v.string(),
    itemId: v.id("workspaceItems"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const item = await requireOwnedItem(ctx, actor, args.itemId);

    if (item.itemType === "artifact") {
      return duplicateArtifactWorkspaceItem(ctx, actor, item);
    }

    const now = Date.now();
    const duplicatedTitle = `${item.title} copy`;
    const duplicateItemId = await ctx.db.insert("workspaceItems", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: item.workstreamId,
      type: item.type,
      itemType: item.itemType,
      sourceKind: item.sourceKind,
      sourceId: item.sourceId,
      renderMode: item.renderMode,
      sourceChatId: item.sourceChatId,
      sourceArtifactId: item.sourceArtifactId,
      sourcePlannerItemId: item.sourcePlannerItemId,
      title: duplicatedTitle,
      contentSummary: item.contentSummary,
      searchText: searchTextForWorkspaceItem({
        title: duplicatedTitle,
        contentSummary: item.contentSummary,
        renderMode: item.renderMode,
        category: item.category,
      }),
      x: item.x + 48,
      y: item.y + 48,
      width: item.width,
      height: item.height,
      zIndex: (item.zIndex ?? 0) + 1,
      category: item.category,
      status: "active",
      pinned: item.pinned,
      collapsed: item.collapsed,
      hidden: item.hidden,
      provenanceSource: item.provenanceSource,
      provenanceAction: "duplicate",
      topicCluster: item.topicCluster,
      clusterOverride: item.clusterOverride,
      createdAt: now,
      updatedAt: now,
    });

    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: item.workstreamId,
      mutationType: "duplicate_workspace_item",
      source: "user",
      targetItemIds: [item._id, duplicateItemId],
      before: item,
      after: { duplicateItemId },
      summary: `Duplicated ${item.title}`,
    });

    return { itemId: duplicateItemId };
  },
});

export const attachItemsToWorkstream = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    items: v.array(v.object({
      title: v.string(),
      type: v.optional(v.union(v.literal("thread"), v.literal("document"), v.literal("planner"), v.literal("board"), v.literal("visualization"), v.literal("media"), v.literal("reference"), v.literal("custom"), v.literal("utility"))),
      itemType: v.optional(v.union(v.literal("thread"), v.literal("artifact"), v.literal("planner"), v.literal("utility"), v.literal("custom"))),
      sourceChatId: v.optional(v.id("chats")),
      sourceArtifactId: v.optional(v.id("artifacts")),
      sourcePlannerItemId: v.optional(v.id("plannerItems")),
      renderMode: v.optional(v.string()),
      contentSummary: v.optional(v.string()),
      x: v.optional(v.number()),
      y: v.optional(v.number()),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      category: v.optional(v.string()),
    })),
    provenanceSource: v.optional(v.union(v.literal("user"), v.literal("ai"), v.literal("system"))),
    mutationSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await requireOwnedWorkstream(ctx, actor, args.workstreamId);
    const existing = await ctx.db.query("workspaceItems").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).collect();
    const inserted: Id<"workspaceItems">[] = [];
    const now = Date.now();

    for (const incoming of args.items) {
      const duplicate = existing.find((item) =>
        item.title === incoming.title
        && item.sourceChatId === incoming.sourceChatId
        && item.sourceArtifactId === incoming.sourceArtifactId
        && item.sourcePlannerItemId === incoming.sourcePlannerItemId
      );
      if (duplicate) continue;

      const itemType = resolveCanonicalWorkspaceItemType({
        itemType: incoming.itemType,
        legacyType: incoming.type,
        sourceChatId: incoming.sourceChatId,
        sourceArtifactId: incoming.sourceArtifactId,
        sourcePlannerItemId: incoming.sourcePlannerItemId,
      });
      const legacyType = incoming.type ?? defaultLegacyTypeForItemType(itemType);
      const category = resolveWorkspaceCategory({ itemType, renderMode: incoming.renderMode, legacyType });

      const itemId = await ctx.db.insert("workspaceItems", {
        orgId: actor.orgId,
        ownerUserId: actor._id,
        workstreamId: args.workstreamId,
        type: legacyType,
        itemType,
        sourceKind: incoming.sourceChatId ? "chat" : incoming.sourcePlannerItemId ? "plannerItem" : incoming.sourceArtifactId ? "artifact" : "custom",
        sourceId: incoming.sourceChatId ?? incoming.sourceArtifactId ?? incoming.sourcePlannerItemId ?? undefined,
        sourceChatId: incoming.sourceChatId,
        sourceArtifactId: incoming.sourceArtifactId,
        sourcePlannerItemId: incoming.sourcePlannerItemId,
        renderMode: incoming.renderMode,
        title: incoming.title.trim(),
        contentSummary: normalizeText(incoming.contentSummary),
        searchText: searchTextForWorkspaceItem({
          title: incoming.title,
          contentSummary: normalizeText(incoming.contentSummary),
          renderMode: incoming.renderMode,
          category,
        }),
        x: incoming.x ?? 120,
        y: incoming.y ?? 120,
        width: incoming.width ?? 320,
        height: incoming.height ?? 200,
        zIndex: 0,
        category,
        status: "active",
        pinned: false,
        collapsed: false,
        hidden: false,
        provenanceSource: "user",
        createdAt: now,
        updatedAt: now,
      });
      inserted.push(itemId);
    }

    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      mutationType: "attach_items_to_workstream",
      source: args.provenanceSource ?? "user",
      targetItemIds: inserted,
      after: { inserted },
      summary: args.mutationSummary ?? `Attached ${inserted.length} item${inserted.length === 1 ? "" : "s"}`,
    });

    return { itemIds: inserted, createdItemIds: inserted, mutationId, success: true };
  },
});

export const listMergeCandidates = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    search: v.optional(v.string()),
    topic: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await requireOwnedWorkstream(ctx, actor, args.workstreamId);
    const search = normalizeText(args.search ?? args.topic, 80)?.toLowerCase();
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const items = await ctx.db.query("workspaceItems").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).collect();
    return items.filter((item) => item.ownerUserId === actor._id && item.orgId === actor.orgId && item.status === "active").filter((item) => {
      if (!search) return true;
      return [item.title, item.contentSummary, item.renderMode].filter(Boolean).some((value) => String(value).toLowerCase().includes(search));
    }).slice(0, limit);
  },
});

export const updateWorkstreamLayout = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    items: v.array(v.object({
      itemId: v.id("workspaceItems"),
      x: v.number(),
      y: v.number(),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      zIndex: v.optional(v.number()),
    })),
    widgets: v.optional(v.array(v.object({
      itemId: v.id("workspaceItems"),
      x: v.number(),
      y: v.number(),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      zIndex: v.optional(v.number()),
    }))),
    provenanceSource: v.optional(v.union(v.literal("user"), v.literal("ai"), v.literal("system"))),
    mutationSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await requireOwnedWorkstream(ctx, actor, args.workstreamId);
    const incomingItems = args.items.length > 0 ? args.items : (args.widgets ?? []);
    const updated: Id<"workspaceItems">[] = [];
    for (const incoming of incomingItems) {
      const item = await requireOwnedItem(ctx, actor, incoming.itemId);
      if (item.workstreamId !== args.workstreamId) throw new Error("Workspace item not in target workstream");
      await ctx.db.patch(incoming.itemId, {
        x: incoming.x,
        y: incoming.y,
        width: incoming.width ?? item.width,
        height: incoming.height ?? item.height,
        zIndex: incoming.zIndex ?? item.zIndex,
        updatedAt: Date.now(),
      });
      updated.push(incoming.itemId);
    }
    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      mutationType: "update_workstream_layout",
      source: args.provenanceSource ?? "user",
      targetItemIds: updated,
      after: { updated },
      summary: args.mutationSummary ?? `Updated layout for ${updated.length} item${updated.length === 1 ? "" : "s"}`,
    });
    return { success: true, mutationId };
  },
});

export const updateBySourceArtifact = mutation({
  args: {
    actorClerkId: v.string(),
    sourceArtifactId: v.id("artifacts"),
    title: v.optional(v.string()),
    contentSummary: v.optional(v.string()),
    renderMode: v.optional(v.string()),
    provenanceSource: v.optional(v.union(v.literal("user"), v.literal("ai"), v.literal("system"))),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const items = await ctx.db.query("workspaceItems").withIndex("by_source_artifact", (q) => q.eq("sourceArtifactId", args.sourceArtifactId)).collect();
    const item = items.find((row) => row.ownerUserId === actor._id && row.orgId === actor.orgId);
    if (!item) throw new Error("Workspace item not found");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.contentSummary !== undefined) patch.contentSummary = normalizeText(args.contentSummary);
    if (args.renderMode !== undefined) patch.renderMode = args.renderMode;
    if (args.provenanceSource !== undefined) patch.provenanceSource = args.provenanceSource;
    patch.searchText = searchTextForWorkspaceItem({
      title: (patch.title as string | undefined) ?? item.title,
      contentSummary: (patch.contentSummary as string | undefined) ?? item.contentSummary,
      renderMode: (patch.renderMode as string | undefined) ?? item.renderMode,
      category: item.category,
    });
    await ctx.db.patch(item._id, patch);
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: item.workstreamId,
      mutationType: "update_by_source_artifact",
      source: "system",
      targetItemIds: [item._id],
      before: item,
      after: patch,
      summary: `Updated projected artifact ${item.title}`,
    });
    return { success: true };
  },
});

export const searchWorkspace = query({
  args: {
    actorClerkId: v.string(),
    query: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const queryText = normalizeText(args.query, 120);
    if (!queryText) return [];
    const limit = Math.max(1, Math.min(args.limit ?? 20, 50));

    const [workstreams, artifacts, workspaceItems, plannerItems, messages] = await Promise.all([
      ctx.db
        .query("workstreams")
        .withSearchIndex("search_title", (q) =>
          q.search("title", queryText).eq("ownerUserId", actor._id).eq("orgId", actor.orgId).eq("status", "active"),
        )
        .take(limit),
      ctx.db
        .query("artifacts")
        .withSearchIndex("search_content", (q) =>
          q.search("contentPlaintext", queryText).eq("ownerUserId", actor._id).eq("orgId", actor.orgId).eq("status", "active"),
        )
        .take(limit),
      ctx.db
        .query("workspaceItems")
        .withSearchIndex("search_text", (q) =>
          q.search("searchText", queryText).eq("ownerUserId", actor._id).eq("orgId", actor.orgId).eq("status", "active"),
        )
        .take(limit),
      ctx.db.query("plannerItems").withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id)).collect(),
      ctx.db.query("messages").withSearchIndex("search_content", (q) => q.search("content", queryText).eq("userId", actor._id)).take(limit),
    ]);

    const workstreamMap = new Map(workstreams.map((row) => [row._id, row]));
    const resultKeys = new Set<string>();
    const results: Array<{
      id: string;
      sourceType: WorkspaceSearchResultSource;
      title: string;
      snippet?: string;
      workspaceId?: Id<"workstreams">;
      workspaceTitle?: string;
      itemId?: Id<"workspaceItems">;
      artifactId?: Id<"artifacts">;
      plannerItemId?: Id<"plannerItems">;
      chatId?: Id<"chats">;
      messageId?: Id<"messages">;
      matchedText?: string;
      updatedAt: number;
    }> = [];

    for (const row of workstreams) {
      if (args.workstreamId && row._id !== args.workstreamId) continue;
      const key = `workstream:${row._id}`;
      if (resultKeys.has(key)) continue;
      resultKeys.add(key);
      results.push({
        id: key,
        sourceType: "workstream",
        title: row.title,
        snippet: normalizeText(row.description, 220),
        workspaceId: row._id,
        workspaceTitle: row.title,
        updatedAt: row.updatedAt,
      });
    }

    for (const row of artifacts) {
      if (args.workstreamId && row.workstreamId !== args.workstreamId) continue;
      const key = `artifact:${row._id}`;
      if (resultKeys.has(key)) continue;
      resultKeys.add(key);
      const workspace = row.workstreamId ? workstreamMap.get(row.workstreamId) ?? await ctx.db.get(row.workstreamId) : null;
      results.push({
        id: key,
        sourceType: "artifact",
        title: row.title,
        snippet: normalizeText(row.contentPlaintext, 220),
        workspaceId: row.workstreamId,
        workspaceTitle: workspace?.title,
        artifactId: row._id,
        matchedText: normalizeText(row.contentPlaintext, 180),
        updatedAt: row.updatedAt,
      });
    }

    const plannerHits = plannerItems
      .filter((row) => row.orgId === actor.orgId)
      .filter((row) => (args.workstreamId ? row.workstreamId === args.workstreamId : true))
      .filter((row) =>
        buildWorkspaceSearchText(row.title, row.description, row.type, row.priority)
          .toLowerCase()
          .includes(queryText.toLowerCase()),
      )
      .slice(0, limit);
    for (const row of plannerHits) {
      const key = `planner:${row._id}`;
      if (resultKeys.has(key)) continue;
      resultKeys.add(key);
      const workspace = row.workstreamId ? workstreamMap.get(row.workstreamId) ?? await ctx.db.get(row.workstreamId) : null;
      results.push({
        id: key,
        sourceType: "planner",
        title: row.title,
        snippet: normalizeText(row.description, 220),
        workspaceId: row.workstreamId,
        workspaceTitle: workspace?.title,
        plannerItemId: row._id,
        matchedText: normalizeText(row.description ?? row.title, 180),
        updatedAt: row.updatedAt,
      });
    }

    for (const row of messages) {
      const chat = await ctx.db.get(row.chatId);
      if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId || chat.deletedAt) continue;
      if (args.workstreamId && chat.workstreamId !== args.workstreamId) continue;
      const key = `thread:${row._id}`;
      if (resultKeys.has(key)) continue;
      resultKeys.add(key);
      const workspace = chat.workstreamId ? workstreamMap.get(chat.workstreamId) ?? await ctx.db.get(chat.workstreamId) : null;
      results.push({
        id: key,
        sourceType: "thread",
        title: chat.title,
        snippet: normalizeText(row.content, 220),
        workspaceId: chat.workstreamId,
        workspaceTitle: workspace?.title,
        chatId: chat._id,
        messageId: row._id,
        matchedText: normalizeText(row.content, 180),
        updatedAt: row.createdAt,
      });
    }

    for (const row of workspaceItems) {
      if (args.workstreamId && row.workstreamId !== args.workstreamId) continue;
      const key = `item:${row._id}`;
      if (resultKeys.has(key)) continue;
      resultKeys.add(key);
      const workspace = row.workstreamId ? workstreamMap.get(row.workstreamId) ?? await ctx.db.get(row.workstreamId) : null;
      results.push({
        id: key,
        sourceType:
          row.itemType === "planner"
            ? "planner"
            : row.itemType === "thread"
              ? "thread"
              : "artifact",
        title: row.title,
        snippet: normalizeText(row.contentSummary, 220),
        workspaceId: row.workstreamId,
        workspaceTitle: workspace?.title,
        itemId: row._id,
        artifactId: row.sourceArtifactId,
        plannerItemId: row.sourcePlannerItemId,
        chatId: row.sourceChatId,
        matchedText: normalizeText(row.contentSummary ?? row.title, 180),
        updatedAt: row.updatedAt,
      });
    }

    return results
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  },
});

export const listRecentMutations = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
    const rows = args.workstreamId
      ? await ctx.db.query("workspaceMutations").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).order("desc").take(limit)
      : await ctx.db.query("workspaceMutations").withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id)).order("desc").take(limit);

    return rows.filter((row) => row.ownerUserId === actor._id && row.orgId === actor.orgId);
  },
});
