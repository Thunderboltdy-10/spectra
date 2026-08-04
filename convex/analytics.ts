import { query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedActor } from "./identityShared";

const DAY = 24 * 60 * 60_000;
const ROW_LIMIT = 2_000;

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
    const [workRows, workspaceRows, runRows, meterRows] = await Promise.all([
      ctx.db
        .query("spectraArtifacts")
        .withIndex("by_account_created", (q) =>
          q
            .eq("ownerAccountId", actor.accountId)
            .gte("createdAt", args.from)
            .lte("createdAt", args.to),
        )
        .take(ROW_LIMIT + 1),
      ctx.db
        .query("spectraWorkspaces")
        .withIndex("by_account_activity", (q) =>
          q
            .eq("ownerAccountId", actor.accountId)
            .gte("lastActivityAt", args.from)
            .lte("lastActivityAt", args.to),
        )
        .take(ROW_LIMIT + 1),
      ctx.db
        .query("spectraAiRuns")
        .withIndex("by_account_created", (q) =>
          q
            .eq("ownerAccountId", actor.accountId)
            .gte("createdAt", args.from)
            .lte("createdAt", args.to),
        )
        .take(ROW_LIMIT + 1),
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
    const work = workRows.slice(0, ROW_LIMIT).filter((item) => item.status !== "deleted");
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
        "Only the signed-in account's metadata and aggregate usage meters are queried. Prompt text, thread transcripts, memory claims, and work content are excluded.",
      metrics: {
        workCreated: {
          value: work.length,
          state: metricState(workTruncated, computedAt),
        },
        activeWorkspaces: {
          value: workspaces.length,
          state: metricState(workspaceTruncated, computedAt),
        },
        aiRuns: {
          value: runs.length,
          state: metricState(runTruncated, computedAt),
        },
        completionRate: {
          value: settledRuns ? Math.round((runOutcomes.completed / settledRuns) * 100) : 0,
          state: metricState(
            runTruncated,
            computedAt,
            settledRuns
              ? "Completed runs divided by all settled runs in the selected range."
              : "Zero means no settled AI runs exist in the selected range.",
          ),
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
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 8)
        .map((item) => ({
          id: item._id,
          title: item.title,
          blueprintKey: item.blueprintKey,
          status: item.status,
          createdAt: item.createdAt,
        })),
      recentRuns: runs
        .slice()
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 8)
        .map((item) => ({
          id: item._id,
          title: item.suggestedThreadTitle ?? item.finalSummary ?? "AI run",
          status: item.status,
          createdAt: item.createdAt,
        })),
    };
  },
});
