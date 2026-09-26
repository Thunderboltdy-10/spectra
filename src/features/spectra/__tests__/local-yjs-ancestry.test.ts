import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import * as Y from "yjs";
import { encodeDurableFrontier } from "../../../../shared/collaboration-durable-frontier.mjs";
import { mergeRecoveryAncestry, type DurableRoomAnchor } from "../../../../shared/collaboration-recovery.mjs";
import { BoundedYjsLocalPersistence, IndexedDbYjsStore, MemoryYjsStore, type LocalYjsRecord } from "../realtime/persistence/local-yjs-persistence";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const anchor = (doc: Y.Doc, nextSequence: number): DurableRoomAnchor => ({ roomId: "room", nextSequence,
  frontierHash: createHash("sha256").update(encodeDurableFrontier(Y, doc)!).digest("hex") });
const record = (doc: Y.Doc, recoveryAnchor: DurableRoomAnchor | undefined, authoredRegionIds: string[]): LocalYjsRecord => {
  const update = Y.encodeStateAsUpdate(doc);
  return { key: "shared", update, bytes: update.byteLength, updatedAt: 1, lastOpenedAt: 1, pendingRemoteSync: true,
    modelVersion: 1, recoveryAnchor, authoredRegionIds };
};
const limits = { perWorkBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024, maxWorks: 10 };

it("saves the acknowledged ancestor with a delete-only draft and restores both atomically", async () => {
  const store = new IndexedDbYjsStore(); const doc = new Y.Doc();
  const persistence = new BoundedYjsLocalPersistence({ key: "delete-anchor", document: doc, store, modelVersion: 1, debounceMs: 60_000 });
  await persistence.initialize();
  doc.transact(() => doc.getMap("cells").set("A1", "base"), { regionId: "cell:A1" });
  const acknowledged = anchor(doc, 2);
  persistence.markRemoteDurable(acknowledged); await persistence.persistNow();
  const vector = Y.encodeStateVector(doc);
  doc.transact(() => doc.getMap("cells").delete("A1"), { regionId: "cell:A1" });
  await persistence.persistNow();
  expect(Y.encodeStateVector(doc)).toEqual(vector);
  const saved = await store.get("delete-anchor");
  expect(saved).toMatchObject({ recoveryAnchor: acknowledged, authoredRegionIds: ["cell:A1"], pendingRemoteSync: true });
  expect(saved?.recoveryGeneration).toBeGreaterThan(0);
  const restoredDoc = new Y.Doc();
  const restored = new BoundedYjsLocalPersistence({ key: "delete-anchor", document: restoredDoc, store, modelVersion: 1 });
  await restored.initialize();
  expect(restored.getSnapshot()).toMatchObject({ recoveryAnchor: acknowledged, authoredRegionIds: ["cell:A1"], pendingRemoteSync: true });
  expect(restoredDoc.getMap("cells").has("A1")).toBe(false);
  await persistence.destroy(); await restored.destroy(); doc.destroy(); restoredDoc.destroy();
});

it("a failed anchor/draft save leaves the previous complete generation recoverable", async () => {
  const store = new MemoryYjsStore(); const doc = new Y.Doc();
  const persistence = new BoundedYjsLocalPersistence({ key: "atomic-anchor", document: doc, store, modelVersion: 1, debounceMs: 60_000 });
  await persistence.initialize();
  doc.transact(() => doc.getMap("body").set("value", "acknowledged"), { regionId: "body:value" });
  persistence.markRemoteDurable(anchor(doc, 2)); await persistence.persistNow();
  const prior = await store.get("atomic-anchor");
  doc.transact(() => doc.getMap("body").set("value", "pending"), { regionId: "body:value" });
  const commit = vi.spyOn(store, "commit").mockRejectedValue(new Error("simulated crash boundary"));
  await persistence.persistNow();
  expect(await store.get("atomic-anchor")).toEqual(prior);
  expect(persistence.getSnapshot().pendingRemoteSync).toBe(true);
  commit.mockRestore(); await persistence.retry();
  const recovered = await store.get("atomic-anchor");
  expect(recovered).toMatchObject({ pendingRemoteSync: true, recoveryAnchor: prior?.recoveryAnchor, authoredRegionIds: ["body:value"] });
  expect(recovered?.recoveryGeneration).toBeGreaterThan(prior?.recoveryGeneration ?? 0);
  await persistence.destroy(); doc.destroy();
});

it("merges cross-tab branches using the older actual ancestor and both authored regions", async () => {
  const base = new Y.Doc(); base.getMap("body").set("base", true);
  const first = new Y.Doc(), second = new Y.Doc();
  Y.applyUpdate(first, Y.encodeStateAsUpdate(base)); Y.applyUpdate(second, Y.encodeStateAsUpdate(base));
  const old = anchor(base, 2), oldFrontier = encodeDurableFrontier(Y, base)!;
  second.getMap("body").set("native", true);
  const newer = anchor(second, 4), newerFrontier = encodeDurableFrontier(Y, second)!;
  first.getMap("body").set("left", true); second.getMap("body").set("right", true);
  const store = new IndexedDbYjsStore();
  await Promise.all([store.commit({ ...record(first, old, ["body:left"]), durableFrontier: oldFrontier }, limits),
    store.commit({ ...record(second, newer, ["body:right"]), durableFrontier: newerFrontier }, limits)]);
  const saved = await store.get("shared");
  expect(saved).toMatchObject({ recoveryAnchor: old, authoredRegionIds: ["body:left", "body:right"], pendingRemoteSync: true });
  expect(saved?.durableFrontier).toEqual(oldFrontier);
  const reopened = new Y.Doc(); Y.applyUpdate(reopened, saved!.update);
  expect(reopened.getMap("body").toJSON()).toEqual({ base: true, native: true, left: true, right: true });
  for (const doc of [base, first, second, reopened]) doc.destroy();
});

it("does not turn legacy or different-room ancestry into the current room frontier", () => {
  const known = { roomId: "room", nextSequence: 4, frontierHash: "a".repeat(64) };
  expect(mergeRecoveryAncestry({ pendingRemoteSync: true }, { pendingRemoteSync: true, recoveryAnchor: known }, false).recoveryAnchor).toBeUndefined();
  expect(mergeRecoveryAncestry({ pendingRemoteSync: true, recoveryAnchor: { ...known, roomId: "old-room" } },
    { pendingRemoteSync: true, recoveryAnchor: known }, false).recoveryAnchor).toBeUndefined();
  expect(mergeRecoveryAncestry({ pendingRemoteSync: true }, { pendingRemoteSync: false, recoveryAnchor: known }, true).recoveryAnchor).toEqual(known);
});
