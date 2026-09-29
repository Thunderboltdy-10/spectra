import { query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";
import { CALENDAR_DONE_CURSOR } from "../shared/calendar-pagination";
import {
  CALENDAR_RANGE_BUCKET_MS,
  CALENDAR_RANGE_BUCKET_LIMIT,
  calendarBucketKey,
  calendarItemReadModelFor,
  calendarItemWire,
  createCalendarReadMetrics,
  plannerTaskCandidates,
  sourceRecordForPlanner,
  upsertCalendarItemReadModel,
  syncCalendarMigrationReadModel,
  syncPlannerTaskReadModels,
  type CalendarReadMetrics,
} from "./calendarReadModels";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

async function actorOrThrow(ctx: Parameters<typeof getAuthenticatedActor>[0]) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_REQUIRED: Sign in to use Calendar.");
  return actor;
}

function itemWire(item: Doc<"calendarItems">) {
  return {
    id: item._id,
    kind: item.kind,
    title: item.title,
    notes: item.notes,
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

function planTasks(artifact: Doc<"spectraArtifacts">) {
  return plannerTaskCandidates(artifact)
    .filter((task) => !task.completed)
    .map(({ completed: _completed, ...task }) => task);
}

const CALENDAR_DEFAULT_PAGE_SIZE = 100;
const CALENDAR_MAX_PAGE_SIZE = 250;

type CalendarCursor = {
  kind: "visible" | "partial";
  kindIndex?: number;
  cursor?: string | null;
  phase?: "range" | "wide" | "unscheduled";
  updatedAt?: number;
  key?: string;
};

type KeysetCursor = { updatedAt: number; key: string };

function encodeCursor(value: CalendarCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): CalendarCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as CalendarCursor;
    return decoded && (decoded.kind === "visible" || decoded.kind === "partial")
      ? decoded
      : undefined;
  } catch {
    return undefined;
  }
}

function encodeKeysetCursor(value: KeysetCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeKeysetCursor(
  value: string | undefined,
): KeysetCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as KeysetCursor;
    return typeof decoded.updatedAt === "number" &&
      typeof decoded.key === "string"
      ? decoded
      : undefined;
  } catch {
    return undefined;
  }
}

function rowKeyset(updatedAt: number, key: string): KeysetCursor {
  return { updatedAt, key };
}

function pageSize(value: number | undefined) {
  return Math.min(
    CALENDAR_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(value ?? CALENDAR_DEFAULT_PAGE_SIZE)),
  );
}

type ReadModelRow = NonNullable<
  Awaited<ReturnType<typeof calendarItemReadModelFor>>
>;

function calendarReadModelWire(row: ReadModelRow | null) {
  return row ? calendarItemWire({ ...row, _id: String(row.itemId) }) : null;
}

async function readVisibleCalendarItems(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  from: number,
  to: number,
  limit: number,
  cursor: CalendarCursor | undefined,
  metrics: CalendarReadMetrics,
) {
  const phase = cursor?.kind === "visible" ? (cursor.phase ?? "range") : "range";
  const rows: ReadModelRow[] = [];
  const firstBucket = calendarBucketKey(
    Math.floor(from / CALENDAR_RANGE_BUCKET_MS),
  );
  const lastBucket = calendarBucketKey(
    Math.floor(to / CALENDAR_RANGE_BUCKET_MS),
  );
  metrics.compactQueries += 1;
  // Only one native pagination call per overview query. Each bucket stream
  // owns its continuation, including long and undated events.
  const bucketPage = await ctx.db
    .query("calendarItemRangeBuckets")
    .withIndex("by_account_status_bucket", (q) =>
      phase === "range"
        ? q.eq("ownerAccountId", accountId).eq("status", "active")
            .gte("bucketKey", firstBucket).lte("bucketKey", lastBucket)
        : q.eq("ownerAccountId", accountId).eq("status", "active")
            .eq("bucketKey", phase === "wide" ? "__wide__" : "__unscheduled__"),
    )
    .paginate({
      cursor: cursor?.kind === "visible" ? (cursor.cursor ?? null) : null,
      numItems: limit,
    });
  metrics.rangeRowsRead += bucketPage.page.length;
  for (const bucket of bucketPage.page) {
    if (bucket.startAt !== undefined) {
      if (bucket.startAt > to || (bucket.endAt ?? bucket.startAt) < from) continue;
      const startBucket = Math.floor(bucket.startAt / CALENDAR_RANGE_BUCKET_MS);
      const firstOverlapBucket = Math.max(startBucket, Math.floor(from / CALENDAR_RANGE_BUCKET_MS));
      // An event has one deterministic discovery bucket. No growing seen-id
      // cursor and no duplicate when a long event crosses page boundaries.
      if (phase === "range" && bucket.bucketKey !== calendarBucketKey(firstOverlapBucket)) continue;
      if (phase === "wide" && firstOverlapBucket < startBucket + CALENDAR_RANGE_BUCKET_LIMIT - 1) continue;
    }
    const item = await calendarItemReadModelFor(ctx, bucket.itemId, metrics);
    if (!item) continue;
    if (
      item.startAt !== undefined &&
      !(item.startAt <= to && (item.endAt ?? item.startAt) >= from)
    )
      continue;
    rows.push(item);
  }
  const nextPhase = phase === "range" ? "wide" : phase === "wide" ? "unscheduled" : null;
  return {
    rows,
    nextCursor: bucketPage.isDone
      ? nextPhase ? encodeCursor({ kind: "visible", phase: nextPhase }) : null
      : encodeCursor({
          kind: "visible",
          phase,
          cursor: bucketPage.continueCursor,
        }),
  };
}

async function readItemKeysetPage(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  kind: "task" | "official_event" | "official_deadline",
  count: number,
  keyset: KeysetCursor | undefined,
  metrics: CalendarReadMetrics,
) {
  const query = () => ctx.db.query("calendarItemReadModels");
  const tieId = keyset && ctx.db.normalizeId("calendarItems", keyset.key);
  const tied = keyset && tieId
    ? await query().withIndex("by_account_status_kind_updated_item", q =>
        q.eq("ownerAccountId", accountId).eq("status", "active").eq("kind", kind)
          .eq("updatedAt", keyset.updatedAt).gt("itemId", tieId)).take(count)
    : [];
  if (keyset && tieId) metrics.compactQueries += 1;
  if (tied.length === count) return tied;
  metrics.compactQueries += 1;
  const later = await query().withIndex("by_account_status_kind_updated_item", q => {
    const scoped = q.eq("ownerAccountId", accountId).eq("status", "active").eq("kind", kind);
    return keyset ? scoped.gt("updatedAt", keyset.updatedAt) : scoped;
  }).take(count - tied.length);
  return [...tied, ...later];
}

