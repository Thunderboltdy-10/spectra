import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getActorForAccountId, getAuthenticatedActor } from "./identityShared";
import { createFolderNode, placeSourceNode, purgeSourceNodes, trashNode, findPrimaryNode, moveNode, renameNode, restoreTrashedNode } from "./orgTreeShared";
import { z } from "zod";
import { chooseReplicaContinuity } from "./bridgeIdentity";
import { activeReplicaWriteTarget } from "./bridgeIdentity";
import { computeEffectivePolicy } from "./syncPolicy";
import { decideMissingResourceAction, policyIncludesPath } from "../shared/sync-policy";
import { policyAllowsTrigger } from "../shared/sync-policy";
import { formatByteCount } from "../shared/human-format";

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
  args: { credential: v.string(), rootLabel: v.string(), grantId: v.string(), rootKey: v.string(), scanId: v.string(), fileCount: v.number(), doubleSyncRisk: v.boolean(), ownerLockPaths: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { device, actor } = await requireDevice(ctx, args.credential);
    const input = z.object({
      rootLabel: z.string().trim().min(1).max(120),
      grantId: z.string().regex(/^grant_[a-f0-9]+$/),
      rootKey: z.string().regex(/^[a-f0-9]{64}$/),
      fileCount: z.number().int().min(0).max(10_000_000),
      doubleSyncRisk: z.boolean(),
      scanId: z.string().uuid(),
      ownerLockPaths: z.array(z.string().min(1).max(1024)).max(500),
    }).parse(args);
    const byRootKey = await ctx.db.query("bridgeMounts").withIndex("by_device_root_key", (q) => q.eq("deviceId", device._id).eq("rootKey", input.rootKey)).unique();
    const [activeMounts, detachedMounts] = await Promise.all([
      ctx.db.query("bridgeMounts").withIndex("by_device_state", (q) => q.eq("deviceId", device._id).eq("state", "active")).take(500),
      ctx.db.query("bridgeMounts").withIndex("by_device_state", (q) => q.eq("deviceId", device._id).eq("state", "detached")).take(500),
    ]);
    const sameLabelLegacy = [...activeMounts, ...detachedMounts].filter((mount) => mount.rootLabel === input.rootLabel && !mount.rootKey);
    const byGrant = await ctx.db.query("bridgeMounts").withIndex("by_device_grant", (q) => q.eq("deviceId", device._id).eq("grantId", input.grantId)).unique();
    const existing = byRootKey ?? byGrant ?? (sameLabelLegacy.length === 1 ? sameLabelLegacy[0] : null);
    const now = Date.now();
    if (existing) {
      const existingRoot = existing.rootOrgNodeId ? await ctx.db.get(existing.rootOrgNodeId) : null;
      if (existingRoot?.deletedAt !== undefined) await restoreTrashedNode(ctx, existingRoot);
      await ctx.db.patch(existing._id, { rootLabel: input.rootLabel, grantId: input.grantId, rootKey: input.rootKey, fileCount: input.fileCount, doubleSyncRisk: input.doubleSyncRisk, state: "active", lastScanAt: now, lastScanId: input.scanId, updatedAt: now });
      for (const ownerLockPath of input.ownerLockPaths) {
        const staleOwnerLocks = await ctx.db.query("workReplicas")
          .withIndex("by_device_mount_path", (q) =>
            q.eq("deviceId", device._id).eq("mountId", existing._id).eq("relativePath", ownerLockPath),
          )
          .take(20);
        for (const replica of staleOwnerLocks) {
          const cloud = await ctx.db.query("workReplicas")
            .withIndex("by_work_kind", (q) => q.eq("workId", replica.workId).eq("kind", "cloud"))
            .first();
          if (!cloud) {
            await ctx.db.patch(replica.workId, { status: "deleted", updatedAt: now });
            await purgeSourceNodes(ctx, "work", String(replica.workId));
            await ctx.db.delete(replica._id);
          }
        }
      }
      const duplicates = sameLabelLegacy.filter((mount) => mount._id !== existing!._id);
      for (const duplicate of duplicates) {
        const [replicas, pendingFs, claimedFs, pendingWrites, claimedWrites] = await Promise.all([
          ctx.db.query("workReplicas").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId)).filter((q) => q.eq(q.field("mountId"), duplicate._id)).take(2_000),
          ctx.db.query("bridgeFsRequests").withIndex("by_device_state", (q) => q.eq("deviceId", device._id).eq("state", "pending")).filter((q) => q.eq(q.field("mountId"), duplicate._id)).take(2_000),
          ctx.db.query("bridgeFsRequests").withIndex("by_device_state", (q) => q.eq("deviceId", device._id).eq("state", "claimed")).filter((q) => q.eq(q.field("mountId"), duplicate._id)).take(2_000),
          ctx.db.query("bridgeWriteRequests").withIndex("by_device_state", (q) => q.eq("deviceId", device._id).eq("state", "pending")).filter((q) => q.eq(q.field("mountId"), duplicate._id)).take(2_000),
          ctx.db.query("bridgeWriteRequests").withIndex("by_device_state", (q) => q.eq("deviceId", device._id).eq("state", "claimed")).filter((q) => q.eq(q.field("mountId"), duplicate._id)).take(2_000),
        ]);
        await Promise.all([
          ...replicas.map((replica) => ctx.db.patch(replica._id, { mountId: existing!._id, updatedAt: now })),
          ...pendingFs.map((request) => ctx.db.patch(request._id, { mountId: existing!._id, updatedAt: now })),
          ...claimedFs.map((request) => ctx.db.patch(request._id, { mountId: existing!._id, updatedAt: now })),
          ...pendingWrites.map((request) => ctx.db.patch(request._id, { mountId: existing!._id, updatedAt: now })),
          ...claimedWrites.map((request) => ctx.db.patch(request._id, { mountId: existing!._id, updatedAt: now })),
          ctx.db.patch(duplicate._id, { state: "revoked", updatedAt: now }),
        ]);
      }
      return existing._id;
    }
    const rootNode = await createFolderNode(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, name: input.rootLabel });
    return ctx.db.insert("bridgeMounts", { accountId: actor.accountId, deviceId: device._id, rootLabel: input.rootLabel, grantId: input.grantId, rootKey: input.rootKey, rootOrgNodeId: rootNode._id, state: "active", fileCount: input.fileCount, doubleSyncRisk: input.doubleSyncRisk, lastScanAt: now, lastScanId: input.scanId, createdAt: now, updatedAt: now });
  },
});

