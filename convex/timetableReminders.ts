import { internalMutation, mutation, query } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { evaluateAccessForActor } from "./authorityShared";
import {
  getActorForAccountId,
  getAuthenticatedActor,
  type AuthenticatedActor,
} from "./identityShared";
import { compactReminderSourceGeneration } from "./reminderSource";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WEEK = 7 * DAY;
const DELIVERY_WINDOW = 5 * MINUTE;
const RECONCILE_BATCH = 100;

type Candidate = {
  eventId: string;
  reminderKey: string;
  eventTitle: string;
  eventStart: number;
  recurrence?: string;
  reminderMinutes: number;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function events(value: unknown) {
  const content = object(value);
  return Array.isArray(content.events) ? content.events.map(object) : [];
}

function recurrenceParts(value: unknown) {
  if (typeof value !== "string") return new Map<string, string>();
  return new Map(
    value
      .split(";")
      .map((part) => part.split("=", 2))
      .filter((part): part is [string, string] => part.length === 2)
      .map(([key, item]) => [key.toUpperCase(), item]),
  );
}

function parseUntil(value: string | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;
  const compact = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/,
  );
  if (!compact) return Number.POSITIVE_INFINITY;
  return Date.UTC(
    Number(compact[1]),
    Number(compact[2]) - 1,
    Number(compact[3]),
    Number(compact[4] ?? 23),
    Number(compact[5] ?? 59),
    Number(compact[6] ?? 59),
  );
}

function utcWeekStart(value: number) {
  const date = new Date(value);
  return (
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
    date.getUTCDay() * DAY
  );
}

function nextOccurrence(
  start: number,
  recurrence: string | undefined,
  reminderMinutes: number,
  notBeforeReminderAt: number,
) {
  const target = notBeforeReminderAt + reminderMinutes * MINUTE;
  const rule = recurrenceParts(recurrence);
  const frequency = rule.get("FREQ");
  const untilAt = parseUntil(rule.get("UNTIL"));
  const within = (candidate: number) =>
    candidate >= start && candidate >= target && candidate <= untilAt;
  if (!frequency) return within(start) ? start : undefined;
  const interval = Math.max(
    1,
    Math.min(10_000, Number(rule.get("INTERVAL")) || 1),
  );
  if (frequency === "DAILY") {
    const step = interval * DAY;
    const index = Math.max(0, Math.ceil((target - start) / step));
    const candidate = start + index * step;
    return within(candidate) ? candidate : undefined;
  }
  if (frequency === "WEEKLY") {
    const weekdays = (rule.get("BYDAY") ?? "")
      .split(",")
      .flatMap((day) => {
        const value =
          ({ SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 } as const)[
            day.slice(-2) as "SU"
          ];
        return value === undefined ? [] : [value];
      });
    const allowed = weekdays.length
      ? [...new Set(weekdays)].sort((a, b) => a - b)
      : [new Date(start).getUTCDay()];
    const startWeek = utcWeekStart(start);
    const targetWeek = Math.max(
      0,
      Math.floor((utcWeekStart(target) - startWeek) / WEEK),
    );
    const firstCycle = Math.floor(targetWeek / interval) * interval;
    const startDate = new Date(start);
    const timeOfDay =
      startDate.getUTCHours() * 60 * MINUTE +
      startDate.getUTCMinutes() * MINUTE +
      startDate.getUTCSeconds() * 1_000 +
      startDate.getUTCMilliseconds();
    for (const cycle of [firstCycle, firstCycle + interval]) {
      for (const weekday of allowed) {
        const candidate = startWeek + cycle * WEEK + weekday * DAY + timeOfDay;
        if (within(candidate)) return candidate;
      }
    }
    return undefined;
  }
  if (frequency === "MONTHLY") {
    const base = new Date(start);
    const targetDate = new Date(target);
    const delta =
      (targetDate.getUTCFullYear() - base.getUTCFullYear()) * 12 +
      targetDate.getUTCMonth() -
      base.getUTCMonth();
    const firstCycle = Math.max(0, Math.floor(delta / interval) * interval);
    for (const cycle of [firstCycle, firstCycle + interval]) {
      const candidate = new Date(start);
      candidate.setUTCMonth(base.getUTCMonth() + cycle);
      if (candidate.getUTCDate() !== base.getUTCDate()) continue;
      if (within(candidate.getTime())) return candidate.getTime();
    }
    return undefined;
  }
  return within(start) ? start : undefined;
}

