/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { upsertArtifactSummary } from "./orgTreeShared";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());
const identity = {
  subject: "clerk_p9_summary_writer",
  email: "p9-summary-writer@example.test",
  emailVerified: true,
};

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

async function seedActor(t: ReturnType<typeof setupTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "P9 Summary Writer School",
      slug: `p9-summary-writer-${crypto.randomUUID()}`,
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
      name: "P9 Summary Writer",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "school_admin",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId };
  });
}

async function summaryState(
  t: ReturnType<typeof setupTest>,
  artifactId: Parameters<typeof upsertArtifactSummary>[1]["_id"],
) {
  return t.run(async (ctx) => ({
    artifact: await ctx.db.get(artifactId),
    summary: await ctx.db
      .query("spectraArtifactSummaries")
      .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
      .unique(),
  }));
}

describe("P9.I3 summary-writer integration", () => {
  it("keeps the direct Agent editor projection current", async () => {
    const t = setupTest();
    const actor = await seedActor(t);
    const seeded = await t.run(async (ctx) => {
      const createdAt = Date.now() - 10_000;
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "agent",
        schemaVersion: 1,
        title: "Research coach",
        summary: "Helps with research",
        content: {
          instructions: { text: "Use evidence." },
          routing: { description: "Research questions", examples: [] },
          behavior: { boundaries: [] },
        },
        textIndex: "Research coach\nHelps with research\nUse evidence.",
        tags: ["research"],
        status: "active",
        createdAt,
        updatedAt: createdAt,
      });
      const artifact = (await ctx.db.get(artifactId))!;
      await upsertArtifactSummary(ctx, artifact);
      const proposalId = await ctx.db.insert("agentImprovementProposals", {
        agentId: artifactId,
        schoolId: actor.schoolId,
        proposedByAccountId: actor.accountId,
        evidence: "The agent needs a clearer instruction.",
        proposedPatch: { instructionsText: "Use primary evidence first." },
        expectedImpact: "More grounded answers",
        status: "proposed",
        createdAt,
        updatedAt: createdAt,
      });
      return { artifactId, proposalId, createdAt };
    });

    await t.withIdentity(identity).mutation(api.agents.decideImprovement, {
      proposalId: seeded.proposalId,
      decision: "accepted",
    });

    const state = await summaryState(t, seeded.artifactId);
    expect(state.artifact?.updatedAt).toBeGreaterThan(seeded.createdAt);
    expect(state.summary?.updatedAt).toBe(state.artifact?.updatedAt);
    expect(state.summary?.projection.updatedAt).toBe(state.artifact?.updatedAt);
    expect(state.summary?.searchText).toContain("use primary evidence first");
  });

  it("keeps the calendar migration tag and recency in the projection", async () => {
    const t = setupTest();
    const actor = await seedActor(t);
    const seeded = await t.run(async (ctx) => {
      const createdAt = Date.now() - 10_000;
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "timetable",
        schemaVersion: 1,
        title: "Legacy timetable",
        content: {
          timezone: "Europe/Madrid",
          events: [
            {
              id: "physics",
              title: "Physics",
              start: "2026-09-01T08:00:00.000Z",
              end: "2026-09-01T09:00:00.000Z",
            },
          ],
        },
        textIndex: "Legacy timetable Physics",
        tags: ["legacy"],
        status: "active",
        createdAt,
        updatedAt: createdAt,
      });
      await upsertArtifactSummary(ctx, (await ctx.db.get(artifactId))!);
      return { artifactId, createdAt };
    });

    await t.withIdentity(identity).mutation(api.calendar.ensureLegacyMigration, {});

    const state = await summaryState(t, seeded.artifactId);
    expect(state.artifact?.tags).toContain("calendar-migrated");
    expect(state.artifact?.updatedAt).toBeGreaterThan(seeded.createdAt);
    expect(state.summary?.projection.tags).toContain("calendar-migrated");
    expect(state.summary?.updatedAt).toBe(state.artifact?.updatedAt);
  });

  it("keeps a ManageBac planner rebase projection current", async () => {
    const t = setupTest();
    const actor = await seedActor(t);
    const seeded = await t.run(async (ctx) => {
      const createdAt = Date.now() - 10_000;
      const integrationId = await ctx.db.insert("schoolIntegrations", {
        schoolId: actor.schoolId,
        provider: "managebac",
        baseUrl: "https://managebac.example.test",
        authHeaderName: "X-API-Key",
        authScheme: "raw",
        status: "connected",
        tokenMode: "read_only",
        secretPurpose: "managebac",
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
          autoCreateClasses: true,
          autoImportTasks: true,
          autoApplySafeUpdates: true,
          conflictMode: "review",
        },
        freshnessSlaMinutes: 60,
        requestBudgetPerMinute: 30,
        bootstrapVersion: 1,
        createdByAccountId: actor.accountId,
        updatedByAccountId: actor.accountId,
        createdAt,
        updatedAt: createdAt,
      });
      const syncRunId = await ctx.db.insert("externalSyncRuns", {
        integrationId,
        schoolId: actor.schoolId,
        accountId: actor.accountId,
        kind: "reconciliation",
        status: "awaiting_review",
        trigger: "user",
        stage: "review",
        capabilityIds: [],
        counts: {
          fetched: 1,
          created: 0,
          updated: 1,
          unchanged: 0,
          tombstoned: 0,
          projected: 1,
          skipped: 0,
          quarantined: 0,
          conflicts: 1,
          errors: 0,
        },
        attemptCount: 1,
        nextAttemptAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
      const recordId = await ctx.db.insert("externalRecords", {
        integrationId,
        schoolId: actor.schoolId,
        providerRecordId: "task-1",
        providerRecordKey: "task:1",
        recordType: "task",
        classification: "personal",
        audienceScope: "mapped_user",
        mappedAccountId: actor.accountId,
        normalized: {
          title: "Revised physics report",
          description: "Use the revised rubric.",
          dueAt: "2026-09-10T16:00:00.000Z",
        },
        payloadVersion: "2",
        sourceHash: "new-source-hash",
        tombstone: false,
        fetchedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "planner_task",
        schemaVersion: 1,
        title: "Physics report",
        summary: "Use the old rubric.",
        content: {
          taskTitle: "Physics report",
          description: "Use the old rubric.",
          dueAt: Date.parse("2026-09-09T16:00:00.000Z"),
          source: {
            externalId: "task-1",
            version: "1",
            hash: "old-source-hash",
            status: "active",
            lockedFields: ["taskTitle", "description", "dueAt", "source"],
          },
        },
        textIndex: "Physics report Use the old rubric.",
        tags: ["managebac", "source-linked"],
        status: "active",
        createdAt,
        updatedAt: createdAt,
      });
      await upsertArtifactSummary(ctx, (await ctx.db.get(artifactId))!);
      await ctx.db.insert("externalProjections", {
        integrationId,
        schoolId: actor.schoolId,
        recordId,
        accountId: actor.accountId,
        projectionType: "planner_task",
        projectionId: String(artifactId),
        providerKey: "planner:task:1",
        sourceHash: "old-source-hash",
        state: "conflicted",
        bootstrapVersion: 1,
        createdAt,
        updatedAt: createdAt,
      });
      const conflictId = await ctx.db.insert("externalSyncConflicts", {
        syncRunId,
        integrationId,
        schoolId: actor.schoolId,
        accountId: actor.accountId,
        recordId,
        projectionType: "planner_task",
        projectionId: String(artifactId),
        kind: "customization_overlap",
        oldSource: { title: "Physics report" },
        newSource: { title: "Revised physics report" },
        affectedLinks: [String(artifactId)],
        suggestedActions: ["rebase"],
        status: "open",
        createdAt,
        updatedAt: createdAt,
      });
      return { artifactId, conflictId };
    });

    await t.withIdentity(identity).mutation(api.managebac.resolveConflict, {
      conflictId: seeded.conflictId,
      resolution: "rebase",
    });

    const state = await summaryState(t, seeded.artifactId);
    expect(state.artifact?.title).toBe("Revised physics report");
    expect(state.summary?.projection.title).toBe("Revised physics report");
    expect(state.summary?.projection.summary).toBe("Use the revised rubric.");
    expect(state.summary?.updatedAt).toBe(state.artifact?.updatedAt);
    expect(state.summary?.searchText).toContain("revised physics report");
  });

  it("keeps collaboration activity recency in the bounded projection", async () => {
    const t = setupTest();
    const actor = await seedActor(t);
    const seeded = await t.run(async (ctx) => {
      const createdAt = Date.now() - 10_000;
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "document",
        schemaVersion: 2,
        title: "Shared essay",
        content: { blocks: [] },
        textIndex: "Shared essay",
        tags: [],
        status: "active",
        createdAt,
        updatedAt: createdAt,
      });
      await upsertArtifactSummary(ctx, (await ctx.db.get(artifactId))!);
      const roomId = await ctx.db.insert("collaborationRooms", {
        artifactId,
        schoolId: actor.schoolId,
        typeKey: "document",
        provider: "self_hosted_yjs",
        partitionKey: "root",
        schemaVersion: 2,
        policyVersion: 0,
        status: "active",
        nextSequence: 1,
        snapshotSequence: 0,
        uncompactedBytes: 0,
        createdAt,
        updatedAt: createdAt,
      });
      return { artifactId, createdAt, roomId };
    });

    await t.mutation(internal.collaborationGatewayStore.append, {
      accountId: actor.accountId,
      actorKind: "human",
      artifactId: seeded.artifactId,
      partitionKey: "root",
      clientId: "p9-summary-writer",
      policyVersion: 0,
      idempotencyKey: "p9-summary-writer:1",
      expectedRoomId: seeded.roomId,
      expectedNextSequence: 1,
      update: new Uint8Array([1]).buffer,
      baseStateVectorHash: "initial-state-vector",
      stateVectorHash: "next-state-vector-1",
      regionIds: ["body"],
    });

    const state = await summaryState(t, seeded.artifactId);
    expect(state.artifact?.updatedAt).toBeGreaterThan(seeded.createdAt);
    expect(state.summary?.updatedAt).toBe(state.artifact?.updatedAt);
    expect(state.summary?.projection.updatedAt).toBe(state.artifact?.updatedAt);
  });

  it("removes the bounded projection with a migrated legacy thread artifact", async () => {
    const t = setupTest();
    const actor = await seedActor(t);
    const artifactId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "thread_reference",
        resourceClass: "thread_reference",
        title: "Legacy conversation",
        content: { threadId: "missing-thread" },
        textIndex: "Legacy conversation",
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await upsertArtifactSummary(ctx, (await ctx.db.get(id))!);
      return id;
    });

    await t.mutation(internal.spectraThreads.migrateLegacyThreadReferences, {
      limit: 10,
    });

    const state = await summaryState(t, artifactId);
    expect(state.artifact).toBeNull();
    expect(state.summary).toBeNull();
  });

  it("detaches deleted-workspace provenance from the bounded projection", async () => {
    vi.useFakeTimers();
    const t = setupTest();
    const actor = await seedActor(t);
    const asUser = t.withIdentity(identity);
    const workspaceId = await asUser.mutation(api.spectraWorkspaces.create, {
      title: "Temporary project",
    });
    const artifactId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "document",
        schemaVersion: 2,
        title: "Project brief",
        content: { blocks: [] },
        textIndex: "Project brief",
        tags: [],
        status: "active",
        createdFrom: { source: "manual", workspaceId },
        createdAt: now,
        updatedAt: now,
      });
      await upsertArtifactSummary(ctx, (await ctx.db.get(id))!);
      return id;
    });
    await asUser.mutation(api.orgTree.placeWork, {
      artifactId,
      workspaceId,
    });

    const deletion = await asUser.mutation(api.spectraWorkspaces.permanentlyDelete, {
      workspaceId,
      confirmation: "Remove Temporary project permanently",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run(ctx => ctx.db.get(deletion.jobId))).toMatchObject({
      phase: "complete", detachedArtifactCount: 1,
    });
    expect(await t.run(ctx => ctx.db.get(workspaceId))).toBeNull();

    const state = await summaryState(t, artifactId);
    expect(state.artifact).not.toBeNull();
    expect(state.summary).not.toBeNull();
    expect(state.artifact?.createdFrom?.workspaceId).toBeUndefined();
    expect(state.summary?.projection.createdFrom?.workspaceId).toBeUndefined();
  });
});
