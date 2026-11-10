/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import * as Y from "yjs";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { loadVersionAfter, loadVersionBefore } from "./artifactSnapshots";
import { planNativeArtifactYjsMutation, readNativeArtifactYjsDocument } from "../src/features/spectra/work/models/yjs/native-artifact-model";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "s11-history", email: "s11-history@example.test", emailVerified: true };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const wireHash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("base64url");
const content = (native: string, human: string) => ({ blocks: [
  { id: "native", type: "paragraph", text: native },
  { id: "human", type: "paragraph", text: human },
] });

async function fixture() {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"]) aggregateTest.register(t, name);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "S11", slug: "s11-history",
      verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email,
      emailVerified: true, name: "S11", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active",
      joinedAt: now, createdAt: now, updatedAt: now });
    const before = content("original native", "original human");
    const workId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId,
      blueprintKey: "document", schemaVersion: 2, title: "S11 native history", content: before,
      contentHash: hash(JSON.stringify(before)), textIndex: "original", tags: [], status: "active", createdAt: now, updatedAt: now });
    const payloads = [];
    for (const bytes of ["native base fixture", "native changed fixture"]) {
      const storageId = await ctx.storage.store(new Blob([bytes]));
      payloads.push(await ctx.db.insert("payloadObjects", { accountId, hash: hash(bytes), storageId,
        bytes: Buffer.byteLength(bytes), mediaType: "application/test", refCount: 1, state: "active", createdAt: now, verifiedAt: now }));
    }
    const baseRevision = hash("native base fixture");
    const localRevision = hash("native changed fixture");
    const cloudId = await ctx.db.insert("workReplicas", { accountId, workId, kind: "cloud", nativeFormat: "docx",
      payloadRef: String(payloads[0]), revision: baseRevision, contentHash: baseRevision,
      projectionBaseContent: before, projectionBasePayloadRef: String(payloads[0]),
      state: "behind", updatedAt: now });
    const localId = await ctx.db.insert("workReplicas", { accountId, workId, kind: "local", nativeFormat: "docx",
      payloadRef: String(payloads[1]), revision: localRevision, contentHash: localRevision, baseRevision,
      projectionBaseContent: before, projectionBasePayloadRef: String(payloads[0]),
      state: "ahead", updatedAt: now });
    const operationId = await ctx.db.insert("syncOperations", { accountId, workId, replicaId: localId,
      idempotencyKey: "s11-native-change", direction: "external", revisionBefore: baseRevision,
      revisionAfter: localRevision, state: "applied", actorKind: "external-edit", createdAt: now, updatedAt: now });
    const document = new Y.Doc();
    document.getText("native").insert(0, "original native");
    document.getText("human").insert(0, "original human");
    const baseUpdate = Y.encodeStateAsUpdate(document);
    const baseStateVectorHash = wireHash(Y.encodeStateVector(document));
    document.destroy();
    const roomId = await ctx.db.insert("collaborationRooms", { artifactId: workId, schoolId, typeKey: "document",
      provider: "self_hosted_yjs", partitionKey: "root", schemaVersion: 2, policyVersion: 0, status: "active",
      nextSequence: 2, snapshotSequence: 0, uncompactedBytes: baseUpdate.byteLength, createdAt: now, updatedAt: now });
    await ctx.db.insert("collaborationUpdates", { roomId, schoolId, sequence: 1, update: baseUpdate.buffer as ArrayBuffer,
      byteLength: baseUpdate.byteLength, stateVectorHash: baseStateVectorHash, actorAccountId: accountId,
      clientId: "fixture", idempotencyKey: "fixture-base", regionIds: ["native", "human"], createdAt: now });
    await ctx.db.patch(workId, { liveStateVectorHash: baseStateVectorHash });
    return { accountId, workId, localId, cloudId, operationId, before, contentHash: hash(JSON.stringify(before)), localRevision, baseRevision,
      localPayloadRef: String(payloads[1]), basePayloadRef: String(payloads[0]), roomId, baseUpdate: baseUpdate.buffer as ArrayBuffer, baseStateVectorHash, now };
  });
  const user = t.withIdentity(identity);
  const external = (projection = content("edited in Word", "original human")) => ({
    workId: ids.workId, localReplicaId: ids.localId, localPayloadRef: ids.localPayloadRef,
    localRevision: ids.localRevision, content: projection, fidelityMap: {}, regionIds: ["native"],
    partNames: ["word/document.xml"], conflictRegionIds: [] as string[],
  });
  const prepare = (projection = content("edited in Word", "original human")) => {
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(ids.baseUpdate));
    const updates: Uint8Array[] = [];
    document.on("update", update => updates.push(update));
    document.transact(() => {
      const native = document.getText("native");
      native.delete(0, native.length);
      if (projection.blocks[0].text) native.insert(0, projection.blocks[0].text);
    });
    const update = Y.mergeUpdates(updates);
    const projectionJson = (value: unknown) => JSON.stringify({ title: "S11 native history", tags: [],
      typeKey: "document", schemaVersion: 2, content: value });
    const args = {
      append: { accountId: ids.accountId, actorKind: "human" as const, artifactId: ids.workId, partitionKey: "root",
        clientId: `native:${ids.operationId}`, idempotencyKey: `native:${ids.operationId}`, policyVersion: 0,
        update: update.buffer as ArrayBuffer, expectedRoomId: ids.roomId, expectedNextSequence: 2,
        baseStateVectorHash: ids.baseStateVectorHash, stateVectorHash: wireHash(Y.encodeStateVector(document)),
        regionIds: ["native"], projectionJson: projectionJson(projection), projectionHash: wireHash(projectionJson(projection)) },
      external: external(projection), operationId: ids.operationId, expectedArtifactUpdatedAt: ids.now,
      expectedContentHash: ids.contentHash, expectedVersionId: null,
      expectedNativeBaseRevision: ids.baseRevision, expectedCloudRevision: ids.baseRevision,
      expectedCloudPayloadRef: ids.basePayloadRef, expectedCloudPayloadHash: ids.baseRevision,
      nativeBasePayloadHash: ids.baseRevision,
      beforeProjectionJson: projectionJson(ids.before), beforeProjectionHash: wireHash(projectionJson(ids.before)),
    };
    document.destroy();
    return args;
  };
  const commit = (args: ReturnType<typeof prepare>) => t.mutation(makeFunctionReference<"mutation">("nativeReconciliation:commit"), args);
  const reconcile = (projection = content("edited in Word", "original human")) => commit(prepare(projection));
  const legacyReconcile = () => user.mutation(api.replicas.recordExternalReconciliation, external());
  return { t, user, ids, reconcile, prepare, commit, legacyReconcile };
}

