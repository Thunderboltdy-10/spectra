import { ensureImportedNativePayload } from "@/features/spectra/lenses/native-payload-server";
import { hydrateContentForWrite } from "@/lib/convex-server";
import { reconcileNativeRevision } from "@/lib/native-reconciliation-server";
import { NextResponse } from "next/server";
import { comparePackages } from "@ariadng/office/preservation";
import { z } from "zod";
import { assertNativePreservationKept } from "@/features/spectra/lenses/preservation-proof";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { checkpointArtifactDurableContent, convexMutation, convexQuery } from "@/lib/convex-server";
import {
  DocxLensError,
  docxLens,
  docxProjectionReadbackDigest,
  docxProjectionSemanticDigest,
  sha256Payload,
  type DocxWriteOptions,
  type DocxProjection,
} from "@/features/spectra/lenses/docx-lens";
import { resolveArtifactAssetBytes } from "@/features/spectra/lenses/asset-resolver-server";
import {
  bindDocxProjectionSource,
  compactDocxProjectionForStorage,
  docxProjectionFromContent,
  docxOperationsBetween,
} from "@/features/spectra/lenses/document-projection";
import {
  fetchVerifiedNativePayload,
  fetchStoredNativeBase,
  uploadNativePayload,
} from "@/features/spectra/lenses/native-payload-server";
import {
  shouldActivateExternalNativeRevision,
  type RecentNativeOperation,
} from "@/features/spectra/lenses/native-reconciliation";
import { mergeThreeWay, type MergeConflict } from "@/features/spectra/lenses/three-way-merge";
import { humanizePublicFailure } from "@/features/spectra/bridge/humanize";
import { nativeOperationId, type NativeSaveReceipt } from "../../../../../../shared/native-office-contract";

