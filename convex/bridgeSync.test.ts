/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const credential = "bridge-batch-test-credential-00000001";

async function seedBridge(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Bridge Batch School",
      slug: `bridge-batch-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: `clerk_bridge_batch_${crypto.randomUUID()}`,
      email: "bridge-batch@example.test",
      emailVerified: true,
      name: "Bridge Batch",
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
    const credentialHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const deviceId = await ctx.db.insert("bridgeDevices", {
      accountId,
      name: "Batch Bridge",
      platform: "windows",
      credentialHash,
      protocolVersion: "1",
      appVersion: "1",
      pairedAt: now,
      lastSeenAt: now,
      state: "active",
    });
    const rootOrgNodeId = await ctx.db.insert("orgNodes", {
      accountId,
      schoolId,
      parentId: null,
      kind: "folder",
      name: "Mounted",
      orderKey: "a",
      createdAt: now,
      updatedAt: now,
    });
    const mountId = await ctx.db.insert("bridgeMounts", {
      accountId,
      deviceId,
      rootLabel: "Mounted",
      grantId: "grant_deadbeef",
      rootKey: "a".repeat(64),
      rootOrgNodeId,
      state: "active",
      fileCount: 2,
      doubleSyncRisk: false,
      lastScanId: crypto.randomUUID(),
      lastScanAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, deviceId, mountId };
  });
}

async function seedDeletedWrite(t: ReturnType<typeof convexTest>, state: "pending" | "claimed") {
  const fixture = await seedBridge(t);
  const discovery = await t.mutation(api.bridgeSync.discoverResourcesPage, {
    credential,
    mountId: fixture.mountId,
    resources: [{
      localResourceId: `lr_${state === "pending" ? "f".repeat(16) : "e".repeat(16)}`,
      relativePath: "Deleted/Essay.docx",
      size: 42,
      contentHash: "a".repeat(64),
      nativeFormat: "docx",
    }],
  });
  const registration = discovery.registrations[0];
  if (!("replicaId" in registration) || !registration.replicaId) throw new Error("Expected a discovered replica");
  const replicaId: Id<"workReplicas"> = registration.replicaId;
  const seeded = await t.run(async (ctx) => {
    const replica = await ctx.db.get(replicaId);
    if (!replica) throw new Error("Expected replica row");
    const now = Date.now();
    const idempotencyKey = `deleted-work-${state}-${crypto.randomUUID()}`;
    await ctx.db.patch(replica._id, {
      state: "pending",
      payloadRef: "payload-orphan",
      pendingPayloadRef: "payload-pending",
      projectionBasePayloadRef: "payload-base",
      updatedAt: now,
    });
    const operationId = await ctx.db.insert("syncOperations", {
      accountId: fixture.accountId,
      workId: replica.workId,
      replicaId: replica._id,
      idempotencyKey,
      direction: "cloud-to-local",
      actorKind: "reconciliation",
      state: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const requestId = await ctx.db.insert("bridgeWriteRequests", {
      accountId: fixture.accountId,
      workId: replica.workId,
      replicaId: replica._id,
      deviceId: fixture.deviceId,
      mountId: fixture.mountId,
      localResourceId: replica.localResourceId ?? "lr_deleted-work",
      relativePath: replica.relativePath ?? "Deleted/Essay.docx",
      payloadRef: "payload-orphan",
      baseRevision: "a".repeat(64),
      targetRevision: "b".repeat(64),
      contentHash: "b".repeat(64),
      idempotencyKey,
      regionIds: [],
      partNames: [],
      state,
      ...(state === "claimed" ? { claimedAt: now, attemptCount: 1 } : { retryAt: now - 1 }),
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.delete(replica.workId);
    return { operationId, requestId, replicaId: replica._id };
  });
  return { fixture, ...seeded };
}

describe("Bridge incremental cloud seam", () => {
  it("fails pending native writes after the work is deleted and releases replica payload refs", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedDeletedWrite(t, "pending");

    const result = await t.mutation(api.bridgeSync.claimWrite, { credential });
    expect(result).toEqual({ request: null });
    const state = await t.run(async (ctx) => ({
      request: await ctx.db.get(seeded.requestId),
      operation: await ctx.db.get(seeded.operationId),
      replica: await ctx.db.get(seeded.replicaId),
    }));
    const replica = state.replica as Doc<"workReplicas"> | null;
    expect(state.request).toMatchObject({ state: "failed", errorCode: "work-no-longer-exists" });
    expect(state.operation).toMatchObject({ state: "failed", errorCode: "work-no-longer-exists" });
    expect(state.replica).toMatchObject({
      state: "unavailable",
      unavailableReason: "work-no-longer-exists",
      errorCode: "work-no-longer-exists",
    });
    expect(replica?.payloadRef).toBeUndefined();
    expect(replica?.pendingPayloadRef).toBeUndefined();
    expect(replica?.projectionBasePayloadRef).toBeUndefined();
  });

  it("fails an in-flight native write completion after the work is deleted", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedDeletedWrite(t, "claimed");

    const result = await t.mutation(api.bridgeSync.completeWrite, {
      credential,
      requestId: seeded.requestId,
      outcome: "waiting",
    });
    expect(result).toEqual({ state: "failed" });
    const state = await t.run(async (ctx) => ({
      request: await ctx.db.get(seeded.requestId),
      operation: await ctx.db.get(seeded.operationId),
      replica: await ctx.db.get(seeded.replicaId),
    }));
    const replica = state.replica as Doc<"workReplicas"> | null;
    expect(state.request).toMatchObject({ state: "failed", errorCode: "work-no-longer-exists" });
    expect(state.operation).toMatchObject({ state: "failed", errorCode: "work-no-longer-exists" });
    expect(state.replica).toMatchObject({ state: "unavailable", unavailableReason: "work-no-longer-exists" });
    expect(replica?.payloadRef).toBeUndefined();
  });

  it("does not claim a pending native structure operation after the work is deleted", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedBridge(t);
    const discovery = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: `lr_${"d".repeat(16)}`,
        relativePath: "Deleted/Essay.docx",
        size: 42,
        contentHash: "a".repeat(64),
        nativeFormat: "docx",
      }],
    });
    const registration = discovery.registrations[0];
    if (!("replicaId" in registration) || !registration.replicaId) throw new Error("Expected a discovered replica");
    const replicaId: Id<"workReplicas"> = registration.replicaId;
    const seeded = await t.run(async (ctx) => {
      const replica = await ctx.db.get(replicaId);
      if (!replica) throw new Error("Expected replica row");
      const now = Date.now();
      const requestId = await ctx.db.insert("bridgeFsRequests", {
        accountId: fixture.accountId,
        workId: replica.workId,
        replicaId: replica._id,
        deviceId: fixture.deviceId,
        mountId: fixture.mountId,
        localResourceId: replica.localResourceId ?? `lr_${"d".repeat(16)}`,
        direction: "spectra-to-disk",
        kind: "delete",
        sourceRelativePath: "Deleted/Essay.docx",
        idempotencyKey: `structure-deleted-${crypto.randomUUID()}`,
        state: "pending",
        explanation: "Delete the file after deleting the work.",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.delete(replica.workId);
      return { requestId, replicaId: replica._id };
    });

    const result = await t.mutation(api.bridgeStructure.claim, { credential });
    expect(result).toEqual({ request: null });
    const state = await t.run(async (ctx) => ({
      request: await ctx.db.get(seeded.requestId),
      replica: await ctx.db.get(seeded.replicaId),
    }));
    expect(state.request).toMatchObject({ state: "failed", errorCode: "work-no-longer-exists" });
    expect(state.replica).toMatchObject({ state: "unavailable", unavailableReason: "work-no-longer-exists" });
  });

  it("isolates a malformed discovery entry while registering the rest of the page", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedBridge(t);
    const result = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [
        {
          localResourceId: "lr_aaaaaaaaaaaaaaaa",
          relativePath: "Reports/Essay.docx",
          size: 42,
          contentHash: "a".repeat(64),
          nativeFormat: "docx",
        },
        {
          localResourceId: "not-a-stable-id",
          relativePath: "Reports/Broken.docx",
          size: 1,
          contentHash: "b".repeat(64),
          nativeFormat: "docx",
        },
      ],
    });

    expect(result.registrations).toHaveLength(2);
    expect(result.registrations[0]).toMatchObject({ needsPayload: true });
    expect(result.registrations[1]).toMatchObject({ skipped: true });
    const truth = await t.run(async (ctx) => ({
      works: await ctx.db.query("spectraArtifacts").collect(),
      replicas: await ctx.db.query("workReplicas").collect(),
    }));
    expect(truth.works).toHaveLength(1);
    expect(truth.replicas).toHaveLength(1);
  });

  it("preserves one work identity through rename and reports disappearance as unavailable", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedBridge(t);
    const discovery = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: "lr_bbbbbbbbbbbbbbbb",
        relativePath: "Before/Essay.docx",
        size: 42,
        contentHash: "a".repeat(64),
        nativeFormat: "docx",
      }],
    });
    const originalRegistration = discovery.registrations[0];
    if (!("replicaId" in originalRegistration)) {
      throw new Error(`Expected resource registration, got ${originalRegistration.reason}`);
    }
    const originalReplicaId = originalRegistration.replicaId;

    const renameChange = {
      journalId: `op_${"1".repeat(32)}`,
      resourceId: "lr_bbbbbbbbbbbbbbbb",
      op: "upsert" as const,
      relativePath: "After/Essay.docx",
      previousRelativePath: "Before/Essay.docx",
      hash: "b".repeat(64),
      revisionBefore: "a".repeat(64),
      size: 43,
      nativeFormat: "docx",
    };
    const renamed = await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [renameChange],
    });
    expect(renamed.results[0]).toMatchObject({
      state: "payload-required",
      replicaId: String(originalReplicaId),
      needsPayload: true,
    });
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [renameChange],
    });

    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"2".repeat(32)}`,
        resourceId: "lr_bbbbbbbbbbbbbbbb",
        op: "unavailable",
        relativePath: "After/Essay.docx",
      }],
    });
    const truth = await t.run(async (ctx) => ({
      works: await ctx.db.query("spectraArtifacts").collect(),
      replicas: await ctx.db.query("workReplicas").collect(),
    }));
    expect(truth.works).toHaveLength(1);
    expect(truth.works[0].status).toBe("active");
    expect(truth.replicas).toHaveLength(1);
    expect(truth.replicas[0]).toMatchObject({
      _id: originalReplicaId,
      relativePath: "After/Essay.docx",
      state: "unavailable",
      unavailableReason: "missing-on-disk",
    });

    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"3".repeat(32)}`,
        resourceId: "lr_cccccccccccccccc",
        op: "upsert",
        relativePath: "After/Essay.docx",
        hash: "c".repeat(64),
        size: 44,
        nativeFormat: "docx",
      }],
    });
    const recreated = await t.run(async (ctx) => ({
      works: await ctx.db.query("spectraArtifacts").collect(),
      replicas: await ctx.db.query("workReplicas").collect(),
    }));
    expect(recreated.works).toHaveLength(2);
    expect(recreated.replicas).toHaveLength(2);
    expect(recreated.replicas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _id: originalReplicaId,
        localResourceId: "lr_bbbbbbbbbbbbbbbb",
        state: "unavailable",
      }),
      expect.objectContaining({
        localResourceId: "lr_cccccccccccccccc",
        relativePath: "After/Essay.docx",
      }),
    ]));
  });

  it("records a writer lock without claiming the file is up to date", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedBridge(t);
    const discovered = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: "lr_dddddddddddddddd",
        relativePath: "Essay.docx",
        size: 42,
        contentHash: "a".repeat(64),
        nativeFormat: "docx",
      }],
    });
    const registration = discovered.registrations[0];
    if (!("replicaId" in registration) || !registration.replicaId) {
      throw new Error(`Expected resource registration, got ${"reason" in registration ? registration.reason : "unknown"}`);
    }
    const replicaId = registration.replicaId;
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"4".repeat(32)}`,
        resourceId: "lr_dddddddddddddddd",
        op: "locked",
      }],
    });
    const locked = await t.run(async (ctx) => ctx.db.get(replicaId));
    expect(locked).toMatchObject({ errorCode: "office-locked" });
    expect(locked?.state).not.toBe("error");
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"5".repeat(32)}`,
        resourceId: "lr_dddddddddddddddd",
        op: "upsert",
        relativePath: "Essay.docx",
        hash: "b".repeat(64),
        size: 44,
        nativeFormat: "docx",
      }],
    });
    const verified = await t.run(async (ctx) => ctx.db.get(replicaId));
    expect(verified?.errorCode).toBeUndefined();
  });

  it("clears a writer lock when Word finishes without a new revision", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedBridge(t);
    const discovered = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: "lr_eeeeeeeeeeeeeeee",
        relativePath: "Essay.docx",
        size: 42,
        contentHash: "a".repeat(64),
        nativeFormat: "docx",
      }],
    });
    const registration = discovered.registrations[0];
    if (!("replicaId" in registration) || !registration.replicaId) {
      throw new Error(`Expected resource registration, got ${"reason" in registration ? registration.reason : "unknown"}`);
    }
    const replicaId = registration.replicaId;
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"6".repeat(32)}`,
        resourceId: "lr_eeeeeeeeeeeeeeee",
        op: "locked",
      }],
    });
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"7".repeat(32)}`,
        resourceId: "lr_eeeeeeeeeeeeeeee",
        op: "unlocked",
      }],
    });
    const released = await t.run(async (ctx) => ctx.db.get(replicaId));
    expect(released?.errorCode).toBeUndefined();
    expect(released?.state).not.toBe("error");
  });
});
