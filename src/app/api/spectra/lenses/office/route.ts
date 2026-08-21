import { NextResponse } from "next/server";
import { comparePackages } from "@ariadng/office/preservation";
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
import {
  pptxArtifactContent,
  xlsxArtifactContent,
} from "@/features/spectra/lenses/office-content";

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
function contentToXlsx(content: unknown, base: XlsxProjection): XlsxProjection {
  const raw = z
    .object({
      sheets: z.array(
        z
          .object({
            id: z.string(),
            cells: z.record(
              z.string(),
              z
                .object({
                  value: z.unknown().optional(),
                  formula: z.string().optional(),
                })
                .passthrough(),
            ),
          })
          .passthrough(),
      ),
    })
    .passthrough()
    .parse(content);
  const byId = new Map(raw.sheets.map((sheet) => [sheet.id, sheet]));
  return {
    ...base,
    sheets: base.sheets.map((sheet) => {
      const next = byId.get(sheet.id);
      if (!next) return sheet;
      const cells = new Map(sheet.cells.map((cell) => [cell.ref, cell]));
      for (const [ref, value] of Object.entries(next.cells)) {
        const previous = cells.get(ref);
        if (
          previous?.formula &&
          !value.formula &&
          JSON.stringify(value.value) !== JSON.stringify(previous.value)
        )
          throw new Error(
            `Formula ${sheet.name}!${ref} cannot be replaced by a literal through a value edit. Edit its formula text instead.`,
          );
        cells.set(ref, {
          ...(previous ?? {
            id: `xlsx:${sheet.id.replace(/^xlsx:sheet:/, "")}:${ref.toUpperCase()}`,
            ref: ref.toUpperCase(),
            value: null,
          }),
          value: value.value as never,
          ...(value.formula
            ? {
                formula: value.formula.replace(/^=/, ""),
                formulaSupport: previous?.formulaSupport,
              }
            : previous?.formula
              ? {
                  formula: previous.formula,
                  formulaSupport: previous.formulaSupport,
                }
              : {}),
        });
      }
      return { ...sheet, cells: [...cells.values()] };
    }),
  };
}

function contentToPptx(content: unknown, base: PptxProjection): PptxProjection {
  const raw = z
    .object({
      slides: z.array(
        z
          .object({
            id: z.string(),
            title: z.string().optional(),
            objects: z
              .array(
                z
                  .object({ type: z.string(), content: z.unknown() })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough()
    .parse(content);
  const byId = new Map(raw.slides.map((slide) => [slide.id, slide]));
  return {
    ...base,
    slides: base.slides.map((slide) => {
      const next = byId.get(slide.id);
      if (!next) return slide;
      const text = (next.objects ?? [])
        .filter((object) => object.type === "text")
        .map((object) => {
          const value = object.content as { text?: unknown } | string;
          return typeof value === "string"
            ? value
            : typeof value?.text === "string"
              ? value.text
              : "";
        });
      return {
        ...slide,
        title: next.title ?? slide.title,
        text: text.length ? text : slide.text,
      };
    }),
  };
}

function contentFor(projection: OfficeProjection, isSheet: boolean) {
  return isSheet
    ? xlsxArtifactContent(projection as XlsxProjection)
    : pptxArtifactContent(projection as PptxProjection);
}
function projectionFor(
  content: unknown,
  base: OfficeProjection,
  isSheet: boolean,
) {
  return isSheet
    ? contentToXlsx(content, base as XlsxProjection)
    : contentToPptx(content, base as PptxProjection);
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
    const cloud = await fetchVerifiedNativePayload(workId, "cloud");
    const isSheet = spreadsheetFormats.has(cloud.truth.nativeFormat);
    const baseOpened = isSheet
      ? await xlsxLens.open(cloud.payload)
      : await pptxLens.open(cloud.payload);
    const baseProjection = baseOpened.projection as OfficeProjection;

    if (input.action === "open") {
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

    if (input.action === "materialize") {
      const workTruth = await convexQuery<
        { workId: Id<"spectraArtifacts"> },
        WorkTruth
      >("replicas:forWork", { workId });
      const projection = projectionFor(input.content, baseProjection, isSheet);
      const regionIds = changedRegions(baseProjection, projection, isSheet);
      const output = isSheet
        ? await xlsxLens.materialize({
            projection: projection as XlsxProjection,
            carry: (baseOpened as Awaited<ReturnType<typeof xlsxLens.open>>)
              .preservedCarry,
          })
        : await pptxLens.materialize({
            projection: projection as PptxProjection,
            carry: (baseOpened as Awaited<ReturnType<typeof pptxLens.open>>)
              .preservedCarry,
          });
      const hash = await sha256Payload(output);
      if (hash === cloud.truth.hash)
        return NextResponse.json({ state: "unchanged", hash });
      const [next, comparison] = await Promise.all([
        isSheet ? xlsxLens.open(output) : pptxLens.open(output),
        comparePackages(cloud.payload, output),
      ]);
      const stored = await uploadNativePayload(output, hash, cloud.truth.nativeFormat);
      const local = workTruth.replicas.find(
        (replica) => replica.kind === "local" && replica.state !== "unavailable",
      );
      if (!local) throw new Error("LOCAL_REPLICA_UNAVAILABLE");
      const queued = await convexMutation("replicas:queueMaterialization", {
        workId,
        payloadRef: stored.payloadRef,
        contentHash: hash,
        baseRevision: local.revision,
        idempotencyKey: crypto.randomUUID(),
        fidelityMap: next.fidelityMap,
        regionIds,
        partNames: comparison.parts
          .filter((part) => part.verdict !== "identical")
          .map((part) => `/${part.name}`),
        localReplicaId: local._id as Id<"workReplicas">,
      });
      return NextResponse.json({
        state: (queued as { state: string }).state,
        requestId: (queued as { requestId: string }).requestId,
        hash,
        status: "Waiting to save locally",
      });
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
      const stored = await uploadNativePayload(output, hash, local.truth.nativeFormat);
      const queued = await convexMutation("replicas:queueMaterialization", {
        workId,
        payloadRef: stored.payloadRef,
        contentHash: hash,
        baseRevision: local.truth.revision,
        idempotencyKey: crypto.randomUUID(),
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
        localPayloadRef: local.truth.payloadRef,
        localRevision: local.truth.revision,
        content: mergedContent,
        fidelityMap: externalOpened.fidelityMap,
        regionIds: [...externalChanged],
        partNames: diff.preservedPartChanges,
        conflictRegionIds:
          input.resolution === "local" ? [] : conflictRegionIds,
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
