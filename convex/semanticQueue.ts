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
export const SEMANTIC_DEBOUNCE_MS = 6_000;
/** A continuously edited item is still indexed this often. */
export const SEMANTIC_MAX_WAIT_MS = 60_000;
/** Coalesced saves rewrite the queue row at most this often. */
const TOUCH_INTERVAL_MS = 2_000;

type QueueDb = Pick<MutationCtx["db"], "query" | "insert" | "patch">;
type QueueCtx = { db: QueueDb; scheduler: MutationCtx["scheduler"] };

/** One scheduled dispatch per transaction, however many items it touches. */
const scheduledIn = new WeakSet<object>();

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
    if (options.immediate) await scheduleDispatch(ctx, 0);
    return;
  }
  await ctx.db.insert("semanticIndexQueue", { itemKind: kind, itemId, schoolId: options.schoolId, status: "waiting",
    dueAt, firstQueuedAt: now, lastTouchedAt: now, attempts: 0 });
  await scheduleDispatch(ctx, dueAt - now);
}

async function scheduleDispatch(ctx: QueueCtx, delayMs: number) {
  const marker = ctx.db as object;
  if (scheduledIn.has(marker)) return;
  scheduledIn.add(marker);
  await ctx.scheduler.runAfter(delayMs, internal.semanticIndex.dispatch, {});
}
