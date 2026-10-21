/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  CALENDAR_RANGE_BUCKET_LIMIT,
  createCalendarReadMetrics,
  upsertCalendarItemReadModel,
} from "./calendarReadModels";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 60 * 60 * 1_000;
const identity = {
  subject: "calendar-bounded-test",
  email: "calendar-bounded@example.test",
  emailVerified: true,
};

function setupTest() {
  return convexTest(schema, modules);
}

async function seedCalendar(t: ReturnType<typeof setupTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Bounded Calendar School",
      slug: `bounded-calendar-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: "Bounded Calendar",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const insertItem = (item: {
      kind: "official_event" | "official_deadline" | "task" | "personal_event";
      title: string;
      startAt?: number;
      endAt?: number;
      timePrecision: "exact" | "date_only" | "unknown";
      notes?: string;
      sourceProvider?: string;
    }) =>
      ctx.db.insert("calendarItems", {
        ownerAccountId: accountId,
        schoolId,
        kind: item.kind,
        title: item.title,
        notes: item.notes,
        startAt: item.startAt,
        endAt: item.endAt,
        allDay: item.startAt === undefined,
        timezone: "Europe/Madrid",
        timePrecision: item.timePrecision,
        status: "active",
        sourceLocked: Boolean(item.sourceProvider),
        sourceProvider: item.sourceProvider,
        sourceCapabilityState: item.sourceProvider ? "partial" : undefined,
        linkedArtifactIds: [],
        revision: 1,
        createdBy: item.sourceProvider ? "source" : "human",
        createdAt: now,
        updatedAt: now,
      });
    const visibleId = await insertItem({
      kind: "personal_event",
      title: "Visible overlap",
      startAt: 10 * DAY - DAY / 2,
      endAt: 10 * DAY + DAY / 2,
      timePrecision: "exact",
      notes: "small metadata",
    });
    for (let index = 0; index < 4; index += 1) {
      await insertItem({
        kind: "personal_event",
        title: `Visible page ${index}`,
        startAt: 10 * DAY + index * 60 * 60 * 1_000,
        endAt: 10 * DAY + index * 60 * 60 * 1_000 + 30 * 60 * 1_000,
        timePrecision: "exact",
      });
    }
    const outsideId = await insertItem({
      kind: "personal_event",
      title: "Named off-range block",
      startAt: 30 * DAY,
      endAt: 30 * DAY + DAY / 2,
      timePrecision: "exact",
      notes: `${"x".repeat(20_000)} CANONICAL_PAYLOAD`,
    });
    const partialId = await insertItem({
      kind: "official_event",
      title: "Provider period not exact",
      timePrecision: "unknown",
      sourceProvider: "managebac",
    });
    const unscheduledId = await insertItem({
      kind: "task",
      title: "Unscheduled local task",
      timePrecision: "unknown",
    });
    for (let index = 0; index < 80; index += 1) {
      await insertItem({
        kind: "personal_event",
        title: `Off-range history ${index}`,
        startAt: 100 * DAY + index * DAY,
        endAt: 100 * DAY + index * DAY + 60 * 60 * 1_000,
        timePrecision: "exact",
      });
    }
    const plannerArtifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accountId,
      schoolId,
      blueprintKey: "planner_task",
      schemaVersion: 1,
      title: "Planner metadata",
      content: {
        tasks: [
          {
            id: "planner-unscheduled",
            title: "Planner unscheduled task",
            description: `${"y".repeat(20_000)} PLANNER_CANONICAL`,
            status: "todo",
          },
        ],
      },
      textIndex: "Planner metadata Planner unscheduled task",
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return {
      accountId,
      schoolId,
      visibleId,
      outsideId,
      partialId,
      unscheduledId,
      plannerArtifactId,
    };
  });
}

async function backfillItems(t: ReturnType<typeof setupTest>) {
  let cursor: string | null = null;
  let pages = 0;
  let writes = 0;
  do {
    const page: {
      cursor: string | null;
      done: boolean;
      processed: number;
      readMetrics: { writes: number };
    } = await t.mutation(internal.calendar.backfillItemReadModels, {
      cursor,
      limit: 25,
    });
    cursor = page.cursor;
    expect(page.processed).toBeLessThanOrEqual(10);
    writes += page.readMetrics.writes;
    pages += 1;
    expect(pages).toBeLessThan(20);
    if (page.done) break;
  } while (cursor !== null);
  return writes;
}

async function backfillArtifacts(t: ReturnType<typeof setupTest>) {
  await t.mutation(internal.calendar.backfillArtifactReadModels, {
    cursor: null,
    limit: 25,
  });
}

describe("bounded Calendar discovery", () => {
  it("uses compact range rows and finds exact named items outside the visible week", async () => {
    const t = setupTest();
    const seeded = await seedCalendar(t);
    const initialWrites = await backfillItems(t);
    await backfillArtifacts(t);
    const result = await t.withIdentity(identity).query(api.calendar.overview, {
      from: 10 * DAY,
      to: 11 * DAY,
      targetItemId: seeded.outsideId,
      targetTitle: "Named off-range block",
      limit: 4,
      debug: true,
    });
    const payload = JSON.stringify(result);
    expect(result.items.map((item) => item.title)).toContain("Visible overlap");
    expect(result.items.map((item) => item.title)).not.toContain(
      "Named off-range block",
    );
    expect(result.targetedItems.map((item) => item.title)).toEqual([
      "Named off-range block",
    ]);
    expect(result.unscheduledTasks.map((item) => item.title)).toContain(
      "Unscheduled local task",
    );
    expect(result.unscheduledTasks.map((item) => item.title)).toContain(
      "Planner metadata",
    );
    expect(result.partialTimeItems.map((item) => item.title)).toContain(
      "Provider period not exact",
    );
    expect(payload).not.toContain("CANONICAL_PAYLOAD");
    expect(payload).not.toContain("PLANNER_CANONICAL");
    const metrics = result.readMetrics!;
    expect(metrics.canonicalQueries).toBe(0);
    expect(metrics.canonicalGets).toBe(0);
    expect(metrics.rangeRowsRead).toBeLessThan(12);
    expect(payload.length).toBeLessThan(8_000);
    expect(result.pagination.visible).toEqual(expect.any(String));
    const continuation = await t
      .withIdentity(identity)
      .query(api.calendar.overview, {
        from: 10 * DAY,
        to: 11 * DAY,
        cursor: result.pagination.visible!,
        limit: 4,
      });
    expect(continuation.items.map((item) => item.title)).toContain(
      "Visible page 3",
    );
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let index = 0; index < 80; index += 1) {
        await ctx.db.insert("calendarItems", {
          ownerAccountId: seeded.accountId,
          schoolId: seeded.schoolId,
          kind: "personal_event",
          title: `More off-range history ${index}`,
          startAt: 300 * DAY + index * DAY,
          endAt: 300 * DAY + index * DAY + 60 * 60 * 1_000,
          allDay: false,
          timezone: "Europe/Madrid",
          timePrecision: "exact",
          status: "active",
          sourceLocked: false,
          linkedArtifactIds: [],
          revision: 1,
          createdBy: "human",
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const additionalWrites = await backfillItems(t);
    const expanded = await t
      .withIdentity(identity)
      .query(api.calendar.overview, {
        from: 10 * DAY,
        to: 11 * DAY,
        targetItemId: seeded.outsideId,
        targetTitle: "Named off-range block",
        limit: 4,
        debug: true,
      });
    const expandedMetrics = expanded.readMetrics!;
    expect(initialWrites).toBeGreaterThan(0);
    expect(additionalWrites).toBeGreaterThan(0);
    expect(expandedMetrics.compactQueries).toBe(metrics.compactQueries);
    expect(expandedMetrics.rangeRowsRead).toBe(metrics.rangeRowsRead);
  });

  it("maintains compact state through schedule, move, resize, complete, and remove", async () => {
    const t = setupTest();
    const seeded = await seedCalendar(t);
    const user = t.withIdentity(identity);
    const created = await user.mutation(api.calendar.createPersonalItem, {
      kind: "task",
      title: "Writer-maintained task",
      timezone: "Europe/Madrid",
    });
    const block = await user.mutation(api.calendar.scheduleTask, {
      taskItemId: created.id,
      startAt: 2 * DAY,
      endAt: 2 * DAY + 2 * 60 * 60 * 1_000,
      timezone: "Europe/Madrid",
      idempotencyKey: "bounded-writer-01",
    });
    let model = await t.run(async (ctx) =>
      ctx.db
        .query("calendarItemReadModels")
        .withIndex("by_item", (q) => q.eq("itemId", block.id))
        .unique(),
    );
    expect(model?.startAt).toBe(2 * DAY);
    const moved = await user.mutation(api.calendar.moveWorkBlock, {
      itemId: block.id,
      startAt: 3 * DAY,
      endAt: 3 * DAY + 2 * 60 * 60 * 1_000,
      expectedRevision: block.revision,
    });
    const resized = await user.mutation(api.calendar.resizeWorkBlock, {
      itemId: block.id,
      endAt: 3 * DAY + 3 * 60 * 60 * 1_000,
      expectedRevision: moved.revision,
    });
    const completed = await user.mutation(api.calendar.completeWorkBlock, {
      itemId: block.id,
      expectedRevision: resized.revision,
    });
    expect(completed.status).toBe("completed");
    const reopened = await user.mutation(api.calendar.completeWorkBlock, {
      itemId: block.id,
      expectedRevision: completed.revision,
      done: false,
    });
    expect(reopened.status).toBe("active");
    await user.mutation(api.calendar.completeWorkBlock, {
      itemId: block.id,
      expectedRevision: reopened.revision,
    });
    const personal = await user.mutation(api.calendar.createPersonalItem, {
      kind: "personal_event",
      title: "Remove me",
      timezone: "Europe/Madrid",
      startAt: 4 * DAY,
      endAt: 4 * DAY + 60 * 60 * 1_000,
    });
    await user.mutation(api.calendar.removePersonalItem, {
      itemId: personal.id,
    });
    model = await t.run(async (ctx) =>
      ctx.db
        .query("calendarItemReadModels")
        .withIndex("by_item", (q) => q.eq("itemId", block.id))
        .unique(),
    );
    const removedBuckets = await t.run(async (ctx) =>
      ctx.db
        .query("calendarItemRangeBuckets")
        .withIndex("by_item_bucket", (q) => q.eq("itemId", personal.id))
        .collect(),
    );
    expect(model?.status).toBe("completed");
    expect(model?.startAt).toBe(3 * DAY);
    expect(model?.endAt).toBe(3 * DAY + 3 * 60 * 60 * 1_000);
    expect(removedBuckets).toHaveLength(0);
    expect(seeded.visibleId).toBeDefined();
  });

  it("processes a legacy timetable in finite resumable pages", async () => {
    const t = setupTest();
    const seeded = await seedCalendar(t);
    const timetableId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("spectraArtifacts", {
        ownerAccountId: seeded.accountId,
        schoolId: seeded.schoolId,
        blueprintKey: "timetable",
        schemaVersion: 1,
        title: "Legacy timetable",
        content: {
          events: Array.from({ length: 105 }, (_, index) => ({
            id: `legacy-${index}`,
            title: `Legacy event ${index}`,
            start: 20 * DAY + index * 60 * 60 * 1_000,
            end: 20 * DAY + index * 60 * 60 * 1_000 + 30 * 60 * 1_000,
            locked: true,
          })),
        },
        textIndex: "Legacy timetable",
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    const user = t.withIdentity(identity);
    const first = await user.mutation(api.calendar.ensureLegacyMigration, {
      limit: 1,
    });
    expect(first.done).toBe(false);
    const second = await user.mutation(api.calendar.ensureLegacyMigration, {
      limit: 1,
    });
    expect(second.done).toBe(true);
    const state = await t.run(async (ctx) => ({
      migration: await ctx.db
        .query("calendarMigrations")
        .withIndex("by_legacy_artifact", (q) =>
          q.eq("legacyArtifactId", timetableId),
        )
        .unique(),
      readModel: await ctx.db
        .query("calendarMigrationReadModels")
        .withIndex("by_legacy_artifact", (q) =>
          q.eq("legacyArtifactId", timetableId),
        )
        .unique(),
    }));
    expect(state.migration?.eventOffset).toBe(105);
    expect(state.readModel?.migrationStatus).toBe("completed");
    expect(state.readModel?.eventOffset).toBe(105);
  });

  it("does not rewrite dependent run projections for heartbeat-only changes", async () => {
    const t = setupTest();
    const seeded = await seedCalendar(t);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const threadId = await ctx.db.insert("spectraThreads", {
        ownerAccountId: seeded.accountId,
        schoolId: seeded.schoolId,
        title: "Heartbeat fixture",
        origin: "chat",
        status: "active",
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("spectraAiRuns", {
        ownerAccountId: seeded.accountId,
        schoolId: seeded.schoolId,
        sourceSurface: "chat",
        status: "running",
        phase: "reading",
        userPrompt: "Heartbeat fixture",
        threadId,
        executionId: "heartbeat-execution",
        workerId: "heartbeat-worker",
        createdAt: now,
        updatedAt: now,
      });
      const tabId = await ctx.db.insert("spectraRunTabs", {
        ownerAccountId: seeded.accountId,
        schoolId: seeded.schoolId,
        runId,
        threadId,
        surface: "chat",
        createdAt: now,
        updatedAt: now,
      });
      const cardId = await ctx.db.insert("spectraResultCards", {
        runId,
        ownerAccountId: seeded.accountId,
        schoolId: seeded.schoolId,
        surface: "chat",
        status: "running",
        variant: "status",
        title: "Heartbeat fixture",
        actions: [],
        createdAt: now,
        updatedAt: now,
      });
      const summaryId = await ctx.db.insert("spectraResultCardSummaries", {
        readModelVersion: 1,
        cardId,
        runId,
        ownerAccountId: seeded.accountId,
        schoolId: seeded.schoolId,
        surface: "chat",
        status: "running",
        variant: "status",
        title: "Heartbeat fixture",
        actions: [],
        createdAt: now,
        updatedAt: now,
      });
      return { runId, tabId, summaryId };
    });
    const alive = await t
      .withIdentity(identity)
      .mutation(api.spectraRuns.heartbeat, {
        runId: ids.runId,
        executionId: "heartbeat-execution",
        workerId: "heartbeat-worker",
      });
    const projections = await t.run(async (ctx) => ({
      tab: await ctx.db.get(ids.tabId),
      summary: await ctx.db.get(ids.summaryId),
    }));
    expect(alive.alive).toBe(true);
    expect(projections.tab?.projectionVersion).toBeUndefined();
    expect(projections.tab?.runSummary).toBeUndefined();
    expect(projections.summary?.runSummary).toBeUndefined();
  });
});

describe("Calendar bucket write fanout", () => {
  it("updates long-item metadata without reading buckets and explicitly repairs a missing bucket", async () => {
    const t = setupTest();
    const seeded = await seedCalendar(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.outsideId, { endAt: 600 * DAY });
      const item = (await ctx.db.get(seeded.outsideId))!;
      await upsertCalendarItemReadModel(ctx, item);
      const buckets = await ctx.db.query("calendarItemRangeBuckets")
        .withIndex("by_item_bucket", q => q.eq("itemId", item._id)).collect();
      expect(buckets).toHaveLength(CALENDAR_RANGE_BUCKET_LIMIT);
      const initialIds = buckets.map(row => row._id);

      await ctx.db.patch(item._id, { title: "Renamed long event", notes: "Updated note", updatedAt: item.updatedAt + 1 });
      const updated = (await ctx.db.get(item._id))!;
      const metrics = createCalendarReadMetrics();
      const queries = vi.spyOn(ctx.db, "query");
      await upsertCalendarItemReadModel(ctx, updated, metrics);
      expect(queries.mock.calls.map(([table]) => table)).toEqual(["calendarItemReadModels"]);
      queries.mockRestore();
      expect(metrics).toMatchObject({ compactQueries: 1, writes: 1, deletes: 0 });
      const model = await ctx.db.query("calendarItemReadModels")
        .withIndex("by_item", q => q.eq("itemId", item._id)).unique();
      expect(model).toMatchObject({ title: "Renamed long event", notes: "Updated note" });
      expect((await ctx.db.query("calendarItemRangeBuckets")
        .withIndex("by_item_bucket", q => q.eq("itemId", item._id)).collect()).map(row => row._id)).toEqual(initialIds);

      await ctx.db.delete(buckets[0]!._id);
      const repair = createCalendarReadMetrics();
      await upsertCalendarItemReadModel(ctx, updated, repair, { repairRangeBuckets: true });
      expect(repair).toMatchObject({ compactQueries: 2, writes: 1, deletes: 0 });
      expect(await ctx.db.query("calendarItemRangeBuckets")
        .withIndex("by_item_bucket", q => q.eq("itemId", item._id)).collect()).toHaveLength(CALENDAR_RANGE_BUCKET_LIMIT);
    });
  });

  it("repairs bucket ownership and membership when ownership, dates or status change", async () => {
    const t = setupTest();
    const seeded = await seedCalendar(t);
    await t.run(async (ctx) => {
      const item = (await ctx.db.get(seeded.outsideId))!;
      await upsertCalendarItemReadModel(ctx, item);
      const otherAccount = await ctx.db.insert("accounts", {
        clerkId: "calendar-new-owner", email: "calendar-new-owner@example.test",
        name: "New owner", emailVerified: true, status: "active",
        createdAt: item.createdAt, updatedAt: item.updatedAt,
      });
      for (const patch of [
        { ownerAccountId: otherAccount },
        { startAt: 40 * DAY, endAt: 41 * DAY },
        { status: "removed" as const },
        { status: "active" as const },
      ]) {
        await ctx.db.patch(item._id, patch);
        const next = (await ctx.db.get(item._id))!;
        await upsertCalendarItemReadModel(ctx, next);
        const buckets = await ctx.db.query("calendarItemRangeBuckets")
          .withIndex("by_item_bucket", q => q.eq("itemId", item._id)).collect();
        if (next.status === "removed") expect(buckets).toHaveLength(0);
        else {
          expect(buckets.length).toBeGreaterThan(0);
          for (const bucket of buckets) expect(bucket).toMatchObject({
            ownerAccountId: otherAccount, startAt: next.startAt, endAt: next.endAt, status: next.status,
          });
        }
      }
    });
  });

  it("caps repair pages for worst-case day-bucket fanout and keeps an advancing continuation", async () => {
    const t = setupTest();
    await seedCalendar(t);
    const first = await t.mutation(internal.calendar.backfillItemReadModels, { cursor: null, limit: 100 });
    expect(first.processed).toBe(10);
    expect(first.done).toBe(false);
    expect(first.cursor).toEqual(expect.any(String));
    const next = await t.mutation(internal.calendar.backfillItemReadModels, { cursor: first.cursor, limit: 100 });
    expect(next.processed).toBe(10);
    expect(next.cursor).not.toBe(first.cursor);
  });
});
