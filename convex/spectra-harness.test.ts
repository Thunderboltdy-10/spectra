/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const execute = makeFunctionReference<"mutation">("spectraApplicationWrites:execute");
const EXECUTION = "harness-attempt-1";

async function fixture(patch: Record<string, unknown> = { appearance: { theme: "dark" } }) {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Harness fixture", slug: "harness", verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accounts = [];
    for (const name of ["harness-owner", "harness-other"]) {
      const accountId = await ctx.db.insert("accounts", {
        clerkId: name, email: name + "@example.test", emailVerified: true, name, status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
      });
      accounts.push(accountId);
    }
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: accounts[0], schoolId, sourceSurface: "workspace", userPrompt: "Switch to dark mode",
      status: "running", phase: "planning", executionId: EXECUTION, createdAt: now, updatedAt: now,
    });
    const operationId = await ctx.db.insert("spectraOperations", {
      runId, executionId: EXECUTION, actorType: "ai", type: "app.command", status: "proposed",
      input: { command: "change_spectra_settings", args: { patch } }, affected: [], requiresConfirmation: true, createdAt: now,
    });
    return { runId, operationId, accountId: accounts[0] };
  });
  const actor = t.withIdentity({ subject: "harness-owner", email: "harness-owner@example.test", emailVerified: true });
  const other = t.withIdentity({ subject: "harness-other", email: "harness-other@example.test", emailVerified: true });
  await actor.mutation(api.spectraHarness.recordToolOperations, {
    runId: ids.runId, executionId: EXECUTION, toolCallId: "call-1", operationIds: [ids.operationId],
  });
  const runExecute = async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.runId, { status: "running" });
      await ctx.db.patch(ids.operationId, { status: "executing" });
    });
    return actor.mutation(execute, {
      runId: ids.runId, executionId: EXECUTION, operationId: ids.operationId,
      expectedCommand: "change_spectra_settings", expectedArgs: { patch },
    });
  };
  const pauseForApproval = async () => {
    await actor.mutation(api.spectraHarness.saveCheckpoint, {
      runId: ids.runId, executionId: EXECUTION, state: { turns: 1 },
      pending: { kind: "approval", toolCallId: "call-1", toolName: "change_settings", question: "Switch to dark mode?", category: "settings" },
    });
    await actor.mutation(api.spectraRuns.updateStatus, {
      runId: ids.runId, executionId: EXECUTION, status: "awaiting_confirmation", approvalReasons: ["Switch to dark mode?"],
    });
  };
  return { t, actor, other, ids, runExecute, pauseForApproval };
}

describe("AI harness durable state", () => {
  it("hands messages sent during a run to the next checkpoint once", async () => {
    const f = await fixture();
    await f.actor.mutation(api.spectraHarness.saveCheckpoint, { runId: f.ids.runId, executionId: EXECUTION, state: { turns: 1 } });
    await f.actor.mutation(api.spectraHarness.queueSteer, { runId: f.ids.runId, executionId: EXECUTION, text: "Make it shorter" });
    const first = await f.actor.mutation(api.spectraHarness.saveCheckpoint, { runId: f.ids.runId, executionId: EXECUTION, state: { turns: 2 } });
    expect(first.steers).toEqual(["Make it shorter"]);
    const second = await f.actor.mutation(api.spectraHarness.saveCheckpoint, { runId: f.ids.runId, executionId: EXECUTION, state: { turns: 3 } });
    expect(second.steers).toEqual([]);
    await expect(
      f.other.mutation(api.spectraHarness.queueSteer, { runId: f.ids.runId, executionId: EXECUTION, text: "hi" }),
    ).rejects.toThrow("AI run not found");
  });

  it("applies an approved settings change and stores Always allow", async () => {
    const f = await fixture();
    await f.pauseForApproval();
    await expect(
      f.other.mutation(api.spectraHarness.answer, {
        runId: f.ids.runId, executionId: EXECUTION, toolCallId: "call-1", answer: { kind: "approval", allowed: true },
      }),
    ).rejects.toThrow("AI run not found");
    await f.actor.mutation(api.spectraHarness.answer, {
      runId: f.ids.runId, executionId: EXECUTION, toolCallId: "call-1",
      answer: { kind: "approval", allowed: true, alwaysAllow: true },
    });
    await f.t.run((ctx) => ctx.db.patch(f.ids.runId, { status: "running" }));
    await f.actor.mutation(api.spectraHarness.ensureApproved, { runId: f.ids.runId, executionId: EXECUTION, toolCallId: "call-1" });
    await f.t.run((ctx) => ctx.db.patch(f.ids.runId, { status: "queued" }));
    const run = await f.t.run((ctx) => ctx.db.get(f.ids.runId));
    expect(run?.status).toBe("queued");
    expect(run?.approval?.status).toBe("accepted");
    const loaded = await f.actor.query(api.spectraHarness.load, { runId: f.ids.runId });
    expect(loaded?.answer).toEqual({ kind: "approval", allowed: true, alwaysAllow: true });
    await f.runExecute();
    const prefs = await f.t.run((ctx) => ctx.db.query("accountPreferences").collect());
    const values = prefs[0]?.values as { ai?: { permissionAllow?: string[] }; appearance?: { theme?: string } };
    expect(values.ai?.permissionAllow).toEqual(["settings"]);
    expect(values.appearance?.theme).toBe("dark");
  });

  it("refuses a settings change without the user's answer or stored choice", async () => {
    const f = await fixture();
    await expect(
      f.actor.mutation(api.spectraHarness.ensureApproved, { runId: f.ids.runId, executionId: EXECUTION, toolCallId: "call-1" }),
    ).rejects.toThrow("AI_PERMISSION_REQUIRED");
    await expect(f.runExecute()).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
  });

  it("approves from full control set by the user", async () => {
    const f = await fixture();
    await f.actor.mutation(api.accountPreferences.writeLayer, {
      scope: "account", scopeKey: "account", values: { ai: { permissionFullControl: true } },
    });
    await f.actor.mutation(api.spectraHarness.ensureApproved, { runId: f.ids.runId, executionId: EXECUTION, toolCallId: "call-1" });
    await f.runExecute();
  });

  it("never lets the AI change its own permissions, even when approved", async () => {
    const f = await fixture({ ai: { permissionFullControl: true } });
    await f.pauseForApproval();
    await f.actor.mutation(api.spectraHarness.answer, {
      runId: f.ids.runId, executionId: EXECUTION, toolCallId: "call-1", answer: { kind: "approval", allowed: true },
    });
    await expect(f.runExecute()).rejects.toThrow("AI_PERMISSION_SELF_GRANT");
  });

  it("cancels the operation when the user says no", async () => {
    const f = await fixture();
    await f.pauseForApproval();
    await f.actor.mutation(api.spectraHarness.answer, {
      runId: f.ids.runId, executionId: EXECUTION, toolCallId: "call-1", answer: { kind: "approval", allowed: false },
    });
    const operation = await f.t.run((ctx) => ctx.db.get(f.ids.operationId));
    expect(operation?.status).toBe("cancelled");
    const again = await f.actor.mutation(api.spectraHarness.answer, {
      runId: f.ids.runId, executionId: EXECUTION, toolCallId: "call-1", answer: { kind: "approval", allowed: true },
    });
    expect(again).toEqual({ alreadyAnswered: true });
  });
});
