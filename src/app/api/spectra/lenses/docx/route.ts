import { NextResponse } from "next/server";
import { comparePackages } from "@ariadng/office/preservation";
import { z } from "zod";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import {
  DocxLensError,
  docxLens,
  sha256Payload,
  type DocxProjection,
} from "@/features/spectra/lenses/docx-lens";
import {
  fetchVerifiedNativePayload,
  uploadNativePayload,
} from "@/features/spectra/lenses/native-payload-server";

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
  recentOperations?: Array<{
    direction?: string;
    state?: string;
    actorKind?: string;
    revisionAfter?: string;
  }>;
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
  const parsed = z.object({
    blocks: z.array(z.object({
      id: z.string().min(1).max(300),
      type: z.enum(["paragraph", "heading", "list", "table"]),
      text: z.string().max(2_000_000),
      attrs: z.record(z.string(), z.unknown()).optional(),
    }).passthrough()).max(100_000),
    outline: z.array(z.object({ id: z.string(), title: z.string(), level: z.number() })).optional(),
    nativeBinding: z.unknown().optional(),
  }).passthrough().parse(value);
  // Strict-native materialization cannot interpret an omitted block as a
  // deletion: the lens deliberately refuses destructive Word edits. Merge
  // the semantic projection onto the last verified native projection so a
  // partial/stale Yjs projection never turns into a false native deletion.
  const incomingById = new Map(parsed.blocks.map((block) => [block.id, block]));
  const baseIds = new Set(base.blocks.map((block) => block.id));
  const blocks = base.blocks.map((block) => incomingById.get(block.id) ?? block);
  for (const block of parsed.blocks) {
    if (!baseIds.has(block.id)) blocks.push(block);
  }
  return {
    blocks,
    outline: parsed.outline ?? base.outline,
    nativeBinding: base.nativeBinding,
  };
}