/** Reconcile resources absent from a completed scan without deleting bytes. */
export const reconcileMissingResources = mutation({
  args: { credential: v.string(), mountId: v.id("bridgeMounts"), scanId: v.string() },
  handler: async (ctx, args) => {
    const { device, actor } = await requireDevice(ctx, args.credential);
    const mount = await ctx.db.get(args.mountId);
    if (!mount || mount.deviceId !== device._id || mount.accountId !== actor.accountId || mount.lastScanId !== args.scanId) throw new Error("MOUNT_SCAN_NOT_CURRENT");
    const replicas = await ctx.db.query("workReplicas").withIndex("by_mount", (q) => q.eq("mountId", mount._id)).take(10_000);
    let unavailable = 0;
    let restoring = 0;
    for (const replica of replicas) {
      if (replica.kind !== "local" || replica.lastSeenScanId === args.scanId || replica.state === "unavailable") continue;
      const policy = await computeEffectivePolicy(ctx, actor.accountId, { account: String(actor.accountId), mount: String(mount._id), item: String(replica.workId) });
      const cloud = await ctx.db.query("workReplicas")
        .withIndex("by_work_kind", (q) => q.eq("workId", replica.workId).eq("kind", "cloud"))
        .unique();
      const action = decideMissingResourceAction(policy.structure, Boolean(cloud?.payloadRef && cloud.contentHash));
      if (action === "restore-to-disk" && cloud?.payloadRef && cloud.contentHash && replica.deviceId && replica.mountId && replica.localResourceId && replica.relativePath) {
        const idempotencyKey = `restore:${replica._id}:${cloud.contentHash}`;
        const existing = await ctx.db.query("bridgeWriteRequests")
          .withIndex("by_account_key", (q) => q.eq("accountId", actor.accountId).eq("idempotencyKey", idempotencyKey))
          .unique();
        if (!existing) {
          const now = Date.now();
          await ctx.db.insert("bridgeWriteRequests", {
            accountId: actor.accountId,
            workId: replica.workId,
            replicaId: replica._id,
            deviceId: replica.deviceId,
            mountId: replica.mountId,
            localResourceId: replica.localResourceId,
            relativePath: replica.relativePath,
            payloadRef: cloud.payloadRef,
            baseRevision: replica.revision,
            targetRevision: cloud.revision,
            contentHash: cloud.contentHash,
            idempotencyKey,
            regionIds: [],
            partNames: [],
            state: "pending",
            createdAt: now,
            updatedAt: now,
          });
          await ctx.db.insert("syncOperations", {
            accountId: actor.accountId,
            workId: replica.workId,
            replicaId: replica._id,
            idempotencyKey,
            direction: "cloud-to-local",
            revisionBefore: replica.revision,
            revisionAfter: cloud.revision,
            state: "pending",
            actorKind: "restore",
            createdAt: now,
            updatedAt: now,
          });
        }
        await ctx.db.patch(replica._id, { state: "pending", unavailableReason: "restoring-from-cloud", updatedAt: Date.now() });
        restoring += 1;
        continue;
      }
      const reason = action === "ask" ? "missing-awaiting-decision" : "missing-on-disk";
      await ctx.db.patch(replica._id, { state: "unavailable", unavailableReason: reason, updatedAt: Date.now() });
      unavailable += 1;
    }
    return { unavailable, restoring };
  },
});

