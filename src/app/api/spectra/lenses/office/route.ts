import { ensureImportedNativePayload } from "@/features/spectra/lenses/native-payload-server";
import { hydrateContentForWrite } from "@/lib/convex-server";
import { reconcileNativeRevision } from "@/lib/native-reconciliation-server";
import { NextResponse } from "next/server";
import { comparePackages } from "@ariadng/office/preservation";
import { assertNativePreservationKept } from "@/features/spectra/lenses/preservation-proof";
import { z } from "zod";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import {
  assertNativePreparationIdentity,
  preparedNativeMaterialization,
  type NativeMaterializationOptions,
} from "@/features/spectra/lenses/native-materialization-options";
import type { QueueMaterializationArgs, CloudMaterializationArgs } from "../../../../../../convex/replicaMaterialization";
import { checkpointArtifactDurableContent, convexMutation, convexQuery } from "@/lib/convex-server";
import { sha256Payload } from "@/features/spectra/lenses/docx-lens";
import {
  fetchVerifiedNativePayload,
  fetchStoredNativeBase,
  uploadNativePayload,
} from "@/features/spectra/lenses/native-payload-server";
import {
  shouldActivateExternalNativeRevision,
  type RecentNativeOperation,
} from "@/features/spectra/lenses/native-reconciliation";
import {
  xlsxLens,
  xlsxSemanticDigest,
  XlsxLensError,
  type XlsxProjection,
} from "@/features/spectra/lenses/xlsx-lens";
import {
  pptxLens,
  PptxLensError,
  type PptxProjection,
} from "@/features/spectra/lenses/pptx-lens";
import type {
  PptxOperation,
  XlsxOperation,
} from "@/features/spectra/lenses/projection-contracts";
import {
  bindPptxProjectionSource,
  convexSafeFidelityMap,
  pptxArtifactContent,
  pptxProjectionUpdateFromContent,
  pptxProjectionFromContent,
  xlsxArtifactContent,
  xlsxProjectionUpdateFromContent,
  xlsxProjectionFromContent,
} from "@/features/spectra/lenses/office-content";
import {
  mergePptxProjections,
  mergeXlsxProjections,
  pptxChangedRegions,
  xlsxChangedRegions,
} from "@/features/spectra/lenses/office-projection-merge";
import { humanizePublicFailure } from "@/features/spectra/bridge/humanize";
import { nativeOperationId, type NativeSaveReceipt } from "../../../../../../shared/native-office-contract";
import { normalizePresentationContent, type PresentationContent } from "@/features/spectra/presentation/model";
import { refreshPresentationLinkedCharts } from "@/features/spectra/presentation/linked-chart";
import type { SpectraArtifact } from "@/features/spectra/data/api";
import { encodeArtifactContentForStorage } from "../../../../../../shared/sheet-cells";

// Compatibility exports for existing callers. The implementation lives in the
// canonical office-content module; routes only re-export the shared transform.
export {
  pptxProjectionFromContent as contentToPptx,
  xlsxProjectionFromContent as contentToXlsx,
} from "@/features/spectra/lenses/office-content";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), artifactId: z.string().min(1) }),
  z.object({
    action: z.literal("materialize"),
    artifactId: z.string().min(1),
    content: z.unknown().optional(),
  }),
  z.object({
    action: z.literal("reconcile"),
    artifactId: z.string().min(1),
    resolution: z.enum(["local", "spectra"]).optional(),
  }),
]);

type WorkTruth = {
  replicas: Array<{
    _id: string;
    kind: "cloud" | "local";
    revision: string;
    state: string;
  }>;
  recentOperations?: RecentNativeOperation[];
};
type ArtifactTruth = Pick<SpectraArtifact, "content" | "status" | "blueprintKey" | "currentVersionId">;
type OfficeProjection = XlsxProjection | PptxProjection;

const spreadsheetFormats = new Set(["xlsx", "xlsm", "xltx", "xltm", "xlam"]);
/* native media types are supplied by the retained payload; the route never rewrites them */
const _mediaTypes: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  xltm: "application/vnd.ms-excel.template.macroEnabled.12",
  xlam: "application/vnd.ms-excel.addin.macroEnabled.12",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pptm: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  potx: "application/vnd.openxmlformats-officedocument.presentationml.template",
  potm: "application/vnd.ms-powerpoint.template.macroEnabled.12",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  ppsm: "application/vnd.ms-powerpoint.slideshow.macroEnabled.12",
  ppam: "application/vnd.ms-powerpoint.addin.macroEnabled.12",
};

