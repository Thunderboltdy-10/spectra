import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";

// Reclaim the queue item before the run's two-minute execution lease expires,
// leaving a recovery window in which a replacement worker can renew the run
// instead of the stale-run reconciler declaring it interrupted.
const LEASE_MS = 90_000;

async function ownedRun(ctx: Parameters<typeof getAuthenticatedActor>[0], runId: Id<"spectraAiRuns">) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  const run = await ctx.db.get(runId);
  if (!run || run.ownerAccountId !== actor.accountId || run.schoolId !== actor.schoolId) throw new Error("AI run not found");
  return { actor, run };
}

export const generateAttachmentUploadUrl = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { run } = await ownedRun(ctx, args.runId);
    if (run.executionId !== args.executionId || run.status !== "queued") throw new Error("RUN_ATTACHMENT_WINDOW_CLOSED");
    return ctx.storage.generateUploadUrl();
  },
});

export const registerAttachment = mutation({
  args: {
    runId: v.id("spectraAiRuns"), executionId: v.string(), storageId: v.optional(v.id("_storage")),
    name: v.string(), mimeType: v.string(), size: v.number(),
    handling: v.union(v.literal("pdf"), v.literal("text"), v.literal("docx")),
    extractedText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, run } = await ownedRun(ctx, args.runId);
    if (run.executionId !== args.executionId || run.status !== "queued") throw new Error("RUN_ATTACHMENT_WINDOW_CLOSED");
    if (args.handling === "pdf" && !args.storageId) throw new Error("RUN_ATTACHMENT_STORAGE_REQUIRED");
    if (args.handling !== "pdf" && !args.extractedText) throw new Error("RUN_ATTACHMENT_TEXT_REQUIRED");
    const existing = await ctx.db.query("spectraRunAttachments").withIndex("by_run_execution", (q) => q.eq("runId", args.runId).eq("executionId", args.executionId)).collect();
    const duplicate = existing.find((attachment) => attachment.name === args.name.slice(0, 180) && attachment.size === Math.max(0, Math.floor(args.size)) && attachment.handling === args.handling);
    if (duplicate) return { attachmentId: duplicate._id };
    if (existing.length >= 4) throw new Error("RUN_ATTACHMENT_LIMIT");
    const attachmentId = await ctx.db.insert("spectraRunAttachments", {
      runId: args.runId, executionId: args.executionId, ownerAccountId: actor.accountId,
      storageId: args.storageId, name: args.name.slice(0, 180), mimeType: args.mimeType.slice(0, 120),
      size: Math.max(0, Math.floor(args.size)), handling: args.handling,
      extractedText: args.extractedText?.slice(0, 80_000), createdAt: Date.now(),
    });
    return { attachmentId };
  },
});

export const enqueue = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string(), payload: v.any() },
  handler: async (ctx, args) => {
    const { actor, run } = await ownedRun(ctx, args.runId);
    if (run.executionId !== args.executionId || run.status !== "queued") throw new Error("RUN_NOT_QUEUEABLE");
    const existing = await ctx.db.query("spectraRunJobs").withIndex("by_run_execution", (q) => q.eq("runId", args.runId).eq("executionId", args.executionId)).unique();
    if (existing) {
      if (existing.status === "failed" || existing.status === "cancelled") {
        const now = Date.now();
        await ctx.db.patch(existing._id, { status: "queued", payload: args.payload, availableAt: now + 60_000, attempt: 0, lastError: undefined, completedAt: undefined, workerId: undefined, leaseExpiresAt: undefined, updatedAt: now });
        return { jobId: existing._id, created: true };
      }
      return { jobId: existing._id, created: false };
    }
    const now = Date.now();
    const jobId = await ctx.db.insert("spectraRunJobs", { runId: args.runId, executionId: args.executionId, ownerAccountId: actor.accountId, schoolId: actor.schoolId, status: "queued", payload: args.payload, availableAt: now + 60_000, attempt: 0, createdAt: now, updatedAt: now });
    return { jobId, created: true };
  },
});

export const activate = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    await ownedRun(ctx, args.runId);
    const job = await ctx.db.query("spectraRunJobs").withIndex("by_run_execution", (q) => q.eq("runId", args.runId).eq("executionId", args.executionId)).unique();
    if (!job || job.status !== "queued") return { activated: false };
    await ctx.db.patch(job._id, { availableAt: Date.now(), updatedAt: Date.now() });
    return { activated: true };
  },
});

export const cancelForRun = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    await ownedRun(ctx, args.runId);
    const job = await ctx.db.query("spectraRunJobs").withIndex("by_run_execution", (q) => q.eq("runId", args.runId).eq("executionId", args.executionId)).unique();
    if (!job || job.status === "completed" || job.status === "cancelled") return { cancelled: false };
    await ctx.db.patch(job._id, { status: "cancelled", leaseExpiresAt: undefined, workerId: undefined, completedAt: Date.now(), updatedAt: Date.now() });
    return { cancelled: true };
  },
});

