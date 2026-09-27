/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import type { NativeAiCommitArgs } from "./nativeAiCommitContract";
import { artifactOperationDigest, artifactScopeDigest, artifactSourceIdentity } from "./spectraArtifactWriteScope";
import { canonicalArtifactWriteContent } from "../src/features/spectra/operations/artifact-write-content";
import { nativeAiRequestDigest } from "../shared/native-ai-commit";
import { nativeOperationId } from "../shared/native-office-contract";
import { planNativeArtifactYjsMutation, readNativeArtifactYjsDocument } from "../src/features/spectra/work/models/yjs/native-artifact-model";

const injected = vi.hoisted(() => ({ stage: "" }));
vi.mock("./replicaMaterialization", async importOriginal => {
  const actual = await importOriginal<typeof import("./replicaMaterialization")>();
  return { ...actual, queueMaterializationInTransaction: async (...args: Parameters<typeof actual.queueMaterializationInTransaction>) => {
    const result = await actual.queueMaterializationInTransaction(...args);
    if (injected.stage === "queue") throw new Error("INJECTED_AFTER_QUEUE_EFFECT");
    return result;
  }, commitCloudMaterializationInTransaction: async (...args: Parameters<typeof actual.commitCloudMaterializationInTransaction>) => {
    const result = await actual.commitCloudMaterializationInTransaction(...args);
    if (injected.stage === "native") throw new Error("INJECTED_AFTER_NATIVE_EFFECT");
    return result;
  } };
});
vi.mock("./changeGroups", async importOriginal => {
  const actual = await importOriginal<typeof import("./changeGroups")>();
  return { ...actual, commitChangeGroup: async (...args: Parameters<typeof actual.commitChangeGroup>) => {
    const result = await actual.commitChangeGroup(...args);
    if (injected.stage === "history") throw new Error("INJECTED_AFTER_HISTORY_EFFECT");
    return result;
  } };
});
beforeEach(() => { injected.stage = ""; });
const modules = import.meta.glob("./**/*.ts");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const wire = (value: string | Uint8Array) => createHash("sha256").update(value).digest("base64url");
const body = (text: string) => ({ blocks: [{ id: "body", type: "paragraph", text }] });