/** Re-drive claims lost with a dead Bridge and surface writes with no journal. */
export const sweepStaleBridgeWork = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - 2 * 60_000;
    const [abandonedWrites, abandonedFs] = await Promise.all([
      ctx.db
        .query("bridgeWriteRequests")
        .withIndex("by_state_updated", (q) =>
          q.eq("state", "claimed").lt("updatedAt", cutoff),
        )
        .take(100),
      ctx.db
        .query("bridgeFsRequests")
        .withIndex("by_state_updated", (q) =>
          q.eq("state", "claimed").lt("updatedAt", cutoff),
        )
        .take(100),
    ]);
    await Promise.all([
      ...abandonedWrites.map((request) =>
        ctx.db.patch(request._id, {
          state: "pending",
          claimedAt: undefined,
          updatedAt: now,
        }),
      ),
      ...abandonedFs.map((request) =>
        ctx.db.patch(request._id, {
          state: "pending",
          claimedAt: undefined,
          updatedAt: now,
        }),
      ),
    ]);

    const [staleReplicas, pendingWrites, pendingFs] = await Promise.all([
      ctx.db
        .query("workReplicas")
        .withIndex("by_state_updated", (q) =>
          q.eq("state", "pending").lt("updatedAt", cutoff),
        )
        .take(100),
      ctx.db
        .query("bridgeWriteRequests")
        .withIndex("by_state_updated", (q) =>
          q.eq("state", "pending").lt("updatedAt", now),
        )
        .take(500),
      ctx.db
        .query("bridgeFsRequests")
        .withIndex("by_state_updated", (q) =>
          q.eq("state", "pending").lt("updatedAt", now),
        )
        .take(500),
    ]);
    let failedReplicas = 0;
    for (const replica of staleReplicas) {
      const active =
        pendingWrites.some((request) => request.replicaId === replica._id) ||
        pendingFs.some((request) => request.replicaId === replica._id) ||
        abandonedWrites.some((request) => request.replicaId === replica._id) ||
        abandonedFs.some((request) => request.replicaId === replica._id);
      if (active) continue;
      await ctx.db.patch(replica._id, {
        state: "error",
        errorCode: "BRIDGE_WRITE_ABANDONED",
        errorMessage: "The Bridge write did not finish. Try again.",
        errorAt: now,
        updatedAt: now,
      });
      failedReplicas += 1;
    }
    return {
      redriven: abandonedWrites.length + abandonedFs.length,
      failedReplicas,
    };
  },
});

