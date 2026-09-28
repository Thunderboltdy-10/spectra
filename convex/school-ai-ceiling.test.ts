/// <reference types="vite/client" />
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
