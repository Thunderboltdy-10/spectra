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

export type NativeTransitionReceipt = {
  kind: "bridge-storage-transition";
  transitionId: string;
  artifactId: string;
  from: string;
  to: string;
  sourceIdentity?: string;
  managedCopyIdentity?: string;
  materializationRequestId?: string;
  state: "pending" | "verified" | "failed" | "cancelled";
  before?: { hash?: string; path?: string };
  after?: { hash?: string; path?: string };
  errorCode?: string;
};

export function nativeOperationId(artifactId: string, baseRevision: string, resultHash: string) {
  return `native:${artifactId}:${baseRevision}:${resultHash}`;
}
