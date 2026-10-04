/// <reference types="vite/client" />
/*
 * Isolation comes first: no student ever sees another student's School data, another school's
 * data, a class they didn't select, or a kind of data they turned off. These run against the
 * public School API (convex/school.ts), the sync job entry points and the shared visibility check.
 */
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { v } from "convex/values";
import schema from "./schema";
import { api } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { canReadManagebacRecord } from "./managebacVisibility";

const modules = import.meta.glob("./**/*.ts");
const bridgeKey = "school-isolation-bridge-key-0123456789abcdef";
const DAY = 24 * 60 * 60_000;

type Identity = { subject: string; email: string; emailVerified: true };
const person = (name: string, domain: string): Identity => ({
  subject: `school-isolation-${name}`, email: `${name}@${domain}`, emailVerified: true,
});
const alice = person("alice", "a.example.test");
const bob = person("bob", "a.example.test");
const carol = person("carol", "b.example.test");

function setup() {
  const t = convexTest(schema, {
    ...modules,
    // Scheduled work never leaves the test: the worker dispatch is recorded, not sent.
    "./executionScheduler.ts": async () => ({
      dispatchManageBacSync: internalAction({
        args: { integrationId: v.optional(v.id("schoolIntegrations")), scheduledFor: v.number() },
        handler: async () => undefined,
      }),
    }),
  });
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}
type T = ReturnType<typeof setup>;

const empty = { discovered: 1, verifiedReadable: 1, unverified: 0, failed: 0, quarantined: 0 };

