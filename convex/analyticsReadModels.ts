import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ARTIFACT_SUMMARY_READ_MODEL_VERSION } from "./orgTreeShared";

export const ANALYTICS_RUN_READ_MODEL_VERSION = 1;
export const ANALYTICS_MIGRATIONS = {
  artifacts: { key: "analytics-artifact-summaries", version: ARTIFACT_SUMMARY_READ_MODEL_VERSION },
  runs: { key: "analytics-run-summaries", version: ANALYTICS_RUN_READ_MODEL_VERSION },
} as const;

export function projectAnalyticsRun(run: Doc<"spectraAiRuns">) {
  return {
    readModelVersion: ANALYTICS_RUN_READ_MODEL_VERSION,
    runId: run._id,
    ownerAccountId: run.ownerAccountId,
    status: run.status,
    createdAt: run.createdAt,
    title: (run.suggestedThreadTitle ?? run.finalSummary ?? "AI run").slice(0, 240),
  };
}

type WriteCtx = Pick<MutationCtx, "db">;

export async function upsertAnalyticsRun(ctx: WriteCtx, run: Doc<"spectraAiRuns">) {
  const value = projectAnalyticsRun(run);
  const existing = await ctx.db.query("spectraAnalyticsRunSummaries")
    .withIndex("by_run", q => q.eq("runId", run._id)).unique();
  if (!existing) await ctx.db.insert("spectraAnalyticsRunSummaries", value);
  else if (Object.entries(value).some(([key, entry]) => Reflect.get(existing, key) !== entry))
    await ctx.db.patch(existing._id, value);
}

export async function syncAnalyticsRun(
  ctx: WriteCtx,
  runId: Id<"spectraAiRuns">,
  previous: Doc<"spectraAiRuns"> | null,
  next: Doc<"spectraAiRuns"> | null,
) {
  // Leases, heartbeat timestamps, plans and prompts do not affect analytics.
  // Compare the already-present trigger documents before any summary I/O.
  if (previous && next && JSON.stringify(projectAnalyticsRun(previous)) === JSON.stringify(projectAnalyticsRun(next))) return;
  if (next) await upsertAnalyticsRun(ctx, next);
  else {
    const existing = await ctx.db.query("spectraAnalyticsRunSummaries")
      .withIndex("by_run", q => q.eq("runId", runId)).unique();
    if (existing) await ctx.db.delete(existing._id);
  }
}

export async function analyticsMigration(ctx: Pick<QueryCtx, "db">, source: keyof typeof ANALYTICS_MIGRATIONS) {
  return ctx.db.query("spectraReadModelMigrations")
    .withIndex("by_key", q => q.eq("key", ANALYTICS_MIGRATIONS[source].key)).unique();
}
