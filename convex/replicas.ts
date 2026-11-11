import { externalReconciliationArgs, recordExternalConflict } from "./nativeReconciliation";
import { deleteUnboundDurableStorage } from "./durableStorageBindings";
import { v } from "convex/values";
import { query } from "./functions";
import { internalMutation, mutation } from "./orgNodeMutation";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor, getOptionalAuthenticatedActor } from "./identityShared";
import { placeSourceNode, subtreeNodes } from "./orgTreeShared";
import { z } from "zod";
import {
  activeReplicaWriteTarget,
  chooseLiveBridgeDeviceId,
} from "./bridgeIdentity";
import { bumpPolicyVersion, evaluateAccessForActor, evaluateArtifactAccessForActor, requireActorArtifactCapability } from "./authorityShared";
import { computeEffectivePolicy } from "./syncPolicy";
import { POLICY_PRESETS, type SyncPolicyPreset } from "../shared/sync-policy";
import { planStorageStrategyTransition } from "../shared/storage-strategy";
import {
  BRIDGE_CLAIM_REDRIVE_MS,
  BRIDGE_WRITE_EXPIRES_MS,
  PAYLOAD_RELEASE_GRACE_MS,
  STRATEGY_TRANSITION_EXPIRES_MS,
  STRATEGY_TRANSITION_STALL_MS,
  deriveProjectionSnapshotHash,
  deriveStorageTransitionIdempotencyKey,
  deriveSyncIdempotencyKey,
  localMaterializationTarget,
} from "../shared/replica-truth";
import {
  isActionablePendingOperation,
  retireSupersededExternalOperations,
  verifyReconciledExternalOperations,
} from "./syncOperationLifecycle";
import { bridgeWriteForSyncOperation, bridgeWriteForTarget, syncOperationForBridgeWrite } from "./bridgeWriteOperations";

import { validateContentAdoption } from "./collaborationDurablePayload";
import {
  queueMaterializationArgs,
  commitCloudMaterializationArgs,
  queueMaterializationInTransaction,
  commitCloudMaterializationInTransaction,
} from "./replicaMaterialization";
import { platformStopped } from "./platformControls";

const strategyPreset = v.union(v.literal("spectra"), v.literal("device"), v.literal("both"), v.literal("linked"));

type TransitionState = "pending" | "verified" | "failed" | "conflicted" | "cancelled";

function transitionLocation(replica: Doc<"workReplicas">) {
  return {
    replicaId: String(replica._id),
    kind: replica.kind,
    copyRole: replica.kind === "local" && replica.protectedOriginal ? "original" : replica.kind === "local" ? "managed-copy" : "cloud",
    localResourceId: replica.localResourceId,
    path: replica.relativePath,
    mountId: replica.mountId ? String(replica.mountId) : undefined,
    deviceId: replica.deviceId ? String(replica.deviceId) : undefined,
    state: replica.state,
    availability: replica.state === "unavailable" ? "unavailable" : "available",
    unavailableReason: replica.unavailableReason,
    revision: replica.revision,
    contentHash: replica.contentHash,
  };
}

function transitionLocations(cloud: Doc<"workReplicas"> | null | undefined, locals: Doc<"workReplicas">[]) {
  return {
    cloud: cloud ? transitionLocation(cloud) : undefined,
    locals: locals.map(transitionLocation),
  };
}

function firstLocationValue(snapshot: Record<string, unknown>, key: string) {
  const locations = (snapshot.locations ?? {}) as {
    cloud?: Record<string, unknown>;
    locals?: Array<Record<string, unknown>>;
  };
  const location = locations.cloud ?? locations.locals?.find((candidate) => typeof candidate[key] === "string");
  return location && typeof location[key] === "string" ? location[key] : undefined;
}

function transitionReceipt(
  transition: { _id: Id<"storageStrategyTransitions">; accountId?: Id<"accounts">; workId: Id<"spectraArtifacts">; fromPreset: string; toPreset: string; state: TransitionState; errorCode?: string; before?: unknown; after?: unknown },
  requestId?: Id<"bridgeWriteRequests"> | null,
  operationId?: Id<"syncOperations"> | null,
) {
  const after = (transition.after ?? {}) as Record<string, unknown>;
  const before = (transition.before ?? {}) as Record<string, unknown>;
  return {
    kind: "bridge-storage-transition" as const,
    transitionId: String(transition._id),
    artifactId: String(transition.workId),
    from: transition.fromPreset,
    to: transition.toPreset,
    sourceIdentity: typeof before.sourceLocalResourceId === "string" ? before.sourceLocalResourceId : undefined,
    managedCopyIdentity: typeof after.localResourceId === "string" ? after.localResourceId : undefined,
    materializationRequestId: requestId ? String(requestId) : undefined,
    state: transition.state,
    before: {
      hash: typeof before.cloudContentHash === "string" ? before.cloudContentHash : firstLocationValue(before, "contentHash"),
      path: firstLocationValue(before, "path"),
    },
    after: {
      hash: typeof after.contentHash === "string" ? after.contentHash : firstLocationValue(after, "contentHash"),
      path: firstLocationValue(after, "path"),
    },
    errorCode: transition.errorCode,
    operationId: operationId ? String(operationId) : typeof after.operationId === "string" ? after.operationId : undefined,
  };
}

