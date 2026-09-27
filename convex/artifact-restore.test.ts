/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { makeFunctionReference, type ApiFromModules, type FunctionReturnType } from "convex/server";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import type { RestoreCommitArgs } from "./artifactRestore";
import { initializeNativeArtifactDocument } from "../scripts/collaboration-native-projection.mjs";
import { artifactProjection } from "../scripts/collaboration-artifact-projection.mjs";
import { NATIVE_VERSION_OWNER_TABLE } from "./durablePayloadOwnership";
import { loadVersionBefore, loadVersionAfter, snapshotHash } from "./artifactSnapshots";
import { nativeOperationId } from "../shared/native-office-contract";

type RestoreApi = ApiFromModules<{ restore: typeof import("./artifactRestore") }>;
const headRef = makeFunctionReference<"query", { request: RestoreCommitArgs["request"] }, FunctionReturnType<RestoreApi["restore"]["head"]>>("artifactRestore:head");
const commitRef = makeFunctionReference<"mutation", RestoreCommitArgs, FunctionReturnType<RestoreApi["restore"]["commit"]>>("artifactRestore:commit");
const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "restore-owner", email: "restore@example.test", emailVerified: true };
const buffer = (value: Uint8Array) => Uint8Array.from(value).buffer;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("base64url");

async function fixture() {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"]) aggregateTest.register(t, name);
  const document = new Y.Doc();
  initializeNativeArtifactDocument(document, { typeKey: "whiteboard", schemaVersion: 1,
    title: "Current", tags: [], content: { nodes: [], edges: [] } });
  const beforeJson = artifactProjection(document, 1)!;
  const before = JSON.parse(beforeJson);
  const initialUpdate = buffer(Y.encodeStateAsUpdate(document));
  const baseVector = hash(Y.encodeStateVector(document));
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Restore", slug: "restore", verifiedDomains: [], status: "active",
      timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email, emailVerified: true,
      name: "Restore", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "whiteboard",
      title: before.title, content: before.content, tags: [], textIndex: "", status: "active", contentHash: hash(beforeJson),
      liveStateVectorHash: baseVector, createdAt: now, updatedAt: now });
    const versionId = await ctx.db.insert("spectraArtifactVersions", { artifactId, ownerAccountId: accountId, schoolId,
      source: "manual", after: { title: "Historical", tags: [], content: before.content }, createdAt: now - 100 });
    const roomId = await ctx.db.insert("collaborationRooms", { artifactId, schoolId, typeKey: "whiteboard", provider: "self_hosted_yjs",
      partitionKey: "root", schemaVersion: 1, policyVersion: 0, status: "active", nextSequence: 2, snapshotSequence: 0,
      lastProjectionSequence: 1, uncompactedBytes: initialUpdate.byteLength, createdAt: now, updatedAt: now });
    await ctx.db.insert("collaborationUpdates", { roomId, sequence: 1, update: initialUpdate, byteLength: initialUpdate.byteLength,
      stateVectorHash: baseVector, actorAccountId: accountId, clientId: "initial", idempotencyKey: "initial", regionIds: ["artifact:structure"], createdAt: now });
    return { now, schoolId, accountId, artifactId, versionId, roomId };
  });
  const actor = t.withIdentity(identity);
  const request = { artifactId: ids.artifactId, sourceVersionId: ids.versionId, requestId: "restore-one", clientId: "restore-client" };
  const head = await actor.query(headRef, { request });
  if (head.committed) throw new Error("unexpected receipt");
  const vector = Y.encodeStateVector(document);
  document.getMap("spectra:work-v2:live-meta").set("title", "Historical");
  const update = buffer(Y.encodeStateAsUpdate(document, vector));
  const afterJson = artifactProjection(document, 1)!;
  const args: RestoreCommitArgs = { request, expectedHeadHash: head.headHash,
    beforeProjectionJson: beforeJson, beforeProjectionHash: hash(beforeJson),
    append: { accountId: ids.accountId, actorKind: "human", artifactId: ids.artifactId, partitionKey: "root", clientId: request.clientId,
      policyVersion: 0, idempotencyKey: `restore:${request.requestId}`, update, baseStateVectorHash: baseVector,
      stateVectorHash: hash(Y.encodeStateVector(document)), expectedRoomId: ids.roomId, expectedNextSequence: 2,
      regionIds: ["metadata:title"], projectionJson: afterJson, projectionHash: hash(afterJson) } };
  document.destroy();
  const state = () => t.run(async ctx => ({
    artifact: await ctx.db.get(ids.artifactId), room: await ctx.db.get(ids.roomId),
    updates: await ctx.db.query("collaborationUpdates").collect(), versions: await ctx.db.query("spectraArtifactVersions").collect(),
    groups: await ctx.db.query("changeGroups").collect(),
    replicas: await ctx.db.query("workReplicas").collect(), operations: await ctx.db.query("syncOperations").collect(),
  }));
  return { t, actor, ids, args, state };
}

