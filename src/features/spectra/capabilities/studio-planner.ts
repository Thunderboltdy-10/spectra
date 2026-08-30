import { z } from "zod";
import type { CommandContext } from "../commands/types";
import {
  PLAN_PRIORITIES,
  PLAN_RECURRENCE_FREQUENCIES,
  PLAN_STATUSES,
  PLAN_VIEW_KINDS,
  planFilterSchema,
  planRecurrenceSchema,
} from "../plan/model";
import type { CapabilityDefinition } from "./types";

const id = z.string().trim().min(1).max(180);
const ids = z.array(id).max(20_000);
const none = z.null();

function available(ctx: CommandContext) {
  return ctx.can("edit")
    ? ({ state: "enabled" } as const)
    : ({ state: "hidden" } as const);
}

function readable() {
  return { state: "enabled" } as const;
}

function plannerCapability<P>(
  localId: string,
  params: z.ZodType<P>,
  description: string,
  options: {
    mutate?: boolean;
    exposed?: boolean;
    risk?: CapabilityDefinition["ai"]["riskClass"];
    manifest?: string;
    region?: string;
  } = {},
): CapabilityDefinition<"planner_task", P> {
  const capabilityId =
    "planner_task." + localId.replaceAll(/[^a-zA-Z0-9]+/g, ".");
  return {
    id: capabilityId as CapabilityDefinition<"planner_task", P>["id"],
    params,
    scope: "artifact",
    availability: options.mutate === false ? readable : available,
    execute: { editor: capabilityId },
    ai: {
      exposed: options.exposed ?? true,
      description,
      riskClass: options.risk ?? "safe",
    },
    choreography: {
      target: options.mutate === false ? "workbar-command" : "planner-region",
      region: options.region ?? capabilityId,
    },
    ...(options.mutate === false ? {} : { requires: "edit" as const }),
    ...(options.manifest ? { manifestOperation: options.manifest } : {}),
  };
}

const taskCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    sectionId: id.optional(),
    parentTaskId: id.optional(),
    status: z.enum(PLAN_STATUSES).optional(),
  })
  .strict();
const taskTextSchema = z
  .object({ taskId: id, value: z.string().max(100_000) })
  .strict();
const taskIdSchema = z.object({ taskId: id }).strict();
const statusSchema = z
  .object({
    taskId: id,
    status: z.enum(PLAN_STATUSES),
    completedAt: z.number().optional(),
  })
  .strict();
const optionalIdSchema = z
  .object({ taskId: id, value: id.nullable() })
  .strict();
