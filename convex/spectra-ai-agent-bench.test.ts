/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";

/*
 * Spectra keeps and removes an agent's bench tests through the same Convex
 * write path as the studio: as the run's owner, with the bench's own edit
 * check, and a removal (a permanent delete) only after the user's approval.
 */

const modules = import.meta.glob("./**/*.ts");
const execute = makeFunctionReference<"mutation">("spectraApplicationWrites:execute");
const owner = { subject: "ai-bench-owner", email: "ai-bench-owner@example.test", emailVerified: true };

async function seed() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Bench", slug: `ai-bench-${crypto.randomUUID()}`, verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: owner.subject, email: owner.email, emailVerified: true, name: "Owner", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const content = { instructions: { text: "Give precise, kind essay feedback with one next step." } };
    const agentId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "agent", title: "Essay coach", content, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    const runId = await ctx.db.insert("spectraAiRuns", { ownerAccountId: accountId, schoolId, sourceSurface: "artifact", artifactId: agentId, status: "running", phase: "planning", userPrompt: "Keep that as a test.", executionId: "bench-0", createdAt: now, updatedAt: now });
    return { agentId, runId };
  });
  const user = t.withIdentity(owner);
  let attempt = 0;
  /** Record the step and run it as the harness does, approving it first when it asks. */
  const run = async (command: string, args: Record<string, unknown>, asks: boolean) => {
    const executionId = `bench-${++attempt}`;
    const input = { agentId: ids.agentId, ...args };
    const operationId = await t.run(async (ctx) => {
      await ctx.db.patch(ids.runId, { status: "running", phase: "planning", approval: undefined, executionId });
      return ctx.db.insert("spectraOperations", {
        runId: ids.runId, executionId, actorType: "ai", type: "app.command", status: "proposed",
        input: { command, args: input }, affected: [], requiresConfirmation: asks, createdAt: Date.now(),
      });
    });
    if (asks) {
      await user.mutation(api.spectraRuns.updateStatus, { runId: ids.runId, executionId, status: "awaiting_confirmation", approvalReasons: ["Remove a test"] });
      await user.mutation(api.spectraRuns.claimConfirmation, { runId: ids.runId, executionId });
    }
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.runId, { status: "running", phase: "applying" });
      await ctx.db.patch(operationId, { status: "executing" });
    });
    return user.mutation(execute, { runId: ids.runId, executionId, operationId, expectedCommand: command, expectedArgs: input });
  };
  return { t, ids, user, run };
}

describe("Spectra AI agent bench tests", () => {
  it("keeps a bench question as a test, updates it when asked again, and removes it only with approval", async () => {
    const { ids, user, run } = await seed();
    const kept = (await run("save_agent_bench_case", { prompt: "Mark my essay", mustInclude: ["next step"], mustNotInclude: [] }, false)) as { caseId: string; created: boolean };
    expect(kept.created).toBe(true);
    const again = (await run("save_agent_bench_case", { prompt: "mark my  ESSAY", mustInclude: ["next step"], mustNotInclude: ["grade"], required: false }, false)) as { caseId: string; created: boolean };
    expect(again).toEqual({ caseId: kept.caseId, created: false });
    expect(await user.query(api.agents.benchCases, { agentId: ids.agentId })).toEqual([
      expect.objectContaining({ id: kept.caseId, prompt: "mark my  ESSAY", required: false, checks: { mustInclude: ["next step"], mustNotInclude: ["grade"] } }),
    ]);

    // A removed test is deleted, so it never runs unapproved.
    await expect(run("remove_agent_bench_case", { caseId: kept.caseId }, false)).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    expect(await run("remove_agent_bench_case", { caseId: kept.caseId }, true)).toEqual({ removed: true });
    expect(await user.query(api.agents.benchCases, { agentId: ids.agentId })).toEqual([]);
  });

  it("refuses a test with nothing to check, as the studio does", async () => {
    const { run } = await seed();
    await expect(run("save_agent_bench_case", { prompt: "Mark my essay", mustInclude: [], mustNotInclude: [] }, false)).rejects.toThrow("AGENT_BENCH_CHECKS_REQUIRED");
  });
});
