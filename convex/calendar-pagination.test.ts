/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  upsertCalendarItemReadModel,
  syncPlannerTaskReadModels,
} from "./calendarReadModels";
import { fetchCalendarOverview, mergeCalendarPages } from "../src/features/spectra/calendar/data/overview-client";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86400000;
const identity = {
  subject: "review-school-pagination",
  email: "review@example.test",
  emailVerified: true,
};
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = 100000;
    const schoolId = await ctx.db.insert("schools", {
      name: "Review",
      slug: "review-pagination",
      verifiedDomains: [],
      status: "active",
      timezone: "UTC",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: "Review",
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
    return { schoolId, accountId };
  });
  async function items(
    count: number,
    kind: "task" | "official_event" | "personal_event",
    startAt?: number,
    endAt?: number,
    title?: string,
  ) {
    return t.run(async (ctx) => {
      const inserted = [];
      for (let i = 0; i < count; i++) {
        const id = await ctx.db.insert("calendarItems", {
          ownerAccountId: ids.accountId,
          schoolId: ids.schoolId,
          kind,
          title: title ?? `${kind}-${i}`,
          startAt,
          endAt,
          allDay: startAt === undefined,
          timezone: "UTC",
          timePrecision: startAt === undefined ? "unknown" : "exact",
          status: "active",
          sourceLocked: false,
          linkedArtifactIds: [],
          revision: 1,
          createdBy: "human",
          createdAt: 100000,
          updatedAt: 100000,
        });
        await upsertCalendarItemReadModel(ctx, (await ctx.db.get(id))!);
        inserted.push(id);
      }
      return inserted;
    });
  }
  return { t, ids, user: t.withIdentity(identity), items };
}

