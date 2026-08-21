import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getActorForAccountId } from "./identityShared";
import { createFolderNode, placeSourceNode, purgeSourceNodes, trashNode } from "./orgTreeShared";
import { z } from "zod";
import { chooseReplicaContinuity } from "./bridgeIdentity";

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireDevice(ctx: Parameters<typeof getActorForAccountId>[0], credential: string) {
  const credentialHash = await digest(z.string().min(32).max(256).parse(credential));
  const device = await ctx.db.query("bridgeDevices").withIndex("by_credential_hash", (q) => q.eq("credentialHash", credentialHash)).unique();
  if (!device || device.state !== "active") throw new Error("BRIDGE_CREDENTIAL_INVALID");
  const actor = await getActorForAccountId(ctx, device.accountId);
  if (!actor) throw new Error("BRIDGE_ACCOUNT_UNAVAILABLE");
  return { device, actor };
}

async function ensureFolderPath(ctx: Parameters<typeof createFolderNode>[0], accountId: Id<"accounts">, schoolId: Id<"schools">, rootId: Id<"orgNodes">, segments: string[]) {
  let parentId = rootId;
  for (const name of segments) {
    const existing = await ctx.db.query("orgNodes").withIndex("by_account_parent_live_name", (q) => q.eq("accountId", accountId).eq("parentId", parentId).eq("deletedAt", undefined).eq("name", name)).filter((q) => q.eq(q.field("kind"), "folder")).unique();
    parentId = existing?._id ?? (await createFolderNode(ctx, { accountId, schoolId, name, parentId }))._id;
  }
  return parentId;
}

export const registerMount = mutation({
  args: { credential: v.string(), rootLabel: v.string(), grantId: v.string(), fileCount: v.number(), doubleSyncRisk: v.boolean() },
  handler: async (ctx, args) => {
    const { device, actor } = await requireDevice(ctx, args.credential);
    const input = z.object({ rootLabel: z.string().trim().min(1).max(120), grantId: z.string().regex(/^grant_[a-f0-9]+$/), fileCount: z.number().int().min(0).max(10_000_000), doubleSyncRisk: z.boolean() }).parse(args);
    const existing = await ctx.db.query("bridgeMounts").withIndex("by_device_grant", (q) => q.eq("deviceId", device._id).eq("grantId", input.grantId)).unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { rootLabel: input.rootLabel, fileCount: input.fileCount, doubleSyncRisk: input.doubleSyncRisk, state: "active", lastScanAt: now, updatedAt: now });
      return existing._id;
    }
    const rootNode = await createFolderNode(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, name: input.rootLabel });
    return ctx.db.insert("bridgeMounts", { accountId: actor.accountId, deviceId: device._id, rootLabel: input.rootLabel, grantId: input.grantId, rootOrgNodeId: rootNode._id, state: "active", fileCount: input.fileCount, doubleSyncRisk: input.doubleSyncRisk, lastScanAt: now, createdAt: now, updatedAt: now });
  },
});

