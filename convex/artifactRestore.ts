import { v, type Infer, type ObjectType } from "convex/values";
import { query } from "./functions";
import { internalMutation } from "./orgNodeMutation";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getActorForAccountId, getAuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { loadVersionAfter, snapshotHash } from "./artifactSnapshots";
import { nativeReferencesForPinnedVersion } from "./retainedContentAccess";
import { appendRoomUpdate, appendRoomUpdateArgs, parseGatewayProjection } from "./collaborationGatewayStore";
import { commitChangeGroup, commitHumanCheckpoint } from "./changeGroups";
import { nativeAiCandidateValidator, nativeAiSourceValidator } from "./nativeAiCommitContract";
import { admittedUpdateDescriptor, applyNativeAdmissionEffect, attestNativeVersionOwnership, verifyNativeAdmissionCandidate,
  type VerifiedNativeAdmission } from "./nativeAiCommit";
import { nativeAiUpdateIdentity } from "../shared/native-ai-commit";

type ReadCtx = QueryCtx | MutationCtx;
const requestValidator = v.object({
  artifactId: v.id("spectraArtifacts"), sourceVersionId: v.id("spectraArtifactVersions"),
  requestId: v.string(), clientId: v.string(), regionIds: v.optional(v.array(v.string())),
});
type RestoreRequest = Infer<typeof requestValidator>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function normalizeRequest(request: RestoreRequest) {
  if (!request.requestId.trim() || request.requestId.length > 180 || !request.clientId.trim() || request.clientId.length > 180)
    throw new Error("ARTIFACT_RESTORE_REQUEST_INVALID");
  const regionIds = [...new Set(request.regionIds ?? [])].sort();
  if (regionIds.length > 10_000 || regionIds.some(id => !id.trim() || id.length > 300))
    throw new Error("ARTIFACT_RESTORE_SELECTION_INVALID");
  return { ...request, regionIds: regionIds.length ? regionIds : undefined };
}

async function authorize(ctx: ReadCtx, request: RestoreRequest, accountId: Id<"accounts">) {
  const actor = await getActorForAccountId(ctx, accountId);
  if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
  await requireActorArtifactCapability(ctx, actor, request.artifactId, "restore");
  await requireActorArtifactCapability(ctx, actor, request.artifactId, "modify");
  const artifact = await ctx.db.get(request.artifactId);
  if (!artifact || !["active", "draft"].includes(artifact.status)) throw new Error("ARTIFACT_NOT_FOUND");
  // History is its author's: collaborators edit the work, its author keeps its past.
  if (artifact.ownerAccountId !== actor.accountId) throw new Error("ARTIFACT_HISTORY_OWNER_ONLY");
  return { actor, artifact };
}

async function priorRequest(ctx: ReadCtx, request: RestoreRequest, accountId: Id<"accounts">) {
  const fingerprint = (await snapshotHash(normalizeRequest(request))).hash;
  const group = await ctx.db.query("changeGroups").withIndex("by_artifact_restore_request", q =>
    q.eq("artifactId", request.artifactId).eq("actorAccountId", accountId).eq("restoreRequestId", request.requestId)).unique();
  if (group && (group.restoreRequestFingerprint !== fingerprint || !group.restoreReceipt || group.status !== "committed"))
    throw new Error("ARTIFACT_RESTORE_REQUEST_MISMATCH");
  return { fingerprint, group };
}

async function admittedResult(ctx: ReadCtx, group: Doc<"changeGroups">, duplicate: boolean) {
  const receipt = group.restoreReceipt!;
  if (receipt.outcome === "unchanged") return { state: "unchanged" as const, duplicate, receipt };
  return { state: "committed" as const, duplicate, receipt,
    admitted: await admittedUpdateDescriptor(ctx, receipt.roomId, receipt.sequence) };
}

/** An authored hash is not a retained native capability. Require both the
 * exact selected snapshot's primary source and its server-owned payload link. */
