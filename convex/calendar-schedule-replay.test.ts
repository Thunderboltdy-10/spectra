/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { scheduleTask } from "./calendar";
import { bridgeKey, calendarFixture, initialSource } from "../scripts/test-fixtures/managebac-calendar";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const times = { startAt: 1_800_000_000_000, endAt: 1_800_003_600_000, timezone: "Europe/Madrid" };
const fixture = async () => {
  const f = await calendarFixture(modules);
  await f.sync();
  const { task, official } = await f.items();
  const plan = (await f.plan())!;
  const request = { ...times, taskItemId: task._id, planArtifactId: plan._id, planTaskId: "task-1", idempotencyKey: "lost-calendar-response" };
  return { ...f, task, official, plan, request };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Request = FunctionArgs<typeof api.calendar.scheduleTask>;
async function observedReplay(f: Fixture, request: Request) {
  const handler = Reflect.get(scheduleTask, "_handler") as
    (ctx: MutationCtx, args: Request) => Promise<FunctionReturnType<typeof api.calendar.scheduleTask>>;
  return f.user.run(async ctx => {
    const ledger = observeDatabase(ctx.db);
    const result = await handler({ ...ctx, db: ledger.db }, request);
    return { result, ledger: ledger.snapshot() };
  });
}
beforeEach(() => vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("scheduled block lost-response recovery", () => {
  it("resolves a single task card's root and replays the same admitted association", async () => {
    const f = await fixture();
    const request = { ...times, planArtifactId: f.plan._id, idempotencyKey: "single-card-root" };
    const block = await f.user.mutation(api.calendar.scheduleTask, request);
    expect(block).toMatchObject({ kind: "scheduled_work_block", planArtifactId: f.plan._id, planTaskId: "task-1" });
    expect(await f.user.mutation(api.calendar.scheduleTask, request)).toEqual(block);
    await f.editPlan(f.plan._id, { content: { ...f.plan.content, tasks: [{ id: "a", title: "First", status: "todo" }, { id: "b", title: "Second", status: "todo" }] } });
    await expect(f.user.mutation(api.calendar.scheduleTask, { ...request, idempotencyKey: "ambiguous-card-root" })).rejects.toThrow("CALENDAR_PLAN_TASK_NOT_FOUND");
  });
  it.each(["completed", "cancelled"] as const)("recovers the exact block after %s without writes or discovery rows", async status => {
    const f = await fixture();
    for (const taskItemId of [f.task._id, undefined]) {
      await f.editTask(f.task._id, { status: "active" });
      const request = { ...f.request, taskItemId, idempotencyKey: `lost-response-${status}-${taskItemId ? "task" : "plan"}` };
      const admitted = await f.user.mutation(api.calendar.scheduleTask, request);
      await f.editTask(f.task._id, { status, title: "New private source title" });
      const replay = await observedReplay(f, request);
      expect(replay.result).toEqual(admitted);
      expect(replay.ledger.writes).toBe(0);
      expect(replay.ledger.reads.filter(read => ["calendarPlanTaskReadModels", "calendarItemReadModels", "externalRecords"].includes(read.table))).toEqual([]);
      await expect(f.user.mutation(api.calendar.scheduleTask, { ...request, idempotencyKey: `${request.idempotencyKey}-new` }))
        .rejects.toThrow("CALENDAR_TASK_UNAVAILABLE");
    }
    expect((await f.items()).rows.filter(row => row.kind === "scheduled_work_block")).toHaveLength(2);
  });

  it("recovers after archive deletes compact rows and the nested root is completed", async () => {
    const f = await fixture();
    const block = await f.user.mutation(api.calendar.scheduleTask, f.request);
    await f.editPlan(f.plan._id, { status: "archived", title: "Archived private title", content: {
      ...f.plan.content, tasks: [{ id: "task-1", title: "Finished", status: "done" }],
    } });
    expect(await f.t.run(ctx => ctx.db.query("calendarPlanTaskReadModels")
      .withIndex("by_plan", q => q.eq("planArtifactId", f.plan._id)).collect())).toEqual([]);
    const replay = await observedReplay(f, f.request);
    expect(replay.result).toEqual(block);
    expect(replay.ledger.writes).toBe(0);
    await expect(f.user.mutation(api.calendar.scheduleTask, { ...f.request, idempotencyKey: "new-archive-request" }))
      .rejects.toThrow("CALENDAR_PLAN_NOT_FOUND");
  });

  it("recovers standalone personal tasks and completed personal planner roots", async () => {
    const f = await fixture();
    const personal = await f.user.mutation(api.calendar.createPersonalItem, { kind: "task", title: "Revision", timezone: "UTC" });
    const taskRequest = { ...times, taskItemId: personal.id, idempotencyKey: "standalone-lost-response" };
    const taskBlock = await f.user.mutation(api.calendar.scheduleTask, taskRequest);
    await f.editTask(personal.id, { status: "completed" });
    expect(await f.user.mutation(api.calendar.scheduleTask, taskRequest)).toEqual(taskBlock);
    const planId = await f.t.run(ctx => ctx.db.insert("spectraArtifacts", {
      ownerAccountId: f.seed.accountId, schoolId: f.seed.schoolId, blueprintKey: "planner_task", title: "Study",
      content: { tasks: [{ id: "revision", title: "Revision", status: "todo" }] }, tags: [], status: "active", createdAt: Date.now(), updatedAt: Date.now(),
    }));
    const planRequest = { ...times, planArtifactId: planId, planTaskId: "revision", idempotencyKey: "personal-plan-lost-response" };
    const planBlock = await f.user.mutation(api.calendar.scheduleTask, planRequest);
    await f.editPlan(planId, { content: { tasks: [{ id: "revision", title: "Done", status: "done" }] } });
    expect(await f.user.mutation(api.calendar.scheduleTask, planRequest)).toEqual(planBlock);
    await expect(f.user.mutation(api.calendar.scheduleTask, { ...planRequest, idempotencyKey: "personal-plan-new-request" }))
      .rejects.toThrow("CALENDAR_PLAN_TASK_NOT_FOUND");
  });

  it("binds a legacy request alias to its original root even after the alias names another task", async () => {
    const f = await fixture();
    await f.editPlan(f.plan._id, { content: { ...f.plan.content, subtasks: [{ id: "outline", title: "Outline" }] } });
    const request = { ...f.request, planTaskId: "outline" };
    const admitted = await f.user.mutation(api.calendar.scheduleTask, request);
    await f.editPlan(f.plan._id, { content: { ...f.plan.content, tasks: [
      { id: "task-1", title: "Original", status: "done" }, { id: "outline", title: "Different task", status: "todo" },
    ] } });
    expect(await f.user.mutation(api.calendar.scheduleTask, request)).toEqual(admitted);
    await expect(f.user.mutation(api.calendar.scheduleTask, { ...request, planTaskId: "task-1" }))
      .rejects.toThrow("CALENDAR_IDEMPOTENCY_CONFLICT");
    await f.editPlan(f.plan._id, { content: { ...f.plan.content, tasks: [{ id: "outline", title: "Different task", status: "todo" }] } });
    await expect(f.user.mutation(api.calendar.scheduleTask, request)).rejects.toThrow("CALENDAR_PLAN_TASK_NOT_FOUND");
  });

  it("recovers historical receipts without guessing a removed legacy alias", async () => {
    const f = await fixture();
    await f.editPlan(f.plan._id, { content: { ...f.plan.content, subtasks: [{ id: "outline", title: "Outline" }] } });
    const request = { ...f.request, planTaskId: "outline" };
    const admitted = await f.user.mutation(api.calendar.scheduleTask, request);
    await f.t.run(ctx => ctx.db.patch(admitted.id, { scheduleScope: undefined }));
    expect(await f.user.mutation(api.calendar.scheduleTask, request)).toEqual(admitted);
    await f.editPlan(f.plan._id, { content: { ...f.plan.content, subtasks: [] } });
    await expect(f.user.mutation(api.calendar.scheduleTask, request)).rejects.toThrow("CALENDAR_IDEMPOTENCY_CONFLICT");
    expect(await f.user.mutation(api.calendar.scheduleTask, f.request)).toEqual(admitted);
  });

  it.each(["time", "timezone", "task", "root"] as const)("rejects changed %s input for the same receipt", async change => {
    const f = await fixture();
    await f.user.mutation(api.calendar.scheduleTask, f.request);
    const request: Request = { ...f.request };
    if (change === "time") request.endAt += 1;
    if (change === "timezone") request.timezone = "UTC";
    if (change === "task") request.taskItemId = undefined;
    if (change === "root") request.planTaskId = "different";
    await expect(f.user.mutation(api.calendar.scheduleTask, request)).rejects.toThrow("CALENDAR_IDEMPOTENCY_CONFLICT");
  });

  it.each(["removed task", "missing task", "missing root", "removed block", "task owner", "plan owner", "task school", "plan school", "account", "membership", "school", "association"] as const)(
    "still denies %s after admission", async change => {
      const f = await fixture();
      const admitted = await f.user.mutation(api.calendar.scheduleTask, f.request);
      await f.t.run(async ctx => {
        if (change === "removed task") await ctx.db.patch(f.task._id, { status: "removed" });
        if (change === "missing task") await ctx.db.delete(f.task._id);
        if (change === "missing root") await ctx.db.patch(f.plan._id, { content: { ...f.plan.content, tasks: [] } });
        if (change === "removed block") await ctx.db.patch(admitted.id, { status: "removed" });
        if (change === "task owner" || change === "plan owner") {
          const other = await ctx.db.insert("accounts", { clerkId: "new-owner", email: "new@example.test", name: "New", emailVerified: true, status: "active", createdAt: Date.now(), updatedAt: Date.now() });
          if (change === "task owner") await ctx.db.patch(f.task._id, { ownerAccountId: other });
          else await ctx.db.patch(f.plan._id, { ownerAccountId: other });
        }
        if (change === "task school" || change === "plan school") {
          const schoolId = await ctx.db.insert("schools", { name: "Other", slug: "other", verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: Date.now(), updatedAt: Date.now() });
          if (change === "task school") await ctx.db.patch(f.task._id, { schoolId });
          else await ctx.db.patch(f.plan._id, { schoolId });
        }
        if (change === "account") await ctx.db.delete(f.seed.accountId);
        if (change === "membership") {
          const membership = await ctx.db.query("schoolMemberships").withIndex("by_account_status", q => q.eq("accountId", f.seed.accountId).eq("status", "active")).unique();
          await ctx.db.delete(membership!._id);
        }
        if (change === "school") await ctx.db.delete(f.seed.schoolId);
        if (change === "association") {
          const projection = await ctx.db.query("externalProjections").withIndex("by_projection", q => q.eq("projectionType", "planner_task").eq("projectionId", f.plan._id)).unique();
          await ctx.db.delete(projection!._id);
        }
      });
      await expect(f.user.mutation(api.calendar.scheduleTask, f.request)).rejects.toThrow();
      expect((await f.items()).rows.filter(row => row.kind === "scheduled_work_block")).toHaveLength(1);
    },
  );

  it("rejects reassignment of all current source links using the admitted source identity", async () => {
    const f = await fixture();
    await f.user.mutation(api.calendar.scheduleTask, f.request);
    await f.sync({ ...initialSource, title: "Different assignment" }, "second", "2026-27", 2);
    const other = (await f.items()).rows.find(row => row.kind === "task" && row._id !== f.task._id)!;
    await f.t.run(async ctx => {
      await ctx.db.patch(f.task._id, { sourceRecordId: other.sourceRecordId });
      await ctx.db.patch(f.official._id, { sourceRecordId: other.sourceRecordId });
      const projection = await ctx.db.query("externalProjections").withIndex("by_projection", q => q.eq("projectionType", "planner_task").eq("projectionId", f.plan._id)).unique();
      await ctx.db.patch(projection!._id, { recordId: other.sourceRecordId! });
    });
    await expect(f.user.mutation(api.calendar.scheduleTask, f.request)).rejects.toThrow("CALENDAR_SOURCE_LINK_UNAVAILABLE");
  });
});
