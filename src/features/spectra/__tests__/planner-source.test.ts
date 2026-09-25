import { describe, expect, it } from "vitest";
import { assertPlannerSourceEdit, refreshPlannerSourceContent } from "../../../../shared/planner-source.mjs";
import { normalizePlanContent } from "../plan/model";
import { reschedulePlanTask } from "../plan/projections";

const dueAt = Date.parse("2026-10-24T09:00:00+02:00");
const legacy = {
  taskTitle: "Official essay", description: "Explain the evidence.", status: "todo", dueAt,
  source: { provider: "managebac", externalId: "assignment-1", hash: "v1", status: "active", lockedFields: ["taskTitle", "description", "dueAt", "source"] },
  sourceRefs: ["managebac:assignment:1:2026-27"],
};
const next = { title: "Updated essay", description: "Revised instructions.", dueAt: dueAt + 90_000_000, source: { ...legacy.source, hash: "v2" } };
const previous = { title: legacy.taskTitle, description: legacy.description };

describe("planner source boundary", () => {
  it("migrates and repeatedly saves the legacy root with its official date/source intact", () => {
    const plan = normalizePlanContent(legacy);
    expect(plan.source).toEqual(legacy.source);
    expect(plan.sourceRefs).toEqual(legacy.sourceRefs);
    expect(plan.tasks[0]).toMatchObject({ id: "task-1", dueAt, officialDeadlineRef: legacy.sourceRefs[0] });
    expect(normalizePlanContent(plan)).toEqual(plan);
    expect(() => assertPlannerSourceEdit(legacy, plan)).not.toThrow();
    expect(reschedulePlanTask(plan, { taskId: "task-1", dueAt: dueAt + 60_000 }).ok).toBe(false);
  });

  it("binds the correct array root and repairs its stale displayed date without binding personal tasks", () => {
    const plan = normalizePlanContent({ ...legacy, tasks: [
      { id: "personal-outline", title: "Outline", dueAt: dueAt - 60_000 },
      { id: "task-1", title: "My essay", dueAt: dueAt - 1, status: "completed" },
    ] });
    expect(plan.tasks[0].officialDeadlineRef).toBeUndefined();
    expect(plan.tasks[0].dueAt).toBe(dueAt - 60_000);
    expect(plan.tasks[1]).toMatchObject({ title: "My essay", status: "done", dueAt, officialDeadlineRef: legacy.sourceRefs[0] });
    expect(() => assertPlannerSourceEdit(legacy, plan)).not.toThrow();
  });

  it.each(["root date", "task date", "source hash", "source refs", "strip source", "strip task ref", "duplicate root", "move reference"] as const)(
    "rejects an untrusted %s change", kind => {
      const plan = normalizePlanContent(legacy);
      const proposed = structuredClone(plan);
      if (kind === "root date") proposed.dueAt = dueAt + 1;
      else if (kind === "task date") proposed.tasks[0].dueAt = dueAt + 1;
      else if (kind === "source hash") proposed.source!.hash = "forged";
      else if (kind === "source refs") proposed.sourceRefs = ["managebac:another-assignment"];
      else if (kind === "strip source") delete proposed.source;
      else if (kind === "strip task ref") delete proposed.tasks[0].officialDeadlineRef;
      else if (kind === "duplicate root") proposed.tasks.push({ ...proposed.tasks[0] });
      else proposed.tasks[0].id = "renamed-root";
      expect(() => assertPlannerSourceEdit(plan, proposed)).toThrow(/PLANNER_(SOURCE_METADATA|OFFICIAL_DEADLINE)_LOCKED/);
    },
  );

  it("permits personal edits and root removal while retaining the official source envelope", () => {
    const plan = normalizePlanContent(legacy);
    const proposed = structuredClone(plan);
    Object.assign(proposed.tasks[0], { title: "My writing plan", description: "", status: "done", checklist: [{ id: "check", title: "Draft", done: true }] });
    expect(() => assertPlannerSourceEdit(plan, proposed)).not.toThrow();
    proposed.tasks = [];
    expect(() => assertPlannerSourceEdit(plan, proposed)).not.toThrow();
    expect(normalizePlanContent(proposed).tasks).toEqual([]);
    expect(refreshPlannerSourceContent(proposed, next, previous).tasks).toEqual([]);
  });

  it("advances only copied root text and always advances the official date", () => {
    const plan = normalizePlanContent(legacy);
    plan.tasks[0].title = "My writing plan";
    const personal = { id: "outline", title: "Outline", dueAt: dueAt - 1, status: "todo" };
    const result = refreshPlannerSourceContent({ ...plan, tasks: [...plan.tasks, personal] }, next, previous);
    const reopened = normalizePlanContent(result);
    expect(reopened.tasks[0]).toMatchObject({ title: "My writing plan", description: next.description, dueAt: next.dueAt });
    expect((result.tasks as unknown[])[1]).toBe(personal);
    const noBaseline = normalizePlanContent(refreshPlannerSourceContent(plan, next));
    expect(noBaseline.tasks[0].description).toBe(legacy.description);
    expect(noBaseline.tasks[0].dueAt).toBe(next.dueAt);
  });

  it("preserves explicit personal clearing and withdrawn official dates on repeated normalization", () => {
    const plan = normalizePlanContent(legacy);
    plan.tasks[0].description = "";
    const result = normalizePlanContent(refreshPlannerSourceContent(plan, { ...next, dueAt: undefined }, previous));
    expect(result.tasks[0].description).toBe("");
    expect(result.tasks[0].dueAt).toBeUndefined();
    expect(result.tasks[0].officialDeadlineRef).toBe(legacy.sourceRefs[0]);
    expect(normalizePlanContent(result)).toEqual(result);
    expect(() => assertPlannerSourceEdit(result, normalizePlanContent(result))).not.toThrow();
  });

  it("retains standalone personal dates and protects existing nonlegacy official references", () => {
    const personal = normalizePlanContent({ tasks: [{ id: "one", title: "Own task", dueAt }] });
    expect(reschedulePlanTask(personal, { taskId: "one", dueAt: dueAt + 1 }).ok).toBe(true);
    expect(() => assertPlannerSourceEdit(personal, { ...personal, tasks: [] })).not.toThrow();
    const official = normalizePlanContent({ tasks: [{ id: "school-task", title: "Official", dueAt, officialDeadlineRef: "school:assignment" }] });
    const changed = structuredClone(official);
    delete changed.tasks[0].officialDeadlineRef;
    expect(() => assertPlannerSourceEdit(official, changed)).toThrow("PLANNER_SOURCE_METADATA_LOCKED");
  });
});
