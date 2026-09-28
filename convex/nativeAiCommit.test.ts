/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import type { NativeAiCommitArgs } from "./nativeAiCommitContract";
import { artifactCreationIdentity, artifactOperationDigest, artifactScopeDigest, artifactSourceIdentity } from "./spectraArtifactWriteScope";
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

async function fixture(kind: "update" | "create" = "update", options: { native?: boolean } = {}) {
  const native = options.native !== false;
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
    document.transact(planNativeArtifactYjsMutation(document, "document", { title: "Native AI", tags: [], content: body(kind === "create" ? "" : "Before") }, actor).apply);
    const before = readNativeArtifactYjsDocument(document, "document")!;
    const baseUpdate = Y.encodeStateAsUpdate(document);
    const baseVector = Y.encodeStateVector(document);
    const baseHash = wire(baseVector);
    const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId,
      blueprintKey: "document", schemaVersion: 2, resourceClass: "artifact", ...(native ? { nativeFormat: "docx" } : {}), title: before.title,
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
      type: kind === "create" ? "artifact.create" : "artifact.update", status: "executing",
      input: { ...(kind === "update" ? { artifactId } : { title: before.title }), blueprintKey: "document", content: after.content },
      ...(kind === "create" ? { pendingArtifactId: artifactId, planIndex: 0 } : {}),
      affected: [], requiresConfirmation: false, createdAt: now });
    if (kind === "create") await ctx.db.patch(artifactId, { createdFrom: { source: "ai", runId, operationId,
      allocationContentDigest: await artifactScopeDigest(canonicalArtifactWriteContent("document", before.content)) } });
    const sourceContentIdentity = await artifactSourceIdentity((await ctx.db.get(artifactId))!);
    const operationDigest = await artifactOperationDigest((await ctx.db.get(operationId))!);
    const baseContentDigest = await artifactScopeDigest(canonicalArtifactWriteContent("document", before.content));
    const resultContentDigest = await artifactScopeDigest(canonicalArtifactWriteContent("document", after.content));
    await ctx.db.patch(operationId, { output: { artifactWriteScope: { version: 1, artifactId, runId, executionId: "attempt",
      operationId, operationDigest, sourceContentIdentity, baseContentDigest, resultContentDigest, kind,
      ...(kind === "create" ? { creationSourceIdentity: await artifactCreationIdentity((await ctx.db.get(artifactId))!) } : {}) } } });
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
    if (!native) {
      delete args.nativeCandidate;
      delete args.expected.nativeSource;
    }
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
  const source = f.args.expected.nativeSource!;
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
  if (f.args.nativeCandidate?.destination !== "cloud") throw new Error("Invalid fixture");
  const cloud = f.args.nativeCandidate.cloud;
  f.args.nativeCandidate = { destination: "bridge", queue: { ...cloud, localReplicaId: localId,
    regionIds: cloud.nativeReceipt.targets.regionIds, partNames: cloud.nativeReceipt.targets.partNames,
    nativeReceipt: { ...cloud.nativeReceipt, state: "pending" } } };
  return { ...f, localId };
}

