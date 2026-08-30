import type { CalendarItem } from "../calendar/domain/model";
import {
  type PlanContent,
  type PlanFilter,
  type PlanRecurrence,
  type PlanTask,
  type PlanViewKind,
  validatePlanDependencies,
} from "./model";

export const PLAN_DUE_REFUSAL =
  "Spectra could not read that date without guessing. Use today, tomorrow, next Friday, or a date such as 2026-09-04.";

export type PlanDueResult =
  | {
      ok: true;
      dueAt: number;
      precision: "date" | "time";
      label: string;
    }
  | { ok: false; reason: string };

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function zonedParts(value: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    hour: number("hour"),
    minute: number("minute"),
    second: number("second"),
  };
}

function zonedTimestamp(
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
  },
  timezone: string,
) {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
  );
  let candidate = desired;
  for (let pass = 0; pass < 3; pass += 1) {
    const actual = zonedParts(candidate, timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const next = candidate + (desired - represented);
    if (next === candidate) break;
    candidate = next;
  }
  const roundTrip = zonedParts(candidate, timezone);
  if (
    roundTrip.year !== parts.year ||
    roundTrip.month !== parts.month ||
    roundTrip.day !== parts.day ||
    roundTrip.hour !== (parts.hour ?? 0) ||
    roundTrip.minute !== (parts.minute ?? 0)
  )
    return undefined;
  return candidate;
}

function parseTime(value: string | undefined) {
  if (!value?.trim())
    return { ok: true as const, hour: 0, minute: 0, precision: "date" as const };
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return { ok: false as const };
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3];
  if (minute > 59 || hour > (meridiem ? 12 : 23) || hour < 0 || (meridiem && hour < 1))
    return { ok: false as const };
  if (meridiem === "am") hour = hour === 12 ? 0 : hour;
  if (meridiem === "pm") hour = hour === 12 ? 12 : hour + 12;
  return { ok: true as const, hour, minute, precision: "time" as const };
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function dateLabel(value: number, timezone: string, precision: "date" | "time") {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(precision === "time" ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(value);
}

/**
 * Bounded natural due grammar. It accepts a useful, deterministic subset and
 * returns a refusal instead of allowing Date.parse to guess locale or timezone.
 */
export function parsePlanDue(
  source: string,
  options: { now: number; timezone: string },
): PlanDueResult {
  const input = source.trim().toLowerCase().replaceAll(/\s+/g, " ");
  if (!input) return { ok: false, reason: PLAN_DUE_REFUSAL };
  let date: { year: number; month: number; day: number } | undefined;
  let timeSource: string | undefined;
  const today = zonedParts(options.now, options.timezone);

  const relative = input.match(/^(today|tomorrow)(?:\s+(.*))?$/);
  if (relative) {
    const shift = relative[1] === "tomorrow" ? 1 : 0;
    const shifted = new Date(Date.UTC(today.year, today.month - 1, today.day + shift));
    date = {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    };
    timeSource = relative[2];
  }

  const weekday = input.match(
    /^(?:next\s+)(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)(?:\s+(.*))?$/,
  );
  if (!date && weekday) {
    const target = WEEKDAYS[weekday[1]!]!;
    const current = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    const shifted = new Date(Date.UTC(today.year, today.month - 1, today.day + delta));
    date = {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    };
    timeSource = weekday[2];
  }

  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(.*))?$/);
  if (!date && iso) {
    date = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    timeSource = iso[4];
  }

  const local = input.match(
    /^(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})(?:\s+(.*))?$/,
  );
  if (!date && local) {
    const months = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    date = {
      year: Number(local[3]),
      month: months.findIndex((month) => local[2]!.startsWith(month)) + 1,
      day: Number(local[1]),
    };
    timeSource = local[4];
  }

  if (!date || !validDate(date.year, date.month, date.day))
    return { ok: false, reason: PLAN_DUE_REFUSAL };
  const time = parseTime(timeSource);
  if (!time.ok) return { ok: false, reason: PLAN_DUE_REFUSAL };
  const dueAt = zonedTimestamp(
    { ...date, hour: time.hour, minute: time.minute },
    options.timezone,
  );
  if (dueAt === undefined) return { ok: false, reason: PLAN_DUE_REFUSAL };
  return {
    ok: true,
    dueAt,
    precision: time.precision,
    label: dateLabel(dueAt, options.timezone, time.precision),
  };
}

function addCalendar(
  value: number,
  timezone: string,
  mutate: (date: Date) => void,
) {
  const parts = zonedParts(value, timezone);
  const local = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  );
  mutate(local);
  return zonedTimestamp(
    {
      year: local.getUTCFullYear(),
      month: local.getUTCMonth() + 1,
      day: local.getUTCDate(),
      hour: local.getUTCHours(),
      minute: local.getUTCMinutes(),
    },
    timezone,
  );
}

