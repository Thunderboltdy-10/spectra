import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createCanonicalRoom, prepareCanonicalAppend, mergeCanonicalIntoLive, stateVectorHash, durableFrontierHash, nativeOverlap } from "./collaboration-canonical-room.mjs";
import { createCollaborationGatewayBridgeClient } from "./collaboration-gateway-bridge-client.mjs";
import { initializeNativeArtifactDocument, nativeArtifactProjection, nativeChangedRegionIds, isNativeArtifactDocument, NATIVE_PROJECTION_REGION } from "./collaboration-native-projection.mjs";
import { isRebaseablePersistenceFailure, samePersistenceBatch } from "./collaboration-persist.mjs";
import { planMergedUpdatePersist } from "./collaboration-durable-capacity.mjs";
import { MAX_DURABLE_UPDATE_BYTES } from "./collaboration-update-envelope.mjs";

const projection = doc => JSON.stringify(nativeArtifactProjection(doc, 4));
const regions = (before, after) => nativeChangedRegionIds(JSON.parse(before), JSON.parse(after));
const clone = doc => { const result = new Y.Doc(); Y.applyUpdate(result, Y.encodeStateAsUpdate(doc)); return result; };

it("commits a disjoint group without erasing a later native-conflicting draft", async () => {
  const base = new Y.Doc();
  initializeNativeArtifactDocument(base, { title: "Base", typeKey: "sheets", schemaVersion: 4, tags: [], content: { sheets: [] } });
  const live = clone(base), native = clone(base);
  const initial = Y.encodeStateAsUpdate(base), initialVector = Y.encodeStateVector(base);
  const firstBefore = nativeArtifactProjection(live, 4);
  live.getMap("spectra:work-v2:live-meta").set("summary", "disjoint");
  const firstDelta = Y.encodeStateAsUpdate(live, initialVector);
  const firstAfter = nativeArtifactProjection(live, 4), secondVector = Y.encodeStateVector(live);
  live.getMap("spectra:work-v2:live-meta").set("title", "pending conflict");
  const secondDelta = Y.encodeStateAsUpdate(live, secondVector), secondAfter = nativeArtifactProjection(live, 4);
  native.getMap("spectra:work-v2:live-meta").set("title", "Native title");
  let nextSequence = 3, liveStateVectorHash = stateVectorHash(native);
  const room = createCanonicalRoom({ expectedRoomId: "room", load: async after => ({ roomId: "room", nextSequence, liveStateVectorHash,
    updates: after === 0 ? [{ sequence: 1, update: initial }, { sequence: 2,
      update: Y.encodeStateAsUpdate(native, initialVector), regionIds: ["metadata:title"], nativeReconciliationOperationId: "native-op" }] : [] }) });
  const appended = vi.fn(async prepare => {
    const prepared = await prepare();
    const sequence = nextSequence++;
    liveStateVectorHash = prepared.payload.stateVectorHash;
    return { ...prepared, result: { sequence, duplicate: false } };
  });
  const sent = vi.fn();
  const deps = { Y, createHash, samePersistenceBatch, planMergedUpdatePersist, MAX_DURABLE_UPDATE_BYTES,
    canonicalRoom: () => room, nativeChangedRegionIds, nativeOverlap, isNativeArtifactDocument, NATIVE_PROJECTION_REGION,
    prepareCanonicalAppend, artifactProjection: projection, mergeCanonicalIntoLive, appendWithRetry: appended,
    documentPersistenceQueues: new WeakMap(), unappliedDocumentMessages: new WeakSet(), documentDurableAnchors: new WeakMap(), openDocuments: new Map(), sendGatewayState: sent,
    documentFrontierHash: durableFrontierHash, documentStateVectorHash: stateVectorHash,
    checkpointScheduler: () => ({ note: vi.fn() }) };
  const source = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
  const code = source.slice(source.indexOf("async function persistAcceptedMessages("), source.indexOf("function schedulePersistence("));
  const persist = new Function(...Object.keys(deps), `${code}; return persistAcceptedMessages;`)(...Object.values(deps));
  const context = { artifactId: "a", partitionKey: "root", schemaVersion: 4, actorKind: "human", policyVersion: 0, roomId: "room" };
  live.broadcastStateless = vi.fn();
  await expect(persist(live, [
    { context: { ...context, accountId: "one", clientId: "one" }, connection: "one", baseSequence: 2, documentUpdate: firstDelta,
      nativeProjectionBefore: firstBefore, nativeProjectionAfter: firstAfter, messageId: "first" },
    { context: { ...context, accountId: "two", clientId: "two" }, connection: "two", baseSequence: 2, documentUpdate: secondDelta,
      nativeProjectionBefore: firstAfter, nativeProjectionAfter: secondAfter, messageId: "second" },
  ])).rejects.toThrow("COLLABORATION_NATIVE_OVERLAP");
  expect(appended).toHaveBeenCalledTimes(2); // second preparation rejects before append
  expect(nextSequence).toBe(4);
  expect(nativeArtifactProjection(live, 4)).toMatchObject({ title: "pending conflict", summary: "disjoint" });
  expect(sent.mock.calls).toContainEqual(["one", { type: "spectra.durable_ack", updateIds: ["first"] }]);
  expect(sent.mock.calls.some(([, value]) => value.type === "spectra.durable_ack" && value.updateIds?.includes("second"))).toBe(false);
  expect(sent.mock.calls.some(([, value]) => value.code === "COLLABORATION_NATIVE_OVERLAP" && value.nativeOperationId === "native-op")).toBe(true);
  await room.dispose(); base.destroy(); live.destroy(); native.destroy();
});

