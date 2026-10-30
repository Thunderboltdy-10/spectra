import { describe, expect, it } from "vitest";
import { calendarLocalTimeToEpoch, normalizeCalendarTimeInput } from "../../../../shared/calendar-time";
import { parseApplicationCommand } from "@/app/api/spectra/run/harness/application-commands";
import { calendarSemanticAction } from "../calendar/domain/command";

describe("Calendar wall-time intent", () => {
  it("allows a task card to be scheduled by work id, leaving root resolution to Calendar", () => {
    const { args } = parseApplicationCommand("schedule_calendar_task", { planArtifactId: "task-card", startLocal: "2026-10-31T10:00", endLocal: "2026-10-31T10:45", timezone: "Europe/Madrid" });
    expect(calendarSemanticAction("schedule_calendar_task", args)).toMatchObject({ type: "calendar.schedule_task", planArtifactId: "task-card" });
  });
  it.each([
    ["2026-09-21T13:00", "Europe/Madrid", "2026-09-21T11:00:00.000Z"],
    ["2026-01-21T13:00", "Europe/Madrid", "2026-01-21T12:00:00.000Z"],
    ["2026-09-21T13:00", "Asia/Kathmandu", "2026-09-21T07:15:00.000Z"],
    ["2026-09-21T13:00", "UTC", "2026-09-21T13:00:00.000Z"],
  ])("preserves %s in %s", (local, zone, expected) => {
    expect(new Date(calendarLocalTimeToEpoch(local, zone)).toISOString()).toBe(expected);
  });
  it("rejects a skipped hour and asks which repeated hour is intended", () => {
    expect(() => calendarLocalTimeToEpoch("2026-03-29T02:30", "Europe/Madrid")).toThrow("NONEXISTENT");
    expect(() => calendarLocalTimeToEpoch("2026-10-25T02:30", "Europe/Madrid")).toThrow("AMBIGUOUS");
    const first = calendarLocalTimeToEpoch("2026-10-25T02:30", "Europe/Madrid", "earlier");
    const second = calendarLocalTimeToEpoch("2026-10-25T02:30", "Europe/Madrid", "later");
    expect(second - first).toBe(3_600_000);
  });
  it("does not silently accept invalid dates/zones or conflicting epoch values", () => {
    expect(() => calendarLocalTimeToEpoch("2026-02-30T13:00", "Europe/Madrid")).toThrow("INVALID");
    expect(() => calendarLocalTimeToEpoch("2026-09-21T13:00", "Europe/Nowhere")).toThrow("TIMEZONE_INVALID");
    expect(() => normalizeCalendarTimeInput({ startLocal: "2026-09-21T13:00", timezone: "Europe/Madrid", startAt: Date.parse("2026-09-21T12:00Z") })).toThrow("TIME_MISMATCH");
  });
  it("normalizes application aliases and wall times through the command contract", () => {
    const args = { planArtifactId: "task", planTaskId: "task-1", startLocal: "2026-09-21T13:00", endLocal: "2026-09-21T14:00", timezone: "Europe/Madrid" };
    const canonical = parseApplicationCommand("schedule_calendar_task", args);
    expect(parseApplicationCommand("calendar.schedule", args)).toEqual(canonical);
    expect(canonical.args.startAt).toBe(Date.parse("2026-09-21T11:00Z"));
    expect(canonical.args.endAt).toBe(Date.parse("2026-09-21T12:00Z"));
    const backwards = parseApplicationCommand("schedule_calendar_task", { ...args, endLocal: "2026-09-21T12:00" });
    expect(() => calendarSemanticAction("schedule_calendar_task", backwards.args)).toThrow("RANGE_INVALID");
  });
});