export const discoverResource = mutation({
  args: { credential: v.string(), mountId: v.id("bridgeMounts"), localResourceId: v.string(), relativePath: v.string(), size: v.number(), contentHash: v.optional(v.string()), nativeFormat: v.string() },
  handler: async (ctx, args) => {
    const { device, actor } = await requireDevice(ctx, args.credential);
    const mount = await ctx.db.get(args.mountId);
    if (!mount || mount.deviceId !== device._id || mount.accountId !== actor.accountId || !mount.rootOrgNodeId || mount.state !== "active") throw new Error("MOUNT_NOT_ACTIVE");
    const input = z.object({ localResourceId: z.string().regex(/^lr_[a-f0-9]+$/), relativePath: z.string().min(1).max(1024).refine((value) => !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes("..")), size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), nativeFormat: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/) }).parse(args);
    const isOfficeOwnerLock = input.relativePath.replaceAll("\\", "/").split("/").pop()?.startsWith("~$") ?? false;
    if (isOfficeOwnerLock) {
      // A previous Bridge version could have projected an Office owner-lock
      // into the Library. Clean only that stale logical projection when it has
      // no cloud replica; the physical ~$ file is never touched here.
      const stale = await ctx.db.query("workReplicas")
        .withIndex("by_device_resource", (q) => q.eq("deviceId", device._id).eq("localResourceId", input.localResourceId))
        .take(20);
      for (const replica of stale) {
        const cloud = await ctx.db.query("workReplicas")
          .withIndex("by_work_kind", (q) => q.eq("workId", replica.workId).eq("kind", "cloud"))
          .first();
        if (!cloud) {
          await ctx.db.patch(replica.workId, { status: "deleted", updatedAt: Date.now() });
          await purgeSourceNodes(ctx, "work", String(replica.workId));
          await ctx.db.delete(replica._id);
        }
      }
      return { skipped: true as const, reason: "office-lock" as const };
    }
    const mountPolicy = await computeEffectivePolicy(ctx, actor.accountId, { account: String(actor.accountId), mount: String(mount._id) });
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
      const existingNode = await findPrimaryNode(ctx, actor.accountId, "work", String(existingReplica.workId));
      if (existingNode?.deletedAt !== undefined) await restoreTrashedNode(ctx, existingNode);
      const policy = await computeEffectivePolicy(ctx, actor.accountId, {
        account: String(actor.accountId),
        mount: String(mount._id),
        item: String(existingReplica.workId),
      });
      const nativePayloadAllowed = policy.cloudContent === "full";
      const changed = Boolean(input.contentHash && input.contentHash !== existingReplica.contentHash);
      const previousPath = existingReplica.relativePath;
      const verifiedAt = Date.now();
      await ctx.db.patch(existingReplica._id, {
        mountId: mount._id,
        localResourceId: input.localResourceId,
        relativePath: input.relativePath,
        ...(changed
          ? { state: "ahead" as const }
          : existingReplica.state === "unavailable"
            ? { state: "current" as const, unavailableReason: undefined, errorCode: undefined, errorMessage: undefined, errorAt: undefined }
            : {}),
        lastVerifiedAt: input.contentHash ? verifiedAt : existingReplica.lastVerifiedAt,
        lastSeenScanId: mount.lastScanId,
        updatedAt: verifiedAt,
      });
      if (previousPath && previousPath !== input.relativePath) {
        if (policy.structure === "mirror-from-disk" || policy.structure === "mirror-both") {
          const node = await findPrimaryNode(ctx, actor.accountId, "work", String(existingReplica.workId));
          if (node) {
            const nextParts = input.relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
            const nextName = nextParts.pop()!;
            const nextParent = await ensureFolderPath(ctx, actor.accountId, actor.schoolId, mount.rootOrgNodeId, nextParts);
            if (node.parentId !== nextParent) await moveNode(ctx, node, { parentId: nextParent });
            if (node.name !== nextName) await renameNode(ctx, node, nextName);
          }
        }
      }
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
        needsPayload: nativePayloadAllowed && ["docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "xlam", "pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "ppam", "spectra-pkg"].includes(input.nativeFormat) &&
          (!existingReplica.payloadRef || input.contentHash !== existingReplica.contentHash),
      };
    }
    let discoveryRequest = await ctx.db.query("syncDiscoveryRequests")
      .withIndex("by_device_resource", (q) => q.eq("deviceId", device._id).eq("localResourceId", input.localResourceId))
      .unique();
    if (mountPolicy.source.kind !== "default") {
      if (!policyIncludesPath(mountPolicy, input.relativePath)) return { skipped: true as const, reason: "filtered" as const };
      if (mountPolicy.discovery === "explicit") return { skipped: true as const, reason: "explicit-only" as const };
      if (mountPolicy.discovery === "ask") {
        if (discoveryRequest?.state === "ignored")
          return { skipped: true as const, reason: "ignored-by-user" as const };
        if (discoveryRequest?.state !== "approved") {
          const now = Date.now();
          if (discoveryRequest) {
            await ctx.db.patch(discoveryRequest._id, {
              mountId: mount._id,
              relativePath: input.relativePath,
              size: input.size,
              contentHash: input.contentHash,
              nativeFormat: input.nativeFormat,
              state: "pending",
              updatedAt: now,
            });
          } else {
            const requestId = await ctx.db.insert("syncDiscoveryRequests", {
              accountId: actor.accountId,
              deviceId: device._id,
              mountId: mount._id,
              localResourceId: input.localResourceId,
              relativePath: input.relativePath,
              size: input.size,
              contentHash: input.contentHash,
              nativeFormat: input.nativeFormat,
              state: "pending",
              createdAt: now,
              updatedAt: now,
            });
            discoveryRequest = await ctx.db.get(requestId);
          }
          return { skipped: true as const, reason: "approval-required" as const };
        }
      }
    }
    const parts = input.relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
    const title = parts.pop()!;
    const parentId = await ensureFolderPath(ctx, actor.accountId, actor.schoolId, mount.rootOrgNodeId, parts);
    const now = Date.now();
    const workId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: actor.accountId, schoolId: actor.schoolId, blueprintKey: "resource", resourceClass: "resource", nativeFormat: input.nativeFormat, compatibilityProfile: "strict-native", title, summary: formatByteCount(input.size), content: null, schemaVersion: 1, contentHash: input.contentHash, tags: [], status: "active", createdFrom: { source: "manual" }, createdAt: now, updatedAt: now });
    const replicaId = await ctx.db.insert("workReplicas", { accountId: actor.accountId, workId, kind: "local", deviceId: device._id, mountId: mount._id, localResourceId: input.localResourceId, relativePath: input.relativePath, nativeFormat: input.nativeFormat, revision: input.contentHash ?? `discovered:${input.localResourceId}`, contentHash: input.contentHash, state: "current", lastVerifiedAt: now, lastSeenScanId: mount.lastScanId, updatedAt: now });
    await placeSourceNode(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, kind: "work", sourceId: String(workId), name: title, target: { parentId }, typeKey: "resource", placedByAccountId: actor.accountId });
    if (discoveryRequest) await ctx.db.delete(discoveryRequest._id);
    return {
      workId,
      replicaId,
      revision: input.contentHash ?? `discovered:${input.localResourceId}`,
      payloadHash: undefined,
      needsPayload: mountPolicy.cloudContent === "full" && ["docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "xlam", "pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "ppam", "spectra-pkg"].includes(input.nativeFormat),
    };
  },
});

