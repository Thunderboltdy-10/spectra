import { z } from "zod";
import type { ArtifactBlueprint } from "../../core";

export const plannerTaskContentSchema = z
  .object({
    taskTitle: z.string().max(500).optional(),
    description: z.string().optional(),
    dueAt: z.number().nullable().optional(),
    startAt: z.number().nullable().optional(),
    endAt: z.number().nullable().optional(),
    allDay: z.boolean().optional(),
    status: z.enum(["todo", "doing", "done"]),
    priority: z.enum(["low", "medium", "high"]).optional(),
    linkedArtifactIds: z.array(z.string()).max(30).optional(),
    linkedThreadIds: z.array(z.string()).max(12).optional(),
    subtasks: z
      .array(
        z
          .object({
            id: z.string().trim().min(1),
            title: z.string().max(500),
            done: z.boolean(),
          })
          .passthrough(),
      )
      .max(100)
      .optional(),
    attachments: z
      .array(
        z
          .object({
            id: z.string().trim().min(1),
            name: z.string().max(240),
            meta: z.string().max(500).optional(),
            assetId: z.string().max(200),
            mediaType: z.string().trim().min(1).max(200),
            bytes: z.number().int().nonnegative(),
          })
          .passthrough(),
      )
      .max(30)
      .optional(),
    reminders: z
      .array(
        z
          .object({
            id: z.string().trim().min(1),
            minutesBefore: z.number().int().min(0).max(525_600),
            enabled: z.boolean(),
          })
          .passthrough(),
      )
      .max(24)
      .optional(),
    estimateMinutes: z
      .number()
      .int()
      .positive()
      .max(100_000)
      .nullable()
      .optional(),
    progressNote: z.string().max(2_000).optional(),
    sourceRefs: z.array(z.string()).max(20).optional(),
    timezone: z.string().trim().min(1).max(100),
    recurrence: z
      .object({
        frequency: z.enum(["none", "daily", "weekly", "monthly", "yearly"]),
        interval: z.number().int().min(1).max(365),
        weekdays: z.array(z.number().int().min(0).max(6)).max(7),
        untilAt: z.number().optional(),
        exceptions: z.array(z.number()).max(500),
      })
      .passthrough(),
    assignees: z
      .array(
        z
          .object({
            accountId: z.string().trim().min(1),
            name: z.string().max(240),
            email: z.string().email().or(z.literal("")),
          })
          .passthrough(),
      )
      .max(100)
      .optional(),
    watchers: z
      .array(
        z
          .object({
            accountId: z.string().trim().min(1),
            name: z.string().max(240),
            email: z.string().email().or(z.literal("")),
          })
          .passthrough(),
      )
      .max(100)
      .optional(),
    source: z
      .object({
        provider: z.enum(["managebac", "import", "spectra"]),
        externalId: z.string().trim().min(1).max(500),
        version: z.string().max(500).optional(),
        hash: z.string().max(500).optional(),
        status: z.enum(["active", "changed", "removed", "detached"]),
        lockedFields: z.array(z.string()).max(40),
      })
      .passthrough()
      .optional(),
    personalOverlay: z
      .object({
        targetDueAt: z.number().optional(),
        note: z.string().max(20_000).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .superRefine((task, context) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: task.timezone }).format();
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timezone"],
        message: "Use a valid IANA timezone.",
      });
    }
    if (task.startAt && task.endAt && task.endAt <= task.startAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "End must be after start.",
      });
    }
    if (task.startAt && task.dueAt && task.dueAt < task.startAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueAt"],
        message: "Due time cannot be before start.",
      });
    }
  });

export const plannerTaskBlueprint: ArtifactBlueprint = {
  key: "planner_task",
  name: "Planner Task",
  description: "A due-date aware task with links to study work.",
  version: 3,
  schema: plannerTaskContentSchema,
  defaultContent: {
    status: "todo",
    priority: "medium",
    timezone: "UTC",
    recurrence: {
      frequency: "none",
      interval: 1,
      weekdays: [],
      exceptions: [],
    },
    subtasks: [],
    attachments: [],
    reminders: [],
    sourceRefs: [],
    assignees: [],
    watchers: [],
    linkedArtifactIds: [],
    linkedThreadIds: [],
  },
  rendererKey: "planner_task",
  operations: [
    "create",
    "update_status",
    "decompose",
    "estimate",
    "schedule",
    "set_recurrence",
    "link_artifact",
    "link_thread",
    "add_to_workspace",
  ],
  searchableFields: ["taskTitle", "description", "progressNote"],
};
