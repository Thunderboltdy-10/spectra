import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireArtifactCapability } from "./spectraShared";

const MAX_STATE_BYTES = 800_000;
const MAX_PRIVATE_LAYERS = 200;
const MAX_PRIVATE_EVENTS = 20_000;
const MAX_OVERLAYS = 20_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedText(value: unknown, maximum: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, maximum) : fallback;
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function iso(value: unknown, fallback: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    return fallback;
  return new Date(value).toISOString();
}

function sanitizeView(value: unknown) {
  const row = record(value);
  const today = new Date().toISOString().slice(0, 10);
  return {
    kind:
      row.kind === "day" || row.kind === "month" || row.kind === "agenda"
        ? row.kind
        : ("week" as const),
    anchorDate:
      typeof row.anchorDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.anchorDate)
        ? row.anchorDate
        : today,
    weekStartsOn: row.weekStartsOn === 0 ? (0 as const) : (1 as const),
    startHour: Math.max(0, Math.min(22, Math.round(finite(row.startHour, 8)))),
    endHour: Math.max(2, Math.min(24, Math.round(finite(row.endHour, 21)))),
    showWeekends: row.showWeekends !== false,
  };
}

function sanitizeLayer(value: unknown, index: number) {
  const row = record(value);
  const kind =
    row.kind === "study"
      ? ("study" as const)
      : row.kind === "tasks"
        ? ("tasks" as const)
        : ("personal" as const);
  return {
    id: boundedText(row.id, 180, `personal-${index + 1}`),
    name: boundedText(row.name, 120, `Personal ${index + 1}`),
    kind,
    visible: row.visible !== false,
    color: boundedText(row.color, 32, kind === "study" ? "#7865ea" : "#4a91de"),
    authority: "user" as const,
    private: true,
  };
}

function sanitizeReminder(value: unknown, index: number) {
  const row = record(value);
  return {
    id: boundedText(row.id, 180, `reminder-${index + 1}`),
    minutesBefore: Math.max(0, Math.min(525_600, finite(row.minutesBefore, 0))),
    method: "in_app" as const,
  };
}

function sanitizeEvent(
  value: unknown,
  index: number,
  layerIds: ReadonlySet<string>,
  fallbackLayerId: string,
) {
  const row = record(value);
  const start = iso(row.start, new Date().toISOString());
  let end = iso(
    row.end,
    new Date(Date.parse(start) + 60 * 60_000).toISOString(),
  );
  if (Date.parse(end) <= Date.parse(start))
    end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
  const requestedLayerId = boundedText(row.layerId, 180);
  return {
    id: boundedText(row.id, 180, `personal-event-${index + 1}`),
    layerId: layerIds.has(requestedLayerId)
      ? requestedLayerId
      : fallbackLayerId,
    title: boundedText(row.title, 300, "Untitled event"),
    start,
    end,
    allDay: row.allDay === true,
    ...(typeof row.timezone === "string"
      ? { timezone: row.timezone.slice(0, 100) }
      : {}),
    ...(typeof row.recurrence === "string"
      ? { recurrence: row.recurrence.slice(0, 500) }
      : {}),
    ...(Array.isArray(row.recurrenceExceptions)
      ? {
          recurrenceExceptions: row.recurrenceExceptions
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.slice(0, 120))
            .slice(0, 500),
        }
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
        : ("confirmed" as const),
    availability:
      row.availability === "free" ? ("free" as const) : ("busy" as const),
    ...(Array.isArray(row.artifactIds)
      ? {
          artifactIds: row.artifactIds
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.slice(0, 180))
            .slice(0, 100),
        }
      : {}),
    ...(typeof row.taskId === "string"
      ? { taskId: row.taskId.slice(0, 180) }
      : {}),
    ...(Array.isArray(row.reminders)
      ? {
          reminders: row.reminders
            .slice(0, 50)
            .map((entry, reminderIndex) =>
              sanitizeReminder(entry, reminderIndex),
            ),
        }
      : {}),
    provenance: { actor: "user" as const },
  };
}

function sanitizeOverlay(value: unknown) {
  const row = record(value);
  const start =
    typeof row.alternativeStart === "string" &&
    !Number.isNaN(Date.parse(row.alternativeStart))
      ? new Date(row.alternativeStart).toISOString()
      : undefined;
  const end =
    typeof row.alternativeEnd === "string" &&
    !Number.isNaN(Date.parse(row.alternativeEnd))
      ? new Date(row.alternativeEnd).toISOString()
      : undefined;
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
    ...(start ? { alternativeStart: start } : {}),
    ...(end && (!start || Date.parse(end) > Date.parse(start))
      ? { alternativeEnd: end }
      : {}),
  };
}

