import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { COLLAB_RECONNECT } from "../collaboration/reconnect-backoff";
import { createCheckpointScheduler } from "../../../../scripts/collaboration-checkpoint.mjs";
import {
  gatewayHealthPayload,
  isGatewayHealthBody,
} from "../../../../scripts/collaboration-health.mjs";
import { collaborationPath, isCollaborationProxyRequest } from "../../../../scripts/collaboration-proxy-path.mjs";
import {
  MAX_DURABLE_UPDATE_BYTES,
  MAX_REALTIME_MESSAGE_BYTES,
  MAX_PROJECTION_JSON_CHARS,
  MAX_PROJECTION_JSON_UTF8_BYTES,
  canonicalDurableUpdate,
  projectionExceedsDurableBound,
  utf8ByteLength,
} from "../../../../scripts/collaboration-update-envelope.mjs";
import { MAX_COLLABORATION_BRIDGE_PAYLOAD_CHARACTERS } from "../../../../shared/collaboration-bridge";
import {
  COLLAB_RECONNECT as gatewayReconnect,
  reconnectDelayMs,
} from "../../../../scripts/collaboration-reconnect.mjs";
import {
  applyStoredRoomUpdates,
  encodeStoredRoomSnapshot,
  shouldCompactRoom,
  shouldRecoverNativeRoom,
} from "../../../../scripts/collaboration-room-state.mjs";
import {
  appendBaseStateVectorHash,
  durableHeadKey,
  isRebaseablePersistenceFailure,
  isTransientCollaborationFailure,
  permanentPersistenceFailure,
  rebaseAppendPayload,
  resolveRebaseHead,
  samePersistenceBatch,
  chainPersistThenCompact,
  collaborationFailureMessage,
  collaborationRetryDelayMs,
  COLLABORATION_AUTHORIZE_CACHE_MS,
} from "../../../../scripts/collaboration-persist.mjs";

