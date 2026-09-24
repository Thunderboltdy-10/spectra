import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { evaluateAccessForActor } from "./authorityShared";
import {
  getActorForAccountId,
  getAuthenticatedActor,
  type AuthenticatedActor,
} from "./identityShared";
import { compactReminderSourceGeneration } from "./reminderSource";

const DAY = 24 * 60 * 60_000;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function accountIds(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((candidate) => {
        const accountId = object(candidate).accountId;
        return typeof accountId === "string" && accountId.trim()
          ? [accountId.trim()]
          : [];
      })
    : [];
}

function reminderRows(content: Record<string, unknown>) {
  return Array.isArray(content.reminders)
    ? content.reminders.flatMap((candidate, index) => {
        const reminder = object(candidate);
        if (reminder.enabled === false) return [];
        const minutesBefore = Number(reminder.minutesBefore);
        if (
          !Number.isFinite(minutesBefore) ||
          minutesBefore < 0 ||
          minutesBefore > 525_600
        )
          return [];
        return [
          {
            id:
              typeof reminder.id === "string" && reminder.id.trim()
                ? reminder.id.trim().slice(0, 180)
                : `reminder-${index + 1}`,
            minutesBefore: Math.round(minutesBefore),
          },
        ];
      })
    : [];
}

function sourceFingerprint(artifact: Doc<"spectraArtifacts"> | null) {
  if (!artifact || artifact.blueprintKey !== "planner_task") return null;
  const content = object(artifact.content);
  const overlay = object(content.personalOverlay);
  return JSON.stringify({
    status: artifact.status,
    schoolId: artifact.schoolId,
    ownerAccountId: artifact.ownerAccountId,
    title: artifact.title,
    taskTitle: content.taskTitle,
    taskStatus: content.status,
    dueAt: content.dueAt,
    targetDueAt: overlay.targetDueAt,
    assignees: accountIds(content.assignees).sort(),
    reminders: reminderRows(content),
  });
}

export function plannerReminderSourceChanged(
  oldDoc: Doc<"spectraArtifacts"> | null,
  newDoc: Doc<"spectraArtifacts"> | null,
) {
  return sourceFingerprint(oldDoc) !== sourceFingerprint(newDoc);
}

export function plannerReminderSourceGeneration(
  artifact: Doc<"spectraArtifacts"> | null,
) {
  return compactReminderSourceGeneration(sourceFingerprint(artifact));
}

async function recipientsFor(
  ctx: MutationCtx,
  artifact: Doc<"spectraArtifacts">,
) {
  const content = object(artifact.content);
  const candidates = new Set<string>([
    artifact.ownerAccountId,
    ...accountIds(content.assignees),
  ]);
  const recipients: Id<"accounts">[] = [];
  for (const rawId of candidates) {
    const accountId = ctx.db.normalizeId("accounts", String(rawId));
    if (!accountId) continue;
    const actor = await getActorForAccountId(ctx, accountId);
    if (!actor || actor.schoolId !== artifact.schoolId) continue;
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      "artifact",
      artifact._id,
    );
    if (decision.allowed && decision.capabilities.includes("read"))
      recipients.push(accountId);
  }
  return recipients;
}

