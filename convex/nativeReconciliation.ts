import { v, type ObjectType } from "convex/values";
import { query } from "./functions";
import { internalMutation } from "./orgNodeMutation";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getActorForAccountId, getAuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { appendRoomUpdate, appendRoomUpdateArgs, parseGatewayProjection } from "./collaborationGatewayStore";
import { commitHumanCheckpoint, commitNativeReconciliationVersion } from "./changeGroups";

const nativeSchemas = { document: 2, sheets: 4, presentation: 1 } as const;
function nativeType(format: string | undefined) {
  if (/^(docx|docm|dotx|dotm)$/.test(format ?? "")) return "document";
  if (/^(xlsx|xlsm|xltx|xltm|xlam)$/.test(format ?? "")) return "sheets";
  if (/^(pptx|pptm|potx|potm|ppsx|ppsm|ppam)$/.test(format ?? "")) return "presentation";
  return null;
}

export const externalReconciliationArgs = {
  workId: v.id("spectraArtifacts"),
  localReplicaId: v.optional(v.id("workReplicas")),
  localPayloadRef: v.string(),
  localRevision: v.string(),
  content: v.any(),
  fidelityMap: v.any(),
  regionIds: v.array(v.string()),
  partNames: v.array(v.string()),
  conflictRegionIds: v.array(v.string()),
  previews: v.optional(v.array(v.object({ regionId: v.string(), spectra: v.string(), external: v.string() }))),
  resolution: v.optional(v.union(v.literal("local"), v.literal("merged"))),
};
type ExternalReconciliation = ObjectType<typeof externalReconciliationArgs>;
type ReadCtx = QueryCtx | MutationCtx;

async function authorizedArtifact(ctx: ReadCtx, workId: Id<"spectraArtifacts">, accountId: Id<"accounts">) {
  const actor = await getActorForAccountId(ctx, accountId);
  const artifact = await ctx.db.get(workId);
  if (!actor || !artifact || artifact.ownerAccountId !== accountId || artifact.schoolId !== actor.schoolId ||
      !["active", "draft"].includes(artifact.status)) throw new Error("WORK_NOT_FOUND");
  await requireActorArtifactCapability(ctx, actor, workId, "modify");
  return { actor, artifact };
}

async function exactOperation(ctx: ReadCtx, accountId: Id<"accounts">, args: {
  workId: Id<"spectraArtifacts">; localReplicaId: Id<"workReplicas">; localRevision: string;
  operationId?: Id<"syncOperations">;
}) {
  const operation = args.operationId ? await ctx.db.get(args.operationId) : await ctx.db.query("syncOperations")
    .withIndex("by_work_created", q => q.eq("workId", args.workId)).order("desc")
    .filter(q => q.and(q.eq(q.field("replicaId"), args.localReplicaId),
      q.eq(q.field("direction"), "external"), q.eq(q.field("revisionAfter"), args.localRevision))).first();
  // An AI-generated materialization must use its explicit AI admission path;
  // it cannot obtain native-user provenance through this external-import API.
  if (!operation || operation.accountId !== accountId || operation.workId !== args.workId ||
      operation.replicaId !== args.localReplicaId || operation.direction !== "external" ||
      operation.actorKind !== "external-edit" || operation.runId || operation.revisionAfter !== args.localRevision)
    throw new Error("EXTERNAL_OPERATION_NOT_FOUND");
  return operation;
}

function matchingReceipt(operation: Doc<"syncOperations">, args: {
  localReplicaId: Id<"workReplicas">; localPayloadRef: string; localRevision: string;
}) {
  const receipt = operation.reconciliationReceipt;
  if (!receipt) return null;
  if (operation.state !== "verified" || receipt.localReplicaId !== args.localReplicaId ||
      receipt.localPayloadRef !== args.localPayloadRef || receipt.localRevision !== args.localRevision)
    throw new Error("EXTERNAL_RECEIPT_MISMATCH");
  return receipt;
}

