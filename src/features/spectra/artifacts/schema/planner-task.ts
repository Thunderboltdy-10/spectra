import type { ArtifactBlueprint } from "../../core";
import { defaultViews, planContentSchema } from "../../plan/model";

/** The canonical Plan v4 schema. UI, AI, storage validation, and migrations share it. */
export const plannerTaskContentSchema = planContentSchema;

export const plannerTaskBlueprint: ArtifactBlueprint = {
  key: "planner_task",
  name: "Plan",
  description: "A connected plan with tasks, views, workload, and scheduling.",
  version: 4,
  schema: plannerTaskContentSchema,
  defaultContent: {
    version: 4,
    description: "",
    timezone: "UTC",
    linkedArtifactIds: [],
    linkedThreadIds: [],
    sections: [],
    milestones: [],
    tasks: [],
    views: defaultViews(),
  },
  rendererKey: "planner_task",
  operations: [
    "task_create",
    "task_update",
    "task_delete",
    "status_set",
    "due_set",
    "priority_set",
    "labels_set",
    "recurrence_set",
    "reminder_set",
    "checklist_update",
    "dependency_set",
    "saved_view_manage",
    "bulk_update",
    "import",
    "export",
    "workload_read",
  ],
  searchableFields: ["title", "description", "tasks"],
};
