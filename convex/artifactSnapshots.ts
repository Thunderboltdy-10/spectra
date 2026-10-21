import { reconcileDurablePayloadOwners } from "./durablePayloadOwnership";
import { internalQuery } from "./functions";
import { internalMutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { isSurvivingPinnedEmbed } from "./artifactEmbedOwnership";
import { ensureArtifactDeletionReconciliation } from "./artifactDeletionScheduling";
import { canonicalSnapshotJson, decodeSnapshotPayload, encodeSnapshotPayload, snapshotHash } from "./snapshotHash";
import { platformStopped } from "./platformControls";

export { canonicalSnapshotJson, snapshotHash };

export type SnapshotStrategy = "normalized" | "content_addressed" | "yjs_snapshot";
type SnapshotCtx = QueryCtx | MutationCtx;

export async function retainSnapshotObject(
  ctx: MutationCtx,
  schoolId: Id<"schools"> | undefined,
  payload: unknown,
  strategy: SnapshotStrategy,
) {
  const { hash, byteLength } = await snapshotHash(payload);
  const existing = await ctx.db.query("artifactSnapshotObjects").withIndex("by_school_hash", (q) => q.eq("schoolId", schoolId).eq("hash", hash)).unique();
  const now = Date.now();
  if (existing) {
    if (existing.state === "deleted") {
      await ctx.db.patch(existing._id, { strategy, payload: encodeSnapshotPayload(payload), byteLength, refCount: 1, state: "hot", lastReferencedAt: now, verifiedAt: now });
      return { snapshotRef: hash, integrityHash: hash, byteLength, deduplicated: false };
    }
    if (canonicalSnapshotJson(decodeSnapshotPayload(existing.payload)) !== canonicalSnapshotJson(payload)) {
      await ctx.db.patch(existing._id, { state: "corrupt", lastReferencedAt: now });
      throw new Error("ARTIFACT_SNAPSHOT_HASH_COLLISION");
    }
    await ctx.db.patch(existing._id, { refCount: existing.refCount + 1, lastReferencedAt: now, state: existing.state === "cold" ? "hot" : existing.state });
    return { snapshotRef: hash, integrityHash: hash, byteLength, deduplicated: true };
  }
  await ctx.db.insert("artifactSnapshotObjects", { schoolId, hash, strategy, payload: encodeSnapshotPayload(payload), byteLength, refCount: 1, state: "hot", createdAt: now, lastReferencedAt: now, verifiedAt: now });
  return { snapshotRef: hash, integrityHash: hash, byteLength, deduplicated: false };
}

export async function loadSnapshotObject(ctx: SnapshotCtx, schoolId: Id<"schools"> | undefined, snapshotRef: string) {
  const object = await ctx.db.query("artifactSnapshotObjects").withIndex("by_school_hash", (q) => q.eq("schoolId", schoolId).eq("hash", snapshotRef)).unique();
  if (!object || object.state === "deleted") throw new Error("ARTIFACT_SNAPSHOT_UNAVAILABLE");
  if (object.state === "corrupt") throw new Error("ARTIFACT_SNAPSHOT_CORRUPT");
  const payload = decodeSnapshotPayload(object.payload);
  const calculated = await snapshotHash(payload);
  if (calculated.hash !== object.hash || calculated.byteLength !== object.byteLength) {
    throw new Error("ARTIFACT_SNAPSHOT_INTEGRITY_FAILED");
  }
  return payload;
}

export async function loadVersionAfter(ctx: SnapshotCtx, version: Doc<"spectraArtifactVersions">) {
  if (version.after !== undefined) return version.after;
  if (!version.snapshotRef) throw new Error("ARTIFACT_VERSION_SNAPSHOT_MISSING");
  return loadSnapshotObject(ctx, version.schoolId, version.snapshotRef);
}

export async function loadVersionBefore(ctx: SnapshotCtx, version: Doc<"spectraArtifactVersions">) {
  if (version.before !== undefined) return version.before;
  if (!version.beforeSnapshotRef) return undefined;
  return loadSnapshotObject(ctx, version.schoolId, version.beforeSnapshotRef);
}

export async function hydrateVersion(ctx: SnapshotCtx, version: Doc<"spectraArtifactVersions">) {
  return { ...version, before: await loadVersionBefore(ctx, version), after: await loadVersionAfter(ctx, version) };
}

export async function hydrateVersionSafely(ctx: SnapshotCtx, version: Doc<"spectraArtifactVersions">) {
  try {
    return { ...(await hydrateVersion(ctx, version)), snapshotState: "ready" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ARTIFACT_SNAPSHOT_UNAVAILABLE";
    return {
      ...version,
      before: undefined,
      after: undefined,
      snapshotState: message.includes("CORRUPT") || message.includes("INTEGRITY") ? "corrupt" as const : "unavailable" as const,
      snapshotError: message,
    };
  }
}

export async function releaseSnapshotObject(ctx: MutationCtx, schoolId: Id<"schools"> | undefined, snapshotRef: string) {
  const object = await ctx.db.query("artifactSnapshotObjects").withIndex("by_school_hash", (q) => q.eq("schoolId", schoolId).eq("hash", snapshotRef)).unique();
  if (!object || object.state === "deleted") return;
  // Reconcile from the durable version rows instead of blindly decrementing.
  // A deletion page can be retried after a row was deleted but before the
  // release was observed; counting the surviving references makes that retry
  // idempotent and never double-releases a shared snapshot object.
  const [after, before] = await Promise.all([
    ctx.db.query("spectraArtifactVersions").withIndex("by_snapshot_ref", (q) => q.eq("snapshotRef", snapshotRef)).collect(),
    ctx.db.query("spectraArtifactVersions").withIndex("by_before_snapshot_ref", (q) => q.eq("beforeSnapshotRef", snapshotRef)).collect(),
  ]);
  const refCount = after.length + before.length;
  await ctx.db.patch(object._id, {
    refCount,
    lastReferencedAt: Date.now(),
    state: refCount === 0 ? "cold" : object.state === "cold" ? "hot" : object.state,
  });
}

/**
 * A pinned version is retained by the embed row even when source deletion has
 * tombstoned that row. Once the actual pin is removed, this helper removes the
 * now-unowned version and reconciles its shared snapshot references.
 */
export async function releaseVersionIfUnpinned(
  ctx: MutationCtx,
  versionId: Id<"spectraArtifactVersions">,
  ignoreEmbedId?: Id<"artifactEmbeds">,
) {
  const version = await ctx.db.get(versionId);
  if (!version) return false;
  const activePin = await ctx.db
    .query("artifactEmbeds")
    .withIndex("by_pinned_version", (q) => q.eq("pinnedVersionId", versionId))
    .filter((q) =>
      ignoreEmbedId
        ? q.and(q.eq(q.field("removedAt"), undefined), q.neq(q.field("_id"), ignoreEmbedId))
        : q.eq(q.field("removedAt"), undefined),
    )
    .first();
  if (activePin && isSurvivingPinnedEmbed(activePin)) return false;
  const artifact = await ctx.db.get(version.artifactId);
  if (!artifact || artifact.status !== "deleted") return false;
  await reconcileDurablePayloadOwners(ctx,"spectraArtifactVersions",String(version._id),null);
  await ctx.db.delete(version._id);
  if (version.snapshotRef) await releaseSnapshotObject(ctx, version.schoolId, version.snapshotRef);
  if (version.beforeSnapshotRef) await releaseSnapshotObject(ctx, version.schoolId, version.beforeSnapshotRef);
  await ensureArtifactDeletionReconciliation(ctx, version.artifactId);
  return true;
}

export const verify = internalMutation({
  args: { snapshotObjectId: v.id("artifactSnapshotObjects") },
  handler: async (ctx, args) => {
    const object = await ctx.db.get(args.snapshotObjectId);
    if (!object || object.state === "deleted") return { state: "unavailable" as const };
    const calculated = await snapshotHash(object.payload);
    const valid = calculated.hash === object.hash && calculated.byteLength === object.byteLength;
    await ctx.db.patch(object._id, { state: valid ? object.state === "corrupt" ? "hot" : object.state : "corrupt", verifiedAt: Date.now() });
    return { state: valid ? "valid" as const : "corrupt" as const };
  },
});

export const listRepairCandidates = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => ctx.db.query("artifactSnapshotObjects").withIndex("by_state_reference", (q) => q.eq("state", "corrupt")).take(Math.max(1, Math.min(args.limit ?? 50, 200))),
});

