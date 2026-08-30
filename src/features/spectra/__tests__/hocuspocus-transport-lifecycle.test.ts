// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hocuspocus = vi.hoisted(() => ({
  provider: null as null | {
    attach: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    forceSync: ReturnType<typeof vi.fn>;
    flushPendingUpdates: ReturnType<typeof vi.fn>;
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
    attach = vi.fn();
    destroy = vi.fn();
    forceSync = vi.fn();
    flushPendingUpdates = vi.fn();
    setAwarenessField = vi.fn();

    constructor() {
      hocuspocus.provider = this;
    }
  },
}));

import { HocuspocusArtifactTransport } from "../collaboration/hocuspocus-transport";

describe("P5.I2 Hocuspocus transport lifecycle", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    hocuspocus.provider = null;
    hocuspocus.websocket = null;
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
});
