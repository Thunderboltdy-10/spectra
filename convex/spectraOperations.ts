import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";

async function requireOwnedRun(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string, runId: Id<"spectraAiRuns">) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  const run = await ctx.db.get(runId);
  if (!run || run.ownerUserId !== actor._id || run.orgId !== actor.orgId) throw new Error("AI run not found");
  return run;
}

export const recordPlan = mutation({
  args: {
    actorClerkId: v.string(),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    operations: v.array(v.object({ type: v.string(), input: v.any(), requiresConfirmation: v.boolean() })),
  },
  handler: async (ctx, args) => {
    const run = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (run.status !== "running" || run.executionId !== args.executionId) throw new Error("This run attempt is no longer active");
    const now = Date.now();
    const operationIds = await Promise.all(args.operations.map((operation) => ctx.db.insert("spectraOperations", {
      runId: args.runId,
      executionId: args.executionId,
      actorType: "ai",
      type: operation.type,
      status: "proposed",
      input: operation.input,
      affected: [],
      requiresConfirmation: operation.requiresConfirmation,
      createdAt: now,
    })));
    return { operationIds };
  },
});

export const listForRun = query({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    return ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
  },
});

export const attachPendingArtifact = mutation({
  args: { actorClerkId: v.string(), operationId: v.id("spectraOperations"), artifactId: v.id("spectraArtifacts"), executionId: v.string() },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId || operation.status !== "proposed") throw new Error("Operation is no longer pending");
    const run = await requireOwnedRun(ctx, args.actorClerkId, operation.runId);
    if (run.status !== "running" || operation.executionId !== run.executionId || run.executionId !== args.executionId) throw new Error("Operation belongs to an older run attempt");
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.ownerUserId !== run.ownerUserId || artifact.aiRunId !== run._id || artifact.aiExecutionId !== run.executionId || artifact.aiState !== "creating") throw new Error("Pending artifact not found");
    await ctx.db.patch(args.operationId, { pendingArtifactId: args.artifactId });
    return { operationId: args.operationId };
  },
});

export const attachPendingWorkspace = mutation({
  args: { actorClerkId: v.string(), operationId: v.id("spectraOperations"), workspaceId: v.id("spectraWorkspaces"), executionId: v.string() },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId || operation.status !== "proposed") throw new Error("Operation is no longer pending");
    const run = await requireOwnedRun(ctx, args.actorClerkId, operation.runId);
    if (run.status !== "running" || operation.executionId !== run.executionId || run.executionId !== args.executionId) throw new Error("Operation belongs to an older run attempt");
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace || workspace.ownerUserId !== run.ownerUserId || workspace.aiRunId !== run._id || workspace.aiExecutionId !== run.executionId || workspace.aiState !== "creating") throw new Error("Pending workspace not found");
    await ctx.db.patch(args.operationId, { pendingWorkspaceId: args.workspaceId });
    return { operationId: args.operationId };
  },
});

export const claim = mutation({
  args: { actorClerkId: v.string(), operationId: v.id("spectraOperations"), executionId: v.string() },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    const run = await requireOwnedRun(ctx, args.actorClerkId, operation.runId);
    if (run.status !== "running") throw new Error("This run is no longer allowed to apply changes");
    if (operation.executionId !== run.executionId || run.executionId !== args.executionId) throw new Error("Operation belongs to an older run attempt");
    if (operation.status !== "proposed") throw new Error("Operation is no longer pending");
    await ctx.db.patch(args.operationId, { status: "executing" });
    return { operationId: args.operationId };
  },
});

export const assertClaimed = mutation({
  args: { actorClerkId: v.string(), operationId: v.id("spectraOperations"), executionId: v.string() },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    const run = await requireOwnedRun(ctx, args.actorClerkId, operation.runId);
    if (run.status !== "running") throw new Error("This run is no longer allowed to apply changes");
    if (operation.executionId !== run.executionId || run.executionId !== args.executionId) throw new Error("Operation belongs to an older run attempt");
    if (operation.status !== "executing") throw new Error("Operation is no longer approved for execution");
    return { operationId: args.operationId };
  },
});

export const markExecuted = mutation({
  args: {
    actorClerkId: v.string(), operationId: v.id("spectraOperations"), output: v.optional(v.any()),
    executionId: v.string(),
    affected: v.array(v.object({ type: v.string(), id: v.string() })),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    const run = await requireOwnedRun(ctx, args.actorClerkId, operation.runId);
    if (run.status !== "running" || operation.executionId !== run.executionId || run.executionId !== args.executionId) throw new Error("Operation belongs to an older run attempt");
    if (operation.status !== "executing") throw new Error("Operation was not claimed for execution");
    await ctx.db.patch(args.operationId, { status: "executed", output: args.output, affected: args.affected, executedAt: Date.now() });
    return { operationId: args.operationId };
  },
});

export const markFailed = mutation({
  args: { actorClerkId: v.string(), operationId: v.id("spectraOperations"), executionId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    const run = await requireOwnedRun(ctx, args.actorClerkId, operation.runId);
    if (operation.executionId !== run.executionId || run.executionId !== args.executionId) throw new Error("Operation belongs to an older run attempt");
    await ctx.db.patch(args.operationId, { status: "failed", output: { error: args.error }, executedAt: Date.now() });
    return { operationId: args.operationId };
  },
});

export const cancelPending = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const run = await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    if (run.executionId !== args.executionId) throw new Error("This run attempt is no longer active");
    const operations = await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    const pending = operations.filter((operation) => operation.status === "proposed" && operation.executionId === args.executionId);
    await Promise.all(pending.map((operation) => ctx.db.patch(operation._id, { status: "cancelled" })));
    return { cancelled: pending.length };
  },
});
