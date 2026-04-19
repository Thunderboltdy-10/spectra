import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import type { Id } from "./_generated/dataModel";
import { buildWorkspaceSearchText, normalizeWorkspaceResultMetadata, recordWorkspaceMutation } from "./workspaceHelpers";
import { syncWorkspaceItemForArtifact, syncWorkspaceItemForChat } from "./workspaceItemSync";

const vIntent = v.union(
  v.literal("note"),
  v.literal("planner"),
  v.literal("thread"),
  v.literal("result"),
  v.literal("widget"),
);

const vStatus = v.union(v.literal("processing"), v.literal("completed"), v.literal("dismissed"));
const vVariant = v.union(v.literal("summary"), v.literal("answer"), v.literal("artifact"), v.literal("planner"), v.literal("thread"));
const vTargetKind = v.union(v.literal("artifact"), v.literal("plannerItem"), v.literal("chat"), v.literal("workspaceItem"), v.literal("result"));
const vThreadStatus = v.union(v.literal("open"), v.literal("resolved"), v.literal("blocked"));

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function validateWorkstream(ctx: Parameters<typeof getUserByClerkId>[0], actor: Awaited<ReturnType<typeof requireActor>>, workstreamId: Id<"workstreams">) {
  const workstream = await ctx.db.get(workstreamId);
  if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
    throw new Error("Workstream not found");
  }
}

function normalizeText(value: string | null | undefined, max = 400) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().split(/\s+/).join(" ");
  return normalized ? normalized.slice(0, max) : undefined;
}

function inferTopicCluster(parts: Array<string | null | undefined>) {
  const tokens = parts
    .flatMap((part) => (typeof part === "string" ? part.toLowerCase().split(/[^a-z0-9]+/g) : []))
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
  return tokens[0];
}

function inferSignalStrength(params: {
  action: string;
  detail?: string;
  title?: string;
  targetKind?: string;
}) {
  let score = 0.45;
  if (params.targetKind) score += 0.2;
  if (params.detail && params.detail.length > 80) score += 0.1;
  if (/plan|flashcard|thread|task|note|artifact/i.test(params.action)) score += 0.15;
  if (/blocked|urgent|due|deadline/i.test(`${params.title ?? ""} ${params.detail ?? ""}`)) score += 0.1;
  return Math.max(0.1, Math.min(1, Number(score.toFixed(2))));
}

function inferThreadStatus(params: {
  action: string;
  summary?: string;
  detail?: string;
}) {
  const haystack = `${params.summary ?? ""} ${params.detail ?? ""}`.toLowerCase();
  if (/blocked|stuck|waiting|missing/.test(haystack)) return "blocked" as const;
  if (params.action === "summarize" || /done|completed|resolved|saved/.test(haystack)) return "resolved" as const;
  return "open" as const;
}

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    intent: vIntent,
    status: vStatus,
    title: v.string(),
    summary: v.string(),
    detail: v.optional(v.string()),
    variant: v.optional(vVariant),
    targetKind: v.optional(vTargetKind),
    targetId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    topicCluster: v.optional(v.string()),
    timelineAt: v.optional(v.number()),
    signalStrength: v.optional(v.number()),
    threadStatus: v.optional(vThreadStatus),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await validateWorkstream(ctx, actor, args.workstreamId);
    const now = Date.now();
    const resultId = await ctx.db.insert("workspaceCommandResults", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      sourceChatId: args.sourceChatId,
      sourceMessageId: args.sourceMessageId,
      intent: args.intent,
      status: args.status,
      title: args.title.trim(),
      summary: args.summary.trim(),
      detail: args.detail?.trim(),
      variant: args.variant,
      targetKind: args.targetKind,
      targetId: args.targetId,
      topicCluster: args.topicCluster ?? inferTopicCluster([args.title, args.summary, args.detail]),
      timelineAt: args.timelineAt,
      signalStrength: args.signalStrength ?? inferSignalStrength({
        action: args.intent,
        detail: args.detail,
        title: args.title,
        targetKind: args.targetKind,
      }),
      threadStatus: args.threadStatus ?? inferThreadStatus({
        action: args.intent,
        summary: args.summary,
        detail: args.detail,
      }),
      metadata: normalizeWorkspaceResultMetadata(args.metadata),
      createdAt: now,
      updatedAt: now,
    });

    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      mutationType: "workspace_command_result",
      source: "ai",
      entity: "workspace-result",
      action: "created",
      includeHub: true,
      refreshHub: true,
      summary: `Created workspace ${args.intent} result ${args.title.trim()}`,
      after: { resultId, intent: args.intent, status: args.status, targetKind: args.targetKind, targetId: args.targetId },
    });

    return { resultId };
  },
});

