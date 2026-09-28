import { createHash, createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

export const bridgeKey = "school-calendar-disposable-fixture-key-1234567890";
export const identity = { subject: "school-calendar-student", email: "student@example.test", emailVerified: true };
export const initialSource = {
  title: "Official essay",
  description: "Explain the evidence.",
  dueAt: "2026-10-24T09:00:00+02:00",
  timezone: "Europe/Madrid",
  classId: "class-1",
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

// All identities, source records and bridge signatures are disposable. The real
// signed mutation and projection triggers run; no provider/server is contacted.
export async function calendarFixture(modules: Record<string, () => Promise<unknown>>, role: "student" | "school_admin" = "student") {
  const t = convexTest(schema, {
    ...modules,
    "./schoolCalendarFixture.ts": async () => {
      const { mutation } = await import("../../convex/orgNodeMutation");
      return { editTask: mutation({
        args: { itemId: v.id("calendarItems"), patch: v.any() },
        handler: async (ctx, args) => { await ctx.db.patch(args.itemId, args.patch); },
      }), editPlan: mutation({
        args: { artifactId: v.id("spectraArtifacts"), patch: v.any() },
        handler: async (ctx, args) => { await ctx.db.patch(args.artifactId, args.patch); },
      }) };
    },
  });
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"])
    aggregateTest.register(t, name);
  const seed = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Disposable Calendar school", slug: "school-calendar-fixture", verifiedDomains: [],
      status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true,
      name: "Student", status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      schoolId, accountId, role, status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const integrationId = await ctx.db.insert("schoolIntegrations", {
      schoolId, provider: "managebac", baseUrl: "https://provider.example.test", authHeaderName: "X-API-Key",
      authScheme: "raw", status: "connected", tokenMode: "read_only", secretPurpose: "fixture", manifestVersion: 1,
      capabilityCoverage: { discovered: 1, verifiedReadable: 1, unverified: 0, failed: 0, quarantined: 0 },
      syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
      freshnessSlaMinutes: 60, requestBudgetPerMinute: 30, bootstrapVersion: 1,
      createdByAccountId: accountId, updatedByAccountId: accountId, createdAt: now, updatedAt: now,
    });
    const capabilityId = await ctx.db.insert("integrationCapabilities", {
      integrationId, schoolId, category: "assignments", name: "Assignments", recordType: "assignment",
      method: "GET", path: "/assignments", purpose: "Fixture assignments", scope: "personal", minimumRole: "student",
      pagination: "page", changeStrategy: "full_reconciliation", freshnessSlaMinutes: 60, contractVersion: "fixture-v1",
      permissionState: "read_only", verificationStatus: "verified", routeSource: "manual_verified", normalization: {},
      lastVerifiedAt: now, lastSuccessAt: now, createdAt: now, updatedAt: now,
    });
    const syncRunId = await ctx.db.insert("externalSyncRuns", {
      integrationId, schoolId, accountId, kind: "manual", status: "running", trigger: "user", stage: "ingesting",
      capabilityIds: [capabilityId], counts: { fetched: 0, created: 0, updated: 0, unchanged: 0, tombstoned: 0, projected: 0, skipped: 0, quarantined: 0, conflicts: 0, errors: 0 },
      attemptCount: 1, nextAttemptAt: now, startedAt: now, createdAt: now, updatedAt: now,
    });
    // Provider facts reach a planner only for a currently verified identity.
    await ctx.db.insert("externalIdentityMappings", {
      integrationId, schoolId, accountId, providerUserId: "provider-student", verifiedEmailHash: "fixture-hash",
      status: "verified", matchCount: 1, createdAt: now, updatedAt: now,
    });
    const selectionId = await ctx.db.insert("managebacClassSelections", {
      integrationId, schoolId, accountId, providerClassId: "class-1", providerRecordKey: "class:1",
      academicPeriodKey: "2026-27", selected: true, retention: "keep_in_spectra", selectionRevision: 1,
      createdAt: now, updatedAt: now,
    });
    return { schoolId, accountId, integrationId, capabilityId, syncRunId, selectionId };
  });
  const user = t.withIdentity(identity);
  const editTask = (itemId: Id<"calendarItems">, patch: Partial<Doc<"calendarItems">>) =>
    t.mutation(makeFunctionReference<"mutation">("schoolCalendarFixture:editTask"), { itemId, patch });
  const editPlan = (artifactId: Id<"spectraArtifacts">, patch: Partial<Doc<"spectraArtifacts">>) =>
    t.mutation(makeFunctionReference<"mutation">("schoolCalendarFixture:editPlan"), { artifactId, patch });
  let sequence = 0;
  const FULL_ROUTE_PAGE = { binding: "", page: 1, bindingDone: true, capabilityDone: true, classIds: [], yearGroupIds: [] };
  const sync = async (normalized = initialSource, sourceHash = "v1", academicPeriodKey = "2026-27", recordNumber = 1) => {
    const records = [{
      providerRecordId: `assignment-${recordNumber}`, providerRecordKey: `assignment:${recordNumber}`, providerClassId: "class-1",
      academicPeriodKey, classification: "personal" as const, audienceScope: "mapped_user" as const,
      normalized, payloadVersion: "fixture-v1", sourceHash, provenanceUrl: "https://provider.example.test/assignment/1",
    }];
    const timestamp = Date.now();
    const nonce = `calendar-fixture-${++sequence}`;
    const progress = FULL_ROUTE_PAGE;
    const payloadDigest = createHash("sha256").update(canonicalJson({ capabilityId: seed.capabilityId, records, pageNumber: sequence, progress })).digest("base64url");
    const signature = createHmac("sha256", bridgeKey).update([
      "sync-page", identity.subject, seed.integrationId, seed.syncRunId, timestamp, nonce, payloadDigest,
    ].join("|")).digest("base64url");
    return user.mutation(api.managebac.commitNormalizedPage, {
      integrationId: seed.integrationId, syncRunId: seed.syncRunId, capabilityId: seed.capabilityId,
      records, pageNumber: sequence, progress, timestamp, nonce, payloadDigest, signature,
    });
  };
  /**
   * Signed full reconciliation, as if a fresh pass had just read only
   * `seenProviderKeys`: the pass's other seen keys are dropped and it starts
   * now, so every record committed before is eligible for removal.
   */
  const complete = async (seenProviderKeys: string[] = ["assignment:1"]) => {
    await t.run(async ctx => {
      const run = (await ctx.db.get(seed.syncRunId))!;
      for (const row of await ctx.db.query("externalSyncSeenKeys").withIndex("by_run_identity", q => q.eq("syncRunId", seed.syncRunId)).collect())
        if (!seenProviderKeys.includes(row.providerRecordKey)) await ctx.db.delete(row._id);
      const pass = run.cursorState && typeof run.cursorState === "object" ? run.cursorState : {};
      await ctx.db.patch(seed.syncRunId, { cursorState: { ...pass, startedAt: Date.now() } });
    });
    const payload = {};
    const timestamp = Date.now();
    const nonce = `calendar-fixture-${++sequence}`;
    const payloadDigest = createHash("sha256").update(canonicalJson(payload)).digest("base64url");
    const signature = createHmac("sha256", bridgeKey).update([
      "sync-complete", identity.subject, seed.integrationId, seed.syncRunId, timestamp, nonce, payloadDigest,
    ].join("|")).digest("base64url");
    return user.mutation(api.managebac.completeSync, {
      integrationId: seed.integrationId, syncRunId: seed.syncRunId, ...payload, timestamp, nonce, payloadDigest, signature,
    });
  };
  const items = () => t.run(async ctx => {
    const rows = await ctx.db.query("calendarItems").withIndex("by_account_kind", q => q.eq("ownerAccountId", seed.accountId)).collect();
    const official = rows.find(row => row.kind === "official_deadline")!;
    const task = rows.find(row => row.kind === "task")!;
    return { rows, official, task };
  });
  const plan = () => t.run(ctx => ctx.db.query("spectraArtifacts")
    .withIndex("by_account_blueprint", q => q.eq("ownerAccountId", seed.accountId).eq("blueprintKey", "planner_task")).unique());
  return { t, user, seed, sync, complete, items, editTask, editPlan, plan };
}
