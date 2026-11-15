import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";

/*
 * Collaboration keeps a little bookkeeping for every edit. Each kind is only
 * useful for a while, so this daily sweep (crons.ts) lets it go:
 *
 * - region claims, once released or rejected, only explain a recent conflict;
 * - update receipts only answer a client retrying an update it already sent;
 * - a finished change group's before/after snapshots only serve "Undo what
 *   Spectra did" soon after a run. Version history keeps every version.
 *
 * Each step takes a bounded batch and the sweep continues itself while any is full.
 */

const DAY = 24 * 60 * 60_000;
export const CLAIM_HISTORY_MS = 30 * DAY;
export const RECEIPT_KEEP_MS = 30 * DAY;
export const CHANGE_GROUP_SNAPSHOT_KEEP_MS = 14 * DAY;
const BATCH = 100;
/** Snapshots can be large, so fewer change groups are read per pass. */
const GROUP_BATCH = 10;

async function sweepClaims(ctx: MutationCtx, before: number) {
  let removed = 0;
  let full = false;
  for (const status of ["released", "rejected"] as const) {
    const rows = await ctx.db.query("regionClaims")
      .withIndex("by_status_expiry", (q) => q.eq("status", status).lt("leaseExpiresAt", before))
      .take(BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    removed += rows.length;
    full ||= rows.length === BATCH;
  }
  return { removed, full };
}

async function sweepReceipts(ctx: MutationCtx, before: number) {
  const rows = await ctx.db.query("collaborationReceipts")
    .withIndex("by_created", (q) => q.lt("createdAt", before))
    .take(BATCH);
  for (const row of rows) await ctx.db.delete(row._id);
  return { removed: rows.length, full: rows.length === BATCH };
}

async function trimChangeGroups(ctx: MutationCtx, before: number) {
  let trimmed = 0;
  let full = false;
  for (const status of ["committed", "abandoned"] as const) {
    const rows = await ctx.db.query("changeGroups")
      .withIndex("by_status_committed", (q) => q.eq("status", status).eq("snapshotsTrimmed", undefined).lt("committedAt", before))
      .take(GROUP_BATCH);
    full ||= rows.length === GROUP_BATCH;
    for (const row of rows) {
      if (row.baseSnapshot !== undefined || row.finalSnapshot !== undefined) {
        trimmed += 1;
      }
      // Move each row out of the index range, including commits sharing a timestamp.
      await ctx.db.patch(row._id, { baseSnapshot: undefined, finalSnapshot: undefined, snapshotsTrimmed: true });
    }
  }
  return { trimmed, full };
}

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [claims, receipts, groups] = [
      await sweepClaims(ctx, now - CLAIM_HISTORY_MS),
      await sweepReceipts(ctx, now - RECEIPT_KEEP_MS),
      await trimChangeGroups(ctx, now - CHANGE_GROUP_SNAPSHOT_KEEP_MS),
    ];
    const more = claims.full || receipts.full || groups.full;
    if (more) await ctx.scheduler.runAfter(0, internal.collaborationRetention.sweep, {});
    return { claims: claims.removed, receipts: receipts.removed, changeGroups: groups.trimmed, more };
  },
});