export const listForWorkstream = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    status: v.optional(vStatus),
    includeDismissed: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await validateWorkstream(ctx, actor, args.workstreamId);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    let rows = await ctx.db
      .query("workspaceCommandResults")
      .withIndex("by_workstream_updated", (q) => q.eq("workstreamId", args.workstreamId))
      .order("desc")
      .take(args.status || args.includeDismissed ? limit : Math.min(limit * 3, 300));
    rows = rows.filter((row) => row.ownerUserId === actor._id && row.orgId === actor.orgId);
    if (args.status) {
      rows = rows.filter((row) => row.status === args.status);
    } else if (!args.includeDismissed) {
      rows = rows.filter((row) => row.status !== "dismissed");
    }
    return rows.slice(0, limit);
  },
});

export const getForTarget = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    targetKind: vTargetKind,
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await validateWorkstream(ctx, actor, args.workstreamId);
    const rows = await ctx.db
      .query("workspaceCommandResults")
      .withIndex("by_workstream_updated", (q) => q.eq("workstreamId", args.workstreamId))
      .order("desc")
      .take(200);

    return rows.find((row) =>
      row.ownerUserId === actor._id
      && row.orgId === actor.orgId
      && row.targetKind === args.targetKind
      && row.targetId === args.targetId,
    ) ?? null;
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    resultId: v.id("workspaceCommandResults"),
    status: v.optional(vStatus),
    summary: v.optional(v.string()),
    title: v.optional(v.string()),
    detail: v.optional(v.string()),
    targetKind: v.optional(vTargetKind),
    targetId: v.optional(v.string()),
    variant: v.optional(vVariant),
    metadata: v.optional(v.any()),
    topicCluster: v.optional(v.string()),
    timelineAt: v.optional(v.number()),
    signalStrength: v.optional(v.number()),
    threadStatus: v.optional(vThreadStatus),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const row = await ctx.db.get(args.resultId);
    if (!row || row.ownerUserId !== actor._id || row.orgId !== actor.orgId) {
      throw new Error("Workspace result not found");
    }
    const now = Date.now();
    const patch = {
      status: args.status ?? row.status,
      title: args.title ? args.title.trim() : row.title,
      summary: args.summary ? args.summary.trim() : row.summary,
      detail: args.detail ? args.detail.trim() : row.detail,
      targetKind: args.targetKind ?? row.targetKind,
      targetId: args.targetId ?? row.targetId,
      variant: args.variant ?? row.variant,
      topicCluster: args.topicCluster ?? row.topicCluster,
      timelineAt: args.timelineAt ?? row.timelineAt,
      signalStrength: args.signalStrength ?? row.signalStrength,
      threadStatus: args.threadStatus ?? row.threadStatus,
      metadata: normalizeWorkspaceResultMetadata(args.metadata ?? row.metadata),
      updatedAt: now,
    };
    await ctx.db.patch(args.resultId, patch);
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: row.workstreamId,
      mutationType: "update_workspace_command_result",
      source: "ai",
      entity: "workspace-result",
      action: "updated",
      includeHub: true,
      refreshHub: true,
      summary: `Updated workspace result ${patch.title}`,
      before: {
        status: row.status,
        title: row.title,
        summary: row.summary,
        targetKind: row.targetKind,
        targetId: row.targetId,
      },
      after: patch,
    });
    return { success: true };
  },
});

export const dismiss = mutation({
  args: {
    actorClerkId: v.string(),
    resultId: v.id("workspaceCommandResults"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const row = await ctx.db.get(args.resultId);
    if (!row || row.ownerUserId !== actor._id || row.orgId !== actor.orgId) {
      throw new Error("Workspace result not found");
    }
    const now = Date.now();
    await ctx.db.patch(args.resultId, {
      status: "dismissed",
      dismissedAt: now,
      updatedAt: now,
    });
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: row.workstreamId,
      mutationType: "dismiss_workspace_command_result",
      source: "user",
      entity: "workspace-result",
      action: "updated",
      includeHub: true,
      refreshHub: true,
      summary: `Dismissed workspace result ${row.title}`,
      before: { resultId: row._id, status: row.status },
      after: { resultId: row._id, status: "dismissed" },
    });
    return { success: true };
  },
});

