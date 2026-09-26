import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { Server } from "@hocuspocus/server";
import WebSocket from "ws";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import { messageYjsSyncStep2, messageYjsUpdate } from "y-protocols/sync";
import { canonicalDurableUpdate } from "../../../../scripts/collaboration-update-envelope.mjs";
import { initializeNativeArtifactDocument, nativeArtifactProjection } from "../../../../scripts/collaboration-native-projection.mjs";
import { installServerFraming, selectFrameProtocol, FRAME_BYTES } from "../../../../shared/collaboration-framing.mjs";
import { HocuspocusArtifactTransport } from "../collaboration/hocuspocus-transport";

afterEach(() => vi.unstubAllGlobals());

// Uses the real transport/provider/server handshake. Recovery admission is
// deliberately held, so neither the native head nor the offline draft may be
// applied to the other branch merely because the socket synchronized.
it("quarantines a newly discovered offline/native overlap before the initial provider handshake applies it", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value) },
    setTimeout, clearTimeout, setInterval, clearInterval,
    addEventListener: () => undefined, removeEventListener: () => undefined,
  });
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("WebSocket", WebSocket);
  const base = new Y.Doc(); base.clientID = 10;
  initializeNativeArtifactDocument(base, { title: "Original", typeKey: "sheets", schemaVersion: 4,
    tags: [], content: { sheets: [] } });
  const native = new Y.Doc(); native.clientID = 30;
  Y.applyUpdate(native, Y.encodeStateAsUpdate(base));
  native.getMap("spectra:work-v2:live-meta").set("title", "Native title");
  const transport = new HocuspocusArtifactTransport("s11-offline-native", "root", 4);
  transport.document.clientID = 20;
  Y.applyUpdate(transport.document, Y.encodeStateAsUpdate(base));
  transport.document.getMap("spectra:work-v2:live-meta").set("title", "Offline title");
  transport.markLocalRecoveryPending();
  const source = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
  const parser = source.slice(source.indexOf("function extractYjsUpdate("), source.indexOf("async function refreshAuthorization("));
  const extract = new Function("decoding", "messageYjsSyncStep2", "messageYjsUpdate", `${parser}; return extractYjsUpdate;`)(
    decoding, messageYjsSyncStep2, messageYjsUpdate) as (frame: Uint8Array) => Uint8Array | null;
  const authoredBeforeAdmission: Uint8Array[] = [];
  const recoveryRequests: unknown[] = [];
  const authenticated = new WeakSet<object>();
  const server = new Server({ port: 0, address: "127.0.0.1", quiet: true, stopOnSignals: false,
    websocketOptions: { maxPayload: FRAME_BYTES, handleProtocols: selectFrameProtocol },
    async onAuthenticate({ request }) { authenticated.add(request); return {}; },
    async onLoadDocument({ document }) { Y.applyUpdate(document, Y.encodeStateAsUpdate(native)); },
    async beforeHandleMessage({ document, update: frame }) {
      const update = extract(frame);
      const authored = update && canonicalDurableUpdate(Y, document, update);
      if (authored) authoredBeforeAdmission.push(authored);
    },
    async onStateless({ payload }) {
      const request = JSON.parse(payload);
      if (request.type === "spectra.recovery_request") recoveryRequests.push(request);
      // No vector/admission response: an offline/native conflict still needs
      // review. An ordinary sync acknowledgement must not bypass this gate.
    },
  });
  installServerFraming(server, (request: object) => authenticated.has(request));
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("FIXTURE_SERVER_ADDRESS_MISSING");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    token: "fixture", documentName: "offline-native", provider: "self_hosted_yjs",
    url: `ws://127.0.0.1:${address.port}`, expiresInMs: 60_000,
    level: "modify", accountId: "fixture", displayName: "Fixture",
  }), { status: 200 })));
  try {
    await transport.connect();
    await expect.poll(() => recoveryRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect.soft(authoredBeforeAdmission).toHaveLength(0);
    expect.soft(nativeArtifactProjection(transport.document, 4)?.title).toBe("Offline title");
    expect(transport.getSnapshot().unsynchronizedChanges).toBeGreaterThan(0);
  } finally {
    transport.destroy(); await server.destroy(); base.destroy(); native.destroy();
  }
}, 20_000);
