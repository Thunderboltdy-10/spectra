/// <reference types="vite/client" />
import { createHash, createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

type Rule = { category: "model_tokens" | "storage_bytes"; period: "day" | "month" | "total"; maximum: number };

async function fixture() {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"])
    aggregateTest.register(t, name);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const school = (slug: string) => ctx.db.insert("schools", {
      name: slug, slug, verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const member = async (clerkId: string, schoolId: Id<"schools">) => {
      const accountId = await ctx.db.insert("accounts", {
        clerkId, email: `${clerkId}@example.test`, emailVerified: true, name: clerkId, status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
      return accountId;
    };
    const capped = await school("capped-school");
    const other = await school("other-school");
    return { capped, other, student: await member("capped-student", capped), neighbour: await member("other-student", other) };
  });
  const setPolicy = (scope: "school" | "platform_default", enforcement: "enforced" | "simulate", rules: Rule[]) =>
    t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("limitPolicies", {
        scope, schoolId: scope === "school" ? ids.capped : undefined, rules, enforcement,
        updatedByAccountId: ids.student, createdAt: now, updatedAt: now,
      });
    });
  let meterKey = 0;
  const useTokens = (schoolId: Id<"schools">, accountId: Id<"accounts">, input: number, output: number) =>
    Promise.all([
      t.mutation(internal.metering.record, {
        schoolId, accountId, category: "model_input_tokens", quantity: input, sourceType: "spectra_run",
        idempotencyKey: `fixture-${meterKey++}`, occurredAt: Date.now(),
      }),
      t.mutation(internal.metering.record, {
        schoolId, accountId, category: "model_output_tokens", quantity: output, sourceType: "spectra_run",
        idempotencyKey: `fixture-${meterKey++}`, occurredAt: Date.now(),
      }),
    ]);
  let submission = 0;
  const begin = (subject: string) => t.withIdentity({ subject, email: `${subject}@example.test`, emailVerified: true })
    .mutation(api.spectraRuns.beginRun, { sourceSurface: "chat", userPrompt: "Explain photosynthesis.", submissionKey: `k-${submission++}` });
  return { t, ids, setPolicy, useTokens, begin };
}

it("blocks new AI requests once an enforced school model-token maximum is reached, and reopens the next UTC day", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
  const { ids, setPolicy, useTokens, begin } = await fixture();
  await setPolicy("school", "enforced", [
    { category: "storage_bytes", period: "day", maximum: 1 },
    { category: "model_tokens", period: "day", maximum: 1_000 },
  ]);
  await useTokens(ids.capped, ids.student, 600, 399);
  await expect(begin("capped-student")).resolves.toMatchObject({ created: true });
  await useTokens(ids.capped, ids.student, 0, 1);
  await expect(begin("capped-student")).rejects.toThrow("Your school has reached its AI usage limit for today");
  // Another school's usage and policy are separate.
  await expect(begin("other-student")).resolves.toMatchObject({ created: true });
  vi.setSystemTime(new Date("2026-09-29T00:00:01Z"));
  await expect(begin("capped-student")).resolves.toMatchObject({ created: true });
});

it("a simulated policy never blocks, and an enforced platform default applies to schools without their own", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
  const { t, ids, setPolicy, useTokens, begin } = await fixture();
  await useTokens(ids.capped, ids.student, 5_000, 5_000);
  await useTokens(ids.other, ids.neighbour, 5_000, 5_000);
  await setPolicy("platform_default", "enforced", [{ category: "model_tokens", period: "month", maximum: 10_000 }]);
  await expect(begin("other-student")).rejects.toThrow("for this month");
  await setPolicy("school", "simulate", [{ category: "model_tokens", period: "total", maximum: 1 }]);
  // The school's own policy wins over the default, and simulate only reports.
  await expect(begin("capped-student")).resolves.toMatchObject({ created: true });
  const totals = await t.run((ctx) => ctx.db.query("schoolUsageTotals").withIndex("by_school_period", (q) => q.eq("schoolId", ids.capped)).collect());
  expect(Object.fromEntries(totals.map((row) => [row.periodKey, row.quantity]))).toEqual({
    "day:2026-09-28": 10_000, "month:2026-09": 10_000, total: 10_000,
  });
});

