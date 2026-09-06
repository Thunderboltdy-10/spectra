import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizePlanContent } from "../plan/model";

describe("Planner Reminder affordance", () => {
  it("normalizes reminders on plan tasks", () => {
    const plan = normalizePlanContent({
      version: 4,
      description: "",
      sections: [],
      milestones: [],
      tasks: [
        {
          id: "task-1",
          title: "Submit essay",
          reminders: ["1 day before", "morning of"],
        },
      ],
      views: [],
    });
    expect(plan.tasks[0]?.reminders).toEqual(["1 day before", "morning of"]);
  });

  it("migrates legacy planner reminders into the plan task", () => {
    const plan = normalizePlanContent({
      taskTitle: "Legacy task",
      reminders: ["2 hours before"],
      subtasks: [],
    });
    expect(plan.tasks[0]?.reminders).toEqual(["2 hours before"]);
  });

  it("exposes Reminder controls in PlanStudio", () => {
    const studio = readFileSync(
      resolve(__dirname, "../components/plan-studio.tsx"),
      "utf8",
    );
    expect(studio).toContain("Reminders");
    expect(studio).toContain('aria-label="Add reminder"');
    expect(studio).toContain("reminderDraft");
  });
});
