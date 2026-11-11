import { describe, expect, it } from "vitest";
import { parseApplicationCommand } from "@/app/api/spectra/run/harness/application-commands";
import { refusePastCalendarStart } from "../calendar/domain/command";

// Tuesday 10 November 2026, 19:21 in Madrid.
const now = Date.parse("2026-11-10T18:21:00Z");
const madrid = "Europe/Madrid";

function args(command: string, input: Record<string, unknown>) {
  return parseApplicationCommand(command, { timezone: madrid, ...input }).args;
}

describe("a calendar time that has already passed", () => {
  it("is refused with the time now, so the model can pick another", () => {
    const event = args("create_calendar_personal_event", { title: "Revise", startLocal: "2026-11-10T17:00", endLocal: "2026-11-10T18:00" });
    expect(() => refusePastCalendarStart("create_calendar_personal_event", event, now)).toThrow(
      "That time has already passed. It is 19:21 on Tuesday.",
    );
    const block = args("schedule_calendar_task", { planArtifactId: "t", startLocal: "2026-11-10T09:00", endLocal: "2026-11-10T10:00" });
    expect(() => refusePastCalendarStart("schedule_calendar_task", block, now)).toThrow("already passed");
    const moved = args("move_calendar_block", { itemId: "b", startLocal: "2026-11-09T09:00", expectedRevision: 1 });
    expect(() => refusePastCalendarStart("move_calendar_block", moved, now)).toThrow("already passed");
  });

  it("is allowed when the request logs something that already happened", () => {
    const logged = args("create_calendar_personal_event", { title: "Ran 5 km", startLocal: "2026-11-10T07:00", endLocal: "2026-11-10T07:30", alreadyHappened: true });
    expect(() => refusePastCalendarStart("create_calendar_personal_event", logged, now)).not.toThrow();
  });

  it("allows the future, a start a moment ago and an all-day event today", () => {
    const later = args("create_calendar_personal_event", { title: "Call", startLocal: "2026-11-10T20:00", endLocal: "2026-11-10T20:30" });
    expect(() => refusePastCalendarStart("create_calendar_personal_event", later, now)).not.toThrow();
    const justNow = args("schedule_calendar_task", { planArtifactId: "t", startLocal: "2026-11-10T19:20", endLocal: "2026-11-10T20:00" });
    expect(() => refusePastCalendarStart("schedule_calendar_task", justNow, now)).not.toThrow();
    const today = args("create_calendar_personal_event", { title: "Exam week", allDay: true, startLocal: "2026-11-10T00:00", endLocal: "2026-11-11T00:00" });
    expect(() => refusePastCalendarStart("create_calendar_personal_event", today, now)).not.toThrow();
  });

  it("allows a repeating series that began earlier this week", () => {
    const timetable = args("create_calendar_personal_event", { title: "Maths", startLocal: "2026-11-09T09:00", endLocal: "2026-11-09T10:00", alsoAtLocal: [{ startLocal: "2026-11-16T09:00", endLocal: "2026-11-16T10:00" }] });
    expect(() => refusePastCalendarStart("create_calendar_personal_event", timetable, now)).not.toThrow();
  });

  it("does not check a resize, which keeps its start", () => {
    const resized = args("resize_calendar_block", { itemId: "b", endLocal: "2026-11-10T20:00", expectedRevision: 1 });
    expect(() => refusePastCalendarStart("resize_calendar_block", resized, now)).not.toThrow();
  });
});
