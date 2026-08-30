/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { upsertArtifactSummary } from "./orgTreeShared";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_p9_efficiency",
  email: "p9-efficiency@example.test",
  emailVerified: true,
};

async function seedActor(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "P9 Efficiency School",
      slug: `p9-efficiency-${crypto.randomUUID()}`,
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
      name: "P9 Efficiency",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId };
  });
}

describe("P9.I2 run projections and targeted recovery", () => {
  it("updates the tab projection with run writes and returns no heavy run fields", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t);
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const threadId = await ctx.db.insert("spectraThreads", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        title: "Projection contract",
        origin: "workspace",
        status: "active",
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("spectraAiRuns", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        sourceSurface: "workspace",
        threadId,
        status: "running",
        phase: "reading",
        userPrompt: "Summarize the workspace",
        contextSnapshot: { heavy: "x".repeat(250_000) },
        executionId: "execution-1",
        eventSequence: 1,
        createdAt: now,
        updatedAt: now,
      });
      const cardId = await ctx.db.insert("spectraResultCards", {
        runId,
        surface: "workspace",
        status: "running",
        variant: "status",
        title: "Reading",
        actions: [],
        createdAt: now,
        updatedAt: now,
      });
      const tabId = await ctx.db.insert("spectraRunTabs", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        runId,
        threadId,
        surface: "workspace",
        selected: true,
        createdAt: now,
        updatedAt: now,
      });
      return { runId, threadId, cardId, tabId };
    });

    await t.withIdentity(identity).mutation(api.spectraRuns.markTraceDegraded, {
      runId: fixture.runId,
      executionId: "execution-1",
    });
    const tab = await t.run((ctx) => ctx.db.get(fixture.tabId));
    expect(tab?.runSummary).toMatchObject({
      _id: fixture.runId,
      status: "running",
      traceDegraded: true,
      userPrompt: "Summarize the workspace",
    });
    const result = await t.withIdentity(identity).query(api.spectraRuns.listTabs, {
      limit: 10,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.thread.title).toBe("Conversation");
    expect(result[0]?.run).not.toHaveProperty("contextSnapshot");
    expect(JSON.stringify(result[0])).not.toContain("x".repeat(2_000));
  });

  it("clears direct and operation-linked effects without sweeping owner tables", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t);
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const otherRunId = await ctx.db.insert("spectraAiRuns", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        sourceSurface: "workspace",
        status: "running",
        userPrompt: "Other run",
        executionId: "other-execution",
        leaseExpiresAt: now + 60_000,
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("spectraAiRuns", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        sourceSurface: "workspace",
        status: "running",
        phase: "updating",
        userPrompt: "Update two targets",
        executionId: "execution-1",
        eventSequence: 1,
        leaseExpiresAt: now - 1,
        createdAt: now,
        updatedAt: now,
      });
      const effect = {
        effectId: "effect-stale",
        runId,
        executionId: "execution-1",
        title: "Updating",
        activity: "edit" as const,
        regionIds: [],
        changedPaths: ["/"],
        state: "active" as const,
        startedAt: now,
        updatedAt: now,
      };
      const directArtifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "document",
        title: "Direct target",
        content: {},
        tags: [],
        status: "active",
        aiState: "updating",
        aiRunId: runId,
        aiExecutionId: "execution-1",
        aiEffects: [effect],
        createdAt: now,
        updatedAt: now,
      });
      const directArtifact = await ctx.db.get(directArtifactId);
      if (!directArtifact) throw new Error("missing direct artifact");
      await upsertArtifactSummary(ctx, directArtifact);
      const linkedArtifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "document",
        title: "Operation target",
        content: {},
        tags: [],
        status: "active",
        aiState: "updating",
        aiRunId: otherRunId,
        aiExecutionId: "other-execution",
        aiEffects: [
          effect,
          {
            ...effect,
            effectId: "effect-other",
            runId: otherRunId,
            executionId: "other-execution",
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      const unrelatedArtifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "document",
        title: "Unrelated heavy target",
        content: { body: "z".repeat(300_000) },
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("spectraOperations", {
        runId,
        executionId: "execution-1",
        actorType: "ai",
        type: "artifact.update",
        status: "executed",
        input: {},
        affected: [{ type: "artifact", id: linkedArtifactId }],
        createdAt: now,
        executedAt: now,
      });
      return {
        runId,
        directArtifactId,
        linkedArtifactId,
        unrelatedArtifactId,
      };
    });

    await t.mutation(internal.spectraRuns.reconcileStaleRuns, {});
    const state = await t.run(async (ctx) => ({
      direct: await ctx.db.get(fixture.directArtifactId),
      directSummary: await ctx.db
        .query("spectraArtifactSummaries")
        .withIndex("by_artifact", (q) =>
          q.eq("artifactId", fixture.directArtifactId),
        )
        .unique(),
      linked: await ctx.db.get(fixture.linkedArtifactId),
      unrelated: await ctx.db.get(fixture.unrelatedArtifactId),
    }));
    expect(state.direct?.aiRunId).toBeUndefined();
    expect(state.direct?.aiEffects).toBeUndefined();
    expect(state.directSummary?.projection.aiRunId).toBeUndefined();
    expect(state.directSummary?.projection.aiEffects).toBeUndefined();
    expect(state.directSummary?.projection.aiState).toBeUndefined();
    expect(state.directSummary?.updatedAt).toBe(state.direct?.updatedAt);
    expect(state.linked?.aiEffects?.map((effect) => effect.effectId)).toEqual([
      "effect-other",
    ]);
    expect(state.unrelated?.title).toBe("Unrelated heavy target");
  });
});

