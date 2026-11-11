/*
 * A calendar event Spectra made stands under its reply like a work it made
 * (harness-run-parts.tsx, reply-peek.tsx). It is not a work, so its id says
 * so, and it opens the calendar on its day instead of a work beside the
 * conversation.
 */

export const CALENDAR_TOUCH_PREFIX = "calendar:";

export function isCalendarTouch(id: string) {
  return id.startsWith(CALENDAR_TOUCH_PREFIX);
}

/** The calendar, opened on the week of the event the card names. */
export function calendarTouchHref(region?: string) {
  const at = region?.startsWith("at:") ? Number(region.slice(3)) : NaN;
  return Number.isFinite(at) ? `/calendar?at=${at}` : "/calendar";
}
