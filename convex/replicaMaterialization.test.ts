/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { getActorForAccountId } from "./identityShared";
import {
  queueMaterializationInTransaction,
  commitCloudMaterializationInTransaction,
  type QueueMaterializationArgs,
} from "./replicaMaterialization";
import { POLICY_PRESETS } from "../shared/sync-policy";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "clerk_replica_transaction", email: "native-tx@example.test", emailVerified: true };
const payloadHash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const baseHash = payloadHash("base");
const nextHash = payloadHash("next");
const bridgeCredential = "bridge-test-credential-000000000001";

// These are protocol payloads, not Office readback or end-to-end AI approval evidence.
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
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: actor.accountId, schoolId: actor.schoolId,
      sourceSurface: "artifact", status: "running", userPrompt: "Update the document",
      executionId: "attempt-1", createdAt: now, updatedAt: now,
    });
    const workId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor.accountId,
      schoolId: actor.schoolId,
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
      credentialHash: Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(bridgeCredential),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join(""),
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
    return {
      ...actor,
      runId,
      workId,
      deviceId,
      mountId,
      basePayloadId,
      nextPayloadId,
      cloudId,
      localId,
    };
  });
}

type Fixture = Awaited<ReturnType<typeof seedWork>>;
const projection = { blocks: [{ id: "body", text: "admitted native result" }] };
const projectionHash = payloadHash(JSON.stringify(projection));
const effects = (f: Fixture) => ({ actorKind: "ai" as const, canonicalProjection: "durable" as const, runId: f.runId });
const queueArgs = (f: Fixture): QueueMaterializationArgs => ({
  workId: f.workId, localReplicaId: f.localId, payloadRef: String(f.nextPayloadId),
  contentHash: nextHash, baseRevision: baseHash, fidelityMap: { entries: [] },
  regionIds: ["body"], partNames: ["/word/document.xml"],
  projectionContent: projection, projectionContentHash: projectionHash,
  projectionTextIndex: "admitted native result", promotionMode: "immediate-projection",
});
const cloudArgs = (f: Fixture) => ({
  workId: f.workId, payloadRef: String(f.nextPayloadId), contentHash: nextHash,
  baseRevision: baseHash, projectionContent: projection, projectionContentHash: projectionHash,
  fidelityMap: { entries: [] },
  nativeReceipt: {
    kind: "native-office-save" as const, format: "docx" as const,
    operationId: `native:${f.workId}:${baseHash}:${nextHash}`, artifactId: String(f.workId),
    basePayloadHash: baseHash, resultPayloadHash: nextHash, baseRevision: baseHash, resultRevision: nextHash,
    targets: { regionIds: ["body"], partNames: ["/word/document.xml"] },
    semantic: { resultDigest: projectionHash, readbackDigest: projectionHash },
    preservedPartNames: [], state: "cloud_saved" as const,
  },
});

const snapshot = (t: ReturnType<typeof convexTest>, f: Fixture) => t.run(async ctx => ({
  work: await ctx.db.get(f.workId),
  local: await ctx.db.get(f.localId),
  cloud: await ctx.db.get(f.cloudId),
  requests: await ctx.db.query("bridgeWriteRequests").collect(),
  operations: await ctx.db.query("syncOperations").collect(),
}));
async function invokeQueue(t: ReturnType<typeof convexTest>, f: Fixture, args = queueArgs(f)) {
  return t.run(async ctx => {
    const actor = await getActorForAccountId(ctx, f.accountId);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    return queueMaterializationInTransaction(ctx, actor, args, effects(f));
  });
}
async function invokeCloud(t: ReturnType<typeof convexTest>, f: Fixture) {
  return t.run(async ctx => {
    const actor = await getActorForAccountId(ctx, f.accountId);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    return commitCloudMaterializationInTransaction(ctx, actor, cloudArgs(f), effects(f));
  });
}

