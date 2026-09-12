import { describe, expect, it } from "vitest";
import {
  nativeOperationId,
  validateNativeSaveReceipt,
} from "./native-office-contract";

const baseHash = "a".repeat(64);
const resultHash = "b".repeat(64);

function receipt() {
  return {
    kind: "native-office-save" as const,
    format: "docx" as const,
    operationId: nativeOperationId("artifact-1", baseHash, resultHash),
    artifactId: "artifact-1",
    basePayloadHash: baseHash,
    resultPayloadHash: resultHash,
    baseRevision: baseHash,
    resultRevision: resultHash,
    targets: { regionIds: ["body"], partNames: ["word/document.xml"] },
    semantic: {
      baseDigest: baseHash,
      resultDigest: resultHash,
      readbackDigest: resultHash,
    },
    preservedPartNames: ["word/styles.xml"],
    state: "applied" as const,
  };
}

describe("native office receipt contract", () => {
  it("accepts only a receipt bound to the queued artifact, base, target, and format", () => {
    expect(validateNativeSaveReceipt(receipt(), {
      artifactId: "artifact-1",
      baseRevision: baseHash,
      targetRevision: resultHash,
      resultPayloadHash: resultHash,
      target: { regionIds: ["body"], partNames: ["word/document.xml"] },
      basePayloadHash: baseHash,
      nativeFormat: "docm",
    })).toMatchObject({ artifactId: "artifact-1", resultRevision: resultHash });
  });

  it("rejects a receipt that tries to acknowledge another target", () => {
    const invalid = { ...receipt(), resultRevision: "c".repeat(64) };
    expect(() => validateNativeSaveReceipt(invalid, {
      artifactId: "artifact-1",
      baseRevision: baseHash,
      targetRevision: resultHash,
      resultPayloadHash: resultHash,
      target: { regionIds: ["body"], partNames: ["word/document.xml"] },
      basePayloadHash: baseHash,
      nativeFormat: "docx",
    })).toThrow("NATIVE_RECEIPT_TARGET_MISMATCH");
  });
});