describe("Calendar pagination source boundaries", () => {
  it("drives actual overview pages through the bounded client loader", async () => {
    const { user, items } = await fixture();
    await items(5, "personal_event", DAY, 500 * DAY);
    await items(6, "task");
    const fetcher = vi.fn(async (url: string) => {
      const params = new URL(url, "https://example.test").searchParams;
      const args: Record<string, string | number> = {};
      for (const [key, value] of params) args[key] = key === "from" || key === "to" ? Number(value) : value;
      const data = await user.query(api.calendar.overview, args as { from: number; to: number });
      return new Response(JSON.stringify({ data }));
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const first = await fetchCalendarOverview(450 * DAY, 451 * DAY, { maxPages: 2 });
      expect(first.continuation).not.toBeNull();
      const last = await fetchCalendarOverview(450 * DAY, 451 * DAY, { maxPages: 2, continuation: first.continuation! });
      expect(last.continuation).toBeNull();
      const complete = mergeCalendarPages(first.overview, last.overview);
      expect(complete.items).toHaveLength(11);
      expect(complete.unscheduledTasks).toHaveLength(6);
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("crosses planner task, planner identity, and migration timestamp ties", async () => {
    const { t, ids, user } = await fixture();
    await t.run(async (ctx) => {
      for (let i = 0; i < 7; i++) {
        const planId = await ctx.db.insert("spectraArtifacts", {
          ownerAccountId: ids.accountId,
          schoolId: ids.schoolId,
          blueprintKey: "planner_task",
          schemaVersion: 1,
          title: `Plan ${i}`,
          content: {
            tasks: Array.from({ length: i === 0 ? 35 : 1 }, (_, j) => ({
              id: `task:${String(j).padStart(3, "0")}`,
              title: `Task ${j}`,
              status: "todo",
            })),
          },
          textIndex: "",
          tags: [],
          status: "active",
          createdAt: 100000,
          updatedAt: 100000,
        });
        await syncPlannerTaskReadModels(ctx, (await ctx.db.get(planId))!);
        await ctx.db.insert("calendarMigrationReadModels", {
          readModelVersion: 1,
          legacyArtifactId: planId,
          ownerAccountId: ids.accountId,
          schoolId: ids.schoolId,
          artifactStatus: "active",
          migrationStatus: "completed",
          migratedCount: 1,
          skippedCount: 0,
          updatedAt: 100000,
        });
      }
    });
    let plannerCursor: string | undefined;
    let migrationCursor: string | undefined;
    let plannerDone = false;
    let migrationDone = false;
    const plans = new Set<string>();
    let migrations = 0;
    for (let i = 0; i < 12; i++) {
      const p = await user.query(api.calendar.overview, {
        from: DAY,
        to: 2 * DAY,
        limit: 2,
        plannerCursor,
        migrationCursor,
        debug: true,
      });
      if (!plannerDone)
        for (const plan of p.unscheduledTasks) plans.add(plan.id);
      if (!migrationDone) migrations += p.migration.migratedArtifacts;
      plannerCursor = p.pagination.planner ?? undefined;
      migrationCursor = p.pagination.migration ?? undefined;
      plannerDone ||= !plannerCursor;
      migrationDone ||= !migrationCursor;
      expect(p.readMetrics!.canonicalQueries).toBe(0);
      if (plannerDone && migrationDone) break;
    }
    expect(plans.size).toBe(7);
    expect(migrations).toBe(7);
    expect(plannerDone && migrationDone).toBe(true);
  });

  it("finishes unscheduled discovery within one timestamp", async () => {
    const { user, items } = await fixture();
    await items(5, "task");
    const pages = [];
    let cursor: string | undefined;
    for (let i = 0; i < 4; i++) {
      const p = await user.query(api.calendar.overview, {
        from: DAY,
        to: 2 * DAY,
        limit: 2,
        unscheduledCursor: cursor,
      });
      pages.push({
        titles: p.unscheduledTasks.map((x) => x.title),
        cursor: p.pagination.unscheduled,
      });
      cursor = p.pagination.unscheduled ?? undefined;
      if (!cursor) break;
    }
    expect(new Set(pages.flatMap((p) => p.titles)).size).toBe(5);
    expect(pages.at(-1)?.cursor).toBeNull();
  });

  it("continues partial-time discovery after a timestamp tie", async () => {
    const { user, items } = await fixture();
    await items(5, "official_event");
    const p1 = await user.query(api.calendar.overview, {
      from: DAY,
      to: 2 * DAY,
      limit: 2,
    });
    const p2 = await user.query(api.calendar.overview, {
      from: DAY,
      to: 2 * DAY,
      limit: 2,
      partialCursor: p1.pagination.partial!,
    });
    const p3 = await user.query(api.calendar.overview, {
      from: DAY,
      to: 2 * DAY,
      limit: 2,
      partialCursor: p2.pagination.partial!,
    });
    expect([
      ...p1.partialTimeItems,
      ...p2.partialTimeItems,
      ...p3.partialTimeItems,
    ]).toHaveLength(5);
    expect(p3.pagination.partial).toBeNull();
  });

  it("pages every wide event and undated event without duplicating range overlaps", async () => {
    const { user, items } = await fixture();
    await items(3, "personal_event", DAY, 500 * DAY);
    await items(3, "personal_event");
    await items(1, "personal_event", 449 * DAY, 452 * DAY);
    let cursor: string | undefined;
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const p = await user.query(api.calendar.overview, {
        from: 450 * DAY,
        to: 451 * DAY,
        limit: 2,
        cursor,
        debug: true,
      });
      ids.push(...p.items.map((x) => String(x.id)));
      expect(p.readMetrics!.rangeRowsRead).toBeLessThanOrEqual(2);
      cursor = p.pagination.visible ?? undefined;
      if (!cursor) break;
    }
    expect(cursor).toBeUndefined();
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
  });

  it("finishes exact-title discovery using indexed identity order", async () => {
    const { user, items } = await fixture();
    await items(
      5,
      "personal_event",
      100 * DAY,
      100 * DAY + 1000,
      "Repeated title",
    );
    const pages = [];
    let cursor: string | undefined;
    for (let i = 0; i < 4; i++) {
      const p = await user.query(api.calendar.overview, {
        from: DAY,
        to: 2 * DAY,
        limit: 2,
        targetTitle: "Repeated title",
        targetCursor: cursor,
      });
      pages.push({
        ids: p.targetedItems.map((x) => x.id),
        cursor: p.pagination.targetTitle,
      });
      cursor = p.pagination.targetTitle ?? undefined;
      if (!cursor) break;
    }
    expect(new Set(pages.flatMap((p) => p.ids)).size).toBe(5);
    expect(pages.at(-1)?.cursor).toBeNull();
  });
});
