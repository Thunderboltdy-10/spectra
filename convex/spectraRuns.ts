import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";

const vSurface = v.union(v.literal("chat"), v.literal("workspace"), v.literal("artifact"));
const vRunStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
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
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
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
      updatedAt: now,
    })));

    return { runId: args.runId };
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
      .withIndex("by_owner_status", (q) => q.eq("ownerUserId", actor._id))
      .order("desc")
      .take(limit * 3);
    return runs
      .filter((run) => run.orgId === actor.orgId)
      .filter((run) => (args.surface ? run.sourceSurface === args.surface : true))
      .slice(0, limit);
  },
});

export const listResultCards = query({
  args: {
    actorClerkId: v.string(),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    includeHidden: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 12, 50));
    const statuses = ["queued", "running", "completed", "failed", "cancelled"] as const;

    const cards = args.workspaceId
      ? (await Promise.all(statuses.map((status) => ctx.db
        .query("spectraResultCards")
        .withIndex("by_workspace_status", (q) => q.eq("workspaceId", args.workspaceId).eq("status", status))
        .order("desc")
        .take(limit)))).flat()
      : args.artifactId
        ? (await Promise.all(statuses.map((status) => ctx.db
          .query("spectraResultCards")
          .withIndex("by_artifact_status", (q) => q.eq("artifactId", args.artifactId).eq("status", status))
          .order("desc")
          .take(limit)))).flat()
        : [];

    const hydrated = await Promise.all(cards.map(async (card) => {
      const run = await ctx.db.get(card.runId);
      if (!run || run.ownerUserId !== actor._id || run.orgId !== actor.orgId) return null;
      if (!args.includeHidden && card.hiddenAt) return null;
      return { ...card, run };
    }));

    return hydrated
      .filter((card): card is NonNullable<typeof card> => Boolean(card))
      .sort((a, b) => b.updatedAt - a.updatedAt)
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
