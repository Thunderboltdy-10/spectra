import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createHash } from "node:crypto";
import { canonicalDurableUpdate } from "./collaboration-update-envelope.mjs";
import { samePersistenceBatch } from "./collaboration-persist.mjs";
import {
  chainPersistThenCompact, drainGatewayForShutdown, GATEWAY_RESTARTING_CLOSE, GATEWAY_SHUTDOWN_DRAIN_MS,
  persistenceFlushDelay, PERSISTENCE_MAX_BATCH_ENTRIES,
} from "./collaboration-persist.mjs";
import { mergeCanonicalIntoLive } from "./collaboration-canonical-room.mjs";

const source = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
function harness(persist = vi.fn(async () => undefined)) {
  const queues = new WeakMap();
  const unapplied = new WeakSet();
  const persistenceDocuments = new Set();
  const persistenceQueue = document => {
    if (!queues.has(document)) queues.set(document, {
      pending: [], snapshotAfterFirst: null, firstPendingAt: null, pendingBytes: 0, timer: null,
      chain: chainPersistThenCompact({ persist, compact: async () => undefined }),
    });
    return queues.get(document);
  };
  const sent = vi.fn();
  const deps = { Y, persistenceQueue, persistenceFlushDelay, documentPersistenceQueues: queues,
    isNativeArtifactDocument: () => false, persistenceDocuments, unappliedDocumentMessages: unapplied,
    sendGatewayState: sent, forceCanonicalReconnect: vi.fn(), collaborationFailureMessage: String };
  const code = source.slice(source.indexOf("function persistenceDirty("), source.indexOf("function canonicalRoom(")) +
    source.slice(source.indexOf("function schedulePersistence("), source.indexOf("function sessionClaims("));
  const handlers = new Function(...Object.keys(deps), `let lastPersistenceFailure; ${code}; return {schedulePersistence, flushPersistence, persistenceDirty};`)(...Object.values(deps));
  const confirmCode = source.slice(source.indexOf("  async onStateless("), source.indexOf("  async onLoadDocument("));
  const release = vi.fn();
  const reject = vi.fn();
  const canonical = new Y.Doc();
  const confirmDeps = { flushPersistence: handlers.flushPersistence, reauthorize: vi.fn(async () => undefined),
    documentFrontierHash: () => "fixture-frontier",
    documentDurableAnchors: new WeakMap(),
    acquireDocumentMessage: vi.fn(async () => undefined), releaseDocumentMessage: release,
    sendGatewayState: sent, rejectPeerUpdate: reject, collaborationFailureMessage: String,
    Y, MAX_COMPACTION_STATE_VECTOR_BYTES: 128 * 1024, documentPersistenceQueues: queues,
    unappliedDocumentMessages: unapplied, mergeCanonicalIntoLive,
    canonicalRoom: () => ({ run: async work => work({ refresh: async () => ({ document: canonical }) }) }) };
  const confirm = new Function(...Object.keys(confirmDeps), `return ({${confirmCode}}).onStateless;`)(...Object.values(confirmDeps));
  return { ...handlers, persist, sent, confirm, release, reject, canonical, unapplied, queues, persistenceDocuments,
    reauthorize: confirmDeps.reauthorize };
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

// Hocuspocus fires stateless hooks without awaiting them: a rejected hook is an
// unhandled rejection that exits the gateway and drops every room (LV-062).
it.each([false, true])("confirms only after the durable barrier (failure=%s), outside the apply gate, and never rejects", async failure => {
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
  expect(await outcome).toBe("ok");
  expect(h.sent.mock.calls.filter(call => call[1].type === "spectra.durable_ack")).toHaveLength(failure ? 0 : 1);
  expect(h.reject).toHaveBeenCalledTimes(failure ? 1 : 0);
  doc.destroy();
});

it("tells only the peer when reauthorization fails during a stateless request", async () => {
  const h = harness(); const doc = new Y.Doc(); const connection = { context: {}, socketId: "fixture" };
  h.reauthorize.mockRejectedValueOnce(new Error("COLLABORATION_AUTH_UNAVAILABLE"));
  await expect(h.confirm({ connection, document: doc,
    payload: JSON.stringify({ type: "spectra.durable_confirm", confirmationId: "recovery:2" }) })).resolves.toBeUndefined();
  expect(h.reject).toHaveBeenCalledWith(connection, "Error: COLLABORATION_AUTH_UNAVAILABLE");
  expect(h.release).not.toHaveBeenCalled();
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
    shuttingDown: false, gatewayRestarting: vi.fn(), persistenceDocuments: new Set(),
    unappliedDocumentMessages: new WeakSet(),
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

function shutdownHarness(h, { connections = [] } = {}) {
  const exit = vi.fn();
  const log = vi.fn();
  const checkpoint = { flush: vi.fn(async () => undefined), dispose: vi.fn() };
  const server = { httpServer: { close: vi.fn() },
    hocuspocus: { documents: new Map([["room", { getConnections: () => connections }]]) } };
  const deps = { shuttingDown: false, clearInterval: vi.fn(), policySweep: null, authorizationGuard: { dispose: vi.fn() },
    drainGatewayForShutdown, server, activeConnections: new Set(connections), GATEWAY_RESTARTING_CLOSE,
    persistenceDocuments: h.persistenceDocuments, persistenceDirty: h.persistenceDirty,
    flushPersistence: h.flushPersistence, checkpointSchedulers: new Set([checkpoint]),
    documentPersistenceQueues: h.queues, process: { exit, stderr: { write: log } } };
  const code = source.slice(source.indexOf("async function shutdown() {"), source.indexOf('process.on("SIGINT", shutdown);'));
  const shutdown = new Function(...Object.keys(deps), `${code}; return shutdown;`)(...Object.values(deps));
  return { shutdown, exit, log, checkpoint, server };
}

it("stores every accepted update and closes sockets before the process exits on SIGTERM", async () => {
  const h = harness(); const doc = new Y.Doc();
  const socket = { close: vi.fn() };
  const s = shutdownHarness(h, { connections: [{ webSocket: socket }] });
  // Accepted, acknowledged as pending, and still inside the 180 ms batch window.
  h.schedulePersistence(doc, entry()); h.schedulePersistence(doc, entry());
  expect(h.persist).not.toHaveBeenCalled();
  await s.shutdown();
  expect(s.server.httpServer.close).toHaveBeenCalledOnce();
  expect(socket.close).toHaveBeenCalledExactlyOnceWith(1012, "Gateway restarting");
  expect(h.persist).toHaveBeenCalledOnce();
  expect(h.persist.mock.calls[0][0].entries).toHaveLength(2);
  expect(s.checkpoint.flush).toHaveBeenCalledOnce();
  expect(h.persist.mock.invocationCallOrder[0]).toBeLessThan(s.checkpoint.flush.mock.invocationCallOrder[0]);
  expect(s.exit).toHaveBeenCalledExactlyOnceWith(0);
  expect(h.persistenceDocuments.size).toBe(0);
  doc.destroy();
});

it("exits within the drain budget and logs the room it could not store", async () => {
  const h = harness(vi.fn(() => new Promise(() => undefined))); const doc = new Y.Doc();
  const s = shutdownHarness(h);
  h.schedulePersistence(doc, entry());
  const stopping = s.shutdown();
  await vi.advanceTimersByTimeAsync(GATEWAY_SHUTDOWN_DRAIN_MS);
  await stopping;
  expect(s.exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(s.log.mock.calls.map(call => call[0]).join("")).toMatch(/not durable before exit: artifact=/);
  doc.destroy();
});

it("hands an update that arrives during shutdown to the next gateway instead of failing it", async () => {
  const rejected = vi.fn();
  const restarting = Object.assign(new Error("COLLABORATION_GATEWAY_RESTARTING"), GATEWAY_RESTARTING_CLOSE);
  const deps = { reauthorize: vi.fn(), acquireDocumentMessage: vi.fn(), rejectPeerUpdate: rejected,
    shuttingDown: true, gatewayRestarting: () => restarting };
  const code = source.slice(source.indexOf("  async beforeHandleMessage("), source.indexOf("  async afterHandleMessage("));
  const before = new Function(...Object.keys(deps), `return ({${code}}).beforeHandleMessage;`)(...Object.values(deps));
  const document = new Y.Doc(); const writer = new Y.Doc(); writer.getText("body").insert(0, "late edit");
  await expect(before({ document, context: { canModify: true }, update: Y.encodeStateAsUpdate(writer), socketId: "peer", connection: {} }))
    .rejects.toMatchObject({ code: 1012 });
  // 4409 plus durable_failed would mark the tab's edit as failed; 1012 makes it reconnect and re-send.
  expect(rejected).not.toHaveBeenCalled();
  expect(deps.acquireDocumentMessage).not.toHaveBeenCalled();
  expect(document.getText("body").toString()).toBe("");
  document.destroy(); writer.destroy();
});
