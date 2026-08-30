import { NextResponse } from "next/server";
import { comparePackages } from "@ariadng/office/preservation";
import { z } from "zod";
import { assertPreservationKept } from "@/features/spectra/commands/office/preservation-guard";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import {
  DocxLensError,
  docxLens,
  sha256Payload,
  type DocxProjection,
} from "@/features/spectra/lenses/docx-lens";
import {
  bindDocxProjectionSource,
  docxProjectionFromContent,
} from "@/features/spectra/lenses/document-projection";
import {
  fetchVerifiedNativePayload,
  fetchStoredNativeBase,
  uploadNativePayload,
} from "@/features/spectra/lenses/native-payload-server";
import {
  hasUnreconciledExternalRevision,
  type RecentNativeOperation,
} from "@/features/spectra/lenses/native-reconciliation";
import { mergeThreeWay, type MergeConflict } from "@/features/spectra/lenses/three-way-merge";
import { humanizePublicFailure } from "@/features/spectra/bridge/humanize";

export const runtime = "nodejs";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), artifactId: z.string().min(1) }),
  z.object({
    action: z.literal("materialize"),
    artifactId: z.string().min(1),
    content: z.unknown(),
  }),
  z.object({
    action: z.literal("reconcile"),
    artifactId: z.string().min(1),
    resolution: z.enum(["word", "spectra"]).optional(),
  }),
]);

type WorkTruth = {
  replicas: Array<{
    _id: string;
    kind: "cloud" | "local";
    revision: string;
    state: string;
    payloadRef?: string;
  }>;
  recentOperations?: RecentNativeOperation[];
};

type ArtifactTruth = {
  content: unknown;
  title: string;
  summary?: string;
  tags?: string[];
};

function artifactId(value: string) {
  return value as Id<"spectraArtifacts">;
}

export function contentProjection(value: unknown, base: DocxProjection): DocxProjection {
  return docxProjectionFromContent(value, base).projection;
}

export function changedRegions(before: DocxProjection, after: DocxProjection) {
  const prior = new Map(before.blocks.map((block) => [block.id, block]));
  const changed: string[] = [];
  for (const block of after.blocks) {
    const old = prior.get(block.id);
    prior.delete(block.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(block))
      changed.push(block.id);
  }
  changed.push(...prior.keys());
  return [...new Set(changed)];
}

/** Queue one verified DOCX payload for the Bridge. Used by both the human
 * editor endpoint and AI artifact updates so native materialization cannot be
 * accidentally omitted by a second caller. */
export async function materializeDocxArtifact(
  workId: Id<"spectraArtifacts">,
  content: unknown,
) {
  return materializeDocxArtifactAttempt(workId, content, 0);
}

