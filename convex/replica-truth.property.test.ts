/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const credential = "bridge-property-test-credential-0001";

afterEach(() => vi.useRealTimers());
const identity = {
  subject: "clerk_replica_property",
  email: "replica-property@example.test",
  emailVerified: true,
};

type TestHarness = ReturnType<typeof convexTest>;
type Fixture = Awaited<ReturnType<typeof seedTruthMachine>>;
type ExternalCommit = { hash: string; payloadRef: string };

const payloadBytes = new Map<string, string>();
function hashFor(index: number) {
  const bytes = index.toString(16).padStart(64, "0");
  const hash = createHash("sha256").update(bytes).digest("hex");
  payloadBytes.set(hash, bytes);
  return hash;
}

async function credentialHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function insertPayload(t: TestHarness, accountId: Id<"accounts">, hash: string) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([payloadBytes.get(hash)!]));
    const payloadId = await ctx.db.insert("payloadObjects", {
      accountId,
      hash,
      storageId,
      bytes: hash.length,
      mediaType: "application/test",
      refCount: 0,
      state: "active",
      createdAt: Date.now(),
      verifiedAt: Date.now(),
    });
    return { payloadId, storageId };
  });
}

async function seedTruthMachine(t: TestHarness) {
  const baseHash = hashFor(1);
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Replica Property School",
      slug: `replica-property-${crypto.randomUUID()}`,
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
      name: "Replica Property",
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
      name: "Property Bridge",
      platform: "windows",
      credentialHash: await credentialHash(credential),
      protocolVersion: "1",
      appVersion: "1",
      pairedAt: now,
      lastSeenAt: now,
      state: "active",
    });
    const mountId = await ctx.db.insert("bridgeMounts", {
      accountId,
      deviceId,
      rootLabel: "Property mount",
      grantId: "grant_deadbeef",
      rootKey: hashFor(99),
      state: "active",
      fileCount: 1,
      doubleSyncRisk: false,
      createdAt: now,
      updatedAt: now,
    });
    const workId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accountId,
      blueprintKey: "resource",
      resourceClass: "resource",
      nativeFormat: "docx",
      compatibilityProfile: "strict-native",
      title: "Property fixture",
      content: { blocks: [{ id: "body", text: "base" }] },
      contentHash: baseHash,
      textIndex: "base",
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const baseStorageId = await ctx.storage.store(new Blob([payloadBytes.get(baseHash)!]));
    const basePayloadId = await ctx.db.insert("payloadObjects", {
      accountId,
      hash: baseHash,
      storageId: baseStorageId,
      bytes: baseHash.length,
      mediaType: "application/test",
      refCount: 2,
      state: "active",
      createdAt: now,
      verifiedAt: now,
    });
    const cloudId = await ctx.db.insert("workReplicas", {
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
      localResourceId: "lr_property_0001",
      relativePath: "Property.docx",
      nativeFormat: "docx",
      payloadRef: String(basePayloadId),
      revision: baseHash,
      baseRevision: baseHash,
      contentHash: baseHash,
      state: "current",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    return { accountId, workId, deviceId, mountId, cloudId, localId, baseHash };
  });
}

async function externalSave(
  t: TestHarness,
  fixture: Fixture,
  hash: string,
): Promise<ExternalCommit> {
  const stored = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([payloadBytes.get(hash)!]));
    return { storageId };
  });
  const result = await t.mutation(api.bridgeSync.commitPayloadUpload, {
    credential,
    replicaId: fixture.localId,
    hash,
    bytes: hash.length,
    mediaType: "application/test",
    storageId: stored.storageId,
  });
  return { hash, payloadRef: result.payloadRef };
}

async function replayExternalSave(t: TestHarness, fixture: Fixture, commit: ExternalCommit) {
  return t.mutation(api.bridgeSync.commitPayloadUpload, {
    credential,
    replicaId: fixture.localId,
    hash: commit.hash,
    bytes: commit.hash.length,
    mediaType: "application/test",
    payloadRef: commit.payloadRef,
  });
}

async function semanticSnapshot(t: TestHarness, fixture: Fixture) {
  return t.run(async (ctx) => {
    const replicas = (await ctx.db.query("workReplicas").collect())
      .filter((replica) => replica.workId === fixture.workId);
    const operations = (await ctx.db.query("syncOperations").collect())
      .filter((operation) => operation.workId === fixture.workId);
    const conflicts = (await ctx.db.query("syncConflicts").collect())
      .filter((conflict) => conflict.workId === fixture.workId);
    return {
      replicas: replicas.map((replica) => ({
        kind: replica.kind,
        state: replica.state,
        revision: replica.revision,
        baseRevision: replica.baseRevision,
        contentHash: replica.contentHash,
        payloadRef: replica.payloadRef,
      })).sort((left, right) => left.kind.localeCompare(right.kind)),
      operations: operations.map((operation) => ({
        key: operation.idempotencyKey,
        direction: operation.direction,
        before: operation.revisionBefore,
        after: operation.revisionAfter,
        state: operation.state,
      })),
      conflicts: conflicts.map((conflict) => ({
        localRevision: conflict.localRevision,
        spectraRevision: conflict.spectraRevision,
        state: conflict.state,
      })),
    };
  });
}