/** Change storage strategy without changing the logical work identity. */
export const transitionStorageStrategy = mutation({
  args: { workId: v.id("spectraArtifacts"), toPreset: strategyPreset, mountId: v.optional(v.id("bridgeMounts")), relativePath: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const effective = await computeEffectivePolicy(ctx, actor.accountId, { account: String(actor.accountId), item: String(args.workId) });
    const fromPreset = effective.preset as SyncPolicyPreset;
    const recentTransitions = await ctx.db.query("storageStrategyTransitions")
      .withIndex("by_work_created", (q) => q.eq("workId", args.workId))
      .order("desc")
      .take(20);
    const replayed = recentTransitions.find((transition) =>
      transition.toPreset === args.toPreset &&
      (transition.state === "pending" || transition.state === "conflicted" || (transition.state === "verified" && fromPreset === args.toPreset)),
    );
    if (replayed) {
      const requestId = ctx.db.normalizeId(
        "bridgeWriteRequests",
        String((replayed.after as { materializationRequestId?: string } | undefined)?.materializationRequestId ?? ""),
      );
      const storedOperationId = ctx.db.normalizeId(
        "syncOperations",
        String((replayed.after as { operationId?: string } | undefined)?.operationId ?? ""),
      );
      let operation = storedOperationId ? await ctx.db.get(storedOperationId) : null;
      if (!operation && requestId) {
        const request = await ctx.db.get(requestId);
        operation = request ? await syncOperationForBridgeWrite(ctx, request) : null;
      }
      return { state: replayed.state, transitionId: replayed._id, materializationRequestId: requestId, operationId: operation?._id ?? storedOperationId, transitionReceipt: transitionReceipt(replayed, requestId, operation?._id ?? storedOperationId) };
    }
    const idempotencyKey = await deriveStorageTransitionIdempotencyKey({
      workId: String(args.workId),
      fromPreset,
      toPreset: args.toPreset,
      target: `${args.mountId ? String(args.mountId) : "cloud"}:${args.relativePath?.trim().replaceAll("\\", "/") ?? ""}`,
    });
    const existingTransition = await ctx.db.query("storageStrategyTransitions")
      .withIndex("by_account_key", (q) => q.eq("accountId", actor.accountId).eq("idempotencyKey", idempotencyKey)).unique();
    if (existingTransition && existingTransition.state !== "failed") {
      const requestId = ctx.db.normalizeId(
        "bridgeWriteRequests",
        String((existingTransition.after as { materializationRequestId?: string } | undefined)?.materializationRequestId ?? ""),
      );
      const storedOperationId = ctx.db.normalizeId(
        "syncOperations",
        String((existingTransition.after as { operationId?: string } | undefined)?.operationId ?? ""),
      );
      let operation = storedOperationId ? await ctx.db.get(storedOperationId) : null;
      if (!operation && requestId) {
        const request = await ctx.db.get(requestId);
        operation = request ? await syncOperationForBridgeWrite(ctx, request) : null;
      }
      return { state: existingTransition.state, transitionId: existingTransition._id, materializationRequestId: requestId, operationId: operation?._id ?? storedOperationId, transitionReceipt: transitionReceipt(existingTransition, requestId, operation?._id ?? storedOperationId) };
    }
    let [cloud, locals] = await Promise.all([
      ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "cloud")).unique(),
      ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local")).take(20),
    ]);
    let activeLocal = locals.find((replica) => replica.state !== "unavailable" && replica.unavailableReason !== "removed-by-user" && replica.unavailableReason !== "unlinked-by-user");
    const verifiedCloudPayload = cloud ? await verifiedReplicaPayload(ctx, cloud) : null;
    const verifiedLocalPayload = activeLocal ? await verifiedReplicaPayload(ctx, activeLocal) : null;
    const hashedPayload = !verifiedCloudPayload && !verifiedLocalPayload
      ? await payloadForHash(ctx, actor.accountId, activeLocal?.contentHash)
      : null;
    const attachablePayload = verifiedCloudPayload ?? verifiedLocalPayload ?? hashedPayload;
    const requiresLocal = args.toPreset === "device" || args.toPreset === "both" || args.toPreset === "linked";
    const strategyPlan = planStorageStrategyTransition(args.toPreset, {
      hasCloud: Boolean(cloud),
      cloudHasPayload: Boolean(attachablePayload),
      hasActiveLocal: Boolean(activeLocal),
      localIsVerified: Boolean(activeLocal && activeLocal.state === "current" && activeLocal.contentHash && activeLocal.lastVerifiedAt),
      replicasAgree: Boolean(
        !cloud?.contentHash ||
        !activeLocal?.contentHash ||
        (cloud.contentHash && cloud.contentHash === activeLocal.contentHash),
      ),
      hasProtectedPending: locals.some((replica) => Boolean(replica.pendingPayloadRef)),
    });
    const now = Date.now();
    const before = {
      preset: fromPreset,
      hadItemPolicy: effective.source.kind === "item" && effective.source.id === String(args.workId),
      policy: {
        preset: effective.preset,
        contentDirection: effective.contentDirection,
        discovery: effective.discovery,
        structure: effective.structure,
        cloudContent: effective.cloudContent,
        localMirrorGrantId: effective.localMirrorGrantId,
        includeGlobs: effective.includeGlobs,
        excludeGlobs: effective.excludeGlobs,
        timing: effective.timing,
        protectedOriginal: effective.protectedOriginal,
      },
      cloudPayloadRef: cloud?.payloadRef,
      cloudContentHash: cloud?.contentHash,
      sourceLocalResourceId: activeLocal?.localResourceId ?? locals.find((replica) => replica.localResourceId)?.localResourceId,
      localReplicaIds: locals.map((replica) => String(replica._id)),
      localStates: locals.map((replica) => ({ id: String(replica._id), state: replica.state })),
      locations: transitionLocations(cloud, locals),
    };
    const transitionId = existingTransition
      ? (await ctx.db.patch(existingTransition._id, {
          fromPreset,
          toPreset: args.toPreset,
          state: "pending",
          before,
          after: undefined,
          errorCode: undefined,
          expiresAt: now + STRATEGY_TRANSITION_EXPIRES_MS,
          updatedAt: now,
        }), existingTransition._id)
      : await ctx.db.insert("storageStrategyTransitions", {
          accountId: actor.accountId,
          workId: args.workId,
          idempotencyKey,
          fromPreset,
          toPreset: args.toPreset,
          state: "pending",
          before,
          expiresAt: now + STRATEGY_TRANSITION_EXPIRES_MS,
          createdAt: now,
          updatedAt: now,
    });
    let createdLocal = false;
    let materializationRequestId: Id<"bridgeWriteRequests"> | undefined;
    let materializationOperationId: Id<"syncOperations"> | undefined;
    try {
      if (!cloud && activeLocal && args.toPreset !== "device") {
        const cloudId = await ctx.db.insert("workReplicas", {
          accountId: actor.accountId,
          workId: args.workId,
          kind: "cloud",
          nativeFormat: activeLocal.nativeFormat,
          revision: activeLocal.revision,
          baseRevision: activeLocal.baseRevision,
          contentHash: activeLocal.contentHash,
          state: "behind",
          fidelityMap: activeLocal.fidelityMap,
          preservedCarryVersion: activeLocal.preservedCarryVersion ?? 1,
          compatibilityProfile: activeLocal.compatibilityProfile ?? "strict-native",
          updatedAt: now,
        });
        cloud = await ctx.db.get(cloudId);
      }
      if (requiresLocal && !activeLocal) {
        if (!args.mountId || !args.relativePath || !cloud?.payloadRef) throw new Error("STORAGE_STRATEGY_LOCAL_TARGET_REQUIRED");
        if (!cloud.contentHash) throw new Error("STORAGE_STRATEGY_CLOUD_HASH_REQUIRED");
        const mount = await ctx.db.get(args.mountId);
        const device = mount ? await ctx.db.get(mount.deviceId) : null;
        if (!mount || mount.accountId !== actor.accountId || mount.state !== "active" || !device || device.state !== "active") throw new Error("MOUNT_NOT_ACTIVE");
        if (mount.selectedFile) throw new Error("Choose a synced folder to save a new file on this computer.");
        const relativePath = z.string().trim().min(1).max(1024).refine((value) => !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes(".."), "LOCAL_PATH_INVALID").parse(args.relativePath);
        const localResourceId = `lr_${crypto.randomUUID().replaceAll("-", "")}`;
        const initialRevision = `new:${cloud.revision}`;
        const localId = await ctx.db.insert("workReplicas", { accountId: actor.accountId, workId: args.workId, kind: "local", deviceId: mount.deviceId, mountId: mount._id, localResourceId, relativePath, nativeFormat: cloud.nativeFormat, payloadRef: undefined, revision: initialRevision, baseRevision: cloud.revision, contentHash: undefined, state: "pending", fidelityMap: cloud.fidelityMap, preservedCarryVersion: 1, compatibilityProfile: cloud.compatibilityProfile ?? "strict-native", updatedAt: now });
        activeLocal = (await ctx.db.get(localId)) ?? undefined;
        const writeKey = await deriveSyncIdempotencyKey({ workId: String(args.workId), target: localMaterializationTarget(String(mount._id), relativePath), baseRevision: initialRevision, targetRevision: cloud.contentHash, direction: "cloud-to-local" });
        materializationRequestId = await ctx.db.insert("bridgeWriteRequests", { accountId: actor.accountId, workId: args.workId, replicaId: localId, deviceId: mount.deviceId, mountId: mount._id, localResourceId, relativePath, payloadRef: cloud.payloadRef, baseRevision: initialRevision, targetRevision: cloud.contentHash, contentHash: cloud.contentHash, idempotencyKey: writeKey, regionIds: [], partNames: [], projectionBaseContent: work.content, projectionBaseContentHash: work.contentHash, projectionBaseTextIndex: work.textIndex, projectionBaseFidelityMap: cloud.fidelityMap, state: "pending", retryAt: now, attemptCount: 0, expiresAt: now + BRIDGE_WRITE_EXPIRES_MS, createdAt: now, updatedAt: now });
        materializationOperationId = await ctx.db.insert("syncOperations", { accountId: actor.accountId, workId: args.workId, replicaId: localId, idempotencyKey: writeKey, direction: "cloud-to-local", revisionBefore: initialRevision, revisionAfter: cloud.contentHash, state: "pending", actorKind: "user", createdAt: now, updatedAt: now });
        createdLocal = true;
        locals = [...locals, activeLocal!];
      }
      const presetValues = POLICY_PRESETS[args.toPreset];
      const existingPolicy = await ctx.db.query("syncPolicies").withIndex("by_account_scope", (q) => q.eq("accountId", actor.accountId).eq("scopeKind", "item").eq("scopeId", String(args.workId))).unique();
      if (existingPolicy) await ctx.db.patch(existingPolicy._id, { ...presetValues, updatedAt: now });
      else await ctx.db.insert("syncPolicies", { accountId: actor.accountId, scopeKind: "item", scopeId: String(args.workId), ...presetValues, createdAt: now, updatedAt: now });
      await ctx.db.insert("syncPolicyChanges", {
        accountId: actor.accountId,
        scopeKind: "item",
        scopeId: String(args.workId),
        action: "override",
        before: { preset: fromPreset },
        after: { ...presetValues },
        actorKind: "user",
        idempotencyKey: `storage:${idempotencyKey}`,
        createdAt: now,
      });
      if (args.toPreset === "spectra") {
        // A metadata-only cloud row is not a completed migration. Keep the
        // local source active until a verified native payload is attached.
        // Prefer a retained payload object (including one unlinked by This PC)
        // over waiting for a Bridge change event that may never fire.
        if (attachablePayload && cloud) {
          await ctx.db.patch(cloud._id, {
            payloadRef: String(attachablePayload._id),
            contentHash: attachablePayload.hash,
            revision: attachablePayload.hash,
            baseRevision: attachablePayload.hash,
            state: "current",
            lastVerifiedAt: now,
            unavailableReason: undefined,
            errorCode: undefined,
            errorMessage: undefined,
            errorAt: undefined,
            updatedAt: now,
          });
        }
        if (!strategyPlan.requiresCloudMaterialization) {
          for (const local of locals) await ctx.db.patch(local._id, { state: "unavailable", unavailableReason: "unlinked-by-user", protectedOriginal: undefined, updatedAt: now });
        }
        await ctx.db.patch(args.workId, { protectedOriginal: false, updatedAt: now });
      } else if (args.toPreset === "device" && cloud) {
        // Keep the cloud payload until the Bridge has read back and verified
        // the materialized local file. completeWrite owns the final cleanup;
        // clearing it here would make a failed F6 transition lose recovery.
        await ctx.db.patch(activeLocal!._id, { protectedOriginal: undefined, state: createdLocal ? "pending" : activeLocal!.state === "unavailable" ? "behind" : activeLocal!.state, updatedAt: now });
        await ctx.db.patch(args.workId, { protectedOriginal: false, updatedAt: now });
      } else if (args.toPreset === "both") {
        if (attachablePayload && cloud && !verifiedCloudPayload) {
          await ctx.db.patch(cloud._id, {
            payloadRef: String(attachablePayload._id),
            contentHash: attachablePayload.hash,
            revision: attachablePayload.hash,
            baseRevision: attachablePayload.hash,
            state: "current",
            lastVerifiedAt: now,
            unavailableReason: undefined,
            errorCode: undefined,
            errorMessage: undefined,
            errorAt: undefined,
            updatedAt: now,
          });
        }
        await ctx.db.patch(activeLocal!._id, { protectedOriginal: undefined, state: activeLocal!.state === "unavailable" ? "behind" : activeLocal!.state, updatedAt: now });
        await ctx.db.patch(args.workId, { protectedOriginal: false, updatedAt: now });
      } else if (args.toPreset === "linked") {
        await ctx.db.patch(activeLocal!._id, { protectedOriginal: true, updatedAt: now });
        await ctx.db.patch(args.workId, { protectedOriginal: true, updatedAt: now });
      }
      if (!createdLocal && !strategyPlan.requiresCloudMaterialization && (args.toPreset === "device" || args.toPreset === "linked") && cloud && activeLocal) {
        await ctx.db.patch(cloud._id, { payloadRef: undefined, contentHash: undefined, state: "unavailable", unavailableReason: "metadata-only", lastVerifiedAt: undefined, updatedAt: now });
        await ctx.db.patch(activeLocal._id, {
          payloadRef: undefined,
          pendingPayloadRef: undefined,
          projectionBasePayloadRef: undefined,
          state: "current",
          lastVerifiedAt: activeLocal.lastVerifiedAt ?? now,
          updatedAt: now,
        });
      }
      const [actualCloud, actualLocals] = await Promise.all([
        ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "cloud")).unique(),
        ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local")).take(20),
      ]);
      const afterLocations = transitionLocations(actualCloud, actualLocals);
      const after = {
        preset: args.toPreset,
        cloudPayloadRef: args.toPreset === "device" || args.toPreset === "linked" ? undefined : actualCloud?.payloadRef,
        localReplicaIds: actualLocals.map((replica) => String(replica._id)),
        localResourceId: actualLocals.find((replica) => replica._id === activeLocal?._id)?.localResourceId ?? actualLocals.find((replica) => replica.localResourceId)?.localResourceId,
        sourceLocalResourceId: before.sourceLocalResourceId,
        physicalLocalAction: args.toPreset === "spectra" ? "leave-file-in-place" : materializationRequestId ? "write-retained-payload-to-existing-local-resource" : "retain",
        materializationRequestId: materializationRequestId ? String(materializationRequestId) : undefined,
        operationId: materializationOperationId ? String(materializationOperationId) : undefined,
        contentHash: actualCloud?.contentHash ?? attachablePayload?.hash,
        locations: afterLocations,
      };
      const finalState = createdLocal || strategyPlan.requiresCloudMaterialization ? "pending" : strategyPlan.completion;
      await ctx.db.patch(transitionId, { state: finalState, after, updatedAt: Date.now() });
      return {
        state: finalState as "pending" | "verified",
        transitionId,
        materializationRequestId: materializationRequestId ?? null,
        operationId: materializationOperationId ?? null,
        preview: { before, after },
        transitionReceipt: transitionReceipt({
          _id: transitionId,
          workId: args.workId,
          fromPreset,
          toPreset: args.toPreset,
          state: finalState as TransitionState,
          before,
          after,
        }, materializationRequestId ?? null, materializationOperationId),
      };
    } catch (error) {
      const failedAt = Date.now();
      const previousPolicy = before.policy;
      const currentPolicy = await ctx.db.query("syncPolicies").withIndex("by_account_scope", (q) => q.eq("accountId", actor.accountId).eq("scopeKind", "item").eq("scopeId", String(args.workId))).unique();
      if (currentPolicy && before.hadItemPolicy) await ctx.db.patch(currentPolicy._id, { ...previousPolicy, updatedAt: failedAt });
      else if (currentPolicy) await ctx.db.delete(currentPolicy._id);
      if (materializationRequestId) {
        const request = await ctx.db.get(materializationRequestId);
        if (request) await ctx.db.patch(request._id, { state: "failed", errorCode: "strategy-transition-failed", updatedAt: failedAt });
      }
      if (createdLocal && activeLocal) await ctx.db.patch(activeLocal._id, { state: "error", errorCode: "strategy-transition-failed", errorAt: failedAt, updatedAt: failedAt });
      await ctx.db.patch(transitionId, { state: "failed", errorCode: error instanceof Error ? error.message.slice(0, 120) : "STRATEGY_TRANSITION_FAILED", updatedAt: failedAt });
      throw error;
    }
  },
});

/**
 * The open conflicts that still ask for a choice. Once the cloud and the
 * conflict's desktop copy hold the same revision again, it was merged.
 */
function liveConflicts(
  conflicts: Doc<"syncConflicts">[],
  replicas: ReadonlyArray<Pick<Doc<"workReplicas">, "_id" | "kind" | "state" | "revision">>,
) {
  const cloud = replicas.find((replica) => replica.kind === "cloud" && replica.state === "current");
  if (!cloud) return conflicts;
  const agreed = new Set(
    replicas
      .filter((replica) => replica.kind === "local" && replica.state === "current" && replica.revision === cloud.revision)
      .map((replica) => String(replica._id)),
  );
  return conflicts.filter(
    (conflict) => conflict.localRevision !== cloud.revision && !conflict.replicaIds.some((id) => agreed.has(String(id))),
  );
}

async function visibleReplicasForWork(ctx: QueryCtx, workId: Id<"spectraArtifacts">, accountId: Id<"accounts">) {
  const cloud = await ctx.db.query("workReplicas")
    .withIndex("by_work_kind", (q) => q.eq("workId", workId).eq("kind", "cloud")).first();
  const locals = await ctx.db.query("workReplicas")
    .withIndex("by_work_kind_account", (q) => q.eq("workId", workId).eq("kind", "local").eq("accountId", accountId))
    .take(cloud ? 19 : 20);
  return [...(cloud ? [cloud] : []), ...locals].sort((a, b) => a._creationTime - b._creationTime);
}