async function firstOpenFixture() {
  const f = await fixture();
  const { t, ids, prepare } = f;
  await t.run(async ctx => {
    for (const row of await ctx.db.query("collaborationUpdates").collect()) await ctx.db.delete(row._id);
    await ctx.db.patch(ids.roomId, { typeKey: "resource", schemaVersion: 1, nextSequence: 1, uncompactedBytes: 0 });
    await ctx.db.patch(ids.workId, { blueprintKey: "resource", resourceClass: "resource", content: null, nativeFormat: "docx", schemaVersion: 1,
      contentHash: ids.baseRevision, liveStateVectorHash: undefined });
  });
  const args = prepare();
  const document = new Y.Doc();
  try {
    args.append.baseStateVectorHash = wireHash(Y.encodeStateVector(document));
    document.transact(planNativeArtifactYjsMutation(document, "document", { title: "S11 native history", tags: [],
      content: content("edited before first open", "original human") }, { kind: "human", clientId: "fixture" }).apply);
    args.append.update = Y.encodeStateAsUpdate(document).buffer as ArrayBuffer;
    args.append.stateVectorHash = wireHash(Y.encodeStateVector(document));
    args.append.expectedNextSequence = 1;
    const after = { ...readNativeArtifactYjsDocument(document, "document")!, typeKey: "document", schemaVersion: 2 };
    args.append.projectionJson = JSON.stringify(after);
    args.append.projectionHash = wireHash(args.append.projectionJson);
    args.expectedContentHash = ids.baseRevision;
    return { ...f, after, args: { ...args, activation: { typeKey: "document" as const, schemaVersion: 2 } } };
  } finally { document.destroy(); }
}

