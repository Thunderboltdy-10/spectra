import type { CalendarItem, CalendarLayerKey } from "./model";

export function formatTime(value: number, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(value);
}

export function formatDay(value: number, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(value);
}

export function layerFor(item: CalendarItem): CalendarLayerKey {
  if (item.kind === "official_event") return "classes";
  if (item.kind === "official_deadline") return "deadlines";
  if (item.kind === "scheduled_work_block") return "work";
  if (item.kind === "personal_event") return "personal";
  return "tasks";
}

/** The owner's own work blocks and personal events move and resize; official
    and imported source events do not (the server enforces the same rule). */
export function isReschedulable(item: CalendarItem) {
  return (
    item.kind === "scheduled_work_block" ||
    (item.kind === "personal_event" && !item.sourceLocked)
  );
}

/** Due at a moment rather than taking time: a ManageBac deadline, a task's due time. */
export function isDeadline(item: CalendarItem) {
  return item.kind === "official_deadline" || (item.endAt !== undefined && item.endAt === item.startAt);
}
