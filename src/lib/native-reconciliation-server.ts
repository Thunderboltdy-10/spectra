import "server-only";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { convexMutation, convexQuery, storeArtifactContent } from "./convex-server";
import { getConvexUrl } from "./env";
import { createCollaborationGatewayBridgeClient } from "../../scripts/collaboration-gateway-bridge-client.mjs";
import { applyStoredRoomUpdates } from "../../scripts/collaboration-room-state.mjs";
import { createDurablePayloadManifest } from "../../scripts/collaboration-durable-capacity.mjs";
import { encodeDurableFrontier } from "../../shared/collaboration-durable-frontier.mjs";
import { encodeArtifactContentForStorage } from "../../shared/sheet-cells";
import { boundedRegionClaims } from "../../shared/region-claim-policy";
import { contentDependencies } from "../../shared/durable-dependencies.mjs";
import { readArtifactYjsDocument, type ArtifactLiveValue } from "@/features/spectra/collaboration/artifact-yjs-model";
import { planNativeArtifactYjsMutation, readNativeArtifactYjsDocument } from "@/features/spectra/work/models/yjs/native-artifact-model";
import type { Id } from "../../convex/_generated/dataModel";

type NativeType = "document" | "sheets" | "presentation";
const nativeSchemas = { document: 2, sheets: 4, presentation: 1 } as const;
type Preview = { regionId: string; spectra: string; external: string };
export type NativeMerge = {
  content: unknown;
  regionIds: string[];
  conflictRegionIds: string[];
  previews?: Preview[];
};
type NativeIdentity = {
  workId: Id<"spectraArtifacts">;
  localReplicaId: Id<"workReplicas">;
  localPayloadRef: string;
  localRevision: string;
};
type NativeReceipt = {
  versionId: string; roomId: string; sequence: number; updateDigest: string;
  projectionHash: string; localReplicaId: string; localPayloadRef: string;
  localRevision: string; nativeBaseRevision?: string; committedAt: number;
};
type NativeHead = {
  accountId: string;
  artifact: ArtifactLiveValue & { blueprintKey: NativeType | "resource"; schemaVersion?: number; updatedAt: number;
    contentHash?: string; currentVersionId?: string; liveStateVectorHash?: string };
  operationId: string;
} & ({ receipt: NativeReceipt } | { receipt: null; roomId: null } | {
  receipt: null; roomId: string; policyVersion: number; nextSequence: number; schemaVersion: number;
  nativeBaseRevision: string | null; cloudRevision: string | null;
  cloudPayloadRef: string | null; cloudPayloadHash: string | null;
});
export type NativeReconciliationResult = NativeMerge & {
  state: "applied" | "conflicted";
  durableNative: true;
  receipt?: NativeReceipt;
  duplicate?: boolean;
};

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("base64url");
const stale = (error: unknown) => /NATIVE_RECONCILIATION_STALE|COLLABORATION_BASE_STATE_STALE|COLLABORATION_REPLAY_GENERATION_CHANGED/.test(String(error));

async function storeCommitContent(
  value: unknown,
  context: { artifactId: string; partitionKey: string; accountId: string; policyVersion: number },
  bridge: ReturnType<typeof createCollaborationGatewayBridgeClient>,
) {
  const stored = await storeArtifactContent(context.artifactId, value);
  // This transaction carries two projections plus the conflict envelope. Size
  // the JSON-string encoding too, since quoted text is escaped again there.
  if (Buffer.byteLength(JSON.stringify(JSON.stringify(stored))) <= 128 * 1024) return stored;
  const bytes = Buffer.from(JSON.stringify(value));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const uploaded = await bridge("storeDurablePayload", { ...context, kind: "projection", digest,
    mediaType: "application/vnd.spectra.content+json", bytesBase64: bytes.toString("base64"),
    dependencies: contentDependencies(value) });
  return { spectraContentRef: { version: 1, artifactId: context.artifactId, payloadRef: uploaded.payloadRef,
    digest, byteLength: bytes.length, path: "value", dependencies: uploaded.dependencies } };
}

/** Recompute from the captured native ancestor on every explicit CAS loss.
 * The merge callback is the Office lens's semantic three-way merge, not a
 * relabeling of a stale candidate. Transport ambiguity retries the exact same
 * signed payload through the existing bridge client/receipt protocol. */
