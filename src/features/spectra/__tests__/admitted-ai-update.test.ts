import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import WebSocket from "ws";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { applyAdmittedProviderUpdate, readAdmittedAiUpdate, type AdmittedAiCommit } from "../ai/admitted-ai-update";

const fixture = () => {
  const doc = new Y.Doc(); doc.getText("body").insert(0, "accepted");
  const update = Y.encodeStateAsUpdate(doc); doc.destroy();
  const digest = createHash("sha256").update(update).digest("hex");
  const result: AdmittedAiCommit = { state: "committed", duplicate: true,
    receipt: { roomId: "room", sequence: 4, updateDigest: digest, nativeResult: { state: "pending" } },
    admitted: { encoding: "inline", updateBase64: Buffer.from(update).toString("base64") } };
  return { result, update, digest };
};
const readers = () => ({ payload: vi.fn(), replay: vi.fn() });

it("applies committed bytes through a real provider without authoring a second update", () => {
  const document = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: "ws://127.0.0.1:1", WebSocketPolyfill: WebSocket, autoConnect: false });
  const provider = new HocuspocusProvider({ name: "admitted-fixture", document, websocketProvider: socket, flushDelay: 180 });
  try {
    const { update } = fixture();
    applyAdmittedProviderUpdate(provider, update, "admitted:fixture");
    expect(document.getText("body").toString()).toBe("accepted");
    expect(provider.hasUnsyncedChanges).toBe(false);
    document.getText("body").insert(0, "authored ");
    expect(provider.hasUnsyncedChanges).toBe(true);
  } finally { provider.destroy(); socket.destroy(); document.destroy(); }
});

it("consumes only the exact admitted inline bytes after a lost acknowledgement", async () => {
  const { result, update } = fixture(); const read = readers();
  expect(await readAdmittedAiUpdate(result, read)).toEqual(update);
  expect(read.payload).not.toHaveBeenCalled(); expect(read.replay).not.toHaveBeenCalled();
  await expect(readAdmittedAiUpdate({ ...result, admitted: { encoding: "inline", updateBase64: "AAA=" } }, read))
    .rejects.toThrow("AI_ADMITTED_UPDATE_INVALID");
});

it("checks a retained payload's original receipt digest and length", async () => {
  const { result, update, digest } = fixture(); const read = readers(); read.payload.mockResolvedValue(update);
  const payload = { ...result, admitted: { encoding: "payload" as const, payloadRef: "retained", digest, byteLength: update.byteLength } };
  expect(await readAdmittedAiUpdate(payload, read)).toEqual(update);
  read.payload.mockResolvedValue(update.slice(1));
  await expect(readAdmittedAiUpdate(payload, read)).rejects.toThrow("AI_ADMITTED_UPDATE_INVALID");
});

it("accepts a current replay covering the original receipt after compaction", async () => {
  const { result, update } = fixture(); const current = new Y.Doc(); Y.applyUpdate(current, update);
  current.getText("body").insert(current.getText("body").length, " then edited");
  const replay = Y.encodeStateAsUpdate(current); current.destroy();
  const read = readers(); read.replay.mockResolvedValue({ roomId: "room", throughSequence: 7, update: replay });
  expect(await readAdmittedAiUpdate({ ...result, admitted: { encoding: "replay", roomId: "room", throughSequence: 4 } }, read)).toEqual(replay);
  read.replay.mockResolvedValue({ roomId: "room", throughSequence: 3, update: replay });
  await expect(readAdmittedAiUpdate({ ...result, admitted: { encoding: "replay", roomId: "room", throughSequence: 4 } }, read))
    .rejects.toThrow("AI_ADMITTED_REPLAY_BEHIND_RECEIPT");
});

it("rejects another room's replay without reading or applying it", async () => {
  const { result } = fixture(); const read = readers();
  await expect(readAdmittedAiUpdate({ ...result, admitted: { encoding: "replay", roomId: "other", throughSequence: 4 } }, read))
    .rejects.toThrow("AI_ADMITTED_REPLAY_BEHIND_RECEIPT");
  expect(read.replay).not.toHaveBeenCalled();
});
