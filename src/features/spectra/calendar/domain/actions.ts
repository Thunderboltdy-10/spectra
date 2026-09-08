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
  kind: "scheduled_work_block";
  startAt: number;
  endAt: number;
  linkedTask: boolean;
};

export function calendarActionTarget(action: CalendarSemanticAction) {
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
  if (item.kind !== "scheduled_work_block")
    throw new Error("CALENDAR_POSTCONDITION_KIND_MISMATCH");
  if (item.startAt === undefined || item.endAt === undefined)
    throw new Error("CALENDAR_POSTCONDITION_TIME_MISSING");
  const expectedStart =
    action.type === "calendar.resize_work_block" ? item.startAt : action.startAt;
  if (item.startAt !== expectedStart || item.endAt !== action.endAt)
    throw new Error("CALENDAR_POSTCONDITION_TIME_MISMATCH");
  const linkedTask = Boolean(item.taskItemId || item.planTaskId);
  if (!linkedTask) throw new Error("CALENDAR_POSTCONDITION_TASK_MISSING");
  return {
    itemId: item.id,
    kind: item.kind,
    startAt: item.startAt,
    endAt: item.endAt,
    linkedTask,
  };
}
