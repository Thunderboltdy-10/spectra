import { z } from "zod";

export const PLAN_STATUSES = [
  "backlog",
  "todo",
  "doing",
  "blocked",
  "done",
] as const;
export const PLAN_PRIORITIES = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export const PLAN_VIEW_KINDS = [
  "list",
  "board",
  "timeline",
  "workload",
] as const;
export const PLAN_RECURRENCE_FREQUENCIES = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];
export type PlanPriority = (typeof PLAN_PRIORITIES)[number];
export type PlanViewKind = (typeof PLAN_VIEW_KINDS)[number];
export type PlanRecurrenceFrequency =
  (typeof PLAN_RECURRENCE_FREQUENCIES)[number];

const id = z.string().trim().min(1).max(180);
const timestamp = z.number().finite();

export const planRecurrenceSchema = z
  .object({
    frequency: z.enum(PLAN_RECURRENCE_FREQUENCIES),
    interval: z.number().int().min(1).max(365),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7),
    untilAt: timestamp.optional(),
    exceptions: z.array(timestamp).max(500),
  })
  .strict();

export const planReminderSchema = z
  .object({
    id,
    minutesBefore: z.number().int().min(0).max(525_600),
    enabled: z.boolean(),
  })
  .strict();

export const planFilterSchema = z
  .object({
    statuses: z.array(z.enum(PLAN_STATUSES)).max(PLAN_STATUSES.length).optional(),
    sectionIds: z.array(id).max(100).optional(),
    milestoneIds: z.array(id).max(100).optional(),
    assigneeIds: z.array(id).max(100).optional(),
    priorities: z.array(z.enum(PLAN_PRIORITIES)).max(PLAN_PRIORITIES.length).optional(),
    labels: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    dueBetween: z
      .object({ from: timestamp.optional(), to: timestamp.optional() })
      .strict()
      .optional(),
    fromOfficialSource: z.boolean().optional(),
    search: z.string().max(500).optional(),
  })
  .strict();

export const planTaskSchema = z
  .object({
    id,
    title: z.string().trim().min(1).max(500),
    description: z.string().max(100_000),
    sectionId: id.optional(),
    parentTaskId: id.optional(),
    milestoneId: id.optional(),
    dependencyIds: z.array(id).max(500),
    estimateMinutes: z.number().int().positive().max(100_000).optional(),
    status: z.enum(PLAN_STATUSES),
    priority: z.enum(PLAN_PRIORITIES),
    labels: z.array(z.string().trim().min(1).max(80)).max(100),
    assigneeIds: z.array(id).max(100),
    referenceIds: z.array(id).max(100),
    sourceRefs: z.array(z.string().trim().min(1).max(500)).max(100),
    dueAt: timestamp.optional(),
    officialDeadlineRef: z.string().trim().min(1).max(500).optional(),
    /** Legacy relationship hints only. Workload never reads these IDs. */
    calendarBlockIds: z.array(id).max(500),
    checklist: z
      .array(
        z
          .object({
            id,
            title: z.string().trim().min(1).max(500),
            done: z.boolean(),
          })
          .strict(),
      )
      .max(500),
    recurrence: planRecurrenceSchema,
    reminders: z.array(planReminderSchema).max(24),
    completedOccurrences: z
      .array(
        z
          .object({
            completedAt: timestamp,
            scheduledDueAt: timestamp.optional(),
          })
          .strict(),
      )
      .max(500),
    order: z.number().finite(),
  })
  .strict();

