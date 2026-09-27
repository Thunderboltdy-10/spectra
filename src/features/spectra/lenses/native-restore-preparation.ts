import "server-only";
import { comparePackages } from "@ariadng/office/preservation";
import type { Id } from "../../../../convex/_generated/dataModel";
import { convexQuery } from "@/lib/convex-server";
import { materializeDocxArtifact } from "@/app/api/spectra/lenses/docx/route";
import { materializeOfficeArtifact } from "@/app/api/spectra/lenses/office/route";
import { docxLens, sha256Payload } from "./docx-lens";
import { xlsxLens } from "./xlsx-lens";
import { pptxLens } from "./pptx-lens";
import { bindDocxProjectionSource, compactDocxProjectionForStorage } from "./document-projection";
import { bindPptxProjectionSource, pptxArtifactContent, xlsxArtifactContent, convexSafeFidelityMap } from "./office-content";
import { fetchVerifiedNativePayload, uploadNativePayload } from "./native-payload-server";
import { preparedNativeMaterialization } from "./native-materialization-options";
import { nativeOperationId, type NativeSaveReceipt } from "../../../../shared/native-office-contract";
import { encodeArtifactContentForStorage } from "../../../../shared/sheet-cells";

export type NativeHistorySource = { sourceVersionId: string; sourcePayloadHash: string;
  payloadRef: string; nativeFormat: string; bytes: number };
const documents = new Set(["docx", "docm", "dotx", "dotm"]);
const sheets = new Set(["xlsx", "xlsm", "xltx", "xltm", "xlam"]);
const presentations = new Set(["pptx", "pptm", "potx", "potm", "ppsx", "ppsm"]);

async function readback(workId: string, nativeFormat: string, bytes: Uint8Array, hash: string) {
  if (documents.has(nativeFormat)) {
    const opened = await docxLens.open(bytes, "strict-native");
    return { format: "docx" as const, digest: opened.projection.nativeBinding.semanticDigest,
      content: compactDocxProjectionForStorage(bindDocxProjectionSource(opened.projection, workId, hash)),
      fidelityMap: convexSafeFidelityMap(opened.fidelityMap) };
  }
  if (sheets.has(nativeFormat)) {
    const opened = await xlsxLens.open(bytes);
    return { format: "xlsx" as const, digest: opened.projection.nativeBinding.semanticDigest,
      content: encodeArtifactContentForStorage("sheets", xlsxArtifactContent(opened.projection)),
      fidelityMap: convexSafeFidelityMap(opened.fidelityMap) };
  }
  if (presentations.has(nativeFormat)) {
    const opened = await pptxLens.open(bytes);
    return { format: "pptx" as const, digest: opened.projection.nativeBinding.semanticDigest,
      content: encodeArtifactContentForStorage("presentation", pptxArtifactContent(bindPptxProjectionSource(opened.projection, workId, hash))),
      fidelityMap: convexSafeFidelityMap(opened.fidelityMap) };
  }
  throw new Error("NATIVE_RESTORE_FORMAT_UNSUPPORTED");
}

/** The history orchestrator supplies bytes and the exact authenticated version
 * descriptor, and rechecks that membership in its final transaction. This
 * helper never chooses a historical hash or admits a restore by itself. */
export async function prepareWholeNativeHistoryRestore(workId: Id<"spectraArtifacts">, source: NativeHistorySource, payload: Uint8Array) {
  if (!source.sourceVersionId || !source.payloadRef || !/^[a-f0-9]{64}$/.test(source.sourcePayloadHash) ||
      payload.byteLength !== source.bytes || await sha256Payload(payload) !== source.sourcePayloadHash)
    throw new Error("NATIVE_RESTORE_SOURCE_INVALID");
  const [current, work] = await Promise.all([
    fetchVerifiedNativePayload(workId, "cloud"),
    convexQuery<{ workId: Id<"spectraArtifacts"> }, { replicas: { _id: Id<"workReplicas">; kind: string; state: string }[] }>(
      "replicas:forWork", { workId }),
  ]);
  if (source.nativeFormat !== current.truth.nativeFormat) throw new Error("NATIVE_RESTORE_FORMAT_MISMATCH");
  const [before, after, comparison] = await Promise.all([
    readback(workId, source.nativeFormat, current.payload, current.truth.hash),
    readback(workId, source.nativeFormat, payload, source.sourcePayloadHash),
    comparePackages(current.payload, payload),
  ]);
  const local = work.replicas.find(replica => replica.kind === "local" && replica.state !== "unavailable");
  const same = current.truth.hash === source.sourcePayloadHash;
  const partNames = comparison.parts.filter(part => part.verdict !== "identical").map(part => `/${part.name}`);
  const receipt: NativeSaveReceipt = { kind: "native-office-save", format: after.format,
    operationId: nativeOperationId(workId, current.truth.revision, source.sourcePayloadHash), artifactId: workId,
    basePayloadHash: current.truth.hash, resultPayloadHash: source.sourcePayloadHash,
    baseRevision: current.truth.revision, resultRevision: source.sourcePayloadHash,
    targets: { regionIds: [], partNames }, semantic: { baseDigest: before.digest, resultDigest: after.digest, readbackDigest: after.digest },
    preservedPartNames: comparison.parts.filter(part => part.verdict === "identical").map(part => `/${part.name}`),
    state: same ? "unchanged" : local ? "pending" : "cloud_saved" };
  if (same) return preparedNativeMaterialization(current.truth, { destination: "none", unchanged: {
    sourcePayloadRef: current.truth.payloadRef, resultPayloadRef: current.truth.payloadRef,
    sourceHash: current.truth.hash, resultHash: source.sourcePayloadHash,
    readbackProjectionHash: after.digest, preservationEvidence: receipt,
  } }, after.content, source.sourcePayloadHash);
  // A deliberate whole-version restore retains exact historical bytes, including
  // features not modeled in the editor. Do not regenerate or flatten this ZIP.
  const stored = await uploadNativePayload(workId, payload, source.sourcePayloadHash, source.nativeFormat);
  const args = { workId, payloadRef: stored.payloadRef, contentHash: source.sourcePayloadHash,
    baseRevision: current.truth.revision, projectionContent: after.content, projectionContentHash: after.digest,
    fidelityMap: after.fidelityMap, nativeReceipt: receipt };
  return preparedNativeMaterialization(current.truth, local ? { destination: "bridge", queue: { ...args,
    localReplicaId: local._id, regionIds: [], partNames, baseContent: before.content, baseContentHash: before.digest,
  } } : { destination: "cloud", cloud: args }, after.content, source.sourcePayloadHash);
}

/** Selected regions are already merged into current canonical content by the
 * history planner. Native edits use the current package and preservation proof. */
export async function preparePartialNativeHistoryRestore(workId: Id<"spectraArtifacts">, nativeFormat: string, content: unknown) {
  const materialize = documents.has(nativeFormat) ? materializeDocxArtifact
    : sheets.has(nativeFormat) || presentations.has(nativeFormat) ? materializeOfficeArtifact : null;
  if (!materialize) throw new Error("NATIVE_RESTORE_FORMAT_UNSUPPORTED");
  return materialize(workId, content, { prepareOnly: true, preparationActor: "user" });
}
