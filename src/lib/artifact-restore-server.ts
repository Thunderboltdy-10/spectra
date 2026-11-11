import "server-only";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import type { ApiFromModules, FunctionReturnType } from "convex/server";
import type { RestoreCommitArgs } from "../../convex/artifactRestore";
import { convexQuery } from "./convex-server";
import { getConvexUrl } from "./env";
import { storeCommitContent } from "./native-reconciliation-server";
import { createCollaborationGatewayBridgeClient } from "../../scripts/collaboration-gateway-bridge-client.mjs";
import { applyStoredRoomUpdates } from "../../scripts/collaboration-room-state.mjs";
import { createDurablePayloadManifest } from "../../scripts/collaboration-durable-capacity.mjs";
import { encodeDurableFrontier } from "../../shared/collaboration-durable-frontier.mjs";
import { encodeArtifactContentForStorage } from "../../shared/sheet-cells";
import { boundedRegionClaims } from "../../shared/region-claim-policy";
import { isArtifactTypeKey } from "../features/spectra/artifacts/registry";
import { planArtifactYjsMutation, planArtifactYjsRestore, readArtifactYjsDocument,
  type ArtifactLiveValue } from "../features/spectra/collaboration/artifact-yjs-model";
import { planNativeArtifactYjsMutation, planNativeArtifactYjsRestore,
  readNativeArtifactYjsDocument } from "../features/spectra/work/models/yjs/native-artifact-model";
import { workYjsAdapter } from "../features/spectra/work/models/yjs/registry";

type RestoreApi = ApiFromModules<{ restore: typeof import("../../convex/artifactRestore") }>;
type RestoreHead = Exclude<FunctionReturnType<RestoreApi["restore"]["head"]>, { committed: object }>;
type RestoreResult = FunctionReturnType<RestoreApi["restore"]["commit"]>;
export type RestoreRequest = RestoreCommitArgs["request"];
export type PrepareNativeRestore = (input: {
  artifactId: RestoreRequest["artifactId"];
  desired: ArtifactLiveValue;
  current: ArtifactLiveValue;
  regionIds?: string[];
  historicalSource: RestoreHead["nativeSource"];
  nativeFormat?: string;
}) => Promise<{
  projectionContent: unknown;
  nativeSource: NonNullable<RestoreCommitArgs["nativeSource"]>;
  nativeCandidate: NonNullable<RestoreCommitArgs["nativeCandidate"]>;
}>;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("base64url");

/** Plain words for restore refusals a student can meet. Every refusal leaves
 * the current work unchanged, so each message says so; internal codes stay in logs. */
export function artifactRestoreFailure(error: unknown): { message: string; status: number } | null {
  const text = String(error instanceof Error ? error.message : error);
  if (/ARTIFACT_RESTORE_STALE|ARTIFACT_RESTORE_NATIVE_BASE_STALE|MATERIALIZATION_BASE_STALE|COLLABORATION_BASE_STATE_STALE|COLLABORATION_REPLAY_GENERATION_CHANGED/.test(text))
    return { message: "New changes arrived before restoration. Review the current version and try again.", status: 409 };
  if (/ARTIFACT_RESTORE_NATIVE_BASE_LIMIT/.test(text))
    return { message: "This artifact is linked to too many computers for Spectra to restore it safely. Your artifact hasn't changed. Ask your teacher or school admin for help.", status: 409 };
  if (/ARTIFACT_RESTORE_NATIVE_SOURCE_(UNAVAILABLE|INVALID|AMBIGUOUS)/.test(text))
    return { message: "The saved file for this version is no longer available, so Spectra can't restore it. Your artifact hasn't changed.", status: 409 };
  return null;
}

/** Reconstruct once and fence that exact base. A changed head is returned to
 * the user for review; it is never silently rebased into a different restore. */
