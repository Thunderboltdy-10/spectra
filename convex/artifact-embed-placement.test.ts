/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference, type FunctionReturnType } from "convex/server";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { currentPinnedPlacementHead, hasCurrentPinnedArtifactPlacement, type loadHead, type recordProof } from "./artifactEmbedPlacement";
import type { refresh } from "./artifactEmbedPlacementActions";
import { containsPinnedArtifactPlacement } from "../shared/artifact-embed-placement";
import { isSurvivingPinnedEmbed } from "./artifactEmbedOwnership";
import { releaseVersionIfUnpinned } from "./artifactSnapshots";
import { initializeNativeArtifactDocument } from "../scripts/collaboration-native-projection.mjs";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "placement-owner", email: "placement@example.test", emailVerified: true };
const refreshRef = makeFunctionReference<"action", { embedId: Id<"artifactEmbeds"> }, FunctionReturnType<typeof refresh>>("artifactEmbedPlacementActions:refresh");
const headRef = makeFunctionReference<"query", { embedId: Id<"artifactEmbeds"> }, FunctionReturnType<typeof loadHead>>("artifactEmbedPlacement:loadHead");
const recordRef = makeFunctionReference<"mutation", { embedId: Id<"artifactEmbeds">; headHash: string }, FunctionReturnType<typeof recordProof>>("artifactEmbedPlacement:recordProof");
const buffer = (value: Uint8Array) => Uint8Array.from(value).buffer;
const vectorHash = (document: Y.Doc) => createHash("sha256").update(Y.encodeStateVector(document)).digest("base64url");

async function fixture(typeKey = "document") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Placement", slug: "placement", verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Placement", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const sourceId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", title: "Source", content: {}, textIndex: "", tags: [], status: "deleted", createdAt: now, updatedAt: now });
    const hostId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: typeKey, title: "Host", content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    const versionId = await ctx.db.insert("spectraArtifactVersions", { artifactId: sourceId, ownerAccountId: accountId, schoolId, source: "manual", after: { content: { text: "Retained exact version" } }, createdAt: now });
    const embedId = await ctx.db.insert("artifactEmbeds", { containerType: "artifact", containerId: hostId, containerRegionId: "reference:one", sourceArtifactId: sourceId, schoolId, mode: "compact", interaction: "read", versionPolicy: "pinned", pinnedVersionId: versionId, contextPolicy: "summary", createdByAccountId: accountId, placementState: "provisional", placementOperationId: "operation:one", createdAt: now, updatedAt: now });
    return { now, schoolId, accountId, sourceId, hostId, versionId, embedId };
  });
  const actor = t.withIdentity(identity);
  const target = { embedId: String(ids.embedId), containerId: String(ids.hostId), containerRegionId: "reference:one", sourceArtifactId: String(ids.sourceId), pinnedVersionId: String(ids.versionId), placementOperationId: "operation:one" };
  const attrs = { ...target, containerType: "artifact", versionPolicy: "pinned", blockId: "reference:one" };
  const content = typeKey === "document"
    ? { tiptap: { type: "doc", content: [{ type: "spectraReference", attrs }] } }
    : typeKey === "whiteboard"
      ? { nodes: [{ type: "embed", id: target.containerRegionId, content: attrs }] }
      : { slides: [{ id: "slide", objects: [{ type: "embed", id: target.containerRegionId, content: attrs }] }] };
  await t.run(ctx => ctx.db.patch(ids.hostId, { content }));
  const input = async (ctx: Pick<QueryCtx, "db">) => ({
    embed: (await ctx.db.get(ids.embedId))!, host: (await ctx.db.get(ids.hostId))!,
  });
  const proven = () => t.run(async ctx => hasCurrentPinnedArtifactPlacement(ctx, await input(ctx)));
  const patchHost = (patch: Partial<Doc<"spectraArtifacts">>) => t.run(ctx => ctx.db.patch(ids.hostId, patch));
  const patchEmbed = (patch: Partial<Doc<"artifactEmbeds">>) => t.run(ctx => ctx.db.patch(ids.embedId, patch));
  const payload = async (body: Uint8Array | string, kind: "projection" | "yjs-snapshot" | "yjs-update") => {
    const bytes = typeof body === "string" ? Buffer.from(body) : body;
    const storageId = await t.run(ctx => ctx.storage.store(new Blob([buffer(bytes)])));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const payloadId = await t.run(ctx => ctx.db.insert("collaborationDurablePayloads", { artifactId: ids.hostId, accountId: ids.accountId, kind, digest, storageId, byteLength: bytes.byteLength, mediaType: "application/json", manifestVersion: 1, status: "active", createdAt: ids.now }));
    return { payloadId, storageId, digest, byteLength: bytes.byteLength };
  };
  return { t, ids, actor, target, attrs, content, input, proven, patchHost, patchEmbed, payload };
}

