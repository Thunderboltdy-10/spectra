export type PlanStatus = "backlog" | "todo" | "doing" | "blocked" | "done";

export type PlanTask = {
  id: string;
  title: string;
  description: string;
  sectionId?: string;
  parentTaskId?: string;
  milestoneId?: string;
  dependencyIds: string[];
  estimateMinutes?: number;
  status: PlanStatus;
  assigneeIds: string[];
  referenceIds: string[];
  sourceRefs: string[];
  dueAt?: number;
  officialDeadlineRef?: string;
  calendarBlockIds: string[];
  /** Human-readable reminder offsets, e.g. "1 day before". */
  reminders: string[];
  checklist: Array<{ id: string; title: string; done: boolean }>;
  order: number;
};

export type PlanContent = {
  version: 4;
  title?: string;
  description: string;
  sections: Array<{ id: string; title: string; order: number }>;
  milestones: Array<{
    id: string;
    title: string;
    dueAt?: number;
    status: "planned" | "reached" | "missed";
    order: number;
  }>;
  tasks: PlanTask[];
  views: Array<{
    id: string;
    kind: "list" | "board" | "timeline";
    title: string;
    filters?: Record<string, unknown>;
  }>;
};

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

/** Idempotently upgrades the historical one-task planner payload to a Plan. */
export function normalizePlanContent(value: unknown): PlanContent {
  const row = object(value);
  if (Array.isArray(row.tasks)) {
    return {
      version: 4,
      title: typeof row.title === "string" ? row.title : undefined,
      description: typeof row.description === "string" ? row.description : "",
      sections: Array.isArray(row.sections)
        ? row.sections.map((candidate, index) => {
            const section = object(candidate);
            return {
              id: String(section.id ?? `section-${index + 1}`),
              title: String(section.title ?? `Section ${index + 1}`),
              order: Number(section.order ?? index),
            };
          })
        : [],
      milestones: Array.isArray(row.milestones)
        ? row.milestones.map((candidate, index) => {
            const milestone = object(candidate);
            return {
              id: String(milestone.id ?? `milestone-${index + 1}`),
              title: String(milestone.title ?? `Milestone ${index + 1}`),
              dueAt: Number.isFinite(milestone.dueAt)
                ? Number(milestone.dueAt)
                : undefined,
              status:
                milestone.status === "reached" || milestone.status === "missed"
                  ? milestone.status
                  : "planned",
              order: Number(milestone.order ?? index),
            };
          })
        : [],
      tasks: row.tasks.map((candidate, index) => normalizePlanTask(candidate, index)),
      views: Array.isArray(row.views)
        ? row.views.map((candidate, index) => {
            const view = object(candidate);
            return {
              id: String(view.id ?? `view-${index + 1}`),
              kind:
                view.kind === "board" || view.kind === "timeline"
                  ? view.kind
                  : "list",
              title: String(view.title ?? "Plan"),
              filters:
                view.filters && typeof view.filters === "object"
                  ? (view.filters as Record<string, unknown>)
                  : undefined,
            };
          })
        : defaultViews(),
    };
  }
  const title =
    typeof row.taskTitle === "string" && row.taskTitle.trim()
      ? row.taskTitle.trim()
      : "First task";
  return {
    version: 4,
    title: typeof row.title === "string" ? row.title : undefined,
    description: typeof row.description === "string" ? row.description : "",
    sections: [],
    milestones: [],
    tasks: [
      normalizePlanTask(
        {
          id: "task-1",
          title,
          description: row.description,
          status: row.status,
          estimateMinutes: row.estimateMinutes,
          dueAt: row.dueAt,
          referenceIds: row.linkedArtifactIds,
          sourceRefs: row.sourceRefs,
          reminders: row.reminders,
          checklist: row.subtasks,
        },
        0,
      ),
    ],
    views: defaultViews(),
  };
}

function normalizePlanTask(value: unknown, index: number): PlanTask {
  const row = object(value);
  const status: PlanStatus =
    row.status === "backlog" ||
    row.status === "doing" ||
    row.status === "blocked" ||
    row.status === "done"
      ? row.status
      : "todo";
  return {
    id: String(row.id ?? `task-${index + 1}`),
    title: String(row.title ?? row.taskTitle ?? `Task ${index + 1}`),
    description: typeof row.description === "string" ? row.description : "",
    sectionId: typeof row.sectionId === "string" ? row.sectionId : undefined,
    parentTaskId:
      typeof row.parentTaskId === "string" ? row.parentTaskId : undefined,
    milestoneId:
      typeof row.milestoneId === "string" ? row.milestoneId : undefined,
    dependencyIds: strings(row.dependencyIds),
    estimateMinutes: Number.isFinite(row.estimateMinutes)
      ? Number(row.estimateMinutes)
      : undefined,
    status,
    assigneeIds: strings(row.assigneeIds),
    referenceIds: strings(row.referenceIds),
    sourceRefs: strings(row.sourceRefs),
    dueAt: Number.isFinite(row.dueAt) ? Number(row.dueAt) : undefined,
    officialDeadlineRef:
      typeof row.officialDeadlineRef === "string"
        ? row.officialDeadlineRef
        : undefined,
    calendarBlockIds: strings(row.calendarBlockIds),
    reminders: strings(row.reminders),
    checklist: Array.isArray(row.checklist)
      ? row.checklist.map((candidate, checklistIndex) => {
          const item = object(candidate);
          return {
            id: String(item.id ?? `check-${checklistIndex + 1}`),
            title: String(item.title ?? "Checklist item"),
            done: item.done === true,
          };
        })
      : [],
    order: Number(row.order ?? index),
  };
}

function defaultViews(): PlanContent["views"] {
  return [
    { id: "list", kind: "list", title: "List" },
    { id: "board", kind: "board", title: "Board" },
    { id: "timeline", kind: "timeline", title: "Timeline" },
  ];
}

export function validatePlanDependencies(plan: PlanContent) {
  const ids = new Set(plan.tasks.map((task) => task.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("PLAN_DEPENDENCY_CYCLE");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencyIds ?? []) {
      if (!ids.has(dependency)) throw new Error("PLAN_DEPENDENCY_MISSING");
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  return true;
}
