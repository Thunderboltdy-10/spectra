import { describe, expect, it } from "vitest";
import { addDays, monthWeeks, parseTimeOfDay } from "../when";

describe("times as people type them", () => {
  it.each([
    ["9", "09:00"],
    ["930", "09:30"],
    ["0930", "09:30"],
    ["9:30", "09:30"],
    ["9.30", "09:30"],
    ["9h30", "09:30"],
    ["9pm", "21:00"],
    ["12:15 am", "00:15"],
    ["12 pm", "12:00"],
    ["2:30 PM", "14:30"],
    ["23:45", "23:45"],
  ])("reads %s as %s", (text, time) => expect(parseTimeOfDay(text)).toBe(time));

  it.each(["", "25", "9:75", "13pm", "noon"])("does not read %s", (text) => expect(parseTimeOfDay(text)).toBeNull());
});

describe("a month laid out in weeks", () => {
  it("starts on the Monday on or before the first and covers the month", () => {
    const weeks = monthWeeks("2026-10-21");
    expect(weeks[0]![0]).toBe("2026-09-28");
    expect(weeks.at(-1)!.at(-1)).toBe("2026-11-01");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("crosses the clock change as whole days", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
});