async function roomFixture(updates = 1, retained = true) {
  const f = await fixture("whiteboard");
  const document = new Y.Doc();
  initializeNativeArtifactDocument(document, { title: "Host", tags: [], typeKey: "whiteboard", schemaVersion: 1,
    content: retained ? f.content : { nodes: [] } });
  const entries = [{ update: buffer(Y.encodeStateAsUpdate(document)), stateVectorHash: vectorHash(document) }];
  for (let index = 1; index < updates; index++) {
    const before = Y.encodeStateVector(document);
    document.getMap("spectra:work-v2:live-meta").set("summary", `Edit ${index}`);
    entries.push({ update: buffer(Y.encodeStateAsUpdate(document, before)), stateVectorHash: vectorHash(document) });
  }
  const roomId = await f.t.run(async ctx => {
    const roomId = await ctx.db.insert("collaborationRooms", { artifactId: f.ids.hostId, schoolId: f.ids.schoolId, typeKey: "whiteboard", provider: "self_hosted_yjs", partitionKey: "root", schemaVersion: 1, policyVersion: 0, status: "active", nextSequence: entries.length + 1, snapshotSequence: 0, lastProjectionSequence: 0, uncompactedBytes: entries.reduce((total, entry) => total + entry.update.byteLength, 0), createdAt: f.ids.now, updatedAt: f.ids.now });
    for (let index = 0; index < entries.length; index++) await ctx.db.insert("collaborationUpdates", {
      roomId, sequence: index + 1, ...entries[index]!, byteLength: entries[index]!.update.byteLength,
      actorAccountId: f.ids.accountId, clientId: "fixture", idempotencyKey: `fixture:${index}`, regionIds: ["artifact:structure"], createdAt: f.ids.now + index,
    });
    return roomId;
  });
  return { ...f, roomId, document, entries };
}

describe("actual current retained-pin placement", () => {
  it.each(["document", "whiteboard", "presentation"])("proves a typed %s insertion even while its row is provisional, without changing retention state", async typeKey => {
    const f = await fixture(typeKey);
    expect(await f.proven()).toBe(true);
    expect(await f.actor.action(refreshRef, { embedId: f.ids.embedId })).toMatchObject({ status: "proven" });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.embedId)))?.placementState).toBe("provisional");
  });

  it("denies flags, old receipts, stale mirrors and arbitrary authored objects while retaining pinned bytes", async () => {
    const f = await fixture();
    await f.patchEmbed({ placementState: "confirmed", placementOperationId: undefined, placementExpiresAt: undefined, placementReceipt: `canonical-version:${f.ids.versionId}` });
    await f.patchHost({ content: { tiptap: { type: "doc", content: [] }, blocks: [{ id: "reference:one", type: "paragraph", reference: f.attrs }], notes: [f.content] } });
    expect(await f.proven()).toBe(false);
    await f.t.run(async ctx => {
      expect(isSurvivingPinnedEmbed((await ctx.db.get(f.ids.embedId))!)).toBe(true);
      await releaseVersionIfUnpinned(ctx, f.ids.versionId);
      expect(await ctx.db.get(f.ids.versionId)).not.toBeNull();
    });
  });

  it("requires the exact current source, version, embed, region and nonconflicting operation", async () => {
    const f = await fixture();
    for (const key of ["sourceArtifactId", "pinnedVersionId", "embedId", "containerRegionId", "placementOperationId", "containerId", "containerType"]) {
      const content = { tiptap: { type: "doc", content: [{ type: "spectraReference", attrs: { ...f.attrs, [key]: "wrong" } }] } };
      expect(containsPinnedArtifactPlacement("document", content, f.target), key).toBe(false);
    }
    const { placementOperationId: _operation, ...legacySchemaAttrs } = f.attrs;
    expect(containsPinnedArtifactPlacement("document", { tiptap: { type: "doc", content: [{ type: "spectraReference", attrs: legacySchemaAttrs }] } }, f.target)).toBe(true);
  });

  it("proves actual legacy typed references and omitted embed school without inventing canonical identities", async () => {
    const f = await fixture();
    await f.patchEmbed({ containerRegionId: "document:reference:legacy", placementOperationId: undefined, schoolId: undefined });
    await f.patchHost({ content: { tiptap: { type: "doc", content: [{ type: "spectraReference", attrs: { id: "legacy", workId: f.ids.sourceId, versionPolicy: { pinnedVersionId: f.ids.versionId } } }] } } });
    expect(await f.proven()).toBe(true);
    await f.patchHost({ content: { tiptap: { type: "doc", content: [] } } });
    expect(await f.proven()).toBe(false);
  });

  it("requires complete typed traversal instead of accepting a truncated positive", async () => {
    const f = await fixture();
    expect(containsPinnedArtifactPlacement("document", f.content, f.target, { nodes: 1, depth: 64 })).toBe(false);
    await f.patchEmbed({ removedAt: Date.now() });
    expect(await f.proven()).toBe(false);
  });

  it.each([false, true])("keeps proof bound to canonical identity across forged label mirrors (full rebuild=%s)", async rebuild => {
    const f = await fixture();
    const otherVersion = await f.t.run(ctx => ctx.db.insert("spectraArtifactVersions", {
      artifactId: f.ids.hostId, ownerAccountId: f.ids.accountId, schoolId: f.ids.schoolId,
      source: "manual", after: { content: {} }, createdAt: f.ids.now + 1,
    }));
    const forged = { ...f.attrs, sourceArtifactId: String(f.ids.hostId), pinnedVersionId: String(otherVersion), placementOperationId: "forged" };
    await f.patchHost({ content: { ...f.content, blocks: [
      { id: "reference:one", type: "paragraph", text: "A changed mirror label", reference: forged },
      ...(rebuild ? [{ id: "new-paragraph", type: "paragraph", text: "New ordinary text" }] : []),
    ] } });
    expect(await f.proven()).toBe(true);
    expect(await f.actor.action(refreshRef, { embedId: f.ids.embedId })).toMatchObject({ status: "proven" });
    await f.patchEmbed({ sourceArtifactId: f.ids.hostId, pinnedVersionId: otherVersion, placementOperationId: "forged" });
    expect(await f.proven()).toBe(false);
    expect(await f.actor.action(refreshRef, { embedId: f.ids.embedId })).toMatchObject({ status: "unavailable" });
  });
});