const dueSchema = z
  .object({
    taskId: id,
    dueAt: z.number().finite().nullable().optional(),
    phrase: z.string().trim().min(1).max(200).optional(),
    now: z.number().finite().optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => value.dueAt !== undefined || value.phrase, {
    message: "Supply an exact due time or a bounded due phrase.",
  });
const labelsSchema = z
  .object({
    taskId: id,
    labels: z.array(z.string().trim().min(1).max(80)).max(100),
    mode: z.enum(["set", "add", "remove"]).default("set"),
  })
  .strict();
const checklistSchema = z
  .object({
    taskId: id,
    itemId: id.optional(),
    title: z.string().trim().min(1).max(500).optional(),
    done: z.boolean().optional(),
  })
  .strict();
const savedViewSchema = z
  .object({
    viewId: id,
    title: z.string().trim().min(1).max(200),
    kind: z.enum(PLAN_VIEW_KINDS),
    filters: planFilterSchema.optional(),
  })
  .strict();
const bulkBase = { taskIds: ids };

export const PLANNER_CAPABILITIES: readonly CapabilityDefinition[] = [
  plannerCapability("task.create", taskCreateSchema, "Create a task in this plan.", {
    manifest: "create_task",
  }),
  plannerCapability("task.title", taskTextSchema, "Rename a task.", {
    manifest: "update_field",
  }),
  plannerCapability(
    "task.description",
    taskTextSchema,
    "Rewrite a task description.",
    { manifest: "update_field" },
  ),
  plannerCapability(
    "task.delete",
    taskIdSchema,
    "Delete a task and its nested subtasks after confirmation.",
    { risk: "destructive", manifest: "delete_task" },
  ),
  plannerCapability(
    "section.create",
    z.object({ title: z.string().trim().min(1).max(500) }).strict(),
    "Create a plan section.",
    { manifest: "create_section" },
  ),
  plannerCapability(
    "task.status",
    statusSchema,
    "Change a task status or complete one recurrence.",
    { manifest: "update_status", region: "status" },
  ),
  plannerCapability(
    "task.due",
    dueSchema,
    "Set or clear a task due date without guessing.",
    { manifest: "set_due", region: "due" },
  ),
  plannerCapability(
    "task.estimate",
    z
      .object({
        taskId: id,
        minutes: z.number().int().positive().max(100_000).nullable(),
      })
      .strict(),
    "Set or clear a task effort estimate.",
    { manifest: "estimate", region: "estimate" },
  ),
  plannerCapability(
    "task.priority",
    z.object({ taskId: id, priority: z.enum(PLAN_PRIORITIES) }).strict(),
    "Set task priority.",
    { manifest: "set_priority", region: "priority" },
  ),
  plannerCapability("task.labels", labelsSchema, "Set, add, or remove task labels.", {
    manifest: "set_labels",
    region: "labels",
  }),
  plannerCapability("task.parent", optionalIdSchema, "Nest or unnest a task under another task.", {
    manifest: "set_parent",
    region: "parent",
  }),
  plannerCapability("task.section", optionalIdSchema, "Move a task to a plan section.", {
    manifest: "move_to_section",
    region: "section",
  }),
  plannerCapability("task.milestone", optionalIdSchema, "Attach or detach a task milestone.", {
    manifest: "set_milestone",
    region: "milestone",
  }),
  plannerCapability(
    "task.dependencies",
    z.object({ taskId: id, dependencyIds: ids }).strict(),
    "Replace a task's dependency set after cycle validation.",
    { manifest: "set_dependencies", region: "dependencies" },
  ),
  plannerCapability(
    "task.recurrence",
    z.object({ taskId: id, recurrence: planRecurrenceSchema }).strict(),
    "Configure a bounded daily, weekly, monthly, or yearly recurrence.",
    { risk: "confirm", manifest: "set_recurrence", region: "recurrence" },
  ),
  plannerCapability(
    "task.reminders",
    z
      .object({
        taskId: id,
        reminders: z
          .array(
            z
              .object({
                id,
                minutesBefore: z.number().int().min(0).max(525_600),
                enabled: z.boolean(),
              })
              .strict(),
          )
          .max(24),
      })
      .strict(),
    "Save relative reminder timing for a task.",
    { manifest: "set_reminder", region: "reminders" },
  ),
  plannerCapability("checklist.add", checklistSchema, "Add a checklist item to a task.", {
    manifest: "add_subtask",
    region: "checklist",
  }),
  plannerCapability("checklist.update", checklistSchema, "Rename a checklist item.", {
    manifest: "update_subtask",
    region: "checklist",
  }),
  plannerCapability("checklist.toggle", checklistSchema, "Complete or reopen a checklist item.", {
    manifest: "update_subtask",
    region: "checklist",
  }),
  plannerCapability("checklist.remove", checklistSchema, "Remove a checklist item.", {
    manifest: "update_subtask",
    region: "checklist",
  }),
  plannerCapability(
    "view.select",
    z.object({ viewId: id }).strict(),
    "Open a saved planner view.",
    { mutate: false, exposed: false },
  ),
  plannerCapability(
    "view.filters",
    z.object({ filters: planFilterSchema }).strict(),
    "Apply the same typed filters to every planner projection.",
    { mutate: false, exposed: false },
  ),
  plannerCapability("view.filters.clear", none, "Clear planner filters.", {
    mutate: false,
    exposed: false,
  }),
  plannerCapability("view.save", savedViewSchema, "Save the current projection and filters.", {
    manifest: "save_view",
    region: "views",
  }),
  plannerCapability(
    "view.rename",
    z
      .object({
        viewId: id,
        title: z.string().trim().min(1).max(200),
      })
      .strict(),
    "Rename a saved view.",
    { manifest: "rename_view", region: "views" },
  ),
  plannerCapability(
    "view.delete",
    z.object({ viewId: id }).strict(),
    "Delete a non-default saved view.",
    { risk: "confirm", manifest: "delete_view", region: "views" },
  ),
  plannerCapability("workload.refresh", none, "Refresh workload from Calendar items.", {
    mutate: false,
    exposed: false,
  }),
  plannerCapability("workload.open-calendar", none, "Open Calendar to edit scheduled work.", {
    mutate: false,
    exposed: false,
  }),
  plannerCapability(
    "bulk.status",
    z
      .object({
        ...bulkBase,
        status: z.enum(PLAN_STATUSES),
        completedAt: z.number().optional(),
      })
      .strict(),
    "Change status for selected tasks while preserving dependency refusals.",
    { manifest: "bulk_update", region: "selection" },
  ),
  plannerCapability(
    "bulk.section",
    z.object({ ...bulkBase, sectionId: id.nullable() }).strict(),
    "Move selected tasks to a section.",
    { manifest: "bulk_update", region: "selection" },
  ),
  plannerCapability(
    "bulk.priority",
    z.object({ ...bulkBase, priority: z.enum(PLAN_PRIORITIES) }).strict(),
    "Set priority for selected tasks.",
    { manifest: "bulk_update", region: "selection" },
  ),
  plannerCapability(
    "bulk.labels",
    z
      .object({
        ...bulkBase,
        labels: z.array(z.string().trim().min(1).max(80)).max(100),
        mode: z.enum(["set", "add", "remove"]),
      })
      .strict(),
    "Set, add, or remove labels for selected tasks.",
    { manifest: "bulk_update", region: "selection" },
  ),
  plannerCapability(
    "bulk.due",
    z.object({ ...bulkBase, dueAt: z.number().finite().nullable() }).strict(),
    "Set or clear due dates for selected personal tasks.",
    { manifest: "bulk_update", region: "selection" },
  ),
  plannerCapability(
    "bulk.delete",
    z.object(bulkBase).strict(),
    "Delete selected tasks after naming descendants and dependents.",
    { risk: "destructive", manifest: "bulk_update", region: "selection" },
  ),
  plannerCapability("find", none, "Find tasks.", {
    mutate: false,
    exposed: false,
  }),
  plannerCapability("filters", none, "Open planner filters.", {
    mutate: false,
    exposed: false,
  }),
  plannerCapability("import", none, "Import personal tasks from CSV or TSV.", {
    exposed: false,
    manifest: "import_tasks",
  }),
  plannerCapability("export-csv", none, "Export a planner copy as CSV.", {
    mutate: false,
    exposed: false,
    manifest: "export",
  }),
  plannerCapability("export-ics", none, "Export a planner copy as calendar to-dos.", {
    mutate: false,
    exposed: false,
    manifest: "export",
  }),
  plannerCapability("export-json", none, "Export the complete Plan v4 graph.", {
    mutate: false,
    exposed: false,
    manifest: "export",
  }),
];

export const PLANNER_RECURRENCE_FREQUENCIES =
  PLAN_RECURRENCE_FREQUENCIES;