async function nativeReplicas(ctx: ReadCtx, accountId: Id<"accounts">, args: {
  workId: Id<"spectraArtifacts">; localReplicaId: Id<"workReplicas">; localPayloadRef: string; localRevision: string;
}) {
  const [local, cloud] = await Promise.all([
    ctx.db.get(args.localReplicaId),
    ctx.db.query("workReplicas").withIndex("by_work_kind", q => q.eq("workId", args.workId).eq("kind", "cloud")).unique(),
  ]);
  if (!local || !cloud || local.accountId !== accountId || cloud.accountId !== accountId ||
      local.workId !== args.workId || local.kind !== "local" || local.payloadRef !== args.localPayloadRef ||
      local.revision !== args.localRevision) throw new Error("EXTERNAL_REVISION_CHANGED");
  const payloadId = ctx.db.normalizeId("payloadObjects", args.localPayloadRef);
  const payload = payloadId ? await ctx.db.get(payloadId) : null;
  if (!payload || payload.state !== "active" || payload.accountId !== accountId ||
      payload.hash !== local.contentHash)
    throw new Error("EXTERNAL_PAYLOAD_UNVERIFIED");
  return { local, cloud, payload };
}

export const head = query({
  args: { workId: v.id("spectraArtifacts"), localReplicaId: v.id("workReplicas"),
    localPayloadRef: v.string(), localRevision: v.string() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const { artifact } = await authorizedArtifact(ctx, args.workId, actor.accountId);
    const operation = await exactOperation(ctx, actor.accountId, args);
    const receipt = matchingReceipt(operation, args);
    if (receipt) return { accountId: actor.accountId, artifact, operationId: operation._id, receipt };
    const replicas = await nativeReplicas(ctx, actor.accountId, args);
    if (!["pending", "applied", "conflicted"].includes(operation.state))
      throw new Error("EXTERNAL_RECEIPT_MISSING");
    const room = await ctx.db.query("collaborationRooms")
      .withIndex("by_artifact_partition", q => q.eq("artifactId", args.workId).eq("partitionKey", "root")).unique();
    if (!room) return { accountId: actor.accountId, artifact, operationId: operation._id, receipt: null, roomId: null };
    if (!["active", "compacting"].includes(room.status)) throw new Error("COLLABORATION_ROOM_NOT_FOUND");
    return { accountId: actor.accountId, artifact, operationId: operation._id, receipt,
      roomId: room._id, policyVersion: room.policyVersion, nextSequence: room.nextSequence, schemaVersion: room.schemaVersion,
      nativeBaseRevision: replicas.local.projectionBaseRevision ?? replicas.local.baseRevision ?? null,
      cloudRevision: replicas.cloud.revision ?? null, cloudPayloadRef: replicas.cloud.payloadRef ?? null,
      cloudPayloadHash: replicas.cloud.contentHash ?? null };
  },
});

/** Legacy callers may record a conflict or read a real completed receipt, but
 * cannot install a projection outside the canonical Yjs/history transaction. */
export async function recordExternalConflict(ctx: MutationCtx, args: ExternalReconciliation) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
  await authorizedArtifact(ctx, args.workId, actor.accountId);
  let localReplicaId = args.localReplicaId;
  if (!localReplicaId) {
    const local = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", q => q.eq("workId", args.workId).eq("kind", "local"))
      .filter(q => q.and(q.eq(q.field("payloadRef"), args.localPayloadRef), q.eq(q.field("revision"), args.localRevision))).first();
    if (!local) throw new Error("EXTERNAL_REVISION_CHANGED");
    localReplicaId = local._id;
  }
  const identity = { ...args, localReplicaId };
  const operation = await exactOperation(ctx, actor.accountId, identity);
  const receipt = matchingReceipt(operation, identity);
  if (receipt) return { state: "applied" as const, duplicate: true, receipt };
  if (!args.conflictRegionIds.length) throw new Error("EXTERNAL_DURABLE_COMMIT_REQUIRED");
  const { local, cloud } = await nativeReplicas(ctx, actor.accountId, identity);
  return recordConflict(ctx, actor.accountId, operation, local, cloud, args);
}

