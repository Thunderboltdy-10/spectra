import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { COLLAB_RECONNECT } from "../collaboration/reconnect-backoff";
import { createCheckpointScheduler } from "../../../../scripts/collaboration-checkpoint.mjs";
import { gatewayHealthPayload, isGatewayHealthBody } from "../../../../scripts/collaboration-health.mjs";
import { collaborationPath } from "../../../../scripts/collaboration-proxy-path.mjs";
import {
  COLLAB_RECONNECT as gatewayReconnect,
  reconnectDelayMs,
} from "../../../../scripts/collaboration-reconnect.mjs";
import {
  applyStoredRoomUpdates,
  shouldCompactRoom,
} from "../../../../scripts/collaboration-room-state.mjs";

describe("P5.I2 gateway production helpers", () => {
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
      lastPersistenceFailure: { code: "COLLABORATION_APPEND_FAILED", at: 1, attempt: 2 },
      startedAt: 10,
      now: 25,
    });
    expect(degraded.status).toBe("degraded");
    expect(degraded.service).toBe("spectra-collaboration-gateway");
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
