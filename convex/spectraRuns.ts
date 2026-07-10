import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";

const vSurface = v.union(v.literal("chat"), v.literal("workspace"), v.literal("artifact"));
const vRunStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("awaiting_confirmation"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);
const vResultVariant = v.union(
  v.literal("status"),
  v.literal("artifact"),
  v.literal("thread"),
  v.literal("operation"),
  v.literal("error"),
);
const vRunPhase = v.union(v.literal("created"), v.literal("planning"), v.literal("reading"), v.literal("retrieving"), v.literal("applying"), v.literal("streaming"), v.literal("approval"), v.literal("completed"), v.literal("stopped"), v.literal("failed"));
const vResultAction = v.object({
  key: v.string(),
  label: v.string(),
  targetType: v.optional(v.union(v.literal("artifact"), v.literal("thread"), v.literal("run"), v.literal("workspace"))),
  targetId: v.optional(v.string()),
});

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function requireOwnedRun(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actorClerkId: string,
  runId: Id<"spectraAiRuns">,
) {
  const actor = await requireActor(ctx, actorClerkId);
  const run = await ctx.db.get(runId);
  if (!run || run.ownerUserId !== actor._id || run.orgId !== actor.orgId) {
    throw new Error("AI run not found");
  }
  return { actor, run };
}

