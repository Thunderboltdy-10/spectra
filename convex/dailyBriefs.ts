import { v } from "convex/values";
import { internalMutation, mutation, query } from "./functions";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { briefSuggestionValidator } from "./dailyBriefSchema";
import { getAuthenticatedAccount } from "./identityShared";

/*
 * The morning brief (docs/product/HOME.md, "The morning brief"). Each account
 * keeps one row, for the reader's current day only: the next day's claim
 * replaces it, so yesterday's brief is never kept. A claim lets one writer
 * through per day; a failed or abandoned claim can be taken again after a
 * while. A brief is written once a day and never on request.
 *
 * Each student's wake-up time is kept as a schedule; a cron hands the due
 * ones to the app a little before they wake, so the brief is waiting.
 */

const RECLAIM_AFTER_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** How long before waking the brief is written. */
export const BRIEF_LEAD_MS = 30 * 60_000;
/** A schedule missed by more than this (the app was down) skips that morning. */
const STALE_AFTER_MS = 3 * 60 * 60_000;
const DISPATCH_BATCH = 50;

async function rowOf(ctx: QueryCtx, accountId: Id<"accounts">) {
  return await ctx.db
    .query("dailyBriefs")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .first();
}

/** Today's brief, or null when there is none for `day` yet. */
export const today = query({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const account = await getAuthenticatedAccount(ctx);
    if (!account) return null;
    const row = await rowOf(ctx, account._id);
    if (!row || row.day !== day) return null;
    return {
      state: row.state,
      recap: row.recap,
      suggestions: row.suggestions ?? [],
      claimedAt: row.claimedAt,
    };
  },
});

/** Takes the day's brief for writing; false when it is written or being written. */
export const claim = mutation({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const account = await getAuthenticatedAccount(ctx);
    if (!account) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const now = Date.now();
    const row = await rowOf(ctx, account._id);
    if (row && row.day === day) {
      if (row.state === "ready") return false;
      if (now - row.claimedAt < RECLAIM_AFTER_MS) return false;
    }
    const fresh = { day, state: "writing" as const, claimedAt: now, recap: undefined, suggestions: undefined, updatedAt: now };
    if (row) await ctx.db.patch(row._id, fresh);
    else await ctx.db.insert("dailyBriefs", { accountId: account._id, ...fresh });
    return true;
  },
});

export const save = mutation({
  args: {
    day: v.string(),
    recap: v.optional(v.string()),
    suggestions: v.optional(v.array(briefSuggestionValidator)),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const account = await getAuthenticatedAccount(ctx);
    if (!account) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const row = await rowOf(ctx, account._id);
    if (!row || row.day !== args.day) return;
    await ctx.db.patch(row._id, {
      state: args.failed ? "failed" : "ready",
      recap: args.recap?.slice(0, 600),
      suggestions: args.suggestions?.slice(0, 5),
      updatedAt: Date.now(),
    });
  },
});

/** Marks a suggestion acted on, with what it made or added. */
export const mark = mutation({
  args: { day: v.string(), index: v.number(), doneId: v.optional(v.string()) },
  handler: async (ctx, { day, index, doneId }) => {
    const account = await getAuthenticatedAccount(ctx);
    if (!account) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const row = await rowOf(ctx, account._id);
    const suggestions = row?.day === day ? row.suggestions : undefined;
    if (!row || !suggestions?.[index]) return;
    await ctx.db.patch(row._id, {
      suggestions: suggestions.map((item, at) => (at === index ? { ...item, done: true, ...(doneId ? { doneId } : {}) } : item)),
    });
  },
});

/** Keeps the student's wake-up time; `wakeAt` is the next one, worked out where the zone is known. */
export const setSchedule = mutation({
  args: { enabled: v.boolean(), wakeTime: v.string(), timeZone: v.string(), wakeAt: v.number() },
  handler: async (ctx, { enabled, wakeTime, timeZone, wakeAt }) => {
    const account = await getAuthenticatedAccount(ctx);
    if (!account) return;
    const row = await ctx.db
      .query("briefSchedules")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .first();
    if (!enabled) {
      if (row) await ctx.db.delete(row._id);
      return;
    }
    const nextAt = wakeAt - BRIEF_LEAD_MS;
    if (row && row.wakeTime === wakeTime && row.timeZone === timeZone && row.nextAt === nextAt) return;
    const fields = { clerkId: account.clerkId, wakeTime, timeZone, nextAt, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("briefSchedules", { accountId: account._id, ...fields });
  },
});

/** The cron: hands each brief due now to the app and moves its schedule to the next morning. */
export const dispatchDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("briefSchedules")
      .withIndex("by_next", (q) => q.lte("nextAt", now))
      .take(DISPATCH_BATCH);
    for (const schedule of due) {
      if (now - schedule.nextAt < STALE_AFTER_MS) {
        await ctx.scheduler.runAfter(0, internal.executionScheduler.dispatchDailyBrief, {
          clerkId: schedule.clerkId,
          timeZone: schedule.timeZone,
          wakeAt: schedule.nextAt + BRIEF_LEAD_MS,
        });
      }
      // Whole days on; Home sets the exact instant again across daylight saving.
      const days = Math.floor((now - schedule.nextAt) / DAY_MS) + 1;
      await ctx.db.patch(schedule._id, { nextAt: schedule.nextAt + days * DAY_MS });
    }
  },
});