function sharedEventFingerprint(artifact: Doc<"spectraArtifacts"> | null) {
  if (!artifact || artifact.blueprintKey !== "timetable") return null;
  return JSON.stringify({
    status: artifact.status,
    title: artifact.title,
    schoolId: artifact.schoolId,
    events: events(artifact.content).map((event) => ({
      id: event.id,
      title: event.title,
      start: event.start,
      recurrence: event.recurrence,
    })),
  });
}

function personalFingerprint(state: Doc<"artifactUserStates"> | null) {
  if (!state || state.kind !== "timetable") return null;
  const personal = object(state.state);
  return JSON.stringify({
    artifactId: state.artifactId,
    accountId: state.accountId,
    privateEvents: Array.isArray(personal.privateEvents)
      ? personal.privateEvents.map((candidate) => {
          const event = object(candidate);
          return {
            id: event.id,
            title: event.title,
            start: event.start,
            recurrence: event.recurrence,
            reminders: event.reminders,
          };
        })
      : [],
    eventOverlays: personal.eventOverlays,
  });
}

export function timetableReminderSourceChanged(
  oldDoc: Doc<"spectraArtifacts"> | null,
  newDoc: Doc<"spectraArtifacts"> | null,
) {
  return sharedEventFingerprint(oldDoc) !== sharedEventFingerprint(newDoc);
}

export function timetableReminderUserStateChanged(
  oldDoc: Doc<"artifactUserStates"> | null,
  newDoc: Doc<"artifactUserStates"> | null,
) {
  return personalFingerprint(oldDoc) !== personalFingerprint(newDoc);
}

export function timetableReminderSourceGeneration(
  artifact: Doc<"spectraArtifacts"> | null,
) {
  return compactReminderSourceGeneration(sharedEventFingerprint(artifact));
}

export function timetableReminderUserStateGeneration(
  state: Doc<"artifactUserStates"> | null,
) {
  return compactReminderSourceGeneration(personalFingerprint(state));
}

function combinedSourceGeneration(
  artifact: Doc<"spectraArtifacts">,
  state: Doc<"artifactUserStates">,
) {
  return `${timetableReminderSourceGeneration(artifact)}:${timetableReminderUserStateGeneration(state)}`;
}

function candidatesFor(
  artifact: Doc<"spectraArtifacts">,
  state: Doc<"artifactUserStates">,
) {
  const personal = object(state.state);
  const privateEvents = Array.isArray(personal.privateEvents)
    ? personal.privateEvents.map(object)
    : [];
  const overlays = object(personal.eventOverlays);
  const candidates = new Map<string, Candidate>();
  for (const event of privateEvents) {
    const eventStart = Date.parse(String(event.start ?? ""));
    if (!Number.isFinite(eventStart)) continue;
    const reminders = Array.isArray(event.reminders)
      ? event.reminders.map(object)
      : [];
    reminders.forEach((reminder, index) => {
      const reminderMinutes = Number(reminder.minutesBefore);
      if (
        !Number.isFinite(reminderMinutes) ||
        reminderMinutes < 0 ||
        reminderMinutes > 525_600
      )
        return;
      const eventId = String(event.id ?? "event").slice(0, 180);
      const reminderKey = String(
        reminder.id ?? `reminder-${index + 1}`,
      ).slice(0, 180);
      candidates.set(`${eventId}:${reminderKey}`, {
        eventId,
        reminderKey,
        eventTitle: String(event.title ?? artifact.title).slice(0, 300),
        eventStart,
        recurrence:
          typeof event.recurrence === "string" ? event.recurrence : undefined,
        reminderMinutes: Math.round(reminderMinutes),
      });
    });
  }
  for (const event of events(artifact.content)) {
    const eventId = typeof event.id === "string" ? event.id.slice(0, 180) : "";
    const eventStart = Date.parse(String(event.start ?? ""));
    const reminderMinutes = Number(
      object(overlays[eventId]).reminderMinutes,
    );
    if (
      !eventId ||
      !Number.isFinite(eventStart) ||
      !Number.isFinite(reminderMinutes) ||
      reminderMinutes < 0 ||
      reminderMinutes > 525_600
    )
      continue;
    candidates.set(`${eventId}:personal-overlay`, {
      eventId,
      reminderKey: "personal-overlay",
      eventTitle: String(event.title ?? artifact.title).slice(0, 300),
      eventStart,
      recurrence:
        typeof event.recurrence === "string" ? event.recurrence : undefined,
      reminderMinutes: Math.round(reminderMinutes),
    });
  }
  return [...candidates.values()];
}

