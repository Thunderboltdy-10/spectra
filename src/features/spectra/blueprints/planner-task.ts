import { z } from "zod";
import type { ArtifactBlueprint } from "../core";

export const plannerTaskContentSchema = z.object({
  description: z.string().optional(),
  dueAt: z.number().optional(),
  status: z.enum(["todo", "doing", "done"]),
  priority: z.enum(["low", "medium", "high"]).optional(),
  linkedArtifactIds: z.array(z.string()).optional(),
  linkedThreadIds: z.array(z.string()).optional(),
});

export const plannerTaskBlueprint: ArtifactBlueprint = {
  key: "planner_task",
  name: "Planner Task",
  description: "A due-date aware task with links to study work.",
  version: 1,
  schema: plannerTaskContentSchema,
  defaultContent: {
    status: "todo",
    linkedArtifactIds: [],
    linkedThreadIds: [],
  },
  rendererKey: "planner_task",
  operations: ["create", "update_status", "link_artifact", "link_thread", "add_to_workspace"],
  searchableFields: ["description"],
};

