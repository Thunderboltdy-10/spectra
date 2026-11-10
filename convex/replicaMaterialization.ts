import { v, type Infer } from "convex/values";
import { z } from "zod";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { AuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { validateContentAdoption } from "./collaborationDurablePayload";
import { computeEffectivePolicy } from "./syncPolicy";
import { activeReplicaWriteTarget, chooseLiveBridgeDeviceId, chooseLiveLocalReplica, latestActiveWriteForReplica } from "./bridgeIdentity";
import { bridgeWriteForTarget, settleRunNativeOutcome, syncOperationForBridgeWrite } from "./bridgeWriteOperations";
import { nativeSaveReceiptValidator } from "./nativeOfficeValidators";
import { validateNativeSaveReceipt, type NativeSaveReceipt } from "../shared/native-office-contract";
import { BRIDGE_WRITE_EXPIRES_MS, deriveSyncIdempotencyKey, localMaterializationTarget } from "../shared/replica-truth";

const RETRYABLE_MATERIALIZATION_FAILURES = new Set([
  "write-expired",
  "payload-download-failed",
  "file-read-failed",
  "write-failed",
  "target-unavailable",
]);

/** Only server mutation callers choose effect provenance. AI callers must first
 * pass current run/attempt/operation admission in this same transaction. */
export type NativeMaterializationEffects =
  | { actorKind: "user"; canonicalProjection: "legacy" | "durable" }
  | { actorKind: "ai"; canonicalProjection: "durable"; runId: Id<"spectraAiRuns"> };

export const queueMaterializationArgs = v.object({
  workId: v.id("spectraArtifacts"),
  payloadRef: v.string(),
  contentHash: v.string(),
  baseRevision: v.string(),
  fidelityMap: v.any(),
  regionIds: v.array(v.string()),
  partNames: v.array(v.string()),
  localReplicaId: v.optional(v.id("workReplicas")),
  // I2 persists the materialized projection beside the payload so Keep Spectra
  // and conflict previews can restore after reload without a second lens open.
  baseContent: v.optional(v.any()),
  baseContentHash: v.optional(v.string()),
  baseTextIndex: v.optional(v.string()),
  projectionContent: v.optional(v.any()),
  projectionContentHash: v.optional(v.string()),
  projectionTextIndex: v.optional(v.string()),
  nativeReceipt: v.optional(nativeSaveReceiptValidator),
  promotionMode: v.optional(
    v.union(v.literal("verified-first"), v.literal("immediate-projection")),
  ),
});
export type QueueMaterializationArgs = Infer<typeof queueMaterializationArgs>;

export const commitCloudMaterializationArgs = v.object({
  workId: v.id("spectraArtifacts"), payloadRef: v.string(), contentHash: v.string(),
  baseRevision: v.string(), projectionContent: v.any(), projectionContentHash: v.string(),
  fidelityMap: v.any(), nativeReceipt: nativeSaveReceiptValidator,
});
export type CloudMaterializationArgs = Infer<typeof commitCloudMaterializationArgs>;

/** Run in the caller's mutation so a failed append, history write, or native
 * admission rolls back the entire effect. Resolve actor in that transaction. */
export async function queueMaterializationInTransaction(
  ctx: MutationCtx,
  actor: AuthenticatedActor,
  args: QueueMaterializationArgs,
  effects: NativeMaterializationEffects,
) {
  const input = z.object({
    payloadRef: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    baseRevision: z.string().min(1).max(200),
    regionIds: z.array(z.string().min(1).max(300)).max(10_000),
    partNames: z.array(z.string().min(1).max(500)).max(200),
    baseContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    baseTextIndex: z.string().max(200_000).optional(),
    projectionContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    projectionTextIndex: z.string().max(200_000).optional(),
    promotionMode: z.enum(["verified-first", "immediate-projection"]).optional(),
  }).parse(args);
  await requireActorArtifactCapability(ctx, actor, args.workId, "modify");
  await validateContentAdoption(ctx, args.workId, actor.accountId, args.baseContent);
  await validateContentAdoption(ctx, args.workId, actor.accountId, args.projectionContent);
  const work = await ctx.db.get(args.workId);
  if (!work) throw new Error("WORK_NOT_FOUND");
  const payloadId = ctx.db.normalizeId("payloadObjects", input.payloadRef);
  const payload = payloadId ? await ctx.db.get(payloadId) : null;
  if (!payload || payload.accountId !== actor.accountId || payload.hash !== input.contentHash || payload.state !== "active")
    throw new Error("MATERIALIZATION_PAYLOAD_INVALID");
  const locals = (await ctx.db.query("workReplicas")
    .withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local"))
    .take(20))
    .filter((candidate) => candidate.accountId === actor.accountId);
  const deviceIds = [
    ...new Set(
      locals
        .map((replica) => replica.deviceId)
        .filter((id): id is Id<"bridgeDevices"> => Boolean(id)),
    ),
  ];
  const devices = (
    await Promise.all(deviceIds.map((id) => ctx.db.get(id)))
  ).filter((device): device is Doc<"bridgeDevices"> => Boolean(device));
  const liveDeviceId = chooseLiveBridgeDeviceId(devices);
  const local = chooseLiveLocalReplica(
    locals,
    liveDeviceId,
    args.localReplicaId,
  );
  if (!local?.deviceId || !local.mountId || !local.localResourceId || !local.relativePath)
    throw new Error("LOCAL_REPLICA_UNAVAILABLE");
  const [mount, device] = await Promise.all([
    ctx.db.get(local.mountId),
    ctx.db.get(local.deviceId),
  ]);
  if (!activeReplicaWriteTarget(local, mount, device))
    throw new Error("LOCAL_REPLICA_UNAVAILABLE");
  let nativeReceipt: NativeSaveReceipt | undefined;
  if (args.nativeReceipt !== undefined) {
    nativeReceipt = validateNativeSaveReceipt(args.nativeReceipt, {
      artifactId: String(args.workId),
      baseRevision: input.baseRevision,
      targetRevision: input.contentHash,
      resultPayloadHash: input.contentHash,
      target: { regionIds: input.regionIds, partNames: input.partNames },
      basePayloadHash: /^[a-f0-9]{64}$/.test(local.contentHash ?? local.revision) ? (local.contentHash ?? local.revision) : undefined,
      nativeFormat: local.nativeFormat,
    });
    const expectedBaseHash = local.contentHash ?? local.revision;
    if (/^[a-f0-9]{64}$/.test(expectedBaseHash) && nativeReceipt.basePayloadHash !== expectedBaseHash)
      throw new Error("NATIVE_RECEIPT_BASE_MISMATCH");
  }
  const policy = await computeEffectivePolicy(ctx, actor.accountId, {
    account: String(actor.accountId),
    mount: String(local.mountId),
    item: String(args.workId),
  });
  // Refuse protected AI writes before superseding requests or recording pending content.
  if (effects.actorKind === "ai" && policy.protectedOriginal)
    throw new Error("NATIVE_PROMOTION_PROTECTED");
  if (!policy.protectedOriginal && policy.contentDirection !== "bidirectional" && policy.contentDirection !== "spectra-to-local")
    throw new Error("NATIVE_WRITES_DISABLED");
  // A desktop save Spectra has not taken in yet is the newest truth; writing
  // now would replace it. Only a write built on that save (Keep Spectra, after
  // the user saw both) may go ahead; anything else reconciles first.
  if (!policy.protectedOriginal && (local.state === "ahead" || local.state === "diverged") &&
      input.baseRevision !== (local.contentHash ?? local.revision))
    throw new Error("MATERIALIZATION_BASE_STALE");
  const baseIdempotencyKey = await deriveSyncIdempotencyKey({
    workId: String(args.workId),
    target: localMaterializationTarget(String(local.mountId), local.relativePath),
    baseRevision: input.baseRevision,
    targetRevision: input.contentHash,
    direction: "cloud-to-local",
  });
  const now = Date.now();
  const hasImmediateProjection =
    effects.actorKind === "user" &&
    effects.canonicalProjection === "legacy" &&
    !work.liveStateVectorHash &&
    input.promotionMode !== "verified-first" &&
    args.projectionContent !== undefined &&
    input.projectionContentHash !== undefined;
  const projectRequestedContent = async () => {
    if (!hasImmediateProjection) return;
    await ctx.db.patch(args.workId, {
      content: args.projectionContent,
      contentHash: input.projectionContentHash,
      ...(input.projectionTextIndex !== undefined
        ? { textIndex: input.projectionTextIndex }
        : {}),
      updatedAt: now,
    });
  };
  const existing = await bridgeWriteForTarget(ctx, {
    accountId: actor.accountId,
    idempotencyKey: baseIdempotencyKey,
    replicaId: local._id,
    workId: args.workId,
    baseRevision: input.baseRevision,
    targetRevision: input.contentHash,
  });
  let idempotencyKey = baseIdempotencyKey;
  if (existing) {
    if (existing.state === "pending" || existing.state === "claimed" ||
      existing.state === "verified" || existing.state === "conflicted") {
      // The first commit owns this request's projection. Retrying a lost
      // response returns its receipt; it must not roll a newer canonical
      // head back or replace the projection of an already-claimed payload.
      return { requestId: existing._id, state: existing.state };
    }
    if (
      existing.state !== "failed" ||
      !RETRYABLE_MATERIALIZATION_FAILURES.has(existing.errorCode ?? "")
    )
      return { requestId: existing._id, state: existing.state };
    const sameRevisionRequests = await ctx.db.query("bridgeWriteRequests")
      .withIndex("by_work_created", (q) => q.eq("workId", args.workId))
      .order("desc")
      .take(100);
    const activeRetry = sameRevisionRequests.find(
      (request) =>
        request.replicaId === local._id &&
        request.baseRevision === input.baseRevision &&
        request.contentHash === input.contentHash &&
        request.idempotencyKey.startsWith(`${baseIdempotencyKey}:retry:`) &&
        (request.state === "pending" || request.state === "claimed"),
    );
    if (activeRetry)
      return { requestId: activeRetry._id, state: activeRetry.state };
    const retryNumber = sameRevisionRequests.filter(
      (request) =>
        request.replicaId === local._id &&
        request.baseRevision === input.baseRevision &&
        request.contentHash === input.contentHash &&
        request.idempotencyKey.startsWith(`${baseIdempotencyKey}:retry:`),
    ).length + 1;
    idempotencyKey = `${baseIdempotencyKey}:retry:${retryNumber}`;
    const priorRetry = await ctx.db.query("bridgeWriteRequests")
      .withIndex("by_account_key", (q) => q.eq("accountId", actor.accountId).eq("idempotencyKey", idempotencyKey))
      .unique();
    if (priorRetry) return { requestId: priorRetry._id, state: priorRetry.state };
  }
  const activeWrite = latestActiveWriteForReplica(
    await ctx.db.query("bridgeWriteRequests")
      .withIndex("by_work_created", (q) => q.eq("workId", args.workId))
      .order("desc")
      .take(50),
    local._id,
  );
  if (activeWrite) {
    if (local.revision === activeWrite.baseRevision) {
      if (activeWrite.state !== "pending") {
        // A device has claimed this write. It may already be replacing the
        // native package, so a concurrent AI edit cannot safely supersede it.
        // Leave Yjs unchanged; the caller can retry after this receipt lands.
        throw new Error("MATERIALIZATION_BASE_STALE");
      }
      // Office-locked requests stay unclaimed between bounded retry times.
      // A newer collaborative revision contains the previous edit, so replace
      // that queued payload instead of later writing stale bytes to disk.
      await supersedeWriteRequest(
        ctx,
        activeWrite,
        "superseded-by-newer-cloud-revision",
        now,
      );
    } else {
      // Word saved underneath the queued request. Retire it so the caller can
      // rebase against the newly observed native revision.
      await supersedeWriteRequest(ctx, activeWrite, "external-save-during-write", now);
    }
  }
  if (local.revision !== input.baseRevision) {
    throw new Error("MATERIALIZATION_BASE_STALE");
  }
  const effectiveBaseRevision = input.baseRevision;
  if (policy.protectedOriginal) {
    const now = Date.now();
    const startsProtectedSession = !work.pendingPayloadRef;
    if (startsProtectedSession && (args.baseContent === undefined || !input.baseContentHash))
      throw new Error("PROTECTED_BASE_SNAPSHOT_REQUIRED");
    await ctx.db.patch(local._id, {
      pendingPayloadRef: input.payloadRef,
      pendingContentHash: input.contentHash,
      pendingBaseRevision: input.baseRevision,
      protectedOriginal: true,
      state: "ahead",
      updatedAt: now,
    });
    await ctx.db.patch(args.workId, {
      pendingPayloadRef: input.payloadRef,
      pendingContentHash: input.contentHash,
      pendingBaseRevision: input.baseRevision,
      ...(startsProtectedSession
        ? {
            protectedBaseContent: args.baseContent,
            protectedBaseContentHash: input.baseContentHash,
            protectedBaseTextIndex: input.baseTextIndex,
          }
        : {}),
      protectedOriginal: true,
      updatedAt: now,
    });
    await ctx.db.insert("syncOperations", {
      accountId: actor.accountId,
      workId: args.workId,
      replicaId: local._id,
      idempotencyKey,
      direction: "cloud-to-local",
      revisionBefore: input.baseRevision,
      revisionAfter: input.contentHash,
      state: "applied",
      actorKind: effects.actorKind,
      runId: effects.actorKind === "ai" ? effects.runId : undefined,
      errorCode: "protected-original-pending",
      createdAt: now,
      updatedAt: now,
    });
    return { requestId: "protected-original" as const, state: "protected-pending" as const };
  }
  const requestId = await ctx.db.insert("bridgeWriteRequests", {
    accountId: actor.accountId,
    workId: args.workId,
    replicaId: local._id,
    deviceId: local.deviceId,
    mountId: local.mountId,
    localResourceId: local.localResourceId,
    relativePath: local.relativePath,
    payloadRef: input.payloadRef,
    baseRevision: effectiveBaseRevision,
    targetRevision: input.contentHash,
    contentHash: input.contentHash,
    idempotencyKey,
    regionIds: input.regionIds,
    partNames: input.partNames,
    projectionBaseContent: args.projectionContent ?? work.content,
    projectionBaseContentHash: input.projectionContentHash ?? work.contentHash,
    projectionBaseTextIndex: input.projectionTextIndex ?? work.textIndex,
    projectionBaseFidelityMap: args.fidelityMap,
    nativeReceipt,
    state: "pending",
    retryAt: now,
    attemptCount: 0,
    expiresAt: now + BRIDGE_WRITE_EXPIRES_MS,
    createdAt: now,
    updatedAt: now,
  });
  // Cloud bytes stay at the last verified revision until Bridge read-back
  // proves the write. Stamping the target hash here made every overlapping
  // Word save look like a blob conflict with no region previews.
  await ctx.db.patch(local._id, {
    state: "pending",
    retryAt: undefined,
    errorCode: undefined,
    errorMessage: undefined,
    errorAt: undefined,
    updatedAt: now,
  });
  await projectRequestedContent();
  await ctx.db.insert("syncOperations", {
    accountId: actor.accountId,
    workId: args.workId,
    replicaId: local._id,
    idempotencyKey,
    direction: "cloud-to-local",
    revisionBefore: effectiveBaseRevision,
    revisionAfter: input.contentHash,
    state: "pending",
    actorKind: effects.actorKind,
    runId: effects.actorKind === "ai" ? effects.runId : undefined,
    nativeReceipt,
    createdAt: now,
    updatedAt: now,
  });
  return { requestId, state: "pending" as const };
}

/** Advances only the native cloud replica; canonical content belongs to Yjs. */
export async function commitCloudMaterializationInTransaction(
  ctx: MutationCtx,
  actor: AuthenticatedActor,
  args: CloudMaterializationArgs,
  effects: NativeMaterializationEffects,
) {
  await requireActorArtifactCapability(ctx, actor, args.workId, "modify");
  await validateContentAdoption(ctx, args.workId, actor.accountId, args.projectionContent);
  const cloud = await ctx.db.query("workReplicas").withIndex("by_work_kind", q =>
    q.eq("workId", args.workId).eq("kind", "cloud")).unique();
  if (!cloud) throw new Error("NATIVE_PAYLOAD_UNAVAILABLE");
  const payloadId = ctx.db.normalizeId("payloadObjects", args.payloadRef);
  const payload = payloadId ? await ctx.db.get(payloadId) : null;
  if (!payload || payload.accountId !== actor.accountId || payload.hash !== args.contentHash || payload.state !== "active")
    throw new Error("MATERIALIZATION_PAYLOAD_INVALID");
  const receipt = validateNativeSaveReceipt(args.nativeReceipt, {
    artifactId: String(args.workId), baseRevision: args.baseRevision,
    targetRevision: args.contentHash, resultPayloadHash: args.contentHash,
    nativeFormat: cloud.nativeFormat, target: args.nativeReceipt.targets,
  });
  if (receipt.semantic.readbackDigest !== args.projectionContentHash ||
    receipt.semantic.resultDigest !== receipt.semantic.readbackDigest)
    throw new Error("NATIVE_RECEIPT_SEMANTIC_MISMATCH");
  const idempotencyKey = await deriveSyncIdempotencyKey({ workId: String(args.workId),
    target: "cloud", baseRevision: args.baseRevision, targetRevision: args.contentHash, direction: "cloud-to-local" });
  const prior = await ctx.db.query("syncOperations").withIndex("by_account_key", q =>
    q.eq("accountId", actor.accountId).eq("idempotencyKey", idempotencyKey)).unique();
  if (prior) return { state: "cloud_saved" as const, operationId: prior._id };
  if (cloud.revision !== args.baseRevision || cloud.contentHash !== receipt.basePayloadHash)
    throw new Error("MATERIALIZATION_BASE_STALE");
  const now = Date.now();
  await ctx.db.patch(cloud._id, {
    payloadRef: args.payloadRef, contentHash: args.contentHash, revision: args.contentHash,
    baseRevision: args.baseRevision, projectionBasePayloadRef: args.payloadRef,
    projectionBaseRevision: args.contentHash, projectionBaseContent: args.projectionContent,
    projectionBaseContentHash: args.projectionContentHash, fidelityMap: args.fidelityMap,
    projectionBaseFidelityMap: args.fidelityMap, state: "current", lastVerifiedAt: now, updatedAt: now,
  });
  // The disk did not change. Remember that explicitly so reopening or a scan
  // cannot mistake the older copy for a new external edit.
  const locals = await ctx.db.query("workReplicas").withIndex("by_work_kind", q =>
    q.eq("workId", args.workId).eq("kind", "local")).take(20);
  for (const local of locals) {
    if (local.accountId !== actor.accountId || (local.state !== "current" && local.state !== "behind")) continue;
    const state = local.contentHash === args.contentHash ? "current" : "behind";
    if (state !== local.state) await ctx.db.patch(local._id, { state, updatedAt: now });
  }
  const operationId = await ctx.db.insert("syncOperations", {
    accountId: actor.accountId, workId: args.workId, replicaId: cloud._id, idempotencyKey,
    direction: "cloud-to-local", revisionBefore: args.baseRevision, revisionAfter: args.contentHash,
    state: "verified", actorKind: effects.actorKind,
    runId: effects.actorKind === "ai" ? effects.runId : undefined,
    nativeReceipt: { ...receipt, state: "cloud_saved" },
    createdAt: now, updatedAt: now,
  });
  return { state: "cloud_saved" as const, operationId };
}

async function supersedeWriteRequest(
  ctx: MutationCtx,
  request: Doc<"bridgeWriteRequests">,
  errorCode: string,
  now: number,
) {
  await ctx.db.patch(request._id, {
    state: "failed",
    errorCode,
    errorMessage: "A newer copy of the file arrived before this save finished.",
    claimedAt: undefined,
    updatedAt: now,
  });
  const operation = await syncOperationForBridgeWrite(ctx, request);
  if (operation && (operation.state === "pending" || operation.state === "applied"))
    await ctx.db.patch(operation._id, { state: "failed", errorCode, updatedAt: now });
  // The run that queued this write may already be done and waiting on it.
  if (operation?.actorKind === "ai" && operation.runId) await settleRunNativeOutcome(ctx, operation.runId);
  const resolving = await ctx.db.query("syncConflicts")
    .withIndex("by_request_account_state", (q) => q.eq("resolutionRequestId", request._id).eq("accountId", request.accountId).eq("state", "resolving-spectra"))
    .take(50);
  await Promise.all(resolving
    .filter((conflict) => conflict.workId === request.workId && conflict.resolutionRequestId === request._id)
    .map((conflict) => ctx.db.patch(conflict._id, {
      state: "open",
      resolutionRequestId: undefined,
      errorCode: "resolution-write-superseded",
      updatedAt: now,
    })));
}