export const reopen = mutation({
  args: {
    actorClerkId: v.string(),
    resultId: v.id("workspaceCommandResults"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const row = await ctx.db.get(args.resultId);
    if (!row || row.ownerUserId !== actor._id || row.orgId !== actor.orgId) {
      throw new Error("Workspace result not found");
    }
    const now = Date.now();
    await ctx.db.patch(args.resultId, {
      status: "completed",
      dismissedAt: undefined,
      updatedAt: now,
    });
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: row.workstreamId,
      mutationType: "reopen_workspace_command_result",
      source: "user",
      entity: "workspace-result",
      action: "updated",
      includeHub: true,
      refreshHub: true,
      summary: `Reopened workspace result ${row.title}`,
      before: { resultId: row._id, status: row.status },
      after: { resultId: row._id, status: "completed" },
    });
    return { success: true };
  },
});

function normalizeCards(cards: unknown) {
  if (!Array.isArray(cards)) return [];
  return cards
    .map((card) => {
      if (!card || typeof card !== "object") return null;
      const front = normalizeText((card as { front?: string }).front, 240);
      const back = normalizeText((card as { back?: string }).back, 320);
      if (!front || !back) return null;
      return { front, back };
    })
    .filter((card): card is { front: string; back: string } => Boolean(card));
}

async function syncPlannerWorkspaceProjection(
  ctx: Pick<MutationCtx, "db">,
  actor: Awaited<ReturnType<typeof requireActor>>,
  plannerItemId: Id<"plannerItems">,
) {
  const plannerItem = await ctx.db.get(plannerItemId);
  if (!plannerItem || plannerItem.ownerUserId !== actor._id || plannerItem.orgId !== actor.orgId) {
    return null;
  }

  const rows = await ctx.db
    .query("workspaceItems")
    .withIndex("by_source_planner", (q) => q.eq("sourcePlannerItemId", plannerItemId))
    .collect();
  const existing = rows.find((row) => row.ownerUserId === actor._id && row.orgId === actor.orgId) ?? null;
  const now = Date.now();
  const shouldArchive = !plannerItem.workstreamId || plannerItem.status === "cancelled";

  if (shouldArchive) {
    if (existing && existing.status !== "archived") {
      await ctx.db.patch(existing._id, { status: "archived", updatedAt: now });
    }
    return existing?._id ?? null;
  }

  const fields = {
    workstreamId: plannerItem.workstreamId,
    type: "planner" as const,
    itemType: "planner" as const,
    sourceKind: "plannerItem" as const,
    sourceId: plannerItemId,
    sourcePlannerItemId: plannerItemId,
    renderMode: plannerItem.type,
    title: plannerItem.title,
    contentSummary: normalizeText(plannerItem.description, 280),
    searchText: buildWorkspaceSearchText(plannerItem.title, normalizeText(plannerItem.description, 280), plannerItem.type, "planner"),
    category: "planner" as const,
    status: "active" as const,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return existing._id;
  }

  return await ctx.db.insert("workspaceItems", {
    orgId: actor.orgId,
    ownerUserId: actor._id,
    workstreamId: plannerItem.workstreamId,
    type: "planner",
    itemType: "planner",
    sourceKind: "plannerItem",
    sourceId: plannerItemId,
    sourcePlannerItemId: plannerItemId,
    renderMode: plannerItem.type,
    title: plannerItem.title,
    contentSummary: normalizeText(plannerItem.description, 280),
    searchText: buildWorkspaceSearchText(plannerItem.title, normalizeText(plannerItem.description, 280), plannerItem.type, "planner"),
    x: 80,
    y: 220,
    width: 280,
    height: 160,
    category: "planner",
    status: "active",
    pinned: true,
    collapsed: false,
    hidden: false,
    provenanceSource: "ai",
    createdAt: now,
    updatedAt: now,
  });
}

