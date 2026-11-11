// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import * as Y from "yjs";
import { encodeDurableFrontier } from "../../../../shared/collaboration-durable-frontier.mjs";

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
    documentUpdateHandler: ReturnType<typeof vi.fn>;
    sendStateless: ReturnType<typeof vi.fn>;
    flushPendingUpdates: ReturnType<typeof vi.fn>;
    hasUnsyncedChanges: boolean;
    synced: boolean;
  },
  /** The gateway's durable canonical state, answered to spectra.recovery_current. */
  canonical: null as null | { updateBase64: string; anchor: { roomId: string; nextSequence: number; frontierHash: string } },
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
    documentUpdateHandler = vi.fn();
    sendStateless = vi.fn((payload: string) => {
      const request = JSON.parse(payload);
      if (request.type === "spectra.recovery_request") hocuspocus.callbacks?.onStateless({ payload: JSON.stringify({
        type: "spectra.recovery_vector", confirmationId: request.confirmationId, admitted: true, stateVector: "AA==",
      }) });
      if (request.type === "spectra.recovery_current" && hocuspocus.canonical) queueMicrotask(() =>
        hocuspocus.callbacks?.onStateless({ payload: JSON.stringify({
          type: "spectra.recovery_current", confirmationId: request.confirmationId, ...hocuspocus.canonical,
        }) }));
    });
    flushPendingUpdates = vi.fn();
    setAwarenessField = vi.fn();

    constructor(callbacks: NonNullable<typeof hocuspocus.callbacks>) {
      hocuspocus.provider = this;
      hocuspocus.callbacks = callbacks;
    }
  },
}));

import { HocuspocusArtifactTransport } from "../collaboration/hocuspocus-transport";
import { bindAccountStorageScope } from "@/lib/account-storage";
import { persistBridgeSession } from "../bridge/client";
import { rememberCommittedPerformance } from "../collaboration/committed-performances";
import { performancePatches } from "../collaboration/performance";
import { initializeNativeArtifactDocument } from "../../../../scripts/collaboration-native-projection.mjs";

