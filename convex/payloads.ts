import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";

function assertHash(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("PAYLOAD_HASH_INVALID");
}

export const put = mutation({
  args: { hash: v.string(), storageId: v.id("_storage"), bytes: v.number(), mediaType: v.string() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    assertHash(args.hash);
    if (!Number.isSafeInteger(args.bytes) || args.bytes < 0) throw new Error("PAYLOAD_BYTES_INVALID");
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size !== args.bytes) throw new Error("PAYLOAD_SIZE_MISMATCH");
    const existing = await ctx.db.query("payloadObjects").withIndex("by_account_hash", (q) => q.eq("accountId", actor.accountId).eq("hash", args.hash)).unique();
    if (existing) { await ctx.db.patch(existing._id, { refCount: existing.refCount + 1 }); return { payloadRef: String(existing._id), deduplicated: true }; }
    const id = await ctx.db.insert("payloadObjects", { accountId: actor.accountId, hash: args.hash, storageId: args.storageId, bytes: args.bytes, mediaType: args.mediaType.slice(0, 120), refCount: 1, state: "active", createdAt: Date.now(), verifiedAt: Date.now() });
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

export const issueUpload = mutation({ args: {}, handler: async (ctx) => { const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED"); return ctx.storage.generateUploadUrl(); } });
