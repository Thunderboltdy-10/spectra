import { describe, expect, it } from "vitest";
import { nativeAiRequestDigest, nativeAiUpdateIdentity } from "./native-ai-commit";

describe("native AI immutable request digest", () => {
  const source = { aiOperation: { runId: "run", operationId: "op", executionId: "attempt" },
    expected: { nativeSource: { hash: "base", payloadRef: "source" } },
    nativeCandidate: { destination: "cloud", cloud: { payloadRef: "result", nativeReceipt: { semantic: { readbackDigest: "proof" } } } },
    append: { update: new Uint8Array([1, 2, 3]).buffer, projectionJson: "after", projectionHash: "after-hash" } };
  it("normalizes exact binary/base64 transport and object property order", async () => {
    expect(await nativeAiRequestDigest(source)).toBe(await nativeAiRequestDigest({
      ...source, aiOperation: { executionId: "attempt", operationId: "op", runId: "run" }, append: { ...source.append, update: "AQID" } }));
  });
  it("binds scope, readback, native source and exact projection", async () => {
    const original = await nativeAiRequestDigest(source);
    for (const changed of [
      { ...source, aiOperation: { ...source.aiOperation, operationId: "other" } },
      { ...source, expected: { nativeSource: { hash: "new-base", payloadRef: "source" } } },
      { ...source, nativeCandidate: { destination: "none", proof: "changed" } },
      { ...source, append: { ...source.append, projectionJson: "different" } },
    ]) expect(await nativeAiRequestDigest(changed)).not.toBe(original);
  });
  it("rejects contradictory inline payload identity fields", async () => {
    await expect(nativeAiUpdateIdentity({ ...source.append, payloadDigest: "a".repeat(64), byteLength: 300 }))
      .rejects.toThrow("AI_NATIVE_UPDATE_INVALID");
  });
  it("rejects mixed inline bytes and a stored payload reference", async () => {
    await expect(nativeAiUpdateIdentity({ ...source.append, payloadRef: "payload", payloadDigest: "a".repeat(64), byteLength: 3 }))
      .rejects.toThrow("AI_NATIVE_UPDATE_INVALID");
  });
});
