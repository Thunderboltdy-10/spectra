import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedActor } from "./identityShared";
import { ANALYTICS_MIGRATIONS, analyticsMigration, upsertAnalyticsRun } from "./analyticsReadModels";
import { upsertArtifactSummary } from "./orgTreeShared";

const DAY = 24 * 60 * 60_000;
const ROW_LIMIT = 2_000;
const preparingState = {
  kind: "partial" as const,
  details: "Historical analytics are still being prepared. Counts will be available when preparation finishes.",
};

function day(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function metricState(
  truncated: boolean,
  computedAt: number,
  detail = "The selected indexed records were aggregated successfully.",
) {
  return truncated
    ? ({
        kind: "partial" as const,
        details: `The range exceeded the ${ROW_LIMIT.toLocaleString()}-record aggregation bound. Narrow the date filter for an exact result.`,
      })
    : ({ kind: "available" as const, updatedAt: computedAt, detail });
}

export const personalOverview = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_REQUIRED: Sign in to view analytics.");
    if (
      !Number.isFinite(args.from) ||
      !Number.isFinite(args.to) ||
      args.to <= args.from ||
      args.to - args.from > 367 * DAY
    )
      throw new Error("ANALYTICS_RANGE_INVALID");

    const fromDay = day(args.from);
    const toDay = day(args.to);
    const [artifactMigration, runMigration] = await Promise.all([
      analyticsMigration(ctx, "artifacts"), analyticsMigration(ctx, "runs"),
    ]);
    const workReady = artifactMigration?.state === "complete" && artifactMigration.version === ANALYTICS_MIGRATIONS.artifacts.version;
    const runsReady = runMigration?.state === "complete" && runMigration.version === ANALYTICS_MIGRATIONS.runs.version;
    const [workRows, workspaceRows, runRows, meterRows] = await Promise.all([
      workReady ? ctx.db
        .query("spectraArtifactSummaries")
        .withIndex("by_account_created", (q) =>
          q
            .eq("ownerAccountId", actor.accountId)
            .gte("createdAt", args.from)
            .lte("createdAt", args.to),
        )
        .order("desc")
        .take(ROW_LIMIT + 1) : [],
      ctx.db
        .query("spectraWorkspaces")
        .withIndex("by_account_activity", (q) =>
          q
            .eq("ownerAccountId", actor.accountId)
            .gte("lastActivityAt", args.from)
            .lte("lastActivityAt", args.to),
        )
        .take(ROW_LIMIT + 1),
      runsReady ? ctx.db
        .query("spectraAnalyticsRunSummaries")
        .withIndex("by_account_created", (q) =>
          q
            .eq("ownerAccountId", actor.accountId)
            .gte("createdAt", args.from)
            .lte("createdAt", args.to),
        )
        .order("desc")
        .take(ROW_LIMIT + 1) : [],
      ctx.db
        .query("usageMeters")
        .withIndex("by_account_day", (q) =>
          q
            .eq("accountId", actor.accountId)
            .gte("day", fromDay)
            .lte("day", toDay),
        )
        .take(ROW_LIMIT + 1),
    ]);
    const computedAt = Date.now();
    const workTruncated = workRows.length > ROW_LIMIT;
    const workspaceTruncated = workspaceRows.length > ROW_LIMIT;
    const runTruncated = runRows.length > ROW_LIMIT;
    const meterTruncated = meterRows.length > ROW_LIMIT;
    const work = workRows.slice(0, ROW_LIMIT).filter(
      (item) => item.status !== "deleted" && item.blueprintKey !== "timetable",
    );
    const workspaces = workspaceRows
      .slice(0, ROW_LIMIT)
      .filter((item) => item.status === "active");
    const runs = runRows.slice(0, ROW_LIMIT);
    const meters = meterRows.slice(0, ROW_LIMIT);
    const byType = [...work.reduce((result, item) => {
      if (item.blueprintKey === "timetable") return result;
      result.set(item.blueprintKey, (result.get(item.blueprintKey) ?? 0) + 1);
      return result;
    }, new Map<string, number>())].map(([key, value]) => ({ key, value }));
    const runOutcomes = {
      completed: runs.filter((item) => item.status === "completed").length,
      active: runs.filter((item) =>
        ["queued", "running", "awaiting_confirmation", "awaiting_resolution"].includes(
          item.status,
        ),
      ).length,
      failed: runs.filter((item) => item.status === "failed").length,
      cancelled: runs.filter((item) => item.status === "cancelled").length,
    };
    const settledRuns = runOutcomes.completed + runOutcomes.failed + runOutcomes.cancelled;
    const meterTotal = (category: "model_input_tokens" | "model_output_tokens" | "collaboration_bytes") =>
      meters
        .filter((item) => item.category === category)
        .reduce((sum, item) => sum + item.quantity, 0);
    const meteringState = meters.length
      ? metricState(meterTruncated, computedAt)
      : ({
          kind: "partial" as const,
          details:
            "No account metering rows were recorded in this range, so collection-disabled is not presented as zero.",
        });

    return {
      range: { from: args.from, to: args.to, fromDay, toDay },
      computedAt,
      privacy:
        "This response contains only the signed-in account's metadata and aggregate usage meters. Prompt text, thread transcripts, memory claims, and work content are excluded from the response.",
      metrics: {
        workCreated: {
          value: workReady ? work.length : null,
          state: workReady ? metricState(workTruncated, computedAt) : preparingState,
        },
        activeWorkspaces: {
          value: workspaces.length,
          state: metricState(workspaceTruncated, computedAt),
        },
        aiRuns: {
          value: runsReady ? runs.length : null,
          state: runsReady ? metricState(runTruncated, computedAt) : preparingState,
        },
        completionRate: {
          value: runsReady ? (settledRuns ? Math.round((runOutcomes.completed / settledRuns) * 100) : 0) : null,
          state: runsReady ? metricState(
            runTruncated,
            computedAt,
            settledRuns
              ? "Completed runs divided by all settled runs in the selected range."
              : "Zero means no settled AI runs exist in the selected range.",
          ) : preparingState,
        },
        modelTokens: {
          value: meters.length
            ? meterTotal("model_input_tokens") + meterTotal("model_output_tokens")
            : null,
          state: meteringState,
        },
        collaborationBytes: {
          value: meters.length ? meterTotal("collaboration_bytes") : null,
          state: meteringState,
        },
      },
      byType: byType.sort((left, right) => right.value - left.value),
      runOutcomes,
      recentWork: work
        .slice()
        .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
        .slice(0, 8)
        .map((item) => ({
          id: item.artifactId,
          title: typeof item.projection?.title === "string" ? item.projection.title.slice(0, 240) : "Untitled work",
          blueprintKey: item.blueprintKey,
          status: item.status,
          createdAt: item.createdAt!,
        })),
      recentRuns: runs
        .slice()
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 8)
        .map((item) => ({
          id: item.runId,
          title: item.title,
          status: item.status,
          createdAt: item.createdAt,
        })),
    };
  },
});