export const planContentSchema = z
  .object({
    version: z.literal(4),
    title: z.string().max(500).optional(),
    description: z.string().max(100_000),
    timezone: z.string().trim().min(1).max(100),
    linkedArtifactIds: z.array(id).max(30).optional(),
    linkedThreadIds: z.array(id).max(12).optional(),
    source: z
      .object({
        provider: z.enum(["managebac", "import", "spectra"]),
        externalId: z.string().trim().min(1).max(500),
        version: z.string().max(500).optional(),
        hash: z.string().max(500).optional(),
        status: z.enum(["active", "changed", "removed", "detached"]),
        lockedFields: z.array(z.string().max(100)).max(40),
      })
      .strict()
      .optional(),
    personalOverlay: z
      .object({
        targetDueAt: timestamp.optional(),
        note: z.string().max(20_000).optional(),
      })
      .strict()
      .optional(),
    sections: z
      .array(
        z
          .object({
            id,
            title: z.string().trim().min(1).max(500),
            order: z.number().finite(),
          })
          .strict(),
      )
      .max(500),
    milestones: z
      .array(
        z
          .object({
            id,
            title: z.string().trim().min(1).max(500),
            dueAt: timestamp.optional(),
            status: z.enum(["planned", "reached", "missed"]),
            order: z.number().finite(),
          })
          .strict(),
      )
      .max(500),
    tasks: z.array(planTaskSchema).max(20_000),
    views: z
      .array(
        z
          .object({
            id,
            kind: z.enum(PLAN_VIEW_KINDS),
            title: z.string().trim().min(1).max(200),
            filters: planFilterSchema.optional(),
            system: z.boolean().optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .superRefine((plan, context) => {
    const taskIds = new Set<string>();
    const sectionIds = new Set<string>();
    const milestoneIds = new Set<string>();
    const viewIds = new Set<string>();
    plan.sections.forEach((section, index) => {
      if (sectionIds.has(section.id))
        context.addIssue({
          code: "custom",
          path: ["sections", index, "id"],
          message: "Section IDs must be unique.",
        });
      sectionIds.add(section.id);
    });
    plan.milestones.forEach((milestone, index) => {
      if (milestoneIds.has(milestone.id))
        context.addIssue({
          code: "custom",
          path: ["milestones", index, "id"],
          message: "Milestone IDs must be unique.",
        });
      milestoneIds.add(milestone.id);
    });
    plan.tasks.forEach((task, index) => {
      if (taskIds.has(task.id))
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "id"],
          message: "Task IDs must be unique.",
        });
      taskIds.add(task.id);
      if (task.sectionId && !sectionIds.has(task.sectionId))
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "sectionId"],
          message: "Task section must exist.",
        });
      if (task.milestoneId && !milestoneIds.has(task.milestoneId))
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "milestoneId"],
          message: "Task milestone must exist.",
        });
      if (task.officialDeadlineRef && task.recurrence.frequency !== "none")
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "recurrence"],
          message: "Official deadlines cannot be made recurring in Plan.",
        });
      const checklistIds = new Set<string>();
      task.checklist.forEach((item, itemIndex) => {
        if (checklistIds.has(item.id))
          context.addIssue({
            code: "custom",
            path: ["tasks", index, "checklist", itemIndex, "id"],
            message: "Checklist item IDs must be unique within a task.",
          });
        checklistIds.add(item.id);
      });
      const reminderIds = new Set<string>();
      task.reminders.forEach((reminder, reminderIndex) => {
        if (reminderIds.has(reminder.id))
          context.addIssue({
            code: "custom",
            path: ["tasks", index, "reminders", reminderIndex, "id"],
            message: "Reminder IDs must be unique within a task.",
          });
        reminderIds.add(reminder.id);
      });
    });
    plan.views.forEach((view, index) => {
      if (viewIds.has(view.id))
        context.addIssue({
          code: "custom",
          path: ["views", index, "id"],
          message: "Saved-view IDs must be unique.",
        });
      viewIds.add(view.id);
    });
    try {
      new Intl.DateTimeFormat("en", { timeZone: plan.timezone }).format();
    } catch {
      context.addIssue({
        code: "custom",
        path: ["timezone"],
        message: "Use a valid IANA timezone.",
      });
    }
    try {
      validatePlanDependencies(plan as PlanContent);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message:
          error instanceof Error && error.message.includes("CYCLE")
            ? "Task relationships cannot contain cycles."
            : "Task relationships must point to tasks in this plan.",
      });
    }
  });

export type PlanRecurrence = z.infer<typeof planRecurrenceSchema>;
export type PlanReminder = z.infer<typeof planReminderSchema>;
export type PlanFilter = z.infer<typeof planFilterSchema>;
export type PlanTask = z.infer<typeof planTaskSchema>;
export type PlanContent = z.infer<typeof planContentSchema>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === "string")
    : [];
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizedTimezone(value: unknown) {
  const timezone =
    typeof value === "string" && value.trim() ? value.trim() : "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "UTC";
  }
}

function normalizeLabels(value: unknown) {
  return [
    ...new Set(strings(value).map((label) => label.trim()).filter(Boolean)),
  ].slice(0, 100);
}