async function cancelDelivery(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  row: Doc<"timetableReminderDeliveries">,
) {
  if (row.scheduledFunctionId)
    await ctx.scheduler.cancel(row.scheduledFunctionId);
  await ctx.db.patch(row._id, {
    status: "cancelled",
    scheduledFunctionId: undefined,
    updatedAt: Date.now(),
  });
}

async function scheduleCandidate(
  ctx: MutationCtx,
  artifact: Doc<"spectraArtifacts">,
  state: Doc<"artifactUserStates">,
  candidate: Candidate,
  generation: string,
  pending: Doc<"timetableReminderDeliveries"> | undefined,
) {
  let notBefore = Date.now() - DELIVERY_WINDOW;
  for (let replay = 0; replay < 4; replay += 1) {
    const occurrenceStart = nextOccurrence(
      candidate.eventStart,
      candidate.recurrence,
      candidate.reminderMinutes,
      notBefore,
    );
    if (occurrenceStart === undefined) {
      if (pending) await cancelDelivery(ctx, pending);
      return false;
    }
    const scheduledFor = occurrenceStart - candidate.reminderMinutes * MINUTE;
    const idempotencyKey =
      `${artifact._id}:${state.accountId}:${candidate.eventId}:${candidate.reminderKey}:${occurrenceStart}`.slice(
        0,
        500,
      );
    if (
      pending &&
      pending.idempotencyKey === idempotencyKey &&
      pending.status === "pending"
    ) {
      await ctx.db.patch(pending._id, {
        sourceGeneration: generation,
        nextReminderAt: scheduledFor,
        updatedAt: Date.now(),
      });
      return true;
    }
    const existing = await ctx.db
      .query("timetableReminderDeliveries")
      .withIndex("by_idempotency", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existing?.status === "delivered") {
      notBefore = scheduledFor + 1;
      continue;
    }
    if (existing) {
      if (pending && pending._id !== existing._id)
        await cancelDelivery(ctx, pending);
      const now = Date.now();
      const scheduledFunctionId = await ctx.scheduler.runAt(
        Math.max(now, scheduledFor),
        internal.timetableReminders.deliver,
        { deliveryId: existing._id },
      );
      await ctx.db.patch(existing._id, {
        artifactId: artifact._id,
        schoolId: state.schoolId,
        recipientAccountId: state.accountId,
        eventId: candidate.eventId,
        reminderKey: candidate.reminderKey,
        eventTitle: candidate.eventTitle,
        eventStart: candidate.eventStart,
        recurrence: candidate.recurrence,
        reminderMinutes: candidate.reminderMinutes,
        occurrenceStart,
        scheduledFor,
        nextReminderAt: scheduledFor,
        sourceGeneration: generation,
        status: "pending",
        scheduledFunctionId,
        deliveredAt: undefined,
        readAt: undefined,
        updatedAt: now,
      });
      return true;
    }
    if (pending) await cancelDelivery(ctx, pending);
    const now = Date.now();
    const deliveryId = await ctx.db.insert("timetableReminderDeliveries", {
      artifactId: artifact._id,
      schoolId: state.schoolId,
      recipientAccountId: state.accountId,
      eventId: candidate.eventId,
      reminderKey: candidate.reminderKey,
      eventTitle: candidate.eventTitle,
      eventStart: candidate.eventStart,
      recurrence: candidate.recurrence,
      reminderMinutes: candidate.reminderMinutes,
      occurrenceStart,
      scheduledFor,
      nextReminderAt: scheduledFor,
      sourceGeneration: generation,
      idempotencyKey,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const scheduledFunctionId = await ctx.scheduler.runAt(
      Math.max(now, scheduledFor),
      internal.timetableReminders.deliver,
      { deliveryId },
    );
    await ctx.db.patch(deliveryId, { scheduledFunctionId });
    return true;
  }
  if (pending) await cancelDelivery(ctx, pending);
  return false;
}

export const reconcileArtifact = internalMutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    expectedSourceGeneration: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (
      args.expectedSourceGeneration !== undefined &&
      timetableReminderSourceGeneration(artifact) !==
        args.expectedSourceGeneration
    )
      return { stale: true, accounts: 0 };
    const pending = await ctx.db
      .query("timetableReminderDeliveries")
      .withIndex("by_artifact_status", (q) =>
        q.eq("artifactId", args.artifactId).eq("status", "pending"),
      )
      .collect();
    if (
      !artifact ||
      artifact.status !== "active" ||
      artifact.blueprintKey !== "timetable"
    ) {
      await Promise.all(pending.map((row) => cancelDelivery(ctx, row)));
      return { stale: false, accounts: 0 };
    }
    const states = await ctx.db
      .query("artifactUserStates")
      .withIndex("by_artifact_updated", (q) =>
        q.eq("artifactId", artifact._id),
      )
      .take(1_000);
    for (const state of states) {
      await ctx.scheduler.runAfter(
        0,
        internal.timetableReminders.reconcileUserState,
        {
          artifactId: artifact._id,
          accountId: state.accountId,
          expectedArtifactSourceGeneration:
            timetableReminderSourceGeneration(artifact),
          expectedStateSourceGeneration:
            timetableReminderUserStateGeneration(state),
          offset: 0,
        },
      );
    }
    const accounts = new Set(states.map((state) => String(state.accountId)));
    await Promise.all(
      pending
        .filter((row) => !accounts.has(String(row.recipientAccountId)))
        .map((row) => cancelDelivery(ctx, row)),
    );
    return { stale: false, accounts: states.length };
  },
});

