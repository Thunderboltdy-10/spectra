import { query } from "./_generated/server";
import { mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";
import { syncArtifactSummary } from "./orgTreeShared";

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
              ? { kind: "stale", updatedAt: item.sourceFreshAt ?? item.updatedAt }
              : item.sourceCapabilityState === "partial"
                ? { kind: "partial", details: "Exact source time is unavailable." }
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
  const content = object(artifact.content);
  if (Array.isArray(content.tasks))
    return content.tasks.flatMap((candidate, index) => {
      const task = object(candidate);
      if (task.status === "done") return [];
      return [
        {
          id: text(task.id, 180) || `task-${index + 1}`,
          title: text(task.title ?? task.taskTitle) || `Task ${index + 1}`,
          notes: text(task.description, 20_000) || undefined,
          dueAt:
            typeof task.dueAt === "number" && Number.isFinite(task.dueAt)
              ? task.dueAt
              : undefined,
        },
      ];
    });
  if (content.status === "done") return [];
  return [
    {
      id: "task-1",
      title: text(content.taskTitle) || artifact.title,
      notes: text(content.description, 20_000) || undefined,
      dueAt:
        typeof content.dueAt === "number" && Number.isFinite(content.dueAt)
          ? content.dueAt
          : undefined,
    },
  ];
}

export const overview = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    const actor = await actorOrThrow(ctx);
    const [items, plans, migrations, legacyArtifacts, integration, projections] = await Promise.all([
      ctx.db
        .query("calendarItems")
        .withIndex("by_account_status", (q) =>
          q.eq("ownerAccountId", actor.accountId).eq("status", "active"),
        )
        .collect(),
      ctx.db
        .query("spectraArtifacts")
        .withIndex("by_account_blueprint", (q) =>
          q.eq("ownerAccountId", actor.accountId).eq("blueprintKey", "planner_task"),
        )
        .collect(),
      Promise.all([
        ctx.db
          .query("calendarMigrations")
          .withIndex("by_account_status", (q) =>
            q.eq("ownerAccountId", actor.accountId).eq("status", "completed"),
          )
          .collect(),
        ctx.db
          .query("calendarMigrations")
          .withIndex("by_account_status", (q) =>
            q.eq("ownerAccountId", actor.accountId).eq("status", "partial"),
          )
          .collect(),
      ]).then(([completed, partial]) => [...completed, ...partial]),
      ctx.db
        .query("spectraArtifacts")
        .withIndex("by_account_blueprint", (q) =>
          q.eq("ownerAccountId", actor.accountId).eq("blueprintKey", "timetable"),
        )
        .collect(),
      ctx.db
        .query("schoolIntegrations")
        .withIndex("by_school_provider", (q) =>
          q.eq("schoolId", actor.schoolId).eq("provider", "managebac"),
        )
        .unique(),
      ctx.db
        .query("externalProjections")
        .withIndex("by_account_updated", (q) => q.eq("accountId", actor.accountId))
        .collect(),
    ]);
    const calendarSourceRecordIds = new Set(
      items.flatMap((item) =>
        item.kind === "task" && item.sourceRecordId
          ? [String(item.sourceRecordId)]
          : [],
      ),
    );
    const planArtifactsRepresentedByCalendar = new Set(
      projections.flatMap((projection) =>
        projection.projectionType === "planner_task" &&
        calendarSourceRecordIds.has(String(projection.recordId))
          ? [projection.projectionId]
          : [],
      ),
    );
    const scheduledPlanTasks = new Set(
      items.flatMap((item) =>
        item.kind === "scheduled_work_block" && item.planArtifactId && item.planTaskId
          ? [`${item.planArtifactId}:${item.planTaskId}`]
          : [],
      ),
    );
    const unscheduledPlans = plans
      .filter(
        (plan) =>
          plan.status === "active" &&
          !planArtifactsRepresentedByCalendar.has(String(plan._id)),
      )
      .flatMap((plan) => {
        const remaining = planTasks(plan).filter(
          (task) => !scheduledPlanTasks.has(`${plan._id}:${task.id}`),
        );
        if (!remaining.length) return [];
        return [
          {
            id: `plan:${plan._id}`,
            kind: "task" as const,
            title: text(plan.title) || remaining[0]!.title,
            notes:
              remaining.length > 1
                ? `${remaining.length} unscheduled`
                : undefined,
            allDay: false,
            timezone: "UTC",
            timePrecision: "unknown" as const,
            status: "active" as const,
            sourceLocked: false,
            planArtifactId: plan._id,
            planTaskId: remaining[0]!.id,
            linkedWorkIds: [plan._id],
            revision: 0,
            dueAt: remaining[0]!.dueAt,
          },
        ];
      });
    const visible = items.filter(
      (item) =>
        item.startAt === undefined ||
        (item.startAt <= args.to && (item.endAt ?? item.startAt) >= args.from),
    );
    const unscheduledStored = items.filter(
      (item) =>
        item.kind === "task" &&
        item.startAt === undefined &&
        !item.sourceProvider &&
        !item.planArtifactId,
    );
    const partialTimeItems = items.filter(
      (item) =>
        (item.kind === "official_event" || item.kind === "official_deadline") &&
        (item.timePrecision === "unknown" || item.startAt === undefined),
    );
    const timezone =
      items.find((item) => item.timezone && item.timezone !== "UTC")?.timezone ??
      "UTC";
    const lastUpdatedAt = items.reduce(
      (latest, item) => Math.max(latest, item.updatedAt),
      integration?.lastSyncAt ?? 0,
    );
    const stale =
      Boolean(integration) &&
      (!integration?.lastSyncAt ||
        Date.now() - integration.lastSyncAt > integration.freshnessSlaMinutes * 60_000);
    return {
      timezone,
      range: { from: args.from, to: args.to },
      items: visible.map(itemWire),
      unscheduledTasks: [
        ...unscheduledStored.map(itemWire),
        ...unscheduledPlans,
      ],
      partialTimeItems: partialTimeItems.map(itemWire),
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
        complete: legacyArtifacts.every((artifact) =>
          migrations.some((migration) => migration.legacyArtifactId === artifact._id),
        ),
        partial: migrations.some((migration) => migration.status === "partial"),
        migratedArtifacts: migrations.length,
        migratedEvents: migrations.reduce((sum, item) => sum + item.migratedCount, 0),
        skippedEvents: migrations.reduce((sum, item) => sum + item.skippedCount, 0),
      },
    };
  },
});