function id(value: string) {
  return value as Id<"spectraArtifacts">;
}
type NativeSource = { artifactId: string; payloadHash: string };

function contentFor(
  projection: OfficeProjection,
  isSheet: boolean,
  source: NativeSource,
) {
  if (isSheet) return xlsxArtifactContent(projection as XlsxProjection);
  return pptxArtifactContent(
    bindPptxProjectionSource(
      projection as PptxProjection,
      source.artifactId,
      source.payloadHash,
    ),
  );
}
function contentForStorage(
  projection: OfficeProjection,
  isSheet: boolean,
  source: NativeSource,
) {
  return encodeArtifactContentForStorage(
    isSheet ? "sheets" : "presentation",
    contentFor(projection, isSheet, source),
  );
}

/** Resolve only the explicitly bound Sheets sources in this deck. The query is
 * per referenced artifact, so native materialization never scans the artifact
 * collection or introduces a second embedding system. */
async function hydratePresentationLinkedCharts(content: unknown) {
  const deck = normalizePresentationContent(content);
  const sourceIds = [...new Set(deck.slides.flatMap((slide) => slide.objects
    .filter((object) => object.type === "chart" && object.sourceBinding?.kind === "sheets_range" && object.sourceBinding.live !== false)
    .map((object) => object.sourceBinding!.artifactId)))];
  if (!sourceIds.length) return deck;
  const sources = await Promise.all(sourceIds.map(async (artifactId) => {
    try {
      const source = await convexQuery<{ artifactId: Id<"spectraArtifacts"> }, ArtifactTruth>(
        "spectraArtifacts:get",
        { artifactId: id(artifactId) },
      );
      return {
        _id: artifactId,
        blueprintKey: source.blueprintKey,
        status: source.status,
        currentVersionId: source.currentVersionId,
        content: source.content,
      } as unknown as SpectraArtifact;
    } catch {
      return {
        _id: artifactId,
        blueprintKey: "sheets",
        status: "deleted",
      } as unknown as SpectraArtifact;
    }
  }));
  return refreshPresentationLinkedCharts(deck, sources).deck as PresentationContent;
}

export function officeLensErrorCode(error: unknown) {
  if (error instanceof XlsxLensError || error instanceof PptxLensError)
    return error.code;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    /^[A-Z][A-Z0-9_]{2,80}$/.test((error as { code: string }).code)
  )
    return (error as { code: string }).code;
  return "OFFICE_LENS_FAILED";
}
export function projectionFor(
  content: unknown,
  base: OfficeProjection,
  isSheet: boolean,
) {
  return isSheet
    ? xlsxProjectionFromContent(content, base as XlsxProjection)
    : pptxProjectionFromContent(content, base as PptxProjection, { objectLists: "complete" });
}

/** Queue one verified XLSX/PPTX payload for the Bridge. AI and human edits
 * must share this path so native writes cannot diverge by caller. */
export async function materializeOfficeArtifact(
  workId: Id<"spectraArtifacts">,
  content: unknown,
  options?: NativeMaterializationOptions,
) {
  assertNativePreparationIdentity(options);
  return materializeOfficeArtifactAttempt(workId, content, 0, options);
}

