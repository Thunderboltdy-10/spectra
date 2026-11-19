import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation } from "./functions";
import { derivedKey, postSigned } from "./executionScheduler";

/*
 * The server outbox keeps a Word, Excel or PowerPoint file and its Spectra
 * work together when no studio tab is open to do it: an AI edit made while
 * the student is elsewhere still reaches the file on their computer, and a
 * Word save still reaches Spectra.
 *
 * One row per work, overwritten rather than appended. A change sets a flag
 * and bumps `generation`; the row waits until the work has been quiet for
 * OUTBOX_IDLE_MS, then asks the app (signed, as the owner) to run the same
 * materialize or reconcile an open studio would. A send clears only the flag
 * for the generation it saw, so a change that lands mid-send runs again.
 * Taking in Word comes first: a write built on an older file is refused
 * anyway. The base-revision checks behind both actions make a send that
 * races an open studio harmless; the studio's own operation, seen at claim
 * time, makes it unnecessary.
 */

export const OUTBOX_IDLE_MS = 15_000;
/** Rapid edits share one row write; the idle window still runs from the last. */
const COALESCE_MS = 5_000;
/** A send that never finished (deploy, crash) is retried after this. */
const SEND_STALE_MS = 10 * 60_000;
/** Bridge write still in flight: look again shortly. */
const PENDING_RETRY_MS = 30_000;
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const OFFICE_FORMATS = new Set(["docx", "xlsx", "pptx"]);

type OutboxAction = "materialize" | "reconcile";
type OutboxCtx = Pick<MutationCtx, "db" | "scheduler">;

/** Errors no retry will fix: the row is dropped and the studio takes over when opened. */
const TERMINAL_ERRORS = [
  "WORK_NOT_FOUND",
  "NATIVE_WRITES_DISABLED",
  "NATIVE_PROMOTION_PROTECTED",
  "LOCAL_REPLICA_UNAVAILABLE",
  "NATIVE_PAYLOAD_UNAVAILABLE",
  "OUTBOX_UNCONFIGURED",
];

async function localReplica(ctx: Pick<MutationCtx, "db">, workId: Id<"spectraArtifacts">) {
  return ctx.db
    .query("workReplicas")
    .withIndex("by_work_kind", (q) => q.eq("workId", workId).eq("kind", "local"))
    .first();
}

export function outboxRoute(nativeFormat: string) {
  return nativeFormat === "docx" ? "docx" as const : "office" as const;
}

/**
 * Notes that one side moved. Cheap on the hot path: works without a local
 * Office file return after one indexed read, and repeated edits inside the
 * coalescing window write nothing.
 */