describe("Native materialization in the admitting mutation", () => {
  it("queues AI provenance and readback without an independent canonical projection", async () => {
    const t = convexTest(schema, modules);
    const f = await seedWork(t);
    const before = await snapshot(t, f);
    const result = await invokeQueue(t, f);
    const after = await snapshot(t, f);
    expect(result.state).toBe("pending");
    expect(after.work).toEqual(before.work);
    expect(after.cloud).toEqual(before.cloud);
    expect(after.requests).toHaveLength(1);
    expect(after.requests[0]).toMatchObject({
      projectionBaseContent: projection, projectionBaseContentHash: projectionHash, state: "pending",
    });
    expect(after.operations).toHaveLength(1);
    expect(after.operations[0]).toMatchObject({ actorKind: "ai", runId: f.runId, state: "pending" });
  });

  it.each(["queue", "cloud"] as const)("rolls back %s and preceding canonical writes if the caller fails", async destination => {
    const t = convexTest(schema, modules);
    const f = await seedWork(t);
    const before = await snapshot(t, f);
    await expect(t.run(async ctx => {
      const actor = await getActorForAccountId(ctx, f.accountId);
      if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
      await ctx.db.patch(f.workId, { content: projection, contentHash: projectionHash });
      if (destination === "queue")
        await queueMaterializationInTransaction(ctx, actor, queueArgs(f), effects(f));
      else
        await commitCloudMaterializationInTransaction(ctx, actor, cloudArgs(f), effects(f));
      throw new Error("CALLER_HISTORY_FAILED");
    })).rejects.toThrow("CALLER_HISTORY_FAILED");
    expect(await snapshot(t, f)).toEqual(before);
  });

  it("refuses a protected AI save before changing an existing request or pending content", async () => {
    const t = convexTest(schema, modules);
    const f = await seedWork(t);
    await t.withIdentity(identity).mutation(api.replicas.queueMaterialization, queueArgs(f));
    await t.run(ctx => ctx.db.insert("syncPolicies", {
      accountId: f.accountId, scopeKind: "item", scopeId: String(f.workId),
      ...POLICY_PRESETS.linked, createdAt: Date.now(), updatedAt: Date.now(),
    }));
    const before = await snapshot(t, f);
    await expect(invokeQueue(t, f)).rejects.toThrow("NATIVE_PROMOTION_PROTECTED");
    expect(await snapshot(t, f)).toEqual(before);
  });

  it.each(["payload", "mount", "native-base"] as const)("rejects a changed %s before queuing", async changed => {
    const t = convexTest(schema, modules);
    const f = await seedWork(t);
    await t.run(async ctx => {
      if (changed === "payload") await ctx.db.patch(f.nextPayloadId, { hash: baseHash });
      if (changed === "mount") await ctx.db.patch(f.mountId, { state: "detached" });
      if (changed === "native-base") await ctx.db.patch(f.localId, { revision: "newer" });
    });
    const before = await snapshot(t, f);
    await expect(invokeQueue(t, f)).rejects.toThrow();
    expect(await snapshot(t, f)).toEqual(before);
  });

  it("advances native cloud once and retains a newer canonical head on replay", async () => {
    const t = convexTest(schema, modules);
    const f = await seedWork(t);
    const first = await invokeCloud(t, f);
    const laterContent = { blocks: [{ id: "body", text: "newer canonical edit" }] };
    await t.run(ctx => ctx.db.patch(f.workId, { content: laterContent, contentHash: payloadHash(JSON.stringify(laterContent)) }));
    const beforeReplay = await snapshot(t, f);
    expect(await invokeCloud(t, f)).toEqual(first);
    expect(await snapshot(t, f)).toEqual(beforeReplay);
    expect(beforeReplay.cloud).toMatchObject({ revision: nextHash, payloadRef: String(f.nextPayloadId) });
    expect(beforeReplay.operations).toHaveLength(1);
    expect(beforeReplay.operations[0]).toMatchObject({ actorKind: "ai", runId: f.runId, state: "verified" });
  });
});
