import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";

const vOrigin = v.union(v.literal("chat"), v.literal("workspace"), v.literal("artifact"));
const vRole = v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool"));

function cleanTitle(value: string) {
  const words = value
    .replace(/[`*_#[\](){}<>]/g, " ")
    .replace(/\b(please|can|could|would|spectra|help|me|with|about|the|a|an|to|for|from|into|this|that|these|those)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "New thread";
  const title = words.slice(0, 4).join(" ").replace(/[.!?,;:]+$/, "").slice(0, 48);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function cleanContent(value: string) {
  return value.replace(/\u0000/g, "").trim().slice(0, 60_000);
}

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], clerkId: string) {
  const actor = await getUserByClerkId(ctx, clerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function requireOwnedThread(
  ctx: Parameters<typeof getUserByClerkId>[0],
  clerkId: string,
  threadId: Id<"spectraThreads">,
) {
  const actor = await requireActor(ctx, clerkId);
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.ownerUserId !== actor._id || thread.orgId !== actor.orgId || thread.status === "deleted") {
    throw new Error("Thread not found");
  }
  return { actor, thread };
}

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    title: v.optional(v.string()),
    origin: vOrigin,
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    if (args.workspaceId) {
      const workspace = await ctx.db.get(args.workspaceId);
      if (!workspace || workspace.ownerUserId !== actor._id || workspace.orgId !== actor.orgId) throw new Error("Workspace not found");
    }
    if (args.artifactId) {
      const artifact = await ctx.db.get(args.artifactId);
      if (!artifact || artifact.ownerUserId !== actor._id || artifact.orgId !== actor.orgId) throw new Error("Artifact not found");
    }
    const now = Date.now();
    return ctx.db.insert("spectraThreads", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      title: args.title?.trim().slice(0, 88) || "New thread",
      origin: args.origin,
      workspaceId: args.workspaceId,
      artifactId: args.artifactId,
      status: "active",
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const appendMessage = mutation({
  args: {
    actorClerkId: v.string(),
    threadId: v.id("spectraThreads"),
    role: vRole,
    content: v.string(),
    runId: v.optional(v.id("spectraAiRuns")),
    executionId: v.optional(v.string()),
    clientMessageId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { thread } = await requireOwnedThread(ctx, args.actorClerkId, args.threadId);
    const content = cleanContent(args.content);
    if (!content) throw new Error("Message content is required");
    if (args.clientMessageId) {
      const existing = await ctx.db.query("spectraMessages")
        .withIndex("by_thread_client", (q) => q.eq("threadId", args.threadId).eq("clientMessageId", args.clientMessageId))
        .unique();
      if (existing) return existing._id;
    }
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (!run || run.ownerUserId !== thread.ownerUserId || run.threadId !== args.threadId || (args.executionId && run.executionId !== args.executionId)) throw new Error("AI run not found");
      const partial = args.metadata && typeof args.metadata === "object" && (args.metadata as { partial?: unknown }).partial === true;
      if (partial && run.status !== "running") throw new Error("This run is no longer streaming.");
      if (args.role === "assistant") {
        const existing = (await ctx.db.query("spectraMessages").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect())
          .find((message) => message.role === "assistant");
        if (existing) {
          await ctx.db.patch(existing._id, { content, metadata: args.metadata });
          return existing._id;
        }
      }
    }
    const now = Date.now();
    const messageId = await ctx.db.insert("spectraMessages", {
      threadId: args.threadId,
      role: args.role,
      content,
      runId: args.runId,
      clientMessageId: args.clientMessageId,
      metadata: args.metadata,
      createdAt: now,
    });
    const firstUserMessage = args.role === "user" && (thread.messageCount ?? 0) === 0;
    await ctx.db.patch(args.threadId, {
      title: firstUserMessage && thread.title === "New thread" ? cleanTitle(content) : thread.title,
      messageCount: (thread.messageCount ?? 0) + 1,
      lastMessageAt: now,
      lastRunId: args.runId ?? thread.lastRunId,
      updatedAt: now,
    });
    return messageId;
  },
});

export const selectMessageChoice = mutation({
  args: {
    actorClerkId: v.string(),
    messageId: v.id("spectraMessages"),
    choiceKey: v.string(),
    choiceTitle: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("This choice is no longer available.");
    await requireOwnedThread(ctx, args.actorClerkId, message.threadId);
    const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata as Record<string, unknown> : {};
    const existing = metadata.choiceSelection;
    if (existing && typeof existing === "object") {
      const row = existing as { key?: unknown; title?: unknown };
      if (row.key === args.choiceKey) return { selected: true, alreadySelected: true, choiceTitle: row.title };
      throw new Error("A choice was already selected for this question.");
    }
    const now = Date.now();
    await ctx.db.patch(args.messageId, {
      metadata: { ...metadata, choiceSelection: { key: args.choiceKey.slice(0, 120), title: args.choiceTitle.slice(0, 200), selectedAt: now } },
    });
    if (message.runId) {
      const run = await ctx.db.get(message.runId);
      if (run) {
        const sequence = (run.eventSequence ?? 0) + 1;
        await ctx.db.insert("spectraRunEvents", { runId: run._id, executionId: run.executionId ?? "choice", sequence, type: "choice_selected", payload: { type: "choice_selected", runId: run._id, choiceTitle: args.choiceTitle.slice(0, 200) }, createdAt: now });
        await ctx.db.patch(run._id, { eventSequence: sequence, updatedAt: now });
      }
    }
    return { selected: true, alreadySelected: false, choiceTitle: args.choiceTitle.slice(0, 200) };
  },
});

export const list = query({
  args: { actorClerkId: v.string(), includeArchived: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 80, 200));
    const rows = await ctx.db.query("spectraThreads")
      .withIndex("by_owner_status", (q) => q.eq("ownerUserId", actor._id).eq("status", "active"))
      .order("desc")
      .take(limit * 2);
    const archived = args.includeArchived
      ? await ctx.db.query("spectraThreads").withIndex("by_owner_status", (q) => q.eq("ownerUserId", actor._id).eq("status", "archived")).order("desc").take(limit)
      : [];
    return [...rows, ...archived]
      .filter((thread) => thread.orgId === actor.orgId)
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt))
      .slice(0, limit);
  },
});

export const get = query({
  args: { actorClerkId: v.string(), threadId: v.id("spectraThreads") },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.actorClerkId, args.threadId);
    const messages = await ctx.db.query("spectraMessages").withIndex("by_thread_created", (q) => q.eq("threadId", args.threadId)).order("desc").take(160);
    messages.reverse();
    const runIds = [...new Set(messages.flatMap((message) => message.runId ? [message.runId] : []))];
    const traces = await Promise.all(runIds.map(async (runId) => {
      const run = await ctx.db.get(runId);
      if (!run) return null;
      const [operations, cards, events] = await Promise.all([
        ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", runId)).collect(),
        ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", runId)).collect(),
        ctx.db.query("spectraRunEvents").withIndex("by_run_sequence", (q) => q.eq("runId", runId)).collect(),
      ]);
      const artifactIds = [...new Set(operations.flatMap((operation) => operation.affected)
        .filter((affected) => affected.type === "artifact").map((affected) => affected.id))];
      const artifacts = (await Promise.all(artifactIds.map(async (id) => {
        const artifactId = ctx.db.normalizeId("spectraArtifacts", id);
        const artifact = artifactId ? await ctx.db.get(artifactId) : null;
        return artifact && artifact.ownerUserId === thread.ownerUserId ? artifact : null;
      }))).filter(Boolean);
      return { run, operations, cards, events: events.sort((a, b) => a.sequence - b.sequence), artifacts };
    }));
    return { thread, messages, traces: traces.filter(Boolean), viewerName: actor.name };
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(), threadId: v.id("spectraThreads"),
    title: v.optional(v.string()), pinned: v.optional(v.boolean()),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.actorClerkId, args.threadId);
    if (args.workspaceId) {
      const workspace = await ctx.db.get(args.workspaceId);
      if (!workspace || workspace.ownerUserId !== actor._id || workspace.orgId !== actor.orgId || workspace.status !== "active") throw new Error("Workspace not found");
    }
    await ctx.db.patch(args.threadId, {
      title: args.title === undefined ? thread.title : cleanTitle(args.title),
      pinned: args.pinned ?? thread.pinned,
      workspaceId: args.workspaceId ?? thread.workspaceId,
      status: args.status ?? thread.status,
      updatedAt: Date.now(),
    });
    return { threadId: args.threadId };
  },
});

export const applyGeneratedMetadata = mutation({
  args: {
    actorClerkId: v.string(),
    threadId: v.id("spectraThreads"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { thread } = await requireOwnedThread(ctx, args.actorClerkId, args.threadId);
    const run = await ctx.db.get(args.runId);
    if (!run || run.threadId !== args.threadId || run.status !== "running" || run.executionId !== args.executionId) throw new Error("This title belongs to an older run attempt.");
    const messageCount = thread.messageCount ?? 0;
    const provisionalTitle = thread.title === "New thread" || thread.title.split(/\s+/).length >= 8;
    // Sparse title windows avoid sidebar instability while allowing a weak
    // first-prompt title to improve once the purpose becomes clear.
    const mayRetitle = messageCount <= 2 || provisionalTitle || (messageCount >= 6 && messageCount <= 8) || (messageCount >= 16 && messageCount <= 18);
    await ctx.db.patch(args.threadId, {
      title: mayRetitle && args.title ? cleanTitle(args.title) : thread.title,
      summaryShort: args.summary?.replace(/\s+/g, " ").trim().slice(0, 320) || thread.summaryShort,
      updatedAt: Date.now(),
    });
    return { threadId: args.threadId };
  },
});

export const createFromRun = mutation({
  args: {
    actorClerkId: v.string(), runId: v.id("spectraAiRuns"),
    placeInWorkspace: v.optional(v.boolean()), createReference: v.optional(v.boolean()),
    localMessages: v.optional(v.array(v.object({
      id: v.string(),
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      runId: v.optional(v.id("spectraAiRuns")),
      createdAt: v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerUserId !== actor._id || run.orgId !== actor.orgId) throw new Error("AI run not found");
    let threadId = run.threadId;
    const now = Date.now();
    if (!threadId) {
      threadId = await ctx.db.insert("spectraThreads", {
        ownerUserId: actor._id, orgId: actor.orgId, title: cleanTitle(run.suggestedThreadTitle ?? run.userPrompt),
        origin: run.sourceSurface, workspaceId: run.workspaceId, artifactId: run.artifactId,
        status: "active", messageCount: run.finalSummary ? 2 : 1,
        createdAt: run.createdAt, updatedAt: now, lastMessageAt: now, lastRunId: run._id,
      });
      await ctx.db.insert("spectraMessages", { threadId, role: "user", content: cleanContent(run.userPrompt), runId: run._id, createdAt: run.createdAt });
      if (run.finalSummary) await ctx.db.insert("spectraMessages", {
        threadId, role: "assistant", content: cleanContent(run.finalSummary), runId: run._id,
        metadata: { decision: run.decision, hasOperationalTrace: true }, createdAt: run.completedAt ?? now,
      });
      await ctx.db.patch(run._id, { threadId, updatedAt: now });
    }

    let appendedLocalCount = 0;
    for (const message of (args.localMessages ?? []).slice(0, 60)) {
      const clientMessageId = `local:${message.id.slice(0, 180)}`;
      const existing = await ctx.db.query("spectraMessages").withIndex("by_thread_client", (q) => q.eq("threadId", threadId!).eq("clientMessageId", clientMessageId)).unique();
      if (existing) continue;
      const content = cleanContent(message.content);
      if (!content) continue;
      await ctx.db.insert("spectraMessages", { threadId, role: message.role, content, runId: message.runId, clientMessageId, createdAt: message.createdAt });
      if (message.runId) {
        const childRun = await ctx.db.get(message.runId);
        if (childRun && childRun.ownerUserId === actor._id && !childRun.threadId) await ctx.db.patch(message.runId, { threadId, updatedAt: now });
      }
      appendedLocalCount += 1;
    }
    if (appendedLocalCount > 0) {
      const currentThread = await ctx.db.get(threadId);
      if (currentThread) await ctx.db.patch(threadId, { messageCount: (currentThread.messageCount ?? 0) + appendedLocalCount, lastMessageAt: now, updatedAt: now });
    }

    let referenceArtifactId: Id<"spectraArtifacts"> | undefined;
    let workspaceItemId: Id<"spectraWorkspaceItems"> | undefined;
    if (args.createReference !== false) {
      const existing = await ctx.db.query("spectraArtifacts").withIndex("by_owner_blueprint", (q) => q.eq("ownerUserId", actor._id).eq("blueprintKey", "thread_reference")).collect();
      const found = existing.find((artifact) => (artifact.content as { threadId?: string } | null)?.threadId === threadId && artifact.status !== "deleted");
      referenceArtifactId = found?._id;
      if (!referenceArtifactId) {
        referenceArtifactId = await ctx.db.insert("spectraArtifacts", {
          ownerUserId: actor._id, orgId: actor.orgId, blueprintKey: "thread_reference",
          title: cleanTitle(run.suggestedThreadTitle ?? run.userPrompt), summary: (run.suggestedThreadSummary ?? run.finalSummary)?.slice(0, 240),
          content: { threadId, summary: run.finalSummary ?? "", linkedArtifactIds: [] },
          textIndex: `${run.userPrompt} ${run.finalSummary ?? ""}`.slice(0, 8_000), tags: ["thread"], status: "active",
          createdFrom: { source: run.sourceSurface, threadId, runId: run._id, workspaceId: run.workspaceId },
          createdAt: now, updatedAt: now,
        });
      }
      if (args.placeInWorkspace && run.workspaceId && referenceArtifactId) {
        const workspace = await ctx.db.get(run.workspaceId);
        if (workspace && workspace.ownerUserId === actor._id && workspace.orgId === actor.orgId) {
          const placement = await ctx.db.query("spectraWorkspaceItems").withIndex("by_workspace_source", (q) => q.eq("workspaceId", run.workspaceId!).eq("sourceType", "artifact").eq("sourceId", referenceArtifactId!)).unique();
          workspaceItemId = placement?._id;
          if (!workspaceItemId) workspaceItemId = await ctx.db.insert("spectraWorkspaceItems", {
            workspaceId: run.workspaceId, sourceType: "artifact", sourceId: referenceArtifactId,
            viewData: { compactSummary: run.finalSummary?.slice(0, 180), pinned: true },
            layout: { view: "cards" }, createdAt: now, updatedAt: now,
          });
        }
      }
    }
    return { threadId, referenceArtifactId, workspaceItemId };
  },
});