export const createPersonalItem = mutation({
  args: {
    kind: v.union(v.literal("personal_event"), v.literal("task"), v.literal("milestone"), v.literal("reminder")),
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
    if (args.startAt !== undefined && args.endAt !== undefined && args.endAt <= args.startAt)
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
    if (args.idempotencyKey !== undefined && (!idempotencyKey || idempotencyKey.length < 8))
      throw new Error("CALENDAR_IDEMPOTENCY_KEY_INVALID");
    const existingByKey = idempotencyKey
      ? await ctx.db
          .query("calendarItems")
          .withIndex("by_schedule_idempotency", (q) =>
            q.eq("ownerAccountId", actor.accountId).eq("idempotencyKey", idempotencyKey),
          )
          .unique()
      : null;
    if (existingByKey) {
      const sameTask =
        String(existingByKey.taskItemId ?? "") === String(args.taskItemId ?? "") &&
        String(existingByKey.planArtifactId ?? "") === String(args.planArtifactId ?? "") &&
        String(existingByKey.planTaskId ?? "") === String(args.planTaskId ?? "") &&
        existingByKey.startAt === args.startAt &&
        existingByKey.endAt === args.endAt &&
        existingByKey.timezone === args.timezone;
      if (!sameTask)
        throw new Error("CALENDAR_IDEMPOTENCY_CONFLICT: This scheduling key was already used for another block.");
      if (existingByKey.status !== "active")
        throw new Error("CALENDAR_IDEMPOTENCY_REPLAY_REMOVED: This scheduled block is no longer active.");
      return itemWire(existingByKey);
    }
    let title = "Scheduled work";
    let officialDeadlineItemId: Id<"calendarItems"> | undefined;
    if (args.taskItemId) {
      const task = await ctx.db.get(args.taskItemId);
      if (!task || task.ownerAccountId !== actor.accountId || task.kind !== "task")
        throw new Error("CALENDAR_TASK_NOT_FOUND");
      title = task.title;
      officialDeadlineItemId = task.officialDeadlineItemId;
    } else if (args.planArtifactId) {
      const plan = await ctx.db.get(args.planArtifactId);
      if (!plan || plan.ownerAccountId !== actor.accountId || plan.blueprintKey !== "planner_task")
        throw new Error("CALENDAR_PLAN_NOT_FOUND");
      const task = planTasks(plan).find((candidate) => candidate.id === args.planTaskId);
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
      planTaskId: args.planTaskId,
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
    if (!item || item.ownerAccountId !== actor.accountId || item.kind !== "scheduled_work_block")
      throw new Error("CALENDAR_WORK_BLOCK_NOT_FOUND");
    if (item.revision !== args.expectedRevision)
      throw new Error("CALENDAR_GESTURE_CONFLICT: Re-resolve the block before moving it.");
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
    if (!item || item.ownerAccountId !== actor.accountId || item.kind !== "scheduled_work_block")
      throw new Error("CALENDAR_WORK_BLOCK_NOT_FOUND");
    if (item.revision !== args.expectedRevision)
      throw new Error("CALENDAR_GESTURE_CONFLICT: Re-resolve the block before resizing it.");
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
      throw new Error("CALENDAR_SOURCE_LOCKED: Official source records cannot be removed here.");
    await ctx.db.patch(item._id, {
      status: "removed",
      revision: item.revision + 1,
      updatedAt: Date.now(),
    });
    return { itemId: item._id };
  },
});

export const ensureLegacyMigration = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await actorOrThrow(ctx);
    const legacy = await ctx.db
      .query("spectraArtifacts")
      .withIndex("by_account_blueprint", (q) =>
        q.eq("ownerAccountId", actor.accountId).eq("blueprintKey", "timetable"),
      )
      .collect();
    let migratedArtifacts = 0;
    let migratedEvents = 0;
    let skippedEvents = 0;
    for (const artifact of legacy) {
      const prior = await ctx.db
        .query("calendarMigrations")
        .withIndex("by_legacy_artifact", (q) => q.eq("legacyArtifactId", artifact._id))
        .unique();
      if (
        prior &&
        prior.version >= 1 &&
        (prior.status === "completed" || prior.status === "partial")
      )
        continue;
      const startedAt = Date.now();
      const migrationId = prior?._id ?? (await ctx.db.insert("calendarMigrations", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        legacyArtifactId: artifact._id,
        version: 1,
        status: "running",
        migratedCount: 0,
        skippedCount: 0,
        startedAt,
        updatedAt: startedAt,
      }));
      const content = object(artifact.content);
      const events = Array.isArray(content.events) ? content.events : [];
      let migrated = 0;
      let skipped = 0;
      for (let index = 0; index < events.length; index += 1) {
        const event = object(events[index]);
        const legacyEventId = text(event.id, 180) || `event-${index + 1}`;
        const existing = await ctx.db
          .query("calendarItems")
          .withIndex("by_legacy_event", (q) =>
            q.eq("legacyArtifactId", artifact._id).eq("legacyEventId", legacyEventId),
          )
          .unique();
        if (existing) continue;
        const startAt = typeof event.start === "string" ? Date.parse(event.start) : Number(event.start);
        const endAt = typeof event.end === "string" ? Date.parse(event.end) : Number(event.end);
        if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
          skipped += 1;
          continue;
        }
        const locked = event.locked === true || typeof event.sourceRef === "string";
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
          timezone: text(event.timezone, 100) || text(content.timezone, 100) || "UTC",
          timePrecision: "exact",
          status: event.status === "cancelled" ? "cancelled" : "active",
          sourceLocked: locked,
          sourceProvider: locked ? "legacy_timetable" : undefined,
          sourceKey: locked ? `legacy:${artifact._id}:${legacyEventId}` : undefined,
          sourceUrl: typeof event.sourceRef === "string" ? event.sourceRef : undefined,
          sourceCapabilityState: locked ? "available" : undefined,
          location: text(event.location, 300) || undefined,
          taskItemId: undefined,
          linkedArtifactIds: Array.isArray(event.artifactIds)
            ? event.artifactIds.flatMap((id) => {
                const normalized = ctx.db.normalizeId("spectraArtifacts", String(id));
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
      await ctx.db.patch(migrationId, {
        status: skipped ? "partial" : "completed",
        migratedCount: migrated,
        skippedCount: skipped,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      const tags = new Set(artifact.tags ?? []);
      tags.add("calendar-migrated");
      await ctx.db.patch(artifact._id, { tags: [...tags], updatedAt: Date.now() });
      await syncArtifactSummary(ctx, artifact._id);
      migratedArtifacts += 1;
      migratedEvents += migrated;
      skippedEvents += skipped;
    }
    return { migratedArtifacts, migratedEvents, skippedEvents };
  },
});
