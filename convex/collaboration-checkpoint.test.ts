/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import * as Y from "yjs";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

function hashBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function arrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function yjsUpdate(text: string) {
  const document = new Y.Doc();
  document.getMap("spectra:work-v2:live-meta").set("title", text);
  const update = Y.encodeStateAsUpdate(document);
  const stateVector = Y.encodeStateVector(document);
  document.destroy();
  return { update, stateVector, hash: hashBytes(stateVector) };
}

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Collab Checkpoint School",
      slug: `collab-checkpoint-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: "clerk_collab_checkpoint",
      email: "collab-checkpoint@example.test",
      emailVerified: true,
      name: "Checkpoint",
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
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accountId,
      schoolId,
      blueprintKey: "document",
      title: "Essay",
      content: { blocks: [{ id: "intro", type: "paragraph", text: "start" }] },
      contentHash: "initial-content-hash",
      textIndex: "Essay",
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const roomId = await ctx.db.insert("collaborationRooms", {
      artifactId,
      schoolId,
      typeKey: "document",
      provider: "self_hosted_yjs",
      partitionKey: "root",
      schemaVersion: 2,
      policyVersion: 0,
      status: "active",
      nextSequence: 1,
      snapshotSequence: 0,
      uncompactedBytes: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId, artifactId, roomId };
  });
}

describe("P5.I2 checkpoint projection and compaction", () => {
  it("appends a durable Yjs update without rewriting artifact.content", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    const first = yjsUpdate("typed");
    const second = yjsUpdate("typed more");
    await t.mutation(internal.collaborationGatewayStore.append, {
      accountId: seed.accountId,
      actorKind: "human",
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "client-1",
      policyVersion: 0,
      idempotencyKey: "human:one",
      update: arrayBufferCopy(first.update),
      baseStateVectorHash: "initial-state-vector",
      stateVectorHash: first.hash,
      regionIds: ["intro"],
    });
    const afterAppend = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(seed.artifactId),
      updates: await ctx.db.query("collaborationUpdates").collect(),
    }));
    expect(afterAppend.updates).toHaveLength(1);
    expect(afterAppend.artifact?.title).toBe("Essay");
    expect(afterAppend.artifact?.content).toEqual({
      blocks: [{ id: "intro", type: "paragraph", text: "start" }],
    });
    expect(afterAppend.artifact?.contentHash).toBe("initial-content-hash");
    expect(afterAppend.artifact?.liveStateVectorHash).toBe(first.hash);

    const projection = {
      title: "Typed essay",
      tags: [],
      typeKey: "document",
      schemaVersion: 2,
      content: { blocks: [{ id: "intro", type: "paragraph", text: "typed more" }] },
    };
    const projectionJson = JSON.stringify(projection);
    const projectionHash = createHash("sha256")
      .update(projectionJson)
      .digest("base64url");
    await t.mutation(internal.collaborationGatewayStore.append, {
      accountId: seed.accountId,
      actorKind: "human",
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "client-1",
      policyVersion: 0,
      idempotencyKey: "human:two",
      update: arrayBufferCopy(second.update),
      baseStateVectorHash: first.hash,
      stateVectorHash: second.hash,
      regionIds: ["intro"],
    });
    await t.mutation(internal.collaborationGatewayStore.checkpoint, {
      accountId: seed.accountId,
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "client-1",
      policyVersion: 0,
      stateVectorHash: second.hash,
      projectionJson,
      projectionHash,
      throughSequence: 2,
    });
    const afterCheckpoint = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(seed.artifactId),
      room: await ctx.db.get(seed.roomId),
      updates: await ctx.db.query("collaborationUpdates").collect(),
    }));
    expect(afterCheckpoint.updates).toHaveLength(2);
    expect(afterCheckpoint.artifact?.title).toBe("Typed essay");
    expect(afterCheckpoint.artifact?.content).toEqual(projection.content);
    expect(afterCheckpoint.artifact?.contentHash).toBe(projectionHash);
    expect(afterCheckpoint.room?.lastProjectionSequence).toBe(2);
  });

  it("compacts the update log through a verified snapshot", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    const encoded = yjsUpdate("compact-me");
    await t.run(async (ctx) => {
      const now = Date.now();
      const update = arrayBufferCopy(encoded.update);
      for (let sequence = 1; sequence <= 12; sequence += 1) {
        await ctx.db.insert("collaborationUpdates", {
          roomId: seed.roomId,
          schoolId: seed.schoolId,
          sequence,
          update,
          byteLength: encoded.update.byteLength,
          stateVectorHash: `${encoded.hash}:${sequence}`.slice(0, 48),
          actorAccountId: seed.accountId,
          clientId: "client-1",
          idempotencyKey: `load:${sequence}`,
          regionIds: ["intro"],
          createdAt: now,
        });
      }
      await ctx.db.patch(seed.roomId, {
        nextSequence: 13,
        uncompactedBytes: encoded.update.byteLength * 12,
      });
    });
    const snapshotId = await t.mutation(internal.collaboration.storeSnapshot, {
      roomId: seed.roomId,
      throughSequence: 12,
      update: arrayBufferCopy(encoded.update),
      stateVector: arrayBufferCopy(encoded.stateVector),
      contentHash: hashBytes(encoded.update),
      schemaVersion: 2,
      createdBy: "compactor",
    });
    const verified = await t.mutation(internal.collaboration.verifySnapshot, {
      snapshotId,
    });
    expect(verified.status).toBe("verified");
    expect(verified.compacted).toBe(12);
    const leftover = await t.run(async (ctx) => ({
      updates: await ctx.db.query("collaborationUpdates").collect(),
      snapshots: await ctx.db.query("collaborationSnapshots").collect(),
      room: await ctx.db.get(seed.roomId),
    }));
    expect(leftover.updates).toHaveLength(0);
    expect(leftover.snapshots).toHaveLength(1);
    expect(leftover.snapshots[0]?.status).toBe("verified");
    expect(leftover.room?.uncompactedBytes).toBe(0);
    expect(leftover.room?.snapshotSequence).toBe(12);
  });
});