export async function enqueueNativeOutbox(
  ctx: OutboxCtx,
  workId: Id<"spectraArtifacts">,
  action: OutboxAction,
) {
  const local = await localReplica(ctx, workId);
  if (!local || !OFFICE_FORMATS.has(local.nativeFormat)) return;
  if (action === "materialize" && local.protectedOriginal) return;
  const now = Date.now();
  const existing = await ctx.db
    .query("nativeOutbox")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .unique();
  if (!existing) {
    const dueAt = now + OUTBOX_IDLE_MS;
    await ctx.db.insert("nativeOutbox", {
      workId,
      accountId: local.accountId,
      reconcile: action === "reconcile",
      materialize: action === "materialize",
      state: "waiting",
      generation: 1,
      changedAt: now,
      dueAt,
      attempts: 0,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(dueAt, internal.nativeOutbox.claim, { workId });
    return;
  }
  if (existing[action] && existing.state === "waiting" && now - existing.changedAt < COALESCE_MS) return;
  await ctx.db.patch(existing._id, {
    [action]: true,
    generation: existing.generation + 1,
    changedAt: now,
    // A fresh change after failures starts the retries over.
    attempts: existing.state === "waiting" ? 0 : existing.attempts,
    updatedAt: now,
  });
}

async function wait(ctx: OutboxCtx, row: Doc<"nativeOutbox">, dueAt: number, patch: Partial<Doc<"nativeOutbox">> = {}) {
  await ctx.db.patch(row._id, { ...patch, state: "waiting", dueAt, updatedAt: Date.now() });
  await ctx.scheduler.runAt(dueAt, internal.nativeOutbox.claim, { workId: row.workId });
}

/** Did an open studio already do this since the change? */
async function handledByStudio(ctx: Pick<MutationCtx, "db">, row: Doc<"nativeOutbox">, action: OutboxAction) {
  const latest = await ctx.db
    .query("syncOperations")
    .withIndex("by_work_created", (q) => q.eq("workId", row.workId).gt("createdAt", row.changedAt))
    .order("desc")
    .take(5);
  const direction = action === "materialize" ? "cloud-to-local" : "local-to-cloud";
  return latest.some((operation) =>
    (operation.direction === direction || (action === "reconcile" && operation.direction === "external")) &&
    operation.state !== "failed");
}

export const claim = internalMutation({
  args: { workId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("nativeOutbox")
      .withIndex("by_work", (q) => q.eq("workId", args.workId))
      .unique();
    if (!row) return { state: "empty" as const };
    const now = Date.now();
    if (row.state === "sending") {
      if (now - (row.sentAt ?? 0) < SEND_STALE_MS) return { state: "busy" as const };
    }
    if (row.state === "waiting" && row.dueAt > now + 1_000) return { state: "early" as const };
    const quietAt = row.changedAt + OUTBOX_IDLE_MS;
    if (quietAt > now) {
      await wait(ctx, row, quietAt);
      return { state: "debounced" as const };
    }
    const [work, local] = await Promise.all([ctx.db.get(row.workId), localReplica(ctx, row.workId)]);
    if (!work || work.status === "deleted" || !local || !OFFICE_FORMATS.has(local.nativeFormat)) {
      await ctx.db.delete(row._id);
      return { state: "dropped" as const };
    }
    let reconcile = row.reconcile;
    let materialize = row.materialize && !local.protectedOriginal;
    // Word has a save Spectra has not taken in: that comes first.
    if (local.state === "ahead" || local.state === "diverged") reconcile = true;
    else if (reconcile && local.state !== "pending") reconcile = false;
    if (reconcile && await handledByStudio(ctx, row, "reconcile")) reconcile = false;
    if (!reconcile && materialize && await handledByStudio(ctx, row, "materialize")) materialize = false;
    if (!reconcile && !materialize) {
      await ctx.db.delete(row._id);
      return { state: "settled" as const };
    }
    // A Bridge write is still landing: its outcome decides what is next.
    if (local.state === "pending") {
      await wait(ctx, row, now + PENDING_RETRY_MS, { reconcile, materialize });
      return { state: "pending" as const };
    }
    const account = await ctx.db.get(local.accountId);
    if (!account?.clerkId) {
      await ctx.db.delete(row._id);
      return { state: "dropped" as const };
    }
    const action: OutboxAction = reconcile ? "reconcile" : "materialize";
    await ctx.db.patch(row._id, {
      reconcile,
      materialize,
      state: "sending",
      sentAction: action,
      sentGeneration: row.generation,
      sentAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.nativeOutbox.send, {
      workId: row.workId,
      action,
      route: outboxRoute(local.nativeFormat),
      clerkId: account.clerkId,
      generation: row.generation,
    });
    return { state: "sending" as const, action };
  },
});

export const send = internalAction({
  args: {
    workId: v.id("spectraArtifacts"),
    action: v.union(v.literal("materialize"), v.literal("reconcile")),
    route: v.union(v.literal("docx"), v.literal("office")),
    clerkId: v.string(),
    generation: v.number(),
  },
  handler: async (ctx, args) => {
    let outcome: { ok: true; state?: string } | { ok: false; error: string };
    if (!process.env.SPECTRA_APP_URL?.trim() || !process.env.SPECTRA_COLLAB_BRIDGE_KEY?.trim()) {
      outcome = { ok: false, error: "OUTBOX_UNCONFIGURED" };
    } else {
      try {
        const response = await postSigned(
          "/api/spectra/native/outbox",
          { workId: args.workId, action: args.action, route: args.route, clerkId: args.clerkId },
          derivedKey("SPECTRA_COLLAB_BRIDGE_KEY", "spectra-event-callback:v1"),
          "spectra-scheduler",
        );
        const body = (await response.json().catch(() => null)) as { state?: unknown; error?: unknown } | null;
        outcome = typeof body?.error === "string"
          ? { ok: false, error: body.error }
          : { ok: true, state: typeof body?.state === "string" ? body.state : undefined };
      } catch (error) {
        outcome = { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : "OUTBOX_SEND_FAILED" };
      }
    }
    await ctx.runMutation(internal.nativeOutbox.finish, {
      workId: args.workId,
      action: args.action,
      generation: args.generation,
      ok: outcome.ok,
      state: outcome.ok ? outcome.state : undefined,
      error: outcome.ok ? undefined : outcome.error,
    });
  },
});

export const finish = internalMutation({
  args: {
    workId: v.id("spectraArtifacts"),
    action: v.union(v.literal("materialize"), v.literal("reconcile")),
    generation: v.number(),
    ok: v.boolean(),
    state: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("nativeOutbox")
      .withIndex("by_work", (q) => q.eq("workId", args.workId))
      .unique();
    if (!row || row.state !== "sending" || row.sentGeneration !== args.generation || row.sentAction !== args.action)
      return { state: "stale" as const };
    const now = Date.now();
    if (!args.ok) {
      const error = args.error ?? "OUTBOX_SEND_FAILED";
      const delay = RETRY_DELAYS_MS[row.attempts];
      if (TERMINAL_ERRORS.some((code) => error.includes(code)) || delay === undefined) {
        await ctx.db.delete(row._id);
        return { state: "given-up" as const };
      }
      await wait(ctx, row, now + delay, { attempts: row.attempts + 1, lastError: error });
      return { state: "retrying" as const };
    }
    const changedSince = row.generation !== args.generation;
    const next = {
      reconcile: args.action === "reconcile" && !changedSince ? false : row.reconcile,
      materialize: args.action === "materialize" && !changedSince ? false : row.materialize,
    };
    // A conflict waits for the student's choice; trying again would only
    // record it again.
    if (args.state === "conflicted") {
      await ctx.db.delete(row._id);
      return { state: "conflicted" as const };
    }
    if (!next.reconcile && !next.materialize) {
      await ctx.db.delete(row._id);
      return { state: "done" as const };
    }
    // Taking in Word may leave Spectra's own edits for Word: send them next.
    await wait(ctx, row, Math.max(now + 1_000, row.changedAt + OUTBOX_IDLE_MS), {
      ...next,
      attempts: 0,
      lastError: undefined,
    });
    return { state: "continuing" as const };
  },
});

/** Rows whose wake-up was lost (deploy, failed action) are picked up again. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const overdue = await ctx.db
      .query("nativeOutbox")
      .withIndex("by_state_due", (q) => q.eq("state", "waiting").lt("dueAt", now - 2 * 60_000))
      .take(50);
    const stale = await ctx.db
      .query("nativeOutbox")
      .withIndex("by_state_due", (q) => q.eq("state", "sending"))
      .take(50);
    let woken = 0;
    for (const row of [...overdue, ...stale.filter((row) => now - (row.sentAt ?? 0) >= SEND_STALE_MS)]) {
      await ctx.scheduler.runAfter(woken * 500, internal.nativeOutbox.claim, { workId: row.workId });
      woken += 1;
    }
    return { woken };
  },
});