it("identifies native overlap since the authored base while allowing disjoint regions", () => {
  const nativeRegions = new Map([["metadata:title", { regionId: "metadata:title", sequence: 7, operationId: "native-op" }]]);
  expect(nativeOverlap({ baseSequence: 7, authoredRegions: ["metadata:title"], nativeRegions })).toMatchObject({ operationId: "native-op", regionId: "metadata:title" });
  expect(nativeOverlap({ baseSequence: 7, authoredRegions: ["metadata:summary"], nativeRegions })).toBeNull();
  expect(nativeOverlap({ baseSequence: 8, authoredRegions: ["metadata:title"], nativeRegions })).toBeNull();
  expect(nativeOverlap({ baseSequence: 7, authoredRegions: ["artifact:structure"], nativeRegions })).not.toBeNull();
  expect(nativeOverlap({ baseSequence: 7, authoredRegions: ["metadata:title"], nativeRegions, historyFloor: 8 })).toMatchObject({ historyUnavailable: true });
});

it("defers idle canonical publication while a captured frame is awaiting apply", async () => {
  const canonical = new Y.Doc();
  canonical.getMap("metadata").set("title", "native");
  const live = new Y.Doc();
  const unappliedDocumentMessages = new WeakSet([live]);
  const broadcast = vi.fn();
  live.broadcastStateless = broadcast;
  const deps = { flushPersistence: async () => undefined,
    canonicalRoom: () => ({ run: work => work({ refresh: async () => ({ document: canonical, stored: { nextSequence: 3 } }) }) }),
    documentPersistenceQueues: new WeakMap(), unappliedDocumentMessages, documentDurableAnchors: new WeakMap(), mergeCanonicalIntoLive,
    documentFrontierHash: durableFrontierHash, openDocuments: new Map(), durableHeadKey: () => "room" };
  const source = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
  const code = source.slice(source.indexOf("async function catchUpCanonicalRoom("), source.indexOf("const compactionState ="));
  const catchUp = new Function(...Object.keys(deps), `${code}; return catchUpCanonicalRoom;`)(...Object.values(deps));
  await catchUp(live, {});
  expect(live.getMap("metadata").has("title")).toBe(false);
  expect(broadcast).not.toHaveBeenCalled();
  unappliedDocumentMessages.delete(live);
  await catchUp(live, {});
  expect(live.getMap("metadata").get("title")).toBe("native");
  expect(broadcast).toHaveBeenCalledOnce();
  canonical.destroy(); live.destroy();
});

