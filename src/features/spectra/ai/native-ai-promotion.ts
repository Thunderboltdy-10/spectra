import type { Id } from "../../../../convex/_generated/dataModel";
import { materializeDocxArtifact } from "@/app/api/spectra/lenses/docx/route";
import { materializeOfficeArtifact } from "@/app/api/spectra/lenses/office/route";
import type {
  NativeAiOperationIdentity, NativeMaterializationOptions,
  NativeMaterializationCandidate, NativeMaterializationSource,
} from "../lenses/native-materialization-options";
import type { AiBeforeCommitInfo, AdmittedAiCommit } from "./admitted-ai-update";
import { nativeAiRequestDigest } from "../../../../shared/native-ai-commit";
import { commitPreparedNativeAiRequest, type NativeAiCommitWireRequest } from "@/lib/native-ai-commit-server";

const DOCX_FORMATS = new Set(["docx", "docm", "dotx", "dotm"]);
const OFFICE_FORMATS = new Set([
  "xlsx",
  "xlsm",
  "xltx",
  "xltm",
  "xlam",
  "pptx",
  "pptm",
  "potx",
  "potm",
]);

export type NativeMaterializeResult = {
  state: string;
  requestId?: string;
  hash?: string;
  status?: string;
  /** Canonical content read back from the native payload that will be written. */
  projectionContent?: unknown;
  conflict?: { message?: string };
  nativeSource?: NativeMaterializationSource;
  nativeCandidate?: NativeMaterializationCandidate;
};

export type NativePromotionDeps = {
  commit?: (request: NativeAiCommitWireRequest) => Promise<AdmittedAiCommit>;
  materializeDocx?: (
    workId: Id<"spectraArtifacts">,
    content: unknown,
    options?: NativeMaterializationOptions,
  ) => Promise<NativeMaterializeResult>;
  materializeOffice?: (
    workId: Id<"spectraArtifacts">,
    content: unknown,
    options?: NativeMaterializationOptions,
  ) => Promise<NativeMaterializeResult>;
};

function promotionError(code: string, detail: string) {
  return new Error(`${code}: ${detail}`);
}

export function isNativeContentRegion(regionId: string) {
  return !regionId.startsWith("metadata:");
}

export function linkedOfficeKind(nativeFormat: string | undefined) {
  const format = nativeFormat?.toLowerCase();
  if (!format) return null;
  if (DOCX_FORMATS.has(format)) return "docx" as const;
  if (OFFICE_FORMATS.has(format)) return "office" as const;
  return null;
}

/** Prepare native bytes, then admit their exact canonical delta and native
 * intent once. Only the returned durable receipt can be consumed as saved. */
export async function promoteNativeAiContent(params: {
  workId: string;
  blueprintKey: string;
  nativeFormat: string;
  commit: AiBeforeCommitInfo;
  aiOperation: NativeAiOperationIdentity;
  deps?: NativePromotionDeps;
}): Promise<AdmittedAiCommit> {
  if (!params.aiOperation || [params.aiOperation.runId, params.aiOperation.executionId, params.aiOperation.operationId]
    .some(value => typeof value !== "string" || !value.trim()))
    throw promotionError("NATIVE_PROMOTION_IDENTITY_REQUIRED", "The native edit has no authenticated AI operation identity.");
  const kind = linkedOfficeKind(params.nativeFormat);
  if (!kind)
    throw promotionError("NATIVE_PROMOTION_REFUSED", "This can't be saved as an Office file.");
  if (typeof params.commit?.prepareAdmittedUpdate !== "function")
    throw promotionError("NATIVE_PROMOTION_ADMISSION_REQUIRED", "The native edit has no atomic canonical admission boundary.");
  const options: NativeMaterializationOptions = {
    prepareOnly: true,
    aiOperation: { ...params.aiOperation },
  };
  const materialize = kind === "docx"
    ? params.deps?.materializeDocx ?? materializeDocxArtifact
    : params.deps?.materializeOffice ?? materializeOfficeArtifact;
  const prepared: NativeMaterializeResult = await materialize(
    params.workId as Id<"spectraArtifacts">,
    params.commit.desired.content,
    options,
  );
  if (prepared.state === "conflicted")
    throw promotionError("NATIVE_PROMOTION_CONFLICT", prepared.conflict?.message || "Both copies changed. Nothing overwritten.");
  if (prepared.state === "protected-pending")
    throw promotionError("NATIVE_PROMOTION_PROTECTED", "Spectra can read this original but will not change it.");
  if (prepared.state !== "prepared" || prepared.projectionContent === undefined ||
      !prepared.nativeSource || !prepared.nativeCandidate || !/^[a-f0-9]{64}$/.test(prepared.hash ?? ""))
    throw promotionError("NATIVE_PROMOTION_NOT_PREPARED", "Native preparation did not return verified bytes and their source.");

  // Native readback may normalize cells, paragraph structure or object mirrors.
  // Build a fresh exact Yjs delta only after that readback is available.
  params.commit.desired.content = prepared.projectionContent;
  const canonical = await params.commit.prepareAdmittedUpdate(params.commit.desired);
  if (String(canonical.append.artifactId) !== params.workId || canonical.append.actorKind !== "ai")
    throw promotionError("NATIVE_PROMOTION_ARTIFACT_MISMATCH", "The canonical update belongs to a different artifact or actor.");
  const request: NativeAiCommitWireRequest = {
    ...canonical,
    aiOperation: {
      runId: params.aiOperation.runId as Id<"spectraAiRuns">,
      executionId: params.aiOperation.executionId,
      operationId: params.aiOperation.operationId as Id<"spectraOperations">,
    },
    expected: {
      ...canonical.expected,
      nativeSource: {
        ...prepared.nativeSource,
        replicaId: prepared.nativeSource.replicaId as Id<"workReplicas">,
      },
    },
    nativeCandidate: prepared.nativeCandidate,
    requestDigest: "",
  };
  request.requestDigest = await nativeAiRequestDigest(request);
  const result = await (params.deps?.commit ?? commitPreparedNativeAiRequest)(request);
  if (result.state !== "committed")
    throw promotionError("NATIVE_PROMOTION_NOT_COMMITTED", "The atomic native and canonical commit was not confirmed.");
  return result;
}
