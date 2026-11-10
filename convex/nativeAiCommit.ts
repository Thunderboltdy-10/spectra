import { v } from "convex/values";
import { type MutationCtx, type QueryCtx } from "./_generated/server";
import { query } from "./functions";
import { internalMutation } from "./orgNodeMutation";
import type { Doc, Id } from "./_generated/dataModel";
import { getActorForAccountId, getAuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { appendRoomUpdate, parseGatewayProjection } from "./collaborationGatewayStore";
import { commitChangeGroup, commitHumanCheckpoint } from "./changeGroups";
import { NATIVE_VERSION_OWNER_TABLE } from "./durablePayloadOwnership";
import { nativeAiCommitArgs, type NativeAiCandidate, type NativeAiCommitArgs } from "./nativeAiCommitContract";
import { queueMaterializationInTransaction, commitCloudMaterializationInTransaction } from "./replicaMaterialization";
import { artifactOperationDigest, artifactOperationTarget, artifactOutput, artifactSourceIdentity, artifactWriteReceipt,
  assertVerifiedAiArtifactWriteAdmission, lookupVerifiedAiArtifactWriteReplay, preparedArtifactScope } from "./spectraArtifactWriteScope";
import { nativeAiRequestDigest, nativeAiUpdateIdentity } from "../shared/native-ai-commit";
import { validateNativeSaveReceipt } from "../shared/native-office-contract";
import { fitsConvexNesting } from "../shared/convex-nesting.mjs";
import { unpackOperationInput } from "../shared/operation-content";
import type { AdmittedAiCommit } from "../src/features/spectra/ai/admitted-ai-update";

/** Authenticated physical head for cold Node preparation. Reading this head
 * never initializes a room or grants permission for a subsequent effect. */
export const head = query({
  args: { artifactId: v.id("spectraArtifacts"), aiOperation: nativeAiCommitArgs.aiOperation },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const access = await requireActorArtifactCapability(ctx, actor, args.artifactId, "modify");
    const artifact = access.loaded!.resource as Doc<"spectraArtifacts">;
    const [run, operation] = await Promise.all([ctx.db.get(args.aiOperation.runId), ctx.db.get(args.aiOperation.operationId)]);
    if (!run || !operation || run.ownerAccountId !== actor.accountId || run.schoolId !== actor.schoolId ||
        operation.actorType !== "ai" || operation.runId !== run._id || !["artifact.create", "artifact.update"].includes(operation.type) ||
        operation.executionId !== args.aiOperation.executionId ||
        run.executionId !== args.aiOperation.executionId) throw new Error("AI_ARTIFACT_OPERATION_NOT_OWNED");
    if (await artifactOperationTarget(ctx, operation) !== artifact._id)
      throw new Error("AI_ARTIFACT_OPERATION_SCOPE_MISMATCH");
    const operationDigest = await artifactOperationDigest(operation);
    const receipt = artifactWriteReceipt(operation.output);
    if (receipt && receipt.scope !== operationDigest) throw new Error("AI_ARTIFACT_RECEIPT_SCOPE_MISMATCH");
    const room = receipt ? null : await ctx.db.query("collaborationRooms")
      .withIndex("by_artifact_partition", q => q.eq("artifactId", artifact._id).eq("partitionKey", "root")).unique();
    return { accountId: actor.accountId, artifact, operationDigest, prompt: run.userPrompt,
      operation: { id: operation._id, type: operation.type, input: unpackOperationInput(operation.input), writeScope: preparedArtifactScope(operation) },
      sourceContentIdentity: await artifactSourceIdentity(artifact), room,
      committedResult: receipt?.result ?? null };
  },
});

type NativeAdmissionInput = {
  accountId: Id<"accounts">; artifactId: Id<"spectraArtifacts">;
  nativeSource: NonNullable<NativeAiCommitArgs["expected"]["nativeSource"]>; nativeCandidate: NativeAiCandidate;
};
type MaterializationActor = Parameters<typeof queueMaterializationInTransaction>[1];
type MaterializationEffects = Parameters<typeof queueMaterializationInTransaction>[3];

async function activePayload(ctx: MutationCtx, accountId: Id<"accounts">, ref: string, hash: string, code: string) {
  const id = ctx.db.normalizeId("payloadObjects", ref);
  const payload = id ? await ctx.db.get(id) : null;
  if (!payload || payload.state !== "active" || payload.accountId !== accountId || payload.hash !== hash)
    throw new Error(`${code}_PAYLOAD_INVALID`);
  return payload;
}

/** The one verifier for a trusted, readback-proven native candidate. AI writes
 * and human history restores admit native effects only through this check;
 * `code` selects the caller's error namespace, never a weaker rule. */