async function retainedNativeSource(ctx: ReadCtx, version: Doc<"spectraArtifactVersions">, snapshot: unknown) {
  const sources = record(snapshot).nativeSources;
  const hashes = [...new Set((Array.isArray(sources) ? sources : []).map(source => record(source).sourcePayloadHash)
    .filter((hash): hash is string => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)))];
  if (!hashes.length) return null;
  const primary = record(version.provenance).nativeAfter;
  const hash = hashes.length === 1 ? hashes[0]! : typeof primary === "string" && hashes.includes(primary) ? primary : null;
  if (!hash) throw new Error("ARTIFACT_RESTORE_NATIVE_SOURCE_AMBIGUOUS");
  const refs = await nativeReferencesForPinnedVersion(ctx, version.artifactId, version._id, snapshot);
  for (const ref of refs) {
    const id = ctx.db.normalizeId("payloadObjects", ref);
    const payload = id ? await ctx.db.get(id) : null;
    const url = payload?.state === "active" && payload.hash === hash ? await ctx.storage.getUrl(payload.storageId) : null;
    if (payload && url)
      return { sourceVersionId: version._id, sourcePayloadHash: hash, payloadRef: String(payload._id),
        bytes: payload.bytes, mediaType: payload.mediaType, url };
  }
  throw new Error("ARTIFACT_RESTORE_NATIVE_SOURCE_UNAVAILABLE");
}

async function restoreState(ctx: ReadCtx, request: RestoreRequest, artifact: Doc<"spectraArtifacts">) {
  const version = await ctx.db.get(request.sourceVersionId);
  if (!version || version.artifactId !== artifact._id) throw new Error("ARTIFACT_RESTORE_VERSION_INVALID");
  const source = await loadVersionAfter(ctx, version);
  const room = await ctx.db.query("collaborationRooms").withIndex("by_artifact_partition", q =>
    q.eq("artifactId", artifact._id).eq("partitionKey", "root")).unique();
  if (!room || !["active", "compacting"].includes(room.status) || room.typeKey !== artifact.blueprintKey)
    throw new Error("ARTIFACT_RESTORE_ROOM_UNAVAILABLE");
  const replicas = await ctx.db.query("workReplicas").withIndex("by_work", q => q.eq("workId", artifact._id)).take(51);
  if (replicas.length > 50) throw new Error("ARTIFACT_RESTORE_NATIVE_BASE_LIMIT");
  const nativeSource = await retainedNativeSource(ctx, version, source);
  const office = (format: string | undefined) => /^(docx|docm|dotx|dotm|xlsx|xlsm|xltx|xltm|xlam|pptx|pptm|potx|potm|ppsx|ppsm|ppam)$/.test(format ?? "");
  const nativeRequired = Boolean(nativeSource || office(artifact.nativeFormat) || replicas.some(replica => office(replica.nativeFormat)));
  const whole = !request.regionIds?.length || request.regionIds.includes("artifact:structure");
  if (nativeRequired && whole && !nativeSource) throw new Error("ARTIFACT_RESTORE_NATIVE_SOURCE_UNAVAILABLE");
  const sourceSnapshotHash = (await snapshotHash(source)).hash;
  const headHash = (await snapshotHash({
    artifact: { id: artifact._id, title: artifact.title, summary: artifact.summary, content: artifact.content, tags: artifact.tags,
      type: artifact.blueprintKey, schema: artifact.schemaVersion, currentVersionId: artifact.currentVersionId,
      vector: artifact.liveStateVectorHash, pendingPayloadRef: artifact.pendingPayloadRef },
    room: { id: room._id, type: room.typeKey, schema: room.schemaVersion, policy: room.policyVersion,
      sequence: room.nextSequence, projection: room.lastProjectionSequence, snapshot: room.snapshotSequence },
    source: { id: version._id, snapshot: source, nativeSource: nativeSource ? {
      payloadRef: nativeSource.payloadRef, hash: nativeSource.sourcePayloadHash,
      bytes: nativeSource.bytes, mediaType: nativeSource.mediaType,
    } : null },
    native: replicas.map(replica => ({ id: replica._id, kind: replica.kind, payloadRef: replica.payloadRef,
      revision: replica.revision, hash: replica.contentHash, state: replica.state, pendingPayloadRef: replica.pendingPayloadRef,
      projectionBaseRevision: replica.projectionBaseRevision })),
  })).hash;
  return { source, sourceSnapshotHash, room, replicas, nativeRequired, nativeSource, whole, headHash };
}

