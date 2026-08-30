import { NextResponse } from "next/server";
import { comparePackages } from "@ariadng/office/preservation";
import { assertPreservationKept } from "@/features/spectra/commands/office/preservation-guard";
import { z } from "zod";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { sha256Payload } from "@/features/spectra/lenses/payload-hash";
import {
  fetchVerifiedNativePayload,
  fetchStoredNativeBase,
  uploadNativePayload,
} from "@/features/spectra/lenses/native-payload-server";
import {
  hasUnreconciledExternalRevision,
  type RecentNativeOperation,
} from "@/features/spectra/lenses/native-reconciliation";
import {
  type XlsxProjection,
  type XlsxSemanticDelta,
} from "@/features/spectra/lenses/xlsx-lens";
import {
  type PptxProjection,
  type PptxSemanticDelta,
} from "@/features/spectra/lenses/pptx-lens";
import {
  registeredLens,
  requireLensRegistration,
} from "@/features/spectra/lenses/registry";
import type {
  PptxOperation,
  XlsxOperation,
} from "@/features/spectra/lenses/projection-contracts";
import {
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
import { encodeArtifactContentForStorage } from "../../../../../../shared/sheet-cells";

// Compatibility exports for existing callers. The implementation lives in the
// canonical office-content module; routes only re-export the shared transform.
export {
  pptxProjectionFromContent as contentToPptx,
  xlsxProjectionFromContent as contentToXlsx,
} from "@/features/spectra/lenses/office-content";

export const runtime = "nodejs";

const xlsxLens = registeredLens<XlsxProjection, XlsxSemanticDelta>("xlsx");
const pptxLens = registeredLens<PptxProjection, PptxSemanticDelta>("pptx");

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), artifactId: z.string().min(1) }),
  z.object({
    action: z.literal("materialize"),
    artifactId: z.string().min(1),
    content: z.unknown(),
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
type ArtifactTruth = { content: unknown };
type OfficeProjection = XlsxProjection | PptxProjection;

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
function isSpreadsheetFormat(nativeFormat: string) {
  const row = requireLensRegistration(nativeFormat);
  if (row.canonicalFormat !== "xlsx" && row.canonicalFormat !== "pptx") {
    throw new Error(
      `The Office route cannot open ${nativeFormat}; its registered lens belongs to ${row.workType}.`,
    );
  }
  return row.workType === "sheets";
}
function contentFor(projection: OfficeProjection, isSheet: boolean) {
  return isSheet
    ? xlsxArtifactContent(projection as XlsxProjection)
    : pptxArtifactContent(projection as PptxProjection);
}
function contentForStorage(projection: OfficeProjection, isSheet: boolean) {
  return encodeArtifactContentForStorage(
    isSheet ? "sheets" : "presentation",
    contentFor(projection, isSheet),
  );
}
export function projectionFor(
  content: unknown,
  base: OfficeProjection,
  isSheet: boolean,
) {
  return isSheet
    ? xlsxProjectionFromContent(content, base as XlsxProjection)
    : pptxProjectionFromContent(content, base as PptxProjection);
}

/** Queue one verified XLSX/PPTX payload for the Bridge. AI and human edits
 * must share this path so native writes cannot diverge by caller. */
export async function materializeOfficeArtifact(
  workId: Id<"spectraArtifacts">,
  content: unknown,
) {
  return materializeOfficeArtifactAttempt(workId, content, 0);
}

async function materializeOfficeArtifactAttempt(
  workId: Id<"spectraArtifacts">,
  content: unknown,
  attempt: number,
) {
  const [{ truth: cloudTruth, payload: cloudPayload }, workTruth] =
    await Promise.all([
      fetchVerifiedNativePayload(workId, "cloud"),
      convexQuery<{ workId: Id<"spectraArtifacts"> }, WorkTruth>(
        "replicas:forWork",
        { workId },
      ),
    ]);
  const isSheet = isSpreadsheetFormat(cloudTruth.nativeFormat);
  let materializationTruth = cloudTruth;
  let materializationPayload = cloudPayload;
  let baseOpened = isSheet
    ? await xlsxLens.open(cloudPayload)
    : await pptxLens.open(cloudPayload);
  let baseProjection = baseOpened.projection as OfficeProjection;
  let update = isSheet
    ? xlsxProjectionUpdateFromContent(content, baseProjection as XlsxProjection)
    : pptxProjectionUpdateFromContent(
        content,
        baseProjection as PptxProjection,
      );
  if (attempt > 0) {
    const local = await fetchVerifiedNativePayload(workId, "local-latest");
    const ancestor = await storedOfficeBase(cloudTruth, cloudPayload, isSheet);
    const latest = isSheet
      ? await xlsxLens.open(local.payload)
      : await pptxLens.open(local.payload);
    const ours = isSheet
      ? xlsxProjectionFromContent(
          content,
          ancestor.projection as XlsxProjection,
        )
      : pptxProjectionFromContent(
          content,
          ancestor.projection as PptxProjection,
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
        content: contentForStorage(ours as OfficeProjection, isSheet),
        fidelityMap: latest.fidelityMap,
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
  if (hash === materializationTruth.hash)
    return { state: "unchanged" as const, hash };
  const [next, comparison] = await Promise.all([
    isSheet ? xlsxLens.open(output) : pptxLens.open(output),
    comparePackages(materializationPayload, output),
  ]);
  /**
   * The preservation promise, checked against the bytes before anything is
   * queued. Every other preservation check in Spectra is a declaration — a
   * command naming the regions it writes, a gate trusting that name. This one
   * trusts nothing: if the lens said a part is preserved and the part came back
   * with different content, the write is refused here, on the one path both a
   * person's edit and the assistant's edit go through. So the two cannot diverge
   * by caller, and neither can be preserved-safe merely by accident.
   */
  assertPreservationKept({
    entries: baseOpened.fidelityMap.entries,
    parts: comparison.parts,
  });
  const stored = await uploadNativePayload(
    workId,
    output,
    hash,
    materializationTruth.nativeFormat,
  );
  const local = workTruth.replicas.find(
    (replica) => replica.kind === "local" && replica.state !== "unavailable",
  );
  if (!local) {
    return {
      state: "cloud_saved" as const,
      hash,
      status:
        "Spectra saved your edit. Open this file from Library with the Spectra bridge connected to update the Office copy on this computer.",
    };
  }
  let queued: { state: string; requestId: string };
  try {
    queued = await convexMutation("replicas:queueMaterialization", {
      workId,
      payloadRef: stored.payloadRef,
      contentHash: hash,
      baseRevision: materializationTruth.revision,
      fidelityMap: next.fidelityMap,
      regionIds,
      partNames: comparison.parts
        .filter((part) => part.verdict !== "identical")
        .map((part) => `/${part.name}`),
      localReplicaId: local._id as Id<"workReplicas">,
      baseContent: contentForStorage(baseProjection, isSheet),
      baseContentHash: baseProjection.nativeBinding.semanticDigest,
      projectionContent: contentForStorage(
        next.projection as OfficeProjection,
        isSheet,
      ),
      projectionContentHash: (next.projection as OfficeProjection).nativeBinding
        .semanticDigest,
    });
  } catch (error) {
    if (
      attempt === 0 &&
      error instanceof Error &&
      error.message.includes("MATERIALIZATION_BASE_STALE")
    )
      return materializeOfficeArtifactAttempt(workId, content, attempt + 1);
    throw error;
  }
  return {
    state: queued.state,
    requestId: queued.requestId,
    hash,
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
  truth: Awaited<ReturnType<typeof fetchVerifiedNativePayload>>["truth"],
  fallback: Uint8Array,
  isSheet: boolean,
) {
  const basePayload = await fetchStoredNativeBase(truth, fallback);
  return isSheet ? xlsxLens.open(basePayload) : pptxLens.open(basePayload);
}

export async function POST(request: Request) {
  let application: "Excel" | "PowerPoint" | "Office" = "Office";
  try {
    const input = schema.parse(await request.json());
    const workId = id(input.artifactId);
    let cloud = await fetchVerifiedNativePayload(workId, "cloud");
    const isSheet = isSpreadsheetFormat(cloud.truth.nativeFormat);
    application = isSheet ? "Excel" : "PowerPoint";
    let baseOpened = isSheet
      ? await xlsxLens.open(cloud.payload)
      : await pptxLens.open(cloud.payload);

    if (input.action === "open") {
      try {
        const local = await fetchVerifiedNativePayload(workId, "local-latest");
        const workTruth = await convexQuery<
          { workId: Id<"spectraArtifacts"> },
          WorkTruth
        >("replicas:forWork", { workId });
        const externalRevision = hasUnreconciledExternalRevision(
          workTruth.recentOperations,
          local.truth.hash,
        );
        const externalNeedsActivation = Boolean(
          local.truth.hash !== cloud.truth.hash || externalRevision,
        );
        if (externalNeedsActivation) {
          const [artifact, externalOpened] = await Promise.all([
            convexQuery<{ artifactId: Id<"spectraArtifacts"> }, ArtifactTruth>(
              "spectraArtifacts:get",
              { artifactId: workId },
            ),
            isSheet
              ? xlsxLens.open(local.payload)
              : pptxLens.open(local.payload),
          ]);
          const ancestorOpened = await storedOfficeBase(
            local.truth,
            local.payload,
            isSheet,
          );
          const current = projectionFor(
            artifact.content,
            ancestorOpened.projection as OfficeProjection,
            isSheet,
          );
          const externalProjection =
            externalOpened.projection as OfficeProjection;
          const mergedResult = mergeOfficeProjection(
            ancestorOpened.projection as OfficeProjection,
            current,
            externalProjection,
            isSheet,
          );
          const conflictRegionIds = mergedResult.conflicts.map((conflict) =>
            String((conflict as { id?: unknown }).id ?? "office:region"),
          );
          if (conflictRegionIds.length) {
            await convexMutation("replicas:recordExternalReconciliation", {
              workId,
              localReplicaId: local.truth.replicaId as Id<"workReplicas">,
              localPayloadRef: local.truth.payloadRef,
              localRevision: local.truth.revision,
              content: contentForStorage(current, isSheet),
              fidelityMap: externalOpened.fidelityMap,
              regionIds: mergedResult.externalChanged,
              partNames: [],
              conflictRegionIds,
              previews: mergedResult.previews,
            });
            return NextResponse.json({
              state: "conflicted",
              conflict: {
                regionIds: conflictRegionIds,
                previews: mergedResult.previews,
                message:
                  "The Office file and Spectra changed the same regions. Choose which version to keep.",
              },
            });
          }
          const merged = mergedResult.projection;
          const diff = isSheet
            ? await xlsxLens.diffExternal(
                ancestorOpened.preservedCarry.payload,
                local.payload,
              )
            : await pptxLens.diffExternal(
                ancestorOpened.preservedCarry.payload,
                local.payload,
              );
          await convexMutation("replicas:recordExternalReconciliation", {
            workId,
            localReplicaId: local.truth.replicaId as Id<"workReplicas">,
            localPayloadRef: local.truth.payloadRef,
            localRevision: local.truth.revision,
            content: contentForStorage(merged, isSheet),
            fidelityMap: externalOpened.fidelityMap,
            regionIds: changedRegions(
              ancestorOpened.projection as OfficeProjection,
              externalProjection,
              isSheet,
            ),
            partNames: diff.preservedPartChanges,
            conflictRegionIds: [],
          });
          cloud = local;
          baseOpened = {
            ...externalOpened,
            projection: merged,
          } as typeof baseOpened;
        }
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "NATIVE_PAYLOAD_UNAVAILABLE"
        )
          throw error;
      }
      const baseProjection = baseOpened.projection as OfficeProjection;
      const content = contentFor(baseProjection, isSheet);
      await convexMutation("replicas:activateLens", {
        workId,
        payloadHash: cloud.truth.hash,
        content: encodeArtifactContentForStorage(
          isSheet ? "sheets" : "presentation",
          content,
        ),
        fidelityMap: baseOpened.fidelityMap,
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
      return NextResponse.json({
        state: "opened",
        content,
        fidelityMap: baseOpened.fidelityMap,
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
    if (cloud.truth.hash === local.truth.hash) {
      if (input.resolution === "spectra" || input.resolution === "local") {
        await convexMutation("replicas:resolveExternalConflict", {
          workId,
          resolution: input.resolution === "local" ? "local" : "spectra",
        });
        return NextResponse.json({
          state: "current",
          attribution:
            input.resolution === "local"
              ? `Kept the ${isSheet ? "Excel" : "PowerPoint"} version`
              : "Kept your Spectra version",
        });
      }
      return NextResponse.json({ state: "current" });
    }
    const basePayload = await fetchStoredNativeBase(cloud.truth, cloud.payload);
    const [ancestorOpened, externalOpened, diff] = await Promise.all([
      isSheet ? xlsxLens.open(basePayload) : pptxLens.open(basePayload),
      isSheet ? xlsxLens.open(local.payload) : pptxLens.open(local.payload),
      isSheet
        ? xlsxLens.diffExternal(basePayload, local.payload)
        : pptxLens.diffExternal(basePayload, local.payload),
    ]);
    baseProjection = ancestorOpened.projection as OfficeProjection;
    const externalProjection = externalOpened.projection as OfficeProjection;
    const currentProjection = projectionFor(
      artifact.content,
      baseProjection,
      isSheet,
    );
    const externalChanged = new Set(
      changedRegions(baseProjection, externalProjection, isSheet),
    );
    const mergedResult = mergeOfficeProjection(
      baseProjection,
      currentProjection,
      externalProjection,
      isSheet,
    );
    const conflictRegionIds = mergedResult.conflicts.map((conflict) =>
      String((conflict as { id?: unknown }).id ?? "office:region"),
    );

    if (input.resolution === "spectra") {
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
        fidelityMap: next.fidelityMap,
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
        projection: contentFor(next.projection as OfficeProjection, isSheet),
        attribution: "Kept your Spectra version",
        requestId: (queued as { requestId: string }).requestId,
        status: "Waiting to save your Spectra version locally",
      });
    }

    if (conflictRegionIds.length && input.resolution !== "local") {
      await convexMutation("replicas:recordExternalReconciliation", {
        workId,
        localReplicaId: local.truth.replicaId as Id<"workReplicas">,
        localPayloadRef: local.truth.payloadRef,
        localRevision: local.truth.revision,
        content: contentForStorage(currentProjection, isSheet),
        fidelityMap: externalOpened.fidelityMap,
        regionIds: [...externalChanged],
        partNames: diff.preservedPartChanges,
        conflictRegionIds,
        previews: mergedResult.previews,
      });
      return NextResponse.json({
        state: "conflicted",
        conflict: {
          regionIds: conflictRegionIds,
          previews: mergedResult.previews,
          message: `${isSheet ? "Excel" : "PowerPoint"} and Spectra changed the same region. Choose which version to keep.`,
        },
      });
    }
    const mergedProjection =
      input.resolution === "local"
        ? externalProjection
        : mergedResult.projection;
    const mergedContent = contentFor(mergedProjection, isSheet);
    const recorded = await convexMutation(
      "replicas:recordExternalReconciliation",
      {
        workId,
        localReplicaId: local.truth.replicaId,
        localPayloadRef: local.truth.payloadRef,
        localRevision: local.truth.revision,
        content: encodeArtifactContentForStorage(
          isSheet ? "sheets" : "presentation",
          mergedContent,
        ),
        fidelityMap: externalOpened.fidelityMap,
        regionIds: [...externalChanged],
        partNames: diff.preservedPartChanges,
        conflictRegionIds:
          input.resolution === "local" ? [] : conflictRegionIds,
        resolution: input.resolution === "local" ? "local" : undefined,
      },
    );
    return NextResponse.json({
      state: (recorded as { state: string }).state,
      ...((recorded as { state: string }).state === "applied"
        ? { projection: mergedContent, attribution: `Edited in ${application}` }
        : {
            conflict: {
              regionIds: conflictRegionIds,
              previews: mergedResult.previews,
              message: `${application} and Spectra changed the same ${isSheet ? "cell" : "slide"}. Choose which version to keep.`,
            },
          }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "OFFICE_LENS_FAILED",
        message: humanizePublicFailure(error, application),
      },
      { status: 400 },
    );
  }
}
