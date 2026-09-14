import { createHash } from "node:crypto";
import {
  verifyCalendarActionPostcondition,
  type CalendarSemanticAction,
} from "./actions";
import { calendarItemFromWire, type CalendarItem } from "./model";

export const CALENDAR_MUTATION_TOOL_IDS = [
  "schedule_calendar_task",
  "create_calendar_personal_event",
  "move_calendar_block",
  "resize_calendar_block",
] as const;

export type CanonicalCalendarTool = (typeof CALENDAR_MUTATION_TOOL_IDS)[number];

/** One alias table for app.command names, tool ids, and Convex-era camelCase. */
export const CALENDAR_COMMAND_ALIASES: Record<string, CanonicalCalendarTool> = {
  "calendar.schedule": "schedule_calendar_task",
  "calendar.schedule_task": "schedule_calendar_task",
  "calendar.scheduleTask": "schedule_calendar_task",
  schedule_calendar_task: "schedule_calendar_task",
  "calendar.create_personal_event": "create_calendar_personal_event",
  "calendar.createPersonalItem": "create_calendar_personal_event",
  "calendar.add_event": "create_calendar_personal_event",
  create_calendar_personal_event: "create_calendar_personal_event",
  "calendar.move": "move_calendar_block",
  "calendar.move_work_block": "move_calendar_block",
  "calendar.moveWorkBlock": "move_calendar_block",
  move_calendar_block: "move_calendar_block",
  "calendar.resize": "resize_calendar_block",
  "calendar.resize_work_block": "resize_calendar_block",
  "calendar.resizeWorkBlock": "resize_calendar_block",
  resize_calendar_block: "resize_calendar_block",
};

const CONVEX_MUTATION: Record<CanonicalCalendarTool, string> = {
  schedule_calendar_task: "calendar:scheduleTask",
  create_calendar_personal_event: "calendar:createPersonalItem",
  move_calendar_block: "calendar:moveWorkBlock",
  resize_calendar_block: "calendar:resizeWorkBlock",
};

const UI_NOTE: Record<CanonicalCalendarTool, string> = {
  schedule_calendar_task: "Scheduled a Calendar work block",
  create_calendar_personal_event: "Added a Calendar personal event",
  move_calendar_block: "Moved a Calendar work block",
  resize_calendar_block: "Resized a Calendar work block",
};

export type CalendarUndoInverse =
  | {
      kind: "remove_work_block";
      itemId: string;
      expectedRevision: number;
      convexMutation: "calendar:removePersonalItem";
    }
  | {
      kind: "remove_personal_event";
      itemId: string;
      expectedRevision: number;
      convexMutation: "calendar:removePersonalItem";
    }
  | {
      kind: "revision_restore";
      itemId: string;
      expectedRevision: number;
      toolId: CanonicalCalendarTool;
    };

export function normalizeCalendarCommand(
  command: string,
): CanonicalCalendarTool | null {
  return CALENDAR_COMMAND_ALIASES[command] ?? null;
}

export function isCalendarMutationCommand(command: string) {
  return normalizeCalendarCommand(command) !== null;
}

export function calendarConvexMutation(toolId: CanonicalCalendarTool) {
  return CONVEX_MUTATION[toolId];
}

export function calendarChangedNote(toolId: CanonicalCalendarTool) {
  return UI_NOTE[toolId];
}

function finiteNumber(args: Record<string, unknown>, key: string) {
  const value = Number(args[key]);
  if (!Number.isFinite(value))
    throw new Error(`CALENDAR_${key.toUpperCase()}_INVALID`);
  return value;
}