it("reloads a compacted tail and preserves a delete-only change with equal vectors", async () => {
  const durable = new Y.Doc(); durable.getMap("body").set("removed", true);
  const initial = Y.encodeStateAsUpdate(durable);
  const vector = Y.encodeStateVector(durable);
  let compacted = false;
  const load = vi.fn(async after => {
    if (!compacted) return { roomId: "room", nextSequence: 2, liveStateVectorHash: stateVectorHash(durable),
      updates: [{ sequence: 1, update: initial }] };
    if (after > 0) throw new Error("COLLABORATION_REPLAY_GENERATION_CHANGED");
    return { roomId: "room", nextSequence: 3, liveStateVectorHash: stateVectorHash(durable),
      snapshot: { throughSequence: 2, update: Y.encodeStateAsUpdate(durable) }, updates: [] };
  });
  const room = createCanonicalRoom({ load, expectedRoomId: "room" });
  await room.run(session => session.refresh());
  durable.getMap("body").delete("removed"); compacted = true;
  expect(Y.encodeStateVector(durable)).toEqual(vector);
  await room.run(async session => {
    const refreshed = await session.refresh();
    expect(refreshed.document.getMap("body").has("removed")).toBe(false);
    expect(refreshed.historyFloor).toBe(2);
    expect(refreshed.stored.nextSequence).toBe(3);
  });
  expect(load.mock.calls.map(([after]) => after)).toEqual([0, 1, 0]);
  await room.dispose(); durable.destroy();
});

it("replays a native delete and disjoint browser delta against the exact durable sequence", async () => {
  const base = new Y.Doc();
  initializeNativeArtifactDocument(base, { title: "Sheet", typeKey: "sheets", schemaVersion: 4, tags: [], content: { sheets: [{ id: "s", name: "Sheet", cells: { A1: { value: 1 } } }] } });
  base.getMap("native-only").set("deleted", "keep until native edit");
  const browser = clone(base);
  const native = clone(base);
  const baseVector = Y.encodeStateVector(base);
  native.getMap("native-only").delete("deleted");
  native.getMap("spectra:work-v2:live-meta").set("title", "Native title");
  browser.getMap("spectra:work-v2:live-meta").set("summary", "Browser summary");
  const browserDelta = Y.encodeStateAsUpdate(browser, baseVector);
  const stored = { roomId: "room", nextSequence: 3, liveStateVectorHash: stateVectorHash(native), updates: [
    { sequence: 1, update: Y.encodeStateAsUpdate(base) }, { sequence: 2, update: Y.encodeStateAsUpdate(native, baseVector) },
  ] };
  const load = vi.fn(async () => stored);
  const room = createCanonicalRoom({ load, expectedRoomId: "room" });
  await room.run(async session => {
    const { document, stored: head } = await session.refresh();
    const prepared = prepareCanonicalAppend({ document, stored: head, update: browserDelta, projection, regions });
    expect(prepared).toMatchObject({ expectedRoomId: "room", expectedNextSequence: 3, baseStateVectorHash: stateVectorHash(native) });
    expect(JSON.parse(prepared.projectionJson)).toMatchObject({ title: "Native title", summary: "Browser summary" });
    expect(prepared.regionIds).toEqual(["metadata:summary"]);
    expect(document.getMap("native-only").has("deleted")).toBe(false);
    expect(prepared.frontierHash).toBe(durableFrontierHash(document));
    // A later speculative edit stays local and cannot appear in this receipt.
    browser.getMap("later-pending").set("not durable", true);
    mergeCanonicalIntoLive(document, browser);
    expect(browser.getMap("later-pending").get("not durable")).toBe(true);
    expect(durableFrontierHash(browser)).not.toBe(prepared.frontierHash);
    session.commit(3);
  });
  await room.dispose();
  base.destroy(); browser.destroy(); native.destroy();
});

