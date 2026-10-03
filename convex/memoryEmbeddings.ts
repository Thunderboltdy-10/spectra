import { v } from "convex/values";
import { internalAction } from "./functions";
import { internal } from "./_generated/api";
import { requestEmbeddings } from "./embeddingProvider";

/** One network attempt per lease: the durable memory job owns retries and backoff. */
export const generate = internalAction({
  args: { jobId: v.id("memoryJobs"), leaseOwner: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const input = await ctx.runQuery(internal.memory.embeddingInput, args);
    if (!input) {
      await ctx.runMutation(internal.memory.completeEmbedding, { ...args, error: "source_unavailable", retryable: false });
      return;
    }
    const result = await requestEmbeddings([input.proposition], { attempts: 1 });
    await ctx.runMutation(internal.memory.completeEmbedding, {
      ...args,
      ...(result.ok ? { vector: result.vectors[0] } : { error: result.code, retryable: result.retryable }),
    });
  },
});
