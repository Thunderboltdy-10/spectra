import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizePlanContent } from "../plan/model";

describe("Planner Reminder affordance", () => {
  it("preserves structured minutesBefore reminders across open/save normalize", () => {
    const structured = [
      { id: "rem-day", minutesBefore: 1440 },
      { id: "rem-hour", minutesBefore: 60 },
    ];
    const opened = normalizePlanContent({
      version: 4,
      description: "",
      sections: [],
      milestones: [],
      tasks: [
        {
          id: "task-1",
          title: "Submit essay",
          dueAt: Date.UTC(2026, 8, 10, 12, 0, 0),
          reminders: structured,
        },
      ],
      views: [],
    });
    expect(opened.tasks[0]?.reminders).toEqual(structured);

    // Simulate a studio save round-trip: emit normalized content, then reopen.
    const saved = normalizePlanContent(opened);
    expect(saved.tasks[0]?.reminders).toEqual(structured);
    expect(saved.tasks[0]?.reminders.every((row) => typeof row !== "string")).toBe(
      true,
    );
    expect(
      saved.tasks[0]?.reminders.every(
        (row) =>
          typeof row === "object" &&
          typeof row.id === "string" &&
          typeof row.minutesBefore === "number",
      ),
    ).toBe(true);
  });

  it("does not wipe object reminders to empty strings on normalize", () => {
    const plan = normalizePlanContent({
      version: 4,
      description: "",
      sections: [],
      milestones: [],
      tasks: [
        {
          id: "task-1",
          title: "Keep offsets",
          reminders: [
            { id: "keep-me", minutesBefore: 30, enabled: true },
            { id: "disabled", minutesBefore: 5, enabled: false },
            "not-a-real-offset",
            "1 day before",
          ],
        },
      ],
      views: [],
    });
    expect(plan.tasks[0]?.reminders).toEqual([
      { id: "keep-me", minutesBefore: 30 },
      { id: "reminder-4", minutesBefore: 1440 },
    ]);
  });

  it("migrates legacy planner string labels into minutesBefore", () => {
    const plan = normalizePlanContent({
      taskTitle: "Legacy task",
      reminders: ["2 hours before", "15 minutes before"],
      subtasks: [],
    });
    expect(plan.tasks[0]?.reminders).toEqual([
      { id: "reminder-1", minutesBefore: 120 },
      { id: "reminder-2", minutesBefore: 15 },
    ]);
  });

  it("exposes minutesBefore Reminder controls in PlanStudio and blueprint sheet", () => {
    const studio = readFileSync(
      resolve(__dirname, "../components/plan-studio.tsx"),
      "utf8",
    );
    expect(studio).toContain("Reminders");
    expect(studio).toContain('ariaLabel="Add reminder"');
    expect(studio).toContain("minutesBefore");
    expect(studio).toContain("REMINDER_MINUTE_OPTIONS");
    expect(studio).not.toContain("reminderDraft");

    const sheet = readFileSync(
      resolve(__dirname, "../components/artifact-blueprint-sheet.tsx"),
      "utf8",
    );
    expect(sheet).toContain("minutesBefore");
    expect(sheet).toContain("REMINDER_MINUTE_OPTIONS");
    expect(sheet).not.toContain("reminderDraft");
    // Must not strip structured rows back to free-text chips.
    expect(sheet).not.toContain(
      'task.reminders.filter((value): value is string => typeof value === "string")',
    );
  });
});
