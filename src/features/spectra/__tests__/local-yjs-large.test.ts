import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import * as Y from "yjs";
import { BoundedYjsLocalPersistence, IndexedDbYjsStore, LOCAL_YJS_DATABASE, LOCAL_YJS_BASE_STORE, LOCAL_PERSISTENCE_MAX_ATTEMPTS, MemoryYjsStore } from "../realtime/persistence/local-yjs-persistence";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const open = async (key: string, store = new IndexedDbYjsStore()) => {
  const document = new Y.Doc();
  const persistence = new BoundedYjsLocalPersistence({ key, document, store, modelVersion: 1, debounceMs: 60_000 });
  await persistence.initialize();
  return { document, persistence, store, close: async () => { await persistence.destroy(); document.destroy(); } };
};

it("retains an immutable large base offline while atomically merging two small tab journals", async () => {
  const first = await open("large-tabs");
  first.document.getText("body").insert(0, "x".repeat(8 * 1024 * 1024));
  first.persistence.markRemoteDurable();
  await first.persistence.persistNow();
  const baseline = await first.store.get("large-tabs");
  expect(baseline?.baseUpdate?.byteLength).toBeGreaterThan(8 * 1024 * 1024);
  const second = await open("large-tabs");
  const originalPut = IDBObjectStore.prototype.put;
  let baseWrites = 0;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
    if (this.name === LOCAL_YJS_BASE_STORE) baseWrites += 1;
    return originalPut.apply(this, args);
  });
  first.document.getMap("cells").set("A1", "offline-a");
  second.document.getMap("cells").set("B1", "offline-b");
  await Promise.all([first.persistence.persistNow(), second.persistence.persistNow()]);
  const merged = await first.store.get("large-tabs");
  expect(merged?.baseId).toBe(baseline?.baseId);
  expect(merged?.update.byteLength).toBeLessThan(1024);
  expect(baseWrites).toBe(0);
  expect(await first.store.deleteIfDurable("large-tabs")).toBe(false);
  const reopened = await open("large-tabs");
  expect(reopened.document.getText("body").length).toBe(8 * 1024 * 1024);
  expect(reopened.document.getMap("cells").toJSON()).toEqual({ A1: "offline-a", B1: "offline-b" });
  expect(reopened.persistence.getSnapshot()).toMatchObject({ pendingRemoteSync: true, restored: true });
  await first.close(); await second.close(); await reopened.close();
});

it("retains a delete-only journal and conflict identity across offline reload", async () => {
  const first = await open("large-delete");
  first.document.getText("body").insert(0, "x".repeat(8 * 1024 * 1024));
  first.document.getMap("cells").set("A1", "remove offline");
  first.persistence.markRemoteDurable(); await first.persistence.persistNow();
  const vector = Y.encodeStateVector(first.document);
  first.document.getMap("cells").delete("A1");
  expect(Y.encodeStateVector(first.document)).toEqual(vector);
  first.persistence.preserveConflict({ regionIds: ["cell:A1"], nativeOperationId: "native-op" });
  await first.close();
  const reopened = await open("large-delete");
  expect(reopened.document.getMap("cells").has("A1")).toBe(false);
  expect(reopened.document.getText("body").length).toBe(8 * 1024 * 1024);
  expect(reopened.persistence.getSnapshot()).toMatchObject({ pendingRemoteSync: true,
    recoveryConflict: { regionIds: ["cell:A1"], nativeOperationId: "native-op" } });
  await reopened.close();
});

it("refuses an incomplete base without replacing the stored pending draft", async () => {
  const first = await open("missing-base");
  first.document.getText("body").insert(0, "x".repeat(8 * 1024 * 1024));
  first.persistence.markRemoteDurable(); first.document.getMap("draft").set("pending", true);
  await first.close();
  const request = indexedDB.open(LOCAL_YJS_DATABASE, 3);
  const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const transaction = database.transaction(LOCAL_YJS_BASE_STORE, "readwrite");
  transaction.objectStore(LOCAL_YJS_BASE_STORE).delete("missing-base:0");
  await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); }); database.close();
  const reopened = await open("missing-base");
  expect(reopened.persistence.getSnapshot()).toMatchObject({ state: "error" });
  await expect(reopened.store.get("missing-base")).rejects.toThrow("RECOVERY_BASE");
  await reopened.close();
});

it("keeps the failure budget across instances until an explicit retry succeeds", async () => {
  vi.useFakeTimers();
  const store = new MemoryYjsStore();
  const commit = vi.spyOn(store, "commit").mockRejectedValue(new Error("storage unavailable"));
  const document = new Y.Doc();
  const first = new BoundedYjsLocalPersistence({ key: "bounded-across-generation", document, store, modelVersion: 1, debounceMs: 1 });
  await first.initialize(); document.getMap("draft").set("pending", true);
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  expect(commit).toHaveBeenCalledTimes(LOCAL_PERSISTENCE_MAX_ATTEMPTS);
  expect(first.getSnapshot()).toMatchObject({ pendingRemoteSync: true, retryExhausted: true });
  await first.destroy();
  const replacement = new BoundedYjsLocalPersistence({ key: "bounded-across-generation", document, store, modelVersion: 1, debounceMs: 1 });
  await replacement.initialize(); document.getMap("draft").set("later", true);
  const afterClose = commit.mock.calls.length;
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  expect(commit).toHaveBeenCalledTimes(afterClose);
  commit.mockRestore(); await replacement.retry();
  expect((await store.get("bounded-across-generation"))?.pendingRemoteSync).toBe(true);
  await replacement.destroy(); document.destroy();
});
