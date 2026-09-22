import { describe, expect, it } from "vitest";
import { calendarLocalTimeToEpoch, normalizeCalendarTimeInput } from "../../../../shared/calendar-time";
import { prepareApplicationCommand } from "../operations/application-command";

describe("Calendar wall-time intent", () => {
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
  it("normalizes both application aliases and model tools through the registered schema", () => {
    const args = { planArtifactId: "task", planTaskId: "task-1", startLocal: "2026-09-21T13:00", endLocal: "2026-09-21T14:00", timezone: "Europe/Madrid" };
    const canonical = prepareApplicationCommand("schedule_calendar_task", args);
    expect(prepareApplicationCommand("calendar.schedule", args)).toEqual(canonical);
    expect(canonical.input.args.startAt).toBe(Date.parse("2026-09-21T11:00Z"));
    expect(canonical.input.args.endAt).toBe(Date.parse("2026-09-21T12:00Z"));
    expect(() => prepareApplicationCommand("schedule_calendar_task", { ...args, endLocal: "2026-09-21T12:00" })).toThrow("RANGE_INVALID");
  });
});
