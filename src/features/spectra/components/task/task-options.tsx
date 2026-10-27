/*
 * A task's settings beyond its day (EDITORS.md, "Planner task"): repeating,
 * priority, how long it takes, reminders. Shown as the task's properties
 * (task-properties.tsx).
 */

export type TaskReminder = { id: string; minutesBefore: number; enabled: boolean };
export type TaskRecurrence = { frequency: "none" | "daily" | "weekly" | "monthly" | "yearly"; interval: number; weekdays: number[]; exceptions: number[]; untilAt?: number };
export type TaskOptionsValue = {
  priority?: "low" | "medium" | "high";
  estimateMinutes?: number | null;
  reminders: TaskReminder[];
  recurrence?: TaskRecurrence;
};

export const REPEATS = [
  { value: "none", label: "Does not repeat", frequency: "none", interval: 1 },
  { value: "daily", label: "Every day", frequency: "daily", interval: 1 },
  { value: "weekly", label: "Every week", frequency: "weekly", interval: 1 },
  { value: "fortnightly", label: "Every two weeks", frequency: "weekly", interval: 2 },
  { value: "monthly", label: "Every month", frequency: "monthly", interval: 1 },
  { value: "yearly", label: "Every year", frequency: "yearly", interval: 1 },
] as const;

export function repeatOf(recurrence?: TaskRecurrence) {
  if (!recurrence || recurrence.frequency === "none") return REPEATS[0];
  return REPEATS.find((repeat) => repeat.frequency === recurrence.frequency && repeat.interval === recurrence.interval) ?? REPEATS[0];
}
