import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const CALENDAR_READ_MODEL_VERSION = 1;
export const CALENDAR_RANGE_BUCKET_MS = 24 * 60 * 60 * 1_000;
export const CALENDAR_RANGE_BUCKET_LIMIT = 370;
const CALENDAR_NOTES_CHARS = 1_200;

export type CalendarReadMetrics = {
  compactQueries: number;
  compactGets: number;
  canonicalQueries: number;
  canonicalGets: number;
  writes: number;
  deletes: number;
  rangeRowsRead: number;
};

export function createCalendarReadMetrics(): CalendarReadMetrics {
  return {
    compactQueries: 0,
    compactGets: 0,
    canonicalQueries: 0,
    canonicalGets: 0,
    writes: 0,
    deletes: 0,
    rangeRowsRead: 0,
  };
}

function compactQuery(metrics?: CalendarReadMetrics) {
  if (metrics) metrics.compactQueries += 1;
}

function compactGet(metrics?: CalendarReadMetrics) {
  if (metrics) metrics.compactGets += 1;
}

function compactWrite(metrics?: CalendarReadMetrics) {
  if (metrics) metrics.writes += 1;
}

function compactDelete(metrics?: CalendarReadMetrics) {
  if (metrics) metrics.deletes += 1;
}

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function timestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return Date.parse(value);
  return undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

type CalendarItemShape = Omit<Doc<"calendarItems">, "_id" | "_creationTime"> & {
  _id: string;
};

export function calendarItemWire(item: CalendarItemShape) {
  return {
    id: item._id,
    kind: item.kind,
    title: item.title,
    notes: item.notes?.slice(0, CALENDAR_NOTES_CHARS),
    startAt: item.startAt,
    endAt: item.endAt,
    allDay: item.allDay,
    timezone: item.timezone,
    timePrecision: item.timePrecision,
    status: item.status,
    sourceLocked: item.sourceLocked,
    source: item.sourceProvider
      ? {
          provider: item.sourceProvider,
          recordId: item.sourceRecordId,
          url: item.sourceUrl,
          freshAt: item.sourceFreshAt,
          state:
            item.sourceCapabilityState === "stale"
              ? {
                  kind: "stale",
                  updatedAt: item.sourceFreshAt ?? item.updatedAt,
                }
              : item.sourceCapabilityState === "partial"
                ? {
                    kind: "partial",
                    details: "Exact source time is unavailable.",
                  }
                : item.sourceCapabilityState === "permission_denied"
                  ? { kind: "permission_denied" }
                  : item.sourceCapabilityState === "unsupported"
                    ? { kind: "unsupported" }
                    : item.sourceCapabilityState === "schema_incompatible"
                      ? { kind: "schema_incompatible" }
                      : item.sourceCapabilityState === "unavailable"
                        ? {
                            kind: "unavailable",
                            retryable: true,
                            message: "The source is temporarily unavailable.",
                          }
                        : { kind: "available", updatedAt: item.sourceFreshAt },
        }
      : undefined,
    location: item.location,
    teacher: item.teacher,
    classId: item.classId,
    planArtifactId: item.planArtifactId,
    planTaskId: item.planTaskId,
    taskItemId: item.taskItemId,
    officialDeadlineItemId: item.officialDeadlineItemId,
    linkedWorkIds: item.linkedArtifactIds,
    revision: item.revision,
  };
}

