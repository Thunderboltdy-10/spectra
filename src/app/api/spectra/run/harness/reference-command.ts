import { createHash } from "node:crypto";
import { applyAiArtifactMutation } from "@/features/spectra/ai/yjs-artifact-operation";
import { insertOperationReference, type OperationReference } from "@/features/spectra/operations/reference-content";
import { throwIfAborted } from "./abort";
import { mutate, query } from "./io";

type ReferenceReceipt = { embedId: string; operationId: string; versionId: string; phase: "canonical_write" };

export async function executeReferenceInsertion(input: {
  actorClerkId: string; runId: string; executionId: string; operationId: string;
  hostWorkId: string; targetWorkId: string; label?: string; signal?: AbortSignal;
}) {
  throwIfAborted(input.signal);
  const host = await query<{ actorClerkId: string; artifactId: string }, { blueprintKey: string; compatibilityProfile?: string }>(
    "spectraArtifacts:get", { actorClerkId: input.actorClerkId, artifactId: input.hostWorkId });
  if (!["document", "whiteboard", "presentation"].includes(host.blueprintKey))
    throw new Error("Live references can be inserted into documents, whiteboards, and presentations. Use one of those as the host.");
  if (host.compatibilityProfile === "strict-native")
    throw new Error("This file keeps strict native compatibility. Change it to Enhanced before adding a live reference.");
  const target = await query<{ actorClerkId: string; artifactId: string }, { title: string; blueprintKey: string; schemaVersion?: number }>(
    "spectraArtifacts:get", { actorClerkId: input.actorClerkId, artifactId: input.targetWorkId });
  const containerRegionId = `reference:${createHash("sha256").update(input.operationId).digest("hex").slice(0, 32)}`;
  const sourceAnchor = { workId: input.targetWorkId, workType: target.blueprintKey, kind: "work:root",
    path: ["work", "root"], stableIds: { workId: input.targetWorkId }, schemaVersion: target.schemaVersion ?? 1 };
  // Presentation labels are not part of placement identity: a source title can
  // change between persistence and receipt reconciliation.
  const placement = { containerType: "artifact", containerId: input.hostWorkId, containerRegionId,
    sourceArtifactId: input.targetWorkId, mode: "compact", interaction: "read", versionPolicy: "live",
    contextPolicy: "summary", placementOperationId: input.operationId,
    displayPreferences: { sourceWorkType: target.blueprintKey, anchorKind: "work:root", sourceAnchor } };
  throwIfAborted(input.signal);
  const created = await mutate<typeof placement, { embedId: string }>("artifactEmbeds:create", placement);
  const readReceipt = () => query<{ embedId: string; placementOperationId: string }, ReferenceReceipt | null>(
    "artifactEmbeds:getPlacementReceipt", { embedId: created.embedId, placementOperationId: input.operationId });
  const existing = await readReceipt();
  if (existing) return { ok: true, status: "canonical_write", receipt: existing, replayed: true,
    hostWorkId: input.hostWorkId, targetWorkId: input.targetWorkId };
  const reference: OperationReference = { ...placement, embedId: created.embedId, state: "ready",
    label: input.label?.trim() || target.title };
  throwIfAborted(input.signal);
  await applyAiArtifactMutation({
    artifactId: input.hostWorkId, runId: input.runId, executionId: input.executionId, operationId: input.operationId,
    signal: input.signal, operations: [host.blueprintKey === "document" ? "document.insert.reference" : "app.reference.insert"],
    beforeCommit: async () => { throwIfAborted(input.signal); }, receipt: "placement",
    resolveDesired: (current) => ({ ...current, content: insertOperationReference(host.blueprintKey, current.content, reference) }),
  });
  // The existing change-group writer confirms placements in the transaction
  // that stores the immutable version. A room ack alone is insufficient.
  for (let attempt = 0; attempt < 8; attempt++) {
    const receipt = await readReceipt();
    if (receipt) return { ok: true, status: "canonical_write", receipt, replayed: false,
      hostWorkId: input.hostWorkId, targetWorkId: input.targetWorkId };
    throwIfAborted(input.signal);
    if (attempt < 7) await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("REFERENCE_RECEIPT_PENDING: The live edit was sent, but its saved version is not acknowledged yet. Reconcile this operation before reporting completion.");
}
