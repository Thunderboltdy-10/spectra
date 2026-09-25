/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { overview } from "./calendar";
import { upsertCalendarItemReadModel } from "./calendarReadModels";
import { CALENDAR_DONE_CURSOR } from "../shared/calendar-pagination";
import { bridgeKey, calendarFixture, identity, initialSource } from "../scripts/test-fixtures/managebac-calendar";
import { observeDatabase } from "../scripts/perf-read-ledger";
import { calendarItemFromWire } from "../src/features/spectra/calendar/domain/model";

const modules = import.meta.glob("./**/*.ts");
const range = { from: Date.parse("2026-10-20"), to: Date.parse("2026-10-30") };
const times = { startAt: Date.parse("2026-10-23T08:00:00Z"), endAt: Date.parse("2026-10-23T09:00:00Z"), timezone: "Europe/Madrid" };
const createFixture = async () => {
  const f = await calendarFixture(modules);
  await f.sync();
  const { task, official } = await f.items();
  const plan = (await f.plan())!;
  const request = { ...times, taskItemId: task._id, planArtifactId: plan._id, planTaskId: "task-1", idempotencyKey: "school-discovery-schedule" };
  const read = () => f.user.query(api.calendar.overview, range);
  return { ...f, task, official, plan, request, read };
};

