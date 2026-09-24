import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BoundedYjsLocalPersistence, MemoryYjsStore, type LocalYjsRecord, type LocalYjsLimits } from "../realtime/persistence/local-yjs-persistence";

it("waits for an unmounted editor's in-flight and final writes before reopening its local branch", async () => {
  const store = new MemoryYjsStore();
  const commit = store.commit.bind(store);
  let release!: () => void;
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  store.commit = vi.fn(async (record: LocalYjsRecord, limits: LocalYjsLimits) => {
    started();
    await blocked;
    return commit(record, limits);
  });
  const original = new Y.Doc();
  const closing = new BoundedYjsLocalPersistence({ key: "immediate-reopen", document: original, modelVersion: 1, store, debounceMs: 60_000 });
  await closing.initialize();
  original.getText("body").insert(0, "first");
  const inFlight = closing.persistNow();
  await writing;
  original.getText("body").insert(5, " final edit");
  const close = closing.destroy();
  original.destroy();

  const restored = new Y.Doc();
  const reopening = new BoundedYjsLocalPersistence({ key: "immediate-reopen", document: restored, modelVersion: 1, store });
  let ready = false;
  const opened = reopening.initialize().then(() => { ready = true; });
  await Promise.resolve();
  expect(ready).toBe(false);
  release();
  await Promise.all([inFlight, close, opened]);
  expect(restored.getText("body").toString()).toBe("first final edit");
  expect(reopening.getSnapshot()).toMatchObject({ state: "local_only", pendingRemoteSync: true, restored: true });
  await reopening.destroy();
  restored.destroy();
});
