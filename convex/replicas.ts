import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";
import { createFolderNode, placeSourceNode, purgeSourceNodes } from "./orgTreeShared";
import { z } from "zod";
import {
  activeReplicaWriteTarget,
  chooseReplicaContinuity,
  latestActiveWriteForReplica,
} from "./bridgeIdentity";
import { bumpPolicyVersion } from "./authorityShared";
import { computeEffectivePolicy } from "./syncPolicy";
import { POLICY_PRESETS, type SyncPolicyPreset } from "../shared/sync-policy";
import { planStorageStrategyTransition } from "../shared/storage-strategy";

const replicaState = z.enum(["current", "ahead", "behind", "diverged", "pending", "error", "unavailable"]);
const transitionSchema = z.object({ idempotencyKey: z.string().uuid(), revisionBefore: z.string().min(1).max(200).optional(), revisionAfter: z.string().min(1).max(200).optional(), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), state: replicaState, errorCode: z.string().min(1).max(80).optional() }).strict();

const strategyPreset = v.union(v.literal("spectra"), v.literal("device"), v.literal("both"), v.literal("linked"));

/** Change storage strategy without changing the logical work identity. */
export const transitionStorageStrategy = mutation({
  args: { workId: v.id("spectraArtifacts"), toPreset: strategyPreset, idempotencyKey: v.string(), mountId: v.optional(v.id("bridgeMounts")), relativePath: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const idempotencyKey = z.string().uuid().parse(args.idempotencyKey);
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const existingTransition = await ctx.db.query("storageStrategyTransitions")
      .withIndex("by_account_key", (q) => q.eq("accountId", actor.accountId).eq("idempotencyKey", idempotencyKey)).unique();
    if (existingTransition) return { state: existingTransition.state, transitionId: existingTransition._id };
    const effective = await computeEffectivePolicy(ctx, actor.accountId, { account: String(actor.accountId), item: String(args.workId) });
    const fromPreset = effective.preset as SyncPolicyPreset;
    const [cloud, locals] = await Promise.all([
      ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "cloud")).unique(),
      ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local")).take(20),
    ]);
    let activeLocal = locals.find((replica) => replica.state !== "unavailable" && replica.unavailableReason !== "removed-by-user");
    const requiresLocal = args.toPreset === "device" || args.toPreset === "both" || args.toPreset === "linked";
    const strategyPlan = planStorageStrategyTransition(args.toPreset, {
      hasCloud: Boolean(cloud),
      cloudHasPayload: Boolean(cloud?.payloadRef),
      hasActiveLocal: Boolean(activeLocal),
      localIsVerified: Boolean(activeLocal && activeLocal.state === "current" && activeLocal.payloadRef && activeLocal.contentHash),
      hasProtectedPending: locals.some((replica) => Boolean(replica.pendingPayloadRef)),
    });
    // Materialize the cloud identity up front when a local-only work is being
    // promoted. The native payload is still uploaded and verified by the
    // Bridge; this row is deliberately payload-less and cannot report
    // `current` until commitPayloadUpload completes.
    if (!cloud && activeLocal && args.toPreset !== "device") {
      const now = Date.now();
      await ctx.db.insert("workReplicas", {
        accountId: actor.accountId,
        workId: args.workId,
        kind: "cloud",
        nativeFormat: activeLocal.nativeFormat,
        revision: activeLocal.revision,
        baseRevision: activeLocal.baseRevision,
        contentHash: activeLocal.contentHash,
        state: args.toPreset === "linked" ? "current" : "pending",
        fidelityMap: activeLocal.fidelityMap,
        preservedCarryVersion: activeLocal.preservedCarryVersion ?? 1,
        compatibilityProfile: activeLocal.compatibilityProfile ?? "strict-native",
        updatedAt: now,
      });
    }
    let createdLocal = false;
    let materializationRequestId: Id<"bridgeWriteRequests"> | undefined;
    if (requiresLocal && !activeLocal) {
      if (!args.mountId || !args.relativePath || !cloud?.payloadRef) throw new Error("STORAGE_STRATEGY_LOCAL_TARGET_REQUIRED");
      if (!cloud.contentHash) throw new Error("STORAGE_STRATEGY_CLOUD_HASH_REQUIRED");
      const mount = await ctx.db.get(args.mountId);
      const device = mount ? await ctx.db.get(mount.deviceId) : null;
      if (!mount || mount.accountId !== actor.accountId || mount.state !== "active" || !device || device.state !== "active") throw new Error("MOUNT_NOT_ACTIVE");
      const relativePath = z.string().trim().min(1).max(1024).refine((value) => !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes(".."), "LOCAL_PATH_INVALID").parse(args.relativePath);
      const now = Date.now();
      const localResourceId = `lr_${crypto.randomUUID().replaceAll("-", "")}`;
      const localId = await ctx.db.insert("workReplicas", { accountId: actor.accountId, workId: args.workId, kind: "local", deviceId: mount.deviceId, mountId: mount._id, localResourceId, relativePath, nativeFormat: cloud.nativeFormat, payloadRef: undefined, revision: `new:${cloud.revision}`, baseRevision: cloud.revision, contentHash: undefined, state: "pending", fidelityMap: cloud.fidelityMap, preservedCarryVersion: 1, compatibilityProfile: cloud.compatibilityProfile ?? "strict-native", updatedAt: now });
      activeLocal = (await ctx.db.get(localId)) ?? undefined;
      const writeKey = crypto.randomUUID();
      materializationRequestId = await ctx.db.insert("bridgeWriteRequests", { accountId: actor.accountId, workId: args.workId, replicaId: localId, deviceId: mount.deviceId, mountId: mount._id, localResourceId, relativePath, payloadRef: cloud.payloadRef, baseRevision: cloud.revision, targetRevision: cloud.contentHash, contentHash: cloud.contentHash, idempotencyKey: writeKey, regionIds: [], partNames: [], state: "pending", createdAt: now, updatedAt: now });
      await ctx.db.insert("syncOperations", { accountId: actor.accountId, workId: args.workId, replicaId: localId, idempotencyKey: writeKey, direction: "cloud-to-local", revisionBefore: cloud.revision, revisionAfter: cloud.contentHash, state: "pending", actorKind: "user", createdAt: now, updatedAt: now });
      createdLocal = true;
    }
    // A local-only -> Spectra transition can be pending without creating a
    // new local replica: the existing Bridge source must upload its retained
    // native payload before the cloud replica is considered complete. Keep
    // the source active until bridgeSync:commitPayloadUpload verifies it.
    const now = Date.now();
    const before = { preset: fromPreset, cloudPayloadRef: cloud?.payloadRef, localReplicaIds: locals.map((replica) => String(replica._id)), localStates: locals.map((replica) => ({ id: String(replica._id), state: replica.state })) };
    const transitionId = await ctx.db.insert("storageStrategyTransitions", { accountId: actor.accountId, workId: args.workId, idempotencyKey, fromPreset, toPreset: args.toPreset, state: "pending", before, createdAt: now, updatedAt: now });
    try {
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
        // local source active until the normal Bridge discovery/upload path
        // has attached and verified the native payload in Spectra.
        if (!strategyPlan.requiresCloudMaterialization) {
          for (const local of locals) await ctx.db.patch(local._id, { state: "unavailable", unavailableReason: "removed-by-user", protectedOriginal: undefined, updatedAt: now });
        }
        await ctx.db.patch(args.workId, { protectedOriginal: false, updatedAt: now });
      } else if (args.toPreset === "device" && cloud) {
        // Keep the cloud payload until the Bridge has read back and verified
        // the materialized local file. completeWrite owns the final cleanup;
        // clearing it here would make a failed F6 transition lose recovery.
        await ctx.db.patch(activeLocal!._id, { protectedOriginal: undefined, state: createdLocal ? "pending" : activeLocal!.state === "unavailable" ? "behind" : activeLocal!.state, updatedAt: now });
        await ctx.db.patch(args.workId, { protectedOriginal: false, updatedAt: now });
      } else if (args.toPreset === "both") {
        await ctx.db.patch(activeLocal!._id, { protectedOriginal: undefined, state: activeLocal!.state === "unavailable" ? "behind" : activeLocal!.state, updatedAt: now });
        await ctx.db.patch(args.workId, { protectedOriginal: false, updatedAt: now });
      } else if (args.toPreset === "linked") {
        await ctx.db.patch(activeLocal!._id, { protectedOriginal: true, updatedAt: now });
        await ctx.db.patch(args.workId, { protectedOriginal: true, updatedAt: now });
      }
      const after = { preset: args.toPreset, cloudPayloadRef: args.toPreset === "device" ? undefined : cloud?.payloadRef, localReplicaIds: [...locals.map((replica) => String(replica._id)), ...(activeLocal && createdLocal ? [String(activeLocal._id)] : [])], physicalLocalAction: args.toPreset === "spectra" ? "leave-file-in-place" : "retain", materializationRequestId: materializationRequestId ? String(materializationRequestId) : undefined };
      const finalState = createdLocal || strategyPlan.requiresCloudMaterialization ? "pending" : strategyPlan.completion;
      await ctx.db.patch(transitionId, { state: finalState, after, updatedAt: Date.now() });
      return { state: finalState as "pending" | "verified", transitionId, materializationRequestId: materializationRequestId ?? null };
    } catch (error) {
      await ctx.db.patch(transitionId, { state: "failed", errorCode: error instanceof Error ? error.message.slice(0, 120) : "STRATEGY_TRANSITION_FAILED", updatedAt: Date.now() });
      throw error;
    }
  },
});