async function readUnscheduledTasks(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  limit: number,
  cursor: string | undefined,
  metrics: CalendarReadMetrics,
) {
  const keyset = decodeKeysetCursor(cursor);
  const page = await readItemKeysetPage(ctx, accountId, "task", limit + 1, keyset, metrics);
  const candidates = page.slice(0, limit);
  const rows = candidates
    .filter(
      (row) =>
        row.startAt === undefined && !row.sourceProvider && !row.planArtifactId,
    )
    .slice(0, limit);
  const cursorRow = page.length > limit ? candidates.at(-1) : undefined;
  return {
    rows,
    nextCursor: cursorRow
      ? encodeKeysetCursor(
          rowKeyset(cursorRow.updatedAt, String(cursorRow.itemId)),
        )
      : null,
  };
}

function plannerGroupWire(rows: readonly Doc<"calendarPlanTaskReadModels">[]) {
  const first = rows[0]!;
  return {
    id: `plan:${first.planArtifactId}`,
    kind: "task" as const,
    title: first.planTitle || first.title,
    notes: rows.length > 1 ? `${rows.length} unscheduled` : undefined,
    allDay: false,
    timezone: "UTC",
    timePrecision: "unknown" as const,
    status: "active" as const,
    sourceLocked: false,
    planArtifactId: first.planArtifactId,
    planTaskId: first.taskId,
    linkedWorkIds: [first.planArtifactId],
    revision: 0,
    dueAt: first.dueAt,
  };
}

type ScheduleRequest = {
  taskItemId?: Id<"calendarItems">;
  planArtifactId?: Id<"spectraArtifacts">;
  planTaskId?: string;
  startAt: number;
  endAt: number;
  timezone: string;
};

/** Receipt recovery checks current authority but creates no new scheduled work. */
async function recoverScheduledBlock(
  ctx: MutationCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  args: ScheduleRequest,
  block: Doc<"calendarItems">,
) {
  const scope = block.scheduleScope;
  const sameRequest = block.kind === "scheduled_work_block" &&
    block.ownerAccountId === actor.accountId && block.schoolId === actor.schoolId &&
    block.planArtifactId === args.planArtifactId &&
    block.startAt === args.startAt && block.endAt === args.endAt && block.timezone === args.timezone &&
    (scope ? scope.requestTaskItemId === args.taskItemId && scope.requestPlanTaskId === args.planTaskId
      : (!args.taskItemId || args.taskItemId === block.taskItemId));
  if (!sameRequest)
    throw new Error("CALENDAR_IDEMPOTENCY_CONFLICT: This scheduling key was already used for another block.");
  if (block.status !== "active")
    throw new Error("CALENDAR_IDEMPOTENCY_REPLAY_REMOVED: This scheduled block is no longer active.");

  // Resolve the admitted IDs, not today's result for a request alias or feed.
  const task = block.taskItemId ? await ctx.db.get(block.taskItemId) : null;
  if (block.taskItemId) {
    if (!task || task.ownerAccountId !== actor.accountId || task.schoolId !== actor.schoolId || task.kind !== "task")
      throw new Error("CALENDAR_TASK_NOT_FOUND: This task is not on your Calendar any more. Refresh Calendar, then try again.");
    if (task.status === "removed") throw new Error("CALENDAR_TASK_UNAVAILABLE: This task is no longer active. Refresh Calendar to see its current state.");
  }
  if (scope && scope.sourceRecordId !== task?.sourceRecordId)
    throw new Error("CALENDAR_SOURCE_LINK_UNAVAILABLE: This task's school record changed. Refresh school data, then try again.");
  if (task?.officialDeadlineItemId !== block.officialDeadlineItemId)
    throw new Error("CALENDAR_SOURCE_LINK_UNAVAILABLE: This task's school record changed. Refresh school data, then try again.");
  if (block.officialDeadlineItemId) {
    const official = await ctx.db.get(block.officialDeadlineItemId);
    if (!official || official.ownerAccountId !== actor.accountId || official.schoolId !== actor.schoolId ||
      official.kind !== "official_deadline" || !official.sourceLocked || official.sourceRecordId !== task?.sourceRecordId)
      throw new Error("CALENDAR_SOURCE_LINK_UNAVAILABLE: This task's school record changed. Refresh school data, then try again.");
  }
  if (block.planArtifactId) {
    const plan = await ctx.db.get(block.planArtifactId);
    if (!plan || plan.ownerAccountId !== actor.accountId ||
      (plan.schoolId !== undefined && plan.schoolId !== actor.schoolId) || plan.blueprintKey !== "planner_task" ||
      !["active", "archived"].includes(plan.status))
      throw new Error("CALENDAR_PLAN_NOT_FOUND: This plan is not available any more. Refresh Calendar, then try again.");
    const content = object(plan.content);
    if (!plannerTaskCandidates(plan).some(candidate => candidate.id === block.planTaskId))
      throw new Error("CALENDAR_PLAN_TASK_NOT_FOUND: This step is no longer in the plan. Refresh Calendar, then try again.");
    if (!scope && args.planTaskId !== block.planTaskId) {
      // Old receipts did not retain the requested visual-subtask alias. Only
      // an extant legacy alias belonging to this same admitted root is safe.
      const sameLegacyRoot = block.planTaskId === "task-1" && !Array.isArray(content.tasks) &&
        Array.isArray(content.subtasks) && content.subtasks.some(candidate => object(candidate).id === args.planTaskId);
      if (!sameLegacyRoot) throw new Error("CALENDAR_IDEMPOTENCY_CONFLICT: This scheduling request was already used for another block. Try placing it again.");
    }
    const sourceRecordId = await sourceRecordForPlanner(ctx, plan._id, actor.accountId);
    const sourceRoot = block.planTaskId === "task-1" ? sourceRecordId : undefined;
    if (task) {
      const linkedDirectly = task.planArtifactId === plan._id && task.planTaskId === block.planTaskId;
      const linkedBySource = Boolean(sourceRoot && task.sourceRecordId === sourceRoot);
      if (!linkedDirectly && !linkedBySource) throw new Error("CALENDAR_TASK_PLAN_MISMATCH: This plan belongs to a different task. Refresh Calendar, then try again.");
      if (sourceRoot && task.sourceRecordId !== sourceRoot) throw new Error("CALENDAR_TASK_PLAN_MISMATCH: This plan belongs to a different task. Refresh Calendar, then try again.");
    } else if (sourceRoot || (block.planTaskId === "task-1" && object(content.source).provider === "managebac")) {
      throw new Error("CALENDAR_SOURCE_LINK_UNAVAILABLE: This task's school record changed. Refresh school data, then try again.");
    }
  } else if (args.planTaskId !== undefined || block.planTaskId !== undefined || !task) {
    throw new Error("CALENDAR_IDEMPOTENCY_CONFLICT: This scheduling request was already used for another block. Try placing it again.");
  }
  return itemWire(block);
}

