import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";
import { ensureThreadWorkspacePlacement, requireArtifactCapability, requireWorkspaceCapability } from "./spectraShared";

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

async function requireActor(ctx: Parameters<typeof getAuthenticatedActor>[0]) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

async function requireOwnedThread(
  ctx: Parameters<typeof getAuthenticatedActor>[0],
  threadId: Id<"spectraThreads">,
) {
  const actor = await requireActor(ctx);
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.ownerAccountId !== actor._id || thread.schoolId !== actor.schoolId || thread.status === "deleted") {
    throw new Error("Thread not found");
  }
  return { actor, thread };
}

export const create = mutation({
  args: {
    title: v.optional(v.string()),
    origin: vOrigin,
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (args.workspaceId) await requireWorkspaceCapability(ctx, args.workspaceId, "read");
    if (args.artifactId) await requireArtifactCapability(ctx, args.artifactId, "read");
    const now = Date.now();
    const threadId = await ctx.db.insert("spectraThreads", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      title: args.title?.trim().slice(0, 88) || "New thread",
      origin: args.origin,
      workspaceId: args.workspaceId,
      artifactId: args.artifactId,
      status: "active",
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ensureThreadWorkspacePlacement(ctx, {
      threadId,
      workspaceId: args.workspaceId,
      summary: "Conversation ready",
    });
    if (args.workspaceId) {
      await ctx.db.patch(args.workspaceId, { updatedAt: now, lastActivityAt: now });
    }
    return threadId;
  },
});

export const appendMessage = mutation({
  args: {
    threadId: v.id("spectraThreads"),
    role: vRole,
    content: v.string(),
    runId: v.optional(v.id("spectraAiRuns")),
    executionId: v.optional(v.string()),
    clientMessageId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { thread } = await requireOwnedThread(ctx, args.threadId);
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
      if (!args.executionId || !run || run.ownerAccountId !== thread.ownerAccountId || run.threadId !== args.threadId || run.executionId !== args.executionId) throw new Error("AI run not found");
      const partial = args.metadata && typeof args.metadata === "object" && (args.metadata as { partial?: unknown }).partial === true;
      if (partial && run.status !== "running") throw new Error("This run is no longer streaming.");
      if (args.role === "assistant") {
        const existing = (await ctx.db.query("spectraMessages").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect())
          .find((message) => message.role === "assistant");
        if (existing) {
          // A retry is a new attempt of the same canonical run. Replace the
          // prior assistant attempt in place for identity, but move it to the
          // current end of the conversation so a successful retry cannot stay
          // stranded above newer trace rows or stale clarification UI.
          const now = Date.now();
          await ctx.db.patch(existing._id, {
            content,
            metadata: args.metadata,
            createdAt: now,
          });
          await ctx.db.patch(args.threadId, {
            lastMessageAt: now,
            lastRunId: args.runId,
            updatedAt: now,
          });
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
    messageId: v.id("spectraMessages"),
    choiceKey: v.string(),
    choiceTitle: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("This choice is no longer available.");
    await requireOwnedThread(ctx, message.threadId);
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
  args: { includeArchived: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 80, 200));
    const rows = await ctx.db.query("spectraThreads")
      .withIndex("by_account_status", (q) => q.eq("ownerAccountId", actor._id).eq("status", "active"))
      .order("desc")
      .take(limit * 2);
    const archived = args.includeArchived
      ? await ctx.db.query("spectraThreads").withIndex("by_account_status", (q) => q.eq("ownerAccountId", actor._id).eq("status", "archived")).order("desc").take(limit)
      : [];
    return [...rows, ...archived]
      .filter((thread) => thread.schoolId === actor.schoolId)
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt))
      .slice(0, limit);
  },
});

export const get = query({
  args: { threadId: v.id("spectraThreads") },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.threadId);
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
        return artifact && artifact.ownerAccountId === thread.ownerAccountId ? artifact : null;
      }))).filter(Boolean);
      return { run, operations, cards, events: events.sort((a, b) => a.sequence - b.sequence), artifacts };
    }));
    return { thread, messages, traces: traces.filter(Boolean), viewerName: actor.name };
  },
});

export const update = mutation({
  args: {
    threadId: v.id("spectraThreads"),
    title: v.optional(v.string()), pinned: v.optional(v.boolean()),
    workspaceId: v.optional(v.union(v.id("spectraWorkspaces"), v.null())),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.threadId);
    if (args.workspaceId) {
      const workspace = await ctx.db.get(args.workspaceId);
      if (!workspace || workspace.ownerAccountId !== actor._id || workspace.schoolId !== actor.schoolId || workspace.status !== "active") throw new Error("Workspace not found");
    }
    const nextWorkspaceId = args.workspaceId === undefined ? thread.workspaceId : args.workspaceId ?? undefined;
    const now = Date.now();
    await ctx.db.patch(args.threadId, {
      title: args.title === undefined ? thread.title : cleanTitle(args.title),
      pinned: args.pinned ?? thread.pinned,
      workspaceId: nextWorkspaceId,
      status: args.status ?? thread.status,
      updatedAt: now,
    });
    if (args.workspaceId !== undefined && nextWorkspaceId !== thread.workspaceId) {
      const placements = await ctx.db.query("spectraWorkspaceItems")
        .withIndex("by_source", (q) => q.eq("sourceType", "thread").eq("sourceId", args.threadId))
        .collect();
      await Promise.all(placements.map((placement) => ctx.db.patch(placement._id, {
        viewData: { ...placement.viewData, hidden: placement.workspaceId !== nextWorkspaceId },
        updatedAt: now,
      })));
      await ensureThreadWorkspacePlacement(ctx, {
        threadId: args.threadId,
        workspaceId: nextWorkspaceId,
        summary: thread.summaryShort,
        pinned: args.pinned ?? thread.pinned,
      });
    }
    return { threadId: args.threadId };
  },
});

