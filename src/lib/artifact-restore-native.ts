import "server-only";
import { createHash } from "node:crypto";
import type { Id } from "../../convex/_generated/dataModel";
import type { PrepareNativeRestore } from "./artifact-restore-server";
import { nativeMediaTypes } from "../features/spectra/lenses/native-payload-server";

/** Historical bytes come only from the authorized version descriptor. The
 * materializer independently captures the current native package as its base. */
export const prepareNativeArtifactRestore: PrepareNativeRestore = async input => {
  const { prepareWholeNativeHistoryRestore, preparePartialNativeHistoryRestore } =
    await import("../features/spectra/lenses/native-restore-preparation");
  const source = input.historicalSource;
  let result;
  if (source) {
    const nativeFormat = Object.entries(nativeMediaTypes).find(([, mediaType]) => mediaType === source.mediaType)?.[0];
    if (!nativeFormat || !source.url) throw new Error("ARTIFACT_RESTORE_NATIVE_SOURCE_UNAVAILABLE");
    const response = await fetch(source.url, { cache: "no-store" });
    if (!response.ok) throw new Error("ARTIFACT_RESTORE_NATIVE_SOURCE_UNAVAILABLE");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== source.bytes || createHash("sha256").update(bytes).digest("hex") !== source.sourcePayloadHash)
      throw new Error("ARTIFACT_RESTORE_NATIVE_SOURCE_INVALID");
    result = await prepareWholeNativeHistoryRestore(input.artifactId, { ...source, nativeFormat }, bytes);
  } else {
    if (!input.regionIds?.length || !input.nativeFormat) throw new Error("ARTIFACT_RESTORE_NATIVE_SOURCE_UNAVAILABLE");
    result = await preparePartialNativeHistoryRestore(input.artifactId, input.nativeFormat, input.desired.content);
  }
  if (result.state !== "prepared" || !result.nativeSource || !result.nativeCandidate || result.projectionContent === undefined)
    throw new Error("ARTIFACT_RESTORE_NATIVE_PREPARATION_REQUIRED");
  // The Convex admission verifier re-reads this exact replica binding.
  return { projectionContent: result.projectionContent, nativeCandidate: result.nativeCandidate,
    nativeSource: { ...result.nativeSource, replicaId: result.nativeSource.replicaId as Id<"workReplicas"> } };
};
