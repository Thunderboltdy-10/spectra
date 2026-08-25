import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { evaluateAccessForActor } from "./authorityShared";
import { getActorForAccountId, getAuthenticatedActor } from "./identityShared";

const SCHEDULE_HORIZON = 31 * 24 * 60 * 60_000;

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

async function recipientsFor(
  ctx: Parameters<typeof getActorForAccountId>[0],
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

export const dispatchDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const artifacts = await ctx.db
      .query("spectraArtifacts")
      .withIndex("by_blueprint_status_updated", (q) =>
        q.eq("blueprintKey", "planner_task").eq("status", "active"),
      )
      .take(1_000);
    let delivered = 0;
    for (const artifact of artifacts) {
      const content = object(artifact.content);
      if (content.status === "done") continue;
      const baseDueAt = Number(content.dueAt);
      if (!Number.isFinite(baseDueAt)) continue;
      const reminders = reminderRows(content);
      if (!reminders.length) continue;
      const recipients = await recipientsFor(ctx, artifact);
      for (const recipientAccountId of recipients) {
        const overlay = object(content.personalOverlay);
        const dueAt =
          recipientAccountId === artifact.ownerAccountId &&
          Number.isFinite(Number(overlay.targetDueAt))
            ? Number(overlay.targetDueAt)
            : baseDueAt;
        for (const reminder of reminders) {
          const scheduledFor = dueAt - reminder.minutesBefore * 60_000;
          if (
            scheduledFor > now + SCHEDULE_HORIZON ||
            now > dueAt + 24 * 60 * 60_000
          )
            continue;
          const idempotencyKey =
            `${artifact._id}:${recipientAccountId}:${reminder.id}:${dueAt}`.slice(
              0,
              500,
            );
          const existing = await ctx.db
            .query("plannerReminderDeliveries")
            .withIndex("by_idempotency", (q) =>
              q.eq("idempotencyKey", idempotencyKey),
            )
            .unique();
          if (existing) continue;
          const deliveryId = await ctx.db.insert("plannerReminderDeliveries", {
            artifactId: artifact._id,
            schoolId: artifact.schoolId,
            recipientAccountId,
            reminderId: reminder.id,
            taskTitle:
              (typeof content.taskTitle === "string" &&
                content.taskTitle.trim()) ||
              artifact.title,
            dueAt,
            scheduledFor,
            idempotencyKey,
            status: "pending",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
          await ctx.scheduler.runAt(
            Math.max(now, scheduledFor),
            internal.plannerReminders.deliver,
            { deliveryId },
          );
          delivered += 1;
        }
      }
    }
    return { scanned: artifacts.length, delivered };
  },
});

export const deliver = internalMutation({
  args: { deliveryId: v.id("plannerReminderDeliveries") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.status !== "pending") return { delivered: false };
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "delivered",
      attempts: row.attempts + 1,
      updatedAt: now,
      deliveredAt: now,
    });
    return { delivered: true };
  },
});

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
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const rows = await ctx.db
      .query("plannerReminderDeliveries")
      .withIndex("by_recipient_created", (q) =>
        q.eq("recipientAccountId", actor.accountId),
      )
      .order("desc")
      .take(limit * 3);
    return rows
      .filter(
        (row) =>
          row.status === "delivered" &&
          (!args.unreadOnly || row.readAt === undefined),
      )
      .slice(0, limit);
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