export const claimNext = internalMutation({
  args: { workerId: v.string() },
  handler: async (ctx, args) => {
    const workerId = args.workerId.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 160);
    if (!workerId) throw new Error("RUN_WORKER_ID_REQUIRED");
    const now = Date.now();
    let job = await ctx.db.query("spectraRunJobs").withIndex("by_status_available", (q) => q.eq("status", "queued").lte("availableAt", now)).first();
    if (!job) {
      const leased = await ctx.db.query("spectraRunJobs").withIndex("by_status_available", (q) => q.eq("status", "leased")).take(100);
      job = leased.filter((candidate) => (candidate.leaseExpiresAt ?? 0) <= now).sort((left, right) => left.updatedAt - right.updatedAt)[0] ?? null;
    }
    if (!job) return null;
    const run = await ctx.db.get(job.runId);
    if (!run || run.executionId !== job.executionId || !["queued", "running"].includes(run.status)) {
      await ctx.db.patch(job._id, { status: "cancelled", completedAt: now, updatedAt: now });
      return null;
    }
    const payloadKind = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? (job.payload as Record<string, unknown>).kind
      : undefined;
    if (job.attempt > 0 && payloadKind !== "resume_operations") {
      const [operations, messages] = await Promise.all([
        ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", job!.runId)).collect(),
        ctx.db.query("spectraMessages").withIndex("by_run", (q) => q.eq("runId", job!.runId)).collect(),
      ]);
      const currentOperations = operations.filter((operation) => operation.executionId === job!.executionId);
      const unsafe = currentOperations.some((operation) => operation.status === "executing" || operation.status === "executed" || operation.status === "failed")
        || messages.some((message) => message.runId === job!.runId && message.role === "assistant" && message.content.trim().length > 0);
      if (unsafe) {
        await ctx.db.patch(job._id, { status: "failed", lastError: "Unsafe automatic replay blocked after partial work.", completedAt: now, updatedAt: now });
        return null;
      }
      await Promise.all(currentOperations.filter((operation) => operation.status === "proposed").map((operation) => ctx.db.patch(operation._id, { status: "cancelled" })));
    }
    await ctx.db.patch(job._id, { status: "leased", workerId, leaseExpiresAt: now + LEASE_MS, attempt: job.attempt + 1, updatedAt: now });
    return { jobId: job._id, leaseExpiresAt: now + LEASE_MS };
  },
});

export const hydrate = internalQuery({
  args: { jobId: v.id("spectraRunJobs"), workerId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "leased" || job.workerId !== args.workerId || (job.leaseExpiresAt ?? 0) <= Date.now()) throw new Error("RUN_JOB_LEASE_INVALID");
    const [run, account, attachments, cards] = await Promise.all([
      ctx.db.get(job.runId), ctx.db.get(job.ownerAccountId),
      ctx.db.query("spectraRunAttachments").withIndex("by_run_execution", (q) => q.eq("runId", job.runId).eq("executionId", job.executionId)).collect(),
      ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", job.runId)).collect(),
    ]);
    if (!run || !account || !cards[0] || run.executionId !== job.executionId) throw new Error("RUN_JOB_STALE");
    return {
      jobId: job._id, runId: job.runId, executionId: job.executionId, workerId: args.workerId,
      resultCardId: cards.sort((left, right) => right.updatedAt - left.updatedAt)[0]!._id,
      actorClerkId: account.clerkId, payload: job.payload,
      attachments: await Promise.all(attachments.map(async (attachment) => ({
        name: attachment.name, mimeType: attachment.mimeType, size: attachment.size, handling: attachment.handling,
        extractedText: attachment.extractedText,
        url: attachment.storageId ? await ctx.storage.getUrl(attachment.storageId) : null,
      }))),
    };
  },
});

export const heartbeat = internalMutation({
  args: { jobId: v.id("spectraRunJobs"), workerId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "leased" || job.workerId !== args.workerId) return { alive: false };
    const run = await ctx.db.get(job.runId);
    if (!run || run.executionId !== job.executionId || !["queued", "running"].includes(run.status)) return { alive: false };
    const now = Date.now();
    await ctx.db.patch(job._id, { leaseExpiresAt: now + LEASE_MS, updatedAt: now });
    return { alive: true, leaseExpiresAt: now + LEASE_MS };
  },
});

export const settle = internalMutation({
  args: { jobId: v.id("spectraRunJobs"), workerId: v.string(), succeeded: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "leased" || job.workerId !== args.workerId) return { settled: false };
    const run = await ctx.db.get(job.runId);
    const now = Date.now();
    const retry = !args.succeeded && job.attempt < 5 && run && run.executionId === job.executionId && ["queued", "running"].includes(run.status);
    await ctx.db.patch(job._id, retry
      ? { status: "queued", workerId: undefined, leaseExpiresAt: undefined, availableAt: now + Math.min(30_000, 1_500 * 2 ** job.attempt), lastError: args.error?.slice(0, 1_000), updatedAt: now }
      : { status: args.succeeded ? "completed" : "failed", workerId: undefined, leaseExpiresAt: undefined, lastError: args.error?.slice(0, 1_000), completedAt: now, updatedAt: now });
    return { settled: true, retry };
  },
});
