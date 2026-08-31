import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { COLLAB_RECONNECT } from "../collaboration/reconnect-backoff";
import { createCheckpointScheduler } from "../../../../scripts/collaboration-checkpoint.mjs";
import {
  gatewayHealthPayload,
  isGatewayHealthBody,
} from "../../../../scripts/collaboration-health.mjs";
import { collaborationPath } from "../../../../scripts/collaboration-proxy-path.mjs";
import {
  MAX_DURABLE_UPDATE_BYTES,
  MAX_REALTIME_MESSAGE_BYTES,
  canonicalDurableUpdate,
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
