export type TimetableLayerKind =
  "personal" | "school" | "class" | "tasks" | "external" | "study";

export type TimetableView = "week" | "day" | "month" | "agenda";

export type TimetableLayer = {
  id: string;
  name: string;
  kind: TimetableLayerKind;
  visible: boolean;
  color: string;
  sourceId?: string;
  authority?: "user" | "workspace" | "school" | "external";
  private?: boolean;
  locked?: boolean;
};

export type TimetableEvent = {
  id: string;
  layerId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  timezone?: string;
  recurrence?: string;
  recurrenceExceptions?: string[];
  sourceRef?: string;
  sourceVersion?: string;
  sourceHash?: string;
  sourceStatus?: "active" | "changed" | "removed" | "detached";
  location?: string;
  videoUrl?: string;
  notes?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  availability?: "busy" | "free";
  artifactIds?: string[];
  taskId?: string;
  reminders?: Array<{ id: string; minutesBefore: number; method: "in_app" }>;
  overlay?: {
    color?: string;
    note?: string;
    reminderMinutes?: number;
    hidden?: boolean;
    alternativeStart?: string;
    alternativeEnd?: string;
  };
  provenance?: {
    actor?: "user" | "ai" | "source";
    source?: string;
    importedAt?: number;
  };
  locked?: boolean;
};

export type TimetableContent = {
  timezone: string;
  layers: TimetableLayer[];
  events: TimetableEvent[];
  view?: {
    kind: TimetableView;
    anchorDate: string;
    weekStartsOn: 0 | 1;
    startHour: number;
    endHour: number;
    showWeekends: boolean;
  };
  availability?: Array<{
    id: string;
    weekday: number;
    startMinutes: number;
    endMinutes: number;
  }>;
  preferences?: {
    focusGoalMinutes?: number;
    compactEvents?: boolean;
  };
};

export type TimetableEventOverlay = NonNullable<TimetableEvent["overlay"]>;

export type TimetablePersonalState = {
  view: NonNullable<TimetableContent["view"]>;
  layerVisibility: Record<string, boolean>;
  privateLayers: TimetableLayer[];
  privateEvents: TimetableEvent[];
  eventOverlays: Record<string, TimetableEventOverlay>;
  availability: NonNullable<TimetableContent["availability"]>;
  preferences: NonNullable<TimetableContent["preferences"]>;
};

export type TimetableOccurrence = TimetableEvent & {
  occurrenceKey: string;
  seriesEventId: string;
};

const layerKinds = new Set<TimetableLayerKind>([
  "personal",
  "school",
  "class",
  "tasks",
  "external",
  "study",
]);
const layerColors = ["#26a879", "#7865ea", "#f2ad2e", "#f07157", "#4a91de"];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function iso(value: unknown, fallback: Date) {
  const candidate =
    typeof value === "number" || typeof value === "string"
      ? new Date(value)
      : fallback;
  return Number.isNaN(candidate.getTime())
    ? fallback.toISOString()
    : candidate.toISOString();
}

function unique(candidate: string, fallback: string, used: Set<string>) {
  const base = (candidate.trim() || fallback).slice(0, 180);
  let resolved = base;
  let suffix = 2;
  while (used.has(resolved)) resolved = `${base.slice(0, 174)}-${suffix++}`;
  used.add(resolved);
  return resolved;
}

export function localDateInput(isoValue: string, timezone?: string) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function inputToIso(value: string, timezone?: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? new Date().toISOString()
      : parsed.toISOString();
  }
  const desired = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  );
  if (!timezone) return new Date(desired).toISOString();
  let instant = desired;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = Object.fromEntries(
        formatter
          .formatToParts(new Date(instant))
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, part.value]),
      );
      const represented = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      const correction = desired - represented;
      instant += correction;
      if (correction === 0) break;
    }
    return new Date(instant).toISOString();
  } catch {
    return new Date(desired).toISOString();
  }
}

const recurrenceWeekday: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function recurrenceParts(value: string) {
  return Object.fromEntries(
    value
      .split(";")
      .map((part) => part.split("=", 2))
      .filter((entry): entry is [string, string] =>
        Boolean(entry[0] && entry[1]),
      )
      .map(([key, setting]) => [key.toUpperCase(), setting.toUpperCase()]),
  );
}