function normalizeAssigneeIds(value: unknown) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : []).flatMap((candidate) => {
        if (typeof candidate === "string") return candidate.trim() ? [candidate] : [];
        const person = object(candidate);
        return typeof person.accountId === "string" && person.accountId.trim()
          ? [person.accountId]
          : [];
      }),
    ),
  ].slice(0, 100);
}

function normalizeRecurrence(value: unknown): PlanRecurrence {
  const row = object(value);
  const frequency = PLAN_RECURRENCE_FREQUENCIES.includes(
    row.frequency as PlanRecurrenceFrequency,
  )
    ? (row.frequency as PlanRecurrenceFrequency)
    : "none";
  return {
    frequency,
    interval: Math.max(
      1,
      Math.min(365, Math.round(finite(row.interval) ?? 1)),
    ),
    weekdays: [
      ...new Set(
        (Array.isArray(row.weekdays) ? row.weekdays : []).filter(
          (day): day is number =>
            Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6,
        ),
      ),
    ],
    ...(finite(row.untilAt) !== undefined
      ? { untilAt: finite(row.untilAt) }
      : {}),
    exceptions: (Array.isArray(row.exceptions) ? row.exceptions : [])
      .filter(
        (entry): entry is number =>
          typeof entry === "number" && Number.isFinite(entry),
      )
      .slice(0, 500),
  };
}

function normalizeFilter(value: unknown): PlanFilter | undefined {
  const filter = object(value);
  if (!Object.keys(filter).length) return undefined;
  const parsed = planFilterSchema.safeParse(filter);
  return parsed.success ? parsed.data : undefined;
}

/** Idempotently upgrades the historical one-task/v3 planner payload to Plan v4. */
export function normalizePlanContent(value: unknown): PlanContent {
  const row = object(value);
  const timezone = normalizedTimezone(row.timezone);
  if (Array.isArray(row.tasks)) {
    const sections = Array.isArray(row.sections)
      ? row.sections.map((candidate, index) => {
          const section = object(candidate);
          return {
            id: String(section.id ?? `section-${index + 1}`),
            title: String(section.title ?? `Section ${index + 1}`),
            order: finite(section.order) ?? index,
          };
        })
      : [];
    const milestones = Array.isArray(row.milestones)
      ? row.milestones.map((candidate, index): PlanContent["milestones"][number] => {
          const milestone = object(candidate);
          return {
            id: String(milestone.id ?? `milestone-${index + 1}`),
            title: String(milestone.title ?? `Milestone ${index + 1}`),
            ...(finite(milestone.dueAt) !== undefined
              ? { dueAt: finite(milestone.dueAt) }
              : {}),
            status:
              milestone.status === "reached" || milestone.status === "missed"
                ? milestone.status
                : ("planned" as const),
            order: finite(milestone.order) ?? index,
          };
        })
      : [];
    const plan: PlanContent = {
      version: 4,
      ...(typeof row.title === "string" ? { title: row.title } : {}),
      description: typeof row.description === "string" ? row.description : "",
      timezone,
      ...(strings(row.linkedArtifactIds).length
        ? { linkedArtifactIds: strings(row.linkedArtifactIds) }
        : {}),
      ...(strings(row.linkedThreadIds).length
        ? { linkedThreadIds: strings(row.linkedThreadIds) }
        : {}),
      ...(planContentSource(row.source, row.version !== 4)
        ? { source: planContentSource(row.source, row.version !== 4) }
        : {}),
      ...(planPersonalOverlay(row.personalOverlay)
        ? { personalOverlay: planPersonalOverlay(row.personalOverlay) }
        : {}),
      sections,
      milestones,
      tasks: row.tasks.map((candidate, index) =>
        normalizePlanTask(candidate, index),
      ),
      views: Array.isArray(row.views)
        ? row.views.map((candidate, index) => {
            const view = object(candidate);
            const kind = PLAN_VIEW_KINDS.includes(view.kind as PlanViewKind)
              ? (view.kind as PlanViewKind)
              : "list";
            const filters = normalizeFilter(view.filters);
            return {
              id: String(view.id ?? `view-${index + 1}`),
              kind,
              title: String(view.title ?? "Plan"),
              ...(filters ? { filters } : {}),
              ...(view.system === true ? { system: true } : {}),
            };
          })
        : defaultViews(),
    };
    ensureDefaultViews(plan.views);
    return plan;
  }

  const title =
    typeof row.taskTitle === "string" && row.taskTitle.trim()
      ? row.taskTitle.trim()
      : "First task";
  return {
    version: 4,
    ...(typeof row.title === "string" ? { title: row.title } : {}),
    description: "",
    timezone,
    ...(strings(row.linkedArtifactIds).length
      ? { linkedArtifactIds: strings(row.linkedArtifactIds) }
      : {}),
    ...(strings(row.linkedThreadIds).length
      ? { linkedThreadIds: strings(row.linkedThreadIds) }
      : {}),
    ...(planContentSource(row.source, true)
      ? { source: planContentSource(row.source, true) }
      : {}),
    ...(planPersonalOverlay(row.personalOverlay)
      ? { personalOverlay: planPersonalOverlay(row.personalOverlay) }
      : {}),
    sections: [],
    milestones: [],
    tasks: [
      normalizePlanTask(
        {
          id: "task-1",
          title,
          description: row.description,
          status: row.status,
          priority: row.priority,
          labels: row.labels,
          estimateMinutes: row.estimateMinutes,
          dueAt: row.dueAt,
          referenceIds: row.linkedArtifactIds,
          sourceRefs: row.sourceRefs,
          assignees: row.assignees,
          checklist: row.subtasks,
          recurrence: row.recurrence,
          reminders: row.reminders,
        },
        0,
      ),
    ],
    views: defaultViews(),
  };
}