async function seed(t: T) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const school = async (slug: string) => ctx.db.insert("schools", {
      name: slug, slug: `${slug}-${crypto.randomUUID()}`, verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const schoolA = await school("school-a");
    const schoolB = await school("school-b");
    const account = async (identity: Identity, schoolId: Id<"schools">) => {
      const accountId = await ctx.db.insert("accounts", {
        clerkId: identity.subject, email: identity.email, emailVerified: true, name: identity.subject,
        status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
      });
      return accountId;
    };
    const aliceId = await account(alice, schoolA);
    const bobId = await account(bob, schoolA);
    const carolId = await account(carol, schoolB);
    const integration = async (schoolId: Id<"schools">, owner: Id<"accounts">) => {
      const integrationId = await ctx.db.insert("schoolIntegrations", {
        schoolId, provider: "managebac", baseUrl: "https://managebac.example.test", authHeaderName: "auth-token",
        authScheme: "raw", status: "connected", tokenMode: "read_only", secretPurpose: "managebac-api-token",
        manifestVersion: 1, capabilityCoverage: empty,
        syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
        freshnessSlaMinutes: 60, requestBudgetPerMinute: 180, bootstrapVersion: 1,
        createdByAccountId: owner, updatedByAccountId: owner, createdAt: now, updatedAt: now,
      });
      const capabilityId = await ctx.db.insert("integrationCapabilities", {
        integrationId, schoolId, category: "Tasks", name: "Tasks for my classes", recordType: "assignment", method: "GET",
        path: "/v2p2/classes/{class_id}/tasks", purpose: "Tasks", scope: "personal", minimumRole: "student",
        pagination: "page", changeStrategy: "full_reconciliation", freshnessSlaMinutes: 60, contractVersion: "v2p2",
        permissionState: "read_only", verificationStatus: "verified", routeSource: "manual_verified",
        normalization: { fanOutParameter: "class_id", classIdFromRouteParameter: "class_id", recordsPath: "tasks", idPath: "id" },
        lastVerifiedAt: now, lastSuccessAt: now, createdAt: now, updatedAt: now,
      });
      return { integrationId, capabilityId };
    };
    const a = await integration(schoolA, aliceId);
    const b = await integration(schoolB, carolId);
    // Carol's provider id equals Alice's: ids are only unique inside one school's ManageBac.
    for (const [accountId, schoolId, integrationId, providerUserId] of [
      [aliceId, schoolA, a.integrationId, "mb-1"], [bobId, schoolA, a.integrationId, "mb-2"], [carolId, schoolB, b.integrationId, "mb-1"],
    ] as const)
      await ctx.db.insert("externalIdentityMappings", {
        integrationId, schoolId, accountId, providerUserId, providerUserIdHash: `${providerUserId}-hash`,
        verifiedEmailHash: `${accountId}-email`, status: "verified", matchCount: 1, resolvedAt: now, createdAt: now, updatedAt: now,
      });
    const insertRecord = async (input: {
      integrationId: Id<"schoolIntegrations">; schoolId: Id<"schools">; accountId: Id<"accounts">;
      key: string; recordType: string; classId?: string; syncKind?: string; normalized: Record<string, unknown>;
    }) => ctx.db.insert("externalRecords", {
      integrationId: input.integrationId, schoolId: input.schoolId, providerRecordId: input.key,
      providerRecordKey: input.key, sourceIdentityKey: `${input.integrationId}|account:${input.accountId}|period:unknown|${input.key}`,
      recordType: input.recordType, classification: "personal", audienceScope: "mapped_user", mappedAccountId: input.accountId,
      ...(input.classId ? { providerClassId: input.classId } : {}),
      ...(input.syncKind ? { syncKind: input.syncKind as "current_tasks" } : {}),
      normalized: input.normalized, payloadVersion: "v2p2", sourceHash: `${input.key}-hash`, sourceState: "available",
      sourceStateAt: now, tombstone: false, fetchedAt: now, createdAt: now, updatedAt: now,
    });
    const select = async (accountId: Id<"accounts">, schoolId: Id<"schools">, integrationId: Id<"schoolIntegrations">, classId: string) =>
      ctx.db.insert("managebacClassSelections", {
        integrationId, schoolId, accountId, providerClassId: classId, providerRecordKey: `class:${classId}`,
        selected: true, retention: "keep_in_spectra", selectionRevision: 1, selectedAt: now, createdAt: now, updatedAt: now,
      });
    const A = { integrationId: a.integrationId, schoolId: schoolA };
    const B = { integrationId: b.integrationId, schoolId: schoolB };
    const records = {
      aliceClass101: await insertRecord({ ...A, accountId: aliceId, key: "class:101", recordType: "class", classId: "101", syncKind: "classes", normalized: { title: "Biology HL" } }),
      aliceClass202: await insertRecord({ ...A, accountId: aliceId, key: "class:202", recordType: "class", classId: "202", syncKind: "classes", normalized: { title: "Chemistry SL" } }),
      aliceCurrent: await insertRecord({ ...A, accountId: aliceId, key: "task:1", recordType: "assignment", classId: "101", syncKind: "current_tasks",
        normalized: { title: "Alice lab report", dueAt: new Date(now + 3 * DAY).toISOString() } }),
      alicePast: await insertRecord({ ...A, accountId: aliceId, key: "task:2", recordType: "assignment", classId: "101", syncKind: "past_tasks",
        normalized: { title: "Alice Macbeth essay", dueAt: new Date(now - 90 * DAY).toISOString() } }),
      aliceUnselected: await insertRecord({ ...A, accountId: aliceId, key: "task:3", recordType: "assignment", classId: "202", syncKind: "current_tasks",
        normalized: { title: "Alice unselected class task", dueAt: new Date(now + 2 * DAY).toISOString() } }),
      aliceSubmission: await insertRecord({ ...A, accountId: aliceId, key: "submission:2", recordType: "submission", classId: "101", syncKind: "dropbox_files",
        normalized: { taskId: "2", status: "submitted", files: [{ id: "77", filename: "macbeth.docx", fileSize: 1200 }] } }),
      aliceGrade: await insertRecord({ ...A, accountId: aliceId, key: "grade:2", recordType: "grade", classId: "101", syncKind: "grades",
        normalized: { taskId: "2", score: 6, maxScore: 7, feedback: "Strong argument" } }),
      aliceCas: await insertRecord({ ...A, accountId: aliceId, key: "cas_experience:9", recordType: "cas_experience", syncKind: "cas",
        normalized: { title: "Beach clean-up", service: true, status: "Approved" } }),
      bobClass101: await insertRecord({ ...A, accountId: bobId, key: "class:101", recordType: "class", classId: "101", syncKind: "classes", normalized: { title: "Biology HL" } }),
      bobCurrent: await insertRecord({ ...A, accountId: bobId, key: "task:1", recordType: "assignment", classId: "101", syncKind: "current_tasks",
        normalized: { title: "Bob lab report", dueAt: new Date(now + 3 * DAY).toISOString() } }),
      carolClass101: await insertRecord({ ...B, accountId: carolId, key: "class:101", recordType: "class", classId: "101", syncKind: "classes", normalized: { title: "Physics" } }),
      carolCurrent: await insertRecord({ ...B, accountId: carolId, key: "task:1", recordType: "assignment", classId: "101", syncKind: "current_tasks",
        normalized: { title: "Carol problem set", dueAt: new Date(now + 3 * DAY).toISOString() } }),
    };
    await select(aliceId, schoolA, a.integrationId, "101");
    await select(bobId, schoolA, a.integrationId, "101");
    await select(carolId, schoolB, b.integrationId, "101");
    const aliceFile = await ctx.db.insert("schoolFiles", {
      accountId: aliceId, schoolId: schoolA, integrationId: a.integrationId, sourceRecordId: records.aliceSubmission,
      origin: "dropbox", providerFileId: "77", filename: "macbeth.docx", mimeType: "application/msword",
      state: "listed", createdAt: now, updatedAt: now,
    });
    return { schoolA, schoolB, aliceId, bobId, carolId, a, b, records, aliceFile };
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([l], [r]) => l.localeCompare(r))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("base64url");

/** A signed page commit, exactly as the ManageBac route sends one. */
async function commitTasks(t: T, identity: Identity, input: {
  integrationId: Id<"schoolIntegrations">; capabilityId: Id<"integrationCapabilities">; syncRunId: string;
  leaseToken: string; selectionRevision: number; binding: string; tasks: Array<{ id: string; classId: string; dueAt: string; title: string }>;
}) {
  const records = input.tasks.map((task) => ({
    providerRecordId: task.id, providerRecordKey: `task:${task.id}`, classification: "personal" as const,
    audienceScope: "mapped_user" as const, providerClassId: task.classId,
    normalized: { title: task.title, dueAt: task.dueAt }, payloadVersion: "v2p2", sourceHash: digest(task),
  }));
  const progress = { binding: input.binding, page: 1, bindingDone: true, capabilityDone: true, classIds: [], yearGroupIds: [] };
  const payload = { capabilityId: input.capabilityId, records, pageNumber: 1, progress, leaseToken: input.leaseToken, selectionRevision: input.selectionRevision };
  const payloadDigest = digest(payload);
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const signature = createHmac("sha256", bridgeKey).update(["sync-page", identity.subject, input.integrationId, input.syncRunId,
    timestamp, nonce, payloadDigest].join("|")).digest("base64url");
  return t.withIdentity(identity).mutation(api.managebac.commitNormalizedPage, {
    integrationId: input.integrationId, syncRunId: input.syncRunId as Id<"externalSyncRuns">, ...payload,
    payloadDigest, timestamp, nonce, signature,
  });
}

const titles = (rows: Array<{ title: string }>) => rows.map((row) => row.title).sort();

describe("School isolation", () => {
  beforeEach(() => { process.env.SPECTRA_CONNECTOR_BRIDGE_KEY = bridgeKey; });
  afterEach(() => { delete process.env.SPECTRA_CONNECTOR_BRIDGE_KEY; vi.useRealTimers(); });

  it("never shows a student another student's tasks, grades, files or CAS", async () => {
    const t = setup();
    const f = await seed(t);
    const aliceTasks = await t.withIdentity(alice).query(api.school.tasks, { view: "all" });
    expect(titles(aliceTasks.tasks)).toEqual(["Alice Macbeth essay", "Alice lab report"]);
    const bobTasks = await t.withIdentity(bob).query(api.school.tasks, { view: "all" });
    expect(titles(bobTasks.tasks)).toEqual(["Bob lab report"]);

    // Asking for another student's record by id reveals nothing.
    expect(await t.withIdentity(bob).query(api.school.task, { recordId: f.records.alicePast })).toBeNull();
    expect(await t.withIdentity(bob).query(api.school.casExperience, { recordId: f.records.aliceCas })).toBeNull();
    expect((await t.withIdentity(bob).query(api.school.cas, {})).experiences).toEqual([]);
    expect((await t.withIdentity(bob).query(api.school.files, {})).files).toEqual([]);
    const detail = await t.withIdentity(alice).query(api.school.task, { recordId: f.records.alicePast });
    expect(detail?.grade?.score).toBe(6);
    expect(detail?.submission?.files.map((file) => file.filename)).toEqual(["macbeth.docx"]);

    // Writing into another student's CAS fails, and reflections stay with their author.
    await expect(t.withIdentity(bob).mutation(api.school.saveCasReflection, {
      experienceRecordId: f.records.aliceCas, body: "Not mine",
    })).rejects.toThrow("SCHOOL_RECORD_NOT_FOUND");
    const saved = await t.withIdentity(alice).mutation(api.school.saveCasReflection, {
      experienceRecordId: f.records.aliceCas, body: "I learned to plan the route.",
    });
    await expect(t.withIdentity(bob).mutation(api.school.saveCasReflection, {
      experienceRecordId: f.records.aliceCas, reflectionId: saved.reflectionId, body: "Edited",
    })).rejects.toThrow("SCHOOL_RECORD_NOT_FOUND");
    const aliceCas = await t.withIdentity(alice).query(api.school.casExperience, { recordId: f.records.aliceCas });
    expect(aliceCas?.reflections.map((row) => row.body)).toEqual(["I learned to plan the route."]);

    // A file fetch can only start for the student's own submission.
    await expect(t.withIdentity(bob).mutation(api.managebac.beginSchoolFileFetch, {
      submissionRecordId: f.records.aliceSubmission, providerFileId: "77",
    })).rejects.toThrow("SCHOOL_RECORD_NOT_FOUND");

    const visible = await t.run(async (ctx) => canReadManagebacRecord(ctx, { accountId: f.bobId, schoolId: f.schoolA }, (await ctx.db.get(f.records.aliceCurrent))!));
    expect(visible).toBe(false);
  });

  it("never shows a student another school's data, even with the same provider ids", async () => {
    const t = setup();
    const f = await seed(t);
    const carolTasks = await t.withIdentity(carol).query(api.school.tasks, { view: "all" });
    expect(titles(carolTasks.tasks)).toEqual(["Carol problem set"]);
    expect(await t.withIdentity(carol).query(api.school.task, { recordId: f.records.aliceCurrent })).toBeNull();
    const carolClasses = await t.withIdentity(carol).query(api.school.classes, {});
    expect(carolClasses.classes.map((row) => row.title)).toEqual(["Physics"]);
    // Carol's class override names the same provider class id and stays in her school.
    await t.withIdentity(carol).mutation(api.school.setClassOverride, { providerClassId: "101", kind: "current_tasks", mode: "off" });
    expect(titles((await t.withIdentity(alice).query(api.school.tasks, { view: "current" })).tasks)).toEqual(["Alice lab report"]);
    const visible = await t.run(async (ctx) => canReadManagebacRecord(ctx, { accountId: f.carolId, schoolId: f.schoolB }, (await ctx.db.get(f.records.aliceCurrent))!));
    expect(visible).toBe(false);
  });

  it("never shows or syncs a class the student didn't select", async () => {
    const t = setup();
    const f = await seed(t);
    const tasks = await t.withIdentity(alice).query(api.school.tasks, { view: "all" });
    expect(tasks.tasks.some((task) => task.title === "Alice unselected class task")).toBe(false);
    expect(await t.withIdentity(alice).query(api.school.task, { recordId: f.records.aliceUnselected })).toBeNull();
    const classes = await t.withIdentity(alice).query(api.school.classes, {});
    expect(classes.classes.map((row) => [row.title, row.selected])).toEqual([["Biology HL", true], ["Chemistry SL", false]]);

    // A sync job only targets selected classes, and a page naming another class stores nothing for it.
    const started = await t.withIdentity(alice).mutation(api.managebac.beginSync, { kind: "manual", syncKind: "current_tasks" });
    expect(started.pass?.classIds).toEqual(["101"]);
    const result = await commitTasks(t, alice, {
      integrationId: f.a.integrationId, capabilityId: f.a.capabilityId, syncRunId: started.syncRunId,
      leaseToken: started.leaseToken, selectionRevision: started.selectionRevision, binding: "202",
      tasks: [{ id: "30", classId: "202", dueAt: new Date(Date.now() + DAY).toISOString(), title: "Injected" }],
    });
    expect(result.counts.skipped).toBe(1);
    const stored = await t.run((ctx) => ctx.db.query("externalRecords").withIndex("by_integration_key", (q) =>
      q.eq("integrationId", f.a.integrationId).eq("providerRecordKey", "task:30")).collect());
    expect(stored).toEqual([]);
  });

  it("removes a kind's data when the student turns it off, and never syncs it again", async () => {
    const t = setup();
    const f = await seed(t);
    await t.withIdentity(alice).mutation(api.school.setMode, { kind: "past_tasks", mode: "off" });
    expect((await t.withIdentity(alice).query(api.school.tasks, { view: "past" })).tasks).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(f.records.alicePast))).toBeNull();
    // Only Alice's past tasks: her current task and Bob's data are untouched.
    expect(await t.run((ctx) => ctx.db.get(f.records.aliceCurrent))).not.toBeNull();
    expect((await t.withIdentity(bob).query(api.school.preferences, {})).kinds.find((row) => row.kind === "past_tasks")?.mode).toBe("manual");

    await expect(t.withIdentity(alice).mutation(api.managebac.beginSync, { kind: "manual", syncKind: "past_tasks" }))
      .rejects.toThrow("SCHOOL_SYNC_KIND_OFF");
    // A current-tasks job that meets a task now in the archive does not store it.
    const started = await t.withIdentity(alice).mutation(api.managebac.beginSync, { kind: "manual", syncKind: "current_tasks" });
    const result = await commitTasks(t, alice, {
      integrationId: f.a.integrationId, capabilityId: f.a.capabilityId, syncRunId: started.syncRunId,
      leaseToken: started.leaseToken, selectionRevision: started.selectionRevision, binding: "101",
      tasks: [
        { id: "1", classId: "101", dueAt: new Date(Date.now() + 3 * DAY).toISOString(), title: "Alice lab report" },
        { id: "40", classId: "101", dueAt: new Date(Date.now() - 200 * DAY).toISOString(), title: "Old essay" },
      ],
    });
    expect(result.counts.skipped).toBe(1);
    const old = await t.run((ctx) => ctx.db.query("externalRecords").withIndex("by_integration_key", (q) =>
      q.eq("integrationId", f.a.integrationId).eq("providerRecordKey", "task:40")).collect());
    expect(old).toEqual([]);

    // Even a record written behind the API's back stays invisible while its kind is off.
    const sneaked = await t.run(async (ctx) => {
      const source = (await ctx.db.get(f.records.aliceCurrent))!;
      const { _id: _ignored, _creationTime: _created, ...rest } = source;
      return ctx.db.insert("externalRecords", { ...rest, providerRecordKey: "task:41", providerRecordId: "41",
        sourceIdentityKey: `${rest.sourceIdentityKey}-41`, syncKind: "past_tasks" });
    });
    expect(await t.run(async (ctx) => canReadManagebacRecord(ctx, { accountId: f.aliceId, schoolId: f.schoolA }, (await ctx.db.get(sneaked))!))).toBe(false);
  });

  it("excludes one class from one kind with a class override, for that student only", async () => {
    const t = setup();
    const f = await seed(t);
    await t.withIdentity(alice).mutation(api.school.setClassOverride, { providerClassId: "101", kind: "current_tasks", mode: "off" });
    expect((await t.withIdentity(alice).query(api.school.tasks, { view: "current" })).tasks).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(f.records.aliceCurrent))).toBeNull();
    expect(titles((await t.withIdentity(alice).query(api.school.tasks, { view: "past" })).tasks)).toEqual(["Alice Macbeth essay"]);
    const started = await t.withIdentity(alice).mutation(api.managebac.beginSync, { kind: "manual", syncKind: "current_tasks" });
    expect(started.pass?.classIds).toEqual([]);
    expect(titles((await t.withIdentity(bob).query(api.school.tasks, { view: "current" })).tasks)).toEqual(["Bob lab report"]);
    const prefs = await t.withIdentity(alice).query(api.school.preferences, {});
    expect(prefs.classOverrides).toEqual([{ providerClassId: "101", kind: "current_tasks", mode: "off" }]);
    expect((await t.withIdentity(bob).query(api.school.preferences, {})).classOverrides).toEqual([]);
  });

  it("queues only the kinds an AI refresh names, and only for that student", async () => {
    const t = setup();
    const f = await seed(t);
    const refreshed = await t.withIdentity(alice).mutation(api.managebac.requestAiRefresh, { kinds: ["current_tasks", "cas"] });
    expect(refreshed.started).toBe(true);
    const queued = async (accountId: Id<"accounts">) => (await t.run((ctx) => ctx.db.query("schoolSyncStates").collect()))
      .filter((row) => row.accountId === accountId && row.state === "queued");
    const aliceQueued = await queued(f.aliceId);
    expect(aliceQueued.map((row) => row.kind).sort()).toEqual(["cas", "current_tasks"]);
    expect(aliceQueued.every((row) => row.dueTrigger === "ai")).toBe(true);
    expect(await queued(f.bobId)).toEqual([]);
    // A kind turned Off is never queued, even when named.
    await t.withIdentity(bob).mutation(api.school.setMode, { kind: "cas", mode: "off" });
    const off = await t.withIdentity(bob).mutation(api.managebac.requestAiRefresh, { kinds: ["cas"] });
    expect(off.started).toBe(false);
    expect(await queued(f.bobId)).toEqual([]);
  });
});
