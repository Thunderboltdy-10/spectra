/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

function requireWriteRequestId(
  requestId: Id<"bridgeWriteRequests"> | "protected-original",
): Id<"bridgeWriteRequests"> {
  if (requestId === "protected-original") {
    throw new Error("expected a Bridge write request, not a protected-original park");
  }
  return requestId;
}

const modules = import.meta.glob("./**/*.ts");

type HumanQueueArgs = { workId: Id<"spectraArtifacts">; payloadRef: string; contentHash: string; baseRevision: string;
  fidelityMap: { entries: unknown[] }; regionIds: string[]; partNames: string[] };
/** Human native writes are admitted only through the signed gateway mutation. */
async function queueHumanMaterialization(t: { mutation: ReturnType<typeof convexTest>["mutation"] }, accountId: Id<"accounts">, queue: HumanQueueArgs) {
  return await t.mutation(internal.nativeMaterialization.commitHuman, {
    accountId, artifactId: queue.workId, candidate: { destination: "bridge", queue },
  }) as { requestId: string; state: string };
}
const credential = "bridge-chaos-credential-000000000001";
const identity = {
  subject: "clerk_bridge_chaos",
  email: "bridge-chaos@example.test",
  emailVerified: true,
};
const baseHash = "a".repeat(64);
const nextHash = "b".repeat(64);

afterEach(() => vi.useRealTimers());