export const forWork = query({
  args: { workId: v.id("spectraArtifacts") },
  handler: async (ctx, { workId }) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const access = await evaluateArtifactAccessForActor(ctx, actor, workId);
    // Unavailability is a normal state of a live metadata subscription.
    if (!access.allowed || !access.capabilities.includes("read")) return null;
    // Shared artifact access grants content authority, not access to another
    // account's Bridge filesystem. A collaborator can see the cloud truth and
    // any local replica registered to their own account; owner-local paths,
    // device ids, and mounts remain private.
    const visibleReplicas = await visibleReplicasForWork(ctx, workId, actor.accountId);
    const deviceIds = [
      ...new Set(
        visibleReplicas
          .map((replica) => replica.deviceId)
          .filter((id): id is Id<"bridgeDevices"> => Boolean(id)),
      ),
    ];
    const devices = (
      await Promise.all(deviceIds.map((id) => ctx.db.get(id)))
    ).filter((device): device is Doc<"bridgeDevices"> => Boolean(device));
    const liveDeviceId = chooseLiveBridgeDeviceId(devices);
    const presented = visibleReplicas.map((replica) => {
      if (
        replica.kind !== "local" ||
        !liveDeviceId ||
        replica.deviceId === liveDeviceId
      ) {
        return replica;
      }
      return {
        ...replica,
        state: "unavailable" as const,
        unavailableReason: "not-on-this-computer",
      };
    });
    const openConflicts = liveConflicts(
      await ctx.db.query("syncConflicts").withIndex("by_work_account_state", (q) => q.eq("workId", workId).eq("accountId", actor.accountId).eq("state", "open")).take(20),
      presented,
    );
    const pending = await ctx.db.query("syncOperations").withIndex("by_work_account_created", (q) => q.eq("workId", workId).eq("accountId", actor.accountId)).order("desc").take(50);
    const replicaById = new Map(presented.map((replica) => [String(replica._id), replica]));
    const pendingCount = pending.filter((operation) => isActionablePendingOperation(operation, replicaById)).length;
    // An editor open in another tab learns here that the work went to Trash (F17).
    const placements = await ctx.db.query("orgNodes")
      .withIndex("by_account_kind_source", (q) => q.eq("accountId", actor.accountId).eq("kind", "work").eq("sourceId", workId))
      .take(4);
    const trashedNode = placements.length && placements.every((node) => node.deletedAt !== undefined)
      ? placements.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))[0]!
      : null;
    return {
      replicas: presented, conflicts: openConflicts, openConflictCount: openConflicts.length, pendingCount, recentOperations: pending.slice(0, 20),
      ...(trashedNode ? { trashedNodeId: trashedNode.trashedRootId ?? trashedNode._id } : {}),
    };
  },
});

export const materializationStatus = query({
  args: { requestId: v.id("bridgeWriteRequests") },
  handler: async (ctx, { requestId }) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const request = await ctx.db.get(requestId);
    if (!request) throw new Error("WRITE_REQUEST_NOT_FOUND");
    const access = await evaluateAccessForActor(ctx, actor, "artifact", request.workId);
    if (!access.allowed || !access.capabilities.includes("read"))
      throw new Error("WRITE_REQUEST_NOT_FOUND");
    return {
      requestId: request._id,
      workId: request.workId,
      state: request.state,
      errorCode: request.errorCode,
      errorMessage: request.errorMessage,
      retryAt: request.retryAt,
      targetRevision: request.targetRevision,
    };
  },
});

export const cancelMaterialization = mutation({
  args: { requestId: v.id("bridgeWriteRequests") },
  handler: async (ctx, { requestId }) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const request = await ctx.db.get(requestId);
    if (!request) throw new Error("WRITE_REQUEST_NOT_FOUND");
    const access = await evaluateAccessForActor(ctx, actor, "artifact", request.workId);
    if (!access.allowed || !access.capabilities.includes("modify"))
      throw new Error("WRITE_REQUEST_NOT_FOUND");
    const now = Date.now();
    if (request.state === "claimed" || request.state === "verified") {
      return { cancelled: false, state: request.state, mustConverge: true as const };
    }
    if (request.state !== "pending") {
      return { cancelled: false, state: request.state };
    }
    await ctx.db.patch(request._id, {
      state: "failed",
      errorCode: "cancelled-before-claim",
      errorMessage: "The save was cancelled before the original file was written.",
      claimedAt: undefined,
      updatedAt: now,
    });
    const operation = await syncOperationForBridgeWrite(ctx, request);
    if (operation && (operation.state === "pending" || operation.state === "applied"))
      await ctx.db.patch(operation._id, { state: "failed", errorCode: "cancelled-before-claim", updatedAt: now });
    const replica = await ctx.db.get(request.replicaId);
    if (replica?.state === "pending") {
      await ctx.db.patch(replica._id, {
        state: "current",
        errorCode: undefined,
        errorMessage: undefined,
        errorAt: undefined,
        updatedAt: now,
      });
    }
    return { cancelled: true, state: "failed" as const };
  },
});

/** Summary replica truth for Library rows. Indexed, no content (ARCHITECTURE-PLATFORM §2). */
export const presentationsForAccount = query({
  args: {},
  handler: async (ctx) => {
    const actor = await getOptionalAuthenticatedActor(ctx);
    if (!actor) return [];
    const replicaStates = ["diverged", "error", "pending", "unavailable"] as const;
    const [openConflicts, ...replicaBatches] = await Promise.all([
      ctx.db.query("syncConflicts").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId).eq("state", "open")).take(100),
      ...replicaStates.map((state) =>
        ctx.db.query("workReplicas").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId).eq("state", state)).take(100),
      ),
    ]);
    const byWork = new Map<string, {
      replicas: Array<{
        kind: "cloud" | "local";
        state: "current" | "ahead" | "behind" | "diverged" | "pending" | "error" | "unavailable";
        lastVerifiedAt?: number;
        errorCode?: string;
        unavailableReason?: string;
      }>;
      openConflictCount: number;
      pendingCount: number;
    }>();
    const ensure = (workId: string) => {
      const existing = byWork.get(workId);
      if (existing) return existing;
      const created = { replicas: [], openConflictCount: 0, pendingCount: 0 };
      byWork.set(workId, created);
      return created;
    };
    for (const conflict of openConflicts) ensure(String(conflict.workId));
    for (const replica of replicaBatches.flat()) {
      ensure(String(replica.workId));
    }
    // Attention indexes omit current/ahead/behind. The presenter needs the
    // full replica set or a This-PC file looks Unavailable (cloud metadata-only).
    for (const workId of byWork.keys()) {
      const row = ensure(workId);
      const workReplicas = await visibleReplicasForWork(ctx, workId as Id<"spectraArtifacts">, actor.accountId);
      row.replicas = workReplicas.map((replica) => ({
        kind: replica.kind,
        state: replica.state,
        lastVerifiedAt: replica.lastVerifiedAt,
        errorCode: replica.errorCode,
        unavailableReason: replica.unavailableReason,
      }));
      row.pendingCount = workReplicas.filter((replica) => replica.state === "pending").length;
      row.openConflictCount = liveConflicts(
        openConflicts.filter((conflict) => String(conflict.workId) === workId),
        workReplicas,
      ).length;
    }
    return [...byWork.entries()].map(([workId, value]) => ({ workId, ...value }));
  },
});

/** Count the currently available local replicas behind an application-level
 * sync-policy confirmation. The consequence is derived from owned data rather
 * than trusted from model-provided arguments. */
export const localEffectCount = query({
  args: { workIds: v.array(v.id("spectraArtifacts")) },
  handler: async (ctx, { workIds }) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    let count = 0;
    for (const workId of workIds.slice(0, 100)) {
      const work = await ctx.db.get(workId);
      if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
      const replicas = await ctx.db.query("workReplicas")
        .withIndex("by_work_kind", (q) => q.eq("workId", workId).eq("kind", "local"))
        .take(50);
      count += replicas.filter((replica) => replica.state !== "unavailable").length;
    }
    return { count };
  },
});

/** Undo can restore a shared work, but another owner's computer remains private. */
export const undoNeedsLocalApproval = query({
  args: { workIds: v.array(v.id("spectraArtifacts")) },
  handler: async (ctx, { workIds }) => {
    if (workIds.length > 100) throw new Error("Too many artifacts in one Undo preflight.");
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    let local = false;
    for (const workId of new Set(workIds)) {
      const access = await evaluateArtifactAccessForActor(ctx, actor, workId);
      if (!access.allowed || !access.capabilities.includes("modify")) throw new Error("WORK_NOT_FOUND");
      if (local) continue;
      const replica = await ctx.db.query("workReplicas")
        .withIndex("by_work_kind", (q) => q.eq("workId", workId).eq("kind", "local"))
        .filter((q) => q.and(q.eq(q.field("accountId"), actor.accountId), q.neq(q.field("state"), "unavailable")))
        .first();
      if (replica) {
        const policy = await computeEffectivePolicy(ctx, actor.accountId, {
          item: String(workId), mount: replica.mountId ? String(replica.mountId) : undefined,
        });
        local = policy.contentDirection === "bidirectional" || policy.contentDirection === "spectra-to-local";
      }
    }
    return local;
  },
});

/** Count available local replicas behind Library node ids, including work
 * inside folders. Used to promote tree notify to local_file confirm. */
export const localEffectCountForNodes = query({
  args: { nodeIds: v.array(v.id("orgNodes")) },
  handler: async (ctx, { nodeIds }) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const seen = new Set<string>();
    let count = 0;
    for (const nodeId of nodeIds.slice(0, 100)) {
      const node = await ctx.db.get(nodeId);
      if (!node || node.accountId !== actor.accountId) continue;
      const related =
        node.kind === "folder" || node.kind === "workspace"
          ? await subtreeNodes(ctx, node)
          : [node];
      for (const item of related) {
        if (item.kind !== "work" || !item.sourceId) continue;
        const workId = ctx.db.normalizeId("spectraArtifacts", item.sourceId);
        if (!workId || seen.has(String(workId))) continue;
        seen.add(String(workId));
        const work = await ctx.db.get(workId);
        if (!work || work.ownerAccountId !== actor.accountId) continue;
        const replicas = await ctx.db
          .query("workReplicas")
          .withIndex("by_work_kind", (q) =>
            q.eq("workId", workId).eq("kind", "local"),
          )
          .take(50);
        count += replicas.filter((replica) => replica.state !== "unavailable")
          .length;
      }
    }
    return { count };
  },
});

export const strategyTransitionForWork = query({
  args: { workId: v.id("spectraArtifacts") },
  handler: async (ctx, { workId }) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(workId);
    if (!work || work.status === "deleted" || work.ownerAccountId !== actor.accountId) return null;
    const transitions = await ctx.db.query("storageStrategyTransitions")
      .withIndex("by_work_created", (q) => q.eq("workId", workId))
      .order("desc")
      .take(10);
    const transition = transitions[0] ?? null;
    if (!transition) return null;
    const requestId = ctx.db.normalizeId(
      "bridgeWriteRequests",
      String((transition.after as { materializationRequestId?: string } | undefined)?.materializationRequestId ?? ""),
    );
    const [request, cloud, locals] = await Promise.all([
      requestId ? ctx.db.get(requestId) : Promise.resolve(null),
      ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", workId).eq("kind", "cloud")).unique(),
      ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", workId).eq("kind", "local")).take(20),
    ]);
    const after = (transition.after ?? {}) as Record<string, unknown>;
    const storedOperationId = ctx.db.normalizeId("syncOperations", typeof after.operationId === "string" ? after.operationId : "");
    let operation = storedOperationId ? await ctx.db.get(storedOperationId) : null;
    if (!operation && request) {
      operation = await syncOperationForBridgeWrite(ctx, request);
    }
    return {
      ...transition,
      requestId,
      operationId: operation?._id ?? storedOperationId ?? (typeof after.operationId === "string" ? after.operationId : undefined),
      requestState: request?.state,
      operationState: operation?.state,
      preview: {
        before: transition.before,
        current: transitionLocations(cloud, locals),
        after,
        pendingWork: request
          ? { requestId: String(request._id), state: request.state, targetRevision: request.targetRevision, localResourceId: request.localResourceId, relativePath: request.relativePath }
          : undefined,
      },
    };
  },
});

