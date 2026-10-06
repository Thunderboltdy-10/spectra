/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const execute = makeFunctionReference<"mutation">("spectraApplicationWrites:execute");
const owner = { subject: "ai-agent-owner", email: "ai-agent-owner@example.test", emailVerified: true };

async function seed() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Agents", slug: `ai-agents-${crypto.randomUUID()}`, verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: owner.subject, email: owner.email, emailVerified: true, name: "Owner", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const content = { instructions: { text: "Help the student plan lab reports step by step, asking before giving answers." } };
    const agentId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "agent", title: "Lab partner", content, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    const runId = await ctx.db.insert("spectraAiRuns", { ownerAccountId: accountId, schoolId, sourceSurface: "artifact", artifactId: agentId, status: "running", phase: "planning", userPrompt: "Release it.", executionId: "release-0", createdAt: now, updatedAt: now });
    return { agentId, runId };
  });
  const user = t.withIdentity(owner);
  let attempt = 0;
  /** Record the step and run it as the harness does, approving it first when it asks. */
  const run = async (args: Record<string, unknown>, asks: boolean) => {
    const executionId = `release-${++attempt}`;
    const input = { agentId: ids.agentId, ...args };
    const operationId = await t.run(async (ctx) => {
      await ctx.db.patch(ids.runId, { status: "running", phase: "planning", approval: undefined, executionId });
      return ctx.db.insert("spectraOperations", {
        runId: ids.runId, executionId, actorType: "ai", type: "app.command", status: "proposed",
        input: { command: "release_agent", args: input }, affected: [], requiresConfirmation: asks, createdAt: Date.now(),
      });
    });
    if (asks) {
      await user.mutation(api.spectraRuns.updateStatus, { runId: ids.runId, executionId, status: "awaiting_confirmation", approvalReasons: ["Release"] });
      await user.mutation(api.spectraRuns.claimConfirmation, { runId: ids.runId, executionId });
    }
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.runId, { status: "running", phase: "applying" });
      await ctx.db.patch(operationId, { status: "executing" });
    });
    return user.mutation(execute, { runId: ids.runId, executionId, operationId, expectedCommand: "release_agent", expectedArgs: input });
  };
  return { t, ids, run };
}

describe("Spectra AI agent releases", () => {
  it("releases the draft to its owner, then suspends that release only with the user's approval", async () => {
    const { t, ids, run } = await seed();
    const made = (await run({ action: "release_private", releaseNotes: "First try" }, false)) as { releaseId: string; rollout: string; releaseNumber: number };
    expect(made).toMatchObject({ rollout: "internal_test", releaseNumber: 1 });
    const release = await t.run((ctx) => ctx.db.get(made.releaseId as never));
    expect(release).toMatchObject({ agentId: ids.agentId, status: "published", rollout: "internal_test", releaseNotes: "First try" });

    // Suspending changes who the agent reaches, so it never runs unapproved.
    await expect(run({ action: "suspend", releaseId: made.releaseId }, false)).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    await run({ action: "suspend", releaseId: made.releaseId }, true);
    expect((await t.run((ctx) => ctx.db.get(made.releaseId as never)))).toMatchObject({ status: "suspended" });
  });

  it("refuses to publish to everyone before the draft passes its checks", async () => {
    const { run } = await seed();
    await expect(run({ action: "publish" }, true)).rejects.toThrow("AGENT_EVAL_GATE_REQUIRED");
  });
});
