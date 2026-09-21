import {
  calendarItemFromWire,
  type CalendarItem,
  type CalendarOverview,
} from "../domain/model";
import {
  CALENDAR_CURSOR_ARGS,
  CALENDAR_DONE_CURSOR,
  type CalendarPagination,
  type CalendarStream,
} from "../../../../../shared/calendar-pagination";

const STREAMS = Object.keys(CALENDAR_CURSOR_ARGS) as CalendarStream[];
const EMPTY_PAGINATION: CalendarPagination = {
  visible: null,
  unscheduled: null,
  planner: null,
  partial: null,
  migration: null,
};
export type CalendarContinuation = {
  from: number;
  to: number;
  cursors: CalendarPagination;
};

export function mergeCalendarItems(
  current: CalendarItem[],
  incoming: CalendarItem[],
) {
  const items = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) items.set(item.id, item);
  return [...items.values()];
}

export function mergeCalendarPages(
  current: CalendarOverview,
  incoming: CalendarOverview,
): CalendarOverview {
  return {
    ...incoming,
    timezone: current.timezone !== "UTC" ? current.timezone : incoming.timezone,
    items: mergeCalendarItems(current.items, incoming.items),
    unscheduledTasks: mergeCalendarItems(
      current.unscheduledTasks,
      incoming.unscheduledTasks,
    ),
    partialTimeItems: mergeCalendarItems(
      current.partialTimeItems,
      incoming.partialTimeItems,
    ),
    lastUpdatedAt:
      Math.max(current.lastUpdatedAt ?? 0, incoming.lastUpdatedAt ?? 0) ||
      undefined,
    migration: {
      complete: current.migration.complete && incoming.migration.complete,
      pageComplete:
        (current.migration.pageComplete ?? current.migration.complete) &&
        (incoming.migration.pageComplete ?? incoming.migration.complete),
      partial: current.migration.partial || incoming.migration.partial,
      migratedArtifacts:
        current.migration.migratedArtifacts +
        incoming.migration.migratedArtifacts,
      migratedEvents:
        current.migration.migratedEvents + incoming.migration.migratedEvents,
      skippedEvents:
        current.migration.skippedEvents + incoming.migration.skippedEvents,
    },
  };
}

/** A bounded batch, with an explicit continuation for larger calendars. Each
 * network await yields; completed streams do no further database discovery. */
export async function fetchCalendarOverview(
  from: number,
  to: number,
  options: {
    signal?: AbortSignal;
    continuation?: CalendarContinuation;
    maxPages?: number;
  } = {},
) {
  if (
    options.continuation &&
    (options.continuation.from !== from || options.continuation.to !== to)
  ) {
    throw new Error("Calendar range changed. Refresh to load this range.");
  }
  let cursors = options.continuation?.cursors;
  let overview: CalendarOverview | undefined;
  const pageBudget = Math.max(
    1,
    Math.min(16, Math.floor(options.maxPages ?? 8)),
  );
  for (let page = 0; page < pageBudget; page++) {
    options.signal?.throwIfAborted();
    const params = new URLSearchParams({ from: String(from), to: String(to) });
    if (cursors)
      for (const stream of STREAMS)
        params.set(
          CALENDAR_CURSOR_ARGS[stream],
          cursors[stream] ?? CALENDAR_DONE_CURSOR,
        );
    const response = await fetch(`/api/spectra/calendar?${params}`, {
      signal: options.signal,
    });
    const payload = await response.json();
    options.signal?.throwIfAborted();
    if (!response.ok)
      throw new Error(payload?.error?.message ?? "Could not load Calendar.");
    const data = payload.data as Record<string, unknown>;
    const pagination = data.pagination as
      Partial<CalendarPagination> | undefined;
    const next = { ...EMPTY_PAGINATION };
    for (const stream of STREAMS) {
      const value = pagination?.[stream];
      if (typeof value === "string" && value) next[stream] = value;
      if (cursors && next[stream] && next[stream] === cursors[stream])
        throw new Error(
          "Calendar could not load the next page. Refresh to try again.",
        );
    }
    const migration = data.migration as CalendarOverview["migration"];
    const incoming: CalendarOverview = {
      timezone: String(data.timezone ?? "UTC"),
      range: { from, to },
      items: Array.isArray(data.items)
        ? data.items.map(calendarItemFromWire)
        : [],
      unscheduledTasks: Array.isArray(data.unscheduledTasks)
        ? data.unscheduledTasks.map(calendarItemFromWire)
        : [],
      partialTimeItems: Array.isArray(data.partialTimeItems)
        ? data.partialTimeItems.map(calendarItemFromWire)
        : [],
      sourceState: data.sourceState as CalendarOverview["sourceState"],
      lastUpdatedAt:
        typeof data.lastUpdatedAt === "number" ? data.lastUpdatedAt : undefined,
      // Per-page migration.complete includes "no further pages". Accumulate
      // its actual row state, then apply the global continuation below.
      migration,
    };
    overview = overview ? mergeCalendarPages(overview, incoming) : incoming;
    overview.migration.complete =
      (overview.migration.pageComplete ?? overview.migration.complete) &&
      next.migration === null;
    cursors = next;
    if (STREAMS.every((stream) => next[stream] === null)) break;
  }
  const continuation =
    cursors && STREAMS.some((stream) => cursors![stream] !== null)
      ? { from, to, cursors }
      : null;
  return { overview: overview!, continuation };
}