/** Explicit, resumable rollout. Readers never scan canonical bodies or infer
 * that missing summaries mean a genuinely empty account. */
export const backfillReadModels = internalMutation({
  args: {
    source: v.union(v.literal("artifacts"), v.literal("runs")),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const definition = ANALYTICS_MIGRATIONS[args.source];
    const migration = await analyticsMigration(ctx, args.source);
    const currentVersion = migration?.version === definition.version;
    if (args.cursor === undefined && currentVersion && migration.state === "complete")
      return { processed: 0, cursor: null, done: true };
    // A supplied continuation must follow the stored progress. An arbitrary
    // tail cursor cannot establish completion without visiting earlier rows.
    if (args.cursor && (!currentVersion || migration.state !== "running" || migration.cursor !== args.cursor))
      throw new Error("ANALYTICS_BACKFILL_CURSOR_STALE: Resume without a cursor to use current progress.");
    const cursor = args.cursor === undefined
      ? (currentVersion ? migration.cursor ?? null : null)
      : args.cursor;
    const options = {
      cursor,
      numItems: Math.min(25, Math.max(1, Math.floor(args.limit ?? 25))),
      maximumBytesRead: 2_000_000,
    };
    const page = args.source === "artifacts"
      ? await ctx.db.query("spectraArtifacts").paginate(options)
      : await ctx.db.query("spectraAiRuns").paginate(options);
    for (const row of page.page) {
      if ("blueprintKey" in row) await upsertArtifactSummary(ctx, row);
      else await upsertAnalyticsRun(ctx, row);
    }
    const now = Date.now();
    const scanned = (cursor === null ? 0 : migration?.scanned ?? 0) + page.page.length;
    const value = {
      key: definition.key, version: definition.version,
      state: page.isDone ? "complete" as const : "running" as const,
      cursor: page.isDone ? undefined : page.continueCursor,
      scanned, repaired: scanned,
      createdAt: migration?.createdAt ?? now, updatedAt: now,
    };
    if (migration) await ctx.db.patch(migration._id, value);
    else await ctx.db.insert("spectraReadModelMigrations", value);
    return { processed: page.page.length, cursor: page.isDone ? null : page.continueCursor, done: page.isDone };
  },
});