function localCalendarDate(value: string, timezone: string) {
  const local = localDateInput(value, timezone);
  const match = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  return match
    ? new Date(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
        ),
      )
    : new Date(value);
}

function localCalendarInput(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export function expandTimetableEvents(
  events: TimetableEvent[],
  rangeStart: Date,
  rangeEnd: Date,
  fallbackTimezone: string,
) {
  const output: TimetableOccurrence[] = [];
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();
  const include = (event: TimetableEvent, start: Date, end: Date) => {
    if (end.getTime() <= rangeStartMs || start.getTime() >= rangeEndMs) return;
    const startIso = start.toISOString();
    const exceptions = new Set(event.recurrenceExceptions ?? []);
    const timezone = event.timezone || fallbackTimezone;
    const localDate = localDateInput(startIso, timezone).slice(0, 10);
    if (
      exceptions.has(startIso) ||
      exceptions.has(startIso.slice(0, 10)) ||
      exceptions.has(localDate)
    )
      return;
    output.push({
      ...event,
      start: startIso,
      end: end.toISOString(),
      timezone: event.timezone || fallbackTimezone,
      ...(event.overlay
        ? {
            overlay: {
              ...event.overlay,
              alternativeStart: startIso,
              alternativeEnd: end.toISOString(),
            },
          }
        : {}),
      occurrenceKey: `${event.id}:${startIso}`,
      seriesEventId: event.id,
    });
  };
  for (const event of events) {
    const originalStart = new Date(
      event.overlay?.alternativeStart || event.start,
    );
    const originalEnd = new Date(event.overlay?.alternativeEnd || event.end);
    if (
      Number.isNaN(originalStart.getTime()) ||
      Number.isNaN(originalEnd.getTime())
    )
      continue;
    if (!event.recurrence) {
      include(event, originalStart, originalEnd);
      continue;
    }
    const rule = recurrenceParts(event.recurrence);
    const frequency = rule.FREQ;
    if (!frequency || !["DAILY", "WEEKLY", "MONTHLY"].includes(frequency)) {
      include(event, originalStart, originalEnd);
      continue;
    }
    const timezone = event.timezone || fallbackTimezone;
    const duration = Math.max(
      0,
      originalEnd.getTime() - originalStart.getTime(),
    );
    const localStart = localCalendarDate(originalStart.toISOString(), timezone);
    const interval = Math.max(1, Math.min(10_000, Number(rule.INTERVAL) || 1));
    const countLimit = Math.max(
      1,
      Math.min(100_000, Number(rule.COUNT) || 100_000),
    );
    const until = rule.UNTIL
      ? /^\d{8}T\d{6}Z$/.test(rule.UNTIL)
        ? new Date(
            `${rule.UNTIL.slice(0, 4)}-${rule.UNTIL.slice(4, 6)}-${rule.UNTIL.slice(6, 8)}T${rule.UNTIL.slice(9, 11)}:${rule.UNTIL.slice(11, 13)}:${rule.UNTIL.slice(13, 15)}Z`,
          )
        : new Date(rule.UNTIL)
      : undefined;
    const byDays = (rule.BYDAY?.split(",") ?? [])
      .map((day) => recurrenceWeekday[day.replace(/^[+-]?\d+/, "")])
      .filter((day): day is number => typeof day === "number");
    let generated = 0;
    if (frequency === "MONTHLY") {
      for (
        let monthStep = 0;
        monthStep < 12_000 && generated < countLimit;
        monthStep += 1
      ) {
        if (monthStep % interval !== 0) continue;
        const monthStart = new Date(
          Date.UTC(
            localStart.getUTCFullYear(),
            localStart.getUTCMonth() + monthStep,
            1,
            localStart.getUTCHours(),
            localStart.getUTCMinutes(),
          ),
        );
        const daysInMonth = new Date(
          Date.UTC(
            monthStart.getUTCFullYear(),
            monthStart.getUTCMonth() + 1,
            0,
          ),
        ).getUTCDate();
        if (localStart.getUTCDate() > daysInMonth) continue;
        monthStart.setUTCDate(localStart.getUTCDate());
        const occurrenceStart = new Date(
          inputToIso(localCalendarInput(monthStart), timezone),
        );
        if (until && occurrenceStart > until) break;
        generated += 1;
        include(
          event,
          occurrenceStart,
          new Date(occurrenceStart.getTime() + duration),
        );
        if (occurrenceStart.getTime() > rangeEndMs && generated > 1) break;
      }
      continue;
    }
    let cursor = new Date(localStart);
    for (let guard = 0; guard < 200_000 && generated < countLimit; guard += 1) {
      const dayOffset = Math.floor(
        (Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth(),
          cursor.getUTCDate(),
        ) -
          Date.UTC(
            localStart.getUTCFullYear(),
            localStart.getUTCMonth(),
            localStart.getUTCDate(),
          )) /
          86_400_000,
      );
      const weekIndex = Math.floor(dayOffset / 7);
      const matches =
        frequency === "DAILY"
          ? dayOffset % interval === 0
          : weekIndex % interval === 0 &&
            (byDays.length
              ? byDays.includes(cursor.getUTCDay())
              : cursor.getUTCDay() === localStart.getUTCDay());
      if (matches) {
        const occurrenceStart = new Date(
          inputToIso(localCalendarInput(cursor), timezone),
        );
        if (until && occurrenceStart > until) break;
        generated += 1;
        include(
          event,
          occurrenceStart,
          new Date(occurrenceStart.getTime() + duration),
        );
        if (occurrenceStart.getTime() > rangeEndMs && generated > 1) break;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return output.sort(
    (left, right) => Date.parse(left.start) - Date.parse(right.start),
  );
}

export function createTimetableEvent(
  layerId: string,
  start: Date,
  durationMinutes = 60,
): TimetableEvent {
  return {
    id: `event-${Date.now().toString(36)}`,
    layerId,
    title: "New event",
    start: start.toISOString(),
    end: new Date(start.getTime() + durationMinutes * 60_000).toISOString(),
    allDay: false,
    status: "confirmed",
    availability: "busy",
    provenance: { actor: "user" },
  };
}

export function normalizeTimetableContent(value: unknown): TimetableContent {
  const input = record(value);
  const timezone = text(
    input.timezone,
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  ).slice(0, 100);
  const usedLayers = new Set<string>();
  const layers = (Array.isArray(input.layers) ? input.layers : []).map(
    (candidate, index): TimetableLayer => {
      const row = record(candidate);
      const kind = layerKinds.has(row.kind as TimetableLayerKind)
        ? (row.kind as TimetableLayerKind)
        : "personal";
      return {
        id: unique(text(row.id), `layer-${index + 1}`, usedLayers),
        name: text(row.name, `Calendar ${index + 1}`).slice(0, 120),
        kind,
        visible: row.visible !== false,
        color: text(row.color, layerColors[index % layerColors.length]).slice(
          0,
          32,
        ),
        ...(typeof row.sourceId === "string"
          ? { sourceId: row.sourceId.slice(0, 180) }
          : {}),
        ...(row.authority === "user" ||
        row.authority === "workspace" ||
        row.authority === "school" ||
        row.authority === "external"
          ? { authority: row.authority }
          : {}),
        ...(typeof row.private === "boolean" ? { private: row.private } : {}),
        ...(typeof row.locked === "boolean" ? { locked: row.locked } : {}),
      };
    },
  );
  if (!layers.length) {
    layers.push(
      {
        id: "classes",
        name: "Classes",
        kind: "class",
        visible: true,
        color: "#26a879",
        authority: "school",
      },
      {
        id: "study",
        name: "Study blocks",
        kind: "study",
        visible: true,
        color: "#7865ea",
        authority: "user",
      },
      {
        id: "tasks",
        name: "Tasks & deadlines",
        kind: "tasks",
        visible: true,
        color: "#f2ad2e",
        authority: "workspace",
      },
    );
  }
  const layerIds = new Set(layers.map((layer) => layer.id));
  const fallbackLayer = layers[0]!.id;
  const usedEvents = new Set<string>();
  const now = new Date();
  const events = (Array.isArray(input.events) ? input.events : []).map(
    (candidate, index): TimetableEvent => {
      const row = record(candidate);
      const start = iso(row.start ?? row.startAt, now);
      const startDate = new Date(start);
      let end = iso(
        row.end ?? row.endAt,
        new Date(startDate.getTime() + 60 * 60_000),
      );
      if (new Date(end).getTime() <= startDate.getTime()) {
        end = new Date(startDate.getTime() + 30 * 60_000).toISOString();
      }
      const overlay = record(row.overlay);
      const provenance = record(row.provenance);
      return {
        id: unique(text(row.id), `event-${index + 1}`, usedEvents),
        layerId: layerIds.has(text(row.layerId))
          ? text(row.layerId)
          : fallbackLayer,
        title: text(row.title, "Untitled event").slice(0, 300),
        start,
        end,
        allDay: row.allDay === true,
        timezone: text(row.timezone, timezone),
        ...(typeof row.recurrence === "string"
          ? { recurrence: row.recurrence.slice(0, 500) }
          : {}),
        ...(Array.isArray(row.recurrenceExceptions)
          ? {
              recurrenceExceptions: row.recurrenceExceptions
                .filter((item): item is string => typeof item === "string")
                .slice(0, 500),
            }
          : {}),
        ...(typeof row.sourceRef === "string"
          ? { sourceRef: row.sourceRef.slice(0, 180) }
          : {}),
        ...(typeof row.sourceVersion === "string"
          ? { sourceVersion: row.sourceVersion.slice(0, 180) }
          : {}),
        ...(typeof row.sourceHash === "string"
          ? { sourceHash: row.sourceHash.slice(0, 180) }
          : {}),
        ...(row.sourceStatus === "active" ||
        row.sourceStatus === "changed" ||
        row.sourceStatus === "removed" ||
        row.sourceStatus === "detached"
          ? { sourceStatus: row.sourceStatus }
          : {}),
        ...(typeof row.location === "string"
          ? { location: row.location.slice(0, 300) }
          : {}),
        ...(typeof row.videoUrl === "string"
          ? { videoUrl: row.videoUrl.slice(0, 2_000) }
          : {}),
        ...(typeof row.notes === "string"
          ? { notes: row.notes.slice(0, 250_000) }
          : {}),
        status:
          row.status === "tentative" || row.status === "cancelled"
            ? row.status
            : "confirmed",
        availability: row.availability === "free" ? "free" : "busy",
        ...(Array.isArray(row.artifactIds)
          ? {
              artifactIds: row.artifactIds
                .filter((item): item is string => typeof item === "string")
                .slice(0, 100),
            }
          : {}),
        ...(typeof row.taskId === "string" ? { taskId: row.taskId } : {}),
        ...(Array.isArray(row.reminders)
          ? {
              reminders: row.reminders.flatMap((candidate, reminderIndex) => {
                const reminder = record(candidate);
                return Number.isFinite(reminder.minutesBefore)
                  ? [
                      {
                        id: text(reminder.id, `reminder-${reminderIndex + 1}`),
                        minutesBefore: Math.max(
                          0,
                          Math.min(525_600, Number(reminder.minutesBefore)),
                        ),
                        method: "in_app" as const,
                      },
                    ]
                  : [];
              }),
            }
          : {}),
        ...(Object.keys(overlay).length
          ? {
              overlay: {
                ...(typeof overlay.color === "string"
                  ? { color: overlay.color.slice(0, 32) }
                  : {}),
                ...(typeof overlay.note === "string"
                  ? { note: overlay.note.slice(0, 250_000) }
                  : {}),
                ...(typeof overlay.reminderMinutes === "number"
                  ? {
                      reminderMinutes: Math.max(
                        0,
                        Math.min(525_600, overlay.reminderMinutes),
                      ),
                    }
                  : {}),
                ...(typeof overlay.hidden === "boolean"
                  ? { hidden: overlay.hidden }
                  : {}),
                ...(typeof overlay.alternativeStart === "string"
                  ? { alternativeStart: overlay.alternativeStart }
                  : {}),
                ...(typeof overlay.alternativeEnd === "string"
                  ? { alternativeEnd: overlay.alternativeEnd }
                  : {}),
              },
            }
          : {}),
        ...(Object.keys(provenance).length
          ? {
              provenance: {
                ...(provenance.actor === "user" ||
                provenance.actor === "ai" ||
                provenance.actor === "source"
                  ? { actor: provenance.actor }
                  : {}),
                ...(typeof provenance.source === "string"
                  ? { source: provenance.source }
                  : {}),
                ...(typeof provenance.importedAt === "number"
                  ? { importedAt: provenance.importedAt }
                  : {}),
              },
            }
          : {}),
        ...(typeof row.locked === "boolean" ? { locked: row.locked } : {}),
      };
    },
  );
  const view = record(input.view);
  const kind =
    view.kind === "day" || view.kind === "month" || view.kind === "agenda"
      ? view.kind
      : "week";
  const anchorDate = /^\d{4}-\d{2}-\d{2}$/.test(text(view.anchorDate))
    ? text(view.anchorDate)
    : new Date().toISOString().slice(0, 10);
  const preferences = record(input.preferences);
  return {
    timezone,
    layers,
    events,
    view: {
      kind,
      anchorDate,
      weekStartsOn: view.weekStartsOn === 0 ? 0 : 1,
      startHour: Math.max(
        0,
        Math.min(22, Math.round(finite(view.startHour, 8))),
      ),
      endHour: Math.max(2, Math.min(24, Math.round(finite(view.endHour, 21)))),
      showWeekends: view.showWeekends !== false,
    },
    ...(Array.isArray(input.availability)
      ? {
          availability: input.availability.flatMap((candidate, index) => {
            const row = record(candidate);
            const startMinutes = Math.max(
              0,
              Math.min(1_439, Math.round(finite(row.startMinutes, 9 * 60))),
            );
            const endMinutes = Math.max(
              startMinutes + 1,
              Math.min(1_440, Math.round(finite(row.endMinutes, 17 * 60))),
            );
            return [
              {
                id: text(row.id, `availability-${index + 1}`),
                weekday: Math.max(
                  0,
                  Math.min(6, Math.round(finite(row.weekday, index % 7))),
                ),
                startMinutes,
                endMinutes,
              },
            ];
          }),
        }
      : {}),
    preferences: {
      focusGoalMinutes: Math.max(
        0,
        Math.min(20_000, Math.round(finite(preferences.focusGoalMinutes, 720))),
      ),
      compactEvents: preferences.compactEvents === true,
    },
  };
}

function isPrivateTimetableLayer(layer: TimetableLayer) {
  return (
    layer.private === true ||
    layer.authority === "user" ||
    ((layer.kind === "personal" || layer.kind === "study") &&
      layer.authority !== "workspace" &&
      layer.authority !== "school" &&
      layer.authority !== "external")
  );
}

function withoutPersonalLayerFields(layer: TimetableLayer): TimetableLayer {
  const { private: _private, ...shared } = layer;
  return { ...shared, visible: true };
}

function withoutPersonalEventFields(event: TimetableEvent): TimetableEvent {
  const { overlay: _overlay, ...shared } = event;
  return shared;
}

/**
 * Produces the only timetable shape that may enter artifact content, Yjs,
 * history, search, AI context, or embeds. View state, private calendars,
 * personal availability, and source overlays belong to artifactUserStates.
 */
export function sharedTimetableContent(value: unknown): TimetableContent {
  const normalized = normalizeTimetableContent(value);
  const privateLayerIds = new Set(
    normalized.layers.filter(isPrivateTimetableLayer).map((layer) => layer.id),
  );
  return {
    timezone: normalized.timezone,
    layers: normalized.layers
      .filter((layer) => !privateLayerIds.has(layer.id))
      .map(withoutPersonalLayerFields),
    events: normalized.events
      .filter((event) => !privateLayerIds.has(event.layerId))
      .map(withoutPersonalEventFields),
  };
}

function defaultPersonalLayers(): TimetableLayer[] {
  return [
    {
      id: "personal",
      name: "Personal",
      kind: "personal",
      visible: true,
      color: "#4a91de",
      authority: "user",
      private: true,
    },
    {
      id: "study",
      name: "Study blocks",
      kind: "study",
      visible: true,
      color: "#7865ea",
      authority: "user",
      private: true,
    },
  ];
}

function normalizeOverlay(value: unknown): TimetableEventOverlay {
  const row = record(value);
  return {
    ...(typeof row.color === "string" ? { color: row.color.slice(0, 32) } : {}),
    ...(typeof row.note === "string"
      ? { note: row.note.slice(0, 250_000) }
      : {}),
    ...(typeof row.reminderMinutes === "number" &&
    Number.isFinite(row.reminderMinutes)
      ? {
          reminderMinutes: Math.max(0, Math.min(525_600, row.reminderMinutes)),
        }
      : {}),
    ...(typeof row.hidden === "boolean" ? { hidden: row.hidden } : {}),
    ...(typeof row.alternativeStart === "string" &&
    !Number.isNaN(Date.parse(row.alternativeStart))
      ? { alternativeStart: new Date(row.alternativeStart).toISOString() }
      : {}),
    ...(typeof row.alternativeEnd === "string" &&
    !Number.isNaN(Date.parse(row.alternativeEnd))
      ? { alternativeEnd: new Date(row.alternativeEnd).toISOString() }
      : {}),
  };
}

export function normalizeTimetablePersonalState(
  value: unknown,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): TimetablePersonalState {
  const input = record(value);
  const layersInput = Array.isArray(input.privateLayers)
    ? input.privateLayers
    : defaultPersonalLayers();
  const normalized = normalizeTimetableContent({
    timezone,
    layers: layersInput.length ? layersInput : defaultPersonalLayers(),
    events: Array.isArray(input.privateEvents) ? input.privateEvents : [],
    view: input.view,
    availability: input.availability,
    preferences: input.preferences,
  });
  const privateLayers = normalized.layers.map((layer) => ({
    ...layer,
    authority: "user" as const,
    private: true,
  }));
  const privateLayerIds = new Set(privateLayers.map((layer) => layer.id));
  const layerVisibility = Object.fromEntries(
    Object.entries(record(input.layerVisibility))
      .filter((entry): entry is [string, boolean] => {
        return (
          entry[0].trim().length > 0 &&
          entry[0].length <= 180 &&
          typeof entry[1] === "boolean"
        );
      })
      .slice(0, 1_000),
  );
  const eventOverlays = Object.fromEntries(
    Object.entries(record(input.eventOverlays))
      .filter(([eventId]) => eventId.trim().length > 0 && eventId.length <= 180)
      .slice(0, 100_000)
      .map(([eventId, overlay]) => [eventId, normalizeOverlay(overlay)])
      .filter(([, overlay]) => Object.keys(overlay).length > 0),
  );
  return {
    view: normalized.view!,
    layerVisibility,
    privateLayers,
    privateEvents: normalized.events
      .filter((event) => privateLayerIds.has(event.layerId))
      .map((event) => ({ ...event, overlay: undefined })),
    eventOverlays,
    availability: normalized.availability ?? [],
    preferences: normalized.preferences ?? {},
  };
}

export function mergeTimetableState(
  sharedValue: unknown,
  personalValue: unknown,
): TimetableContent {
  const shared = sharedTimetableContent(sharedValue);
  const personal = normalizeTimetablePersonalState(
    personalValue,
    shared.timezone,
  );
  return {
    timezone: shared.timezone,
    layers: [
      ...shared.layers.map((layer) => ({
        ...layer,
        visible: personal.layerVisibility[layer.id] ?? layer.visible,
      })),
      ...personal.privateLayers.map((layer) => ({
        ...layer,
        visible: personal.layerVisibility[layer.id] ?? layer.visible,
      })),
    ],
    events: [
      ...shared.events.map((event) => ({
        ...event,
        ...(personal.eventOverlays[event.id]
          ? { overlay: personal.eventOverlays[event.id] }
          : {}),
      })),
      ...personal.privateEvents.map((event) => ({
        ...event,
        ...(personal.eventOverlays[event.id]
          ? { overlay: personal.eventOverlays[event.id] }
          : {}),
      })),
    ],
    view: personal.view,
    availability: personal.availability,
    preferences: personal.preferences,
  };
}

export function partitionTimetableState(value: unknown) {
  const normalized = normalizeTimetableContent(value);
  const shared = sharedTimetableContent(normalized);
  const sharedLayerIds = new Set(shared.layers.map((layer) => layer.id));
  const privateLayers = normalized.layers.filter(
    (layer) => !sharedLayerIds.has(layer.id),
  );
  const privateLayerIds = new Set(privateLayers.map((layer) => layer.id));
  return {
    shared,
    personal: normalizeTimetablePersonalState(
      {
        view: normalized.view,
        layerVisibility: Object.fromEntries(
          normalized.layers.map((layer) => [layer.id, layer.visible]),
        ),
        privateLayers,
        privateEvents: normalized.events.filter((event) =>
          privateLayerIds.has(event.layerId),
        ),
        eventOverlays: Object.fromEntries(
          normalized.events.flatMap((event) =>
            event.overlay ? [[event.id, event.overlay] as const] : [],
          ),
        ),
        availability: normalized.availability,
        preferences: normalized.preferences,
      },
      normalized.timezone,
    ),
  };
}
