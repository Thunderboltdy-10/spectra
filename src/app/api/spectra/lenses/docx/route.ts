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

type PayloadTruth = {
  url: string | null;
  bytes: number;
  hash: string;
  mediaType: string;
  payloadRef: string;
  replicaId: string;
  replicaKind: "cloud" | "local";
  revision: string;
  baseRevision?: string;
  state: string;
  nativeFormat: string;
  fidelityMap?: unknown;
  compatibilityProfile: "strict-native" | "enhanced" | "spectra-native";
};

type WorkTruth = {
  replicas: Array<{
    _id: string;
    kind: "cloud" | "local";
    revision: string;
    state: string;
    payloadRef?: string;
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

async function payloadForWork(
  workId: Id<"spectraArtifacts">,
  prefer: "cloud" | "local-latest",
) {
  const truth = await convexQuery<
    { workId: Id<"spectraArtifacts">; prefer: typeof prefer },
    PayloadTruth | null
  >("replicas:payloadForWork", { workId, prefer });
  if (!truth?.url) throw new Error("DOCX_PAYLOAD_UNAVAILABLE");
  const response = await fetch(truth.url, { cache: "no-store" });
  if (!response.ok) throw new Error("DOCX_PAYLOAD_FETCH_FAILED");
  const payload = new Uint8Array(await response.arrayBuffer());
  if (payload.byteLength !== truth.bytes || (await sha256Payload(payload)) !== truth.hash)
    throw new Error("DOCX_PAYLOAD_VERIFICATION_FAILED");
  return { truth, payload };
}

function contentProjection(value: unknown, base: DocxProjection): DocxProjection {
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
  return {
    blocks: parsed.blocks,
    outline: parsed.outline ?? base.outline,
    nativeBinding: base.nativeBinding,
  };
}

async function uploadPayload(payload: Uint8Array, hash: string) {
  const uploadUrl = await convexMutation<Record<string, never>, string>(
    "payloads:issueUpload",
    {},
  );
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    body: Buffer.from(payload),
  });
  const stored = (await response.json().catch(() => null)) as
    | { storageId?: string }
    | null;
  if (!response.ok || !stored?.storageId)
    throw new Error("DOCX_PAYLOAD_UPLOAD_FAILED");
  return convexMutation<
    {
      hash: string;
      storageId: Id<"_storage">;
      bytes: number;
      mediaType: string;
    },
    { payloadRef: string; deduplicated: boolean }
  >("payloads:put", {
    hash,
    storageId: stored.storageId as Id<"_storage">,
    bytes: payload.byteLength,
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function changedRegions(before: DocxProjection, after: DocxProjection) {
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
      const { truth, payload } = await payloadForWork(workId, "cloud");
      const opened = await docxLens.open(payload, "strict-native");
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
      const [{ truth, payload }, workTruth] = await Promise.all([
        payloadForWork(workId, "cloud"),
        convexQuery<{ workId: Id<"spectraArtifacts"> }, WorkTruth>(
          "replicas:forWork",
          { workId },
        ),
      ]);
      const opened = await docxLens.open(payload, "strict-native");
      const projection = contentProjection(input.content, opened.projection);
      const regionIds = changedRegions(opened.projection, projection);
      const output = await docxLens.materialize({
        projection,
        carry: opened.preservedCarry,
      });
      const hash = await sha256Payload(output);
      if (hash === truth.hash)
        return NextResponse.json({ state: "unchanged", hash });
      const [next, comparison] = await Promise.all([
        docxLens.open(output, "strict-native"),
        comparePackages(payload, output),
      ]);
      const stored = await uploadPayload(output, hash);
      const local = workTruth.replicas.find((replica) => replica.kind === "local");
      if (!local) throw new Error("LOCAL_REPLICA_UNAVAILABLE");
      const partNames = comparison.parts
        .filter((part) => part.verdict !== "identical")
        .map((part) => `/${part.name}`);
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
        partNames,
      });
      return NextResponse.json({
        state: queued.state,
        requestId: queued.requestId,
        hash,
        status: "Waiting to save locally",
      });
    }

    const [cloud, local, artifact] = await Promise.all([
      payloadForWork(workId, "cloud"),
      payloadForWork(workId, "local-latest"),
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
      const stored = await uploadPayload(output, hash);
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
