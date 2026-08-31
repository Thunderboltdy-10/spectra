/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ensureCasDeadlineProjection } from "./managebac";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

const studentIdentity = {
  subject: "clerk_cas_student",
  email: "cas-student@example.test",
  emailVerified: true,
};

const otherIdentity = {
  subject: "clerk_cas_other",
  email: "cas-other@example.test",
  emailVerified: true,
};

async function seedCas(t: ReturnType<typeof setupTest>) {
  return t.run(async (ctx) => {
    const now = Date.parse("2026-08-31T10:00:00.000Z");
    const schoolId = await ctx.db.insert("schools", {
      name: "CAS Contract School",
      slug: `cas-contract-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: studentIdentity.subject,
      email: studentIdentity.email,
      emailVerified: true,
      name: "CAS Student",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const otherAccountId = await ctx.db.insert("accounts", {
      clerkId: otherIdentity.subject,
      email: otherIdentity.email,
      emailVerified: true,
      name: "Other Student",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    for (const memberAccountId of [accountId, otherAccountId])
      await ctx.db.insert("schoolMemberships", {
        accountId: memberAccountId,
        schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    const integrationId = await ctx.db.insert("schoolIntegrations", {
      schoolId,
      provider: "managebac",
      baseUrl: "https://api.example.invalid",
      authHeaderName: "auth-token",
      authScheme: "raw",
      status: "connected",
      tokenMode: "read_only",
      secretPurpose: "managebac-api-token",
      providerVersion: "v2p2",
      manifestVersion: 1,
      capabilityCoverage: {
        discovered: 1,
        verifiedReadable: 1,
        unverified: 0,
        failed: 0,
        quarantined: 0,
      },
      syncPolicy: {
        frequencyMinutes: 180,
        autoCreateClasses: false,
        autoImportTasks: true,
        autoApplySafeUpdates: true,
        conflictMode: "review",
      },
      freshnessSlaMinutes: 60,
      requestBudgetPerMinute: 30,
      bootstrapVersion: 1,
      lastValidatedAt: now,
      lastSyncAt: now,
      nextSyncAt: now + 180 * 60_000,
      createdByAccountId: accountId,
      updatedByAccountId: accountId,
      createdAt: now,
      updatedAt: now,
    });
    const capabilityId = await ctx.db.insert("integrationCapabilities", {
      integrationId,
      schoolId,
      category: "CAS",
      name: "My CAS experiences",
      recordType: "cas_experience",
      method: "GET",
      path: "/v2p2/year-groups/{year_group_id}/projects/cas/experiences/students?student_ids={student_id}",
      purpose: "Retrieve CAS experiences for the signed-in student.",
      scope: "personal",
      minimumRole: "student",
      pagination: "page",
      changeStrategy: "full_reconciliation",
      freshnessSlaMinutes: 60,
      contractVersion: "v2p2",
      permissionState: "read_only",
      verificationStatus: "verified",
      routeSource: "manual_verified",
      personalIdParameter: "student_id",
      normalization: {},
      lastVerifiedAt: now,
      lastSuccessAt: now,
      createdAt: now,
      updatedAt: now,
    });
    for (const [mappedAccountId, providerUserId] of [
      [accountId, "11001"],
      [otherAccountId, "11002"],
    ] as const)
      await ctx.db.insert("externalIdentityMappings", {
        integrationId,
        schoolId,
        accountId: mappedAccountId,
        providerUserId,
        verifiedEmailHash: `verified-${providerUserId}`,
        status: "verified",
        evidenceCapabilityId: capabilityId,
        matchCount: 1,
        resolvedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    const endAt = Date.parse("2026-10-31T00:00:00.000Z");
    const sourceId = await ctx.db.insert("externalRecords", {
      integrationId,
      schoolId,
      providerRecordId: "18001",
      providerRecordKey: "cas_experience:18001",
      recordType: "cas_experience",
      classification: "personal",
      audienceScope: "mapped_user",
      mappedAccountId: accountId,
      normalized: {
        title: "Community garden",
        description: "Plan and maintain a shared community garden.",
        status: "approved",
        startAt: "2026-08-01",
        endAt,
        creativity: false,
        activity: true,
        service: true,
        creativityHours: 0,
        activityHours: 4,
        serviceHours: 8,
      },
      payloadVersion: "v2p2",
      sourceHash: "cas-source-v1",
      sourceModifiedAt: now,
      provenanceUrl: "https://example.invalid/cas/18001",
      tombstone: false,
      fetchedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return {
      accountId,
      otherAccountId,
      schoolId,
      integrationId,
      sourceId,
      endAt,
    };
  });
}

describe("P13.I4 CAS productization", () => {
  it("returns verified experiences with explicit native reflection and evidence boundaries", async () => {
    const t = setupTest();
    const fixture = await seedCas(t);

    const overview = await t
      .withIdentity(studentIdentity)
      .query(api.managebac.casOverview, {});

    expect(overview).toMatchObject({
      connected: true,
      identityRequired: false,
      stale: false,
      boundary: {
        experiences: { sync: "verified" },
        reflections: {
          sync: "spectra_native_only",
          providerPermission: "unverified",
          providerPath: null,
        },
        evidence: {
          sync: "not_available",
          providerPermission: "unverified",
          providerPath: null,
        },
      },
    });
    expect(overview.experiences).toHaveLength(1);
    expect(overview.experiences[0]).toMatchObject({
      recordId: fixture.sourceId,
      title: "Community garden",
      status: "approved",
      endAt: fixture.endAt,
      strands: { creativity: false, activity: true, service: true },
      hours: { creativity: 0, activity: 4, service: 8 },
      linkedReflections: [],
    });
  });

  it("creates, places, and permission-binds a Spectra-native reflection", async () => {
    const t = setupTest();
    const fixture = await seedCas(t);

    const created = await t
      .withIdentity(studentIdentity)
      .mutation(api.managebac.createCasReflectionDraft, {
        recordId: fixture.sourceId,
      });
    const state = await t.run(async (ctx) => {
      const artifactId = created.artifactId as Id<"spectraArtifacts">;
      return {
        artifact: await ctx.db.get(artifactId),
        overlay: await ctx.db
          .query("externalRecordOverlays")
          .withIndex("by_record_account", (q) =>
            q
              .eq("recordId", fixture.sourceId)
              .eq("accountId", fixture.accountId),
          )
          .unique(),
        node: await ctx.db
          .query("orgNodes")
          .withIndex("by_account_kind_source", (q) =>
            q
              .eq("accountId", fixture.accountId)
              .eq("kind", "work")
              .eq("sourceId", String(artifactId)),
          )
          .unique(),
      };
    });
    expect(state.artifact).toMatchObject({
      blueprintKey: "document",
      ownerAccountId: fixture.accountId,
      schoolId: fixture.schoolId,
      tags: ["cas", "reflection", "managebac-linked"],
      status: "active",
    });
    expect(state.artifact?.content).toMatchObject({
      sources: [
        {
          id: `managebac:${fixture.sourceId}`,
          sourceType: "school",
          authority: "primary",
          verified: true,
        },
      ],
    });
    expect(state.node).toMatchObject({
      kind: "work",
      sourceId: String(created.artifactId),
    });
    expect(state.node?.deletedAt).toBeUndefined();
    expect(state.overlay?.linkedArtifactIds).toEqual([created.artifactId]);
    expect(created.prompt).toContain(`record id \"${fixture.sourceId}\"`);
    expect(created.prompt).toContain("get_school_data");
    expect(created.prompt).toContain("sync is unverified");

    const records = await t
      .withIdentity(studentIdentity)
      .query(api.managebac.recordsForPurpose, { purpose: "cas" });
    expect(records.boundary.reflections.providerPath).toBeNull();
    expect(records.records[0]?.linkedReflections).toEqual([
      expect.objectContaining({
        artifactId: created.artifactId,
        title: "Community garden reflection",
      }),
    ]);

    await expect(
      t
        .withIdentity(otherIdentity)
        .mutation(api.managebac.createCasReflectionDraft, {
          recordId: fixture.sourceId,
        }),
    ).rejects.toThrow("CAS_EXPERIENCE_FORBIDDEN");
  });

  it("projects one official CAS deadline and one schedulable task without inventing dates", async () => {
    const t = setupTest();
    const fixture = await seedCas(t);

    await t.run(async (ctx) => {
      const [integration, source] = await Promise.all([
        ctx.db.get(fixture.integrationId),
        ctx.db.get(fixture.sourceId),
      ]);
      if (!integration || !source) throw new Error("missing CAS fixture");
      await ensureCasDeadlineProjection(
        ctx,
        integration,
        fixture.accountId,
        source,
      );
      await ensureCasDeadlineProjection(
        ctx,
        integration,
        fixture.accountId,
        source,
      );
    });
    let state = await t.run(async (ctx) => ({
      items: await ctx.db
        .query("calendarItems")
        .withIndex("by_source_record", (q) =>
          q.eq("sourceRecordId", fixture.sourceId),
        )
        .collect(),
      projections: await ctx.db
        .query("externalProjections")
        .withIndex("by_record_type", (q) =>
          q
            .eq("recordId", fixture.sourceId)
            .eq("projectionType", "timetable_event"),
        )
        .collect(),
    }));
    expect(state.items).toHaveLength(2);
    expect(state.items.map((item) => item.kind).sort()).toEqual([
      "official_deadline",
      "task",
    ]);
    expect(state.items.every((item) => item.status === "active")).toBe(true);
    expect(
      state.items.find((item) => item.kind === "official_deadline")?.startAt,
    ).toBe(fixture.endAt);
    expect(state.projections).toHaveLength(1);
    expect(state.projections[0]).toMatchObject({
      providerKey: "cas_deadline:cas_experience:18001",
      state: "active",
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.sourceId, {
        normalized: {
          title: "Community garden",
          status: "approved",
          service: true,
        },
        sourceHash: "cas-source-no-date",
        updatedAt: Date.now(),
      });
      const [integration, source] = await Promise.all([
        ctx.db.get(fixture.integrationId),
        ctx.db.get(fixture.sourceId),
      ]);
      if (!integration || !source) throw new Error("missing CAS fixture");
      await ensureCasDeadlineProjection(
        ctx,
        integration,
        fixture.accountId,
        source,
      );
    });
    state = await t.run(async (ctx) => ({
      items: await ctx.db
        .query("calendarItems")
        .withIndex("by_source_record", (q) =>
          q.eq("sourceRecordId", fixture.sourceId),
        )
        .collect(),
      projections: await ctx.db
        .query("externalProjections")
        .withIndex("by_record_type", (q) =>
          q
            .eq("recordId", fixture.sourceId)
            .eq("projectionType", "timetable_event"),
        )
        .collect(),
    }));
    expect(state.items).toHaveLength(2);
    expect(state.items.every((item) => item.status === "removed")).toBe(true);
    expect(state.projections[0]?.state).toBe("tombstoned");

    const undatedId = await t.run((ctx) => {
      const now = Date.now();
      return ctx.db.insert("externalRecords", {
        integrationId: fixture.integrationId,
        schoolId: fixture.schoolId,
        providerRecordId: "18002",
        providerRecordKey: "cas_experience:18002",
        recordType: "cas_experience",
        classification: "personal",
        audienceScope: "mapped_user",
        mappedAccountId: fixture.accountId,
        normalized: { title: "Undated CAS experience", service: true },
        payloadVersion: "v2p2",
        sourceHash: "cas-undated",
        tombstone: false,
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });
    await t.run(async (ctx) => {
      const [integration, source] = await Promise.all([
        ctx.db.get(fixture.integrationId),
        ctx.db.get(undatedId),
      ]);
      if (!integration || !source) throw new Error("missing CAS fixture");
      const result = await ensureCasDeadlineProjection(
        ctx,
        integration,
        fixture.accountId,
        source,
      );
      expect(result.projected).toBe(false);
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("calendarItems")
          .withIndex("by_source_record", (q) =>
            q.eq("sourceRecordId", undatedId),
          )
          .collect(),
      ),
    ).toEqual([]);
  });
});
