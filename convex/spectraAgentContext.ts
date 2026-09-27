import { action, internalMutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";

const identityArgs = { runId: v.id("spectraAiRuns"), executionId: v.string(), workerId: v.string() };
type Identity = { runId: Id<"spectraAiRuns">; executionId: string; workerId: string };

async function owned(ctx: QueryCtx | MutationCtx, runId: Id<"spectraAiRuns">) {
  const actor = await getAuthenticatedActor(ctx);
  const run = await ctx.db.get(runId);
  if (!actor || !run || run.ownerAccountId !== actor._id || run.schoolId !== actor.schoolId)
    throw new Error("AI_CONTEXT_RUN_NOT_FOUND");
  return run;
}

async function current(ctx: QueryCtx | MutationCtx, args: Identity) {
  const run = await owned(ctx, args.runId);
  if (run.status !== "running" || run.executionId !== args.executionId ||
      run.workerId !== args.workerId || (run.leaseExpiresAt ?? 0) <= Date.now())
    throw new Error("AI_CONTEXT_STALE_WORKER");
  return run;
}

export const state = query({
  args: identityArgs,
  handler: async (ctx, args) => {
    const run = await current(ctx, args);
    return { request: run.userPrompt, checkpoint: run.agentContextCheckpoint ?? null };
  },
});

export const commit = internalMutation({
  args: { ...identityArgs, expectedGeneration: v.number(), storageId: v.id("_storage"), request: v.string(),
    inputTokens: v.number(), compactedTokens: v.number() },
  handler: async (ctx, args) => {
    const run = await current(ctx, args);
    const previous = run.agentContextCheckpoint;
    const generation = previous?.executionId === args.executionId ? previous.generation : 0;
    if (!Number.isSafeInteger(args.expectedGeneration) || generation !== args.expectedGeneration || run.userPrompt !== args.request)
      throw new Error("AI_CONTEXT_GENERATION_CHANGED");
    // A planning checkpoint can never replace approval/receipt state or cause
    // recorded operations to be planned/applied a second time.
    const recorded = await ctx.db.query("spectraOperations")
      .withIndex("by_run_execution", q => q.eq("runId", args.runId).eq("executionId", args.executionId)).first();
    if (recorded) throw new Error("AI_CONTEXT_PLAN_ALREADY_RECORDED");
    const checkpoint = { executionId: args.executionId, generation: generation + 1,
      storageId: args.storageId, inputTokens: args.inputTokens, compactedTokens: args.compactedTokens, createdAt: Date.now() };
    await ctx.db.patch(args.runId, { agentContextCheckpoint: checkpoint });
    if (previous && previous.storageId !== args.storageId) await ctx.storage.delete(previous.storageId);
    return checkpoint.generation;
  },
});

export const save = action({
  args: { ...identityArgs, expectedGeneration: v.number(), payload: v.string() },
  handler: async (ctx, args): Promise<{ generation: number }> => {
    const binding = await ctx.runQuery(api.spectraAgentContext.state, argsIdentity(args));
    const data = JSON.parse(args.payload);
    if (data?.version !== 1 || data.request !== binding.request || !Array.isArray(data.loop?.messages) ||
        !Array.isArray(data.archive) || !Number.isFinite(data.inputTokens) || !Number.isFinite(data.compactedTokens))
      throw new Error("AI_CONTEXT_CHECKPOINT_INVALID");
    const storageId = await ctx.storage.store(new Blob([args.payload], { type: "application/json" }));
    try {
      const generation: number = await ctx.runMutation(internal.spectraAgentContext.commit, {
        ...argsIdentity(args), expectedGeneration: args.expectedGeneration, storageId, request: data.request,
        inputTokens: data.inputTokens, compactedTokens: data.compactedTokens,
      });
      return { generation };
    } catch (error) {
      // Only this action's newly created blob is eligible for cleanup. Never
      // delete a caller-supplied storage reference or an adopted checkpoint.
      const adopted = await ctx.runQuery(internal.spectraAgentContext.adopted, { runId: args.runId, storageId });
      if (!adopted) await ctx.storage.delete(storageId);
      throw error;
    }
  },
});

function argsIdentity(args: Identity) { return { runId: args.runId, executionId: args.executionId, workerId: args.workerId }; }

// The ownership check also protects cleanup after Stop invalidates the worker.
import { internalQuery } from "./_generated/server";
export const adopted = internalQuery({
  args: { runId: v.id("spectraAiRuns"), storageId: v.id("_storage") },
  handler: async (ctx, args) => (await owned(ctx, args.runId)).agentContextCheckpoint?.storageId === args.storageId,
});

export const load = action({
  args: identityArgs,
  handler: async (ctx, args): Promise<{ generation: number; payload: string } | null> => {
    const binding = await ctx.runQuery(api.spectraAgentContext.state, args);
    const checkpoint = binding.checkpoint;
    if (!checkpoint || checkpoint.executionId !== args.executionId) return null;
    const blob = await ctx.storage.get(checkpoint.storageId);
    if (!blob) throw new Error("AI_CONTEXT_CHECKPOINT_MISSING");
    const payload = await blob.text();
    const latest = await ctx.runQuery(api.spectraAgentContext.state, args);
    if (latest.checkpoint?.generation !== checkpoint.generation || latest.request !== binding.request)
      throw new Error("AI_CONTEXT_GENERATION_CHANGED");
    return { generation: checkpoint.generation, payload };
  },
});

export const clear = internalMutation({
  args: { ...identityArgs, expectedGeneration: v.number() },
  handler: async (ctx, args) => {
    const run = await current(ctx, args);
    const checkpoint = run.agentContextCheckpoint;
    if (!checkpoint) return;
    if (checkpoint.executionId !== args.executionId || checkpoint.generation !== args.expectedGeneration)
      throw new Error("AI_CONTEXT_GENERATION_CHANGED");
    await ctx.db.patch(args.runId, { agentContextCheckpoint: undefined });
    await ctx.storage.delete(checkpoint.storageId);
  },
});

export const finish = action({
  args: { ...identityArgs, expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<void> => { await ctx.runMutation(internal.spectraAgentContext.clear, args); },
});