async function cancelDelivery(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  row: Doc<"plannerReminderDeliveries">,
  now: number,
) {
  if (row.scheduledFunctionId)
    await ctx.scheduler.cancel(row.scheduledFunctionId);
  await ctx.db.patch(row._id, {
    status: "cancelled",
    scheduledFunctionId: undefined,
    updatedAt: now,
  });
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
      plannerReminderSourceGeneration(artifact) !==
        args.expectedSourceGeneration
    )
      return { stale: true, scheduled: 0, cancelled: 0 };
    const existing = await ctx.db
      .query("plannerReminderDeliveries")
      .withIndex("by_artifact_status", (q) =>
        q.eq("artifactId", args.artifactId).eq("status", "pending"),
      )
      .collect();
    const now = Date.now();
    if (
      !artifact ||
      artifact.status !== "active" ||
      artifact.blueprintKey !== "planner_task"
    ) {
      await Promise.all(existing.map((row) => cancelDelivery(ctx, row, now)));
      return { stale: false, scheduled: 0, cancelled: existing.length };
    }
    const content = object(artifact.content);
    const dueAtBase = Number(content.dueAt);
    const reminders = reminderRows(content);
    if (
      content.status === "done" ||
      !Number.isFinite(dueAtBase) ||
      !reminders.length
    ) {
      await Promise.all(existing.map((row) => cancelDelivery(ctx, row, now)));
      return { stale: false, scheduled: 0, cancelled: existing.length };
    }
    const recipients = await recipientsFor(ctx, artifact);
    const overlay = object(content.personalOverlay);
    const desired = new Map<
      string,
      {
        recipientAccountId: Id<"accounts">;
        reminderId: string;
        dueAt: number;
        scheduledFor: number;
        taskTitle: string;
      }
    >();
    for (const recipientAccountId of recipients) {
      const dueAt =
        recipientAccountId === artifact.ownerAccountId &&
        Number.isFinite(Number(overlay.targetDueAt))
          ? Number(overlay.targetDueAt)
          : dueAtBase;
      if (now > dueAt + DAY) continue;
      for (const reminder of reminders) {
        const scheduledFor = dueAt - reminder.minutesBefore * 60_000;
        const idempotencyKey =
          `${artifact._id}:${recipientAccountId}:${reminder.id}:${dueAt}`.slice(
            0,
            500,
          );
        desired.set(idempotencyKey, {
          recipientAccountId,
          reminderId: reminder.id,
          dueAt,
          scheduledFor,
          taskTitle:
            (typeof content.taskTitle === "string" &&
              content.taskTitle.trim()) ||
            artifact.title,
        });
      }
    }
    const pendingByKey = new Map(
      existing.map((row) => [row.idempotencyKey, row] as const),
    );
    let scheduled = 0;
    let cancelled = 0;
    for (const [idempotencyKey, target] of desired) {
      const pending = pendingByKey.get(idempotencyKey);
      if (pending) {
        pendingByKey.delete(idempotencyKey);
        const scheduleChanged =
          pending.scheduledFor !== target.scheduledFor ||
          pending.dueAt !== target.dueAt ||
          pending.taskTitle !== target.taskTitle;
        if (scheduleChanged || !pending.scheduledFunctionId) {
          if (scheduleChanged && pending.scheduledFunctionId)
            await ctx.scheduler.cancel(pending.scheduledFunctionId);
          const scheduledFunctionId = await ctx.scheduler.runAt(
            Math.max(now, target.scheduledFor),
            internal.plannerReminders.deliver,
            { deliveryId: pending._id },
          );
          await ctx.db.patch(pending._id, {
            taskTitle: target.taskTitle,
            dueAt: target.dueAt,
            scheduledFor: target.scheduledFor,
            nextReminderAt: target.scheduledFor,
            status: "pending",
            scheduledFunctionId,
            nextAttemptAt: undefined,
            lastError: undefined,
            updatedAt: now,
          });
          scheduled += 1;
        }
        continue;
      }
      const prior = await ctx.db
        .query("plannerReminderDeliveries")
        .withIndex("by_idempotency", (q) =>
          q.eq("idempotencyKey", idempotencyKey),
        )
        .unique();
      if (prior?.status === "delivered") continue;
      if (prior) {
        const scheduledFunctionId = await ctx.scheduler.runAt(
          Math.max(now, target.scheduledFor),
          internal.plannerReminders.deliver,
          { deliveryId: prior._id },
        );
        await ctx.db.patch(prior._id, {
          recipientAccountId: target.recipientAccountId,
          reminderId: target.reminderId,
          taskTitle: target.taskTitle,
          dueAt: target.dueAt,
          scheduledFor: target.scheduledFor,
          nextReminderAt: target.scheduledFor,
          status: "pending",
          scheduledFunctionId,
          nextAttemptAt: undefined,
          lastError: undefined,
          updatedAt: now,
        });
        scheduled += 1;
        continue;
      }
      const deliveryId = await ctx.db.insert("plannerReminderDeliveries", {
        artifactId: artifact._id,
        schoolId: artifact.schoolId,
        recipientAccountId: target.recipientAccountId,
        reminderId: target.reminderId,
        taskTitle: target.taskTitle,
        dueAt: target.dueAt,
        scheduledFor: target.scheduledFor,
        nextReminderAt: target.scheduledFor,
        idempotencyKey,
        status: "pending",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      const scheduledFunctionId = await ctx.scheduler.runAt(
        Math.max(now, target.scheduledFor),
        internal.plannerReminders.deliver,
        { deliveryId },
      );
      await ctx.db.patch(deliveryId, { scheduledFunctionId });
      scheduled += 1;
    }
    for (const row of pendingByKey.values()) {
      await cancelDelivery(ctx, row, now);
      cancelled += 1;
    }
    return { stale: false, scheduled, cancelled };
  },
});

