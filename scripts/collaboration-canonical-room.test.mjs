import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createCanonicalRoom, prepareCanonicalAppend, mergeCanonicalIntoLive, stateVectorHash, durableFrontierHash } from "./collaboration-canonical-room.mjs";
import { createCollaborationGatewayBridgeClient } from "./collaboration-gateway-bridge-client.mjs";
import { initializeNativeArtifactDocument, nativeArtifactProjection, nativeChangedRegionIds } from "./collaboration-native-projection.mjs";
import { isRebaseablePersistenceFailure } from "./collaboration-persist.mjs";

const projection = doc => JSON.stringify(nativeArtifactProjection(doc, 4));
const regions = (before, after) => nativeChangedRegionIds(JSON.parse(before), JSON.parse(after));
const clone = doc => { const result = new Y.Doc(); Y.applyUpdate(result, Y.encodeStateAsUpdate(doc)); return result; };

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
