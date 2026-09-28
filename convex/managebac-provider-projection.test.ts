/// <reference types="vite/client" />
import { createHash, createHmac } from "node:crypto";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { bridgeKey, calendarFixture, identity, initialSource } from "../scripts/test-fixtures/managebac-calendar";
import { planArtifactYjsMutation } from "../src/features/spectra/collaboration/artifact-yjs-model";
import { artifactProjection } from "../scripts/collaboration-artifact-projection.mjs";

const modules = import.meta.glob("./**/*.ts");
const changedSource = { ...initialSource, title: "Revised official essay", description: "New source instructions.", dueAt: "2026-10-25T09:00:00+01:00" };
const vectorHash = (document: Y.Doc) => createHash("sha256").update(Y.encodeStateVector(document)).digest("base64url");
const copy = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

beforeEach(() => {
  vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type Fixture = Awaited<ReturnType<typeof calendarFixture>>;

/** Only immediate work: provider jobs, not the next scheduled sync or idle commits. */
async function drain(f: Fixture) {
  for (let step = 0; step < 12; step += 1) {
    vi.advanceTimersByTime(1);
    await f.t.finishInProgressScheduledFunctions();
  }
}

/** A real collaborative edit: the student's editor initializes the planner's
 * room and changes personal copied text, without a projection checkpoint. */
async function openRoomWithPersonalEdit(f: Fixture, edit: (content: Record<string, unknown>) => void) {
  const plan = (await f.plan())!;
  const roomId = await f.t.run(ctx => ctx.db.insert("collaborationRooms", {
    artifactId: plan._id, schoolId: plan.schoolId, typeKey: "planner_task", provider: "self_hosted_yjs",
    partitionKey: "root", schemaVersion: plan.schemaVersion ?? 1, policyVersion: 0, status: "active",
    nextSequence: 1, snapshotSequence: 0, uncompactedBytes: 0, createdAt: Date.now(), updatedAt: Date.now(),
  }));
  const document = new Y.Doc();
  const base = vectorHash(document);
  const content = structuredClone(plan.content) as Record<string, unknown>;
  edit(content);
  const mutation = planArtifactYjsMutation(document, "planner_task", { title: plan.title, summary: plan.summary, tags: plan.tags, content });
  const captured: Uint8Array[] = [];
  document.on("update", (update: Uint8Array) => captured.push(update));
  document.transact(() => mutation.apply());
  await f.t.mutation(internal.collaborationGatewayStore.append, {
    accountId: f.seed.accountId, actorKind: "human", artifactId: plan._id, partitionKey: "root", clientId: "student-tab",
    policyVersion: 0, idempotencyKey: "student-edit-1", update: copy(Y.mergeUpdates(captured)),
    expectedRoomId: roomId, expectedNextSequence: 1, baseStateVectorHash: base, stateVectorHash: vectorHash(document),
    regionIds: mutation.regions.map(region => region.regionId),
  });
  document.destroy();
  return { planId: plan._id, roomId };
}

async function replayProjection(f: Fixture, roomId: Id<"collaborationRooms">) {
  const updates = await f.t.run(ctx => ctx.db.query("collaborationUpdates")
    .withIndex("by_room_sequence", q => q.eq("roomId", roomId)).collect());
  const document = new Y.Doc();
  for (const row of updates) Y.applyUpdate(document, new Uint8Array(row.update));
  const json = artifactProjection(document, 1);
  document.destroy();
  return { updates, projection: JSON.parse(json!) as { title: string; content: Record<string, unknown> } };
}

const state = (f: Fixture, planId: Id<"spectraArtifacts">) => f.t.run(async ctx => ({
  plan: (await ctx.db.get(planId))!,
  projection: (await ctx.db.query("externalProjections")
    .withIndex("by_projection", q => q.eq("projectionType", "planner_task").eq("projectionId", planId)).unique())!,
  run: (await ctx.db.get(f.seed.syncRunId))!,
  versions: await ctx.db.query("spectraArtifactVersions").withIndex("by_artifact_created", q => q.eq("artifactId", planId)).collect(),
  conflicts: await ctx.db.query("externalSyncConflicts").withIndex("by_account_status", q => q.eq("accountId", f.seed.accountId).eq("status", "open")).collect(),
}));

describe("ManageBac provider projection through canonical history", () => {
  it("commits a room-less refresh together with its import history receipt", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const planId = (await f.plan())!._id;
    await f.sync(changedSource, "v2");
    const after = await state(f, planId);
    expect(after.plan.content).toMatchObject({ taskTitle: changedSource.title, description: changedSource.description,
      dueAt: Date.parse(changedSource.dueAt), source: { hash: "v2", status: "active" } });
    const imported = after.versions.find(version => version.source === "import");
    expect(imported).toMatchObject({ creatorAccountIds: [f.seed.accountId], provenance: { kind: "managebac_provider", mode: "refresh", sourceHash: "v2" } });
    expect(after.projection).toMatchObject({ sourceHash: "v2", state: "active",
      providerReceipt: { state: "committed", versionId: imported!._id } });
    expect(after.projection.pendingProvider).toBeUndefined();
    expect(await f.t.run(ctx => ctx.db.query("collaborationRooms").collect())).toHaveLength(0);
  });

  it("appends through the room, preserves an unprojected personal edit and keeps the run pending until it commits", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const { planId, roomId } = await openRoomWithPersonalEdit(f, content => {
      content.taskTitle = "My personal title";
      content.progressNote = "Outline done";
    });
    const stored = (await f.plan())!.content as Record<string, unknown>;
    expect(stored.taskTitle).toBe(initialSource.title);

    await f.sync(changedSource, "v2");
    const staged = await state(f, planId);
    expect(staged.projection.pendingProvider).toMatchObject({ state: "pending", mode: "refresh", previousSourceHash: "v1", sourceHash: "v2" });
    expect(staged.plan.content).toMatchObject({ source: { hash: "v1" } });
    expect(staged.run.projectionWorkRemaining).toBe(1);
    expect(await f.complete()).toMatchObject({ status: "running" });
    expect((await state(f, planId)).run).toMatchObject({ status: "running", stage: "applying_projections", projectionIngestionComplete: true });

    await drain(f);
    const after = await state(f, planId);
    expect(after.run).toMatchObject({ status: "completed", stage: "complete", projectionWorkRemaining: 0 });
    expect(after.plan.content).toMatchObject({ taskTitle: "My personal title", progressNote: "Outline done",
      description: changedSource.description, dueAt: Date.parse(changedSource.dueAt), source: { hash: "v2" } });
    const replayed = await replayProjection(f, roomId);
    expect(replayed.updates.map(row => row.sequence)).toEqual([1, 2]);
    expect(replayed.updates[1]).toMatchObject({ actorAccountId: f.seed.accountId, providerSourceOperationId: after.projection.providerReceipt?.operationId });
    // The canonical room and the stored projection converge on one value.
    expect(replayed.projection.content).toEqual(after.plan.content);
    expect(after.versions.map(version => version.source)).toEqual(["checkpoint", "import"]);
    expect(after.versions[0]!.summary).toBe("Your work before the school source changed");
    expect(after.projection).toMatchObject({ sourceHash: "v2", state: "active",
      providerReceipt: { state: "committed", roomId, sequence: 2, versionId: after.versions[1]!._id } });
    expect(after.projection.pendingProvider).toBeUndefined();
  });

  it("keeps the first baseline when a second provider generation supersedes an uncommitted one", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const { planId, roomId } = await openRoomWithPersonalEdit(f, content => { content.progressNote = "Personal"; });
    await f.sync(changedSource, "v2");
    const third = { ...changedSource, title: "Third title", description: "Third instructions." };
    await f.sync(third, "v3");
    const staged = await state(f, planId);
    expect(staged.projection.pendingProvider).toMatchObject({ generation: 2, previousSourceHash: "v1", sourceHash: "v3" });
    expect(staged.run.projectionWorkRemaining).toBe(1);
    await drain(f);
    const after = await state(f, planId);
    expect(after.plan.content).toMatchObject({ taskTitle: third.title, description: third.description, progressNote: "Personal", source: { hash: "v3" } });
    expect((await replayProjection(f, roomId)).updates).toHaveLength(2);
    expect(after.projection.providerReceipt).toMatchObject({ generation: 2, state: "committed" });
  });

  it("records a reviewable conflict instead of guessing a moved room baseline", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    // A planner whose stored provider generation is not this page's baseline.
    const before = (await f.plan())!;
    await f.editPlan(before._id, { content: { ...(before.content as object), source: {
      ...((before.content as { source: object }).source), hash: "an-older-generation" } } });
    const { planId, roomId } = await openRoomWithPersonalEdit(f, content => { content.progressNote = "Personal"; });
    await f.sync(changedSource, "v2");
    expect(await f.complete()).toMatchObject({ status: "running" });
    await drain(f);
    const after = await state(f, planId);
    expect(after.run).toMatchObject({ status: "awaiting_review", projectionWorkRemaining: 0 });
    expect(after.projection).toMatchObject({ state: "conflicted", sourceHash: "v1", pendingProvider: { state: "failed" } });
    expect(after.conflicts).toEqual([expect.objectContaining({ kind: "customization_overlap", affectedLinks: [String(planId)] })]);
    expect((await replayProjection(f, roomId)).updates).toHaveLength(1);
    expect(after.versions.filter(version => version.source === "import")).toHaveLength(0);
  });

  it("delivers no provider text after the recipient's verified identity is revoked", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const { planId, roomId } = await openRoomWithPersonalEdit(f, content => { content.progressNote = "Personal"; });
    await f.sync(changedSource, "v2");
    await f.t.run(async ctx => {
      const mapping = (await ctx.db.query("externalIdentityMappings").collect())[0]!;
      await ctx.db.patch(mapping._id, { status: "revoked", revokedAt: Date.now() });
    });
    await drain(f);
    const after = await state(f, planId);
    expect((await replayProjection(f, roomId)).updates).toHaveLength(1);
    expect(after.projection).toMatchObject({ sourceHash: "v1", pendingProvider: { state: "failed" } });
    expect(after.run.projectionWorkRemaining).toBe(0);
    expect(after.conflicts).toHaveLength(0);

    // The same rule holds for a planner without a canonical room.
    const g = await calendarFixture(modules);
    await g.sync();
    const plain = (await g.plan())!;
    await g.t.run(async ctx => {
      const mapping = (await ctx.db.query("externalIdentityMappings").collect())[0]!;
      await ctx.db.patch(mapping._id, { status: "revoked", revokedAt: Date.now() });
    });
    await g.sync(changedSource, "v2");
    expect((await g.plan())!.content).toEqual(plain.content);
  });

  it("rejects an ordinary editor's rollback of provider facts through the room", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const { planId, roomId } = await openRoomWithPersonalEdit(f, content => { content.progressNote = "Personal"; });
    const { updates } = await replayProjection(f, roomId);
    const document = new Y.Doc();
    for (const row of updates) Y.applyUpdate(document, new Uint8Array(row.update));
    const base = vectorHash(document);
    const plan = (await f.plan())!;
    const current = JSON.parse(artifactProjection(document, 1)!) as { title: string; tags: string[]; content: Record<string, unknown> };
    const attempt = async (content: Record<string, unknown>, key: string) => {
      const next = new Y.Doc();
      Y.applyUpdate(next, Y.encodeStateAsUpdate(document));
      const mutation = planArtifactYjsMutation(next, "planner_task", { title: current.title, tags: current.tags, content });
      const captured: Uint8Array[] = [];
      next.on("update", (update: Uint8Array) => captured.push(update));
      next.transact(() => mutation.apply());
      const projectionJson = artifactProjection(next, 1)!;
      return f.t.mutation(internal.collaborationGatewayStore.append, {
        accountId: f.seed.accountId, actorKind: "human", artifactId: planId, partitionKey: "root", clientId: "stale-tab",
        policyVersion: 0, idempotencyKey: key, update: copy(Y.mergeUpdates(captured)),
        expectedRoomId: roomId, expectedNextSequence: 2, baseStateVectorHash: base, stateVectorHash: vectorHash(next),
        regionIds: mutation.regions.map(region => region.regionId), projectionJson,
        projectionHash: createHash("sha256").update(projectionJson).digest("base64url"),
      });
    };
    await expect(attempt({ ...current.content, source: { ...(current.content.source as object), hash: "v0" } }, "rollback-source"))
      .rejects.toThrow("PLANNER_SOURCE_METADATA_LOCKED");
    await expect(attempt({ ...current.content, dueAt: Date.parse("2026-12-01T00:00:00Z") }, "move-deadline"))
      .rejects.toThrow("PLANNER_OFFICIAL_DEADLINE_LOCKED");
    await attempt({ ...current.content, progressNote: "Still personal" }, "personal-note");
    expect((await f.plan())!.content).toMatchObject({ progressNote: "Still personal", source: (plan.content as { source: object }).source });
    document.destroy();
  });

  it("marks a withdrawn source removed through the room and the same history", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const { planId, roomId } = await openRoomWithPersonalEdit(f, content => { content.progressNote = "Personal"; });
    expect(await f.complete([])).toMatchObject({ status: "running" });
    await drain(f);
    const after = await state(f, planId);
    expect(after.plan.content).toMatchObject({ progressNote: "Personal", source: { status: "removed" } });
    expect((await replayProjection(f, roomId)).updates).toHaveLength(2);
    expect(after.projection).toMatchObject({ state: "tombstoned", providerReceipt: { state: "committed" } });
    expect(after.run.status).toBe("awaiting_review");
    expect(after.conflicts.map(conflict => conflict.kind)).toEqual(["source_removed"]);
  });
  it("resolves a rebase only after its canonical room effect commits", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const before = (await f.plan())!;
    await f.editPlan(before._id, { content: { ...(before.content as object), source: {
      ...((before.content as { source: object }).source), hash: "an-older-generation" } } });
    const { planId, roomId } = await openRoomWithPersonalEdit(f, content => { content.taskTitle = "My title"; });
    await f.sync(changedSource, "v2");
    await drain(f);
    const conflict = (await state(f, planId)).conflicts[0]!;
    expect(await f.user.mutation(api.managebac.resolveConflict, { conflictId: conflict._id, resolution: "rebase" }))
      .toMatchObject({ pending: true });
    const pending = await f.t.run(ctx => ctx.db.get(conflict._id));
    expect(pending).toMatchObject({ status: "open", projectionResolution: "rebase", projectionWorkRemaining: 1 });
    await expect(f.user.mutation(api.managebac.resolveConflict, { conflictId: conflict._id, resolution: "detach" }))
      .rejects.toThrow("INTEGRATION_CONFLICT_PENDING");
    await drain(f);
    const after = await state(f, planId);
    expect(await f.t.run(ctx => ctx.db.get(conflict._id))).toMatchObject({ status: "resolved", resolution: "rebase", projectionWorkRemaining: 0 });
    // The uncertain baseline keeps personal text; official facts still advance.
    expect(after.plan.content).toMatchObject({ taskTitle: "My title", dueAt: Date.parse(changedSource.dueAt), source: { hash: "v2" } });
    expect(after.projection).toMatchObject({ state: "active", sourceHash: "v2", providerReceipt: { state: "committed", sequence: 2 } });
    expect((await replayProjection(f, roomId)).updates).toHaveLength(2);
  });

  it("keeps an overlay by advancing official facts only, through the room", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const before = (await f.plan())!;
    await f.editPlan(before._id, { content: { ...(before.content as object), source: {
      ...((before.content as { source: object }).source), hash: "an-older-generation" } } });
    const { planId, roomId } = await openRoomWithPersonalEdit(f, content => { content.progressNote = "Personal"; });
    await f.sync(changedSource, "v2");
    await drain(f);
    const conflict = (await state(f, planId)).conflicts[0]!;
    expect(await f.user.mutation(api.managebac.resolveConflict, { conflictId: conflict._id, resolution: "keep_overlay" }))
      .toMatchObject({ pending: true });
    await drain(f);
    const after = await state(f, planId);
    expect(await f.t.run(ctx => ctx.db.get(conflict._id))).toMatchObject({ status: "resolved", resolution: "keep_overlay" });
    // Copied text stays the person's; the deadline and source envelope advance.
    expect(after.plan.content).toMatchObject({ taskTitle: initialSource.title, description: initialSource.description,
      progressNote: "Personal", dueAt: Date.parse(changedSource.dueAt), source: { hash: "v2", status: "active" } });
    expect(after.versions.filter(version => version.source === "import")).toEqual([
      expect.objectContaining({ provenance: expect.objectContaining({ mode: "keep_overlay", sourceHash: "v2" }) }),
    ]);
    expect((await replayProjection(f, roomId)).updates).toHaveLength(2);
  });

  it("rejects a prepared update whose artifact head moved and retries from the new head", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const { planId } = await openRoomWithPersonalEdit(f, content => { content.progressNote = "Personal"; });
    await f.sync(changedSource, "v2");
    const projection = (await state(f, planId)).projection;
    const operationId = projection.pendingProvider!.operationId;
    const room = (await f.t.run(ctx => ctx.db.query("collaborationRooms").collect()))[0]!;
    await expect(f.t.mutation(internal.managebacProjectionJobs.commit, {
      projectionId: projection._id, operationId, artifactDigest: "not-the-current-head",
      roomId: room._id, nextSequence: room.nextSequence,
    })).rejects.toThrow("MANAGEBAC_PROJECTION_HEAD_STALE");
    await drain(f);
    expect((await state(f, planId)).projection).toMatchObject({ sourceHash: "v2", providerReceipt: { operationId, state: "committed" } });
  });

  it("recovers a lost attempt so the run cannot stay pending forever", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const { planId } = await openRoomWithPersonalEdit(f, content => { content.progressNote = "Personal"; });
    await f.sync(changedSource, "v2");
    const { projection } = await state(f, planId);
    const operationId = projection.pendingProvider!.operationId;
    // A watchdog for an attempt that already made progress does nothing.
    await f.t.mutation(internal.managebacProjectionJobs.watchdog, { projectionId: projection._id, operationId, attempts: 7 });
    expect((await state(f, planId)).projection.pendingProvider).toMatchObject({ attempts: 0, state: "pending" });
    await f.t.mutation(internal.managebacProjectionJobs.watchdog, { projectionId: projection._id, operationId, attempts: 0 });
    expect((await state(f, planId)).projection.pendingProvider).toMatchObject({ attempts: 1, state: "pending",
      error: "MANAGEBAC_PROJECTION_ATTEMPT_LOST" });
    expect(await f.complete()).toMatchObject({ status: "running" });
    vi.advanceTimersByTime(2_000);
    await drain(f);
    const after = await state(f, planId);
    expect(after.projection).toMatchObject({ sourceHash: "v2", providerReceipt: { state: "committed" } });
    expect(after.run).toMatchObject({ status: "completed", projectionWorkRemaining: 0 });
    expect(after.versions.filter(version => version.source === "import")).toHaveLength(1);
  });

  it("degrades the connection when a staged update fails after the sync reported complete", async () => {
    const f = await calendarFixture(modules);
    await f.sync();
    const { planId } = await openRoomWithPersonalEdit(f, content => { content.progressNote = "Personal"; });
    await f.sync(changedSource, "v2");
    const { projection } = await state(f, planId);
    expect(await f.complete()).toMatchObject({ status: "running" });
    const integration = () => f.t.run(async ctx => (await ctx.db.get(f.seed.integrationId))!);
    expect((await integration()).status).toBe("connected");
    await f.t.mutation(internal.managebacProjectionJobs.failed, {
      projectionId: projection._id, operationId: projection.pendingProvider!.operationId, error: "MANAGEBAC_PROJECTION_TOO_LARGE",
    });
    expect((await state(f, planId)).run).toMatchObject({ status: "partial", projectionWorkRemaining: 0 });
    expect((await integration()).status).toBe("degraded");
  });
});

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

