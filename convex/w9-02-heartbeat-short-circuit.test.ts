/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { runProjectionTriggerIo } from "./orgNodeMutation";
import {
  projectRunTabSummary,
  projectResultCardRunSummary,
  RESULT_CARD_SUMMARY_READ_MODEL_VERSION,
  RUN_TAB_PROJECTION_VERSION,
  runProjectionFactsUnchanged,
} from "./spectraRunProjection";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_w9_02_heartbeat",
  email: "w9-02-heartbeat@example.test",
  emailVerified: true,
};

function baseRun(
  overrides: Partial<Doc<"spectraAiRuns">> & {
    ownerAccountId: Doc<"spectraAiRuns">["ownerAccountId"];
    schoolId: Doc<"spectraAiRuns">["schoolId"];
  },
): Doc<"spectraAiRuns"> {
  const now = 1_700_000_000_000;
  return {
    _id: "jd7runs000000000000000000" as Doc<"spectraAiRuns">["_id"],
    _creationTime: now,
    sourceSurface: "workspace",
    status: "running",
    phase: "reading",
    userPrompt: "Summarize",
    executionId: "execution-1",
    workerId: "worker-1",
    heartbeatAt: now,
    leaseExpiresAt: now + 120_000,
    eventSequence: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Doc<"spectraAiRuns">;
}

async function seedActor(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "W9-02 Heartbeat School",
      slug: `w9-02-hb-${crypto.randomUUID()}`,
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
      name: "W9-02 Heartbeat",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId };
  });
}

describe("W9-02 runProjectionFactsUnchanged", () => {
  it("treats heartbeat/lease-only patches as unchanged", () => {
    const before = baseRun({
      ownerAccountId: "jd7accounts000000000000001" as Doc<"spectraAiRuns">["ownerAccountId"],
      schoolId: "jd7schools0000000000000001" as Doc<"spectraAiRuns">["schoolId"],
    });
    const after = {
      ...before,
      heartbeatAt: before.heartbeatAt! + 1_000,
      leaseExpiresAt: before.leaseExpiresAt! + 1_000,
    };
    expect(runProjectionFactsUnchanged(before, after)).toBe(true);
  });

  it("requires projection when status/phase/outcome/dock/clarification change", () => {
    const before = baseRun({
      ownerAccountId: "jd7accounts000000000000001" as Doc<"spectraAiRuns">["ownerAccountId"],
      schoolId: "jd7schools0000000000000001" as Doc<"spectraAiRuns">["schoolId"],
    });
    expect(
      runProjectionFactsUnchanged(before, {
        ...before,
        status: "completed",
        phase: "completed",
        outcome: "answer_only",
        updatedAt: before.updatedAt + 1,
      }),
    ).toBe(false);
    expect(
      runProjectionFactsUnchanged(before, {
        ...before,
        traceDegraded: true,
        updatedAt: before.updatedAt + 1,
      }),
    ).toBe(false);
    expect(
      runProjectionFactsUnchanged(before, {
        ...before,
        dockSummary: {
          checkpointSummary: "progress",
          recentSteps: ["step"],
          inputRequest: {
            kind: "choice",
            messageId: "msg-1",
            clarificationId: "clarification-exact-key-must-survive",
            executionId: "execution-1",
            prompt: "Pick one",
            options: [{ key: "exact-option-key", title: "Exact Title" }],
          },
        },
        updatedAt: before.updatedAt + 1,
      }),
    ).toBe(false);
    expect(runProjectionFactsUnchanged(undefined, before)).toBe(false);
  });
});

describe("W9-02 spectraAiRuns heartbeat short-circuit", () => {
  it("skips tab/card-summary collects on heartbeat and still projects real changes", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t);
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const threadId = await ctx.db.insert("spectraThreads", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        title: "Heartbeat short-circuit",
        origin: "workspace",
        status: "active",
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("spectraAiRuns", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        sourceSurface: "workspace",
        threadId,
        status: "running",
        phase: "reading",
        userPrompt: "Keep projecting real changes",
        executionId: "execution-1",
        workerId: "worker-1",
        heartbeatAt: now,
        leaseExpiresAt: now + 120_000,
        eventSequence: 1,
        createdAt: now,
        updatedAt: now,
      });
      const run = (await ctx.db.get(runId))!;
      const runSummary = projectRunTabSummary(run);
      const cardRunSummary = projectResultCardRunSummary(run);
      const cardId = await ctx.db.insert("spectraResultCards", {
        runId,
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        surface: "workspace",
        status: "running",
        variant: "status",
        title: "Reading",
        actions: [],
        createdAt: now,
        updatedAt: now,
      });
      const tabId = await ctx.db.insert("spectraRunTabs", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        runId,
        threadId,
        surface: "workspace",
        selected: true,
        projectionVersion: RUN_TAB_PROJECTION_VERSION,
        artifactId: run.artifactId,
        runSummary,
        createdAt: now,
        updatedAt: now,
      });
      const cardSummaryId = await ctx.db.insert("spectraResultCardSummaries", {
        readModelVersion: RESULT_CARD_SUMMARY_READ_MODEL_VERSION,
        cardId,
        runId,
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        surface: "workspace",
        status: "running",
        variant: "status",
        title: "Reading",
        actions: [],
        runSummary: cardRunSummary,
        createdAt: now,
        updatedAt: now,
      });
      return { runId, tabId, cardId, cardSummaryId, tabUpdatedAt: now };
    });

    runProjectionTriggerIo.reset();
    await t.withIdentity(identity).mutation(api.spectraRuns.heartbeat, {
      runId: fixture.runId,
      executionId: "execution-1",
      workerId: "worker-1",
    });
    expect(runProjectionTriggerIo.tabCollects).toBe(0);
    expect(runProjectionTriggerIo.cardSummaryCollects).toBe(0);

    const afterHeartbeat = await t.run(async (ctx) => ({
      run: await ctx.db.get(fixture.runId),
      tab: await ctx.db.get(fixture.tabId),
      cardSummary: await ctx.db.get(fixture.cardSummaryId),
    }));
    expect(afterHeartbeat.run?.heartbeatAt).toBeGreaterThan(
      fixture.tabUpdatedAt,
    );
    expect(afterHeartbeat.tab?.updatedAt).toBe(fixture.tabUpdatedAt);
    expect(afterHeartbeat.cardSummary?.updatedAt).toBe(fixture.tabUpdatedAt);
    expect(afterHeartbeat.tab?.runSummary?.status).toBe("running");
    expect(afterHeartbeat.tab?.runSummary?.traceDegraded).toBeUndefined();

    runProjectionTriggerIo.reset();
    await t.withIdentity(identity).mutation(api.spectraRuns.markTraceDegraded, {
      runId: fixture.runId,
      executionId: "execution-1",
    });
    expect(runProjectionTriggerIo.tabCollects).toBe(1);
    expect(runProjectionTriggerIo.cardSummaryCollects).toBe(1);

    const afterDegraded = await t.run(async (ctx) => ({
      tab: await ctx.db.get(fixture.tabId),
      cardSummary: await ctx.db.get(fixture.cardSummaryId),
    }));
    expect(afterDegraded.tab?.runSummary?.traceDegraded).toBe(true);
    expect(afterDegraded.cardSummary?.runSummary?.traceDegraded).toBe(true);
    expect(afterDegraded.tab?.updatedAt).toBeGreaterThan(fixture.tabUpdatedAt);
  });
});
