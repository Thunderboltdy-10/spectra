/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { bridgeKey, calendarFixture } from "../scripts/test-fixtures/managebac-calendar";
import {
  OLD_TASK_RESTORE_MAX_RANGE_MS,
  PAST_TASK_GRACE_MS,
  PAST_TASK_KEEP_MS,
  TASK_KEPT_INDEFINITELY,
  aiRefreshRequest,
  taskExpiresAt,
} from "../shared/school-sync";

const modules = import.meta.glob("./**/*.ts");
const day = 24 * 60 * 60_000;

beforeEach(() => vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey));
afterEach(() => vi.unstubAllEnvs());

describe("past task retention", () => {
  it("keeps a task two weeks past the week it stays current, and an undated one until removed", () => {
    const due = Date.parse("2026-01-10T12:00:00Z");
    expect(taskExpiresAt({ dueAt: due })).toBe(due + PAST_TASK_GRACE_MS + PAST_TASK_KEEP_MS);
    expect(taskExpiresAt({ title: "No date" })).toBe(TASK_KEPT_INDEFINITELY);
  });

  it("removes expired tasks, keeps edited and recent ones, and dates rows saved before keep dates", async () => {
    const f = await calendarFixture(modules);
    const now = Date.now();
    const ids = await f.t.run(async (ctx) => {
      const { schoolId, integrationId, accountId } = f.seed;
      const task = (key: string, dueAt: number | undefined, expiresAt?: number) => ctx.db.insert("externalRecords", {
        integrationId, schoolId, providerRecordId: key, providerRecordKey: `task:${key}`, recordType: "task",
        classification: "personal", audienceScope: "mapped_user", mappedAccountId: accountId, providerClassId: "class-1",
        normalized: { title: key, ...(dueAt === undefined ? {} : { dueAt }) }, payloadVersion: "fixture-v1",
        sourceHash: key, tombstone: false, fetchedAt: now, createdAt: now, updatedAt: now,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });
      const old = await task("old", now - 60 * day, now - 39 * day);
      const legacyOld = await task("legacy-old", now - 60 * day);
      const legacyRecent = await task("legacy-recent", now - 2 * day);
      const undated = await task("undated", undefined);
      const edited = await task("edited", now - 60 * day, now - 39 * day);
      const recent = await task("recent", now + 3 * day, taskExpiresAt({ dueAt: now + 3 * day }));
      await ctx.db.insert("externalRecordOverlays", {
        recordId: edited, schoolId, accountId, notes: "My notes", tags: [], linkedArtifactIds: [],
        sourceHashAtEdit: "edited", createdAt: now, updatedAt: now,
      });
      const related = await ctx.db.insert("externalRecordRelations", {
        integrationId, schoolId, sourceRecordId: old, targetRecordId: recent, relationType: "deadline_for",
        createdAt: now,
      });
      return { old, legacyOld, legacyRecent, undated, edited, recent, related };
    });

    const result = await f.t.mutation(internal.managebac.sweepExpiredTasks, {});
    expect(result).toMatchObject({ retired: 2, more: false });

    const rows = await f.t.run(async (ctx) => Object.fromEntries(await Promise.all(
      Object.entries(ids).map(async ([name, id]) => [name, await ctx.db.get(id as Id<"externalRecords">)]),
    )));
    expect(rows.old).toBeNull();
    expect(rows.legacyOld).toBeNull();
    expect(rows.related).toBeNull();
    expect(rows.legacyRecent?.expiresAt).toBe(taskExpiresAt({ dueAt: now - 2 * day }));
    expect(rows.undated?.expiresAt).toBe(TASK_KEPT_INDEFINITELY);
    // A task the student wrote on stays with their notes.
    expect(rows.edited?.expiresAt).toBe(TASK_KEPT_INDEFINITELY);
    expect(rows.recent).not.toBeNull();

    // A second run finds nothing left to do.
    expect(await f.t.mutation(internal.managebac.sweepExpiredTasks, {})).toMatchObject({ retired: 0, dated: 0, more: false });
  });
});

describe("bringing back older tasks", () => {
  it("asks for one class and a bounded date range, never every old task", () => {
    const from = Date.parse("2026-02-01T00:00:00Z");
    expect(aiRefreshRequest("past_tasks", true, { classId: "101", from: "2026-02-01", to: "2026-02-28" })).toEqual({
      reason: "ai_past_tasks", force: true, kinds: ["past_tasks"],
      pastTasks: { providerClassId: "101", from, to: Date.parse("2026-02-28T00:00:00Z") + day - 1 },
    });
    // A range wider than the limit is cut to it.
    expect(aiRefreshRequest("past_tasks", true, { classId: "101", from: "2026-02-01", to: "2027-02-01" }).pastTasks?.to)
      .toBe(from + OLD_TASK_RESTORE_MAX_RANGE_MS);
    // Without a class, past tasks only refresh the ones Spectra keeps.
    expect(aiRefreshRequest("past_tasks", true, { from: "2026-02-01" })).not.toHaveProperty("pastTasks");
    expect(aiRefreshRequest("grades", true, { classId: "101", from: "2026-02-01" })).not.toHaveProperty("pastTasks");
  });
});
