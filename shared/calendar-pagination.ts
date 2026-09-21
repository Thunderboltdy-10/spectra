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