export const reconcileUserState = internalMutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    accountId: v.id("accounts"),
    expectedArtifactSourceGeneration: v.optional(v.string()),
    expectedStateSourceGeneration: v.optional(v.string()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const [artifact, state] = await Promise.all([
      ctx.db.get(args.artifactId),
      ctx.db
        .query("artifactUserStates")
        .withIndex("by_artifact_account_kind", (q) =>
          q
            .eq("artifactId", args.artifactId)
            .eq("accountId", args.accountId)
            .eq("kind", "timetable"),
        )
        .unique(),
    ]);
    const pending = await ctx.db
      .query("timetableReminderDeliveries")
      .withIndex("by_artifact_recipient_status", (q) =>
        q
          .eq("artifactId", args.artifactId)
          .eq("recipientAccountId", args.accountId)
          .eq("status", "pending"),
      )
      .collect();
    if (
      !artifact ||
      !state ||
      artifact.status !== "active" ||
      artifact.blueprintKey !== "timetable" ||
      (args.expectedArtifactSourceGeneration !== undefined &&
        timetableReminderSourceGeneration(artifact) !==
          args.expectedArtifactSourceGeneration) ||
      (args.expectedStateSourceGeneration !== undefined &&
        timetableReminderUserStateGeneration(state) !==
          args.expectedStateSourceGeneration)
    ) {
      if (!artifact || !state || artifact.status !== "active")
        await Promise.all(pending.map((row) => cancelDelivery(ctx, row)));
      return { stale: true, processed: 0 };
    }
    const actor = await getActorForAccountId(ctx, state.accountId);
    const access = actor
      ? await evaluateAccessForActor(ctx, actor, "artifact", artifact._id)
      : null;
    if (
      !actor ||
      actor.schoolId !== artifact.schoolId ||
      !access?.allowed ||
      !access.capabilities.includes("read")
    ) {
      await Promise.all(pending.map((row) => cancelDelivery(ctx, row)));
      return { stale: false, processed: 0 };
    }
    const candidates = candidatesFor(artifact, state);
    const offset = Math.max(0, args.offset ?? 0);
    const batch = candidates.slice(offset, offset + RECONCILE_BATCH);
    const generation = combinedSourceGeneration(artifact, state);
    const pendingByIdentity = new Map(
      pending.map((row) => [`${row.eventId}:${row.reminderKey}`, row] as const),
    );
    for (const candidate of batch) {
      await scheduleCandidate(
        ctx,
        artifact,
        state,
        candidate,
        generation,
        pendingByIdentity.get(`${candidate.eventId}:${candidate.reminderKey}`),
      );
    }
    const nextOffset = offset + batch.length;
    if (nextOffset < candidates.length) {
      await ctx.scheduler.runAfter(
        0,
        internal.timetableReminders.reconcileUserState,
        { ...args, offset: nextOffset },
      );
    } else {
      await Promise.all(
        pending
          .filter((row) => row.sourceGeneration !== generation)
          .filter(
            (row) =>
              !candidates.some(
                (candidate) =>
                  `${candidate.eventId}:${candidate.reminderKey}` ===
                  `${row.eventId}:${row.reminderKey}`,
              ),
          )
          .map((row) => cancelDelivery(ctx, row)),
      );
    }
    return { stale: false, processed: batch.length };
  },
});

