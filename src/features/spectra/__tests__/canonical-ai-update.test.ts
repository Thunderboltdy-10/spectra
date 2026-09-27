import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { initializeNativeArtifactDocument, nativeArtifactProjection } from "../../../../scripts/collaboration-native-projection.mjs";
import { durableFrontierHash, stateVectorHash } from "../../../../scripts/collaboration-canonical-room.mjs";
import { assertPreparedAiCommit, loadAdmittedAiUpdate, prepareCanonicalAiUpdate, retryCanonicalAiMutation, type NativeAiHead } from "../ai/canonical-ai-update";
import type { AdmittedAiCommit } from "../ai/admitted-ai-update";

function fixture() {
  const document = new Y.Doc();
  const before = { title: "Work", tags: [], content: { blocks: [{ id: "p", type: "paragraph", text: "First paragraph" }] } };
  initializeNativeArtifactDocument(document, { ...before, typeKey: "document", schemaVersion: 4 });
  const desired = { ...before, content: { blocks: [{ id: "p", type: "paragraph", text: "Edited paragraph" }] } };
  const head = { accountId: "account", artifact: { _id: "artifact", blueprintKey: "document", schemaVersion: 4,
    updatedAt: 100, contentHash: "physical" }, operationDigest: "operation", prompt: "Edit paragraph",
    operation: { id: "operation", type: "artifact.update", input: { content: desired.content } },
    sourceContentIdentity: "source", room: { _id: "room", nextSequence: 2, policyVersion: 3 }, committedResult: null } as NativeAiHead;
  const stored = { roomId: "room", nextSequence: 2, liveStateVectorHash: stateVectorHash(document),
    updates: [{ sequence: 1, update: Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64") }] };
  const bridge = vi.fn(async () => stored);
  return { document, head, desired, stored, bridge, authoredFrontier: durableFrontierHash(document), clientId: "ai", operationId: "operation" };
}

it("retries only explicit stale refusals and bounds fresh semantic attempts", async () => {
  const stale = vi.fn(async () => { throw new Error("AI_NATIVE_CANONICAL_STALE"); });
  await expect(retryCanonicalAiMutation(stale)).rejects.toThrow("AI_NATIVE_CANONICAL_STALE");
  expect(stale).toHaveBeenCalledTimes(3);
  const uncertain = vi.fn(async () => { throw new Error("response lost"); });
  await expect(retryCanonicalAiMutation(uncertain)).rejects.toThrow("response lost");
  expect(uncertain).toHaveBeenCalledTimes(1);
  const cancelled = new AbortController(); cancelled.abort();
  const unwritten = vi.fn(async () => true);
  await expect(retryCanonicalAiMutation(unwritten, cancelled.signal)).rejects.toThrow();
  expect(unwritten).not.toHaveBeenCalled();
});

it("prepares and verifies exact accepted bytes without mutating the live document", async () => {
  const f = fixture();
  try {
    const original = Y.encodeStateAsUpdate(f.document);
    const result = await prepareCanonicalAiUpdate(f);
    expect(Y.encodeStateAsUpdate(f.document)).toEqual(original);
    expect(result.prepared.expected).toMatchObject({ roomId: "room", nextSequence: 2, artifactUpdatedAt: 100 });
    const update = Buffer.from(result.prepared.append.update, "base64");
    const admitted: AdmittedAiCommit = { state: "committed", duplicate: false,
      receipt: { roomId: "room", sequence: 2, updateDigest: createHash("sha256").update(update).digest("hex"), nativeResult: null },
      admitted: { encoding: "inline", updateBase64: update.toString("base64") } };
    expect(() => assertPreparedAiCommit(result.prepared, admitted)).not.toThrow();
    expect(() => assertPreparedAiCommit(result.prepared, { ...admitted, receipt: { ...admitted.receipt, updateDigest: "a".repeat(64) } }))
      .toThrow("AI_ADMITTED_PREPARATION_MISMATCH");
    const bytes = await loadAdmittedAiUpdate(admitted, f.bridge, { artifactId: "artifact", accountId: "account", policyVersion: 3 });
    Y.applyUpdate(f.document, bytes);
    expect(nativeArtifactProjection(f.document, 4)?.content).toEqual(result.after.content);
    expect(JSON.stringify(result.before.content)).toContain("First paragraph");
    expect(JSON.stringify(result.after.content)).toContain("Edited paragraph");
    expect(f.bridge).toHaveBeenCalledTimes(1);
  } finally { f.document.destroy(); }
});

it("rejects a changed durable sequence before preparing any result", async () => {
  const f = fixture(); f.stored.nextSequence = 3;
  try { await expect(prepareCanonicalAiUpdate(f)).rejects.toThrow("AI_NATIVE_CANONICAL_STALE"); }
  finally { f.document.destroy(); }
});

it("fences a delete-only native change even when the state vector is unchanged", async () => {
  const f = fixture();
  try {
    f.document.getMap("spectra:work-v2:live-meta").delete("title");
    expect(stateVectorHash(f.document)).toBe(f.stored.liveStateVectorHash);
    f.stored.updates[0].update = Buffer.from(Y.encodeStateAsUpdate(f.document)).toString("base64");
    await expect(prepareCanonicalAiUpdate(f)).rejects.toThrow("AI_NATIVE_CANONICAL_STALE");
  } finally { f.document.destroy(); }
});

it("rejects native readback that does not match the persisted operation", async () => {
  const f = fixture();
  f.desired.content.blocks[0].text = "Unexpected replacement";
  f.head.operation.input = { content: { blocks: [{ id: "p", type: "paragraph", text: "Expected replacement" }] } };
  try { await expect(prepareCanonicalAiUpdate(f)).rejects.toThrow("AI_ARTIFACT_RESULT_SCOPE_MISMATCH"); }
  finally { f.document.destroy(); }
});

it("recovers a compacted accepted payload only from a verified covering room", async () => {
  const f = fixture();
  try {
    const result: AdmittedAiCommit = { state: "committed", duplicate: true,
      receipt: { roomId: "room", sequence: 1, updateDigest: "a".repeat(64), nativeResult: null },
      admitted: { encoding: "payload", payloadRef: "old", digest: "a".repeat(64), byteLength: 12 } };
    const bridge = vi.fn(async () => ({ ...f.stored, updates: [], snapshot: { update: f.stored.updates[0].update } }));
    const update = await loadAdmittedAiUpdate(result, bridge, { artifactId: "artifact", accountId: "account", policyVersion: 3 });
    const recovered = new Y.Doc();
    try { Y.applyUpdate(recovered, update); expect(nativeArtifactProjection(recovered, 4)).toEqual(nativeArtifactProjection(f.document, 4)); }
    finally { recovered.destroy(); }
    bridge.mockResolvedValueOnce({ ...f.stored, roomId: "other", updates: [], snapshot: { update: f.stored.updates[0].update } });
    await expect(loadAdmittedAiUpdate(result, bridge, { artifactId: "artifact", accountId: "account", policyVersion: 3 }))
      .rejects.toThrow("AI_ADMITTED_REPLAY_BEHIND_RECEIPT");
  } finally { f.document.destroy(); }
});