export const payloadForWork = query({
  args: {
    workId: v.id("spectraArtifacts"),
    prefer: v.optional(v.union(v.literal("cloud"), v.literal("local-latest"))),
  },
  handler: async (ctx, { workId, prefer }) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    await requireActorArtifactCapability(ctx, actor, workId, "read");
    const work = await ctx.db.get(workId);
    if (!work) throw new Error("WORK_NOT_FOUND");
    const visibleReplicas = await visibleReplicasForWork(ctx, workId, actor.accountId);
    if (prefer !== "local-latest" && work.pendingPayloadRef && work.pendingContentHash) {
      const pendingId = ctx.db.normalizeId("payloadObjects", work.pendingPayloadRef);
      const pending = pendingId ? await ctx.db.get(pendingId) : null;
      const protectedLocal = visibleReplicas.find((replica) => replica.kind === "local" && replica.pendingPayloadRef === work.pendingPayloadRef);
      if (pending && pending.state === "active") {
        return {
          url: await ctx.storage.getUrl(pending.storageId), bytes: pending.bytes, hash: pending.hash,
          mediaType: pending.mediaType, payloadRef: String(pending._id), replicaId: protectedLocal?._id,
          replicaKind: "cloud" as const, revision: work.pendingContentHash, baseRevision: work.pendingBaseRevision,
          state: "ahead" as const, nativeFormat: protectedLocal?.nativeFormat ?? work.nativeFormat ?? "spectra-pkg",
          fidelityMap: protectedLocal?.fidelityMap, compatibilityProfile: protectedLocal?.compatibilityProfile ?? work.compatibilityProfile ?? "strict-native",
        };
      }
    }
    const local = visibleReplicas
      .filter((replica) => replica.kind === "local" && replica.payloadRef)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    const cloud = visibleReplicas.find((replica) => replica.kind === "cloud" && replica.payloadRef);
    const selected = prefer === "local-latest" ? local ?? cloud : cloud ?? local;
    if (!selected?.payloadRef) return null;
    const payloadId = ctx.db.normalizeId("payloadObjects", selected.payloadRef);
    const payload = payloadId ? await ctx.db.get(payloadId) : null;
    if (!payload || payload.state !== "active") return null;
    return {
      url: await ctx.storage.getUrl(payload.storageId),
      bytes: payload.bytes,
      hash: payload.hash,
      mediaType: payload.mediaType,
      payloadRef: String(payload._id),
      replicaId: selected._id,
      replicaKind: selected.kind,
      revision: selected.revision,
      baseRevision: selected.baseRevision,
      state: selected.state,
      nativeFormat: selected.nativeFormat,
      fidelityMap: selected.fidelityMap,
      projectionBasePayloadRef: selected.projectionBasePayloadRef,
      projectionBaseRevision: selected.projectionBaseRevision,
      projectionBaseContent: selected.projectionBaseContent,
      projectionBaseContentHash: selected.projectionBaseContentHash,
      projectionBaseTextIndex: selected.projectionBaseTextIndex,
      projectionBaseFidelityMap: selected.projectionBaseFidelityMap,
      compatibilityProfile: selected.compatibilityProfile ?? work.compatibilityProfile ?? "strict-native",
    };
  },
});

export const activateLens = mutation({
  args: {
    workId: v.id("spectraArtifacts"),
    payloadHash: v.string(),
    content: v.any(),
    fidelityMap: v.any(),
    semanticDigest: v.string(),
    nativeFormat: v.string(),
    blueprintKey: v.optional(v.union(v.literal("document"), v.literal("sheets"), v.literal("presentation"))),
    textIndex: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const input = z.object({
      payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
      semanticDigest: z.string().regex(/^[a-f0-9]{64}$/),
      nativeFormat: z.enum(["docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "xlam", "pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "ppam"]),
      blueprintKey: z.enum(["document", "sheets", "presentation"]).optional(),
      textIndex: z.string().max(200_000).optional(),
    }).parse(args);
    await requireActorArtifactCapability(ctx, actor, args.workId, "modify");
    await validateContentAdoption(ctx, args.workId, actor.accountId, args.content);
    const work = await ctx.db.get(args.workId);
    if (!work) throw new Error("WORK_NOT_FOUND");
    const cloud = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "cloud"))
      .unique();
    if (!cloud || cloud.contentHash !== input.payloadHash || !cloud.payloadRef)
      throw new Error("LENS_BASE_PAYLOAD_CHANGED");
    const now = Date.now();
    const nextBlueprintKey = input.blueprintKey ?? "document";
    const changesArtifactType = work.blueprintKey !== nextBlueprintKey;
    if (changesArtifactType && work.blueprintKey !== "resource")
      throw new Error("LENS_TYPE_TRANSITION_UNSAFE");
    // Opening a retained package must not reset an already-live authored head.
    // External revisions use recordExternalReconciliation before reaching here.
    if (!changesArtifactType && work.liveStateVectorHash)
      return { activated: false, workId: args.workId };
    const nextSchemaVersion =
      nextBlueprintKey === "document"
          ? 2
          : nextBlueprintKey === "sheets"
          ? 4
          : 1;
    if (changesArtifactType) {
      const room = await ctx.db.query("collaborationRooms")
        .withIndex("by_artifact_partition", (q) =>
          q.eq("artifactId", args.workId).eq("partitionKey", "root"),
        )
        .unique();
      if (room) {
        const [updates, snapshots] = await Promise.all([
          ctx.db.query("collaborationUpdates")
            .withIndex("by_room_sequence", (q) => q.eq("roomId", room._id))
            .collect(),
          ctx.db.query("collaborationSnapshots")
            .withIndex("by_room_sequence", (q) => q.eq("roomId", room._id))
            .collect(),
        ]);
        await Promise.all([
          ...updates.map((update) => ctx.db.delete(update._id)),
          ...snapshots.map((snapshot) => ctx.db.delete(snapshot._id)),
        ]);
        const policyVersion = await bumpPolicyVersion(
          ctx,
          "artifact",
          work._id,
          work.schoolId,
          actor.accountId,
        );
        await ctx.db.patch(room._id, {
          typeKey: nextBlueprintKey,
          schemaVersion: nextSchemaVersion,
          policyVersion,
          nextSequence: 1,
          snapshotSequence: 0,
          uncompactedBytes: 0,
          updatedAt: now,
        });
      }
    }
    await ctx.db.patch(args.workId, {
      blueprintKey: nextBlueprintKey,
      resourceClass: "artifact",
      nativeFormat: input.nativeFormat,
      compatibilityProfile: "strict-native",
      content: args.content,
      schemaVersion: nextSchemaVersion,
      contentHash: input.semanticDigest,
      syncState: changesArtifactType ? "synchronizing" : work.syncState,
      liveStateVectorHash: changesArtifactType
        ? undefined
        : work.liveStateVectorHash,
      lastSynchronizedAt: changesArtifactType
        ? undefined
        : work.lastSynchronizedAt,
      textIndex: input.textIndex ?? (Array.isArray(args.content?.blocks)
        ? args.content.blocks.map((block: { text?: unknown }) => typeof block?.text === "string" ? block.text : "").join("\n").slice(0, 200_000)
        : work.textIndex),
      updatedAt: now,
    });
    await ctx.db.patch(cloud._id, {
      fidelityMap: args.fidelityMap,
      projectionBasePayloadRef: cloud.payloadRef,
      projectionBaseRevision: cloud.revision,
      projectionBaseContent: args.content,
      projectionBaseContentHash: input.semanticDigest,
      projectionBaseTextIndex: input.textIndex,
      projectionBaseFidelityMap: args.fidelityMap,
      preservedCarryVersion: 1,
      compatibilityProfile: "strict-native",
      updatedAt: now,
    });
    const matchingLocals = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local"))
      .take(50);
    await retireSupersededExternalOperations(ctx, {
      workId: args.workId,
      replicaRevisions: matchingLocals.map((replica) => ({
        replicaId: replica._id,
        revision: replica.revision,
      })),
      now,
    });
    await Promise.all(matchingLocals
      .filter((replica) => replica.contentHash === input.payloadHash && replica.payloadRef)
      .map((replica) => ctx.db.patch(replica._id, {
        projectionBasePayloadRef: replica.payloadRef,
        projectionBaseRevision: replica.revision,
        projectionBaseContent: args.content,
        projectionBaseContentHash: input.semanticDigest,
        projectionBaseTextIndex: input.textIndex,
        projectionBaseFidelityMap: args.fidelityMap,
        updatedAt: now,
      })));
    return { activated: true, workId: args.workId };
  },
});

export const queueMaterialization = mutation({
  args: queueMaterializationArgs,
  handler: async (): Promise<Awaited<ReturnType<typeof queueMaterializationInTransaction>>> => {
    throw new Error("NATIVE_SIGNED_MATERIALIZATION_REQUIRED");
  },
});

/** Commit a verified native package for work without an available local target.
 * Yjs remains the authored-content authority; only the native replica advances. */
export const commitCloudMaterialization = mutation({
  args: commitCloudMaterializationArgs,
  handler: async (): Promise<Awaited<ReturnType<typeof commitCloudMaterializationInTransaction>>> => {
    throw new Error("NATIVE_SIGNED_MATERIALIZATION_REQUIRED");
  },
});

export const discardProtectedPending = mutation({
  args: { workId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const locals = await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local")).take(20);
    const changed = locals.filter((replica) => replica.pendingPayloadRef).length;
    if (changed && (work.protectedBaseContent === undefined || !work.protectedBaseContentHash))
      throw new Error("PROTECTED_BASE_SNAPSHOT_MISSING");
    await Promise.all(locals.filter((replica) => replica.pendingPayloadRef).map((replica) => ctx.db.patch(replica._id, {
      pendingPayloadRef: undefined,
      pendingContentHash: undefined,
      pendingBaseRevision: undefined,
      protectedOriginal: true,
      state: "current",
      updatedAt: Date.now(),
    })));
    const pendingOperations = await ctx.db.query("syncOperations")
      .withIndex("by_work_created", (q) => q.eq("workId", args.workId))
      .order("desc")
      .take(50);
    await Promise.all(pendingOperations.filter((operation) => operation.errorCode === "protected-original-pending" && operation.state === "applied").map((operation) =>
      ctx.db.patch(operation._id, { state: "failed", errorCode: "protected-original-discarded", updatedAt: Date.now() }),
    ));
    if (changed) {
      await ctx.db.patch(args.workId, {
        content: work.protectedBaseContent,
        contentHash: work.protectedBaseContentHash,
        textIndex: work.protectedBaseTextIndex,
        pendingPayloadRef: undefined,
        pendingContentHash: undefined,
        pendingBaseRevision: undefined,
        protectedBaseContent: undefined,
        protectedBaseContentHash: undefined,
        protectedBaseTextIndex: undefined,
        protectedOriginal: true,
        updatedAt: Date.now(),
      });
    }
    return { discarded: changed };
  },
});

