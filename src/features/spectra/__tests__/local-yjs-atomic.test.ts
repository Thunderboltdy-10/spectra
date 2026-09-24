import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import * as Y from "yjs";
import {
  BoundedYjsLocalPersistence, IndexedDbYjsStore, MemoryYjsStore,
  LOCAL_YJS_DATABASE, LOCAL_YJS_STORE, LOCAL_YJS_META_STORE,
  type LocalYjsRecord, type LocalYjsStore,
} from "../realtime/persistence/local-yjs-persistence";

const limits = { perWorkBytes: 100_000, totalBytes: 500_000, maxWorks: 24 };
function record(key: string, doc: Y.Doc, pendingRemoteSync = true, modelVersion = 1): LocalYjsRecord {
  const update = Y.encodeStateAsUpdate(doc);
  return { key, update, bytes: update.byteLength, updatedAt: 1, lastOpenedAt: 1, pendingRemoteSync, modelVersion };
}
function draft(value: LocalYjsRecord | null) {
  const doc = new Y.Doc(); if (value) Y.applyUpdate(doc, value.update);
  const result = doc.getMap("draft").toJSON(); doc.destroy(); return result;
}
async function tab(store: LocalYjsStore, key = "shared", maxWorks = 24) {
  const doc = new Y.Doc();
  const persistence = new BoundedYjsLocalPersistence({ key, document: doc, modelVersion: 1, store, maxWorks, debounceMs: 60_000 });
  await persistence.initialize();
  return { doc, persistence, close: async () => { await persistence.destroy(); doc.destroy(); } };
}

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

describe.each(["memory", "indexeddb"])("atomic %s local recovery", kind => {
  function stores() {
    const a = kind === "memory" ? new MemoryYjsStore() : new IndexedDbYjsStore();
    return { a, b: kind === "memory" ? a : new IndexedDbYjsStore() };
  }

  it.each([false, true])("retains both pending branches through concurrent writes and either close order (reverse=%s)", async reverse => {
    const { a: storeA, b: storeB } = stores();
    const a = await tab(storeA); const b = await tab(storeB);
    a.doc.getMap("draft").set("a", "offline-a");
    b.doc.getMap("draft").set("b", "offline-b");
    await Promise.all(reverse ? [b.persistence.persistNow(), a.persistence.persistNow()] : [a.persistence.persistNow(), b.persistence.persistNow()]);
    for (const peer of reverse ? [b, a] : [a, b]) await peer.close();
    const restored = await storeA.get("shared");
    expect(draft(restored)).toEqual({ a: "offline-a", b: "offline-b" });
    expect(restored?.pendingRemoteSync).toBe(true);
  });

  it("an ACK of one branch cannot clear another pending branch; full coverage can", async () => {
    const { a: storeA, b: storeB } = stores();
    const a = await tab(storeA); const b = await tab(storeB);
    a.doc.getMap("draft").set("a", "offline");
    b.doc.getMap("draft").set("b", "acknowledged");
    await a.persistence.persistNow();
    b.persistence.markRemoteDurable(); await b.persistence.persistNow();
    expect(draft(await storeB.get("shared"))).toEqual({ a: "offline", b: "acknowledged" });
    expect((await storeB.get("shared"))?.pendingRemoteSync).toBe(true);
    expect(b.persistence.getSnapshot()).toMatchObject({ state: "local_only", pendingRemoteSync: true });
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    b.persistence.markRemoteDurable(); await b.persistence.persistNow();
    expect((await storeA.get("shared"))?.pendingRemoteSync).toBe(false);
    await a.close(); await b.close();
  });

  it("keeps a clear and its pending flag against a stale clean snapshot with an equal vector", async () => {
    const { a, b } = stores(); const before = new Y.Doc(); const cleared = new Y.Doc();
    before.getMap("draft").set("value", "long value");
    Y.applyUpdate(cleared, Y.encodeStateAsUpdate(before));
    cleared.getMap("draft").delete("value");
    expect(Y.encodeStateVector(cleared)).toEqual(Y.encodeStateVector(before));
    await a.commit(record("shared", cleared), limits);
    await b.commit(record("shared", before, false), limits);
    expect(draft(await a.get("shared"))).toEqual({});
    expect((await a.get("shared"))?.pendingRemoteSync).toBe(true);
    await b.commit(record("shared", cleared, false), limits);
    expect((await a.get("shared"))?.pendingRemoteSync).toBe(false);
    before.destroy(); cleared.destroy();
  });

  it("retains an unresolved delete until a clean snapshot covers that delete set", async () => {
    const { a, b } = stores(); const writer = new Y.Doc(); const empty = new Y.Doc();
    writer.getMap("draft").set("future", "removed");
    const vector = Y.encodeStateVector(writer);
    writer.getMap("draft").delete("future");
    const update = Y.encodeStateAsUpdate(writer, vector);
    await a.commit({ ...record("shared", writer), update, bytes: update.byteLength }, limits);
    await b.commit(record("shared", empty, false), limits);
    expect((await a.get("shared"))?.pendingRemoteSync).toBe(true);
    await b.commit(record("shared", writer, false), limits);
    expect((await a.get("shared"))?.pendingRemoteSync).toBe(false);
    expect(draft(await a.get("shared"))).toEqual({});
    writer.destroy(); empty.destroy();
  });

  it("refuses stale eviction after the victim becomes pending and aborts quota admission", async () => {
    const { a, b } = stores(); const victim = new Y.Doc(); const next = new Y.Doc();
    victim.getMap("draft").set("baseline", true);
    await a.commit(record("victim", victim, false), limits);
    const staleMetadata = await b.listMeta(); expect(staleMetadata[0].pendingRemoteSync).toBe(false);
    victim.getMap("draft").set("offline", "keep"); await a.commit(record("victim", victim), limits);
    expect(await b.deleteIfDurable("victim")).toBe(false);
    next.getMap("draft").set("next", true);
    await expect(b.commit(record("next", next), { ...limits, maxWorks: 1 })).rejects.toThrow("QUOTA_RESERVED");
    expect(draft(await b.get("victim"))).toEqual({ baseline: true, offline: "keep" });
    expect(await b.get("next")).toBeNull();
    victim.destroy(); next.destroy();
  });

  it("leaves every old record intact when merged size or model checks abort", async () => {
    const { a, b } = stores(); const left = new Y.Doc(); const right = new Y.Doc();
    left.getMap("draft").set("left", "x".repeat(1000));
    right.getMap("draft").set("right", "y".repeat(1000));
    const original = await a.commit(record("shared", left), limits);
    const other = new Y.Doc(); other.getMap("draft").set("durable", true);
    await a.commit(record("evictable", other, false), limits);
    await expect(b.commit(record("shared", right), { ...limits, perWorkBytes: 1500, maxWorks: 1 })).rejects.toThrow("QUOTA_RESERVED");
    expect((await a.get("shared"))?.update).toEqual(original.update);
    expect(await a.get("evictable")).not.toBeNull();
    await expect(b.commit(record("shared", right, false, 2), limits)).rejects.toThrow("MODEL_MISMATCH");
    expect((await a.get("shared"))?.update).toEqual(original.update);
    left.destroy(); right.destroy(); other.destroy();
  });
});

