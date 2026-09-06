/** Shared minutesBefore reminder shape (Timetable / planner_task / Plan). */

export type MinutesBeforeReminder = {
  id: string;
  minutesBefore: number;
};

export const REMINDER_MINUTE_OPTIONS: ReadonlyArray<{
  minutesBefore: number;
  label: string;
}> = [
  { minutesBefore: 0, label: "At start time" },
  { minutesBefore: 5, label: "5 minutes before" },
  { minutesBefore: 10, label: "10 minutes before" },
  { minutesBefore: 15, label: "15 minutes before" },
  { minutesBefore: 30, label: "30 minutes before" },
  { minutesBefore: 60, label: "1 hour before" },
  { minutesBefore: 120, label: "2 hours before" },
  { minutesBefore: 1440, label: "1 day before" },
];

const MAX_MINUTES = 525_600;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function formatMinutesBefore(minutesBefore: number): string {
  const preset = REMINDER_MINUTE_OPTIONS.find(
    (option) => option.minutesBefore === minutesBefore,
  );
  if (preset) return preset.label;
  if (minutesBefore === 0) return "At start time";
  if (minutesBefore % 1440 === 0) {
    const days = minutesBefore / 1440;
    return days === 1 ? "1 day before" : `${days} days before`;
  }
  if (minutesBefore % 60 === 0) {
    const hours = minutesBefore / 60;
    return hours === 1 ? "1 hour before" : `${hours} hours before`;
  }
  return minutesBefore === 1
    ? "1 minute before"
    : `${minutesBefore} minutes before`;
}

/** Parse free-text legacy chips into minutesBefore when the label is unambiguous. */
export function parseLegacyReminderLabel(label: string): number | null {
  const text = label.trim().toLowerCase();
  if (!text) return null;
  const preset = REMINDER_MINUTE_OPTIONS.find(
    (option) => option.label.toLowerCase() === text,
  );
  if (preset) return preset.minutesBefore;
  if (text === "at due" || text === "at due time" || text === "when due")
    return 0;
  const match = text.match(
    /^(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)\s*before$/,
  );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const unit = match[2];
  if (unit.startsWith("min")) return Math.min(MAX_MINUTES, Math.round(amount));
  if (unit.startsWith("hour") || unit.startsWith("hr"))
    return Math.min(MAX_MINUTES, Math.round(amount * 60));
  if (unit.startsWith("day"))
    return Math.min(MAX_MINUTES, Math.round(amount * 1440));
  return null;
}

function clampMinutes(value: number) {
  return Math.max(0, Math.min(MAX_MINUTES, Math.round(value)));
}

/**
 * Normalize reminder rows to `{ id, minutesBefore }`.
 * Structured rows survive; known string labels migrate; unknown strings drop.
 */
export function normalizeMinutesBeforeReminders(
  value: unknown,
): MinutesBeforeReminder[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const out: MinutesBeforeReminder[] = [];
  value.forEach((candidate, index) => {
    if (typeof candidate === "string") {
      const minutes = parseLegacyReminderLabel(candidate);
      if (minutes === null || seen.has(minutes)) return;
      seen.add(minutes);
      out.push({ id: `reminder-${index + 1}`, minutesBefore: minutes });
      return;
    }
    const row = record(candidate);
    if (row.enabled === false) return;
    const minutesBefore = Number(row.minutesBefore);
    if (!Number.isFinite(minutesBefore)) return;
    const clamped = clampMinutes(minutesBefore);
    if (seen.has(clamped)) return;
    seen.add(clamped);
    out.push({
      id:
        typeof row.id === "string" && row.id.trim()
          ? row.id.trim().slice(0, 180)
          : `reminder-${index + 1}`,
      minutesBefore: clamped,
    });
  });
  return out.slice(0, 24);
}