async function repairFromVersionEvidence(ctx: MutationCtx, object: Doc<"artifactSnapshotObjects">) {
  const afterVersions = await ctx.db.query("spectraArtifactVersions").withIndex("by_snapshot_ref", (q) => q.eq("snapshotRef", object.hash)).take(250);
  const beforeVersions = await ctx.db.query("spectraArtifactVersions").withIndex("by_before_snapshot_ref", (q) => q.eq("beforeSnapshotRef", object.hash)).take(250);
  const candidates = [
    ...afterVersions.flatMap((version) => version.after === undefined ? [] : [version.after]),
    ...beforeVersions.flatMap((version) => version.before === undefined ? [] : [version.before]),
  ];
  for (const payload of candidates) {
    const calculated = await snapshotHash(payload);
    if (calculated.hash !== object.hash) continue;
    const referenceCount = afterVersions.length + beforeVersions.length;
    await ctx.db.patch(object._id, {
      payload,
      byteLength: calculated.byteLength,
      refCount: Math.max(referenceCount, object.refCount),
      state: "hot",
      lastReferencedAt: Date.now(),
      verifiedAt: Date.now(),
    });
    return true;
  }
  return false;
}

export const maintain = internalMutation({
  args: {
    verifyLimit: v.optional(v.number()),
    repairLimit: v.optional(v.number()),
    coldAfterMs: v.optional(v.number()),
    purgeUnreferencedAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (await platformStopped(ctx, "background")) return null;
    const now = Date.now();
    const verifyLimit = Math.max(1, Math.min(args.verifyLimit ?? 75, 300));
    const repairLimit = Math.max(1, Math.min(args.repairLimit ?? 30, 100));
    const coldBefore = now - Math.max(7 * 86_400_000, args.coldAfterMs ?? 90 * 86_400_000);
    const purgeBefore = now - Math.max(7 * 86_400_000, args.purgeUnreferencedAfterMs ?? 30 * 86_400_000);
    const stale = await ctx.db.query("artifactSnapshotObjects").withIndex("by_state_reference", (q) => q.eq("state", "hot").lt("lastReferencedAt", coldBefore)).take(verifyLimit);
    const corrupt = await ctx.db.query("artifactSnapshotObjects").withIndex("by_state_reference", (q) => q.eq("state", "corrupt")).take(repairLimit);
    let verified = 0;
    let markedCorrupt = 0;
    let repaired = 0;
    let cooled = 0;
    for (const object of stale) {
      const calculated = await snapshotHash(object.payload);
      if (calculated.hash !== object.hash || calculated.byteLength !== object.byteLength) {
        await ctx.db.patch(object._id, { state: "corrupt", verifiedAt: now });
        markedCorrupt += 1;
      } else {
        await ctx.db.patch(object._id, { state: "cold", verifiedAt: now });
        verified += 1;
        cooled += 1;
      }
    }
    for (const object of corrupt) {
      if (await repairFromVersionEvidence(ctx, object)) repaired += 1;
    }
    const unreferenced = await ctx.db.query("artifactSnapshotObjects").withIndex("by_state_reference", (q) => q.eq("state", "cold").lt("lastReferencedAt", purgeBefore)).take(verifyLimit);
    let purged = 0;
    for (const object of unreferenced) {
      if (object.refCount > 0) continue;
      await ctx.db.patch(object._id, { payload: null, byteLength: 0, state: "deleted", verifiedAt: now });
      purged += 1;
    }
    return { verified, markedCorrupt, repaired, cooled, purged };
  },
});
