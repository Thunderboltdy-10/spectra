export type NativeOfficeFormat = "docx" | "xlsx" | "pptx";
export type NativeSaveState = "pending" | "applied" | "unchanged" | "cloud_saved" | "conflicted" | "failed";

export type NativeSaveTarget = {
  regionIds: string[];
  partNames: string[];
};

export type NativeSaveReceipt = {
  kind: "native-office-save";
  format: NativeOfficeFormat;
  operationId: string;
  artifactId: string;
  basePayloadHash: string;
  resultPayloadHash: string;
  baseRevision: string;
  resultRevision: string;
  targets: NativeSaveTarget;
  semantic: {
    baseDigest?: string;
    resultDigest: string;
    readbackDigest: string;
  };
  preservedPartNames: string[];
  state: NativeSaveState;
  acknowledgedAt?: number;
  errorCode?: string;
};

export type NativeReceiptExpectation = {
  artifactId: string;
  baseRevision: string;
  targetRevision: string;
  resultPayloadHash: string;
  target: NativeSaveTarget;
  basePayloadHash?: string;
  nativeFormat?: string;
};

const SHA256 = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function formatFamily(value: string) {
  const format = value.toLowerCase();
  if (["docx", "docm", "dotx", "dotm"].includes(format)) return "docx";
  if (["xlsx", "xlsm", "xltx", "xltm", "xlam"].includes(format)) return "xlsx";
  if (["pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "ppam"].includes(format)) return "pptx";
  return format;
}

/**
 * Validate a receipt at the authority boundary. A receipt is evidence about
 * one queued operation; its caller does not get to choose the artifact, base,
 * or target it proves.
 */
export function validateNativeSaveReceipt(
  value: unknown,
  expected: NativeReceiptExpectation,
): NativeSaveReceipt {
  if (!isRecord(value) || value.kind !== "native-office-save")
    throw new Error("NATIVE_RECEIPT_INVALID");
  if (!["docx", "xlsx", "pptx"].includes(String(value.format)))
    throw new Error("NATIVE_RECEIPT_FORMAT_INVALID");
  if (value.artifactId !== expected.artifactId || value.baseRevision !== expected.baseRevision)
    throw new Error("NATIVE_RECEIPT_OWNERSHIP_MISMATCH");
  if (value.resultPayloadHash !== expected.resultPayloadHash || value.resultRevision !== expected.targetRevision)
    throw new Error("NATIVE_RECEIPT_TARGET_MISMATCH");
  if (value.operationId !== nativeOperationId(expected.artifactId, expected.baseRevision, expected.resultPayloadHash))
    throw new Error("NATIVE_RECEIPT_OPERATION_MISMATCH");
  if (typeof value.basePayloadHash !== "string" || !SHA256.test(value.basePayloadHash))
    throw new Error("NATIVE_RECEIPT_BASE_HASH_INVALID");
  if (expected.basePayloadHash && value.basePayloadHash !== expected.basePayloadHash)
    throw new Error("NATIVE_RECEIPT_BASE_MISMATCH");
  if (typeof value.resultPayloadHash !== "string" || !SHA256.test(value.resultPayloadHash))
    throw new Error("NATIVE_RECEIPT_RESULT_HASH_INVALID");
  if (expected.nativeFormat && formatFamily(String(value.format)) !== formatFamily(expected.nativeFormat))
    throw new Error("NATIVE_RECEIPT_FORMAT_MISMATCH");
  if (!isRecord(value.targets) || !isStringArray(value.targets.regionIds) || !isStringArray(value.targets.partNames))
    throw new Error("NATIVE_RECEIPT_TARGETS_INVALID");
  if (!sameStringArray(value.targets.regionIds, expected.target.regionIds) ||
      !sameStringArray(value.targets.partNames, expected.target.partNames))
    throw new Error("NATIVE_RECEIPT_TARGET_MISMATCH");
  if (!isRecord(value.semantic) ||
      (value.semantic.baseDigest !== undefined && (typeof value.semantic.baseDigest !== "string" || !SHA256.test(value.semantic.baseDigest))) ||
      typeof value.semantic.resultDigest !== "string" || !SHA256.test(value.semantic.resultDigest) ||
      typeof value.semantic.readbackDigest !== "string" || !SHA256.test(value.semantic.readbackDigest))
    throw new Error("NATIVE_RECEIPT_SEMANTIC_INVALID");
  if (!isStringArray(value.preservedPartNames))
    throw new Error("NATIVE_RECEIPT_PRESERVATION_INVALID");
  if (!["pending", "applied", "unchanged", "cloud_saved", "conflicted", "failed"].includes(String(value.state)))
    throw new Error("NATIVE_RECEIPT_STATE_INVALID");
  if (value.acknowledgedAt !== undefined && typeof value.acknowledgedAt !== "number")
    throw new Error("NATIVE_RECEIPT_ACK_TIME_INVALID");
  if (value.errorCode !== undefined && typeof value.errorCode !== "string")
    throw new Error("NATIVE_RECEIPT_ERROR_INVALID");
  return value as NativeSaveReceipt;
}

export type NativeTransitionReceipt = {
  kind: "bridge-storage-transition";
  transitionId: string;
  artifactId: string;
  from: string;
  to: string;
  sourceIdentity?: string;
  managedCopyIdentity?: string;
  materializationRequestId?: string;
  state: "pending" | "verified" | "failed" | "conflicted" | "cancelled";
  before?: { hash?: string; path?: string };
  after?: { hash?: string; path?: string };
  errorCode?: string;
};

export function nativeOperationId(artifactId: string, baseRevision: string, resultHash: string) {
  return `native:${artifactId}:${baseRevision}:${resultHash}`;
}
