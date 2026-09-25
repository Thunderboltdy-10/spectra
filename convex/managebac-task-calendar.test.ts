/// <reference types="vite/client" />
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { upsertSourceCalendarItem } from "./calendarShared";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const bridgeKey = "school-calendar-disposable-fixture-key-1234567890";
const identity = { subject: "school-calendar-student", email: "student@example.test", emailVerified: true };
const initialSource = {
  title: "Official essay",
  description: "Explain the evidence.",
  dueAt: "2026-10-24T09:00:00+02:00",
  timezone: "Europe/Madrid",
  classId: "class-1",
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

// All identities, source records and bridge signatures are disposable. The real
// signed mutation and projection triggers run; no provider/server is contacted.
async function fixture(role: "student" | "school_admin" = "student") {
  const t = convexTest(schema, {
    ...modules,
    "./schoolCalendarFixture.ts": async () => {
      const { mutation } = await import("./orgNodeMutation");
      return { editTask: mutation({
        args: { itemId: v.id("calendarItems"), patch: v.any() },
        handler: async (ctx, args) => { await ctx.db.patch(args.itemId, args.patch); },
      }) };
    },
  });
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"])
    aggregateTest.register(t, name);
  const seed = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Disposable Calendar school", slug: "school-calendar-fixture", verifiedDomains: [],
      status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true,
      name: "Student", status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      schoolId, accountId, role, status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const integrationId = await ctx.db.insert("schoolIntegrations", {
      schoolId, provider: "managebac", baseUrl: "https://provider.example.test", authHeaderName: "X-API-Key",
      authScheme: "raw", status: "connected", tokenMode: "read_only", secretPurpose: "fixture", manifestVersion: 1,
      capabilityCoverage: { discovered: 1, verifiedReadable: 1, unverified: 0, failed: 0, quarantined: 0 },
      syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
      freshnessSlaMinutes: 60, requestBudgetPerMinute: 30, bootstrapVersion: 1,
      createdByAccountId: accountId, updatedByAccountId: accountId, createdAt: now, updatedAt: now,
    });
    const capabilityId = await ctx.db.insert("integrationCapabilities", {
      integrationId, schoolId, category: "assignments", name: "Assignments", recordType: "assignment",
      method: "GET", path: "/assignments", purpose: "Fixture assignments", scope: "personal", minimumRole: "student",
      pagination: "page", changeStrategy: "full_reconciliation", freshnessSlaMinutes: 60, contractVersion: "fixture-v1",
      permissionState: "read_only", verificationStatus: "verified", routeSource: "manual_verified", normalization: {},
      lastVerifiedAt: now, lastSuccessAt: now, createdAt: now, updatedAt: now,
    });
    const syncRunId = await ctx.db.insert("externalSyncRuns", {
      integrationId, schoolId, accountId, kind: "manual", status: "running", trigger: "user", stage: "ingesting",
      capabilityIds: [capabilityId], counts: { fetched: 0, created: 0, updated: 0, unchanged: 0, tombstoned: 0, projected: 0, skipped: 0, quarantined: 0, conflicts: 0, errors: 0 },
      attemptCount: 1, nextAttemptAt: now, startedAt: now, createdAt: now, updatedAt: now,
    });
    const selectionId = await ctx.db.insert("managebacClassSelections", {
      integrationId, schoolId, accountId, providerClassId: "class-1", providerRecordKey: "class:1",
      academicPeriodKey: "2026-27", selected: true, retention: "keep_in_spectra", selectionRevision: 1,
      createdAt: now, updatedAt: now,
    });
    return { schoolId, accountId, integrationId, capabilityId, syncRunId, selectionId };
  });
  const user = t.withIdentity(identity);
  const editTask = (itemId: Id<"calendarItems">, patch: Partial<Doc<"calendarItems">>) =>
    t.mutation(makeFunctionReference<"mutation">("schoolCalendarFixture:editTask"), { itemId, patch });
  let sequence = 0;
  const sync = async (normalized = initialSource, sourceHash = "v1", academicPeriodKey = "2026-27") => {
    const records = [{
      providerRecordId: "assignment-1", providerRecordKey: "assignment:1", providerClassId: "class-1",
      academicPeriodKey, classification: "personal" as const, audienceScope: "mapped_user" as const,
      normalized, payloadVersion: "fixture-v1", sourceHash, provenanceUrl: "https://provider.example.test/assignment/1",
    }];
    const timestamp = Date.now();
    const nonce = `calendar-fixture-${++sequence}`;
    const payloadDigest = createHash("sha256").update(canonicalJson({ capabilityId: seed.capabilityId, records, pageNumber: sequence })).digest("base64url");
    const signature = createHmac("sha256", bridgeKey).update([
      "sync-page", identity.subject, seed.integrationId, seed.syncRunId, timestamp, nonce, payloadDigest,
    ].join("|")).digest("base64url");
    return user.mutation(api.managebac.commitNormalizedPage, {
      integrationId: seed.integrationId, syncRunId: seed.syncRunId, capabilityId: seed.capabilityId,
      records, pageNumber: sequence, timestamp, nonce, payloadDigest, signature,
    });
  };
  const items = () => t.run(async ctx => {
    const rows = await ctx.db.query("calendarItems").withIndex("by_account_kind", q => q.eq("ownerAccountId", seed.accountId)).collect();
    const official = rows.find(row => row.kind === "official_deadline")!;
    const task = rows.find(row => row.kind === "task")!;
    return { rows, official, task };
  });
  return { t, user, seed, sync, items, editTask };
}

