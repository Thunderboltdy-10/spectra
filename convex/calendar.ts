import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";
import {
  CALENDAR_RANGE_BUCKET_MS,
  calendarBucketKey,
  calendarItemReadModelFor,
  calendarItemWire,
  createCalendarReadMetrics,
  plannerTaskCandidates,
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
  updatedAt?: number;
  key?: string;
  seen?: string[];
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

function afterKeyset(
  updatedAt: number,
  key: string,
  cursor: KeysetCursor | undefined,
) {
  return (
    !cursor ||
    updatedAt > cursor.updatedAt ||
    (updatedAt === cursor.updatedAt && key > cursor.key)
  );
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
  const seen = new Set(cursor?.kind === "visible" ? (cursor.seen ?? []) : []);
  const rows = new Map<string, ReadModelRow>();
  const firstBucket = calendarBucketKey(
    Math.floor(from / CALENDAR_RANGE_BUCKET_MS),
  );
  const lastBucket = calendarBucketKey(
    Math.floor(to / CALENDAR_RANGE_BUCKET_MS),
  );
  metrics.compactQueries += 1;
  const bucketPage = await ctx.db
    .query("calendarItemRangeBuckets")
    .withIndex("by_account_status_bucket", (q) =>
      q
        .eq("ownerAccountId", accountId)
        .eq("status", "active")
        .gte("bucketKey", firstBucket)
        .lte("bucketKey", lastBucket),
    )
    .paginate({
      cursor: cursor?.kind === "visible" ? (cursor.cursor ?? null) : null,
      numItems: limit,
    });
  metrics.rangeRowsRead += bucketPage.page.length;
  const wideRows = await ctx.db
    .query("calendarItemRangeBuckets")
    .withIndex("by_account_status_bucket", (q) =>
      q
        .eq("ownerAccountId", accountId)
        .eq("status", "active")
        .eq("bucketKey", "__wide__"),
    )
    .take(limit);
  metrics.compactQueries += 1;
  const unscheduledRows = await ctx.db
    .query("calendarItemRangeBuckets")
    .withIndex("by_account_status_bucket", (q) =>
      q
        .eq("ownerAccountId", accountId)
        .eq("status", "active")
        .eq("bucketKey", "__unscheduled__"),
    )
    .take(limit);
  metrics.rangeRowsRead += wideRows.length + unscheduledRows.length;
  for (const bucket of [...bucketPage.page, ...wideRows, ...unscheduledRows]) {
    const itemKey = String(bucket.itemId);
    if (seen.has(itemKey) || rows.has(itemKey)) continue;
    const item = await calendarItemReadModelFor(ctx, bucket.itemId, metrics);
    if (!item) continue;
    if (
      item.startAt !== undefined &&
      !(item.startAt <= to && (item.endAt ?? item.startAt) >= from)
    )
      continue;
    rows.set(itemKey, item);
    seen.add(itemKey);
    if (rows.size >= limit) break;
  }
  return {
    rows: [...rows.values()].slice(0, limit),
    nextCursor: bucketPage.isDone
      ? null
      : encodeCursor({
          kind: "visible",
          cursor: bucketPage.continueCursor,
          seen: [...seen].slice(-CALENDAR_MAX_PAGE_SIZE),
        }),
  };
}

async function readUnscheduledTasks(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  limit: number,
  cursor: string | undefined,
  metrics: CalendarReadMetrics,
) {
  const keyset = decodeKeysetCursor(cursor);
  metrics.compactQueries += 1;
  const page = await ctx.db
    .query("calendarItemReadModels")
    .withIndex("by_account_status_kind_updated_item", (q) => {
      const scoped = q
        .eq("ownerAccountId", accountId)
        .eq("status", "active")
        .eq("kind", "task");
      return keyset ? scoped.gte("updatedAt", keyset.updatedAt) : scoped;
    })
    .take(limit + 1);
  const candidates = page.filter((row) =>
    afterKeyset(row.updatedAt, String(row.itemId), keyset),
  );
  const rows = candidates
    .filter(
      (row) =>
        row.startAt === undefined && !row.sourceProvider && !row.planArtifactId,
    )
    .slice(0, limit);
  const cursorRow =
    rows.length >= limit
      ? rows.at(-1)
      : page.length > limit
        ? page.at(-1)
        : undefined;
  return {
    rows,
    nextCursor: cursorRow
      ? encodeKeysetCursor(
          rowKeyset(cursorRow.updatedAt, String(cursorRow.itemId)),
        )
      : null,
  };
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
  metrics.compactQueries += 1;
  const page = await ctx.db
    .query("calendarPlanTaskReadModels")
    .withIndex("by_account_plan_status_updated_task", (q) => {
      const scoped = q
        .eq("ownerAccountId", accountId)
        .eq("planStatus", "active");
      return keyset ? scoped.gte("updatedAt", keyset.updatedAt) : scoped;
    })
    .take(pageSize + 1);
  const candidates = page.filter((row) =>
    afterKeyset(
      row.updatedAt,
      `${String(row.planArtifactId)}:${row.taskId}`,
      keyset,
    ),
  );
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
  const representedPlans = new Set<string>();
  for (const group of grouped.values()) {
    const sourceRecordId = group.rows[0]?.sourceRecordId;
    if (!sourceRecordId) continue;
    metrics.compactQueries += 1;
    const sourceTasks = await ctx.db
      .query("calendarItemReadModels")
      .withIndex("by_account_status_source", (q) =>
        q
          .eq("ownerAccountId", accountId)
          .eq("status", "active")
          .eq("kind", "task")
          .eq("sourceRecordId", sourceRecordId),
      )
      .take(1);
    if (sourceTasks.length)
      representedPlans.add(String(group.rows[0]!.planArtifactId));
  }
  const selectedGroups = [...grouped.entries()]
    .filter(([planId]) => !representedPlans.has(planId))
    .slice(0, limit);
  const plans = selectedGroups.map(([, group]) => {
    const first = group.rows[0]!;
    return {
      id: `plan:${first.planArtifactId}`,
      kind: "task" as const,
      title: first.planTitle || first.title,
      notes:
        group.rows.length > 1 ? `${group.rows.length} unscheduled` : undefined,
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
  });
  const cursorRow =
    selectedGroups.length >= limit
      ? selectedGroups.at(-1)?.[1].last
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
    metrics.compactQueries += 1;
    const page = await ctx.db
      .query("calendarItemReadModels")
      .withIndex("by_account_status_kind_updated_item", (q) => {
        const scoped = q
          .eq("ownerAccountId", accountId)
          .eq("status", "active")
          .eq("kind", kind);
        return keyset ? scoped.gte("updatedAt", keyset.updatedAt) : scoped;
      })
      .take(limit + 1);
    const candidates = page.filter((row) =>
      afterKeyset(row.updatedAt, String(row.itemId), keyset),
    );
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
      throw new Error("CALENDAR_RANGE_INVALID");
    const metrics = createCalendarReadMetrics();
    const limit = pageSize(args.limit);
    const visiblePage = await readVisibleCalendarItems(
      ctx,
      actor.accountId,
      args.from,
      args.to,
      limit,
      decodeCursor(args.cursor),
      metrics,
    );
    const unscheduledPage = await readUnscheduledTasks(
      ctx,
      actor.accountId,
      limit,
      args.unscheduledCursor,
      metrics,
    );
    const plannerPage = await readPlannerTasks(
      ctx,
      actor.accountId,
      limit,
      args.plannerCursor,
      metrics,
    );
    const partialPage = await readPartialTimeItems(
      ctx,
      actor.accountId,
      limit,
      decodeCursor(args.partialCursor),
      metrics,
    );
    const migrationKeyset = decodeKeysetCursor(args.migrationCursor);
    metrics.compactQueries += 1;
    const migrationRows = await ctx.db
      .query("calendarMigrationReadModels")
      .withIndex("by_account_artifact_status_updated_legacy", (q) => {
        const scoped = q
          .eq("ownerAccountId", actor.accountId)
          .eq("artifactStatus", "active");
        return migrationKeyset
          ? scoped.gte("updatedAt", migrationKeyset.updatedAt)
          : scoped;
      })
      .take(limit + 1);
    const migrationCandidates = migrationRows.filter((row) =>
      afterKeyset(row.updatedAt, String(row.legacyArtifactId), migrationKeyset),
    );
    const migrationPage = migrationCandidates.slice(0, limit);
    const migrationCursorRow =
      migrationPage.length >= limit
        ? migrationPage.at(-1)
        : migrationRows.length > limit
          ? migrationRows.at(-1)
          : undefined;
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
        .withIndex("by_account_status_title", (q) =>
          q
            .eq("ownerAccountId", actor.accountId)
            .eq("status", "active")
            .eq("title", targetTitle),
        )
        .take(limit + 1);
      const matches = titleRows
        .filter((row) => !titleKeyset || String(row.itemId) > titleKeyset.key)
        .slice(0, limit);
      for (const row of matches) {
        const wire = calendarReadModelWire(row);
        if (wire && !targetItems.some((item) => item.id === wire.id))
          targetItems.push(wire);
      }
      const titleCursorRow =
        matches.length >= limit
          ? matches.at(-1)
          : titleRows.length > limit
            ? titleRows.at(-1)
            : undefined;
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
  },
  handler: async (ctx, args) => {
    const actor = await actorOrThrow(ctx);
    if (
      args.startAt !== undefined &&
      args.endAt !== undefined &&
      args.endAt <= args.startAt
    )
      throw new Error("CALENDAR_TIME_INVALID: End must be after start.");
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
      createdBy: "human",
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
      throw new Error("CALENDAR_TASK_REQUIRED");
    const idempotencyKey = args.idempotencyKey?.trim().slice(0, 240);
    if (
      args.idempotencyKey !== undefined &&
      (!idempotencyKey || idempotencyKey.length < 8)
    )
      throw new Error("CALENDAR_IDEMPOTENCY_KEY_INVALID");
    let plannerArtifact: Doc<"spectraArtifacts"> | null = null;
    let plannerTask: { id: string; title: string } | undefined;
    if (args.planArtifactId && !args.taskItemId) {
      plannerArtifact = await ctx.db.get(args.planArtifactId);
      if (
        !plannerArtifact ||
        plannerArtifact.ownerAccountId !== actor.accountId ||
        plannerArtifact.blueprintKey !== "planner_task"
      )
        throw new Error("CALENDAR_PLAN_NOT_FOUND");
      const availableTasks = planTasks(plannerArtifact);
      plannerTask =
        availableTasks.find((candidate) => candidate.id === args.planTaskId) ??
        // A single-root planner has one canonical Calendar task even if the
        // editor/model surfaced a visual subtask id.
        (availableTasks.length === 1 ? availableTasks[0] : undefined);
      if (!plannerTask) throw new Error("CALENDAR_PLAN_TASK_NOT_FOUND");
    }
    const resolvedPlanTaskId = plannerTask?.id ?? args.planTaskId;
    const existingByKey = idempotencyKey
      ? await ctx.db
          .query("calendarItems")
          .withIndex("by_schedule_idempotency", (q) =>
            q
              .eq("ownerAccountId", actor.accountId)
              .eq("idempotencyKey", idempotencyKey),
          )
          .unique()
      : null;
    if (existingByKey) {
      const sameTask =
        String(existingByKey.taskItemId ?? "") ===
          String(args.taskItemId ?? "") &&
        String(existingByKey.planArtifactId ?? "") ===
          String(args.planArtifactId ?? "") &&
        String(existingByKey.planTaskId ?? "") ===
          String(resolvedPlanTaskId ?? "") &&
        existingByKey.startAt === args.startAt &&
        existingByKey.endAt === args.endAt &&
        existingByKey.timezone === args.timezone;
      if (!sameTask)
        throw new Error(
          "CALENDAR_IDEMPOTENCY_CONFLICT: This scheduling key was already used for another block.",
        );
      if (existingByKey.status !== "active")
        throw new Error(
          "CALENDAR_IDEMPOTENCY_REPLAY_REMOVED: This scheduled block is no longer active.",
        );
      return itemWire(existingByKey);
    }
    let title = "Scheduled work";
    let officialDeadlineItemId: Id<"calendarItems"> | undefined;
    if (args.taskItemId) {
      const task = await ctx.db.get(args.taskItemId);
      if (
        !task ||
        task.ownerAccountId !== actor.accountId ||
        task.kind !== "task"
      )
        throw new Error("CALENDAR_TASK_NOT_FOUND");
      title = task.title;
      officialDeadlineItemId = task.officialDeadlineItemId;
    } else if (args.planArtifactId) {
      const task = plannerTask;
      if (!task) throw new Error("CALENDAR_PLAN_TASK_NOT_FOUND");
      title = task.title;
    }
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
      taskItemId: args.taskItemId,
      planArtifactId: args.planArtifactId,
      planTaskId: resolvedPlanTaskId,
      officialDeadlineItemId,
      linkedArtifactIds: args.planArtifactId ? [args.planArtifactId] : [],
      idempotencyKey,
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
      throw new Error("CALENDAR_WORK_BLOCK_NOT_FOUND");
    if (item.revision !== args.expectedRevision)
      throw new Error(
        "CALENDAR_GESTURE_CONFLICT: Re-resolve the block before moving it.",
      );
    if (args.endAt <= args.startAt) throw new Error("CALENDAR_TIME_INVALID");
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
      throw new Error("CALENDAR_WORK_BLOCK_NOT_FOUND");
    if (item.revision !== args.expectedRevision)
      throw new Error(
        "CALENDAR_GESTURE_CONFLICT: Re-resolve the block before resizing it.",
      );
    if (item.startAt === undefined || args.endAt <= item.startAt)
      throw new Error("CALENDAR_TIME_INVALID");
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
      throw new Error("CALENDAR_WORK_BLOCK_NOT_FOUND");
    if (item.revision !== args.expectedRevision)
      throw new Error(
        "CALENDAR_GESTURE_CONFLICT: Re-resolve the block before completing it.",
      );
    if (item.status === "removed" || item.status === "cancelled")
      throw new Error("CALENDAR_WORK_BLOCK_UNAVAILABLE");
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
      throw new Error("CALENDAR_ITEM_NOT_FOUND");
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
      numItems: Math.min(100, Math.max(1, Math.floor(args.limit ?? 50))),
    });
    for (const item of page.page)
      await upsertCalendarItemReadModel(ctx, item, metrics);
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