function planContentSource(
  value: unknown,
  migrateLegacyPointers: boolean,
): PlanContent["source"] {
  const source = object(value);
  if (
    source.provider !== "managebac" &&
    source.provider !== "import" &&
    source.provider !== "spectra"
  )
    return undefined;
  if (typeof source.externalId !== "string" || !source.externalId.trim())
    return undefined;
  return {
    provider: source.provider,
    externalId: source.externalId.trim(),
    ...(typeof source.version === "string" ? { version: source.version } : {}),
    ...(typeof source.hash === "string" ? { hash: source.hash } : {}),
    status:
      source.status === "changed" ||
      source.status === "removed" ||
      source.status === "detached"
        ? source.status
        : "active",
    lockedFields: strings(source.lockedFields)
      .map((field) => {
        if (!migrateLegacyPointers) return field;
        if (field === "taskTitle") return "tasks/0/title";
        if (field === "description") return "tasks/0/description";
        if (field === "dueAt") return "tasks/0/dueAt";
        return field;
      })
      .slice(0, 40),
  };
}

function planPersonalOverlay(value: unknown): PlanContent["personalOverlay"] {
  const overlay = object(value);
  const targetDueAt = finite(overlay.targetDueAt);
  const note = typeof overlay.note === "string" ? overlay.note : undefined;
  if (targetDueAt === undefined && note === undefined) return undefined;
  return {
    ...(targetDueAt !== undefined ? { targetDueAt } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

function normalizePlanTask(value: unknown, index: number): PlanTask {
  const row = object(value);
  const statusAliases: Record<string, PlanStatus> = {
    pending: "todo",
    not_started: "todo",
    open: "todo",
    in_progress: "doing",
    active: "doing",
    complete: "done",
    completed: "done",
    finished: "done",
  };
  const rawStatus = String(row.status ?? "todo")
    .toLowerCase()
    .replaceAll(/[\s.-]+/g, "_");
  const status = PLAN_STATUSES.includes(rawStatus as PlanStatus)
    ? (rawStatus as PlanStatus)
    : (statusAliases[rawStatus] ?? "todo");
  const rawPriority = String(row.priority ?? "none").toLowerCase();
  const priority = PLAN_PRIORITIES.includes(rawPriority as PlanPriority)
    ? (rawPriority as PlanPriority)
    : "none";
  const reminders = Array.isArray(row.reminders)
    ? row.reminders.flatMap((candidate, reminderIndex) => {
        const reminder = object(candidate);
        const minutesBefore = finite(reminder.minutesBefore);
        if (minutesBefore === undefined) return [];
        return [
          {
            id: String(reminder.id ?? `reminder-${reminderIndex + 1}`),
            minutesBefore: Math.max(
              0,
              Math.min(525_600, Math.round(minutesBefore)),
            ),
            enabled: reminder.enabled !== false,
          },
        ];
      })
    : [];
  const checklistSource = Array.isArray(row.checklist)
    ? row.checklist
    : Array.isArray(row.subtasks)
      ? row.subtasks
      : [];
  return {
    id: String(row.id ?? `task-${index + 1}`),
    title: String(row.title ?? row.taskTitle ?? `Task ${index + 1}`),
    description: typeof row.description === "string" ? row.description : "",
    ...(typeof row.sectionId === "string" ? { sectionId: row.sectionId } : {}),
    ...(typeof row.parentTaskId === "string"
      ? { parentTaskId: row.parentTaskId }
      : {}),
    ...(typeof row.milestoneId === "string"
      ? { milestoneId: row.milestoneId }
      : {}),
    dependencyIds: strings(row.dependencyIds),
    ...(finite(row.estimateMinutes) !== undefined
      ? {
          estimateMinutes: Math.max(
            1,
            Math.round(finite(row.estimateMinutes)!),
          ),
        }
      : {}),
    status,
    priority,
    labels: normalizeLabels(row.labels),
    assigneeIds: normalizeAssigneeIds(row.assigneeIds ?? row.assignees),
    referenceIds: strings(row.referenceIds ?? row.linkedArtifactIds),
    sourceRefs: strings(row.sourceRefs),
    ...(finite(row.dueAt) !== undefined ? { dueAt: finite(row.dueAt) } : {}),
    ...(typeof row.officialDeadlineRef === "string"
      ? { officialDeadlineRef: row.officialDeadlineRef }
      : {}),
    calendarBlockIds: strings(row.calendarBlockIds),
    checklist: checklistSource.map((candidate, checklistIndex) => {
      const item = object(candidate);
      return {
        id: String(item.id ?? `check-${checklistIndex + 1}`),
        title: String(item.title ?? item.text ?? "Checklist item"),
        done: item.done === true,
      };
    }),
    recurrence: normalizeRecurrence(row.recurrence),
    reminders,
    completedOccurrences: Array.isArray(row.completedOccurrences)
      ? row.completedOccurrences
          .flatMap((candidate) => {
            const occurrence = object(candidate);
            const completedAt = finite(occurrence.completedAt);
            if (completedAt === undefined) return [];
            const scheduledDueAt = finite(occurrence.scheduledDueAt);
            return [
              {
                completedAt,
                ...(scheduledDueAt !== undefined ? { scheduledDueAt } : {}),
              },
            ];
          })
          .slice(-500)
      : [],
    order: finite(row.order) ?? index,
  };
}

export function defaultViews(): PlanContent["views"] {
  return [
    { id: "list", kind: "list", title: "List", system: true },
    { id: "board", kind: "board", title: "Board", system: true },
    { id: "timeline", kind: "timeline", title: "Timeline", system: true },
    { id: "workload", kind: "workload", title: "Workload", system: true },
  ];
}

function ensureDefaultViews(views: PlanContent["views"]) {
  for (const view of defaultViews()) {
    if (!views.some((candidate) => candidate.id === view.id)) views.push(view);
  }
}

export function validatePlanDependencies(plan: PlanContent) {
  const ids = new Set(plan.tasks.map((task) => task.id));
  const visitingDependencies = new Set<string>();
  const visitedDependencies = new Set<string>();
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const visitDependency = (taskId: string) => {
    if (visitingDependencies.has(taskId))
      throw new Error("PLAN_DEPENDENCY_CYCLE");
    if (visitedDependencies.has(taskId)) return;
    visitingDependencies.add(taskId);
    for (const dependency of byId.get(taskId)?.dependencyIds ?? []) {
      if (!ids.has(dependency)) throw new Error("PLAN_DEPENDENCY_MISSING");
      visitDependency(dependency);
    }
    visitingDependencies.delete(taskId);
    visitedDependencies.add(taskId);
  };
  for (const taskId of ids) visitDependency(taskId);

  for (const task of plan.tasks) {
    const parents = new Set<string>([task.id]);
    let parentId = task.parentTaskId;
    while (parentId) {
      if (!ids.has(parentId)) throw new Error("PLAN_PARENT_MISSING");
      if (parents.has(parentId)) throw new Error("PLAN_PARENT_CYCLE");
      parents.add(parentId);
      parentId = byId.get(parentId)?.parentTaskId;
    }
  }
  return true;
}