export function calendarSemanticAction(
  toolId: CanonicalCalendarTool,
  args: Record<string, unknown>,
): CalendarSemanticAction {
  if (toolId === "schedule_calendar_task") {
    const taskItemId =
      typeof args.taskItemId === "string" && args.taskItemId.trim()
        ? args.taskItemId.trim()
        : undefined;
    const planArtifactId =
      typeof args.planArtifactId === "string" && args.planArtifactId.trim()
        ? args.planArtifactId.trim()
        : undefined;
    const planTaskId =
      typeof args.planTaskId === "string" && args.planTaskId.trim()
        ? args.planTaskId.trim()
        : undefined;
    if (!taskItemId && !(planArtifactId && planTaskId))
      throw new Error("CALENDAR_TASK_REQUIRED");
    return {
      type: "calendar.schedule_task",
      ...(taskItemId ? { taskItemId } : {}),
      ...(planArtifactId ? { planArtifactId } : {}),
      ...(planTaskId ? { planTaskId } : {}),
      startAt: finiteNumber(args, "startAt"),
      endAt: finiteNumber(args, "endAt"),
      timezone: typeof args.timezone === "string" ? args.timezone : "UTC",
      ...(typeof args.idempotencyKey === "string" && args.idempotencyKey.trim()
        ? { idempotencyKey: args.idempotencyKey.trim().slice(0, 240) }
        : {}),
    };
  }
  if (toolId === "create_calendar_personal_event") {
    const title =
      typeof args.title === "string" ? args.title.trim().slice(0, 500) : "";
    if (!title) throw new Error("CALENDAR_TITLE_REQUIRED");
    const linkedArtifactIds = Array.isArray(args.linkedArtifactIds)
      ? args.linkedArtifactIds
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => value.trim())
          .slice(0, 24)
      : undefined;
    return {
      type: "calendar.create_personal_event",
      title,
      startAt: finiteNumber(args, "startAt"),
      endAt: finiteNumber(args, "endAt"),
      timezone: typeof args.timezone === "string" ? args.timezone : "UTC",
      ...(typeof args.notes === "string" && args.notes.trim()
        ? { notes: args.notes.trim().slice(0, 20_000) }
        : {}),
      ...(args.allDay === true ? { allDay: true } : {}),
      ...(linkedArtifactIds?.length ? { linkedArtifactIds } : {}),
    };
  }
  const itemId = typeof args.itemId === "string" ? args.itemId.trim() : "";
  if (!itemId) throw new Error("CALENDAR_ITEM_REQUIRED");
  if (toolId === "move_calendar_block")
    return {
      type: "calendar.move_work_block",
      itemId,
      startAt: finiteNumber(args, "startAt"),
      endAt: finiteNumber(args, "endAt"),
      expectedRevision: finiteNumber(args, "expectedRevision"),
    };
  return {
    type: "calendar.resize_work_block",
    itemId,
    endAt: finiteNumber(args, "endAt"),
    expectedRevision: finiteNumber(args, "expectedRevision"),
  };
}

export function calendarMutationPayload(
  action: CalendarSemanticAction,
  idempotencyKey?: string,
) {
  if (action.type === "calendar.schedule_task")
    return {
      taskItemId: action.taskItemId,
      planArtifactId: action.planArtifactId,
      planTaskId: action.planTaskId,
      startAt: action.startAt,
      endAt: action.endAt,
      timezone: action.timezone,
      actorKind: "ai" as const,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };
  if (action.type === "calendar.create_personal_event")
    return {
      kind: "personal_event" as const,
      title: action.title,
      notes: action.notes,
      startAt: action.startAt,
      endAt: action.endAt,
      allDay: action.allDay === true,
      timezone: action.timezone,
      actorKind: "ai" as const,
      ...(action.linkedArtifactIds?.length
        ? { linkedArtifactIds: action.linkedArtifactIds }
        : {}),
    };
  if (action.type === "calendar.move_work_block")
    return {
      itemId: action.itemId,
      startAt: action.startAt,
      endAt: action.endAt,
      expectedRevision: action.expectedRevision,
    };
  return {
    itemId: action.itemId,
    endAt: action.endAt,
    expectedRevision: action.expectedRevision,
  };
}

export function calendarScheduleIdempotencyKey(input: {
  scopeId: string;
  toolId: CanonicalCalendarTool;
  action: CalendarSemanticAction;
  requestedKey?: string;
}) {
  if (input.action.type !== "calendar.schedule_task") return undefined;
  const requested =
    input.requestedKey?.trim() || input.action.idempotencyKey?.trim() || "";
  const identity = requested
    ? requested.slice(0, 180)
    : [
        input.action.planArtifactId ?? input.action.taskItemId ?? "task",
        input.action.planTaskId ?? "root",
        String(input.action.startAt),
        String(input.action.endAt),
      ].join(":");
  return `ai:${createHash("sha256")
    .update(`${input.scopeId}\0${input.toolId}\0${identity}`)
    .digest("hex")}`.slice(0, 240);
}

export function interpretCalendarMutationResult(
  action: CalendarSemanticAction,
  wire: unknown,
) {
  const item = calendarItemFromWire(wire);
  const postcondition = verifyCalendarActionPostcondition(action, item);
  return { item, postcondition };
}

export function calendarUndoInverse(
  toolId: CanonicalCalendarTool,
  item: CalendarItem,
): CalendarUndoInverse {
  if (toolId === "schedule_calendar_task")
    return {
      kind: "remove_work_block",
      itemId: item.id,
      expectedRevision: item.revision,
      convexMutation: "calendar:removePersonalItem",
    };
  if (toolId === "create_calendar_personal_event")
    return {
      kind: "remove_personal_event",
      itemId: item.id,
      expectedRevision: item.revision,
      convexMutation: "calendar:removePersonalItem",
    };
  return {
    kind: "revision_restore",
    itemId: item.id,
    expectedRevision: item.revision,
    toolId,
  };
}
