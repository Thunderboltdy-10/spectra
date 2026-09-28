/// <reference types="vite/client" />
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const bridgeKey = "managebac-isolation-test-key-012345678901234567890";

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

async function insertSyncRun(
  t: ReturnType<typeof setupTest>,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  accountId: Id<"accounts">,
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const syncRunId = await ctx.db.insert("externalSyncRuns", {
      integrationId: fixture.integrationId,
      schoolId: fixture.schoolId,
      accountId,
      kind: "manual",
      status: "running",
      trigger: "user",
      stage: "ingesting",
      capabilityIds: [fixture.capabilityId],
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
      capabilityId: fixture.capabilityId,
      status: "running",
      pageCount: 0,
      recordCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return syncRunId;
  });
}

// These lifecycle fixtures act as a class member who explicitly opted in.
// Use the public selection mutation; do not restore implicit class following.
async function selectFixtureClass(
  t: ReturnType<typeof setupTest>,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  providerClassId: string,
) {
  const recordId = await t.run(ctx => ctx.db.insert("externalRecords", {
    integrationId: fixture.integrationId, schoolId: fixture.schoolId,
    providerRecordId: providerClassId, providerRecordKey: `class:${providerClassId}`,
    recordType: "class", classification: "personal", audienceScope: "mapped_user",
    mappedAccountId: fixture.aliceId, providerClassId, normalized: { title: providerClassId },
    payloadVersion: "fixture-v1", sourceHash: `class-${providerClassId}`, tombstone: false,
    fetchedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
  }));
  const selection = await t.withIdentity(alice).mutation(api.managebac.setSelectedClasses, { recordIds: [recordId] });
  expect(selection.selectedRecordIds).toEqual([recordId]);
  return selection;
}