const BRIDGE_KEY = "agent-bridge-fixture-key-with-at-least-32-chars";
const sign = (operation: string, subject: string, subjectId: string, payloadDigest: string, nonce = `n-${Math.random()}`) => {
  const timestamp = Date.now();
  const signature = createHmac("sha256", BRIDGE_KEY)
    .update([operation, subject, subjectId, timestamp, nonce, payloadDigest].join("|"))
    .digest("base64url");
  return { timestamp, nonce, signature };
};

/** The settlement digest's sorted-key JSON (convex/agents.ts canonical). */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

async function withAgent(fixtureValue: Awaited<ReturnType<typeof fixture>>) {
  const { t, ids } = fixtureValue;
  const agentId = await t.run((ctx) => ctx.db.insert("spectraArtifacts", {
    ownerAccountId: ids.student, schoolId: ids.capped, blueprintKey: "agent", title: "Study coach", summary: "Coaches study.",
    content: { instructions: { text: "Help students plan revision with calm practical steps and honest limits." }, routing: { enabled: false, description: "", examples: [], negativeExamples: [] }, tools: [], resources: [] },
    schemaVersion: 1, tags: [], status: "active", createdAt: Date.now(), updatedAt: Date.now(),
  }));
  const student = t.withIdentity({ subject: "capped-student", email: "capped-student@example.test", emailVerified: true });
  const totals = async () => Object.fromEntries((await t.run((ctx) => ctx.db.query("schoolUsageTotals")
    .withIndex("by_school_period", (q) => q.eq("schoolId", ids.capped)).collect())).map((row) => [row.periodKey, row.quantity]));
  return { agentId, student, totals };
}

it("gates a retry like a new request and does not meter the earlier attempt twice", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
  const value = await fixture();
  const { t, ids, setPolicy, useTokens, begin } = value;
  await setPolicy("school", "enforced", [{ category: "model_tokens", period: "day", maximum: 1_000 }]);
  const run = await begin("capped-student");
  await t.run((ctx) => ctx.db.patch(run.runId, { status: "failed", usage: { promptTokens: 300, completionTokens: 100 } }));
  await useTokens(ids.capped, ids.student, 600, 400);
  const student = t.withIdentity({ subject: "capped-student", email: "capped-student@example.test", emailVerified: true });
  await expect(student.mutation(api.spectraRuns.resetForRetry, { runId: run.runId, executionId: run.executionId, retryKey: "r-1" }))
    .rejects.toThrow("Your school has reached its AI usage limit for today");
  vi.setSystemTime(new Date("2026-09-29T08:00:00Z"));
  const retried = await student.mutation(api.spectraRuns.resetForRetry, { runId: run.runId, executionId: run.executionId, retryKey: "r-2" });
  expect((await t.run((ctx) => ctx.db.get(run.runId)))?.usage).toBeUndefined();
  expect(retried.executionId).not.toBe(run.executionId);
});