async function invariantProblems(t: TestHarness, fixture: Fixture) {
  return t.run(async (ctx) => {
    const [replicas, requests, operations, payloads] = await Promise.all([
      ctx.db.query("workReplicas").collect(),
      ctx.db.query("bridgeWriteRequests").collect(),
      ctx.db.query("syncOperations").collect(),
      ctx.db.query("payloadObjects").collect(),
    ]);
    const problems: string[] = [];
    const payloadByRef = new Map(payloads.map((payload) => [String(payload._id), payload]));
    const workReplicas = replicas.filter((replica) => replica.workId === fixture.workId);
    const workRequests = requests.filter((request) => request.workId === fixture.workId);
    const workOperations = operations.filter((operation) => operation.workId === fixture.workId);
    const activeReplicas = workReplicas.filter((replica) => replica.state !== "unavailable");

    for (const replica of workReplicas.filter((candidate) => candidate.state === "current")) {
      if (!replica.lastVerifiedAt) problems.push(`${replica.kind}:current-without-verification`);
      if (replica.payloadRef) {
        const payload = payloadByRef.get(replica.payloadRef);
        if (!payload || payload.state !== "active" || payload.hash !== replica.revision || payload.hash !== replica.contentHash)
          problems.push(`${replica.kind}:current-without-matching-bytes`);
      }
      for (const peer of activeReplicas.filter((candidate) => candidate._id !== replica._id && candidate.lastVerifiedAt && candidate.contentHash)) {
        if (peer.revision !== replica.revision)
          problems.push(`${replica.kind}:current-while-${peer.kind}-is-${peer.revision.slice(-4)}`);
      }
    }

    const operationsByKey = new Map(workOperations.map((operation) => [operation.idempotencyKey, operation]));
    for (const request of workRequests) {
      const operation = operationsByKey.get(request.idempotencyKey);
      if (!operation) {
        problems.push(`request:${request.state}:missing-operation`);
        continue;
      }
      const expected = request.state === "claimed" || request.state === "pending"
        ? "pending"
        : request.state;
      if (operation.state !== expected)
        problems.push(`request:${request.state}:operation-${operation.state}`);
    }
    for (const [table, keys] of [
      ["request", workRequests.map((row) => row.idempotencyKey)],
      ["operation", workOperations.map((row) => row.idempotencyKey)],
    ] as const) {
      if (new Set(keys).size !== keys.length) problems.push(`${table}:duplicate-idempotency-key`);
    }
    return problems;
  });
}

async function expireActorsAndSweep(t: TestHarness, fixture: Fixture) {
  await t.run(async (ctx) => {
    const old = Date.now() - 60 * 60_000;
    const [requests, operations, replicas, transitions, conflicts] = await Promise.all([
      ctx.db.query("bridgeWriteRequests").collect(),
      ctx.db.query("syncOperations").collect(),
      ctx.db.query("workReplicas").collect(),
      ctx.db.query("storageStrategyTransitions").collect(),
      ctx.db.query("syncConflicts").collect(),
    ]);
    for (const request of requests.filter((row) => row.workId === fixture.workId && (row.state === "pending" || row.state === "claimed")))
      await ctx.db.patch(request._id, { claimedAt: old, expiresAt: old, updatedAt: old });
    for (const operation of operations.filter((row) => row.workId === fixture.workId && row.state === "pending"))
      await ctx.db.patch(operation._id, { updatedAt: old });
    for (const replica of replicas.filter((row) => row.workId === fixture.workId && row.state === "pending"))
      await ctx.db.patch(replica._id, { updatedAt: old });
    for (const transition of transitions.filter((row) => row.workId === fixture.workId && row.state === "pending"))
      await ctx.db.patch(transition._id, { expiresAt: old, updatedAt: old });
    for (const conflict of conflicts.filter((row) => row.workId === fixture.workId && row.state === "resolving-spectra"))
      await ctx.db.patch(conflict._id, { updatedAt: old });
  });
  await t.mutation(internal.replicas.sweepReplicaTruth, {});
}

