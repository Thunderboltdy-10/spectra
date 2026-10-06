/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

const owner = { subject: "agent-bench-owner", email: "owner@agent-bench.test", emailVerified: true };
const stranger = { subject: "agent-bench-stranger", email: "stranger@agent-bench.test", emailVerified: true };

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Agent Bench School",
      slug: `agent-bench-${crypto.randomUUID()}`,
      verifiedDomains: ["agent-bench.test"],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const account = async (identity: typeof owner, name: string) => {
      const accountId = await ctx.db.insert("accounts", {
        clerkId: identity.subject,
        email: identity.email,
        emailVerified: true,
        name,
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
      return accountId;
    };
    const ownerAccountId = await account(owner, "Owner");
    await account(stranger, "Stranger");
    const agentId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId,
      schoolId,
      blueprintKey: "agent",
      title: "Essay coach",
      summary: "Gives essay feedback.",
      content: {
        instructions: { text: "Give students precise, kind essay feedback with one clear next step every time." },
        routing: { enabled: true, description: "Use this agent when a student wants essay feedback.", examples: [], negativeExamples: [] },
        tools: [],
        resources: [],
      },
      schemaVersion: 1,
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { schoolId, ownerAccountId, agentId };
  });
}

async function passingRun(
  t: ReturnType<typeof convexTest>,
  f: Awaited<ReturnType<typeof seed>>,
  startedAt: number,
) {
  const state = await t.withIdentity(owner).query(api.agents.evalRuns, { agentId: f.agentId });
  return t.run((ctx) =>
    ctx.db.insert("agentEvalRuns", {
      agentId: f.agentId,
      schoolId: f.schoolId,
      creatorAccountId: f.ownerAccountId,
      contentHash: state.currentContentHash,
      status: "passed",
      modelId: "fixture",
      provider: "fixture",
      threshold: 0.8,
      caseCount: 1,
      passedCount: 1,
      averageScore: 1,
      results: [],
      startedAt,
      completedAt: startedAt + 1,
      createdAt: startedAt,
      updatedAt: startedAt,
    }),
  );
}

describe("bench tests in Convex", () => {
  it("saves a test with its checks, and the same question again updates it", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const me = t.withIdentity(owner);
    const first = await me.mutation(api.agents.saveBenchCase, {
      agentId: f.agentId,
      prompt: "  Mark my essay ",
      mustInclude: ["thesis", "Thesis", " "],
      mustNotInclude: [],
      rubric: "Names one concrete fix",
    });
    expect(first.created).toBe(true);
    const again = await me.mutation(api.agents.saveBenchCase, {
      agentId: f.agentId,
      prompt: "mark MY essay",
      mustInclude: ["evidence"],
      mustNotInclude: ["perfect"],
      required: false,
    });
    expect(again).toEqual({ caseId: first.caseId, created: false });
    const cases = await me.query(api.agents.benchCases, { agentId: f.agentId });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: first.caseId,
      prompt: "mark MY essay",
      checks: { mustInclude: ["evidence"], mustNotInclude: ["perfect"] },
      required: false,
    });
    expect(cases[0]!.checks).not.toHaveProperty("rubric");
  });

  it("refuses a test with nothing to check, or an empty question", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const me = t.withIdentity(owner);
    await expect(
      me.mutation(api.agents.saveBenchCase, { agentId: f.agentId, prompt: "Hi", mustInclude: [" "], mustNotInclude: [] }),
    ).rejects.toThrow("AGENT_BENCH_CHECKS_REQUIRED");
    await expect(
      me.mutation(api.agents.saveBenchCase, { agentId: f.agentId, prompt: "  ", mustInclude: ["a"], mustNotInclude: [] }),
    ).rejects.toThrow("AGENT_BENCH_PROMPT_REQUIRED");
  });

  it("keeps up to fifty tests per agent", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 50; index += 1)
        await ctx.db.insert("agentBenchCases", {
          agentId: f.agentId,
          schoolId: f.schoolId,
          creatorAccountId: f.ownerAccountId,
          prompt: `Question ${index}`,
          promptKey: `question ${index}`,
          mustInclude: ["a"],
          mustNotInclude: [],
          required: true,
          createdAt: index,
          updatedAt: index,
        });
    });
    await expect(
      t.withIdentity(owner).mutation(api.agents.saveBenchCase, {
        agentId: f.agentId,
        prompt: "One more",
        mustInclude: ["a"],
        mustNotInclude: [],
      }),
    ).rejects.toThrow("AGENT_BENCH_FULL");
  });

  it("removes a test, and only from its own agent", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const me = t.withIdentity(owner);
    const { caseId } = await me.mutation(api.agents.saveBenchCase, {
      agentId: f.agentId,
      prompt: "Mark my essay",
      mustInclude: ["thesis"],
      mustNotInclude: [],
    });
    expect(await me.mutation(api.agents.removeBenchCase, { agentId: f.agentId, caseId })).toEqual({ removed: true });
    expect(await me.query(api.agents.benchCases, { agentId: f.agentId })).toEqual([]);
  });

  it("is only for people who can edit the agent", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const them = t.withIdentity(stranger);
    await expect(them.query(api.agents.benchCases, { agentId: f.agentId })).rejects.toThrow("AUTH_RESOURCE_FORBIDDEN");
    await expect(
      them.mutation(api.agents.recordBenchRun, { agentId: f.agentId, prompt: "Hi", target: "draft", output: "x" }),
    ).rejects.toThrow("AUTH_RESOURCE_FORBIDDEN");
  });
});

