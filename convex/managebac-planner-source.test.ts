/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeKey, calendarFixture, initialSource } from "../scripts/test-fixtures/managebac-calendar";
import { assertPlannerSourceEdit } from "../shared/planner-source.mjs";
import { normalizePlanContent } from "../src/features/spectra/plan/model";

const modules = import.meta.glob("./**/*.ts");
const changedSource = { ...initialSource, title: "Revised official essay", description: "New source instructions.", dueAt: "2026-10-25T09:00:00+01:00" };

beforeEach(() => vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey));
afterEach(() => vi.unstubAllEnvs());

describe("ManageBac planner source preservation", () => {
  it.each(["legacy", "array"] as const)("refreshes copied text and official date in %s representation", async representation => {
    const f = await calendarFixture(modules);
    await f.sync();
    const before = (await f.plan())!;
    if (representation === "array") {
      const normalized = normalizePlanContent(before.content);
      expect(() => assertPlannerSourceEdit(before.content, normalized)).not.toThrow();
      await f.editPlan(before._id, { content: normalized });
    }
    await f.sync(changedSource, "v2");
    const after = (await f.plan())!;
    expect(after._id).toBe(before._id);
    expect(after.title).toBe(changedSource.title);
    const reopened = normalizePlanContent(after.content);
    expect(reopened.tasks[0]).toMatchObject({ title: changedSource.title, description: changedSource.description, dueAt: Date.parse(changedSource.dueAt) });
    expect(reopened.tasks[0].officialDeadlineRef).toMatch(/^managebac:/);
    expect(reopened.source).toMatchObject({ provider: "managebac", hash: "v2" });
    const compact = await f.t.run(ctx => ctx.db.query("calendarPlanTaskReadModels")
      .withIndex("by_plan_task", q => q.eq("planArtifactId", before._id).eq("taskId", "task-1")).unique());
    expect(compact).toMatchObject({ title: changedSource.title, dueAt: Date.parse(changedSource.dueAt) });
    expect((await f.items()).official.startAt).toBe(Date.parse(changedSource.dueAt));
  });

  it("retains customized personal root fields and additional tasks through changed and unchanged refreshes", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const before = (await f.plan())!;
    const plan = normalizePlanContent(before.content);
    const personal = normalizePlanContent({ taskTitle: "Research notes", dueAt: Date.parse("2026-10-20"), status: "doing" }).tasks[0];
    personal.id = "personal-research";
    Object.assign(plan.tasks[0], { title: "My writing plan", description: "", status: "done", checklist: [{ id: "proofread", title: "Proofread", done: true }] });
    plan.tasks.unshift(personal);
    expect(() => assertPlannerSourceEdit(before.content, plan)).not.toThrow();
    await f.editPlan(before._id, { title: "My coursework", summary: "My private summary", content: plan });
    await f.sync(changedSource, "v2");
    const after = (await f.plan())!;
    const reopened = normalizePlanContent(after.content);
    expect(after.title).toBe("My coursework");
    expect(after.summary).toBe("My private summary");
    expect(reopened.tasks[0]).toEqual(personal);
    expect(reopened.tasks[1]).toMatchObject({ id: "task-1", title: "My writing plan", description: "", status: "done", dueAt: Date.parse(changedSource.dueAt), checklist: [{ id: "proofread", title: "Proofread", done: true }] });
    await f.sync(changedSource, "v2");
    expect(normalizePlanContent((await f.plan())!.content)).toEqual(reopened);
  });

  it("keeps a user-deleted root absent while the separate official Calendar deadline advances", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const before = (await f.plan())!;
    const plan = normalizePlanContent(before.content);
    plan.tasks = [];
    expect(() => assertPlannerSourceEdit(before.content, plan)).not.toThrow();
    await f.editPlan(before._id, { content: plan });
    await f.sync(changedSource, "v2");
    const after = normalizePlanContent((await f.plan())!.content);
    expect(after.tasks).toEqual([]);
    expect(after.source).toMatchObject({ provider: "managebac", hash: "v2" });
    expect((await f.items()).official.startAt).toBe(Date.parse(changedSource.dueAt));
  });
});