async function materializeDocxArtifactAttempt(
  workId: Id<"spectraArtifacts">,
  content: unknown,
  attempt: number,
) {
  const [cloud, workTruth] = await Promise.all([
    fetchVerifiedNativePayload(workId, "cloud"),
    convexQuery<{ workId: Id<"spectraArtifacts"> }, WorkTruth>(
      "replicas:forWork",
      { workId },
    ),
  ]);
  let { truth, payload } = cloud;
  let opened = await docxLens.open(payload, "strict-native");
  let update = docxProjectionFromContent(content, opened.projection);
  if (attempt > 0) {
    const local = await fetchVerifiedNativePayload(workId, "local-latest");
    const baseOpened = await storedDocxBase(cloud.truth, cloud.payload);
    const ours = contentProjection(content, baseOpened.projection);
    const externalOpened = await docxLens.open(local.payload, "strict-native");
    const rebased = mergeDocxProjections(baseOpened.projection, ours, externalOpened.projection, undefined, true);
    if (rebased.conflicts.length) {
      const conflictRegionIds = conflictIds(rebased.conflicts);
      const previews = conflictDetails(rebased.conflicts);
      await convexMutation("replicas:recordExternalReconciliation", {
        workId,
        localReplicaId: local.truth.replicaId as Id<"workReplicas">,
        localPayloadRef: local.truth.payloadRef,
        localRevision: local.truth.revision,
        content: ours,
        fidelityMap: externalOpened.fidelityMap,
        regionIds: rebased.externalChanged,
        partNames: [],
        conflictRegionIds,
        previews,
      });
      return {
        state: "conflicted" as const,
        conflict: {
          regionIds: conflictRegionIds,
          previews,
          message: "The Word file and Spectra changed the same regions. Choose which version to keep.",
        },
      };
    }
    truth = local.truth;
    payload = local.payload;
    opened = externalOpened;
    update = docxProjectionFromContent(rebased.projection, opened.projection);
  }
  const { projection, operations } = update;
  const regionIds = changedRegions(opened.projection, projection);
  const output = operations.length
    ? await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations })
    : payload;
  const hash = await sha256Payload(output);
  if (hash === truth.hash) return { state: "unchanged" as const, hash };
  const [next, comparison] = await Promise.all([
    docxLens.open(output, "strict-native"),
    comparePackages(payload, output),
  ]);
  const nextProjection = bindDocxProjectionSource(
    next.projection,
    String(workId),
    hash,
  );
  assertPreservationKept({ entries: opened.fidelityMap.entries, parts: comparison.parts });
  const stored = await uploadNativePayload(workId, output, hash, truth.nativeFormat);
  const local = workTruth.replicas.find(
    (replica) => replica.kind === "local" && replica.state !== "unavailable",
  );
  if (!local) {
    return {
      state: "cloud_saved" as const,
      hash,
      status:
        "Spectra saved your edit. Open this file from Library with the Spectra bridge connected to update the Word copy on this computer.",
    };
  }
  let queued: { requestId: string; state: string };
  try {
    queued = await convexMutation<
    {
      workId: Id<"spectraArtifacts">;
      payloadRef: string;
      contentHash: string;
      baseRevision: string;
      fidelityMap: unknown;
      regionIds: string[];
      partNames: string[];
      localReplicaId?: Id<"workReplicas">;
      baseContent?: unknown;
      baseContentHash?: string;
      baseTextIndex?: string;
      projectionContent?: unknown;
      projectionContentHash?: string;
      projectionTextIndex?: string;
    },
    { requestId: string; state: string }
    >("replicas:queueMaterialization", {
      workId,
      payloadRef: stored.payloadRef,
      contentHash: hash,
      baseRevision: truth.revision,
      fidelityMap: next.fidelityMap,
      regionIds,
      partNames: comparison.parts
        .filter((part) => part.verdict !== "identical")
        .map((part) => `/${part.name}`),
      localReplicaId: local._id as Id<"workReplicas">,
      baseContent: opened.projection,
      baseContentHash: opened.projection.nativeBinding.semanticDigest,
      baseTextIndex: opened.projection.blocks
        .map((block) => block.text)
        .join("\n")
        .slice(0, 200_000),
      projectionContent: nextProjection,
      projectionContentHash: nextProjection.nativeBinding.semanticDigest,
      projectionTextIndex: nextProjection.blocks
        .map((block) => block.text)
        .join("\n")
        .slice(0, 200_000),
    });
  } catch (error) {
    if (attempt === 0 && error instanceof Error && error.message.includes("MATERIALIZATION_BASE_STALE"))
      return materializeDocxArtifactAttempt(workId, content, attempt + 1);
    throw error;
  }
  return {
    state: queued.state,
    requestId: queued.requestId,
    hash,
    status: "Waiting to save locally",
  };
}

export function mergeDocxProjections(
  base: DocxProjection,
  current: DocxProjection,
  external: DocxProjection,
  resolution?: "spectra" | "word",
  requireStableIdentity = false,
) {
  for (const projection of [base, current, external]) {
    const ids = projection.blocks.map((block) => block.id);
    if (ids.some((regionId) => !regionId) || new Set(ids).size !== ids.length)
      throw new DocxLensError(
        "DOCX_IDENTITY_AMBIGUOUS",
        "This Word file contains duplicate or missing native region identities, so Spectra will not guess which content to change.",
      );
  }
  if (
    requireStableIdentity &&
    base.nativeBinding.identityStable !== true &&
    changedRegions(base, current).length > 0 &&
    changedRegions(base, external).length > 0
  )
    throw new DocxLensError(
      "DOCX_IDENTITY_UNSTABLE",
      "This Word file did not yet have persisted native anchors when both Word and Spectra changed it. Open the latest version and save again before merging.",
    );
  const merged = mergeThreeWay({
    base: base.blocks,
    ours: current.blocks,
    theirs: external.blocks,
    id: (block) => block.id,
    orderId: "docx:order",
    conflictResolution: resolution === "spectra" ? "ours" : resolution === "word" ? "theirs" : undefined,
  });
  return {
    projection: {
      ...current,
      blocks: merged.value,
      outline: merged.value.flatMap((block) => block.type === "heading" ? [{ id: block.id, title: block.text, level: Number(block.attrs?.styleId?.toString().match(/[1-3]$/)?.[0] ?? 2) }] : []),
      nativeBinding: {
        ...external.nativeBinding,
        externalTransaction: { label: "Edited in Word", occurredAt: Date.now() },
      },
    } as DocxProjection,
    conflicts: merged.conflicts,
    spectraChanged: merged.changedByOurs,
    externalChanged: merged.changedByTheirs,
  };
}

