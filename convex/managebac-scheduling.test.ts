/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import schema from "./schema";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

describe("bounded ManageBac scheduling repair", () => {
  it("continues both indexed streams with tied times, excluding blocked and unscheduled integrations", async () => {
    vi.useFakeTimers();
    const dispatched: { integrationId: Id<"schoolIntegrations">; scheduledFor: number }[] = [];
    const t = convexTest(schema, {
      ...modules,
      // Execute real pagination/continuation jobs, but contain HTTP dispatch
      // inside the disposable test. No provider or live stack is contacted.
      "./executionScheduler.ts": async () => ({
        dispatchManageBacSync: internalAction({
          args: { integrationId: v.id("schoolIntegrations"), scheduledFor: v.number() },
          handler: async (_ctx, args) => { dispatched.push(args); },
        }),
      }),
    });
    const scheduledFor = Date.now() + 60_000;
    const expected = await t.run(async ctx => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "Scheduling fixture", slug: "scheduling-fixture", verifiedDomains: [],
        status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
      });
      const accountId = await ctx.db.insert("accounts", {
        clerkId: "scheduler-fixture", email: "scheduler@example.test", emailVerified: true,
        name: "Fixture", status: "active", createdAt: now, updatedAt: now,
      });
      const ids: Id<"schoolIntegrations">[] = [];
      for (const [status, count] of [["connected", 250], ["degraded", 120], ["revoked", 250]] as const) {
        for (let index = 0; index < count; index++) {
          const id = await ctx.db.insert("schoolIntegrations", {
            schoolId, provider: "managebac", baseUrl: "https://provider.example.test",
            authHeaderName: "X-API-Key", authScheme: "raw", status, tokenMode: "read_only",
            secretPurpose: "fixture", manifestVersion: 1,
            capabilityCoverage: { discovered: 0, verifiedReadable: 0, unverified: 0, failed: 0, quarantined: 0 },
            syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: false, autoApplySafeUpdates: false, conflictMode: "review" },
            freshnessSlaMinutes: 60, requestBudgetPerMinute: 30, bootstrapVersion: 1,
            createdByAccountId: accountId, updatedByAccountId: accountId, createdAt: now, updatedAt: now,
            nextSyncAt: index === 0 ? undefined : scheduledFor,
            blockedReason: index === 1 ? "Fixture blocked" : undefined,
          });
          if (status !== "revoked" && index > 1) ids.push(id);
        }
      }
      return ids;
    });
    const first = await t.mutation(internal.managebac.scheduleExisting, { limit: 10_000 });
    expect(first).toEqual({ scanned: 100, scheduled: 98, done: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(dispatched.map(row => row.integrationId).sort()).toEqual(expected.sort());
    expect(new Set(dispatched.map(row => row.integrationId)).size).toBe(366);
    expect(dispatched.every(row => row.scheduledFor === scheduledFor)).toBe(true);
  });

  it("finishes an empty repair without an endless continuation chain", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    expect(await t.mutation(internal.managebac.scheduleExisting, {}))
      .toEqual({ scanned: 0, scheduled: 0, done: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.mutation(internal.managebac.scheduleExisting, { stream: "students" }))
      .toEqual({ scanned: 0, scheduled: 0, done: true });
  });
});