describe("atomic human history restore", () => {
  it("records one delta, version and receipt, replaying a lost response without applying again", async () => {
    const f = await fixture();
    const before = await f.state();
    expect(before.artifact?.title).toBe("Current");
    const result = await f.actor.mutation(commitRef, f.args);
    expect(result).toMatchObject({ state: "committed", duplicate: false, receipt: { sequence: 2 }, admitted: { encoding: "inline" } });
    const committed = await f.state();
    expect(committed.artifact?.title).toBe("Historical");
    expect(committed.updates).toHaveLength(before.updates.length + 1);
    expect(committed.versions).toHaveLength(before.versions.length + 1);
    expect(committed.versions.find(version => version._id === result.receipt.versionId)).toMatchObject({ source: "restore",
      provenance: { sourceVersionId: f.ids.versionId, requestId: f.args.request.requestId } });
    expect(await f.actor.mutation(commitRef, f.args)).toMatchObject({ duplicate: true, receipt: result.receipt });
    expect(await f.state()).toEqual(committed);
    const restored = await f.actor.query(headRef, { request: f.args.request });
    expect(restored.committed).toMatchObject({ duplicate: true, receipt: result.receipt });
  });

  it.each(["canonical", "version", "room", "source"])("rejects a changed %s base before any restore effect", async kind => {
    const f = await fixture();
    await f.t.run(async ctx => {
      if (kind === "canonical") await ctx.db.patch(f.ids.artifactId, { title: "Intervening edit" });
      else if (kind === "version") await ctx.db.patch(f.ids.artifactId, { currentVersionId: f.ids.versionId });
      else if (kind === "room") await ctx.db.patch(f.ids.roomId, { nextSequence: 3 });
      else await ctx.db.patch(f.ids.versionId, { after: { title: "Changed source", content: {}, tags: [] } });
    });
    const before = await f.state();
    await expect(f.actor.mutation(commitRef, f.args)).rejects.toThrow("ARTIFACT_RESTORE_STALE");
    expect(await f.state()).toEqual(before);
  });

  it("reauthorizes restore after preparation and rejects changed selection under an existing receipt", async () => {
    const f = await fixture();
    await f.actor.mutation(commitRef, f.args);
    const committed = await f.state();
    await expect(f.actor.mutation(commitRef, { ...f.args, request: { ...f.args.request, regionIds: ["metadata:title"] } }))
      .rejects.toThrow("ARTIFACT_RESTORE_REQUEST_MISMATCH");
    expect(await f.state()).toEqual(committed);
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { status: "deleted" }));
    const deleted = await f.state();
    await expect(f.actor.mutation(commitRef, f.args)).rejects.toThrow();
    expect(await f.state()).toEqual(deleted);
  });

  it("does not restore a native-backed projection without verified native preparation", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { nativeFormat: "docx" }));
    const request = { ...f.args.request, regionIds: ["metadata:title"] };
    const head = await f.actor.query(headRef, { request });
    if (head.committed) throw new Error("unexpected receipt");
    const before = await f.state();
    await expect(f.actor.mutation(commitRef, { ...f.args, request, expectedHeadHash: head.headHash }))
      .rejects.toThrow("ARTIFACT_RESTORE_NATIVE_BASE_STALE");
    expect(await f.state()).toEqual(before);
  });

  it("retains an unchanged receipt without a new version and never replays it over later edits", async () => {
    const f = await fixture();
    const args = { ...f.args, append: { ...f.args.append, update: buffer(new Uint8Array([0, 0])),
      projectionJson: f.args.beforeProjectionJson, projectionHash: f.args.beforeProjectionHash,
      stateVectorHash: f.args.append.baseStateVectorHash } };
    const before = await f.state();
    const result = await f.actor.mutation(commitRef, args);
    expect(result).toMatchObject({ state: "unchanged", duplicate: false, receipt: { outcome: "unchanged" } });
    const unchanged = await f.state();
    expect(unchanged.artifact).toEqual(before.artifact);
    expect(unchanged.room).toEqual(before.room);
    expect(unchanged.updates).toEqual(before.updates);
    expect(unchanged.versions).toEqual(before.versions);
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { title: "Newer edit" }));
    const newer = await f.state();
    expect(await f.actor.mutation(commitRef, args)).toMatchObject({ state: "unchanged", duplicate: true });
    expect(await f.state()).toEqual(newer);
  });

  it("commits a native-only cloud restore with a real version and retains both packages after the replica advances", async () => {
    const f = await nativeFixture();
    const before = await f.state();
    const result = await f.actor.mutation(commitRef, f.args);
    expect(result).toMatchObject({ state: "committed", receipt: { nativeResult: { state: "cloud_saved" } } });
    const after = await f.state();
    expect(after.artifact?.content).toEqual(before.artifact?.content);
    expect(after.versions).toHaveLength(before.versions.length + 1);
    expect(after.operations).toHaveLength(1);
    expect(after.replicas[0]).toMatchObject({ payloadRef: f.native.resultRef, contentHash: f.native.resultHash });
    const retained = await f.t.run(async ctx => {
      const version = await ctx.db.get(result.receipt.versionId!);
      return { before: await loadVersionBefore(ctx, version!), after: await loadVersionAfter(ctx, version!),
        owners: await ctx.db.query("collaborationPayloadOwners").withIndex("by_owner", q => q.eq("ownerId", String(version!._id))).collect() };
    });
    expect(retained.before.nativeSources).toEqual([{ sourcePayloadHash: f.native.baseHash }]);
    expect(retained.after.nativeSources).toEqual([{ sourcePayloadHash: f.native.resultHash }]);
    expect(retained.owners).toEqual(expect.arrayContaining([f.native.baseRef, f.native.resultRef].map(payloadRef =>
      expect.objectContaining({ payloadRef, ownerTable: NATIVE_VERSION_OWNER_TABLE }))));
    await f.actor.mutation(commitRef, f.args);
    expect(await f.state()).toEqual(after);
  });

  it("records the exact source descriptor and returns the original receipt to a retry after newer edits", async () => {
    const f = await nativeFixture();
    const result = await f.actor.mutation(commitRef, f.args);
    const version = await f.t.run(ctx => ctx.db.get(result.receipt.versionId!));
    const source = await f.t.run(async ctx => loadVersionAfter(ctx, (await ctx.db.get(f.ids.versionId))!));
    expect(version?.provenance).toMatchObject({ kind: "history_restore", sourceVersionId: f.ids.versionId,
      sourceSnapshotHash: (await snapshotHash(source)).hash,
      sourcePayloadHash: f.native.resultHash, nativeBefore: f.native.baseHash, nativeAfter: f.native.resultHash });
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { title: "Newer edit" }));
    const newer = await f.state();
    // The prepared head no longer matches, yet the same request identity
    // replays its receipt and applies nothing over the newer edit.
    expect(await f.actor.mutation(commitRef, f.args)).toMatchObject({ duplicate: true, receipt: result.receipt });
    expect(await f.state()).toEqual(newer);
  });

  it("verifies native restore candidates with the shared atomic admission rules", async () => {
    const f = await nativeFixture();
    await f.t.run(async ctx => {
      const other = await ctx.db.insert("accounts", { clerkId: "other", email: "other@example.test", emailVerified: true,
        name: "Other", status: "active", createdAt: f.ids.now, updatedAt: f.ids.now });
      const id = ctx.db.normalizeId("payloadObjects", f.native.resultRef)!;
      await ctx.db.patch(id, { accountId: other });
    });
    const before = await f.state();
    await expect(f.actor.mutation(commitRef, f.args)).rejects.toThrow("ARTIFACT_RESTORE_NATIVE_PAYLOAD_INVALID");
    expect(await f.state()).toEqual(before);
  });

  it.each(["native base", "retained source"])("rejects a changed %s before native-only restore effects", async kind => {
    const f = await nativeFixture();
    await f.t.run(async ctx => {
      if (kind === "native base") await ctx.db.patch(f.native.replicaId, { revision: "newer-native" });
      else await ctx.db.delete(f.native.ownerId);
    });
    const before = await f.state();
    await expect(f.actor.mutation(commitRef, f.args)).rejects.toThrow();
    expect(await f.state()).toEqual(before);
  });
});

