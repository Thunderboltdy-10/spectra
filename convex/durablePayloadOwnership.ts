import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { PAYLOAD_RELEASE_GRACE_MS } from "../shared/replica-truth";
import { releasePayloadIfUnreferenced } from "./payloadLifecycle";

export function durablePayloadReferences(value: unknown, refs = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { for (const item of value) durablePayloadReferences(item, refs); }
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if ((key === "payloadRef" || key === "projectionPayloadRef") && typeof item === "string") refs.add(item);
      else if (key === "nativePayloadRefs" && Array.isArray(item)) for (const ref of item) { if (typeof ref === "string") refs.add(ref); }
      else if (item && typeof item === "object") durablePayloadReferences(item, refs);
    }
  }
  return refs;
}

/** The existing row lifetime coordinator owns pins, embeds and pending native
 * operations. Mirror those owners instead of inventing another retention rule. */
export async function reconcileDurablePayloadOwners(ctx: MutationCtx, table: string, ownerId: string, value: unknown) {
  const refs = durablePayloadReferences(value);
  const previous = await ctx.db.query("collaborationPayloadOwners").withIndex("by_owner", q => q.eq("ownerId", ownerId)).collect();
  const old = new Set(previous.map(row => row.payloadRef));
  for (const ref of refs) {
    if (old.has(ref) || (!ctx.db.normalizeId("collaborationDurablePayloads", ref) && !ctx.db.normalizeId("payloadObjects", ref))) continue;
    await ctx.db.insert("collaborationPayloadOwners", { payloadRef: ref, ownerId, ownerTable: table });
  }
  for (const row of previous) {
    if (refs.has(row.payloadRef)) continue;
    await ctx.db.delete(row._id);
    await ctx.scheduler.runAfter(PAYLOAD_RELEASE_GRACE_MS, internal.durablePayloadOwnership.release, { payloadRef: row.payloadRef });
  }
}

export const release = internalMutation({
  args: { payloadRef: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("collaborationDurablePayloads", args.payloadRef);
    if (!id) return (await releasePayloadIfUnreferenced(ctx, args.payloadRef)) > 0;
    const payload = id ? await ctx.db.get(id) : null;
    if (!payload || payload.status !== "active") return false;
    const owner = await ctx.db.query("collaborationPayloadOwners").withIndex("by_payload", q => q.eq("payloadRef", args.payloadRef)).first();
    if (owner) return false;
    const wait = payload.createdAt + PAYLOAD_RELEASE_GRACE_MS - Date.now();
    if (wait > 0) {
      await ctx.scheduler.runAfter(wait, internal.durablePayloadOwnership.release, args);
      return false;
    }
    await ctx.storage.delete(payload.storageId);
    await ctx.db.patch(payload._id, { status: "released", releasedAt: Date.now() });
    await reconcileDurablePayloadOwners(ctx, "collaborationDurablePayloads", String(payload._id), null);
    return true;
  },
});