it("admits Agent Foundry and evaluation work under the ceiling and meters only server-signed token reports", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
  vi.stubEnv("SPECTRA_SECRET_BRIDGE_KEY", BRIDGE_KEY);
  try {
    const value = await fixture();
    const { setPolicy } = value;
    const { agentId, student, totals } = await withAgent(value);
    await setPolicy("school", "enforced", [{ category: "model_tokens", period: "day", maximum: 1_000 }]);
    await expect(student.mutation(api.agents.admitModelWork, { agentId })).resolves.toEqual({ admitted: true });

    const report = { agentId, purpose: "agent_foundry" as const, inputTokens: 700, outputTokens: 200 };
    const signed = sign("agent-model-work", "capped-student", agentId, "agent_foundry:700:200");
    await student.mutation(api.agents.recordModelWork, { ...report, ...signed });
    expect(await totals()).toEqual({ "day:2026-09-28": 900, "month:2026-09": 900, total: 900 });
    // A replay, a browser-invented report and an altered count all fail.
    await expect(student.mutation(api.agents.recordModelWork, { ...report, ...signed })).rejects.toThrow("AGENT_BRIDGE_REPLAYED");
    await expect(student.mutation(api.agents.recordModelWork, { ...report, timestamp: Date.now(), nonce: "forged", signature: "AAAA" }))
      .rejects.toThrow("AGENT_BRIDGE_INVALID");
    await expect(student.mutation(api.agents.recordModelWork, { ...report, inputTokens: 1, ...sign("agent-model-work", "capped-student", agentId, "agent_foundry:700:200") }))
      .rejects.toThrow("AGENT_BRIDGE_INVALID");
    expect(await totals()).toEqual({ "day:2026-09-28": 900, "month:2026-09": 900, total: 900 });

    // Evaluation: begun under the ceiling, its signed per-case tokens metered at settlement.
    const cases = [{ id: "c1", prompt: "Plan my week.", expected: "A plan.", category: "quality", required: true }];
    const begun = await student.mutation(api.agents.beginEvalRun, { agentId, modelId: "m", provider: "p", cases });
    const results = [{ caseId: "c1", category: "quality", required: true, score: 1, passed: true, reason: "ok", responseExcerpt: "A plan.", latencyMs: 5, inputTokens: 60, outputTokens: 40 }];
    const digest = createHash("sha256").update(canonical({ results })).digest("base64url");
    await student.mutation(api.agents.settleEvalRun, {
      evalRunId: begun.evalRunId, results, payloadDigest: digest,
      ...sign("agent-eval-settle", "capped-student", begun.evalRunId, digest),
    });
    expect(await totals()).toEqual({ "day:2026-09-28": 1_000, "month:2026-09": 1_000, total: 1_000 });

    // At the maximum, both kinds of agent model work are refused.
    await expect(student.mutation(api.agents.admitModelWork, { agentId })).rejects.toThrow("AI usage limit for today");
    await expect(student.mutation(api.agents.beginEvalRun, { agentId, modelId: "m", provider: "p", cases }))
      .rejects.toThrow("AI usage limit for today");
  } finally {
    vi.unstubAllEnvs();
  }
});