describe("atomic AI native commit", () => {
  it("admits the exact pending create binding and replays its original native receipt after Stop", async () => {
    const f = await fixture("create");
    const client = f.t.withIdentity({ subject: "native-ai-owner", email: "native-ai@example.test", emailVerified: true });
    expect(await client.query(makeFunctionReference<"query">("nativeAiCommit:head"), {
      artifactId: f.ids.artifactId, aiOperation: f.args.aiOperation,
    })).toMatchObject({ operation: { type: "artifact.create", writeScope: { kind: "create", artifactId: f.ids.artifactId } } });
    const original = await f.commit();
    expect(original).toMatchObject({ state: "committed", receipt: { nativeResult: { state: "cloud_saved" } } });
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.runId, { status: "cancelled" });
      await ctx.db.patch(f.ids.artifactId, { content: body("Human after creation") });
    });
    expect(await f.commit()).toMatchObject({ duplicate: true, receipt: original.receipt });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.artifactId)))?.content).toEqual(body("Human after creation"));
  });

  it("resolves a dependent alias through its creator receipt and refuses it before that receipt exists", async () => {
    const f = await fixture();
    const creatorId = await f.t.run(async ctx => {
      const creatorId = await ctx.db.insert("spectraOperations", { runId: f.ids.runId, executionId: "attempt",
        actorType: "ai", type: "artifact.create", status: "executed", input: { blueprintKey: "document", content: f.before.content },
        pendingArtifactId: f.ids.artifactId, planIndex: 0, affected: [], requiresConfirmation: false, createdAt: Date.now() });
      const operation = (await ctx.db.get(f.ids.operationId))!;
      await ctx.db.patch(operation._id, { input: { ...operation.input, artifactId: "@created:0" },
        planRootOperationId: creatorId, planIndex: 1 });
      const operationDigest = await artifactOperationDigest((await ctx.db.get(operation._id))!);
      f.args.evidence.operationDigest = operationDigest;
      await ctx.db.patch(operation._id, { output: { ...operation.output, artifactWriteScope: {
        ...operation.output.artifactWriteScope, operationDigest, baseProducerOperationId: creatorId,
      } } });
      return creatorId;
    });
    const client = f.t.withIdentity({ subject: "native-ai-owner", email: "native-ai@example.test", emailVerified: true });
    const readHead = () => client.query(makeFunctionReference<"query">("nativeAiCommit:head"), {
      artifactId: f.ids.artifactId, aiOperation: f.args.aiOperation,
    });
    await expect(readHead()).rejects.toThrow("AI_ARTIFACT_DEPENDENCY_NOT_COMMITTED");
    await expect(f.commit()).rejects.toThrow("AI_ARTIFACT_DEPENDENCY_NOT_COMMITTED");
    expect((await f.t.run(ctx => ctx.db.get(f.ids.roomId)))?.nextSequence).toBe(2);
    await f.t.run(async ctx => {
      const creator = (await ctx.db.get(creatorId))!;
      const operationDigest = await artifactOperationDigest(creator);
      await ctx.db.patch(creatorId, { output: {
        artifactWriteScope: { version: 1, artifactId: f.ids.artifactId, runId: f.ids.runId, executionId: "attempt",
          operationId: creatorId, operationDigest, sourceContentIdentity: "allocation", baseContentDigest: "empty",
          resultContentDigest: f.args.evidence.baseContentDigest, kind: "create" },
        artifactWriteReceipt: { scope: operationDigest, result: { artifactId: f.ids.artifactId },
          sourceContentIdentity: f.args.evidence.sourceContentIdentity, resultContentDigest: f.args.evidence.baseContentDigest },
      } });
    });
    expect(await readHead()).toMatchObject({ operation: { type: "artifact.update", input: { artifactId: "@created:0" } } });
    expect(await f.commit()).toMatchObject({ state: "committed", receipt: { nativeResult: { state: "cloud_saved" } } });
  });

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

  it("reports a queued local write until Bridge read-back verifies it, then settles the completed run", async () => {
    const f = await bridgeFixture();
    const credential = "native-ai-bridge-credential-0123456789";
    await f.commit();
    await f.t.run(async ctx => {
      const local = (await ctx.db.get(f.localId))!;
      await ctx.db.patch(local.deviceId!, { credentialHash: hash(credential) });
      await ctx.db.patch(f.ids.operationId, { status: "executed" });
    });
    const client = f.t.withIdentity({ subject: "native-ai-owner", email: "native-ai@example.test", emailVerified: true });
    // The runner words the chat reply from the returned receipt state.
    expect(await client.mutation(makeFunctionReference<"mutation">("spectraRuns:updateStatus"), {
      runId: f.ids.runId, executionId: "attempt", status: "completed", outcome: "canonical_saved",
    })).toEqual({ runId: f.ids.runId, nativeOutcome: "native_pending" });
    const outcome = async () => (await f.t.run(ctx => ctx.db.get(f.ids.runId)))?.outcome;
    expect(await outcome()).toBe("native_pending");
    const { request } = await f.t.mutation(makeFunctionReference<"mutation">("bridgeSync:claimWrite"), { credential });
    const [queued] = await f.t.run(ctx => ctx.db.query("bridgeWriteRequests").collect());
    expect(await f.t.mutation(makeFunctionReference<"mutation">("bridgeSync:completeWrite"), {
      credential, requestId: request.requestId, claimGeneration: request.claimGeneration, claimToken: request.claimToken,
      outcome: "verified", actualRevision: queued.targetRevision,
    })).toMatchObject({ state: "verified" });
    expect(await outcome()).toBe("native_verified");
  });

  it("never reports a local write as verified when the Bridge could not verify it", async () => {
    const f = await bridgeFixture();
    const credential = "native-ai-bridge-credential-0123456789";
    await f.commit();
    await f.t.run(async ctx => {
      const local = (await ctx.db.get(f.localId))!;
      await ctx.db.patch(local.deviceId!, { credentialHash: hash(credential) });
      await ctx.db.patch(f.ids.operationId, { status: "executed" });
    });
    const client = f.t.withIdentity({ subject: "native-ai-owner", email: "native-ai@example.test", emailVerified: true });
    await client.mutation(makeFunctionReference<"mutation">("spectraRuns:updateStatus"), {
      runId: f.ids.runId, executionId: "attempt", status: "completed", outcome: "canonical_saved",
    });
    const { request } = await f.t.mutation(makeFunctionReference<"mutation">("bridgeSync:claimWrite"), { credential });
    await f.t.mutation(makeFunctionReference<"mutation">("bridgeSync:completeWrite"), {
      credential, requestId: request.requestId, claimGeneration: request.claimGeneration, claimToken: request.claimToken,
      outcome: "verified", actualRevision: "a".repeat(64),
    });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.runId)))?.outcome).toBe("native_pending");
  });

  it("settles a completed run whose queued local write a newer edit replaced before read-back", async () => {
    const f = await bridgeFixture();
    const credential = "native-ai-bridge-credential-0123456789";
    await f.commit();
    await f.t.run(async ctx => {
      const local = (await ctx.db.get(f.localId))!;
      await ctx.db.patch(local.deviceId!, { credentialHash: hash(credential) });
      await ctx.db.patch(f.ids.operationId, { status: "executed" });
    });
    const client = f.t.withIdentity({ subject: "native-ai-owner", email: "native-ai@example.test", emailVerified: true });
    await client.mutation(makeFunctionReference<"mutation">("spectraRuns:updateStatus"), {
      runId: f.ids.runId, executionId: "attempt", status: "completed", outcome: "canonical_saved",
    });
    const outcome = async () => (await f.t.run(ctx => ctx.db.get(f.ids.runId)))?.outcome;
    expect(await outcome()).toBe("native_pending");
    // Word saved the file on the computer before the Bridge wrote the AI change.
    const saved = "the student saved this in Word first";
    const storageId = await f.t.run(ctx => ctx.storage.store(new Blob([saved], { type: "application/octet-stream" })));
    await f.t.mutation(makeFunctionReference<"mutation">("bridgeSync:commitPayloadUpload"), {
      credential, replicaId: f.localId, hash: hash(saved), bytes: saved.length, mediaType: "application/octet-stream", storageId,
    });
    const [queued] = await f.t.run(ctx => ctx.db.query("bridgeWriteRequests").collect());
    expect(queued).toMatchObject({ state: "failed", errorCode: "external-save-during-write" });
    // Nothing will ever confirm the retired write, so the run no longer waits.
    expect(await outcome()).toBe("native_superseded");
  });

  it("keeps a cloud-only native save as saved in Spectra, never as a verified local file", async () => {
    const f = await fixture();
    await f.commit();
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { status: "executed" }));
    const client = f.t.withIdentity({ subject: "native-ai-owner", email: "native-ai@example.test", emailVerified: true });
    expect(await client.mutation(makeFunctionReference<"mutation">("spectraRuns:updateStatus"), {
      runId: f.ids.runId, executionId: "attempt", status: "completed", outcome: "canonical_saved",
    })).toEqual({ runId: f.ids.runId });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.runId)))?.outcome).toBe("canonical_saved");
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
    const cloud = f.args.nativeCandidate?.destination === "cloud" ? f.args.nativeCandidate.cloud : null;
    f.args.nativeCandidate = { destination: "none", unchanged: { sourcePayloadRef: f.ids.sourceRef,
      sourceHash: f.args.expected.nativeSource!.hash, resultPayloadRef: f.ids.resultRef, resultHash: cloud!.contentHash,
      readbackProjectionHash: cloud!.projectionContentHash, preservationEvidence: { ...cloud!.nativeReceipt, state: "unchanged" } } };
    await expect(f.commit()).rejects.toThrow("AI_NATIVE_UNCHANGED_UNVERIFIED");
  });

  it("rejects an envelope that carries only half of a native binding", async () => {
    const f = await fixture();
    delete f.args.nativeCandidate;
    await expect(f.commit()).rejects.toThrow("AI_NATIVE_ENVELOPE_INVALID");
    expect((await f.t.run(ctx => ctx.db.get(f.ids.roomId)))?.nextSequence).toBe(2);
  });
});