it("catches up delete-only heads even when the state vector is unchanged", async () => {
  const canonical = new Y.Doc(); canonical.getText("body").insert(0, "native text");
  const live = clone(canonical);
  const initial = Y.encodeStateAsUpdate(canonical);
  const vector = Y.encodeStateVector(canonical);
  let head = 2;
  const load = vi.fn(async after => ({ roomId: "room", nextSequence: head, liveStateVectorHash: stateVectorHash(canonical),
    updates: after === 0 ? [{ sequence: 1, update: initial }] : [{ sequence: 2, update: Y.encodeStateAsUpdate(canonical, vector) }] }));
  const room = createCanonicalRoom({ load, expectedRoomId: "room" });
  await room.run(session => session.refresh());
  canonical.getText("body").delete(0, 6); head = 3;
  expect(Y.encodeStateVector(canonical)).toEqual(vector);
  await room.run(async session => {
    const next = await session.refresh(); mergeCanonicalIntoLive(next.document, live);
    expect(next.stored.nextSequence).toBe(3); expect(live.getText("body").toString()).toBe(" text");
  });
  expect(load.mock.calls.map(call => call[0])).toEqual([0, 1]);
  await room.dispose(); canonical.destroy(); live.destroy();
});

it("continues paginated tail loads from the caller's sequence", async () => {
  const bridge = createCollaborationGatewayBridgeClient({ convexUrl: "https://fixture.invalid", bridgeKey: "fixture-key".repeat(4),
    client: { action: async (_ref, args) => {
      const { afterSequence } = JSON.parse(args.payloadJson);
      return { roomId: "room", nextSequence: 12, afterSequence: afterSequence + 1, hasMore: afterSequence === 9,
        updates: [{ sequence: afterSequence + 1, update: "AAA=" }] };
    } } });
  expect(await bridge("load", { artifactId: "a", partitionKey: "root", afterSequence: 9 })).toMatchObject({ nextSequence: 12,
    updates: [{ sequence: 10 }, { sequence: 11 }] });
});

it("rebuilds only after an explicit stale CAS, retaining the same envelope on a lost acknowledgement", async () => {
  const source = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
  const code = source.slice(source.indexOf("async function appendWithRetry("), source.indexOf("async function persistAcceptedMessages("));
  const prepare = vi.fn(async () => ({ payload: { idempotencyKey: "stable-delta", generation: prepare.mock.calls.length } }));
  const appended = [];
  const bridge = vi.fn(async (_operation, payload) => {
    appended.push(payload);
    if (appended.length === 1) throw new Error("COLLABORATION_BASE_STATE_STALE");
    if (appended.length === 2) throw new Error("fetch failed");
    return { sequence: 3, duplicate: true };
  });
  const deps = { bridge, reauthorizePersistenceEntries: async () => undefined, isRebaseablePersistenceFailure,
    PERSISTENCE_REBASE_MAX_ATTEMPTS: 8, PERSISTENCE_RETRY_MAX_MS: 5000, collaborationRetryDelayMs: () => 0,
    collaborationFailureMessage: String, permanentPersistenceFailure: () => false, forceCanonicalReconnect: vi.fn(),
    process: { stderr: { write: vi.fn() } } };
  const append = new Function(...Object.keys(deps), `let lastPersistenceFailure; ${code}; return appendWithRetry;`)(...Object.values(deps));
  expect(await append(prepare, [{ context: {} }])).toMatchObject({ result: { sequence: 3 } });
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(appended[1]).toBe(appended[2]); expect(appended[0]).not.toBe(appended[1]);
});

