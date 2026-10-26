/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { settleStudentSyncState } from "./schoolSyncShared";
import { SCHOOL_SYNC_KINDS } from "../shared/school-sync";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "login-student", email: "student@example.test", emailVerified: true };
const counts = { fetched: 0, created: 0, updated: 0, unchanged: 0, tombstoned: 0, projected: 0, skipped: 0, quarantined: 0, conflicts: 0, errors: 0 };
afterEach(() => vi.useRealTimers());

async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "School", slug: "school", verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Student", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const integrationId = await ctx.db.insert("schoolIntegrations", {
      schoolId, provider: "managebac", baseUrl: "https://api.managebac.com", authHeaderName: "auth-token", authScheme: "raw", status: "connected", tokenMode: "read_only", secretPurpose: "managebac-api-token",
      manifestVersion: 1, capabilityCoverage: { discovered: 1, verifiedReadable: 1, unverified: 0, failed: 0, quarantined: 0 },
      syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
      freshnessSlaMinutes: 60, requestBudgetPerMinute: 180, bootstrapVersion: 1, lastSyncAt: now,
      createdByAccountId: accountId, updatedByAccountId: accountId, createdAt: now, updatedAt: now,
    });
    return { schoolId, accountId, integrationId };
  });
  const student = t.withIdentity(identity);
  const run = () => t.run(async (ctx) => ctx.db.insert("externalSyncRuns", {
    ...ids, kind: "manual", syncKind: "classes", status: "completed", trigger: "user", stage: "complete", capabilityIds: [], counts,
    attemptCount: 0, nextAttemptAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
  }));
  return { t, ids, student, run };
}

it("persists a retry gate across requests and increases delays up to one hour", async () => {
  const { t, student } = await fixture();
  for (const minutes of [5, 15, 30, 60, 60]) {
    const now = Date.now();
    expect(await student.mutation(api.managebac.claimLoginSync, {})).toMatchObject({ claimed: true, nextAttemptAt: now + minutes * 60_000 });
    expect(await student.mutation(api.managebac.claimLoginSync, {})).toMatchObject({ claimed: false, reason: "cooldown" });
    vi.setSystemTime(now + minutes * 60_000);
  }
  expect(await t.run((ctx) => ctx.db.query("schoolSyncBootstraps").collect())).toHaveLength(1);
});

it("waits for explicit class confirmation, then completes its own sync before allowing the first brief", async () => {
  const { t, student, run } = await fixture();
  const claim = await student.mutation(api.managebac.claimLoginSync, {});
  const runId = await run();
  await t.run((ctx) => ctx.db.patch(runId, { status: "partial" }));
  expect(await student.mutation(api.managebac.finishLoginSync, { attemptAt: claim.attemptAt!, runIds: [runId] })).toEqual({ completed: false });
  await t.run((ctx) => ctx.db.patch(runId, { status: "completed" }));
  expect(await student.mutation(api.managebac.finishLoginSync, { attemptAt: claim.attemptAt! - 1, runIds: [runId] })).toEqual({ completed: false });
  expect(await student.mutation(api.managebac.finishLoginSync, { attemptAt: claim.attemptAt!, runIds: [runId] })).toEqual({ completed: false, waitingForClasses: true });
  expect(await student.query(api.managebac.onboardingStatus, {})).toMatchObject({ phase: "choose_classes" });
  expect(await student.mutation(api.managebac.claimLoginSync, {})).toMatchObject({ claimed: false, reason: "choose_classes" });
  expect(await student.mutation(api.dailyBriefs.claim, { day: "2026-10-23" })).toBe(false);
  await student.mutation(api.managebac.confirmSchoolSetup, { expectedRevision: 0 });
  expect(await student.query(api.managebac.onboardingStatus, {})).toMatchObject({ phase: "syncing" });
  const selected = await student.mutation(api.managebac.claimLoginSync, {});
  expect(selected).toMatchObject({ claimed: true, classesOnly: false });
  // Repeated confirmation cannot bypass a failed sync's retry budget.
  await student.mutation(api.managebac.confirmSchoolSetup, { expectedRevision: 0 });
  expect(await student.mutation(api.managebac.claimLoginSync, {})).toMatchObject({ claimed: false, reason: "cooldown" });
  expect(await student.mutation(api.managebac.finishLoginSync, { attemptAt: selected.attemptAt!, runIds: [runId] })).toMatchObject({ completed: true });
  expect(await student.query(api.managebac.onboardingStatus, {})).toMatchObject({ phase: "ready" });
  // The tour must also be completed or skipped before generating the brief.
  expect(await student.mutation(api.dailyBriefs.claim, { day: "2026-10-23" })).toBe(false);
  await t.run(async (ctx) => {
    const account = await ctx.db.query("accounts").first();
    await ctx.db.insert("accountPreferences", { accountId: account!._id, scope: "account", scopeKey: "account", values: { integrations: { tourStatus: "done" } }, schemaVersion: 1, updatedAt: Date.now() });
    await ctx.db.insert("dailyBriefs", { accountId: account!._id, day: "2026-10-23", state: "ready", recap: "Written before school data arrived", claimedAt: Date.now() - 60_000, updatedAt: Date.now() - 60_000 });
  });
  expect(await student.query(api.dailyBriefs.today, { day: "2026-10-23" })).toBeNull();
  expect(await student.mutation(api.dailyBriefs.claim, { day: "2026-10-23" })).toBe(true);
  expect(await student.mutation(api.dailyBriefs.claim, { day: "2026-10-23" })).toBe(false);
  vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
  expect(await student.mutation(api.managebac.claimLoginSync, {})).toMatchObject({ claimed: false, reason: "completed" });
});

