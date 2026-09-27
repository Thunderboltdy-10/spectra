import "server-only";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import type { Id } from "../../../../convex/_generated/dataModel";
import { buildAiArtifactContentEvidence } from "../../../../convex/spectraArtifactWriteScope";
import { applyStoredRoomUpdates } from "../../../../scripts/collaboration-room-state.mjs";
import { artifactProjection } from "../../../../scripts/collaboration-artifact-projection.mjs";
import { durableFrontierHash, stateVectorHash } from "../../../../scripts/collaboration-canonical-room.mjs";
import { createDurablePayloadManifest } from "../../../../scripts/collaboration-durable-capacity.mjs";
import { contentDependencies } from "../../../../shared/durable-dependencies.mjs";
import { planNativeArtifactYjsMutation } from "../work/models/yjs/native-artifact-model";
import type { ArtifactTypeKey } from "../artifacts/types";
import type { ArtifactLiveValue } from "../collaboration/artifact-yjs-model";
import { readAdmittedAiUpdate, type AdmittedAiCommit, type CanonicalPayload, type PreparedCanonicalAiUpdate } from "./admitted-ai-update";

export type NativeAiHead = {
  accountId: Id<"accounts">;
  artifact: { _id: Id<"spectraArtifacts">; blueprintKey: ArtifactTypeKey; schemaVersion?: number;
    updatedAt: number; contentHash?: string; currentVersionId?: Id<"spectraArtifactVersions"> };
  operationDigest: string;
  prompt: string;
  operation: { id: string; type: string; input: Record<string, unknown>; writeScope?: unknown };
  sourceContentIdentity: string;
  room: { _id: Id<"collaborationRooms">; nextSequence: number; policyVersion: number } | null;
  committedResult: AdmittedAiCommit | null;
};
type StoredRoom = { roomId: string; nextSequence: number; liveStateVectorHash?: string;
  snapshot?: { update: string }; updates: { sequence: number; update: string }[] };
// The signed bridge verifies payloads and contiguous replay before returning.
export type AiCanonicalBridge = (operation: string, payload: Record<string, unknown>) => Promise<unknown>;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("base64url");
const scope = (head: NativeAiHead) => ({ artifactId: head.artifact._id, accountId: head.accountId,
  partitionKey: "root", policyVersion: head.room!.policyVersion });

export async function retryCanonicalAiMutation<T>(attempt: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let count = 0; ; count += 1) {
    signal?.throwIfAborted();
    try { return await attempt(); }
    catch (error) {
      // These explicit CAS refusals prove no effect committed. Ambiguous I/O
      // and receipt-consumption failures must never repeat a semantic write.
      if (count >= 2 || !/\bAI_NATIVE_(?:CANONICAL|SOURCE)_STALE\b/.test(String(error))) throw error;
    }
  }
}

export function assertPreparedAiCommit(prepared: PreparedCanonicalAiUpdate, admitted: AdmittedAiCommit) {
  const digest = prepared.append.payloadDigest ?? createHash("sha256")
    .update(Buffer.from(prepared.append.update, "base64")).digest("hex");
  if (admitted.receipt.roomId !== prepared.expected.roomId ||
      admitted.receipt.sequence !== prepared.expected.nextSequence || admitted.receipt.updateDigest !== digest)
    throw new Error("AI_ADMITTED_PREPARATION_MISMATCH");
}

/** Prepare from one durable head, after native readback. Never rebase a stale
 * normalized result: the caller must rerun the original semantic operation. */
