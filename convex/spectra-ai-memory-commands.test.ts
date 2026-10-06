/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const execute = makeFunctionReference<"mutation">("spectraApplicationWrites:execute");
const owner = { subject: "ai-memory-owner", email: "ai-memory-owner@example.test", emailVerified: true };

async function seed() {
  const t = convexTest(schema, modules);
  const runId = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Memory", slug: `ai-memory-${crypto.randomUUID()}`, verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: owner.subject, email: owner.email, emailVerified: true, name: "Owner", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    return ctx.db.insert("spectraAiRuns", { ownerAccountId: accountId, schoolId, sourceSurface: "chat", status: "running", phase: "planning", userPrompt: "Forget that.", executionId: "memory-0", createdAt: now, updatedAt: now });
  });
  const user = t.withIdentity(owner);
  let attempt = 0;
  /** Record the step and run it as the harness does, approving it first when it asks. */
  const run = async (args: Record<string, unknown>, asks: boolean) => {
    const executionId = `memory-${++attempt}`;
    const operationId = await t.run(async (ctx) => {
      await ctx.db.patch(runId, { status: "running", phase: "planning", approval: undefined, executionId });
      return ctx.db.insert("spectraOperations", {
        runId, executionId, actorType: "ai", type: "app.command", status: "proposed",
        input: { command: "write_memory", args }, affected: [], requiresConfirmation: asks, createdAt: Date.now(),
      });
    });
    if (asks) {
      await user.mutation(api.spectraRuns.updateStatus, { runId, executionId, status: "awaiting_confirmation", approvalReasons: ["Forget"] });
      await user.mutation(api.spectraRuns.claimConfirmation, { runId, executionId });
    }
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { status: "running", phase: "applying" });
      await ctx.db.patch(operationId, { status: "executing" });
    });
    return user.mutation(execute, { runId, executionId, operationId, expectedCommand: "write_memory", expectedArgs: args });
  };
  return { t, run };
}

describe("Spectra AI memory commands", () => {
  it("saves a memory without asking, and erases it only with the user's approval", async () => {
    const { t, run } = await seed();
    const saved = (await run({ action: "create", content: "Prefers worked examples in physics." }, false)) as { claimId: string };
    expect(await t.run((ctx) => ctx.db.get(saved.claimId as never))).toMatchObject({ status: "active" });

    // Forgetting erases the memory, so it never runs unapproved.
    await expect(run({ action: "forget", memoryId: saved.claimId }, false)).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    expect(await run({ action: "forget", memoryId: saved.claimId }, true)).toEqual({ forgotten: true });
    expect(await t.run((ctx) => ctx.db.get(saved.claimId as never))).toMatchObject({ status: "deleted", proposition: "[forgotten]" });
  });
});