export const discoverResource = mutation({
  args: { credential: v.string(), mountId: v.id("bridgeMounts"), localResourceId: v.string(), relativePath: v.string(), size: v.number(), contentHash: v.optional(v.string()), nativeFormat: v.string() },
  handler: async (ctx, args) => {
    const { device, actor } = await requireDevice(ctx, args.credential);
    const mount = await ctx.db.get(args.mountId);
    if (!mount || mount.deviceId !== device._id || mount.accountId !== actor.accountId || !mount.rootOrgNodeId || mount.state !== "active") throw new Error("MOUNT_NOT_ACTIVE");
    const input = z.object({ localResourceId: z.string().regex(/^lr_[a-f0-9]+$/), relativePath: z.string().min(1).max(1024).refine((value) => !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes("..")), size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), nativeFormat: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/) }).parse(args);
    const byResource = await ctx.db.query("workReplicas").withIndex("by_device_resource", (q) => q.eq("deviceId", device._id).eq("localResourceId", input.localResourceId)).take(20);
    const byPath = await ctx.db.query("workReplicas").withIndex("by_device_mount_path", (q) => q.eq("deviceId", device._id).eq("mountId", mount._id).eq("relativePath", input.relativePath)).take(20);
    const candidates = [...byResource, ...byPath].filter((candidate, index, all) => all.findIndex((entry) => entry._id === candidate._id) === index);
    const scored = await Promise.all(candidates.map(async (candidate) => ({
      candidate,
      cloud: await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", candidate.workId).eq("kind", "cloud")).first(),
    })));
    const existingReplica = chooseReplicaContinuity(scored.map(({ candidate, cloud }) => ({
      value: candidate,
      creationTime: candidate._creationTime,
      hasCloudReplica: Boolean(cloud),
    })));
    if (existingReplica) {
      const changed = Boolean(input.contentHash && input.contentHash !== existingReplica.contentHash);
      await ctx.db.patch(existingReplica._id, {
        mountId: mount._id,
        localResourceId: input.localResourceId,
        relativePath: input.relativePath,
        ...(changed ? { state: "ahead" as const } : {}),
        updatedAt: Date.now(),
      });
      for (const duplicate of candidates.filter((candidate) => candidate._id !== existingReplica._id)) {
        const duplicateCloud = await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", duplicate.workId).eq("kind", "cloud")).first();
        if (duplicateCloud) continue;
        await ctx.db.patch(duplicate.workId, { status: "deleted", updatedAt: Date.now() });
        await purgeSourceNodes(ctx, "work", String(duplicate.workId));
        await ctx.db.delete(duplicate._id);
      }
      return {
        workId: existingReplica.workId,
        replicaId: existingReplica._id,
        revision: existingReplica.revision,
        payloadHash: existingReplica.contentHash,
        needsPayload: ["docx", "docm"].includes(input.nativeFormat) &&
          (!existingReplica.payloadRef || input.contentHash !== existingReplica.contentHash),
      };
    }
    const parts = input.relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
    const title = parts.pop()!;
    const parentId = await ensureFolderPath(ctx, actor.accountId, actor.schoolId, mount.rootOrgNodeId, parts);
    const now = Date.now();
    const workId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: actor.accountId, schoolId: actor.schoolId, blueprintKey: "resource", resourceClass: "resource", nativeFormat: input.nativeFormat, compatibilityProfile: "strict-native", title, summary: `${input.size} bytes`, content: null, schemaVersion: 1, contentHash: input.contentHash, tags: [], status: "active", createdFrom: { source: "manual" }, createdAt: now, updatedAt: now });
    const replicaId = await ctx.db.insert("workReplicas", { accountId: actor.accountId, workId, kind: "local", deviceId: device._id, mountId: mount._id, localResourceId: input.localResourceId, relativePath: input.relativePath, nativeFormat: input.nativeFormat, revision: input.contentHash ?? `discovered:${input.localResourceId}`, contentHash: input.contentHash, state: "current", lastVerifiedAt: now, updatedAt: now });
    await placeSourceNode(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, kind: "work", sourceId: String(workId), name: title, target: { parentId }, typeKey: "resource", placedByAccountId: actor.accountId });
    return {
      workId,
      replicaId,
      revision: input.contentHash ?? `discovered:${input.localResourceId}`,
      payloadHash: undefined,
      needsPayload: ["docx", "docm"].includes(input.nativeFormat),
    };
  },
});

