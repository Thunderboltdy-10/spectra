import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";
import { createFolderNode, placeSourceNode } from "./orgTreeShared";
import { z } from "zod";

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
    return { replicas, openConflictCount: conflicts.length, pendingCount: pending.filter((op) => op.state === "pending" || op.state === "applied").length, recentOperations: pending.slice(0, 10) };
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
    const existingReplica = await ctx.db.query("workReplicas").withIndex("by_device_resource", (q) => q.eq("deviceId", mount.deviceId).eq("localResourceId", input.localResourceId)).unique();
    if (existingReplica) return existingReplica.workId;
    const parts = input.relativePath.replaceAll("\\", "/").split("/").filter(Boolean); const title = parts.pop()!; const parentId = await ensureFolderPath(ctx, actor.accountId, actor.schoolId, mount.rootOrgNodeId, parts);
    const now = Date.now(); const workId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: actor.accountId, schoolId: actor.schoolId, blueprintKey: "resource", resourceClass: "resource", nativeFormat: input.nativeFormat, compatibilityProfile: "strict-native", title, summary: `${input.size} bytes`, content: null, schemaVersion: 1, contentHash: input.contentHash, tags: [], status: "active", createdFrom: { source: "manual" }, createdAt: now, updatedAt: now });
    await ctx.db.insert("workReplicas", { accountId: actor.accountId, workId, kind: "local", deviceId: mount.deviceId, localResourceId: input.localResourceId, nativeFormat: input.nativeFormat, revision: input.contentHash ?? `discovered:${input.localResourceId}`, contentHash: input.contentHash, state: "current", lastVerifiedAt: now, updatedAt: now });
    await placeSourceNode(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, kind: "work", sourceId: String(workId), name: title, target: { parentId }, typeKey: "resource", placedByAccountId: actor.accountId });
    return workId;
  },
});