async function fixture() {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"]) aggregateTest.register(t, name);
  const seeded = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Native AI", slug: crypto.randomUUID(), verifiedDomains: [],
      status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: "native-ai-owner", email: "native-ai@example.test",
      emailVerified: true, name: "Owner", status: "active", createdAt: now, updatedAt: now });
    const membershipId = await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active",
      joinedAt: now, createdAt: now, updatedAt: now });
    const document = new Y.Doc();
    const actor = { kind: "ai" as const, accountId, clientId: "native-ai-test" };
    document.transact(planNativeArtifactYjsMutation(document, "document", { title: "Native AI", tags: [], content: body("Before") }, actor).apply);
    const before = readNativeArtifactYjsDocument(document, "document")!;
    const baseUpdate = Y.encodeStateAsUpdate(document);
    const baseVector = Y.encodeStateVector(document);
    const baseHash = wire(baseVector);
    const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId,
      blueprintKey: "document", schemaVersion: 2, resourceClass: "artifact", nativeFormat: "docx", title: before.title,
      tags: before.tags, content: before.content, textIndex: "Before", contentHash: hash(JSON.stringify(before)),
      liveStateVectorHash: baseHash, status: "active", createdAt: now, updatedAt: now });
    const roomId = await ctx.db.insert("collaborationRooms", { artifactId, schoolId, typeKey: "document", partitionKey: "root",
      provider: "self_hosted_yjs", schemaVersion: 2, policyVersion: 0, status: "active", nextSequence: 2,
      snapshotSequence: 0, uncompactedBytes: baseUpdate.byteLength, createdAt: now, updatedAt: now });
    await ctx.db.insert("collaborationUpdates", { roomId, schoolId, sequence: 1, update: baseUpdate.buffer as ArrayBuffer,
      byteLength: baseUpdate.byteLength, stateVectorHash: baseHash, actorAccountId: accountId, clientId: "seed",
      idempotencyKey: "seed", regionIds: ["artifact:structure"], createdAt: now });
    document.transact(planNativeArtifactYjsMutation(document, "document", { ...before, content: body("After") }, actor).apply);
    const after = readNativeArtifactYjsDocument(document, "document")!;
    const update = Y.encodeStateAsUpdate(document, baseVector);
    const finalHash = wire(Y.encodeStateVector(document));
    document.destroy();
    const runId = await ctx.db.insert("spectraAiRuns", { ownerAccountId: accountId, schoolId, artifactId,
      sourceSurface: "artifact", userPrompt: "Replace the paragraph", status: "running", executionId: "attempt",
      createdAt: now, updatedAt: now });
    const operationId = await ctx.db.insert("spectraOperations", { runId, executionId: "attempt", actorType: "ai",
      type: "artifact.update", status: "executing", input: { artifactId, blueprintKey: "document", content: after.content },
      affected: [], requiresConfirmation: false, createdAt: now });
    const sourceContentIdentity = await artifactSourceIdentity((await ctx.db.get(artifactId))!);
    const operationDigest = await artifactOperationDigest((await ctx.db.get(operationId))!);
    const baseContentDigest = await artifactScopeDigest(canonicalArtifactWriteContent("document", before.content));
    const resultContentDigest = await artifactScopeDigest(canonicalArtifactWriteContent("document", after.content));
    await ctx.db.patch(operationId, { output: { artifactWriteScope: { version: 1, artifactId, runId, executionId: "attempt",
      operationId, operationDigest, sourceContentIdentity, baseContentDigest, resultContentDigest, kind: "update" } } });
    const claimId = await ctx.db.insert("regionClaims", { artifactId, roomId, schoolId, actorAccountId: accountId,
      actorKind: "ai", clientId: actor.clientId, runId, operationId, regionId: "artifact:structure", overlapDomains: ["artifact:structure"],
      baseStateVectorHash: baseHash, status: "active", leaseExpiresAt: now + 100_000, createdAt: now, updatedAt: now });
    const payloads = [];
    for (const value of ["source package", "result package"]) {
      const storageId = await ctx.storage.store(new Blob([value]));
      payloads.push(await ctx.db.insert("payloadObjects", { accountId, storageId, hash: hash(value), bytes: value.length,
        mediaType: "application/test", state: "active", refCount: 0, verifiedAt: now, createdAt: now }));
    }
    const sourceHash = hash("source package");
    const resultHash = hash("result package");
    const cloudId = await ctx.db.insert("workReplicas", { accountId, workId: artifactId, kind: "cloud", nativeFormat: "docx",
      payloadRef: String(payloads[0]), contentHash: sourceHash, revision: sourceHash, state: "current", updatedAt: now });
    const projection = (value: unknown) => JSON.stringify({ ...(value as object), typeKey: "document", schemaVersion: 2 });
    const semanticHash = hash("after native semantic content");
    const args: NativeAiCommitArgs = {
      aiOperation: { runId, executionId: "attempt", operationId }, requestDigest: "",
      expected: { roomId, nextSequence: 2, artifactUpdatedAt: now, contentHash: hash(JSON.stringify(before)), currentVersionId: null,
        nativeSource: { replicaId: cloudId, payloadRef: String(payloads[0]), hash: sourceHash, revision: sourceHash, bytes: 14, nativeFormat: "docx" } },
      beforeProjectionJson: projection(before), beforeProjectionHash: wire(projection(before)),
      append: { artifactId, accountId, partitionKey: "root", actorKind: "ai", clientId: actor.clientId, policyVersion: 0,
        idempotencyKey: `native-ai:${operationId}`, expectedRoomId: roomId, expectedNextSequence: 2,
        baseStateVectorHash: baseHash, stateVectorHash: finalHash, update: update.buffer as ArrayBuffer,
        regionIds: ["artifact:structure"], projectionJson: projection(after), projectionHash: wire(projection(after)) },
      evidence: { version: 1, operationDigest, sourceContentIdentity, baseContentDigest, resultContentDigest, fullContentDeletion: false },
      nativeCandidate: { destination: "cloud", cloud: { workId: artifactId, payloadRef: String(payloads[1]), contentHash: resultHash,
        baseRevision: sourceHash, projectionContent: after.content, projectionContentHash: semanticHash, fidelityMap: {}, nativeReceipt: {
          kind: "native-office-save", format: "docx", artifactId, operationId: nativeOperationId(artifactId, sourceHash, resultHash),
          baseRevision: sourceHash, resultRevision: resultHash, basePayloadHash: sourceHash, resultPayloadHash: resultHash,
          targets: { regionIds: ["artifact:structure"], partNames: [] }, semantic: { resultDigest: semanticHash, readbackDigest: semanticHash },
          preservedPartNames: [], state: "cloud_saved",
        } } },
    };
    return { args, ids: { artifactId, roomId, runId, operationId, cloudId, claimId, membershipId,
      sourceRef: String(payloads[0]), resultRef: String(payloads[1]) }, before, after };
  });
  const commit = async (args: NativeAiCommitArgs = seeded.args) => {
    args.requestDigest = await nativeAiRequestDigest(args);
    return t.mutation(makeFunctionReference<"mutation">("nativeAiCommit:commit"), args);
  };
  return { t, ...seeded, commit };
}

