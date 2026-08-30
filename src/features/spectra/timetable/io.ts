import { inputToIso, localDateInput, type TimetableEvent } from "./model";

export type TimetableImportReport = {
  events: TimetableEvent[];
  imported: number;
  skipped: number;
  warnings: string[];
  originalName: string;
};

function unquote(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }
  return trimmed;
}

function csvRows(source: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseIcsDate(value: string, timezone?: string) {
  const clean = value.trim();
  if (/^\d{8}$/.test(clean)) {
    return new Date(
      inputToIso(
        `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T00:00:00`,
        timezone,
      ),
    );
  }
  const match = clean.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/,
  );
  if (!match) return new Date(clean);
  const [, year, month, day, hour, minute, second, utc] = match;
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  return new Date(utc ? `${normalized}Z` : inputToIso(normalized, timezone));
}

function escapeIcs(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function formatIcsDate(value: string, allDay: boolean, timezone?: string) {
  const date = new Date(value);
  if (allDay)
    return localDateInput(date.toISOString(), timezone)
      .slice(0, 10)
      .replaceAll("-", "");
  return date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".000", "");
}

export async function importTimetableFile(
  file: File,
  layerId: string,
): Promise<TimetableImportReport> {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error(
      "Calendar import exceeds the 20 MB technical safety ceiling.",
    );
  }
  const source = await file.text();
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "ics" || source.includes("BEGIN:VCALENDAR")) {
    if (/BEGIN:(VTODO|VJOURNAL|VFREEBUSY)/i.test(source)) {
      throw new Error(
        "This calendar contains unsupported active record types. It was quarantined without importing events.",
      );
    }
    const unfolded = source.replace(/\r?\n[ \t]/g, "");
    const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
    const warnings: string[] = [];
    const events: TimetableEvent[] = [];
    blocks.forEach((block, index) => {
      const properties = new Map<string, string>();
      block.split(/\r?\n/).forEach((line) => {
        const separator = line.indexOf(":");
        if (separator < 0) return;
        const key = line.slice(0, separator).toUpperCase();
        properties.set(key, line.slice(separator + 1));
      });
      const startEntry = [...properties.entries()].find(([key]) =>
        key.startsWith("DTSTART"),
      );
      const endEntry = [...properties.entries()].find(([key]) =>
        key.startsWith("DTEND"),
      );
      if (!startEntry) {
        warnings.push(`Event ${index + 1} has no start and was skipped.`);
        return;
      }
      const timezone = startEntry[0]
        .match(/TZID=([^;:]+)/i)?.[1]
        ?.replace(/^"|"$/g, "");
      const start = parseIcsDate(startEntry[1], timezone);
      const allDay = startEntry[0].includes("VALUE=DATE");
      const end = endEntry
        ? parseIcsDate(
            endEntry[1],
            endEntry[0].match(/TZID=([^;:]+)/i)?.[1]?.replace(/^"|"$/g, "") ||
              timezone,
          )
        : new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        warnings.push(
          `Event ${index + 1} has an invalid date and was skipped.`,
        );
        return;
      }
      events.push({
        id: `ics-${properties.get("UID") || `${Date.now().toString(36)}-${index}`}`,
        layerId,
        title: (properties.get("SUMMARY") || "Imported event").slice(0, 300),
        start: start.toISOString(),
        end:
          end.getTime() > start.getTime()
            ? end.toISOString()
            : new Date(start.getTime() + 1_800_000).toISOString(),
        allDay,
        ...(timezone ? { timezone } : {}),
        ...(properties.get("RRULE")
          ? { recurrence: properties.get("RRULE")!.slice(0, 500) }
          : {}),
        ...(() => {
          const exception = [...properties.entries()].find(([key]) =>
            key.startsWith("EXDATE"),
          );
          if (!exception) return {};
          const exceptionTimezone =
            exception[0].match(/TZID=([^;:]+)/i)?.[1]?.replace(/^"|"$/g, "") ||
            timezone;
          return {
            recurrenceExceptions: exception[1]
              .split(",")
              .map((value) => parseIcsDate(value, exceptionTimezone))
              .filter((date) => !Number.isNaN(date.getTime()))
              .map((date) => date.toISOString()),
          };
        })(),
        ...(properties.get("LOCATION")
          ? { location: properties.get("LOCATION")!.slice(0, 300) }
          : {}),
        ...(properties.get("DESCRIPTION")
          ? { notes: properties.get("DESCRIPTION")!.slice(0, 250_000) }
          : {}),
        provenance: {
          actor: "source",
          source: file.name,
          importedAt: Date.now(),
        },
      });
    });
    return {
      events,
      imported: events.length,
      skipped: blocks.length - events.length,
      warnings,
      originalName: file.name,
    };
  }

  if (extension !== "csv") {
    throw new Error("Choose an ICS or CSV calendar file.");
  }
  const rows = csvRows(source);
  const header = (rows.shift() ?? []).map((cell) => cell.trim().toLowerCase());
  const field = (...names: string[]) =>
    names.map((name) => header.indexOf(name)).find((index) => index >= 0) ?? -1;
  const titleIndex = field("title", "summary", "event");
  const startIndex = field("start", "start date", "start time");
  const endIndex = field("end", "end date", "end time");
  if (titleIndex < 0 || startIndex < 0) {
    throw new Error("CSV needs at least Title and Start columns.");
  }
  const warnings: string[] = [];
  const events = rows.flatMap((row, index): TimetableEvent[] => {
    const start = new Date(unquote(row[startIndex] ?? ""));
    const end = new Date(unquote(row[endIndex] ?? ""));
    if (Number.isNaN(start.getTime())) {
      warnings.push(`Row ${index + 2} has an invalid start and was skipped.`);
      return [];
    }
    const safeEnd =
      !Number.isNaN(end.getTime()) && end.getTime() > start.getTime()
        ? end
        : new Date(start.getTime() + 3_600_000);
    return [
      {
        id: `csv-${Date.now().toString(36)}-${index}`,
        layerId,
        title: unquote(row[titleIndex] ?? "Imported event").slice(0, 300),
        start: start.toISOString(),
        end: safeEnd.toISOString(),
        allDay: false,
        provenance: {
          actor: "source",
          source: file.name,
          importedAt: Date.now(),
        },
      },
    ];
  });
  return {
    events,
    imported: events.length,
    skipped: rows.length - events.length,
    warnings,
    originalName: file.name,
  };
}