function randomFor(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

describe("replica truth model properties", () => {
  it("replays an external-save journal prefix without changing replica truth", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedTruthMachine(t);
    const commit = await externalSave(t, fixture, hashFor(2));
    const afterFirstCommit = await semanticSnapshot(t, fixture);

    await replayExternalSave(t, fixture, commit);

    expect(await semanticSnapshot(t, fixture)).toEqual(afterFirstCommit);
  });

  it("preserves the truth invariants through generated real-function interleavings", async () => {
    vi.useFakeTimers();
    const failures: Array<{ seed: number; step: number; action: string; problems: string[] }> = [];
    const actions = ["enqueue", "claim", "write", "complete", "lock", "fail", "external", "replay", "crash", "restart", "network", "revoke"] as const;

    for (let seed = 1; seed <= 24; seed += 1) {
      const t = convexTest(schema, modules);
      const fixture = await seedTruthMachine(t);
      const asUser = t.withIdentity(identity);
      const random = randomFor(seed);
      let nextRevision = 10;
      let lastExternal: ExternalCommit | undefined;

      for (let step = 0; step < 18; step += 1) {
        const action = actions[Math.floor(random() * actions.length)]!;
        try {
          if (action === "enqueue") {
            const snapshot = await t.run(async (ctx) => ({
              local: await ctx.db.get(fixture.localId),
              active: (await ctx.db.query("bridgeWriteRequests")
                .withIndex("by_work_created", (q) => q.eq("workId", fixture.workId))
                .order("desc").collect())
                .find((request) => request.state === "pending" || request.state === "claimed"),
              device: await ctx.db.get(fixture.deviceId),
            }));
            if (snapshot.local && snapshot.device?.state === "active" && snapshot.local.state !== "unavailable") {
              const targetHash = hashFor(nextRevision++);
              const payload = await insertPayload(t, fixture.accountId, targetHash);
              await asUser.mutation(api.replicas.queueMaterialization, {
                workId: fixture.workId,
                payloadRef: String(payload.payloadId),
                contentHash: targetHash,
                baseRevision: snapshot.active?.targetRevision ?? snapshot.local.revision,
                fidelityMap: { entries: [] },
                regionIds: ["body"],
                partNames: ["word/document.xml"],
              });
            }
          } else if (action === "claim") {
            await t.mutation(api.bridgeSync.claimWrite, { credential });
          } else if (action === "write" || action === "network") {
            // Byte writing and a lost response happen outside Convex. Leaving
            // the claimed request unchanged models both actor-side intervals.
          } else if (action === "complete" || action === "lock" || action === "fail") {
            const request = await t.run(async (ctx) => ctx.db.query("bridgeWriteRequests")
              .withIndex("by_work_created", (q) => q.eq("workId", fixture.workId))
              .order("desc").filter((q) => q.eq(q.field("state"), "claimed")).first());
            if (request) await t.mutation(api.bridgeSync.completeWrite, {
              credential,
              requestId: request._id,
              outcome: action === "complete" ? "verified" : action === "lock" ? "waiting" : "failed",
              actualRevision: action === "complete" ? request.targetRevision : undefined,
              errorCode: action === "lock" ? "office-locked" : action === "fail" ? "write-failed" : undefined,
            });
          } else if (action === "external") {
            const device = await t.run(async (ctx) => ctx.db.get(fixture.deviceId));
            if (device?.state === "active") lastExternal = await externalSave(t, fixture, hashFor(nextRevision++));
          } else if (action === "replay" && lastExternal) {
            await replayExternalSave(t, fixture, lastExternal);
          } else if (action === "crash") {
            await t.run(async (ctx) => {
              const claimed = await ctx.db.query("bridgeWriteRequests")
                .withIndex("by_work_created", (q) => q.eq("workId", fixture.workId))
                .order("desc").filter((q) => q.eq(q.field("state"), "claimed")).first();
              if (claimed) {
                const old = Date.now() - 3 * 60_000;
                await ctx.db.patch(claimed._id, { claimedAt: old, updatedAt: old });
              }
            });
          } else if (action === "restart") {
            await t.mutation(internal.replicas.sweepReplicaTruth, {});
          } else if (action === "revoke") {
            const device = await t.run(async (ctx) => ctx.db.get(fixture.deviceId));
            if (device?.state === "active") await asUser.mutation(api.bridge.revokeDevice, { deviceId: fixture.deviceId });
          }
        } catch {
          // A real mutation may truthfully refuse an inapplicable generated
          // action. Refusal is an allowed transition; invariants still run.
        }
        const problems = await invariantProblems(t, fixture);
        if (problems.length) failures.push({ seed, step, action, problems });
      }

      await expireActorsAndSweep(t, fixture);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const stranded = await t.run(async (ctx) => ({
        requests: (await ctx.db.query("bridgeWriteRequests").withIndex("by_work_created", (q) => q.eq("workId", fixture.workId)).collect())
          .filter((row) => row.state === "pending" || row.state === "claimed").length,
        operations: (await ctx.db.query("syncOperations").withIndex("by_work_created", (q) => q.eq("workId", fixture.workId)).collect())
          .filter((row) => row.state === "pending").length,
        replicas: (await ctx.db.query("workReplicas").withIndex("by_work", (q) => q.eq("workId", fixture.workId)).collect())
          .filter((row) => row.state === "pending").length,
        transitions: (await ctx.db.query("storageStrategyTransitions").withIndex("by_work_created", (q) => q.eq("workId", fixture.workId)).collect())
          .filter((row) => row.state === "pending").length,
      }));
      if (Object.values(stranded).some((count) => count > 0))
        failures.push({ seed, step: 18, action: "quiesce", problems: [JSON.stringify(stranded)] });
    }

    expect(failures).toEqual([]);
  });
});
