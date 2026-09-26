import type { QueueMaterializationArgs, CloudMaterializationArgs } from "../../../../convex/replicaMaterialization";
import type { NativeSaveReceipt } from "../../../../shared/native-office-contract";
import type { NativePayloadTruth } from "./native-payload-server";

/** Supplied by the authenticated AI executor, never by a model tool argument. */
export type NativeAiOperationIdentity = {
  runId: string;
  executionId: string;
  operationId: string;
};

export type NativeMaterializationOptions = {
  promotionMode?: "verified-first" | "immediate-projection";
  /** Human editor calls omit this; the AI entry point requires it. */
  aiOperation?: NativeAiOperationIdentity;
  /** Return a transient verified candidate without queueing or replica writes. */
  prepareOnly?: boolean;
};

export type NativeMaterializationSource = Pick<
  NativePayloadTruth,
  "replicaId" | "payloadRef" | "hash" | "revision" | "bytes" | "nativeFormat"
>;

export type NativeMaterializationCandidate =
  | { destination: "bridge"; queue: QueueMaterializationArgs }
  | { destination: "cloud"; cloud: CloudMaterializationArgs }
  | {
      destination: "none";
      unchanged: {
        sourcePayloadRef: string;
        sourceHash: string;
        resultPayloadRef: string;
        resultHash: string;
        /** Native semantic hex digest, separate from canonical projection hashes. */
        readbackProjectionHash: string;
        preservationEvidence: NativeSaveReceipt;
      };
    };

export function assertNativePreparationIdentity(options?: NativeMaterializationOptions) {
  if (!options?.prepareOnly) return;
  const identity = options.aiOperation;
  if (!identity || [identity.runId, identity.executionId, identity.operationId]
    .some(value => typeof value !== "string" || !value.trim()))
    throw new Error("NATIVE_PROMOTION_IDENTITY_REQUIRED");
}

/** This is an in-memory handoff, not a durable prepared-state lifecycle.
 * Only immutable uploaded payload retention may have occurred at this point. */
export function preparedNativeMaterialization(
  source: NativeMaterializationSource,
  nativeCandidate: NativeMaterializationCandidate,
  projectionContent: unknown,
  hash: string,
) {
  return {
    state: "prepared" as const,
    hash,
    projectionContent,
    nativeSource: {
      replicaId: source.replicaId,
      payloadRef: source.payloadRef,
      hash: source.hash,
      revision: source.revision,
      bytes: source.bytes,
      nativeFormat: source.nativeFormat,
    },
    nativeCandidate,
  };
}