async function readPlannerTasks(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  limit: number,
  cursor: string | undefined,
  metrics: CalendarReadMetrics,
) {
  const keyset = decodeKeysetCursor(cursor);
  const pageSize = Math.max(limit * 4, 25);
  const page: Doc<"calendarPlanTaskReadModels">[] = [];
  const separator = keyset?.key.indexOf(":") ?? -1;
  const planId = keyset && separator >= 0
    ? ctx.db.normalizeId("spectraArtifacts", keyset.key.slice(0, separator)) : null;
  if (keyset && planId) {
    metrics.compactQueries += 1;
    page.push(...await ctx.db.query("calendarPlanTaskReadModels")
      .withIndex("by_account_plan_status_updated_task", q =>
        q.eq("ownerAccountId", accountId).eq("planStatus", "active")
          .eq("updatedAt", keyset.updatedAt).eq("planArtifactId", planId)
          .gt("taskId", keyset.key.slice(separator + 1))).take(pageSize + 1));
    if (page.length <= pageSize) {
      metrics.compactQueries += 1;
      page.push(...await ctx.db.query("calendarPlanTaskReadModels")
        .withIndex("by_account_plan_status_updated_task", q =>
          q.eq("ownerAccountId", accountId).eq("planStatus", "active")
            .eq("updatedAt", keyset.updatedAt).gt("planArtifactId", planId))
        .take(pageSize + 1 - page.length));
    }
  }
  if (page.length <= pageSize) {
    metrics.compactQueries += 1;
    page.push(...await ctx.db.query("calendarPlanTaskReadModels")
      .withIndex("by_account_plan_status_updated_task", q => {
        const scoped = q.eq("ownerAccountId", accountId).eq("planStatus", "active");
        return keyset ? scoped.gt("updatedAt", keyset.updatedAt) : scoped;
      }).take(pageSize + 1 - page.length));
  }
  const candidates = page.slice(0, pageSize);
  const grouped = new Map<
    string,
    { rows: (typeof page)[number][]; last: (typeof page)[number] }
  >();
  for (const row of candidates) {
    if (row.taskStatus !== "active" || row.scheduled) continue;
    const prior = grouped.get(String(row.planArtifactId));
    const group = prior ?? { rows: [], last: row };
    group.rows.push(row);
    group.last = row;
    grouped.set(String(row.planArtifactId), group);
  }
  const selectedGroups: Array<{
    last: (typeof page)[number];
    wire: ReturnType<typeof calendarItemWire> | ReturnType<typeof plannerGroupWire>;
  }> = [];
  let examinedGroups = 0;
  for (const group of grouped.values()) {
    examinedGroups++;
    let eligible = group.rows;
    let sourceWire: ReturnType<typeof calendarItemWire> | undefined;
    // ManageBac's single-root projection has the stable task-1 identity.
    // Extra personal tasks in that planner do not inherit its lifecycle.
    const root = eligible.find(row => row.taskId === "task-1" && row.sourceRecordId);
    if (root?.sourceRecordId) {
      metrics.compactQueries += 1;
      const sourceTask = await ctx.db.query("calendarItemReadModels")
        .withIndex("by_account_source_kind", q => q.eq("ownerAccountId", accountId)
          .eq("sourceRecordId", root.sourceRecordId).eq("kind", "task"))
        .unique();
      if (sourceTask && sourceTask.schoolId === root.schoolId) {
        let scheduled = false;
        if (sourceTask.status === "active" && sourceTask.startAt === undefined) {
          metrics.compactQueries += 1;
          const blocks = await ctx.db.query("calendarItemReadModels")
            .withIndex("by_account_task_status", q => q.eq("ownerAccountId", accountId)
              .eq("taskItemId", sourceTask.itemId).eq("status", "active"))
            .take(1);
          scheduled = blocks.length > 0;
        }
        if (sourceTask.status !== "active" || sourceTask.startAt !== undefined || scheduled) {
          eligible = eligible.filter(row => row !== root);
        } else {
          sourceWire = {
            ...calendarReadModelWire(sourceTask)!,
            planArtifactId: root.planArtifactId,
            planTaskId: root.taskId,
            linkedWorkIds: [...new Set([...sourceTask.linkedArtifactIds, root.planArtifactId])],
          };
        }
      } else eligible = eligible.filter(row => row !== root);
    }
    const first = eligible[0];
    if (!first) continue;
    selectedGroups.push({ last: group.last, wire: sourceWire ?? plannerGroupWire(eligible) });
    if (selectedGroups.length === limit) break;
  }
  const plans = selectedGroups.map(group => group.wire);
  const cursorRow =
    examinedGroups < grouped.size
      ? selectedGroups.at(-1)?.last
      : page.length > pageSize
        ? candidates.at(-1)
        : undefined;
  return {
    plans,
    nextCursor: cursorRow
      ? encodeKeysetCursor(
          rowKeyset(
            cursorRow.updatedAt,
            `${String(cursorRow.planArtifactId)}:${cursorRow.taskId}`,
          ),
        )
      : null,
  };
}

