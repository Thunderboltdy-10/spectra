/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "calendar-idempotency-test",
  email: "calendar-idempotency@example.test",
  emailVerified: true,
};

function setupTest() {
  return convexTest(schema, modules);
}

async function seedCalendarTask(t: ReturnType<typeof setupTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Calendar Idempotency School",
      slug: `calendar-idempotency-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: "Calendar Idempotency",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "school_admin",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const taskItemId = await ctx.db.insert("calendarItems", {
      ownerAccountId: accountId,
      schoolId,
      kind: "task",
      title: "Revise biology essay",
      allDay: false,
      timezone: "Europe/Madrid",
      timePrecision: "unknown",
      status: "active",
      sourceLocked: false,
      linkedArtifactIds: [],
      revision: 1,
      createdBy: "human",
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId, taskItemId };
  });
}

async function seedPlanner(
  t: ReturnType<typeof setupTest>,
  accountId: Id<"accounts">,
  schoolId: Id<"schools">,
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accountId,
      schoolId,
      blueprintKey: "planner_task",
      schemaVersion: 4,
      title: "Biology revision plan",
      summary: "A linked study plan.",
      content: {
        tasks: [{ id: "essay", title: "Revise biology essay", status: "todo" }],
      },
      textIndex: "Biology revision plan Revise biology essay",
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("Calendar scheduled work blocks", () => {
  it("reuses one scheduled block for a retried request and rejects key reuse with different data", async () => {
    const t = setupTest();
    const seeded = await seedCalendarTask(t);
    const user = t.withIdentity(identity);
    const input = {
      taskItemId: seeded.taskItemId,
      startAt: 1_000,
      endAt: 7_000,
      timezone: "Europe/Madrid",
      actorKind: "human" as const,
      idempotencyKey: "human:calendar-retry-01",
    };

    const first = await user.mutation(api.calendar.scheduleTask, input);
    const retry = await user.mutation(api.calendar.scheduleTask, input);
    expect(retry.id).toBe(first.id);

    await expect(
      user.mutation(api.calendar.scheduleTask, {
        ...input,
        endAt: 8_000,
      }),
    ).rejects.toThrow("CALENDAR_IDEMPOTENCY_CONFLICT");

    const secondIntent = await user.mutation(api.calendar.scheduleTask, {
      ...input,
      idempotencyKey: "human:calendar-retry-02",
    });
    expect(secondIntent.id).not.toBe(first.id);

    const blocks = await t.run(async (ctx) =>
      ctx.db
        .query("calendarItems")
        .withIndex("by_account_kind", (q) =>
          q.eq("ownerAccountId", seeded.accountId).eq("kind", "scheduled_work_block"),
        )
        .collect(),
    );
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.idempotencyKey).sort()).toEqual([
      "human:calendar-retry-01",
      "human:calendar-retry-02",
    ]);
  });

  it("preserves stable planner and task identities through a retry", async () => {
    const t = setupTest();
    const seeded = await seedCalendarTask(t);
    const planArtifactId = await seedPlanner(t, seeded.accountId, seeded.schoolId);
    const user = t.withIdentity(identity);
    const input = {
      planArtifactId,
      planTaskId: "essay",
      startAt: 10_000,
      endAt: 20_000,
      timezone: "Europe/Madrid",
      actorKind: "ai" as const,
      idempotencyKey: "ai:calendar-plan-retry-01",
    };
    const first = await user.mutation(api.calendar.scheduleTask, input);
    const retry = await user.mutation(api.calendar.scheduleTask, input);
    expect(retry.id).toBe(first.id);
    expect(retry.planArtifactId).toBe(planArtifactId);
    expect(retry.planTaskId).toBe("essay");
    expect(retry.linkedWorkIds).toEqual([planArtifactId]);
  });
});