describe("P5.I2 gateway production helpers", () => {
  it("admits a bounded native bootstrap snapshot and projection in one signed envelope", () => {
    const payloadJson = JSON.stringify({
      update: "u".repeat(986_604),
      projectionJson: "p".repeat(515_290),
      artifactId: "artifact-1",
      partitionKey: "root",
      accountId: "account-1",
      clientId: "client-1",
      policyVersion: 0,
      artifactUpdatedAt: 1,
      expectedNextSequence: 1,
      stateVectorHash: "s".repeat(43),
      projectionHash: "p".repeat(43),
    });

    expect(payloadJson.length).toBeGreaterThan(1_500_000);
    expect(payloadJson.length).toBeLessThanOrEqual(
      MAX_COLLABORATION_BRIDGE_PAYLOAD_CHARACTERS,
    );
  });

  it("keeps a leading slash on every proxied WebSocket upgrade target", () => {
    expect(collaborationPath("/_spectra/realtime")).toBe("/");
    expect(collaborationPath("/_spectra/realtime?token=abc&foo=1")).toBe(
      "/?token=abc&foo=1",
    );
    expect(collaborationPath("/_spectra/realtime/?token=abc&foo=1")).toBe(
      "/?token=abc&foo=1",
    );
    expect(collaborationPath("/_spectra/realtime/room?token=abc&foo=1")).toBe(
      "/room?token=abc&foo=1",
    );
    expect(isCollaborationProxyRequest("/_spectra/health")).toBe(true);
    expect(collaborationPath("/_spectra/health")).toBe("/_spectra/health");
    expect(isCollaborationProxyRequest("/library")).toBe(false);
  });

  it("keeps client and gateway reconnect constants aligned", () => {
    expect(COLLAB_RECONNECT).toMatchObject({
      delay: gatewayReconnect.delay,
      factor: gatewayReconnect.factor,
      minDelay: gatewayReconnect.minDelay,
      maxDelay: gatewayReconnect.maxDelay,
      jitter: gatewayReconnect.jitter,
      maxAttempts: gatewayReconnect.maxAttempts,
    });
  });

  it("grows reconnect delay with jitter inside the configured band", () => {
    const delays = [0, 1, 2, 3, 8].map((attempt) =>
      reconnectDelayMs(attempt, { jitter: false }),
    );
    expect(delays[0]).toBe(400);
    expect(delays[1]).toBe(800);
    expect(delays[2]).toBe(1_600);
    expect(delays[3]).toBe(3_200);
    expect(delays[4]).toBe(12_000);
    const jittered = reconnectDelayMs(3, { random: () => 0.5 });
    expect(jittered).toBeGreaterThanOrEqual(200);
    expect(jittered).toBeLessThanOrEqual(3_200);
  });

  it("flushes a checkpoint after idle and not on every note", async () => {
    const persisted: unknown[] = [];
    let now = 1_000;
    const scheduler = createCheckpointScheduler({
      idleMs: 100,
      maxMs: 1_000,
      now: () => now,
      persist: async (payload) => {
        persisted.push(payload);
        return payload;
      },
    });
    scheduler.note({ n: 1 });
    scheduler.note({ n: 2 });
    expect(persisted).toHaveLength(0);
    now = 1_100;
    await scheduler.flush();
    expect(persisted).toEqual([{ n: 2 }]);
    scheduler.dispose();
  });

  it("reports ready vs degraded health without changing the service identity", () => {
    const ready = gatewayHealthPayload({
      protocolVersion: 1,
      connections: 3,
      lastPersistenceFailure: null,
      startedAt: 10,
      now: 25,
    });
    expect(isGatewayHealthBody(ready)).toBe(true);
    expect(ready.status).toBe("ready");
    expect(ready.uptimeMs).toBe(15);
    expect(ready.dependencies.convex.status).toBe("ready");
    const degraded = gatewayHealthPayload({
      protocolVersion: 1,
      connections: 3,
      lastPersistenceFailure: {
        code: "COLLABORATION_APPEND_FAILED",
        at: 1,
        attempt: 2,
      },
      startedAt: 10,
      now: 25,
    });
    expect(degraded.status).toBe("degraded");
    expect(degraded.service).toBe("spectra-collaboration-gateway");
    const notReady = gatewayHealthPayload({
      protocolVersion: 1,
      convex: { status: "not_ready", detail: "Convex did not answer." },
    });
    expect(notReady.status).toBe("not_ready");
    expect(isGatewayHealthBody(notReady)).toBe(true);
    const compactionDegraded = gatewayHealthPayload({
      protocolVersion: 1,
      lastCompactionDeferred: {
        code: "COLLABORATION_COMPACTION_DEFERRED",
        reason: "snapshot_update_exceeds_envelope",
        at: 9,
      },
      startedAt: 10,
      now: 25,
    });
    expect(compactionDegraded.status).toBe("degraded");
    expect(compactionDegraded.compaction?.code).toBe(
      "COLLABORATION_COMPACTION_DEFERRED",
    );
  });


  it("does not recover a room whose unprojected human log already matches the live hash", () => {
    const hash = "a".repeat(43);
    expect(
      shouldRecoverNativeRoom({
        liveStateVectorHash: hash,
        observedStateVectorHash: hash,
      }),
    ).toBe(false);
    expect(
      shouldRecoverNativeRoom({
        liveStateVectorHash: hash,
        observedStateVectorHash: "b".repeat(43),
      }),
    ).toBe(true);
    expect(
      shouldRecoverNativeRoom({
        liveStateVectorHash: null,
        observedStateVectorHash: hash,
      }),
    ).toBe(false);
  });

  it("reloads a room from snapshot plus later updates after a process restart", () => {
    const base = new Y.Doc();
    base.getMap("spectra:work-v2:meta").set("initialized", true);
    base.getMap("spectra:work-v2:meta").set("workType", "document");
    base.getMap("spectra:work-v2:live-meta").set("title", "before");
    const snapshot = Y.encodeStateAsUpdate(base);
    const next = new Y.Doc();
    Y.applyUpdate(next, snapshot);
    next.getMap("spectra:work-v2:live-meta").set("title", "after");
    const delta = Y.encodeStateAsUpdate(next, Y.encodeStateVector(base));
    base.destroy();
    next.destroy();
    const restored = applyStoredRoomUpdates(Y, {
      snapshot: { update: Buffer.from(snapshot).toString("base64") },
      updates: [{ update: Buffer.from(delta).toString("base64") }],
    });
    expect(restored.getMap("spectra:work-v2:live-meta").get("title")).toBe(
      "after",
    );
    restored.destroy();
  });

  it("builds compaction snapshots from durable storage, not live-ahead state", () => {
    const durable = new Y.Doc();
    durable.getText("body").insert(0, "durable");
    const durableUpdate = Y.encodeStateAsUpdate(durable);
    const durableVector = Y.encodeStateVector(durable);
    const live = new Y.Doc();
    Y.applyUpdate(live, durableUpdate);
    live.getText("body").insert(live.getText("body").length, " pending");

    const encoded = encodeStoredRoomSnapshot(Y, {
      updates: [{ update: Buffer.from(durableUpdate).toString("base64") }],
    });
    const compacted = new Y.Doc();
    Y.applyUpdate(compacted, encoded.update);

    expect(compacted.getText("body").toString()).toBe("durable");
    expect(encoded.stateVector).toEqual(durableVector);
    expect(encoded.stateVector).not.toEqual(Y.encodeStateVector(live));

    durable.destroy();
    live.destroy();
    compacted.destroy();
  });

  it("accepts a bounded rich-document sync frame but persists only its canonical delta", () => {
    const canonical = new Y.Doc();
    canonical.getText("body").insert(0, "x".repeat(900_000));
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(canonical));
    peer.getText("body").insert(peer.getText("body").length, " edited");
    const fullPeerState = Y.encodeStateAsUpdate(peer);

    expect(fullPeerState.byteLength).toBeGreaterThan(MAX_DURABLE_UPDATE_BYTES);
    expect(fullPeerState.byteLength).toBeLessThan(MAX_REALTIME_MESSAGE_BYTES);
    expect(MAX_REALTIME_MESSAGE_BYTES).toBeGreaterThan(
      MAX_DURABLE_UPDATE_BYTES,
    );
    const durableDelta = canonicalDurableUpdate(Y, canonical, fullPeerState);
    expect(durableDelta).not.toBeNull();
    expect(durableDelta!.byteLength).toBeLessThan(MAX_DURABLE_UPDATE_BYTES);
    Y.applyUpdate(canonical, durableDelta!);
    expect(canonical.getText("body").toString()).toBe(
      peer.getText("body").toString(),
    );

    const oversizedPeer = new Y.Doc();
    Y.applyUpdate(oversizedPeer, Y.encodeStateAsUpdate(canonical));
    oversizedPeer.getText("new-body").insert(0, "y".repeat(800_000));
    const oversizedDelta = canonicalDurableUpdate(
      Y,
      canonical,
      Y.encodeStateAsUpdate(oversizedPeer),
    );
    expect(oversizedDelta!.byteLength).toBeGreaterThan(
      MAX_DURABLE_UPDATE_BYTES,
    );

    canonical.destroy();
    peer.destroy();
    oversizedPeer.destroy();
  });

  it("keeps a delete-only update in the durable envelope", () => {
    const canonical = new Y.Doc();
    canonical.getText("body").insert(0, "abcdef");
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(canonical));
    peer.getText("body").delete(1, 2);

    const deleteOnlyUpdate = Y.encodeStateAsUpdate(
      peer,
      Y.encodeStateVector(canonical),
    );
    expect(Y.encodeStateVector(peer)).toEqual(Y.encodeStateVector(canonical));
    const durableDelta = canonicalDurableUpdate(Y, canonical, deleteOnlyUpdate);

    expect(durableDelta).not.toBeNull();
    expect(durableDelta!.byteLength).toBeLessThanOrEqual(
      deleteOnlyUpdate.byteLength,
    );
    Y.applyUpdate(canonical, durableDelta!);
    expect(canonical.getText("body").toString()).toBe("adef");

    canonical.destroy();
    peer.destroy();
  });

  it("treats overlapping Yjs CAS as rebaseable persist work, not a dead socket", () => {
    const stale = new Error("COLLABORATION_BASE_STATE_STALE");
    expect(isRebaseablePersistenceFailure(stale)).toBe(true);
    expect(permanentPersistenceFailure(stale)).toBe(false);
    expect(
      permanentPersistenceFailure(
        new Error("COLLABORATION_GATEWAY_UNAVAILABLE"),
      ),
    ).toBe(false);
    expect(
      isTransientCollaborationFailure(
        new Error("COLLABORATION_GATEWAY_UNAVAILABLE"),
      ),
    ).toBe(true);
    expect(
      isTransientCollaborationFailure(
        new Error(
          '{"code":"InternalServerError","message":"Your request couldn\'t be completed. Try again later."}',
        ),
      ),
    ).toBe(true);
    expect(
      isTransientCollaborationFailure(
        new Error(
          '[Request ID: abc] Server Error\nUncaught Error: {"code":"TooManyWrites","message":"Too many writes per second. Your deployment is limited to 4 MiB bytes written per 1 second."}',
        ),
      ),
    ).toBe(true);
    expect(
      collaborationRetryDelayMs(
        new Error(
          'Uncaught Error: {"code":"TooManyWrites","message":"Too many writes per second."}',
        ),
        0,
      ),
    ).toBeGreaterThanOrEqual(1_000);
    expect(COLLABORATION_AUTHORIZE_CACHE_MS).toBeGreaterThanOrEqual(15_000);
    expect(
      permanentPersistenceFailure(new Error("COLLABORATION_TOKEN_EXPIRED")),
    ).toBe(true);
    expect(
      permanentPersistenceFailure(new Error("COLLABORATION_READ_ONLY")),
    ).toBe(true);
    expect(
      permanentPersistenceFailure(new Error("COLLABORATION_ACCESS_REVOKED")),
    ).toBe(true);
    expect(
      permanentPersistenceFailure(new Error("COLLABORATION_PROJECTION_SIZE")),
    ).toBe(true);
    expect(
      permanentPersistenceFailure(
        new Error("COLLABORATION_PROJECTION_INVALID"),
      ),
    ).toBe(true);
    expect(
      permanentPersistenceFailure(
        new Error("COLLABORATION_GATEWAY_UPDATE_SIZE"),
      ),
    ).toBe(true);
    expect(
      permanentPersistenceFailure(
        new Error(
          "[Request ID: abc] Server Error\nUncaught Error: Uncaught Error: Value is too large (1.48 MiB > maximum size 1 MiB)",
        ),
      ),
    ).toBe(true);
    expect(
      permanentPersistenceFailure(
        new Error("COLLABORATION_CHANGE_GROUP_SIZE"),
      ),
    ).toBe(true);
    expect(
      permanentPersistenceFailure(
        new Error(
          "Field name $spectraSnapshotOmitted starts with a '$', which is reserved.",
        ),
      ),
    ).toBe(true);
    expect(
      appendBaseStateVectorHash({
        lastPersistedHash: "b".repeat(43),
        capturedBaseHash: "a".repeat(43),
      }),
    ).toBe("b".repeat(43));
    expect(
      appendBaseStateVectorHash({
        lastPersistedHash: null,
        capturedBaseHash: "a".repeat(43),
      }),
    ).toBe("a".repeat(43));
    expect(
      rebaseAppendPayload(
        { baseStateVectorHash: "a".repeat(43), stateVectorHash: "c".repeat(43) },
        "b".repeat(43),
      ),
    ).toMatchObject({ baseStateVectorHash: "b".repeat(43) });
    expect(durableHeadKey({ artifactId: "art", partitionKey: "root" })).toBe(
      "art:root",
    );
    expect(
      resolveRebaseHead({
        lastPersistedHash: "a".repeat(43),
        storedLiveHash: "b".repeat(43),
      }),
    ).toBe("b".repeat(43));
    expect(
      resolveRebaseHead({
        lastPersistedHash: "a".repeat(43),
        storedLiveHash: null,
      }),
    ).toBe("a".repeat(43));
    expect(
      rebaseAppendPayload(
        { baseStateVectorHash: "a".repeat(43), stateVectorHash: "c".repeat(43) },
        resolveRebaseHead({
          lastPersistedHash: "a".repeat(43),
          storedLiveHash: "b".repeat(43),
        }),
      ),
    ).toMatchObject({ baseStateVectorHash: "b".repeat(43) });
  });

  it("treats Convex 1s function timeouts as transient so soft-reauth can keep the tab alive", () => {
    expect(
      isTransientCollaborationFailure(
        new Error("Function execution timed out (maximum duration: 1s)"),
      ),
    ).toBe(true);
    expect(
      isTransientCollaborationFailure(
        new Error("[Request ID: abc] Server Error\nUncaught Error: Function execution timed out (maximum duration: 1s)"),
      ),
    ).toBe(true);
  });


  it("coalesces same-account human edits in one durable batch and keeps AI per client", () => {
    const human = (clientId: string) => ({
      nativeInitialization: false,
      context: {
        artifactId: "art",
        partitionKey: "root",
        policyVersion: 0,
        actorKind: "human",
        accountId: "account-a",
        clientId,
      },
    });
    const otherAccount = {
      nativeInitialization: false,
      context: {
        artifactId: "art",
        partitionKey: "root",
        policyVersion: 0,
        actorKind: "human",
        accountId: "account-b",
        clientId: "client-1",
      },
    };
    const ai = (clientId: string) => ({
      nativeInitialization: false,
      context: {
        artifactId: "art",
        partitionKey: "root",
        policyVersion: 0,
        actorKind: "ai",
        accountId: "account-a",
        clientId,
      },
    });
    expect(samePersistenceBatch(human("c1"), human("c2"))).toBe(true);
    expect(samePersistenceBatch(human("c1"), otherAccount)).toBe(false);
    expect(samePersistenceBatch(human("c1"), ai("c1"))).toBe(false);
    expect(samePersistenceBatch(ai("c1"), ai("c2"))).toBe(false);
    expect(samePersistenceBatch(ai("c1"), ai("c1"))).toBe(true);
  });

  it("acks persist without waiting for compaction I/O", async () => {
    let compactStarted = 0;
    let compactFinished = 0;
    let persistUnblockedBeforeCompact = false;
    const chain = chainPersistThenCompact({
      persist: async () => "acked",
      compact: async () => {
        compactStarted += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        compactFinished += 1;
      },
    });
    const persistResult = await chain.enqueue({});
    persistUnblockedBeforeCompact =
      compactStarted === 1 && compactFinished === 0;
    await chain.compactTail;
    expect(persistResult).toBe("acked");
    expect(persistUnblockedBeforeCompact).toBe(true);
    expect(compactFinished).toBe(1);
  });

  it("surfaces Convex observe failures instead of the empty Error name", () => {
    expect(
      collaborationFailureMessage({
        message: "Error",
        data: { message: "COLLABORATION_BRIDGE_SNAPSHOT_REQUIRED" },
      }),
    ).toBe("COLLABORATION_BRIDGE_SNAPSHOT_REQUIRED");
    expect(collaborationFailureMessage(new Error("Error"))).toBe(
      "CLASSROOM_LOAD_CONVEX_OBSERVE_FAILED",
    );
    expect(
      collaborationFailureMessage(
        new Error(
          '[Request ID: abc] Server Error\nUncaught Error: {"code":"TooManyWrites","message":"Too many writes per second."}',
        ),
      ),
    ).toBe("Too many writes per second.");
  });

  it("fails closed when projection JSON exceeds UTF-8 or character bounds", () => {
    expect(MAX_PROJECTION_JSON_CHARS).toBe(900_000);
    expect(MAX_PROJECTION_JSON_UTF8_BYTES).toBe(900_000);
    expect(projectionExceedsDurableBound("x".repeat(900_000))).toBe(false);
    expect(projectionExceedsDurableBound("x".repeat(900_001))).toBe(true);
    // One BMP code unit can expand to multiple UTF-8 bytes; character length
    // alone must not admit an envelope that Convex cannot store.
    const multibyte = "é".repeat(500_000);
    expect(multibyte.length).toBe(500_000);
    expect(utf8ByteLength(multibyte)).toBeGreaterThan(900_000);
    expect(projectionExceedsDurableBound(multibyte)).toBe(true);
  });

  it("compacts when the update log crosses size, count, or idle", () => {
    expect(
      shouldCompactRoom({ uncompactedBytes: 256 * 1024, updateCount: 1 }),
    ).toBe(true);
    expect(shouldCompactRoom({ uncompactedBytes: 10, updateCount: 200 })).toBe(
      true,
    );
    expect(
      shouldCompactRoom({
        uncompactedBytes: 80,
        updateCount: 3,
        lastSnapshotAt: 1,
        now: 1 + 60_000,
      }),
    ).toBe(true);
    expect(
      shouldCompactRoom({
        uncompactedBytes: 80,
        updateCount: 3,
        lastSnapshotAt: 1_000,
        now: 1_500,
      }),
    ).toBe(false);
  });
});