describe("S11 independent native/canonical/history boundaries", () => {
  it("preserves a disjoint canonical edit committed after the lens read", async () => {
    const { t, ids, reconcile } = await fixture();
    // The route read the original head, then opened/diffed a native package.
    // A human/AI commit occurs before the reconciliation mutation arrives.
    const concurrent = content("original native", "human edit while lens awaits");
    await t.run(ctx => ctx.db.patch(ids.workId, { content: concurrent,
      contentHash: hash(JSON.stringify(concurrent)), liveStateVectorHash: "newer-live-state" }));
    await reconcile().catch(() => undefined); // A stale rejection is also safe.
    const current = await t.run(ctx => ctx.db.get(ids.workId));
    expect(current?.content.blocks.find((block: { id: string }) => block.id === "human")?.text)
      .toBe("human edit while lens awaits");
  });

  it("records a reversible native history boundary before reporting applied", async () => {
    const { t, ids, reconcile } = await fixture();
    expect(await reconcile()).toMatchObject({ state: "applied" });
    const history = await t.run(async ctx => {
      const rows = await ctx.db.query("spectraArtifactVersions").withIndex("by_artifact_created", q => q.eq("artifactId", ids.workId)).collect();
      return Promise.all(rows.map(async row => ({ before: await loadVersionBefore(ctx, row), after: await loadVersionAfter(ctx, row) })));
    });
    expect(history, "closing the browser now must not erase the import history boundary").toEqual(expect.arrayContaining([
      expect.objectContaining({ before: expect.objectContaining({ content: ids.before }),
        after: expect.objectContaining({ content: content("edited in Word", "original human") }) }),
    ]));
  });

  it("settles its own native conflict beyond other accounts' conflict rows", async () => {
    const { t, ids, reconcile } = await fixture();
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", { clerkId: "s11-peer", email: "s11-peer@example.test", emailVerified: true,
        name: "Native peer", status: "active", createdAt: now, updatedAt: now });
      const foreign = [];
      for (let i = 0; i < 100; i++) foreign.push(await ctx.db.insert("syncConflicts", { accountId, workId: ids.workId,
        replicaIds: [ids.cloudId], localRevision: ids.localRevision, spectraRevision: ids.baseRevision,
        regionIds: ["private"], partNames: [], state: "open", createdAt: now }));
      const own = await ctx.db.insert("syncConflicts", { accountId: ids.accountId, workId: ids.workId,
        replicaIds: [ids.localId, ids.cloudId], localRevision: ids.localRevision, spectraRevision: ids.baseRevision,
        regionIds: ["native"], partNames: [], state: "open", createdAt: now });
      return { foreign: await Promise.all(foreign.map(id => ctx.db.get(id))), own };
    });
    expect(await reconcile()).toMatchObject({ state: "applied" });
    expect(await t.run(ctx => ctx.db.get(seeded.own))).toMatchObject({ state: "resolved-merged" });
    expect(await t.run(ctx => Promise.all(seeded.foreign.map(row => ctx.db.get(row!._id))))).toEqual(seeded.foreign);
    expect((await t.run(ctx => ctx.db.get(ids.workId)))?.content).toEqual(content("edited in Word", "original human"));
  });

  it("does not call an unprocessed native change applied when no operation is found", async () => {
    const { t, ids, reconcile } = await fixture();
    await t.run(ctx => ctx.db.delete(ids.operationId));
    const result = await reconcile().catch(() => ({ state: "rejected" }));
    const work = await t.run(ctx => ctx.db.get(ids.workId));
    // An actual receipt can justify replay success. Absence cannot prove it.
    expect(result.state === "applied" && JSON.stringify(work?.content) === JSON.stringify(ids.before)).toBe(false);
  });

  it("replaying a completed native reconciliation preserves a later canonical edit", async () => {
    const { t, ids, reconcile } = await fixture();
    await reconcile();
    const newer = content("edited in Word", "later human edit");
    await t.run(ctx => ctx.db.patch(ids.workId, { content: newer, contentHash: hash(JSON.stringify(newer)) }));
    await reconcile();
    expect((await t.run(ctx => ctx.db.get(ids.workId)))?.content).toEqual(newer);
  });

  it("retains original and new native packages before advancing replicas", async () => {
    const { t, ids, reconcile } = await fixture();
    const result = await reconcile();
    const owners = await t.run(ctx => ctx.db.query("collaborationPayloadOwners")
      .withIndex("by_owner", q => q.eq("ownerId", String(result.receipt.versionId))).collect());
    expect(owners.filter(owner => owner.ownerTable === "spectraArtifactVersions:native").map(owner => owner.payloadRef))
      .toEqual(expect.arrayContaining([ids.basePayloadRef, ids.localPayloadRef]));
    expect((await t.run(ctx => ctx.db.get(ids.operationId)))?.reconciliationReceipt).toMatchObject({
      roomId: ids.roomId, sequence: 2, localRevision: ids.localRevision,
    });
  });

  it("persists a delete-only native update even though its state vector did not advance", async () => {
    const { t, ids, prepare, commit } = await fixture();
    const args = prepare(content("", "original human"));
    expect(args.append.stateVectorHash).toBe(ids.baseStateVectorHash);
    await commit(args);
    const updates = await t.run(ctx => ctx.db.query("collaborationUpdates")
      .withIndex("by_room_sequence", q => q.eq("roomId", ids.roomId)).collect());
    const replay = new Y.Doc();
    try {
      for (const row of updates) Y.applyUpdate(replay, new Uint8Array(row.update));
      expect(replay.getText("native").toString()).toBe("");
      expect(replay.getText("human").toString()).toBe("original human");
      expect((await t.run(ctx => ctx.db.get(ids.roomId)))?.nextSequence).toBe(3);
    } finally { replay.destroy(); }
  });

  it("rejects a stale room sequence without creating a receipt or version", async () => {
    const { t, ids, prepare, commit } = await fixture();
    const args = prepare();
    args.append.expectedNextSequence = 1;
    await expect(commit(args)).rejects.toThrow("NATIVE_RECONCILIATION_STALE");
    expect((await t.run(ctx => ctx.db.get(ids.operationId)))?.reconciliationReceipt).toBeUndefined();
    expect((await t.run(ctx => ctx.db.get(ids.workId)))?.currentVersionId).toBeUndefined();
  });

  it("preserves both native references on overlap without acknowledging an applied edit", async () => {
    const { t, ids, prepare, commit } = await fixture();
    const args = prepare();
    args.external.conflictRegionIds = ["native"];
    expect(await commit(args)).toMatchObject({ state: "conflicted" });
    expect((await t.run(ctx => ctx.db.get(ids.workId)))?.content).toEqual(ids.before);
    expect((await t.run(ctx => ctx.db.get(ids.roomId)))?.nextSequence).toBe(2);
    const conflict = await t.run(ctx => ctx.db.query("syncConflicts")
      .withIndex("by_work_state", q => q.eq("workId", ids.workId).eq("state", "open")).first());
    expect(conflict).toMatchObject({ localPayloadRef: ids.localPayloadRef, spectraPayloadRef: ids.basePayloadRef });
  });

  it("the legacy projection-only mutation cannot bypass the durable commit", async () => {
    const { legacyReconcile } = await fixture();
    await expect(legacyReconcile()).rejects.toThrow("EXTERNAL_DURABLE_COMMIT_REQUIRED");
  });

  it("rolls back the before checkpoint when the shared appender refuses its projection", async () => {
    const { t, ids, prepare, commit } = await fixture();
    const args = prepare();
    args.append.projectionJson = "{}";
    await expect(commit(args)).rejects.toThrow("COLLABORATION_PROJECTION_INVALID");
    expect((await t.run(ctx => ctx.db.get(ids.workId)))?.contentHash).toBe(args.expectedContentHash);
    expect((await t.run(ctx => ctx.db.get(ids.roomId)))?.nextSequence).toBe(2);
    expect((await t.run(ctx => ctx.db.get(ids.operationId)))?.reconciliationReceipt).toBeUndefined();
    expect(await t.run(ctx => ctx.db.query("spectraArtifactVersions").collect())).toEqual([]);
  });

  it("rejects changed native ancestry before making an effect", async () => {
    const { t, ids, prepare, commit } = await fixture();
    const args = prepare();
    await t.run(ctx => ctx.db.patch(ids.localId, { projectionBaseRevision: "different-base" }));
    await expect(commit(args)).rejects.toThrow("NATIVE_RECONCILIATION_STALE");
    expect((await t.run(ctx => ctx.db.get(ids.workId)))?.content).toEqual(ids.before);
    expect((await t.run(ctx => ctx.db.get(ids.operationId)))?.reconciliationReceipt).toBeUndefined();
  });

  it("checks current actor authority before accepting a native effect", async () => {
    const { t, ids, prepare, commit } = await fixture();
    const args = prepare();
    await t.run(async ctx => {
      const membership = await ctx.db.query("schoolMemberships").first();
      await ctx.db.delete(membership!._id);
    });
    await expect(commit(args)).rejects.toThrow();
    expect((await t.run(ctx => ctx.db.get(ids.workId)))?.content).toEqual(ids.before);
    expect((await t.run(ctx => ctx.db.get(ids.operationId)))?.reconciliationReceipt).toBeUndefined();
  });

  it("serves a completed receipt after its old room retires", async () => {
    const { t, user, ids, reconcile } = await fixture();
    const result = await reconcile();
    await t.run(ctx => ctx.db.patch(ids.roomId, { status: "closed", partitionKey: `__retired__:${ids.roomId}` }));
    const head = await user.query(makeFunctionReference<"query">("nativeReconciliation:head"), {
      workId: ids.workId, localReplicaId: ids.localId, localPayloadRef: ids.localPayloadRef, localRevision: ids.localRevision,
    });
    expect(head.receipt).toEqual(result.receipt);
  });

  it("resolves all Keep Office conflicts for the committed revision while preserving unrelated revisions", async () => {
    const { t, ids, prepare, commit } = await fixture();
    const conflictIds = await t.run(async ctx => {
      const conflicts = [];
      for (const localRevision of [ids.localRevision, "other-native-revision"]) {
        conflicts.push(await ctx.db.insert("syncConflicts", { accountId: ids.accountId, workId: ids.workId,
          replicaIds: [ids.localId, ids.cloudId], localRevision, spectraRevision: ids.baseRevision,
          regionIds: ["native", "another-conflicting-region"], partNames: [],
          localPayloadRef: ids.localPayloadRef, spectraPayloadRef: ids.basePayloadRef,
          state: "open", createdAt: ids.now, updatedAt: ids.now }));
      }
      return conflicts;
    });
    const prepared = prepare();
    const external = { ...prepared.external, resolution: "local" as const };
    const result = await commit({ ...prepared, external });
    expect(result.state).toBe("applied");
    expect((await t.run(ctx => ctx.db.get(conflictIds[0])))?.state).toBe("resolved-local");
    expect((await t.run(ctx => ctx.db.get(conflictIds[1])))?.state).toBe("open");
    expect((await t.run(ctx => ctx.db.get(ids.operationId)))?.reconciliationReceipt).toBeDefined();
  });

  it("rejects cloud C as the merge ancestor of external B when the retained native base is A", async () => {
    const { t, ids, prepare, commit } = await fixture();
    const cloudHash = hash("newer cloud C");
    const cloudPayloadId = await t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(["newer cloud C"]));
      const cloudPayloadId = await ctx.db.insert("payloadObjects", { accountId: ids.accountId, hash: cloudHash,
        storageId, bytes: 13, mediaType: "application/test", refCount: 1, state: "active", createdAt: ids.now, verifiedAt: ids.now });
      await ctx.db.patch(ids.cloudId, { payloadRef: String(cloudPayloadId), revision: cloudHash, contentHash: cloudHash });
      return cloudPayloadId;
    });
    const args = prepare();
    args.expectedCloudRevision = cloudHash;
    args.expectedCloudPayloadRef = String(cloudPayloadId);
    args.expectedCloudPayloadHash = cloudHash;
    args.nativeBasePayloadHash = cloudHash;
    await expect(commit(args)).rejects.toThrow("EXTERNAL_NATIVE_BASE_CHANGED");
    expect((await t.run(ctx => ctx.db.get(ids.roomId)))?.nextSequence).toBe(2);
    expect((await t.run(ctx => ctx.db.get(ids.operationId)))?.reconciliationReceipt).toBeUndefined();
  });

  it("atomically activates an empty resource room when Office changed before the first lens open", async () => {
    const { t, ids, args, after, commit } = await firstOpenFixture();
    const result = await commit(args);
    expect(result.state).toBe("applied");
    expect(result.receipt.roomId).not.toBe(ids.roomId);
    expect(await t.run(ctx => ctx.db.get(ids.roomId))).toMatchObject({ status: "closed" });
    expect(await t.run(ctx => ctx.db.get(result.receipt.roomId))).toMatchObject({ typeKey: "document", schemaVersion: 2, nextSequence: 2 });
    expect(await t.run(ctx => ctx.db.get(ids.workId))).toMatchObject({ blueprintKey: "document", resourceClass: "artifact", content: after.content });
    const rows = await t.run(ctx => ctx.db.query("collaborationUpdates")
      .withIndex("by_room_sequence", q => q.eq("roomId", result.receipt.roomId)).collect());
    const replay = new Y.Doc();
    try {
      expect(rows).toHaveLength(1);
      Y.applyUpdate(replay, new Uint8Array(rows[0].update));
      expect(readNativeArtifactYjsDocument(replay, "document")?.content).toEqual(after.content);
    } finally { replay.destroy(); }
    await expect(t.mutation(makeFunctionReference<"mutation">("collaborationGatewayStore:append"), {
      ...args.append, clientId: "old-resource-session", idempotencyKey: "old-resource-session",
    })).rejects.toThrow("COLLABORATION_BASE_STATE_STALE");
  });

  it.each(["update", "snapshot", "content"])("refuses resource activation with an existing %s", async kind => {
    const { t, ids, args, commit } = await firstOpenFixture();
    await t.run(async ctx => {
      if (kind === "content") await ctx.db.patch(ids.workId, { content: { saved: true } });
      if (kind === "update") await ctx.db.insert("collaborationUpdates", { roomId: ids.roomId,
        sequence: 1, update: ids.baseUpdate, byteLength: ids.baseUpdate.byteLength, stateVectorHash: ids.baseStateVectorHash,
        actorAccountId: ids.accountId, clientId: "concurrent", idempotencyKey: "concurrent", regionIds: [], createdAt: ids.now });
      if (kind === "snapshot") await ctx.db.insert("collaborationSnapshots", { roomId: ids.roomId, artifactId: ids.workId,
        throughSequence: 0, update: ids.baseUpdate, stateVector: new ArrayBuffer(0), contentHash: ids.contentHash,
        schemaVersion: 1, status: "verified", createdBy: "migration", createdAt: ids.now });
    });
    await expect(commit(args)).rejects.toThrow("NATIVE_RECONCILIATION_ACTIVATION_NOT_EMPTY");
    expect(await t.run(ctx => ctx.db.get(ids.roomId))).toMatchObject({ status: "active", partitionKey: "root" });
    expect((await t.run(ctx => ctx.db.get(ids.operationId)))?.reconciliationReceipt).toBeUndefined();
  });

  it("rolls back room retirement and type activation when append validation fails", async () => {
    const { t, ids, args, commit } = await firstOpenFixture();
    args.append.projectionJson = "{}";
    await expect(commit(args)).rejects.toThrow("COLLABORATION_PROJECTION_INVALID");
    expect(await t.run(ctx => ctx.db.get(ids.workId))).toMatchObject({ blueprintKey: "resource", content: null });
    expect(await t.run(ctx => ctx.db.query("collaborationRooms").collect())).toEqual([
      expect.objectContaining({ _id: ids.roomId, status: "active", partitionKey: "root" }),
    ]);
    expect(await t.run(ctx => ctx.db.query("spectraArtifactVersions").collect())).toEqual([]);
  });

  it("refuses first activation into a type unrelated to the verified native format", async () => {
    const { t, ids, args, commit } = await firstOpenFixture();
    await t.run(ctx => ctx.db.patch(ids.localId, { nativeFormat: "xlsx" }));
    await expect(commit(args)).rejects.toThrow("NATIVE_RECONCILIATION_TYPE_MISMATCH");
    expect(await t.run(ctx => ctx.db.get(ids.workId))).toMatchObject({ blueprintKey: "resource", content: null });
  });

  it("retains A and cloud C before advancing first activation to external B", async () => {
    const { t, ids, args, commit } = await firstOpenFixture();
    const cloudHash = hash("cloud C");
    const cloudRef = await t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(["cloud C"]));
      const ref = await ctx.db.insert("payloadObjects", { accountId: ids.accountId, hash: cloudHash, storageId,
        bytes: 7, mediaType: "application/test", refCount: 1, state: "active", createdAt: ids.now, verifiedAt: ids.now });
      await ctx.db.patch(ids.cloudId, { payloadRef: String(ref), revision: cloudHash, contentHash: cloudHash });
      return String(ref);
    });
    args.expectedCloudRevision = cloudHash;
    args.expectedCloudPayloadRef = cloudRef;
    args.expectedCloudPayloadHash = cloudHash;
    args.beforeProjectionJson = JSON.stringify({ title: "S11 native history", tags: [], typeKey: "document", schemaVersion: 2,
      content: content("cloud C", "original human") });
    args.beforeProjectionHash = wireHash(args.beforeProjectionJson);
    const result = await commit(args);
    const version = await t.run(ctx => ctx.db.get(result.receipt.versionId as Id<"spectraArtifactVersions">));
    expect(await t.run(ctx => loadVersionBefore(ctx, version!))).toMatchObject({ content: content("cloud C", "original human") });
    const owners = await t.run(ctx => ctx.db.query("collaborationPayloadOwners")
      .withIndex("by_owner", q => q.eq("ownerId", String(result.receipt.versionId))).collect());
    expect(owners.filter(owner => owner.ownerTable === "spectraArtifactVersions:native").map(owner => owner.payloadRef))
      .toEqual(expect.arrayContaining([ids.basePayloadRef, cloudRef, ids.localPayloadRef]));
  });
});