async function nativeFixture() {
  const f = await fixture();
  const projection = JSON.parse(f.args.beforeProjectionJson);
  const native = await f.t.run(async ctx => {
    const refs = [];
    for (const bytes of ["current native package", "historical native package"]) {
      const storageId = await ctx.storage.store(new Blob([bytes]));
      const digest = createHash("sha256").update(bytes).digest("hex");
      refs.push({ hash: digest, bytes: Buffer.byteLength(bytes), ref: String(await ctx.db.insert("payloadObjects", {
        accountId: f.ids.accountId, hash: digest, storageId, bytes: Buffer.byteLength(bytes), mediaType: "application/test",
        state: "active", refCount: 1, createdAt: f.ids.now, verifiedAt: f.ids.now })) });
    }
    const [base, result] = refs;
    const replicaId = await ctx.db.insert("workReplicas", { workId: f.ids.artifactId, accountId: f.ids.accountId,
      kind: "cloud", nativeFormat: "docx", payloadRef: base.ref, revision: base.hash, contentHash: base.hash,
      state: "current", updatedAt: f.ids.now });
    await ctx.db.patch(f.ids.artifactId, { nativeFormat: "docx" });
    await ctx.db.patch(f.ids.versionId, { after: { title: projection.title, tags: projection.tags, content: projection.content,
      nativeSources: [{ sourcePayloadHash: result.hash }] } });
    const ownerId = await ctx.db.insert("collaborationPayloadOwners", { ownerId: String(f.ids.versionId),
      ownerTable: NATIVE_VERSION_OWNER_TABLE, payloadRef: result.ref });
    return { replicaId, ownerId, baseHash: base.hash, baseRef: base.ref, baseBytes: base.bytes,
      resultHash: result.hash, resultRef: result.ref };
  });
  const head = await f.actor.query(headRef, { request: f.args.request });
  if (head.committed) throw new Error("unexpected receipt");
  const semantic = createHash("sha256").update(JSON.stringify(projection.content)).digest("hex");
  const args: RestoreCommitArgs = { ...f.args, expectedHeadHash: head.headHash,
    append: { ...f.args.append, update: buffer(new Uint8Array([0, 0])), regionIds: ["metadata:native"],
      projectionJson: f.args.beforeProjectionJson, projectionHash: f.args.beforeProjectionHash,
      stateVectorHash: f.args.append.baseStateVectorHash },
    nativeSource: { replicaId: native.replicaId, payloadRef: native.baseRef, hash: native.baseHash,
      revision: native.baseHash, bytes: native.baseBytes, nativeFormat: "docx" },
    nativeCandidate: { destination: "cloud", cloud: { workId: f.ids.artifactId, payloadRef: native.resultRef,
      contentHash: native.resultHash, baseRevision: native.baseHash, projectionContent: projection.content,
      projectionContentHash: semantic, fidelityMap: {}, nativeReceipt: { kind: "native-office-save", format: "docx",
        operationId: nativeOperationId(String(f.ids.artifactId), native.baseHash, native.resultHash), artifactId: String(f.ids.artifactId), baseRevision: native.baseHash,
        resultRevision: native.resultHash, basePayloadHash: native.baseHash, resultPayloadHash: native.resultHash,
        targets: { regionIds: [], partNames: [] }, semantic: { baseDigest: semantic, resultDigest: semantic, readbackDigest: semantic },
        preservedPartNames: [], state: "cloud_saved" } } } };
  return { ...f, args, native };
}