export const pendingDiscovery = query({
  args: { mountId: v.optional(v.id("bridgeMounts")) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const mounts = args.mountId
      ? [await ctx.db.get(args.mountId)]
      : await ctx.db.query("bridgeMounts")
          .withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId).eq("state", "active"))
          .take(100);
    const rows = [];
    for (const mount of mounts) {
      if (!mount || mount.accountId !== actor.accountId) continue;
      const pending = await ctx.db.query("syncDiscoveryRequests")
        .withIndex("by_mount_state", (q) => q.eq("mountId", mount._id).eq("state", "pending"))
        .take(200);
      rows.push(...pending.map((request) => ({ ...request, mountLabel: mount.rootLabel })));
    }
    return rows.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  },
});

export const resolveDiscovery = mutation({
  args: {
    requestIds: v.array(v.id("syncDiscoveryRequests")),
    action: v.union(v.literal("approve"), v.literal("ignore")),
    alwaysHere: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    if (!args.requestIds.length || args.requestIds.length > 200)
      throw new Error("DISCOVERY_REQUEST_COUNT_INVALID");
    const now = Date.now();
    const requests = await Promise.all(args.requestIds.map((id) => ctx.db.get(id)));
    const owned = requests.filter((request) => request?.accountId === actor.accountId);
    if (owned.length !== args.requestIds.length) throw new Error("DISCOVERY_REQUEST_NOT_FOUND");
    await Promise.all(owned.map((request) => ctx.db.patch(request!._id, {
      state: args.action === "approve" ? "approved" : "ignored",
      updatedAt: now,
    })));
    if (args.action === "approve" && args.alwaysHere) {
      const mountIds = [...new Set(owned.map((request) => request!.mountId))];
      for (const mountId of mountIds) {
        const existing = await ctx.db.query("syncPolicies")
          .withIndex("by_account_scope", (q) => q.eq("accountId", actor.accountId).eq("scopeKind", "mount").eq("scopeId", String(mountId)))
          .unique();
        if (existing) await ctx.db.patch(existing._id, { discovery: "auto", updatedAt: now });
      }
    }
    return { resolved: owned.length, rescanRequired: args.action === "approve" };
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
    const policy = await computeEffectivePolicy(ctx, device.accountId, { account: String(device.accountId), mount: replica.mountId ? String(replica.mountId) : undefined, item: String(replica.workId) });
    if (policy.source.kind !== "default" && policy.cloudContent !== "full")
      throw new Error(policy.cloudContent === "none" ? "CLOUD_CONTENT_DISABLED" : "CLOUD_CONTENT_METADATA_ONLY");
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
    const cloud = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", (q) => q.eq("workId", replica.workId).eq("kind", "cloud"))
      .unique();
    const isFirstCloudPayload = !cloud?.payloadRef;
    const cloudChangedSinceReplicaBase = Boolean(
      cloud?.payloadRef &&
      replica.baseRevision &&
      cloud.contentHash &&
      cloud.contentHash !== replica.baseRevision &&
      cloud.contentHash !== input.hash,
    );
    const externalChange = Boolean(replica.payloadRef && replica.contentHash !== input.hash);
    if (cloudChangedSinceReplicaBase && !isFirstCloudPayload) {
      const operationKey = `external:${replica._id}:${input.hash}`;
      const existingOperation = await ctx.db.query("syncOperations")
        .withIndex("by_account_key", (q) => q.eq("accountId", device.accountId).eq("idempotencyKey", operationKey))
        .unique();
      await ctx.db.patch(replica._id, {
        payloadRef: String(payload._id),
        baseRevision: replica.revision,
        revision: input.hash,
        contentHash: input.hash,
        state: "diverged",
        updatedAt: now,
      });
      if (!existingOperation) {
        await ctx.db.insert("syncOperations", {
          accountId: device.accountId,
          workId: replica.workId,
          replicaId: replica._id,
          idempotencyKey: operationKey,
          direction: "external",
          revisionBefore: replica.revision,
          revisionAfter: input.hash,
          state: "conflicted",
          actorKind: "external-edit",
          errorCode: "stale-revision",
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("syncConflicts", {
          accountId: device.accountId,
          workId: replica.workId,
          replicaIds: [replica._id, cloud._id],
          regionIds: [],
          partNames: [],
          localRevision: input.hash,
          spectraRevision: cloud.revision,
          state: "open",
          createdAt: now,
        });
      }
      await ctx.db.patch(cloud._id, { state: "diverged", updatedAt: now });
      await ctx.db.patch(device._id, { lastSeenAt: now });
      return { payloadRef: String(payload._id), externalChange: true, conflicted: true };
    }
    await ctx.db.patch(replica._id, {
      payloadRef: String(payload._id),
      baseRevision: externalChange ? replica.revision : replica.baseRevision,
      revision: input.hash,
      contentHash: input.hash,
      state: externalChange ? "ahead" : "current",
      lastVerifiedAt: now,
      updatedAt: now,
    });
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
    } else if (!cloud.payloadRef) {
      // Replica migration can create the cloud identity before the first
      // native payload arrives. Attach that retained payload now; never
      // replace an already-retained divergent cloud version here.
      await ctx.db.patch(cloud._id, {
        payloadRef: String(payload._id),
        preservedCarryVersion: 1,
        nativeFormat: replica.nativeFormat,
        revision: input.hash,
        contentHash: input.hash,
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now,
      });
    }
    // Complete a local -> Spectra F6 transition only after the uploaded
    // payload is attached to the cloud replica. Until this point the local
    // source remains active so a failed/offline upload cannot lose the file.
    const pendingTransitions = await ctx.db.query("storageStrategyTransitions")
      .withIndex("by_work_created", (q) => q.eq("workId", replica.workId))
      .order("desc")
      .take(20);
    const cloudTransition = pendingTransitions.find(
      (transition) =>
        transition.state === "pending" &&
        (transition.toPreset === "spectra" || transition.toPreset === "both"),
    );
    // Re-read the cloud row after the insert/patch above. The initial query is
    // intentionally a snapshot and may be null or still contain the old
    // payloadRef, which must never leave an otherwise completed F6 transition
    // stuck in `pending`.
    const cloudAfterUpload = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", (q) => q.eq("workId", replica.workId).eq("kind", "cloud"))
      .unique();
    if (cloudTransition && cloudAfterUpload?.payloadRef === String(payload._id)) {
      const local = await ctx.db.get(replica._id);
      if (local) {
        await ctx.db.patch(local._id, cloudTransition.toPreset === "spectra"
          ? { state: "unavailable", unavailableReason: "removed-by-user", updatedAt: now }
          : { state: "current", unavailableReason: undefined, lastVerifiedAt: now, updatedAt: now });
      }
      await ctx.db.patch(cloudTransition._id, {
        state: "verified",
        after: {
          ...(cloudTransition.after as Record<string, unknown> | undefined),
          cloudPayloadRef: String(payload._id),
          physicalLocalAction: cloudTransition.toPreset === "spectra" ? "leave-file-in-place" : "retain",
        },
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
      .take(20);
    const abandonedClaims = await ctx.db.query("bridgeWriteRequests")
      .withIndex("by_device_state", (q) => q.eq("deviceId", device._id).eq("state", "claimed"))
      .filter((q) => q.lt(q.field("claimedAt"), now - 60_000))
      .take(20);
    for (const request of [...pending, ...abandonedClaims]) {
      const payloadId = ctx.db.normalizeId("payloadObjects", request.payloadRef);
      const [payload, mount, replica] = await Promise.all([
        payloadId ? ctx.db.get(payloadId) : null,
        ctx.db.get(request.mountId),
        ctx.db.get(request.replicaId),
      ]);
      const targetActive = activeReplicaWriteTarget(replica, mount, device);
      const requestMatchesTarget = Boolean(
        replica &&
          replica._id === request.replicaId &&
          replica.deviceId === request.deviceId &&
          replica.mountId === request.mountId,
      );
      if (!payload || payload.state !== "active" || !mount || !replica || !targetActive || !requestMatchesTarget) {
        const errorCode = !payload || payload.state !== "active" ? "payload-unavailable" : "target-unavailable";
        await ctx.db.patch(request._id, {
          state: "failed",
          errorCode,
          errorMessage: errorCode === "payload-unavailable" ? "The retained payload is unavailable." : "The target Bridge folder or device is unavailable.",
          updatedAt: now,
        });
        const operation = await ctx.db.query("syncOperations")
          .withIndex("by_account_key", (q) => q.eq("accountId", device.accountId).eq("idempotencyKey", request.idempotencyKey))
          .unique();
        if (operation) await ctx.db.patch(operation._id, { state: "failed", errorCode, updatedAt: now });
        continue;
      }
      const payloadUrl = await ctx.storage.getUrl(payload.storageId);
      if (!payloadUrl) {
        await ctx.db.patch(request._id, { state: "failed", errorCode: "payload-unavailable", errorMessage: "The retained payload has no download URL.", updatedAt: now });
        continue;
      }
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
        payloadUrl,
      } };
    }
    return { request: null };
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
    const strategyTransitions = await ctx.db.query("storageStrategyTransitions")
      .withIndex("by_work_created", (q) => q.eq("workId", request.workId))
      .order("desc")
      .take(20);
    const strategyTransition = strategyTransitions.find(
      (transition) => transition.state === "pending" &&
        String((transition.after as { materializationRequestId?: string } | undefined)?.materializationRequestId ?? "") === String(request._id),
    );
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
      const [mount, replica] = await Promise.all([
        ctx.db.get(request.mountId),
        ctx.db.get(request.replicaId),
      ]);
      if (!activeReplicaWriteTarget(replica, mount, device)) {
        await ctx.db.patch(request._id, {
          state: "failed",
          errorCode: "target-unavailable",
          errorMessage: "The Bridge folder or device became unavailable before verification.",
          updatedAt: now,
        });
        if (operation) await ctx.db.patch(operation._id, { state: "failed", errorCode: "target-unavailable", updatedAt: now });
        return { state: "failed" as const };
      }
      const protectedApply = Boolean(
        operation?.errorCode === "protected-original-apply-pending" &&
        replica?.pendingPayloadRef === request.payloadRef &&
        replica.pendingContentHash === request.contentHash,
      );
      const work = protectedApply ? await ctx.db.get(request.workId) : null;
      const cloud = protectedApply
        ? await ctx.db
            .query("workReplicas")
            .withIndex("by_work_kind", (q) => q.eq("workId", request.workId).eq("kind", "cloud"))
            .unique()
        : null;
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
        ...(protectedApply
          ? {
              pendingPayloadRef: undefined,
              pendingContentHash: undefined,
              pendingBaseRevision: undefined,
              protectedBaseContent: undefined,
              protectedBaseContentHash: undefined,
              protectedBaseTextIndex: undefined,
              protectedOriginal: false,
            }
          : {}),
        updatedAt: now,
      });
      if (protectedApply && work) {
        await ctx.db.patch(work._id, {
          pendingPayloadRef: undefined,
          pendingContentHash: undefined,
          pendingBaseRevision: undefined,
          protectedBaseContent: undefined,
          protectedBaseContentHash: undefined,
          protectedBaseTextIndex: undefined,
          protectedOriginal: false,
          updatedAt: now,
        });
      }
      if (protectedApply && cloud) {
        await ctx.db.patch(cloud._id, {
          payloadRef: request.payloadRef,
          baseRevision: cloud.revision,
          revision: request.targetRevision,
          contentHash: request.contentHash,
          state: "current",
          lastVerifiedAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.patch(request._id, { state: "verified", errorCode: undefined, errorMessage: undefined, updatedAt: now });
      if (operation) await ctx.db.patch(operation._id, { state: "verified", updatedAt: now });
      if (strategyTransition) {
        if (strategyTransition.toPreset === "device") {
          const transitionCloud = await ctx.db.query("workReplicas")
            .withIndex("by_work_kind", (q) => q.eq("workId", request.workId).eq("kind", "cloud"))
            .unique();
          if (transitionCloud) await ctx.db.patch(transitionCloud._id, { payloadRef: undefined, state: "current", updatedAt: now });
        }
        await ctx.db.patch(strategyTransition._id, { state: "verified", updatedAt: now });
      }
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
    if (strategyTransition) await ctx.db.patch(strategyTransition._id, { state: "failed", errorCode: args.errorCode ?? (conflicted ? "stale-revision" : "write-failed"), updatedAt: now });
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
      const now = Date.now();
      const rootNode = mount.rootOrgNodeId ? await ctx.db.get(mount.rootOrgNodeId) : null;
      if (rootNode && rootNode.accountId === actor.accountId && rootNode.deletedAt === undefined) {
        await trashNode(ctx, rootNode);
      }
      const [replicas, pending, claimed] = await Promise.all([
        ctx.db.query("workReplicas")
          .withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId))
          .filter((q) => q.eq(q.field("mountId"), mount._id))
          .take(2_000),
        ctx.db.query("bridgeWriteRequests")
          .withIndex("by_device_state", (q) => q.eq("deviceId", device._id).eq("state", "pending"))
          .filter((q) => q.eq(q.field("mountId"), mount._id))
          .take(2_000),
        ctx.db.query("bridgeWriteRequests")
          .withIndex("by_device_state", (q) => q.eq("deviceId", device._id).eq("state", "claimed"))
          .filter((q) => q.eq(q.field("mountId"), mount._id))
          .take(2_000),
      ]);
      await ctx.db.patch(mount._id, { state: "detached", updatedAt: now });
      for (const replica of replicas)
        await ctx.db.patch(replica._id, { state: "unavailable", unavailableReason: "mount-detached", updatedAt: now });
      for (const request of [...pending, ...claimed]) {
        await ctx.db.patch(request._id, { state: "failed", errorCode: "mount-detached", errorMessage: "The selected Bridge folder was removed.", updatedAt: now });
        const operation = await ctx.db.query("syncOperations")
          .withIndex("by_account_key", (q) => q.eq("accountId", actor.accountId).eq("idempotencyKey", request.idempotencyKey))
          .unique();
        if (operation) await ctx.db.patch(operation._id, { state: "failed", errorCode: "mount-detached", updatedAt: now });
      }
    }
    return true;
  },
});