describe("P9.I2 schedule-at-write reminders", () => {
  it("stores planner scheduler handles and replaces obsolete pending work", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t);
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "planner_task",
        title: "Physics write-up",
        content: {
          taskTitle: "Physics write-up",
          status: "todo",
          dueAt: now + 2 * 60 * 60_000,
          reminders: [{ id: "one-hour", minutesBefore: 60 }],
          assignees: [],
        },
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return { artifactId };
    });
    await t.mutation(internal.plannerReminders.reconcileArtifact, {
      artifactId: fixture.artifactId,
    });
    const first = await t.run((ctx) =>
      ctx.db
        .query("plannerReminderDeliveries")
        .withIndex("by_artifact_status", (q) =>
          q.eq("artifactId", fixture.artifactId).eq("status", "pending"),
        )
        .unique(),
    );
    expect(first?.scheduledFunctionId).toBeDefined();
    expect(first?.nextReminderAt).toBe(first?.scheduledFor);
    if (!first) throw new Error("missing planner delivery");

    await t.run(async (ctx) => {
      if (first.scheduledFunctionId)
        await ctx.scheduler.cancel(first.scheduledFunctionId);
      await ctx.db.patch(first._id, {
        status: "failed",
        scheduledFunctionId: undefined,
        lastError: "temporary delivery failure",
      });
    });
    await t.mutation(internal.plannerReminders.reconcileArtifact, {
      artifactId: fixture.artifactId,
    });
    const rearmed = await t.run((ctx) => ctx.db.get(first._id));
    expect(rearmed).toMatchObject({
      _id: first._id,
      status: "pending",
      nextReminderAt: first.scheduledFor,
    });
    expect(rearmed?.scheduledFunctionId).toBeDefined();
    expect(rearmed?.lastError).toBeUndefined();

    await t.run(async (ctx) => {
      const artifact = await ctx.db.get(fixture.artifactId);
      const nextUpdatedAt = (artifact?.updatedAt ?? Date.now()) + 1;
      await ctx.db.patch(fixture.artifactId, {
        content: {
          taskTitle: "Physics write-up",
          status: "todo",
          dueAt: Date.now() + 3 * 60 * 60_000,
          reminders: [{ id: "thirty-minutes", minutesBefore: 30 }],
          assignees: [],
        },
        updatedAt: nextUpdatedAt,
      });
    });
    await t.mutation(internal.plannerReminders.reconcileArtifact, {
      artifactId: fixture.artifactId,
    });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("plannerReminderDeliveries")
        .withIndex("by_artifact_scheduled", (q) =>
          q.eq("artifactId", fixture.artifactId),
        )
        .collect(),
    );
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(1);
    expect(rows.some((row) => row.status === "cancelled")).toBe(true);
  });

  it("schedules the next recurring timetable occurrence from one user-state write", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t);
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "timetable",
        title: "Calendar",
        content: { events: [] },
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const stateId = await ctx.db.insert("artifactUserStates", {
        artifactId,
        schoolId: actor.schoolId,
        accountId: actor.accountId,
        kind: "timetable",
        state: {
          privateEvents: [
            {
              id: "daily-review",
              title: "Daily review",
              start: new Date(now + 2 * 60 * 60_000).toISOString(),
              recurrence: "FREQ=DAILY;INTERVAL=1",
              reminders: [{ id: "ten-minutes", minutesBefore: 10 }],
            },
          ],
          eventOverlays: {},
        },
        revision: 1,
        byteLength: 200,
        createdAt: now,
        updatedAt: now,
      });
      return { artifactId, stateId };
    });
    await t.mutation(internal.timetableReminders.reconcileUserState, {
      artifactId: fixture.artifactId,
      accountId: actor.accountId,
      offset: 0,
    });
    const first = await t.run((ctx) =>
      ctx.db
        .query("timetableReminderDeliveries")
        .withIndex("by_artifact_recipient_status", (q) =>
          q
            .eq("artifactId", fixture.artifactId)
            .eq("recipientAccountId", actor.accountId)
            .eq("status", "pending"),
        )
        .unique(),
    );
    expect(first?.scheduledFunctionId).toBeDefined();
    expect(first?.nextReminderAt).toBe(first?.scheduledFor);
    if (!first) throw new Error("missing timetable delivery");

    await t.run(async (ctx) => {
      const state = await ctx.db.get(fixture.stateId);
      await ctx.db.patch(fixture.stateId, {
        state: { privateEvents: [], eventOverlays: {} },
        revision: (state?.revision ?? 1) + 1,
        updatedAt: Date.now(),
      });
    });
    await t.mutation(internal.timetableReminders.reconcileUserState, {
      artifactId: fixture.artifactId,
      accountId: actor.accountId,
      offset: 0,
    });
    expect(await t.run((ctx) => ctx.db.get(first._id))).toMatchObject({
      status: "cancelled",
      occurrenceStart: first.occurrenceStart,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.stateId, {
        state: {
          privateEvents: [
            {
              id: "daily-review",
              title: "Daily review",
              start: new Date(first.eventStart!).toISOString(),
              recurrence: "FREQ=DAILY;INTERVAL=1",
              reminders: [{ id: "ten-minutes", minutesBefore: 10 }],
            },
          ],
          eventOverlays: {},
        },
        revision: 3,
        updatedAt: Date.now(),
      });
    });
    await t.mutation(internal.timetableReminders.reconcileUserState, {
      artifactId: fixture.artifactId,
      accountId: actor.accountId,
      offset: 0,
    });
    const rearmed = await t.run((ctx) => ctx.db.get(first._id));
    expect(rearmed).toMatchObject({
      _id: first._id,
      status: "pending",
      occurrenceStart: first.occurrenceStart,
    });
    expect(rearmed?.scheduledFunctionId).toBeDefined();

    await t.run(async (ctx) => {
      const [artifact, state] = await Promise.all([
        ctx.db.get(fixture.artifactId),
        ctx.db.get(fixture.stateId),
      ]);
      await ctx.db.patch(fixture.artifactId, {
        summary: "An unrelated calendar description change",
        updatedAt: (artifact?.updatedAt ?? Date.now()) + 1,
      });
      await ctx.db.patch(fixture.stateId, {
        state: {
          ...(state?.state as Record<string, unknown>),
          view: { kind: "week", anchorDate: "2026-08-30" },
        },
        revision: (state?.revision ?? 3) + 1,
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.timetableReminders.deliver, {
      deliveryId: first._id,
    });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("timetableReminderDeliveries")
        .withIndex("by_artifact_scheduled", (q) =>
          q.eq("artifactId", fixture.artifactId),
        )
        .collect(),
    );
    expect(rows.filter((row) => row.status === "delivered")).toHaveLength(1);
    const next = rows.find((row) => row.status === "pending");
    expect(next?.occurrenceStart).toBe(first.occurrenceStart + 24 * 60 * 60_000);
    expect(next?.scheduledFunctionId).toBeDefined();
  });

  it("refuses delivery after the recipient loses access", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t);
    const artifactId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "planner_task",
        title: "Private reminder",
        content: {
          taskTitle: "Private reminder",
          status: "todo",
          dueAt: now + 2 * 60 * 60_000,
          reminders: [{ id: "one-hour", minutesBefore: 60 }],
          assignees: [],
        },
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    await t.mutation(internal.plannerReminders.reconcileArtifact, {
      artifactId,
    });
    const delivery = await t.run((ctx) =>
      ctx.db
        .query("plannerReminderDeliveries")
        .withIndex("by_artifact_status", (q) =>
          q.eq("artifactId", artifactId).eq("status", "pending"),
        )
        .unique(),
    );
    if (!delivery) throw new Error("missing planner delivery");
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("schoolMemberships")
        .withIndex("by_account_status", (q) =>
          q.eq("accountId", actor.accountId).eq("status", "active"),
        )
        .unique();
      if (!membership) throw new Error("missing membership");
      await ctx.db.patch(membership._id, {
        status: "suspended",
        updatedAt: Date.now(),
      });
    });
    await t.mutation(internal.plannerReminders.deliver, {
      deliveryId: delivery._id,
    });
    const cancelled = await t.run((ctx) => ctx.db.get(delivery._id));
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.scheduledFunctionId).toBeUndefined();
  });

  it("schedules planner and timetable reconciliation from source mutations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T10:00:00.000Z"));
    try {
      const t = convexTest(schema, modules);
      const actor = await seedActor(t);
      const planner = await t.run(async (ctx) => {
        const now = Date.now();
        const runId = await ctx.db.insert("spectraAiRuns", {
          ownerAccountId: actor.accountId,
          schoolId: actor.schoolId,
          sourceSurface: "workspace",
          status: "running",
          userPrompt: "Add a reminder",
          executionId: "planner-trigger-execution",
          createdAt: now,
          updatedAt: now,
        });
        const artifactId = await ctx.db.insert("spectraArtifacts", {
          ownerAccountId: actor.accountId,
          schoolId: actor.schoolId,
          blueprintKey: "planner_task",
          title: "Triggered planner reminder",
          content: {
            taskTitle: "Triggered planner reminder",
            status: "todo",
            reminders: [],
          },
          tags: [],
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
        return { artifactId, runId };
      });
      await t.withIdentity(identity).mutation(api.spectraArtifacts.stageAiPatch, {
        artifactId: planner.artifactId,
        runId: planner.runId,
        executionId: "planner-trigger-execution",
        commit: true,
        changedPaths: ["/reminders"],
        content: {
          taskTitle: "Triggered planner reminder",
          status: "todo",
          dueAt: Date.now() + 3 * 60 * 60_000,
          reminders: [
            { id: "one-hour", minutesBefore: 60, enabled: true },
          ],
          timezone: "Europe/Madrid",
          recurrence: {
            frequency: "none",
            interval: 1,
            weekdays: [],
            exceptions: [],
          },
          assignees: [],
        },
      });
      vi.advanceTimersByTime(0);
      await t.finishInProgressScheduledFunctions();
      const plannerRows = await t.run((ctx) =>
        ctx.db
          .query("plannerReminderDeliveries")
          .withIndex("by_artifact_status", (q) =>
            q.eq("artifactId", planner.artifactId).eq("status", "pending"),
          )
          .collect(),
      );
      expect(plannerRows).toHaveLength(1);
      expect(plannerRows[0]?.scheduledFunctionId).toBeDefined();

      const timetableArtifactId = await t.run(async (ctx) => {
        const now = Date.now();
        return ctx.db.insert("spectraArtifacts", {
          ownerAccountId: actor.accountId,
          schoolId: actor.schoolId,
          blueprintKey: "timetable",
          title: "Triggered calendar reminder",
          content: { events: [] },
          tags: [],
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
      });
      await t.withIdentity(identity).mutation(api.artifactUserStates.put, {
        artifactId: timetableArtifactId,
        kind: "timetable",
        state: {
          privateEvents: [
            {
              id: "triggered-event",
              title: "Triggered event",
              start: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
              reminders: [{ id: "fifteen-minutes", minutesBefore: 15 }],
            },
          ],
          eventOverlays: {},
        },
      });
      vi.advanceTimersByTime(0);
      await t.finishInProgressScheduledFunctions();
      const timetableRows = await t.run((ctx) =>
        ctx.db
          .query("timetableReminderDeliveries")
          .withIndex("by_artifact_recipient_status", (q) =>
            q
              .eq("artifactId", timetableArtifactId)
              .eq("recipientAccountId", actor.accountId)
              .eq("status", "pending"),
          )
          .collect(),
      );
      expect(timetableRows).toHaveLength(1);
      expect(timetableRows[0]?.scheduledFunctionId).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