describe("P5.I2 Hocuspocus transport lifecycle", () => {
  it("never seeds old-account native artifact after its transport is destroyed during a late cloud session", async () => {
    bindAccountStorageScope("deployment/account-A");
    persistBridgeSession("session-A");
    let finish!: (response: Response) => void;
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/spectra/collaboration/token") return new Promise<Response>(resolve => { finish = resolve; });
      const method = JSON.parse(String(init?.body)).method;
      return Promise.resolve(Response.json({ result: method === "summary" ? { storeId: "old-shared-store", works: 0 } : { seeded: true } }));
    });
    vi.stubGlobal("fetch", fetcher);
    const transport = new HocuspocusArtifactTransport("private-account-a-work");
    const connecting = transport.connect();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    transport.destroy();
    bindAccountStorageScope("deployment/account-B");
    persistBridgeSession("session-B");
    finish(Response.json({ token: "cloud-session-A", documentName: "artifact:root", provider: "self_hosted_yjs", url: "ws://fixture", expiresInMs: 60_000, level: "modify", accountId: "account-A", device: { storeId: "old-shared-store", seed: { typeKey: "document", title: "A private artifact", tags: [], schemaVersion: 1, content: { blocks: [] } } } }));
    await connecting;
    expect(fetcher.mock.calls.filter(([url]) => url.includes("/v1/works/call"))).toHaveLength(0);
  });
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    window.sessionStorage.clear();
    hocuspocus.provider = null;
    hocuspocus.websocket = null;
    hocuspocus.callbacks = null;
    hocuspocus.canonical = null;
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

  it("plays the acknowledged creation when its document arrives after the event", async () => {
    const before = { title: "Revision", tags: [], content: { blocks: [] } };
    const after = { ...before, content: { blocks: [{ id: "intro", type: "paragraph", text: "Review vectors." }] } };
    rememberCommittedPerformance({ v: 1, id: "transport-creation", artifactId: "new-work", runId: "run", operationId: "op",
      typeKey: "document", actor: { clientId: "ai-new", kind: "ai", name: "Spectra" }, regionIds: ["artifact:structure"],
      startAt: Date.now() - 30_000, estimateMs: 1_000, seed: 1, tempo: 1, ...performancePatches(before, after) }, Date.now());
    const transport = new HocuspocusArtifactTransport("new-work");
    await transport.connect();
    expect(transport.getSnapshot().presence).toEqual([]);
    initializeNativeArtifactDocument(transport.document, { ...after, typeKey: "document", schemaVersion: 4 });
    expect(transport.getSnapshot().presence).toContainEqual(expect.objectContaining({ actorKind: "ai", clientId: "ai-new", previewPhase: "streaming" }));
    transport.destroy();
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
    expect(transport.getSyncSnapshot().unsynchronizedChanges).toBeGreaterThan(0);
    hocuspocus.callbacks.onStateless({ payload: JSON.stringify({ type: "spectra.durable_frontier",
      frontierHash: createHash("sha256").update(encodeDurableFrontier(Y, transport.document)!).digest("hex") }) });
    await flushed;
    expect(transport.getSyncSnapshot()).toMatchObject({
      state: "synchronized",
      unsynchronizedChanges: 0,
    });
    transport.destroy();
  });

  it("replays a restored offline branch after room sync and keeps it pending until the full document is durable", async () => {
    const hashBytes = (value: Uint8Array) =>
      createHash("sha256").update(value).digest();
    vi.stubGlobal("crypto", {
      randomUUID: () => "recovery-client",
      subtle: {
        digest: async (_algorithm: string, value: BufferSource) => {
          const bytes =
            value instanceof ArrayBuffer
              ? new Uint8Array(value)
              : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          const digest = hashBytes(bytes);
          return new Uint8Array(digest).buffer as ArrayBuffer;
        },
      },
    });
    const transport = new HocuspocusArtifactTransport("artifact-local-recovery");
    transport.document.getMap("recovery").set("offline-edit", "must-survive-close");
    transport.markLocalRecoveryPending();
    expect(transport.getSyncSnapshot()).toMatchObject({
      state: "synchronizing",
      unsynchronizedChanges: 1,
    });

    await transport.connect();
    if (!hocuspocus.provider || !hocuspocus.callbacks)
      throw new Error("HOCUSPOCUS_MOCK_NOT_READY");
    expect(hocuspocus.provider.documentUpdateHandler).not.toHaveBeenCalled();
    hocuspocus.provider.synced = true;
    hocuspocus.callbacks.onSynced({ state: true });
    expect(hocuspocus.provider.documentUpdateHandler).toHaveBeenCalledOnce();
    expect(hocuspocus.provider.flushPendingUpdates).toHaveBeenCalled();
    expect(transport.getSyncSnapshot().unsynchronizedChanges).toBeGreaterThan(0);

    hocuspocus.callbacks.onStateless({
      payload: JSON.stringify({
        type: "spectra.durable_ack",
        documentHash: "0".repeat(64),
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(transport.getSyncSnapshot().unsynchronizedChanges).toBeGreaterThan(0);

    const confirmedHash = createHash("sha256")
      .update(Y.encodeStateAsUpdate(transport.document))
      .digest("hex");
    hocuspocus.callbacks.onStateless({
      payload: JSON.stringify({
        type: "spectra.durable_ack",
        documentHash: confirmedHash,
      }),
    });
    await vi.waitFor(() => {
      expect(transport.getSyncSnapshot()).toMatchObject({
        state: "synchronized",
        unsynchronizedChanges: 0,
      });
    });
    transport.destroy();
  });

  it("holds recovered edits while access is read-only and resumes after modify access returns", async () => {
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
            accountId: "account-a",
            displayName: "Account A",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const transport = new HocuspocusArtifactTransport("artifact-read-recovery");
    transport.document.getMap("recovery").set("offline-edit", "preserve-me");
    transport.markLocalRecoveryPending();
    await transport.connect();
    if (!hocuspocus.provider || !hocuspocus.callbacks)
      throw new Error("HOCUSPOCUS_MOCK_NOT_READY");
    hocuspocus.provider.synced = true;
    hocuspocus.callbacks.onSynced({ state: true });
    expect(hocuspocus.provider.documentUpdateHandler).not.toHaveBeenCalled();
    expect(transport.getSyncSnapshot()).toMatchObject({
      state: "unsynchronized",
      level: "read",
      unsynchronizedChanges: 1,
      error: "Your locally saved edit needs modify access before it can sync.",
    });

    hocuspocus.callbacks.onStateless({
      payload: JSON.stringify({ type: "spectra.permission_changed" }),
    });
    await vi.waitFor(() => {
      expect(hocuspocus.provider?.documentUpdateHandler).toHaveBeenCalledOnce();
    });
    expect(transport.getSyncSnapshot().unsynchronizedChanges).toBeGreaterThan(0);
    transport.destroy();
  });

  it("confirms recovered updates without another full snapshot and keeps a later edit pending", async () => {
    const transport = new HocuspocusArtifactTransport("artifact-confirm-recovery");
    transport.document.getMap("recovery").set("draft", "offline");
    transport.markLocalRecoveryPending();
    await transport.connect();
    const provider = hocuspocus.provider!;
    const callbacks = hocuspocus.callbacks!;
    provider.synced = true;
    callbacks.onSynced({ state: true });
    const request = provider.sendStateless.mock.calls.map(call => JSON.parse(call[0])).find(value => value.type === "spectra.durable_confirm");
    expect(request).toMatchObject({ type: "spectra.durable_confirm" });
    expect(JSON.stringify(request).length).toBeLessThan(120);
    callbacks.onStateless({ payload: JSON.stringify({ type: "spectra.durable_ack", updateIds: [] }) });
    expect(transport.getSyncSnapshot().unsynchronizedChanges).toBeGreaterThan(0);

    transport.transact("later", () => transport.document.getMap("recovery").set("later", "new edit"));
    callbacks.onStateless({ payload: JSON.stringify({ type: "spectra.durable_ack", confirmationId: request.confirmationId }) });
    expect(transport.getSyncSnapshot().unsynchronizedChanges).toBeGreaterThan(0);
    callbacks.onStateless({ payload: JSON.stringify({ type: "spectra.durable_pending", updateIds: ["later"] }) });
    callbacks.onStateless({ payload: JSON.stringify({ type: "spectra.durable_ack", updateIds: ["later"] }) });
    expect(transport.getSyncSnapshot().unsynchronizedChanges).toBeGreaterThan(0);
    callbacks.onStateless({ payload: JSON.stringify({ type: "spectra.durable_frontier",
      frontierHash: createHash("sha256").update(encodeDurableFrontier(Y, transport.document)!).digest("hex") }) });
    await vi.waitFor(() => expect(transport.getSyncSnapshot()).toMatchObject({ state: "synchronized", unsynchronizedChanges: 0 }));
    expect(provider.documentUpdateHandler).toHaveBeenCalledOnce();
    transport.destroy();
  });

  it("ignores a recovery confirmation from before reconnect", async () => {
    const transport = new HocuspocusArtifactTransport("artifact-confirm-reconnect");
    transport.document.getMap("recovery").set("draft", "offline");
    transport.markLocalRecoveryPending();
    await transport.connect();
    const provider = hocuspocus.provider!;
    const callbacks = hocuspocus.callbacks!;
    provider.synced = true;
    callbacks.onSynced({ state: true });
    const first = provider.sendStateless.mock.calls.map(call => JSON.parse(call[0])).find(value => value.type === "spectra.durable_confirm");
    callbacks.onDisconnect({ event: { code: 1006, reason: "restart" } });
    // A pending branch never reuses the old provider replica: the next
    // handshake runs on a fresh provider and must be admitted again.
    await Promise.resolve();
    expect(provider.destroy).toHaveBeenCalledOnce();
    await transport.retry();
    const reconnected = hocuspocus.provider!;
    const reconnectedCallbacks = hocuspocus.callbacks!;
    expect(reconnected).not.toBe(provider);
    reconnected.synced = true;
    reconnectedCallbacks.onSynced({ state: true });
    const second = reconnected.sendStateless.mock.calls.map(call => JSON.parse(call[0])).filter(value => value.type === "spectra.durable_confirm").at(-1);
    expect(second.confirmationId).not.toBe(first.confirmationId);
    callbacks.onStateless({ payload: JSON.stringify({ type: "spectra.durable_ack", confirmationId: first.confirmationId }) });
    reconnectedCallbacks.onStateless({ payload: JSON.stringify({ type: "spectra.durable_ack", confirmationId: first.confirmationId }) });
    expect(transport.getSyncSnapshot().unsynchronizedChanges).toBeGreaterThan(0);
    reconnectedCallbacks.onStateless({ payload: JSON.stringify({ type: "spectra.durable_ack", confirmationId: second.confirmationId,
      frontierHash: createHash("sha256").update(encodeDurableFrontier(Y, transport.document)!).digest("hex") }) });
    await vi.waitFor(() => expect(transport.getSyncSnapshot()).toMatchObject({ state: "synchronized", unsynchronizedChanges: 0 }));
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
    expect(transport.getSyncSnapshot().level).toBeNull();
    hocuspocus.callbacks.onStateless({ payload: JSON.stringify({ type: "spectra.permission_changed" }) });
    await vi.waitFor(() => expect(transport.getSyncSnapshot().level).toBe("modify"));
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

  it("marks unsynchronized with a truthful error on durable-reject close 4409", async () => {
    const transport = new HocuspocusArtifactTransport("artifact-oversize");
    await transport.connect();
    if (!hocuspocus.callbacks || !hocuspocus.provider)
      throw new Error("HOCUSPOCUS_MOCK_NOT_READY");
    hocuspocus.provider.synced = true;
    hocuspocus.callbacks.onSynced({ state: true });
    hocuspocus.callbacks.onUnsyncedChanges({ number: 0 });
    expect(transport.getSyncSnapshot().state).toBe("synchronized");

    hocuspocus.callbacks.onStateless({
      payload: JSON.stringify({
        type: "spectra.durable_failed",
        message:
          "This edit could not be accepted. Spectra is reloading the latest permitted version while keeping the local draft available for review.",
      }),
    });
    hocuspocus.callbacks.onDisconnect({
      event: { code: 4409, reason: "COLLABORATION_GATEWAY_UPDATE_SIZE" },
    });
    expect(transport.getSyncSnapshot()).toMatchObject({
      state: "unsynchronized",
      unsynchronizedChanges: 1,
      error:
        "This edit could not be accepted. Spectra is reloading the latest permitted version while keeping the local draft available for review.",
    });
    transport.destroy();
  });

  it("consumes an admitted restore delta once, as a gateway frame, and asks for a canonical refresh", async () => {
    const transport = new HocuspocusArtifactTransport("artifact-admitted");
    await transport.connect();
    const source = new Y.Doc();
    source.getMap("meta").set("title", "Restored");
    const update = Y.encodeStateAsUpdate(source);
    source.destroy();
    const digest = createHash("sha256").update(update).digest("hex");
    const inline = { encoding: "inline" as const, updateBase64: Buffer.from(update).toString("base64") };
    const receipt = { roomId: "room", sequence: 4, updateDigest: digest };
    await expect(transport.consumeAdmittedUpdate(inline, { ...receipt, updateDigest: "0".repeat(64) }, "restore:bad")).rejects.toThrow(
      "COLLABORATION_ADMITTED_UPDATE_INVALID");
    expect(transport.document.getMap("meta").get("title")).toBeUndefined();
    await transport.consumeAdmittedUpdate(inline, receipt, "restore:one");
    expect(transport.document.getMap("meta").get("title")).toBe("Restored");
    // Provider origin: the accepted bytes are never re-sent as a local write.
    expect(hocuspocus.provider?.documentUpdateHandler).not.toHaveBeenCalled();
    const refreshes = hocuspocus.provider!.sendStateless.mock.calls.map(([payload]) => JSON.parse(payload as string))
      .filter(request => request.type === "spectra.canonical_refresh");
    expect(refreshes.map(request => request.confirmationId)).toEqual(["restore:one"]);
    transport.destroy();
  });

  async function canonicalState(title: string, nextSequence: number) {
    const canonical = new Y.Doc();
    canonical.getMap("meta").set("title", title);
    const frontier = encodeDurableFrontier(Y, canonical)!;
    const frontierHash = createHash("sha256").update(new Uint8Array(frontier)).digest("hex");
    const updateBase64 = Buffer.from(Y.encodeStateAsUpdate(canonical)).toString("base64");
    canonical.destroy();
    return { updateBase64, anchor: { roomId: "room", nextSequence, frontierHash } };
  }

  it("shows a large or compacted restore only from canonical state that covers its receipt", async () => {
    // A payload/replay receipt carries no bytes. The gateway may skip the
    // refresh merge while other edits persist, so a hint plus resync alone
    // could leave the old content on screen after "restored".
    const transport = new HocuspocusArtifactTransport("artifact-admitted-large");
    await transport.connect();
    hocuspocus.provider!.synced = true;
    hocuspocus.callbacks!.onSynced({ state: true });
    const payload = { encoding: "payload" as const, payloadRef: "payload", digest: "d".repeat(64), byteLength: 900_000 };
    const receipt = { roomId: "room", sequence: 7, updateDigest: "d".repeat(64) };
    hocuspocus.canonical = await canonicalState("Before restore", 7);
    await expect(transport.consumeAdmittedUpdate(payload, receipt, "restore:behind")).rejects.toThrow(
      "COLLABORATION_ADMITTED_UPDATE_BEHIND");
    expect(transport.document.getMap("meta").get("title")).toBeUndefined();
    hocuspocus.canonical = await canonicalState("Restored", 8);
    await transport.consumeAdmittedUpdate({ encoding: "replay", roomId: "room", throughSequence: 7 }, receipt, "restore:covered");
    expect(transport.document.getMap("meta").get("title")).toBe("Restored");
    expect(hocuspocus.provider?.documentUpdateHandler).not.toHaveBeenCalled();
    transport.destroy();
  });
});