function provisionalTitle(prompt: string) {
  const ignored = new Set(["please", "can", "could", "would", "spectra", "help", "me", "with", "about", "the", "a", "an", "to", "for", "from", "into", "this", "that", "these", "those", "make", "create"]);
  const words = prompt.replace(/[`*_#[\](){}<>]/g, " ").split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word && !ignored.has(word.toLowerCase())).slice(0, 4);
  return (words.length ? words : ["New", "thread"]).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ").slice(0, 48);
}

export const beginRun = mutation({
  args: {
    actorClerkId: v.string(),
    sourceSurface: vSurface,
    userPrompt: v.string(),
    submissionKey: v.string(),
    threadId: v.optional(v.id("spectraThreads")),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    modelUsed: v.optional(v.string()),
    messageMetadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const cleanPrompt = args.userPrompt.replace(/\u0000/g, "").trim().slice(0, 12_000);
    if (!cleanPrompt) throw new Error("Write a message before starting a run.");
    const existingRun = await ctx.db.query("spectraAiRuns")
      .withIndex("by_owner_submission", (q) => q.eq("ownerUserId", actor._id).eq("submissionKey", args.submissionKey))
      .first();
    if (existingRun) {
      const existingCard = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", existingRun._id)).first();
      if (!existingRun.threadId || !existingCard) throw new Error("This request could not be restored safely. Start it again.");
      return { runId: existingRun._id, resultCardId: existingCard._id, threadId: existingRun.threadId, executionId: existingRun.executionId ?? "legacy", created: false };
    }

    let thread = args.threadId ? await ctx.db.get(args.threadId) : null;
    if (args.threadId && (!thread || thread.ownerUserId !== actor._id || thread.orgId !== actor.orgId || thread.status !== "active")) throw new Error("That conversation is no longer available.");
    if (args.workspaceId) {
      const workspace = await ctx.db.get(args.workspaceId);
      if (!workspace || workspace.ownerUserId !== actor._id || workspace.orgId !== actor.orgId || workspace.status !== "active") throw new Error("That workspace is no longer available.");
    }
    if (args.artifactId) {
      const artifact = await ctx.db.get(args.artifactId);
      if (!artifact || artifact.ownerUserId !== actor._id || artifact.orgId !== actor.orgId || artifact.status === "deleted") throw new Error("That artifact is no longer available.");
    }
    if (thread) {
      const activeRun = (await ctx.db.query("spectraAiRuns").withIndex("by_thread", (q) => q.eq("threadId", thread!._id)).collect())
        .find((run) => run.status === "queued" || run.status === "running" || run.status === "awaiting_confirmation");
      if (activeRun) throw new Error("This conversation is still responding. Start a new thread to work in parallel, or wait for it to finish.");
      if (thread.workspaceId && args.workspaceId && thread.workspaceId !== args.workspaceId) throw new Error("This conversation belongs to another workspace. Open it there, or start a new thread in this workspace.");
    }

    const now = Date.now();
    const title = provisionalTitle(cleanPrompt);
    const workspaceId = args.workspaceId ?? thread?.workspaceId;
    const projectionWorkspaceId = thread ? thread.workspaceId : workspaceId;
    let threadId = thread?._id;
    if (!threadId) {
      threadId = await ctx.db.insert("spectraThreads", {
        ownerUserId: actor._id, orgId: actor.orgId, title, origin: args.sourceSurface,
        workspaceId, artifactId: args.artifactId, status: "active", messageCount: 0,
        createdAt: now, updatedAt: now,
      });
      thread = await ctx.db.get(threadId);
    }
    const executionId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerUserId: actor._id, orgId: actor.orgId, sourceSurface: args.sourceSurface,
      threadId, workspaceId, artifactId: args.artifactId, status: "queued", userPrompt: cleanPrompt,
      modelUsed: args.modelUsed, submissionKey: args.submissionKey, executionId, eventSequence: 1,
      phase: "created", heartbeatAt: now, attemptCount: 1, createdAt: now, updatedAt: now,
    });
    const resultCardId = await ctx.db.insert("spectraResultCards", {
      runId, surface: args.sourceSurface, workspaceId, artifactId: args.artifactId,
      status: "queued", variant: "status", title: "Queued", summary: "Spectra is preparing this run.", actions: [],
      provenance: { threadId, workspaceId, artifactIds: args.artifactId ? [args.artifactId] : [], focusMode: args.artifactId ? "artifact" : workspaceId ? "workspace" : "global" },
      createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("spectraMessages", { threadId, role: "user", content: cleanPrompt, runId, clientMessageId: `user:${runId}`, metadata: args.messageMetadata, createdAt: now });
    await ctx.db.patch(threadId, { messageCount: (thread?.messageCount ?? 0) + 1, lastMessageAt: now, lastRunId: runId, updatedAt: now });
    const references = await ctx.db.query("spectraArtifacts").withIndex("by_owner_blueprint", (q) => q.eq("ownerUserId", actor._id).eq("blueprintKey", "thread_reference")).collect();
    const existingReference = references.find((artifact) => artifact.status !== "deleted" && (artifact.content as { threadId?: string } | null)?.threadId === threadId);
    const referenceArtifactId = existingReference?._id ?? await ctx.db.insert("spectraArtifacts", {
      ownerUserId: actor._id, orgId: actor.orgId, blueprintKey: "thread_reference", title,
      summary: "Conversation in progress", content: { threadId, summary: "", linkedArtifactIds: [] },
      textIndex: cleanPrompt.slice(0, 8_000), tags: ["thread"], status: "active",
      createdFrom: { source: args.sourceSurface, threadId, runId, workspaceId: projectionWorkspaceId }, createdAt: now, updatedAt: now,
    });
    if (existingReference) await ctx.db.patch(existingReference._id, { title: thread?.title ?? existingReference.title, summary: "Conversation in progress", textIndex: `${existingReference.textIndex ?? ""} ${cleanPrompt}`.slice(-8_000), updatedAt: now });
    if (projectionWorkspaceId) {
      const placement = await ctx.db.query("spectraWorkspaceItems").withIndex("by_workspace_source", (q) => q.eq("workspaceId", projectionWorkspaceId).eq("sourceType", "artifact").eq("sourceId", referenceArtifactId)).first();
      if (placement) await ctx.db.patch(placement._id, { viewData: { ...placement.viewData, compactSummary: "Conversation in progress", hidden: false }, updatedAt: now });
      else await ctx.db.insert("spectraWorkspaceItems", {
        workspaceId: projectionWorkspaceId, sourceType: "artifact", sourceId: referenceArtifactId,
        viewData: { compactSummary: "Conversation in progress", pinned: true, hidden: false },
        layout: { view: "cards" }, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(projectionWorkspaceId, { updatedAt: now, lastActivityAt: now });
    }
    const openTabs = await ctx.db.query("spectraRunTabs").withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id)).collect();
    await Promise.all(openTabs.filter((tab) => tab.orgId === actor.orgId && !tab.hiddenAt && tab.selected).map((tab) => ctx.db.patch(tab._id, { selected: false, updatedAt: now })));
    await ctx.db.insert("spectraRunTabs", {
      ownerUserId: actor._id, orgId: actor.orgId, runId, threadId, workspaceId,
      surface: args.sourceSurface, selected: true, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("spectraRunEvents", { runId, executionId, sequence: 1, type: "run_created", payload: { threadId, resultCardId, title }, createdAt: now });
    return { runId, resultCardId, threadId, executionId, referenceArtifactId, created: true };
  },
});

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    sourceSurface: vSurface,
    userPrompt: v.string(),
    threadId: v.optional(v.id("spectraThreads")),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    modelUsed: v.optional(v.string()),
    providerUsed: v.optional(v.string()),
    usage: v.optional(v.any()),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    if (args.threadId) {
      const thread = await ctx.db.get(args.threadId);
      if (!thread || thread.ownerUserId !== actor._id || thread.orgId !== actor.orgId || thread.status !== "active") {
        throw new Error("Thread not found");
      }
      const activeRun = (await ctx.db.query("spectraAiRuns").withIndex("by_thread", (q) => q.eq("threadId", args.threadId)).collect())
        .find((run) => run.status === "queued" || run.status === "running" || run.status === "awaiting_confirmation");
      if (activeRun) throw new Error("This conversation is still responding. Start a new thread to work in parallel, or wait for it to finish.");
    }
    const now = Date.now();
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      sourceSurface: args.sourceSurface,
      threadId: args.threadId,
      workspaceId: args.workspaceId,
      artifactId: args.artifactId,
      status: "queued",
      userPrompt: args.userPrompt,
      modelUsed: args.modelUsed,
      sessionId: args.sessionId,
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const resultCardId = await ctx.db.insert("spectraResultCards", {
      runId,
      surface: args.sourceSurface,
      workspaceId: args.workspaceId,
      artifactId: args.artifactId,
      status: "queued",
      variant: "status",
      title: "Queued",
      summary: "Spectra is preparing this run.",
      actions: [],
      provenance: {
        threadId: args.threadId,
        workspaceId: args.workspaceId,
        artifactIds: args.artifactId ? [args.artifactId] : [],
        focusMode: args.threadId ? "thread" : args.artifactId ? "artifact" : args.workspaceId ? "workspace" : "global",
      },
      createdAt: now,
      updatedAt: now,
    });
    return { runId, resultCardId };
  },
});

export const updateStatus = mutation({
  args: {
    actorClerkId: v.string(),
    runId: v.id("spectraAiRuns"),
    status: vRunStatus,
    finalSummary: v.optional(v.string()),
    error: v.optional(v.string()),
    resultTitle: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    resultVariant: v.optional(vResultVariant),
    resultActions: v.optional(v.array(vResultAction)),
    modelUsed: v.optional(v.string()),
    providerUsed: v.optional(v.string()),
    usage: v.optional(v.any()),
    decision: v.optional(v.union(v.literal("answer"), v.literal("operate"), v.literal("clarify"), v.literal("refuse"))),
    planIntent: v.optional(v.any()),
    provenance: v.optional(v.any()),
    executionId: v.optional(v.string()),
    phase: v.optional(vRunPhase),
  },
  handler: async (ctx, args) => {
    const { actor, run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (args.executionId && run.executionId && args.executionId !== run.executionId) throw new Error("This run attempt is no longer active.");
    const transitions: Record<typeof run.status, ReadonlySet<typeof run.status>> = {
      queued: new Set(["queued", "running", "cancelled", "failed"]),
      running: new Set(["running", "awaiting_confirmation", "completed", "failed", "cancelled"]),
      awaiting_confirmation: new Set(["awaiting_confirmation", "running", "cancelled", "failed"]),
      completed: new Set(["completed"]), failed: new Set(["failed"]), cancelled: new Set(["cancelled"]),
    };
    if (!transitions[run.status].has(args.status)) throw new Error("This run has already moved to a newer state.");
    const now = Date.now();
    const terminal = args.status === "completed" || args.status === "failed" || args.status === "cancelled";
    await ctx.db.patch(args.runId, {
      status: args.status,
      phase: args.phase ?? (args.status === "completed" ? "completed" : args.status === "cancelled" ? "stopped" : args.status === "failed" ? "failed" : run.phase),
      finalSummary: args.finalSummary,
      error: args.error,
      updatedAt: now,
      heartbeatAt: now,
      startedAt: args.status === "running" ? run.startedAt ?? now : run.startedAt,
      completedAt: terminal ? now : run.completedAt,
      modelUsed: args.modelUsed ?? run.modelUsed,
      providerUsed: args.providerUsed ?? run.providerUsed,
      usage: args.usage ?? run.usage,
      decision: args.decision ?? run.decision,
      planIntent: args.planIntent ?? run.planIntent,
    });

    const cards = await ctx.db
      .query("spectraResultCards")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    await Promise.all(cards.map((card) => ctx.db.patch(card._id, {
      status: args.status,
      variant: args.resultVariant ?? (args.status === "failed" ? "error" : card.variant),
      title: args.resultTitle ?? card.title,
      summary: args.resultSummary ?? args.finalSummary ?? args.error ?? card.summary,
      actions: args.resultActions ?? card.actions,
      provenance: args.provenance ?? card.provenance,
      updatedAt: now,
    })));

    if (terminal && run.threadId) {
      const thread = await ctx.db.get(run.threadId);
      const references = await ctx.db.query("spectraArtifacts").withIndex("by_owner_blueprint", (q) => q.eq("ownerUserId", actor._id).eq("blueprintKey", "thread_reference")).collect();
      const reference = references.find((artifact) => artifact.status !== "deleted" && (artifact.content as { threadId?: string } | null)?.threadId === run.threadId);
      if (reference) await ctx.db.patch(reference._id, {
        title: thread?.title ?? reference.title,
        summary: args.finalSummary?.slice(0, 240) ?? args.resultSummary?.slice(0, 240) ?? reference.summary,
        content: { ...(reference.content as Record<string, unknown>), summary: args.finalSummary ?? args.resultSummary ?? "" },
        textIndex: `${thread?.title ?? reference.title} ${args.finalSummary ?? args.resultSummary ?? ""}`.slice(0, 8_000),
        updatedAt: now,
      });
    }

    return { runId: args.runId };
  },
});

export const appendEvent = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), executionId: v.string(), type: v.string(), payload: v.any() },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (run.executionId && run.executionId !== args.executionId) return { ignored: true, sequence: run.eventSequence ?? 0 };
    const terminal = run.status === "completed" || run.status === "failed" || run.status === "cancelled";
    const terminalEvent = args.type === "final" || args.type === "error" || args.type === "stopped" || args.type === "interrupted" || args.type === "approval_rejected" || args.type === "approval_accepted" || args.type === "choice_selected";
    if (terminal && !terminalEvent) return { ignored: true, sequence: run.eventSequence ?? 0 };
    const sequence = (run.eventSequence ?? 0) + 1;
    const now = Date.now();
    await ctx.db.insert("spectraRunEvents", { runId: args.runId, executionId: args.executionId, sequence, type: args.type.slice(0, 80), payload: args.payload, createdAt: now });
    await ctx.db.patch(args.runId, { eventSequence: sequence, heartbeatAt: now, updatedAt: now });
    return { ignored: false, sequence };
  },
});

export const heartbeat = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (run.executionId !== args.executionId || (run.status !== "queued" && run.status !== "running")) return { alive: false };
    await ctx.db.patch(args.runId, { heartbeatAt: Date.now() });
    return { alive: true };
  },
});

export const markTraceDegraded = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (run.executionId !== args.executionId) return { ignored: true };
    const now = Date.now();
    await ctx.db.patch(args.runId, { traceDegraded: true, updatedAt: now });
    const cards = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    await Promise.all(cards.map((card) => ctx.db.patch(card._id, { summary: `${card.summary ?? "Run finished."} Some live progress could not be saved.`, updatedAt: now })));
    return { ignored: false };
  },
});

export const listEvents = query({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), after: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    const rows = await ctx.db.query("spectraRunEvents").withIndex("by_run_sequence", (q) => q.eq("runId", args.runId).gt("sequence", args.after ?? 0)).take(Math.min(args.limit ?? 300, 800));
    return rows.sort((a, b) => a.sequence - b.sequence);
  },
});

export const listTabs = query({
  args: { actorClerkId: v.string(), includeHidden: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const tabs = await ctx.db.query("spectraRunTabs").withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id)).order("desc").take(Math.min(args.limit ?? 80, 200));
    return (await Promise.all(tabs.filter((tab) => tab.orgId === actor.orgId && (args.includeHidden || !tab.hiddenAt)).map(async (tab) => ({ ...tab, run: await ctx.db.get(tab.runId), thread: await ctx.db.get(tab.threadId) })))).filter((tab) => tab.run && tab.thread);
  },
});

export const reconcileStaleRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - 5 * 60_000;
    const active = await ctx.db.query("spectraAiRuns").filter((q) => q.or(q.eq(q.field("status"), "queued"), q.eq(q.field("status"), "running"))).collect();
    let interrupted = 0;
    for (const run of active) {
      if ((run.heartbeatAt ?? run.updatedAt) >= cutoff) continue;
      await ctx.db.patch(run._id, { status: "failed", phase: "failed", error: "The run was interrupted and can be retried safely.", completedAt: now, updatedAt: now });
      const cards = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", run._id)).collect();
      await Promise.all(cards.map((card) => ctx.db.patch(card._id, { status: "failed", variant: "error", title: "Run interrupted", summary: "Spectra lost its execution lease. Retry to continue from the saved context.", actions: [{ key: "retry", label: "Retry", targetType: "run", targetId: run._id }], updatedAt: now })));
      const sequence = (run.eventSequence ?? 0) + 1;
      await ctx.db.insert("spectraRunEvents", { runId: run._id, executionId: run.executionId ?? "interrupted", sequence, type: "interrupted", payload: { type: "interrupted", runId: run._id }, createdAt: now });
      await ctx.db.patch(run._id, { eventSequence: sequence });
      const artifacts = await ctx.db.query("spectraArtifacts").withIndex("by_owner_status", (q) => q.eq("ownerUserId", run.ownerUserId).eq("status", "active")).collect();
      await Promise.all(artifacts.filter((artifact) => artifact.aiRunId === run._id && (artifact.aiState === "creating" || artifact.aiState === "updating")).map((artifact) => ctx.db.patch(artifact._id, { aiState: "failed", summary: artifact.aiState === "creating" ? "Spectra was interrupted while building this artifact. Retry the run to continue." : artifact.summary, updatedAt: now })));
      const workspaces = await ctx.db.query("spectraWorkspaces").withIndex("by_owner_activity", (q) => q.eq("ownerUserId", run.ownerUserId)).collect();
      await Promise.all(workspaces.filter((workspace) => workspace.aiRunId === run._id && (workspace.aiState === "creating" || workspace.aiState === "updating")).map((workspace) => ctx.db.patch(workspace._id, { aiState: "failed", updatedAt: now })));
      interrupted += 1;
    }
    return { interrupted };
  },
});

export const hideTab = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const tab = await ctx.db.query("spectraRunTabs").withIndex("by_owner_run", (q) => q.eq("ownerUserId", actor._id).eq("runId", args.runId)).first();
    if (!tab || tab.orgId !== actor.orgId) throw new Error("Run tab not found");
    await ctx.db.patch(tab._id, { hiddenAt: Date.now(), selected: false, updatedAt: Date.now() });
    return { runId: args.runId };
  },
});

export const selectTab = mutation({
  args: { actorClerkId: v.string(), runId: v.optional(v.id("spectraAiRuns")) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const tabs = await ctx.db.query("spectraRunTabs").withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id)).collect();
    const now = Date.now();
    let selected = false;
    for (const tab of tabs) {
      if (tab.orgId !== actor.orgId || tab.hiddenAt) continue;
      const next = Boolean(args.runId && tab.runId === args.runId);
      if (tab.selected !== next) await ctx.db.patch(tab._id, { selected: next, updatedAt: now });
      selected ||= next;
    }
    if (args.runId && !selected) throw new Error("Run tab not found");
    return { runId: args.runId };
  },
});

export const claimConfirmation = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (run.executionId !== args.executionId) throw new Error("This approval belongs to an older run attempt.");
    if (run.status !== "awaiting_confirmation") throw new Error("This approval was already handled in another view.");
    const operations = await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    const currentOperations = operations.filter((operation) => !operation.executionId || operation.executionId === args.executionId);
    const proposed = currentOperations.filter((operation) => operation.status === "proposed" && operation.requiresConfirmation);
    if (proposed.length === 0 || currentOperations.some((operation) => operation.status === "executing" || operation.status === "executed")) {
      throw new Error("This approval was already handled in another view.");
    }
    const now = Date.now();
    await ctx.db.patch(args.runId, { status: "running", phase: "applying", heartbeatAt: now, updatedAt: now });
    await Promise.all(proposed.map((operation) => ctx.db.patch(operation._id, { status: "executing" })));
    const cards = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    await Promise.all(cards.map((card) => ctx.db.patch(card._id, { status: "running", title: "Applying confirmed changes", actions: [], updatedAt: now })));
    return { operationIds: proposed.map((operation) => operation._id) };
  },
});

export const rejectConfirmation = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (run.executionId !== args.executionId) throw new Error("This approval belongs to an older run attempt.");
    if (run.status === "cancelled") return { alreadyRejected: true };
    if (run.status !== "awaiting_confirmation") throw new Error("This approval was already handled in another view.");
    const operations = await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    const currentOperations = operations.filter((operation) => !operation.executionId || operation.executionId === args.executionId);
    if (currentOperations.some((operation) => operation.status === "executing" || operation.status === "executed")) throw new Error("These changes are already being applied.");
    const now = Date.now();
    await Promise.all(currentOperations.filter((operation) => operation.status === "proposed").map((operation) => ctx.db.patch(operation._id, { status: "cancelled" })));
    await ctx.db.patch(args.runId, { status: "cancelled", phase: "stopped", finalSummary: "No proposed changes were applied.", completedAt: now, heartbeatAt: now, updatedAt: now });
    const cards = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    await Promise.all(cards.map((card) => ctx.db.patch(card._id, { status: "cancelled", title: "Cancelled", summary: "No proposed changes were applied.", actions: [], updatedAt: now })));
    return { alreadyRejected: false };
  },
});

export const stopRun = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (run.status === "cancelled") return { alreadyStopped: true, executionId: run.executionId };
    if (run.status !== "queued" && run.status !== "running") throw new Error("This run is no longer active.");
    const operations = await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    const currentOperations = operations.filter((operation) => !operation.executionId || operation.executionId === run.executionId);
    if (currentOperations.some((operation) => operation.status === "executing" || operation.status === "executed")) throw new Error("This run has already started applying changes and can no longer be stopped safely.");
    const now = Date.now();
    await Promise.all(currentOperations.filter((operation) => operation.status === "proposed").map((operation) => ctx.db.patch(operation._id, { status: "cancelled" })));
    await ctx.db.patch(args.runId, { status: "cancelled", phase: "stopped", completedAt: now, heartbeatAt: now, updatedAt: now });
    const cards = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    await Promise.all(cards.map((card) => ctx.db.patch(card._id, { status: "cancelled", title: "Stopped", summary: "Stopped by you. Any partial response remains available in the thread.", actions: [{ key: "retry", label: "Retry", targetType: "run", targetId: args.runId }], updatedAt: now })));
    return { alreadyStopped: false, executionId: run.executionId };
  },
});

export const setSuggestedThreadMetadata = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), executionId: v.string(), title: v.optional(v.string()), summary: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (run.status !== "running" || run.executionId !== args.executionId) throw new Error("This title belongs to an older run attempt.");
    await ctx.db.patch(args.runId, {
      suggestedThreadTitle: args.title?.trim().slice(0, 88),
      suggestedThreadSummary: args.summary?.replace(/\s+/g, " ").trim().slice(0, 320),
      updatedAt: Date.now(),
    });
    return { runId: args.runId };
  },
});

export const patchResultCard = mutation({
  args: {
    actorClerkId: v.string(),
    resultCardId: v.id("spectraResultCards"),
    executionId: v.optional(v.string()),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    variant: v.optional(vResultVariant),
    actions: v.optional(v.array(vResultAction)),
    provenance: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const card = await ctx.db.get(args.resultCardId);
    if (!card) throw new Error("Result card not found");
    const run = await ctx.db.get(card.runId);
    if (!run || run.ownerUserId !== actor._id || run.orgId !== actor.orgId) throw new Error("Result card not found");
    if (args.executionId && run.executionId !== args.executionId) throw new Error("This card belongs to an older run attempt.");
    await ctx.db.patch(args.resultCardId, {
      title: args.title ?? card.title,
      summary: args.summary ?? card.summary,
      variant: args.variant ?? card.variant,
      actions: args.actions ?? card.actions,
      provenance: args.provenance ?? card.provenance,
      updatedAt: Date.now(),
    });
    return { resultCardId: args.resultCardId };
  },
});

export const get = query({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    const cards = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    const operations = await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    return { run, cards, operations };
  },
});

export const resetForRetry = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), retryKey: v.string() },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (run.status === "queued" && run.lastRetryKey === args.retryKey && run.executionId) {
      const cards = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
      return { runId: args.runId, resultCardId: cards[0]?._id, prompt: run.userPrompt, workspaceId: run.workspaceId, artifactId: run.artifactId, sourceSurface: run.sourceSurface, contextSnapshot: run.contextSnapshot, executionId: run.executionId, created: false };
    }
    if (run.status !== "failed" && run.status !== "cancelled") throw new Error("Only failed or cancelled runs can be retried");
    const priorOperations = await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    if (priorOperations.some((operation) => operation.status === "executing" || operation.status === "executed" || operation.status === "failed")) {
      throw new Error("This run may have partially applied changes. Review its details and use a follow-up command instead of retrying.");
    }
    const now = Date.now();
    const executionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    await ctx.db.patch(args.runId, {
      status: "queued",
      finalSummary: undefined,
      error: undefined,
      completedAt: undefined,
      attemptCount: (run.attemptCount ?? 1) + 1,
      executionId,
      lastRetryKey: args.retryKey,
      phase: "created",
      heartbeatAt: Date.now(),
      updatedAt: now,
    });
    const cards = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    await Promise.all(cards.map((card) => ctx.db.patch(card._id, {
      status: "queued",
      variant: "status",
      title: "Retrying",
      summary: "Analysing request",
      actions: [],
      hiddenAt: undefined,
      updatedAt: now,
    })));
    return { runId: args.runId, resultCardId: cards[0]?._id, prompt: run.userPrompt, workspaceId: run.workspaceId, artifactId: run.artifactId, sourceSurface: run.sourceSurface, contextSnapshot: run.contextSnapshot, executionId, created: true };
  },
});

export const listResultCards = query({
  args: {
    actorClerkId: v.string(),
    surface: v.optional(vSurface),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    includeHidden: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const runs = await ctx.db.query("spectraAiRuns").withIndex("by_owner_created", (q) => q.eq("ownerUserId", actor._id)).order("desc").take(limit * 4);
    const allowed = runs.filter((run) => run.orgId === actor.orgId)
      .filter((run) => !args.surface || run.sourceSurface === args.surface)
      .filter((run) => !args.workspaceId || run.workspaceId === args.workspaceId)
      .filter((run) => !args.artifactId || run.artifactId === args.artifactId);
    const cards = (await Promise.all(allowed.map(async (run) => {
      const rows = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", run._id)).collect();
      return rows.map((card) => ({ ...card, run }));
    }))).flat();
    return cards
      .filter((card) => args.includeHidden || !card.hiddenAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  },
});

export const listRecent = query({
  args: {
    actorClerkId: v.string(),
    surface: v.optional(vSurface),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const runs = await ctx.db
      .query("spectraAiRuns")
      .withIndex("by_owner_created", (q) => q.eq("ownerUserId", actor._id))
      .order("desc")
      .take(limit * 3);
    return runs
      .filter((run) => run.orgId === actor.orgId)
      .filter((run) => (args.surface ? run.sourceSurface === args.surface : true))
      .slice(0, limit);
  },
});

export const hideResultCard = mutation({
  args: {
    actorClerkId: v.string(),
    resultCardId: v.id("spectraResultCards"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const card = await ctx.db.get(args.resultCardId);
    if (!card) throw new Error("Result card not found");
    const run = await ctx.db.get(card.runId);
    if (!run || run.ownerUserId !== actor._id || run.orgId !== actor.orgId) {
      throw new Error("Result card not found");
    }
    await ctx.db.patch(args.resultCardId, {
      hiddenAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { resultCardId: args.resultCardId };
  },
});

export const unhideResultCard = mutation({
  args: { actorClerkId: v.string(), resultCardId: v.id("spectraResultCards") },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const card = await ctx.db.get(args.resultCardId);
    if (!card) throw new Error("Result card not found");
    const run = await ctx.db.get(card.runId);
    if (!run || run.ownerUserId !== actor._id || run.orgId !== actor.orgId) throw new Error("Result card not found");
    await ctx.db.patch(args.resultCardId, { hiddenAt: undefined, updatedAt: Date.now() });
    return { resultCardId: args.resultCardId };
  },
});

export const keepResultCard = mutation({
  args: { actorClerkId: v.string(), resultCardId: v.id("spectraResultCards") },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const card = await ctx.db.get(args.resultCardId);
    if (!card) throw new Error("Result card not found");
    const run = await ctx.db.get(card.runId);
    if (!run || run.ownerUserId !== actor._id || run.orgId !== actor.orgId) throw new Error("Result card not found");
    const now = Date.now();
    await ctx.db.patch(args.resultCardId, { keptAt: now, hiddenAt: undefined, updatedAt: now });
    return { resultCardId: args.resultCardId };
  },
});

export const setContextSnapshot = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), executionId: v.string(), contextSnapshot: v.any() },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if ((run.status !== "queued" && run.status !== "running") || run.executionId !== args.executionId) throw new Error("This context belongs to an older run attempt.");
    await ctx.db.patch(args.runId, { contextSnapshot: args.contextSnapshot, updatedAt: Date.now() });
    return { runId: args.runId };
  },
});