async function materializeOfficeArtifactAttempt(
  workId: Id<"spectraArtifacts">,
  content: unknown,
  attempt: number,
  options?: NativeMaterializationOptions,
) {
  let cloudTruth: Awaited<ReturnType<typeof fetchVerifiedNativePayload>>["truth"];
  let cloudPayload: Uint8Array;
  let workTruth: WorkTruth;
  try {
    [{ truth: cloudTruth, payload: cloudPayload }, workTruth] =
      await Promise.all([
        fetchVerifiedNativePayload(workId, "cloud"),
        convexQuery<{ workId: Id<"spectraArtifacts"> }, WorkTruth>(
          "replicas:forWork",
          { workId },
        ),
      ]);
  } catch (error) {
    // Library import commits projection/stub without a cloud replica payload URL.
    if (error instanceof Error && error.message === "NATIVE_PAYLOAD_UNAVAILABLE") {
      if (options?.prepareOnly) throw error;
      return {
        state: "deferred_native" as const,
        status:
          "Spectra saved your edit. Open this file from Library with the Spectra bridge connected to update the Office copy on this computer.",
      };
    }
    throw error;
  }
  const isSheet = spreadsheetFormats.has(cloudTruth.nativeFormat);
  const materializationContent = isSheet
    ? content
    : await hydratePresentationLinkedCharts(content);
  let materializationTruth = cloudTruth;
  let materializationPayload = cloudPayload;
  let baseOpened = isSheet
    ? await xlsxLens.open(cloudPayload)
    : await pptxLens.open(cloudPayload);
  let baseProjection = baseOpened.projection as OfficeProjection;
  let update = isSheet
    ? xlsxProjectionUpdateFromContent(materializationContent, baseProjection as XlsxProjection)
    : pptxProjectionUpdateFromContent(
        materializationContent,
        baseProjection as PptxProjection,
        { objectLists: "complete" },
      );
  if (attempt > 0) {
    const local = await fetchVerifiedNativePayload(workId, "local-latest");
    const ancestor = await storedOfficeBase(workId, cloudTruth, cloudPayload, isSheet);
    const latest = isSheet
      ? await xlsxLens.open(local.payload)
      : await pptxLens.open(local.payload);
    const ours = isSheet
      ? xlsxProjectionFromContent(
          materializationContent,
          ancestor.projection as XlsxProjection,
        )
      : pptxProjectionFromContent(
          materializationContent,
          ancestor.projection as PptxProjection,
          { objectLists: "complete" },
        );
    const rebased = isSheet
      ? mergeOfficeProjection(
          ancestor.projection as XlsxProjection,
          ours as XlsxProjection,
          latest.projection as XlsxProjection,
          true,
        )
      : mergeOfficeProjection(
          ancestor.projection as PptxProjection,
          ours as PptxProjection,
          latest.projection as PptxProjection,
          false,
        );
    if (rebased.conflicts.length) {
      await convexMutation("replicas:recordExternalReconciliation", {
        workId,
        localReplicaId: local.truth.replicaId as Id<"workReplicas">,
        localPayloadRef: local.truth.payloadRef,
        localRevision: local.truth.revision,
        content: contentForStorage(ours as OfficeProjection, isSheet, {
          artifactId: String(workId),
          payloadHash: local.truth.hash,
        }),
        fidelityMap: convexSafeFidelityMap(latest.fidelityMap),
        regionIds: rebased.externalChanged,
        partNames: [],
        conflictRegionIds: rebased.conflicts.map((conflict) =>
          String((conflict as { id?: unknown }).id ?? "office:region"),
        ),
        previews: rebased.previews,
      });
      return {
        state: "conflicted" as const,
        conflict: {
          regionIds: rebased.conflicts.map((conflict) =>
            String((conflict as { id?: unknown }).id ?? "office:region"),
          ),
          previews: rebased.previews,
          message: `${isSheet ? "Excel" : "PowerPoint"} and Spectra changed the same region. Choose which version to keep.`,
        },
      };
    }
    materializationTruth = local.truth;
    materializationPayload = local.payload;
    baseOpened = latest as typeof baseOpened;
    baseProjection = latest.projection as OfficeProjection;
    update = isSheet
      ? xlsxProjectionUpdateFromContent(
          rebased.projection,
          latest.projection as XlsxProjection,
        )
      : pptxProjectionUpdateFromContent(
          rebased.projection,
          latest.projection as PptxProjection,
          { objectLists: "complete" },
        );
  }
  const projection = update.projection as OfficeProjection;
  const regionIds = changedRegions(baseProjection, projection, isSheet);
  const output = update.operations.length
    ? isSheet
      ? await xlsxLens.mutate(
          (baseOpened as Awaited<ReturnType<typeof xlsxLens.open>>)
            .preservedCarry,
          { kind: "ai-edit", operations: update.operations as XlsxOperation[] },
        )
      : await pptxLens.mutate(
          (baseOpened as Awaited<ReturnType<typeof pptxLens.open>>)
            .preservedCarry,
          { kind: "ai-edit", operations: update.operations as PptxOperation[] },
        )
    : materializationPayload;
  const hash = await sha256Payload(output);
  const invalidatesFormulaCaches = update.operations.some(operation =>
    ["set-cell", "set-formula", "clear-cell", "rename-sheet", "reorder-sheets", "set-defined-names", "mutate-sheet-axis"].includes(operation.kind));
  const requestedDigest = isSheet
    ? await xlsxSemanticDigest({
        ...(projection as XlsxProjection),
        sheets: (projection as XlsxProjection).sheets.map(sheet => ({
          ...sheet,
          cells: sheet.cells.map(cell => invalidatesFormulaCaches && cell.formula ? { ...cell, value: null } : cell),
        })),
      })
    : await sha256Payload(new TextEncoder().encode(JSON.stringify(
        (projection as PptxProjection).slides.map(({ id, title, text, objects, hidden, speakerNotes }) => ({ id, title, text, objects, hidden, speakerNotes })),
      )));
  if (hash === materializationTruth.hash) {
    const readbackDigest = isSheet
      ? await xlsxSemanticDigest(baseProjection as XlsxProjection)
      : await sha256Payload(new TextEncoder().encode(JSON.stringify(
          (baseProjection as PptxProjection).slides.map(({ id, title, text, objects, hidden, speakerNotes }) => ({ id, title, text, objects, hidden, speakerNotes })),
        )));
    if (readbackDigest !== requestedDigest)
      throw new Error("OFFICE_READBACK_MISMATCH");
    const unchanged = {
      state: "unchanged" as const,
      hash,
      projectionContent: contentForStorage(baseProjection, isSheet, {
        artifactId: String(workId),
        payloadHash: materializationTruth.hash,
      }),
      receipt: {
        kind: "native-office-save" as const,
        format: isSheet ? "xlsx" as const : "pptx" as const,
        operationId: nativeOperationId(String(workId), materializationTruth.revision, hash),
        artifactId: String(workId),
        basePayloadHash: materializationTruth.hash,
        resultPayloadHash: hash,
        baseRevision: materializationTruth.revision,
        resultRevision: hash,
        targets: { regionIds: [], partNames: [] },
        semantic: { resultDigest: requestedDigest, readbackDigest },
        preservedPartNames: [],
        state: "unchanged" as const,
      } satisfies NativeSaveReceipt,
    };
    if (options?.prepareOnly)
      return preparedNativeMaterialization(materializationTruth, {
        destination: "none",
        unchanged: {
          sourcePayloadRef: materializationTruth.payloadRef,
          sourceHash: materializationTruth.hash,
          resultPayloadRef: materializationTruth.payloadRef,
          resultHash: hash,
          readbackProjectionHash: readbackDigest,
          preservationEvidence: unchanged.receipt,
        },
      }, unchanged.projectionContent, hash);
    return unchanged;
  }
  const [next, comparison] = await Promise.all([
    isSheet ? xlsxLens.open(output) : pptxLens.open(output),
    comparePackages(materializationPayload, output),
  ]);
  const readbackDigest = (next.projection as OfficeProjection).nativeBinding.semanticDigest;
  // Editor projections retain the imported binding. Its digest is the base,
  // never an attestation of the requested edit. Input edits deliberately clear
  // all native formula caches; Excel will calculate them on reopen.
  if (readbackDigest !== requestedDigest) {
    throw new Error("OFFICE_READBACK_MISMATCH");
  }
  /**
   * The preservation promise, checked against the bytes before anything is
   * queued. Every other preservation check in Spectra is a declaration — a
   * command naming the regions it writes, a gate trusting that name. This one
   * trusts nothing: if the lens said a part is preserved and the part came back
   * with different content, the write is refused here, on the one path both a
   * person's edit and the assistant's edit go through. So the two cannot diverge
   * by caller, and neither can be preserved-safe merely by accident.
   */
  await assertNativePreservationKept({
    entries: baseOpened.fidelityMap.entries,
    parts: comparison.parts,
    before: baseOpened.preservedCarry.safePayload ?? materializationPayload,
    after: next.preservedCarry.safePayload ?? output,
    intent: isSheet
      ? { format: "xlsx", projection: baseProjection as XlsxProjection, operations: update.operations as XlsxOperation[] }
      : { format: "pptx", projection: baseProjection as PptxProjection, operations: update.operations as PptxOperation[] },
  });
  const local = workTruth.replicas.find(
    (replica) => replica.kind === "local" && replica.state !== "unavailable",
  );
  const changedPartNames = comparison.parts.filter((part) => part.verdict !== "identical").map((part) => `/${part.name}`);
  const nativeReceipt: NativeSaveReceipt = {
    kind: "native-office-save",
    format: isSheet ? "xlsx" : "pptx",
    operationId: nativeOperationId(String(workId), materializationTruth.revision, hash),
    artifactId: String(workId),
    basePayloadHash: materializationTruth.hash,
    resultPayloadHash: hash,
    baseRevision: materializationTruth.revision,
    resultRevision: hash,
    targets: { regionIds, partNames: changedPartNames },
    semantic: { baseDigest: baseProjection.nativeBinding.semanticDigest, resultDigest: requestedDigest, readbackDigest },
    preservedPartNames: comparison.parts.filter((part) => part.verdict === "identical").map((part) => `/${part.name}`),
    state: local ? "pending" : "cloud_saved",
  };
  const stored = await uploadNativePayload(workId, output, hash, materializationTruth.nativeFormat);
  const projectionContent = contentForStorage(next.projection as OfficeProjection, isSheet, { artifactId: String(workId), payloadHash: hash });
  const cloudArgs: CloudMaterializationArgs = {
    workId, payloadRef: stored.payloadRef, contentHash: hash, baseRevision: materializationTruth.revision,
    projectionContent, projectionContentHash: readbackDigest,
    fidelityMap: convexSafeFidelityMap(next.fidelityMap), nativeReceipt,
  };
  const queueArgs = (): QueueMaterializationArgs => ({
    workId, payloadRef: stored.payloadRef, contentHash: hash, baseRevision: materializationTruth.revision,
    fidelityMap: convexSafeFidelityMap(next.fidelityMap), regionIds, partNames: changedPartNames,
    localReplicaId: local?._id as Id<"workReplicas"> | undefined,
    baseContent: contentForStorage(baseProjection, isSheet, { artifactId: String(workId), payloadHash: materializationTruth.hash }),
    baseContentHash: baseProjection.nativeBinding.semanticDigest,
    projectionContent, projectionContentHash: readbackDigest,
    nativeReceipt,
    ...(options?.promotionMode ? { promotionMode: options.promotionMode } : {}),
  });
  if (options?.prepareOnly)
    return preparedNativeMaterialization(materializationTruth,
      local ? { destination: "bridge", queue: queueArgs() } : { destination: "cloud", cloud: cloudArgs },
      projectionContent, hash);
  const saveCloud = () => convexMutation("replicas:commitCloudMaterialization", cloudArgs);
  if (!local) {
    await saveCloud();
    return {
      state: "cloud_saved" as const,
      hash,
      projectionContent,
      receipt: nativeReceipt,
      status:
        "Spectra saved your edit. Open this file from Library with the Spectra bridge connected to update the Office copy on this computer.",
    };
  }
  let queued: { requestId: string; state: string };
  try {
    queued = await convexMutation<QueueMaterializationArgs, { requestId: string; state: string }>(
      "replicas:queueMaterialization", queueArgs(),
    );
  } catch (error) {
    if (
      attempt === 0 &&
      error instanceof Error &&
      error.message.includes("MATERIALIZATION_BASE_STALE")
    )
      return materializeOfficeArtifactAttempt(workId, content, attempt + 1, options);
    if (
      error instanceof Error &&
      error.message.includes("LOCAL_REPLICA_UNAVAILABLE")
    ) {
      await saveCloud();
      return {
        state: "cloud_saved" as const,
        hash,
        projectionContent: contentForStorage(next.projection as OfficeProjection, isSheet, { artifactId: String(workId), payloadHash: hash }),
        receipt: nativeReceipt,
        status:
          "Spectra saved your edit. Open this file from Library with the Spectra bridge connected to update the Office copy on this computer.",
      };
    }
    throw error;
  }
  if (queued.state !== "pending")
    throw new Error(`MATERIALIZATION_NOT_PENDING:${queued.state}`);
  return {
    state: queued.state,
    requestId: queued.requestId,
    hash,
    projectionContent: contentForStorage(next.projection as OfficeProjection, isSheet, { artifactId: String(workId), payloadHash: hash }),
    receipt: nativeReceipt,
    status: "Waiting to save locally",
  };
}