it("opens the canonical room from the document owned by the connected Hocuspocus connection", async () => {
  const canonical = new Y.Doc(); canonical.getText("body").insert(0, "durable text");
  const live = new Y.Doc(); live.broadcastStateless = vi.fn();
  const context = { artifactId: "artifact", partitionKey: "root" };
  const activeConnections = new Set();
  const openDocuments = new Map();
  const forceCanonicalReconnect = vi.fn();
  const authorizationGuard = { watch: vi.fn(() => vi.fn()) };
  const deps = { flushPersistence: async () => undefined,
    canonicalRoom: () => ({ run: work => work({ refresh: async () => ({ document: canonical, stored: { nextSequence: 3 } }) }) }),
    documentPersistenceQueues: new WeakMap(), unappliedDocumentMessages: new WeakSet(), documentDurableAnchors: new WeakMap(), mergeCanonicalIntoLive,
    documentFrontierHash: durableFrontierHash, openDocuments, durableHeadKey: () => "room" };
  const source = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
  const code = source.slice(source.indexOf("async function catchUpCanonicalRoom("), source.indexOf("const compactionState ="));
  const catchUpCanonicalRoom = new Function(...Object.keys(deps), `${code}; return catchUpCanonicalRoom;`)(...Object.values(deps));
  const start = source.indexOf("  async connected(");
  const end = source.indexOf("  async beforeHandleMessage(", start);
  const hooks = { reauthorize: async () => undefined, activeConnections, openDocuments,
    durableHeadKey: deps.durableHeadKey, catchUpCanonicalRoom, forceCanonicalReconnect,
    collaborationFailureMessage: String, authorizationGuard };
  const connected = new Function(...Object.keys(hooks), `return ({${source.slice(start, end)}}).connected;`)(...Object.values(hooks));
  const connection = { context, document: live, onClose: vi.fn(), webSocket: { close: vi.fn() } };
  try {
    // The installed server's connected payload has connection and context, but no document field.
    await connected({ connection, context, documentName: "artifact-room" });
    expect(forceCanonicalReconnect).not.toHaveBeenCalled();
    expect(live.getText("body").toString()).toBe("durable text");
    expect(openDocuments.get("room")).toMatchObject({ document: live, nextSequence: 3 });
    expect(authorizationGuard.watch).toHaveBeenCalledWith(connection);
    expect(activeConnections.has(connection)).toBe(true);
  } finally { canonical.destroy(); live.destroy(); }
});

it.each(["authorization", "catch-up"])("releases a peer closed during connected %s", async phase => {
  let resume;
  const pending = new Promise(resolve => { resume = resolve; });
  const activeConnections = new Set(), openDocuments = new Map(), callbacks = [];
  const unwatch = vi.fn(), watch = vi.fn(() => unwatch);
  const catchUpCanonicalRoom = vi.fn(() => phase === "catch-up" ? pending : Promise.resolve());
  const hooks = { reauthorize: () => phase === "authorization" ? pending : Promise.resolve(),
    activeConnections, openDocuments, durableHeadKey: () => "room", catchUpCanonicalRoom,
    forceCanonicalReconnect: vi.fn(), collaborationFailureMessage: String, authorizationGuard: { watch } };
  const source = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
  const start = source.indexOf("  async connected("), end = source.indexOf("  async beforeHandleMessage(", start);
  const connected = new Function(...Object.keys(hooks), `return ({${source.slice(start, end)}}).connected;`)(...Object.values(hooks));
  const connection = { context: {}, document: {}, onClose: callback => callbacks.push(callback), webSocket: { close: vi.fn() } };
  const joining = connected({ connection });
  await Promise.resolve();
  callbacks.forEach(callback => callback());
  resume();
  await joining;
  expect(activeConnections.size).toBe(0);
  if (phase === "authorization") {
    expect(watch).not.toHaveBeenCalled();
    expect(catchUpCanonicalRoom).not.toHaveBeenCalled();
    expect(openDocuments.size).toBe(0);
  } else {
    expect(watch).toHaveBeenCalledOnce();
    expect(unwatch).toHaveBeenCalledOnce();
  }
});