async function bridgeFixture() {
  const f = await fixture();
  const source = f.args.expected.nativeSource;
  const localId = await f.t.run(async ctx => {
    const now = Date.now();
    const deviceId = await ctx.db.insert("bridgeDevices", { accountId: f.args.append.accountId,
      name: "Disposable Bridge", platform: "windows", credentialHash: hash("fixture credential"),
      protocolVersion: "1", appVersion: "1", pairedAt: now, lastSeenAt: now, state: "active" });
    const mountId = await ctx.db.insert("bridgeMounts", { accountId: f.args.append.accountId, deviceId,
      rootLabel: "Disposable", grantId: "grant_native_ai_fixture", state: "active", fileCount: 1,
      doubleSyncRisk: false, createdAt: now, updatedAt: now });
    return ctx.db.insert("workReplicas", { accountId: f.args.append.accountId, workId: f.ids.artifactId,
      kind: "local", deviceId, mountId, localResourceId: "native-ai", relativePath: "Native AI.docx",
      payloadRef: source.payloadRef, contentHash: source.hash, revision: source.revision, nativeFormat: "docx",
      state: "current", lastVerifiedAt: now, updatedAt: now });
  });
  if (f.args.nativeCandidate.destination !== "cloud") throw new Error("Invalid fixture");
  const cloud = f.args.nativeCandidate.cloud;
  f.args.nativeCandidate = { destination: "bridge", queue: { ...cloud, localReplicaId: localId,
    regionIds: cloud.nativeReceipt.targets.regionIds, partNames: cloud.nativeReceipt.targets.partNames,
    nativeReceipt: { ...cloud.nativeReceipt, state: "queued" } } };
  return { ...f, localId };
}