it("aborts an IndexedDB transaction after tentative eviction without losing the victim", async () => {
  const a = new IndexedDbYjsStore(); const b = new IndexedDbYjsStore();
  const victim = new Y.Doc(); victim.getMap("draft").set("durable", true);
  await a.commit(record("victim", victim, false), limits);
  const next = new Y.Doc(); next.getMap("draft").set("next", true);
  // The mutation tentatively evicts the durable victim but even an empty cache
  // cannot admit maxWorks=0. The whole transaction must roll back the deletion.
  await expect(b.commit(record("next", next), { ...limits, maxWorks: 0 })).rejects.toThrow("QUOTA_RESERVED");
  expect(draft(await a.get("victim"))).toEqual({ durable: true });
  expect(await a.get("next")).toBeNull();
  victim.destroy(); next.destroy();
});

it("admits legacy records missing metadata without evicting their pending bytes", async () => {
  const opened = indexedDB.open(LOCAL_YJS_DATABASE, 2);
  opened.onupgradeneeded = () => {
    opened.result.createObjectStore(LOCAL_YJS_STORE, { keyPath: "key" });
    opened.result.createObjectStore(LOCAL_YJS_META_STORE, { keyPath: "key" });
  };
  const database = await new Promise<IDBDatabase>(resolve => { opened.onsuccess = () => resolve(opened.result); });
  const doc = new Y.Doc(); doc.getMap("draft").set("legacy", true);
  const transaction = database.transaction(LOCAL_YJS_STORE, "readwrite");
  transaction.objectStore(LOCAL_YJS_STORE).put(record("legacy", doc));
  await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); });
  database.close();
  const store = new IndexedDbYjsStore();
  await expect(store.commit(record("new", new Y.Doc()), { ...limits, maxWorks: 1 })).rejects.toThrow("QUOTA_RESERVED");
  expect(draft(await store.get("legacy"))).toEqual({ legacy: true });
  doc.destroy();
});
