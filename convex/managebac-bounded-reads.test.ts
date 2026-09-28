/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { resolveConflict } from "./managebac";
import { OPEN_CONFLICT_COUNT_LIMIT, syncRunOutcome } from "./managebacProjectionJobs";
import { observeDatabase } from "../scripts/perf-read-ledger";
import { bridgeKey, calendarFixture, identity } from "../scripts/test-fixtures/managebac-calendar";

const modules = import.meta.glob("./**/*.ts");
const classmates = 240;
// Conflicts keep the full old/new provider payloads for review.
const payload = { title: "Official essay", description: "x".repeat(4_000) };
const resolveHandler = Reflect.get(resolveConflict, "_handler") as (
  ctx: MutationCtx, args: { conflictId: Id<"externalSyncConflicts">; resolution: "detach" },
) => Promise<{ pending: boolean }>;

beforeEach(() => vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey));
afterEach(() => vi.unstubAllEnvs());

/** One shared class resource projected to the student and many classmates. */
async function sharedRecordFixture() {
  const f = await calendarFixture(modules);
  const ids = await f.t.run(async ctx => {
    const now = Date.now();
    const { schoolId, integrationId, accountId, syncRunId } = f.seed;
    const recordId = await ctx.db.insert("externalRecords", {
      integrationId, schoolId, providerRecordId: "resource-1", providerRecordKey: "resource:1", recordType: "resource",
      classification: "class", audienceScope: "class_members", providerClassId: "class-1", normalized: payload,
      payloadVersion: "fixture-v1", sourceHash: "v2", tombstone: false, fetchedAt: now, createdAt: now, updatedAt: now,
    });
    const projection = (owner: Id<"accounts">, index: number) => ctx.db.insert("externalProjections", {
      integrationId, schoolId, recordId, accountId: owner, projectionType: "resource", projectionId: `resource-projection-${index}`,
      providerKey: `resource:1:${index}`, sourceHash: "v1", state: "conflicted", bootstrapVersion: 1, createdAt: now, updatedAt: now,
    });
    const ownId = await projection(accountId, 0);
    const classmateIds: Id<"externalProjections">[] = [];
    for (let index = 1; index <= classmates; index += 1) {
      const classmate = await ctx.db.insert("accounts", {
        clerkId: `classmate-${index}`, email: `classmate-${index}@example.test`, emailVerified: true,
        name: `Classmate ${index}`, status: "active", createdAt: now, updatedAt: now,
      });
      classmateIds.push(await projection(classmate, index));
      await ctx.db.insert("externalSyncConflicts", {
        syncRunId, integrationId, schoolId, accountId: classmate, recordId, projectionType: "resource",
        kind: "source_changed", oldSource: payload, newSource: payload, affectedLinks: [], suggestedActions: ["detach"],
        status: "open", createdAt: now, updatedAt: now,
      });
    }
    const conflictId = await ctx.db.insert("externalSyncConflicts", {
      syncRunId, integrationId, schoolId, accountId, recordId, projectionType: "resource", projectionId: "resource-projection-0",
      kind: "source_changed", oldSource: payload, newSource: payload, affectedLinks: ["resource-projection-0"],
      suggestedActions: ["detach"], status: "open", createdAt: now, updatedAt: now,
    });
    return { recordId, ownId, classmateIds, conflictId };
  });
  return { ...f, ...ids };
}

/** Rows returned by index scans of a table (point gets by id are excluded). */
const scanned = (reads: { table: string; operation: string; documentsReturned: number }[], table: string) =>
  reads.filter(row => row.table === table && row.operation !== "get").reduce((sum, row) => sum + row.documentsReturned, 0);

describe("ManageBac conflict reads stay bounded for a large class", () => {
  it("settles a school run without reading every open conflict in the school", async () => {
    const f = await sharedRecordFixture();
    const measured = await f.t.run(async ctx => {
      const now = Date.now();
      const schoolRunId = await ctx.db.insert("externalSyncRuns", {
        integrationId: f.seed.integrationId, schoolId: f.seed.schoolId, kind: "scheduled", status: "running",
        trigger: "schedule", stage: "ingesting", capabilityIds: [f.seed.capabilityId],
        counts: { fetched: 0, created: 0, updated: 0, unchanged: 0, tombstoned: 0, projected: 0, skipped: 0, quarantined: 0, conflicts: 0, errors: 0 },
        attemptCount: 1, nextAttemptAt: now, startedAt: now, createdAt: now, updatedAt: now,
      });
      const observer = observeDatabase(ctx.db);
      const outcome = await syncRunOutcome({ ...ctx, db: observer.db }, (await ctx.db.get(schoolRunId))!);
      return { outcome, ...observer.snapshot() };
    });
    expect(measured.outcome).toEqual({ status: "awaiting_review", conflicts: OPEN_CONFLICT_COUNT_LIMIT });
    expect(scanned(measured.reads, "externalSyncConflicts")).toBeLessThanOrEqual(OPEN_CONFLICT_COUNT_LIMIT);
  });

  it("resolves a personal conflict from that account's projections only", async () => {
    const f = await sharedRecordFixture();
    const measured = await f.t.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      const auth = { getUserIdentity: async () => ({ ...identity, tokenIdentifier: `fixture|${identity.subject}`, issuer: "fixture" }) };
      const result = await resolveHandler({ ...ctx, db: observer.db, auth }, { conflictId: f.conflictId, resolution: "detach" });
      return { result, ...observer.snapshot() };
    });
    expect(measured.result).toMatchObject({ pending: false });
    expect(scanned(measured.reads, "externalProjections")).toBe(1);
    const after = await f.t.run(async ctx => ({
      own: await ctx.db.get(f.ownId),
      classmates: await Promise.all(f.classmateIds.map(id => ctx.db.get(id))),
      conflict: await ctx.db.get(f.conflictId),
    }));
    expect(after.own).toMatchObject({ state: "detached" });
    expect(after.classmates.every(row => row?.state === "conflicted")).toBe(true);
    expect(after.conflict).toMatchObject({ status: "resolved", resolution: "detach" });
  });
});
