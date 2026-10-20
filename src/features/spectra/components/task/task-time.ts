/*
 * A task's day and time, read and written in the task's own timezone, so a
 * deadline set in Madrid is still that evening when the student is away.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function validZone(zone: unknown) {
  if (typeof zone !== "string" || !zone) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    return zone;
  } catch {
    return undefined;
  }
}

/**
 * The zone a task's day and time are read in. The server writes "UTC" for a
 * task that came without a zone, so a timed one is shown at the student's own
 * clock, the way the calendar shows it. A date alone stays a UTC date: read
 * anywhere west of it, its midnight would fall on the day before.
 */
export function taskZone(zone: unknown, allDay: boolean) {
  const named = validZone(zone);
  const unknown = !named || /^(etc\/)?utc$/i.test(named);
  return unknown && !allDay ? Intl.DateTimeFormat().resolvedOptions().timeZone : (named ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function zoneOffset(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - instant;
}

/** A day, and a time on it or the end of the day, in the task's zone. */
export function taskInstant(date: string, time: string | null, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time ? time.split(":").map(Number) : [23, 59];
  const guess = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  return guess - zoneOffset(guess - zoneOffset(guess, timeZone), timeZone);
}

/** The day and time of an instant in the task's zone, as the inputs read them. */
export function taskInputs(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function dayNumber(instant: number, timeZone: string) {
  const { date } = taskInputs(instant, timeZone);
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
}

/** "Today", "Tomorrow", "In 3 days", "2 days late": how near the due day is. */
export function dueDistance(dueAt: number, now: number, timeZone: string) {
  const days = dayNumber(dueAt, timeZone) - dayNumber(now, timeZone);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days late`;
}

/** "Thursday 15 October", and ", 14:10" when the task has a time. */
export function dueSentence(dueAt: number, allDay: boolean, timeZone: string) {
  const day = new Intl.DateTimeFormat(undefined, { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(dueAt));
  if (allDay) return day;
  const time = new Intl.DateTimeFormat(undefined, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(dueAt));
  return `${day}, ${time}`;
}

/** The month and day for a date block: "Oct" over "15". */
export function dateBlock(instant: number, timeZone: string) {
  const date = new Date(instant);
  return {
    month: new Intl.DateTimeFormat(undefined, { timeZone, month: "short" }).format(date),
    day: new Intl.DateTimeFormat(undefined, { timeZone, day: "numeric" }).format(date),
  };
}

/** The days a student most often means, as the dates the inputs take. */
export function quickDays(now: number, timeZone: string) {
  const today = taskInputs(now, timeZone).date;
  const at = (days: number) => taskInputs(taskInstant(today, "12:00", timeZone) + days * DAY_MS, timeZone).date;
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const toMonday = ((8 - weekday) % 7) || 7;
  return [
    { label: "Today", date: today },
    { label: "Tomorrow", date: at(1) },
    { label: "Next week", date: at(toMonday) },
  ];
}
