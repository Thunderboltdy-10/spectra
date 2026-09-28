/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { advanceSchoolPurge, PURGE_SCHOOL_INDEXES, PURGE_SCHOOL_TABLES } from "./administration";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const advanceHandler = Reflect.get(advanceSchoolPurge, "_handler") as (
  ctx: MutationCtx,
  args: { jobId: Id<"schoolLifecycleJobs"> },
) => Promise<boolean>;

afterEach(() => vi.useRealTimers());

it("names a school index for every purge table that has one", () => {
  const tables = (schema as unknown as { tables: Record<string, { export(): { indexes: { indexDescriptor: string; fields: string[] }[] } }> }).tables;
  for (const table of PURGE_SCHOOL_TABLES) {
    const schoolIndexes = tables[table]!.export().indexes
      .filter(index => index.fields[0] === "schoolId").map(index => index.indexDescriptor);
    const named = PURGE_SCHOOL_INDEXES[table];
    if (schoolIndexes.length === 0) expect(named, table).toBeUndefined();
    else expect(schoolIndexes, table).toContain(named);
  }
});

/** A suspended school awaiting purge beside a larger tenant that must stay. */
async function purgeFixture(options: { queued: boolean }) {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"])
    aggregateTest.register(t, name);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const accountId = await ctx.db.insert("accounts", {
      clerkId: "purge-owner", email: "owner@purge.test", emailVerified: true,
      name: "Owner", status: "active", createdAt: now, updatedAt: now,
    });
    const school = (slug: string, status: "active" | "suspended") => ctx.db.insert("schools", {
      name: slug, slug, verifiedDomains: [], status, timezone: "Europe/Madrid",
      policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const seed = async (schoolId: Id<"schools">, rows: number) => {
      const threadId = await ctx.db.insert("spectraThreads", {
        ownerAccountId: accountId, schoolId, title: "Chat", origin: "chat", status: "active", createdAt: now, updatedAt: now,
      });
      for (let index = 0; index < rows; index += 1) {
        await ctx.db.insert("spectraMessages", { threadId, schoolId, role: "user", content: `Question ${index}`, createdAt: now });
        // calendarItems has no school index, so the purge walks it.
        await ctx.db.insert("calendarItems", {
          ownerAccountId: accountId, schoolId, kind: "personal_event", title: `Event ${index}`,
          allDay: true, timezone: "Europe/Madrid", timePrecision: "date_only", status: "active",
          sourceLocked: false, linkedArtifactIds: [], revision: 1, createdBy: "human", createdAt: now, updatedAt: now,
        });
      }
    };
    const target = await school("purged-school", "suspended");
    const kept = await school("kept-school", "active");
    await seed(target, 30);
    await seed(kept, 450);
    const exportJobId = await ctx.db.insert("schoolLifecycleJobs", {
      schoolId: target, type: "export", status: "completed", requestedByAccountId: accountId, approvedByAccountIds: [],
      reason: "export", impact: { activeMembers: 0, artifacts: 0, workspaces: 0, integrations: 0 },
      createdAt: now, updatedAt: now,
    });
    const jobId = await ctx.db.insert("schoolLifecycleJobs", {
      schoolId: target, type: "purge", status: options.queued ? "queued" : "running", requestedByAccountId: accountId,
      approvedByAccountIds: [], reason: "purge", impact: { activeMembers: 0, artifacts: 0, workspaces: 0, integrations: 0 },
      prerequisiteExportJobId: exportJobId, reversibleUntil: now - 1, createdAt: now, updatedAt: now,
    });
    if (!options.queued)
      await ctx.db.insert("schoolPurgeProgress", {
        jobId, schoolId: target, stage: "dependent_rows", tableIndex: 0, deletedRows: 0, deletedStorageObjects: 0,
        createdAt: now, updatedAt: now,
      });
    return { target, kept, jobId };
  });
  return { t, ...ids };
}

async function remaining(t: ReturnType<typeof convexTest>, schoolId: Id<"schools">) {
  return t.run(async ctx => ({
    messages: (await ctx.db.query("spectraMessages").collect()).filter(row => row.schoolId === schoolId).length,
    calendar: (await ctx.db.query("calendarItems").collect()).filter(row => row.schoolId === schoolId).length,
  }));
}

it("purges school rows through school indexes or one bounded walk", async () => {
  const f = await purgeFixture({ queued: false });
  const scheduler = { runAfter: async () => null };
  for (let batch = 0; batch < 2_000; batch += 1) {
    const measured = await f.t.run(async ctx => {
      const stage = (await ctx.db.query("schoolPurgeProgress").first())!.stage;
      const observer = observeDatabase(ctx.db);
      const advanced = await advanceHandler({ ...ctx, db: observer.db, scheduler } as unknown as MutationCtx, { jobId: f.jobId });
      return { stage, advanced, ...observer.snapshot() };
    });
    // A filter hides how many rows it scanned; the school stage uses none.
    if (measured.stage === "school_rows")
      expect(measured.reads.filter(row => row.postIndexFilter).map(row => row.table)).toEqual([]);
    expect(measured.documentsReturned).toBeLessThan(1_000);
    if (!measured.advanced) break;
  }
  expect((await f.t.run(ctx => ctx.db.get(f.jobId)))?.status).toBe("completed");
  expect(await remaining(f.t, f.target)).toEqual({ messages: 0, calendar: 0 });
  expect(await remaining(f.t, f.kept)).toEqual({ messages: 450, calendar: 450 });
});

it("keeps purging after the cron starts it instead of one batch per tick", async () => {
  vi.useFakeTimers();
  const f = await purgeFixture({ queued: true });
  await f.t.mutation(internal.administration.processLifecycleJobs, {});
  expect((await f.t.run(ctx => ctx.db.get(f.jobId)))?.status).toBe("running");
  // The runtime accepts an iteration cap that the published types omit.
  const finishAll = f.t.finishAllScheduledFunctions as (advance: () => void, maxIterations: number) => Promise<void>;
  await finishAll(vi.runAllTimers, 5_000);
  expect((await f.t.run(ctx => ctx.db.get(f.jobId)))?.status).toBe("completed");
  expect(await remaining(f.t, f.target)).toEqual({ messages: 0, calendar: 0 });
  expect(await remaining(f.t, f.kept)).toEqual({ messages: 450, calendar: 450 });
});
