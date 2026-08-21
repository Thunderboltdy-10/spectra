import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";
import { createFolderNode, placeSourceNode, purgeSourceNodes } from "./orgTreeShared";
import { z } from "zod";
import { chooseReplicaContinuity } from "./bridgeIdentity";

const replicaState = z.enum(["current", "ahead", "behind", "diverged", "pending", "error", "unavailable"]);
const transitionSchema = z.object({ idempotencyKey: z.string().uuid(), revisionBefore: z.string().min(1).max(200).optional(), revisionAfter: z.string().min(1).max(200).optional(), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), state: replicaState, errorCode: z.string().min(1).max(80).optional() }).strict();

export const forWork = query({
  args: { workId: v.id("spectraArtifacts") },
  handler: async (ctx, { workId }) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(workId); if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const replicas = await ctx.db.query("workReplicas").withIndex("by_work", (q) => q.eq("workId", workId)).take(20);
    const conflicts = await ctx.db.query("syncConflicts").withIndex("by_work_state", (q) => q.eq("workId", workId).eq("state", "open")).take(20);
    const pending = await ctx.db.query("syncOperations").withIndex("by_work_created", (q) => q.eq("workId", workId)).order("desc").take(50);
    return { replicas, conflicts, openConflictCount: conflicts.length, pendingCount: pending.filter((op) => op.state === "pending" || op.state === "applied").length, recentOperations: pending.slice(0, 10) };
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
    const local = replicas.find((replica) => replica.kind === "local" && replica.payloadRef);
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
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const input = z.object({
      payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
      semanticDigest: z.string().regex(/^[a-f0-9]{64}$/),
      nativeFormat: z.enum(["docx", "docm", "dotx", "dotm"]),
    }).parse(args);
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const cloud = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "cloud"))
      .unique();
    if (!cloud || cloud.contentHash !== input.payloadHash || !cloud.payloadRef)
      throw new Error("LENS_BASE_PAYLOAD_CHANGED");
    const now = Date.now();
    await ctx.db.patch(args.workId, {
      blueprintKey: "document",
      resourceClass: "artifact",
      nativeFormat: input.nativeFormat,
      compatibilityProfile: "strict-native",
      content: args.content,
      schemaVersion: 2,
      contentHash: input.semanticDigest,
      textIndex: Array.isArray(args.content?.blocks)
        ? args.content.blocks.map((block: { text?: unknown }) => typeof block?.text === "string" ? block.text : "").join("\n").slice(0, 200_000)
        : work.textIndex,
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
    const local = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local"))
      .unique();
    const cloud = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "cloud"))
      .unique();
    if (!local?.deviceId || !local.mountId || !local.localResourceId || !local.relativePath)
      throw new Error("LOCAL_REPLICA_UNAVAILABLE");
    const activeWrite = (await ctx.db.query("bridgeWriteRequests")
      .withIndex("by_work_created", (q) => q.eq("workId", args.workId))
      .order("desc")
      .take(50))
      .find((request) => request.state === "pending" || request.state === "claimed");
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

export const recordExternalReconciliation = mutation({
  args: {
    workId: v.id("spectraArtifacts"),
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
    const local = await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local")).unique();
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
