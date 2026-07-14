"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Id } from "./_generated/dataModel";

const operation = v.union(v.literal("claim"), v.literal("heartbeat"), v.literal("settle"));

function key() {
  const explicit = process.env.SPECTRA_AI_WORKER_BRIDGE_KEY;
  const base = process.env.SPECTRA_COLLAB_BRIDGE_KEY;
  const value = explicit || (base && base.length >= 32 ? createHmac("sha256", base).update("spectra-ai-worker-bridge:v1").digest("base64url") : undefined);
  if (!value || value.length < 32) throw new Error("AI_WORKER_BRIDGE_CONFIG_MISSING");
  return value;
}

function verify(operationName: string, payloadJson: string, timestamp: number, nonce: string, signature: string) {
  if (Math.abs(Date.now() - timestamp) > 30_000 || payloadJson.length > 20_000 || nonce.length < 20 || nonce.length > 100) throw new Error("AI_WORKER_BRIDGE_INVALID");
  const digest = createHash("sha256").update(payloadJson).digest("base64url");
  const expected = createHmac("sha256", key()).update([operationName, timestamp, nonce, digest].join("|")).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("AI_WORKER_BRIDGE_FORBIDDEN");
}

function payload(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AI_WORKER_BRIDGE_PAYLOAD_INVALID");
  return parsed as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 180) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`AI_WORKER_${name.toUpperCase()}_INVALID`);
  return value.trim();
}

export const exchange = action({
  args: { operation, payloadJson: v.string(), timestamp: v.number(), nonce: v.string(), signature: v.string() },
  handler: async (ctx, args): Promise<unknown> => {
    verify(args.operation, args.payloadJson, args.timestamp, args.nonce, args.signature);
    const value = payload(args.payloadJson);
    const workerId = text(value.workerId, "worker_id");
    if (args.operation === "claim") {
      const claim = await ctx.runMutation(internal.spectraRunJobs.claimNext, { workerId });
      if (!claim) return null;
      return ctx.runQuery(internal.spectraRunJobs.hydrate, { jobId: claim.jobId, workerId });
    }
    const jobId = text(value.jobId, "job_id") as Id<"spectraRunJobs">;
    if (args.operation === "heartbeat") return ctx.runMutation(internal.spectraRunJobs.heartbeat, { jobId, workerId });
    return ctx.runMutation(internal.spectraRunJobs.settle, { jobId, workerId, succeeded: value.succeeded === true, error: typeof value.error === "string" ? value.error : undefined });
  },
});