function advanceOnce(value: number, recurrence: PlanRecurrence, timezone: string) {
  if (recurrence.frequency === "daily")
    return addCalendar(value, timezone, (date) =>
      date.setUTCDate(date.getUTCDate() + recurrence.interval),
    );
  if (recurrence.frequency === "weekly") {
    const weekdays = [...new Set(recurrence.weekdays)].sort((a, b) => a - b);
    if (weekdays.length) {
      const current = zonedParts(value, timezone);
      const currentDay = new Date(
        Date.UTC(current.year, current.month - 1, current.day),
      ).getUTCDay();
      const next = weekdays.find((day) => day > currentDay);
      const delta =
        next === undefined
          ? recurrence.interval * 7 - currentDay + weekdays[0]!
          : next - currentDay;
      return addCalendar(value, timezone, (date) =>
        date.setUTCDate(date.getUTCDate() + delta),
      );
    }
    return addCalendar(value, timezone, (date) =>
      date.setUTCDate(date.getUTCDate() + recurrence.interval * 7),
    );
  }
  if (recurrence.frequency === "monthly")
    return addCalendar(value, timezone, (date) => {
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + recurrence.interval);
      const finalDay = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
      ).getUTCDate();
      date.setUTCDate(Math.min(day, finalDay));
    });
  if (recurrence.frequency === "yearly")
    return addCalendar(value, timezone, (date) => {
      const month = date.getUTCMonth();
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCFullYear(date.getUTCFullYear() + recurrence.interval);
      date.setUTCMonth(month);
      const finalDay = new Date(
        Date.UTC(date.getUTCFullYear(), month + 1, 0),
      ).getUTCDate();
      date.setUTCDate(Math.min(day, finalDay));
    });
  return undefined;
}

export function nextPlanOccurrence(
  currentDueAt: number,
  recurrence: PlanRecurrence,
  timezone: string,
) {
  if (recurrence.frequency === "none") return undefined;
  let candidate = advanceOnce(currentDueAt, recurrence, timezone);
  const localDay = (value: number) => {
    const parts = zonedParts(value, timezone);
    return parts.year * 10_000 + parts.month * 100 + parts.day;
  };
  const exceptionDates = new Set(
    recurrence.exceptions.map((value) => localDay(value)),
  );
  let attempts = 0;
  while (
    candidate !== undefined &&
    exceptionDates.has(localDay(candidate)) &&
    attempts < 500
  ) {
    candidate = advanceOnce(candidate, recurrence, timezone);
    attempts += 1;
  }
  const afterUntil =
    candidate !== undefined &&
    recurrence.untilAt !== undefined &&
    localDay(candidate) > localDay(recurrence.untilAt);
  if (
    candidate === undefined ||
    attempts >= 500 ||
    afterUntil
  )
    return undefined;
  return candidate;
}

export type PlanCompletionResult =
  | { ok: true; plan: PlanContent; advanced: boolean }
  | { ok: false; reason: string };

/** Complete once, or advance a recurring task without minting a duplicate. */
export function completePlanTask(
  plan: PlanContent,
  taskId: string,
  completedAt: number,
): PlanCompletionResult {
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return { ok: false, reason: "That task is no longer in this plan." };
  const unfinishedDependencies = task.dependencyIds.filter(
    (dependencyId) =>
      plan.tasks.find((candidate) => candidate.id === dependencyId)?.status !==
      "done",
  );
  if (unfinishedDependencies.length)
    return {
      ok: false,
      reason: `Finish ${unfinishedDependencies.length} task${unfinishedDependencies.length === 1 ? "" : "s"} this depends on first.`,
    };
  if (task.officialDeadlineRef && task.recurrence.frequency !== "none")
    return {
      ok: false,
      reason: "Official deadlines cannot repeat as personal tasks in Plan.",
    };
  if (task.recurrence.frequency === "none")
    return {
      ok: true,
      advanced: false,
      plan: {
        ...plan,
        tasks: plan.tasks.map((candidate) =>
          candidate.id === taskId ? { ...candidate, status: "done" } : candidate,
        ),
      },
    };
  const currentDueAt = task.dueAt ?? completedAt;
  const next = nextPlanOccurrence(currentDueAt, task.recurrence, plan.timezone);
  const occurrence = {
    completedAt,
    ...(task.dueAt !== undefined ? { scheduledDueAt: task.dueAt } : {}),
  };
  if (next === undefined)
    return {
      ok: true,
      advanced: false,
      plan: {
        ...plan,
        tasks: plan.tasks.map((candidate) =>
          candidate.id === taskId
            ? {
                ...candidate,
                status: "done",
                completedOccurrences: [
                  ...candidate.completedOccurrences,
                  occurrence,
                ].slice(-500),
              }
            : candidate,
        ),
      },
    };
  return {
    ok: true,
    advanced: true,
    plan: {
      ...plan,
      tasks: plan.tasks.map((candidate) =>
        candidate.id === taskId
          ? {
              ...candidate,
              status: "todo",
              dueAt: next,
              completedOccurrences: [
                ...candidate.completedOccurrences,
                occurrence,
              ].slice(-500),
              checklist: candidate.checklist.map((item) => ({
                ...item,
                done: false,
              })),
            }
          : candidate,
      ),
    },
  };
}