async function recordConflict(ctx: MutationCtx, accountId: Id<"accounts">, operation: Doc<"syncOperations">,
  local: Doc<"workReplicas">, cloud: Doc<"workReplicas">, args: ExternalReconciliation) {
  const now = Date.now();
  const existing = await ctx.db.query("syncConflicts")
    .withIndex("by_work_state", q => q.eq("workId", args.workId).eq("state", "open"))
    .filter(q => q.and(q.eq(q.field("localRevision"), local.revision), q.eq(q.field("spectraRevision"), cloud.revision))).first();
  const previews = new Map((existing?.previews ?? []).map(preview => [preview.regionId, preview]));
  for (const preview of args.previews ?? []) previews.set(preview.regionId, preview);
  const value = {
    regionIds: [...new Set([...(existing?.regionIds ?? []), ...args.conflictRegionIds])],
    partNames: [...new Set([...(existing?.partNames ?? []), ...args.partNames])],
    localPayloadRef: local.payloadRef, spectraPayloadRef: cloud.payloadRef,
    ...(previews.size ? { previews: [...previews.values()] } : {}), updatedAt: now,
  };
  if (existing) await ctx.db.patch(existing._id, value);
  else await ctx.db.insert("syncConflicts", { ...value, accountId, workId: args.workId,
    replicaIds: [local._id, cloud._id], localRevision: local.revision!, spectraRevision: cloud.revision!,
    state: "open", createdAt: now });
  await ctx.db.patch(operation._id, { state: "conflicted", updatedAt: now });
  await ctx.db.patch(local._id, { state: "diverged", updatedAt: now });
  await ctx.db.patch(cloud._id, { state: "diverged", updatedAt: now });
  return { state: "conflicted" as const, conflictRegionIds: args.conflictRegionIds, previews: args.previews ?? [] };
}