export const deliver = internalMutation({
  args: { deliveryId: v.id("timetableReminderDeliveries") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.status !== "pending") return { delivered: false };
    const [artifact, state] = await Promise.all([
      ctx.db.get(row.artifactId),
      ctx.db
        .query("artifactUserStates")
        .withIndex("by_artifact_account_kind", (q) =>
          q
            .eq("artifactId", row.artifactId)
            .eq("accountId", row.recipientAccountId)
            .eq("kind", "timetable"),
        )
        .unique(),
    ]);
    const generation =
      artifact && state ? combinedSourceGeneration(artifact, state) : null;
    const actor = await getActorForAccountId(ctx, row.recipientAccountId);
    const access =
      artifact && actor
        ? await evaluateAccessForActor(ctx, actor, "artifact", artifact._id)
        : null;
    if (
      !artifact ||
      !state ||
      !actor ||
      actor.schoolId !== artifact.schoolId ||
      !access?.allowed ||
      !access.capabilities.includes("read") ||
      artifact.status !== "active" ||
      artifact.blueprintKey !== "timetable" ||
      row.eventStart === undefined ||
      row.reminderMinutes === undefined ||
      generation !== row.sourceGeneration
    ) {
      await ctx.db.patch(row._id, {
        status: "cancelled",
        scheduledFunctionId: undefined,
        updatedAt: Date.now(),
      });
      return { delivered: false };
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "delivered",
      scheduledFunctionId: undefined,
      deliveredAt: now,
      updatedAt: now,
    });
    const nextStart = nextOccurrence(
      row.eventStart,
      row.recurrence,
      row.reminderMinutes,
      row.scheduledFor + 1,
    );
    if (nextStart === undefined) return { delivered: true };
    const scheduledFor = nextStart - row.reminderMinutes * MINUTE;
    const idempotencyKey =
      `${row.artifactId}:${row.recipientAccountId}:${row.eventId}:${row.reminderKey}:${nextStart}`.slice(
        0,
        500,
      );
    const existing = await ctx.db
      .query("timetableReminderDeliveries")
      .withIndex("by_idempotency", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (!existing) {
      const deliveryId = await ctx.db.insert("timetableReminderDeliveries", {
        artifactId: row.artifactId,
        schoolId: row.schoolId,
        recipientAccountId: row.recipientAccountId,
        eventId: row.eventId,
        reminderKey: row.reminderKey,
        eventTitle: row.eventTitle,
        eventStart: row.eventStart,
        recurrence: row.recurrence,
        reminderMinutes: row.reminderMinutes,
        occurrenceStart: nextStart,
        scheduledFor,
        nextReminderAt: scheduledFor,
        sourceGeneration: row.sourceGeneration,
        idempotencyKey,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      const scheduledFunctionId = await ctx.scheduler.runAt(
        scheduledFor,
        internal.timetableReminders.deliver,
        { deliveryId },
      );
      await ctx.db.patch(deliveryId, { scheduledFunctionId });
    }
    return { delivered: true };
  },
});

export const safetySweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [overdue, missingHandle] = await Promise.all([
      ctx.db
        .query("timetableReminderDeliveries")
        .withIndex("by_status_next_reminder", (q) =>
          q.eq("status", "pending").lte("nextReminderAt", now),
        )
        .take(200),
      ctx.db
        .query("timetableReminderDeliveries")
        .withIndex("by_status_next_reminder", (q) =>
          q.eq("status", "pending").eq("nextReminderAt", undefined),
        )
        .take(100),
    ]);
    const rows = [
      ...new Map(
        [...overdue, ...missingHandle].map((row) => [row._id, row]),
      ).values(),
    ];
    for (const row of rows) {
      if (row.scheduledFunctionId)
        await ctx.scheduler.cancel(row.scheduledFunctionId);
      const nextReminderAt = row.nextReminderAt ?? row.scheduledFor;
      const scheduledFunctionId = await ctx.scheduler.runAt(
        Math.max(now, nextReminderAt),
        internal.timetableReminders.deliver,
        { deliveryId: row._id },
      );
      await ctx.db.patch(row._id, {
        nextReminderAt,
        scheduledFunctionId,
        updatedAt: now,
      });
    }
    return { scanned: rows.length, rescheduled: rows.length };
  },
});

