import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { assertPayloadWriteAllowed } from "./syncPolicy";

function assertHash(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("PAYLOAD_HASH_INVALID");
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
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED"); assertHash(hash);
    const found = await ctx.db.query("payloadObjects").withIndex("by_account_hash", (q) => q.eq("accountId", actor.accountId).eq("hash", hash)).unique();
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