describe("bench answers in Convex", () => {
  it("keeps the latest six answers per prompt and target, newest first", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const me = t.withIdentity(owner);
    for (let index = 0; index < 8; index += 1)
      await me.mutation(api.agents.recordBenchRun, {
        agentId: f.agentId,
        prompt: index % 2 ? "Mark my essay" : "mark my  ESSAY",
        target: "draft",
        output: `Answer ${index}`,
      });
    await me.mutation(api.agents.recordBenchRun, {
      agentId: f.agentId,
      prompt: "Mark my essay",
      target: "release",
      releaseNumber: 2,
      output: "Released answer",
    });
    const runs = await me.query(api.agents.benchRuns, { agentId: f.agentId });
    const drafts = runs.filter((run) => run.target === "draft");
    expect(drafts.map((run) => run.output)).toEqual(
      ["Answer 7", "Answer 6", "Answer 5", "Answer 4", "Answer 3", "Answer 2"],
    );
    expect(runs.find((run) => run.target === "release")).toMatchObject({ releaseNumber: 2, output: "Released answer" });
  });

  it("shows each person only their own answers", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await t.withIdentity(owner).mutation(api.agents.recordBenchRun, {
      agentId: f.agentId,
      prompt: "Mark my essay",
      target: "draft",
      output: "Mine",
    });
    const strangerAccount = await t.run(async (ctx) =>
      (await ctx.db.query("accounts").collect()).find((row) => row.clerkId === stranger.subject)!._id,
    );
    await t.run((ctx) =>
      ctx.db.insert("agentBenchRuns", {
        agentId: f.agentId,
        schoolId: f.schoolId,
        accountId: strangerAccount as Id<"accounts">,
        prompt: "Theirs",
        promptKey: "theirs",
        target: "draft",
        output: "Not mine",
        createdAt: Date.now(),
      }),
    );
    const runs = await t.withIdentity(owner).query(api.agents.benchRuns, { agentId: f.agentId });
    expect(runs.map((run) => run.output)).toEqual(["Mine"]);
  });
});

describe("the release a draft is compared with", () => {
  it("is empty before any release, then the newest release's own content", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const me = t.withIdentity(owner);
    expect(await me.query(api.spectraArtifacts.agentBenchRelease, { agentId: f.agentId })).toBeNull();
    await me.mutation(api.spectraArtifacts.publishAgent, { agentId: f.agentId, rollout: "internal_test" });
    await t.run((ctx) => ctx.db.patch(f.agentId, { title: "Draft title" }));
    const release = await me.query(api.spectraArtifacts.agentBenchRelease, { agentId: f.agentId });
    expect(release).toMatchObject({ releaseNumber: 1, title: "Essay coach" });
    expect(JSON.stringify(release?.content)).toContain("one clear next step");
  });
});

describe("publishing after saving a test", () => {
  it("asks for checks again when a test was saved after the last passing run", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const me = t.withIdentity(owner);
    await passingRun(t, f, Date.now() - 60_000);
    await me.mutation(api.agents.saveBenchCase, {
      agentId: f.agentId,
      prompt: "Mark my essay",
      mustInclude: ["thesis"],
      mustNotInclude: [],
    });
    await expect(
      me.mutation(api.spectraArtifacts.publishAgent, { agentId: f.agentId, rollout: "published" }),
    ).rejects.toThrow("include the tests you saved");
    await passingRun(t, f, Date.now() + 1);
    await expect(
      me.mutation(api.spectraArtifacts.publishAgent, { agentId: f.agentId, rollout: "published" }),
    ).resolves.toMatchObject({ releaseNumber: 1 });
  });
});
