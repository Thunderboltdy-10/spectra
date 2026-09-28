/// <reference types="vite/client" />
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const bridgeKey = "managebac-isolation-test-key-012345678901234567890";

describe("ManageBac Keep lifecycle", () => {
  beforeEach(() => {
    process.env.SPECTRA_CONNECTOR_BRIDGE_KEY = bridgeKey;
  });
  afterEach(() => {
    delete process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
  });

  it("keeps one account's shared projection while other accounts still receive updates and removals", async () => {
    const t = setupTest();
    const f = await seedFixture(t);
    const classId = await t.run(ctx => ctx.db.insert("externalRecords", {
      integrationId: f.integrationId, schoolId: f.schoolId, providerRecordId: "class-current",
      providerRecordKey: "class:current", recordType: "class", classification: "personal",
      audienceScope: "mapped_user", mappedAccountId: f.aliceId, providerClassId: "class-current",
      normalized: { title: "Current class" }, payloadVersion: "fixture-v1", sourceHash: "class-current",
      tombstone: false, fetchedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    }));
    const selection = await t.withIdentity(alice).mutation(api.managebac.setSelectedClasses, { recordIds: [classId] });
    expect(selection.selectedRecordIds).toEqual([classId]);
    const first = await insertTimetableRun(t, f, f.aliceId);
    await commitTimetablePage(
      t,
      f,
      first,
      "Shared original",
      "shared-v1",
      "shared-first",
    );
    const seeded = await t.run(async (ctx) => {
      const projection = (
        await ctx.db
          .query("externalProjections")
          .withIndex("by_account_updated", (q) => q.eq("accountId", f.aliceId))
          .collect()
      )[0];
      const source = (await ctx.db.get(projection.recordId))!;
      await ctx.db.patch(source._id, {
        audienceScope: "class_members",
        classification: "class",
        mappedAccountId: undefined,
        sourceIdentityKey: undefined,
      });
      const itemId = ctx.db.normalizeId(
        "calendarItems",
        projection.projectionId,
      )!;
      const {
        _id: _itemId,
        _creationTime: _itemCreation,
        ...item
      } = (await ctx.db.get(itemId))!;
      const bobItemId = await ctx.db.insert("calendarItems", {
        ...item,
        ownerAccountId: f.bobId,
      });
      const {
        _id: _projectionId,
        _creationTime: _projectionCreation,
        ...projectionFields
      } = projection;
      await ctx.db.insert("externalProjections", {
        ...projectionFields,
        accountId: f.bobId,
        projectionId: String(bobItemId),
      });
      for (const [accountId, selected] of [
        [f.aliceId, false],
        [f.bobId, true],
      ] as const) {
        const existing = await ctx.db.query("managebacClassSelections")
          .withIndex("by_integration_account_class", q => q.eq("integrationId", f.integrationId)
            .eq("accountId", accountId).eq("providerClassId", "class-current")).unique();
        const value = {
          accountId,
          integrationId: f.integrationId,
          schoolId: f.schoolId,
          providerClassId: "class-current",
          providerRecordKey: "class:current",
          selected,
          retention: "keep_in_spectra" as const,
          selectionRevision: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        if (existing) await ctx.db.patch(existing._id, value);
        else await ctx.db.insert("managebacClassSelections", value);
      }
      return { itemId, bobItemId, sourceId: source._id };
    });
    const sharedRun = await insertTimetableRun(t, f, f.adminId);
    await t.run(async (ctx) => {
      await ctx.db.patch(sharedRun.syncRunId, { accountId: undefined });
      await ctx.db.patch(sharedRun.capabilityId, { scope: "school" });
    });
    const records = [
      {
        providerRecordId: "timetable-event-1",
        providerRecordKey: "timetable:math-1",
        providerClassId: "class-current",
        classification: "class" as const,
        audienceScope: "class_members" as const,
        normalized: {
          title: "Shared updated",
          startAt: "2026-09-21T10:00:00Z",
          endAt: "2026-09-21T11:00:00Z",
        },
        payloadVersion: "v1",
        sourceHash: "shared-v2",
      },
    ];
    const timestamp = Date.now();
    const payloadDigest = digest({
      capabilityId: sharedRun.capabilityId,
      records,
      pageNumber: 1,
      progress: FULL_ROUTE_PAGE,
    });
    await t.withIdentity(admin).mutation(api.managebac.commitNormalizedPage, {
      integrationId: f.integrationId,
      syncRunId: sharedRun.syncRunId,
      capabilityId: sharedRun.capabilityId,
      records,
      pageNumber: 1,
      progress: FULL_ROUTE_PAGE,
      timestamp,
      payloadDigest,
      nonce: "shared-update",
      signature: signature(
        "sync-page",
        admin,
        f.integrationId,
        sharedRun.syncRunId,
        timestamp,
        "shared-update",
        payloadDigest,
      ),
    });
    expect((await t.run((ctx) => ctx.db.get(seeded.itemId)))?.title).toBe(
      "Shared original",
    );
    expect((await t.run((ctx) => ctx.db.get(seeded.bobItemId)))?.title).toBe(
      "Shared updated",
    );
    // A later school pass reads the route and finds it empty.
    const emptyRun = await insertTimetableRun(t, f, f.adminId);
    await t.run(async (ctx) => {
      await ctx.db.patch(emptyRun.syncRunId, { accountId: undefined });
      await ctx.db.patch(emptyRun.capabilityId, { scope: "school" });
    });
    await commitEmptyPage(t, admin, f, emptyRun, "shared-empty");
    const completeDigest = digest({});
    await t.withIdentity(admin).mutation(api.managebac.completeSync, {
      integrationId: f.integrationId,
      syncRunId: emptyRun.syncRunId,
      timestamp,
      payloadDigest: completeDigest,
      nonce: "shared-complete",
      signature: signature(
        "sync-complete",
        admin,
        f.integrationId,
        emptyRun.syncRunId,
        timestamp,
        "shared-complete",
        completeDigest,
      ),
    });
    expect((await t.run((ctx) => ctx.db.get(seeded.itemId)))?.status).toBe(
      "active",
    );
    expect((await t.run((ctx) => ctx.db.get(seeded.bobItemId)))?.status).toBe(
      "removed",
    );
  });

  it("preserves a deselected Keep schedule through selected-class reconciliation and resumes on reselect", async () => {
    const t = setupTest();
    const f = await seedFixture(t);
    const classIds = await t.run(async (ctx) => {
      const result = [];
      for (const providerClassId of ["class-current", "class-still-followed"]) {
        result.push(
          await ctx.db.insert("externalRecords", {
            integrationId: f.integrationId,
            schoolId: f.schoolId,
            providerRecordId: providerClassId,
            providerRecordKey: `class:${providerClassId}`,
            recordType: "class",
            classification: "personal",
            audienceScope: "mapped_user",
            mappedAccountId: f.aliceId,
            providerClassId,
            normalized: { title: providerClassId },
            payloadVersion: "v1",
            sourceHash: providerClassId,
            tombstone: false,
            fetchedAt: Date.now(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        );
      }
      return result;
    });
    const user = t.withIdentity(alice);
    const selected = await user.mutation(api.managebac.setSelectedClasses, {
      recordIds: classIds,
      expectedRevision: 0,
    });
    await user.mutation(api.managebac.materializeClassWorkspaces, {
      recordIds: classIds,
    });
    const first = await insertTimetableRun(t, f, f.aliceId);
    await commitTimetablePage(
      t,
      f,
      first,
      "Kept class schedule",
      "keep-v1",
      "keep-initial",
    );
    const deselected = await user.mutation(api.managebac.setSelectedClasses, {
      recordIds: [classIds[1]],
      expectedRevision: selected.selectionRevision,
      retention: "keep_in_spectra",
    });
    const released = await user.mutation(api.managebac.releaseClassWorkspaces, {
      recordIds: deselected.deselectedRecordIds,
      retention: "keep_in_spectra",
    });
    expect(released.kept).toBe(1);
    const state = () =>
      t.run(async (ctx) => ({
        item: (
          await ctx.db
            .query("calendarItems")
            .withIndex("by_account_kind", (q) =>
              q.eq("ownerAccountId", f.aliceId).eq("kind", "official_event"),
            )
            .collect()
        )[0],
        sources: await ctx.db
          .query("externalRecords")
          .withIndex("by_account_type", (q) =>
            q.eq("mappedAccountId", f.aliceId).eq("recordType", "timetable"),
          )
          .collect(),
      }));
    expect((await state()).item.status).toBe("active");
    // The route now fans out only to class-still-followed. A valid empty result
    // for that class reconciles the timetable capability; the kept class was
    // not fetched, exactly as selectClasses/Keep promises.
    const next = await insertTimetableRun(t, f, f.aliceId);
    await t.run(async (ctx) => {
      await ctx.db.patch(next.syncRunId, {
        selectionRevision: deselected.selectionRevision,
      });
    });
    await commitEmptyPage(t, alice, f, next, "keep-empty", deselected.selectionRevision);
    const payload = { selectionRevision: deselected.selectionRevision };
    const timestamp = Date.now();
    const payloadDigest = digest(payload);
    await user.mutation(api.managebac.completeSync, {
      integrationId: f.integrationId,
      syncRunId: next.syncRunId,
      ...payload,
      timestamp,
      payloadDigest,
      nonce: "keep-reconcile",
      signature: signature(
        "sync-complete",
        alice,
        f.integrationId,
        next.syncRunId,
        timestamp,
        "keep-reconcile",
        payloadDigest,
      ),
    });
    const after = await state();
    expect(after.item.status).toBe("active");
    expect(after.sources[0].tombstone).toBe(false);
    const skippedUpdate = await insertTimetableRun(t, f, f.aliceId);
    await commitTimetablePage(
      t,
      f,
      skippedUpdate,
      "Must not overwrite Keep",
      "keep-v2",
      "keep-skipped-update",
    );
    expect((await state()).item.title).toBe("Kept class schedule");
    await user.mutation(api.managebac.setSelectedClasses, {
      recordIds: classIds,
      expectedRevision: deselected.selectionRevision,
    });
    const resumedUpdate = await insertTimetableRun(t, f, f.aliceId);
    await commitTimetablePage(
      t,
      f,
      resumedUpdate,
      "Resumed school schedule",
      "keep-v3",
      "keep-resumed-update",
    );
    expect((await state()).item.title).toBe("Resumed school schedule");
  });
});

type TestIdentity = {
  subject: string;
  email: string;
  emailVerified: true;
};

const alice: TestIdentity = {
  subject: "managebac-isolation-alice",
  email: "alice@managebac-isolation.example.test",
  emailVerified: true,
};
const bob: TestIdentity = {
  subject: "managebac-isolation-bob",
  email: "bob@managebac-isolation.example.test",
  emailVerified: true,
};
const admin: TestIdentity = {
  subject: "managebac-isolation-admin",
  email: "admin@managebac-isolation.example.test",
  emailVerified: true,
};

/** Progress for a page that is the last page of its whole route. */
const FULL_ROUTE_PAGE = {
  binding: "",
  page: 1,
  bindingDone: true,
  capabilityDone: true,
  classIds: [],
  yearGroupIds: [],
};

const emptyCounts = {
  fetched: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  tombstoned: 0,
  projected: 0,
  skipped: 0,
  quarantined: 0,
  conflicts: 0,
  errors: 0,
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function digest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url");
}

function signature(
  operation: string,
  identity: { subject: string },
  integrationId: string,
  syncRunId: string | undefined,
  timestamp: number,
  nonce: string,
  payloadDigest: string,
) {
  return createHmac("sha256", bridgeKey)
    .update(
      [
        operation,
        identity.subject,
        integrationId,
        syncRunId ?? "-",
        timestamp,
        nonce,
        payloadDigest,
      ].join("|"),
    )
    .digest("base64url");
}

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

async function seedFixture(t: ReturnType<typeof setupTest>) {
  return t.run(async (ctx) => {
    const now = Date.now() - 10_000;
    const schoolId = await ctx.db.insert("schools", {
      name: "ManageBac isolation school",
      slug: `managebac-isolation-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const insertAccount = async (identity: typeof alice, name: string) =>
      ctx.db.insert("accounts", {
        clerkId: identity.subject,
        email: identity.email,
        emailVerified: true,
        name,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    const aliceId = await insertAccount(alice, "Alice");
    const bobId = await insertAccount(bob, "Bob");
    const adminId = await insertAccount(admin, "School admin");
    for (const [accountId, role] of [
      [aliceId, "student"],
      [bobId, "student"],
      [adminId, "school_admin"],
    ] as const)
      await ctx.db.insert("schoolMemberships", {
        accountId,
        schoolId,
        role,
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    const integrationId = await ctx.db.insert("schoolIntegrations", {
      schoolId,
      provider: "managebac",
      baseUrl: "https://managebac-isolation.example.test",
      authHeaderName: "X-API-Key",
      authScheme: "raw",
      status: "connected",
      tokenMode: "read_only",
      secretPurpose: "managebac-test",
      manifestVersion: 1,
      capabilityCoverage: {
        discovered: 1,
        verifiedReadable: 1,
        unverified: 0,
        failed: 0,
        quarantined: 0,
      },
      syncPolicy: {
        frequencyMinutes: 60,
        autoCreateClasses: false,
        autoImportTasks: true,
        autoApplySafeUpdates: true,
        conflictMode: "review",
      },
      freshnessSlaMinutes: 60,
      requestBudgetPerMinute: 30,
      bootstrapVersion: 1,
      createdByAccountId: adminId,
      updatedByAccountId: adminId,
      createdAt: now,
      updatedAt: now,
    });
    const capabilityId = await ctx.db.insert("integrationCapabilities", {
      integrationId,
      schoolId,
      category: "assignments",
      name: "Assignments",
      recordType: "class_resource",
      method: "GET",
      path: "/assignments",
      purpose: "Read assignments and class resources",
      scope: "personal",
      minimumRole: "student",
      pagination: "page",
      changeStrategy: "full_reconciliation",
      freshnessSlaMinutes: 60,
      contractVersion: "test-v1",
      permissionState: "read_only",
      verificationStatus: "verified",
      routeSource: "manual_verified",
      normalization: {},
      lastVerifiedAt: now,
      lastSuccessAt: now,
      createdAt: now,
      updatedAt: now,
    });
    for (const [accountId, providerUserId] of [
      [aliceId, "mb-alice"],
      [bobId, "mb-bob"],
    ] as const)
      await ctx.db.insert("externalIdentityMappings", {
        integrationId,
        schoolId,
        accountId,
        providerUserId,
        providerUserIdHash: `${providerUserId}-hash`,
        verifiedEmailHash: `${providerUserId}-email-hash`,
        status: "verified",
        matchCount: 1,
        resolvedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    return { schoolId, integrationId, capabilityId, aliceId, bobId, adminId };
  });
}

async function insertTimetableRun(
  t: ReturnType<typeof setupTest>,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  accountId: Id<"accounts">,
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const capabilityId = await ctx.db.insert("integrationCapabilities", {
      integrationId: fixture.integrationId,
      schoolId: fixture.schoolId,
      category: "Timetable",
      name: "Timetable",
      recordType: "timetable",
      method: "GET",
      path: "/timetable",
      purpose: "Read the signed-in student's timetable",
      scope: "personal",
      minimumRole: "student",
      pagination: "none",
      changeStrategy: "full_reconciliation",
      freshnessSlaMinutes: 60,
      contractVersion: "test-timetable-v1",
      permissionState: "read_only",
      verificationStatus: "verified",
      routeSource: "manual_verified",
      normalization: {},
      lastVerifiedAt: now,
      lastSuccessAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const syncRunId = await ctx.db.insert("externalSyncRuns", {
      integrationId: fixture.integrationId,
      schoolId: fixture.schoolId,
      accountId,
      kind: "manual",
      status: "running",
      trigger: "user",
      stage: "ingesting",
      capabilityIds: [capabilityId],
      counts: { ...emptyCounts },
      attemptCount: 1,
      nextAttemptAt: now,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("externalSyncCapabilityRuns", {
      syncRunId,
      integrationId: fixture.integrationId,
      capabilityId,
      status: "running",
      pageCount: 0,
      recordCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { capabilityId, syncRunId };
  });
}

async function commitTimetablePage(
  t: ReturnType<typeof setupTest>,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  timetable: Awaited<ReturnType<typeof insertTimetableRun>>,
  title: string,
  sourceHash: string,
  nonce: string,
) {
  const records = [
    {
      providerRecordId: "timetable-event-1",
      providerRecordKey: "timetable:math-1",
      classification: "personal" as const,
      audienceScope: "mapped_user" as const,
      providerClassId: "class-current",
      normalized: {
        title,
        startAt: "2026-09-10T08:30:00.000Z",
        endAt: "2026-09-10T09:20:00.000Z",
        location: "Room 101",
      },
      payloadVersion: "v1",
      sourceHash,
    },
  ];
  const timestamp = Date.now();
  const payloadDigest = digest({
    capabilityId: timetable.capabilityId,
    records,
    pageNumber: 1,
    progress: FULL_ROUTE_PAGE,
  });
  return t.withIdentity(alice).mutation(api.managebac.commitNormalizedPage, {
    integrationId: fixture.integrationId,
    syncRunId: timetable.syncRunId,
    capabilityId: timetable.capabilityId,
    records,
    pageNumber: 1,
    progress: FULL_ROUTE_PAGE,
    payloadDigest,
    timestamp,
    nonce,
    signature: signature(
      "sync-page",
      alice,
      fixture.integrationId,
      timetable.syncRunId,
      timestamp,
      nonce,
      payloadDigest,
    ),
  });
}

/** One signed empty page that finishes the run's route. */
async function commitEmptyPage(
  t: ReturnType<typeof setupTest>,
  identity: TestIdentity,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  run: Awaited<ReturnType<typeof insertTimetableRun>>,
  nonce: string,
  selectionRevision?: number,
) {
  const payload = {
    capabilityId: run.capabilityId,
    records: [],
    pageNumber: 1,
    progress: FULL_ROUTE_PAGE,
    ...(selectionRevision !== undefined ? { selectionRevision } : {}),
  };
  const timestamp = Date.now();
  const payloadDigest = digest(payload);
  return t.withIdentity(identity).mutation(api.managebac.commitNormalizedPage, {
    integrationId: fixture.integrationId,
    syncRunId: run.syncRunId,
    ...payload,
    payloadDigest,
    timestamp,
    nonce,
    signature: signature(
      "sync-page",
      identity,
      fixture.integrationId,
      run.syncRunId,
      timestamp,
      nonce,
      payloadDigest,
    ),
  });
}
