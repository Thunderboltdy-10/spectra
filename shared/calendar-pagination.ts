// A completed stream is explicit so a continuation request does not reread
// every other stream's first page.
export const CALENDAR_DONE_CURSOR = "__calendar_done__";
export const CALENDAR_CURSOR_ARGS = {
  visible: "cursor",
  unscheduled: "unscheduledCursor",
  planner: "plannerCursor",
  partial: "partialCursor",
  migration: "migrationCursor",
} as const;
export type CalendarStream = keyof typeof CALENDAR_CURSOR_ARGS;
export type CalendarPagination = Record<CalendarStream, string | null>;

/** The visible stream reads three independent sets: events starting in the
 * range's buckets, long events reaching into it, and undated items. Each has
 * a cursor of its own, so a client can read them side by side. */
export type CalendarVisiblePhase = "range" | "wide" | "unscheduled";
export const CALENDAR_VISIBLE_PHASES: readonly CalendarVisiblePhase[] = ["range", "wide", "unscheduled"];

/** The first-page cursor of one visible phase (the server's own encoding). */
export function calendarPhaseCursor(phase: CalendarVisiblePhase) {
  const bytes = new TextEncoder().encode(JSON.stringify({ kind: "visible", phase }));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
