import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import * as Y from "yjs";
import { encodeDurableFrontier } from "../../../../shared/collaboration-durable-frontier.mjs";
import type { DurableRoomAnchor } from "../../../../shared/collaboration-recovery.mjs";
import {
  BoundedYjsLocalPersistence,
  IndexedDbYjsStore,
  MemoryYjsStore,
  localRecordGeneration,
  type LocalYjsStore,
} from "../realtime/persistence/local-yjs-persistence";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const anchorFor = (doc: Y.Doc, nextSequence: number): DurableRoomAnchor => ({ roomId: "room", nextSequence,
  frontierHash: createHash("sha256").update(encodeDurableFrontier(Y, doc)!).digest("hex") });

async function draftOnDevice(store: LocalYjsStore, key: string) {
  const doc = new Y.Doc();
  const persistence = new BoundedYjsLocalPersistence({ key, document: doc, store, modelVersion: 1, debounceMs: 60_000 });
  await persistence.initialize();
  doc.transact(() => doc.getMap("meta").set("title", "Saved"), { regionId: "metadata:title" });
  persistence.markRemoteDurable(anchorFor(doc, 3)); await persistence.persistNow();
  doc.transact(() => doc.getMap("meta").set("title", "Offline draft"), { regionId: "metadata:title" });
  await persistence.persistNow();
  return { doc, persistence };
}

function currentRoom() {
  const current = new Y.Doc(); current.clientID = 77;
  current.getMap("meta").set("title", "Current");
  return { update: Y.encodeStateAsUpdate(current), anchor: anchorFor(current, 9), destroy: () => current.destroy() };
}

describe.each([
  ["memory", () => new MemoryYjsStore()],
  ["indexeddb", () => new IndexedDbYjsStore()],
])("retained recovery branches (%s store)", (_name, createStore) => {
  it("archives the exact active draft before adopting the current version, then retires the old writer", async () => {
    const store = createStore();
    const { doc, persistence } = await draftOnDevice(store, "adopt");
    const active = await store.get("adopt");
    const current = currentRoom();
    const result = await persistence.archiveAndAdopt({ branchKey: "adopt", expectedGeneration: localRecordGeneration(active!),
      update: current.update, anchor: current.anchor });
    const archived = await store.get(result.archivedBranchId);
    expect(result.archivedBranchId.startsWith("adopt:recovery:")).toBe(true);
    const archivedDoc = new Y.Doc();
    Y.applyUpdate(archivedDoc, archived!.baseUpdate ? Y.mergeUpdates([archived!.baseUpdate, archived!.update]) : archived!.update);
    expect(archivedDoc.getMap("meta").get("title")).toBe("Offline draft");
    expect(archived).toMatchObject({ pendingRemoteSync: true, authoredRegionIds: ["metadata:title"] });
    const head = await store.get("adopt");
    expect(head).toMatchObject({ pendingRemoteSync: false, recoveryAnchor: current.anchor, adoptionId: result.adoptionId });
    // The retired writer never touches the adopted head, even when its
    // document changes afterwards or it is destroyed.
    doc.getMap("meta").set("title", "late");
    await persistence.destroy();
    expect(localRecordGeneration((await store.get("adopt"))!)).toBe(localRecordGeneration(head!));
    const reopened = new Y.Doc();
    const next = new BoundedYjsLocalPersistence({ key: "adopt", document: reopened, store, modelVersion: 1 });
    await next.initialize();
    expect(reopened.getMap("meta").get("title")).toBe("Current");
    expect(next.getSnapshot()).toMatchObject({ pendingRemoteSync: false, recoveryAnchor: current.anchor });
    expect((await next.listRecoveryRecords()).map(record => record.key)).toEqual([result.archivedBranchId]);
    await next.destroy(); reopened.destroy(); archivedDoc.destroy(); doc.destroy(); current.destroy();
  });

  it("refuses a stale reviewed generation without changing either record", async () => {
    const store = createStore();
    const { doc, persistence } = await draftOnDevice(store, "stale");
    const reviewed = localRecordGeneration((await store.get("stale"))!);
    doc.transact(() => doc.getMap("meta").set("title", "Edited after review"), { regionId: "metadata:title" });
    const current = currentRoom();
    await expect(persistence.archiveAndAdopt({ branchKey: "stale", expectedGeneration: reviewed,
      update: current.update, anchor: current.anchor })).rejects.toThrow("LOCAL_RECOVERY_GENERATION_CHANGED");
    expect((await persistence.listRecoveryRecords()).map(record => record.key)).toEqual(["stale"]);
    await persistence.destroy(); doc.destroy(); current.destroy();
  });

  it("redirects a superseded writer's later save into its own retained branch", async () => {
    const store = createStore();
    const first = await draftOnDevice(store, "tabs");
    const secondDoc = new Y.Doc();
    const second = new BoundedYjsLocalPersistence({ key: "tabs", document: secondDoc, store, modelVersion: 1, debounceMs: 60_000 });
    await second.initialize();
    const current = currentRoom();
    await second.archiveAndAdopt({ branchKey: "tabs", expectedGeneration: localRecordGeneration((await store.get("tabs"))!),
      update: current.update, anchor: current.anchor });
    const adopted = localRecordGeneration((await store.get("tabs"))!);
    first.doc.transact(() => first.doc.getMap("meta").set("title", "Other tab kept typing"), { regionId: "metadata:title" });
    await first.persistence.persistNow();
    expect(localRecordGeneration((await store.get("tabs"))!)).toBe(adopted);
    expect(first.persistence.getSnapshot().branchKey?.startsWith("tabs:recovery:")).toBe(true);
    expect((await first.persistence.listRecoveryRecords()).length).toBe(2);
    await first.persistence.destroy(); await second.destroy(); first.doc.destroy(); secondDoc.destroy(); current.destroy();
  });

  it("discards only an exact retained branch and never the active draft", async () => {
    const store = createStore();
    const { doc, persistence } = await draftOnDevice(store, "discard");
    await expect(persistence.discardRecoveryRecord("discard", localRecordGeneration((await store.get("discard"))!)))
      .rejects.toThrow("LOCAL_RECOVERY_BRANCH_MISSING");
    const current = currentRoom();
    const { archivedBranchId } = await persistence.archiveAndAdopt({ branchKey: "discard",
      expectedGeneration: localRecordGeneration((await store.get("discard"))!), update: current.update, anchor: current.anchor });
    await expect(persistence.discardRecoveryRecord(archivedBranchId, "not-the-reviewed-generation"))
      .rejects.toThrow("LOCAL_RECOVERY_GENERATION_CHANGED");
    await persistence.discardRecoveryRecord(archivedBranchId, localRecordGeneration((await store.get(archivedBranchId))!));
    expect(await store.get(archivedBranchId)).toBeNull();
    expect(await store.get("discard")).not.toBeNull();
    await persistence.destroy(); doc.destroy(); current.destroy();
  });
});