describe("ManageBac shared-source fanout", () => {
  it("applies a shared source to many planners as a bounded chain while the run stays pending", async () => {
    const f = await calendarFixture(modules, "school_admin");
    const recipients = 20;
    const runId = await f.t.run(ctx => ctx.db.insert("externalSyncRuns", {
      integrationId: f.seed.integrationId, schoolId: f.seed.schoolId, kind: "reconciliation", status: "running",
      trigger: "school_admin", stage: "ingesting", capabilityIds: [f.seed.capabilityId],
      counts: { fetched: 0, created: 0, updated: 0, unchanged: 0, tombstoned: 0, projected: 0, skipped: 0, quarantined: 0, conflicts: 0, errors: 0 },
      attemptCount: 1, nextAttemptAt: Date.now(), startedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    }));
    let nonce = 0;
    const signed = (operation: string, payloadDigest: string) => {
      const timestamp = Date.now();
      const value = `fanout-${++nonce}`;
      const signature = createHmac("sha256", bridgeKey).update([operation, identity.subject, f.seed.integrationId, runId,
        timestamp, value, payloadDigest].join("|")).digest("base64url");
      return { timestamp, nonce: value, signature, payloadDigest };
    };
    const page = (normalized: object, sourceHash: string) => {
      const records = [{ providerRecordId: "school-event", providerRecordKey: "event:school", classification: "school" as const,
        audienceScope: "school" as const, normalized, payloadVersion: "fixture-v1", sourceHash }];
      const pageNumber = nonce + 1;
      const payloadDigest = createHash("sha256").update(canonicalJson({ capabilityId: f.seed.capabilityId, records, pageNumber })).digest("base64url");
      return f.user.mutation(api.managebac.commitNormalizedPage, { integrationId: f.seed.integrationId, syncRunId: runId,
        capabilityId: f.seed.capabilityId, records, pageNumber, ...signed("sync-page", payloadDigest) });
    };
    await page(initialSource, "v1");
    const seeded = await f.t.run(async ctx => {
      const record = (await ctx.db.query("externalRecords").collect()).find(row => row.providerRecordKey === "event:school")!;
      const planIds: Id<"spectraArtifacts">[] = [];
      for (let index = 0; index < recipients; index += 1) {
        const now = Date.now();
        const accountId = await ctx.db.insert("accounts", { clerkId: `fanout-${index}`, email: `fanout-${index}@example.test`,
          emailVerified: true, name: `Student ${index}`, status: "active", createdAt: now, updatedAt: now });
        await ctx.db.insert("schoolMemberships", { schoolId: f.seed.schoolId, accountId, role: "student", status: "active",
          joinedAt: now, createdAt: now, updatedAt: now });
        // The last recipient has no verified identity and must not receive text.
        if (index < recipients - 1) await ctx.db.insert("externalIdentityMappings", { integrationId: f.seed.integrationId,
          schoolId: f.seed.schoolId, accountId, providerUserId: `provider-${index}`, verifiedEmailHash: "fixture",
          status: "verified", matchCount: 1, createdAt: now, updatedAt: now });
        const planId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId: f.seed.schoolId,
          blueprintKey: "planner_task", schemaVersion: 1, title: initialSource.title, summary: initialSource.description,
          content: { taskTitle: initialSource.title, description: initialSource.description, status: "todo", timezone: "Europe/Madrid",
            source: { provider: "managebac", externalId: "school-event", version: "fixture-v1", hash: "v1", status: "active",
              lockedFields: ["taskTitle", "description", "dueAt", "source"] } },
          textIndex: initialSource.title, tags: ["managebac"], status: "active", createdAt: now, updatedAt: now });
        await ctx.db.insert("externalProjections", { integrationId: f.seed.integrationId, schoolId: f.seed.schoolId,
          recordId: record._id, accountId, projectionType: "planner_task", projectionId: planId, providerKey: `planner:${index}`,
          sourceHash: "v1", state: "active", bootstrapVersion: 1, createdAt: now, updatedAt: now });
        planIds.push(planId);
      }
      return { recordId: record._id, planIds };
    });
    await page(changedSource, "v2");
    const plans = () => f.t.run(async ctx => Promise.all(seeded.planIds.map(id => ctx.db.get(id))));
    const hashOf = (plan: { content: unknown } | null) => (plan!.content as { source: { hash: string } }).source.hash;
    // The admitting page wrote no planner: every one of them needs the chain.
    expect((await plans()).filter(plan => hashOf(plan) === "v2")).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.get(runId))).toMatchObject({ projectionWorkRemaining: 1 });
    const completion = { seenProviderKeys: ["event:school"], reconciledCapabilityIds: [f.seed.capabilityId] };
    const completed = await f.user.mutation(api.managebac.completeSync, { integrationId: f.seed.integrationId, syncRunId: runId,
      ...completion, ...signed("sync-complete", createHash("sha256").update(canonicalJson(completion)).digest("base64url")) });
    expect(completed.status).toBe("running");
    await drain(f);
    const after = await plans();
    const updated = after.filter(plan => hashOf(plan) === "v2");
    expect(updated).toHaveLength(recipients - 1);
    expect(after[recipients - 1]!.content).toMatchObject({ taskTitle: initialSource.title, source: { hash: "v1" } });
    expect(updated.every(plan => plan!.title === changedSource.title)).toBe(true);
    const history = await f.t.run(ctx => ctx.db.query("spectraArtifactVersions").collect());
    // Each import is authored by the administrator, never by the recipient.
    expect(history.filter(version => version.source === "import").map(version => version.creatorAccountIds))
      .toEqual(Array(recipients - 1).fill([f.seed.accountId]));
    expect(await f.t.run(ctx => ctx.db.get(runId))).toMatchObject({ status: "completed", projectionWorkRemaining: 0 });
  });
});
