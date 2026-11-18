import {
  calendarItemFromWire,
  type CalendarItem,
  type CalendarOverview,
} from "../domain/model";
import {
  CALENDAR_CURSOR_ARGS,
  CALENDAR_DONE_CURSOR,
  CALENDAR_VISIBLE_PHASES,
  calendarPhaseCursor,
  type CalendarVisiblePhase,
  type CalendarPagination,
  type CalendarStream,
} from "../../../../../shared/calendar-pagination";
import { requestSpectra } from "../../data/request";

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
    /** Only these streams are read; the others are sent as done. The week's
     * own items and the range-free lists (unscheduled, planner, partial,
     * migration) load apart, so a week never waits on every task. */
    streams?: readonly CalendarStream[];
    /** The continuation's visible phase stops at its own end. */
    phaseOnly?: boolean;
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
    if (options.phaseOnly) params.set("phaseOnly", "1");
    if (cursors)
      for (const stream of STREAMS)
        params.set(
          CALENDAR_CURSOR_ARGS[stream],
          cursors[stream] ?? CALENDAR_DONE_CURSOR,
        );
    else if (options.streams)
      for (const stream of STREAMS)
        if (!options.streams.includes(stream))
          params.set(CALENDAR_CURSOR_ARGS[stream], CALENDAR_DONE_CURSOR);
    const response = await requestSpectra(`/api/spectra/calendar?${params}`, {
      signal: options.signal,
    });
    // A proxy error page is HTML; its parse error is not a Calendar message.
    const payload = await response.json().catch(() => null);
    options.signal?.throwIfAborted();
    if (!response.ok) {
      const message = payload?.error?.message ?? "Could not load Calendar.";
      // Keep the code where the caller reads it: someone in no school is sent to their invitation, not told to retry.
      throw new Error(payload?.error?.code === "AUTH_NO_SCHOOL" ? `AUTH_NO_SCHOOL: ${message}` : message);
    }
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

/**
 * Calendar items by phase, read side by side rather than one after another:
 * by default the days' own items (events starting in the range and long ones
 * reaching into it); `["unscheduled"]` reads the undated items, which no
 * range changes.
 */
export async function fetchCalendarWeek(
  from: number,
  to: number,
  options: { signal?: AbortSignal; phases?: readonly CalendarVisiblePhase[] } = {},
) {
  const phases = options.phases ?? CALENDAR_VISIBLE_PHASES.filter((phase) => phase !== "unscheduled");
  const results = await readPhases(from, to, phases, options.signal).catch((error: unknown) => {
    if (options.signal?.aborted) throw error;
    // A server from before phase reads: the ordinary visible stream, in turn.
    return fetchCalendarOverview(from, to, { signal: options.signal, streams: ["visible"] }).then((result) => [result]);
  });
  let overview = results[0]!.overview;
  for (const result of results.slice(1)) overview = mergeCalendarPages(overview, result.overview);
  // A phase that ran past its page budget resumes as an ordinary continuation.
  const continuation = results.find((result) => result.continuation)?.continuation ?? null;
  return { overview, continuation };
}

function readPhases(from: number, to: number, phases: readonly CalendarVisiblePhase[], signal?: AbortSignal) {
  return Promise.all(
    phases.map((phase) =>
      fetchCalendarOverview(from, to, {
        signal,
        phaseOnly: true,
        continuation: {
          from,
          to,
          cursors: { ...EMPTY_PAGINATION, visible: calendarPhaseCursor(phase) },
        },
      }),
    ),
  );
}