describe("atomic AI admission without a native binding", () => {
  it("admits the exact live delta, AI history and receipt, then replays instead of writing over later human work", async () => {
    const f = await fixture("update", { native: false });
    const original = await f.commit();
    expect(original).toMatchObject({ state: "committed", duplicate: false,
      receipt: { sequence: 2, nativeResult: null }, admitted: { encoding: "inline" } });
    expect(original.receipt.versionId).toBeTruthy();
    expect((await f.t.run(ctx => ctx.db.get(f.ids.artifactId)))?.content).toEqual(f.after.content);
    const version = await f.t.run(ctx => ctx.db.get(original.receipt.versionId as never));
    expect(version).toMatchObject({ source: "ai" });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.operationId)))?.output.artifactWriteReceipt.result.receipt).toEqual(original.receipt);
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { content: body("Later human work") }));
    // A lost acknowledgement retried with a freshly prepared candidate
    // consumes the original receipt; it never appends the new bytes.
    f.args.append.update = new Uint8Array([0, 0]).buffer;
    f.args.append.idempotencyKey = "native-ai:retry-candidate";
    const replay = await f.commit();
    expect(replay).toMatchObject({ duplicate: true, receipt: original.receipt, admitted: original.admitted });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.roomId)))?.nextSequence).toBe(3);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.artifactId)))?.content).toEqual(body("Later human work"));
  });

  it("enforces the approval scope at the sink before any effect", async () => {
    const f = await fixture("update", { native: false });
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { requiresConfirmation: true }));
    await expect(f.commit()).rejects.toThrow("AI_ARTIFACT_APPROVAL_SCOPE_REQUIRED");
    expect((await f.t.run(ctx => ctx.db.get(f.ids.roomId)))?.nextSequence).toBe(2);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.artifactId)))?.content).toEqual(f.before.content);
    expect(await f.t.run(ctx => ctx.db.query("spectraArtifactVersions").collect())).toEqual([]);
  });

  it("refuses a stale room sequence so a newer human edit is never overwritten", async () => {
    const f = await fixture("update", { native: false });
    await f.t.run(ctx => ctx.db.patch(f.ids.roomId, { nextSequence: 3 }));
    await expect(f.commit()).rejects.toThrow("AI_NATIVE_CANONICAL_STALE");
    expect((await f.t.run(ctx => ctx.db.get(f.ids.operationId)))?.output.artifactWriteReceipt).toBeUndefined();
  });
});
