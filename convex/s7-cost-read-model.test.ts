/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ownerIdentity = {
  subject: "clerk_s7_cost_owner",
  email: "s7-cost-owner@example.test",
  emailVerified: true,
};
const peerIdentity = {
  subject: "clerk_s7_cost_peer",
  email: "s7-cost-peer@example.test",
  emailVerified: true,
};

const LARGE_ARTIFACT_MARKER = "S7-LARGE-ARTIFACT-CONTENT-";
const RUN_PLAN_MARKER = "S7-RUN-PLAN-PAYLOAD-";
const RUN_CONTEXT_MARKER = "S7-RUN-CONTEXT-PAYLOAD-";
const CARD_EVIDENCE_MARKER = "S7-CARD-EVIDENCE-PAYLOAD-";

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe("S7-COST compact authoritative read model", () => {
  it("measures migrated list/status reads and keeps permissions immediate", async () => {
    const t = setupTest();
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "S7 Cost School",
        slug: `s7-cost-${crypto.randomUUID()}`,
        verifiedDomains: [],
        status: "active",
        timezone: "Europe/Madrid",
        policyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const ownerAccountId = await ctx.db.insert("accounts", {
        clerkId: ownerIdentity.subject,
        email: ownerIdentity.email,
        emailVerified: true,
        name: "S7 Owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const peerAccountId = await ctx.db.insert("accounts", {
        clerkId: peerIdentity.subject,
        email: peerIdentity.email,
        emailVerified: true,
        name: "S7 Peer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId: ownerAccountId,
        schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId: peerAccountId,
        schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const workspaceId = await ctx.db.insert("spectraWorkspaces", {
        ownerAccountId,
        schoolId,
        title: "S7 Measured Workspace",
        status: "active",
        defaultView: "cards",
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      });
      const largeThreadId = await ctx.db.insert("spectraThreads", {
        ownerAccountId,
        schoolId,
        title: "Large target thread",
        origin: "workspace",
        workspaceId,
        status: "active",
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      const smallThreadId = await ctx.db.insert("spectraThreads", {
        ownerAccountId,
        schoolId,
        title: "Small target thread",
        origin: "workspace",
        workspaceId,
        status: "active",
        messageCount: 0,
        createdAt: now + 1,
        updatedAt: now + 1,
      });
      const largeBody = LARGE_ARTIFACT_MARKER.repeat(7_000);
      const largeArtifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId,
        schoolId,
        blueprintKey: "document",
        schemaVersion: 2,
        title: "Large authored document",
        summary: "A small displayed summary",
        content: { blocks: [{ id: "body", type: "paragraph", text: largeBody }] },
        textIndex: largeBody,
        protectedBaseContent: { blocks: [{ id: "base", text: largeBody }] },
        protectedBaseTextIndex: largeBody,
        tags: ["measured", "document"],
        status: "active",
        createdFrom: {
          source: "ai",
          threadId: largeThreadId,
          workspaceId,
        },
        createdAt: now,
        updatedAt: now,
      });
      const smallArtifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId,
        schoolId,
        blueprintKey: "document",
        schemaVersion: 2,
        title: "Small authored document",
        summary: "A small displayed summary",
        content: { blocks: [{ id: "body", type: "paragraph", text: "small" }] },
        textIndex: "small",
        tags: ["measured", "document"],
        status: "active",
        createdFrom: {
          source: "ai",
          threadId: smallThreadId,
          workspaceId,
        },
        createdAt: now + 1,
        updatedAt: now + 1,
      });
      await ctx.db.patch(largeThreadId, { artifactId: largeArtifactId });
      await ctx.db.patch(smallThreadId, { artifactId: smallArtifactId });
      const largeRunId = await ctx.db.insert("spectraAiRuns", {
        ownerAccountId,
        schoolId,
        sourceSurface: "artifact",
        threadId: largeThreadId,
        workspaceId,
        artifactId: largeArtifactId,
        status: "running",
        phase: "reading",
        userPrompt: "P".repeat(8_000),
        planIntent: { privatePlan: RUN_PLAN_MARKER.repeat(5_000) },
        contextSnapshot: { privateContext: RUN_CONTEXT_MARKER.repeat(5_000) },
        dockSummary: {
          checkpointSummary: "Reading the selected document",
          recentSteps: Array.from({ length: 20 }, (_, index) => `step-${index}-${"S".repeat(700)}`),
          inputRequest: {
            kind: "choice",
            messageId: "s7-choice-message",
            prompt: "Which section should be edited? ".repeat(100),
            options: Array.from({ length: 50 }, (_, index) => ({
              key: `section-${index}`,
              title: `Section ${index} ${"O".repeat(300)}`,
              description: "D".repeat(500),
            })),
          },
        },
        executionId: "s7-large-execution",
        attemptId: "s7-large-attempt",
        outcome: "executing",
        attemptCount: 1,
        eventSequence: 4,
        createdAt: now,
        updatedAt: now + 2,
      });
      const smallRunId = await ctx.db.insert("spectraAiRuns", {
        ownerAccountId,
        schoolId,
        sourceSurface: "artifact",
        threadId: smallThreadId,
        workspaceId,
        artifactId: smallArtifactId,
        status: "completed",
        phase: "completed",
        userPrompt: "Small completed request",
        finalSummary: "Small result",
        executionId: "s7-small-execution",
        outcome: "answer_only",
        createdAt: now + 1,
        updatedAt: now + 3,
      });
      await ctx.db.patch(largeArtifactId, {
        aiRunId: largeRunId,
        aiExecutionId: "s7-large-execution",
        aiState: "updating",
        aiProgress: 0.45,
        updatedAt: now + 2,
      });
      await ctx.db.patch(smallArtifactId, {
        aiRunId: smallRunId,
        aiExecutionId: "s7-small-execution",
        updatedAt: now + 3,
      });
      const largeCardId = await ctx.db.insert("spectraResultCards", {
        runId: largeRunId,
        surface: "artifact",
        workspaceId,
        artifactId: largeArtifactId,
        status: "running",
        variant: "status",
        title: "Large run status",
        summary: "Small card summary",
        actions: [],
        provenance: { privateEvidence: CARD_EVIDENCE_MARKER.repeat(5_000) },
        createdAt: now,
        updatedAt: now + 2,
      });
      const smallCardId = await ctx.db.insert("spectraResultCards", {
        runId: smallRunId,
        surface: "artifact",
        workspaceId,
        artifactId: smallArtifactId,
        status: "completed",
        variant: "status",
        title: "Small run status",
        summary: "Small card summary",
        actions: [],
        createdAt: now + 1,
        updatedAt: now + 3,
      });
      const largeTabId = await ctx.db.insert("spectraRunTabs", {
        ownerAccountId,
        schoolId,
        runId: largeRunId,
        threadId: largeThreadId,
        workspaceId,
        surface: "artifact",
        selected: true,
        createdAt: now,
        updatedAt: now + 2,
      });
      const smallTabId = await ctx.db.insert("spectraRunTabs", {
        ownerAccountId,
        schoolId,
        runId: smallRunId,
        threadId: smallThreadId,
        workspaceId,
        surface: "artifact",
        selected: false,
        createdAt: now + 1,
        updatedAt: now + 3,
      });
      await ctx.db.patch(largeThreadId, { lastRunId: largeRunId });
      await ctx.db.patch(smallThreadId, { lastRunId: smallRunId });
      const peerGrantId = await ctx.db.insert("accessGrants", {
        schoolId,
        resourceType: "artifact",
        resourceId: String(largeArtifactId),
        principalType: "account",
        principalId: String(peerAccountId),
        level: "read",
        capabilities: ["read", "use", "comment"],
        source: "direct",
        createdByAccountId: ownerAccountId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("orgNodes", {
        accountId: ownerAccountId,
        schoolId,
        kind: "work",
        sourceId: String(largeArtifactId),
        name: "Large authored document",
        typeKey: "document",
        parentId: null,
        orderKey: "a0",
        activityAt: now + 2,
        workspaceContextId: workspaceId,
        placedByAccountId: ownerAccountId,
        accessProjection: true,
        createdAt: now,
        updatedAt: now + 2,
      });
      await ctx.db.insert("orgNodes", {
        accountId: ownerAccountId,
        schoolId,
        kind: "work",
        sourceId: String(smallArtifactId),
        name: "Small authored document",
        typeKey: "document",
        parentId: null,
        orderKey: "a1",
        activityAt: now + 3,
        workspaceContextId: workspaceId,
        placedByAccountId: ownerAccountId,
        accessProjection: true,
        createdAt: now + 1,
        updatedAt: now + 3,
      });
      return {
        schoolId,
        ownerAccountId,
        peerAccountId,
        workspaceId,
        largeThreadId,
        smallThreadId,
        largeArtifactId,
        smallArtifactId,
        largeRunId,
        smallRunId,
        largeCardId,
        smallCardId,
        largeTabId,
        smallTabId,
        peerGrantId,
      };
    });

    const owner = t.withIdentity(ownerIdentity);
    await t.mutation(internal.spectraArtifacts.backfillSummaries, { cursor: null });

    let tabCursor: string | null = null;
    const tabPages: Array<{ updated: number; cursor: string | null; done: boolean }> = [];
    do {
      const page: { updated: number; cursor: string | null; done: boolean } = await t.mutation(internal.spectraRuns.backfillRunTabProjections, {
        limit: 1,
        cursor: tabCursor,
      });
      tabPages.push(page);
      tabCursor = page.cursor;
    } while (tabCursor !== null);
    expect(tabPages).toHaveLength(2);
    expect(tabPages.every((page) => page.updated === 1)).toBe(true);
    expect(tabPages[1]?.done).toBe(true);
    const tabRetry = await t.mutation(internal.spectraRuns.backfillRunTabProjections, {
      limit: 1,
      cursor: null,
    });
    expect(tabRetry.updated).toBe(0);
    expect(tabRetry.cursor).not.toBeNull();

    let cardCursor: string | null = null;
    const cardPages: Array<{ updated: number; cursor: string | null; done: boolean }> = [];
    do {
      const page: { updated: number; cursor: string | null; done: boolean } = await t.mutation(internal.spectraRuns.backfillResultCardReadModels, {
        limit: 1,
        cursor: cardCursor,
      });
      cardPages.push(page);
      cardCursor = page.cursor;
    } while (cardCursor !== null);
    expect(cardPages).toHaveLength(2);
    expect(cardPages.every((page) => page.updated === 1)).toBe(true);
    expect(cardPages[1]?.done).toBe(true);
    const cardRetry = await t.mutation(internal.spectraRuns.backfillResultCardReadModels, {
      limit: 1,
      cursor: null,
    });
    expect(cardRetry.updated).toBe(0);
    expect(cardRetry.cursor).not.toBeNull();

    const outputs = {
      library: await owner.query(api.spectraArtifacts.list, {
        status: "active",
        search: "Large",
        limit: 20,
      }),
      workspace: await owner.query(api.orgTree.listWorkspaceContents, {
        workspaceId: fixture.workspaceId,
        includeDetails: false,
      }),
      children: await owner.query(api.orgTree.listChildren, {
        parentId: null,
        paginationOpts: { numItems: 20, cursor: null },
      }),
      treeSearch: await owner.query(api.orgTree.search, {
        term: "Large",
        limit: 20,
      }),
      threads: await owner.query(api.spectraThreads.list, { limit: 20 }),
      thread: await owner.query(api.spectraThreads.get, {
        threadId: fixture.largeThreadId,
      }),
      tabs: await owner.query(api.spectraRuns.listTabs, {
        threadId: fixture.largeThreadId,
        surface: "artifact",
        limit: 10,
      }),
      cards: await owner.query(api.spectraRuns.listResultCards, {
        artifactId: fixture.largeArtifactId,
        limit: 10,
      }),
      recent: await owner.query(api.spectraRuns.listRecent, {
        surface: "artifact",
        limit: 10,
      }),
    };
    const encodedOutputs = JSON.stringify(outputs);
    expect(encodedOutputs).not.toContain(LARGE_ARTIFACT_MARKER);
    expect(encodedOutputs).not.toContain(RUN_PLAN_MARKER);
    expect(encodedOutputs).not.toContain(RUN_CONTEXT_MARKER);
    expect(encodedOutputs).not.toContain(CARD_EVIDENCE_MARKER);
    expect(outputs.library).toHaveLength(1);
    expect(outputs.workspace.items).toHaveLength(2);
    expect(outputs.children.page).toHaveLength(2);
    expect(outputs.treeSearch.results).toHaveLength(1);
    expect(outputs.threads.threads).toHaveLength(2);
    expect(outputs.tabs).toHaveLength(1);
    expect(outputs.cards).toHaveLength(1);
    expect(outputs.recent).toHaveLength(2);
    expect(outputs.tabs[0]?.run.userPrompt).toHaveLength(2_000);
    expect(outputs.tabs[0]?.run).not.toHaveProperty("planIntent");
    expect(outputs.tabs[0]?.run).not.toHaveProperty("contextSnapshot");
    expect(outputs.tabs[0]?.recentSteps).toHaveLength(6);

    // Hot reads stay compact, while an explicit selection still hydrates the
    // canonical body for the editor/detail workflow.
    const selected = await owner.query(api.spectraArtifacts.get, {
      artifactId: fixture.largeArtifactId,
    });
    expect(JSON.stringify(selected)).toContain(LARGE_ARTIFACT_MARKER);

    const measured = await t.run(async (ctx) => {
      const [largeArtifact, smallArtifact, largeSummary, smallSummary, largeRun, largeTab, largeCard, largeCardSummary] = await Promise.all([
        ctx.db.get(fixture.largeArtifactId),
        ctx.db.get(fixture.smallArtifactId),
        ctx.db.query("spectraArtifactSummaries").withIndex("by_artifact", (q) => q.eq("artifactId", fixture.largeArtifactId)).unique(),
        ctx.db.query("spectraArtifactSummaries").withIndex("by_artifact", (q) => q.eq("artifactId", fixture.smallArtifactId)).unique(),
        ctx.db.get(fixture.largeRunId),
        ctx.db.get(fixture.largeTabId),
        ctx.db.get(fixture.largeCardId),
        ctx.db.query("spectraResultCardSummaries").withIndex("by_card", (q) => q.eq("cardId", fixture.largeCardId)).unique(),
      ]);
      const counts = {
        artifacts: (await ctx.db.query("spectraArtifacts").take(20)).length,
        artifactSummaries: (await ctx.db.query("spectraArtifactSummaries").take(20)).length,
        runs: (await ctx.db.query("spectraAiRuns").take(20)).length,
        tabs: (await ctx.db.query("spectraRunTabs").take(20)).length,
        cards: (await ctx.db.query("spectraResultCards").take(20)).length,
        cardSummaries: (await ctx.db.query("spectraResultCardSummaries").take(20)).length,
        readModelMigrations: (await ctx.db.query("spectraReadModelMigrations").take(20)).length,
      };
      return {
        counts,
        artifactBytes: {
          large: bytes(largeArtifact),
          small: bytes(smallArtifact),
        },
        summaryBytes: {
          large: bytes(largeSummary),
          small: bytes(smallSummary),
        },
        canonicalRunBytes: bytes(largeRun),
        storedTabBytes: bytes(largeTab),
        storedCardBytes: bytes(largeCard),
        storedCardSummaryBytes: bytes(largeCardSummary),
        compactTabResponseBytes: bytes(outputs.tabs),
        compactCardResponseBytes: bytes(outputs.cards),
        compactWorkspaceResponseBytes: bytes(outputs.workspace),
      };
    });
    expect(measured.counts).toEqual({
      artifacts: 2,
      artifactSummaries: 2,
      runs: 2,
      tabs: 2,
      cards: 2,
      cardSummaries: 2,
      readModelMigrations: 1,
    });
    expect(measured.artifactBytes.large).toBeGreaterThan(100_000);
    expect(measured.artifactBytes.large).toBeGreaterThan(measured.artifactBytes.small * 20);
    expect(measured.summaryBytes.large).toBeLessThan(10_000);
    expect(measured.summaryBytes.small).toBeLessThan(10_000);
    // The bounded search index intentionally retains at most 1,400 normalized
    // characters; it is the only body-size-dependent part of this metadata
    // row, so its delta is capped while the canonical body can grow freely.
    expect(measured.summaryBytes.large - measured.summaryBytes.small).toBeLessThan(1_600);
    expect(measured.storedTabBytes).toBeLessThan(measured.canonicalRunBytes / 10);
    expect(measured.storedCardSummaryBytes).toBeLessThan(10_000);
    expect(measured.storedCardSummaryBytes).toBeLessThan(measured.storedCardBytes / 10);
    expect(measured.compactTabResponseBytes).toBeLessThan(20_000);
    expect(measured.compactCardResponseBytes).toBeLessThan(20_000);
    console.info("S7_COST_MEASUREMENT", JSON.stringify(measured));

    await owner.mutation(api.authority.revoke, {
      resourceType: "artifact",
      resourceId: String(fixture.largeArtifactId),
      grantId: fixture.peerGrantId,
    });
    const peerList = await t.withIdentity(peerIdentity).query(api.spectraArtifacts.list, {
      status: "active",
      limit: 20,
    });
    expect(
      (peerList as Array<{ _id?: string }>).some(
        (row) => row._id === fixture.largeArtifactId,
      ),
    ).toBe(false);

    await owner.mutation(api.spectraArtifactDeletion.request, {
      artifactId: fixture.smallArtifactId,
    });
    const tombstone = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(fixture.smallArtifactId),
      summary: await ctx.db
        .query("spectraArtifactSummaries")
        .withIndex("by_artifact", (q) => q.eq("artifactId", fixture.smallArtifactId))
        .unique(),
    }));
    expect(tombstone.artifact?.status).toBe("deleted");
    expect(tombstone.summary?.status).toBe("deleted");

    const imported = await owner.mutation(api.spectraArtifacts.createImportedResource, {
      title: "S7 imported resource",
      nativeFormat: "pdf",
      bytes: 1_024,
      workspaceId: fixture.workspaceId,
    });
    const importedSummary = await t.run(async (ctx) =>
      ctx.db
        .query("spectraArtifactSummaries")
        .withIndex("by_artifact", (q) => q.eq("artifactId", imported.artifactId))
        .unique(),
    );
    expect(importedSummary?.readModelVersion).toBe(2);
    expect(importedSummary?.blueprintKey).toBe("resource");

    // Mixed rollout rows must remain safe and bounded until the cursor-shaped
    // backfill reaches them. Exercise both an old version and a missing row.
    await t.run(async (ctx) => {
      const summary = await ctx.db
        .query("spectraArtifactSummaries")
        .withIndex("by_artifact", (q) => q.eq("artifactId", fixture.largeArtifactId))
        .unique();
      if (!summary) throw new Error("Large artifact summary missing");
      await ctx.db.patch(summary._id, { readModelVersion: 1 });
      const missing = await ctx.db
        .query("spectraArtifactSummaries")
        .withIndex("by_artifact", (q) => q.eq("artifactId", fixture.smallArtifactId))
        .unique();
      if (!missing) throw new Error("Small artifact summary missing");
      await ctx.db.delete(missing._id);
    });
    const mixedWorkspace = await owner.query(api.orgTree.listWorkspaceContents, {
      workspaceId: fixture.workspaceId,
      includeDetails: false,
    });
    expect(mixedWorkspace.items).toHaveLength(2);
    expect(JSON.stringify(mixedWorkspace)).not.toContain(LARGE_ARTIFACT_MARKER);
  });
});
