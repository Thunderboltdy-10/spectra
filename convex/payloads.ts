import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import type { Id } from "./_generated/dataModel";
import { assertPayloadWriteAllowed } from "./syncPolicy";
import { canReadPinnedContent, snapshotReferencesNative } from "./retainedContentAccess";

function assertHash(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("PAYLOAD_HASH_INVALID");
}

async function payloadForWork(
  ctx: Parameters<typeof assertPayloadWriteAllowed>[0],
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  workId: Id<"spectraArtifacts">,
  hash: string,
) {
  let retained = false;
  const pinnedRefs = new Set<string>();
  try { await requireActorArtifactCapability(ctx, actor, workId, "read"); }
  catch (error) {
    retained = await canReadPinnedContent(ctx, actor, workId, snapshot => snapshotReferencesNative(snapshot, hash, pinnedRefs));
    if (!retained) throw error;
  }
  const work = await ctx.db.get(workId);
  if (!work) return null;
  const replicas = await ctx.db
    .query("workReplicas")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .take(20);
  const references = retained ? [...pinnedRefs] : [
    work.pendingPayloadRef,
    ...replicas.flatMap((replica) => [
      replica.payloadRef,
      replica.projectionBasePayloadRef,
      replica.pendingPayloadRef,
    ]),
  ].filter((ref): ref is string => Boolean(ref));
  for (const reference of [...new Set(references)]) {
    const payloadId = ctx.db.normalizeId("payloadObjects", reference);
    const payload = payloadId ? await ctx.db.get(payloadId) : null;
    if (payload?.state === "active" && payload.hash === hash) return payload;
  }
  const originals = await ctx.db.query("artifactImportJobs").withIndex("by_artifact", q => q.eq("artifactId", workId)).collect();
  const original = originals.find(job => job.originalSha256 === hash && job.originalStorageId && job.status === "imported");
  if (original?.originalStorageId) return { state: "active", storageId: original.originalStorageId, hash, bytes: original.originalBytes ?? 0, mediaType: original.originalMimeType ?? "application/octet-stream" };
  return null;
}

async function assertWorkPayloadWriteAllowed(
  ctx: Parameters<typeof assertPayloadWriteAllowed>[0],
  accountId: Parameters<typeof assertPayloadWriteAllowed>[1],
  workId: Parameters<typeof assertPayloadWriteAllowed>[2],
) {
  const locals = await ctx.db.query("workReplicas")
    .withIndex("by_work_kind", (q) => q.eq("workId", workId).eq("kind", "local"))
    .take(50);
  const mountIds = [...new Set(locals
    .filter((replica) => replica.accountId === accountId)
    .flatMap((replica) => replica.mountId ? [replica.mountId] : []))];
  if (!mountIds.length) return assertPayloadWriteAllowed(ctx, accountId, workId);
  for (const mountId of mountIds)
    await assertPayloadWriteAllowed(ctx, accountId, workId, mountId);
}

export const put = mutation({
  args: { workId: v.id("spectraArtifacts"), hash: v.string(), storageId: v.id("_storage"), bytes: v.number(), mediaType: v.string() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    await requireActorArtifactCapability(ctx, actor, args.workId, "modify");
    await assertWorkPayloadWriteAllowed(ctx, actor.accountId, args.workId);
    assertHash(args.hash);
    if (!Number.isSafeInteger(args.bytes) || args.bytes < 0) throw new Error("PAYLOAD_BYTES_INVALID");
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size !== args.bytes) throw new Error("PAYLOAD_SIZE_MISMATCH");
    const existing = await ctx.db.query("payloadObjects").withIndex("by_account_hash", (q) => q.eq("accountId", actor.accountId).eq("hash", args.hash)).unique();
    if (existing) {
      if (existing.state === "quarantined") {
        if (existing.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
        throw new Error("PAYLOAD_HASH_QUARANTINED");
      }
      if (existing.state === "active") {
        if (existing.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
        return { payloadRef: String(existing._id), deduplicated: true };
      }
      await ctx.db.patch(existing._id, {
        storageId: args.storageId,
        bytes: args.bytes,
        mediaType: args.mediaType.slice(0, 120),
        refCount: 0,
        state: "active",
        releasedAt: undefined,
        verifiedAt: Date.now(),
      });
      return { payloadRef: String(existing._id), deduplicated: false };
    }
    const id = await ctx.db.insert("payloadObjects", { accountId: actor.accountId, hash: args.hash, storageId: args.storageId, bytes: args.bytes, mediaType: args.mediaType.slice(0, 120), refCount: 0, state: "active", createdAt: Date.now(), verifiedAt: Date.now() });
    return { payloadRef: String(id), deduplicated: false };
  },
});

export const head = query({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED"); assertHash(hash);
    const found = await ctx.db.query("payloadObjects").withIndex("by_account_hash", (q) => q.eq("accountId", actor.accountId).eq("hash", hash)).unique();
    return found ? { exists: found.state === "active", bytes: found.bytes, refCount: found.refCount, verifiedAt: found.verifiedAt } : { exists: false };
  },
});

export const get = query({
  args: { hash: v.string(), workId: v.optional(v.id("spectraArtifacts")) },
  handler: async (ctx, { hash, workId }) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED"); assertHash(hash);
    const found = workId
      ? await payloadForWork(ctx, actor, workId, hash)
      : await ctx.db.query("payloadObjects").withIndex("by_account_hash", (q) => q.eq("accountId", actor.accountId).eq("hash", hash)).unique();
    if (!found || found.state !== "active") return null;
    return { url: await ctx.storage.getUrl(found.storageId), bytes: found.bytes, mediaType: found.mediaType, hash: found.hash };
  },
});

export const issueUpload = mutation({
  args: { workId: v.id("spectraArtifacts") },
  handler: async (ctx, { workId }) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    await requireActorArtifactCapability(ctx, actor, workId, "modify");
    await assertWorkPayloadWriteAllowed(ctx, actor.accountId, workId);
    return ctx.storage.generateUploadUrl();
  },
});
