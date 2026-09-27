/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "clerk_ai_run_admission", email: "admission@example.test", emailVerified: true };

it("caps an account's live AI runs across fresh threads and per hour", async () => {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"])
    aggregateTest.register(t, name);
  const { accountId, schoolId } = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Admission School", slug: "admission-school", verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true,
      name: "Admission", status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    return { accountId, schoolId };
  });
  const user = t.withIdentity(identity);
  const begin = (submissionKey: string) =>
    user.mutation(api.spectraRuns.beginRun, { sourceSurface: "chat", userPrompt: "Explain photosynthesis.", submissionKey });

  // Each new thread admits its own run, so the ceiling must be account-wide.
  const first = await begin("fan-out-0");
  for (let index = 1; index < 4; index++) await begin(`fan-out-${index}`);
  await expect(begin("fan-out-4")).rejects.toThrow("Several AI requests are already running");
  // Replaying an admitted submission stays idempotent at the ceiling.
  await expect(begin("fan-out-0")).resolves.toMatchObject({ runId: first.runId, created: false });

  // A run whose worker lease lapsed no longer holds a slot.
  await t.run((ctx) => ctx.db.patch(first.runId, { leaseExpiresAt: Date.now() - 1 }));
  await expect(begin("fan-out-4")).resolves.toMatchObject({ created: true });

  // Settled runs free concurrency, but the rolling hour still bounds cost.
  await t.run(async (ctx) => {
    const now = Date.now();
    for (const run of await ctx.db.query("spectraAiRuns").collect())
      await ctx.db.patch(run._id, { status: "completed", leaseExpiresAt: undefined });
    for (let index = 0; index < 120; index++)
      await ctx.db.insert("spectraAiRuns", {
        ownerAccountId: accountId, schoolId, sourceSurface: "chat", status: "completed",
        userPrompt: "earlier", submissionKey: `earlier-${index}`, createdAt: now - 1_000, updatedAt: now,
      });
  });
  await expect(begin("after-burst")).rejects.toThrow("many AI requests in the last hour");
});
