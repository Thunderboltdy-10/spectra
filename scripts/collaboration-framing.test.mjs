import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createMessageAssembler, frameMessage, FRAME_BYTES } from "../shared/collaboration-framing.mjs";

describe("bounded Yjs message framing", () => {
  it("reassembles the exact large Yjs update with bounded frames", () => {
    const source = new Y.Doc();
    source.getText("body").insert(0, "界".repeat(600_000));
    const update = Y.encodeStateAsUpdate(source);
    const assembler = createMessageAssembler();
    let complete;
    const frames = [...frameMessage(update)];
    for (const [index, frame] of frames.entries()) {
      expect(frame.length).toBeLessThanOrEqual(FRAME_BYTES);
      const value = assembler.accept(frame);
      if (index < frames.length - 1) expect(value).toBeNull();
      else complete = value;
    }
    expect(complete).toEqual(update);
    const replay = new Y.Doc(); Y.applyUpdate(replay, complete);
    expect(replay.getText("body").toString()).toBe(source.getText("body").toString());
    source.destroy(); replay.destroy();
  });
  it("rejects unauthenticated allocation, missing parts, and out-of-order frames", () => {
    const frames = [...frameMessage(new Uint8Array(FRAME_BYTES * 3))];
    expect(() => createMessageAssembler({allowLarge:()=>false}).accept(frames[0])).toThrow("INVALID");
    expect(() => createMessageAssembler().accept(frames[1])).toThrow("INVALID");
    const assembler = createMessageAssembler();
    assembler.accept(frames[0]);
    expect(() => assembler.accept(new Uint8Array([1,2]))).toThrow("INCOMPLETE");
  });
  it("expires unfinished allocations and accepts legacy small frames", () => {
    let now = 0;
    const assembler = createMessageAssembler({ now: () => now });
    expect(assembler.accept(new Uint8Array([1,2,3]))).toEqual(new Uint8Array([1,2,3]));
    const frames = [...frameMessage(new Uint8Array(FRAME_BYTES * 2))];
    assembler.accept(frames[0]); now = 30_001;
    expect(() => assembler.accept(frames[1])).toThrow("INVALID");
  });
  it("rejects duplicate and truncated frames without accepting a partial Yjs update", () => {
    const frames = [...frameMessage(new Uint8Array(FRAME_BYTES * 2))];
    const duplicate = createMessageAssembler();
    expect(duplicate.accept(frames[0])).toBeNull();
    expect(() => duplicate.accept(frames[0])).toThrow("INVALID");
    duplicate.reset();
    const truncated = createMessageAssembler();
    expect(() => truncated.accept(frames[0].subarray(0, frames[0].length - 1))).toThrow("INVALID");
    truncated.reset();
  });
});


it("negotiates with real Hocuspocus and synchronizes fragmented updates both ways", async () => {
  const { Server } = await import("@hocuspocus/server");
  const { HocuspocusProvider } = await import("@hocuspocus/provider");
  const { default: WebSocket } = await import("ws");
  const { installServerFraming, selectFrameProtocol, framedWebSocket, FRAME_PROTOCOL } = await import("../shared/collaboration-framing.mjs");
  const authenticated = new WeakSet();
  const seed = "界".repeat(600_000);
  const server = new Server({
    port: 0, address: "127.0.0.1", quiet: true, stopOnSignals: false,
    websocketOptions: { maxPayload: FRAME_BYTES, handleProtocols: selectFrameProtocol },
    async onAuthenticate({ request }) { authenticated.add(request); return {}; },
    async onLoadDocument({ document }) { document.getText("body").insert(0, seed); },
  });
  installServerFraming(server, request => authenticated.has(request));
  await server.listen();
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: `ws://127.0.0.1:${server.httpServer.address().port}`, name: "framing-roundtrip", document: doc, token: "test", WebSocketPolyfill: framedWebSocket(WebSocket) });
  try {
    await expect.poll(() => doc.getText("body").length, {timeout: 10000}).toBe(seed.length);
    expect(provider.configuration.websocketProvider.webSocket.protocol).toBe(FRAME_PROTOCOL);
    doc.getText("body").insert(seed.length, seed);
    await expect.poll(() => server.hocuspocus.documents.get("framing-roundtrip")?.getText("body").length, {timeout: 10000}).toBe(seed.length * 2);
    expect(server.hocuspocus.documents.get("framing-roundtrip").getText("body").toString()).toBe(seed + seed);
  } finally {
    provider.destroy(); provider.configuration.websocketProvider.destroy(); doc.destroy(); await server.destroy();
  }
}, 30000);
