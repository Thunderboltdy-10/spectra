// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { MAX_REALTIME_MESSAGE_BYTES } from "../../../../scripts/collaboration-update-envelope.mjs";
import { BoundedYjsLocalPersistence, MemoryYjsStore } from "../realtime/persistence/local-yjs-persistence";

const wire = vi.hoisted(() => ({
  callbacks: null as null | { onSynced: (event: { state: boolean }) => void; onStateless: (event: { payload: string }) => void },
  provider: null as null | { synced: boolean; documentUpdateHandler: ReturnType<typeof vi.fn>; sendStateless: ReturnType<typeof vi.fn> },
}));

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProviderWebsocket: class {
    connect = vi.fn(async () => undefined);
    destroy = vi.fn();
    disconnect = vi.fn();
  },
  HocuspocusProvider: class {
    synced = false;
    hasUnsyncedChanges = false;
    attach = vi.fn();
    destroy = vi.fn();
    forceSync = vi.fn();
    documentUpdateHandler = vi.fn();
    sendStateless = vi.fn();
    flushPendingUpdates = vi.fn();
    setAwarenessField = vi.fn();
    constructor(callbacks: NonNullable<typeof wire.callbacks>) {
      wire.callbacks = callbacks;
      wire.provider = this;
    }
  },
}));

import { HocuspocusArtifactTransport } from "../collaboration/hocuspocus-transport";

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    token: "fixture-token", documentName: "fixture:root", provider: "self_hosted_yjs",
    url: "ws://fixture.invalid", expiresInMs: 60_000, level: "modify",
    accountId: "fixture-account", displayName: "Fixture",
  }), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => vi.unstubAllGlobals());

describe("S11 independent durable recovery boundaries", () => {
  it("can resend a tiny offline edit in a room above the gateway message limit", async () => {
    const transport = new HocuspocusArtifactTransport("s11-large-offline");
    // A 1.2 MiB imported text/table body is well below the 8 MiB local-cache
    // limit. Recovery must depend on the missing delta, not total room size.
    transport.document.getText("body").insert(0, "paragraph ".repeat(125_000));
    const baseline = Y.encodeStateVector(transport.document);
    transport.document.getMap("cells").set("T10000", "offline edit");
    expect(Y.encodeStateAsUpdate(transport.document, baseline).byteLength).toBeLessThan(1024);
    transport.markLocalRecoveryPending();
    try {
      await transport.connect();
      wire.provider!.synced = true;
      wire.callbacks!.onSynced({ state: true });
      const request = wire.provider!.sendStateless.mock.calls.map(call => JSON.parse(call[0])).find(value => value.type === "spectra.recovery_request");
      expect(wire.provider!.documentUpdateHandler).not.toHaveBeenCalled();
      wire.callbacks!.onStateless({ payload: JSON.stringify({ type: "spectra.recovery_vector", admitted: true,
        confirmationId: request.confirmationId, stateVector: Buffer.from(baseline).toString("base64") }) });
      const sent = wire.provider!.documentUpdateHandler.mock.calls.map(call => call[0] as Uint8Array);
      expect(sent.length).toBeGreaterThan(0);
      // Payload alone must fit; real Hocuspocus framing consumes more bytes.
      expect(Math.max(...sent.map(update => update.byteLength))).toBeLessThan(1024);
      expect(Math.max(...sent.map(update => update.byteLength))).toBeLessThan(MAX_REALTIME_MESSAGE_BYTES);
    } finally { transport.destroy(); }
  });

  it("preserves the last offline edit when a supported large room exceeds the local snapshot cap", async () => {
    const document = new Y.Doc();
    const store = new MemoryYjsStore();
    const persistence = new BoundedYjsLocalPersistence({ key: "s11-large-local", document,
      modelVersion: 1, store, debounceMs: 60_000 });
    await persistence.initialize();
    try {
      // Imported Office projections may be tens of MiB. A local recovery
      // journal can save a small new edit without rewriting the entire base.
      document.getText("body").insert(0, "x".repeat(8 * 1024 * 1024));
      persistence.markRemoteDurable();
      document.getMap("cells").set("A1", "recover me");
      await persistence.persistNow();
      const stored = await store.get("s11-large-local");
      expect(stored, "a remotely known large base must not disable recovery of small pending edits").not.toBeNull();
      expect(stored?.pendingRemoteSync).toBe(true);
      expect(stored?.baseUpdate?.byteLength).toBeGreaterThan(8 * 1024 * 1024);
      expect(stored?.update.byteLength).toBeLessThan(1024);
      const restored = new Y.Doc();
      Y.applyUpdate(restored, Y.mergeUpdates([stored!.baseUpdate!, stored!.update]));
      expect(restored.getText("body").length).toBe(8 * 1024 * 1024);
      expect(restored.getMap("cells").get("A1")).toBe("recover me");
      restored.destroy();
    } finally { await persistence.destroy(); document.destroy(); }
  });

  it("stops automatic local-store retries after a finite failure budget", async () => {
    vi.useFakeTimers();
    const document = new Y.Doc();
    const store = new MemoryYjsStore();
    const commit = vi.spyOn(store, "commit").mockRejectedValue(new Error("device storage unavailable"));
    const persistence = new BoundedYjsLocalPersistence({ key: "s11-retry", document,
      modelVersion: 1, store, debounceMs: 1 });
    await persistence.initialize();
    try {
      document.getMap("draft").set("important", "pending");
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      const afterDay = commit.mock.calls.length;
      expect(afterDay).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(commit.mock.calls.length, "backoff alone is not a finite retry budget").toBe(afterDay);
      expect(persistence.getSnapshot().pendingRemoteSync).toBe(true);
    } finally { await persistence.destroy(); document.destroy(); vi.useRealTimers(); }
  });
});
