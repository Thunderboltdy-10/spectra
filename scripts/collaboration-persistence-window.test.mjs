import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createHash } from "node:crypto";
import { canonicalDurableUpdate } from "./collaboration-update-envelope.mjs";
import { samePersistenceBatch } from "./collaboration-persist.mjs";
import { chainPersistThenCompact, persistenceFlushDelay, PERSISTENCE_MAX_BATCH_ENTRIES } from "./collaboration-persist.mjs";
import { mergeCanonicalIntoLive } from "./collaboration-canonical-room.mjs";

const source = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
function harness(persist = vi.fn(async () => undefined)) {
  const queues = new WeakMap();
  const persistenceQueue = document => {
    if (!queues.has(document)) queues.set(document, {
      pending: [], snapshotAfterFirst: null, firstPendingAt: null, pendingBytes: 0, timer: null,
      chain: chainPersistThenCompact({ persist, compact: async () => undefined }),
    });
    return queues.get(document);
  };
  const sent = vi.fn();
  const deps = { Y, persistenceQueue, persistenceFlushDelay, documentPersistenceQueues: queues,
    isNativeArtifactDocument: () => false,
    sendGatewayState: sent, forceCanonicalReconnect: vi.fn(), collaborationFailureMessage: String };
  const code = source.slice(source.indexOf("function schedulePersistence("), source.indexOf("function sessionClaims("));
  const handlers = new Function(...Object.keys(deps), `let lastPersistenceFailure; ${code}; return {schedulePersistence, flushPersistence};`)(...Object.values(deps));
  const confirmCode = source.slice(source.indexOf("  async onStateless("), source.indexOf("  async onLoadDocument("));
  const release = vi.fn();
  const reject = vi.fn();
  const canonical = new Y.Doc();
  const unapplied = new WeakSet();
  const confirmDeps = { flushPersistence: handlers.flushPersistence, reauthorize: vi.fn(async () => undefined),
    documentFrontierHash: () => "fixture-frontier",
    documentDurableAnchors: new WeakMap(),
    acquireDocumentMessage: vi.fn(async () => undefined), releaseDocumentMessage: release,
    sendGatewayState: sent, rejectPeerUpdate: reject, collaborationFailureMessage: String,
    Y, MAX_COMPACTION_STATE_VECTOR_BYTES: 128 * 1024, documentPersistenceQueues: queues,
    unappliedDocumentMessages: unapplied, mergeCanonicalIntoLive,
    canonicalRoom: () => ({ run: async work => work({ refresh: async () => ({ document: canonical }) }) }) };
  const confirm = new Function(...Object.keys(confirmDeps), `return ({${confirmCode}}).onStateless;`)(...Object.values(confirmDeps));
  return { ...handlers, persist, sent, confirm, release, reject, canonical, unapplied };
}
const entry = () => ({ documentUpdate: new Uint8Array([0, 0]), context: { artifactId: "fixture" }, messageId: "update", connection: {} });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());

it("refreshes an already committed room without authoring another persistence entry", async () => {
  const h = harness(); const doc = new Y.Doc();
  h.canonical.getText("body").insert(0, "Accepted by the atomic sink");
  try {
    await h.confirm({ connection: { context: {}, socketId: "peer" }, document: doc,
      payload: JSON.stringify({ type: "spectra.canonical_refresh", confirmationId: "admitted:1" }) });
    expect(doc.getText("body").toString()).toBe("Accepted by the atomic sink");
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.sent).not.toHaveBeenCalled();
  } finally { doc.destroy(); h.canonical.destroy(); }
});

it("defers committed refresh while a human frame is captured but not applied", async () => {
  const h = harness(); const doc = new Y.Doc();
  h.canonical.getText("body").insert(0, "Native state");
  h.unapplied.add(doc);
  try {
    await h.confirm({ connection: { context: {}, socketId: "peer" }, document: doc,
      payload: JSON.stringify({ type: "spectra.canonical_refresh", confirmationId: "admitted:1" }) });
    expect(doc.getText("body").toString()).toBe("");
    expect(h.persist).not.toHaveBeenCalled();
  } finally { doc.destroy(); h.canonical.destroy(); }
});