export const removeLocalReplica = mutation({
  args: { workId: v.id("spectraArtifacts"), replicaId: v.id("workReplicas"), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const idempotencyKey = z.string().uuid().parse(args.idempotencyKey);
    const replica = await ctx.db.get(args.replicaId);
    if (!replica || replica.accountId !== actor.accountId || replica.workId !== args.workId || replica.kind !== "local") throw new Error("LOCAL_REPLICA_NOT_FOUND");
    if (replica.pendingPayloadRef) throw new Error("LOCAL_REPLICA_PENDING_CHANGES");
    const existing = await ctx.db.query("storageStrategyTransitions").withIndex("by_account_key", (q) => q.eq("accountId", actor.accountId).eq("idempotencyKey", idempotencyKey)).unique();
    if (existing) return { state: existing.state, transitionId: existing._id };
    const now = Date.now();
    const transitionId = await ctx.db.insert("storageStrategyTransitions", { accountId: actor.accountId, workId: args.workId, idempotencyKey, fromPreset: "both", toPreset: "spectra", state: "pending", before: { replicaId: String(replica._id), relativePath: replica.relativePath, state: replica.state }, createdAt: now, updatedAt: now });
    const spectraPolicy = POLICY_PRESETS.spectra;
    const existingPolicy = await ctx.db.query("syncPolicies")
      .withIndex("by_account_scope", (q) => q.eq("accountId", actor.accountId).eq("scopeKind", "item").eq("scopeId", String(args.workId)))
      .unique();
    if (existingPolicy) await ctx.db.patch(existingPolicy._id, { ...spectraPolicy, updatedAt: now });
    else await ctx.db.insert("syncPolicies", { accountId: actor.accountId, scopeKind: "item", scopeId: String(args.workId), ...spectraPolicy, createdAt: now, updatedAt: now });
    await ctx.db.insert("syncPolicyChanges", { accountId: actor.accountId, scopeKind: "item", scopeId: String(args.workId), action: "override", before: { preset: "both" }, after: { ...spectraPolicy }, actorKind: "user", idempotencyKey: `storage:${idempotencyKey}`, createdAt: now });
    await ctx.db.patch(replica._id, { state: "unavailable", unavailableReason: "removed-by-user", protectedOriginal: undefined, updatedAt: now });
    await ctx.db.patch(transitionId, { state: "verified", after: { replicaId: String(replica._id), physicalAction: "leave-file-in-place", state: "unavailable" }, updatedAt: Date.now() });
    return { state: "verified" as const, transitionId };
  },
});

