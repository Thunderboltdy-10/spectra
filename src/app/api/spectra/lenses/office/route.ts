import { NextResponse } from "next/server";
import { comparePackages } from "@ariadng/office/preservation";
import { assertPreservationKept } from "@/features/spectra/commands/office/preservation-guard";
import { z } from "zod";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { sha256Payload } from "@/features/spectra/lenses/docx-lens";
import {
  fetchVerifiedNativePayload,
  uploadNativePayload,
} from "@/features/spectra/lenses/native-payload-server";
import {
  xlsxLens,
  type XlsxProjection,
} from "@/features/spectra/lenses/xlsx-lens";
import {
  pptxLens,
  type PptxProjection,
} from "@/features/spectra/lenses/pptx-lens";
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

// Compatibility exports for existing callers. The implementation lives in the
// canonical office-content module; routes only re-export the shared transform.
export { pptxProjectionFromContent as contentToPptx, xlsxProjectionFromContent as contentToXlsx } from "@/features/spectra/lenses/office-content";

export const runtime = "nodejs";

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
  recentOperations?: Array<{
    direction?: string;
    state?: string;
    actorKind?: string;
    revisionAfter?: string;
  }>;
};
type ArtifactTruth = { content: unknown };
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
function contentFor(projection: OfficeProjection, isSheet: boolean) {
  return isSheet
    ? xlsxArtifactContent(projection as XlsxProjection)
    : pptxArtifactContent(projection as PptxProjection);
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
  const [{ truth: cloudTruth, payload: cloudPayload }, workTruth] =
    await Promise.all([
      fetchVerifiedNativePayload(workId, "cloud"),
      convexQuery<{ workId: Id<"spectraArtifacts"> }, WorkTruth>(
        "replicas:forWork",
        { workId },
      ),
    ]);
  const isSheet = spreadsheetFormats.has(cloudTruth.nativeFormat);
  const baseOpened = isSheet
    ? await xlsxLens.open(cloudPayload)
    : await pptxLens.open(cloudPayload);
  const baseProjection = baseOpened.projection as OfficeProjection;
  const update = isSheet
    ? xlsxProjectionUpdateFromContent(content, baseProjection as XlsxProjection)
    : pptxProjectionUpdateFromContent(content, baseProjection as PptxProjection);
  const projection = update.projection as OfficeProjection;
  const regionIds = changedRegions(baseProjection, projection, isSheet);
  const output = update.operations.length
    ? isSheet
      ? await xlsxLens.mutate(
          (baseOpened as Awaited<ReturnType<typeof xlsxLens.open>>).preservedCarry,
          { kind: "ai-edit", operations: update.operations as XlsxOperation[] },
        )
      : await pptxLens.mutate(
          (baseOpened as Awaited<ReturnType<typeof pptxLens.open>>).preservedCarry,
          { kind: "ai-edit", operations: update.operations as PptxOperation[] },
        )
    : cloudPayload;
  const hash = await sha256Payload(output);
  if (hash === cloudTruth.hash) return { state: "unchanged" as const, hash };
  const [next, comparison] = await Promise.all([
    isSheet ? xlsxLens.open(output) : pptxLens.open(output),
    comparePackages(cloudPayload, output),
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
  const stored = await uploadNativePayload(workId, output, hash, cloudTruth.nativeFormat);
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
  const queued = await convexMutation("replicas:queueMaterialization", {
    workId,
    payloadRef: stored.payloadRef,
    contentHash: hash,
    baseRevision: cloudTruth.revision,
    fidelityMap: next.fidelityMap,
    regionIds,
    partNames: comparison.parts
      .filter((part) => part.verdict !== "identical")
      .map((part) => `/${part.name}`),
    localReplicaId: local._id as Id<"workReplicas">,
    baseContent: contentFor(baseProjection, isSheet),
    baseContentHash: baseProjection.nativeBinding.semanticDigest,
  });
  return {
    state: (queued as { state: string }).state,
    requestId: (queued as { requestId: string }).requestId,
    hash,
    status: "Waiting to save locally",
  };
}

function changedRegions(
  before: OfficeProjection,
  after: OfficeProjection,
  isSheet: boolean,
) {
  if (isSheet) {
    const previous = new Map(
      (before as XlsxProjection).sheets.flatMap((sheet) =>
        sheet.cells.map((cell) => [cell.id, cell] as const),
      ),
    );
    const changed: string[] = [];
    for (const cell of (after as XlsxProjection).sheets.flatMap(
      (sheet) => sheet.cells,
    )) {
      const old = previous.get(cell.id);
      previous.delete(cell.id);
      if (!old || JSON.stringify(old) !== JSON.stringify(cell))
        changed.push(cell.id);
    }
    changed.push(...previous.keys());
    return [...new Set(changed)];
  }
  const previous = new Map(
    (before as PptxProjection).slides.map(
      (slide) => [slide.id, slide] as const,
    ),
  );
  const changed: string[] = [];
  for (const slide of (after as PptxProjection).slides) {
    const old = previous.get(slide.id);
    previous.delete(slide.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(slide))
      changed.push(slide.id);
  }
  changed.push(...previous.keys());
  return [...new Set(changed)];
}

function mergeExternalProjection(
  current: OfficeProjection,
  external: OfficeProjection,
  externalRegions: Set<string>,
  isSheet: boolean,
) {
  if (isSheet) {
    const externalBook = external as XlsxProjection;
    const externalCells = new Map(
      externalBook.sheets.flatMap((sheet) =>
        sheet.cells.map((cell) => [cell.id, cell] as const),
      ),
    );
    const merged = current as XlsxProjection;
    return {
      ...merged,
      sheets: merged.sheets.map((sheet) => {
        const existingIds = new Set(sheet.cells.map((cell) => cell.id));
        const cells = sheet.cells.flatMap((cell) =>
          externalRegions.has(cell.id)
            ? externalCells.get(cell.id)
              ? [externalCells.get(cell.id)!]
              : []
            : [cell],
        );
        const externalSheet = externalBook.sheets.find(
          (candidate) => candidate.id === sheet.id,
        );
        for (const cell of externalSheet?.cells ?? [])
          if (externalRegions.has(cell.id) && !existingIds.has(cell.id))
            cells.push(cell);
        return { ...sheet, cells };
      }),
    } as XlsxProjection;
  }
  const externalSlides = new Map(
    (external as PptxProjection).slides.map(
      (slide) => [slide.id, slide] as const,
    ),
  );
  const merged = current as PptxProjection;
  const slides = merged.slides.flatMap((slide) =>
    externalRegions.has(slide.id)
      ? externalSlides.get(slide.id)
        ? [externalSlides.get(slide.id)!]
        : []
      : [slide],
  );
  for (const slide of (external as PptxProjection).slides)
    if (
      externalRegions.has(slide.id) &&
      !slides.some((candidate) => candidate.id === slide.id)
    )
      slides.push(slide);
  return { ...merged, slides } as PptxProjection;
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const workId = id(input.artifactId);
    let cloud = await fetchVerifiedNativePayload(workId, "cloud");
    const isSheet = spreadsheetFormats.has(cloud.truth.nativeFormat);
    let baseOpened = isSheet
      ? await xlsxLens.open(cloud.payload)
      : await pptxLens.open(cloud.payload);

    if (input.action === "open") {
      try {
        const local = await fetchVerifiedNativePayload(workId, "local-latest");
        const workTruth = await convexQuery<{ workId: Id<"spectraArtifacts"> }, WorkTruth>(
          "replicas:forWork",
          { workId },
        );
        const externalRevision = workTruth.recentOperations?.find(
          (operation) =>
            operation.direction === "external" &&
            operation.actorKind === "external-edit" &&
            operation.revisionAfter === local.truth.hash,
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
            isSheet ? xlsxLens.open(local.payload) : pptxLens.open(local.payload),
          ]);
          const current = projectionFor(artifact.content, baseOpened.projection as OfficeProjection, isSheet);
          const externalProjection = externalOpened.projection as OfficeProjection;
          const externalChanged = new Set(
            local.truth.hash === cloud.truth.hash && externalRevision
              ? changedRegions(baseOpened.projection as OfficeProjection, current, isSheet)
              : changedRegions(baseOpened.projection as OfficeProjection, externalProjection, isSheet),
          );
          const spectraChanged = new Set(changedRegions(baseOpened.projection as OfficeProjection, current, isSheet));
          const conflictRegionIds =
            local.truth.hash === cloud.truth.hash && externalRevision
              ? []
              : [...externalChanged].filter((regionId) => spectraChanged.has(regionId));
          if (conflictRegionIds.length) {
            return NextResponse.json(
              { state: "conflicted", conflictRegionIds, message: "The Office file and Spectra changed the same regions. Review the conflict before opening." },
              { status: 409 },
            );
          }
          const merged = mergeExternalProjection(current, externalProjection, externalChanged, isSheet);
          await convexMutation("replicas:recordExternalReconciliation", {
            workId,
            localReplicaId: local.truth.replicaId as Id<"workReplicas">,
            localPayloadRef: local.truth.payloadRef,
            localRevision: local.truth.revision,
            content: contentFor(merged, isSheet),
            fidelityMap: externalOpened.fidelityMap,
            regionIds: [...externalChanged],
            partNames: [],
            conflictRegionIds: [],
          });
          cloud = local;
          baseOpened = { ...externalOpened, projection: merged } as typeof baseOpened;
        }
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "NATIVE_PAYLOAD_UNAVAILABLE") throw error;
      }
      const baseProjection = baseOpened.projection as OfficeProjection;
      const content = contentFor(baseProjection, isSheet);
      await convexMutation("replicas:activateLens", {
        workId,
        payloadHash: cloud.truth.hash,
        content,
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

    const baseProjection = baseOpened.projection as OfficeProjection;

    if (input.action === "materialize") {
      return NextResponse.json(await materializeOfficeArtifact(workId, input.content));
    }

    const [local, artifact] = await Promise.all([
      fetchVerifiedNativePayload(workId, "local-latest"),
      convexQuery<{ artifactId: Id<"spectraArtifacts"> }, ArtifactTruth>(
        "spectraArtifacts:get",
        { artifactId: workId },
      ),
    ]);
    if (cloud.truth.hash === local.truth.hash)
      return NextResponse.json({ state: "current" });
    const [externalOpened, diff] = await Promise.all([
      isSheet ? xlsxLens.open(local.payload) : pptxLens.open(local.payload),
      isSheet
        ? xlsxLens.diffExternal(cloud.payload, local.payload)
        : pptxLens.diffExternal(cloud.payload, local.payload),
    ]);
    const externalProjection = externalOpened.projection as OfficeProjection;
    const currentProjection = projectionFor(
      artifact.content,
      baseProjection,
      isSheet,
    );
    const spectraChanged = new Set(
      changedRegions(baseProjection, currentProjection, isSheet),
    );
    const externalChanged = new Set(
      diff.changes
        .filter((change) => change.kind !== "preserved-part-replaced")
        .map((change) => change.regionId),
    );
    const conflictRegionIds = [...externalChanged].filter((regionId) =>
      spectraChanged.has(regionId),
    );

    if (input.resolution === "spectra") {
      const output = isSheet
        ? await xlsxLens.materialize({
            projection: currentProjection as XlsxProjection,
            carry: (externalOpened as Awaited<ReturnType<typeof xlsxLens.open>>)
              .preservedCarry,
          })
        : await pptxLens.materialize({
            projection: currentProjection as PptxProjection,
            carry: (externalOpened as Awaited<ReturnType<typeof pptxLens.open>>)
              .preservedCarry,
          });
      const hash = await sha256Payload(output);
      const [next, comparison] = await Promise.all([
        isSheet ? xlsxLens.open(output) : pptxLens.open(output),
        comparePackages(local.payload, output),
      ]);
      const stored = await uploadNativePayload(workId, output, hash, local.truth.nativeFormat);
      const queued = await convexMutation("replicas:queueMaterialization", {
        workId,
        payloadRef: stored.payloadRef,
        contentHash: hash,
        baseRevision: local.truth.revision,
        fidelityMap: next.fidelityMap,
        regionIds: [...new Set([...spectraChanged, ...conflictRegionIds])],
        partNames: comparison.parts
          .filter((part) => part.verdict !== "identical")
          .map((part) => `/${part.name}`),
        localReplicaId: local.truth.replicaId as Id<"workReplicas">,
      });
      await convexMutation("replicas:resolveExternalConflict", {
        workId,
        resolution: "spectra",
      });
      return NextResponse.json({
        state: (queued as { state: string }).state,
        requestId: (queued as { requestId: string }).requestId,
        status: "Waiting to save your Spectra version locally",
      });
    }

    const mergedProjection = mergeExternalProjection(
      currentProjection,
      externalProjection,
      externalChanged,
      isSheet,
    );
    const mergedContent = contentFor(mergedProjection, isSheet);
    const recorded = await convexMutation(
      "replicas:recordExternalReconciliation",
      {
        workId,
        localReplicaId: local.truth.replicaId,
        localPayloadRef: local.truth.payloadRef,
        localRevision: local.truth.revision,
        content: mergedContent,
        fidelityMap: externalOpened.fidelityMap,
        regionIds: [...externalChanged],
        partNames: diff.preservedPartChanges,
        conflictRegionIds:
          input.resolution === "local" ? [] : conflictRegionIds,
        resolution: input.resolution === "local" ? "local" : undefined,
      },
    );
    const application = isSheet ? "Excel" : "PowerPoint";
    return NextResponse.json({
      state: (recorded as { state: string }).state,
      ...((recorded as { state: string }).state === "applied"
        ? { projection: mergedContent, attribution: `Edited in ${application}` }
        : {
            conflict: {
              regionIds: conflictRegionIds,
              message: `${application} and Spectra changed the same ${isSheet ? "cell" : "slide"}. Choose which version to keep.`,
            },
          }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "OFFICE_LENS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "The Office file could not be processed safely.",
      },
      { status: 400 },
    );
  }
}
