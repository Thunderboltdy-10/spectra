import type { CalendarItem } from "./model";

export type CalendarSemanticAction =
  | {
      type: "calendar.schedule_task";
      taskItemId?: string;
      planArtifactId?: string;
      planTaskId?: string;
      startAt: number;
      endAt: number;
      timezone: string;
      idempotencyKey?: string;
    }
  | {
      type: "calendar.create_personal_event";
      title: string;
      startAt: number;
      endAt: number;
      timezone: string;
      notes?: string;
      allDay?: boolean;
      linkedArtifactIds?: string[];
    }
  | {
      type: "calendar.move_work_block";
      itemId: string;
      startAt: number;
      endAt: number;
      expectedRevision: number;
    }
  | {
      type: "calendar.resize_work_block";
      itemId: string;
      endAt: number;
      expectedRevision: number;
    };

export type CalendarActionPostcondition = {
  itemId: string;
  kind: "scheduled_work_block" | "personal_event" | "task" | "milestone" | "reminder";
  startAt: number;
  endAt: number;
  linkedTask: boolean;
};

export function calendarActionTarget(action: CalendarSemanticAction) {
  if (action.type === "calendar.create_personal_event")
    return {
      workId: "calendar",
      workType: "planner_task" as const,
      kind: "personal_event" as const,
      path: [action.title.slice(0, 80) || "event"],
      schemaVersion: 1,
    };
  return {
    workId: "calendar",
    workType: "planner_task" as const,
    kind:
      action.type === "calendar.schedule_task"
        ? "unscheduled_task"
        : "scheduled_work_block",
    path:
      action.type === "calendar.schedule_task"
        ? [action.taskItemId ?? action.planTaskId ?? "task"]
        : [action.itemId],
    schemaVersion: 1,
  };
}

export function calendarActionPolicy(action: CalendarSemanticAction) {
  return {
    mode: "interaction_lease" as const,
    leaseScope: "gesture" as const,
    release: "pointer_up" as const,
    target: calendarActionTarget(action),
  };
}

export function verifyCalendarActionPostcondition(
  action: CalendarSemanticAction,
  item: CalendarItem,
): CalendarActionPostcondition {
  if (action.type === "calendar.create_personal_event") {
    const dayTask = action.allDay === true && action.endAt - action.startAt <= 86_400_000 &&
      item.kind === "task" && Boolean(item.planArtifactId) && !item.sourceLocked;
    if (item.kind !== "personal_event" && !(item.kind === "task" && dayTask))
      throw new Error("CALENDAR_POSTCONDITION_KIND_MISMATCH");
    if (item.startAt === undefined || item.endAt === undefined)
      throw new Error("CALENDAR_POSTCONDITION_TIME_MISSING");
    if (item.startAt !== action.startAt || item.endAt !== (dayTask ? action.startAt : action.endAt))
      throw new Error("CALENDAR_POSTCONDITION_TIME_MISMATCH");
    return {
      itemId: item.id,
      kind: item.kind,
      startAt: item.startAt,
      endAt: item.endAt,
      linkedTask: dayTask,
    };
  }
  if (item.kind !== "scheduled_work_block" && item.kind !== "personal_event" &&
      item.kind !== "task" && item.kind !== "milestone" && item.kind !== "reminder")
    throw new Error("CALENDAR_POSTCONDITION_KIND_MISMATCH");
  if (item.kind !== "scheduled_work_block" &&
      (action.type === "calendar.schedule_task" || item.sourceLocked))
    throw new Error("CALENDAR_POSTCONDITION_KIND_MISMATCH");
  if (item.startAt === undefined || item.endAt === undefined)
    throw new Error("CALENDAR_POSTCONDITION_TIME_MISSING");
  const expectedStart =
    action.type === "calendar.resize_work_block" ? item.startAt : action.startAt;
  if (item.startAt !== expectedStart || item.endAt !== action.endAt)
    throw new Error("CALENDAR_POSTCONDITION_TIME_MISMATCH");
  const linkedTask = Boolean(item.taskItemId || item.planTaskId);
  if (item.kind === "scheduled_work_block" && !linkedTask)
    throw new Error("CALENDAR_POSTCONDITION_TASK_MISSING");
  return {
    itemId: item.id,
    kind: item.kind,
    startAt: item.startAt,
    endAt: item.endAt,
    linkedTask,
  };
}
