import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { evaluateAccessForActor } from "./authorityShared";
import { getActorForAccountId, getAuthenticatedActor } from "./identityShared";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const DELIVERY_WINDOW = 5 * MINUTE;
const SCHEDULE_HORIZON = 31 * DAY;

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

function occurrenceNear(
  start: number,
  recurrence: unknown,
  reminderMinutes: number,
  now: number,
) {
  const target = now + reminderMinutes * MINUTE;
  const rule = recurrenceParts(recurrence);
  const frequency = rule.get("FREQ");
  if (!frequency) return [start];
  const interval = Math.max(
    1,
    Math.min(10_000, Number(rule.get("INTERVAL")) || 1),
  );
  const candidates = new Set<number>();
  if (frequency === "DAILY") {
    const step = interval * DAY;
    const index = Math.max(0, Math.floor((target - start) / step));
    for (const offset of [-1, 0, 1])
      candidates.add(start + (index + offset) * step);
  } else if (frequency === "WEEKLY") {
    const weekdays = (rule.get("BYDAY") ?? "")
      .split(",")
      .map(
        (day) =>
          ({ SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 })[
            day.slice(-2) as "SU"
          ],
      )
      .filter((day): day is number => day !== undefined);
    const allowed = weekdays.length
      ? new Set(weekdays)
      : new Set([new Date(start).getUTCDay()]);
    for (let offset = -8; offset <= 8; offset += 1) {
      const candidate = new Date(target + offset * DAY);
      candidate.setUTCHours(
        new Date(start).getUTCHours(),
        new Date(start).getUTCMinutes(),
        new Date(start).getUTCSeconds(),
        new Date(start).getUTCMilliseconds(),
      );
      const value = candidate.getTime();
      const weeks = Math.floor((value - start) / (7 * DAY));
      if (
        value >= start &&
        weeks % interval === 0 &&
        allowed.has(candidate.getUTCDay())
      )
        candidates.add(value);
    }
  } else if (frequency === "MONTHLY") {
    const base = new Date(start);
    const targetDate = new Date(target);
    const monthDelta =
      (targetDate.getUTCFullYear() - base.getUTCFullYear()) * 12 +
      targetDate.getUTCMonth() -
      base.getUTCMonth();
    const index = Math.max(0, Math.floor(monthDelta / interval));
    for (const offset of [-1, 0, 1]) {
      const month = (index + offset) * interval;
      const candidate = new Date(start);
      candidate.setUTCMonth(base.getUTCMonth() + month);
      if (candidate.getUTCDate() === base.getUTCDate())
        candidates.add(candidate.getTime());
    }
  }
  const until = rule.get("UNTIL");
  const untilAt = until ? Date.parse(until) : Number.POSITIVE_INFINITY;
  return [...candidates].filter(
    (candidate) => candidate >= start && candidate <= untilAt,
  );
}

function scheduledOccurrence(
  event: Record<string, unknown>,
  reminderMinutes: number,
  now: number,
) {
  const start = Date.parse(String(event.start ?? ""));
  if (!Number.isFinite(start)) return undefined;
  return occurrenceNear(start, event.recurrence, reminderMinutes, now).find(
    (occurrence) => {
      const scheduled = occurrence - reminderMinutes * MINUTE;
      return (
        scheduled <= now + SCHEDULE_HORIZON &&
        scheduled > now - DELIVERY_WINDOW
      );
    },
  );
}

export const dispatchDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const states = await ctx.db
      .query("artifactUserStates")
      .withIndex("by_kind_updated", (q) => q.eq("kind", "timetable"))
      .take(5_000);
    let delivered = 0;
    for (const state of states) {
      const artifact = await ctx.db.get(state.artifactId);
      if (
        !artifact ||
        artifact.status !== "active" ||
        artifact.blueprintKey !== "timetable"
      )
        continue;
      const actor = await getActorForAccountId(ctx, state.accountId);
      if (!actor || actor.schoolId !== state.schoolId) continue;
      const access = await evaluateAccessForActor(
        ctx,
        actor,
        "artifact",
        artifact._id,
      );
      if (!access.allowed || !access.capabilities.includes("read")) continue;
      const personal = object(state.state);
      const privateEvents = Array.isArray(personal.privateEvents)
        ? personal.privateEvents.map(object)
        : [];
      const overlays = object(personal.eventOverlays);
      const candidates: Array<{
        event: Record<string, unknown>;
        reminderKey: string;
        minutes: number;
      }> = [];
      for (const event of privateEvents) {
        const reminders = Array.isArray(event.reminders)
          ? event.reminders.map(object)
          : [];
        reminders.forEach((reminder, index) => {
          const minutes = Number(reminder.minutesBefore);
          if (Number.isFinite(minutes) && minutes >= 0 && minutes <= 525_600)
            candidates.push({
              event,
              reminderKey: String(reminder.id ?? `reminder-${index + 1}`).slice(
                0,
                180,
              ),
              minutes: Math.round(minutes),
            });
        });
      }
      for (const event of events(artifact.content)) {
        const eventId = typeof event.id === "string" ? event.id : "";
        const overlay = object(overlays[eventId]);
        const minutes = Number(overlay.reminderMinutes);
        if (
          eventId &&
          Number.isFinite(minutes) &&
          minutes >= 0 &&
          minutes <= 525_600
        )
          candidates.push({
            event,
            reminderKey: "personal-overlay",
            minutes: Math.round(minutes),
          });
      }
      for (const candidate of candidates.slice(0, 20_000)) {
        const occurrenceStart = scheduledOccurrence(
          candidate.event,
          candidate.minutes,
          now,
        );
        if (occurrenceStart === undefined) continue;
        const eventId = String(candidate.event.id ?? "event").slice(0, 180);
        const idempotencyKey =
          `${artifact._id}:${state.accountId}:${eventId}:${candidate.reminderKey}:${occurrenceStart}`.slice(
            0,
            500,
          );
        const existing = await ctx.db
          .query("timetableReminderDeliveries")
          .withIndex("by_idempotency", (q) =>
            q.eq("idempotencyKey", idempotencyKey),
          )
          .unique();
        if (existing) continue;
        const deliveryId = await ctx.db.insert("timetableReminderDeliveries", {
          artifactId: artifact._id,
          schoolId: state.schoolId,
          recipientAccountId: state.accountId,
          eventId,
          reminderKey: candidate.reminderKey,
          eventTitle: String(candidate.event.title ?? artifact.title).slice(
            0,
            300,
          ),
          occurrenceStart,
          scheduledFor: occurrenceStart - candidate.minutes * MINUTE,
          idempotencyKey,
          status: "pending",
          createdAt: now,
        });
        await ctx.scheduler.runAt(
          Math.max(now, occurrenceStart - candidate.minutes * MINUTE),
          internal.timetableReminders.deliver,
          { deliveryId },
        );
        delivered += 1;
      }
    }
    return { scanned: states.length, delivered };
  },
});

export const deliver = internalMutation({
  args: { deliveryId: v.id("timetableReminderDeliveries") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.status === "delivered") return { delivered: false };
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "delivered",
      deliveredAt: now,
    });
    return { delivered: true };
  },
});

export const listMine = query({
  args: { unreadOnly: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
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
      if (row.status === "pending" || (args.unreadOnly && row.readAt)) continue;
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
      await ctx.db.patch(row._id, { readAt: now });
      updated += 1;
    }
    return { updated };
  },
});
