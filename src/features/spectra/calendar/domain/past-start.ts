/** A start this long ago still counts as now: the person asked a moment before. */
const PAST_START_GRACE_MS = 5 * 60_000;

/**
 * Calendar writes refuse a start that has already passed, with the time now so
 * the model can choose again. Logging something that already happened is the
 * one exception, and the request must say so with alreadyHappened.
 */
export function refusePastCalendarStart(
  toolId: string,
  args: Record<string, unknown>,
  now = Date.now(),
) {
  if (toolId === "resize_calendar_block" || args.alreadyHappened === true) return;
  // A repeating series (a timetable) may begin earlier this week.
  if (Array.isArray(args.alsoAtLocal) && args.alsoAtLocal.length > 0) return;
  const startAt = Number(args.startAt);
  if (!Number.isFinite(startAt) || startAt >= now - PAST_START_GRACE_MS) return;
  // An all-day event that is still going today is not in the past.
  if (args.allDay === true && Number(args.endAt) > now) return;
  const timeZone = typeof args.timezone === "string" && args.timezone.trim() ? args.timezone : undefined;
  let clock: string;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", weekday: "long", hourCycle: "h23" }).formatToParts(new Date(now));
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    clock = `${part("hour")}:${part("minute")} on ${part("weekday")}`;
  } catch {
    clock = new Date(now).toISOString();
  }
  throw new Error(
    `CALENDAR_TIME_PASSED: That time has already passed. It is ${clock}. Choose a time from now on, or pass alreadyHappened: true only if the person is logging something that already happened.`,
  );
}
