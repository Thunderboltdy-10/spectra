/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

const ownerIdentity = {
  subject: "agent-publish-owner",
  email: "owner@agent-publish.test",
  emailVerified: true,
};

type Fixture = {
  owner: typeof ownerIdentity;
  agentId: Id<"spectraArtifacts">;
  ownerAccountId: Id<"accounts">;
  schoolId: Id<"schools">;
};

async function seedFixture(t: ReturnType<typeof convexTest>): Promise<Fixture> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Agent Publish School",
      slug: `agent-publish-${crypto.randomUUID()}`,
      verifiedDomains: ["agent-publish.test"],
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
      name: "Student owner",
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
    const agentId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId,
      schoolId,
      blueprintKey: "agent",
      title: "Study guide agent",
      summary: "A publishable study guide agent.",
      content: {
        instructions: {
          text: "Help students make a clear study plan and explain each next step with calm, practical guidance.",
        },
        routing: {
          enabled: true,
          description:
            "Use this agent when a student needs a focused study plan.",
          examples: [],
          negativeExamples: [],
        },
        tools: [],
        resources: [],
      },
      schemaVersion: 1,
      tags: ["study"],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    return { owner: ownerIdentity, agentId, ownerAccountId, schoolId };
  });
}

describe("ordinary student-owner agent publishing", () => {
  it("requires a current passing check, then allows the owner to publish", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFixture(t);

    await expect(
      t.withIdentity(fixture.owner).mutation(api.spectraArtifacts.publishAgent, {
        agentId: fixture.agentId,
        rollout: "published",
      }),
    ).rejects.toThrow("AGENT_EVAL_GATE_REQUIRED");

    const evalState = await t
      .withIdentity(fixture.owner)
      .query(api.agents.evalRuns, { agentId: fixture.agentId });
    const now = Date.now();
    const evalRunId = await t.run((ctx) =>
      ctx.db.insert("agentEvalRuns", {
        agentId: fixture.agentId,
        schoolId: fixture.schoolId,
        creatorAccountId: fixture.ownerAccountId,
        contentHash: evalState.currentContentHash,
        status: "passed",
        modelId: "fixture-model",
        provider: "fixture",
        threshold: 0.8,
        caseCount: 1,
        passedCount: 1,
        averageScore: 1,
        results: [
          {
            caseId: "fixture-case",
            category: "adversarial",
            layer: "adversarial",
            required: true,
            score: 1,
            passed: true,
            reason: "The fixture satisfies the required behavior.",
            responseExcerpt: "The agent provided a safe study plan.",
            latencyMs: 1,
          },
        ],
        startedAt: now - 1,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const published = await t
      .withIdentity(fixture.owner)
      .mutation(api.spectraArtifacts.publishAgent, {
        agentId: fixture.agentId,
        releaseNotes: "Fixture release",
        rollout: "published",
      });

    expect(published).toMatchObject({
      releaseNumber: 1,
      rollout: "published",
      evalRunId,
    });
    const releases = await t
      .withIdentity(fixture.owner)
      .query(api.spectraArtifacts.listAgentReleases, {
        agentId: fixture.agentId,
      });
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({
      releaseNumber: 1,
      status: "published",
      rollout: "published",
      evalRunId,
      releaseNotes: "Fixture release",
    });
  });
});
