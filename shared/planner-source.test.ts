import { describe, expect, it } from "vitest";
import { assertPlannerSourceEdit, bindPlannerSourceTask, plannerSourceMetadata, refreshPlannerSourceContent } from "./planner-source.mjs";

const legacy = {
  taskTitle: "Essay", description: "Evidence", dueAt: 12345,
  source: { provider: "managebac", externalId: "assignment-1", hash: "v1" },
  sourceRefs: ["managebac:assignment:1:2026"],
};
const migrated = () => ({ ...legacy, tasks: [bindPlannerSourceTask(legacy, {
  id: "task-1", title: legacy.taskTitle, description: legacy.description, status: "todo",
})] });

describe("planner source write guard", () => {
  it("accepts canonical migration, metadata preservation, personal edits and deletion", () => {
    const next = migrated();
    expect(plannerSourceMetadata(next)).toMatchObject({ source: legacy.source, sourceRefs: legacy.sourceRefs, dueAt: legacy.dueAt });
    expect(() => assertPlannerSourceEdit(legacy, next)).not.toThrow();
    next.tasks[0].title = "My plan";
    next.tasks[0].description = "";
    next.tasks[0].status = "done";
    expect(() => assertPlannerSourceEdit(legacy, next)).not.toThrow();
    expect(() => assertPlannerSourceEdit(next, { ...next, tasks: [] })).not.toThrow();
  });

  it.each(["hash", "strip source", "source refs", "task ref", "duplicate", "move"] as const)("rejects %s metadata substitution", mode => {
    const next = migrated();
    if (mode === "hash") next.source = { ...legacy.source, hash: "forged" };
    else if (mode === "strip source") Reflect.deleteProperty(next, "source");
    else if (mode === "source refs") next.sourceRefs = ["managebac:other"];
    else if (mode === "task ref") Reflect.deleteProperty(next.tasks[0], "officialDeadlineRef");
    else if (mode === "duplicate") next.tasks.push({ ...next.tasks[0] });
    else next.tasks[0].id = "other";
    expect(() => assertPlannerSourceEdit(legacy, next)).toThrow("PLANNER_SOURCE_METADATA_LOCKED");
  });

  it.each(["legacy", "root", "task"] as const)("rejects changed official date in %s form", mode => {
    if (mode === "legacy") {
      expect(() => assertPlannerSourceEdit(legacy, { ...legacy, dueAt: 12346 })).toThrow("PLANNER_OFFICIAL_DEADLINE_LOCKED");
      return;
    }
    const next = migrated();
    if (mode === "task") next.tasks[0].dueAt = 12346;
    else next.dueAt = 12346;
    expect(() => assertPlannerSourceEdit(legacy, next)).toThrow("PLANNER_OFFICIAL_DEADLINE_LOCKED");
  });

  it("advances copied text but preserves custom text, personal tasks and a deleted root", () => {
    const plan = migrated();
    plan.tasks[0].description = "";
    const personal = { id: "personal", title: "Outline", dueAt: 123 };
    plan.tasks.push(personal);
    const next = { title: "Updated essay", description: "New evidence", dueAt: 20000, source: { ...legacy.source, hash: "v2" } };
    const result = refreshPlannerSourceContent(plan, next, { title: legacy.taskTitle, description: legacy.description });
    expect((result.tasks as Record<string, unknown>[])[0]).toMatchObject({ title: next.title, description: "", dueAt: next.dueAt, officialDeadlineRef: legacy.sourceRefs[0] });
    expect((result.tasks as unknown[])[1]).toBe(personal);
    expect(refreshPlannerSourceContent({ ...plan, tasks: [personal] }, next).tasks).toEqual([personal]);
    const withdrawn = refreshPlannerSourceContent(plan, { ...next, dueAt: undefined });
    expect(withdrawn.dueAt).toBeNull();
    expect((withdrawn.tasks as Record<string, unknown>[])[0].dueAt).toBeUndefined();
    expect(() => assertPlannerSourceEdit(withdrawn, structuredClone(withdrawn))).not.toThrow();
  });

  it("does not bind an unrelated personal task and preserves nonlegacy official guards", () => {
    const personal = { id: "personal", dueAt: 100 };
    expect(bindPlannerSourceTask(legacy, personal)).toBe(personal);
    expect(() => assertPlannerSourceEdit({ tasks: [personal] }, { tasks: [{ ...personal, dueAt: 200 }] })).not.toThrow();
    const official = { ...personal, officialDeadlineRef: "school:other" };
    expect(() => assertPlannerSourceEdit({ tasks: [official] }, { tasks: [personal] })).toThrow("PLANNER_SOURCE_METADATA_LOCKED");
  });
});