describe("collaboration bridge verify precision", () => {
  it("emits distinct verify failure codes instead of a single INVALID", async () => {
    const { readFileSync } = await import("node:fs");
    const bridge = readFileSync("convex/collaborationGatewayBridge.ts", "utf8");
    expect(bridge).toContain("COLLABORATION_BRIDGE_EXPIRED");
    expect(bridge).toContain("COLLABORATION_BRIDGE_NONCE_INVALID");
    expect(bridge).toContain("COLLABORATION_BRIDGE_PAYLOAD_TOO_LARGE");
    expect(bridge).toContain("COLLABORATION_BRIDGE_FORBIDDEN");
    // Legacy umbrella must not be the only verify throw.
    const verifyBlock = bridge.slice(
      bridge.indexOf("function verify("),
      bridge.indexOf("function objectPayload("),
    );
    expect(verifyBlock).not.toMatch(
      /throw new Error\("COLLABORATION_BRIDGE_INVALID"\)/,
    );
  });

  it("keeps the complete bootstrap projection for verified payload storage", async () => {
    const { readFileSync } = await import("node:fs");
    const gateway = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
    expect(gateway).toContain("bootstrapPayload.projectionJson = projectionJson");
    expect(gateway).toContain("onLoadDocument:bootstrap");
    expect(gateway).not.toContain("omitting oversized projection");
    const transport = readFileSync("scripts/collaboration-gateway-bridge-client.mjs", "utf8");
    expect(transport).toContain("spectraContentRef");
    expect(transport).toContain("COLLABORATION_BRIDGE_ENVELOPE_SIZE");
    const bridge = readFileSync("convex/collaborationGatewayBridge.ts", "utf8");
    expect(bridge).toContain("optionalProjectionText");
    expect(bridge).toContain("projectionPayloadRef");
  });
});