export function changedRegions(before: DocxProjection, after: DocxProjection) {
  const prior = new Map(before.blocks.map((block) => [block.id, block]));
  const changed: string[] = [];
  for (const block of after.blocks) {
    const old = prior.get(block.id);
    prior.delete(block.id);
    if (!old || old.text !== block.text || JSON.stringify(old.attrs) !== JSON.stringify(block.attrs))
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
  const [{ truth, payload }, workTruth] = await Promise.all([
    fetchVerifiedNativePayload(workId, "cloud"),
    convexQuery<{ workId: Id<"spectraArtifacts"> }, WorkTruth>(
      "replicas:forWork",
      { workId },
    ),
  ]);
  const opened = await docxLens.open(payload, "strict-native");
  const projection = contentProjection(content, opened.projection);
  const regionIds = changedRegions(opened.projection, projection);
  const output = await docxLens.materialize({
    projection,
    carry: opened.preservedCarry,
  });
  const hash = await sha256Payload(output);
  if (hash === truth.hash) return { state: "unchanged" as const, hash };
  const [next, comparison] = await Promise.all([
    docxLens.open(output, "strict-native"),
    comparePackages(payload, output),
  ]);
  const stored = await uploadNativePayload(output, hash, truth.nativeFormat);
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
  const queued = await convexMutation<
    {
      workId: Id<"spectraArtifacts">;
      payloadRef: string;
      contentHash: string;
      baseRevision: string;
      idempotencyKey: string;
      fidelityMap: unknown;
      regionIds: string[];
      partNames: string[];
      localReplicaId?: Id<"workReplicas">;
      baseContent?: unknown;
      baseContentHash?: string;
      baseTextIndex?: string;
    },
    { requestId: string; state: string }
  >("replicas:queueMaterialization", {
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
    baseContent: opened.projection,
    baseContentHash: opened.projection.nativeBinding.semanticDigest,
    baseTextIndex: opened.projection.blocks
      .map((block) => block.text)
      .join("\n")
      .slice(0, 200_000),
  });
  return {
    state: queued.state,
    requestId: queued.requestId,
    hash,
    status: "Waiting to save locally",
  };
}

function mergeExternalProjection(
  current: DocxProjection,
  external: DocxProjection,
  externalRegionIds: Set<string>,
) {
  const externalById = new Map(external.blocks.map((block) => [block.id, block]));
  const blocks = current.blocks.flatMap((block) => {
    if (!externalRegionIds.has(block.id)) return [block];
    const replacement = externalById.get(block.id);
    externalById.delete(block.id);
    return replacement ? [replacement] : [];
  });
  for (const block of external.blocks) {
    if (externalRegionIds.has(block.id) && externalById.has(block.id)) {
      blocks.push(block);
      externalById.delete(block.id);
    }
  }
  return {
    ...current,
    blocks,
    outline: external.outline,
    nativeBinding: {
      ...external.nativeBinding,
      externalTransaction: {
        label: "Edited in Word",
        occurredAt: Date.now(),
      },
    },
  } as DocxProjection;
}

function errorResponse(error: unknown) {
  const status = error instanceof DocxLensError &&
    ["DOCX_PASSWORD_PROTECTED", "DOCX_CORRUPT"].includes(error.code)
    ? 422
    : 400;
  return NextResponse.json(
    {
      error: error instanceof DocxLensError ? error.code : "DOCX_LENS_FAILED",
      message: error instanceof Error ? error.message : "The Word file could not be processed safely.",
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
        const externalRevision = workTruth.recentOperations?.find(
          (operation) =>
            operation.direction === "external" &&
            operation.actorKind === "external-edit" &&
            operation.revisionAfter === local.truth.hash,
        );
        const externalNeedsActivation = Boolean(
          local.truth.hash !== truth.hash || externalRevision,
        );
        if (externalNeedsActivation) {
          const [artifact, externalOpened, diff] = await Promise.all([
            convexQuery<{ artifactId: Id<"spectraArtifacts"> }, ArtifactTruth>(
              "spectraArtifacts:get",
              { artifactId: workId },
            ),
            docxLens.open(local.payload, "strict-native"),
            docxLens.diffExternal(payload, local.payload),
          ]);
          const current = contentProjection(artifact.content, opened.projection);
          const spectraChanged = new Set(changedRegions(opened.projection, current));
          const externalChanged = new Set(
            local.truth.hash === truth.hash && externalRevision
              ? changedRegions(opened.projection, current)
              : diff.changes
                  .filter((change) => change.kind !== "preserved-part-replaced")
                  .map((change) => change.regionId),
          );
          const conflictRegionIds =
            local.truth.hash === truth.hash && externalRevision
              ? []
              : [...externalChanged].filter((regionId) => spectraChanged.has(regionId));
          if (conflictRegionIds.length) {
            return NextResponse.json(
              { state: "conflicted", conflictRegionIds, message: "The Word file and Spectra changed the same regions. Review the conflict before opening." },
              { status: 409 },
            );
          }
          const merged = mergeExternalProjection(current, externalOpened.projection, externalChanged);
          await convexMutation("replicas:recordExternalReconciliation", {
            workId,
            localReplicaId: local.truth.replicaId as Id<"workReplicas">,
            localPayloadRef: local.truth.payloadRef,
            localRevision: local.truth.revision,
            content: merged,
            fidelityMap: externalOpened.fidelityMap,
            regionIds: [...externalChanged],
            partNames: diff.preservedPartChanges,
            conflictRegionIds: [],
          });
          truth = local.truth;
          payload = local.payload;
          opened = { ...externalOpened, projection: merged };
        }
      } catch (error) {
        // A missing local payload is normal for cloud-only work. Other errors
        // must remain visible instead of silently reverting to stale content.
        if (!(error instanceof Error) || !["LOCAL_REPLICA_UNAVAILABLE", "NATIVE_PAYLOAD_UNAVAILABLE"].includes(error.message)) throw error;
      }
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
        content: opened.projection,
        fidelityMap: opened.fidelityMap,
        semanticDigest: opened.projection.nativeBinding.semanticDigest,
        nativeFormat: opened.projection.nativeBinding.format,
      });
      return NextResponse.json({
        state: "opened",
        projection: opened.projection,
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
    if (cloud.truth.hash === local.truth.hash)
      return NextResponse.json({ state: "current" });
    const [baseOpened, externalOpened, diff] = await Promise.all([
      docxLens.open(cloud.payload, "strict-native"),
      docxLens.open(local.payload, "strict-native"),
      docxLens.diffExternal(cloud.payload, local.payload),
    ]);
    const current = contentProjection(artifact.content, baseOpened.projection);
    const spectraChanged = new Set(changedRegions(baseOpened.projection, current));
    const externalChanged = new Set(diff.changes
      .filter((change) => change.kind !== "preserved-part-replaced")
      .map((change) => change.regionId));
    const conflictRegionIds = [...externalChanged].filter((regionId) => spectraChanged.has(regionId));
    const firstConflictBlock = current.blocks.find(
      (block) => block.id === conflictRegionIds[0],
    );
    const conflictLabel = firstConflictBlock
      ? `${firstConflictBlock.type} “${firstConflictBlock.text.slice(0, 54) || "empty paragraph"}”`
      : "the same document region";

    if (input.resolution === "spectra") {
      const output = await docxLens.materialize({
        projection: current,
        carry: externalOpened.preservedCarry,
      });
      const hash = await sha256Payload(output);
      const [next, comparison] = await Promise.all([
        docxLens.open(output, "strict-native"),
        comparePackages(local.payload, output),
      ]);
      const stored = await uploadNativePayload(output, hash, local.truth.nativeFormat);
      const queued = await convexMutation<
        {
          workId: Id<"spectraArtifacts">;
          payloadRef: string;
          contentHash: string;
          baseRevision: string;
          idempotencyKey: string;
          fidelityMap: unknown;
          regionIds: string[];
          partNames: string[];
          localReplicaId?: Id<"workReplicas">;
        },
        { requestId: string; state: string }
      >("replicas:queueMaterialization", {
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
      await convexMutation<
        { workId: Id<"spectraArtifacts">; resolution: "spectra" },
        unknown
      >("replicas:resolveExternalConflict", {
        workId,
        resolution: "spectra",
      });
      return NextResponse.json({
        state: queued.state,
        requestId: queued.requestId,
        status: "Waiting to save your Spectra version locally",
      });
    }
    const merged = mergeExternalProjection(current, externalOpened.projection, externalChanged);
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
    });
    return NextResponse.json({
      state: recorded.state,
      ...(recorded.state === "applied"
        ? { projection: merged, attribution: "Edited in Word" }
        : {
            conflict: {
              regionIds: conflictRegionIds,
              message: `Word and Spectra both changed ${conflictLabel}. Choose which version to keep.`,
            },
          }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
