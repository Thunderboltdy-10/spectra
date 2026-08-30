import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function exportedBlock(contents: string, name: string, nextName?: string) {
  const start = contents.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`Missing export ${name}`);
  const end = nextName
    ? contents.indexOf(`export const ${nextName}`, start)
    : contents.length;
  return contents.slice(start, end < 0 ? contents.length : end);
}

describe("P9.I2 Convex efficiency contracts", () => {
  it("serves run tabs from denormalized projections instead of full run/thread documents", () => {
    const runs = source("./spectraRuns.ts");
    const listTabs = exportedBlock(
      runs,
      "listTabs",
      "backfillRunTabProjections",
    );

    expect(listTabs).toContain("runSummary");
    expect(listTabs).toContain("threadTitle");
    expect(listTabs).not.toContain("ctx.db.get(tab.runId)");
    expect(listTabs).not.toContain("ctx.db.get(tab.threadId)");
  });

  it("reconciles stale run effects through run-owned targets only", () => {
    const runs = source("./spectraRuns.ts");
    const reconcile = exportedBlock(
      runs,
      "reconcileStaleRuns",
      "hideTab",
    );

    expect(reconcile).toContain('withIndex("by_ai_run"');
    expect(reconcile).toContain("operationTargetIds");
    expect(reconcile).not.toContain('withIndex("by_account_status"');
    expect(reconcile).not.toContain('withIndex("by_account_activity"');
  });

  it("keeps only indexed hourly reminder safety sweeps", () => {
    const crons = source("./crons.ts");
    const planner = source("./plannerReminders.ts");
    const timetable = source("./timetableReminders.ts");

    expect(crons).not.toContain("schedule-planner-reminders");
    expect(crons).not.toContain("schedule-timetable-reminders");
    expect(crons).toContain("safety-sweep-planner-reminders");
    expect(crons).toContain("safety-sweep-timetable-reminders");
    expect(crons.match(/\{ hours: 1 \}/g)).toHaveLength(2);

    for (const reminderSource of [planner, timetable]) {
      expect(reminderSource).toContain("reconcileArtifact");
      expect(reminderSource).toContain("safetySweep");
      expect(reminderSource).toContain("nextReminderAt");
      expect(reminderSource).toContain("scheduledFunctionId");
    }
    expect(planner).not.toContain('withIndex("by_blueprint_status_updated"');
    expect(timetable).not.toContain('withIndex("by_kind_updated"');
    expect(timetable).not.toContain(".take(5_000)");
  });
});
