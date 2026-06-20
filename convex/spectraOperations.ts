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
    operations: v.array(v.object({ type: v.string(), input: v.any(), requiresConfirmation: v.boolean() })),
  },
  handler: async (ctx, args) => {
    await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    const now = Date.now();
    const operationIds = await Promise.all(args.operations.map((operation) => ctx.db.insert("spectraOperations", {
      runId: args.runId,
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

export const claim = mutation({
  args: { actorClerkId: v.string(), operationId: v.id("spectraOperations") },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    await requireOwnedRun(ctx, args.actorClerkId, operation.runId);
    if (operation.status !== "proposed") throw new Error("Operation is no longer pending");
    await ctx.db.patch(args.operationId, { status: "executing" });
    return { operationId: args.operationId };
  },
});

export const markExecuted = mutation({
  args: {
    actorClerkId: v.string(), operationId: v.id("spectraOperations"), output: v.optional(v.any()),
    affected: v.array(v.object({ type: v.string(), id: v.string() })),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    await requireOwnedRun(ctx, args.actorClerkId, operation.runId);
    if (operation.status !== "executing") throw new Error("Operation was not claimed for execution");
    await ctx.db.patch(args.operationId, { status: "executed", output: args.output, affected: args.affected, executedAt: Date.now() });
    return { operationId: args.operationId };
  },
});

export const markFailed = mutation({
  args: { actorClerkId: v.string(), operationId: v.id("spectraOperations"), error: v.string() },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    await requireOwnedRun(ctx, args.actorClerkId, operation.runId);
    await ctx.db.patch(args.operationId, { status: "failed", output: { error: args.error }, executedAt: Date.now() });
    return { operationId: args.operationId };
  },
});

export const cancelPending = mutation({
  args: { actorClerkId: v.string(), runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    await requireOwnedRun(ctx, args.actorClerkId, args.runId);
    const operations = await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    await Promise.all(operations.filter((operation) => operation.status === "proposed").map((operation) => ctx.db.patch(operation._id, { status: "cancelled" })));
    return { cancelled: operations.filter((operation) => operation.status === "proposed").length };
  },
});