export function normalizePlanLabels(labels: readonly string[]) {
  return [
    ...new Set(labels.map((label) => label.trim()).filter(Boolean)),
  ].slice(0, 100);
}

export function savePlanView(
  plan: PlanContent,
  input: {
    id: string;
    title: string;
    kind: PlanViewKind;
    filters?: PlanFilter;
  },
) {
  const saved = {
    id: input.id,
    title: input.title.trim(),
    kind: input.kind,
    ...(input.filters ? { filters: input.filters } : {}),
  };
  return {
    ...plan,
    views: [
      ...plan.views.filter((view) => view.id !== input.id),
      saved,
    ],
  };
}

export function renamePlanView(plan: PlanContent, id: string, title: string) {
  return {
    ...plan,
    views: plan.views.map((view) =>
      view.id === id ? { ...view, title: title.trim() } : view,
    ),
  };
}

export function deletePlanView(plan: PlanContent, id: string) {
  const view = plan.views.find((candidate) => candidate.id === id);
  if (view?.system)
    return {
      ok: false as const,
      reason: "Default List, Board, Timeline, and Workload views stay available.",
    };
  return {
    ok: true as const,
    plan: { ...plan, views: plan.views.filter((candidate) => candidate.id !== id) },
  };
}

export function setPlanParent(
  plan: PlanContent,
  taskId: string,
  parentTaskId: string | undefined,
) {
  const next: PlanContent = {
    ...plan,
    tasks: plan.tasks.map((task) =>
      task.id === taskId ? { ...task, parentTaskId } : task,
    ),
  };
  validatePlanDependencies(next);
  return next;
}

export type PlanWorkloadRow = {
  task: PlanTask;
  scheduledMinutes: number;
  estimateMinutes?: number;
  remainingMinutes?: number;
  blockCount: number;
};

/**
 * Read-only workload projection. The only scheduling input is calendarItems;
 * legacy task.calendarBlockIds are deliberately ignored.
 */
export function derivePlanWorkload(
  plan: PlanContent,
  calendarItems: readonly CalendarItem[],
  options?: { artifactId?: string },
): readonly PlanWorkloadRow[] {
  const minutes = new Map<string, { scheduledMinutes: number; blockCount: number }>();
  for (const item of calendarItems) {
    if (
      item.kind !== "scheduled_work_block" ||
      item.status !== "active" ||
      !item.planTaskId ||
      item.startAt === undefined ||
      item.endAt === undefined ||
      item.endAt <= item.startAt ||
      (options?.artifactId && item.planArtifactId !== options.artifactId)
    )
      continue;
    const current = minutes.get(item.planTaskId) ?? {
      scheduledMinutes: 0,
      blockCount: 0,
    };
    current.scheduledMinutes += Math.round((item.endAt - item.startAt) / 60_000);
    current.blockCount += 1;
    minutes.set(item.planTaskId, current);
  }
  return plan.tasks
    .filter((task) => task.status !== "done")
    .map((task) => {
      const scheduled = minutes.get(task.id) ?? {
        scheduledMinutes: 0,
        blockCount: 0,
      };
      return {
        task,
        ...scheduled,
        ...(task.estimateMinutes !== undefined
          ? {
              estimateMinutes: task.estimateMinutes,
              remainingMinutes: Math.max(
                0,
                task.estimateMinutes - scheduled.scheduledMinutes,
              ),
            }
          : {}),
      };
    })
    .sort(
      (left, right) =>
        (right.remainingMinutes ?? 0) - (left.remainingMinutes ?? 0) ||
        left.task.order - right.task.order,
    );
}

export const PLAN_REMINDER_DELIVERY_PENDING =
  "Reminder timing is saved. Delivery will turn on when the schedule-at-write reminder service lands.";