export async function verifyNativeAdmissionCandidate(ctx: MutationCtx, input: NativeAdmissionInput, code = "AI_NATIVE") {
  const source = input.nativeSource;
  const replica = await ctx.db.get(source.replicaId);
  if (!replica || replica.accountId !== input.accountId || replica.workId !== input.artifactId ||
      replica.payloadRef !== source.payloadRef || replica.contentHash !== source.hash ||
      replica.revision !== source.revision || replica.nativeFormat !== source.nativeFormat)
    throw new Error(`${code}_SOURCE_STALE`);
  const sourcePayload = await activePayload(ctx, input.accountId, source.payloadRef, source.hash, code);
  if (sourcePayload.bytes !== source.bytes) throw new Error(`${code}_SOURCE_STALE`);
  const candidate = input.nativeCandidate;
  const destination = candidate.destination;
  const materialization = destination === "bridge" ? candidate.queue : destination === "cloud" ? candidate.cloud : undefined;
  const resultRef = materialization?.payloadRef ?? (candidate.destination === "none" ? candidate.unchanged.resultPayloadRef : "");
  const resultHash = materialization?.contentHash ?? (candidate.destination === "none" ? candidate.unchanged.resultHash : "");
  const nativeReceipt = materialization?.nativeReceipt ?? (candidate.destination === "none" ? candidate.unchanged.preservationEvidence : undefined);
  if (!nativeReceipt || (materialization && (materialization.workId !== input.artifactId ||
      materialization.baseRevision !== source.revision))) throw new Error(`${code}_CANDIDATE_INVALID`);
  if (destination === "bridge") {
    // The materializer normally reads verified CLOUD bytes and queues them
    // for a local target. Source provenance and destination identity differ.
    const target = candidate.queue.localReplicaId ? await ctx.db.get(candidate.queue.localReplicaId) : null;
    if (!target || target.kind !== "local" || target.accountId !== input.accountId ||
        target.workId !== input.artifactId || target.revision !== candidate.queue.baseRevision || target.contentHash !== source.hash)
      throw new Error(`${code}_DESTINATION_INVALID`);
  }
  const receipt = validateNativeSaveReceipt(nativeReceipt, { artifactId: String(input.artifactId),
    baseRevision: source.revision, basePayloadHash: source.hash, targetRevision: resultHash,
    resultPayloadHash: resultHash, nativeFormat: source.nativeFormat, target: nativeReceipt.targets });
  if (receipt.semantic.resultDigest !== receipt.semantic.readbackDigest || receipt.errorCode ||
      ["conflicted", "failed"].includes(receipt.state)) throw new Error(`${code}_READBACK_INVALID`);
  if (materialization && materialization.projectionContentHash !== receipt.semantic.readbackDigest)
    throw new Error(`${code}_READBACK_INVALID`);
  if (candidate.destination === "none" && (receipt.state !== "unchanged" || resultRef !== source.payloadRef ||
      resultHash !== source.hash || candidate.unchanged.sourcePayloadRef !== source.payloadRef ||
      candidate.unchanged.sourceHash !== source.hash || candidate.unchanged.readbackProjectionHash !== receipt.semantic.readbackDigest))
    throw new Error(`${code}_UNCHANGED_UNVERIFIED`);
  const resultPayload = await activePayload(ctx, input.accountId, resultRef, resultHash, code);
  return { source, sourcePayload, resultRef, resultHash, resultPayload, receipt, materialization };
}
export type VerifiedNativeAdmission = Awaited<ReturnType<typeof verifyNativeAdmissionCandidate>>;

/** The trusted materializer produced these exact bytes from the current bound
 * source. Attest version ownership before any replica can advance past them;
 * later version reconciliation preserves this attested hash/ref. */
export async function attestNativeVersionOwnership(ctx: MutationCtx, versionId: Id<"spectraArtifactVersions">, payloadRefs: string[]) {
  for (const payloadRef of new Set(payloadRefs)) {
    const prior = await ctx.db.query("collaborationPayloadOwners").withIndex("by_owner", q => q.eq("ownerId", String(versionId)))
      .filter(q => q.eq(q.field("payloadRef"), payloadRef)).first();
    if (prior) await ctx.db.patch(prior._id, { ownerTable: NATIVE_VERSION_OWNER_TABLE });
    else await ctx.db.insert("collaborationPayloadOwners", { ownerId: String(versionId), ownerTable: NATIVE_VERSION_OWNER_TABLE, payloadRef });
  }
}

/** Apply the verified candidate's single native effect in the caller's
 * admission transaction, after canonical history and ownership are written. */