export const beginPayloadUpload = mutation({
  args: {
    credential: v.string(),
    replicaId: v.id("workReplicas"),
    hash: v.string(),
    bytes: v.number(),
    mediaType: v.string(),
  },
  handler: async (ctx, args) => {
    const { device } = await requireDevice(ctx, args.credential);
    const input = z.object({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().min(0).max(100 * 1024 * 1024),
      mediaType: z.string().min(1).max(120),
    }).parse(args);
    const replica = await ctx.db.get(args.replicaId);
    if (!replica || replica.accountId !== device.accountId || replica.deviceId !== device._id)
      throw new Error("REPLICA_NOT_OWNED_BY_DEVICE");
    const existing = await ctx.db.query("payloadObjects")
      .withIndex("by_account_hash", (q) => q.eq("accountId", device.accountId).eq("hash", input.hash))
      .unique();
    if (existing?.state === "active")
      return { deduplicated: true as const, payloadRef: String(existing._id) };
    return { deduplicated: false as const, uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const commitPayloadUpload = mutation({
  args: {
    credential: v.string(),
    replicaId: v.id("workReplicas"),
    hash: v.string(),
    bytes: v.number(),
    mediaType: v.string(),
    storageId: v.optional(v.id("_storage")),
    payloadRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { device } = await requireDevice(ctx, args.credential);
    const input = z.object({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().min(0).max(100 * 1024 * 1024),
      mediaType: z.string().min(1).max(120),
      payloadRef: z.string().optional(),
    }).parse(args);
    const replica = await ctx.db.get(args.replicaId);
    if (!replica || replica.accountId !== device.accountId || replica.deviceId !== device._id)
      throw new Error("REPLICA_NOT_OWNED_BY_DEVICE");
    let payload = await ctx.db.query("payloadObjects")
      .withIndex("by_account_hash", (q) => q.eq("accountId", device.accountId).eq("hash", input.hash))
      .unique();
    if (!payload) {
      if (!args.storageId) throw new Error("PAYLOAD_STORAGE_REQUIRED");
      const metadata = await ctx.db.system.get(args.storageId);
      if (!metadata || metadata.size !== input.bytes) throw new Error("PAYLOAD_SIZE_MISMATCH");
      const payloadId = await ctx.db.insert("payloadObjects", {
        accountId: device.accountId,
        hash: input.hash,
        storageId: args.storageId,
        bytes: input.bytes,
        mediaType: input.mediaType,
        refCount: 1,
        state: "active",
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      });
      payload = (await ctx.db.get(payloadId))!;
    } else if (args.storageId && args.storageId !== payload.storageId) {
      await ctx.storage.delete(args.storageId);
    }
    if (input.payloadRef && input.payloadRef !== String(payload._id))
      throw new Error("PAYLOAD_REFERENCE_MISMATCH");
    const now = Date.now();
    const externalChange = Boolean(replica.payloadRef && replica.contentHash !== input.hash);
    await ctx.db.patch(replica._id, {
      payloadRef: String(payload._id),
      baseRevision: externalChange ? replica.revision : replica.baseRevision,
      revision: input.hash,
      contentHash: input.hash,
      state: externalChange ? "ahead" : "current",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    const cloud = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", (q) => q.eq("workId", replica.workId).eq("kind", "cloud"))
      .unique();
    if (!cloud) {
      await ctx.db.insert("workReplicas", {
        accountId: device.accountId,
        workId: replica.workId,
        kind: "cloud",
        nativeFormat: replica.nativeFormat,
        payloadRef: String(payload._id),
        preservedCarryVersion: 1,
        compatibilityProfile: "strict-native",
        revision: input.hash,
        contentHash: input.hash,
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now,
      });
    }
    if (externalChange) {
      await ctx.db.insert("syncOperations", {
        accountId: device.accountId,
        workId: replica.workId,
        replicaId: replica._id,
        idempotencyKey: `external:${replica._id}:${input.hash}`,
        direction: "external",
        revisionBefore: replica.revision,
        revisionAfter: input.hash,
        state: "pending",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(device._id, { lastSeenAt: now });
    return { payloadRef: String(payload._id), externalChange };
  },
});

export const claimWrite = mutation({
  args: { credential: v.string() },
  handler: async (ctx, args) => {
    const { device } = await requireDevice(ctx, args.credential);
    const now = Date.now();
    const pending = await ctx.db.query("bridgeWriteRequests")
      .withIndex("by_device_state", (q) => q.eq("deviceId", device._id).eq("state", "pending"))
      .first();
    const request = pending ?? (await ctx.db.query("bridgeWriteRequests")
      .withIndex("by_device_state", (q) => q.eq("deviceId", device._id).eq("state", "claimed"))
      .filter((q) => q.lt(q.field("claimedAt"), now - 60_000))
      .first());
    if (!request) return { request: null };
    const payloadId = ctx.db.normalizeId("payloadObjects", request.payloadRef);
    const payload = payloadId ? await ctx.db.get(payloadId) : null;
    const mount = await ctx.db.get(request.mountId);
    if (!payload || payload.state !== "active" || !mount || mount.deviceId !== device._id)
      throw new Error("WRITE_PAYLOAD_UNAVAILABLE");
    await ctx.db.patch(request._id, { state: "claimed", claimedAt: now, updatedAt: now });
    return { request: {
      requestId: request._id,
      replicaId: request.replicaId,
      grantId: mount.grantId,
      localResourceId: request.localResourceId,
      relativePath: request.relativePath,
      baseRevision: request.baseRevision,
      targetRevision: request.targetRevision,
      contentHash: request.contentHash,
      idempotencyKey: request.idempotencyKey,
      payloadUrl: await ctx.storage.getUrl(payload.storageId),
    } };
  },
});

export const completeWrite = mutation({
  args: {
    credential: v.string(),
    requestId: v.id("bridgeWriteRequests"),
    outcome: v.union(v.literal("verified"), v.literal("waiting"), v.literal("conflicted"), v.literal("failed")),
    actualRevision: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { device } = await requireDevice(ctx, args.credential);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.deviceId !== device._id || request.accountId !== device.accountId)
      throw new Error("WRITE_REQUEST_NOT_OWNED_BY_DEVICE");
    const operation = await ctx.db.query("syncOperations")
      .withIndex("by_account_key", (q) => q.eq("accountId", device.accountId).eq("idempotencyKey", request.idempotencyKey))
      .unique();
    const now = Date.now();
    if (args.outcome === "waiting") {
      await ctx.db.patch(request._id, {
        state: "pending",
        errorCode: args.errorCode ?? "office-locked",
        errorMessage: args.errorMessage,
        claimedAt: undefined,
        updatedAt: now,
      });
      return { state: "pending" as const };
    }
    if (args.outcome === "verified") {
      await ctx.db.patch(request.replicaId, {
        payloadRef: request.payloadRef,
        baseRevision: request.baseRevision,
        revision: request.targetRevision,
        contentHash: request.contentHash,
        state: "current",
        lastVerifiedAt: now,
        errorCode: undefined,
        errorMessage: undefined,
        errorAt: undefined,
        updatedAt: now,
      });
      await ctx.db.patch(request._id, { state: "verified", errorCode: undefined, errorMessage: undefined, updatedAt: now });
      if (operation) await ctx.db.patch(operation._id, { state: "verified", updatedAt: now });
      return { state: "verified" as const };
    }
    const conflicted = args.outcome === "conflicted";
    await ctx.db.patch(request._id, {
      state: conflicted ? "conflicted" : "failed",
      errorCode: args.errorCode ?? (conflicted ? "stale-revision" : "write-failed"),
      errorMessage: args.errorMessage,
      updatedAt: now,
    });
    await ctx.db.patch(request.replicaId, {
      state: conflicted ? "diverged" : "error",
      errorCode: args.errorCode ?? (conflicted ? "stale-revision" : "write-failed"),
      errorMessage: args.errorMessage,
      errorAt: now,
      updatedAt: now,
    });
    if (operation) await ctx.db.patch(operation._id, { state: conflicted ? "conflicted" : "failed", errorCode: args.errorCode, updatedAt: now });
    if (conflicted) {
      await ctx.db.insert("syncConflicts", {
        accountId: device.accountId,
        workId: request.workId,
        replicaIds: [request.replicaId],
        regionIds: request.regionIds,
        partNames: request.partNames,
        localRevision: args.actualRevision ?? request.baseRevision,
        spectraRevision: request.targetRevision,
        state: "open",
        createdAt: now,
      });
    }
    return { state: conflicted ? "conflicted" as const : "failed" as const };
  },
});

export const detachGrant = mutation({
  args: { credential: v.string(), grantId: v.string() },
  handler: async (ctx, args) => {
    const { device, actor } = await requireDevice(ctx, args.credential);
    const grantId = z.string().regex(/^grant_[a-f0-9]+$/).parse(args.grantId);
    const mount = await ctx.db.query("bridgeMounts").withIndex("by_device_grant", (q) => q.eq("deviceId", device._id).eq("grantId", grantId)).unique();
    if (mount && mount.accountId !== actor.accountId) throw new Error("MOUNT_NOT_OWNED_BY_DEVICE");
    if (mount) {
      const rootNode = mount.rootOrgNodeId ? await ctx.db.get(mount.rootOrgNodeId) : null;
      if (rootNode && rootNode.accountId === actor.accountId && rootNode.deletedAt === undefined) {
        await trashNode(ctx, rootNode);
      }
      await ctx.db.patch(mount._id, { state: "detached", updatedAt: Date.now() });
    }
    return true;
  },
});

export const migrateCloudReplicaPage = mutation({
  args: { credential: v.string(), cursor: v.optional(v.string()), numItems: v.number(), dryRun: v.boolean() },
  handler: async (ctx, args) => {
    const { actor } = await requireDevice(ctx, args.credential);
    const numItems = Math.min(100, Math.max(1, Math.trunc(args.numItems)));
    const page = await ctx.db.query("spectraArtifacts").withIndex("by_account_status", (q) => q.eq("ownerAccountId", actor.accountId)).paginate({ cursor: args.cursor ?? null, numItems });
    let missing = 0; let inserted = 0; let duplicates = 0; let localOnly = 0;
    for (const work of page.page) {
      const cloud = await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", work._id).eq("kind", "cloud")).take(2);
      if (cloud.length > 1) duplicates += cloud.length - 1;
      if (cloud.length) continue;
      const local = await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", work._id).eq("kind", "local")).first();
      if (local) { localOnly += 1; continue; }
      missing += 1;
      if (!args.dryRun) {
        const now = Date.now(); const revision = work.contentHash ?? String(work.currentVersionId ?? work._id);
        const replicaId = await ctx.db.insert("workReplicas", { accountId: actor.accountId, workId: work._id, kind: "cloud", nativeFormat: work.nativeFormat ?? "spectra-pkg", revision, contentHash: work.contentHash, state: "current", lastVerifiedAt: now, updatedAt: now });
        await ctx.db.insert("syncOperations", { accountId: actor.accountId, workId: work._id, replicaId, idempotencyKey: `migration:${work._id}`, direction: "migration", revisionAfter: revision, state: "verified", actorKind: "migration", createdAt: now, updatedAt: now });
        inserted += 1;
      }
    }
    return { continueCursor: page.continueCursor, isDone: page.isDone, scanned: page.page.length, missing, inserted, duplicates, localOnly };
  },
});

export const reportRevision = mutation({
  args: { credential: v.string(), replicaId: v.id("workReplicas"), idempotencyKey: v.string(), revisionBefore: v.string(), revisionAfter: v.string(), contentHash: v.string() },
  handler: async (ctx, args) => {
    const input = z.object({ credential: z.string().min(32).max(256), idempotencyKey: z.string().uuid(), revisionBefore: z.string().min(1).max(200), revisionAfter: z.string().min(1).max(200), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(args);
    const { device } = await requireDevice(ctx, input.credential);
    const replica = await ctx.db.get(args.replicaId); if (!replica || replica.accountId !== device.accountId || replica.deviceId !== device._id) throw new Error("REPLICA_NOT_OWNED_BY_DEVICE");
    const existing = await ctx.db.query("syncOperations").withIndex("by_account_key", (q) => q.eq("accountId", device.accountId).eq("idempotencyKey", input.idempotencyKey)).unique(); if (existing) return { state: existing.state, operationId: existing._id };
    const now = Date.now();
    if (replica.revision !== input.revisionBefore) {
      const operationId = await ctx.db.insert("syncOperations", { accountId: device.accountId, workId: replica.workId, replicaId: replica._id, idempotencyKey: input.idempotencyKey, direction: "local-to-cloud", revisionBefore: input.revisionBefore, revisionAfter: input.revisionAfter, state: "conflicted", actorKind: "external-edit", errorCode: "stale-revision", createdAt: now, updatedAt: now });
      await ctx.db.patch(replica._id, { state: "diverged", updatedAt: now }); return { state: "conflicted" as const, operationId };
    }
    const operationId = await ctx.db.insert("syncOperations", { accountId: device.accountId, workId: replica.workId, replicaId: replica._id, idempotencyKey: input.idempotencyKey, direction: "local-to-cloud", revisionBefore: input.revisionBefore, revisionAfter: input.revisionAfter, state: "verified", actorKind: "external-edit", createdAt: now, updatedAt: now });
    await ctx.db.patch(replica._id, { revision: input.revisionAfter, baseRevision: input.revisionBefore, contentHash: input.contentHash, state: "current", lastVerifiedAt: now, updatedAt: now });
    await ctx.db.patch(device._id, { lastSeenAt: now }); return { state: "verified" as const, operationId };
  },
});
