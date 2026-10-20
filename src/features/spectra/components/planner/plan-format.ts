import type { PlanStatus, PlanTask } from "../../plan/model";

/*
 * How a plan says its dates and statuses, shared by the list, the board, the
 * timeline and the task page so the same task reads the same way in each.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each status's ink, for the check, the board column and the timeline bar. */
export const STATUS_INK: Record<PlanStatus, string> = {
  backlog: "var(--text-tertiary)",
  todo: "var(--text-secondary)",
  doing: "var(--ink-blue)",
  blocked: "var(--warning)",
  done: "var(--success)",
};

export function shortDate(value: number) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The date as a person scans for it: "Today", "Friday", "2 days late", "12 Oct". */
export function dueLabel(task: PlanTask, now: number) {
  if (task.dueAt === undefined) return "";
  const days = Math.round((task.dueAt - now) / DAY_MS);
  if (task.status === "done") return shortDate(task.dueAt);
  if (days === -1) return "A day late";
  if (days < 0) return `${Math.abs(days)} days late`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 6) return new Date(task.dueAt).toLocaleDateString(undefined, { weekday: "long" });
  return shortDate(task.dueAt);
}

export function isOverdue(task: PlanTask, now: number) {
  return task.dueAt !== undefined && task.dueAt < now && task.status !== "done";
}

/** A date input's value for an instant, in the reader's own zone. */
export function dateInput(value: number | undefined) {
  if (value === undefined) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