beforeEach(() => vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("imported task discovery and stable Calendar identity", () => {
  it("returns the canonical imported task with its planner and official deadline links", async () => {
    const f = await createFixture();
    await f.editTask(f.task._id, { title: "My essay plan", notes: "Draft the argument" });
    const result = await f.read();
    expect(result.unscheduledTasks).toHaveLength(1);
    expect(result.unscheduledTasks[0]).toMatchObject({
      id: f.task._id, title: "My essay plan", notes: "Draft the argument", planArtifactId: f.plan._id,
      planTaskId: "task-1", officialDeadlineItemId: f.official._id, sourceLocked: false,
    });
    // These are the unchanged UI's opening/dragging inputs, not a second task.
    const item = calendarItemFromWire(result.unscheduledTasks[0]);
    expect(item.planArtifactId).toBe(f.plan._id);
    expect(item.linkedWorkIds).toContain(f.plan._id);
    expect(item.id.startsWith("plan:")).toBe(false);
    expect(item.source?.recordId).toBe(f.task.sourceRecordId);
  });

  it("schedules from the feed, survives replay and returns the same identity when its block is removed", async () => {
    const f = await createFixture();
    const block = await f.user.mutation(api.calendar.scheduleTask, f.request);
    expect(block).toMatchObject({ taskItemId: f.task._id, planArtifactId: f.plan._id, planTaskId: "task-1", officialDeadlineItemId: f.official._id });
    expect((await f.read()).unscheduledTasks).toEqual([]);
    expect(await f.user.mutation(api.calendar.scheduleTask, f.request)).toEqual(block);
    expect((await f.items()).rows.filter(row => row.kind === "scheduled_work_block")).toHaveLength(1);
    await f.user.mutation(api.calendar.removePersonalItem, { itemId: block.id });
    expect((await f.read()).unscheduledTasks.map(row => row.id)).toEqual([f.task._id]);
    expect((await f.items()).official).toMatchObject({ _id: f.official._id, startAt: f.official.startAt, sourceLocked: true });
  });

  it("recognizes source-only scheduled blocks without depending on an assigned planner link", async () => {
    const f = await createFixture();
    const block = await f.user.mutation(api.calendar.scheduleTask, { ...times, taskItemId: f.task._id, idempotencyKey: "source-only-block" });
    expect(block.planArtifactId).toBeUndefined();
    expect((await f.read()).unscheduledTasks).toEqual([]);
    await f.user.mutation(api.calendar.completeWorkBlock, { itemId: block.id, expectedRevision: block.revision });
    expect((await f.read()).unscheduledTasks.map(row => row.id)).toEqual([f.task._id]);
  });

  it("resolves a plan-only imported request to the same source task and official deadline", async () => {
    const f = await createFixture();
    const block = await f.user.mutation(api.calendar.scheduleTask, { ...times, planArtifactId: f.plan._id, planTaskId: "task-1", idempotencyKey: "plan-only-block" });
    expect(block).toMatchObject({ taskItemId: f.task._id, officialDeadlineItemId: f.official._id, planArtifactId: f.plan._id });
    expect((await f.read()).unscheduledTasks).toEqual([]);
  });

  for (const status of ["completed", "cancelled", "removed"] as const) {
    it(`does not revive a ${status} source root through its planner fallback`, async () => {
      const f = await createFixture();
      await f.editTask(f.task._id, { status });
      expect((await f.read()).unscheduledTasks).toEqual([]);
      await f.sync({ ...initialSource, title: "Changed official task" }, "v2");
      expect((await f.read()).unscheduledTasks).toEqual([]);
      await expect(f.user.mutation(api.calendar.scheduleTask, { ...times, planArtifactId: f.plan._id, planTaskId: "task-1" })).rejects.toThrow("CALENDAR_TASK_UNAVAILABLE");
    });
  }

  it("suppresses only the represented source root and keeps another personal task schedulable", async () => {
    const f = await createFixture();
    await f.editPlan(f.plan._id, { content: { ...f.plan.content, tasks: [
      { id: "task-1", title: "Official essay", status: "todo" },
      { id: "personal-outline", title: "Prepare an outline", status: "todo" },
    ] } });
    await f.editTask(f.task._id, { status: "removed" });
    const feed = (await f.read()).unscheduledTasks;
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ id: `plan:${f.plan._id}`, planTaskId: "personal-outline" });
    const block = await f.user.mutation(api.calendar.scheduleTask, { ...times, planArtifactId: f.plan._id, planTaskId: "personal-outline" });
    expect(block.taskItemId).toBeUndefined();
    expect(block.officialDeadlineItemId).toBeUndefined();
  });

  it("continues tied pages past terminal source roots with no missing or duplicate imported tasks", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-25T10:00:00Z"));
    const f = await createFixture();
    await f.editTask(f.task._id, { status: "removed" });
    for (let id = 2; id <= 7; id++) await f.sync({ ...initialSource, title: `Assignment ${id}` }, `hash-${id}`, "2026-27", id);
    const expected = (await f.items()).rows.filter(row => row.kind === "task" && row.status === "active").map(row => row._id);
    const ids: string[] = [];
    let plannerCursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await f.user.query(api.calendar.overview, { ...range, plannerCursor, limit: 2 });
      ids.push(...result.unscheduledTasks.map(row => row.id));
      plannerCursor = result.pagination.planner ?? undefined;
      if (!plannerCursor) break;
    }
    expect(plannerCursor).toBeUndefined();
    expect(ids.sort()).toEqual(expected.sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses compact source/task indexes without opening unrelated canonical payloads", async () => {
    const f = await createFixture();
    await f.t.run(async ctx => {
      for (let id = 0; id < 40; id++) {
        const { _id, _creationTime, ...task } = f.task;
        const itemId = await ctx.db.insert("calendarItems", { ...task, sourceRecordId: undefined, sourceKey: `unrelated-${id}`, notes: "x".repeat(20_000) });
        await upsertCalendarItemReadModel(ctx, (await ctx.db.get(itemId))!);
      }
    });
    const handler = Reflect.get(overview, "_handler") as (ctx: QueryCtx, args: FunctionArgs<typeof api.calendar.overview>) => Promise<FunctionReturnType<typeof api.calendar.overview>>;
    const observed = await f.user.run(async ctx => {
      const ledger = observeDatabase(ctx.db);
      const result = await handler({ ...ctx, db: ledger.db }, { ...range, cursor: CALENDAR_DONE_CURSOR, unscheduledCursor: CALENDAR_DONE_CURSOR, partialCursor: CALENDAR_DONE_CURSOR, migrationCursor: CALENDAR_DONE_CURSOR, debug: true });
      return { result, ledger: ledger.snapshot() };
    });
    expect(observed.result.unscheduledTasks.map(row => row.id)).toEqual([f.task._id]);
    expect(observed.ledger.reads.filter(row => row.table === "calendarItems" || row.table === "spectraArtifacts")).toEqual([]);
    const sourceReads = observed.ledger.reads.filter(row => row.index === "by_account_source_kind");
    expect(sourceReads).toHaveLength(1);
    expect(sourceReads[0].documentsReturned).toBe(1);
    expect(sourceReads[0].serializedDocumentBytes).toBeLessThan(5_000);
    expect(observed.ledger.reads.filter(row => row.index === "by_account_task_status")).toHaveLength(1);
    expect(observed.ledger.writes).toBe(0);
  });
});