describe("server-observed offloaded and collaboration placement", () => {
  it("verifies an offloaded body larger than the former 8MiB proposal and reuses its exact receipt", async () => {
    const f = await fixture();
    const stored = await f.payload(JSON.stringify({ ...f.content, largeNativeMetadata: "x".repeat(8 * 1024 * 1024 + 1) }), "projection");
    await f.patchHost({ content: { spectraContentRef: { version: 1, artifactId: f.ids.hostId, payloadRef: stored.payloadId, digest: stored.digest, byteLength: stored.byteLength, path: "value" } } });
    expect(await f.proven()).toBe(false);
    expect(await f.actor.action(refreshRef, { embedId: f.ids.embedId })).toMatchObject({ status: "proven" });
    expect(await f.proven()).toBe(true);
    const proof = (await f.t.run(ctx => ctx.db.get(f.ids.embedId)))?.placementProof;
    await f.patchHost({ updatedAt: f.ids.now + 10_000 });
    expect(await f.proven()).toBe(true);
    expect(await f.actor.action(refreshRef, { embedId: f.ids.embedId })).toMatchObject({ status: "proven" });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.embedId)))?.placementProof).toEqual(proof);
    await f.t.run(ctx => ctx.storage.delete(stored.storageId));
    expect(await f.proven()).toBe(false);
  });

  it("does not grant from a wrapper's forged fields or a blob with no typed insertion", async () => {
    const f = await fixture();
    const stored = await f.payload(JSON.stringify({ notes: [f.content] }), "projection");
    await f.patchHost({ content: { ...f.content, spectraContentRef: { version: 1, artifactId: f.ids.hostId, payloadRef: stored.payloadId, digest: stored.digest, byteLength: stored.byteLength, path: "value" } } });
    expect(await f.actor.action(refreshRef, { embedId: f.ids.embedId })).toMatchObject({ status: "unavailable" });
    expect(await f.proven()).toBe(false);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.embedId)))?.placementProof).toBeUndefined();
  });

  it("rejects a stale receipt CAS after canonical edits, pin edits, or a room append", async () => {
    const f = await fixture();
    const head = await f.actor.query(headRef, { embedId: f.ids.embedId });
    await f.patchHost({ content: { tiptap: { type: "doc", content: [] } } });
    expect(await f.actor.mutation(recordRef, { embedId: f.ids.embedId, headHash: head!.headHash })).toBe(false);
    await f.patchHost({ content: f.content });
    const restored = await f.actor.query(headRef, { embedId: f.ids.embedId });
    await f.patchEmbed({ containerRegionId: "changed" });
    expect(await f.actor.mutation(recordRef, { embedId: f.ids.embedId, headHash: restored!.headHash })).toBe(false);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.embedId)))?.placementProof).toBeUndefined();

    const live = await roomFixture();
    try {
      const before = await live.actor.query(headRef, { embedId: live.ids.embedId });
      await live.t.run(ctx => ctx.db.patch(live.roomId, { nextSequence: 3 }));
      expect(await live.actor.mutation(recordRef, { embedId: live.ids.embedId, headHash: before!.headHash })).toBe(false);
    } finally { live.document.destroy(); }
  });

  it("reconstructs more than 500 small updates through bounded continuation and invalidates the proof on the next head", async () => {
    const f = await roomFixture(521);
    try {
      expect(await f.proven()).toBe(false);
      expect(await f.actor.action(refreshRef, { embedId: f.ids.embedId })).toMatchObject({ status: "proven" });
      expect(await f.proven()).toBe(true);
      await f.t.run(ctx => ctx.db.patch(f.roomId, { nextSequence: 523 }));
      expect(await f.proven()).toBe(false);
      expect(await f.actor.action(refreshRef, { embedId: f.ids.embedId })).toMatchObject({ status: "needs_checkpoint" });
    } finally { f.document.destroy(); }
  });

  it("does not authorize from an obsolete canonical node when the current room removed it", async () => {
    const f = await roomFixture(2, false);
    try {
      expect(await f.proven()).toBe(false);
      expect(await f.actor.action(refreshRef, { embedId: f.ids.embedId })).toMatchObject({ status: "unavailable" });
      expect((await f.t.run(ctx => ctx.db.get(f.ids.embedId)))?.placementProof).toBeUndefined();
    } finally { f.document.destroy(); }
  });

  it("reads a covering offloaded snapshot despite many newer failed snapshots, and rejects corrupt storage", async () => {
    const f = await roomFixture(3);
    try {
      const bytes = Y.encodeStateAsUpdate(f.document);
      const stored = await f.payload(bytes, "yjs-snapshot");
      await f.t.run(async ctx => {
        for (const update of await ctx.db.query("collaborationUpdates").withIndex("by_room_sequence", q => q.eq("roomId", f.roomId)).collect()) await ctx.db.delete(update._id);
        const snapshot = { roomId: f.roomId, artifactId: f.ids.hostId, throughSequence: 3, update: new ArrayBuffer(0), stateVector: buffer(Y.encodeStateVector(f.document)), contentHash: createHash("sha256").update(bytes).digest("base64url"), schemaVersion: 1, payloadRef: String(stored.payloadId), payloadDigest: stored.digest, byteLength: stored.byteLength, createdBy: "compactor" as const, createdAt: f.ids.now };
        await ctx.db.insert("collaborationSnapshots", { ...snapshot, status: "verified" });
        for (let i = 0; i < 150; i++) await ctx.db.insert("collaborationSnapshots", { ...snapshot, status: "corrupt", createdAt: f.ids.now + i + 1 });
        await ctx.db.patch(f.roomId, { snapshotSequence: 3 });
      });
      expect(await f.actor.action(refreshRef, { embedId: f.ids.embedId })).toMatchObject({ status: "proven" });
      await f.patchEmbed({ placementProof: undefined });
      await f.t.run(ctx => ctx.storage.delete(stored.storageId));
      expect(await f.actor.action(refreshRef, { embedId: f.ids.embedId })).toMatchObject({ status: "unavailable" });
      expect(await f.proven()).toBe(false);
    } finally { f.document.destroy(); }
  });

  it("reauthorizes the live host before recording evidence, leaving source/version retention untouched", async () => {
    const f = await fixture();
    const head = await f.actor.query(headRef, { embedId: f.ids.embedId });
    await f.patchHost({ status: "deleted" });
    await expect(f.actor.mutation(recordRef, { embedId: f.ids.embedId, headHash: head!.headHash })).rejects.toThrow();
    expect(await f.proven()).toBe(false);
    expect(await f.t.run(ctx => ctx.db.get(f.ids.versionId))).not.toBeNull();
  });

  it("keeps placement head identity independent of incidental timestamps", async () => {
    const f = await fixture();
    const before = await f.t.run(async ctx => currentPinnedPlacementHead(ctx, await f.input(ctx)));
    await f.patchHost({ updatedAt: f.ids.now + 1000 });
    await f.patchEmbed({ updatedAt: f.ids.now + 2000 });
    const after = await f.t.run(async ctx => currentPinnedPlacementHead(ctx, await f.input(ctx)));
    expect(after?.headHash).toBe(before?.headHash);
  });
});