async function findWorkspaceItemBySource(ctx: Pick<MutationCtx, "db">, actor: Awaited<ReturnType<typeof requireActor>>, source: { artifactId?: Id<"artifacts">; plannerItemId?: Id<"plannerItems">; chatId?: Id<"chats"> }) {
  if (source.artifactId) {
    const rows = await ctx.db.query("workspaceItems").withIndex("by_source_artifact", (q) => q.eq("sourceArtifactId", source.artifactId)).collect();
    return rows.find((row) => row.ownerUserId === actor._id && row.orgId === actor.orgId) ?? null;
  }
  if (source.plannerItemId) {
    const rows = await ctx.db.query("workspaceItems").withIndex("by_source_planner", (q) => q.eq("sourcePlannerItemId", source.plannerItemId)).collect();
    return rows.find((row) => row.ownerUserId === actor._id && row.orgId === actor.orgId) ?? null;
  }
  if (source.chatId) {
    const rows = await ctx.db.query("workspaceItems").withIndex("by_source_chat", (q) => q.eq("sourceChatId", source.chatId)).collect();
    return rows.find((row) => row.ownerUserId === actor._id && row.orgId === actor.orgId) ?? null;
  }
  return null;
}

export const executeQuickAction = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    prompt: v.string(),
    action: v.optional(v.union(
      v.literal("summarize"),
      v.literal("make_flashcards"),
      v.literal("plan_week"),
      v.literal("create_note"),
      v.literal("create_task"),
      v.literal("create_thread"),
      v.literal("artifact_request"),
    )),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    cards: v.optional(v.array(v.object({ front: v.string(), back: v.string() }))),
    targetArtifactId: v.optional(v.id("artifacts")),
    targetPlannerItemId: v.optional(v.id("plannerItems")),
    targetChatId: v.optional(v.id("chats")),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await validateWorkstream(ctx, actor, args.workstreamId);
    const now = Date.now();
    const prompt = normalizeText(args.prompt, 600) ?? "Quick action";
    const action = args.action
      ?? (/flashcard/i.test(prompt) ? "make_flashcards"
        : /plan.+week|week.+plan|exam week/i.test(prompt) ? "plan_week"
        : /thread|chat|discuss/i.test(prompt) ? "create_thread"
        : /task|todo|deadline|remind/i.test(prompt) ? "create_task"
        : /note|write down|capture/i.test(prompt) ? "create_note"
        : /artifact|document|deck|study guide/i.test(prompt) ? "artifact_request"
        : "summarize");

    const targetArtifact = args.targetArtifactId ? await ctx.db.get(args.targetArtifactId) : null;
    if (targetArtifact && (targetArtifact.ownerUserId !== actor._id || targetArtifact.orgId !== actor.orgId)) {
      throw new Error("Artifact not found");
    }

    let resultTitle = normalizeText(args.title, 120) ?? prompt.slice(0, 80);
    let summary = normalizeText(args.content, 240) ?? prompt;
    let detail = normalizeText(args.content, 2000);
    let intent: "note" | "planner" | "thread" | "result" | "widget" = "result";
    let variant: "summary" | "answer" | "artifact" | "planner" | "thread" = "answer";
    let targetKind: "artifact" | "plannerItem" | "chat" | "workspaceItem" | "result" | undefined;
    let targetId: string | undefined;
    const metadata: Record<string, unknown> = { ...normalizeWorkspaceResultMetadata(args.metadata), action, prompt };

    if (action === "summarize" || action === "artifact_request") {
      let artifact = targetArtifact;
      if (!artifact) {
        const artifacts = await ctx.db.query("artifacts").withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId)).collect();
        artifact = artifacts
          .filter((row) => row.ownerUserId === actor._id && row.orgId === actor.orgId && row.status === "active")
          .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
      }
      if (artifact) {
        resultTitle = normalizeText(args.title, 120) ?? `Summary · ${artifact.title}`;
        summary = normalizeText(artifact.contentPlaintext, 240) ?? `Summarized ${artifact.title}`;
        detail = normalizeText(artifact.contentPlaintext, 2000);
        variant = action === "artifact_request" ? "artifact" : "summary";
        targetKind = "artifact";
        targetId = artifact._id;
        metadata.sourceArtifactId = artifact._id;
        metadata.artifactType = artifact.type;
      } else {
        summary = `No artifact available yet — captured request: ${prompt}`;
        variant = "summary";
      }
    } else if (action === "make_flashcards") {
      const cards = normalizeCards(args.cards ?? [
        { front: `Key idea`, back: prompt },
        { front: `Most important detail`, back: normalizeText(args.content, 180) ?? prompt },
      ]);
      if (cards.length === 0) throw new Error("No flashcards to save");
      let chatId = args.targetChatId;
      if (!chatId) {
        const chatIdResult = await ctx.db.insert("chats", {
          orgId: actor.orgId,
          workstreamId: args.workstreamId,
          ownerUserId: actor._id,
          title: normalizeText(args.title, 120) ?? `Flashcards · ${prompt.slice(0, 48)}`,
          latestUserPrompt: prompt,
          messageCount: 0,
          mode: "flashcard",
          thinkingLevel: "low",
          routerMode: "auto",
          usePersonalResources: true,
          createdAt: now,
          updatedAt: now,
        });
        chatId = chatIdResult;
      }
      const deckId = await ctx.db.insert("flashcardDecks", {
        userId: actor._id,
        orgId: actor.orgId,
        chatId,
        sourceMessageId: args.sourceMessageId,
        title: normalizeText(args.title, 120) ?? `Flashcards · ${prompt.slice(0, 48)}`,
        cards: cards.map((card) => ({ ...card, cardHash: `${card.front.toLowerCase()}::${card.back.toLowerCase()}` })),
        createdAt: now,
        updatedAt: now,
        lastReviewedAt: undefined,
      });
      resultTitle = normalizeText(args.title, 120) ?? `Created ${cards.length} flashcards`;
      summary = `Saved ${cards.length} flashcards for review.`;
      detail = cards.map((card, index) => `${index + 1}. ${card.front} → ${card.back}`).join("\n");
      intent = "result";
      variant = "artifact";
      targetKind = "chat";
      targetId = chatId;
      metadata.deckId = deckId;
      metadata.cardCount = cards.length;
    } else if (action === "plan_week" || action === "create_task") {
      const plannerId = await ctx.db.insert("plannerItems", {
        ownerUserId: actor._id,
        orgId: actor.orgId,
        workstreamId: args.workstreamId,
        title: normalizeText(args.title, 120) ?? (action === "plan_week" ? "Weekly plan" : "New task"),
        description: normalizeText(args.content, 400) ?? prompt,
        type: action === "plan_week" ? "goal" : "deadline",
        priority: "medium",
        status: "pending",
        dueAt: args.dueAt,
        sourceType: "ai_suggested",
        createdAt: now,
        updatedAt: now,
      });
      const workspaceItemId = await syncPlannerWorkspaceProjection(ctx, actor, plannerId);
      resultTitle = normalizeText(args.title, 120) ?? (action === "plan_week" ? "Weekly plan created" : "Task created");
      summary = action === "plan_week" ? "Created a planner item for this week." : "Created a planner task.";
      detail = normalizeText(args.content, 1200) ?? prompt;
      intent = "planner";
      variant = "planner";
      targetKind = "plannerItem";
      targetId = plannerId;
      metadata.workspaceItemId = workspaceItemId;
    } else if (action === "create_note") {
      const artifactId = await ctx.db.insert("artifacts", {
        ownerUserId: actor._id,
        orgId: actor.orgId,
        workstreamId: args.workstreamId,
        type: "note",
        title: normalizeText(args.title, 120) ?? "Quick note",
        content: args.content ?? prompt,
        contentPlaintext: normalizeText(args.content, 2000) ?? prompt,
        editorMode: "standard",
        sourceType: "ai_generated",
        status: "active",
        pinnedAt: undefined,
        createdAt: now,
        updatedAt: now,
      });
      const workspaceItem = await findWorkspaceItemBySource(ctx, actor, { artifactId });
      resultTitle = normalizeText(args.title, 120) ?? "Quick note created";
      summary = "Saved a note to the workspace.";
      detail = normalizeText(args.content, 2000) ?? prompt;
      intent = "note";
      variant = "artifact";
      targetKind = "artifact";
      targetId = artifactId;
      metadata.workspaceItemId = workspaceItem?._id;
    } else if (action === "create_thread") {
      const chatId = await ctx.db.insert("chats", {
        orgId: actor.orgId,
        workstreamId: args.workstreamId,
        ownerUserId: actor._id,
        title: normalizeText(args.title, 120) ?? "Quick chat thread",
        latestUserPrompt: prompt,
        messageCount: 1,
        mode: "general",
        thinkingLevel: "low",
        routerMode: "auto",
        usePersonalResources: true,
        createdAt: now,
        updatedAt: now,
      });
      const messageId = await ctx.db.insert("messages", {
        orgId: actor.orgId,
        packId: undefined,
        chatId,
        userId: actor._id,
        clientMessageId: undefined,
        role: "user",
        mode: "general",
        content: prompt,
        citations: [],
        modelRequested: undefined,
        modelUsed: undefined,
        whyThisResponse: "workspace_quick_action",
        usageIn: undefined,
        usageOut: undefined,
        verificationPassed: undefined,
        thinkingContent: undefined,
        routeTrace: {
          mode: "general",
          routerMode: "auto",
          model: "workspace_quick_action",
          reason: "workspace quick action created thread",
        },
        cancelled: undefined,
        parentMessageId: undefined,
        attachments: undefined,
        attachmentResourceIds: undefined,
        createdAt: now,
      });
      const currentChat = await ctx.db.get(chatId);
      if (currentChat) {
        await ctx.db.patch(chatId, {
          latestUserPrompt: prompt,
          messageCount: (currentChat.messageCount ?? 0) + 1,
          updatedAt: now,
        });
      }
      await syncWorkspaceItemForChat(ctx, {
        chatId,
        ownerUserId: actor._id,
        orgId: actor.orgId,
        workstreamId: args.workstreamId,
        title: normalizeText(args.title, 120) ?? "Quick chat thread",
        latestUserPrompt: prompt,
        contextSummary: prompt,
        createdAt: now,
        updatedAt: now,
        provenanceSource: "ai",
      });
      const workspaceItem = await findWorkspaceItemBySource(ctx, actor, { chatId });
      resultTitle = normalizeText(args.title, 120) ?? "Thread created";
      summary = "Started a linked workspace thread.";
      detail = prompt;
      intent = "thread";
      variant = "thread";
      targetKind = "chat";
      targetId = chatId;
      metadata.workspaceItemId = workspaceItem?._id;
      metadata.messageId = messageId;
    }

    if (targetKind === "artifact" && targetId) {
      const artifactId = targetId as Id<"artifacts">;
      const artifact = await ctx.db.get(artifactId);
      if (artifact && artifact.ownerUserId === actor._id && artifact.orgId === actor.orgId) {
        await syncWorkspaceItemForArtifact(ctx, {
          artifactId,
          ownerUserId: actor._id,
          orgId: actor.orgId,
          workstreamId: artifact.workstreamId,
          status: artifact.status,
          title: artifact.title,
          artifactType: artifact.type,
          contentPlaintext: artifact.contentPlaintext,
        });
        const workspaceItem = await findWorkspaceItemBySource(ctx, actor, { artifactId });
        if (workspaceItem) metadata.workspaceItemId = workspaceItem._id;
      }
    } else if (targetKind === "plannerItem" && targetId) {
      const workspaceItemId = await syncPlannerWorkspaceProjection(ctx, actor, targetId as Id<"plannerItems">);
      if (workspaceItemId) metadata.workspaceItemId = workspaceItemId;
    } else if (targetKind === "chat" && targetId) {
      const workspaceItem = await findWorkspaceItemBySource(ctx, actor, { chatId: targetId as Id<"chats"> });
      if (workspaceItem) metadata.workspaceItemId = workspaceItem._id;
    }

    const resultId = await ctx.db.insert("workspaceCommandResults", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      sourceChatId: args.sourceChatId,
      sourceMessageId: args.sourceMessageId,
      intent,
      status: "completed",
      title: resultTitle,
      summary,
      detail,
      variant,
      targetKind,
      targetId,
      topicCluster: inferTopicCluster([resultTitle, summary, detail, prompt]),
      timelineAt: args.dueAt,
      signalStrength: inferSignalStrength({ action, detail, title: resultTitle, targetKind }),
      threadStatus: inferThreadStatus({ action, summary, detail }),
      metadata: normalizeWorkspaceResultMetadata(metadata),
      createdAt: now,
      updatedAt: now,
    });

    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      mutationType: "execute_workspace_quick_action",
      source: "ai",
      entity: "workspace-result",
      action: "created",
      includeHub: true,
      refreshHub: true,
      summary: `Executed quick action ${action}`,
      after: { resultId, action, targetKind, targetId },
    });

    return { resultId, action, targetKind, targetId };
  },
});