function changedRegions(
  before: OfficeProjection,
  after: OfficeProjection,
  isSheet: boolean,
) {
  return isSheet
    ? xlsxChangedRegions(before as XlsxProjection, after as XlsxProjection)
    : pptxChangedRegions(before as PptxProjection, after as PptxProjection);
}

export function mergeOfficeProjection(
  base: OfficeProjection,
  current: OfficeProjection,
  external: OfficeProjection,
  isSheet: boolean,
  resolution?: "spectra" | "external",
) {
  return isSheet
    ? mergeXlsxProjections(
        base as XlsxProjection,
        current as XlsxProjection,
        external as XlsxProjection,
        resolution,
      )
    : mergePptxProjections(
        base as PptxProjection,
        current as PptxProjection,
        external as PptxProjection,
        resolution,
      );
}

async function storedOfficeBase(
  workId: Id<"spectraArtifacts">,
  truth: Awaited<ReturnType<typeof fetchVerifiedNativePayload>>["truth"],
  fallback: Uint8Array,
  isSheet: boolean,
) {
  const basePayload = await fetchStoredNativeBase(workId, truth, fallback);
  return isSheet ? xlsxLens.open(basePayload) : pptxLens.open(basePayload);
}

async function commitOfficeNative(
  workId: Id<"spectraArtifacts">,
  local: Awaited<ReturnType<typeof fetchVerifiedNativePayload>>,
  base: OfficeProjection,
  external: OfficeProjection,
  fidelityMap: unknown,
  partNames: string[],
  isSheet: boolean,
  nativeBasePayloadHash: string,
  cloud: Awaited<ReturnType<typeof fetchVerifiedNativePayload>>,
  initialContent: unknown,
  keepLocal = false,
) {
  return reconcileNativeRevision({ workId, localReplicaId: local.truth.replicaId as Id<"workReplicas">,
    localPayloadRef: local.truth.payloadRef, localRevision: local.truth.revision }, {
    typeKey: isSheet ? "sheets" : "presentation", fidelityMap: convexSafeFidelityMap(fidelityMap), partNames,
    nativeBaseRevision: local.truth.projectionBaseRevision ?? local.truth.baseRevision ?? null,
    nativeBasePayloadHash,
    initialContent, cloudSource: cloud.truth,
    ...(keepLocal ? { resolution: "local" as const } : {}),
    merge: currentContent => {
      const current = projectionFor(currentContent, base, isSheet);
      const merged = mergeOfficeProjection(base, current, external, isSheet);
      return { content: contentFor(keepLocal ? external : merged.projection, isSheet,
        { artifactId: String(workId), payloadHash: local.truth.hash }), regionIds: merged.externalChanged,
        conflictRegionIds: keepLocal ? [] : merged.conflicts.map(conflict => String((conflict as { id?: unknown }).id ?? "office:region")),
        previews: merged.previews };
    },
  });
}