it("an operator backfill rebuilds totals that predate the rollup, exactly and without double counting", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
  const { t, ids, useTokens } = await fixture();
  // Usage metered before the rollup shipped: meters exist, totals do not.
  await t.run(async (ctx) => {
    const meter = (schoolId: Id<"schools">, accountId: Id<"accounts">, category: "model_input_tokens" | "model_output_tokens" | "storage_bytes", day: string, quantity: number, dimensionsKey = "") =>
      ctx.db.insert("usageMeters", { schoolId, accountId, category, day, dimensionsKey, quantity, updatedAt: Date.now() });
    await meter(ids.capped, ids.student, "model_input_tokens", "2026-08-30", 700);
    await meter(ids.capped, ids.student, "model_output_tokens", "2026-08-30", 300);
    await meter(ids.capped, ids.student, "model_input_tokens", "2026-09-27", 40, "model=a");
    await meter(ids.capped, ids.student, "model_input_tokens", "2026-09-27", 60, "model=b");
    await meter(ids.other, ids.neighbour, "model_output_tokens", "2026-09-01", 5);
    await meter(ids.capped, ids.student, "storage_bytes", "2026-09-27", 9_999);
  });
  // Usage after the rollup is already in the totals, and must stay counted once.
  await useTokens(ids.capped, ids.student, 10, 5);
  const totals = (schoolId: Id<"schools">) => t.run(async (ctx) => Object.fromEntries(
    (await ctx.db.query("schoolUsageTotals").withIndex("by_school_period", (q) => q.eq("schoolId", schoolId).eq("category", "model_tokens")).collect())
      .map((row) => [row.periodKey, row.quantity]),
  ));
  expect(await totals(ids.capped)).toEqual({ "day:2026-09-28": 15, "month:2026-09": 15, total: 15 });

  await t.mutation(internal.metering.backfillSchoolUsageTotals, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const expected = {
    "day:2026-08-30": 1_000, "day:2026-09-27": 100, "day:2026-09-28": 15,
    "month:2026-08": 1_000, "month:2026-09": 115, total: 1_115,
  };
  expect(await totals(ids.capped)).toEqual(expected);
  expect(await totals(ids.other)).toEqual({ "day:2026-09-01": 5, "month:2026-09": 5, total: 5 });

  // Finished: a second call is a no-op, and a deliberate re-run changes nothing.
  expect(await t.mutation(internal.metering.backfillSchoolUsageTotals, {})).toMatchObject({ state: "complete" });
  await t.mutation(internal.metering.backfillSchoolUsageTotals, { restart: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await totals(ids.capped)).toEqual(expected);
  // New usage keeps adding on top of the rebuilt totals.
  await useTokens(ids.capped, ids.student, 1, 1);
  expect(await totals(ids.capped)).toMatchObject({ "day:2026-09-28": 17, "month:2026-09": 117, total: 1_117 });
});

it("meters a stopped run from its heartbeat usage, then only the growth the worker reports afterwards", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
  const { t, ids, begin } = await fixture();
  const student = t.withIdentity({ subject: "capped-student", email: "capped-student@example.test", emailVerified: true });
  const run = await begin("capped-student");
  const target = { runId: run.runId, executionId: run.executionId };
  await student.mutation(api.spectraRuns.claimExecution, { ...target, workerId: "worker-a" });
  // The heartbeat stores usage only when it renews the lease.
  vi.setSystemTime(new Date("2026-09-28T10:01:05Z"));
  await student.mutation(api.spectraRuns.heartbeat, { ...target, workerId: "worker-a", usage: { promptTokens: 300, completionTokens: 100 } });
  const totals = async () => (await t.run((ctx) => ctx.db.query("schoolUsageTotals")
    .withIndex("by_school_period", (q) => q.eq("schoolId", ids.capped)).collect())).find((row) => row.periodKey === "total")?.quantity;
  await student.mutation(api.spectraRuns.stopRun, target);
  expect(await totals()).toBe(400);
  // The worker notices Stop after one more model call and reports its final total.
  const final = { ...target, status: "cancelled" as const, usage: { promptTokens: 500, completionTokens: 150 } };
  await student.mutation(api.spectraRuns.updateStatus, final);
  expect(await totals()).toBe(650);
  await student.mutation(api.spectraRuns.updateStatus, final);
  expect(await totals()).toBe(650);
});

it("meters the stored usage of a run whose worker died", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
  const { t, ids, begin } = await fixture();
  const student = t.withIdentity({ subject: "capped-student", email: "capped-student@example.test", emailVerified: true });
  const run = await begin("capped-student");
  const target = { runId: run.runId, executionId: run.executionId };
  await student.mutation(api.spectraRuns.claimExecution, { ...target, workerId: "worker-a" });
  vi.setSystemTime(new Date("2026-09-28T10:01:05Z"));
  await student.mutation(api.spectraRuns.heartbeat, { ...target, workerId: "worker-a", usage: { promptTokens: 700, completionTokens: 200 } });
  vi.setSystemTime(new Date("2026-09-28T10:10:00Z"));
  await t.mutation(internal.spectraRuns.reconcileStaleRuns, {});
  const rows = await t.run((ctx) => ctx.db.query("schoolUsageTotals")
    .withIndex("by_school_period", (q) => q.eq("schoolId", ids.capped)).collect());
  expect(rows.find((row) => row.periodKey === "total")?.quantity).toBe(900);
  expect((await t.run((ctx) => ctx.db.get(run.runId)))?.status).toBe("failed");
});
