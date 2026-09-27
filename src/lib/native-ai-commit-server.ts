import "server-only";
import type { NativeAiCommitArgs } from "../../convex/nativeAiCommitContract";
import type { PreparedCanonicalAiUpdate, AdmittedAiCommit } from "../features/spectra/ai/admitted-ai-update";
import { createCollaborationGatewayBridgeClient } from "../../scripts/collaboration-gateway-bridge-client.mjs";
import { getConvexUrl } from "./env";
import { retainNativeCandidate } from "./native-materialization-server";
import { nativeAiRequestDigest } from "../../shared/native-ai-commit";

export type NativeAiCommitWireRequest = Omit<NativeAiCommitArgs, "append"> & {
  append: PreparedCanonicalAiUpdate["append"];
};

/** The existing bridge transport retries this exact immutable business request.
 * Rebuilding a native package or authored Yjs delta is not a transport retry. */
export async function commitPreparedNativeAiRequest(request: NativeAiCommitWireRequest): Promise<AdmittedAiCommit> {
  const retained = structuredClone(request);
  retained.nativeCandidate = await retainNativeCandidate(retained.nativeCandidate);
  retained.requestDigest = await nativeAiRequestDigest(retained);
  const bridge = createCollaborationGatewayBridgeClient({
    convexUrl: getConvexUrl(),
    bridgeKey: process.env.SPECTRA_COLLAB_BRIDGE_KEY!,
  });
  const result = await bridge("commitAiNative", {
    artifactId: request.append.artifactId,
    accountId: request.append.accountId,
    partitionKey: request.append.partitionKey,
    policyVersion: request.append.policyVersion,
    ...retained,
  });
  if (result?.state !== "committed")
    throw new Error("AI_NATIVE_COMMIT_NOT_CONFIRMED");
  return result as AdmittedAiCommit;
}
