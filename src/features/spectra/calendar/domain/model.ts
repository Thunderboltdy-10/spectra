import type { CapabilityState } from "../../core/capability-truth";

export const CALENDAR_ITEM_KINDS = [
  "official_event",
  "official_deadline",
  "task",
  "scheduled_work_block",
  "personal_event",
  "milestone",
  "reminder",
] as const;

export type CalendarItemKind = (typeof CALENDAR_ITEM_KINDS)[number];
export type CalendarTimePrecision =
  | "exact"
  | "verified_period"
  | "date_only"
  | "unknown";

export type CalendarItem = {
  id: string;
  kind: CalendarItemKind;
  title: string;
  notes?: string;
  startAt?: number;
  endAt?: number;
  allDay: boolean;
  timezone: string;
  timePrecision: CalendarTimePrecision;
  status: "active" | "completed" | "cancelled" | "removed";
  sourceLocked: boolean;
  source?: {
    provider: string;
    recordId?: string;
    url?: string;
    freshAt?: number;
    state: CapabilityState;
  };
  location?: string;
  teacher?: string;
  classId?: string;
  planArtifactId?: string;
  planTaskId?: string;
  taskItemId?: string;
  officialDeadlineItemId?: string;
  linkedWorkIds: string[];
  revision: number;
};

export type CalendarLayerKey =
  | "classes"
  | "deadlines"
  | "tasks"
  | "work"
  | "personal"
  | "shared";

export const CALENDAR_LAYERS: ReadonlyArray<{
  key: CalendarLayerKey;
  label: string;
  itemKinds: CalendarItemKind[];
  color: string;
}> = [
  {
    key: "classes",
    label: "Classes",
    itemKinds: ["official_event"],
    color: "var(--accent-mint)",
  },
  {
    key: "deadlines",
    label: "Official deadlines",
    itemKinds: ["official_deadline"],
    color: "var(--accent-coral)",
  },
  {
    key: "tasks",
    label: "Plans",
    itemKinds: ["task", "milestone", "reminder"],
    color: "var(--accent-gold)",
  },
  {
    key: "work",
    label: "Scheduled work",
    itemKinds: ["scheduled_work_block"],
    color: "var(--accent-violet)",
  },
  {
    key: "personal",
    label: "Personal",
    itemKinds: ["personal_event"],
    color: "var(--text-tertiary)",
  },
  { key: "shared", label: "Shared", itemKinds: [], color: "var(--accent-cyan)" },
] as const;

export type CalendarOverview = {
  timezone: string;
  range: { from: number; to: number };
  items: CalendarItem[];
  unscheduledTasks: CalendarItem[];
  partialTimeItems: CalendarItem[];
  sourceState: CapabilityState;
  lastUpdatedAt?: number;
  migration: {
    complete: boolean;
    pageComplete?: boolean;
    partial?: boolean;
    migratedArtifacts: number;
    migratedEvents: number;
    skippedEvents: number;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function calendarItemFromWire(value: unknown): CalendarItem {
  const row = asRecord(value);
  const source = asRecord(row.source);
  const kind = CALENDAR_ITEM_KINDS.includes(row.kind as CalendarItemKind)
    ? (row.kind as CalendarItemKind)
    : "personal_event";
  return {
    id: String(row.id ?? row._id ?? ""),
    kind,
    title: String(row.title ?? "Untitled item"),
    notes: typeof row.notes === "string" ? row.notes : undefined,
    startAt: Number.isFinite(row.startAt) ? Number(row.startAt) : undefined,
    endAt: Number.isFinite(row.endAt) ? Number(row.endAt) : undefined,
    allDay:
      row.allDay === true ||
      row.timePrecision === "date_only" ||
      (row.timePrecision === "unknown" && Number.isFinite(row.startAt)),
    timezone: typeof row.timezone === "string" ? row.timezone : "UTC",
    timePrecision:
      row.timePrecision === "verified_period" ||
      row.timePrecision === "date_only" ||
      row.timePrecision === "unknown"
        ? row.timePrecision
        : "exact",
    status:
      row.status === "completed" ||
      row.status === "cancelled" ||
      row.status === "removed"
        ? row.status
        : "active",
    sourceLocked: row.sourceLocked === true,
    source:
      typeof source.provider === "string"
        ? {
            provider: source.provider,
            recordId:
              typeof source.recordId === "string" ? source.recordId : undefined,
            url: typeof source.url === "string" ? source.url : undefined,
            freshAt: Number.isFinite(source.freshAt)
              ? Number(source.freshAt)
              : undefined,
            state:
              source.state && typeof source.state === "object"
                ? (source.state as CapabilityState)
                : { kind: "available" },
          }
        : undefined,
    location: typeof row.location === "string" ? row.location : undefined,
    teacher: typeof row.teacher === "string" ? row.teacher : undefined,
    classId: typeof row.classId === "string" ? row.classId : undefined,
    planArtifactId:
      typeof row.planArtifactId === "string" ? row.planArtifactId : undefined,
    planTaskId: typeof row.planTaskId === "string" ? row.planTaskId : undefined,
    taskItemId: typeof row.taskItemId === "string" ? row.taskItemId : undefined,
    officialDeadlineItemId:
      typeof row.officialDeadlineItemId === "string"
        ? row.officialDeadlineItemId
        : undefined,
    linkedWorkIds: Array.isArray(row.linkedWorkIds)
      ? row.linkedWorkIds.filter(
          (candidate): candidate is string => typeof candidate === "string",
        )
      : [],
    revision: Number.isFinite(row.revision) ? Number(row.revision) : 0,
  };
}

export function assertTemporalSeparation(items: CalendarItem[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    if (item.kind === "official_deadline" && !item.sourceLocked)
      throw new Error("CALENDAR_OFFICIAL_DEADLINE_UNLOCKED");
    if (item.kind === "scheduled_work_block") {
      if (!item.taskItemId && !item.planTaskId)
        throw new Error("CALENDAR_WORK_BLOCK_WITHOUT_TASK");
      if (
        item.officialDeadlineItemId &&
        byId.get(item.officialDeadlineItemId)?.kind !== "official_deadline"
      )
        throw new Error("CALENDAR_DEADLINE_LINK_INVALID");
    }
  }
  return true;
}
