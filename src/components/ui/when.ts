/*
 * Plain days and times of day, as the day and time fields read and write
 * them: "YYYY-MM-DD" and "HH:MM", with no zone of their own.
 */

export type DayKey = string;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(day: DayKey) {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDays(day: DayKey, days: number): DayKey {
  return new Date(utcDay(day) + days * DAY_MS).toISOString().slice(0, 10);
}

export function sameMonth(first: DayKey, second: DayKey) {
  return first.slice(0, 7) === second.slice(0, 7);
}

/** Today on this device's clock. */
export function todayKey(now = Date.now()): DayKey {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The weeks, Monday first, that hold a day's month. */
export function monthWeeks(day: DayKey): DayKey[][] {
  const first = `${day.slice(0, 7)}-01`;
  const weekday = (new Date(utcDay(first)).getUTCDay() + 6) % 7;
  let cursor = addDays(first, -weekday);
  const weeks: DayKey[][] = [];
  do {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(cursor, index)));
    cursor = addDays(cursor, 7);
  } while (sameMonth(cursor, first));
  return weeks;
}

/**
 * A time as people type it: "9", "0930", "9:30", "9.30", "9h30", "9pm",
 * "12:15 am". Null when it is not one.
 */
export function parseTimeOfDay(text: string): string | null {
  const match = text
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?:\s*[:.h]\s*(\d{2})|(\d{2}))?\s*(a|p)?\.?\s*m?\.?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? match[3] ?? 0);
  const half = match[4];
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === "p" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "HH:MM" the way this device writes a time (14:30, or 2:30 PM). */
export function formatTimeOfDay(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, 1, hour, minute)),
  );
}