export function exportTimetableIcs(
  events: TimetableEvent[],
  calendarName: string,
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Spectra//Timetable//EN",
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
  ];
  events.forEach((event) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcs(event.id)}@spectra`,
      `DTSTAMP:${formatIcsDate(new Date().toISOString(), false)}`,
      `DTSTART${event.allDay ? ";VALUE=DATE" : ""}:${formatIcsDate(event.start, event.allDay, event.timezone)}`,
      `DTEND${event.allDay ? ";VALUE=DATE" : ""}:${formatIcsDate(event.end, event.allDay, event.timezone)}`,
      `SUMMARY:${escapeIcs(event.title)}`,
    );
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    if (event.notes || event.overlay?.note)
      lines.push(
        `DESCRIPTION:${escapeIcs(event.overlay?.note || event.notes || "")}`,
      );
    if (event.recurrence) lines.push(`RRULE:${event.recurrence}`);
    if (event.recurrenceExceptions?.length)
      lines.push(
        `EXDATE:${event.recurrenceExceptions
          .map((value) => formatIcsDate(value, event.allDay, event.timezone))
          .join(",")}`,
      );
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function escapeCsv(value: string | number | boolean | undefined) {
  const text = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Spreadsheet-friendly export of the same visible event set as ICS. Source
 * authority stays explicit and personal overlay times are exported as the
 * viewer currently sees them without pretending to change provider truth. */
export function exportTimetableCsv(events: readonly TimetableEvent[]) {
  const rows = [
    [
      "Title",
      "Start",
      "End",
      "All day",
      "Timezone",
      "Location",
      "Recurrence",
      "Source",
      "Notes",
    ],
    ...events.map((event) => [
      event.title,
      event.overlay?.alternativeStart ?? event.start,
      event.overlay?.alternativeEnd ?? event.end,
      event.allDay,
      event.timezone ?? "",
      event.location ?? "",
      event.recurrence ?? "",
      event.sourceRef ?? event.provenance?.source ?? "Spectra",
      event.overlay?.note ?? event.notes ?? "",
    ]),
  ];
  return `${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
}
