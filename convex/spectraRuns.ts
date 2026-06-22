import { mutation, query } from "./_generated/server";
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
  },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    const now = Date.now();
    const terminal = args.status === "completed" || args.status === "failed" || args.status === "cancelled";
    await ctx.db.patch(args.runId, {
      status: args.status,
      finalSummary: args.finalSummary,
      error: args.error,
      updatedAt: now,
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

    return { runId: args.runId };
  },
});

export const setSuggestedThreadMetadata = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), title: v.optional(v.string()), summary: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOwnedRun(ctx, args.actorClerkId, args.runId);
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
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (run.status !== "failed" && run.status !== "cancelled") throw new Error("Only failed or cancelled runs can be retried");
    const priorOperations = await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    if (priorOperations.some((operation) => operation.status === "executing" || operation.status === "executed" || operation.status === "failed")) {
      throw new Error("This run may have partially applied changes. Review its details and use a follow-up command instead of retrying.");
    }
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "queued",
      finalSummary: undefined,
      error: undefined,
      completedAt: undefined,
      attemptCount: (run.attemptCount ?? 1) + 1,
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
    return { runId: args.runId, resultCardId: cards[0]?._id, prompt: run.userPrompt, workspaceId: run.workspaceId, artifactId: run.artifactId, sourceSurface: run.sourceSurface, contextSnapshot: run.contextSnapshot };
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
    const now = Date.now();
    return cards
      .filter((card) => args.includeHidden || !card.hiddenAt)
      .filter((card) => args.includeHidden
        || Boolean(card.keptAt)
        || ((card.status === "queued" || card.status === "running") && now - card.updatedAt < 30 * 60 * 1_000)
        || card.status === "awaiting_confirmation"
        || (card.status === "failed" && now - card.updatedAt < 24 * 60 * 60 * 1_000)
        || ((card.status === "completed" || card.status === "cancelled") && now - card.updatedAt < 15 * 60 * 1_000))
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
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), contextSnapshot: v.any() },
  handler: async (ctx, args) => {
    await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    await ctx.db.patch(args.runId, { contextSnapshot: args.contextSnapshot, updatedAt: Date.now() });
    return { runId: args.runId };
  },
});