describe("canonical Calendar task-to-plan validation", () => {
  it("rejects an owned task paired with a foreign or unrelated owned planner", async () => {
    const f = await createFixture();
    const clones = await f.t.run(async ctx => {
      const now = Date.now();
      const foreignAccountId = await ctx.db.insert("accounts", { clerkId: "foreign-calendar", email: "foreign@example.test", name: "Foreign", emailVerified: true, status: "active", createdAt: now, updatedAt: now });
      const { _id, _creationTime, ...plan } = f.plan;
      const foreignPlanId = await ctx.db.insert("spectraArtifacts", { ...plan, ownerAccountId: foreignAccountId });
      const unrelatedPlanId = await ctx.db.insert("spectraArtifacts", { ...plan, title: "Unrelated personal plan" });
      return { foreignPlanId, unrelatedPlanId };
    });
    await expect(f.user.mutation(api.calendar.scheduleTask, { ...f.request, planArtifactId: clones.foreignPlanId })).rejects.toThrow("CALENDAR_PLAN_NOT_FOUND");
    await expect(f.user.mutation(api.calendar.scheduleTask, { ...f.request, planArtifactId: clones.unrelatedPlanId })).rejects.toThrow("CALENDAR_TASK_PLAN_MISMATCH");
    expect((await f.items()).rows.filter(row => row.kind === "scheduled_work_block")).toEqual([]);
  });

  it("requires the supplied nested task to exist and represent the canonical source root", async () => {
    const f = await createFixture();
    await expect(f.user.mutation(api.calendar.scheduleTask, { ...f.request, planTaskId: "nonexistent" })).rejects.toThrow("CALENDAR_PLAN_TASK_NOT_FOUND");
    await f.editPlan(f.plan._id, { content: { ...f.plan.content, tasks: [
      { id: "task-1", title: "Source root", status: "todo" }, { id: "other-task", title: "Other", status: "todo" },
    ] } });
    await expect(f.user.mutation(api.calendar.scheduleTask, { ...f.request, planTaskId: "other-task" })).rejects.toThrow("CALENDAR_TASK_PLAN_MISMATCH");
  });

  it("preserves an actual legacy subtask alias while rejecting invented aliases", async () => {
    const f = await createFixture();
    await f.editPlan(f.plan._id, { content: { ...f.plan.content, subtasks: [{ id: "outline", title: "Outline", done: false }] } });
    const block = await f.user.mutation(api.calendar.scheduleTask, { ...f.request, planTaskId: "outline" });
    expect(block.planTaskId).toBe("task-1");
    await expect(f.user.mutation(api.calendar.scheduleTask, { ...f.request, planTaskId: "invented" })).rejects.toThrow("CALENDAR_PLAN_TASK_NOT_FOUND");
  });

  it("rechecks current task and plan state before returning an old idempotency receipt", async () => {
    const f = await createFixture();
    const block = await f.user.mutation(api.calendar.scheduleTask, f.request);
    await f.editTask(f.task._id, { status: "removed" });
    await expect(f.user.mutation(api.calendar.scheduleTask, f.request)).rejects.toThrow("CALENDAR_TASK_UNAVAILABLE");
    await f.editTask(f.task._id, { status: "active" });
    await f.editPlan(f.plan._id, { status: "archived" });
    await expect(f.user.mutation(api.calendar.scheduleTask, f.request)).rejects.toThrow("CALENDAR_PLAN_NOT_FOUND");
    expect((await f.items()).rows.filter(row => row.kind === "scheduled_work_block").map(row => row._id)).toEqual([block.id]);
  });

  it("rejects same-owner cross-school references and stale read-model ownership", async () => {
    const f = await createFixture();
    const schoolId = await f.t.run(ctx => ctx.db.insert("schools", { name: "Other school", slug: "other-school", verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: Date.now(), updatedAt: Date.now() }));
    await f.editPlan(f.plan._id, { schoolId });
    await expect(f.user.mutation(api.calendar.scheduleTask, f.request)).rejects.toThrow("CALENDAR_PLAN_NOT_FOUND");
    await f.editPlan(f.plan._id, { schoolId: f.seed.schoolId });
    // Deliberately stale compact rows cannot override authoritative task scope.
    await f.t.run(ctx => ctx.db.patch(f.task._id, { schoolId }));
    await expect(f.user.mutation(api.calendar.scheduleTask, { ...times, planArtifactId: f.plan._id, planTaskId: "task-1" })).rejects.toThrow("CALENDAR_TASK_NOT_FOUND");
  });

  it("retains positive standalone personal task and personal plan controls", async () => {
    const f = await createFixture();
    const task = await f.user.mutation(api.calendar.createPersonalItem, { kind: "task", title: "Own task", timezone: "Europe/Madrid" });
    expect(await f.user.mutation(api.calendar.scheduleTask, { ...times, taskItemId: task.id })).toMatchObject({ taskItemId: task.id });
    const planId = await f.t.run(ctx => ctx.db.insert("spectraArtifacts", { ownerAccountId: f.seed.accountId, schoolId: f.seed.schoolId, blueprintKey: "planner_task", title: "Own plan", content: { tasks: [{ id: "my-task", title: "Plan task", status: "todo" }] }, tags: [], status: "active", createdAt: Date.now(), updatedAt: Date.now() }));
    expect(await f.user.mutation(api.calendar.scheduleTask, { ...times, planArtifactId: planId, planTaskId: "my-task" })).toMatchObject({ planArtifactId: planId, planTaskId: "my-task" });
  });

  it("rejects a stale planner source association to another owned imported task", async () => {
    const f = await createFixture();
    await f.sync({ ...initialSource, title: "Second assignment" }, "second", "2026-27", 2);
    const otherTask = (await f.items()).rows.find(row => row.kind === "task" && row._id !== f.task._id)!;
    await f.t.run(async ctx => {
      const row = await ctx.db.query("calendarPlanTaskReadModels")
        .withIndex("by_plan_task", q => q.eq("planArtifactId", f.plan._id).eq("taskId", "task-1")).unique();
      await ctx.db.patch(row!._id, { sourceRecordId: otherTask.sourceRecordId });
    });
    for (const taskItemId of [undefined, f.task._id, otherTask._id]) {
      await expect(f.user.mutation(api.calendar.scheduleTask, { ...f.request, taskItemId }))
        .rejects.toThrow("CALENDAR_SOURCE_LINK_UNAVAILABLE");
    }
    expect((await f.items()).rows.filter(row => row.kind === "scheduled_work_block")).toEqual([]);
  });

  it("rejects ambiguous authoritative source associations instead of choosing the first", async () => {
    const f = await createFixture();
    await f.sync({ ...initialSource, title: "Second assignment" }, "second", "2026-27", 2);
    const otherTask = (await f.items()).rows.find(row => row.kind === "task" && row._id !== f.task._id)!;
    await f.t.run(async ctx => {
      const projection = await ctx.db.query("externalProjections")
        .withIndex("by_projection", q => q.eq("projectionType", "planner_task").eq("projectionId", f.plan._id)).unique();
      const { _id, _creationTime, ...fields } = projection!;
      await ctx.db.insert("externalProjections", { ...fields, recordId: otherTask.sourceRecordId!, providerKey: "ambiguous-fixture" });
    });
    await expect(f.user.mutation(api.calendar.scheduleTask, { ...f.request, taskItemId: undefined }))
      .rejects.toThrow("CALENDAR_SOURCE_LINK_AMBIGUOUS");
    expect((await f.items()).rows.filter(row => row.kind === "scheduled_work_block")).toEqual([]);
  });

  it.each(["owner", "school", "source", "missing plan", "missing source task"] as const)(
    "does not turn invalid derived provenance (%s) into an unlinked plan-only block", async corruption => {
      const f = await createFixture();
      await f.t.run(async ctx => {
        const row = await ctx.db.query("calendarPlanTaskReadModels")
          .withIndex("by_plan_task", q => q.eq("planArtifactId", f.plan._id).eq("taskId", "task-1")).unique();
        if (corruption === "owner") {
          const accountId = await ctx.db.insert("accounts", { clerkId: "stale-owner", email: "stale@example.test", name: "Stale", emailVerified: true, status: "active", createdAt: Date.now(), updatedAt: Date.now() });
          await ctx.db.patch(row!._id, { ownerAccountId: accountId });
        } else if (corruption === "school") await ctx.db.patch(row!._id, { schoolId: undefined });
        else if (corruption === "source") await ctx.db.patch(row!._id, { sourceRecordId: undefined });
        else if (corruption === "missing plan") await ctx.db.delete(row!._id);
        else {
          // A missing projection must not resurrect a terminal canonical root.
          await ctx.db.patch(f.task._id, { status: "removed" });
          const source = await ctx.db.query("calendarItemReadModels")
            .withIndex("by_item", q => q.eq("itemId", f.task._id)).unique();
          await ctx.db.delete(source!._id);
        }
      });
      await expect(f.user.mutation(api.calendar.scheduleTask, { ...times, planArtifactId: f.plan._id, planTaskId: "task-1" }))
        .rejects.toThrow("CALENDAR_SOURCE_LINK_UNAVAILABLE");
      expect((await f.items()).rows.filter(row => row.kind === "scheduled_work_block")).toEqual([]);
      if (corruption === "missing source task") expect((await f.read()).unscheduledTasks).toEqual([]);
    },
  );

  it("does not disclose another account's imported tasks in discovery", async () => {
    const f = await createFixture();
    const foreign = { ...identity, subject: "other-reader", email: "other-reader@example.test" };
    await f.t.run(async ctx => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", { clerkId: foreign.subject, email: foreign.email, emailVerified: true, name: "Other", status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("schoolMemberships", { accountId, schoolId: f.seed.schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    });
    const result = await f.t.withIdentity(foreign).query(api.calendar.overview, { ...range, targetItemId: f.task._id });
    expect(result.unscheduledTasks).toEqual([]);
    expect(result.targetedItems).toEqual([]);
  });
});