export const applyGeneratedMetadata = mutation({
  args: {
    threadId: v.id("spectraThreads"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { thread } = await requireOwnedThread(ctx, args.threadId);
    const run = await ctx.db.get(args.runId);
    if (!run || run.threadId !== args.threadId || run.status !== "running" || run.executionId !== args.executionId) throw new Error("This title belongs to an older run attempt.");
    const messageCount = thread.messageCount ?? 0;
    const provisionalTitle = thread.title === "New thread" || thread.title.split(/\s+/).length >= 8;
    // Sparse title windows avoid sidebar instability while allowing a weak
    // first-prompt title to improve once the purpose becomes clear.
    const mayRetitle = messageCount <= 2 || provisionalTitle || (messageCount >= 6 && messageCount <= 8) || (messageCount >= 16 && messageCount <= 18);
    const title = mayRetitle && args.title ? cleanTitle(args.title) : thread.title;
    const summary = args.summary?.replace(/\s+/g, " ").trim().slice(0, 320) || thread.summaryShort;
    const now = Date.now();
    await ctx.db.patch(args.threadId, { title, summaryShort: summary, updatedAt: now });
    const placements = await ctx.db.query("spectraWorkspaceItems")
      .withIndex("by_source", (q) => q.eq("sourceType", "thread").eq("sourceId", args.threadId))
      .collect();
    await Promise.all(placements.map((placement) => ctx.db.patch(placement._id, {
      viewData: { ...placement.viewData, titleOverride: title, compactSummary: summary },
      updatedAt: now,
    })));
    return { threadId: args.threadId };
  },
});

export const createFromRun = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    placeInWorkspace: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor._id || run.schoolId !== actor.schoolId) throw new Error("AI run not found");
    if (!run.threadId) throw new Error("This older run has no conversation to keep.");
    const thread = await ctx.db.get(run.threadId);
    if (!thread || thread.ownerAccountId !== actor._id || thread.status === "deleted") throw new Error("Thread not found");
    const workspaceItemId = args.placeInWorkspace
      ? await ensureThreadWorkspacePlacement(ctx, {
        threadId: thread._id,
        workspaceId: thread.workspaceId,
        summary: thread.summaryShort ?? run.finalSummary?.slice(0, 240),
        pinned: true,
      })
      : undefined;
    return { threadId: thread._id, workspaceItemId };
  },
});

// Explicit one-way repair for rows created before threads became first-class
// workspace items. Runtime code never creates thread-reference artifacts.
export const migrateLegacyThreadReferences = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const legacy = await ctx.db.query("spectraArtifacts")
      .filter((q) => q.eq(q.field("blueprintKey"), "thread_reference"))
      .take(Math.max(1, Math.min(args.limit ?? 100, 500)));
    let migrated = 0;
    let removed = 0;
    for (const artifact of legacy) {
      const rawThreadId = (artifact.content as { threadId?: unknown } | null)?.threadId;
      const threadId = typeof rawThreadId === "string" ? ctx.db.normalizeId("spectraThreads", rawThreadId) : null;
      const thread = threadId ? await ctx.db.get(threadId) : null;
      const placements = await ctx.db.query("spectraWorkspaceItems")
        .withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", artifact._id))
        .collect();
      if (thread && thread.ownerAccountId === artifact.ownerAccountId && thread.schoolId === artifact.schoolId && thread.status !== "deleted") {
        const destination = thread.workspaceId ?? placements.find((item) => item.viewData.hidden !== true)?.workspaceId;
        if (destination && !thread.workspaceId) await ctx.db.patch(thread._id, { workspaceId: destination, updatedAt: Date.now() });
        await ensureThreadWorkspacePlacement(ctx, {
          threadId: thread._id,
          workspaceId: destination,
          summary: thread.summaryShort ?? artifact.summary,
          pinned: placements.some((item) => item.viewData.pinned),
        });
        migrated += 1;
      }
      const versions = await ctx.db.query("spectraArtifactVersions").withIndex("by_artifact_created", (q) => q.eq("artifactId", artifact._id)).collect();
      const [outgoing, incoming] = await Promise.all([
        ctx.db.query("spectraArtifactLinks").withIndex("by_source", (q) => q.eq("sourceArtifactId", artifact._id)).collect(),
        ctx.db.query("spectraArtifactLinks").withIndex("by_target", (q) => q.eq("targetArtifactId", artifact._id)).collect(),
      ]);
      const links = [...new Map([...outgoing, ...incoming].map((link) => [link._id, link])).values()];
      await Promise.all([
        ...placements.map((placement) => ctx.db.delete(placement._id)),
        ...versions.map((version) => ctx.db.delete(version._id)),
        ...links.map((link) => ctx.db.delete(link._id)),
      ]);
      await ctx.db.delete(artifact._id);
      removed += 1;
    }
    return { scanned: legacy.length, migrated, removed, complete: legacy.length < Math.max(1, Math.min(args.limit ?? 100, 500)) };
  },
});