export async function reconcileNativeRevision(
  identity: NativeIdentity,
  options: {
    typeKey: NativeType;
    fidelityMap: unknown;
    partNames: string[];
    nativeBaseRevision: string | null;
    nativeBasePayloadHash: string;
    initialContent?: unknown;
    cloudSource?: { payloadRef: string; hash: string; revision: string };
    resolution?: "local" | "merged";
    merge: (currentContent: unknown) => NativeMerge | Promise<NativeMerge>;
  },
): Promise<NativeReconciliationResult> {
  let bridge: ReturnType<typeof createCollaborationGatewayBridgeClient> | undefined;
  let resolutionBase: string | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let document: Y.Doc | undefined;
    try {
      let head = await convexQuery<NativeIdentity, NativeHead>("nativeReconciliation:head", identity);
      if (head.receipt) return { state: "applied", durableNative: true, duplicate: true,
        receipt: head.receipt, content: undefined, regionIds: [], conflictRegionIds: [] };
      if (head.roomId === null) {
        await convexMutation("collaboration:ensureRoom", {
          artifactId: identity.workId, partitionKey: "root", schemaVersion: head.artifact.schemaVersion ?? 1,
        });
        head = await convexQuery<NativeIdentity, NativeHead>("nativeReconciliation:head", identity);
        if (head.receipt) return { state: "applied", durableNative: true, duplicate: true,
          receipt: head.receipt, content: undefined, regionIds: [], conflictRegionIds: [] };
        if (head.roomId === null) throw new Error("NATIVE_RECONCILIATION_STALE");
      }
      const activation = head.artifact.blueprintKey === "resource"
        ? { typeKey: options.typeKey, schemaVersion: nativeSchemas[options.typeKey] } : undefined;
      if (!activation && head.artifact.blueprintKey !== options.typeKey) throw new Error("NATIVE_RECONCILIATION_TYPE_MISMATCH");
      if (activation && (head.artifact.content != null || head.artifact.currentVersionId || head.nextSequence !== 1 ||
          options.initialContent == null || !options.cloudSource))
        throw new Error("NATIVE_RECONCILIATION_ACTIVATION_NOT_EMPTY");
      if (options.cloudSource && (head.cloudRevision !== options.cloudSource.revision ||
          head.cloudPayloadRef !== options.cloudSource.payloadRef || head.cloudPayloadHash !== options.cloudSource.hash))
        throw new Error("EXTERNAL_NATIVE_BASE_CHANGED");
      const activeBridge = bridge ??= createCollaborationGatewayBridgeClient({
        convexUrl: getConvexUrl(), bridgeKey: process.env.SPECTRA_COLLAB_BRIDGE_KEY!,
      });
      const context = { artifactId: identity.workId, partitionKey: "root", accountId: head.accountId,
        policyVersion: head.policyVersion };
      const stored = await activeBridge("load", context);
      if (!stored || stored.roomId !== head.roomId || stored.nextSequence !== head.nextSequence)
        throw new Error("NATIVE_RECONCILIATION_STALE");
      document = applyStoredRoomUpdates(Y, stored);
      if (!document || !encodeDurableFrontier(Y, document)) throw new Error("NATIVE_RECONCILIATION_CAUSAL_BASE_INCOMPLETE");
      if (activation && Y.encodeStateAsUpdate(document).some((byte: number) => byte !== 0))
        throw new Error("NATIVE_RECONCILIATION_ACTIVATION_NOT_EMPTY");
      const projected = readNativeArtifactYjsDocument(document, options.typeKey) ?? readArtifactYjsDocument(document, options.typeKey);
      if (!projected && head.nextSequence > 1) throw new Error("NATIVE_RECONCILIATION_CAUSAL_BASE_INCOMPLETE");
      const current = projected ?? { title: head.artifact.title, summary: head.artifact.summary, tags: head.artifact.tags,
        content: activation ? options.initialContent : head.artifact.content };
      if (head.nativeBaseRevision !== options.nativeBaseRevision) throw new Error("EXTERNAL_NATIVE_BASE_CHANGED");
      if (options.resolution) {
        const currentIdentity = digest(JSON.stringify(current));
        if (resolutionBase && resolutionBase !== currentIdentity) throw new Error("EXTERNAL_RESOLUTION_STALE: New edits arrived. Review the conflict again.");
        resolutionBase = currentIdentity;
      }
      const merged = await options.merge(current.content);
      const schemaVersion = activation?.schemaVersion ?? head.schemaVersion;
      const beforeProjection = { ...current, typeKey: options.typeKey, schemaVersion };
      const baseStateVectorHash = digest(Y.encodeStateVector(document));
      const nativeActor = { kind: "human" as const, accountId: head.accountId, clientId: `native:${head.operationId}` };
      const plan = planNativeArtifactYjsMutation(document, options.typeKey, { ...current, content: merged.content }, nativeActor);
      const updates: Uint8Array[] = [];
      const capture = (update: Uint8Array) => updates.push(update);
      document.on("update", capture);
      try {
        if (!merged.conflictRegionIds.length) document.transact(plan.apply, "native-reconciliation");
      } finally { document.off("update", capture); }
      const after = merged.conflictRegionIds.length ? current : readNativeArtifactYjsDocument(document, options.typeKey);
      if (!after || !encodeDurableFrontier(Y, document)) throw new Error("NATIVE_RECONCILIATION_PROJECTION_INVALID");
      const afterProjection = { ...after, typeKey: options.typeKey, schemaVersion };
      // Spill both immutable bodies before the effect transaction. Failed/CAS
      // attempts are unowned objects handled by the existing release policy.
      const [beforeContent, afterContent] = await Promise.all([
        storeCommitContent(encodeArtifactContentForStorage(options.typeKey, beforeProjection.content), context, activeBridge),
        storeCommitContent(encodeArtifactContentForStorage(options.typeKey, afterProjection.content), context, activeBridge),
      ]);
      const update = updates.length ? Y.mergeUpdates(updates) : new Uint8Array([0, 0]);
      let updatePayload: Record<string, unknown> = { update: Buffer.from(update).toString("base64") };
      const spillUpdate = async () => {
        const updateDigest = createHash("sha256").update(update).digest("hex");
        const uploaded = await activeBridge("storeDurablePayload", { ...context, kind: "yjs-update", digest: updateDigest,
          mediaType: "application/vnd.spectra.yjs-update", bytesBase64: Buffer.from(update).toString("base64") });
        updatePayload = { update: "", payloadRef: uploaded.payloadRef, payloadDigest: updateDigest, byteLength: update.byteLength,
          payloadManifest: createDurablePayloadManifest({ kind: "yjs-update", bytes: update, payloadRef: uploaded.payloadRef,
            mediaType: "application/vnd.spectra.yjs-update" }) };
      };
      if (update.byteLength > 760 * 1024) await spillUpdate();
      const request = {
        ...context,
        append: { ...context, ...updatePayload, actorKind: "human", clientId: nativeActor.clientId,
          idempotencyKey: nativeActor.clientId, expectedRoomId: head.roomId, expectedNextSequence: head.nextSequence,
          baseStateVectorHash, stateVectorHash: digest(Y.encodeStateVector(document)),
          regionIds: plan.regions.length ? boundedRegionClaims(plan.regions).map(region => region.regionId) : ["metadata:native"],
          projectionJson: JSON.stringify({ ...afterProjection, content: afterContent }),
          projectionHash: digest(JSON.stringify(afterProjection)) },
        external: { ...identity, ...merged, content: afterContent, fidelityMap: options.fidelityMap,
          partNames: options.partNames, ...(options.resolution ? { resolution: options.resolution } : {}) },
        operationId: head.operationId,
        expectedArtifactUpdatedAt: head.artifact.updatedAt, expectedContentHash: head.artifact.contentHash ?? null,
        expectedVersionId: head.artifact.currentVersionId ?? null, expectedNativeBaseRevision: head.nativeBaseRevision,
        expectedCloudRevision: head.cloudRevision,
        expectedCloudPayloadRef: head.cloudPayloadRef, expectedCloudPayloadHash: head.cloudPayloadHash,
        ...(activation ? { activation } : {}),
        nativeBasePayloadHash: options.nativeBasePayloadHash,
        beforeProjectionJson: JSON.stringify({ ...beforeProjection, content: beforeContent }),
        beforeProjectionHash: digest(JSON.stringify(beforeProjection)),
      };
      if (!updatePayload.payloadRef && Buffer.byteLength(JSON.stringify({ payloadJson: JSON.stringify(request) })) > 1400 * 1024) {
        await spillUpdate();
        Object.assign(request.append, updatePayload);
      }
      const result = await activeBridge("nativeReconcile", request) as { state: "applied" | "conflicted"; duplicate?: boolean; receipt?: NativeReceipt;
        conflictRegionIds?: string[]; previews?: Preview[] };
      // A matching receipt proves the business operation committed even when
      // this request prepared a different candidate after a lost response.
      // Return no candidate projection; the live log supplies current content.
      if (result.duplicate) return { ...merged, ...result, content: undefined, durableNative: true };
      return { ...merged, ...result, content: result.state === "applied" ? after.content : current.content, durableNative: true };
    } catch (error) {
      if (!stale(error)) throw error;
      if (attempt === 3) throw new Error("NATIVE_RECONCILIATION_BUSY: New changes arrived while importing the native file. Retry the import.");
    } finally { document?.destroy(); }
  }
  throw new Error("NATIVE_RECONCILIATION_BUSY: New changes arrived while importing the native file. Retry the import.");
}
