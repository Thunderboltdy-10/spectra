import { v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import { internalMutation } from "./orgNodeMutation";
import type { Id } from "./_generated/dataModel";
import { getActorForAccountId, getAuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { appendRoomUpdate, parseGatewayProjection } from "./collaborationGatewayStore";
import { commitChangeGroup, commitHumanCheckpoint } from "./changeGroups";
import { NATIVE_VERSION_OWNER_TABLE } from "./durablePayloadOwnership";
import { nativeAiCommitArgs, type NativeAiCommitArgs } from "./nativeAiCommitContract";
import { queueMaterializationInTransaction, commitCloudMaterializationInTransaction } from "./replicaMaterialization";
import { artifactOperationDigest, artifactOutput, artifactSourceIdentity, artifactWriteReceipt,
  assertVerifiedAiArtifactWriteAdmission, lookupVerifiedAiArtifactWriteReplay, preparedArtifactScope } from "./spectraArtifactWriteScope";
import { nativeAiRequestDigest, nativeAiUpdateIdentity } from "../shared/native-ai-commit";
import { validateNativeSaveReceipt } from "../shared/native-office-contract";
import type { AdmittedAiCommit } from "../src/features/spectra/ai/admitted-ai-update";

/** Authenticated physical head for cold Node preparation. Reading this head
 * never initializes a room or grants permission for a subsequent effect. */
export const head = query({
  args: { artifactId: v.id("spectraArtifacts"), aiOperation: nativeAiCommitArgs.aiOperation },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const { artifact } = await requireActorArtifactCapability(ctx, actor, args.artifactId, "modify");
    const [run, operation] = await Promise.all([ctx.db.get(args.aiOperation.runId), ctx.db.get(args.aiOperation.operationId)]);
    if (!run || !operation || run.ownerAccountId !== actor.accountId || run.schoolId !== actor.schoolId ||
        operation.actorType !== "ai" || operation.runId !== run._id || operation.type !== "artifact.update" ||
        artifactOutput(operation.input).artifactId !== artifact._id || operation.executionId !== args.aiOperation.executionId ||
        run.executionId !== args.aiOperation.executionId) throw new Error("AI_ARTIFACT_OPERATION_NOT_OWNED");
    const operationDigest = await artifactOperationDigest(operation);
    const receipt = artifactWriteReceipt(operation.output);
    if (receipt && receipt.scope !== operationDigest) throw new Error("AI_ARTIFACT_RECEIPT_SCOPE_MISMATCH");
    const room = receipt ? null : await ctx.db.query("collaborationRooms")
      .withIndex("by_artifact_partition", q => q.eq("artifactId", artifact._id).eq("partitionKey", "root")).unique();
    return { accountId: actor.accountId, artifact, operationDigest, prompt: run.userPrompt,
      operation: { id: operation._id, type: operation.type, input: operation.input, writeScope: preparedArtifactScope(operation) },
      sourceContentIdentity: await artifactSourceIdentity(artifact), room,
      committedResult: receipt?.result ?? null };
  },
});

async function activePayload(ctx: MutationCtx, accountId: Id<"accounts">, ref: string, hash: string) {
  const id = ctx.db.normalizeId("payloadObjects", ref);
  const payload = id ? await ctx.db.get(id) : null;
  if (!payload || payload.state !== "active" || payload.accountId !== accountId || payload.hash !== hash)
    throw new Error("AI_NATIVE_PAYLOAD_INVALID");
  return payload;
}

async function verifyNativeCandidate(ctx: MutationCtx, args: NativeAiCommitArgs) {
  const source = args.expected.nativeSource;
  const replica = await ctx.db.get(source.replicaId);
  if (!replica || replica.accountId !== args.append.accountId || replica.workId !== args.append.artifactId ||
      replica.payloadRef !== source.payloadRef || replica.contentHash !== source.hash ||
      replica.revision !== source.revision || replica.nativeFormat !== source.nativeFormat)
    throw new Error("AI_NATIVE_SOURCE_STALE");
  const sourcePayload = await activePayload(ctx, args.append.accountId, source.payloadRef, source.hash);
  if (sourcePayload.bytes !== source.bytes) throw new Error("AI_NATIVE_SOURCE_STALE");
  const candidate = args.nativeCandidate;
  const destination = candidate.destination;
  const materialization = destination === "bridge" ? candidate.queue : destination === "cloud" ? candidate.cloud : undefined;
  const resultRef = materialization?.payloadRef ?? (candidate.destination === "none" ? candidate.unchanged.resultPayloadRef : "");
  const resultHash = materialization?.contentHash ?? (candidate.destination === "none" ? candidate.unchanged.resultHash : "");
  const nativeReceipt = materialization?.nativeReceipt ?? (candidate.destination === "none" ? candidate.unchanged.preservationEvidence : undefined);
  if (!nativeReceipt || (materialization && (materialization.workId !== args.append.artifactId ||
      materialization.baseRevision !== source.revision))) throw new Error("AI_NATIVE_CANDIDATE_INVALID");
  if (destination === "bridge") {
    // The materializer normally reads verified CLOUD bytes and queues them
    // for a local target. Source provenance and destination identity differ.
    const target = candidate.queue.localReplicaId ? await ctx.db.get(candidate.queue.localReplicaId) : null;
    if (!target || target.kind !== "local" || target.accountId !== args.append.accountId ||
        target.workId !== args.append.artifactId || target.revision !== candidate.queue.baseRevision || target.contentHash !== source.hash)
      throw new Error("AI_NATIVE_DESTINATION_INVALID");
  }
  const receipt = validateNativeSaveReceipt(nativeReceipt, { artifactId: String(args.append.artifactId),
    baseRevision: source.revision, basePayloadHash: source.hash, targetRevision: resultHash,
    resultPayloadHash: resultHash, nativeFormat: source.nativeFormat, target: nativeReceipt.targets });
  if (receipt.semantic.resultDigest !== receipt.semantic.readbackDigest || receipt.errorCode ||
      ["conflicted", "failed"].includes(receipt.state)) throw new Error("AI_NATIVE_READBACK_INVALID");
  if (materialization && materialization.projectionContentHash !== receipt.semantic.readbackDigest)
    throw new Error("AI_NATIVE_READBACK_INVALID");
  if (candidate.destination === "none" && (receipt.state !== "unchanged" || resultRef !== source.payloadRef ||
      resultHash !== source.hash || candidate.unchanged.sourcePayloadRef !== source.payloadRef ||
      candidate.unchanged.sourceHash !== source.hash || candidate.unchanged.readbackProjectionHash !== receipt.semantic.readbackDigest))
    throw new Error("AI_NATIVE_UNCHANGED_UNVERIFIED");
  await activePayload(ctx, args.append.accountId, resultRef, resultHash);
  return { source, resultRef, resultHash, receipt };
}

async function admittedResponse(ctx: MutationCtx, stored: AdmittedAiCommit, duplicate: boolean): Promise<AdmittedAiCommit> {
  const roomId = ctx.db.normalizeId("collaborationRooms", stored.receipt.roomId);
  if (!roomId) throw new Error("AI_NATIVE_RECEIPT_INVALID");
  const row = await ctx.db.query("collaborationUpdates")
    .withIndex("by_room_sequence", q => q.eq("roomId", roomId).eq("sequence", stored.receipt.sequence)).unique();
  let admitted: AdmittedAiCommit["admitted"] = { encoding: "replay", roomId, throughSequence: stored.receipt.sequence };
  if (row?.payloadRef) {
    const id = ctx.db.normalizeId("collaborationDurablePayloads", row.payloadRef);
    const payload = id ? await ctx.db.get(id) : null;
    if (payload?.status === "active") admitted = { encoding: "payload", payloadRef: row.payloadRef,
      digest: row.payloadDigest!, byteLength: row.byteLength };
  } else if (row) {
    // At most the existing 760KiB inline bound. No large body is copied into
    // the operation receipt; a compacted retry loads the covering room state.
    const bytes = new Uint8Array(row.update);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 16_384)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
    admitted = { encoding: "inline", updateBase64: btoa(binary) };
  }
  return { ...stored, duplicate, admitted };
}

