import { describe, expect, it } from "vitest";
import { normalizePlanContent, type PlanTask } from "../plan/model";
import { dueLabel, isOverdue } from "../components/planner/plan-format";
import { planTaskOptionsSummary } from "../components/planner/plan-task-options";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 14, 9);

function task(patch: Partial<PlanTask> = {}): PlanTask {
  return {
    id: "t1",
    title: "Essay draft",
    description: "",
    dependencyIds: [],
    status: "todo",
    assigneeIds: [],
    referenceIds: [],
    sourceRefs: [],
    calendarBlockIds: [],
    reminders: [],
    checklist: [],
    order: 0,
    ...patch,
  };
}

describe("a plan's dates, as a row reads them", () => {
  it("says how near a date is, and a finished task's plain date", () => {
    expect(dueLabel(task(), NOW)).toBe("");
    expect(dueLabel(task({ dueAt: NOW + 3 * 60 * 1000 }), NOW)).toBe("Today");
    expect(dueLabel(task({ dueAt: NOW + DAY }), NOW)).toBe("Tomorrow");
    expect(dueLabel(task({ dueAt: NOW + 4 * DAY }), NOW)).toBe(new Date(NOW + 4 * DAY).toLocaleDateString(undefined, { weekday: "long" }));
    expect(dueLabel(task({ dueAt: NOW - 2 * DAY }), NOW)).toBe("2 days late");
    expect(dueLabel(task({ dueAt: NOW - 2 * DAY, status: "done" }), NOW)).not.toContain("late");
  });

  it("is overdue only while unfinished", () => {
    expect(isOverdue(task({ dueAt: NOW - DAY }), NOW)).toBe(true);
    expect(isOverdue(task({ dueAt: NOW - DAY, status: "done" }), NOW)).toBe(false);
    expect(isOverdue(task(), NOW)).toBe(false);
  });
});

describe("a plan task's More options line", () => {
  const plan = normalizePlanContent({
    sections: [{ id: "s1", title: "Week one", order: 0 }],
    tasks: [task(), task({ id: "t2", title: "Sources" })],
  });
  const timing = { allDay: false, dueTime: "09:00", reminderTime: "09:00" };

  it("offers what can be set when nothing is", () => {
    expect(planTaskOptionsSummary(task(), plan, timing)).toBe("Section, waiting on, time, reminders");
  });

  it("names what is set", () => {
    const summary = planTaskOptionsSummary(
      task({ sectionId: "s1", dependencyIds: ["t2"], estimateMinutes: 45, reminders: [{ id: "r1", minutesBefore: 1440 }], dueAt: NOW }),
      plan,
      timing,
    );
    expect(summary).toMatch(/^In Week one, waiting on 1 task, takes 45 min, reminder /);
  });
});