export const applyProtectedPending = mutation({
  args: { workId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const local = (await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local")).take(20))
      .find((replica) => replica.pendingPayloadRef);
    if (!local?.pendingPayloadRef || !local.pendingContentHash || !local.pendingBaseRevision || !local.deviceId || !local.mountId || !local.localResourceId || !local.relativePath)
      throw new Error("PROTECTED_PENDING_NOT_FOUND");
    const openConflict = await ctx.db.query("syncConflicts")
      .withIndex("by_work_account_state", (q) => q.eq("workId", args.workId).eq("accountId", actor.accountId).eq("state", "open"))
      .first();
    if (openConflict) throw new Error("PROTECTED_ORIGINAL_CONFLICT");
    const payloadId = ctx.db.normalizeId("payloadObjects", local.pendingPayloadRef);
    const payload = payloadId ? await ctx.db.get(payloadId) : null;
    if (!payload || payload.accountId !== actor.accountId || payload.state !== "active" || payload.hash !== local.pendingContentHash)
      throw new Error("PROTECTED_PENDING_PAYLOAD_INVALID");
    if (work.protectedBaseContent === undefined || !work.protectedBaseContentHash)
      throw new Error("PROTECTED_BASE_SNAPSHOT_MISSING");
    const idempotencyKey = await deriveSyncIdempotencyKey({
      workId: String(args.workId),
      target: localMaterializationTarget(String(local.mountId), local.relativePath),
      baseRevision: local.pendingBaseRevision,
      targetRevision: local.pendingContentHash,
      direction: "cloud-to-local",
    });
    const existing = await bridgeWriteForTarget(ctx, {
      accountId: actor.accountId,
      idempotencyKey,
      replicaId: local._id,
      workId: args.workId,
      baseRevision: local.pendingBaseRevision,
      targetRevision: local.pendingContentHash,
    });
    if (existing) return { requestId: existing._id, state: existing.state };
    const [mount, device] = await Promise.all([ctx.db.get(local.mountId), ctx.db.get(local.deviceId)]);
    if (!activeReplicaWriteTarget(local, mount, device)) throw new Error("LOCAL_REPLICA_UNAVAILABLE");
    const now = Date.now();
    const requestId = await ctx.db.insert("bridgeWriteRequests", {
      accountId: actor.accountId, workId: args.workId, replicaId: local._id, deviceId: local.deviceId, mountId: local.mountId,
      localResourceId: local.localResourceId, relativePath: local.relativePath, payloadRef: local.pendingPayloadRef,
      baseRevision: local.pendingBaseRevision, targetRevision: local.pendingContentHash, contentHash: local.pendingContentHash,
      idempotencyKey, regionIds: [], partNames: [], projectionBaseContent: work.content,
      projectionBaseContentHash: work.contentHash, projectionBaseTextIndex: work.textIndex,
      projectionBaseFidelityMap: local.fidelityMap, state: "pending", retryAt: now, attemptCount: 0,
      expiresAt: now + BRIDGE_WRITE_EXPIRES_MS, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(local._id, { state: "pending", updatedAt: now });
    await ctx.db.insert("syncOperations", {
      accountId: actor.accountId, workId: args.workId, replicaId: local._id, idempotencyKey,
      direction: "cloud-to-local", revisionBefore: local.pendingBaseRevision, revisionAfter: local.pendingContentHash,
      state: "pending", actorKind: "user", errorCode: "protected-original-apply-pending", createdAt: now, updatedAt: now,
    });
    return { requestId, state: "pending" as const };
  },
});

export const forkProtectedPending = mutation({
  args: { workId: v.id("spectraArtifacts"), title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const local = (await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local")).take(20))
      .find((replica) => replica.pendingPayloadRef);
    if (!local?.pendingPayloadRef || !local.pendingContentHash) throw new Error("PROTECTED_PENDING_NOT_FOUND");
    const payloadId = ctx.db.normalizeId("payloadObjects", local.pendingPayloadRef);
    const payload = payloadId ? await ctx.db.get(payloadId) : null;
    if (!payload || payload.accountId !== actor.accountId || payload.state !== "active" || payload.hash !== local.pendingContentHash)
      throw new Error("PROTECTED_PENDING_PAYLOAD_INVALID");
    const now = Date.now();
    const title = (args.title?.trim() || `${work.title} copy`).slice(0, 240);
    const forkId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor.accountId, schoolId: work.schoolId, blueprintKey: work.blueprintKey,
      resourceClass: work.resourceClass, nativeFormat: work.nativeFormat, compatibilityProfile: work.compatibilityProfile,
      title, summary: work.summary, content: work.content, schemaVersion: work.schemaVersion,
      contentHash: work.contentHash, textIndex: work.textIndex, tags: work.tags, status: "active",
      createdFrom: { source: "manual", sourceArtifactIds: [args.workId] }, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("workReplicas", {
      accountId: actor.accountId, workId: forkId, kind: "cloud", nativeFormat: local.nativeFormat,
      payloadRef: local.pendingPayloadRef, revision: local.pendingContentHash, contentHash: local.pendingContentHash,
      baseRevision: local.pendingBaseRevision, state: "current", lastVerifiedAt: now, updatedAt: now,
    });
    await ctx.db.patch(local._id, {
      pendingPayloadRef: undefined,
      pendingContentHash: undefined,
      pendingBaseRevision: undefined,
      state: "current",
      protectedOriginal: true,
      updatedAt: now,
    });
    await ctx.db.patch(args.workId, {
      content: work.protectedBaseContent,
      contentHash: work.protectedBaseContentHash,
      textIndex: work.protectedBaseTextIndex,
      pendingPayloadRef: undefined,
      pendingContentHash: undefined,
      pendingBaseRevision: undefined,
      protectedBaseContent: undefined,
      protectedBaseContentHash: undefined,
      protectedBaseTextIndex: undefined,
      protectedOriginal: true,
      updatedAt: now,
    });
    const pendingOperations = await ctx.db.query("syncOperations")
      .withIndex("by_work_created", (q) => q.eq("workId", args.workId))
      .order("desc")
      .take(50);
    await Promise.all(pendingOperations
      .filter((operation) => operation.errorCode === "protected-original-pending" && operation.state === "applied")
      .map((operation) => ctx.db.patch(operation._id, {
        state: "verified",
        errorCode: "protected-original-forked",
        updatedAt: now,
      })));
    if (work.schoolId) {
      await placeSourceNode(ctx, { accountId: actor.accountId, schoolId: work.schoolId, kind: "work", sourceId: String(forkId), name: title, target: {}, placedByAccountId: actor.accountId, typeKey: work.blueprintKey });
    }
    return { forked: true as const, workId: forkId };
  },
});

export const createLocalReplica = mutation({
  args: {
    workId: v.id("spectraArtifacts"),
    mountId: v.id("bridgeMounts"),
    relativePath: v.string(),
    payloadRef: v.string(),
    contentHash: v.string(),
    nativeFormat: v.string(),
    fidelityMap: v.any(),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const input = z.object({
      relativePath: z.string().trim().min(1).max(1024)
        .refine((value) => !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes("..")),
      payloadRef: z.string().min(1),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      nativeFormat: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/),
    }).parse(args);
    const work = await ctx.db.get(args.workId);
    const mount = await ctx.db.get(args.mountId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const device = mount ? await ctx.db.get(mount.deviceId) : null;
    if (!mount || mount.accountId !== actor.accountId || mount.state !== "active" || !device || device.accountId !== actor.accountId || device.state !== "active") throw new Error("MOUNT_NOT_ACTIVE");
    const payloadId = ctx.db.normalizeId("payloadObjects", input.payloadRef);
    const payload = payloadId ? await ctx.db.get(payloadId) : null;
    if (!payload || payload.accountId !== actor.accountId || payload.state !== "active" || payload.hash !== input.contentHash) throw new Error("MATERIALIZATION_PAYLOAD_INVALID");
    const locals = await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local")).take(20);
    const existing = locals.find((candidate) => candidate.mountId === mount._id && candidate.relativePath === input.relativePath);
    if (mount.selectedFile && (!existing || input.relativePath !== mount.selectedFile))
      throw new Error("Choose a synced folder to save a new file on this computer.");
    if (existing?.state === "current" && existing.contentHash === input.contentHash)
      return { state: "existing" as const, replicaId: existing._id, requestId: null };
    if (existing) {
      const activeRequest = (await ctx.db.query("bridgeWriteRequests").withIndex("by_work_created", (q) => q.eq("workId", args.workId)).order("desc").take(50))
        .find((request) => request.replicaId === existing._id && (request.state === "pending" || request.state === "claimed") && request.contentHash === input.contentHash);
      if (activeRequest) return { state: "pending" as const, replicaId: existing._id, requestId: activeRequest._id };
    }
    const now = Date.now();
    const localResourceId = existing?.localResourceId ?? `lr_${crypto.randomUUID().replaceAll("-", "")}`;
    const replicaId = existing?._id ?? await ctx.db.insert("workReplicas", {
      accountId: actor.accountId, workId: args.workId, kind: "local", deviceId: mount.deviceId, mountId: mount._id,
      localResourceId, relativePath: input.relativePath,
      nativeFormat: input.nativeFormat, revision: `new:${input.contentHash}`, state: "pending",
      fidelityMap: args.fidelityMap, preservedCarryVersion: 1, compatibilityProfile: work.compatibilityProfile ?? "strict-native",
      updatedAt: now,
    });
    if (existing) await ctx.db.patch(existing._id, {
      deviceId: mount.deviceId, mountId: mount._id, localResourceId, relativePath: input.relativePath,
      nativeFormat: input.nativeFormat, state: "pending", unavailableReason: undefined, errorCode: undefined, errorMessage: undefined, errorAt: undefined,
      fidelityMap: args.fidelityMap, preservedCarryVersion: 1, compatibilityProfile: work.compatibilityProfile ?? "strict-native", updatedAt: now,
    });
    const baseRevision = existing?.revision ?? `new:${args.workId}`;
    const idempotencyKey = await deriveSyncIdempotencyKey({
      workId: String(args.workId),
      target: localMaterializationTarget(String(mount._id), input.relativePath),
      baseRevision,
      targetRevision: input.contentHash,
      direction: "cloud-to-local",
    });
    const requestId = await ctx.db.insert("bridgeWriteRequests", {
      accountId: actor.accountId, workId: args.workId, replicaId, deviceId: mount.deviceId, mountId: mount._id,
      localResourceId, relativePath: input.relativePath, payloadRef: input.payloadRef,
      baseRevision, targetRevision: input.contentHash, contentHash: input.contentHash, idempotencyKey,
      regionIds: [], partNames: [], projectionBaseContent: work.content,
      projectionBaseContentHash: work.contentHash, projectionBaseTextIndex: work.textIndex,
      projectionBaseFidelityMap: args.fidelityMap, state: "pending", retryAt: now, attemptCount: 0,
      expiresAt: now + BRIDGE_WRITE_EXPIRES_MS, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("syncOperations", { accountId: actor.accountId, workId: args.workId, replicaId, idempotencyKey, direction: "cloud-to-local", revisionBefore: baseRevision, revisionAfter: input.contentHash, state: "pending", actorKind: "restore", createdAt: now, updatedAt: now });
    return { state: "pending" as const, replicaId, requestId };
  },
});

export const attachPortablePayload = mutation({
  args: {
    workId: v.id("spectraArtifacts"),
    payloadRef: v.string(),
    contentHash: v.string(),
    nativeFormat: v.string(),
    projectionBaseContent: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const input = z.object({
      payloadRef: z.string().min(1),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      nativeFormat: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/),
    }).parse(args);
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const payloadId = ctx.db.normalizeId("payloadObjects", input.payloadRef);
    const payload = payloadId ? await ctx.db.get(payloadId) : null;
    if (!payload || payload.accountId !== actor.accountId || payload.state !== "active" || payload.hash !== input.contentHash) throw new Error("PORTABLE_PAYLOAD_INVALID");
    await validateContentAdoption(ctx, args.workId, actor.accountId, args.projectionBaseContent);
    const baseContent = args.projectionBaseContent ?? work.content;
    const baseContentHash = args.projectionBaseContent === undefined ? work.contentHash : await deriveProjectionSnapshotHash(baseContent);
    const now = Date.now();
    const cloud = await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "cloud")).first();
    if (cloud) {
      if (cloud.payloadRef === input.payloadRef && cloud.contentHash === input.contentHash)
        return { state: "existing" as const, replicaId: cloud._id };
      if (cloud.payloadRef && cloud.contentHash && cloud.contentHash !== input.contentHash) {
        const existingConflict = await ctx.db.query("syncConflicts")
          .withIndex("by_work_account_state", (q) => q.eq("workId", args.workId).eq("accountId", actor.accountId).eq("state", "open"))
          .filter((q) => q.and(q.eq(q.field("localRevision"), input.contentHash), q.eq(q.field("spectraRevision"), cloud.revision)))
          .first();
        if (!existingConflict) await ctx.db.insert("syncConflicts", {
          accountId: actor.accountId,
          workId: args.workId,
          replicaIds: [cloud._id],
          regionIds: [],
          partNames: [],
          localRevision: input.contentHash,
          spectraRevision: cloud.revision,
          localPayloadRef: input.payloadRef,
          spectraPayloadRef: cloud.payloadRef,
          state: "open",
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.patch(cloud._id, { state: "diverged", updatedAt: now });
        return { state: "conflicted" as const, replicaId: cloud._id };
      }
      await ctx.db.patch(cloud._id, {
        payloadRef: input.payloadRef,
        baseRevision: cloud.revision,
        revision: input.contentHash,
        contentHash: input.contentHash,
        nativeFormat: input.nativeFormat,
        projectionBasePayloadRef: input.payloadRef,
        projectionBaseRevision: input.contentHash,
        projectionBaseContent: baseContent,
        projectionBaseContentHash: baseContentHash,
        projectionBaseTextIndex: work.textIndex,
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now,
      });
      return { state: "attached" as const, replicaId: cloud._id };
    }
    const replicaId = await ctx.db.insert("workReplicas", { accountId: actor.accountId, workId: args.workId, kind: "cloud", payloadRef: input.payloadRef, nativeFormat: input.nativeFormat, revision: input.contentHash, contentHash: input.contentHash, projectionBasePayloadRef: input.payloadRef, projectionBaseRevision: input.contentHash, projectionBaseContent: baseContent, projectionBaseContentHash: baseContentHash, projectionBaseTextIndex: work.textIndex, state: "current", lastVerifiedAt: now, updatedAt: now });
    return { state: "attached" as const, replicaId };
  },
});

export const recordExternalReconciliation = mutation({
  args: externalReconciliationArgs,
  handler: recordExternalConflict,
});

export const resolveExternalConflict = mutation({
  args: {
    workId: v.id("spectraArtifacts"),
    resolution: v.union(v.literal("local"), v.literal("spectra"), v.literal("keep-both")),
    title: v.optional(v.string()),
    requestId: v.optional(v.id("bridgeWriteRequests")),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId)
      throw new Error("WORK_NOT_FOUND");
    const conflicts = await ctx.db.query("syncConflicts")
      .withIndex("by_work_account_state", (q) => q.eq("workId", args.workId).eq("accountId", actor.accountId).eq("state", "open"))
      .take(20);
    const now = Date.now();
    if (!conflicts.length) return { resolved: 0, workId: null };
    const convergedReplicaPair = async () => {
      const replicas = await ctx.db.query("workReplicas")
        .withIndex("by_work", (q) => q.eq("workId", args.workId))
        .take(50);
      const cloud = replicas.find((replica) => replica.kind === "cloud");
      const local = cloud?.contentHash
        ? replicas.find((replica) =>
            replica.kind === "local" &&
            replica.state === "current" &&
            replica.contentHash === cloud.contentHash,
          )
        : undefined;
      const cloudPayload = cloud
        ? await verifiedReplicaPayload(ctx, cloud)
        : null;
      const conflictsReferenceOnlyConvergedOrUnavailableLocals =
        conflicts.every((conflict) => {
          const localReplicaIds = conflict.replicaIds.filter((replicaId) => {
            const replica = replicas.find((candidate) => candidate._id === replicaId);
            return !replica || replica.kind === "local";
          });
          return localReplicaIds.length > 0 && localReplicaIds.every((replicaId) => {
            const replica = replicas.find((candidate) => candidate._id === replicaId);
            return Boolean(
              replica &&
              replica.kind === "local" &&
              (replica.state === "unavailable" ||
                (replica.state === "current" &&
                  replica.contentHash === cloud?.contentHash)),
            );
          });
        });
      return {
        cloud,
        local,
        replicas,
        safe: Boolean(
          cloud?.state === "current" &&
          cloud.contentHash &&
          cloudPayload &&
          local &&
          conflictsReferenceOnlyConvergedOrUnavailableLocals,
        ),
      };
    };
    if (args.resolution === "local") {
      const pair = await convergedReplicaPair();
      if (pair.safe && pair.local && pair.cloud?.contentHash) {
        await Promise.all([
          ...conflicts.map((conflict) => ctx.db.patch(conflict._id, {
            state: "resolved-local",
            resolvedAt: now,
            updatedAt: now,
          })),
          pair.local.state !== "current"
            ? ctx.db.patch(pair.local._id, { state: "current", updatedAt: now })
            : Promise.resolve(),
          pair.cloud.state !== "current"
            ? ctx.db.patch(pair.cloud._id, { state: "current", updatedAt: now })
            : Promise.resolve(),
        ]);
        await verifyReconciledExternalOperations(ctx, {
          workId: args.workId,
          replicaId: pair.local._id,
          revision: pair.cloud.contentHash,
          now,
        });
        return { resolved: conflicts.length, workId: null };
      }
      throw new Error("CONFLICT_RECONCILIATION_REQUIRED");
    }
    if (args.resolution === "spectra") {
      const requests = (args.requestId
        ? [await ctx.db.get(args.requestId)]
        : await ctx.db.query("bridgeWriteRequests")
        .withIndex("by_work_created", (q) => q.eq("workId", args.workId))
        .order("desc")
        .take(50)).filter((candidate): candidate is Doc<"bridgeWriteRequests"> =>
          candidate !== null && candidate.accountId === actor.accountId && candidate.workId === args.workId);
      const bound = args.requestId
        ? requests.find((candidate) => candidate._id === args.requestId)
        : undefined;
      // Keep Spectra is one choice for the whole conflict bar. Bind the write
      // the route just queued; do not require that write's region list to be a
      // superset of every historically unioned open-conflict region id.
      const request =
        bound &&
        bound.accountId === actor.accountId &&
        (bound.state === "pending" || bound.state === "claimed")
          ? bound
          : requests.find((candidate) =>
              (candidate.state === "pending" || candidate.state === "claimed") &&
              conflicts.some((conflict) =>
                conflict.regionIds.length === 0 ||
                conflict.regionIds.some((regionId) => candidate.regionIds.includes(regionId)) ||
                candidate.regionIds.some((regionId) => conflict.regionIds.includes(regionId)),
              ),
            );
      if (!request) {
        const pair = await convergedReplicaPair();
        if (pair.safe && pair.local && pair.cloud?.contentHash) {
          await Promise.all([
            ...conflicts.map((conflict) => ctx.db.patch(conflict._id, {
              state: "resolved-spectra",
              resolvedAt: now,
              updatedAt: now,
            })),
            pair.local.state !== "current"
              ? ctx.db.patch(pair.local._id, { state: "current", updatedAt: now })
              : Promise.resolve(),
            pair.cloud.state !== "current"
              ? ctx.db.patch(pair.cloud._id, { state: "current", updatedAt: now })
              : Promise.resolve(),
          ]);
          await verifyReconciledExternalOperations(ctx, {
            workId: args.workId,
            replicaId: pair.local._id,
            revision: pair.cloud.contentHash,
            now,
          });
          return { resolved: conflicts.length, workId: null };
        }
        throw new Error("CONFLICT_RESOLUTION_WRITE_REQUIRED");
      }
      await Promise.all(conflicts.map((conflict) => ctx.db.patch(conflict._id, {
        state: "resolving-spectra",
        resolutionRequestId: request._id,
        errorCode: undefined,
        updatedAt: now,
      })));
      return { resolved: 0, workId: null, requestId: request._id };
    }
    const replicas = await ctx.db.query("workReplicas").withIndex("by_work", (q) => q.eq("workId", args.workId)).take(50);
    const local = replicas.find((replica) => replica.kind === "local" && conflicts.some((conflict) => conflict.localRevision === replica.revision));
    const cloud = replicas.find((replica) => replica.kind === "cloud");
    if (!local?.payloadRef || !local.contentHash || !cloud?.payloadRef || !cloud.contentHash)
      throw new Error("CONFLICT_KEEP_BOTH_PAYLOADS_REQUIRED");
    const localPayloadId = ctx.db.normalizeId("payloadObjects", local.payloadRef);
    const localPayload = localPayloadId ? await ctx.db.get(localPayloadId) : null;
    if (!localPayload || localPayload.state !== "active" || localPayload.hash !== local.contentHash)
      throw new Error("CONFLICT_LOCAL_PAYLOAD_UNVERIFIED");
    const cloudPayloadId = ctx.db.normalizeId("payloadObjects", cloud.payloadRef);
    const cloudPayload = cloudPayloadId ? await ctx.db.get(cloudPayloadId) : null;
    if (!cloudPayload || cloudPayload.state !== "active" || cloudPayload.hash !== cloud.contentHash)
      throw new Error("CONFLICT_SPECTRA_PAYLOAD_UNVERIFIED");
    const activeWrites = await ctx.db.query("bridgeWriteRequests")
      .withIndex("by_work_created", (q) => q.eq("workId", args.workId))
      .order("desc")
      .take(50);
    if (activeWrites.some((request) => request.state === "pending" || request.state === "claimed"))
      throw new Error("CONFLICT_ACTIVE_WRITE");
    const forkTitle = (args.title?.trim() || `${work.title} external copy`).slice(0, 240);
    const forkId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor.accountId,
      schoolId: work.schoolId,
      blueprintKey: "resource",
      resourceClass: "resource",
      nativeFormat: local.nativeFormat,
      compatibilityProfile: local.compatibilityProfile ?? work.compatibilityProfile,
      title: forkTitle,
      content: null,
      schemaVersion: 1,
      contentHash: local.contentHash,
      textIndex: undefined,
      tags: work.tags,
      status: "active",
      createdFrom: { source: "artifact", sourceArtifactIds: [args.workId] },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(local._id, { workId: forkId, baseRevision: local.revision, state: "current", lastVerifiedAt: now, updatedAt: now });
    await ctx.db.insert("workReplicas", { accountId: actor.accountId, workId: forkId, kind: "cloud", nativeFormat: local.nativeFormat, payloadRef: local.payloadRef, revision: local.revision, baseRevision: local.revision, contentHash: local.contentHash, state: "current", lastVerifiedAt: now, updatedAt: now });
    await ctx.db.patch(cloud._id, { state: "current", lastVerifiedAt: now, updatedAt: now });
    await Promise.all(conflicts.map((conflict) => ctx.db.patch(conflict._id, { state: "forked", forkedWorkId: forkId, resolvedAt: now, updatedAt: now })));
    if (work.schoolId) await placeSourceNode(ctx, { accountId: actor.accountId, schoolId: work.schoolId, kind: "work", sourceId: String(forkId), name: forkTitle, target: {}, placedByAccountId: actor.accountId, typeKey: "resource" });
    return { resolved: conflicts.length, workId: forkId };
  },
});

async function verifiedReplicaPayload(
  ctx: MutationCtx,
  replica: Doc<"workReplicas">,
) {
  if (!replica.payloadRef || !replica.contentHash) return null;
  const payloadId = ctx.db.normalizeId("payloadObjects", replica.payloadRef);
  const payload = payloadId ? await ctx.db.get(payloadId) : null;
  return payload?.state === "active" && payload.hash === replica.contentHash
    ? payload
    : null;
}

async function payloadForHash(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  hash: string | undefined,
) {
  if (!hash) return null;
  const payload = await ctx.db.query("payloadObjects")
    .withIndex("by_account_hash", (q) => q.eq("accountId", accountId).eq("hash", hash))
    .unique();
  return payload?.state === "active" ? payload : null;
}

async function verifiedReplicaRevision(
  ctx: MutationCtx,
  replica: Doc<"workReplicas">,
) {
  const payload = await verifiedReplicaPayload(ctx, replica);
  if (payload) return payload.hash;
  // Metadata-only local replicas deliberately have no cloud payload object.
  // A revision reported by the Bridge and timestamped at read-back is still
  // byte evidence; cloud rows never get this fallback.
  if (replica.kind === "local" && replica.contentHash && replica.lastVerifiedAt)
    return replica.contentHash;
  return null;
}

async function restoreTransitionPolicy(
  ctx: MutationCtx,
  transition: Doc<"storageStrategyTransitions">,
  now: number,
) {
  const before = transition.before as {
    hadItemPolicy?: boolean;
    policy?: typeof POLICY_PRESETS.spectra;
  };
  const policy = await ctx.db.query("syncPolicies")
    .withIndex("by_account_scope", (q) => q.eq("accountId", transition.accountId).eq("scopeKind", "item").eq("scopeId", String(transition.workId)))
    .unique();
  if (policy && before.hadItemPolicy && before.policy)
    await ctx.db.patch(policy._id, { ...before.policy, updatedAt: now });
  else if (policy) await ctx.db.delete(policy._id);
}


async function failWriteRequest(
  ctx: MutationCtx,
  request: Doc<"bridgeWriteRequests">,
  errorCode: string,
  now: number,
) {
  await ctx.db.patch(request._id, {
    state: "failed",
    errorCode,
    errorMessage: "The save did not finish. Try again.",
    claimedAt: undefined,
    updatedAt: now,
  });
  const operation = await syncOperationForBridgeWrite(ctx, request);
  if (operation) await ctx.db.patch(operation._id, { state: "failed", errorCode, updatedAt: now });
  const replica = await ctx.db.get(request.replicaId);
  if (replica?.state === "pending") await ctx.db.patch(replica._id, { state: "error", errorCode, errorAt: now, updatedAt: now });
}

/** Indexed compensation for actor death, expired transitions and unreferenced bytes.
 * One invocation stays inside the scheduled 100-document / 128 KB gate; leftover
 * due rows wait for the next tick instead of scanning the whole table. */
export const SWEEP_DOCUMENT_BUDGET = 100;

type SweepDocumentBudget = ReturnType<typeof createDocumentBudget>;

async function payloadHasRemainingRefs(
  ctx: MutationCtx,
  payloadRef: string,
  budget: SweepDocumentBudget,
) {
  const probes = [
    // Newer writers already maintain compact payload ownership. A positive
    // match avoids reopening a replica's large Office projection on every
    // sweep. Missing legacy ownership still goes through the full probes.
    () =>
      ctx.db
        .query("collaborationPayloadOwners")
        .withIndex("by_payload", (q) => q.eq("payloadRef", payloadRef))
        .take(budget.cap(1)),
    () =>
      ctx.db
        .query("workReplicas")
        .withIndex("by_payload_ref", (q) => q.eq("payloadRef", payloadRef))
        .take(budget.cap(1)),
    () =>
      ctx.db
        .query("workReplicas")
        .withIndex("by_pending_payload_ref", (q) =>
          q.eq("pendingPayloadRef", payloadRef),
        )
        .take(budget.cap(1)),
    () =>
      ctx.db
        .query("workReplicas")
        .withIndex("by_projection_base_payload_ref", (q) =>
          q.eq("projectionBasePayloadRef", payloadRef),
        )
        .take(budget.cap(1)),
    () =>
      ctx.db
        .query("spectraArtifacts")
        .withIndex("by_pending_payload_ref", (q) =>
          q.eq("pendingPayloadRef", payloadRef),
        )
        .take(budget.cap(1)),
    () =>
      ctx.db
        .query("bridgeWriteRequests")
        .withIndex("by_payload_state", (q) =>
          q.eq("payloadRef", payloadRef).eq("state", "pending"),
        )
        .take(budget.cap(1)),
    () =>
      ctx.db
        .query("bridgeWriteRequests")
        .withIndex("by_payload_state", (q) =>
          q.eq("payloadRef", payloadRef).eq("state", "claimed"),
        )
        .take(budget.cap(1)),
    () =>
      ctx.db
        .query("syncConflicts")
        .withIndex("by_local_payload_ref", (q) =>
          q.eq("localPayloadRef", payloadRef),
        )
        .filter((q) =>
          q.or(
            q.eq(q.field("state"), "open"),
            q.eq(q.field("state"), "resolving-spectra"),
          ),
        )
        .take(budget.cap(1)),
    () =>
      ctx.db
        .query("syncConflicts")
        .withIndex("by_spectra_payload_ref", (q) =>
          q.eq("spectraPayloadRef", payloadRef),
        )
        .filter((q) =>
          q.or(
            q.eq(q.field("state"), "open"),
            q.eq(q.field("state"), "resolving-spectra"),
          ),
        )
        .take(budget.cap(1)),
  ];
  for (const probe of probes) {
    if (budget.exhausted()) return true;
    const rows = await probe();
    budget.note(rows.length);
    if (rows.length > 0) return true;
  }
  return false;
}

function createDocumentBudget(limit = SWEEP_DOCUMENT_BUDGET) {
  let remaining = limit;
  return {
    cap(requested: number) {
      return Math.max(0, Math.min(requested, remaining));
    },
    note(count: number) {
      remaining = Math.max(0, remaining - count);
    },
    remaining() {
      return remaining;
    },
    exhausted() {
      return remaining <= 0;
    },
  };
}

export const sweepReplicaTruth = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await platformStopped(ctx, "background"))
      return { redriven: 0, failedWrites: 0, orphanedReplicas: 0, orphanedOperations: 0, expiredExternalOperations: 0, failedTransitions: 0, verifiedTransitions: 0, reopenedConflicts: 0, abandonedConflicts: 0, releasedPayloads: 0, documentsRead: 0 };
    const now = Date.now();
    const budget = createDocumentBudget();
    const claimCutoff = now - BRIDGE_CLAIM_REDRIVE_MS;
    const claimedLimit = budget.cap(100);
    const claimed = claimedLimit
      ? await ctx.db.query("bridgeWriteRequests")
          .withIndex("by_state_updated", (q) => q.eq("state", "claimed").lt("updatedAt", claimCutoff))
          .take(claimedLimit)
      : [];
    budget.note(claimed.length);
    let redriven = 0;
    let failedWrites = 0;
    for (const request of claimed) {
      if ((request.expiresAt ?? request.createdAt + BRIDGE_WRITE_EXPIRES_MS) <= now) {
        await failWriteRequest(ctx, request, "write-expired", now);
        failedWrites += 1;
      } else {
        await ctx.db.patch(request._id, { state: "pending", claimedAt: undefined, updatedAt: now });
        redriven += 1;
      }
    }
    const pendingLimit = budget.cap(100);
    const pending = pendingLimit
      ? await ctx.db.query("bridgeWriteRequests")
          .withIndex("by_state_updated", (q) => q.eq("state", "pending").lt("updatedAt", now))
          .take(pendingLimit)
      : [];
    budget.note(pending.length);
    for (const request of pending) {
      if ((request.expiresAt ?? request.createdAt + BRIDGE_WRITE_EXPIRES_MS) > now) continue;
      await failWriteRequest(ctx, request, "write-expired", now);
      failedWrites += 1;
    }

    const orphanCutoff = now - BRIDGE_WRITE_EXPIRES_MS;
    const pendingReplicaLimit = budget.cap(100);
    const pendingReplicas = pendingReplicaLimit
      ? await ctx.db.query("workReplicas")
          .withIndex("by_state_updated", (q) => q.eq("state", "pending").lt("updatedAt", orphanCutoff))
          .take(pendingReplicaLimit)
      : [];
    budget.note(pendingReplicas.length);
    let orphanedReplicas = 0;
    for (const replica of pendingReplicas) {
      const requestLimit = budget.cap(50);
      const requests = requestLimit
        ? await ctx.db.query("bridgeWriteRequests")
            .withIndex("by_work_created", (q) => q.eq("workId", replica.workId))
            .order("desc")
            .take(requestLimit)
        : [];
      budget.note(requests.length);
      if (requests.some((request) => request.replicaId === replica._id && (request.state === "pending" || request.state === "claimed"))) continue;
      await ctx.db.patch(replica._id, {
        state: "error",
        errorCode: "orphaned-pending-replica",
        errorAt: now,
        updatedAt: now,
      });
      orphanedReplicas += 1;
    }
    const pendingOperationLimit = budget.cap(100);
    const pendingOperations = pendingOperationLimit
      ? await ctx.db.query("syncOperations")
          .withIndex("by_state_updated", (q) => q.eq("state", "pending").lt("updatedAt", orphanCutoff))
          .take(pendingOperationLimit)
      : [];
    budget.note(pendingOperations.length);
    let orphanedOperations = 0;
    for (const operation of pendingOperations) {
      const request = await bridgeWriteForSyncOperation(ctx, operation);
      if (request) budget.note(1);
      if (request && (request.state === "pending" || request.state === "claimed")) continue;
      await ctx.db.patch(operation._id, {
        state: "failed",
        errorCode: "orphaned-pending-operation",
        updatedAt: now,
      });
      orphanedOperations += 1;
    }

    const externalReconciliationCutoff = now - BRIDGE_WRITE_EXPIRES_MS;
    const stalledLimit = budget.cap(100);
    const stalledExternalOperations = stalledLimit
      ? await ctx.db.query("syncOperations")
          .withIndex("by_state_updated", (q) => q.eq("state", "applied").lt("updatedAt", externalReconciliationCutoff))
          .filter((q) => q.and(
            q.eq(q.field("direction"), "external"),
            q.eq(q.field("actorKind"), "external-edit"),
          ))
          .take(stalledLimit)
      : [];
    budget.note(stalledExternalOperations.length);
    for (const operation of stalledExternalOperations) {
      await ctx.db.patch(operation._id, {
        state: "failed",
        errorCode: "external-reconciliation-expired",
        updatedAt: now,
      });
    }
    const expiredExternalOperations = stalledExternalOperations.length;

    const transitionLimit = budget.cap(100);
    const transitions = transitionLimit
      ? await ctx.db.query("storageStrategyTransitions")
          .withIndex("by_state_updated", (q) => q.eq("state", "pending").lt("updatedAt", now))
          .take(transitionLimit)
      : [];
    budget.note(transitions.length);
    let failedTransitions = 0;
    let verifiedTransitions = 0;
    for (const transition of transitions) {
      if (transition.toPreset === "spectra" || transition.toPreset === "both") {
        const cloud = await ctx.db.query("workReplicas")
          .withIndex("by_work_kind", (q) => q.eq("workId", transition.workId).eq("kind", "cloud"))
          .unique();
        if (cloud) budget.note(1);
        const payload = cloud ? await verifiedReplicaPayload(ctx, cloud) : null;
        if (payload) {
          if (transition.toPreset === "spectra") {
            const localLimit = budget.cap(20);
            const locals = localLimit
              ? await ctx.db.query("workReplicas")
                  .withIndex("by_work_kind", (q) => q.eq("workId", transition.workId).eq("kind", "local"))
                  .take(localLimit)
              : [];
            budget.note(locals.length);
            for (const local of locals) {
              if (local.state === "unavailable") continue;
              await ctx.db.patch(local._id, {
                state: "unavailable",
                unavailableReason: "unlinked-by-user",
                protectedOriginal: undefined,
                updatedAt: now,
              });
            }
          }
          await ctx.db.patch(transition._id, {
            state: "verified",
            after: {
              ...(transition.after as Record<string, unknown> | undefined),
              cloudPayloadRef: String(payload._id),
              physicalLocalAction: transition.toPreset === "spectra" ? "leave-file-in-place" : "retain",
            },
            updatedAt: now,
          });
          verifiedTransitions += 1;
          continue;
        }
        const localLimit = budget.cap(20);
        const locals = localLimit
          ? await ctx.db.query("workReplicas")
              .withIndex("by_work_kind", (q) => q.eq("workId", transition.workId).eq("kind", "local"))
              .take(localLimit)
          : [];
        budget.note(locals.length);
        if (locals.some((local) => local.errorCode === "office-locked" && local.state !== "unavailable")) {
          continue;
        }
      }
      const requestId = ctx.db.normalizeId(
        "bridgeWriteRequests",
        String((transition.after as { materializationRequestId?: string } | undefined)?.materializationRequestId ?? ""),
      );
      const request = requestId ? await ctx.db.get(requestId) : null;
      if (request) budget.note(1);
      const liveWrite = request && (request.state === "pending" || request.state === "claimed");
      const stalled = (transition.updatedAt ?? transition.createdAt) + STRATEGY_TRANSITION_STALL_MS <= now;
      const expired = (transition.expiresAt ?? transition.createdAt + STRATEGY_TRANSITION_EXPIRES_MS) <= now;
      if (!expired && !(stalled && !liveWrite)) continue;
      await restoreTransitionPolicy(ctx, transition, now);
      if (liveWrite) await failWriteRequest(ctx, request, expired ? "strategy-transition-expired" : "strategy-transition-failed", now);
      await ctx.db.patch(transition._id, {
        state: "failed",
        errorCode: expired ? "strategy-transition-expired" : "strategy-transition-failed",
        updatedAt: now,
      });
      failedTransitions += 1;
    }

    const resolvingLimit = budget.cap(100);
    const resolving = resolvingLimit
      ? await ctx.db.query("syncConflicts")
          .withIndex("by_state_updated", (q) => q.eq("state", "resolving-spectra"))
          .take(resolvingLimit)
      : [];
    budget.note(resolving.length);
    let reopenedConflicts = 0;
    for (const conflict of resolving) {
      if ((conflict.updatedAt ?? conflict.createdAt) >= claimCutoff) continue;
      const request = conflict.resolutionRequestId ? await ctx.db.get(conflict.resolutionRequestId) : null;
      if (request) budget.note(1);
      if (request && (request.state === "pending" || request.state === "claimed")) continue;
      const work = await ctx.db.get(conflict.workId);
      if (work) budget.note(1);
      await ctx.db.patch(conflict._id, work
        ? { state: "open", resolutionRequestId: undefined, errorCode: "resolution-write-did-not-finish", updatedAt: now }
        : { state: "abandoned", resolutionRequestId: undefined, errorCode: "work-no-longer-exists", resolvedAt: now, updatedAt: now });
      reopenedConflicts += 1;
    }
    const openLimit = budget.cap(100);
    const openConflicts = openLimit
      ? await ctx.db.query("syncConflicts")
          .withIndex("by_state_updated", (q) => q.eq("state", "open"))
          .take(openLimit)
      : [];
    budget.note(openConflicts.length);
    let abandonedConflicts = 0;
    for (const conflict of openConflicts) {
      const work = await ctx.db.get(conflict.workId);
      if (work) {
        budget.note(1);
        continue;
      }
      budget.note(1);
      await ctx.db.patch(conflict._id, { state: "abandoned", errorCode: "work-no-longer-exists", resolvedAt: now, updatedAt: now });
      abandonedConflicts += 1;
    }

    const payloadLimit = budget.cap(100);
    const payloads = payloadLimit
      ? await ctx.db.query("payloadObjects")
          .withIndex("by_state_verified", (q) => q.eq("state", "active").lt("verifiedAt", now - PAYLOAD_RELEASE_GRACE_MS))
          .take(payloadLimit)
      : [];
    budget.note(payloads.length);
    let releasedPayloads = 0;
    for (const payload of payloads) {
      if (budget.exhausted()) break;
      const payloadRef = String(payload._id);
      const referenced = await payloadHasRemainingRefs(ctx, payloadRef, budget);
      if (referenced) continue;
      await ctx.db.patch(payload._id, { refCount: 0, state: "released", releasedAt: now });
      await deleteUnboundDurableStorage(ctx, payload.storageId);
      releasedPayloads += 1;
    }
    const repairs = { redriven, failedWrites, orphanedReplicas, orphanedOperations, expiredExternalOperations, failedTransitions, verifiedTransitions, reopenedConflicts, abandonedConflicts, releasedPayloads, documentsRead: SWEEP_DOCUMENT_BUDGET - budget.remaining() };
    if (Object.values(repairs).some((count) => count > 0))
      console.info("replica-truth-sweeper", repairs);
    return repairs;
  },
});