beforeEach(() => vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey));
afterEach(() => vi.unstubAllEnvs());

describe("ManageBac task refresh preserves personal work", () => {
  for (const status of ["active", "completed", "cancelled", "removed"] as const) {
    for (const changed of [false, true]) {
      it(`preserves a ${status} customized task with ${changed ? "changed" : "unchanged"} provider data`, async () => {
        const f = await fixture();
        await f.sync();
        const before = await f.items();
        const personal: Partial<Doc<"calendarItems">> = {
          title: "My writing plan", notes: "Start with the counterargument.", status,
          startAt: Date.parse("2026-10-23T10:00:00-04:00"), endAt: Date.parse("2026-10-24T10:00:00-04:00"),
          allDay: true, timezone: "America/New_York", timePrecision: "date_only", revision: 10,
        };
        await f.editTask(before.task._id, personal);
        const normalized = changed ? { ...initialSource, title: "Updated official essay", description: "New instructions.", dueAt: "2026-10-25T09:00:00+01:00" } : initialSource;
        await f.sync(normalized, changed ? "v2" : "v1");
        const after = await f.items();
        expect(after.rows).toHaveLength(2);
        const { revision: _revision, ...personalFields } = personal;
        expect(after.task).toMatchObject({ ...personalFields, _id: before.task._id, revision: changed ? 11 : 10 });
        expect(after.official).toMatchObject({ _id: before.official._id, title: normalized.title, notes: normalized.description, startAt: Date.parse(normalized.dueAt), sourceLocked: true, status: "active" });
        expect(after.task).toMatchObject({ sourceRecordId: after.official.sourceRecordId, officialDeadlineItemId: after.official._id, sourceHash: changed ? "v2" : "v1", createdBy: "source", sourceProvider: "managebac", sourceLocked: false });
        const compact = await f.t.run(ctx => ctx.db.query("calendarItemReadModels").withIndex("by_item", q => q.eq("itemId", before.task._id)).unique());
        expect(compact).toMatchObject({ ...personalFields, revision: changed ? 11 : 10 });
        await f.sync(normalized, changed ? "v2" : "v1");
        expect((await f.items()).task).toMatchObject({ ...personalFields, revision: changed ? 11 : 10 });
      });
    }
  }

  it("keeps a student's task removed in Calendar's canonical lookup after both kinds of sync", async () => {
    const f = await fixture();
    await f.sync();
    const before = await f.items();
    const range = { from: Date.parse("2026-10-20"), to: Date.parse("2026-10-30"), targetItemId: before.task._id, limit: 100 };
    expect((await f.user.query(api.calendar.overview, range)).targetedItems[0]).toMatchObject({ id: before.task._id, status: "active" });
    await f.user.mutation(api.calendar.removePersonalItem, { itemId: before.task._id });
    await expect(f.user.mutation(api.calendar.removePersonalItem, { itemId: before.official._id })).rejects.toThrow("CALENDAR_SOURCE_LOCKED");
    for (const version of ["v1", "v2"]) {
      await f.sync(version === "v1" ? initialSource : { ...initialSource, dueAt: "2026-10-25T09:00:00+01:00" }, version);
      const overview = await f.user.query(api.calendar.overview, range);
      expect(overview.targetedItems[0]).toMatchObject({ id: before.task._id, status: "removed" });
      expect(overview.items.some(row => row.id === before.official._id)).toBe(true);
      expect((await f.items()).task.status).toBe("removed");
    }
  });

  it("refreshes untouched copied text field by field and preserves an explicitly cleared note", async () => {
    const f = await fixture();
    await f.sync();
    const before = await f.items();
    await f.editTask(before.task._id, { notes: "" });
    await f.sync({ ...initialSource, title: "New source title", description: "New source description" }, "v2");
    expect((await f.items()).task).toMatchObject({ title: "New source title" });
    expect((await f.items()).task.notes).toBe("");
    await f.editTask(before.task._id, { title: "Personal title", notes: "New source description" });
    await f.sync({ ...initialSource, title: "Third source title", description: "Third source description" }, "v3");
    expect((await f.items()).task).toMatchObject({ title: "Personal title", notes: "Third source description" });
    await f.sync({ ...initialSource, description: "" }, "v4");
    expect((await f.items()).task.notes).toBeUndefined();
  });

  it("preserves personal text when a legacy task has no matching source baseline", async () => {
    const f = await fixture();
    await f.sync();
    const before = await f.items();
    await f.editTask(before.task._id, { sourceHash: "older-source" });
    await f.sync({ ...initialSource, title: "Updated official title", description: "Updated official description" }, "v2");
    expect((await f.items()).task).toMatchObject({ title: initialSource.title, notes: initialSource.description, sourceHash: "v2" });
    expect((await f.items()).official.title).toBe("Updated official title");
  });

  it("preserves an exact scheduled block and its replay across a source deadline's DST change", async () => {
    const f = await fixture();
    await f.sync();
    const before = await f.items();
    const request = { taskItemId: before.task._id, startAt: Date.parse("2026-10-25T02:15:00+02:00"), endAt: Date.parse("2026-10-25T02:45:00+01:00"), timezone: "Europe/Madrid", idempotencyKey: "fixture-dst-work-block" };
    const block = await f.user.mutation(api.calendar.scheduleTask, request);
    await f.sync({ ...initialSource, dueAt: "2026-10-25T09:00:00+01:00" }, "v2");
    expect(await f.user.mutation(api.calendar.scheduleTask, request)).toEqual(block);
    const after = await f.items();
    expect(after.rows).toHaveLength(3);
    expect(after.official.startAt! - before.official.startAt!).toBe(25 * 60 * 60_000);
    expect(after.rows.find(row => row._id === block.id)).toMatchObject({ startAt: request.startAt, endAt: request.endAt, timezone: request.timezone, officialDeadlineItemId: before.official._id });
  });

  it("keeps class opt-out frozen and period rollover separate from the prior personal task", async () => {
    const f = await fixture();
    await f.sync();
    const before = await f.items();
    await f.editTask(before.task._id, { status: "completed", title: "Last year's plan" });
    await f.t.run(ctx => ctx.db.patch(f.seed.selectionId, { selected: false }));
    await f.sync({ ...initialSource, title: "Not followed" }, "v2");
    expect((await f.items()).official.sourceHash).toBe("v1");
    await f.t.run(ctx => ctx.db.patch(f.seed.selectionId, { selected: true }));
    await f.sync({ ...initialSource, title: "Followed again" }, "v3");
    expect((await f.items()).task).toMatchObject({ _id: before.task._id, title: "Last year's plan", status: "completed" });
    await f.t.run(ctx => ctx.db.patch(f.seed.selectionId, { academicPeriodKey: "2027-28" }));
    await f.sync({ ...initialSource, title: "Next year's assignment" }, "next-year", "2027-28");
    const after = await f.items();
    expect(after.rows).toHaveLength(4);
    expect(after.rows.find(row => row._id === before.task._id)).toMatchObject({ title: "Last year's plan", status: "completed" });
    expect(after.rows.find(row => row.kind === "task" && row._id !== before.task._id)).toMatchObject({ title: "Next year's assignment", status: "active", sourceHash: "next-year" });
  });

  it("applies the same personal-copy rule for a school administrator", async () => {
    const f = await fixture("school_admin");
    await f.sync();
    const before = await f.items();
    await f.user.mutation(api.calendar.removePersonalItem, { itemId: before.task._id });
    await f.sync({ ...initialSource, title: "Provider changed" }, "v2");
    expect((await f.items()).task.status).toBe("removed");
    expect((await f.items()).official.title).toBe("Provider changed");
  });

  it("clears a provider's withdrawn deadline without clearing a personal schedule", async () => {
    const f = await fixture();
    await f.sync();
    const before = await f.items();
    const personal = { startAt: Date.parse("2026-10-23T10:00:00Z"), endAt: Date.parse("2026-10-23T11:00:00Z"), timePrecision: "exact" as const };
    await f.editTask(before.task._id, personal);
    await f.sync({ ...initialSource, dueAt: "" }, "no-deadline");
    const after = await f.items();
    expect(after.official.startAt).toBeUndefined();
    expect(after.official.endAt).toBeUndefined();
    expect(after.official.timePrecision).toBe("unknown");
    expect(after.task).toMatchObject(personal);
  });

  it("reads only the two keyed calendar rows and performs no writes for an identical replay", async () => {
    const f = await fixture();
    await f.sync();
    const before = await f.items();
    await f.user.mutation(api.calendar.removePersonalItem, { itemId: before.task._id });
    await f.t.run(async ctx => {
      for (let index = 0; index < 40; index++) {
        const { _id, _creationTime, ...row } = before.task;
        await ctx.db.insert("calendarItems", { ...row, sourceKey: `unrelated-${index}`, notes: "x".repeat(20_000) });
      }
    });
    const stats = await f.t.run(async ctx => {
      const measured = { queries: 0, returnedRows: 0, serializedRowBytes: 0, writes: 0 };
      const db = new Proxy(ctx.db, {
        get(target, key) {
          const original = Reflect.get(target, key);
          if (key === "query") return (...args: unknown[]) => {
            measured.queries++;
            const query = Reflect.apply(original, target, args);
            return { withIndex: (...indexArgs: unknown[]) => {
              const indexed = query.withIndex(...indexArgs);
              return { unique: async () => {
                const row = await indexed.unique();
                if (row) {
                  measured.returnedRows++;
                  measured.serializedRowBytes += new TextEncoder().encode(JSON.stringify(row)).byteLength;
                }
                return row;
              } };
            } };
          };
          if (["patch", "insert", "delete"].includes(String(key))) return (...args: unknown[]) => {
            measured.writes++;
            return Reflect.apply(original, target, args);
          };
          return typeof original === "function" ? original.bind(target) : original;
        },
      });
      await upsertSourceCalendarItem({ ...ctx, db }, {
        ownerAccountId: f.seed.accountId, schoolId: f.seed.schoolId, sourceRecordId: before.official.sourceRecordId!,
        sourceKey: before.official.sourceKey!.replace(/:official_deadline$/, ""), sourceHash: "v1",
        sourceUrl: before.official.sourceUrl, fetchedAt: before.official.sourceFreshAt!, recordType: "assignment", normalized: initialSource,
      });
      return measured;
    });
    expect(stats).toMatchObject({ queries: 2, returnedRows: 2, writes: 0 });
    // These are serialized canonical rows returned by the helper's reads,
    // not a client response size or a claim about deployed Convex billing.
    expect(stats.serializedRowBytes).toBeLessThan(10_000);
  });
});