async function readPartialTimeItems(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  limit: number,
  cursor: CalendarCursor | undefined,
  metrics: CalendarReadMetrics,
) {
  const kinds = ["official_event", "official_deadline"] as const;
  let kindIndex = cursor?.kind === "partial" ? (cursor.kindIndex ?? 0) : 0;
  let keyset =
    cursor?.kind === "partial" && cursor.updatedAt !== undefined && cursor.key
      ? rowKeyset(cursor.updatedAt, cursor.key)
      : undefined;
  const rows: ReadModelRow[] = [];
  while (kindIndex < kinds.length) {
    const kind = kinds[kindIndex]!;
    const page = await readItemKeysetPage(ctx, accountId, kind, limit + 1, keyset, metrics);
    const candidates = page.slice(0, limit);
    const partialRows = candidates.filter(
      (row) => row.timePrecision === "unknown" || row.startAt === undefined,
    );
    rows.push(...partialRows.slice(0, Math.max(0, limit - rows.length)));
    if (rows.length >= limit) {
      const last = rows.at(-1)!;
      return {
        rows,
        nextCursor: encodeCursor({
          kind: "partial",
          kindIndex,
          updatedAt: last.updatedAt,
          key: String(last.itemId),
        }),
      };
    }
    if (page.length > limit) {
      const last = candidates.at(-1)!;
      return {
        rows,
        nextCursor: encodeCursor({
          kind: "partial",
          kindIndex,
          updatedAt: last.updatedAt,
          key: String(last.itemId),
        }),
      };
    }
    kindIndex += 1;
    keyset = undefined;
  }
  return { rows, nextCursor: null };
}


export const overview = query({
  args: {
    from: v.number(),
    to: v.number(),
    targetItemId: v.optional(v.id("calendarItems")),
    targetTitle: v.optional(v.string()),
    cursor: v.optional(v.string()),
    unscheduledCursor: v.optional(v.string()),
    partialCursor: v.optional(v.string()),
    migrationCursor: v.optional(v.string()),
    plannerCursor: v.optional(v.string()),
    targetCursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    debug: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await actorOrThrow(ctx);
    if (
      !Number.isFinite(args.from) ||
      !Number.isFinite(args.to) ||
      args.to <= args.from
    )
      throw new Error("CALENDAR_RANGE_INVALID: Calendar needs a valid date range.");
    const metrics = createCalendarReadMetrics();
    const limit = pageSize(args.limit);
    const visiblePage = args.cursor === CALENDAR_DONE_CURSOR ? { rows: [], nextCursor: null } : await readVisibleCalendarItems(
      ctx,
      actor.accountId,
      args.from,
      args.to,
      limit,
      decodeCursor(args.cursor),
      metrics,
    );
    const unscheduledPage = args.unscheduledCursor === CALENDAR_DONE_CURSOR ? { rows: [], nextCursor: null } : await readUnscheduledTasks(
      ctx,
      actor.accountId,
      limit,
      args.unscheduledCursor,
      metrics,
    );
    const plannerPage = args.plannerCursor === CALENDAR_DONE_CURSOR ? { plans: [], nextCursor: null } : await readPlannerTasks(
      ctx,
      actor.accountId,
      limit,
      args.plannerCursor,
      metrics,
    );
    const partialPage = args.partialCursor === CALENDAR_DONE_CURSOR ? { rows: [], nextCursor: null } : await readPartialTimeItems(
      ctx,
      actor.accountId,
      limit,
      decodeCursor(args.partialCursor),
      metrics,
    );
    const migrationKeyset = decodeKeysetCursor(args.migrationCursor);
    const migrationRows: Doc<"calendarMigrationReadModels">[] = [];
    const migrationId = migrationKeyset && ctx.db.normalizeId("spectraArtifacts", migrationKeyset.key);
    if (args.migrationCursor !== CALENDAR_DONE_CURSOR && migrationKeyset && migrationId) {
      metrics.compactQueries += 1;
      migrationRows.push(...await ctx.db.query("calendarMigrationReadModels")
        .withIndex("by_account_artifact_status_updated_legacy", q =>
          q.eq("ownerAccountId", actor.accountId).eq("artifactStatus", "active")
            .eq("updatedAt", migrationKeyset.updatedAt).gt("legacyArtifactId", migrationId))
        .take(limit + 1));
    }
    if (args.migrationCursor !== CALENDAR_DONE_CURSOR && migrationRows.length <= limit) {
      metrics.compactQueries += 1;
      migrationRows.push(...await ctx.db
      .query("calendarMigrationReadModels")
      .withIndex("by_account_artifact_status_updated_legacy", (q) => {
        const scoped = q
          .eq("ownerAccountId", actor.accountId)
          .eq("artifactStatus", "active");
        return migrationKeyset
          ? scoped.gt("updatedAt", migrationKeyset.updatedAt)
          : scoped;
      })
      .take(limit + 1 - migrationRows.length));
    }
    const migrationPage = migrationRows.slice(0, limit);
    const migrationCursorRow = migrationRows.length > limit ? migrationPage.at(-1) : undefined;
    const nextMigrationCursor = migrationCursorRow
      ? encodeKeysetCursor(
          rowKeyset(
            migrationCursorRow.updatedAt,
            String(migrationCursorRow.legacyArtifactId),
          ),
        )
      : null;
    metrics.compactQueries += 1;
    const integration = await ctx.db
      .query("schoolIntegrations")
      .withIndex("by_school_provider", (q) =>
        q.eq("schoolId", actor.schoolId).eq("provider", "managebac"),
      )
      .unique();
    const targetItems: Array<ReturnType<typeof calendarItemWire>> = [];
    if (args.targetItemId) {
      const target = await calendarItemReadModelFor(
        ctx,
        args.targetItemId,
        metrics,
      );
      // Exact identity is a safe, bounded compatibility fallback while the
      // one-time item backfill is still in progress. Never scan canonical rows
      // for ordinary range discovery.
      if (target?.ownerAccountId === actor.accountId) {
        const wire = calendarReadModelWire(target);
        if (wire) targetItems.push(wire);
      } else if (!target) {
        metrics.canonicalGets += 1;
        const canonical = await ctx.db.get(args.targetItemId);
        if (canonical?.ownerAccountId === actor.accountId)
          targetItems.push(calendarItemWire(canonical));
      }
    }
    const targetTitle = args.targetTitle?.trim();
    let targetTitleCursor: string | null = null;
    if (targetTitle) {
      const titleKeyset = decodeKeysetCursor(args.targetCursor);
      metrics.compactQueries += 1;
      const titleRows = await ctx.db
        .query("calendarItemReadModels")
        .withIndex("by_account_status_title_item", (q) => {
          const scoped = q
            .eq("ownerAccountId", actor.accountId)
            .eq("status", "active")
            .eq("title", targetTitle);
          const itemId = titleKeyset && ctx.db.normalizeId("calendarItems", titleKeyset.key);
          return itemId ? scoped.gt("itemId", itemId) : scoped;
        })
        .take(limit + 1);
      const matches = titleRows.slice(0, limit);
      for (const row of matches) {
        const wire = calendarReadModelWire(row);
        if (wire && !targetItems.some((item) => item.id === wire.id))
          targetItems.push(wire);
      }
      const titleCursorRow = titleRows.length > limit ? matches.at(-1) : undefined;
      targetTitleCursor = titleCursorRow
        ? encodeKeysetCursor(rowKeyset(0, String(titleCursorRow.itemId)))
        : null;
    }
    const visibleItems = visiblePage.rows.flatMap((row) => {
      const wire = calendarReadModelWire(row);
      return wire ? [wire] : [];
    });
    const unscheduledTasks = unscheduledPage.rows.flatMap((row) => {
      const wire = calendarReadModelWire(row);
      return wire ? [wire] : [];
    });
    const timezone =
      visiblePage.rows.find((item) => item.timezone && item.timezone !== "UTC")
        ?.timezone ?? "UTC";
    const lastUpdatedAt = visiblePage.rows.reduce(
      (latest, item) => Math.max(latest, item.updatedAt),
      integration?.lastSyncAt ?? 0,
    );
    const stale =
      Boolean(integration) &&
      (!integration?.lastSyncAt ||
        Date.now() - integration.lastSyncAt >
          integration.freshnessSlaMinutes * 60_000);
    return {
      timezone,
      range: { from: args.from, to: args.to },
      items: visibleItems,
      scheduledWorkBlocks: visibleItems.filter(
        (item) => item.kind === "scheduled_work_block",
      ),
      unscheduledTasks: [...unscheduledTasks, ...plannerPage.plans],
      partialTimeItems: partialPage.rows.flatMap((row) => {
        const wire = calendarReadModelWire(row);
        return wire ? [wire] : [];
      }),
      targetedItems: targetItems,
      pagination: {
        visible: visiblePage.nextCursor,
        unscheduled: unscheduledPage.nextCursor,
        planner: plannerPage.nextCursor,
        partial: partialPage.nextCursor,
        migration: nextMigrationCursor,
        targetTitle: targetTitleCursor,
      },
      sourceState: !integration
        ? { kind: "not_connected" as const }
        : stale
          ? {
              kind: "stale" as const,
              updatedAt: integration.lastSyncAt ?? 0,
              reason: "School data is outside its freshness window.",
            }
          : { kind: "available" as const, updatedAt: integration.lastSyncAt },
      lastUpdatedAt: lastUpdatedAt || undefined,
      migration: {
        pageComplete: migrationPage.every(migration => migration.migrationStatus === "completed"),
        complete:
          nextMigrationCursor === null &&
          migrationPage.every(
            (migration) => migration.migrationStatus === "completed",
          ),
        completeKnown: nextMigrationCursor === null,
        partial: migrationPage.some(
          (migration) => migration.migrationStatus === "partial",
        ),
        migratedArtifacts: migrationPage.length,
        migratedEvents: migrationPage.reduce(
          (sum, item) => sum + item.migratedCount,
          0,
        ),
        skippedEvents: migrationPage.reduce(
          (sum, item) => sum + item.skippedCount,
          0,
        ),
      },
      ...(args.debug ? { readMetrics: metrics } : {}),
    };
  },
});

