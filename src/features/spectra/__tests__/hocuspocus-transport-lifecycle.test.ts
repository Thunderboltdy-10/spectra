// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hocuspocus = vi.hoisted(() => ({
  callbacks: null as null | {
    onStateless: (event: { payload: string }) => void;
    onSynced: (event: { state: boolean }) => void;
    onUnsyncedChanges: (event: { number: number }) => void;
    onAuthenticationFailed: (event: { reason: string }) => void;
    onDisconnect: (event: { event: { code: number; reason: string } }) => void;
  },
  provider: null as null | {
    attach: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    forceSync: ReturnType<typeof vi.fn>;
    flushPendingUpdates: ReturnType<typeof vi.fn>;
    hasUnsyncedChanges: boolean;
    synced: boolean;
  },
  websocket: null as null | {
    connect: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProviderWebsocket: class MockHocuspocusProviderWebsocket {
    connect = vi.fn(async () => undefined);
    destroy = vi.fn();
    disconnect = vi.fn();

    constructor() {
      hocuspocus.websocket = this;
    }
  },
  HocuspocusProvider: class MockHocuspocusProvider {
    synced = false;
    hasUnsyncedChanges = false;
    attach = vi.fn();
    destroy = vi.fn();
    forceSync = vi.fn();
    flushPendingUpdates = vi.fn();
    setAwarenessField = vi.fn();

    constructor(callbacks: NonNullable<typeof hocuspocus.callbacks>) {
      hocuspocus.provider = this;
      hocuspocus.callbacks = callbacks;
    }
  },
}));

import { HocuspocusArtifactTransport } from "../collaboration/hocuspocus-transport";

describe("P5.I2 Hocuspocus transport lifecycle", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    hocuspocus.provider = null;
    hocuspocus.websocket = null;
    hocuspocus.callbacks = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            token: "signed-session",
            documentName: "artifact:root",
            provider: "self_hosted_yjs",
            url: "ws://localhost:3000/_spectra/realtime",
            expiresInMs: 60_000,
            level: "modify",
            accountId: "account-a",
            displayName: "Account A",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the document provider and owns the external socket lifecycle", async () => {
    const transport = new HocuspocusArtifactTransport("artifact-a");
    await transport.connect();

    expect(hocuspocus.provider?.attach).toHaveBeenCalledOnce();

    transport.disconnect();
    expect(hocuspocus.websocket?.disconnect).toHaveBeenCalledOnce();

    if (hocuspocus.provider) hocuspocus.provider.synced = true;
    await transport.retry();
    expect(hocuspocus.websocket?.connect).toHaveBeenCalledTimes(2);
    expect(hocuspocus.provider?.forceSync).toHaveBeenCalledOnce();
    expect(hocuspocus.provider?.flushPendingUpdates).toHaveBeenCalledTimes(2);

    transport.destroy();
    expect(hocuspocus.provider?.destroy).toHaveBeenCalledOnce();
    expect(hocuspocus.websocket?.destroy).toHaveBeenCalledOnce();
  });

  it("issues one collaboration token while two connects overlap", async () => {
    const first = new HocuspocusArtifactTransport("artifact-shared");
    const second = new HocuspocusArtifactTransport("artifact-shared");
    await Promise.all([first.connect(), second.connect()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    first.destroy();
    second.destroy();
  });

  it("keeps sync and flush pending until the gateway durably acknowledges a local edit", async () => {
    const transport = new HocuspocusArtifactTransport("artifact-durable");
    await transport.connect();
    if (!hocuspocus.provider || !hocuspocus.callbacks)
      throw new Error("HOCUSPOCUS_MOCK_NOT_READY");
    hocuspocus.provider.synced = true;
    hocuspocus.callbacks.onSynced({ state: true });
    hocuspocus.callbacks.onUnsyncedChanges({ number: 0 });

    transport.transact("sheet-1:A1", () => {
      transport.document.getMap("sheet").set("A1", "RCV1-ACK");
    });
    expect(transport.getSyncSnapshot()).toMatchObject({
      state: "synchronizing",
      unsynchronizedChanges: 1,
    });

    let settled = false;
    const flushed = transport.flush().then(() => {
      settled = true;
    });
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(settled).toBe(false);

    hocuspocus.callbacks.onStateless({
      payload: JSON.stringify({
        type: "spectra.durable_pending",
        updateIds: ["dense-sheet-client:update-1"],
      }),
    });
    expect(transport.getSyncSnapshot().unsynchronizedChanges).toBeGreaterThan(0);
    await Promise.resolve();
    expect(settled).toBe(false);

    hocuspocus.callbacks.onStateless({
      payload: JSON.stringify({
        type: "spectra.durable_ack",
        updateIds: ["dense-sheet-client:update-1"],
      }),
    });
    await flushed;
    expect(transport.getSyncSnapshot()).toMatchObject({
      state: "synchronized",
      unsynchronizedChanges: 0,
    });
    transport.destroy();
  });

  it("applies a live read level from a permission change without clearing access", async () => {
    const transport = new HocuspocusArtifactTransport("artifact-share");
    await transport.connect();
    if (!hocuspocus.callbacks) throw new Error("HOCUSPOCUS_MOCK_NOT_READY");
    expect(transport.getSyncSnapshot().level).toBe("modify");

    vi.mocked(fetch).mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            token: "read-session",
            documentName: "artifact:root",
            provider: "self_hosted_yjs",
            url: "ws://localhost:3000/_spectra/realtime",
            expiresInMs: 60_000,
            level: "read",
            accountId: "account-b",
            displayName: "Account B",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    hocuspocus.callbacks.onStateless({
      payload: JSON.stringify({ type: "spectra.permission_changed" }),
    });
    await vi.waitFor(() => {
      expect(transport.getSyncSnapshot().level).toBe("read");
    });
    expect(transport.getSyncSnapshot().state).not.toBe("permission_lost");
    transport.destroy();
  });

  it("reconnects through a generic Hocuspocus permission denial after a gateway restart", async () => {
    const transport = new HocuspocusArtifactTransport("artifact-restart");
    await transport.connect();
    if (!hocuspocus.callbacks) throw new Error("HOCUSPOCUS_MOCK_NOT_READY");
    hocuspocus.callbacks.onAuthenticationFailed({
      reason: "Permission denied",
    });
    expect(transport.getSyncSnapshot().state).toBe("reconnecting");
    hocuspocus.callbacks.onDisconnect({
      event: { code: 4403, reason: "Access or permissions changed" },
    });
    expect(transport.getSyncSnapshot().state).toBe("reconnecting");
    expect(transport.getSyncSnapshot().level).toBe("modify");
    transport.destroy();
  });

  it("closes the room only for an explicit Spectra access revoke", async () => {
    const transport = new HocuspocusArtifactTransport("artifact-revoked");
    await transport.connect();
    if (!hocuspocus.callbacks) throw new Error("HOCUSPOCUS_MOCK_NOT_READY");
    hocuspocus.callbacks.onAuthenticationFailed({
      reason: "COLLABORATION_ACCESS_REVOKED",
    });
    expect(transport.getSyncSnapshot()).toMatchObject({
      state: "permission_lost",
      error: "COLLABORATION_ACCESS_REVOKED",
    });
    transport.destroy();
  });
});
