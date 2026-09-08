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

async function commitPage(
  t: ReturnType<typeof setupTest>,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  identity: TestIdentity,
  syncRunId: Id<"externalSyncRuns">,
  providerRecordKey: string,
  title: string,
  sourceHash: string,
  nonce: string,
) {
  const records = [
    {
      providerRecordId: "assignment-overlapping-id",
      providerRecordKey,
      classification: "personal" as const,
      audienceScope: "mapped_user" as const,
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
  });
  return t.withIdentity(identity).mutation(api.managebac.commitNormalizedPage, {
    integrationId: fixture.integrationId,
    syncRunId,
    capabilityId: fixture.capabilityId,
    records,
    pageNumber: 1,
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

describe("ManageBac account isolation", () => {
  beforeEach(() => {
    process.env.SPECTRA_CONNECTOR_BRIDGE_KEY = bridgeKey;
  });

  afterEach(() => {
    delete process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
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
});