export const commit = internalMutation({
  args: {
    append: v.object(appendRoomUpdateArgs),
    external: v.object({ ...externalReconciliationArgs, localReplicaId: v.id("workReplicas") }),
    operationId: v.id("syncOperations"), expectedArtifactUpdatedAt: v.number(),
    expectedContentHash: v.union(v.string(), v.null()),
    expectedVersionId: v.union(v.id("spectraArtifactVersions"), v.null()),
    expectedNativeBaseRevision: v.union(v.string(), v.null()),
    expectedCloudRevision: v.union(v.string(), v.null()),
    expectedCloudPayloadRef: v.union(v.string(), v.null()),
    expectedCloudPayloadHash: v.union(v.string(), v.null()),
    activation: v.optional(v.object({ typeKey: v.union(v.literal("document"), v.literal("sheets"), v.literal("presentation")),
      schemaVersion: v.number() })),
    nativeBasePayloadHash: v.string(),
    beforeProjectionJson: v.string(), beforeProjectionHash: v.string(),
  },
  handler: async (ctx, args) => {
    const input = args.external;
    let append = args.append;
    const { artifact, actor } = await authorizedArtifact(ctx, input.workId, append.accountId);
    if (append.artifactId !== input.workId || append.partitionKey !== "root" || append.actorKind !== "human" ||
        append.clientId !== `native:${args.operationId}` || append.idempotencyKey !== `native:${args.operationId}`)
      throw new Error("EXTERNAL_OPERATION_SCOPE_INVALID");
    const operation = await exactOperation(ctx, actor.accountId, { ...input, operationId: args.operationId });
    const receipt = matchingReceipt(operation, input);
    if (receipt) return { state: "applied" as const, duplicate: true, receipt };
    if (!["pending", "applied", "conflicted"].includes(operation.state)) throw new Error("EXTERNAL_RECEIPT_MISSING");
    const { local, cloud, payload } = await nativeReplicas(ctx, actor.accountId, input);
    let room = await ctx.db.query("collaborationRooms")
      .withIndex("by_artifact_partition", q => q.eq("artifactId", input.workId).eq("partitionKey", "root")).unique();
    if (!room || room._id !== append.expectedRoomId || room.nextSequence !== append.expectedNextSequence ||
        !["active", "compacting"].includes(room.status) || room.policyVersion !== append.policyVersion ||
        artifact.updatedAt !== args.expectedArtifactUpdatedAt || (artifact.contentHash ?? null) !== args.expectedContentHash ||
        (artifact.currentVersionId ?? null) !== args.expectedVersionId ||
        (local.projectionBaseRevision ?? local.baseRevision ?? null) !== args.expectedNativeBaseRevision ||
        (cloud.revision ?? null) !== args.expectedCloudRevision ||
        (cloud.payloadRef ?? null) !== args.expectedCloudPayloadRef ||
        (cloud.contentHash ?? null) !== args.expectedCloudPayloadHash)
      throw new Error("NATIVE_RECONCILIATION_STALE");
    const targetType = args.activation?.typeKey ?? artifact.blueprintKey;
    if (nativeType(local.nativeFormat) !== targetType || nativeType(cloud.nativeFormat) !== targetType)
      throw new Error("NATIVE_RECONCILIATION_TYPE_MISMATCH");
    if (args.activation) {
      const [update, snapshot] = await Promise.all([
        ctx.db.query("collaborationUpdates").withIndex("by_room_sequence", q => q.eq("roomId", room!._id)).first(),
        ctx.db.query("collaborationSnapshots").withIndex("by_room_sequence", q => q.eq("roomId", room!._id)).first(),
      ]);
      if (artifact.blueprintKey !== "resource" || artifact.content != null || artifact.currentVersionId ||
          room.typeKey !== "resource" || room.schemaVersion !== 1 || room.nextSequence !== 1 ||
          room.snapshotSequence !== 0 || update || snapshot ||
          args.activation.schemaVersion !== nativeSchemas[args.activation.typeKey])
        throw new Error("NATIVE_RECONCILIATION_ACTIVATION_NOT_EMPTY");
    }
    if (input.conflictRegionIds.length) return recordConflict(ctx, actor.accountId, operation, local, cloud, input);
    const beforeProjection = await parseGatewayProjection(ctx, args.beforeProjectionJson, args.beforeProjectionHash,
      { ...artifact, blueprintKey: targetType }, { accountId: actor.accountId, policyVersion: append.policyVersion });
    if (!beforeProjection) throw new Error("NATIVE_RECONCILIATION_BASE_REQUIRED");
    const before = { title: beforeProjection.title, summary: beforeProjection.summary,
      content: beforeProjection.content, tags: beforeProjection.tags };
    const beforeNativeHashes = [];
    for (const ref of new Set([cloud.payloadRef, local.projectionBasePayloadRef].filter((ref): ref is string => Boolean(ref)))) {
      const id = ctx.db.normalizeId("payloadObjects", ref);
      const source = id ? await ctx.db.get(id) : null;
      if (!source || source.state !== "active" || source.accountId !== actor.accountId ||
          (ref === cloud.payloadRef && source.hash !== args.expectedCloudPayloadHash))
        throw new Error("EXTERNAL_BASE_PAYLOAD_UNAVAILABLE");
      beforeNativeHashes.push(source.hash);
    }
    if (!args.expectedNativeBaseRevision || args.nativeBasePayloadHash !== args.expectedNativeBaseRevision ||
        !beforeNativeHashes.includes(args.nativeBasePayloadHash)) throw new Error("EXTERNAL_NATIVE_BASE_CHANGED");
    if (args.activation) {
      // A resource room must be empty in this effect transaction. The first
      // admitted update initializes the typed document from an empty Y.Doc.
      const now = Date.now();
      await ctx.db.patch(room._id, { status: "closed", partitionKey: `__retired__:${room._id}`, updatedAt: now });
      const roomId = await ctx.db.insert("collaborationRooms", { artifactId: artifact._id, schoolId: room.schoolId,
        typeKey: args.activation.typeKey, provider: room.provider, partitionKey: "root",
        schemaVersion: args.activation.schemaVersion, policyVersion: room.policyVersion, status: "active",
        nextSequence: 1, snapshotSequence: 0, uncompactedBytes: 0, createdAt: now, updatedAt: now });
      room = (await ctx.db.get(roomId))!;
      append = { ...append, expectedRoomId: roomId };
      await ctx.db.patch(artifact._id, { blueprintKey: args.activation.typeKey, schemaVersion: args.activation.schemaVersion,
        resourceClass: "artifact" });
    }
    // Canonical projection may lag acknowledged human deltas. Materialize the
    // exact fenced before head and close its human history before appending the
    // native operation, all in this transaction (no observable partial phase).
    await ctx.db.patch(artifact._id, { ...before, contentHash: args.beforeProjectionHash, liveStateVectorHash: append.baseStateVectorHash });
    await ctx.db.patch(room._id, { lastProjectionSequence: room.nextSequence - 1 });
    await commitHumanCheckpoint(ctx, artifact._id, "Your work before the native file changed", { kind: "pre_native_checkpoint" });
    const appended = await appendRoomUpdate(ctx, append);
    if (appended.duplicate) throw new Error("EXTERNAL_RECEIPT_MISSING");
    const appendedRow = await ctx.db.query("collaborationUpdates")
      .withIndex("by_room_sequence", q => q.eq("roomId", room._id).eq("sequence", appended.sequence)).unique();
    if (!appendedRow) throw new Error("NATIVE_RECONCILIATION_LOG_REQUIRED");
    await ctx.db.patch(appendedRow._id, { nativeReconciliationOperationId: operation._id });
    const updated = await ctx.db.get(artifact._id);
    if (!updated || !("projected" in appended) || !appended.projected) throw new Error("NATIVE_RECONCILIATION_PROJECTION_REQUIRED");
    const versionId = await commitNativeReconciliationVersion(ctx, {
      artifactId: artifact._id, actorAccountId: actor.accountId, syncOperationId: operation._id,
      changeGroupId: "changeGroupId" in appended ? appended.changeGroupId : undefined, before, beforeNativeHashes, afterNativeHash: payload.hash,
      regionIds: appended.regionIds ?? input.regionIds, nativeFormat: local.nativeFormat ?? "office",
    });
    const now = Date.now();
    const projectionBase = { projectionBasePayloadRef: local.payloadRef,
      projectionBaseRevision: local.revision, projectionBaseContent: updated.content,
      projectionBaseContentHash: updated.contentHash, projectionBaseTextIndex: updated.textIndex,
      projectionBaseFidelityMap: input.fidelityMap, baseRevision: local.revision,
      state: "current" as const, lastVerifiedAt: now, updatedAt: now };
    await ctx.db.patch(cloud._id, { ...projectionBase, payloadRef: local.payloadRef,
      revision: local.revision, contentHash: local.contentHash, fidelityMap: input.fidelityMap });
    await ctx.db.patch(local._id, projectionBase);
    const committedReceipt = { versionId, roomId: room._id, sequence: appended.sequence,
      updateDigest: append.payloadDigest ?? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", append.update)), b => b.toString(16).padStart(2, "0")).join(""),
      projectionHash: updated.contentHash!, localReplicaId: local._id, localPayloadRef: input.localPayloadRef,
      localRevision: input.localRevision, nativeBaseRevision: args.expectedNativeBaseRevision ?? undefined, committedAt: now };
    await ctx.db.patch(operation._id, { state: "verified", reconciliationReceipt: committedReceipt, updatedAt: now });
    if (input.resolution) {
      const regions = new Set(input.regionIds);
      const conflicts = await ctx.db.query("syncConflicts")
        .withIndex("by_work_state", q => q.eq("workId", input.workId).eq("state", "open")).collect();
      for (const conflict of conflicts) {
        if (conflict.localRevision !== local.revision || !conflict.replicaIds.includes(local._id) ||
            (input.resolution !== "local" && !conflict.regionIds.every(region => regions.has(region)))) continue;
        await ctx.db.patch(conflict._id, { state: input.resolution === "local" ? "resolved-local" : "resolved-merged",
          resolvedAt: now, updatedAt: now });
      }
    }
    return { state: "applied" as const, duplicate: false, receipt: committedReceipt };
  },
});