describe("atomic AI native commit", () => {
  it("returns the authoritative prompt and original receipt before loading a retired room for preparation", async () => {
    const f = await fixture();
    const client = f.t.withIdentity({ subject: "native-ai-owner", email: "native-ai@example.test", emailVerified: true });
    const readHead = () => client.query(makeFunctionReference<"query">("nativeAiCommit:head"), {
      artifactId: f.ids.artifactId, aiOperation: f.args.aiOperation,
    });
    expect(await readHead()).toMatchObject({ prompt: "Replace the paragraph", room: { _id: f.ids.roomId }, committedResult: null });
    const original = await f.commit();
    await f.t.run(ctx => ctx.db.patch(f.ids.roomId, { status: "closed" }));
    expect(await readHead()).toMatchObject({ prompt: "Replace the paragraph", room: null,
      committedResult: { receipt: original.receipt } });
  });

  it("queues cloud-prepared bytes for the separately bound local destination without claiming a local save", async () => {
    const f = await bridgeFixture();
    const result = await f.commit();
    expect(result).toMatchObject({ state: "committed", receipt: { sequence: 2, nativeResult: { state: "pending" } } });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.cloudId)))?.payloadRef).toBe(f.ids.sourceRef);
    expect((await f.t.run(ctx => ctx.db.get(f.localId)))?.payloadRef).toBe(f.ids.sourceRef);
    const requests = await f.t.run(ctx => ctx.db.query("bridgeWriteRequests").collect());
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ state: "pending", payloadRef: f.ids.resultRef, replicaId: f.localId });
    const owners = await f.t.run(ctx => ctx.db.query("collaborationPayloadOwners")
      .withIndex("by_owner", q => q.eq("ownerId", result.receipt.versionId)).collect());
    expect(owners.filter(row => row.ownerTable === "spectraArtifactVersions:native").map(row => row.payloadRef))
      .toEqual(expect.arrayContaining([f.ids.sourceRef, f.ids.resultRef]));
  });

  it("rolls back the outbox, history, owners and canonical append when queue admission fails after writing", async () => {
    const f = await bridgeFixture();
    injected.stage = "queue";
    await expect(f.commit()).rejects.toThrow("INJECTED_AFTER_QUEUE_EFFECT");
    expect((await f.t.run(ctx => ctx.db.get(f.ids.artifactId)))?.content).toEqual(f.before.content);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.roomId)))?.nextSequence).toBe(2);
    expect(await f.t.run(ctx => ctx.db.query("bridgeWriteRequests").collect())).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.query("syncOperations").collect())).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.query("spectraArtifactVersions").collect())).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.query("collaborationPayloadOwners").collect())).toEqual([]);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.operationId)))?.output.artifactWriteReceipt).toBeUndefined();
  });

  it.each(["revision", "contentHash"] as const)("refuses a changed local target %s even while the prepared cloud source is current", async key => {
    const f = await bridgeFixture();
    await f.t.run(ctx => ctx.db.patch(f.localId, { [key]: "changed-local" }));
    await expect(f.commit()).rejects.toThrow("AI_NATIVE_DESTINATION_INVALID");
    expect((await f.t.run(ctx => ctx.db.get(f.ids.roomId)))?.nextSequence).toBe(2);
    expect(await f.t.run(ctx => ctx.db.query("bridgeWriteRequests").collect())).toEqual([]);
  });

  it("admits native cloud, exact Yjs bytes, AI history, both payload owners and the business receipt together", async () => {
    const f = await fixture();
    const result = await f.commit();
    expect(result).toMatchObject({ state: "committed", receipt: { sequence: 2, nativeResult: { state: "cloud_saved" } }, admitted: { encoding: "inline" } });
    const current = await f.t.run(ctx => ctx.db.get(f.ids.artifactId));
    expect(current?.content).toEqual(f.after.content);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.cloudId)))?.payloadRef).toBe(f.ids.resultRef);
    const owners = await f.t.run(ctx => ctx.db.query("collaborationPayloadOwners")
      .withIndex("by_owner", q => q.eq("ownerId", result.receipt.versionId)).collect());
    expect(owners.filter(row => row.ownerTable === "spectraArtifactVersions:native").map(row => row.payloadRef))
      .toEqual(expect.arrayContaining([f.ids.sourceRef, f.ids.resultRef]));
    expect((await f.t.run(ctx => ctx.db.get(f.ids.operationId)))?.output.artifactWriteReceipt.result.receipt).toEqual(result.receipt);
    const updates = await f.t.run(ctx => ctx.db.query("collaborationUpdates")
      .withIndex("by_room_sequence", q => q.eq("roomId", f.ids.roomId)).collect());
    expect(updates).toHaveLength(2);
    const replayed = new Y.Doc();
    try {
      Y.applyUpdate(replayed, new Uint8Array(updates[0]!.update));
      if (result.admitted.encoding !== "inline") throw new Error("Expected inline delta");
      Y.applyUpdate(replayed, Buffer.from(result.admitted.updateBase64, "base64"));
      expect(readNativeArtifactYjsDocument(replayed, "document")?.content).toEqual(f.after.content);
    } finally {
      replayed.destroy();
    }
  });

  it.each(["history", "native"])("rolls back all effects if %s fails after writing", async stage => {
    const f = await fixture();
    injected.stage = stage;
    await expect(f.commit()).rejects.toThrow("INJECTED_AFTER_");
    expect((await f.t.run(ctx => ctx.db.get(f.ids.artifactId)))?.content).toEqual(f.before.content);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.cloudId)))?.payloadRef).toBe(f.ids.sourceRef);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.roomId)))?.nextSequence).toBe(2);
    expect(await f.t.run(ctx => ctx.db.query("spectraArtifactVersions").collect())).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.query("syncOperations").collect())).toEqual([]);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.operationId)))?.output.artifactWriteReceipt).toBeUndefined();
  });

  it("rolls back its before checkpoint if append has no current region lease", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.delete(f.ids.claimId));
    await expect(f.commit()).rejects.toThrow("COLLABORATION_REGION_UNCLAIMED");
    expect((await f.t.run(ctx => ctx.db.get(f.ids.artifactId)))?.content).toEqual(f.before.content);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.cloudId)))?.payloadRef).toBe(f.ids.sourceRef);
  });

  it.each(["stopped", "revoked", "native-changed", "room-changed"])("refuses first effect after %s", async change => {
    const f = await fixture();
    await f.t.run(async ctx => {
      if (change === "stopped") await ctx.db.patch(f.ids.runId, { status: "cancelled" });
      if (change === "revoked") await ctx.db.delete(f.ids.membershipId);
      if (change === "native-changed") await ctx.db.patch(f.ids.cloudId, { revision: "new native" });
      if (change === "room-changed") await ctx.db.patch(f.ids.roomId, { nextSequence: 3 });
    });
    await expect(f.commit()).rejects.toThrow();
    expect((await f.t.run(ctx => ctx.db.get(f.ids.artifactId)))?.content).toEqual(f.before.content);
    expect(await f.t.run(ctx => ctx.db.query("spectraArtifactVersions").collect())).toEqual([]);
  });

  it("replays the original admitted result after Stop and later human work, without consuming the retry candidate", async () => {
    const f = await fixture();
    const original = await f.commit();
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.artifactId, { content: body("Later human work") });
      await ctx.db.patch(f.ids.runId, { status: "cancelled" });
    });
    f.args.append.update = new Uint8Array([0, 0]).buffer;
    const replay = await f.commit();
    expect(replay.receipt).toEqual(original.receipt);
    expect(replay.admitted).toEqual(original.admitted);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.artifactId)))?.content).toEqual(body("Later human work"));
    expect((await f.t.run(ctx => ctx.db.get(f.ids.roomId)))?.nextSequence).toBe(3);
  });

  it("returns a covering replay descriptor when the original delta has been compacted", async () => {
    const f = await fixture();
    const original = await f.commit();
    await f.t.run(async ctx => {
      const row = await ctx.db.query("collaborationUpdates").withIndex("by_room_sequence", q => q.eq("roomId", f.ids.roomId).eq("sequence", 2)).unique();
      await ctx.db.delete(row!._id);
    });
    expect(await f.commit()).toMatchObject({ duplicate: true, receipt: original.receipt,
      admitted: { encoding: "replay", roomId: f.ids.roomId, throughSequence: 2 } });
  });

  it("rejects an unchanged claim with different result bytes", async () => {
    const f = await fixture();
    const cloud = f.args.nativeCandidate.destination === "cloud" ? f.args.nativeCandidate.cloud : null;
    f.args.nativeCandidate = { destination: "none", unchanged: { sourcePayloadRef: f.ids.sourceRef,
      sourceHash: f.args.expected.nativeSource.hash, resultPayloadRef: f.ids.resultRef, resultHash: cloud!.contentHash,
      readbackProjectionHash: cloud!.projectionContentHash, preservationEvidence: { ...cloud!.nativeReceipt, state: "unchanged" } } };
    await expect(f.commit()).rejects.toThrow("AI_NATIVE_UNCHANGED_UNVERIFIED");
  });
});