export async function applyNativeAdmissionEffect(ctx: MutationCtx, actor: MaterializationActor, candidate: NativeAiCandidate,
  native: VerifiedNativeAdmission, effects: MaterializationEffects, code = "AI_NATIVE") {
  const nativeResult = candidate.destination === "bridge" ? await queueMaterializationInTransaction(ctx, actor, candidate.queue, effects)
    : candidate.destination === "cloud" ? await commitCloudMaterializationInTransaction(ctx, actor, candidate.cloud, effects)
    : { state: "unchanged" as const, payloadRef: native.resultRef, hash: native.resultHash, nativeReceipt: native.receipt };
  if (["failed", "conflicted", "protected-pending"].includes(nativeResult.state)) throw new Error(`${code}_EFFECT_REFUSED`);
  return nativeResult;
}

/** Exact admitted delta for a receipt: inline bytes, the durable spilled body,
 * or a covering replay once compaction removed the row. Never a new plan. */
export async function admittedUpdateDescriptor(ctx: QueryCtx | MutationCtx, roomId: Id<"collaborationRooms">,
  sequence: number): Promise<AdmittedAiCommit["admitted"]> {
  const row = await ctx.db.query("collaborationUpdates")
    .withIndex("by_room_sequence", q => q.eq("roomId", roomId).eq("sequence", sequence)).unique();
  if (row?.payloadRef) {
    const id = ctx.db.normalizeId("collaborationDurablePayloads", row.payloadRef);
    const payload = id ? await ctx.db.get(id) : null;
    if (payload?.status === "active") return { encoding: "payload", payloadRef: row.payloadRef,
      digest: row.payloadDigest!, byteLength: row.byteLength };
  } else if (row) {
    // At most the existing 760KiB inline bound. No large body is copied into
    // the operation receipt; a compacted retry loads the covering room state.
    const bytes = new Uint8Array(row.update);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 16_384)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
    return { encoding: "inline", updateBase64: btoa(binary) };
  }
  return { encoding: "replay", roomId, throughSequence: sequence };
}

async function admittedResponse(ctx: MutationCtx, stored: AdmittedAiCommit, duplicate: boolean): Promise<AdmittedAiCommit> {
  const roomId = ctx.db.normalizeId("collaborationRooms", stored.receipt.roomId);
  if (!roomId) throw new Error("AI_NATIVE_RECEIPT_INVALID");
  return { ...stored, duplicate, admitted: await admittedUpdateDescriptor(ctx, roomId, stored.receipt.sequence) };
}

/** The one AI admission for live artifacts. With a verified native candidate it
 * also advances the native outbox/cloud replica; without one (no native file
 * binding) it admits the same exact Yjs delta, history and operation receipt,
 * so a retry after an acknowledged save replays instead of writing again. */
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
    const { append, expected, nativeCandidate } = args;
    const nativeSource = expected.nativeSource;
    if (Boolean(nativeSource) !== Boolean(nativeCandidate)) throw new Error("AI_NATIVE_ENVELOPE_INVALID");
    const actor = await getActorForAccountId(ctx, append.accountId);
    const artifact = await ctx.db.get(append.artifactId);
    const room = await ctx.db.get(expected.roomId);
    if (!actor || !artifact || !room || room.artifactId !== artifact._id || room.partitionKey !== "root" ||
        room._id !== append.expectedRoomId || expected.nextSequence !== append.expectedNextSequence ||
        room.nextSequence !== expected.nextSequence || room.policyVersion !== append.policyVersion ||
        !["active", "compacting"].includes(room.status) || artifact.updatedAt !== expected.artifactUpdatedAt ||
        (artifact.contentHash ?? null) !== expected.contentHash || (artifact.currentVersionId ?? null) !== expected.currentVersionId)
      throw new Error("AI_NATIVE_CANONICAL_STALE");
    const native = nativeSource && nativeCandidate ? await verifyNativeAdmissionCandidate(ctx, { accountId: append.accountId,
      artifactId: append.artifactId, nativeSource, nativeCandidate }) : null;
    const beforeProjection = await parseGatewayProjection(ctx, args.beforeProjectionJson, args.beforeProjectionHash,
      artifact, { accountId: actor.accountId, policyVersion: append.policyVersion });
    const afterProjection = await parseGatewayProjection(ctx, append.projectionJson, append.projectionHash,
      artifact, { accountId: actor.accountId, policyVersion: append.policyVersion });
    if (!beforeProjection || !afterProjection) throw new Error("AI_NATIVE_PROJECTION_REQUIRED");
    if ((native && ({ docx: "document", xlsx: "sheets", pptx: "presentation" } as const)[native.receipt.format] !== artifact.blueprintKey) ||
        beforeProjection.schemaVersion !== artifact.schemaVersion || afterProjection.schemaVersion !== artifact.schemaVersion)
      throw new Error("AI_NATIVE_TYPE_MISMATCH");
    const admission = await assertVerifiedAiArtifactWriteAdmission(ctx, identity);
    if (nativeCandidate?.destination === "bridge" && (!admission.operation.requiresConfirmation ||
        !admission.scope.approvalCategories?.includes("bridge_files")))
      throw new Error("AI_ARTIFACT_APPROVAL_SCOPE_REQUIRED");
    const before = { title: beforeProjection.title, summary: beforeProjection.summary,
      content: beforeProjection.content, tags: beforeProjection.tags };
    // Usually the row already says this, and rewriting it would run every trigger for nothing.
    if ((artifact.contentHash ?? null) !== args.beforeProjectionHash || artifact.liveStateVectorHash !== append.baseStateVectorHash)
      await ctx.db.patch(artifact._id, { ...before, contentHash: args.beforeProjectionHash, liveStateVectorHash: append.baseStateVectorHash });
    if (room.lastProjectionSequence !== room.nextSequence - 1)
      await ctx.db.patch(room._id, { lastProjectionSequence: room.nextSequence - 1 });
    await commitHumanCheckpoint(ctx, artifact._id, "Your work before Spectra edited", { kind: "pre_ai_checkpoint" });
    // Without native sources the appender's ordinary AI history boundary is
    // the whole history effect; it already fits oversized snapshots off-row.
    const appended = await appendRoomUpdate(ctx, append, { deferAiHistory: Boolean(native) });
    if (appended.duplicate) throw new Error("AI_NATIVE_BUSINESS_RECEIPT_MISSING");
    const nativeResult = native && nativeCandidate
      ? await admitNativeHistoryAndEffect(ctx, args, { actor, artifact, before, appended, native, nativeCandidate })
      : { versionId: await liveAiHistoryVersion(ctx, args, actor.accountId, appended), nativeResult: null };
    const updateIdentity = await nativeAiUpdateIdentity(append);
    const result: AdmittedAiCommit = { state: "committed", duplicate: false,
      receipt: { roomId: room._id, sequence: appended.sequence, updateDigest: updateIdentity.updateDigest,
        versionId: nativeResult.versionId, nativeResult: nativeResult.nativeResult },
      admitted: { encoding: "replay", roomId: room._id, throughSequence: appended.sequence } };
    await ctx.db.patch(admission.operation._id, { output: { ...artifactOutput(admission.operation.output),
      artifactWriteReceipt: { scope: admission.operationDigest, requestDigest: args.requestDigest, result,
        sourceContentIdentity: await artifactSourceIdentity((await ctx.db.get(artifact._id))!), resultContentDigest: admission.resultContentDigest } } });
    return admittedResponse(ctx, result, false);
  },
});