export async function loadTimetableReminderNotifications(
  ctx: QueryCtx,
  actor: AuthenticatedActor,
  args: { unreadOnly?: boolean; limit?: number },
) {
  const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
  const rows = await ctx.db
    .query("timetableReminderDeliveries")
    .withIndex("by_recipient_created", (q) =>
      q.eq("recipientAccountId", actor.accountId),
    )
    .order("desc")
    .take(limit * 3);
  const visible = [];
  for (const row of rows) {
    if (row.status !== "delivered" || (args.unreadOnly && row.readAt))
      continue;
    const artifact = await ctx.db.get(row.artifactId);
    if (!artifact || artifact.status !== "active") continue;
    const access = await evaluateAccessForActor(
      ctx,
      actor,
      "artifact",
      artifact._id,
    );
    if (!access.allowed || !access.capabilities.includes("read")) continue;
    visible.push({ ...row, artifactTitle: artifact.title });
    if (visible.length >= limit) break;
  }
  return visible;
}

export const listMine = query({
  args: { unreadOnly: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
    return loadTimetableReminderNotifications(ctx, actor, args);
  },
});

export const markRead = mutation({
  args: { deliveryIds: v.array(v.id("timetableReminderDeliveries")) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
    let updated = 0;
    const now = Date.now();
    for (const id of [...new Set(args.deliveryIds)].slice(0, 100)) {
      const row = await ctx.db.get(id);
      if (!row || row.recipientAccountId !== actor.accountId || row.readAt)
        continue;
      await ctx.db.patch(row._id, { readAt: now, updatedAt: now });
      updated += 1;
    }
    return { updated };
  },
});
