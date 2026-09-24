import { deleteUnboundDurableStorage } from "./durableStorageBindings";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { PAYLOAD_RELEASE_GRACE_MS } from "../shared/replica-truth";
import { releasePayloadIfUnreferenced } from "./payloadLifecycle";
import { resolveContentDependencies } from "./durableContentDependencies";
import type { Doc } from "./_generated/dataModel";

// Retention references may be authored data. Only this discriminator attests
// that a version's native reference was resolved through its source binding.
export const NATIVE_VERSION_OWNER_TABLE = "spectraArtifactVersions:native";

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

/** Inline snapshots need the same native ownership as a spilled content body.
 * Resolve hashes only through this artifact's replicas or already-owned refs;
 * an arbitrary hash in authored content grants no access to another artifact. */
async function retainVersionNativeReferences(ctx: MutationCtx, value: unknown, refs: Set<string>, previous: Doc<"collaborationPayloadOwners">[]) {
  const version = value as Partial<Doc<"spectraArtifactVersions">> | null;
  if (!version?.artifactId) return;
  const snapshots: unknown[] = [version.before, version.after];
  let unresolved = false;
  for (const snapshotRef of [version.beforeSnapshotRef, version.snapshotRef]) {
    if (!snapshotRef) continue;
    const snapshot = await ctx.db.query("artifactSnapshotObjects").withIndex("by_school_hash", q => q.eq("schoolId", version.schoolId).eq("hash", snapshotRef)).unique();
    if (!snapshot || snapshot.state === "deleted" || snapshot.state === "corrupt") unresolved = true;
    else snapshots.push(snapshot.payload);
  }
  const hashes = new Set<string>();
  const visit = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (key === "sourcePayloadHash" && typeof child === "string" && /^[a-f0-9]{64}$/.test(child)) hashes.add(child);
      else if (child && typeof child === "object") visit(child);
    }
  };
  snapshots.forEach(visit);
  if (!unresolved && hashes.size === 0) return;
  for (const owner of previous) {
    const id = ctx.db.normalizeId("payloadObjects", owner.payloadRef);
    const payload = id ? await ctx.db.get(id) : null;
    if (payload?.state === "active" && (unresolved || hashes.has(payload.hash))) refs.add(owner.payloadRef);
  }
  const dependencies = await resolveContentDependencies(ctx, version.artifactId, {
    assetIds: [], nativePayloadHashes: unresolved ? [] : [...hashes],
  });
  for (const ref of dependencies.nativePayloadRefs) refs.add(ref);
}

/** The existing row lifetime coordinator owns pins, embeds and pending native
 * operations. Mirror those owners instead of inventing another retention rule. */
export async function reconcileDurablePayloadOwners(ctx: MutationCtx, table: string, ownerId: string, value: unknown) {
  const refs = durablePayloadReferences(value);
  const previous = await ctx.db.query("collaborationPayloadOwners").withIndex("by_owner", q => q.eq("ownerId", ownerId)).collect();
  const nativeRefs = new Set<string>();
  if (table === "spectraArtifactVersions") {
    await retainVersionNativeReferences(ctx, value, nativeRefs, previous.filter(row => row.ownerTable === NATIVE_VERSION_OWNER_TABLE));
    for (const ref of nativeRefs) refs.add(ref);
  }
  const old = new Map(previous.map(row => [row.payloadRef, row]));
  for (const ref of refs) {
    if (!ctx.db.normalizeId("collaborationDurablePayloads", ref) && !ctx.db.normalizeId("payloadObjects", ref)) continue;
    const ownerTable = nativeRefs.has(ref) ? NATIVE_VERSION_OWNER_TABLE : table;
    const existing = old.get(ref);
    if (existing) {
      if (existing.ownerTable !== ownerTable) await ctx.db.patch(existing._id, { ownerTable });
    } else {
      await ctx.db.insert("collaborationPayloadOwners", { payloadRef: ref, ownerId, ownerTable });
    }
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
    await ctx.db.patch(payload._id, { status: "released", releasedAt: Date.now() });
    await deleteUnboundDurableStorage(ctx, payload.storageId);
    await reconcileDurablePayloadOwners(ctx, "collaborationDurablePayloads", String(payload._id), null);
    return true;
  },
});
