import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export type SnapshotStrategy = "normalized" | "content_addressed" | "yjs_snapshot";
type SnapshotCtx = QueryCtx | MutationCtx;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function canonicalSnapshotJson(value: unknown) {
  return JSON.stringify(canonical(value));
}

export async function snapshotHash(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalSnapshotJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return { hash: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""), byteLength: bytes.byteLength };
}

export async function retainSnapshotObject(
  ctx: MutationCtx,
  schoolId: Id<"schools"> | undefined,
  payload: unknown,
  strategy: SnapshotStrategy,
) {
  const { hash, byteLength } = await snapshotHash(payload);
  const existing = await ctx.db.query("artifactSnapshotObjects").withIndex("by_school_hash", (q) => q.eq("schoolId", schoolId).eq("hash", hash)).unique();
  const now = Date.now();
  if (existing && existing.state !== "deleted") {
    if (canonicalSnapshotJson(existing.payload) !== canonicalSnapshotJson(payload)) {
      await ctx.db.patch(existing._id, { state: "corrupt", lastReferencedAt: now });
      throw new Error("ARTIFACT_SNAPSHOT_HASH_COLLISION");
    }
    await ctx.db.patch(existing._id, { refCount: existing.refCount + 1, lastReferencedAt: now, state: existing.state === "cold" ? "hot" : existing.state });
    return { snapshotRef: hash, integrityHash: hash, byteLength, deduplicated: true };
  }
  await ctx.db.insert("artifactSnapshotObjects", { schoolId, hash, strategy, payload, byteLength, refCount: 1, state: "hot", createdAt: now, lastReferencedAt: now, verifiedAt: now });
  return { snapshotRef: hash, integrityHash: hash, byteLength, deduplicated: false };
}

export async function loadSnapshotObject(ctx: SnapshotCtx, schoolId: Id<"schools"> | undefined, snapshotRef: string) {
  const object = await ctx.db.query("artifactSnapshotObjects").withIndex("by_school_hash", (q) => q.eq("schoolId", schoolId).eq("hash", snapshotRef)).unique();
  if (!object || object.state === "deleted") throw new Error("ARTIFACT_SNAPSHOT_UNAVAILABLE");
  if (object.state === "corrupt") throw new Error("ARTIFACT_SNAPSHOT_CORRUPT");
  const calculated = await snapshotHash(object.payload);
  if (calculated.hash !== object.hash || calculated.byteLength !== object.byteLength) {
    throw new Error("ARTIFACT_SNAPSHOT_INTEGRITY_FAILED");
  }
  return object.payload;
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

export async function releaseSnapshotObject(ctx: MutationCtx, schoolId: Id<"schools"> | undefined, snapshotRef: string) {
  const object = await ctx.db.query("artifactSnapshotObjects").withIndex("by_school_hash", (q) => q.eq("schoolId", schoolId).eq("hash", snapshotRef)).unique();
  if (!object || object.state === "deleted") return;
  const refCount = Math.max(0, object.refCount - 1);
  await ctx.db.patch(object._id, { refCount, lastReferencedAt: Date.now(), state: refCount === 0 ? "cold" : object.state });
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
