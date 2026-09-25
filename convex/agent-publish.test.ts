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

async function publishedRoutingFixture(t: ReturnType<typeof convexTest>) {
  const fixture = await seedFixture(t);
  await t.run(async (ctx) => {
    const artifact = (await ctx.db.get(fixture.agentId))!;
    await ctx.db.patch(fixture.agentId, { content: { ...artifact.content,
      tools: [
        { id: "read", key: "artifact_read", enabled: true },
        { id: "search", key: "web_search", enabled: false },
      ],
    } });
  });
  const owner = t.withIdentity(fixture.owner);
  const state = await owner.query(api.agents.evalRuns, { agentId: fixture.agentId });
  const now = Date.now();
  const evalRunId = await t.run((ctx) => ctx.db.insert("agentEvalRuns", {
    agentId: fixture.agentId, schoolId: fixture.schoolId, creatorAccountId: fixture.ownerAccountId,
    contentHash: state.currentContentHash, status: "passed", modelId: "fixture", provider: "fixture",
    threshold: 0.8, caseCount: 1, passedCount: 1, averageScore: 1, verificationStrength: "moderate",
    results: [{ caseId: "private-case", category: "adversarial", required: true, score: 1, passed: true,
      reason: "PRIVATE EVALUATION DETAIL", responseExcerpt: "PRIVATE CASE BODY", latencyMs: 1 }],
    startedAt: now - 1, completedAt: now, createdAt: now, updatedAt: now,
  }));
  const release = await owner.mutation(api.spectraArtifacts.publishAgent, { agentId: fixture.agentId, rollout: "published" });
  return { ...fixture, owner, release, evalRunId, contentHash: state.currentContentHash };
}

describe("published evaluation for routing invokers", () => {
  it("returns bounded release-bound evaluation and enabled tools, without private case output", async () => {
    const t = convexTest(schema, modules);
    const f = await publishedRoutingFixture(t);
    const descriptors = await f.owner.query(api.spectraArtifacts.listAgentRoutingDescriptors, {});
    const runtime = await f.owner.query(api.spectraArtifacts.getAgentRuntime, { agentId: f.agentId });
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({
      availableToolKeys: ["artifact_read"], evaluation: {
        versionId: runtime.versionId, contentHash: f.contentHash,
        status: "passed", verificationStrength: "moderate", caseCount: 1, passedCount: 1,
      },
    });
    expect(runtime.evaluation).toEqual(descriptors[0]?.evaluation);
    expect(JSON.stringify({ descriptors, runtime })).not.toContain("PRIVATE");
    await t.run((ctx) => ctx.db.patch(f.agentId, { title: "Unpublished new title" }));
    const unchanged = await f.owner.query(api.spectraArtifacts.getAgentRuntime, { agentId: f.agentId });
    expect(unchanged.title).toBe("Study guide agent");
    expect(unchanged.evaluation).toEqual(runtime.evaluation);
  });

  it.each(["hash", "agent", "school", "missing"])("does not attribute a %s-mismatched evaluation to the release", async (mismatch) => {
    const t = convexTest(schema, modules);
    const f = await publishedRoutingFixture(t);
    if (mismatch === "missing") await t.run((ctx) => ctx.db.delete(f.evalRunId));
    if (mismatch === "hash") await t.run((ctx) => ctx.db.patch(f.evalRunId, { contentHash: "other-content" }));
    if (mismatch === "agent") await t.run(async (ctx) => {
      const now = Date.now();
      const agentId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: f.ownerAccountId, schoolId: f.schoolId, blueprintKey: "agent",
        title: "Another agent", content: {}, tags: [], status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(f.evalRunId, { agentId });
    });
    if (mismatch === "school") await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "Another school", slug: crypto.randomUUID(), verifiedDomains: [], status: "active",
        timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(f.evalRunId, { schoolId });
    });
    expect((await f.owner.query(api.spectraArtifacts.listAgentRoutingDescriptors, {}))[0]?.evaluation).toBeNull();
    expect((await f.owner.query(api.spectraArtifacts.getAgentRuntime, { agentId: f.agentId })).evaluation).toBeNull();
  });

  it("keeps unevaluated internal releases explicitly unevaluated", async () => {
    const t = convexTest(schema, modules);
    const f = await seedFixture(t);
    const owner = t.withIdentity(f.owner);
    await owner.mutation(api.spectraArtifacts.publishAgent, { agentId: f.agentId, rollout: "internal_test" });
    expect((await owner.query(api.spectraArtifacts.listAgentRoutingDescriptors, {}))[0]?.evaluation).toBeNull();
    expect((await owner.query(api.spectraArtifacts.getAgentRuntime, { agentId: f.agentId })).evaluation).toBeNull();
  });

  it("allows a use-only reader to see routing evidence and rechecks revoked access", async () => {
    const t = convexTest(schema, modules);
    const f = await publishedRoutingFixture(t);
    const readerIdentity = { subject: "routing-reader", email: "reader@agent-publish.test", emailVerified: true };
    const grantId = await t.run(async (ctx) => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", {
        clerkId: readerIdentity.subject, email: readerIdentity.email, emailVerified: true,
        name: "Routing reader", status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId, schoolId: f.schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
      });
      return ctx.db.insert("accessGrants", {
        schoolId: f.schoolId, resourceType: "agent", resourceId: f.agentId,
        principalType: "account", principalId: accountId, level: "read", capabilities: ["use"],
        source: "direct", createdByAccountId: f.ownerAccountId, createdAt: now, updatedAt: now,
      });
    });
    const reader = t.withIdentity(readerIdentity);
    expect((await reader.query(api.spectraArtifacts.listAgentRoutingDescriptors, {}))[0]?.evaluation).toMatchObject({ status: "passed" });
    await expect(reader.query(api.agents.evalRuns, { agentId: f.agentId })).rejects.toThrow();
    await t.run((ctx) => ctx.db.patch(grantId, { revokedAt: Date.now() }));
    expect(await reader.query(api.spectraArtifacts.listAgentRoutingDescriptors, {})).toEqual([]);
    await expect(reader.query(api.spectraArtifacts.getAgentRuntime, { agentId: f.agentId })).rejects.toThrow();
  });
});