async function commitPage(
  t: ReturnType<typeof setupTest>,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  identity: TestIdentity,
  syncRunId: Id<"externalSyncRuns">,
  providerRecordKey: string,
  title: string,
  sourceHash: string,
  nonce: string,
  academicPeriodKey?: string,
) {
  const records = [
    {
      providerRecordId: "assignment-overlapping-id",
      providerRecordKey,
      classification: "personal" as const,
      audienceScope: "mapped_user" as const,
      ...(academicPeriodKey ? { academicPeriodKey } : {}),
      normalized: { title, description: `${title} private source` },
      payloadVersion: "v2p2",
      sourceHash,
    },
  ];
  const timestamp = Date.now();
  const payloadDigest = digest({
    capabilityId: fixture.capabilityId,
    records,
    pageNumber: 1,
    progress: FULL_ROUTE_PAGE,
  });
  return t.withIdentity(identity).mutation(api.managebac.commitNormalizedPage, {
    integrationId: fixture.integrationId,
    syncRunId,
    capabilityId: fixture.capabilityId,
    records,
    pageNumber: 1,
    progress: FULL_ROUTE_PAGE,
    payloadDigest,
    timestamp,
    nonce,
    signature: signature(
      "sync-page",
      identity,
      fixture.integrationId,
      syncRunId,
      timestamp,
      nonce,
      payloadDigest,
    ),
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
  omitted = false,
) {
  const records = omitted ? [] : [
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

describe("ManageBac account isolation", () => {
  beforeEach(() => {
    process.env.SPECTRA_CONNECTOR_BRIDGE_KEY = bridgeKey;
  });

  afterEach(() => {
    delete process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
    vi.useRealTimers();
  });

  it("lets a new sync start soon after the request that owned a lease was killed", async () => {
    // The owning request lives at most 300 seconds. A lease that outlives it
    // by half an hour kept every Sync press busy after one killed request.
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = setupTest();
    await seedFixture(t);
    const killed = await t.withIdentity(alice).mutation(api.managebac.beginSync, { kind: "manual" });
    vi.setSystemTime(Date.now() + 60_000);
    await expect(
      t.withIdentity(alice).mutation(api.managebac.beginSync, { kind: "manual" }),
    ).rejects.toThrow("INTEGRATION_SYNC_BUSY");
    vi.setSystemTime(Date.now() + 6 * 60_000);
    // The killed request's pass is not thrown away: the next request takes
    // it over under a fresh lease and continues from its last saved page.
    const replacement = await t.withIdentity(alice).mutation(api.managebac.beginSync, { kind: "manual" });
    expect(replacement.syncRunId).toBe(killed.syncRunId);
    expect(replacement.leaseToken).not.toBe(killed.leaseToken);
    expect(await t.run((ctx) => ctx.db.get(killed.syncRunId as Id<"externalSyncRuns">))).toMatchObject({
      status: "leased", stage: "resuming", cursorState: { requests: 2 },
    });
  });

  it("reclaims an expired account sync and fences its late provider response", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    const oldRun = await t.run(async (ctx) => {
      const now = Date.now();
      const syncRunId = await ctx.db.insert("externalSyncRuns", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        accountId: fixture.aliceId,
        kind: "manual",
        status: "queued",
        trigger: "user",
        stage: "queued",
        capabilityIds: [fixture.capabilityId],
        counts: { ...emptyCounts },
        leaseOwner: "old-worker",
        leaseToken: "old-lease",
        leaseExpiresAt: now - 1,
        selectionRevision: 0,
        attemptCount: 1,
        nextAttemptAt: now,
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
      });
      await ctx.db.insert("externalSyncCapabilityRuns", {
        syncRunId,
        integrationId: fixture.integrationId,
        capabilityId: fixture.capabilityId,
        status: "queued",
        pageCount: 0,
        recordCount: 0,
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
      });
      return syncRunId;
    });

    const replacement = await t.withIdentity(alice).mutation(
      api.managebac.beginSync,
      { kind: "manual" },
    );
    expect(replacement.syncRunId).not.toBe(oldRun);

    const reclaimed = await t.run((ctx) => ctx.db.get(oldRun));
    expect(reclaimed).toMatchObject({
      status: "failed",
      stage: "lease_expired",
      errorCode: "INTEGRATION_WORKER_LEASE_EXPIRED",
    });

    const timestamp = Date.now();
    const payloadDigest = digest({
      capabilityId: fixture.capabilityId,
      records: [],
      pageNumber: 1,
      progress: FULL_ROUTE_PAGE,
      leaseToken: "old-lease",
      selectionRevision: 0,
    });
    await expect(
      t.withIdentity(alice).mutation(api.managebac.commitNormalizedPage, {
        integrationId: fixture.integrationId,
        syncRunId: oldRun,
        capabilityId: fixture.capabilityId,
        records: [],
        pageNumber: 1,
        progress: FULL_ROUTE_PAGE,
        leaseToken: "old-lease",
        selectionRevision: 0,
        payloadDigest,
        timestamp,
        nonce: "old-response",
        signature: signature(
          "sync-page",
          alice,
          fixture.integrationId,
          oldRun,
          timestamp,
          "old-response",
          payloadDigest,
        ),
      }),
    ).rejects.toThrow("INTEGRATION_SYNC_FENCED");
  });

  it("keeps two mapped accounts' ingestion and projections separate", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    const aliceRun = await insertSyncRun(t, fixture, fixture.aliceId);
    const bobRun = await insertSyncRun(t, fixture, fixture.bobId);

    await commitPage(
      t,
      fixture,
      alice,
      aliceRun,
      `account:${fixture.aliceId}:assignment:overlapping-id`,
      "Alice private assignment",
      "alice-source-v1",
      "alice-page-1",
    );
    await commitPage(
      t,
      fixture,
      bob,
      bobRun,
      `account:${fixture.bobId}:assignment:overlapping-id`,
      "Bob private assignment",
      "bob-source-v1",
      "bob-page-1",
    );

    const state = await t.run(async (ctx) => ({
      records: await ctx.db
        .query("externalRecords")
        .withIndex("by_integration_type", (q) =>
          q
            .eq("integrationId", fixture.integrationId)
            .eq("recordType", "class_resource"),
        )
        .collect(),
      projections: await ctx.db
        .query("externalProjections")
        .withIndex("by_account_updated", (q) =>
          q.eq("accountId", fixture.aliceId),
        )
        .collect(),
      bobProjections: await ctx.db
        .query("externalProjections")
        .withIndex("by_account_updated", (q) =>
          q.eq("accountId", fixture.bobId),
        )
        .collect(),
    }));
    expect(state.records).toHaveLength(2);
    expect(new Set(state.records.map((item) => item.mappedAccountId))).toEqual(
      new Set([fixture.aliceId, fixture.bobId]),
    );
    expect(state.projections).toHaveLength(1);
    expect(state.bobProjections).toHaveLength(1);
    expect(state.projections[0]!.recordId).not.toBe(
      state.bobProjections[0]!.recordId,
    );

    const aliceOverview = await t
      .withIdentity(alice)
      .query(api.managebac.myOverview, {});
    const bobOverview = await t
      .withIdentity(bob)
      .query(api.managebac.myOverview, {});
    expect(aliceOverview.records.map((item) => item.normalized.title)).toEqual([
      "Alice private assignment",
    ]);
    expect(bobOverview.records.map((item) => item.normalized.title)).toEqual([
      "Bob private assignment",
    ]);
  });

  it("scopes the same provider record id by account and academic period", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    const aliceCurrent = await insertSyncRun(t, fixture, fixture.aliceId);
    const bobCurrent = await insertSyncRun(t, fixture, fixture.bobId);
    const aliceNextYear = await insertSyncRun(t, fixture, fixture.aliceId);

    await commitPage(
      t,
      fixture,
      alice,
      aliceCurrent,
      "assignment:shared-provider-id",
      "Alice current assignment",
      "alice-current-v1",
      "same-provider-alice-current",
      "2026",
    );
    await commitPage(
      t,
      fixture,
      bob,
      bobCurrent,
      "assignment:shared-provider-id",
      "Bob current assignment",
      "bob-current-v1",
      "same-provider-bob-current",
      "2026",
    );
    await commitPage(
      t,
      fixture,
      alice,
      aliceNextYear,
      "assignment:shared-provider-id",
      "Alice next-year assignment",
      "alice-next-year-v1",
      "same-provider-alice-next-year",
      "2027",
    );

    const records = await t.run(async (ctx) =>
      ctx.db
        .query("externalRecords")
        .withIndex("by_integration_type", (q) =>
          q
            .eq("integrationId", fixture.integrationId)
            .eq("recordType", "class_resource"),
        )
        .collect(),
    );
    expect(records).toHaveLength(3);
    expect(new Set(records.map((item) => item.mappedAccountId))).toEqual(
      new Set([fixture.aliceId, fixture.bobId]),
    );
    expect(new Set(records.map((item) => item.academicPeriodKey))).toEqual(
      new Set(["2026", "2027"]),
    );
    expect(new Set(records.map((item) => item.sourceIdentityKey)).size).toBe(3);
  });

  it("derives class access from non-tombstoned memberships only", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const insert = (input: {
        providerRecordId: string;
        recordType: string;
        providerClassId?: string;
        audienceScope: "mapped_user" | "class_members";
        mappedAccountId?: typeof fixture.aliceId;
        tombstone: boolean;
        title: string;
      }) =>
        ctx.db.insert("externalRecords", {
          integrationId: fixture.integrationId,
          schoolId: fixture.schoolId,
          providerRecordId: input.providerRecordId,
          providerRecordKey: `${input.recordType}:${input.providerRecordId}`,
          recordType: input.recordType,
          classification:
            input.audienceScope === "mapped_user" ? "personal" : "class",
          audienceScope: input.audienceScope,
          mappedAccountId: input.mappedAccountId,
          providerClassId: input.providerClassId,
          normalized: { title: input.title },
          payloadVersion: "v2p2",
          sourceHash: `${input.providerRecordId}-hash`,
          tombstone: input.tombstone,
          tombstonedAt: input.tombstone ? now : undefined,
          fetchedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      await insert({
        providerRecordId: "membership-current",
        recordType: "membership",
        providerClassId: "class-current",
        audienceScope: "mapped_user",
        mappedAccountId: fixture.aliceId,
        tombstone: false,
        title: "Current membership",
      });
      await insert({
        providerRecordId: "membership-removed",
        recordType: "membership",
        providerClassId: "class-removed",
        audienceScope: "mapped_user",
        mappedAccountId: fixture.aliceId,
        tombstone: true,
        title: "Removed membership",
      });
      const currentClassId = await insert({
        providerRecordId: "class-current",
        recordType: "class",
        providerClassId: "class-current",
        audienceScope: "class_members",
        tombstone: false,
        title: "Current class",
      });
      await insert({
        providerRecordId: "class-removed",
        recordType: "class",
        providerClassId: "class-removed",
        audienceScope: "class_members",
        tombstone: false,
        title: "Removed class",
      });
      await insert({
        providerRecordId: "resource-current",
        recordType: "class_resource",
        providerClassId: "class-current",
        audienceScope: "class_members",
        tombstone: false,
        title: "Current resource",
      });
      await insert({
        providerRecordId: "resource-removed",
        recordType: "class_resource",
        providerClassId: "class-removed",
        audienceScope: "class_members",
        tombstone: false,
        title: "Removed resource",
      });
      return { currentClassId };
    });

    const asAlice = t.withIdentity(alice);
    await asAlice.mutation(api.managebac.setSelectedClasses, {
      recordIds: [seeded.currentClassId],
      expectedRevision: 0,
    });
    const resources = await asAlice.query(api.managebac.recordsForPurpose, {
      purpose: "class_resources",
    });
    const candidates = await asAlice.query(
      api.managebac.listMyClassCandidates,
      {},
    );
    const materialized = await asAlice.mutation(
      api.managebac.materializeClassWorkspaces,
      {
        recordIds: [seeded.currentClassId],
      },
    );
    expect(resources.records.map((item) => item.providerClassId)).toEqual([
      "class-current",
    ]);
    expect(candidates?.classes.map((item) => item.providerClassId)).toEqual([
      "class-current",
    ]);
    expect(materialized.created).toBe(1);
    expect(materialized.skipped).toBe(0);
  });

  it("keeps the class workspace on deselect with keep_in_spectra", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const insert = (input: {
        providerRecordId: string;
        recordType: string;
        providerClassId?: string;
        audienceScope: "mapped_user" | "class_members";
        mappedAccountId?: typeof fixture.aliceId;
        tombstone: boolean;
        title: string;
      }) =>
        ctx.db.insert("externalRecords", {
          integrationId: fixture.integrationId,
          schoolId: fixture.schoolId,
          providerRecordId: input.providerRecordId,
          providerRecordKey: `${input.recordType}:${input.providerRecordId}`,
          recordType: input.recordType,
          classification:
            input.audienceScope === "mapped_user" ? "personal" : "class",
          audienceScope: input.audienceScope,
          mappedAccountId: input.mappedAccountId,
          providerClassId: input.providerClassId,
          normalized: { title: input.title },
          payloadVersion: "v2p2",
          sourceHash: `${input.providerRecordId}-hash`,
          tombstone: input.tombstone,
          tombstonedAt: input.tombstone ? now : undefined,
          fetchedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      await insert({
        providerRecordId: "membership-keep",
        recordType: "membership",
        providerClassId: "class-keep",
        audienceScope: "mapped_user",
        mappedAccountId: fixture.aliceId,
        tombstone: false,
        title: "Keep membership",
      });
      const classId = await insert({
        providerRecordId: "class-keep",
        recordType: "class",
        providerClassId: "class-keep",
        audienceScope: "class_members",
        mappedAccountId: fixture.aliceId,
        tombstone: false,
        title: "Keep class",
      });
      return { classId };
    });

    const asAlice = t.withIdentity(alice);
    const selected = await asAlice.mutation(api.managebac.setSelectedClasses, {
      recordIds: [seeded.classId],
      expectedRevision: 0,
    });
    const materialized = await asAlice.mutation(
      api.managebac.materializeClassWorkspaces,
      { recordIds: [seeded.classId] },
    );
    expect(materialized.created).toBe(1);

    const deselected = await asAlice.mutation(api.managebac.setSelectedClasses, {
      recordIds: [],
      expectedRevision: selected.selectionRevision,
      retention: "keep_in_spectra",
    });
    expect(deselected.selectedClassIds).toEqual([]);
    expect(deselected.deselectedRecordIds).toEqual([seeded.classId]);

    const released = await asAlice.mutation(
      api.managebac.releaseClassWorkspaces,
      {
        recordIds: deselected.deselectedRecordIds ?? [seeded.classId],
        retention: "keep_in_spectra",
      },
    );
    expect(released).toMatchObject({
      kept: 1,
      removed: 0,
      skipped: 0,
      done: true,
    });

    const state = await t.run(async (ctx) => {
      const source = await ctx.db.get(seeded.classId);
      const workspaces = await ctx.db
        .query("spectraWorkspaces")
        .withIndex("by_account_starter", (q) =>
          q
            .eq("ownerAccountId", fixture.aliceId)
            .eq("starterKey", "managebac-class"),
        )
        .collect();
      const projections = await ctx.db
        .query("externalProjections")
        .withIndex("by_account_updated", (q) =>
          q.eq("accountId", fixture.aliceId),
        )
        .collect();
      const selections = await ctx.db
        .query("managebacClassSelections")
        .withIndex("by_account_integration", (q) =>
          q
            .eq("accountId", fixture.aliceId)
            .eq("integrationId", fixture.integrationId),
        )
        .collect();
      return { source, workspaces, projections, selections };
    });

    expect(state.source?.tombstone).toBe(false);
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0]?.status).toBe("active");
    expect(state.projections).toHaveLength(1);
    expect(state.projections[0]?.projectionType).toBe("workspace");
    expect(state.projections[0]?.state).not.toBe("tombstoned");
    expect(state.projections[0]?.projectionId).toBe(
      String(state.workspaces[0]?._id),
    );
    expect(state.selections.map((row) => row.selected)).toEqual([false]);
    expect(state.selections[0]?.retention).toBe("keep_in_spectra");
  });

  it("follows class-scoped data only after that member explicitly selects the class", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    const run = await insertTimetableRun(t, fixture, fixture.aliceId);
    await commitTimetablePage(t, fixture, run, "Not selected", "v1", "selection-before");
    expect(await t.run(ctx => ctx.db.query("calendarItems").collect())).toEqual([]);
    await selectFixtureClass(t, fixture, "class-current");
    await commitTimetablePage(t, fixture, run, "Selected", "v2", "selection-after");
    const selected = await t.run(ctx => ctx.db.query("calendarItems").collect());
    expect(selected).toHaveLength(1);
    expect(selected[0].title).toBe("Selected");
    await t.withIdentity(alice).mutation(api.managebac.setSelectedClasses, { recordIds: [] });
    await commitTimetablePage(t, fixture, run, "No longer followed", "v3", "selection-removed");
    expect((await t.run(ctx => ctx.db.get(selected[0]._id)))?.title).toBe("Selected");
  });

  it("refreshes a calendarItems timetable projection and removes it without duplicates", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    await selectFixtureClass(t, fixture, "class-current");
    const firstRun = await insertTimetableRun(t, fixture, fixture.aliceId);

    await commitTimetablePage(
      t,
      fixture,
      firstRun,
      "Math — Monday",
      "timetable-v1",
      "timetable-page-1",
    );
    const first = await t.run(async (ctx) => ({
      calendar: await ctx.db
        .query("calendarItems")
        .withIndex("by_source_key", (q) =>
          q.eq("ownerAccountId", fixture.aliceId).eq("sourceKey", "timetable:math-1:official_event"),
        )
        .collect(),
      projections: await ctx.db
        .query("externalProjections")
        .withIndex("by_provider_key", (q) =>
          q.eq("integrationId", fixture.integrationId).eq("providerKey", "timetable:timetable:math-1"),
        )
        .collect(),
    }));
    expect(first.calendar).toHaveLength(1);
    expect(first.projections).toHaveLength(1);
    expect(first.projections[0]?.projectionId).toBe(String(first.calendar[0]?._id));

    const guardRows = await t.run(async (ctx) => {
      const source = await ctx.db
        .query("externalRecords")
        .withIndex("by_integration_key", (q) =>
          q.eq("integrationId", fixture.integrationId).eq("providerRecordKey", "timetable:math-1"),
        )
        .unique();
      if (!source) throw new Error("timetable fixture source missing");
      const now = Date.now();
      const unrelatedCalendarId = await ctx.db.insert("calendarItems", {
        ownerAccountId: fixture.bobId,
        schoolId: fixture.schoolId,
        kind: "official_event",
        title: "Bob's unrelated event",
        allDay: false,
        timezone: "UTC",
        timePrecision: "exact",
        status: "active",
        sourceLocked: true,
        sourceProvider: "managebac",
        sourceRecordId: source._id,
        sourceKey: "unrelated:timetable-event-1",
        sourceHash: "timetable-v1",
        sourceCapabilityState: "available",
        linkedArtifactIds: [],
        revision: 1,
        createdBy: "source",
        createdAt: now,
        updatedAt: now,
      });
      const missingCalendarId = await ctx.db.insert("calendarItems", {
        ownerAccountId: fixture.aliceId,
        schoolId: fixture.schoolId,
        kind: "official_event",
        title: "Deleted calendar target",
        allDay: false,
        timezone: "UTC",
        timePrecision: "exact",
        status: "active",
        sourceLocked: true,
        sourceProvider: "managebac",
        sourceRecordId: source._id,
        sourceKey: "missing:timetable-event-1",
        sourceHash: "timetable-v1",
        sourceCapabilityState: "available",
        linkedArtifactIds: [],
        revision: 1,
        createdBy: "source",
        createdAt: now,
        updatedAt: now,
      });
      const unrelatedProjectionId = await ctx.db.insert("externalProjections", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        recordId: source._id,
        accountId: fixture.aliceId,
        projectionType: "timetable_event",
        projectionId: String(unrelatedCalendarId),
        providerKey: "timetable:unrelated:timetable-event-1",
        sourceHash: "timetable-v1",
        state: "active",
        bootstrapVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const missingProjectionId = await ctx.db.insert("externalProjections", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        recordId: source._id,
        accountId: fixture.aliceId,
        projectionType: "timetable_event",
        projectionId: String(missingCalendarId),
        providerKey: "timetable:missing:timetable-event-1",
        sourceHash: "timetable-v1",
        state: "active",
        bootstrapVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.delete(missingCalendarId);
      return { unrelatedCalendarId, unrelatedProjectionId, missingProjectionId };
    });

    const secondRun = await insertTimetableRun(t, fixture, fixture.aliceId);
    await commitTimetablePage(
      t,
      fixture,
      secondRun,
      "Math — Tuesday",
      "timetable-v2",
      "timetable-page-2",
    );
    const refreshed = await t.run(async (ctx) => ({
      calendar: await ctx.db
        .query("calendarItems")
        .withIndex("by_source_key", (q) =>
          q.eq("ownerAccountId", fixture.aliceId).eq("sourceKey", "timetable:math-1:official_event"),
        )
        .collect(),
      projection: (
        await ctx.db
          .query("externalProjections")
      .withIndex("by_provider_key", (q) =>
            q.eq("integrationId", fixture.integrationId).eq("providerKey", "timetable:timetable:math-1"),
          )
          .collect()
      )[0],
      unrelatedCalendar: await ctx.db.get(guardRows.unrelatedCalendarId),
      unrelatedProjection: await ctx.db.get(guardRows.unrelatedProjectionId),
      missingProjection: await ctx.db.get(guardRows.missingProjectionId),
    }));
    expect(refreshed.calendar).toHaveLength(1);
    expect(refreshed.calendar[0]?.title).toBe("Math — Tuesday");
    expect(refreshed.calendar[0]?.sourceHash).toBe("timetable-v2");
    expect(refreshed.projection?.projectionId).toBe(String(refreshed.calendar[0]?._id));
    expect(refreshed.unrelatedCalendar?.title).toBe("Bob's unrelated event");
    expect(refreshed.unrelatedProjection?.state).toBe("conflicted");
    expect(refreshed.missingProjection?.state).toBe("conflicted");

    const repeatRun = await insertTimetableRun(t, fixture, fixture.aliceId);
    await commitTimetablePage(
      t,
      fixture,
      repeatRun,
      "Math — Tuesday",
      "timetable-v2",
      "timetable-page-repeat",
    );
    const repeated = await t.run(async (ctx) =>
      ctx.db
        .query("calendarItems")
        .withIndex("by_source_key", (q) =>
          q.eq("ownerAccountId", fixture.aliceId).eq("sourceKey", "timetable:math-1:official_event"),
        )
        .collect(),
    );
    expect(repeated).toHaveLength(1);

    // The provider now lists no timetable: the pass reads one empty page.
    const removeRun = await insertTimetableRun(t, fixture, fixture.aliceId);
    await commitTimetablePage(t, fixture, removeRun, "", "", "timetable-empty-page", true);
    const timestamp = Date.now();
    const payloadDigest = digest({});
    await t.withIdentity(alice).mutation(api.managebac.completeSync, {
      integrationId: fixture.integrationId,
      syncRunId: removeRun.syncRunId,
      payloadDigest,
      timestamp,
      nonce: "timetable-remove-1",
      signature: signature(
        "sync-complete",
        alice,
        fixture.integrationId,
        removeRun.syncRunId,
        timestamp,
        "timetable-remove-1",
        payloadDigest,
      ),
    });
    const removed = await t.run(async (ctx) => ({
      calendar: await ctx.db
        .query("calendarItems")
        .withIndex("by_source_key", (q) =>
          q.eq("ownerAccountId", fixture.aliceId).eq("sourceKey", "timetable:math-1:official_event"),
        )
        .collect(),
      projection: (
        await ctx.db
          .query("externalProjections")
          .withIndex("by_provider_key", (q) =>
            q.eq("integrationId", fixture.integrationId).eq("providerKey", "timetable:timetable:math-1"),
          )
          .collect()
      )[0],
    }));
    expect(removed.calendar).toHaveLength(1);
    expect(removed.calendar[0]?.status).toBe("removed");
    expect(removed.projection?.state).toBe("tombstoned");
  });

  it("refreshes a legacy timetable projection in place before upgrading its id", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    await selectFixtureClass(t, fixture, "class-current");
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const sourceId = await ctx.db.insert("externalRecords", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        providerRecordId: "legacy-timetable-event-1",
        providerRecordKey: "timetable:math-1",
        recordType: "timetable",
        classification: "personal",
        audienceScope: "mapped_user",
        mappedAccountId: fixture.aliceId,
        providerClassId: "class-current",
        normalized: {
          title: "Math — Monday",
          startAt: "2026-09-10T08:30:00.000Z",
          endAt: "2026-09-10T09:20:00.000Z",
        },
        payloadVersion: "legacy-v1",
        sourceHash: "legacy-v1",
        tombstone: false,
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: fixture.aliceId,
        schoolId: fixture.schoolId,
        blueprintKey: "timetable",
        title: "Legacy timetable",
        content: {
          timezone: "UTC",
          events: [
            {
              id: "event-1",
              title: "Math — Monday",
              start: "2026-09-10T08:30:00.000Z",
              end: "2026-09-10T09:20:00.000Z",
              sourceHash: "legacy-v1",
              sourceStatus: "active",
            },
          ],
        },
        tags: ["managebac"],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const calendarId = await ctx.db.insert("calendarItems", {
        ownerAccountId: fixture.aliceId,
        schoolId: fixture.schoolId,
        kind: "official_event",
        title: "Math — Monday",
        startAt: Date.parse("2026-09-10T08:30:00.000Z"),
        endAt: Date.parse("2026-09-10T09:20:00.000Z"),
        allDay: false,
        timezone: "UTC",
        timePrecision: "exact",
        status: "active",
        sourceLocked: true,
        sourceProvider: "legacy_timetable",
        sourceRecordId: sourceId,
        sourceKey: `legacy:${artifactId}:event-1`,
        sourceHash: "legacy-v1",
        sourceCapabilityState: "available",
        linkedArtifactIds: [],
        legacyArtifactId: artifactId,
        legacyEventId: "event-1",
        revision: 1,
        createdBy: "migration",
        createdAt: now,
        updatedAt: now,
      });
      const projectionId = await ctx.db.insert("externalProjections", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        recordId: sourceId,
        accountId: fixture.aliceId,
        projectionType: "timetable_event",
        projectionId: `${artifactId}#event-1`,
        providerKey: "timetable:timetable:math-1",
        sourceHash: "legacy-v1",
        state: "active",
        bootstrapVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      return { sourceId, artifactId, calendarId, projectionId };
    });

    const run = await insertTimetableRun(t, fixture, fixture.aliceId);
    await commitTimetablePage(
      t,
      fixture,
      run,
      "Math — Tuesday",
      "legacy-v2",
      "legacy-timetable-page-1",
    );
    const state = await t.run(async (ctx) => ({
      calendar: await ctx.db.get(seeded.calendarId),
      artifact: await ctx.db.get(seeded.artifactId),
      projection: await ctx.db.get(seeded.projectionId),
      allCalendar: await ctx.db
        .query("calendarItems")
        .withIndex("by_source_record", (q) => q.eq("sourceRecordId", seeded.sourceId))
        .collect(),
    }));
    const events = Array.isArray(state.artifact?.content?.events)
      ? state.artifact.content.events
      : [];
    expect(state.allCalendar).toHaveLength(1);
    expect(state.calendar?.title).toBe("Math — Tuesday");
    expect(events[0]?.title).toBe("Math — Tuesday");
    expect(state.projection?.projectionId).toBe(String(seeded.calendarId));
  });

  it("hides foreign-school data and enforces conflict authority/link scope", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const foreignSchoolId = await ctx.db.insert("schools", {
        name: "Foreign school",
        slug: `managebac-foreign-${crypto.randomUUID()}`,
        verifiedDomains: [],
        status: "active",
        timezone: "UTC",
        policyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const foreignIntegrationId = await ctx.db.insert("schoolIntegrations", {
        schoolId: foreignSchoolId,
        provider: "managebac",
        baseUrl: "https://foreign.example.test",
        authHeaderName: "X-API-Key",
        authScheme: "raw",
        status: "connected",
        tokenMode: "read_only",
        secretPurpose: "managebac-foreign-test",
        manifestVersion: 1,
        capabilityCoverage: {
          discovered: 0,
          verifiedReadable: 0,
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
        createdByAccountId: fixture.adminId,
        updatedByAccountId: fixture.adminId,
        createdAt: now,
        updatedAt: now,
      });
      const foreignRecordId = await ctx.db.insert("externalRecords", {
        integrationId: foreignIntegrationId,
        schoolId: foreignSchoolId,
        providerRecordId: "foreign-record",
        providerRecordKey: "foreign:record",
        recordType: "class_resource",
        classification: "personal",
        audienceScope: "mapped_user",
        mappedAccountId: fixture.aliceId,
        normalized: { title: "Foreign private data" },
        payloadVersion: "v2p2",
        sourceHash: "foreign-hash",
        tombstone: false,
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const localRecordId = await ctx.db.insert("externalRecords", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        providerRecordId: "local-record",
        providerRecordKey: "local:record",
        recordType: "class_resource",
        classification: "personal",
        audienceScope: "mapped_user",
        mappedAccountId: fixture.aliceId,
        normalized: { title: "Local private data" },
        payloadVersion: "v2p2",
        sourceHash: "local-hash",
        tombstone: false,
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const aliceProjectionId = await ctx.db.insert("externalProjections", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        recordId: localRecordId,
        accountId: fixture.aliceId,
        projectionType: "resource",
        projectionId: "managebac:alice-resource",
        providerKey: "resource:local:record",
        sourceHash: "local-hash",
        state: "active",
        bootstrapVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const bobProjectionId = await ctx.db.insert("externalProjections", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        recordId: localRecordId,
        accountId: fixture.bobId,
        projectionType: "resource",
        projectionId: "managebac:bob-resource",
        providerKey: "resource:bob-target",
        sourceHash: "bob-hash",
        state: "active",
        bootstrapVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const aliceConflictId = await ctx.db.insert("externalSyncConflicts", {
        syncRunId: await ctx.db.insert("externalSyncRuns", {
          integrationId: fixture.integrationId,
          schoolId: fixture.schoolId,
          accountId: fixture.aliceId,
          kind: "manual",
          status: "awaiting_review",
          trigger: "user",
          stage: "review_conflicts",
          capabilityIds: [fixture.capabilityId],
          counts: { ...emptyCounts, conflicts: 1 },
          attemptCount: 1,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        }),
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        accountId: fixture.aliceId,
        recordId: localRecordId,
        projectionType: "resource",
        projectionId: "managebac:alice-resource",
        kind: "customization_overlap",
        oldSource: { title: "old" },
        newSource: { title: "new" },
        affectedLinks: ["managebac:alice-resource"],
        suggestedActions: ["detach", "link_existing"],
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
      const schoolConflictId = await ctx.db.insert("externalSyncConflicts", {
        syncRunId: await ctx.db.insert("externalSyncRuns", {
          integrationId: fixture.integrationId,
          schoolId: fixture.schoolId,
          kind: "reconciliation",
          status: "awaiting_review",
          trigger: "school_admin",
          stage: "review_conflicts",
          capabilityIds: [fixture.capabilityId],
          counts: { ...emptyCounts, conflicts: 1 },
          attemptCount: 1,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        }),
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        recordId: localRecordId,
        projectionType: "resource",
        projectionId: "managebac:alice-resource",
        kind: "duplicate_projection",
        oldSource: { title: "old" },
        newSource: { title: "new" },
        affectedLinks: ["managebac:alice-resource"],
        suggestedActions: ["detach"],
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
      const foreignConflictId = await ctx.db.insert("externalSyncConflicts", {
        syncRunId: await ctx.db.insert("externalSyncRuns", {
          integrationId: foreignIntegrationId,
          schoolId: foreignSchoolId,
          accountId: fixture.aliceId,
          kind: "manual",
          status: "awaiting_review",
          trigger: "user",
          stage: "review_conflicts",
          capabilityIds: [],
          counts: { ...emptyCounts, conflicts: 1 },
          attemptCount: 1,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        }),
        integrationId: foreignIntegrationId,
        schoolId: foreignSchoolId,
        accountId: fixture.aliceId,
        recordId: foreignRecordId,
        projectionType: "resource",
        projectionId: "managebac:foreign-resource",
        kind: "source_changed",
        oldSource: { title: "old" },
        newSource: { title: "new" },
        affectedLinks: [],
        suggestedActions: ["detach"],
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
      return {
        aliceConflictId,
        schoolConflictId,
        foreignConflictId,
        aliceProjectionId,
        bobProjectionId,
      };
    });

    const aliceOverview = await t
      .withIdentity(alice)
      .query(api.managebac.myOverview, {});
    expect(aliceOverview.records.map((item) => item.normalized.title)).toEqual([
      "Local private data",
    ]);
    expect(aliceOverview.conflicts.map((item) => item._id)).toEqual([
      seeded.aliceConflictId,
    ]);
    await expect(
      t.withIdentity(bob).mutation(api.managebac.resolveConflict, {
        conflictId: seeded.aliceConflictId,
        resolution: "detach",
      }),
    ).rejects.toThrow("INTEGRATION_CONFLICT_FORBIDDEN");
    await expect(
      t.withIdentity(admin).mutation(api.managebac.resolveConflict, {
        conflictId: seeded.aliceConflictId,
        resolution: "link_existing",
        linkProjectionId: "managebac:bob-resource",
      }),
    ).rejects.toThrow("INTEGRATION_CONFLICT_LINK_FORBIDDEN");
    await expect(
      t.withIdentity(bob).mutation(api.managebac.resolveConflict, {
        conflictId: seeded.schoolConflictId,
        resolution: "detach",
      }),
    ).rejects.toThrow("INTEGRATION_CONFLICT_FORBIDDEN");
    await t.withIdentity(admin).mutation(api.managebac.resolveConflict, {
      conflictId: seeded.schoolConflictId,
      resolution: "detach",
    });
    const state = await t.run(async (ctx) => ({
      aliceProjection: await ctx.db.get(seeded.aliceProjectionId),
      bobProjection: await ctx.db.get(seeded.bobProjectionId),
      schoolConflict: await ctx.db.get(seeded.schoolConflictId),
    }));
    expect(state.aliceProjection?.state).toBe("detached");
    expect(state.bobProjection?.state).toBe("detached");
    expect(state.schoolConflict?.status).toBe("resolved");
  });

  it("keeps duplicate deliveries to one logical resource but exposes receipt accounting gap", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    const aliceRun = await insertSyncRun(t, fixture, fixture.aliceId);
    const key = `account:${fixture.aliceId}:assignment:duplicate-id`;
    await commitPage(
      t,
      fixture,
      alice,
      aliceRun,
      key,
      "Duplicate source",
      "same-hash",
      "page-1-a",
    );
    await commitPage(
      t,
      fixture,
      alice,
      aliceRun,
      key,
      "Duplicate source",
      "same-hash",
      "page-1-b",
    );

    const state = await t.run(async (ctx) => ({
      records: await ctx.db
        .query("externalRecords")
        .withIndex("by_integration_type", (q) =>
          q
            .eq("integrationId", fixture.integrationId)
            .eq("recordType", "class_resource"),
        )
        .collect(),
      projections: await ctx.db
        .query("externalProjections")
        .withIndex("by_account_updated", (q) =>
          q.eq("accountId", fixture.aliceId),
        )
        .collect(),
      run: await ctx.db.get(aliceRun),
    }));
    expect(state.records).toHaveLength(1);
    expect(state.projections).toHaveLength(1);
    expect(state.run?.counts.fetched).toBe(2);
    expect(state.run?.counts.unchanged).toBe(1);
  });

  it("does not stamp archive retention on still-selected classes", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const insertClass = async (providerClassId: string) => {
        await ctx.db.insert("externalRecords", {
          integrationId: fixture.integrationId,
          schoolId: fixture.schoolId,
          providerRecordId: `membership-${providerClassId}`,
          providerRecordKey: `membership:membership-${providerClassId}`,
          recordType: "membership",
          classification: "personal",
          audienceScope: "mapped_user",
          mappedAccountId: fixture.aliceId,
          providerClassId,
          normalized: { title: `${providerClassId} membership` },
          payloadVersion: "v2p2",
          sourceHash: `membership-${providerClassId}-hash`,
          tombstone: false,
          fetchedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        return ctx.db.insert("externalRecords", {
          integrationId: fixture.integrationId,
          schoolId: fixture.schoolId,
          providerRecordId: providerClassId,
          providerRecordKey: `class:${providerClassId}`,
          recordType: "class",
          classification: "class",
          audienceScope: "class_members",
          mappedAccountId: fixture.aliceId,
          providerClassId,
          normalized: { title: providerClassId },
          payloadVersion: "v2p2",
          sourceHash: `${providerClassId}-hash`,
          tombstone: false,
          fetchedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      };
      const keepId = await insertClass("class-keep-ret");
      const dropId = await insertClass("class-drop-ret");
      return { keepId, dropId };
    });

    const asAlice = t.withIdentity(alice);
    const first = await asAlice.mutation(api.managebac.setSelectedClasses, {
      recordIds: [seeded.keepId, seeded.dropId],
      expectedRevision: 0,
      retention: "keep_in_spectra",
    });
    const second = await asAlice.mutation(api.managebac.setSelectedClasses, {
      recordIds: [seeded.keepId],
      expectedRevision: first.selectionRevision,
      retention: "archive_projection",
    });
    expect(second.retention).toBe("archive_projection");
    expect(second.deselectedRecordIds).toEqual([seeded.dropId]);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("managebacClassSelections")
        .withIndex("by_account_integration", (q) =>
          q
            .eq("accountId", fixture.aliceId)
            .eq("integrationId", fixture.integrationId),
        )
        .collect(),
    );
    const byClass = Object.fromEntries(
      rows.map((row) => [row.providerClassId, row]),
    );
    expect(byClass["class-keep-ret"]?.selected).toBe(true);
    expect(byClass["class-keep-ret"]?.retention).toBe("keep_in_spectra");
    expect(byClass["class-drop-ret"]?.selected).toBe(false);
    expect(byClass["class-drop-ret"]?.retention).toBe("archive_projection");
  });

  it("keeps personal overlay notes when a deadline source hash refreshes", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    const selection = await selectFixtureClass(t, fixture, "class-notes");
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const recordId = await ctx.db.insert("externalRecords", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        providerRecordId: "deadline-notes-1",
        providerRecordKey: "deadline:deadline-notes-1",
        recordType: "deadline",
        classification: "personal",
        audienceScope: "mapped_user",
        mappedAccountId: fixture.aliceId,
        providerClassId: "class-notes",
        normalized: {
          title: "Essay draft",
          description: "Original brief",
          dueAt: now + 86_400_000,
        },
        payloadVersion: "v2p2",
        sourceHash: "deadline-hash-v1",
        tombstone: false,
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: fixture.aliceId,
        schoolId: fixture.schoolId,
        blueprintKey: "planner_task",
        schemaVersion: 1,
        title: "Essay draft",
        summary: "Original brief",
        content: {
          taskTitle: "Essay draft",
          description: "Original brief",
          dueAt: now + 86_400_000,
          source: {
            provider: "managebac",
            externalId: "deadline-notes-1",
            version: "v2p2",
            hash: "deadline-hash-v1",
            status: "active",
            lockedFields: ["taskTitle", "description", "dueAt", "source"],
          },
          personalOverlay: {},
        },
        textIndex: "Essay draft",
        tags: ["managebac"],
        status: "active",
        createdFrom: { source: "manual", contextSummary: "test" },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("externalProjections", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        recordId,
        accountId: fixture.aliceId,
        projectionType: "planner_task",
        projectionId: artifactId,
        providerKey: `planner:${recordId}`,
        sourceHash: "deadline-hash-v1",
        state: "active",
        bootstrapVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const syncRunId = await ctx.db.insert("externalSyncRuns", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        accountId: fixture.aliceId,
        kind: "manual",
        status: "running",
        trigger: "user",
        stage: "syncing:deadlines",
        capabilityIds: [fixture.capabilityId],
        selectionRevision: selection.selectionRevision,
        leaseOwner: "overlay-notes-worker",
        leaseToken: "overlay-notes-lease",
        leaseExpiresAt: now + 120_000,
        counts: { ...emptyCounts },
        attemptCount: 1,
        nextAttemptAt: now,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return { recordId, artifactId, syncRunId };
    });

    const asAlice = t.withIdentity(alice);
    await asAlice.mutation(api.managebac.setOverlay, {
      recordId: seeded.recordId,
      notes: "Personal study plan — keep me",
      completion: false,
    });

    const records = [
      {
        providerRecordId: "deadline-notes-1",
        providerRecordKey: "deadline:deadline-notes-1",
        classification: "personal" as const,
        audienceScope: "mapped_user" as const,
        providerClassId: "class-notes",
        normalized: {
          title: "Essay draft",
          description: "Updated school brief",
          dueAt: now + 2 * 86_400_000,
        },
        payloadVersion: "v2p2",
        sourceHash: "deadline-hash-v2",
      },
    ];
    const timestamp = Date.now();
    const payloadDigest = digest({
      capabilityId: fixture.capabilityId,
      records,
      pageNumber: 1,
      progress: FULL_ROUTE_PAGE,
      leaseToken: "overlay-notes-lease",
    });
    await asAlice.mutation(api.managebac.commitNormalizedPage, {
      integrationId: fixture.integrationId,
      syncRunId: seeded.syncRunId,
      capabilityId: fixture.capabilityId,
      records,
      pageNumber: 1,
      progress: FULL_ROUTE_PAGE,
      payloadDigest,
      timestamp,
      nonce: "overlay-notes-nonce",
      leaseToken: "overlay-notes-lease",
      signature: signature(
        "sync-page",
        alice,
        fixture.integrationId,
        seeded.syncRunId,
        timestamp,
        "overlay-notes-nonce",
        payloadDigest,
      ),
    });

    const state = await t.run(async (ctx) => {
      const overlay = await ctx.db
        .query("externalRecordOverlays")
        .withIndex("by_record_account", (q) =>
          q.eq("recordId", seeded.recordId).eq("accountId", fixture.aliceId),
        )
        .unique();
      const conflicts = (
        await ctx.db.query("externalSyncConflicts").collect()
      ).filter((item) => item.syncRunId === seeded.syncRunId);
      return { overlay, conflicts };
    });
    expect(state.overlay?.notes).toBe("Personal study plan — keep me");
    expect(state.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(state.conflicts.some((item) => item.status === "open")).toBe(true);

    // Partial update must not wipe notes.
    await asAlice.mutation(api.managebac.setOverlay, {
      recordId: seeded.recordId,
      completion: true,
    });
    const afterPartial = await t.run(async (ctx) =>
      ctx.db
        .query("externalRecordOverlays")
        .withIndex("by_record_account", (q) =>
          q.eq("recordId", seeded.recordId).eq("accountId", fixture.aliceId),
        )
        .unique(),
    );
    expect(afterPartial?.notes).toBe("Personal study plan — keep me");
    expect(afterPartial?.completion).toBe(true);
  });

});
