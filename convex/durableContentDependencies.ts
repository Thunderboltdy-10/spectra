import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const contentDependencyValidator = v.object({ assetIds: v.array(v.string()), nativePayloadHashes: v.array(v.string()) });

export async function resolveContentDependencies(ctx: MutationCtx, artifactId: Id<"spectraArtifacts">, dependencies?: { assetIds: string[]; nativePayloadHashes: string[] }) {
  const assetIds = [...new Set(dependencies?.assetIds ?? [])];
  const nativePayloadHashes = [...new Set(dependencies?.nativePayloadHashes ?? [])];
  if (assetIds.length + nativePayloadHashes.length > 512) throw new Error("COLLABORATION_CONTENT_DEPENDENCIES_SIZE");
  for (const value of assetIds) {
    const id = ctx.db.normalizeId("artifactAssets", value);
    const asset = id ? await ctx.db.get(id) : null;
    if (!asset || asset.artifactId !== artifactId || asset.status !== "active") throw new Error("COLLABORATION_CONTENT_DEPENDENCY_INVALID");
  }
  const replicas = await ctx.db.query("workReplicas").withIndex("by_work", q => q.eq("workId", artifactId)).take(51);
  // A bounded read must not silently omit an owner's native base.
  if (replicas.length > 50) throw new Error("COLLABORATION_CONTENT_DEPENDENCIES_SIZE");
  const nativePayloadRefs: string[] = [];
  for (const value of new Set(replicas.flatMap(row => [row.payloadRef, row.projectionBasePayloadRef]).filter(Boolean))) {
    const id = ctx.db.normalizeId("payloadObjects", value!);
    const payload = id ? await ctx.db.get(id) : null;
    if (payload?.state !== "active") continue;
    // Capture the bound native base even in older XLSX projections that did
    // not yet include sourcePayloadHash in nativeBinding.
    if (nativePayloadHashes.length === 0 || nativePayloadHashes.includes(payload.hash)) nativePayloadRefs.push(value!);
  }
  return { assetIds, nativePayloadHashes, nativePayloadRefs };
}
