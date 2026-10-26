import { v } from "convex/values";
import { internalMutation, mutation, query } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { briefSuggestionValidator } from "./dailyBriefSchema";
import { getAuthenticatedAccount } from "./identityShared";
import { platformStopped } from "./platformControls";
import { schoolSetupForAccount } from "./schoolSyncShared";

/*
 * The morning brief (docs/product/HOME.md, "The morning brief"). Each account
 * keeps one row, for the reader's current day: the next day's claim replaces
 * it, keeping the last brief only as `previous`, which Home shows until the
 * new day's is ready and which goes once it is. A claim lets one writer
 * through per day; a failed or abandoned claim can be taken again after a
 * while. A brief is written once a day and never on request.
 *
 * Each student's wake-up time is kept as a schedule; a cron hands the due
 * ones to the app a little before they wake, so the brief is waiting. A
 * reader away for four days stops getting them: their schedule rests, out of
 * the cron's way, until Home opens again, writes that day's brief there and
 * sets the schedule going.
 */

const RECLAIM_AFTER_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** How long before waking the brief is written. */
export const BRIEF_LEAD_MS = 30 * 60_000;
/** A schedule missed by more than this (the app was down) skips that morning. */
const STALE_AFTER_MS = 3 * 60 * 60_000;
const DISPATCH_BATCH = 50;
/** Days without opening Home after which the briefs stop. */
const IDLE_AFTER_MS = 4 * DAY_MS;
/** Home tells the schedule it was seen at most this often. */
const SEEN_EVERY_MS = 6 * 60 * 60_000;
/** Where a resting schedule waits: past any morning the cron will reach before Home sets it again. */
const RESTING_MS = 365 * DAY_MS;

async function rowOf(ctx: QueryCtx, accountId: Id<"accounts">) {
  return await ctx.db
    .query("dailyBriefs")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .first();
}

/** The brief a row keeps from before `day`: its own when it is an earlier day's, else the one it replaced. */
function earlierBrief(row: Doc<"dailyBriefs">, day: string) {
  if (row.day < day && row.state === "ready") return { day: row.day, recap: row.recap ?? "", suggestions: row.suggestions ?? [] };
  if (row.previous && row.previous.day < day) return { day: row.previous.day, recap: row.previous.recap ?? "", suggestions: row.previous.suggestions ?? [] };
  return undefined;
}

/**
 * Today's brief: its state, or "absent" when there is none for `day` yet.
 * Until it is ready, `previous` is the last day's, which Home keeps showing.
 * Null only for a reader with no brief at all.
 */
export const today = query({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const account = await getAuthenticatedAccount(ctx);
    if (!account) return null;
    const setup = await schoolSetupForAccount(ctx, account._id);
    if (!setup.tourComplete || setup.phase !== "ready") return null;
    const row = await rowOf(ctx, account._id);
    if (!row) return null;
    if (row.claimedAt < setup.completedAt!) return null;
    const previous = row.day === day && row.state === "ready" ? undefined : earlierBrief(row, day);
    if (row.day !== day) return { state: "absent" as const, claimedAt: 0, recap: undefined, suggestions: [], ...(previous ? { previous } : {}) };
    return {
      state: row.state,
      recap: row.recap,
      suggestions: row.suggestions ?? [],
      claimedAt: row.claimedAt,
      ...(previous ? { previous } : {}),
    };
  },
});

/** Takes the day's brief for writing; false when it is written or being written. */
export const claim = mutation({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const account = await getAuthenticatedAccount(ctx);
    if (!account) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const setup = await schoolSetupForAccount(ctx, account._id);
    if (!setup.tourComplete || setup.phase !== "ready") return false;
    const now = Date.now();
    const row = await rowOf(ctx, account._id);
    if (row && row.day === day) {
      if (row.claimedAt >= setup.completedAt!) {
        if (row.state === "ready") return false;
        if (now - row.claimedAt < RECLAIM_AFTER_MS) return false;
      }
    }
    // The last brief stays on the page while this one is written.
    const previous = row && row.claimedAt >= setup.completedAt! ? earlierBrief(row, day) : undefined;
    const fresh = { day, state: "writing" as const, claimedAt: now, recap: undefined, suggestions: undefined, previous, updatedAt: now };
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
      // A failed brief leaves the last one showing; a written one replaces it.
      ...(args.failed ? {} : { previous: undefined }),
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
    const now = Date.now();
    const seen = row?.seenAt !== undefined && now - row.seenAt < SEEN_EVERY_MS;
    if (row && seen && row.wakeTime === wakeTime && row.timeZone === timeZone && row.nextAt === nextAt) return;
    const fields = { clerkId: account.clerkId, wakeTime, timeZone, nextAt, seenAt: now, updatedAt: now };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("briefSchedules", { accountId: account._id, ...fields });
  },
});

/** The cron: hands each brief due now to the app and moves its schedule to the next morning. */
export const dispatchDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    if ((await platformStopped(ctx, "background")) || (await platformStopped(ctx, "ai"))) return null;
    const now = Date.now();
    const due = await ctx.db
      .query("briefSchedules")
      .withIndex("by_next", (q) => q.lte("nextAt", now))
      .take(DISPATCH_BATCH);
    for (const schedule of due) {
      const setup = await schoolSetupForAccount(ctx, schedule.accountId);
      if (!setup.tourComplete || setup.phase !== "ready") {
        await ctx.db.patch(schedule._id, { nextAt: now + DAY_MS });
        continue;
      }
      if (now - (schedule.seenAt ?? schedule.updatedAt) > IDLE_AFTER_MS) {
        await ctx.db.patch(schedule._id, { nextAt: now + RESTING_MS });
        continue;
      }
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