async function rowIsCurrent(
  ctx: MutationCtx | QueryCtx,
  row: Doc<"plannerReminderDeliveries">,
) {
  const artifact = await ctx.db.get(row.artifactId);
  if (
    !artifact ||
    artifact.status !== "active" ||
    artifact.blueprintKey !== "planner_task"
  )
    return false;
  const content = object(artifact.content);
  if (content.status === "done") return false;
  const reminder = reminderRows(content).find(
    (candidate) => candidate.id === row.reminderId,
  );
  if (!reminder) return false;
  const candidates = new Set([
    String(artifact.ownerAccountId),
    ...accountIds(content.assignees),
  ]);
  if (!candidates.has(String(row.recipientAccountId))) return false;
  const actor = await getActorForAccountId(ctx, row.recipientAccountId);
  if (!actor || actor.schoolId !== artifact.schoolId) return false;
  const access = await evaluateAccessForActor(
    ctx,
    actor,
    "artifact",
    artifact._id,
  );
  if (!access.allowed || !access.capabilities.includes("read")) return false;
  const overlay = object(content.personalOverlay);
  const dueAt =
    row.recipientAccountId === artifact.ownerAccountId &&
    Number.isFinite(Number(overlay.targetDueAt))
      ? Number(overlay.targetDueAt)
      : Number(content.dueAt);
  if (!Number.isFinite(dueAt)) return false;
  return (
    dueAt === row.dueAt &&
    dueAt - reminder.minutesBefore * 60_000 === row.scheduledFor
  );
}

export const deliver = internalMutation({
  args: { deliveryId: v.id("plannerReminderDeliveries") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.status !== "pending") return { delivered: false };
    const now = Date.now();
    if (!(await rowIsCurrent(ctx, row))) {
      await ctx.db.patch(row._id, {
        status: "cancelled",
        scheduledFunctionId: undefined,
        updatedAt: now,
      });
      return { delivered: false };
    }
    await ctx.db.patch(row._id, {
      status: "delivered",
      attempts: row.attempts + 1,
      scheduledFunctionId: undefined,
      updatedAt: now,
      deliveredAt: now,
    });
    return { delivered: true };
  },
});

export const safetySweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [overdue, missingHandle] = await Promise.all([
      ctx.db
        .query("plannerReminderDeliveries")
        .withIndex("by_status_next_reminder", (q) =>
          q.eq("status", "pending").lte("nextReminderAt", now),
        )
        .take(200),
      ctx.db
        .query("plannerReminderDeliveries")
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
        internal.plannerReminders.deliver,
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

export async function loadPlannerReminderNotifications(
  ctx: QueryCtx,
  actor: AuthenticatedActor,
  args: { unreadOnly?: boolean; limit?: number },
) {
  const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
  const rows = await ctx.db
    .query("plannerReminderDeliveries")
    .withIndex("by_recipient_created", (q) =>
      q.eq("recipientAccountId", actor.accountId),
    )
    .order("desc")
    .take(limit * 3);
  const candidates = rows
    .filter(
      (row) =>
        row.status === "delivered" &&
        (!args.unreadOnly || row.readAt === undefined),
    )
  const visible: typeof candidates = [];
  for (const row of candidates) {
    if (await rowIsCurrent(ctx, row)) visible.push(row);
    if (visible.length >= limit) break;
  }
  return visible;
}

export const listMine = query({
  args: {
    unreadOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
    return loadPlannerReminderNotifications(ctx, actor, args);
  },
});

export const markRead = mutation({
  args: { deliveryIds: v.array(v.id("plannerReminderDeliveries")) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
    const now = Date.now();
    let updated = 0;
    for (const deliveryId of [...new Set(args.deliveryIds)].slice(0, 100)) {
      const row = await ctx.db.get(deliveryId);
      if (
        !row ||
        row.recipientAccountId !== actor.accountId ||
        row.readAt !== undefined
      )
        continue;
      await ctx.db.patch(row._id, { readAt: now, updatedAt: now });
      updated += 1;
    }
    return { updated };
  },
});