export function calendarItemProjection(item: Doc<"calendarItems">) {
  return {
    readModelVersion: CALENDAR_READ_MODEL_VERSION,
    itemId: item._id,
    ownerAccountId: item.ownerAccountId,
    schoolId: item.schoolId,
    workspaceId: item.workspaceId,
    kind: item.kind,
    title: item.title,
    notes: item.notes?.slice(0, CALENDAR_NOTES_CHARS),
    startAt: item.startAt,
    endAt: item.endAt,
    allDay: item.allDay,
    timezone: item.timezone,
    timePrecision: item.timePrecision,
    status: item.status,
    sourceLocked: item.sourceLocked,
    sourceProvider: item.sourceProvider,
    sourceRecordId: item.sourceRecordId,
    sourceKey: item.sourceKey,
    sourceHash: item.sourceHash,
    sourceUrl: item.sourceUrl,
    sourceFreshAt: item.sourceFreshAt,
    sourceCapabilityState: item.sourceCapabilityState,
    location: item.location,
    teacher: item.teacher,
    classId: item.classId,
    planArtifactId: item.planArtifactId,
    planTaskId: item.planTaskId,
    taskItemId: item.taskItemId,
    officialDeadlineItemId: item.officialDeadlineItemId,
    linkedArtifactIds: item.linkedArtifactIds,
    recurrence: item.recurrence,
    legacyArtifactId: item.legacyArtifactId,
    legacyEventId: item.legacyEventId,
    idempotencyKey: item.idempotencyKey,
    revision: item.revision,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function calendarBucketKey(bucket: number) {
  return String(bucket).padStart(14, "0");
}

export function calendarRangeBucketKeys(startAt?: number, endAt?: number) {
  if (startAt === undefined) return ["__unscheduled__"];
  const first = Math.floor(startAt / CALENDAR_RANGE_BUCKET_MS);
  const last = Math.floor(
    Math.max(startAt, endAt ?? startAt) / CALENDAR_RANGE_BUCKET_MS,
  );
  const count = last - first + 1;
  if (count <= CALENDAR_RANGE_BUCKET_LIMIT)
    return Array.from({ length: count }, (_, index) =>
      calendarBucketKey(first + index),
    );
  return [
    ...Array.from({ length: CALENDAR_RANGE_BUCKET_LIMIT - 1 }, (_, index) =>
      calendarBucketKey(first + index),
    ),
    "__wide__",
  ];
}

function rangeBucketValues(item: Doc<"calendarItems">) {
  return calendarRangeBucketKeys(item.startAt, item.endAt).map((bucketKey) => ({
    readModelVersion: CALENDAR_READ_MODEL_VERSION,
    itemId: item._id,
    ownerAccountId: item.ownerAccountId,
    status: item.status,
    bucketKey,
    startAt: item.startAt,
    endAt: item.endAt,
  }));
}

type CalendarWriteCtx = Pick<MutationCtx, "db">;

export async function upsertCalendarItemReadModel(
  ctx: CalendarWriteCtx,
  item: Doc<"calendarItems">,
  metrics?: CalendarReadMetrics,
) {
  compactQuery(metrics);
  const existing = await ctx.db
    .query("calendarItemReadModels")
    .withIndex("by_item", (q) => q.eq("itemId", item._id))
    .unique();
  const value = calendarItemProjection(item);
  if (
    !existing ||
    stableJson(existing) !==
      stableJson({
        ...value,
        _id: existing._id,
        _creationTime: existing._creationTime,
      })
  ) {
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("calendarItemReadModels", value);
    compactWrite(metrics);
  }

  compactQuery(metrics);
  const oldBuckets = await ctx.db
    .query("calendarItemRangeBuckets")
    .withIndex("by_item_bucket", (q) => q.eq("itemId", item._id))
    .collect();
  // Keep a tombstone for exact-identity lookup, but do not leave removed
  // items in any range bucket used by ordinary discovery.
  const nextBuckets = item.status === "removed" ? [] : rangeBucketValues(item);
  const nextByKey = new Map(nextBuckets.map((row) => [row.bucketKey, row]));
  for (const oldBucket of oldBuckets) {
    const next = nextByKey.get(oldBucket.bucketKey);
    if (!next) {
      await ctx.db.delete(oldBucket._id);
      compactDelete(metrics);
    } else if (
      oldBucket.readModelVersion !== next.readModelVersion ||
      oldBucket.status !== next.status ||
      oldBucket.startAt !== next.startAt ||
      oldBucket.endAt !== next.endAt
    ) {
      await ctx.db.patch(oldBucket._id, next);
      compactWrite(metrics);
    }
    nextByKey.delete(oldBucket.bucketKey);
  }
  for (const next of nextByKey.values()) {
    await ctx.db.insert("calendarItemRangeBuckets", next);
    compactWrite(metrics);
  }
}

export async function deleteCalendarItemReadModel(
  ctx: CalendarWriteCtx,
  itemId: Id<"calendarItems">,
  metrics?: CalendarReadMetrics,
) {
  compactQuery(metrics);
  const row = await ctx.db
    .query("calendarItemReadModels")
    .withIndex("by_item", (q) => q.eq("itemId", itemId))
    .unique();
  if (row) {
    await ctx.db.delete(row._id);
    compactDelete(metrics);
  }
  compactQuery(metrics);
  const buckets = await ctx.db
    .query("calendarItemRangeBuckets")
    .withIndex("by_item_bucket", (q) => q.eq("itemId", itemId))
    .collect();
  for (const bucket of buckets) {
    await ctx.db.delete(bucket._id);
    compactDelete(metrics);
  }
}

export async function calendarItemReadModelFor(
  ctx: QueryCtx,
  itemId: Id<"calendarItems">,
  metrics?: CalendarReadMetrics,
) {
  compactQuery(metrics);
  const row = await ctx.db
    .query("calendarItemReadModels")
    .withIndex("by_item", (q) => q.eq("itemId", itemId))
    .unique();
  if (row) compactGet(metrics);
  return row;
}

export function plannerTaskCandidates(artifact: Doc<"spectraArtifacts">) {
  const content = object(artifact.content);
  const rows = Array.isArray(content.tasks)
    ? content.tasks.map((candidate, index) => {
        const task = object(candidate);
        const status = task.status ?? (task.done === true ? "done" : "todo");
        return {
          id: text(task.id, 180) || `task-${index + 1}`,
          title:
            text(task.title ?? task.taskTitle ?? task.name) ||
            `Task ${index + 1}`,
          notes:
            text(
              task.description ?? task.notes ?? task.personalIntent,
              CALENDAR_NOTES_CHARS,
            ) || undefined,
          dueAt: timestamp(task.dueAt),
          completed:
            status === "done" || status === "completed" || task.done === true,
        };
      })
    : [];
  if (Array.isArray(content.tasks)) return rows;
  return [
    {
      id: "task-1",
      title: text(content.taskTitle) || artifact.title,
      notes:
        text(
          content.description ?? content.notes ?? content.personalIntent,
          CALENDAR_NOTES_CHARS,
        ) || undefined,
      dueAt: timestamp(content.dueAt),
      completed: content.status === "done" || content.status === "completed",
    },
  ];
}

async function sourceRecordForPlanner(
  ctx: CalendarWriteCtx,
  artifactId: Id<"spectraArtifacts">,
  accountId: Id<"accounts">,
) {
  compactQuery();
  const projections = await ctx.db
    .query("externalProjections")
    .withIndex("by_projection", (q) =>
      q
        .eq("projectionType", "planner_task")
        .eq("projectionId", String(artifactId)),
    )
    .collect();
  return projections.find((projection) => projection.accountId === accountId)
    ?.recordId;
}

export async function syncPlannerTaskReadModels(
  ctx: CalendarWriteCtx,
  artifact: Doc<"spectraArtifacts">,
) {
  compactQuery();
  const existing = await ctx.db
    .query("calendarPlanTaskReadModels")
    .withIndex("by_plan", (q) => q.eq("planArtifactId", artifact._id))
    .collect();
  if (artifact.status !== "active") {
    for (const row of existing) await ctx.db.delete(row._id);
    return;
  }
  const sourceRecordId = await sourceRecordForPlanner(
    ctx,
    artifact._id,
    artifact.ownerAccountId,
  );
  compactQuery();
  const scheduledBlocks = await ctx.db
    .query("calendarItems")
    .withIndex("by_plan_task", (q) => q.eq("planArtifactId", artifact._id))
    .collect();
  const scheduledKeys = new Set(
    scheduledBlocks
      .filter((item) => item.status === "active" && item.planTaskId)
      .map((item) => item.planTaskId),
  );
  const nextRows = plannerTaskCandidates(artifact).map((task) => ({
    readModelVersion: CALENDAR_READ_MODEL_VERSION,
    planArtifactId: artifact._id,
    ownerAccountId: artifact.ownerAccountId,
    schoolId: artifact.schoolId,
    planUpdatedAt: artifact.updatedAt,
    planTitle: artifact.title,
    taskId: task.id,
    title: task.title,
    notes: task.notes,
    dueAt: task.dueAt,
    taskStatus: task.completed ? ("completed" as const) : ("active" as const),
    scheduled: scheduledKeys.has(task.id),
    planStatus: artifact.status,
    sourceRecordId,
    updatedAt: artifact.updatedAt,
  }));
  const existingByTask = new Map(existing.map((row) => [row.taskId, row]));
  for (const next of nextRows) {
    const prior = existingByTask.get(next.taskId);
    if (prior) {
      if (
        stableJson(prior) !==
        stableJson({
          ...next,
          _id: prior._id,
          _creationTime: prior._creationTime,
        })
      ) {
        await ctx.db.patch(prior._id, next);
      }
      existingByTask.delete(next.taskId);
    } else await ctx.db.insert("calendarPlanTaskReadModels", next);
  }
  for (const stale of existingByTask.values()) await ctx.db.delete(stale._id);
}

export async function syncPlannerTaskScheduleState(
  ctx: CalendarWriteCtx,
  item: Doc<"calendarItems">,
) {
  if (!item.planArtifactId || !item.planTaskId) return;
  compactQuery();
  const rows = await ctx.db
    .query("calendarPlanTaskReadModels")
    .withIndex("by_plan_task", (q) =>
      q
        .eq("planArtifactId", item.planArtifactId!)
        .eq("taskId", item.planTaskId!),
    )
    .collect();
  compactQuery();
  const blocks = await ctx.db
    .query("calendarItems")
    .withIndex("by_plan_task", (q) =>
      q
        .eq("planArtifactId", item.planArtifactId!)
        .eq("planTaskId", item.planTaskId!),
    )
    .collect();
  const scheduled = blocks.some((block) => block.status === "active");
  for (const row of rows) {
    if (row.scheduled !== scheduled) await ctx.db.patch(row._id, { scheduled });
  }
}

export async function syncPlannerTaskSourceProjection(
  ctx: CalendarWriteCtx,
  projection: Doc<"externalProjections">,
) {
  if (projection.projectionType !== "planner_task") return;
  const planArtifactId = ctx.db.normalizeId(
    "spectraArtifacts",
    projection.projectionId,
  );
  if (!planArtifactId || !projection.accountId) return;
  compactQuery();
  const rows = await ctx.db
    .query("calendarPlanTaskReadModels")
    .withIndex("by_plan", (q) => q.eq("planArtifactId", planArtifactId))
    .collect();
  for (const row of rows) {
    if (row.sourceRecordId !== projection.recordId)
      await ctx.db.patch(row._id, { sourceRecordId: projection.recordId });
  }
}

export async function syncCalendarMigrationReadModel(
  ctx: CalendarWriteCtx,
  artifact: Doc<"spectraArtifacts">,
) {
  if (artifact.blueprintKey !== "timetable" || !artifact.schoolId) return;
  compactQuery();
  const migration = await ctx.db
    .query("calendarMigrations")
    .withIndex("by_legacy_artifact", (q) =>
      q.eq("legacyArtifactId", artifact._id),
    )
    .unique();
  compactQuery();
  const existing = await ctx.db
    .query("calendarMigrationReadModels")
    .withIndex("by_legacy_artifact", (q) =>
      q.eq("legacyArtifactId", artifact._id),
    )
    .unique();
  const value = {
    readModelVersion: CALENDAR_READ_MODEL_VERSION,
    legacyArtifactId: artifact._id,
    ownerAccountId: artifact.ownerAccountId,
    schoolId: artifact.schoolId,
    artifactStatus: artifact.status,
    migrationStatus: migration?.status ?? ("missing" as const),
    migratedCount: migration?.migratedCount ?? 0,
    skippedCount: migration?.skippedCount ?? 0,
    eventOffset: migration?.eventOffset,
    updatedAt: Math.max(artifact.updatedAt, migration?.updatedAt ?? 0),
  };
  if (existing) {
    if (
      stableJson(existing) !==
      stableJson({
        ...value,
        _id: existing._id,
        _creationTime: existing._creationTime,
      })
    )
      await ctx.db.patch(existing._id, value);
  } else await ctx.db.insert("calendarMigrationReadModels", value);
}

export async function syncCalendarMigrationFromMigration(
  ctx: CalendarWriteCtx,
  migration: Doc<"calendarMigrations">,
) {
  compactQuery();
  const existing = await ctx.db
    .query("calendarMigrationReadModels")
    .withIndex("by_legacy_artifact", (q) =>
      q.eq("legacyArtifactId", migration.legacyArtifactId),
    )
    .unique();
  const value = {
    readModelVersion: CALENDAR_READ_MODEL_VERSION,
    legacyArtifactId: migration.legacyArtifactId,
    ownerAccountId: migration.ownerAccountId,
    schoolId: migration.schoolId,
    artifactStatus: existing?.artifactStatus ?? ("active" as const),
    migrationStatus: migration.status,
    migratedCount: migration.migratedCount,
    skippedCount: migration.skippedCount,
    eventOffset: migration.eventOffset,
    updatedAt: migration.updatedAt,
  };
  if (existing) await ctx.db.patch(existing._id, value);
  else await ctx.db.insert("calendarMigrationReadModels", value);
}

export async function deleteCalendarArtifactReadModels(
  ctx: CalendarWriteCtx,
  artifactId: Id<"spectraArtifacts">,
) {
  compactQuery();
  const tasks = await ctx.db
    .query("calendarPlanTaskReadModels")
    .withIndex("by_plan", (q) => q.eq("planArtifactId", artifactId))
    .collect();
  for (const task of tasks) await ctx.db.delete(task._id);
  compactQuery();
  const migration = await ctx.db
    .query("calendarMigrationReadModels")
    .withIndex("by_legacy_artifact", (q) =>
      q.eq("legacyArtifactId", artifactId),
    )
    .unique();
  if (migration) await ctx.db.delete(migration._id);
}