export async function admitArtifactRestore(request: RestoreRequest, prepareNative: PrepareNativeRestore): Promise<RestoreResult> {
  const head = await convexQuery<{ request: RestoreRequest }, FunctionReturnType<RestoreApi["restore"]["head"]>>(
    "artifactRestore:head", { request });
  if (head.committed) return head.committed;
  const typeKey = head.artifact.blueprintKey;
  if (!isArtifactTypeKey(typeKey)) throw new Error("ARTIFACT_RESTORE_TYPE_UNAVAILABLE");
  const bridge = createCollaborationGatewayBridgeClient({ convexUrl: getConvexUrl(), bridgeKey: process.env.SPECTRA_COLLAB_BRIDGE_KEY! });
  const context = { artifactId: request.artifactId, accountId: head.accountId, partitionKey: "root", policyVersion: head.room.policyVersion };
  const stored = await bridge("load", context);
  if (!stored || stored.roomId !== head.room._id || stored.nextSequence !== head.room.nextSequence)
    throw new Error("ARTIFACT_RESTORE_STALE: New changes arrived. Review the current version before restoring.");
  const document = applyStoredRoomUpdates(Y, stored);
  let scratch: Y.Doc | undefined;
  try {
    if (!encodeDurableFrontier(Y, document)) throw new Error("ARTIFACT_RESTORE_ROOM_INCOMPLETE");
    const baseVector = Y.encodeStateVector(document);
    const native = readNativeArtifactYjsDocument(document, typeKey);
    const legacy = native ? null : readArtifactYjsDocument(document, typeKey);
    let current = native ?? legacy;
    const nativeModel = Boolean(native || !legacy);
    const actor = { kind: "human" as const, accountId: head.accountId, clientId: request.clientId };
    if (!current) {
      if (head.room.nextSequence !== 1) throw new Error("ARTIFACT_RESTORE_ROOM_INCOMPLETE");
      current = { title: head.artifact.title, summary: head.artifact.summary, tags: head.artifact.tags, content: head.artifact.content };
      document.transact(planNativeArtifactYjsMutation(document, typeKey, current, actor).apply, "history-restore-bootstrap");
    }
    const source = head.source as ArtifactLiveValue;
    if (!source || typeof source.title !== "string" || !Array.isArray(source.tags) || source.content === undefined)
      throw new Error("ARTIFACT_RESTORE_SNAPSHOT_UNAVAILABLE");
    const selected = request.regionIds?.length ? request.regionIds : undefined;
    scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(document));
    const restore = nativeModel ? planNativeArtifactYjsRestore(scratch, typeKey, source, actor, selected)
      : planArtifactYjsRestore(scratch, typeKey, source, selected);
    scratch.transact(restore.apply, "history-restore-preview");
    let desired = (nativeModel ? readNativeArtifactYjsDocument(scratch, typeKey) : readArtifactYjsDocument(scratch, typeKey));
    if (!desired || !encodeDurableFrontier(Y, scratch)) throw new Error("ARTIFACT_RESTORE_PROJECTION_INVALID");
    let nativePreparation: Awaited<ReturnType<PrepareNativeRestore>> | undefined;
    if (head.nativeRequired) {
      nativePreparation = await prepareNative({ artifactId: request.artifactId, current, desired, regionIds: selected,
        historicalSource: head.whole ? head.nativeSource : null,
        nativeFormat: head.artifact.nativeFormat ?? head.replicas.find(replica => replica.nativeFormat)?.nativeFormat });
      // Compare the native readback in the same canonical shape the room uses.
      const adapter = workYjsAdapter(typeKey);
      const readback = adapter.createDocument(nativePreparation.projectionContent);
      try { nativePreparation.projectionContent = adapter.project(readback); }
      finally { readback.destroy(); }
      const candidate = nativePreparation.nativeCandidate;
      if (candidate.destination === "bridge") candidate.queue.projectionContent = nativePreparation.projectionContent;
      else if (candidate.destination === "cloud") candidate.cloud.projectionContent = nativePreparation.projectionContent;
      desired = { ...desired, content: nativePreparation.projectionContent };
    }
    const plan = nativeModel ? planNativeArtifactYjsMutation(document, typeKey, desired, actor)
      : planArtifactYjsMutation(document, typeKey, desired);
    document.transact(plan.apply, "history-restore-admitted-candidate");
    const after = nativeModel ? readNativeArtifactYjsDocument(document, typeKey) : readArtifactYjsDocument(document, typeKey);
    if (!after || !encodeDurableFrontier(Y, document)) throw new Error("ARTIFACT_RESTORE_PROJECTION_INVALID");
    const beforeProjection = { ...current, typeKey, schemaVersion: head.room.schemaVersion };
    const afterProjection = { ...after, typeKey, schemaVersion: head.room.schemaVersion };
    const [beforeContent, afterContent] = await Promise.all([
      storeCommitContent(encodeArtifactContentForStorage(typeKey, current.content), context, bridge),
      storeCommitContent(encodeArtifactContentForStorage(typeKey, after.content), context, bridge),
    ]);
    const nativeCandidate = nativePreparation?.nativeCandidate;
    if (nativeCandidate?.destination === "bridge") {
      const queue = nativeCandidate.queue;
      nativeCandidate.queue = { ...queue,
        baseContent: await storeCommitContent(queue.baseContent, context, bridge),
        projectionContent: await storeCommitContent(queue.projectionContent, context, bridge) };
    } else if (nativeCandidate?.destination === "cloud") {
      nativeCandidate.cloud = { ...nativeCandidate.cloud,
        projectionContent: await storeCommitContent(nativeCandidate.cloud.projectionContent, context, bridge) };
    }
    const update = Y.encodeStateAsUpdate(document, baseVector);
    let updatePayload: { update: string; payloadRef?: string; payloadDigest?: string; byteLength?: number; payloadManifest?: unknown } = {
      update: Buffer.from(update).toString("base64"),
    };
    const spillUpdate = async () => {
      const updateDigest = createHash("sha256").update(update).digest("hex");
      const uploaded = await bridge("storeDurablePayload", { ...context, kind: "yjs-update", digest: updateDigest,
        mediaType: "application/vnd.spectra.yjs-update", bytesBase64: Buffer.from(update).toString("base64") });
      updatePayload = { update: "", payloadRef: uploaded.payloadRef, payloadDigest: updateDigest, byteLength: update.byteLength,
        payloadManifest: createDurablePayloadManifest({ kind: "yjs-update", bytes: update, payloadRef: uploaded.payloadRef,
          mediaType: "application/vnd.spectra.yjs-update" }) };
    };
    if (update.byteLength > 600 * 1024) await spillUpdate();
    const wire = { ...context, request, expectedHeadHash: head.headHash,
      beforeProjectionJson: JSON.stringify({ ...beforeProjection, content: beforeContent }), beforeProjectionHash: digest(JSON.stringify(beforeProjection)),
      append: { ...context, ...updatePayload, actorKind: "human", clientId: request.clientId, idempotencyKey: `restore:${request.requestId}`,
        expectedRoomId: head.room._id, expectedNextSequence: head.room.nextSequence, baseStateVectorHash: digest(baseVector),
        stateVectorHash: digest(Y.encodeStateVector(document)),
        regionIds: plan.regions.length ? boundedRegionClaims(plan.regions).map(region => region.regionId) : ["metadata:native"],
        projectionJson: JSON.stringify({ ...afterProjection, content: afterContent }), projectionHash: digest(JSON.stringify(afterProjection)) },
      ...(nativePreparation ? { nativeSource: nativePreparation.nativeSource, nativeCandidate } : {}) };
    if (!updatePayload.payloadRef && Buffer.byteLength(JSON.stringify({ payloadJson: JSON.stringify(wire) })) > 1400 * 1024) {
      await spillUpdate();
      Object.assign(wire.append, updatePayload);
    }
    return await bridge("historyRestore", wire) as RestoreResult;
  } finally { scratch?.destroy(); document.destroy(); }
}