export const commit = internalMutation({
  args: nativeAiCommitArgs,
  handler: async (ctx, args): Promise<AdmittedAiCommit> => {
    const identity = { actorAccountId: args.append.accountId, artifactId: args.append.artifactId,
      aiOperation: args.aiOperation, evidence: args.evidence };
    const replay = await lookupVerifiedAiArtifactWriteReplay(ctx, identity);
    if (replay) {
      const stored = replay.result as AdmittedAiCommit;
      if (stored?.state !== "committed" || !stored.receipt?.roomId || !stored.admitted)
        throw new Error("AI_NATIVE_RECEIPT_INVALID");
      return admittedResponse(ctx, stored, true);
    }
    if (await nativeAiRequestDigest(args) !== args.requestDigest) throw new Error("AI_NATIVE_REQUEST_DIGEST_MISMATCH");
    const { append, expected } = args;
    const actor = await getActorForAccountId(ctx, append.accountId);
    const artifact = await ctx.db.get(append.artifactId);
    const room = await ctx.db.get(expected.roomId);
    if (!actor || !artifact || !room || room.artifactId !== artifact._id || room.partitionKey !== "root" ||
        room._id !== append.expectedRoomId || expected.nextSequence !== append.expectedNextSequence ||
        room.nextSequence !== expected.nextSequence || room.policyVersion !== append.policyVersion ||
        !["active", "compacting"].includes(room.status) || artifact.updatedAt !== expected.artifactUpdatedAt ||
        (artifact.contentHash ?? null) !== expected.contentHash || (artifact.currentVersionId ?? null) !== expected.currentVersionId)
      throw new Error("AI_NATIVE_CANONICAL_STALE");
    const native = await verifyNativeCandidate(ctx, args);
    const beforeProjection = await parseGatewayProjection(ctx, args.beforeProjectionJson, args.beforeProjectionHash,
      artifact, { accountId: actor.accountId, policyVersion: append.policyVersion });
    const afterProjection = await parseGatewayProjection(ctx, append.projectionJson, append.projectionHash,
      artifact, { accountId: actor.accountId, policyVersion: append.policyVersion });
    if (!beforeProjection || !afterProjection) throw new Error("AI_NATIVE_PROJECTION_REQUIRED");
    if (({ docx: "document", xlsx: "sheets", pptx: "presentation" } as const)[native.receipt.format] !== artifact.blueprintKey ||
        beforeProjection.schemaVersion !== artifact.schemaVersion || afterProjection.schemaVersion !== artifact.schemaVersion)
      throw new Error("AI_NATIVE_TYPE_MISMATCH");
    const admission = await assertVerifiedAiArtifactWriteAdmission(ctx, identity);
    const before = { title: beforeProjection.title, summary: beforeProjection.summary,
      content: beforeProjection.content, tags: beforeProjection.tags };
    await ctx.db.patch(artifact._id, { ...before, contentHash: args.beforeProjectionHash, liveStateVectorHash: append.baseStateVectorHash });
    await ctx.db.patch(room._id, { lastProjectionSequence: room.nextSequence - 1 });
    await commitHumanCheckpoint(ctx, artifact._id, "Your work before Spectra edited", { kind: "pre_ai_checkpoint" });
    const appended = await appendRoomUpdate(ctx, append, { deferAiHistory: true });
    if (appended.duplicate) throw new Error("AI_NATIVE_BUSINESS_RECEIPT_MISSING");
    const updated = (await ctx.db.get(artifact._id))!;
    const after = { title: updated.title, summary: updated.summary, content: updated.content, tags: updated.tags };
    const baseSnapshot = { ...before, nativeSources: [{ sourcePayloadHash: native.source.hash }] };
    const finalSnapshot = { ...after, nativeSources: [{ sourcePayloadHash: native.resultHash }] };
    if (new TextEncoder().encode(JSON.stringify({ baseSnapshot, finalSnapshot })).byteLength > 850_000)
      throw new Error("AI_NATIVE_SNAPSHOT_REQUIRED");
    let groupId = "changeGroupId" in appended ? appended.changeGroupId : undefined;
    if (groupId) {
      const group = await ctx.db.get(groupId);
      if (!group || group.status !== "open" || group.source !== "ai" || group.runId !== args.aiOperation.runId ||
          group.actorAccountId !== actor.accountId || group.operationIds.length !== 1 || group.operationIds[0] !== args.aiOperation.operationId)
        throw new Error("AI_NATIVE_HISTORY_SCOPE_INVALID");
      await ctx.db.patch(groupId, { baseSnapshot, finalSnapshot });
    } else {
      groupId = await ctx.db.insert("changeGroups", { artifactId: artifact._id, schoolId: artifact.schoolId,
        source: "ai", actorAccountId: actor.accountId, clientId: append.clientId, runId: args.aiOperation.runId,
        operationIds: [args.aiOperation.operationId], regionIds: append.regionIds, baseStateVectorHash: append.baseStateVectorHash,
        finalStateVectorHash: append.stateVectorHash, finalIntegrityHash: append.projectionHash,
        baseVersionId: updated.currentVersionId, baseSnapshot, finalSnapshot, status: "open", openedAt: Date.now(), lastActivityAt: Date.now() });
    }
    const history = await commitChangeGroup(ctx, groupId, { source: "ai", provenance: { kind: "ai_native_commit",
      operationId: args.aiOperation.operationId, requestDigest: args.requestDigest } });
    const versionId = history.status === "committed" ? history.versionId : undefined;
    if (versionId) {
      // The trusted materializer produced this exact verified result from the
      // current bound source. Attest ownership before the replica can advance.
      // Subsequent version reconciliation preserves this attested hash/ref.
      for (const payloadRef of new Set([native.source.payloadRef, native.resultRef])) {
        const prior = await ctx.db.query("collaborationPayloadOwners").withIndex("by_owner", q => q.eq("ownerId", String(versionId)))
          .filter(q => q.eq(q.field("payloadRef"), payloadRef)).first();
        if (prior) await ctx.db.patch(prior._id, { ownerTable: NATIVE_VERSION_OWNER_TABLE });
        else await ctx.db.insert("collaborationPayloadOwners", { ownerId: String(versionId), ownerTable: NATIVE_VERSION_OWNER_TABLE, payloadRef });
      }
    }
    const effects = { actorKind: "ai" as const, canonicalProjection: "durable" as const, runId: args.aiOperation.runId };
    const candidate = args.nativeCandidate;
    const nativeResult = candidate.destination === "bridge" ? await queueMaterializationInTransaction(ctx, actor, candidate.queue, effects)
      : candidate.destination === "cloud" ? await commitCloudMaterializationInTransaction(ctx, actor, candidate.cloud, effects)
      : { state: "unchanged" as const, payloadRef: native.resultRef, hash: native.resultHash, nativeReceipt: native.receipt };
    if (["failed", "conflicted", "protected-pending"].includes(nativeResult.state)) throw new Error("AI_NATIVE_EFFECT_REFUSED");
    const updateIdentity = await nativeAiUpdateIdentity(append);
    const result: AdmittedAiCommit = { state: "committed", duplicate: false,
      receipt: { roomId: room._id, sequence: appended.sequence, updateDigest: updateIdentity.updateDigest, versionId, nativeResult },
      admitted: { encoding: "replay", roomId: room._id, throughSequence: appended.sequence } };
    await ctx.db.patch(admission.operation._id, { output: { ...artifactOutput(admission.operation.output),
      artifactWriteReceipt: { scope: admission.operationDigest, requestDigest: args.requestDigest, result,
        sourceContentIdentity: await artifactSourceIdentity((await ctx.db.get(artifact._id))!), resultContentDigest: admission.resultContentDigest } } });
    return admittedResponse(ctx, result, false);
  },
});
