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

const LIVE_META = "spectra:work-v2:live-meta";

type AdmissionFixture = {
  transport: HocuspocusArtifactTransport;
  server: Server;
  serverDocument: () => Y.Doc | undefined;
  authoredBeforeAdmission: Uint8Array[];
  authoredAfterAdmission: Uint8Array[];
  recoveryRequests: Array<Record<string, unknown>>;
  cleanup: () => Promise<void>;
};

// Uses the real transport/provider/server handshake. `admit` decides whether
// the fixture gateway answers a recovery request with an admitted vector.
async function startFixture(native: Y.Doc, draft: (document: Y.Doc) => void, admit: boolean): Promise<AdmissionFixture> {
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
  Y.applyUpdate(native, Y.encodeStateAsUpdate(base));
  const transport = new HocuspocusArtifactTransport("s11-offline-native", "root", 4);
  transport.document.clientID = 20;
  Y.applyUpdate(transport.document, Y.encodeStateAsUpdate(base));
  draft(transport.document);
  transport.markLocalRecoveryPending();
  const source = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
  const parser = source.slice(source.indexOf("function extractYjsUpdate("), source.indexOf("async function refreshAuthorization("));
  const extract = new Function("decoding", "messageYjsSyncStep2", "messageYjsUpdate", `${parser}; return extractYjsUpdate;`)(
    decoding, messageYjsSyncStep2, messageYjsUpdate) as (frame: Uint8Array) => Uint8Array | null;
  const authoredBeforeAdmission: Uint8Array[] = [];
  const authoredAfterAdmission: Uint8Array[] = [];
  const recoveryRequests: Array<Record<string, unknown>> = [];
  const authenticated = new WeakSet<object>();
  let admitted = false;
  let loaded: Y.Doc | undefined;
  const server = new Server({ port: 0, address: "127.0.0.1", quiet: true, stopOnSignals: false,
    websocketOptions: { maxPayload: FRAME_BYTES, handleProtocols: selectFrameProtocol },
    async onAuthenticate({ request }) { authenticated.add(request); return {}; },
    async onLoadDocument({ document }) { loaded = document; Y.applyUpdate(document, Y.encodeStateAsUpdate(native)); },
    async beforeHandleMessage({ document, update: frame }) {
      const update = extract(frame);
      const authored = update && canonicalDurableUpdate(Y, document, update);
      if (authored) (admitted ? authoredAfterAdmission : authoredBeforeAdmission).push(authored);
    },
    async onStateless({ payload, connection, document }) {
      const request = JSON.parse(payload);
      if (request.type !== "spectra.recovery_request") return;
      recoveryRequests.push(request);
      // Without an admission response an offline/native conflict still needs
      // review; an ordinary sync acknowledgement must not bypass this gate.
      if (!admit) return;
      admitted = true;
      connection.sendStateless(JSON.stringify({ type: "spectra.recovery_vector", confirmationId: request.confirmationId,
        admitted: true, stateVector: Buffer.from(Y.encodeStateVector(document)).toString("base64") }));
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
  return { transport, server, serverDocument: () => loaded, authoredBeforeAdmission, authoredAfterAdmission, recoveryRequests,
    cleanup: async () => { transport.destroy(); await server.destroy(); base.destroy(); } };
}

it("quarantines a newly discovered offline/native overlap before the initial provider handshake applies it", async () => {
  const native = new Y.Doc(); native.clientID = 30;
  const fixture = await startFixture(native, document => document.getMap(LIVE_META).set("title", "Offline title"), false);
  native.getMap(LIVE_META).set("title", "Native title");
  try {
    await fixture.transport.connect();
    await expect.poll(() => fixture.recoveryRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect.soft(fixture.authoredBeforeAdmission).toHaveLength(0);
    expect.soft(nativeArtifactProjection(fixture.transport.document, 4)?.title).toBe("Offline title");
    expect(fixture.transport.getSnapshot().unsynchronizedChanges).toBeGreaterThan(0);
    // The request carries the draft's authored scope, not the room's current head.
    expect(fixture.recoveryRequests[0]).toMatchObject({ recoveryAnchor: null, regionIds: ["artifact:structure"] });
  } finally {
    await fixture.cleanup(); native.destroy();
  }
}, 20_000);

it("uploads an admitted draft once, merges disjoint native state and lets later edits flow", async () => {
  const native = new Y.Doc(); native.clientID = 30;
  const fixture = await startFixture(native, document => document.getMap(LIVE_META).set("title", "Offline title"), true);
  try {
    // A disjoint native change that the room already holds when the draft reconnects.
    native.getMap(LIVE_META).set("summary", "Native summary");
    await fixture.transport.connect();
    await expect.poll(() => fixture.authoredAfterAdmission.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(fixture.authoredBeforeAdmission).toHaveLength(0);
    await expect.poll(() => nativeArtifactProjection(fixture.transport.document, 4)?.summary, { timeout: 10_000 }).toBe("Native summary");
    expect(nativeArtifactProjection(fixture.transport.document, 4)?.title).toBe("Offline title");
    await expect.poll(() => fixture.serverDocument()?.getMap(LIVE_META).get("title"), { timeout: 10_000 }).toBe("Offline title");
    // After admission the quarantine is open: an ordinary later edit reaches the room.
    fixture.transport.transact("metadata:tags", () => fixture.transport.document.getMap(LIVE_META).set("tags", ["later"]));
    await expect.poll(() => fixture.serverDocument()?.getMap(LIVE_META).get("tags"), { timeout: 10_000 }).toEqual(["later"]);
  } finally {
    await fixture.cleanup(); native.destroy();
  }
}, 20_000);
