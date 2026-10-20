import {
  normalizeMinutesBeforeReminders,
  type MinutesBeforeReminder,
} from "../reminders/minutes-before";
import { bindPlannerSourceTask, plannerSourceMetadata, legacyPlannerTask, defaultPlanViews as defaultViews } from "../../../../shared/planner-source.mjs";

export type PlanStatus = "backlog" | "todo" | "doing" | "blocked" | "done";

export type PlanReminder = MinutesBeforeReminder;

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
  /** Offsets before dueAt — same shape as Timetable / planner_task scheduling. */
  reminders: PlanReminder[];
  checklist: Array<{ id: string; title: string; done: boolean }>;
  order: number;
};

export type PlanContent = {
  version: 4;
  source?: Record<string, unknown>;
  sourceRefs?: string[];
  taskTitle?: string;
  dueAt?: number | null;
  officialDeadlineRef?: string;
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

/**
 * A planner task is one task (TaskStudio) until it holds more than one: a plan
 * with a single task and no sections or milestones is still one thing to do,
 * even once the room has given it the plan's collections (shared/planner-source).
 */
export function isSingleTask(content: unknown) {
  const row = object(content);
  if (!Array.isArray(row.tasks)) return true;
  return row.tasks.length <= 1 && !(Array.isArray(row.sections) && row.sections.length) && !(Array.isArray(row.milestones) && row.milestones.length);
}

const TASK_STATUS = { backlog: "todo", todo: "todo", doing: "doing", blocked: "doing", done: "done" } as const;

/** The steps a plan's other tasks become when it is read as one task: each was a line to tick off. */
function stepsOf(tasks: unknown[]) {
  return tasks.map((value, index) => {
    const task = object(value);
    return {
      id: typeof task.id === "string" && task.id ? task.id : `subtask-${index + 1}`,
      title: typeof task.title === "string" ? task.title : "",
      done: task.status === "done",
    };
  });
}

/**
 * One task as the task studio reads it. A task is one thing to do; a plan
 * made of several (an older shape) reads as its first task, with the others
 * as steps to tick off.
 */
export function singleTaskView(content: unknown): Record<string, unknown> {
  const row = object(content);
  if (!Array.isArray(row.tasks)) return row;
  const task = object(row.tasks[0]);
  if (!row.tasks.length) return row;
  const checklist = Array.isArray(task.checklist) ? task.checklist : Array.isArray(row.subtasks) ? row.subtasks : [];
  const rest = stepsOf(row.tasks.slice(1));
  return {
    ...row,
    taskTitle: typeof row.taskTitle === "string" && row.taskTitle ? row.taskTitle : task.title,
    description: typeof task.description === "string" && task.description ? task.description : row.description,
    status: TASK_STATUS[task.status as keyof typeof TASK_STATUS] ?? row.status ?? "todo",
    estimateMinutes: Number.isFinite(task.estimateMinutes) ? task.estimateMinutes : row.estimateMinutes,
    reminders: Array.isArray(task.reminders) ? task.reminders : row.reminders,
    subtasks: rest.length ? [...checklist, ...rest] : checklist,
    linkedArtifactIds: Array.isArray(task.referenceIds) && task.referenceIds.length ? task.referenceIds : row.linkedArtifactIds,
    dueAt: row.dueAt ?? task.dueAt ?? null,
  };
}

/**
 * Writes what the task studio changed back to the shape it came in: the top
 * fields, and the plan's one task when there is one (its other tasks now its
 * steps). A school task's date and
 * reference stay the school's (assertPlannerSourceEdit).
 */
export function applySingleTask(previous: unknown, next: Record<string, unknown>): Record<string, unknown> {
  const before = object(previous);
  if (!Array.isArray(before.tasks) || !before.tasks.length) return next;
  const task = object(before.tasks[0]);
  const shown = singleTaskView(before);
  const fromSchool = object(before.source).provider === "managebac";
  return {
    ...next,
    tasks: [
      {
        ...task,
        title: typeof next.taskTitle === "string" && next.taskTitle.trim() ? next.taskTitle : task.title,
        description: fromSchool ? task.description : next.description,
        status: next.status === shown.status ? task.status : next.status,
        estimateMinutes: next.estimateMinutes ?? undefined,
        reminders: next.reminders,
        checklist: next.subtasks,
        referenceIds: next.linkedArtifactIds,
        dueAt: fromSchool ? task.dueAt : (next.dueAt ?? undefined),
      },
    ],
    // The plan's other tasks were read as steps, and are written back as them.
    sections: [],
    milestones: [],
  };
}

export function normalizePlanContent(value: unknown): PlanContent {
  const row = object(value);
  if (Array.isArray(row.tasks)) {
    return {
      ...plannerSourceMetadata(row),
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
      tasks: row.tasks.map((candidate, index) => normalizePlanTask(bindPlannerSourceTask(row, {
        ...object(candidate), id: String(object(candidate).id ?? `task-${index + 1}`),
      }), index)),
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
  return {
    ...plannerSourceMetadata(row),
    version: 4,
    title: typeof row.title === "string" ? row.title : undefined,
    description: typeof row.description === "string" ? row.description : "",
    sections: [],
    milestones: [],
    tasks: [
      normalizePlanTask(
        bindPlannerSourceTask(row, legacyPlannerTask(row)),
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
      : row.status === "completed" ? "done"
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
    reminders: normalizeMinutesBeforeReminders(row.reminders),
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