const OFFICE_NATIVE_FORMATS = new Set([
  "docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "xlam",
  "pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "ppam",
]);

async function reconcileWorkReplicaTruth(
  ctx: MutationCtx,
  work: Doc<"spectraArtifacts">,
) {
  const replicas = await ctx.db.query("workReplicas").withIndex("by_work", (q) => q.eq("workId", work._id)).take(100);
  const activeRequests = await ctx.db.query("bridgeWriteRequests")
    .withIndex("by_work_created", (q) => q.eq("workId", work._id))
    .order("desc")
    .take(50);
  if (activeRequests.some((request) => request.state === "pending" || request.state === "claimed"))
    return { repaired: 0, conflicts: 0 };
  const now = Date.now();
  const clouds = replicas.filter((replica) => replica.kind === "cloud").sort((left, right) => right.updatedAt - left.updatedAt);
  const locals = replicas.filter((replica) => replica.kind === "local");
  const linked = locals.length > 0 || OFFICE_NATIVE_FORMATS.has(work.nativeFormat ?? "") || work.resourceClass === "resource";
  let repaired = 0;
  let conflicts = 0;
  let cloud: Doc<"workReplicas"> | undefined = clouds[0];
  if (clouds.length > 1) {
    for (const duplicate of clouds.slice(1)) {
      if (duplicate.payloadRef && duplicate.contentHash && cloud?.contentHash !== duplicate.contentHash) {
        await ctx.db.insert("syncConflicts", { accountId: work.ownerAccountId, workId: work._id, replicaIds: cloud ? [cloud._id] : [], regionIds: [], partNames: [], localRevision: duplicate.revision, spectraRevision: cloud?.revision ?? "missing", localPayloadRef: duplicate.payloadRef, spectraPayloadRef: cloud?.payloadRef, state: "open", createdAt: now, updatedAt: now });
        conflicts += 1;
      }
      await ctx.db.delete(duplicate._id);
      repaired += 1;
    }
  }
  if (!cloud && !linked) {
    const revision = work.contentHash ?? String(work.currentVersionId ?? work._id);
    const cloudId = await ctx.db.insert("workReplicas", { accountId: work.ownerAccountId, workId: work._id, kind: "cloud", nativeFormat: work.nativeFormat ?? "spectra-native", revision, contentHash: work.contentHash, state: "current", lastVerifiedAt: now, updatedAt: now });
    cloud = await ctx.db.get(cloudId) ?? undefined;
    const key = await deriveSyncIdempotencyKey({ workId: String(work._id), target: "cloud", baseRevision: revision, targetRevision: revision, direction: "migration" });
    await ctx.db.insert("syncOperations", { accountId: work.ownerAccountId, workId: work._id, replicaId: cloudId, idempotencyKey: key, direction: "migration", revisionAfter: revision, state: "verified", actorKind: "migration", createdAt: now, updatedAt: now });
    return { repaired: repaired + 1, conflicts };
  }
  if (!cloud) {
    const evidence = await Promise.all(locals.map(async (local) => ({
      local,
      revision: await verifiedReplicaRevision(ctx, local),
    })));
    const verified = evidence.filter((entry): entry is typeof entry & { revision: string } => Boolean(entry.revision));
    const revisions = new Set(verified.map((entry) => entry.revision));
    for (const { local, revision } of evidence) {
      if (!revision) {
        await ctx.db.patch(local._id, { state: "error", errorCode: "replica-payload-unverified", errorAt: now, updatedAt: now });
      } else if (revisions.size > 1) {
        await ctx.db.patch(local._id, { revision, contentHash: revision, state: "diverged", lastVerifiedAt: now, updatedAt: now });
      } else {
        const policy = await computeEffectivePolicy(ctx, work.ownerAccountId, { account: String(work.ownerAccountId), mount: local.mountId ? String(local.mountId) : undefined, item: String(work._id) });
        await ctx.db.patch(local._id, { revision, contentHash: revision, state: policy.cloudContent === "full" ? "ahead" : "current", lastVerifiedAt: now, errorCode: undefined, errorMessage: undefined, errorAt: undefined, updatedAt: now });
      }
      repaired += 1;
    }
    const base = verified[0];
    if (base && revisions.size > 1) {
      for (const candidate of verified.slice(1).filter((entry) => entry.revision !== base.revision)) {
        const existing = await ctx.db.query("syncConflicts")
          .withIndex("by_work_state", (q) => q.eq("workId", work._id).eq("state", "open"))
          .filter((q) => q.and(q.eq(q.field("localRevision"), candidate.revision), q.eq(q.field("spectraRevision"), base.revision)))
          .first();
        if (!existing) {
          await ctx.db.insert("syncConflicts", {
            accountId: work.ownerAccountId,
            workId: work._id,
            replicaIds: [candidate.local._id, base.local._id],
            regionIds: [],
            partNames: [],
            localRevision: candidate.revision,
            spectraRevision: base.revision,
            localPayloadRef: candidate.local.payloadRef,
            spectraPayloadRef: base.local.payloadRef,
            state: "open",
            createdAt: now,
            updatedAt: now,
          });
          conflicts += 1;
        }
      }
    }
    return { repaired, conflicts };
  }
  const cloudRevision = await verifiedReplicaRevision(ctx, cloud);
  if (!locals.length) {
    await ctx.db.patch(cloud._id, cloudRevision || !linked
      ? { revision: cloudRevision ?? cloud.revision, contentHash: cloudRevision ?? cloud.contentHash, state: "current", lastVerifiedAt: now, errorCode: undefined, errorMessage: undefined, errorAt: undefined, updatedAt: now }
      : { state: "error", errorCode: "replica-payload-unverified", errorAt: now, updatedAt: now });
    return { repaired: repaired + 1, conflicts };
  }
  let cloudState: Doc<"workReplicas">["state"] = cloudRevision ? "current" : "behind";
  for (const local of locals) {
    const localRevision = await verifiedReplicaRevision(ctx, local);
    if (!localRevision) {
      await ctx.db.patch(local._id, { state: cloudRevision ? "behind" : "error", errorCode: cloudRevision ? undefined : "replica-payload-unverified", errorAt: cloudRevision ? undefined : now, updatedAt: now });
      if (cloudRevision) cloudState = "ahead";
      repaired += 1;
      continue;
    }
    if (!cloudRevision) {
      const policy = await computeEffectivePolicy(ctx, work.ownerAccountId, { account: String(work.ownerAccountId), mount: local.mountId ? String(local.mountId) : undefined, item: String(work._id) });
      await ctx.db.patch(local._id, { revision: localRevision, contentHash: localRevision, state: policy.cloudContent === "full" ? "ahead" : "current", lastVerifiedAt: now, updatedAt: now });
      cloudState = policy.cloudContent === "full" ? "behind" : "unavailable";
      repaired += 1;
      continue;
    }
    if (localRevision === cloudRevision) {
      await ctx.db.patch(local._id, { revision: localRevision, baseRevision: localRevision, contentHash: localRevision, state: "current", lastVerifiedAt: now, errorCode: undefined, errorMessage: undefined, errorAt: undefined, updatedAt: now });
    } else {
      cloudState = "diverged";
      await ctx.db.patch(local._id, { revision: localRevision, contentHash: localRevision, state: "diverged", lastVerifiedAt: now, updatedAt: now });
      const existing = await ctx.db.query("syncConflicts").withIndex("by_work_state", (q) => q.eq("workId", work._id).eq("state", "open")).filter((q) => q.and(q.eq(q.field("localRevision"), localRevision), q.eq(q.field("spectraRevision"), cloudRevision))).first();
      if (!existing) {
        await ctx.db.insert("syncConflicts", { accountId: work.ownerAccountId, workId: work._id, replicaIds: [local._id, cloud._id], regionIds: [], partNames: [], localRevision, spectraRevision: cloudRevision, localPayloadRef: local.payloadRef, spectraPayloadRef: cloud.payloadRef, state: "open", createdAt: now, updatedAt: now });
        conflicts += 1;
      }
    }
    repaired += 1;
  }
  await ctx.db.patch(cloud._id, {
    ...(cloudRevision ? { revision: cloudRevision, contentHash: cloudRevision } : {}),
    state: cloudState,
    unavailableReason: cloudState === "unavailable" ? "metadata-only" : undefined,
    lastVerifiedAt: cloudState === "current" ? now : undefined,
    errorCode: cloudState === "behind" && !cloudRevision ? "replica-payload-unverified" : undefined,
    errorAt: cloudState === "behind" && !cloudRevision ? now : undefined,
    updatedAt: now,
  });
  return { repaired: repaired + 1, conflicts };
}