function conflictPreview(conflict: MergeConflict<DocxProjection["blocks"][number]>) {
  const preview = (block: DocxProjection["blocks"][number] | undefined) =>
    block ? block.text.slice(0, 160) || "Empty region" : "Deleted";
  return { regionId: conflict.id, spectra: preview(conflict.ours), external: preview(conflict.theirs) };
}

async function storedDocxBase(cloudTruth: Awaited<ReturnType<typeof fetchVerifiedNativePayload>>["truth"], fallback: Uint8Array) {
  return docxLens.open(await fetchStoredNativeBase(cloudTruth, fallback), "strict-native");
}

function conflictIds(conflicts: readonly MergeConflict<unknown>[]) {
  return conflicts.map((conflict) => conflict.id);
}

function conflictDetails(conflicts: readonly MergeConflict<DocxProjection["blocks"][number]>[]) {
  return conflicts.map(conflictPreview);
}

function errorResponse(error: unknown) {
  const status = error instanceof DocxLensError &&
    ["DOCX_PASSWORD_PROTECTED", "DOCX_CORRUPT"].includes(error.code)
    ? 422
    : 400;
  return NextResponse.json(
    {
      error: error instanceof DocxLensError ? error.code : "DOCX_LENS_FAILED",
      message:
        error instanceof DocxLensError
          ? error.message
          : humanizePublicFailure(error, "Word"),
    },
    { status },
  );
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const workId = artifactId(input.artifactId);

    if (input.action === "open") {
      let { truth, payload } = await fetchVerifiedNativePayload(workId, "cloud");
      let opened = await docxLens.open(payload, "strict-native");

      // A Bridge external revision may arrive after the cloud projection was
      // last activated. Reconcile it before opening so the user sees the
      // native file they just saved, while still failing closed on overlap.
      try {
        const local = await fetchVerifiedNativePayload(workId, "local-latest");
        const workTruth = await convexQuery<{ workId: Id<"spectraArtifacts"> }, WorkTruth>(
          "replicas:forWork",
          { workId },
        );
        const externalRevision = hasUnreconciledExternalRevision(
          workTruth.recentOperations,
          local.truth.hash,
        );
        const externalNeedsActivation = Boolean(
          local.truth.hash !== truth.hash || externalRevision,
        );
        if (externalNeedsActivation) {
          const [artifact, externalOpened] = await Promise.all([
            convexQuery<{ artifactId: Id<"spectraArtifacts"> }, ArtifactTruth>(
              "spectraArtifacts:get",
              { artifactId: workId },
            ),
            docxLens.open(local.payload, "strict-native"),
          ]);
          const baseOpened = await storedDocxBase(local.truth, local.payload);
          const current = contentProjection(artifact.content, baseOpened.projection);
          const merged = mergeDocxProjections(baseOpened.projection, current, externalOpened.projection, undefined, true);
          const conflictRegionIds = conflictIds(merged.conflicts);
          if (conflictRegionIds.length) {
            const previews = conflictDetails(merged.conflicts as MergeConflict<DocxProjection["blocks"][number]>[]);
            await convexMutation("replicas:recordExternalReconciliation", {
              workId,
              localReplicaId: local.truth.replicaId as Id<"workReplicas">,
              localPayloadRef: local.truth.payloadRef,
              localRevision: local.truth.revision,
              content: contentProjection(artifact.content, baseOpened.projection),
              fidelityMap: externalOpened.fidelityMap,
              regionIds: merged.externalChanged,
              partNames: [],
              conflictRegionIds,
              previews,
            });
            return NextResponse.json(
              { state: "conflicted", conflict: { regionIds: conflictRegionIds, previews, message: "The Word file and Spectra changed the same regions. Choose which version to keep." } },
            );
          }
          const diff = await docxLens.diffExternal(baseOpened.preservedCarry.payload, local.payload);
          await convexMutation("replicas:recordExternalReconciliation", {
            workId,
            localReplicaId: local.truth.replicaId as Id<"workReplicas">,
            localPayloadRef: local.truth.payloadRef,
            localRevision: local.truth.revision,
            content: bindDocxProjectionSource(
              merged.projection,
              String(workId),
              local.truth.hash,
            ),
            fidelityMap: externalOpened.fidelityMap,
            regionIds: merged.externalChanged,
            partNames: diff.preservedPartChanges,
            conflictRegionIds: [],
          });
          truth = local.truth;
          payload = local.payload;
          opened = { ...externalOpened, projection: merged.projection };
        }
      } catch (error) {
        // A missing local payload is normal for cloud-only work. Other errors
        // must remain visible instead of silently reverting to stale content.
        if (!(error instanceof Error) || !["LOCAL_REPLICA_UNAVAILABLE", "NATIVE_PAYLOAD_UNAVAILABLE"].includes(error.message)) throw error;
      }
      const activatedProjection = bindDocxProjectionSource(
        opened.projection,
        String(workId),
        truth.hash,
      );
      await convexMutation<
        {
          workId: Id<"spectraArtifacts">;
          payloadHash: string;
          content: DocxProjection;
          fidelityMap: unknown;
          semanticDigest: string;
          nativeFormat: string;
        },
        unknown
      >("replicas:activateLens", {
        workId,
        payloadHash: truth.hash,
        content: activatedProjection,
        fidelityMap: opened.fidelityMap,
        semanticDigest: activatedProjection.nativeBinding.semanticDigest,
        nativeFormat: activatedProjection.nativeBinding.format,
      });
      return NextResponse.json({
        state: "opened",
        projection: activatedProjection,
        fidelityMap: opened.fidelityMap,
        capabilities: opened.capabilities,
      });
    }

    if (input.action === "materialize") {
      return NextResponse.json(await materializeDocxArtifact(workId, input.content));
    }

    const [cloud, local, artifact] = await Promise.all([
      fetchVerifiedNativePayload(workId, "cloud"),
      fetchVerifiedNativePayload(workId, "local-latest"),
      convexQuery<{ artifactId: Id<"spectraArtifacts"> }, ArtifactTruth>(
        "spectraArtifacts:get",
        { artifactId: workId },
      ),
    ]);
    if (cloud.truth.hash === local.truth.hash) {
      if (input.resolution === "spectra" || input.resolution === "word") {
        await convexMutation<
          { workId: Id<"spectraArtifacts">; resolution: "spectra" | "local" },
          unknown
        >("replicas:resolveExternalConflict", {
          workId,
          resolution: input.resolution === "word" ? "local" : "spectra",
        });
        return NextResponse.json({
          state: "current",
          attribution:
            input.resolution === "spectra"
              ? "Kept your Spectra version"
              : "Kept the Word version",
        });
      }
      return NextResponse.json({ state: "current" });
    }
    const [baseOpened, externalOpened] = await Promise.all([
      storedDocxBase(cloud.truth, cloud.payload),
      docxLens.open(local.payload, "strict-native"),
    ]);
    const current = contentProjection(artifact.content, baseOpened.projection);
    const diff = await docxLens.diffExternal(baseOpened.preservedCarry.payload, local.payload);
    const mergedResult = mergeDocxProjections(baseOpened.projection, current, externalOpened.projection, undefined, true);
    const spectraChanged = new Set(mergedResult.spectraChanged);
    const externalChanged = new Set(mergedResult.externalChanged);
    const conflictRegionIds = conflictIds(mergedResult.conflicts);
    const firstConflictBlock = current.blocks.find(
      (block) => block.id === conflictRegionIds[0],
    );
    const conflictLabel = firstConflictBlock
      ? `${firstConflictBlock.type} “${firstConflictBlock.text.slice(0, 54) || "empty paragraph"}”`
      : "the same document region";

    if (input.resolution === "spectra") {
      const resolved = mergeDocxProjections(baseOpened.projection, current, externalOpened.projection, "spectra", true);
      const output = await docxLens.materialize({
        projection: resolved.projection,
        carry: externalOpened.preservedCarry,
      });
      const hash = await sha256Payload(output);
      const [next, comparison] = await Promise.all([
        docxLens.open(output, "strict-native"),
        comparePackages(local.payload, output),
      ]);
      const nextProjection = bindDocxProjectionSource(
        next.projection,
        String(workId),
        hash,
      );
      assertPreservationKept({ entries: externalOpened.fidelityMap.entries, parts: comparison.parts });
      const stored = await uploadNativePayload(workId, output, hash, local.truth.nativeFormat);
      const queued = await convexMutation<
        {
          workId: Id<"spectraArtifacts">;
          payloadRef: string;
          contentHash: string;
          baseRevision: string;
          fidelityMap: unknown;
          regionIds: string[];
          partNames: string[];
          localReplicaId?: Id<"workReplicas">;
          projectionContent?: unknown;
          projectionContentHash?: string;
          projectionTextIndex?: string;
        },
        { requestId: string; state: string }
      >("replicas:queueMaterialization", {
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
        projectionContent: nextProjection,
        projectionContentHash: nextProjection.nativeBinding.semanticDigest,
        projectionTextIndex: nextProjection.blocks
          .map((block) => block.text)
          .join("\n")
          .slice(0, 200_000),
      });
      if (queued.state !== "pending") {
        throw new DocxLensError(
          "DOCX_KEEP_SPECTRA_WRITE_PENDING",
          "Spectra prepared your version but could not queue the Word file update. Nothing was overwritten. Try Keep Spectra again.",
        );
      }
      await convexMutation<
        {
          workId: Id<"spectraArtifacts">;
          resolution: "spectra";
          requestId: Id<"bridgeWriteRequests">;
        },
        unknown
      >("replicas:resolveExternalConflict", {
        workId,
        resolution: "spectra",
        requestId: queued.requestId as Id<"bridgeWriteRequests">,
      });
      return NextResponse.json({
        state: "applied",
        projection: nextProjection,
        attribution: "Kept your Spectra version",
        requestId: queued.requestId,
        status: "Waiting to save your Spectra version locally",
      });
    }
    if (conflictRegionIds.length && input.resolution !== "word") {
      const previews = conflictDetails(mergedResult.conflicts as MergeConflict<DocxProjection["blocks"][number]>[]);
      await convexMutation("replicas:recordExternalReconciliation", {
        workId,
        localReplicaId: local.truth.replicaId as Id<"workReplicas">,
        localPayloadRef: local.truth.payloadRef,
        localRevision: local.truth.revision,
        content: current,
        fidelityMap: externalOpened.fidelityMap,
        regionIds: mergedResult.externalChanged,
        partNames: diff.preservedPartChanges,
        conflictRegionIds,
        previews,
      });
      return NextResponse.json({ state: "conflicted", conflict: { regionIds: conflictRegionIds, previews, message: "The Word file and Spectra changed the same regions. Choose which version to keep." } });
    }
    const merged = bindDocxProjectionSource(
      mergeDocxProjections(
        baseOpened.projection,
        current,
        externalOpened.projection,
        "word",
        true,
      ).projection,
      String(workId),
      local.truth.hash,
    );
    const recorded = await convexMutation<
      {
        workId: Id<"spectraArtifacts">;
        localReplicaId: Id<"workReplicas">;
        localPayloadRef: string;
        localRevision: string;
        content: DocxProjection;
        fidelityMap: unknown;
        regionIds: string[];
        partNames: string[];
        conflictRegionIds: string[];
        resolution?: "local" | "merged";
      },
      { state: "applied" | "conflicted" }
    >("replicas:recordExternalReconciliation", {
      workId,
      localReplicaId: local.truth.replicaId as Id<"workReplicas">,
      localPayloadRef: local.truth.payloadRef,
      localRevision: local.truth.revision,
      content: merged,
      fidelityMap: externalOpened.fidelityMap,
      regionIds: [...externalChanged],
      partNames: diff.preservedPartChanges,
      conflictRegionIds: input.resolution === "word" ? [] : conflictRegionIds,
      resolution: input.resolution === "word" ? "local" : undefined,
    });
    return NextResponse.json({
      state: recorded.state,
      ...(recorded.state === "applied"
        ? { projection: merged, attribution: "Edited in Word" }
        : {
            conflict: {
              regionIds: conflictRegionIds,
              previews: conflictDetails(mergedResult.conflicts as MergeConflict<DocxProjection["blocks"][number]>[]),
              message: `Word and Spectra both changed ${conflictLabel}. Choose which version to keep.`,
            },
          }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