export const runtime = "nodejs";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), artifactId: z.string().min(1) }),
  z.object({ action: z.literal("download-copy"), artifactId: z.string().min(1) }),
  z.object({
    action: z.literal("materialize"),
    artifactId: z.string().min(1),
    content: z.unknown().optional(),
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
  if (JSON.stringify(before.pageSetup ?? null) !== JSON.stringify(after.pageSetup ?? null))
    changed.push("docx:region:sections");
  return [...new Set(changed)];
}

const nativeWriteOptions: DocxWriteOptions = {
  resolveAsset: async ({ assetId, mediaType }) => {
    const resolved = await resolveArtifactAssetBytes(assetId as Id<"artifactAssets">);
    if (resolved.mediaType.toLowerCase() !== mediaType)
      throw new DocxLensError(
        "DOCX_UNSUPPORTED_EDIT",
        "The durable Word image asset has a different media type from the requested replacement.",
      );
    return resolved.bytes;
  },
};

/** Queue one verified DOCX payload for the Bridge. Used by both the human
 * editor endpoint and AI artifact updates so native materialization cannot be
 * accidentally omitted by a second caller. */
export async function materializeDocxArtifact(
  workId: Id<"spectraArtifacts">,
  content: unknown,
  options?: { promotionMode?: "verified-first" | "immediate-projection" },
) {
  return materializeDocxArtifactAttempt(workId, content, 0, options);
}

async function materializeDocxArtifactAttempt(
  workId: Id<"spectraArtifacts">,
  content: unknown,
  attempt: number,
  options?: { promotionMode?: "verified-first" | "immediate-projection" },
) {
  let cloud: Awaited<ReturnType<typeof fetchVerifiedNativePayload>>;
  let workTruth: WorkTruth;
  try {
    [cloud, workTruth] = await Promise.all([
      fetchVerifiedNativePayload(workId, "cloud"),
      convexQuery<{ workId: Id<"spectraArtifacts"> }, WorkTruth>(
        "replicas:forWork",
        { workId },
      ),
    ]);
  } catch (error) {
    // Library import commits projection without a cloud replica payload URL.
    // Spectra already saved the edit — do not toast a false Word writeback failure.
    if (error instanceof Error && error.message === "NATIVE_PAYLOAD_UNAVAILABLE") {
      return {
        state: "deferred_native" as const,
        status:
          "Spectra saved your edit. Open this file from Library with the Spectra bridge connected to update the Word copy on this computer.",
      };
    }
    throw error;
  }
  let { truth, payload } = cloud;
  let opened = await docxLens.open(payload, "strict-native");
  let update = docxProjectionFromContent(content, opened.projection);
  if (attempt > 0) {
    const local = await fetchVerifiedNativePayload(workId, "local-latest");
    const baseOpened = await storedDocxBase(workId, local.truth, cloud.payload);
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
        content: compactDocxProjectionForStorage(ours),
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
  const requestedDigest = await docxProjectionSemanticDigest(projection);
  const regionIds = changedRegions(opened.projection, projection);
  const output = operations.length
    ? await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations }, nativeWriteOptions)
    : payload;
  const hash = await sha256Payload(output);
  if (hash === truth.hash) {
    const readbackDigest = await docxProjectionReadbackDigest(
      opened.projection,
      projection,
    );
    if (readbackDigest !== requestedDigest)
      throw new DocxLensError(
        "DOCX_READBACK_MISMATCH",
        "Word readback did not match the requested text, image, page, or header/footer edit.",
      );
    return {
      state: "unchanged" as const,
      hash,
      projectionContent: compactDocxProjectionForStorage(opened.projection),
      receipt: {
        kind: "native-office-save" as const,
        format: "docx" as const,
        operationId: nativeOperationId(String(workId), truth.revision, hash),
        artifactId: String(workId),
        basePayloadHash: truth.hash,
        resultPayloadHash: hash,
        baseRevision: truth.revision,
        resultRevision: hash,
        targets: { regionIds: [], partNames: [] },
        semantic: { resultDigest: requestedDigest, readbackDigest },
        preservedPartNames: [],
        state: "unchanged" as const,
      } satisfies NativeSaveReceipt,
    };
  }
  const [next, comparison] = await Promise.all([
    docxLens.open(output, "strict-native"),
    comparePackages(payload, output),
  ]);
  const nextProjection = bindDocxProjectionSource(
    next.projection,
    String(workId),
    hash,
  );
  const readbackDigest = await docxProjectionReadbackDigest(
    nextProjection,
    projection,
  );
  if (readbackDigest !== requestedDigest)
    throw new DocxLensError("DOCX_READBACK_MISMATCH", "Word readback did not match the requested text, image, page, or header/footer edit.");
  await assertNativePreservationKept({ entries: opened.fidelityMap.entries, parts: comparison.parts,
    before: opened.preservedCarry.safePayload ?? payload, after: next.preservedCarry.safePayload ?? output,
    intent: { format: "docx", projection: opened.projection, operations },
  });
  const local = workTruth.replicas.find(
    (replica) => replica.kind === "local" && replica.state !== "unavailable",
  );
  const changedPartNames = comparison.parts.filter((part) => part.verdict !== "identical").map((part) => `/${part.name}`);
  const nativeReceipt: NativeSaveReceipt = {
    kind: "native-office-save",
    format: "docx",
    operationId: nativeOperationId(String(workId), truth.revision, hash),
    artifactId: String(workId),
    basePayloadHash: truth.hash,
    resultPayloadHash: hash,
    baseRevision: truth.revision,
    resultRevision: hash,
    targets: { regionIds, partNames: changedPartNames },
    semantic: { baseDigest: opened.projection.nativeBinding.semanticDigest, resultDigest: requestedDigest, readbackDigest },
    preservedPartNames: comparison.parts.filter((part) => part.verdict === "identical").map((part) => `/${part.name}`),
    state: local ? "pending" : "cloud_saved",
  };
  const stored = await uploadNativePayload(workId, output, hash, truth.nativeFormat);
  const saveCloud = () => convexMutation("replicas:commitCloudMaterialization", {
    workId, payloadRef: stored.payloadRef, contentHash: hash, baseRevision: truth.revision,
    projectionContent: compactDocxProjectionForStorage(nextProjection),
    projectionContentHash: nextProjection.nativeBinding.semanticDigest, fidelityMap: next.fidelityMap, nativeReceipt,
  });
  if (!local) {
    await saveCloud();
    return {
      state: "cloud_saved" as const,
      hash,
      projectionContent: compactDocxProjectionForStorage(nextProjection),
      receipt: nativeReceipt,
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
      nativeReceipt?: NativeSaveReceipt;
      promotionMode?: "verified-first" | "immediate-projection";
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
      nativeReceipt,
      localReplicaId: local._id as Id<"workReplicas">,
      baseContent: compactDocxProjectionForStorage(opened.projection),
      baseContentHash: opened.projection.nativeBinding.semanticDigest,
      baseTextIndex: opened.projection.blocks
        .map((block) => block.text)
        .join("\n")
        .slice(0, 200_000),
      projectionContent: compactDocxProjectionForStorage(nextProjection),
      projectionContentHash: nextProjection.nativeBinding.semanticDigest,
      projectionTextIndex: nextProjection.blocks
        .map((block) => block.text)
        .join("\n")
        .slice(0, 200_000),
      ...(options?.promotionMode
        ? { promotionMode: options.promotionMode }
        : {}),
    });
  } catch (error) {
    if (attempt === 0 && error instanceof Error && error.message.includes("MATERIALIZATION_BASE_STALE"))
      return materializeDocxArtifactAttempt(workId, content, attempt + 1, options);
    if (error instanceof Error && error.message.includes("LOCAL_REPLICA_UNAVAILABLE")) {
      await saveCloud();
      return {
        state: "cloud_saved" as const,
        hash,
        projectionContent: compactDocxProjectionForStorage(nextProjection),
        receipt: nativeReceipt,
        status:
          "Spectra saved your edit. Open this file from Library with the Spectra bridge connected to update the Word copy on this computer.",
      };
    }
    throw error;
  }
  return {
    state: queued.state,
    requestId: queued.requestId,
    hash,
    projectionContent: compactDocxProjectionForStorage(nextProjection),
    receipt: nativeReceipt,
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

async function storedDocxBase(workId: Id<"spectraArtifacts">, cloudTruth: Awaited<ReturnType<typeof fetchVerifiedNativePayload>>["truth"], fallback: Uint8Array) {
  return docxLens.open(await fetchStoredNativeBase(workId, cloudTruth, fallback), "strict-native");
}

function conflictIds(conflicts: readonly MergeConflict<unknown>[]) {
  return conflicts.map((conflict) => conflict.id);
}

function conflictDetails(conflicts: readonly MergeConflict<DocxProjection["blocks"][number]>[]) {
  return conflicts.map(conflictPreview);
}

async function commitDocxNative(
  workId: Id<"spectraArtifacts">,
  local: Awaited<ReturnType<typeof fetchVerifiedNativePayload>>,
  base: Awaited<ReturnType<typeof docxLens.open>>,
  external: Awaited<ReturnType<typeof docxLens.open>>,
  partNames: string[],
  keepWord = false,
) {
  return reconcileNativeRevision({ workId, localReplicaId: local.truth.replicaId as Id<"workReplicas">,
    localPayloadRef: local.truth.payloadRef, localRevision: local.truth.revision }, {
    typeKey: "document", fidelityMap: external.fidelityMap, partNames,
    nativeBaseRevision: local.truth.projectionBaseRevision ?? local.truth.baseRevision ?? null,
    nativeBasePayloadHash: await sha256Payload(base.preservedCarry.payload),
    ...(keepWord ? { resolution: "local" as const } : {}),
    merge: currentContent => {
      const current = contentProjection(currentContent, base.projection);
      const merged = mergeDocxProjections(base.projection, current, external.projection, undefined, true);
      const projection = bindDocxProjectionSource(keepWord ? external.projection : merged.projection,
        String(workId), local.truth.hash);
      return { content: compactDocxProjectionForStorage(projection), regionIds: merged.externalChanged,
        conflictRegionIds: keepWord ? [] : conflictIds(merged.conflicts),
        previews: conflictDetails(merged.conflicts as MergeConflict<DocxProjection["blocks"][number]>[]) };
    },
  });
}

function errorResponse(error: unknown) {
  const status = /NATIVE_RECONCILIATION_BUSY|EXTERNAL_RESOLUTION_STALE|EXTERNAL_NATIVE_BASE_CHANGED/.test(String(error))
    ? 409 : error instanceof DocxLensError &&
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
    if (input.action === "download-copy") {
      await ensureImportedNativePayload(workId);
      const [cloud, artifact] = await Promise.all([
        fetchVerifiedNativePayload(workId, "cloud"),
        convexQuery<{ artifactId: Id<"spectraArtifacts"> }, ArtifactTruth & { currentVersionId?: string }>(
          "spectraArtifacts:get", { artifactId: workId },
        ),
      ]);
      const savedContent = await hydrateContentForWrite(input.artifactId, artifact.content);
      const opened = await docxLens.open(cloud.payload, "strict-native");
      const { projection, operations } = docxProjectionFromContent(savedContent, opened.projection);
      const output = operations.length
        ? await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations }, nativeWriteOptions)
        : cloud.payload;
      const [reopened, comparison] = await Promise.all([
        docxLens.open(output, "strict-native"),
        comparePackages(cloud.payload, output),
      ]);
      if (await docxProjectionReadbackDigest(reopened.projection, projection) !== await docxProjectionSemanticDigest(projection))
        throw new DocxLensError("DOCX_READBACK_MISMATCH", "The downloaded Word copy did not match the saved document.");
      await assertNativePreservationKept({ entries: opened.fidelityMap.entries, parts: comparison.parts,
        before: opened.preservedCarry.safePayload ?? cloud.payload, after: reopened.preservedCarry.safePayload ?? output,
        intent: { format: "docx", projection: opened.projection, operations },
      });
      const fileName = `${(artifact.title || "Spectra document").replace(/\.docx$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")}.docx`;
      return new NextResponse(Buffer.from(output), { headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Length": String(output.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "X-Spectra-Saved-Version": artifact.currentVersionId ?? "unversioned",
      } });
    }
    if (input.action === "materialize") {
      await ensureImportedNativePayload(workId);
      if (input.content === undefined) {
        // Materialize from the same acknowledged collaboration log that saved
        // versions use, then read its canonical current artifact projection.
        await checkpointArtifactDurableContent(input.artifactId);
        const artifact = await convexQuery<
          { artifactId: Id<"spectraArtifacts"> },
          ArtifactTruth & { currentVersionId?: string }
        >("spectraArtifacts:get", { artifactId: workId });
        input.content = artifact.content;
      } else {
        input.content = await hydrateContentForWrite(input.artifactId, input.content);
      }
    }

    if (input.action === "open") {
      // Legacy Library imports retain the exact original in import storage,
      // but may not yet have a cloud native replica. Adopt that verified copy
      // before the projection (and its image URLs) tries to read the payload.
      await ensureImportedNativePayload(workId);
      let cloud: Awaited<ReturnType<typeof fetchVerifiedNativePayload>>;
      try {
        cloud = await fetchVerifiedNativePayload(workId, "cloud");
      } catch (error) {
        // No retained native bytes on the replica wire (typical Library DOCX
        // import without Bridge). Projection content is already on the artifact.
        if (error instanceof Error && error.message === "NATIVE_PAYLOAD_UNAVAILABLE") {
          return NextResponse.json({ state: "opened", deferredNative: true });
        }
        throw error;
      }
      const { truth, payload } = cloud;
      const opened = await docxLens.open(payload, "strict-native");

      // A Bridge external revision may arrive after the cloud projection was
      // last activated. Reconcile it before opening so the user sees the
      // native file they just saved, while still failing closed on overlap.
      try {
        const local = await fetchVerifiedNativePayload(workId, "local-latest");
        const workTruth = await convexQuery<{ workId: Id<"spectraArtifacts"> }, WorkTruth>(
          "replicas:forWork",
          { workId },
        );
        const externalNeedsActivation = shouldActivateExternalNativeRevision({
          operations: workTruth.recentOperations,
          localHash: local.truth.hash,
          cloudHash: truth.hash,
        });
        if (externalNeedsActivation) {
          const externalOpened = await docxLens.open(local.payload, "strict-native");
          const baseOpened = await storedDocxBase(workId, local.truth, cloud.payload);
          const diff = await docxLens.diffExternal(baseOpened.preservedCarry.payload, local.payload);
          const recorded = await commitDocxNative(workId, local, baseOpened, externalOpened, diff.preservedPartChanges);
          return NextResponse.json({
            state: recorded.state === "applied" ? "opened" : "conflicted",
            durableNative: true, receipt: recorded.receipt,
            ...(recorded.state === "applied" ? { projection: recorded.content,
              fidelityMap: externalOpened.fidelityMap, capabilities: externalOpened.capabilities } : {
              conflict: { regionIds: recorded.conflictRegionIds, previews: recorded.previews,
                message: "The Word file and Spectra changed the same regions. Choose which version to keep." },
            }),
          });
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
      const activation = await convexMutation<
        {
          workId: Id<"spectraArtifacts">;
          payloadHash: string;
          content: DocxProjection;
          fidelityMap: unknown;
          semanticDigest: string;
          nativeFormat: string;
        },
        { activated: boolean }
      >("replicas:activateLens", {
        workId,
        payloadHash: truth.hash,
        content: compactDocxProjectionForStorage(activatedProjection),
        fidelityMap: opened.fidelityMap,
        semanticDigest: activatedProjection.nativeBinding.semanticDigest,
        nativeFormat: activatedProjection.nativeBinding.format,
      });
      if (!activation.activated) return NextResponse.json({ state: "opened" });
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
    if (cloud.truth.hash === local.truth.hash && !input.resolution) return NextResponse.json({ state: "current" });
    const [baseOpened, externalOpened] = await Promise.all([
      storedDocxBase(workId, local.truth, cloud.payload),
      docxLens.open(local.payload, "strict-native"),
    ]);
    const diff = await docxLens.diffExternal(baseOpened.preservedCarry.payload, local.payload);
    if (input.resolution === "spectra") {
      const current = contentProjection(artifact.content, baseOpened.projection);
      const mergedResult = mergeDocxProjections(baseOpened.projection, current, externalOpened.projection, undefined, true);
      const spectraChanged = new Set(mergedResult.spectraChanged);
      const conflictRegionIds = conflictIds(mergedResult.conflicts);
      const resolved = mergeDocxProjections(baseOpened.projection, current, externalOpened.projection, "spectra", true);
      const output = await docxLens.materialize({
        projection: resolved.projection,
        carry: externalOpened.preservedCarry,
        options: nativeWriteOptions,
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
      const requestedDigest = await docxProjectionSemanticDigest(resolved.projection);
      const readbackDigest = await docxProjectionReadbackDigest(
        nextProjection,
        resolved.projection,
      );
      if (readbackDigest !== requestedDigest)
        throw new DocxLensError("DOCX_READBACK_MISMATCH", "Word readback did not match the requested text, image, page, or header/footer edit.");
      await assertNativePreservationKept({ entries: externalOpened.fidelityMap.entries, parts: comparison.parts,
        before: externalOpened.preservedCarry.safePayload ?? local.payload, after: next.preservedCarry.safePayload ?? output,
        intent: { format: "docx", projection: externalOpened.projection, operations: docxOperationsBetween(externalOpened.projection, resolved.projection) },
      });
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
        projectionContent: compactDocxProjectionForStorage(nextProjection),
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
    const recorded = await commitDocxNative(workId, local, baseOpened, externalOpened,
      diff.preservedPartChanges, input.resolution === "word");
    return NextResponse.json({ state: recorded.state, durableNative: true, receipt: recorded.receipt,
      ...(recorded.state === "applied" ? { projection: recorded.content, attribution: "Edited in Word" } : {
        conflict: { regionIds: recorded.conflictRegionIds, previews: recorded.previews,
          message: "Word and Spectra changed the same regions. Choose which version to keep." },
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
