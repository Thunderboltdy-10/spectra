import { downloadDocumentText } from "@/features/spectra/components/artifact-studio-file-utils";
import { exportTimetableIcs, importTimetableFile } from "@/features/spectra/timetable/io";
import { expandTimetableEvents, type TimetableEvent } from "@/features/spectra/timetable/model";
import { fetchCalendarOverview } from "../data/overview-client";
import type { CalendarItem } from "../domain/model";

const DAY = 24 * 60 * 60 * 1_000;
/** A repeating event becomes its next year of days, and a file can't flood the calendar. */
const IMPORT_AHEAD_DAYS = 365;
const MOST_IMPORTED = 400;
const AT_ONCE = 4;

const itemKey = (title: string, startAt: number) => `${title.trim().toLowerCase()}|${startAt}`;

/**
 * An .ics or .csv file onto the calendar. What is already there is left alone, so
 * bringing in the same file twice changes nothing.
 */
export async function importCalendarFile(
  file: File,
  timezone: string,
  create: (event: { title: string; notes?: string; startAt: number; endAt: number; allDay: boolean; timezone: string }) => Promise<unknown>,
) {
  const report = await importTimetableFile(file, "imported");
  const from = Date.now() - 365 * DAY;
  const to = Date.now() + IMPORT_AHEAD_DAYS * DAY;
  const occurrences = expandTimetableEvents(report.events, new Date(from), new Date(to), timezone);
  const { overview } = await fetchCalendarOverview(from, to, { maxPages: 16 });
  const already = new Set(overview.items.flatMap((item) => (item.startAt ? [itemKey(item.title, item.startAt)] : [])));
  const seen = new Set<string>();
  const fresh = occurrences.flatMap((occurrence) => {
    const startAt = new Date(occurrence.start).getTime();
    const endAt = new Date(occurrence.end).getTime();
    const key = itemKey(occurrence.title, startAt);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || already.has(key) || seen.has(key)) return [];
    seen.add(key);
    return [{ occurrence, startAt, endAt }];
  });
  const chosen = fresh.slice(0, MOST_IMPORTED);
  let added = 0;
  for (let index = 0; index < chosen.length; index += AT_ONCE) {
    await Promise.all(
      chosen.slice(index, index + AT_ONCE).map(async ({ occurrence, startAt, endAt }) => {
        const notes = [occurrence.location, occurrence.notes].filter(Boolean).join("\n");
        await create({
          title: occurrence.title,
          ...(notes ? { notes } : {}),
          startAt,
          endAt,
          allDay: occurrence.allDay,
          timezone: occurrence.timezone || timezone,
        });
        added += 1;
      }),
    );
  }
  return { added, alreadyThere: occurrences.length - fresh.length, leftOut: fresh.length - chosen.length, warnings: report.warnings };
}

function asEvent(item: CalendarItem, timezone: string): TimetableEvent[] {
  if (!item.startAt || item.status === "removed" || item.status === "cancelled") return [];
  return [
    {
      id: item.id,
      layerId: "calendar",
      title: item.title,
      start: new Date(item.startAt).toISOString(),
      end: new Date(item.endAt ?? item.startAt).toISOString(),
      allDay: item.allDay,
      timezone: item.timezone || timezone,
      ...(item.location ? { location: item.location } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
    },
  ];
}

/** The last three months and the coming year, as a file other calendars can open. */
export async function exportCalendarFile(timezone: string) {
  const { overview } = await fetchCalendarOverview(Date.now() - 90 * DAY, Date.now() + 365 * DAY, { maxPages: 16 });
  const events = overview.items.flatMap((item) => asEvent(item, timezone));
  downloadDocumentText("spectra-calendar.ics", "text/calendar", exportTimetableIcs(events, "Spectra calendar"));
  return events.length;
}
