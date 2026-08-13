import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CloudflareRealtimeProvider } from "@/features/spectra/realtime/providers";
import { realtimeProviderForWorkType } from "@/features/spectra/realtime/providers/provider-factory";

class FakeSocket {
  static OPEN = 1;
  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();

  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(value: string) {
    this.sent.push(value);
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }

  emit(type: string, event: { data?: unknown } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function wire(value: unknown) {
  return JSON.stringify(value, (_key, entry) =>
    entry instanceof Uint8Array ? { $bytes: Array.from(entry) } : entry,
  );
}

describe("Cloudflare realtime browser provider", () => {
  it("conforms to the collaboration transport and acknowledges local updates", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const socket = new FakeSocket();
    const provider = new CloudflareRealtimeProvider({
      workId: "work-1",
      schemaVersion: 1,
      fetch: vi.fn(async () =>
        Response.json({
          token: "signed-token",
          url: "wss://collab.example",
          level: "modify",
          accountId: "account-1",
          displayName: "Pablo",
        }),
      ) as typeof fetch,
      createSocket: () => socket as unknown as WebSocket,
    });
    await provider.connect();
    socket.emit("open");
    provider.transact("document:body", () =>
      provider.document.getText("body").insert(0, "Hello"),
    );
    expect(provider.getSnapshot().unsynchronizedChanges).toBe(1);
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
      type: "sync_update",
      protocolVersion: 1,
    });
    socket.emit("message", { data: JSON.stringify({ type: "sync_ack", sequence: 1 }) });
    expect(provider.getSnapshot()).toMatchObject({
      state: "synchronized",
      unsynchronizedChanges: 0,
    });
    await provider.flush();
  });

  it("does not permit mutation through a read-only session", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const provider = new CloudflareRealtimeProvider({
      workId: "work-1",
      schemaVersion: 1,
      fetch: vi.fn(async () =>
        Response.json({ token: "signed-token", url: "wss://collab.example", level: "read" }),
      ) as typeof fetch,
      createSocket: () => new FakeSocket() as unknown as WebSocket,
    });
    await provider.connect();
    expect(() => provider.transact("body", () => undefined)).toThrow(/READ_ONLY/);
  });

  it("activates Cloudflare for native document/code work with an explicit rollback", () => {
    const previous = process.env.NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME;
    delete process.env.NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME;
    expect(realtimeProviderForWorkType("document")).toBe("cloudflare");
    expect(realtimeProviderForWorkType("code")).toBe("cloudflare");
    process.env.NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME = "false";
    expect(realtimeProviderForWorkType("document")).toBe("hocuspocus");
    if (previous === undefined)
      delete process.env.NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME;
    else process.env.NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME = previous;
  });

  it("uses the running local gateway in development unless Cloudflare is explicit", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME", "");
    expect(realtimeProviderForWorkType("document")).toBe("hocuspocus");
    vi.stubEnv("NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME", "true");
    expect(realtimeProviderForWorkType("document")).toBe("cloudflare");
  });

  it("acquires/releases leases and queues structural claims through room events", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const socket = new FakeSocket();
    const provider = new CloudflareRealtimeProvider({
      workId: "work-lease",
      schemaVersion: 2,
      fetch: vi.fn(async (_url, init) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          realtimeProvider: "cloudflare",
        });
        return Response.json({
          token: "signed-token",
          url: "wss://collab.example",
          level: "modify",
          accountId: "account-1",
          displayName: "Pablo",
        });
      }) as typeof fetch,
      createSocket: () => socket as unknown as WebSocket,
    });
    await provider.connect();
    socket.emit("open");

    const leasePromise = provider.acquireInteractionLease({
      id: "lease-1",
      target: "/slides/slide-1/objects/object-1",
      scope: "gesture",
      acquiredAt: 10,
      expiresAt: 12_010,
      releaseCondition: "pointer_up",
      sequence: 0,
    });
    const leaseFrame = JSON.parse(socket.sent.at(-1) ?? "{}");
    expect(leaseFrame).toMatchObject({ type: "lease_acquire", lease: { id: "lease-1" } });
    socket.emit("message", {
      data: wire({
        type: "lease_state",
        requestLeaseId: "lease-1",
        requesterClientId: provider.clientId,
        result: { ok: true, lease: leaseFrame.lease },
      }),
    });
    await expect(leasePromise).resolves.toMatchObject({ ok: true });

    const released = vi.fn();
    provider.subscribeLeaseReleases(released);
    socket.emit("message", {
      data: wire({
        type: "lease_released",
        leaseId: "lease-1",
        target: "/slides/slide-1/objects/object-1",
        releasedAt: 20,
        reason: "pointer_up",
      }),
    });
    expect(released).toHaveBeenCalledWith(
      expect.objectContaining({ leaseId: "lease-1", reason: "pointer_up" }),
    );

    const claimPromise = provider.acquireStructuralClaim({
      id: "claim-1",
      target: "/slides",
      acquiredAt: 20,
      expiresAt: 60_020,
    });
    const claimFrame = JSON.parse(socket.sent.at(-1) ?? "{}");
    socket.emit("message", {
      data: wire({ type: "claim_state", claim: { ...claimFrame.claim, state: "queued" } }),
    });
    await expect(claimPromise).resolves.toMatchObject({
      id: "claim-1",
      state: "queued",
    });
  });

  it("merges an offline local branch with the room snapshot by state vector", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const socket = new FakeSocket();
    const provider = new CloudflareRealtimeProvider({
      workId: "work-offline",
      schemaVersion: 2,
      fetch: vi.fn(async () =>
        Response.json({
          token: "signed-token",
          url: "wss://collab.example",
          level: "modify",
          accountId: "account-1",
          displayName: "Pablo",
        }),
      ) as typeof fetch,
      createSocket: () => socket as unknown as WebSocket,
    });
    await provider.connect();
    socket.emit("open");
    provider.transact("body", () => provider.document.getText("body").insert(0, "local"));

    const room = new Y.Doc();
    room.getText("body").insert(0, "remote-");
    socket.emit("message", {
      data: wire({ type: "sync_snapshot", update: Y.encodeStateAsUpdate(room) }),
    });
    expect(provider.document.getText("body").toString()).toContain("local");
    expect(provider.document.getText("body").toString()).toContain("remote-");
    const reconnectFrame = JSON.parse(socket.sent.at(-1) ?? "{}", (_key, entry) =>
      entry && typeof entry === "object" && Array.isArray(entry.$bytes)
        ? new Uint8Array(entry.$bytes)
        : entry,
    );
    Y.applyUpdate(room, reconnectFrame.update);
    expect(room.getText("body").toString()).toBe(
      provider.document.getText("body").toString(),
    );
  });
});