export async function POST(request: Request) {
  let application: "Excel" | "PowerPoint" | "Office" = "Office";
  try {
    const input = schema.parse(await request.json());
    const workId = id(input.artifactId);
    if (input.action === "materialize") {
      await ensureImportedNativePayload(workId);
      if (input.content === undefined) {
        // Yjs appends are durable before the public artifact projection is
        // checkpointed. Flush that authenticated durable head before reading
        // the native-save input; never ship the full workbook from the browser.
        await checkpointArtifactDurableContent(input.artifactId);
        const artifact = await convexQuery<
          { artifactId: Id<"spectraArtifacts"> },
          ArtifactTruth
        >("spectraArtifacts:get", { artifactId: workId });
        input.content = artifact.content;
      } else {
        input.content = await hydrateContentForWrite(input.artifactId, input.content);
      }
    }
    let cloud: Awaited<ReturnType<typeof fetchVerifiedNativePayload>>;
    try {
      cloud = await fetchVerifiedNativePayload(workId, "cloud");
    } catch (error) {
      if (error instanceof Error && error.message === "NATIVE_PAYLOAD_UNAVAILABLE") {
        if (input.action === "open") {
          return NextResponse.json({ state: "opened", deferredNative: true });
        }
        if (input.action === "materialize") {
          return NextResponse.json({
            state: "deferred_native",
            status:
              "Spectra saved your edit. Open this file from Library with the Spectra bridge connected to update the Office copy on this computer.",
          });
        }
      }
      throw error;
    }
    const isSheet = spreadsheetFormats.has(cloud.truth.nativeFormat);
    application = isSheet ? "Excel" : "PowerPoint";
    const baseOpened = isSheet
      ? await xlsxLens.open(cloud.payload)
      : await pptxLens.open(cloud.payload);

    if (input.action === "open") {
      try {
        const local = await fetchVerifiedNativePayload(workId, "local-latest");
        const workTruth = await convexQuery<
          { workId: Id<"spectraArtifacts"> },
          WorkTruth
        >("replicas:forWork", { workId });
        const externalNeedsActivation = shouldActivateExternalNativeRevision({
          operations: workTruth.recentOperations,
          localHash: local.truth.hash,
          cloudHash: cloud.truth.hash,
        });
        if (externalNeedsActivation) {
          const externalOpened = isSheet ? await xlsxLens.open(local.payload) : await pptxLens.open(local.payload);
          const ancestorOpened = await storedOfficeBase(workId, local.truth, cloud.payload, isSheet);
          const diff = isSheet ? await xlsxLens.diffExternal(ancestorOpened.preservedCarry.payload, local.payload)
            : await pptxLens.diffExternal(ancestorOpened.preservedCarry.payload, local.payload);
          const recorded = await commitOfficeNative(workId, local, ancestorOpened.projection as OfficeProjection,
            externalOpened.projection as OfficeProjection, externalOpened.fidelityMap, diff.preservedPartChanges, isSheet,
            await sha256Payload(ancestorOpened.preservedCarry.payload), cloud,
            contentFor(baseOpened.projection as OfficeProjection, isSheet, { artifactId: String(workId), payloadHash: cloud.truth.hash }));
          return NextResponse.json({ state: recorded.state === "applied" ? "opened" : "conflicted",
            durableNative: true, receipt: recorded.receipt,
            ...(recorded.state === "applied" ? { content: recorded.content,
              fidelityMap: convexSafeFidelityMap(externalOpened.fidelityMap), capabilities: externalOpened.capabilities } : {
              conflict: { regionIds: recorded.conflictRegionIds, previews: recorded.previews,
                message: "The Office file and Spectra changed the same regions. Choose which version to keep." },
            }),
          });
        }
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "NATIVE_PAYLOAD_UNAVAILABLE"
        )
          throw error;
      }
      const baseProjection = baseOpened.projection as OfficeProjection;
      const content = contentFor(baseProjection, isSheet, {
        artifactId: String(workId),
        payloadHash: cloud.truth.hash,
      });
      const activation = await convexMutation<Record<string, unknown>, { activated: boolean }>("replicas:activateLens", {
        workId,
        payloadHash: cloud.truth.hash,
        content: encodeArtifactContentForStorage(
          isSheet ? "sheets" : "presentation",
          content,
        ),
        fidelityMap: convexSafeFidelityMap(baseOpened.fidelityMap),
        semanticDigest: baseProjection.nativeBinding.semanticDigest,
        nativeFormat: baseProjection.nativeBinding.format,
        blueprintKey: isSheet ? "sheets" : "presentation",
        textIndex: isSheet
          ? (baseProjection as XlsxProjection).sheets
              .flatMap((sheet) =>
                sheet.cells.map((cell) => String(cell.value ?? "")),
              )
              .join("\n")
              .slice(0, 200_000)
          : (baseProjection as PptxProjection).slides
              .flatMap((slide) => slide.text)
              .join("\n")
              .slice(0, 200_000),
      });
      if (!activation.activated) return NextResponse.json({ state: "opened" });
      return NextResponse.json({
        state: "opened",
        content,
        fidelityMap: convexSafeFidelityMap(baseOpened.fidelityMap),
        capabilities: baseOpened.capabilities,
      });
    }

    let baseProjection = baseOpened.projection as OfficeProjection;

    if (input.action === "materialize") {
      return NextResponse.json(
        await materializeOfficeArtifact(workId, input.content),
      );
    }

    const [local, artifact] = await Promise.all([
      fetchVerifiedNativePayload(workId, "local-latest"),
      convexQuery<{ artifactId: Id<"spectraArtifacts"> }, ArtifactTruth>(
        "spectraArtifacts:get",
        { artifactId: workId },
      ),
    ]);
    if (cloud.truth.hash === local.truth.hash && !input.resolution) return NextResponse.json({ state: "current" });
    const basePayload = await fetchStoredNativeBase(workId, local.truth, cloud.payload);
    const [ancestorOpened, externalOpened, diff] = await Promise.all([
      isSheet ? xlsxLens.open(basePayload) : pptxLens.open(basePayload),
      isSheet ? xlsxLens.open(local.payload) : pptxLens.open(local.payload),
      isSheet
        ? xlsxLens.diffExternal(basePayload, local.payload)
        : pptxLens.diffExternal(basePayload, local.payload),
    ]);
    baseProjection = ancestorOpened.projection as OfficeProjection;
    const externalProjection = externalOpened.projection as OfficeProjection;
    if (input.resolution === "spectra") {
      const currentProjection = projectionFor(artifact.content, baseProjection, isSheet);
      const mergedResult = mergeOfficeProjection(baseProjection, currentProjection, externalProjection, isSheet);
      const conflictRegionIds = mergedResult.conflicts.map((conflict) =>
        String((conflict as { id?: unknown }).id ?? "office:region"),
      );
      const resolved = mergeOfficeProjection(
        baseProjection,
        currentProjection,
        externalProjection,
        isSheet,
        "spectra",
      );
      const output = isSheet
        ? await xlsxLens.materialize({
            projection: resolved.projection as XlsxProjection,
            carry: (externalOpened as Awaited<ReturnType<typeof xlsxLens.open>>)
              .preservedCarry,
          })
        : await pptxLens.materialize({
            projection: resolved.projection as PptxProjection,
            carry: (externalOpened as Awaited<ReturnType<typeof pptxLens.open>>)
              .preservedCarry,
          });
      const hash = await sha256Payload(output);
      const [next, comparison] = await Promise.all([
        isSheet ? xlsxLens.open(output) : pptxLens.open(output),
        comparePackages(local.payload, output),
      ]);
      const stored = await uploadNativePayload(
        workId,
        output,
        hash,
        local.truth.nativeFormat,
      );
      const queued = await convexMutation("replicas:queueMaterialization", {
        workId,
        payloadRef: stored.payloadRef,
        contentHash: hash,
        baseRevision: local.truth.revision,
        fidelityMap: convexSafeFidelityMap(next.fidelityMap),
        regionIds: [
          ...new Set([...resolved.spectraChanged, ...conflictRegionIds]),
        ],
        partNames: comparison.parts
          .filter((part) => part.verdict !== "identical")
          .map((part) => `/${part.name}`),
        localReplicaId: local.truth.replicaId as Id<"workReplicas">,
        projectionContent: contentForStorage(
          next.projection as OfficeProjection,
          isSheet,
          { artifactId: String(workId), payloadHash: hash },
        ),
        projectionContentHash: (next.projection as OfficeProjection)
          .nativeBinding.semanticDigest,
      });
      if ((queued as { state: string }).state !== "pending") {
        throw new Error(
          "Spectra prepared your version but could not queue the file update. Nothing was overwritten. Try Keep Spectra again.",
        );
      }
      await convexMutation("replicas:resolveExternalConflict", {
        workId,
        resolution: "spectra",
        requestId: (queued as { requestId: string }).requestId,
      });
      return NextResponse.json({
        state: "applied",
        projection: contentFor(next.projection as OfficeProjection, isSheet, {
          artifactId: String(workId),
          payloadHash: hash,
        }),
        attribution: "Kept your Spectra version",
        requestId: (queued as { requestId: string }).requestId,
        status: "Waiting to save your Spectra version locally",
      });
    }

    const recorded = await commitOfficeNative(workId, local, baseProjection, externalProjection,
      externalOpened.fidelityMap, diff.preservedPartChanges, isSheet, await sha256Payload(basePayload), cloud,
      contentFor(baseOpened.projection as OfficeProjection, isSheet, { artifactId: String(workId), payloadHash: cloud.truth.hash }),
      input.resolution === "local");
    return NextResponse.json({ state: recorded.state, durableNative: true, receipt: recorded.receipt,
      ...(recorded.state === "applied" ? { projection: recorded.content, attribution: `Edited in ${application}` } : {
        conflict: { regionIds: recorded.conflictRegionIds, previews: recorded.previews,
          message: `${application} and Spectra changed the same regions. Choose which version to keep.` },
      }),
    });
  } catch (error) {
    const code = officeLensErrorCode(error);
    console.error("[office lens]", error instanceof Error ? error.message : code);
    return NextResponse.json(
      {
        error: code,
        message: humanizePublicFailure(error, application),
      },
      { status: /NATIVE_RECONCILIATION_BUSY|EXTERNAL_RESOLUTION_STALE|EXTERNAL_NATIVE_BASE_CHANGED/.test(String(error)) ? 409 : 400 },
    );
  }
}