export const setMountAvailability = mutation({
  args: { credential: v.string(), grantId: v.string(), available: v.boolean() },
  handler: async (ctx, args) => {
    const { device, actor } = await requireDevice(ctx, args.credential);
    const grantId = z.string().regex(/^grant_[a-f0-9]+$/).parse(args.grantId);
    const mount = await ctx.db.query("bridgeMounts").withIndex("by_device_grant", (q) => q.eq("deviceId", device._id).eq("grantId", grantId)).unique();
    if (!mount || mount.accountId !== actor.accountId) throw new Error("MOUNT_NOT_FOUND");
    const now = Date.now();
    await ctx.db.patch(mount._id, { state: args.available ? "active" : "detached", updatedAt: now });
    const replicas = await ctx.db.query("workReplicas").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId)).filter((q) => q.eq(q.field("mountId"), mount._id)).take(2_000);
    for (const replica of replicas) await ctx.db.patch(replica._id, args.available ? { state: "behind", unavailableReason: undefined, updatedAt: now } : { state: "unavailable", unavailableReason: "mount-unavailable", updatedAt: now });
    return { state: args.available ? "active" as const : "detached" as const };
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
    const policy = await computeEffectivePolicy(ctx, device.accountId, { account: String(device.accountId), mount: replica.mountId ? String(replica.mountId) : undefined, item: String(replica.workId) });
    const existing = await ctx.db.query("syncOperations").withIndex("by_account_key", (q) => q.eq("accountId", device.accountId).eq("idempotencyKey", input.idempotencyKey)).unique(); if (existing) return { state: existing.state, operationId: existing._id };
    const now = Date.now();
    if (replica.revision !== input.revisionBefore) {
      const operationId = await ctx.db.insert("syncOperations", { accountId: device.accountId, workId: replica.workId, replicaId: replica._id, idempotencyKey: input.idempotencyKey, direction: "local-to-cloud", revisionBefore: input.revisionBefore, revisionAfter: input.revisionAfter, state: "conflicted", actorKind: "external-edit", errorCode: "stale-revision", createdAt: now, updatedAt: now });
      await ctx.db.patch(replica._id, { state: "diverged", updatedAt: now }); return { state: "conflicted" as const, operationId };
    }
    const deferred = policy.source.kind !== "default" && !policyAllowsTrigger(policy.timing, "watch");
    const operationId = await ctx.db.insert("syncOperations", { accountId: device.accountId, workId: replica.workId, replicaId: replica._id, idempotencyKey: input.idempotencyKey, direction: "local-to-cloud", revisionBefore: input.revisionBefore, revisionAfter: input.revisionAfter, state: deferred ? "pending" : "verified", actorKind: "external-edit", createdAt: now, updatedAt: now });
    await ctx.db.patch(replica._id, { revision: input.revisionAfter, baseRevision: input.revisionBefore, contentHash: input.contentHash, state: deferred ? "ahead" : "current", lastVerifiedAt: deferred ? replica.lastVerifiedAt : now, updatedAt: now });
    await ctx.db.patch(device._id, { lastSeenAt: now }); return { state: deferred ? "pending" as const : "verified" as const, operationId };
  },
});