it("can finish when the reader deliberately turns every kind off", async () => {
  const { t, ids, student, run } = await fixture();
  const first = await student.mutation(api.managebac.claimLoginSync, {});
  await student.mutation(api.managebac.finishLoginSync, { attemptAt: first.attemptAt!, runIds: [await run()] });
  await student.mutation(api.managebac.confirmSchoolSetup, { expectedRevision: 0 });
  const selected = await student.mutation(api.managebac.claimLoginSync, {});
  expect(await student.mutation(api.managebac.finishLoginSync, { attemptAt: selected.attemptAt!, runIds: [] })).toEqual({ completed: false });
  await t.run(async (ctx) => {
    for (const kind of SCHOOL_SYNC_KINDS) await ctx.db.insert("schoolSyncPreferences", { ...ids, kind, mode: "off", updatedAt: Date.now() });
  });
  expect(await student.mutation(api.managebac.finishLoginSync, { attemptAt: selected.attemptAt!, runIds: [] })).toMatchObject({ completed: true });
  expect(await student.query(api.managebac.onboardingStatus, {})).toMatchObject({ phase: "ready" });
});

it("resumes setup when an admin adds the school's key after signup", async () => {
  const { t, ids, student } = await fixture();
  await t.run((ctx) => ctx.db.patch(ids.integrationId, { status: "disconnected" }));
  expect(await student.query(api.managebac.onboardingStatus, {})).toMatchObject({ phase: "awaiting_connection" });
  expect(await student.mutation(api.managebac.claimLoginSync, {})).toMatchObject({ claimed: false, reason: "not_connected" });
  await t.run((ctx) => ctx.db.patch(ids.integrationId, { status: "connected" }));
  expect(await student.query(api.managebac.onboardingStatus, {})).toMatchObject({ phase: "loading_classes" });
  expect(await student.mutation(api.managebac.claimLoginSync, {})).toMatchObject({ claimed: true, classesOnly: true });
});

it("does not report another person's school-wide sync as this student's success", async () => {
  const { student } = await fixture();
  expect((await student.query(api.school.syncStatus, {})).connection.lastSyncAt).toBeNull();
});

it("retries the old setup that incorrectly completed without current memberships", async () => {
  const { t, ids, student } = await fixture();
  await t.run((ctx) => ctx.db.insert("schoolSyncBootstraps", {
    accountId: ids.accountId, integrationId: ids.integrationId,
    attemptCount: 1, lastAttemptAt: Date.now() - 60_000,
    nextAttemptAt: Date.now() + 240_000, completedAt: Date.now() - 30_000,
  }));
  expect(await student.mutation(api.managebac.claimLoginSync, {})).toMatchObject({ claimed: true });
  expect(await student.mutation(api.managebac.claimLoginSync, {})).toMatchObject({ claimed: false, reason: "cooldown" });
  const attempt = await t.run((ctx) => ctx.db.query("schoolSyncBootstraps").unique());
  expect(attempt?.completedAt).toBeUndefined();
});

it.each(["running", "partial", "awaiting_review", "completed"] as const)("keeps the student status truthful for %s projections", async (status) => {
  const { t, ids, run } = await fixture();
  const runId = await run();
  await t.run(async (ctx) => {
    await ctx.db.insert("schoolSyncStates", { ...ids, kind: "classes", state: "running", lastSyncRunId: runId, updatedAt: Date.now() });
    await settleStudentSyncState(ctx, (await ctx.db.get(runId))!, status, Date.now());
  });
  const state = await t.run((ctx) => ctx.db.query("schoolSyncStates").first());
  expect(state?.state).toBe(status === "completed" ? "idle" : status === "running" ? "running" : "failed");
  expect(state?.lastSuccessAt !== undefined).toBe(status === "completed");
});

it("requires an authenticated school member", async () => {
  const { t } = await fixture();
  await expect(t.mutation(api.managebac.claimLoginSync, {})).rejects.toThrow("AUTH");
});

it("only exposes saved sync progress to its owning account", async () => {
  const { t, student, run } = await fixture();
  const runId = await run();
  expect(await student.query(api.managebac.studentSyncProgress, { runIds: [runId] })).toMatchObject([{ syncRunId: runId, status: "completed" }]);
  await t.run((ctx) => ctx.db.patch(runId, { accountId: undefined }));
  await expect(student.query(api.managebac.studentSyncProgress, { runIds: [runId] })).rejects.toThrow("AUTH_FORBIDDEN");
});
