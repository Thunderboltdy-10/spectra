/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_replica_truth",
  email: "replica-truth@example.test",
  emailVerified: true,
};
const baseHash = "a".repeat(64);
const nextHash = "b".repeat(64);
const bridgeCredential = "bridge-test-credential-000000000001";

async function seedActor(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Replica Truth School",
      slug: `replica-truth-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: "Replica Truth",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId };
  });
}

async function seedWork(t: ReturnType<typeof convexTest>) {
  const actor = await seedActor(t);
  return t.run(async (ctx) => {
    const now = Date.now();
    const workId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor.accountId,
      blueprintKey: "resource",
      resourceClass: "resource",
      nativeFormat: "docx",
      compatibilityProfile: "strict-native",
      title: "Truth fixture",
      content: { blocks: [] },
      contentHash: baseHash,
      textIndex: "",
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const deviceId = await ctx.db.insert("bridgeDevices", {
      accountId: actor.accountId,
      name: "Test Bridge",
      platform: "windows",
      credentialHash: Array.from(new Uint8Array(await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(bridgeCredential),
      )), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      protocolVersion: "1",
      appVersion: "1",
      pairedAt: now,
      lastSeenAt: now,
      state: "active",
    });
    const mountId = await ctx.db.insert("bridgeMounts", {
      accountId: actor.accountId,
      deviceId,
      rootLabel: "Test",
      grantId: "grant_deadbeef",
      state: "active",
      fileCount: 1,
      doubleSyncRisk: false,
      createdAt: now,
      updatedAt: now,
    });
    const baseStorageId = await ctx.storage.store(new Blob(["base"]));
    const nextStorageId = await ctx.storage.store(new Blob(["next"]));
    const basePayloadId = await ctx.db.insert("payloadObjects", {
      accountId: actor.accountId,
      hash: baseHash,
      storageId: baseStorageId,
      bytes: 4,
      mediaType: "application/test",
      refCount: 2,
      state: "active",
      createdAt: now,
      verifiedAt: now,
    });
    const nextPayloadId = await ctx.db.insert("payloadObjects", {
      accountId: actor.accountId,
      hash: nextHash,
      storageId: nextStorageId,
      bytes: 4,
      mediaType: "application/test",
      refCount: 0,
      state: "active",
      createdAt: now,
      verifiedAt: now,
    });
    const cloudId = await ctx.db.insert("workReplicas", {
      accountId: actor.accountId,
      workId,
      kind: "cloud",
      nativeFormat: "docx",
      payloadRef: String(basePayloadId),
      revision: baseHash,
      baseRevision: baseHash,
      contentHash: baseHash,
      state: "current",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    const localId = await ctx.db.insert("workReplicas", {
      accountId: actor.accountId,
      workId,
      kind: "local",
      deviceId,
      mountId,
      localResourceId: "resource-1",
      relativePath: "Truth.docx",
      nativeFormat: "docx",
      payloadRef: String(basePayloadId),
      revision: baseHash,
      baseRevision: baseHash,
      contentHash: baseHash,
      state: "current",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    return { ...actor, workId, deviceId, mountId, basePayloadId, nextPayloadId, cloudId, localId };
  });
}

describe("replica truth machine", () => {
  it("derives one replay-safe request without optimistic current stamps", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const input = {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    };

    const first = await asUser.mutation(api.replicas.queueMaterialization, input);
    const replay = await asUser.mutation(api.replicas.queueMaterialization, input);

    expect(replay.requestId).toBe(first.requestId);
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      requests: await ctx.db.query("bridgeWriteRequests").collect(),
      operations: await ctx.db.query("syncOperations").collect(),
    }));
    expect(truth.requests).toHaveLength(1);
    expect(truth.operations).toHaveLength(1);
    expect(truth.cloud).toMatchObject({ state: "ahead", revision: nextHash });
    expect(truth.local).toMatchObject({ state: "pending", revision: baseHash });
    expect([truth.cloud?.state, truth.local?.state]).not.toContain("current");
  });

  it("keeps an external upload and its exact replay on the same replica truth", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    const input = {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: nextHash,
      bytes: 4,
      mediaType: "application/test",
      payloadRef: String(fixture.nextPayloadId),
    };

    const first = await t.mutation(api.bridgeSync.commitPayloadUpload, input);
    const afterFirst = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      operations: await ctx.db.query("syncOperations").collect(),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));
    const replay = await t.mutation(api.bridgeSync.commitPayloadUpload, input);
    const afterReplay = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      operations: await ctx.db.query("syncOperations").collect(),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));

    expect(first).toMatchObject({ externalChange: true });
    expect(replay).toEqual(first);
    expect(afterFirst.local).toMatchObject({
      state: "ahead",
      revision: nextHash,
      baseRevision: baseHash,
      contentHash: nextHash,
    });
    expect(afterFirst.cloud).toMatchObject({
      state: "behind",
      revision: baseHash,
      baseRevision: baseHash,
      contentHash: baseHash,
    });
    expect(afterFirst.operations).toHaveLength(1);
    expect(afterFirst.operations[0]).toMatchObject({
      direction: "external",
      revisionBefore: baseHash,
      revisionAfter: nextHash,
      state: "applied",
    });
    expect(afterFirst.conflicts).toEqual([]);
    expect(afterReplay).toEqual(afterFirst);
  });

  it("retains the verified common base across successive external saves", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    const thirdHash = "c".repeat(64);
    const thirdPayloadId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["third"]));
      return ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: thirdHash,
        storageId,
        bytes: 5,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      });
    });

    await t.mutation(api.bridgeSync.commitPayloadUpload, {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: nextHash,
      bytes: 4,
      mediaType: "application/test",
      payloadRef: String(fixture.nextPayloadId),
    });
    await t.mutation(api.bridgeSync.commitPayloadUpload, {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: thirdHash,
      bytes: 5,
      mediaType: "application/test",
      payloadRef: String(thirdPayloadId),
    });

    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      operations: await ctx.db.query("syncOperations").collect(),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));
    expect(truth.local).toMatchObject({
      state: "ahead",
      revision: thirdHash,
      baseRevision: baseHash,
      contentHash: thirdHash,
    });
    expect(truth.cloud).toMatchObject({ state: "behind", revision: baseHash, contentHash: baseHash });
    expect(truth.operations).toHaveLength(2);
    expect(new Set(truth.operations.map((operation) => operation.idempotencyKey)).size).toBe(2);
    expect(truth.conflicts).toEqual([]);
  });

  it("compensates an expired claimed write and its dependent rows", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    const ids = await t.run(async (ctx) => {
      const then = Date.now() - 60 * 60_000;
      await ctx.db.patch(fixture.localId, { state: "pending", updatedAt: then });
      const requestId = await ctx.db.insert("bridgeWriteRequests", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        deviceId: fixture.deviceId,
        mountId: fixture.mountId,
        localResourceId: "resource-1",
        relativePath: "Truth.docx",
        payloadRef: String(fixture.nextPayloadId),
        baseRevision: baseHash,
        targetRevision: nextHash,
        contentHash: nextHash,
        idempotencyKey: "expired-write",
        regionIds: [],
        partNames: [],
        state: "claimed",
        claimedAt: then,
        attemptCount: 1,
        expiresAt: then + 1,
        createdAt: then,
        updatedAt: then,
      });
      const operationId = await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "expired-write",
        direction: "cloud-to-local",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "pending",
        actorKind: "user",
        createdAt: then,
        updatedAt: then,
      });
      return { requestId, operationId };
    });

    const result = await t.mutation(internal.replicas.sweepReplicaTruth, {});
    expect(result.failedWrites).toBe(1);
    const truth = await t.run(async (ctx) => ({
      request: await ctx.db.get(ids.requestId),
      operation: await ctx.db.get(ids.operationId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.request).toMatchObject({ state: "failed", errorCode: "write-expired" });
    expect(truth.operation).toMatchObject({ state: "failed", errorCode: "write-expired" });
    expect(truth.local).toMatchObject({ state: "error", errorCode: "write-expired" });
  });

  it("releases only payload bytes with no live references", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    await t.run(async (ctx) => ctx.db.patch(fixture.nextPayloadId, {
      verifiedAt: Date.now() - 25 * 60 * 60_000,
    }));

    const result = await t.mutation(internal.replicas.sweepReplicaTruth, {});
    expect(result.releasedPayloads).toBe(1);
    const truth = await t.run(async (ctx) => ({
      released: await ctx.db.get(fixture.nextPayloadId),
      retained: await ctx.db.get(fixture.basePayloadId),
    }));
    expect(truth.released).toMatchObject({ state: "released", refCount: 0 });
    expect(truth.retained).toMatchObject({ state: "active" });
  });

  it("finishes cloud-to-device storage only after Bridge read-back", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    await t.run(async (ctx) => ctx.db.delete(fixture.localId));
    const asUser = t.withIdentity(identity);

    const transition = await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
      mountId: fixture.mountId,
      relativePath: "Truth.docx",
    });
    expect(transition.state).toBe("pending");
    expect(transition.materializationRequestId).not.toBeNull();
    const replay = await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
      mountId: fixture.mountId,
      relativePath: "Truth.docx",
    });
    expect(replay.transitionId).toBe(transition.transitionId);
    expect(replay.materializationRequestId).toBe(transition.materializationRequestId);

    const completed = await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: transition.materializationRequestId!,
      outcome: "verified",
      actualRevision: baseHash,
    });
    expect(completed.state).toBe("verified");
    const truth = await t.run(async (ctx) => ({
      transition: await ctx.db.get(transition.transitionId),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.query("workReplicas")
        .withIndex("by_work_kind", (q) => q.eq("workId", fixture.workId).eq("kind", "local"))
        .unique(),
    }));
    expect(truth.transition).toMatchObject({ state: "verified", toPreset: "device" });
    expect(truth.cloud).toMatchObject({ state: "unavailable", unavailableReason: "metadata-only" });
    expect(truth.cloud?.payloadRef).toBeUndefined();
    expect(truth.local).toMatchObject({ state: "current", revision: baseHash });
    expect(truth.local?.payloadRef).toBeUndefined();
    await expect(asUser.mutation(api.payloads.issueUpload, { workId: fixture.workId }))
      .rejects.toThrow("CLOUD_CONTENT_METADATA_ONLY");
  });

  it("finishes Keep in Spectra by attaching a retained payload without waiting on Bridge", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
    });
    const afterDevice = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      payload: await ctx.db.get(fixture.basePayloadId),
    }));
    expect(afterDevice.cloud).toMatchObject({ state: "unavailable", unavailableReason: "metadata-only" });
    expect(afterDevice.cloud?.payloadRef).toBeUndefined();
    expect(afterDevice.local?.payloadRef).toBeUndefined();
    expect(afterDevice.payload).toMatchObject({ state: "active", hash: baseHash });

    const transition = await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "spectra",
    });
    expect(transition.state).toBe("verified");
    const truth = await t.run(async (ctx) => ({
      transition: await ctx.db.get(transition.transitionId),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.transition).toMatchObject({ state: "verified", toPreset: "spectra" });
    expect(truth.cloud).toMatchObject({
      state: "current",
      payloadRef: String(fixture.basePayloadId),
      contentHash: baseHash,
    });
    expect(truth.local).toMatchObject({ state: "unavailable", unavailableReason: "unlinked-by-user" });
  });

  it("completes Keep in Spectra from disk-only bytes after Bridge uploads them", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.basePayloadId, { state: "released" });
    });
    const transition = await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "spectra",
    });
    expect(transition.state).toBe("pending");
    const claimed = await t.mutation(api.bridgeSync.claimPendingPayloadUpload, {
      credential: bridgeCredential,
    });
    expect(claimed.request).toMatchObject({
      replicaId: fixture.localId,
      relativePath: "Truth.docx",
    });
    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["base"])));
    await t.mutation(api.bridgeSync.commitPayloadUpload, {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: baseHash,
      bytes: 4,
      mediaType: "application/test",
      storageId,
    });
    const truth = await t.run(async (ctx) => ({
      transition: await ctx.db.get(transition.transitionId),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.transition).toMatchObject({ state: "verified", toPreset: "spectra" });
    expect(truth.cloud).toMatchObject({ state: "current", contentHash: baseHash });
    expect(truth.cloud?.payloadRef).toBeTruthy();
    expect(truth.local).toMatchObject({ state: "unavailable", unavailableReason: "unlinked-by-user" });
  });

  it("gives Library the full replica set so a This-PC file is not Unavailable", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
    });
    const rows = await asUser.query(api.replicas.presentationsForAccount, {});
    const row = rows.find((candidate) => candidate.workId === fixture.workId);
    expect(row?.replicas).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "local", state: "current" }),
      expect.objectContaining({ kind: "cloud", state: "unavailable" }),
    ]));
    expect(row?.replicas.some((replica) => replica.kind === "local" && replica.state === "current")).toBe(true);
  });

  it("sweeps a stalled pending storage transition so the radios can exit", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    const stalledAt = Date.now() - 3 * 60_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.cloudId, {
        payloadRef: undefined,
        contentHash: undefined,
        state: "unavailable",
        unavailableReason: "metadata-only",
      });
    });
    const transitionId = await t.run(async (ctx) =>
      ctx.db.insert("storageStrategyTransitions", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        idempotencyKey: "strategy_stall_test",
        fromPreset: "both",
        toPreset: "spectra",
        state: "pending",
        before: { hadItemPolicy: false, preset: "both" },
        createdAt: stalledAt,
        updatedAt: stalledAt,
      }),
    );
    const result = await t.mutation(internal.replicas.sweepReplicaTruth, {});
    expect(result.failedTransitions).toBe(1);
    const transition = await t.run(async (ctx) => ctx.db.get(transitionId));
    expect(transition).toMatchObject({ state: "failed", errorCode: "strategy-transition-failed" });
  });

  it("makes linked storage metadata-only without losing the verified local revision", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);

    const transition = await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "linked",
    });
    expect(transition.state).toBe("verified");
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.cloud).toMatchObject({ state: "unavailable", unavailableReason: "metadata-only" });
    expect(truth.cloud?.payloadRef).toBeUndefined();
    expect(truth.local).toMatchObject({ state: "current", contentHash: baseHash, protectedOriginal: true });
    expect(truth.local?.payloadRef).toBeUndefined();
  });

  it("rolls a storage strategy back when Bridge read-back disagrees", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    await t.run(async (ctx) => ctx.db.delete(fixture.localId));
    const asUser = t.withIdentity(identity);
    const transition = await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
      mountId: fixture.mountId,
      relativePath: "Truth.docx",
    });

    const completed = await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: transition.materializationRequestId!,
      outcome: "verified",
      actualRevision: nextHash,
    });
    expect(completed.state).toBe("failed");
    const [truth, policy] = await Promise.all([
      t.run(async (ctx) => ({
        transition: await ctx.db.get(transition.transitionId),
        cloud: await ctx.db.get(fixture.cloudId),
      })),
      asUser.query(api.syncPolicy.effective, { itemId: String(fixture.workId) }),
    ]);
    expect(truth.transition).toMatchObject({ state: "failed", errorCode: "readback-revision-mismatch" });
    expect(truth.cloud).toMatchObject({ state: "current", payloadRef: String(fixture.basePayloadId) });
    expect(policy.preset).toBe("spectra");
  });

  it("parks a locked write outside the eligible claim window", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const queued = await asUser.mutation(api.replicas.queueMaterialization, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const claimed = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    const requestId = queued.requestId as Id<"bridgeWriteRequests">;
    expect(claimed.request?.requestId).toBe(requestId);
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId,
      outcome: "waiting",
      errorCode: "office-locked",
      errorMessage: "Waiting for Office",
    });

    const immediate = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    expect(immediate.request).toBeNull();
    const request = await t.run(async (ctx) => ctx.db.get(requestId));
    expect(request).toMatchObject({ state: "pending", errorCode: "office-locked" });
    expect(request?.retryAt).toBeGreaterThan(Date.now());
  });

  it("reconciles legacy labels from retained payload hashes", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        revision: "legacy-current",
        state: "current",
      });
    });

    const result = await t.mutation(internal.replicas.reconcileReplicaTruthMigration, {});
    expect(result.state).toBe("complete");
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));
    expect(truth.cloud).toMatchObject({ state: "diverged", revision: baseHash });
    expect(truth.local).toMatchObject({ state: "diverged", revision: nextHash });
    expect(truth.conflicts).toHaveLength(1);
    expect(truth.conflicts[0]).toMatchObject({
      state: "open",
      localPayloadRef: String(fixture.nextPayloadId),
      spectraPayloadRef: String(fixture.basePayloadId),
    });
  });

  it("migrates a local-only full-cloud work to ahead, never false current", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    await t.run(async (ctx) => ctx.db.delete(fixture.cloudId));

    await t.mutation(internal.replicas.reconcileReplicaTruthMigration, {});
    const local = await t.run(async (ctx) => ctx.db.get(fixture.localId));
    expect(local).toMatchObject({ state: "ahead", revision: baseHash, contentHash: baseHash });
  });

  it("keeps both byte versions by moving the local identity to a real fork", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        revision: nextHash,
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.patch(fixture.cloudId, { state: "diverged", updatedAt: now });
      await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.withIdentity(identity).mutation(api.replicas.resolveExternalConflict, {
      workId: fixture.workId,
      resolution: "keep-both",
    });
    expect(result.resolved).toBe(1);
    expect(result.workId).not.toBeNull();
    const truth = await t.run(async (ctx) => {
      const forkId = result.workId as Id<"spectraArtifacts">;
      return {
        fork: await ctx.db.get(forkId),
        local: await ctx.db.get(fixture.localId),
        forkCloud: await ctx.db.query("workReplicas")
          .withIndex("by_work_kind", (q) => q.eq("workId", forkId).eq("kind", "cloud"))
          .unique(),
        originalCloud: await ctx.db.get(fixture.cloudId),
        conflict: (await ctx.db.query("syncConflicts").collect())[0],
      };
    });
    expect(truth.fork).toMatchObject({ resourceClass: "resource", contentHash: nextHash });
    expect(truth.local).toMatchObject({ workId: result.workId, payloadRef: String(fixture.nextPayloadId), state: "current" });
    expect(truth.forkCloud).toMatchObject({ payloadRef: String(fixture.nextPayloadId), state: "current" });
    expect(truth.originalCloud).toMatchObject({ payloadRef: String(fixture.basePayloadId), state: "current" });
    expect(truth.conflict).toMatchObject({ state: "forked", forkedWorkId: result.workId });
  });

  it("resolves only the conflict covered by the reconciled revision and regions", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWork(t);
    const conflicts = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        revision: nextHash,
        contentHash: nextHash,
        state: "ahead",
        updatedAt: now,
      });
      await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "external-next",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
      const relevant = await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
      const unrelated = await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["header"],
        partNames: ["word/header1.xml"],
        localRevision: "c".repeat(64),
        spectraRevision: baseHash,
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
      return { relevant, unrelated };
    });

    const result = await t.withIdentity(identity).mutation(api.replicas.recordExternalReconciliation, {
      workId: fixture.workId,
      localReplicaId: fixture.localId,
      localPayloadRef: String(fixture.nextPayloadId),
      localRevision: nextHash,
      content: { blocks: [{ id: "body", text: "external" }] },
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      conflictRegionIds: [],
      resolution: "local",
    });
    expect(result.state).toBe("applied");
    const truth = await t.run(async (ctx) => ({
      relevant: await ctx.db.get(conflicts.relevant),
      unrelated: await ctx.db.get(conflicts.unrelated),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      work: await ctx.db.get(fixture.workId),
    }));
    expect(truth.relevant).toMatchObject({ state: "resolved-local" });
    expect(truth.unrelated).toMatchObject({ state: "open" });
    expect(truth.cloud).toMatchObject({ state: "current", revision: nextHash, payloadRef: String(fixture.nextPayloadId) });
    expect(truth.local).toMatchObject({ state: "current", revision: nextHash });
    expect(truth.work?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
