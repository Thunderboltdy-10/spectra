/**
 * Debounced re-index requests (no registered functions). Saves reach `enqueueSemanticItem`
 * through the triggers declared in ./semanticSources and registered by ./orgNodeMutation; it
 * touches one queue row and never does network work.
 * Imports stay minimal because ./orgNodeMutation loads this module.
 */
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { IndexedSemanticKind } from "../shared/semantic-types";

/** Quiet period after the last save before re-indexing. */
export const SEMANTIC_DEBOUNCE_MS = 5 * 60_000;
/** A continuously edited item is still indexed this often. */
export const SEMANTIC_MAX_WAIT_MS = 30 * 60_000;
/** Coalesced saves rewrite the queue row at most this often. */
const TOUCH_INTERVAL_MS = 60_000;

type QueueDb = Pick<MutationCtx["db"], "query" | "insert" | "patch">;
type QueueCtx = { db: QueueDb; scheduler: MutationCtx["scheduler"] };

/** The earliest dispatch this transaction scheduled, however many items it touches. */
const scheduledIn = new WeakMap<object, number>();
/** A dispatch due about now may be the one running (scheduled functions can start a little early). */
const DISPATCH_SLACK_MS = 1_000;

export async function enqueueSemanticItem(ctx: QueueCtx, kind: IndexedSemanticKind, itemId: string,
  options: { schoolId?: Id<"schools">; immediate?: boolean } = {}) {
  const now = Date.now();
  const existing = await ctx.db.query("semanticIndexQueue")
    .withIndex("by_item", (q) => q.eq("itemKind", kind).eq("itemId", itemId)).unique();
  const dueAt = options.immediate ? now : now + SEMANTIC_DEBOUNCE_MS;
  if (existing?.status === "running") {
    if (!existing.rerun) await ctx.db.patch(existing._id, { rerun: true, lastTouchedAt: now });
    return;
  }
  if (existing) {
    const capped = Math.min(dueAt, existing.firstQueuedAt + SEMANTIC_MAX_WAIT_MS);
    if (options.immediate ? existing.dueAt <= now : now - existing.lastTouchedAt < TOUCH_INTERVAL_MS) return;
    await ctx.db.patch(existing._id, { dueAt: Math.max(now, capped), lastTouchedAt: now });
    if (options.immediate) await scheduleSemanticDispatch(ctx, now);
    return;
  }
  await ctx.db.insert("semanticIndexQueue", { itemKind: kind, itemId, schoolId: options.schoolId, status: "waiting",
    dueAt, firstQueuedAt: now, lastTouchedAt: now, attempts: 0 });
  await scheduleSemanticDispatch(ctx, dueAt);
}

/**
 * Makes sure a dispatch runs by `at`. A dispatch already scheduled between now and
 * then covers it: each dispatch schedules the next for the work still waiting, so a
 * sync that queues hundreds of items schedules one dispatch, not hundreds. A duplicate
 * dispatch is harmless because jobs are leased.
 */
export async function scheduleSemanticDispatch(ctx: QueueCtx, at: number) {
  const transaction = ctx.db as object;
  const earliest = scheduledIn.get(transaction);
  if (earliest !== undefined && earliest <= at) return;
  const now = Date.now();
  const marker = await ctx.db.query("semanticDispatcher").first();
  if (marker && marker.scheduledFor > now + DISPATCH_SLACK_MS && marker.scheduledFor <= at) return;
  if (marker) await ctx.db.patch(marker._id, { scheduledFor: at });
  else await ctx.db.insert("semanticDispatcher", { scheduledFor: at });
  scheduledIn.set(transaction, at);
  await ctx.scheduler.runAfter(Math.max(0, at - now), internal.semanticIndex.dispatch, {});
}