export const head = query({
  args: { request: requestValidator },
  handler: async (ctx, { request: raw }) => {
    const authenticated = await getAuthenticatedActor(ctx);
    if (!authenticated) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const request = normalizeRequest(raw);
    const { actor, artifact } = await authorize(ctx, request, authenticated.accountId);
    const prior = await priorRequest(ctx, request, actor.accountId);
    if (prior.group) return { committed: await admittedResult(ctx, prior.group, true) };
    const state = await restoreState(ctx, request, artifact);
    return { committed: null, accountId: actor.accountId, artifact, ...state };
  },
});

export const commitArgs = {
  request: requestValidator, expectedHeadHash: v.string(), append: v.object(appendRoomUpdateArgs),
  beforeProjectionJson: v.string(), beforeProjectionHash: v.string(),
  nativeSource: v.optional(nativeAiSourceValidator), nativeCandidate: v.optional(nativeAiCandidateValidator),
};
export type RestoreCommitArgs = ObjectType<typeof commitArgs>;

/** Trusted Node preparation is the only caller. Every visible effect and
 * receipt below commits together; CAS loss cannot leave an optimistic restore.
 * Native verification, ownership attestation and the native effect are the
 * same helpers the atomic native AI admission uses (convex/nativeAiCommit). */
export const commit = internalMutation({
  args: commitArgs,
  handler: async (ctx, args) => {
    const request = normalizeRequest(args.request);
    const { actor, artifact } = await authorize(ctx, request, args.append.accountId);
    const prior = await priorRequest(ctx, request, actor.accountId);
    // The same request identity returns its original receipt, never a second
    // restore over whatever changed since, exactly like the head query.
    if (prior.group) return admittedResult(ctx, prior.group, true);
    const state = await restoreState(ctx, request, artifact);
    const append = args.append;
    if (state.headHash !== args.expectedHeadHash || append.artifactId !== artifact._id || append.actorKind !== "human" ||
      append.partitionKey !== "root" || append.clientId !== request.clientId ||
      append.idempotencyKey !== `restore:${request.requestId}` || append.expectedRoomId !== state.room._id ||
      append.expectedNextSequence !== state.room.nextSequence || append.policyVersion !== state.room.policyVersion)
      throw new Error("ARTIFACT_RESTORE_STALE");
    const parse = (json: string | undefined, hash: string | undefined) => parseGatewayProjection(ctx, json, hash, artifact,
      { accountId: actor.accountId, policyVersion: append.policyVersion });
    const before = await parse(args.beforeProjectionJson, args.beforeProjectionHash);
    const after = await parse(append.projectionJson, append.projectionHash);
    if (!before || !after) throw new Error("ARTIFACT_RESTORE_PROJECTION_REQUIRED");
    let native: VerifiedNativeAdmission | undefined;
    if (state.nativeRequired) {
      if (!args.nativeSource || !args.nativeCandidate) throw new Error("ARTIFACT_RESTORE_NATIVE_BASE_STALE");
      native = await verifyNativeAdmissionCandidate(ctx, { accountId: actor.accountId, artifactId: artifact._id,
        nativeSource: args.nativeSource, nativeCandidate: args.nativeCandidate }, "ARTIFACT_RESTORE_NATIVE");
      const materialization = native.materialization;
      // Restore-specific: a whole restore yields exactly the retained historical
      // package; the projection admitted in Yjs is the native readback.
      if ((state.whole && state.nativeSource?.sourcePayloadHash !== native.resultHash) ||
        native.resultPayload.mediaType !== native.sourcePayload.mediaType)
        throw new Error("ARTIFACT_RESTORE_NATIVE_RESULT_INVALID");
      if ((materialization && (await snapshotHash(materialization.projectionContent)).hash !== (await snapshotHash(after.content)).hash) ||
        (args.nativeCandidate.destination === "bridge" && args.nativeCandidate.queue.baseContentHash !== native.receipt.semantic.baseDigest))
        throw new Error("ARTIFACT_RESTORE_NATIVE_PROJECTION_MISMATCH");
    } else if (args.nativeCandidate || args.nativeSource) throw new Error("ARTIFACT_RESTORE_NATIVE_UNEXPECTED");
    const snapshot = (value: typeof before, hash?: string) => ({ title: value.title, summary: value.summary,
      tags: value.tags, content: value.content, ...(hash ? { nativeSources: [{ sourcePayloadHash: hash }] } : {}) });
    const snapshots = { baseSnapshot: snapshot(before, native?.source.hash), finalSnapshot: snapshot(after, native?.resultHash) };
    const now = Date.now();
    const receiptIdentity = { restoreRequestId: request.requestId, restoreRequestFingerprint: prior.fingerprint,
      restoreHeadHash: args.expectedHeadHash };
    if ((await snapshotHash(snapshots.baseSnapshot)).hash === (await snapshotHash(snapshots.finalSnapshot)).hash) {
      // A stable no-op receipt prevents a lost response from turning a later
      // retry into a restore over new edits. It creates no phantom version.
      const groupId = await ctx.db.insert("changeGroups", { source: "restore", artifactId: artifact._id,
        schoolId: artifact.schoolId, actorAccountId: actor.accountId, clientId: request.clientId, operationIds: [], regionIds: [],
        baseStateVectorHash: append.baseStateVectorHash, status: "committed", openedAt: now, lastActivityAt: now, committedAt: now,
        ...receiptIdentity, restoreReceipt: { outcome: "unchanged", versionId: artifact.currentVersionId, roomId: state.room._id,
          sequence: state.room.nextSequence - 1, nativeResult: native ? { state: "unchanged" } : null, committedAt: now } });
      return admittedResult(ctx, (await ctx.db.get(groupId))!, false);
    }
    await ctx.db.patch(artifact._id, { ...snapshot(before), contentHash: args.beforeProjectionHash, liveStateVectorHash: append.baseStateVectorHash });
    await ctx.db.patch(state.room._id, { lastProjectionSequence: state.room.nextSequence - 1 });
    await commitHumanCheckpoint(ctx, artifact._id, "Your work before restore", { kind: "pre_restore_checkpoint" });
    const appended = await appendRoomUpdate(ctx, append);
    if (appended.duplicate || !("projected" in appended) || !appended.projected) throw new Error("ARTIFACT_RESTORE_RECEIPT_MISSING");
    let groupId = appended.changeGroupId;
    if (groupId) await ctx.db.patch(groupId, { ...snapshots, source: "restore" });
    else groupId = await ctx.db.insert("changeGroups", { ...snapshots, source: "restore", artifactId: artifact._id,
      schoolId: artifact.schoolId, actorAccountId: actor.accountId, clientId: request.clientId, operationIds: [],
      regionIds: append.regionIds, baseStateVectorHash: append.baseStateVectorHash, finalStateVectorHash: append.stateVectorHash,
      status: "open", openedAt: now, lastActivityAt: now });
    // The new version names its exact source: version id, source snapshot
    // digest, selected regions, and the retained native package it restored.
    const committed = await commitChangeGroup(ctx, groupId, { source: "restore", summary: "Restored a previous version",
      provenance: { kind: "history_restore", sourceVersionId: request.sourceVersionId, sourceSnapshotHash: state.sourceSnapshotHash,
        requestId: request.requestId, selectedRegionIds: request.regionIds,
        sourcePayloadHash: state.whole ? state.nativeSource?.sourcePayloadHash : undefined,
        nativeBefore: native?.source.hash, nativeAfter: native?.resultHash } });
    if (committed.status !== "committed") throw new Error("ARTIFACT_RESTORE_VERSION_REQUIRED");
    let nativeResult: unknown = null;
    if (native && args.nativeCandidate) {
      // The prepared result is not necessarily on a replica yet, and advancing
      // a cloud replica can remove its former base binding: attest first.
      await attestNativeVersionOwnership(ctx, committed.versionId, [native.source.payloadRef, native.resultRef]);
      nativeResult = await applyNativeAdmissionEffect(ctx, actor, args.nativeCandidate, native,
        { actorKind: "user", canonicalProjection: "durable" }, "ARTIFACT_RESTORE_NATIVE");
    }
    const { updateDigest } = await nativeAiUpdateIdentity(append);
    const receipt = { outcome: "restored" as const, versionId: committed.versionId, roomId: state.room._id, sequence: appended.sequence,
      updateDigest, nativeResult, committedAt: now };
    await ctx.db.patch(groupId, { ...receiptIdentity, restoreReceipt: receipt });
    return admittedResult(ctx, (await ctx.db.get(groupId))!, false);
  },
});