export async function prepareCanonicalAiUpdate(args: {
  head: NativeAiHead; bridge: AiCanonicalBridge; authoredFrontier: string | null;
  desired: ArtifactLiveValue; clientId: string; operationId: string;
}): Promise<{ prepared: PreparedCanonicalAiUpdate; before: ArtifactLiveValue; after: ArtifactLiveValue }> {
  const { head } = args;
  if (!head.room || !args.authoredFrontier) throw new Error("AI_NATIVE_CANONICAL_STALE");
  const stored = await args.bridge("load", scope(head)) as StoredRoom | null;
  if (!stored || stored.roomId !== head.room._id || stored.nextSequence !== head.room.nextSequence)
    throw new Error("AI_NATIVE_CANONICAL_STALE");
  const scratch = applyStoredRoomUpdates(Y, stored) as Y.Doc;
  try {
    if (durableFrontierHash(scratch) !== args.authoredFrontier ||
        (stored.liveStateVectorHash && stateVectorHash(scratch) !== stored.liveStateVectorHash))
      throw new Error("AI_NATIVE_CANONICAL_STALE");
    const beforeProjectionJson = artifactProjection(scratch, head.artifact.schemaVersion ?? 1);
    if (!beforeProjectionJson) throw new Error("AI_NATIVE_PROJECTION_REQUIRED");
    const before = JSON.parse(beforeProjectionJson) as ArtifactLiveValue;
    const baseStateVectorHash = stateVectorHash(scratch);
    const vector = Y.encodeStateVector(scratch);
    const plan = planNativeArtifactYjsMutation(scratch, head.artifact.blueprintKey, args.desired, {
      clientId: args.clientId, kind: "ai", name: "Spectra AI",
    });
    scratch.transact(plan.apply, { kind: "spectra-ai-admission", operationId: args.operationId });
    const projectionJson = artifactProjection(scratch, head.artifact.schemaVersion ?? 1);
    if (!projectionJson) throw new Error("AI_NATIVE_PROJECTION_REQUIRED");
    const after = JSON.parse(projectionJson) as ArtifactLiveValue;
    const evidence = await buildAiArtifactContentEvidence({ blueprintKey: head.artifact.blueprintKey,
      input: head.operation.input, prompt: head.prompt, operationDigest: head.operationDigest,
      sourceContentIdentity: head.sourceContentIdentity, beforeContent: before.content, afterContent: after.content });
    const update = Y.encodeStateAsUpdate(scratch, vector);
    let envelope: CanonicalPayload = {
      update: Buffer.from(update).toString("base64"),
    };
    if (update.byteLength > 760 * 1024) {
      const digest = createHash("sha256").update(update).digest("hex");
      const payload = await args.bridge("storeDurablePayload", { ...scope(head), kind: "yjs-update", digest,
        mediaType: "application/vnd.spectra.yjs-update", bytesBase64: Buffer.from(update).toString("base64") }) as { payloadRef: string };
      envelope = { update: "", payloadRef: payload.payloadRef, payloadDigest: digest, byteLength: update.byteLength,
        payloadManifest: createDurablePayloadManifest({ kind: "yjs-update", bytes: update,
          payloadRef: payload.payloadRef, encoding: "payload-ref", mediaType: "application/vnd.spectra.yjs-update" }) };
    }
    const spillProjections = Buffer.byteLength(JSON.stringify({ beforeProjectionJson,
      append: { ...envelope, projectionJson } })) > 1200 * 1024;
    async function storedProjection(json: string) {
      if (!spillProjections && Buffer.byteLength(json) <= 256 * 1024) return json;
      const value = JSON.parse(json);
      const bytes = Buffer.from(json);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const payload = await args.bridge("storeDurablePayload", { ...scope(head), kind: "projection", digest,
        mediaType: "application/vnd.spectra.projection+json", bytesBase64: bytes.toString("base64"),
        dependencies: contentDependencies(value.content) }) as { payloadRef: string; dependencies: unknown };
      return JSON.stringify({ ...value, content: { spectraContentRef: { version: 1, artifactId: head.artifact._id,
        payloadRef: payload.payloadRef, digest, byteLength: bytes.length, path: "content", dependencies: payload.dependencies } } });
    }
    return { before, after, prepared: {
      expected: { roomId: head.room._id, nextSequence: head.room.nextSequence, artifactUpdatedAt: head.artifact.updatedAt,
        contentHash: head.artifact.contentHash ?? null, currentVersionId: head.artifact.currentVersionId ?? null },
      beforeProjectionJson: await storedProjection(beforeProjectionJson), beforeProjectionHash: hash(beforeProjectionJson),
      append: { ...envelope, ...scope(head), partitionKey: "root", actorKind: "ai", clientId: args.clientId,
        idempotencyKey: `native-ai:${args.operationId}:${hash(update)}`, expectedRoomId: head.room._id,
        expectedNextSequence: head.room.nextSequence, baseStateVectorHash, claimBaseStateVectorHash: baseStateVectorHash,
        stateVectorHash: stateVectorHash(scratch), regionIds: plan.regions.map(region => region.regionId),
        projectionJson: await storedProjection(projectionJson), projectionHash: hash(projectionJson) },
      evidence,
    } };
  } finally { scratch.destroy(); }
}

/** Exact receipt bytes, falling back only to a verified covering replay when
 * compaction has removed that row. No new semantic plan is evaluated here. */
export async function loadAdmittedAiUpdate(result: AdmittedAiCommit, bridge: AiCanonicalBridge,
  authority: { artifactId: string; accountId: string; policyVersion: number }) {
  if (result.admitted.encoding === "inline") return readAdmittedAiUpdate(result, {
    payload: async () => { throw new Error("AI_ADMITTED_UPDATE_INVALID"); },
    replay: async () => { throw new Error("AI_ADMITTED_UPDATE_INVALID"); },
  });
  const stored = await bridge("load", { ...authority, partitionKey: "root" }) as StoredRoom | null;
  if (!stored || stored.roomId !== result.receipt.roomId || stored.nextSequence - 1 < result.receipt.sequence)
    throw new Error("AI_ADMITTED_REPLAY_BEHIND_RECEIPT");
  const row = stored.updates.find(entry => entry.sequence === result.receipt.sequence);
  const selected: AdmittedAiCommit = row ? result : { ...result,
    admitted: { encoding: "replay", roomId: stored.roomId, throughSequence: stored.nextSequence - 1 } };
  return readAdmittedAiUpdate(selected, {
    payload: async () => Uint8Array.from(Buffer.from(row!.update, "base64")),
    replay: async () => {
      const document = applyStoredRoomUpdates(Y, stored) as Y.Doc;
      try {
        if (stored.liveStateVectorHash && stateVectorHash(document) !== stored.liveStateVectorHash)
          throw new Error("COLLABORATION_REPLAY_HEAD_MISMATCH");
        return { roomId: stored.roomId, throughSequence: stored.nextSequence - 1, update: Y.encodeStateAsUpdate(document) };
      } finally { document.destroy(); }
    },
  });
}