/** One-time, automatic migration that distrusts legacy labels and re-derives
 * truth from retained payload hashes. */
export const reconcileReplicaTruthMigration = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await platformStopped(ctx, "background")) return { state: "running" as const, scanned: 0, repaired: 0, conflicts: 0 };
    const key = "replica-truth-v1";
    let migration = await ctx.db.query("replicaTruthMigrations").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (migration?.state === "complete") return migration;
    const now = Date.now();
    if (!migration) {
      const id = await ctx.db.insert("replicaTruthMigrations", { key, state: "running", scanned: 0, repaired: 0, conflicts: 0, createdAt: now, updatedAt: now });
      migration = await ctx.db.get(id);
    }
    if (!migration) throw new Error("REPLICA_TRUTH_MIGRATION_MISSING");
    const page = await ctx.db.query("spectraArtifacts").paginate({ cursor: migration.cursor ?? null, numItems: 25 });
    let repaired = 0;
    let conflicts = 0;
    for (const work of page.page) {
      const result = await reconcileWorkReplicaTruth(ctx, work);
      repaired += result.repaired;
      conflicts += result.conflicts;
    }
    await ctx.db.patch(migration._id, {
      state: page.isDone ? "complete" : "running",
      cursor: page.isDone ? undefined : page.continueCursor,
      scanned: migration.scanned + page.page.length,
      repaired: migration.repaired + repaired,
      conflicts: migration.conflicts + conflicts,
      updatedAt: Date.now(),
    });
    // The cron only starts it; once running, it carries itself to the end.
    if (!page.isDone) await ctx.scheduler.runAfter(60_000, internal.replicas.reconcileReplicaTruthMigration, {});
    return { state: page.isDone ? "complete" as const : "running" as const, scanned: page.page.length, repaired, conflicts };
  },
});