export function sanitizeTimetableUserState(value: unknown) {
  const input = record(value);
  const privateLayers = (
    Array.isArray(input.privateLayers) ? input.privateLayers : []
  )
    .slice(0, MAX_PRIVATE_LAYERS)
    .map(sanitizeLayer);
  if (privateLayers.length === 0) {
    privateLayers.push(
      sanitizeLayer(
        {
          id: "personal",
          name: "Personal",
          kind: "personal",
          color: "#4a91de",
        },
        0,
      ),
      sanitizeLayer(
        {
          id: "study",
          name: "Study blocks",
          kind: "study",
          color: "#7865ea",
        },
        1,
      ),
    );
  }
  const layerIds = new Set(privateLayers.map((layer) => layer.id));
  const fallbackLayerId = privateLayers[0]!.id;
  const layerVisibility = Object.fromEntries(
    Object.entries(record(input.layerVisibility))
      .filter(
        (entry): entry is [string, boolean] =>
          entry[0].trim().length > 0 &&
          entry[0].length <= 180 &&
          typeof entry[1] === "boolean",
      )
      .slice(0, 1_000),
  );
  const eventOverlays = Object.fromEntries(
    Object.entries(record(input.eventOverlays))
      .filter(([eventId]) => eventId.trim().length > 0 && eventId.length <= 180)
      .slice(0, MAX_OVERLAYS)
      .map(([eventId, overlay]) => [eventId, sanitizeOverlay(overlay)])
      .filter(([, overlay]) => Object.keys(overlay).length > 0),
  );
  const availability = (
    Array.isArray(input.availability) ? input.availability : []
  )
    .slice(0, 500)
    .map((candidate, index) => {
      const row = record(candidate);
      const startMinutes = Math.max(
        0,
        Math.min(1_439, Math.round(finite(row.startMinutes, 9 * 60))),
      );
      return {
        id: boundedText(row.id, 180, `availability-${index + 1}`),
        weekday: Math.max(
          0,
          Math.min(6, Math.round(finite(row.weekday, index % 7))),
        ),
        startMinutes,
        endMinutes: Math.max(
          startMinutes + 1,
          Math.min(1_440, Math.round(finite(row.endMinutes, 17 * 60))),
        ),
      };
    });
  const preferences = record(input.preferences);
  return {
    view: sanitizeView(input.view),
    layerVisibility,
    privateLayers,
    privateEvents: (Array.isArray(input.privateEvents)
      ? input.privateEvents
      : []
    )
      .slice(0, MAX_PRIVATE_EVENTS)
      .map((event, index) =>
        sanitizeEvent(event, index, layerIds, fallbackLayerId),
      ),
    eventOverlays,
    availability,
    preferences: {
      focusGoalMinutes: Math.max(
        0,
        Math.min(20_000, Math.round(finite(preferences.focusGoalMinutes, 720))),
      ),
      compactEvents: preferences.compactEvents === true,
    },
  };
}

export function personalStateFromLegacyTimetable(contentValue: unknown) {
  const content = record(contentValue);
  const layers = Array.isArray(content.layers) ? content.layers : [];
  const privateLayers = layers.filter((candidate) => {
    const layer = record(candidate);
    const authority =
      typeof layer.authority === "string" ? layer.authority : undefined;
    return (
      layer.private === true ||
      authority === "user" ||
      ((layer.kind === "personal" || layer.kind === "study") &&
        authority !== "workspace" &&
        authority !== "school" &&
        authority !== "external")
    );
  });
  const privateLayerIds = new Set(
    privateLayers.flatMap((candidate) => {
      const id = record(candidate).id;
      return typeof id === "string" ? [id] : [];
    }),
  );
  const events = Array.isArray(content.events) ? content.events : [];
  return sanitizeTimetableUserState({
    view: content.view,
    layerVisibility: Object.fromEntries(
      layers.flatMap((candidate) => {
        const layer = record(candidate);
        return typeof layer.id === "string"
          ? [[layer.id, layer.visible !== false]]
          : [];
      }),
    ),
    privateLayers,
    privateEvents: events.filter((candidate) => {
      const layerId = record(candidate).layerId;
      return typeof layerId === "string" && privateLayerIds.has(layerId);
    }),
    eventOverlays: Object.fromEntries(
      events.flatMap((candidate) => {
        const event = record(candidate);
        return typeof event.id === "string" &&
          event.overlay &&
          typeof event.overlay === "object"
          ? [[event.id, event.overlay]]
          : [];
      }),
    ),
    availability: content.availability,
    preferences: content.preferences,
  });
}

export const get = query({
  args: {
    artifactId: v.id("spectraArtifacts"),
    kind: v.literal("timetable"),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "read",
    );
    if (artifact.blueprintKey !== "timetable" || artifact.status === "deleted")
      throw new Error("TIMETABLE_UNAVAILABLE");
    const state = await ctx.db
      .query("artifactUserStates")
      .withIndex("by_artifact_account_kind", (q) =>
        q
          .eq("artifactId", artifact._id)
          .eq("accountId", actor.accountId)
          .eq("kind", args.kind),
      )
      .unique();
    return state
      ? {
          state: state.state,
          revision: state.revision,
          updatedAt: state.updatedAt,
        }
      : {
          state: personalStateFromLegacyTimetable(artifact.content),
          revision: 0,
          updatedAt: null,
        };
  },
});

export const put = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    kind: v.literal("timetable"),
    state: v.any(),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "read",
    );
    if (artifact.blueprintKey !== "timetable" || artifact.status === "deleted")
      throw new Error("TIMETABLE_UNAVAILABLE");
    const state = sanitizeTimetableUserState(args.state);
    const serialized = JSON.stringify(state);
    const byteLength = new TextEncoder().encode(serialized).byteLength;
    if (byteLength > MAX_STATE_BYTES)
      throw new Error("TIMETABLE_PERSONAL_STATE_TOO_LARGE");
    const existing = await ctx.db
      .query("artifactUserStates")
      .withIndex("by_artifact_account_kind", (q) =>
        q
          .eq("artifactId", artifact._id)
          .eq("accountId", actor.accountId)
          .eq("kind", args.kind),
      )
      .unique();
    const now = Date.now();
    const revision = (existing?.revision ?? 0) + 1;
    if (existing) {
      await ctx.db.patch(existing._id, {
        state,
        revision,
        byteLength,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("artifactUserStates", {
        artifactId: artifact._id,
        schoolId: actor.schoolId,
        accountId: actor.accountId,
        kind: args.kind,
        state,
        revision,
        byteLength,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { state, revision, updatedAt: now };
  },
});