type AppendedAiUpdate = Awaited<ReturnType<typeof appendRoomUpdate>>;

/** The appender committed this attempt's AI group; bind it to the operation. */
async function liveAiHistoryVersion(ctx: MutationCtx, args: NativeAiCommitArgs, accountId: Id<"accounts">, appended: AppendedAiUpdate) {
  const group = "changeGroupId" in appended && appended.changeGroupId ? await ctx.db.get(appended.changeGroupId) : null;
  if (!group || group.source !== "ai" || group.runId !== args.aiOperation.runId || group.actorAccountId !== accountId ||
      group.operationIds.length !== 1 || group.operationIds[0] !== args.aiOperation.operationId)
    throw new Error("AI_NATIVE_HISTORY_SCOPE_INVALID");
  return group.versionId;
}

async function admitNativeHistoryAndEffect(ctx: MutationCtx, args: NativeAiCommitArgs, input: {
  actor: NonNullable<Awaited<ReturnType<typeof getActorForAccountId>>>; artifact: Doc<"spectraArtifacts">;
  before: { title: string; summary?: string; content: unknown; tags: string[] }; appended: AppendedAiUpdate;
  native: VerifiedNativeAdmission; nativeCandidate: NativeAiCandidate;
}) {
  const { actor, artifact, before, appended, native } = input;
  const append = args.append;
  const updated = (await ctx.db.get(artifact._id))!;
  const after = { title: updated.title, summary: updated.summary, content: updated.content, tags: updated.tags };
  const baseSnapshot = { ...before, nativeSources: [{ sourcePayloadHash: native.source.hash }] };
  const finalSnapshot = { ...after, nativeSources: [{ sourcePayloadHash: native.resultHash }] };
  if (new TextEncoder().encode(JSON.stringify({ baseSnapshot, finalSnapshot })).byteLength > 850_000 ||
      !fitsConvexNesting({ baseSnapshot, finalSnapshot }))
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
  if (versionId) await attestNativeVersionOwnership(ctx, versionId, [native.source.payloadRef, native.resultRef]);
  const effects = { actorKind: "ai" as const, canonicalProjection: "durable" as const, runId: args.aiOperation.runId };
  return { versionId, nativeResult: await applyNativeAdmissionEffect(ctx, actor, input.nativeCandidate, native, effects) };
}
