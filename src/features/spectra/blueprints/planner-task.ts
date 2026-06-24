import { z } from "zod";
import type { ArtifactBlueprint } from "../core";

export const plannerTaskContentSchema = z.object({
  description: z.string().optional(),
  dueAt: z.number().nullable().optional(),
  startAt: z.number().nullable().optional(),
  endAt: z.number().nullable().optional(),
  allDay: z.boolean().optional(),
  status: z.enum(["todo", "doing", "done"]),
  priority: z.enum(["low", "medium", "high"]).optional(),
  linkedArtifactIds: z.array(z.string()).max(30).optional(),
  linkedThreadIds: z.array(z.string()).max(12).optional(),
  subtasks: z.array(z.object({
    id: z.string().trim().min(1),
    title: z.string().max(500),
    done: z.boolean(),
  }).passthrough()).max(100).optional(),
  attachments: z.array(z.object({
    id: z.string().trim().min(1),
    name: z.string().max(240),
    meta: z.string().max(500).optional(),
    url: z.string().url().optional(),
  }).passthrough()).max(30).optional(),
  reminders: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  estimateMinutes: z.number().int().positive().max(100_000).nullable().optional(),
  progressNote: z.string().max(2_000).optional(),
  sourceRefs: z.array(z.string()).max(20).optional(),
}).passthrough();

export const plannerTaskBlueprint: ArtifactBlueprint = {
  key: "planner_task",
  name: "Planner Task",
  description: "A due-date aware task with links to study work.",
  version: 2,
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
