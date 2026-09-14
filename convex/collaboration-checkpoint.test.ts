/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import * as Y from "yjs";
import schema from "./schema";
import { internal } from "./_generated/api";
import {
  encodeArtifactContentForStorage,
  sheetCellEntries,
} from "../shared/sheet-cells";

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

function initialProjection() {
  const json = JSON.stringify({
    title: "Essay",
    tags: [],
    typeKey: "document",
    schemaVersion: 2,
    content: { blocks: [{ id: "intro", type: "paragraph", text: "start" }] },
  });
  return { json, hash: createHash("sha256").update(json).digest("base64url") };
}

function projectionWithTitle(title: string) {
  const value = JSON.parse(initialProjection().json) as {
    title: string;
  } & Record<string, unknown>;
  value.title = title;
  const json = JSON.stringify(value);
  return { json, hash: createHash("sha256").update(json).digest("base64url") };
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
  it("stores a large sheet projection in bounded chunks at checkpoint", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    const content = {
      workbook: { calculationMode: "automatic", locale: "en-US" },
      sheets: [
        {
          id: "sheet-1",
          name: "Data",
          cells: Object.fromEntries(
            Array.from({ length: 1_322 }, (_, index) => [
              `A${index + 1}`,
              { value: index + 1 },
            ]),
          ),
          tables: [],
          charts: [],
        },
      ],
      activeSheetId: "sheet-1",
    };
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.artifactId, {
        blueprintKey: "sheets",
        schemaVersion: 4,
        content: encodeArtifactContentForStorage("sheets", {
          ...content,
          sheets: [{ ...content.sheets[0], cells: {} }],
        }),
      });
      await ctx.db.patch(seed.roomId, { typeKey: "sheets", schemaVersion: 4 });
    });
    const projection = {
      title: "Large workbook",
      tags: [],
      typeKey: "sheets",
      schemaVersion: 4,
      content,
    };
    const projectionJson = JSON.stringify(projection);
    const projectionHash = createHash("sha256")
      .update(projectionJson)
      .digest("base64url");

    await t.mutation(internal.collaborationGatewayStore.checkpoint, {
      accountId: seed.accountId,
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "sheet-client",
      policyVersion: 0,
      stateVectorHash: "sheet-state-vector",
      projectionJson,
      projectionHash,
      throughSequence: 0,
    });

    const artifact = await t.run(async (ctx) => ctx.db.get(seed.artifactId));
    const storedSheet = (
      artifact?.content as { sheets?: Array<{ cells?: unknown }> }
    )?.sheets?.[0];
    expect(sheetCellEntries(storedSheet?.cells)).toHaveLength(1_322);
    expect(storedSheet?.cells).toMatchObject({
      encoding: "spectra-sheet-cells-v1",
    });
  });

  it("keeps chunked sheet cells on load initialProjection (≤1024 fields)", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    const denseCells = Object.fromEntries(
      Array.from({ length: 1_322 }, (_, index) => [
        `A${index + 1}`,
        { value: index + 1 },
      ]),
    );
    // Expanded address maps exceed Convex's 1024-field return cap and stuck
    // Live on Reconnecting (Object has too many fields). Load must stay chunked.
    expect(Object.keys(denseCells).length).toBeGreaterThan(1_024);
    const storedContent = encodeArtifactContentForStorage("sheets", {
      workbook: { calculationMode: "automatic", locale: "en-US" },
      sheets: [
        {
          id: "sheet-1",
          name: "Data",
          cells: denseCells,
          tables: [],
          charts: [],
        },
      ],
      activeSheetId: "sheet-1",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.artifactId, {
        blueprintKey: "sheets",
        schemaVersion: 4,
        title: "Dense workbook",
        content: storedContent,
      });
      await ctx.db.patch(seed.roomId, { typeKey: "sheets", schemaVersion: 4 });
    });

    const loaded = await t.query(internal.collaborationGatewayStore.load, {
      artifactId: seed.artifactId,
      partitionKey: "root",
      afterSequence: 0,
      limit: 500,
      includeInitialProjection: true,
    });
    const projectedSheet = (
      loaded?.initialProjection?.content as {
        sheets?: Array<{ cells?: Record<string, unknown> }>;
      }
    )?.sheets?.[0];
    const cells = projectedSheet?.cells;
    expect(cells).toMatchObject({ encoding: "spectra-sheet-cells-v1" });
    expect(Array.isArray((cells as { chunks?: unknown }).chunks)).toBe(true);
    expect(Object.keys(cells ?? {})).toEqual(
      expect.arrayContaining(["encoding", "chunks"]),
    );
    expect(Object.keys(cells ?? {}).length).toBeLessThanOrEqual(1_024);
    expect(Object.prototype.hasOwnProperty.call(cells, "A1")).toBe(false);
    expect(sheetCellEntries(cells)).toHaveLength(1_322);
  });

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

    const duplicate = await t.mutation(
      internal.collaborationGatewayStore.append,
      {
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
      },
    );
    expect(duplicate).toMatchObject({ sequence: 1, duplicate: true });

    const projection = {
      title: "Typed essay",
      tags: [],
      typeKey: "document",
      schemaVersion: 2,
      content: {
        blocks: [{ id: "intro", type: "paragraph", text: "typed more" }],
      },
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

  it("repairs a replayed append-before-checkpoint head exactly once", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    const durable = yjsUpdate("replayed after crash");
    await t.mutation(internal.collaborationGatewayStore.append, {
      accountId: seed.accountId,
      actorKind: "human",
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "crash-window-client",
      policyVersion: 0,
      idempotencyKey: "crash-window:append",
      update: arrayBufferCopy(durable.update),
      baseStateVectorHash: "initial-state-vector",
      stateVectorHash: durable.hash,
      regionIds: ["intro"],
    });
    const projection = projectionWithTitle("replayed after crash");
    const repair = {
      accountId: seed.accountId,
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "crash-window-client",
      policyVersion: 0,
      roomId: seed.roomId,
      expectedNextSequence: 2,
      expectedLastProjectionSequence: 0,
      stateVectorHash: durable.hash,
      projectionJson: projection.json,
      projectionHash: projection.hash,
      throughSequence: 1,
    };

    await expect(
      t.mutation(internal.collaborationGatewayStore.checkpoint, repair),
    ).resolves.toMatchObject({
      duplicate: false,
      sequence: 1,
    });
    await expect(
      t.mutation(internal.collaborationGatewayStore.checkpoint, repair),
    ).resolves.toMatchObject({
      duplicate: true,
      sequence: 1,
    });

    const after = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(seed.artifactId),
      room: await ctx.db.get(seed.roomId),
    }));
    expect(after.artifact).toMatchObject({
      title: "replayed after crash",
      contentHash: projection.hash,
      liveStateVectorHash: durable.hash,
    });
    expect(after.room).toMatchObject({
      nextSequence: 2,
      lastProjectionSequence: 1,
    });
  });

  it("advances the durable head for a no-content native append and checkpoints it once", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    const projection = initialProjection();
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.artifactId, {
        contentHash: projection.hash,
      });
    });
    const noContentChange = yjsUpdate("native convergence metadata");
    const append = {
      accountId: seed.accountId,
      actorKind: "human" as const,
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "no-content-client",
      policyVersion: 0,
      idempotencyKey: "no-content:append",
      update: arrayBufferCopy(noContentChange.update),
      baseStateVectorHash: "initial-state-vector",
      stateVectorHash: noContentChange.hash,
      regionIds: ["$spectra:native-projection"],
      projectionJson: projection.json,
      projectionHash: projection.hash,
    };
    await expect(
      t.mutation(internal.collaborationGatewayStore.append, append),
    ).resolves.toMatchObject({
      sequence: 1,
      duplicate: false,
      regionIds: [],
    });
    await expect(
      t.mutation(internal.collaborationGatewayStore.append, append),
    ).resolves.toMatchObject({ sequence: 1, duplicate: true });

    const afterAppend = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(seed.artifactId),
      room: await ctx.db.get(seed.roomId),
    }));
    expect(afterAppend.artifact?.contentHash).toBe(projection.hash);
    expect(afterAppend.artifact?.liveStateVectorHash).toBe(
      noContentChange.hash,
    );
    expect(afterAppend.room?.nextSequence).toBe(2);
    expect(afterAppend.room?.lastProjectionSequence).toBeUndefined();

    const checkpoint = {
      accountId: seed.accountId,
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "no-content-client",
      policyVersion: 0,
      roomId: seed.roomId,
      expectedNextSequence: 2,
      expectedLastProjectionSequence: 0,
      stateVectorHash: noContentChange.hash,
      projectionJson: projection.json,
      projectionHash: projection.hash,
      throughSequence: 1,
    };
    await expect(
      t.mutation(internal.collaborationGatewayStore.checkpoint, checkpoint),
    ).resolves.toMatchObject({ sequence: 1, duplicate: false });
    await expect(
      t.mutation(internal.collaborationGatewayStore.checkpoint, checkpoint),
    ).resolves.toMatchObject({ sequence: 1, duplicate: true });
    await expect(
      t.run(async (ctx) => ctx.db.get(seed.roomId)),
    ).resolves.toMatchObject({
      nextSequence: 2,
      lastProjectionSequence: 1,
    });
  });

  it("refuses a stale head without overwriting the newer editor projection", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    const first = yjsUpdate("first durable edit");
    const newer = yjsUpdate("newer durable edit");
    for (const [index, update] of [first, newer].entries()) {
      await t.mutation(internal.collaborationGatewayStore.append, {
        accountId: seed.accountId,
        actorKind: "human",
        artifactId: seed.artifactId,
        partitionKey: "root",
        clientId: index === 0 ? "editor-a" : "editor-b",
        policyVersion: 0,
        idempotencyKey: `stale-head:${index + 1}`,
        update: arrayBufferCopy(update.update),
        baseStateVectorHash: index === 0 ? "initial-state-vector" : first.hash,
        stateVectorHash: update.hash,
        regionIds: ["intro"],
      });
    }
    const projection = projectionWithTitle("must not win");
    const result = await t.mutation(
      internal.collaborationGatewayStore.checkpoint,
      {
        accountId: seed.accountId,
        artifactId: seed.artifactId,
        partitionKey: "root",
        clientId: "editor-a",
        policyVersion: 0,
        roomId: seed.roomId,
        expectedNextSequence: 2,
        expectedLastProjectionSequence: 0,
        stateVectorHash: first.hash,
        projectionJson: projection.json,
        projectionHash: projection.hash,
        throughSequence: 1,
      },
    );
    expect(result).toMatchObject({ stale: true, sequence: 0 });
    const after = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(seed.artifactId),
      room: await ctx.db.get(seed.roomId),
    }));
    expect(after.artifact?.title).toBe("Essay");
    expect(after.artifact?.contentHash).toBe("initial-content-hash");
    expect(after.artifact?.liveStateVectorHash).toBe(newer.hash);
    expect(after.room?.lastProjectionSequence).toBeUndefined();
  });

  it("refuses a checkpoint from a retired room generation", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    let currentRoomId: typeof seed.roomId | undefined;
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(seed.roomId, {
        partitionKey: `__retired__:${seed.roomId}`,
        status: "closed",
      });
      currentRoomId = await ctx.db.insert("collaborationRooms", {
        artifactId: seed.artifactId,
        schoolId: seed.schoolId,
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
    });
    expect(currentRoomId).toBeDefined();
    const projection = initialProjection();
    await expect(
      t.mutation(internal.collaborationGatewayStore.checkpoint, {
        accountId: seed.accountId,
        artifactId: seed.artifactId,
        partitionKey: "root",
        clientId: "retired-room-client",
        policyVersion: 0,
        roomId: seed.roomId,
        stateVectorHash: "retired-state-vector",
        projectionJson: projection.json,
        projectionHash: projection.hash,
        throughSequence: 0,
      }),
    ).rejects.toThrow("COLLABORATION_DURABLE_RECOVERY_STALE");
    const after = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(seed.artifactId),
      room: await ctx.db.get(currentRoomId!),
    }));
    expect(after.artifact?.contentHash).toBe("initial-content-hash");
    expect(after.room?.lastProjectionSequence).toBeUndefined();
  });

  it("only sends the full bootstrap projection for an empty native room", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);

    const emptyRoom = await t.query(internal.collaborationGatewayStore.load, {
      artifactId: seed.artifactId,
      partitionKey: "root",
      afterSequence: 0,
      limit: 500,
      includeInitialProjection: true,
    });
    expect(emptyRoom?.initialProjection?.content).toEqual({
      blocks: [{ id: "intro", type: "paragraph", text: "start" }],
    });

    const update = yjsUpdate("durable");
    await t.mutation(internal.collaborationGatewayStore.append, {
      accountId: seed.accountId,
      actorKind: "human",
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "client-1",
      policyVersion: 0,
      idempotencyKey: "load:durable",
      update: arrayBufferCopy(update.update),
      baseStateVectorHash: "initial-state-vector",
      stateVectorHash: update.hash,
      regionIds: ["intro"],
    });

    const durableRoom = await t.query(internal.collaborationGatewayStore.load, {
      artifactId: seed.artifactId,
      partitionKey: "root",
      afterSequence: 0,
      limit: 500,
    });
    expect(durableRoom?.updates).toHaveLength(1);
    expect(durableRoom?.initialProjection).toBeNull();

    const legacyBootstrap = await t.query(
      internal.collaborationGatewayStore.load,
      {
        artifactId: seed.artifactId,
        partitionKey: "root",
        afterSequence: 0,
        limit: 500,
        includeInitialProjection: true,
      },
    );
    expect(legacyBootstrap?.initialProjection?.content).toEqual(
      emptyRoom?.initialProjection?.content,
    );
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
          stateVectorHash: encoded.hash,
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

  it("rebases overlapping Yjs CAS instead of rejecting a stale base hash", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    const first = yjsUpdate("typed");
    const overlapping = yjsUpdate("typed concurrently");
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
    const rebased = await t.mutation(internal.collaborationGatewayStore.append, {
      accountId: seed.accountId,
      actorKind: "human",
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "client-2",
      policyVersion: 0,
      idempotencyKey: "human:two",
      update: arrayBufferCopy(overlapping.update),
      baseStateVectorHash: "initial-state-vector",
      stateVectorHash: overlapping.hash,
      regionIds: ["intro"],
    });
    expect(rebased).toMatchObject({
      duplicate: false,
      rebased: true,
    });
    const after = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(seed.artifactId),
      updates: await ctx.db.query("collaborationUpdates").collect(),
    }));
    expect(after.updates).toHaveLength(2);
    expect(after.artifact?.liveStateVectorHash).toBe(overlapping.hash);
  });

  it("rejects a snapshot whose state is ahead of its durable sequence", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    const durable = yjsUpdate("durable");
    await t.mutation(internal.collaborationGatewayStore.append, {
      accountId: seed.accountId,
      actorKind: "human",
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "client-1",
      policyVersion: 0,
      idempotencyKey: "human:durable",
      update: arrayBufferCopy(durable.update),
      baseStateVectorHash: "initial-state-vector",
      stateVectorHash: durable.hash,
      regionIds: ["intro"],
    });

    const liveDocument = new Y.Doc();
    Y.applyUpdate(liveDocument, durable.update);
    liveDocument
      .getMap("spectra:work-v2:live-meta")
      .set("title", "not durable yet");
    const aheadUpdate = Y.encodeStateAsUpdate(liveDocument);
    const aheadStateVector = Y.encodeStateVector(liveDocument);

    await expect(
      t.mutation(internal.collaboration.storeSnapshot, {
        roomId: seed.roomId,
        throughSequence: 1,
        update: arrayBufferCopy(aheadUpdate),
        stateVector: arrayBufferCopy(aheadStateVector),
        contentHash: hashBytes(aheadUpdate),
        schemaVersion: 2,
        createdBy: "compactor",
      }),
    ).rejects.toThrow("COLLABORATION_SNAPSHOT_HEAD_MISMATCH");

    liveDocument.destroy();
  });

  it("resets only a contiguous bootstrap-only log after a native room race", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    const first = yjsUpdate("bootstrap one");
    const second = yjsUpdate("bootstrap two");
    const merged = new Y.Doc();
    Y.applyUpdate(merged, first.update);
    Y.applyUpdate(merged, second.update);
    const observedHash = hashBytes(Y.encodeStateVector(merged));
    const projection = initialProjection();

    await t.run(async (ctx) => {
      const now = Date.now();
      for (const [index, encoded] of [first, second].entries()) {
        await ctx.db.insert("collaborationUpdates", {
          roomId: seed.roomId,
          schoolId: seed.schoolId,
          sequence: index + 1,
          update: arrayBufferCopy(encoded.update),
          byteLength: encoded.update.byteLength,
          stateVectorHash: encoded.hash,
          actorAccountId: seed.accountId,
          clientId: `bootstrap-${index + 1}`,
          idempotencyKey: `bootstrap:${index + 1}:${encoded.hash}`,
          regionIds: ["artifact:structure"],
          createdAt: now,
        });
      }
      await ctx.db.patch(seed.roomId, {
        nextSequence: 3,
        uncompactedBytes: first.update.byteLength + second.update.byteLength,
      });
      await ctx.db.patch(seed.artifactId, {
        liveStateVectorHash: second.hash,
        syncState: "synchronized",
      });
    });

    await expect(
      t.mutation(internal.collaborationGatewayStore.recoverNativeSnapshot, {
        accountId: seed.accountId,
        artifactId: seed.artifactId,
        partitionKey: "root",
        clientId: "client-1",
        policyVersion: 0,
        expectedNextSequence: 3,
        expectedStateVectorHash: second.hash,
        observedStateVectorHash: observedHash,
        observedProjectionJson: projection.json,
        observedProjectionHash: projection.hash,
      }),
    ).resolves.toMatchObject({
      recovered: true,
      previousHeadSequence: 2,
      bootstrapReset: true,
    });

    const recovered = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(seed.artifactId),
      room: await ctx.db.get(seed.roomId),
      updates: await ctx.db.query("collaborationUpdates").collect(),
    }));
    expect(recovered.artifact?.liveStateVectorHash).toBeUndefined();
    expect(recovered.room).toMatchObject({
      status: "active",
      nextSequence: 1,
      snapshotSequence: 0,
      uncompactedBytes: 0,
    });
    expect(recovered.updates).toHaveLength(0);

    merged.destroy();
  });

  it("recovers an already-compacted native snapshot only from a current projection", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRoom(t);
    const durable = yjsUpdate("durable");
    await t.mutation(internal.collaborationGatewayStore.append, {
      accountId: seed.accountId,
      actorKind: "human",
      artifactId: seed.artifactId,
      partitionKey: "root",
      clientId: "client-1",
      policyVersion: 0,
      idempotencyKey: "human:durable",
      update: arrayBufferCopy(durable.update),
      baseStateVectorHash: "initial-state-vector",
      stateVectorHash: durable.hash,
      regionIds: ["intro"],
    });
    const observedHash = durable.hash;
    const projection = initialProjection();
    const staleProjectionJson = JSON.stringify({
      ...JSON.parse(projection.json),
      title: "Unprojected title",
    });

    await t.run(async (ctx) => {
      const updates = await ctx.db
        .query("collaborationUpdates")
        .withIndex("by_room_sequence", (q) => q.eq("roomId", seed.roomId))
        .collect();
      await Promise.all(updates.map((update) => ctx.db.delete(update._id)));
      const now = Date.now();
      await ctx.db.insert("collaborationSnapshots", {
        roomId: seed.roomId,
        artifactId: seed.artifactId,
        schoolId: seed.schoolId,
        throughSequence: 1,
        update: arrayBufferCopy(durable.update),
        stateVector: arrayBufferCopy(durable.stateVector),
        contentHash: hashBytes(durable.update),
        schemaVersion: 2,
        status: "verified",
        createdBy: "compactor",
        createdAt: now,
        verifiedAt: now,
      });
      await ctx.db.patch(seed.roomId, {
        snapshotSequence: 1,
        uncompactedBytes: 0,
      });
    });

    await expect(
      t.mutation(internal.collaborationGatewayStore.recoverNativeSnapshot, {
        accountId: seed.accountId,
        artifactId: seed.artifactId,
        partitionKey: "root",
        clientId: "client-1",
        policyVersion: 0,
        expectedNextSequence: 2,
        expectedStateVectorHash: durable.hash,
        observedStateVectorHash: observedHash,
        observedProjectionJson: staleProjectionJson,
        observedProjectionHash: createHash("sha256")
          .update(staleProjectionJson)
          .digest("base64url"),
      }),
    ).rejects.toThrow("COLLABORATION_DURABLE_RECOVERY_STALE");

    await expect(
      t.mutation(internal.collaborationGatewayStore.recoverNativeSnapshot, {
        accountId: seed.accountId,
        artifactId: seed.artifactId,
        partitionKey: "root",
        clientId: "client-1",
        policyVersion: 0,
        expectedNextSequence: 2,
        expectedStateVectorHash: durable.hash,
        observedStateVectorHash: observedHash,
        observedProjectionJson: projection.json,
        observedProjectionHash: projection.hash,
      }),
    ).resolves.toMatchObject({ recovered: true, previousHeadSequence: 1 });

    const recovered = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(seed.artifactId),
      room: await ctx.db.get(seed.roomId),
      snapshots: await ctx.db.query("collaborationSnapshots").collect(),
    }));
    expect(recovered.artifact?.liveStateVectorHash).toBeUndefined();
    expect(recovered.room).toMatchObject({
      status: "active",
      nextSequence: 1,
      snapshotSequence: 0,
      uncompactedBytes: 0,
    });
    expect(recovered.room?.lastProjectionSequence).toBeUndefined();
    expect(recovered.snapshots).toHaveLength(0);
  });
});