export const createPersonalItem = mutation({
  args: {
    kind: v.union(
      v.literal("personal_event"),
      v.literal("task"),
      v.literal("milestone"),
      v.literal("reminder"),
    ),
    title: v.string(),
    notes: v.optional(v.string()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    timezone: v.string(),
    linkedArtifactIds: v.optional(v.array(v.id("spectraArtifacts"))),
    actorKind: v.optional(v.union(v.literal("human"), v.literal("ai"))),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await actorOrThrow(ctx);
    if (
      args.startAt !== undefined &&
      args.endAt !== undefined &&
      args.endAt <= args.startAt
    )
      throw new Error("CALENDAR_TIME_INVALID: End must be after start.");
    const idempotencyKey = args.idempotencyKey?.trim().slice(0, 240);
    if (args.idempotencyKey !== undefined && (!idempotencyKey || idempotencyKey.length < 8))
      throw new Error("CALENDAR_IDEMPOTENCY_KEY_INVALID: This Calendar request is invalid. Try again.");
    const previous = idempotencyKey ? await ctx.db.query("calendarItems")
      .withIndex("by_schedule_idempotency", (q) => q.eq("ownerAccountId", actor.accountId).eq("idempotencyKey", idempotencyKey)).unique() : null;
    if (previous) {
      const same = previous.kind === args.kind && previous.title === (text(args.title) || "Untitled item") &&
        previous.notes === (text(args.notes, 20_000) || undefined) && previous.startAt === args.startAt &&
        previous.endAt === args.endAt && previous.timezone === args.timezone && previous.allDay === (args.allDay === true) &&
        JSON.stringify(previous.linkedArtifactIds) === JSON.stringify(args.linkedArtifactIds ?? []);
      if (!same) throw new Error("CALENDAR_IDEMPOTENCY_CONFLICT: This key was already used for another event.");
      if (previous.status !== "active") throw new Error("CALENDAR_IDEMPOTENCY_REPLAY_REMOVED: This event is no longer active.");
      return itemWire(previous);
    }
    const now = Date.now();
    const itemId = await ctx.db.insert("calendarItems", {
      ownerAccountId: actor.accountId,
      schoolId: actor.schoolId,
      kind: args.kind,
      title: text(args.title) || "Untitled item",
      notes: text(args.notes, 20_000) || undefined,
      startAt: args.startAt,
      endAt: args.endAt,
      allDay: args.allDay === true,
      timezone: args.timezone,
      timePrecision: args.startAt === undefined ? "unknown" : "exact",
      status: "active",
      sourceLocked: false,
      linkedArtifactIds: args.linkedArtifactIds ?? [],
      revision: 1,
      createdBy: args.actorKind === "ai" ? "ai" : "human",
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    });
    return itemWire((await ctx.db.get(itemId))!);
  },
});

export const scheduleTask = mutation({
  args: {
    taskItemId: v.optional(v.id("calendarItems")),
    planArtifactId: v.optional(v.id("spectraArtifacts")),
    planTaskId: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    timezone: v.string(),
    actorKind: v.optional(v.union(v.literal("human"), v.literal("ai"))),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await actorOrThrow(ctx);
    if (args.endAt <= args.startAt)
      throw new Error("CALENDAR_TIME_INVALID: End must be after start.");
    if (!args.taskItemId && !(args.planArtifactId && args.planTaskId))
      throw new Error("CALENDAR_TASK_REQUIRED: Choose a task or plan to schedule.");
    const idempotencyKey = args.idempotencyKey?.trim().slice(0, 240);
    if (
      args.idempotencyKey !== undefined &&
      (!idempotencyKey || idempotencyKey.length < 8)
    )
      throw new Error("CALENDAR_IDEMPOTENCY_KEY_INVALID: This Calendar request is invalid. Try again.");
    const existingByKey = idempotencyKey
      ? await ctx.db.query("calendarItems")
          .withIndex("by_schedule_idempotency", q => q.eq("ownerAccountId", actor.accountId).eq("idempotencyKey", idempotencyKey))
          .unique()
      : null;
    if (existingByKey) return recoverScheduledBlock(ctx, actor, args, existingByKey);
    let plannerArtifact: Doc<"spectraArtifacts"> | null = null;
    let plannerTask: { id: string; title: string } | undefined;
    let taskItem = args.taskItemId ? await ctx.db.get(args.taskItemId) : null;
    const assertTaskAvailable = (task: Doc<"calendarItems"> | null) => {
      if (!task || task.ownerAccountId !== actor.accountId ||
        task.schoolId !== actor.schoolId || task.kind !== "task")
        throw new Error("CALENDAR_TASK_NOT_FOUND: This task is not on your Calendar any more. Refresh Calendar, then try again.");
      if (task.status !== "active") throw new Error("CALENDAR_TASK_UNAVAILABLE: This task is no longer active. Refresh Calendar to see its current state.");
    };
    if (args.taskItemId) assertTaskAvailable(taskItem);
    if (args.planTaskId && !args.planArtifactId)
      throw new Error("CALENDAR_PLAN_NOT_FOUND: This plan is not available any more. Refresh Calendar, then try again.");
    if (args.planArtifactId) {
      plannerArtifact = await ctx.db.get(args.planArtifactId);
      if (
        !plannerArtifact ||
        plannerArtifact.ownerAccountId !== actor.accountId ||
        (plannerArtifact.schoolId !== undefined && plannerArtifact.schoolId !== actor.schoolId) ||
        plannerArtifact.blueprintKey !== "planner_task" ||
        plannerArtifact.status !== "active"
      )
        throw new Error("CALENDAR_PLAN_NOT_FOUND: This plan is not available any more. Refresh Calendar, then try again.");
      const availableTasks = planTasks(plannerArtifact);
      const content = object(plannerArtifact.content);
      const legacySubtask = !Array.isArray(content.tasks) && Array.isArray(content.subtasks) &&
        content.subtasks.some(candidate => object(candidate).id === args.planTaskId);
      plannerTask =
        availableTasks.find((candidate) => candidate.id === args.planTaskId) ??
        // Retain the historical visual-subtask alias only when that subtask
        // actually belongs to the single-root plan, never for arbitrary IDs.
        (legacySubtask && availableTasks.length === 1 ? availableTasks[0] : undefined);
      if (!plannerTask) throw new Error("CALENDAR_PLAN_TASK_NOT_FOUND: This step is no longer in the plan. Refresh Calendar, then try again.");
      const planRow = await ctx.db.query("calendarPlanTaskReadModels")
        .withIndex("by_plan_task", q => q.eq("planArtifactId", plannerArtifact!._id)
          .eq("taskId", plannerTask!.id)).unique();
      // Read models accelerate discovery; only the persisted source projection
      // may authorize the association between a planner and an imported task.
      const sourceRecordId = await sourceRecordForPlanner(ctx, plannerArtifact._id, actor.accountId);
      if (planRow && (planRow.ownerAccountId !== actor.accountId ||
        planRow.schoolId !== plannerArtifact.schoolId || planRow.sourceRecordId !== sourceRecordId))
        throw new Error("CALENDAR_SOURCE_LINK_UNAVAILABLE: This task's school record changed. Refresh school data, then try again.");
      const sourceRootRecordId = plannerTask.id === "task-1" ? sourceRecordId : undefined;
      if (sourceRootRecordId) {
        if (!planRow) throw new Error("CALENDAR_SOURCE_LINK_UNAVAILABLE: This task's school record changed. Refresh school data, then try again.");
        const sourceModel = await ctx.db.query("calendarItemReadModels")
          .withIndex("by_account_source_kind", q => q.eq("ownerAccountId", actor.accountId)
            .eq("sourceRecordId", sourceRootRecordId).eq("kind", "task")).unique();
        if (sourceModel) {
          const sourceTask = await ctx.db.get(sourceModel.itemId);
          assertTaskAvailable(sourceTask);
          if (sourceTask!.sourceRecordId !== sourceRootRecordId ||
            (taskItem && taskItem._id !== sourceTask!._id))
            throw new Error("CALENDAR_TASK_PLAN_MISMATCH: This plan belongs to a different task. Refresh Calendar, then try again.");
          taskItem = sourceTask;
        } else throw new Error("CALENDAR_SOURCE_LINK_UNAVAILABLE: This task's school record changed. Refresh school data, then try again.");
      }
      if (taskItem) {
        const linkedDirectly = taskItem.planArtifactId === plannerArtifact._id &&
          taskItem.planTaskId === plannerTask.id;
        const linkedBySource = Boolean(sourceRootRecordId && taskItem.sourceRecordId === sourceRootRecordId);
        if (!linkedDirectly && !linkedBySource)
          throw new Error("CALENDAR_TASK_PLAN_MISMATCH: This plan belongs to a different task. Refresh Calendar, then try again.");
      } else if (plannerTask.id === "task-1" && object(content.source).provider === "managebac") {
        throw new Error("CALENDAR_SOURCE_LINK_UNAVAILABLE: Refresh school data before scheduling this imported task.");
      }
    }
    const resolvedPlanTaskId = plannerTask?.id ?? args.planTaskId;
    const resolvedTaskItemId = taskItem?._id;
    let officialDeadlineItemId = taskItem?.officialDeadlineItemId;
    if (officialDeadlineItemId) {
      const official = await ctx.db.get(officialDeadlineItemId);
      if (!official || official.ownerAccountId !== actor.accountId ||
        official.schoolId !== actor.schoolId || official.kind !== "official_deadline" ||
        !official.sourceLocked || official.sourceRecordId !== taskItem?.sourceRecordId)
        throw new Error("CALENDAR_SOURCE_LINK_UNAVAILABLE: This task's school record changed. Refresh school data, then try again.");
      officialDeadlineItemId = official._id;
    }
    const title = taskItem?.title ?? plannerTask?.title ?? "Scheduled work";
    const now = Date.now();
    const itemId = await ctx.db.insert("calendarItems", {
      ownerAccountId: actor.accountId,
      schoolId: actor.schoolId,
      kind: "scheduled_work_block",
      title,
      startAt: args.startAt,
      endAt: args.endAt,
      allDay: false,
      timezone: args.timezone,
      timePrecision: "exact",
      status: "active",
      sourceLocked: false,
      taskItemId: resolvedTaskItemId,
      planArtifactId: args.planArtifactId,
      planTaskId: resolvedPlanTaskId,
      officialDeadlineItemId,
      linkedArtifactIds: args.planArtifactId ? [args.planArtifactId] : [],
      idempotencyKey,
      scheduleScope: idempotencyKey ? {
        requestTaskItemId: args.taskItemId,
        requestPlanTaskId: args.planTaskId,
        sourceRecordId: taskItem?.sourceRecordId,
      } : undefined,
      revision: 1,
      createdBy: args.actorKind ?? "human",
      createdAt: now,
      updatedAt: now,
    });
    return itemWire((await ctx.db.get(itemId))!);
  },
});

export const moveWorkBlock = mutation({
  args: {
    itemId: v.id("calendarItems"),
    startAt: v.number(),
    endAt: v.number(),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await actorOrThrow(ctx);
    const item = await ctx.db.get(args.itemId);
    if (
      !item ||
      item.ownerAccountId !== actor.accountId ||
      item.kind !== "scheduled_work_block"
    )
      throw new Error("CALENDAR_WORK_BLOCK_NOT_FOUND: This work block is not on your Calendar any more. Refresh Calendar.");
    if (item.revision !== args.expectedRevision)
      throw new Error(
        "CALENDAR_GESTURE_CONFLICT: Re-resolve the block before moving it.",
      );
    if (args.endAt <= args.startAt) throw new Error("CALENDAR_TIME_INVALID: End must be after start.");
    await ctx.db.patch(item._id, {
      startAt: args.startAt,
      endAt: args.endAt,
      revision: item.revision + 1,
      updatedAt: Date.now(),
    });
    return itemWire((await ctx.db.get(item._id))!);
  },
});

export const resizeWorkBlock = mutation({
  args: {
    itemId: v.id("calendarItems"),
    endAt: v.number(),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await actorOrThrow(ctx);
    const item = await ctx.db.get(args.itemId);
    if (
      !item ||
      item.ownerAccountId !== actor.accountId ||
      item.kind !== "scheduled_work_block"
    )
      throw new Error("CALENDAR_WORK_BLOCK_NOT_FOUND: This work block is not on your Calendar any more. Refresh Calendar.");
    if (item.revision !== args.expectedRevision)
      throw new Error(
        "CALENDAR_GESTURE_CONFLICT: Re-resolve the block before resizing it.",
      );
    if (item.startAt === undefined || args.endAt <= item.startAt)
      throw new Error("CALENDAR_TIME_INVALID: End must be after start.");
    await ctx.db.patch(item._id, {
      endAt: args.endAt,
      revision: item.revision + 1,
      updatedAt: Date.now(),
    });
    return itemWire((await ctx.db.get(item._id))!);
  },
});

export const completeWorkBlock = mutation({
  args: {
    itemId: v.id("calendarItems"),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await actorOrThrow(ctx);
    const item = await ctx.db.get(args.itemId);
    if (
      !item ||
      item.ownerAccountId !== actor.accountId ||
      item.kind !== "scheduled_work_block"
    )
      throw new Error("CALENDAR_WORK_BLOCK_NOT_FOUND: This work block is not on your Calendar any more. Refresh Calendar.");
    if (item.revision !== args.expectedRevision)
      throw new Error(
        "CALENDAR_GESTURE_CONFLICT: Re-resolve the block before completing it.",
      );
    if (item.status === "removed" || item.status === "cancelled")
      throw new Error("CALENDAR_WORK_BLOCK_UNAVAILABLE: This work block was removed or cancelled, so it cannot be completed.");
    await ctx.db.patch(item._id, {
      status: "completed",
      revision: item.revision + 1,
      updatedAt: Date.now(),
    });
    return itemWire((await ctx.db.get(item._id))!);
  },
});

export const removePersonalItem = mutation({
  args: { itemId: v.id("calendarItems") },
  handler: async (ctx, args) => {
    const actor = await actorOrThrow(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.ownerAccountId !== actor.accountId)
      throw new Error("CALENDAR_ITEM_NOT_FOUND: This item is not on your Calendar any more. Refresh Calendar.");
    if (item.sourceLocked)
      throw new Error(
        "CALENDAR_SOURCE_LOCKED: Official source records cannot be removed here.",
      );
    await ctx.db.patch(item._id, {
      status: "removed",
      revision: item.revision + 1,
      updatedAt: Date.now(),
    });
    return { itemId: item._id };
  },
});

export const ensureLegacyMigration = mutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await actorOrThrow(ctx);
    const page = await ctx.db
      .query("spectraArtifacts")
      .withIndex("by_account_blueprint", (q) =>
        q.eq("ownerAccountId", actor.accountId).eq("blueprintKey", "timetable"),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: Math.min(25, Math.max(1, Math.floor(args.limit ?? 10))),
      });
    let migratedArtifacts = 0;
    let migratedEvents = 0;
    let skippedEvents = 0;
    for (const artifact of page.page) {
      const prior = await ctx.db
        .query("calendarMigrations")
        .withIndex("by_legacy_artifact", (q) =>
          q.eq("legacyArtifactId", artifact._id),
        )
        .unique();
      if (
        prior &&
        prior.version >= 1 &&
        (prior.status === "completed" || prior.status === "partial")
      )
        continue;
      const startedAt = Date.now();
      const migrationId =
        prior?._id ??
        (await ctx.db.insert("calendarMigrations", {
          ownerAccountId: actor.accountId,
          schoolId: actor.schoolId,
          legacyArtifactId: artifact._id,
          version: 1,
          status: "running",
          migratedCount: 0,
          skippedCount: 0,
          eventOffset: 0,
          startedAt,
          updatedAt: startedAt,
        }));
      const content = object(artifact.content);
      const events = Array.isArray(content.events) ? content.events : [];
      const eventOffset = Math.max(0, prior?.eventOffset ?? 0);
      const eventEnd = Math.min(events.length, eventOffset + 100);
      let migrated = 0;
      let skipped = 0;
      for (let index = eventOffset; index < eventEnd; index += 1) {
        const event = object(events[index]);
        const legacyEventId = text(event.id, 180) || `event-${index + 1}`;
        const existing = await ctx.db
          .query("calendarItems")
          .withIndex("by_legacy_event", (q) =>
            q
              .eq("legacyArtifactId", artifact._id)
              .eq("legacyEventId", legacyEventId),
          )
          .unique();
        if (existing) continue;
        const startAt =
          typeof event.start === "string"
            ? Date.parse(event.start)
            : Number(event.start);
        const endAt =
          typeof event.end === "string"
            ? Date.parse(event.end)
            : Number(event.end);
        if (
          !Number.isFinite(startAt) ||
          !Number.isFinite(endAt) ||
          endAt <= startAt
        ) {
          skipped += 1;
          continue;
        }
        const locked =
          event.locked === true || typeof event.sourceRef === "string";
        const now = Date.now();
        await ctx.db.insert("calendarItems", {
          ownerAccountId: actor.accountId,
          schoolId: actor.schoolId,
          kind: locked ? "official_event" : "personal_event",
          title: text(event.title) || "Imported Calendar event",
          notes: text(event.notes, 20_000) || undefined,
          startAt,
          endAt,
          allDay: event.allDay === true,
          timezone:
            text(event.timezone, 100) || text(content.timezone, 100) || "UTC",
          timePrecision: "exact",
          status: event.status === "cancelled" ? "cancelled" : "active",
          sourceLocked: locked,
          sourceProvider: locked ? "legacy_timetable" : undefined,
          sourceKey: locked
            ? `legacy:${artifact._id}:${legacyEventId}`
            : undefined,
          sourceUrl:
            typeof event.sourceRef === "string" ? event.sourceRef : undefined,
          sourceCapabilityState: locked ? "available" : undefined,
          location: text(event.location, 300) || undefined,
          taskItemId: undefined,
          linkedArtifactIds: Array.isArray(event.artifactIds)
            ? event.artifactIds.flatMap((id) => {
                const normalized = ctx.db.normalizeId(
                  "spectraArtifacts",
                  String(id),
                );
                return normalized ? [normalized] : [];
              })
            : [],
          recurrence: text(event.recurrence, 500) || undefined,
          legacyArtifactId: artifact._id,
          legacyEventId,
          revision: 1,
          createdBy: "migration",
          createdAt: now,
          updatedAt: now,
        });
        migrated += 1;
      }
      const complete = eventEnd >= events.length;
      const totalMigrated = (prior?.migratedCount ?? 0) + migrated;
      const totalSkipped = (prior?.skippedCount ?? 0) + skipped;
      await ctx.db.patch(migrationId, {
        status: complete ? (totalSkipped ? "partial" : "completed") : "running",
        migratedCount: totalMigrated,
        skippedCount: totalSkipped,
        eventOffset: eventEnd,
        completedAt: complete ? Date.now() : undefined,
        updatedAt: Date.now(),
      });
      await syncCalendarMigrationReadModel(ctx, {
        ...artifact,
        updatedAt: Math.max(artifact.updatedAt, Date.now()),
      });
      if (complete) {
        const tags = new Set(artifact.tags ?? []);
        tags.add("calendar-migrated");
        await ctx.db.patch(artifact._id, {
          tags: [...tags],
          updatedAt: Date.now(),
        });
        migratedArtifacts += 1;
      }
      migratedEvents += migrated;
      skippedEvents += skipped;
      if (!complete)
        return {
          migratedArtifacts,
          migratedEvents,
          skippedEvents,
          cursor: args.cursor ?? null,
          done: false,
        };
    }
    return {
      migratedArtifacts,
      migratedEvents,
      skippedEvents,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

/** Bounded repair for calendar rows created before the compact read models. */
export const backfillItemReadModels = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const metrics = createCalendarReadMetrics();
    const page = await ctx.db.query("calendarItems").paginate({
      cursor: args.cursor,
      // Each repair can delete and recreate 370 day buckets. Ten items keep
      // worst-case read/write fanout below a single transaction's limits.
      numItems: Math.min(10, Math.max(1, Math.floor(args.limit ?? 10))),
      maximumBytesRead: 2_000_000,
    });
    for (const item of page.page)
      await upsertCalendarItemReadModel(ctx, item, metrics, {
        repairRangeBuckets: true,
      });
    return {
      processed: page.page.length,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
      readMetrics: metrics,
    };
  },
});

/** Bounded repair for planner task and legacy timetable metadata rows. */
export const backfillArtifactReadModels = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("spectraArtifacts").paginate({
      cursor: args.cursor,
      numItems: Math.min(50, Math.max(1, Math.floor(args.limit ?? 25))),
    });
    for (const artifact of page.page) {
      if (artifact.blueprintKey === "planner_task")
        await syncPlannerTaskReadModels(ctx, artifact);
      if (artifact.blueprintKey === "timetable")
        await syncCalendarMigrationReadModel(ctx, artifact);
    }
    return {
      processed: page.page.length,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});