export const forWork = query({
  args: { workId: v.id("spectraArtifacts") },
  handler: async (ctx, { workId }) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(workId); if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const replicas = await ctx.db.query("workReplicas").withIndex("by_work", (q) => q.eq("workId", workId)).take(20);
    const conflicts = await ctx.db.query("syncConflicts").withIndex("by_work_state", (q) => q.eq("workId", workId).eq("state", "open")).take(20);
    const pending = await ctx.db.query("syncOperations").withIndex("by_work_created", (q) => q.eq("workId", workId)).order("desc").take(50);
    return { replicas, conflicts, openConflictCount: conflicts.length, pendingCount: pending.filter((op) => op.state === "pending" || op.state === "applied").length, recentOperations: pending.slice(0, 20) };
  },
});

export const strategyTransitionForWork = query({
  args: { workId: v.id("spectraArtifacts") },
  handler: async (ctx, { workId }) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const transitions = await ctx.db.query("storageStrategyTransitions")
      .withIndex("by_work_created", (q) => q.eq("workId", workId))
      .order("desc")
      .take(10);
    return transitions.find((transition) => transition.state === "pending") ?? transitions[0] ?? null;
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
    const work = await ctx.db.get(workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const replicas = await ctx.db.query("workReplicas").withIndex("by_work", (q) => q.eq("workId", workId)).take(20);
    if (prefer !== "local-latest" && work.pendingPayloadRef && work.pendingContentHash) {
      const pendingId = ctx.db.normalizeId("payloadObjects", work.pendingPayloadRef);
      const pending = pendingId ? await ctx.db.get(pendingId) : null;
      const protectedLocal = replicas.find((replica) => replica.kind === "local" && replica.pendingPayloadRef === work.pendingPayloadRef);
      if (pending && pending.accountId === actor.accountId && pending.state === "active") {
        return {
          url: await ctx.storage.getUrl(pending.storageId), bytes: pending.bytes, hash: pending.hash,
          mediaType: pending.mediaType, payloadRef: String(pending._id), replicaId: protectedLocal?._id,
          replicaKind: "cloud" as const, revision: work.pendingContentHash, baseRevision: work.pendingBaseRevision,
          state: "ahead" as const, nativeFormat: protectedLocal?.nativeFormat ?? work.nativeFormat ?? "spectra-pkg",
          fidelityMap: protectedLocal?.fidelityMap, compatibilityProfile: protectedLocal?.compatibilityProfile ?? work.compatibilityProfile ?? "strict-native",
        };
      }
    }
    const local = replicas
      .filter((replica) => replica.kind === "local" && replica.payloadRef)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    const cloud = replicas.find((replica) => replica.kind === "cloud" && replica.payloadRef);
    const selected = prefer === "local-latest" ? local ?? cloud : cloud ?? local;
    if (!selected?.payloadRef) return null;
    const payloadId = ctx.db.normalizeId("payloadObjects", selected.payloadRef);
    const payload = payloadId ? await ctx.db.get(payloadId) : null;
    if (!payload || payload.accountId !== actor.accountId || payload.state !== "active") return null;
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
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
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
      preservedCarryVersion: 1,
      compatibilityProfile: "strict-native",
      updatedAt: now,
    });
    return { activated: true, workId: args.workId };
  },
});

