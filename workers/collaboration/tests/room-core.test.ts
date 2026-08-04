import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { drainProjectionOutbox } from "../src/projection-outbox";
import { COLLABORATION_PROTOCOL_VERSION, roomName, type ConnectionClaims } from "../src/protocol";
import { RealtimeRoomCore } from "../src/room-core";
import { CollaborationRoom } from "../src/room";
import { MemoryYDocStore } from "../src/ydoc-store";

function claims(clientId: string, access: "read_only" | "edit" = "edit"): ConnectionClaims {
  return {
    workId: "work-1",
    roomId: "room-1",
    actor: {
      accountId: `account-${clientId}`,
      clientId,
      actorKind: "human",
      displayName: clientId,
    },
    access,
    capabilities: access === "edit" ? ["view", "edit"] : ["view"],
    permissionEpoch: 4,
    protocolVersion: COLLABORATION_PROTOCOL_VERSION,
    expiresAt: Date.now() + 60_000,
  };
}

function updateWithText(value: string) {
  const document = new Y.Doc();
  document.getText("body").insert(0, value);
  return Y.encodeStateAsUpdate(document);
}

describe("Cloudflare realtime room core", () => {
  it("synchronizes two, five, and many clients without waiting for projection", async () => {
    for (const count of [2, 5, 12]) {
      const store = new MemoryYDocStore();
      const room = new RealtimeRoomCore(store);
      await room.load();
      const inboxes = Array.from({ length: count }, () => [] as unknown[]);
      for (let index = 0; index < count; index += 1)
        room.connect({
          claims: claims(`client-${index}`),
          send: (event) => inboxes[index].push(event),
        });
      await room.applyUpdate("client-0", updateWithText(`room-${count}`));
      expect(inboxes.slice(1).every((inbox) => inbox.some((event) => (event as { type?: string }).type === "sync_update"))).toBe(true);
      expect(room.document.getText("body").toString()).toBe(`room-${count}`);
      expect(store.outbox.size).toBe(1);
    }
  });

  it("replays cold updates and compacts only through the snapshot boundary", async () => {
    const store = new MemoryYDocStore();
    const first = new RealtimeRoomCore(store, { compactEvery: 2 });
    await first.load();
    first.connect({ claims: claims("writer"), send: vi.fn() });
    await first.applyUpdate("writer", updateWithText("A"));
    await first.applyUpdate("writer", updateWithText("B"));
    expect(store.snapshots).toHaveLength(1);
    expect(store.updates).toHaveLength(0);
    const cold = new RealtimeRoomCore(store);
    await cold.load();
    expect(cold.document.getText("body").toString()).toContain("A");
    expect(cold.document.getText("body").toString()).toContain("B");
  });

  it("broadcasts an accepted update before durable persistence resolves", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    class SlowStore extends MemoryYDocStore {
      override async appendUpdate(update: Parameters<MemoryYDocStore["appendUpdate"]>[0]) {
        await gate;
        return super.appendUpdate(update);
      }
    }
    const store = new SlowStore();
    const room = new RealtimeRoomCore(store);
    await room.load();
    const received: unknown[] = [];
    room.connect({ claims: claims("writer"), send: vi.fn() });
    room.connect({ claims: claims("peer"), send: (event) => received.push(event) });
    const pending = room.applyUpdate("writer", updateWithText("now"));
    await Promise.resolve();
    expect(received.some((event) => (event as { type?: string }).type === "sync_update")).toBe(true);
    release();
    await pending;
  });

  it("keeps local and peer state after a durable append failure", async () => {
    class FailingStore extends MemoryYDocStore {
      override async appendUpdate(): Promise<number> {
        throw new Error("sqlite unavailable");
      }
    }
    const room = new RealtimeRoomCore(new FailingStore());
    await room.load();
    const peerEvents: unknown[] = [];
    room.connect({ claims: claims("writer"), send: vi.fn() });
    room.connect({ claims: claims("peer"), send: (event) => peerEvents.push(event) });
    await expect(room.applyUpdate("writer", updateWithText("safe"))).rejects.toThrow(/sqlite/);
    expect(room.document.getText("body").toString()).toBe("safe");
    expect(peerEvents.some((event) => (event as { type?: string }).type === "sync_update")).toBe(true);
  });

  it("enforces read-only access, permission epoch, update bounds, and protocol", async () => {
    const room = new RealtimeRoomCore(new MemoryYDocStore(), { permissionEpoch: 4 });
    await room.load();
    room.connect({ claims: claims("reader", "read_only"), send: vi.fn() });
    await expect(room.applyUpdate("reader", updateWithText("x"))).rejects.toThrow(/READ_ONLY/);
    room.connect({ claims: { ...claims("stale"), permissionEpoch: 3 }, send: vi.fn() });
    await expect(room.applyUpdate("stale", updateWithText("x"))).rejects.toThrow(/EPOCH/);
    room.connect({ claims: claims("large"), send: vi.fn() });
    await expect(room.applyUpdate("large", new Uint8Array(1_048_577))).rejects.toThrow(/TOO_LARGE/);
    expect(() => room.connect({ claims: { ...claims("future"), protocolVersion: 99 }, send: vi.fn() })).toThrow(/PROTOCOL/);
    const revoked = vi.fn();
    room.connect({ claims: claims("revoked"), send: revoked });
    room.setPermissionEpoch(5);
    expect(revoked).toHaveBeenCalledWith(
      expect.objectContaining({ type: "permission_revoked", permissionEpoch: 5 }),
    );
  });

  it("enforces update and awareness frequency bounds", async () => {
    const room = new RealtimeRoomCore(new MemoryYDocStore());
    await room.load();
    room.connect({ claims: claims("rapid"), send: vi.fn() });
    for (let index = 0; index < 60; index += 1)
      room.updateAwareness("rapid", { index }, index + 1, 100);
    expect(() => room.updateAwareness("rapid", { index: 61 }, 61, 100)).toThrow(/RATE/);
  });

  it("expires awareness and releases leases on disconnect", async () => {
    const room = new RealtimeRoomCore(new MemoryYDocStore());
    await room.load();
    room.connect({ claims: claims("a"), send: vi.fn() });
    room.connect({ claims: claims("b"), send: vi.fn() });
    expect(room.updateAwareness("a", { target: "block-1" }, 1, 100)).toBe(true);
    expect(room.awareness.list(101)).toHaveLength(1);
    expect(room.awareness.list(30_101)).toHaveLength(0);
    const first = room.acquireLease("a", {
      id: "lease-a",
      target: "dropdown:status",
      scope: "control",
      owner: claims("a").actor,
      acquiredAt: 100,
      expiresAt: 10_000,
      releaseCondition: "close",
      sequence: 1,
    }, 100);
    expect(first.ok).toBe(true);
    const conflict = room.acquireLease("b", {
      id: "lease-b",
      target: "dropdown:status",
      scope: "control",
      owner: claims("b").actor,
      acquiredAt: 101,
      expiresAt: 10_000,
      releaseCondition: "close",
      sequence: 1,
    }, 101);
    expect(conflict.ok).toBe(false);
    room.disconnect("a");
    expect(room.leases.list(102)).toHaveLength(0);
  });

  it("queues structural conflicts and resumes the next claim", async () => {
    const room = new RealtimeRoomCore(new MemoryYDocStore());
    await room.load();
    room.connect({ claims: claims("a"), send: vi.fn() });
    room.connect({ claims: claims("b"), send: vi.fn() });
    const base = { target: "slides:order", acquiredAt: 1, expiresAt: 10_000 };
    expect(room.acquireClaim("a", { ...base, id: "one", owner: claims("a").actor, state: "active" }, 1).state).toBe("active");
    expect(room.acquireClaim("b", { ...base, id: "two", owner: claims("b").actor, state: "active" }, 1).state).toBe("queued");
    expect(room.releaseClaim("a", "one")?.id).toBe("two");
  });

  it("retries projection idempotently with backoff", async () => {
    const store = new MemoryYDocStore();
    await store.enqueueProjection({ id: "p1", sequenceFrom: 1, sequenceTo: 1, projectionKind: "work", attempts: 0, nextAttemptAt: 10, status: "pending" });
    await store.enqueueProjection({ id: "p1", sequenceFrom: 1, sequenceTo: 1, projectionKind: "work", attempts: 0, nextAttemptAt: 10, status: "pending" });
    expect(store.outbox.size).toBe(1);
    await drainProjectionOutbox(store, async () => { throw new Error("offline"); }, 10);
    expect(store.outbox.get("p1")).toMatchObject({ attempts: 1, status: "pending", nextAttemptAt: 2_010 });
    await drainProjectionOutbox(store, async () => undefined, 2_010);
    expect(store.outbox.get("p1")?.status).toBe("completed");
  });

  it("uses stable room identity with optional future partitioning", () => {
    expect(roomName("work-1")).toBe("work:work-1");
    expect(roomName("work-1", "sheet-2")).toBe("work:work-1:sheet-2");
    expect(() => roomName("bad:id")).toThrow();
  });

  it("rehydrates hibernating sockets from serialized attachments", async () => {
    const socket = {
      deserializeAttachment: () => ({
        claims: claims("hibernating"),
        activeLeaseIds: [],
        lastAwarenessSequence: 4,
      }),
      send: vi.fn(),
    };
    let ready = Promise.resolve();
    const state = {
      storage: {
        sql: { exec: vi.fn(() => []) },
        setAlarm: vi.fn(async () => undefined),
        getAlarm: vi.fn(async () => null),
      },
      blockConcurrencyWhile: vi.fn((callback: () => Promise<unknown>) => {
        ready = callback().then(() => undefined);
        return ready;
      }),
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => [socket]),
    };
    new CollaborationRoom(
      state as unknown as DurableObjectState,
      { SPECTRA_COLLAB_TOKEN_SECRET: "x".repeat(32) },
    );
    await ready;
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining("sync_snapshot"));
  });
});