it("flushes sustained edits within a second and coalesces short bursts", async () => {
  const h = harness(); const doc = new Y.Doc();
  for (let i = 0; i < 10; i++) {
    h.schedulePersistence(doc, entry());
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(h.persist).toHaveBeenCalledOnce();
  expect(h.persist.mock.calls[0][0].entries).toHaveLength(10);
  h.schedulePersistence(doc, entry()); h.schedulePersistence(doc, entry());
  await vi.advanceTimersByTimeAsync(180);
  expect(h.persist).toHaveBeenCalledTimes(2);
  doc.destroy();
});

it("flushes at the entry and byte limits without waiting for idle", async () => {
  const h = harness(); const doc = new Y.Doc();
  for (let i = 0; i < PERSISTENCE_MAX_BATCH_ENTRIES; i++) h.schedulePersistence(doc, entry());
  await h.flushPersistence(doc);
  expect(h.persist).toHaveBeenCalledOnce();
  h.schedulePersistence(doc, { ...entry(), documentUpdate: new Uint8Array(760 * 1024) });
  await h.flushPersistence(doc);
  expect(h.persist).toHaveBeenCalledTimes(2);
  doc.destroy();
});

it("keeps one pending batch while storage is slow and backpressures a full batch", async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const h = harness(vi.fn(async () => blocked));
  const doc = new Y.Doc();
  h.schedulePersistence(doc, entry());
  await vi.advanceTimersByTimeAsync(180);
  expect(h.persist).toHaveBeenCalledOnce();
  let backpressure;
  for (let i = 0; i < PERSISTENCE_MAX_BATCH_ENTRIES; i++) backpressure = h.schedulePersistence(doc, entry());
  let completed = false;
  const waiting = backpressure.then(() => { completed = true; });
  await vi.advanceTimersByTimeAsync(2_000);
  expect(h.persist).toHaveBeenCalledOnce();
  expect(completed).toBe(false);
  release();
  await waiting;
  expect(h.persist).toHaveBeenCalledTimes(2);
  expect(h.persist.mock.calls[1][0].entries).toHaveLength(PERSISTENCE_MAX_BATCH_ENTRIES);
  doc.destroy();
});

it.each([false, true])("confirms only after the durable barrier (failure=%s), outside the apply gate", async failure => {
  let finish;
  const h = harness(vi.fn(() => new Promise((resolve, reject) => { finish = failure ? () => reject(new Error("durable failure")) : resolve; })));
  const doc = new Y.Doc(); const connection = { context: {}, socketId: "fixture" };
  h.schedulePersistence(doc, entry());
  const pending = h.confirm({ connection, document: doc, payload: JSON.stringify({ type: "spectra.durable_confirm", confirmationId: "recovery:1" }) });
  const outcome = pending.then(() => "ok", () => "failed");
  await vi.advanceTimersByTimeAsync(0);
  expect(h.release).toHaveBeenCalledOnce();
  expect(h.sent.mock.calls.some(call => call[1].type === "spectra.durable_ack")).toBe(false);
  finish();
  expect(await outcome).toBe(failure ? "failed" : "ok");
  expect(h.sent.mock.calls.filter(call => call[1].type === "spectra.durable_ack")).toHaveLength(failure ? 0 : 1);
  expect(h.reject).toHaveBeenCalledTimes(failure ? 1 : 0);
  doc.destroy();
});

it("allows a read-only no-op handshake but rejects an authored update before apply", async () => {
  const queue = [];
  const rejected = vi.fn();
  const projection = vi.fn(() => null);
  const deps = { Y, createHash, canonicalDurableUpdate, samePersistenceBatch,
    reauthorize: async () => undefined, catchUpCanonicalRoom: async () => undefined, extractYjsUpdate: frame => frame,
    acquireDocumentMessage: async () => undefined, releaseDocumentMessage: vi.fn(),
    isNativeArtifactDocument: () => true, nativeArtifactProjection: projection,
    artifactModelState: () => ({}), documentStateVectorHash: () => "hash",
    documentPersistenceQueues: new WeakMap(), messageQueue: () => queue,
    MAX_ASSEMBLED_BYTES: 64 * 1024 * 1024, rejectPeerUpdate: rejected,
    process: { stderr: { write: vi.fn() } } };
  const code = source.slice(source.indexOf("  async beforeHandleMessage("), source.indexOf("  async afterHandleMessage("));
  const before = new Function(...Object.keys(deps), `return ({${code}}).beforeHandleMessage;`)(...Object.values(deps));
  const document = new Y.Doc();
  const context = { canModify: false };
  await before({ document, context, update: new Uint8Array([0, 0]), socketId: "reader", connection: {} });
  expect(queue).toHaveLength(1);
  expect(queue[0].noop).toBe(true);
  expect(projection).not.toHaveBeenCalled();
  const writer = new Y.Doc(); writer.getText("body").insert(0, "forbidden");
  await expect(before({ document, context, update: Y.encodeStateAsUpdate(writer), socketId: "reader", connection: {} })).rejects.toThrow("COLLABORATION_READ_ONLY");
  expect(rejected).toHaveBeenCalledOnce();
  expect(document.getText("body").toString()).toBe("");
  document.destroy(); writer.destroy();
});