export const queueMaterialization = mutation({
  args: {
    workId: v.id("spectraArtifacts"),
    payloadRef: v.string(),
    contentHash: v.string(),
    baseRevision: v.string(),
    idempotencyKey: v.string(),
    fidelityMap: v.any(),
    regionIds: v.array(v.string()),
    partNames: v.array(v.string()),
    localReplicaId: v.optional(v.id("workReplicas")),
    baseContent: v.optional(v.any()),
    baseContentHash: v.optional(v.string()),
    baseTextIndex: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const input = z.object({
      payloadRef: z.string().min(1),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      baseRevision: z.string().min(1).max(200),
      idempotencyKey: z.string().uuid(),
      regionIds: z.array(z.string().min(1).max(300)).max(500),
      partNames: z.array(z.string().min(1).max(500)).max(200),
      baseContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      baseTextIndex: z.string().max(200_000).optional(),
    }).parse(args);
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const existing = await ctx.db.query("bridgeWriteRequests")
      .withIndex("by_account_key", (q) => q.eq("accountId", actor.accountId).eq("idempotencyKey", input.idempotencyKey))
      .unique();
    if (existing) return { requestId: existing._id, state: existing.state };
    const payloadId = ctx.db.normalizeId("payloadObjects", input.payloadRef);
    const payload = payloadId ? await ctx.db.get(payloadId) : null;
    if (!payload || payload.accountId !== actor.accountId || payload.hash !== input.contentHash || payload.state !== "active")
      throw new Error("MATERIALIZATION_PAYLOAD_INVALID");
    const locals = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local"))
      .take(20);
    const local = args.localReplicaId
      ? locals.find((candidate) => candidate._id === args.localReplicaId)
      : locals.filter((candidate) => candidate.state !== "unavailable").sort((left, right) => right.updatedAt - left.updatedAt)[0];
    const cloud = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "cloud"))
      .unique();
    if (!local?.deviceId || !local.mountId || !local.localResourceId || !local.relativePath)
      throw new Error("LOCAL_REPLICA_UNAVAILABLE");
    const activeWrite = latestActiveWriteForReplica(
      await ctx.db.query("bridgeWriteRequests")
      .withIndex("by_work_created", (q) => q.eq("workId", args.workId))
      .order("desc")
      .take(50),
      local._id,
    );
    const [mount, device] = await Promise.all([
      ctx.db.get(local.mountId),
      ctx.db.get(local.deviceId),
    ]);
    if (!activeReplicaWriteTarget(local, mount, device))
      throw new Error("LOCAL_REPLICA_UNAVAILABLE");
    const policy = await computeEffectivePolicy(ctx, actor.accountId, {
      account: String(actor.accountId),
      mount: String(local.mountId),
      item: String(args.workId),
    });
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
        idempotencyKey: input.idempotencyKey,
        direction: "cloud-to-local",
        revisionBefore: input.baseRevision,
        revisionAfter: input.contentHash,
        state: "pending",
        actorKind: "user",
        errorCode: "protected-original-pending",
        createdAt: now,
        updatedAt: now,
      });
      return { requestId: "protected-original" as const, state: "protected-pending" as const };
    }
    if (local.revision !== input.baseRevision && !activeWrite)
      throw new Error("MATERIALIZATION_BASE_STALE");
    const effectiveBaseRevision = activeWrite?.targetRevision ?? local.revision;
    const now = Date.now();
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
      idempotencyKey: input.idempotencyKey,
      regionIds: input.regionIds,
      partNames: input.partNames,
      state: "pending",
      createdAt: now,
      updatedAt: now,
    });
    if (cloud) {
      await ctx.db.patch(cloud._id, {
        payloadRef: input.payloadRef,
        baseRevision: cloud.revision,
        revision: input.contentHash,
        contentHash: input.contentHash,
        fidelityMap: args.fidelityMap,
        preservedCarryVersion: 1,
        compatibilityProfile: "strict-native",
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(local._id, { state: "pending", updatedAt: now });
    await ctx.db.insert("syncOperations", {
      accountId: actor.accountId,
      workId: args.workId,
      replicaId: local._id,
      idempotencyKey: input.idempotencyKey,
      direction: "cloud-to-local",
      revisionBefore: effectiveBaseRevision,
      revisionAfter: input.contentHash,
      state: "pending",
      actorKind: "user",
      createdAt: now,
      updatedAt: now,
    });
    return { requestId, state: "pending" as const };
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
    await Promise.all(pendingOperations.filter((operation) => operation.errorCode === "protected-original-pending" && operation.state === "pending").map((operation) =>
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
  args: { workId: v.id("spectraArtifacts"), idempotencyKey: v.string() },
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
      .withIndex("by_work_state", (q) => q.eq("workId", args.workId).eq("state", "open"))
      .first();
    if (openConflict) throw new Error("PROTECTED_ORIGINAL_CONFLICT");
    const payloadId = ctx.db.normalizeId("payloadObjects", local.pendingPayloadRef);
    const payload = payloadId ? await ctx.db.get(payloadId) : null;
    if (!payload || payload.accountId !== actor.accountId || payload.state !== "active" || payload.hash !== local.pendingContentHash)
      throw new Error("PROTECTED_PENDING_PAYLOAD_INVALID");
    if (work.protectedBaseContent === undefined || !work.protectedBaseContentHash)
      throw new Error("PROTECTED_BASE_SNAPSHOT_MISSING");
    const existing = await ctx.db.query("bridgeWriteRequests").withIndex("by_account_key", (q) => q.eq("accountId", actor.accountId).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (existing) return { requestId: existing._id, state: existing.state };
    const [mount, device] = await Promise.all([ctx.db.get(local.mountId), ctx.db.get(local.deviceId)]);
    if (!activeReplicaWriteTarget(local, mount, device)) throw new Error("LOCAL_REPLICA_UNAVAILABLE");
    const now = Date.now();
    const requestId = await ctx.db.insert("bridgeWriteRequests", {
      accountId: actor.accountId, workId: args.workId, replicaId: local._id, deviceId: local.deviceId, mountId: local.mountId,
      localResourceId: local.localResourceId, relativePath: local.relativePath, payloadRef: local.pendingPayloadRef,
      baseRevision: local.pendingBaseRevision, targetRevision: local.pendingContentHash, contentHash: local.pendingContentHash,
      idempotencyKey: args.idempotencyKey, regionIds: [], partNames: [], state: "pending", createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(local._id, { state: "pending", updatedAt: now });
    await ctx.db.insert("syncOperations", {
      accountId: actor.accountId, workId: args.workId, replicaId: local._id, idempotencyKey: args.idempotencyKey,
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
      .filter((operation) => operation.errorCode === "protected-original-pending" && operation.state === "pending")
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
    const idempotencyKey = crypto.randomUUID();
    const requestId = await ctx.db.insert("bridgeWriteRequests", {
      accountId: actor.accountId, workId: args.workId, replicaId, deviceId: mount.deviceId, mountId: mount._id,
      localResourceId, relativePath: input.relativePath, payloadRef: input.payloadRef,
      baseRevision: existing?.revision ?? `new:${args.workId}`, targetRevision: input.contentHash, contentHash: input.contentHash, idempotencyKey,
      regionIds: [], partNames: [], state: "pending", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("syncOperations", { accountId: actor.accountId, workId: args.workId, replicaId, idempotencyKey, direction: "cloud-to-local", revisionBefore: existing?.revision ?? `new:${args.workId}`, revisionAfter: input.contentHash, state: "pending", actorKind: "restore", createdAt: now, updatedAt: now });
    return { state: "pending" as const, replicaId, requestId };
  },
});

export const attachPortablePayload = mutation({
  args: {
    workId: v.id("spectraArtifacts"),
    payloadRef: v.string(),
    contentHash: v.string(),
    nativeFormat: v.string(),
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
    const now = Date.now();
    const cloud = await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "cloud")).first();
    if (cloud) {
      await ctx.db.patch(cloud._id, { payloadRef: input.payloadRef, baseRevision: cloud.revision, revision: input.contentHash, contentHash: input.contentHash, nativeFormat: input.nativeFormat, state: "current", lastVerifiedAt: now, updatedAt: now });
      return cloud._id;
    }
    return ctx.db.insert("workReplicas", { accountId: actor.accountId, workId: args.workId, kind: "cloud", payloadRef: input.payloadRef, nativeFormat: input.nativeFormat, revision: input.contentHash, contentHash: input.contentHash, state: "current", lastVerifiedAt: now, updatedAt: now });
  },
});

export const recordExternalReconciliation = mutation({
  args: {
    workId: v.id("spectraArtifacts"),
    localReplicaId: v.optional(v.id("workReplicas")),
    localPayloadRef: v.string(),
    localRevision: v.string(),
    content: v.any(),
    fidelityMap: v.any(),
    regionIds: v.array(v.string()),
    partNames: v.array(v.string()),
    conflictRegionIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    // A work may legitimately have one local replica per device. Reconcile
    // against the exact replica reported by the Bridge, never an arbitrary
    // `unique()` local row that only happened to exist before N6.
    const locals = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local"))
      .take(50);
    const local = (args.localReplicaId
      ? locals.find((candidate) => candidate._id === args.localReplicaId)
      : undefined) ?? locals.find((candidate) =>
      candidate.payloadRef === args.localPayloadRef && candidate.revision === args.localRevision,
    );
    if (local && (local.payloadRef !== args.localPayloadRef || local.revision !== args.localRevision))
      throw new Error("EXTERNAL_REVISION_CHANGED");
    const cloud = await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "cloud")).unique();
    if (!local || !cloud || local.payloadRef !== args.localPayloadRef || local.revision !== args.localRevision)
      throw new Error("EXTERNAL_REVISION_CHANGED");
    const now = Date.now();
    const operation = await ctx.db.query("syncOperations")
      .withIndex("by_work_created", (q) => q.eq("workId", args.workId))
      .order("desc")
      .filter((q) => q.and(q.eq(q.field("direction"), "external"), q.eq(q.field("state"), "pending")))
      .first();
    if (args.conflictRegionIds.length) {
      const existingConflict = await ctx.db
        .query("syncConflicts")
        .withIndex("by_work_state", (q) => q.eq("workId", args.workId).eq("state", "open"))
        .filter((q) =>
          q.and(
            q.eq(q.field("localRevision"), local.revision),
            q.eq(q.field("spectraRevision"), cloud.revision),
          ),
        )
        .first();
      if (existingConflict) {
        if (operation) await ctx.db.patch(operation._id, { state: "conflicted", updatedAt: now });
        await ctx.db.patch(local._id, { state: "diverged", updatedAt: now });
        await ctx.db.patch(cloud._id, { state: "diverged", updatedAt: now });
        return { state: "conflicted" as const };
      }
      await ctx.db.insert("syncConflicts", {
        accountId: actor.accountId,
        workId: args.workId,
        replicaIds: [local._id, cloud._id],
        regionIds: args.conflictRegionIds,
        partNames: args.partNames,
        localRevision: local.revision,
        spectraRevision: cloud.revision,
        state: "open",
        createdAt: now,
      });
      await ctx.db.patch(local._id, { state: "diverged", updatedAt: now });
      await ctx.db.patch(cloud._id, { state: "diverged", updatedAt: now });
      if (operation) await ctx.db.patch(operation._id, { state: "conflicted", updatedAt: now });
      return { state: "conflicted" as const };
    }
    await ctx.db.patch(args.workId, {
      content: args.content,
      textIndex: Array.isArray(args.content?.blocks)
        ? args.content.blocks.map((block: { text?: unknown }) => typeof block?.text === "string" ? block.text : "").join("\n").slice(0, 200_000)
        : work.textIndex,
      updatedAt: now,
    });
    await ctx.db.patch(cloud._id, {
      payloadRef: local.payloadRef,
      baseRevision: cloud.revision,
      revision: local.revision,
      contentHash: local.contentHash,
      fidelityMap: args.fidelityMap,
      state: "current",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(local._id, { state: "current", lastVerifiedAt: now, updatedAt: now });
    if (operation) await ctx.db.patch(operation._id, { state: "verified", updatedAt: now });
    const openConflicts = await ctx.db.query("syncConflicts")
      .withIndex("by_work_state", (q) => q.eq("workId", args.workId).eq("state", "open"))
      .take(20);
    await Promise.all(openConflicts.map((conflict) =>
      ctx.db.patch(conflict._id, { state: "resolved-local", resolvedAt: now }),
    ));
    return { state: "applied" as const };
  },
});

export const resolveExternalConflict = mutation({
  args: {
    workId: v.id("spectraArtifacts"),
    resolution: v.union(v.literal("local"), v.literal("spectra")),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId)
      throw new Error("WORK_NOT_FOUND");
    const conflicts = await ctx.db.query("syncConflicts")
      .withIndex("by_work_state", (q) => q.eq("workId", args.workId).eq("state", "open"))
      .take(20);
    const now = Date.now();
    await Promise.all(conflicts.map((conflict) =>
      ctx.db.patch(conflict._id, {
        state: args.resolution === "local" ? "resolved-local" : "resolved-spectra",
        resolvedAt: now,
      }),
    ));
    return { resolved: conflicts.length };
  },
});

export const transition = mutation({
  args: { replicaId: v.id("workReplicas"), input: v.any() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED"); const input = transitionSchema.parse(args.input);
    const replica = await ctx.db.get(args.replicaId); if (!replica || replica.accountId !== actor.accountId) throw new Error("REPLICA_NOT_FOUND");
    const existing = await ctx.db.query("syncOperations").withIndex("by_account_key", (q) => q.eq("accountId", actor.accountId).eq("idempotencyKey", input.idempotencyKey)).unique();
    if (existing) return existing._id;
    if (input.revisionBefore && input.revisionBefore !== replica.revision) {
      const now = Date.now();
      const operationId = await ctx.db.insert("syncOperations", { accountId: actor.accountId, workId: replica.workId, replicaId: replica._id, idempotencyKey: input.idempotencyKey, direction: replica.kind === "local" ? "local-to-cloud" : "cloud-to-local", revisionBefore: input.revisionBefore, revisionAfter: input.revisionAfter, state: "conflicted", actorKind: "reconciliation", errorCode: "stale-revision", createdAt: now, updatedAt: now });
      await ctx.db.insert("syncConflicts", { accountId: actor.accountId, workId: replica.workId, replicaIds: [replica._id], regionIds: [], partNames: [], localRevision: replica.kind === "local" ? replica.revision : input.revisionBefore, spectraRevision: replica.kind === "cloud" ? replica.revision : input.revisionBefore, state: "open", createdAt: now });
      await ctx.db.patch(replica._id, { state: "diverged", updatedAt: now }); return operationId;
    }
    if (input.state === "current" && !input.contentHash) throw new Error("VERIFIED_HASH_REQUIRED");
    const now = Date.now();
    const operationId = await ctx.db.insert("syncOperations", { accountId: actor.accountId, workId: replica.workId, replicaId: replica._id, idempotencyKey: input.idempotencyKey, direction: replica.kind === "local" ? "local-to-cloud" : "cloud-to-local", revisionBefore: replica.revision, revisionAfter: input.revisionAfter, state: input.state === "current" ? "verified" : input.state === "diverged" ? "conflicted" : input.state === "error" ? "failed" : "pending", actorKind: "reconciliation", errorCode: input.errorCode, createdAt: now, updatedAt: now });
    await ctx.db.patch(replica._id, { revision: input.revisionAfter ?? replica.revision, baseRevision: input.revisionBefore ?? replica.baseRevision, contentHash: input.contentHash ?? replica.contentHash, state: input.state, lastVerifiedAt: input.state === "current" ? now : replica.lastVerifiedAt, errorCode: input.errorCode, errorAt: input.errorCode ? now : undefined, updatedAt: now });
    return operationId;
  },
});

export const replicaMigrationPage = mutation({
  args: { cursor: v.optional(v.string()), numItems: v.number(), dryRun: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const page = await ctx.db.query("spectraArtifacts").withIndex("by_account_status", (q) => q.eq("ownerAccountId", actor.accountId)).paginate({ cursor: args.cursor ?? null, numItems: Math.min(100, Math.max(1, args.numItems)) });
    let missing = 0; let inserted = 0; let duplicates = 0;
    for (const work of page.page) {
      const replicas = await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", work._id).eq("kind", "cloud")).take(2);
      if (replicas.length > 1) duplicates += replicas.length - 1;
      const hasLocalReplica = !replicas.length && Boolean(await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", work._id).eq("kind", "local")).first());
      if (!replicas.length && !hasLocalReplica) { missing += 1; if (!args.dryRun) { const now = Date.now(); const revision = work.contentHash ?? String(work.currentVersionId ?? work._id); await ctx.db.insert("workReplicas", { accountId: actor.accountId, workId: work._id, kind: "cloud", nativeFormat: work.nativeFormat ?? "spectra-pkg", revision, contentHash: work.contentHash, state: "current", lastVerifiedAt: now, updatedAt: now }); await ctx.db.insert("syncOperations", { accountId: actor.accountId, workId: work._id, idempotencyKey: `migration:${work._id}`, direction: "migration", revisionAfter: revision, state: "verified", actorKind: "migration", createdAt: now, updatedAt: now }); inserted += 1; } }
    }
    return { continueCursor: page.continueCursor, isDone: page.isDone, scanned: page.page.length, missing, inserted, duplicates };
  },
});

async function ensureFolderPath(ctx: Parameters<typeof createFolderNode>[0], accountId: Id<"accounts">, schoolId: Id<"schools">, rootId: Id<"orgNodes">, segments: string[]) {
  let parentId = rootId;
  for (const name of segments) {
    const existing = await ctx.db.query("orgNodes").withIndex("by_account_parent_live_name", (q) => q.eq("accountId", accountId).eq("parentId", parentId).eq("deletedAt", undefined).eq("name", name)).filter((q) => q.eq(q.field("kind"), "folder")).unique();
    parentId = existing?._id ?? (await createFolderNode(ctx, { accountId, schoolId, name, parentId }))._id;
  }
  return parentId;
}

export const discoverResource = mutation({
  args: { mountId: v.id("bridgeMounts"), localResourceId: v.string(), relativePath: v.string(), size: v.number(), contentHash: v.optional(v.string()), nativeFormat: v.string() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED"); const mount = await ctx.db.get(args.mountId);
    if (!mount || mount.accountId !== actor.accountId || !mount.rootOrgNodeId || mount.state !== "active") throw new Error("MOUNT_NOT_ACTIVE");
    const input = z.object({ localResourceId: z.string().regex(/^lr_[a-f0-9]+$/), relativePath: z.string().min(1).max(1024).refine((value) => !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes("..")), size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), nativeFormat: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/) }).parse(args);
    const byResource = await ctx.db.query("workReplicas").withIndex("by_device_resource", (q) => q.eq("deviceId", mount.deviceId).eq("localResourceId", input.localResourceId)).take(20);
    const byPath = await ctx.db.query("workReplicas").withIndex("by_device_mount_path", (q) => q.eq("deviceId", mount.deviceId).eq("mountId", mount._id).eq("relativePath", input.relativePath)).take(20);
    const candidates = [...byResource, ...byPath].filter((candidate, index, all) => all.findIndex((entry) => entry._id === candidate._id) === index);
    const scored = await Promise.all(candidates.map(async (candidate) => ({ candidate, cloud: await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", candidate.workId).eq("kind", "cloud")).first() })));
    const existingReplica = chooseReplicaContinuity(scored.map(({ candidate, cloud }) => ({ value: candidate, creationTime: candidate._creationTime, hasCloudReplica: Boolean(cloud) })));
    if (existingReplica) {
      await ctx.db.patch(existingReplica._id, {
        mountId: mount._id,
        localResourceId: input.localResourceId,
        relativePath: input.relativePath,
        ...(input.contentHash && input.contentHash !== existingReplica.contentHash ? { state: "ahead" as const } : {}),
        updatedAt: Date.now(),
      });
      for (const duplicate of candidates.filter((candidate) => candidate._id !== existingReplica._id)) {
        const duplicateCloud = await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", duplicate.workId).eq("kind", "cloud")).first();
        if (duplicateCloud) continue;
        await ctx.db.patch(duplicate.workId, { status: "deleted", updatedAt: Date.now() });
        await purgeSourceNodes(ctx, "work", String(duplicate.workId));
        await ctx.db.delete(duplicate._id);
      }
      return existingReplica.workId;
    }
    const parts = input.relativePath.replaceAll("\\", "/").split("/").filter(Boolean); const title = parts.pop()!; const parentId = await ensureFolderPath(ctx, actor.accountId, actor.schoolId, mount.rootOrgNodeId, parts);
    const now = Date.now(); const workId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: actor.accountId, schoolId: actor.schoolId, blueprintKey: "resource", resourceClass: "resource", nativeFormat: input.nativeFormat, compatibilityProfile: "strict-native", title, summary: `${input.size} bytes`, content: null, schemaVersion: 1, contentHash: input.contentHash, tags: [], status: "active", createdFrom: { source: "manual" }, createdAt: now, updatedAt: now });
    await ctx.db.insert("workReplicas", { accountId: actor.accountId, workId, kind: "local", deviceId: mount.deviceId, mountId: mount._id, localResourceId: input.localResourceId, relativePath: input.relativePath, nativeFormat: input.nativeFormat, revision: input.contentHash ?? `discovered:${input.localResourceId}`, contentHash: input.contentHash, state: "current", lastVerifiedAt: now, updatedAt: now });
    await placeSourceNode(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, kind: "work", sourceId: String(workId), name: title, target: { parentId }, typeKey: "resource", placedByAccountId: actor.accountId });
    return workId;
  },
});