async function hashCredential(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedRevocation(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Bridge Chaos School",
      slug: `bridge-chaos-${crypto.randomUUID()}`,
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
      name: "Bridge Chaos",
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
    const deviceId = await ctx.db.insert("bridgeDevices", {
      accountId,
      name: "Chaos Bridge",
      platform: "windows",
      credentialHash: await hashCredential(credential),
      protocolVersion: "1",
      appVersion: "1",
      pairedAt: now,
      lastSeenAt: now,
      state: "active",
    });
    const mountId = await ctx.db.insert("bridgeMounts", {
      accountId,
      deviceId,
      rootLabel: "Chaos mount",
      grantId: "grant_deadbeef",
      rootKey: "c".repeat(64),
      state: "active",
      fileCount: 2_001,
      doubleSyncRisk: false,
      createdAt: now,
      updatedAt: now,
    });
    const workId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accountId,
      schoolId,
      blueprintKey: "resource",
      resourceClass: "resource",
      nativeFormat: "docx",
      compatibilityProfile: "strict-native",
      title: "Revocation fixture",
      content: null,
      contentHash: baseHash,
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const baseStorageId = await ctx.storage.store(new Blob(["base"]));
    const nextStorageId = await ctx.storage.store(new Blob(["next"]));
    const basePayloadId = await ctx.db.insert("payloadObjects", {
      accountId,
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
      accountId,
      hash: nextHash,
      storageId: nextStorageId,
      bytes: 4,
      mediaType: "application/test",
      refCount: 0,
      state: "active",
      createdAt: now,
      verifiedAt: now,
    });
    await ctx.db.insert("workReplicas", {
      accountId,
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
      accountId,
      workId,
      kind: "local",
      deviceId,
      mountId,
      localResourceId: "lr_bridge_chaos_primary",
      relativePath: "Primary.docx",
      nativeFormat: "docx",
      payloadRef: String(basePayloadId),
      revision: baseHash,
      baseRevision: baseHash,
      contentHash: baseHash,
      state: "current",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    return { accountId, deviceId, mountId, workId, localId, nextPayloadId };
  });
}

describe("Bridge revocation chaos", () => {
  it("compensates a claimed write and rejects the revoked credential", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fixture = await seedRevocation(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueHumanMaterialization(t, fixture.accountId, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const claimed = await t.mutation(api.bridgeSync.claimWrite, { credential });
    expect(claimed.request?.requestId).toBe(queued.requestId);

    await asUser.mutation(api.bridge.revokeDevice, { deviceId: fixture.deviceId });

    const immediatelyRevoked = await t.run(async (ctx) => ({
      device: await ctx.db.get(fixture.deviceId),
      mount: await ctx.db.get(fixture.mountId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(immediatelyRevoked.device?.state).toBe("revoked");
    expect(immediatelyRevoked.mount?.state).toBe("active");
    expect(immediatelyRevoked.local?.state).toBe("pending");
    await expect(t.mutation(api.bridgeSync.claimWrite, { credential }))
      .rejects.toThrow("BRIDGE_CREDENTIAL_INVALID");

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const truth = await t.run(async (ctx) => ({
      device: await ctx.db.get(fixture.deviceId),
      mount: await ctx.db.get(fixture.mountId),
      local: await ctx.db.get(fixture.localId),
      request: await ctx.db.get(requireWriteRequestId(queued.requestId)),
      operations: await ctx.db.query("syncOperations").collect(),
    }));
    expect(truth.device?.state).toBe("revoked");
    expect(truth.mount?.state).toBe("revoked");
    expect(truth.local).toMatchObject({ state: "unavailable", unavailableReason: "device-revoked" });
    expect(truth.request).toMatchObject({ state: "failed", errorCode: "device-revoked" });
    expect(truth.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "failed", errorCode: "device-revoked" }),
    ]));
  });

  it("resolves legacy same-key writes by replica during claim and cancellation", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedRevocation(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueHumanMaterialization(t, fixture.accountId, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const firstRequestId = requireWriteRequestId(queued.requestId);
    const firstOperationId = await t.run(async (ctx) => {
      const request = await ctx.db.get(firstRequestId);
      if (!request) throw new Error("test request missing");
      const operation = await ctx.db
        .query("syncOperations")
        .withIndex("by_account_key_replica", (q) =>
          q
            .eq("accountId", fixture.accountId)
            .eq("idempotencyKey", request.idempotencyKey)
            .eq("replicaId", fixture.localId),
        )
        .first();
      if (!operation) throw new Error("test operation missing");
      return operation._id;
    });
    const second = await t.run(async (ctx) => {
      const now = Date.now();
      const localResourceId = "lr_bridge_chaos_secondary";
      const replicaId = await ctx.db.insert("workReplicas", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        kind: "local",
        deviceId: fixture.deviceId,
        mountId: fixture.mountId,
        localResourceId,
        relativePath: "Secondary.docx",
        nativeFormat: "docx",
        payloadRef: String(fixture.nextPayloadId),
        revision: baseHash,
        baseRevision: baseHash,
        contentHash: baseHash,
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now,
      });
      const firstRequest = await ctx.db.get(firstRequestId);
      if (!firstRequest) throw new Error("test request missing");
      const requestId = await ctx.db.insert("bridgeWriteRequests", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId,
        deviceId: fixture.deviceId,
        mountId: fixture.mountId,
        localResourceId,
        relativePath: "Secondary.docx",
        payloadRef: String(fixture.nextPayloadId),
        baseRevision: baseHash,
        targetRevision: nextHash,
        contentHash: nextHash,
        idempotencyKey: firstRequest.idempotencyKey,
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        state: "pending",
        retryAt: now,
        attemptCount: 0,
        expiresAt: now + 60_000,
        createdAt: now,
        updatedAt: now,
      });
      const operationId = await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId,
        idempotencyKey: firstRequest.idempotencyKey,
        direction: "cloud-to-local",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "pending",
        actorKind: "user",
        createdAt: now,
        updatedAt: now,
      });
      return { requestId, operationId, replicaId };
    });

    const claim = await t.mutation(api.bridgeSync.claimWrite, { credential });
    expect(claim.request).toBeTruthy();
    const claimedLink = claim.request?.requestId === firstRequestId
      ? { requestId: firstRequestId, operationId: firstOperationId }
      : { requestId: second.requestId, operationId: second.operationId };
    expect(claim.request).toMatchObject(claimedLink);
    const pendingLink = claim.request?.requestId === firstRequestId ? second : {
      requestId: firstRequestId,
      operationId: firstOperationId,
      replicaId: fixture.localId,
    };
    const cancelled = await asUser.mutation(api.replicas.cancelMaterialization, {
      requestId: pendingLink.requestId,
    });
    expect(cancelled).toMatchObject({ cancelled: true, state: "failed" });
    const truth = await t.run(async (ctx) => ({
      claimedRequest: await ctx.db.get(claim.request!.requestId),
      claimedOperation: await ctx.db.get(claim.request!.operationId!),
      cancelledRequest: await ctx.db.get(pendingLink.requestId),
      cancelledOperation: await ctx.db.get(pendingLink.operationId),
    }));
    expect(truth.claimedRequest?.state).toBe("claimed");
    expect(truth.claimedOperation?.state).toBe("pending");
    expect(truth.cancelledRequest).toMatchObject({ state: "failed", errorCode: "cancelled-before-claim" });
    expect(truth.cancelledOperation).toMatchObject({ state: "failed", errorCode: "cancelled-before-claim" });
  });

  it("revokes every local replica on a 10k-capable mount", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fixture = await seedRevocation(t);
    const asUser = t.withIdentity(identity);
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let index = 1; index < 2_001; index += 1) {
        await ctx.db.insert("workReplicas", {
          accountId: fixture.accountId,
          workId: fixture.workId,
          kind: "local",
          deviceId: fixture.deviceId,
          mountId: fixture.mountId,
          localResourceId: `lr_bridge_chaos_${index.toString().padStart(4, "0")}`,
          relativePath: `Files/${index.toString().padStart(4, "0")}.docx`,
          nativeFormat: "docx",
          revision: baseHash,
          baseRevision: baseHash,
          contentHash: baseHash,
          state: "current",
          lastVerifiedAt: now,
          updatedAt: now,
        });
      }
    });

    await asUser.mutation(api.bridge.revokeDevice, { deviceId: fixture.deviceId });

    const immediatelyRevoked = await t.run(async (ctx) => ({
      device: await ctx.db.get(fixture.deviceId),
      replicas: await ctx.db.query("workReplicas").collect(),
    }));
    expect(immediatelyRevoked.device?.state).toBe("revoked");
    expect(immediatelyRevoked.replicas.filter((row) => row.deviceId === fixture.deviceId))
      .toHaveLength(2_001);
    expect(immediatelyRevoked.replicas.every((row) => row.state === "current")).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const states = await t.run(async (ctx) => {
      const replicas = await ctx.db.query("workReplicas").collect();
      return replicas
        .filter((replica) => replica.deviceId === fixture.deviceId)
        .map((replica) => replica.state);
    });
    const counts = states.reduce<Record<string, number>>((result, state) => {
      result[state] = (result[state] ?? 0) + 1;
      return result;
    }, {});
    expect({ total: states.length, counts }).toEqual({
      total: 2_001,
      counts: { unavailable: 2_001 },
    });
  }, 60_000);
});
