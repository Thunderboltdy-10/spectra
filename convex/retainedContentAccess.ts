import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import type { AuthenticatedActor } from "./identityShared";
import { evaluateRetainedPinAccess } from "./retainedPinAccess";
import { loadVersionAfter } from "./artifactSnapshots";
import { isDurableContentRef } from "../shared/durable-content";
import { NATIVE_VERSION_OWNER_TABLE } from "./durablePayloadOwnership";

/** A retained body is readable only through an authorized surviving pin that
 * references that exact body. Source deletion grants no new authority. */
export async function canReadPinnedContent(ctx: QueryCtx, actor: AuthenticatedActor, artifactId: Id<"spectraArtifacts">, contains: (snapshot: unknown, version: Doc<"spectraArtifactVersions">) => boolean | Promise<boolean>) {
  const pins = await ctx.db.query("artifactEmbeds").withIndex("by_source", q => q.eq("sourceArtifactId", artifactId)).collect();
  for (const pin of pins) {
    const access = await evaluateRetainedPinAccess(ctx, actor, pin._id);
    if (!access.allowed || access.source._id !== artifactId) continue;
    let snapshot: unknown;
    try { snapshot = await loadVersionAfter(ctx, access.version); }
    catch { continue; }
    if (await contains(snapshot, access.version)) return true;
  }
  return false;
}

export function snapshotReferencesNative(value: unknown, hash: string): boolean {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  if (source.sourcePayloadHash === hash) return true;
  if (Array.isArray(source.nativePayloadHashes) && source.nativePayloadHashes.includes(hash)) return true;
  return Object.values(source).some(child => snapshotReferencesNative(child, hash));
}

/** A native hash claim in authored content is not a storage capability. Read
 * only source-verified version bindings or server-resolved durable dependencies. */
export async function nativeReferencesForPinnedVersion(ctx: QueryCtx, artifactId: Id<"spectraArtifacts">, versionId: Id<"spectraArtifactVersions">, snapshot: unknown) {
  const owners = await ctx.db.query("collaborationPayloadOwners").withIndex("by_owner", q => q.eq("ownerId", String(versionId))).collect();
  const refs = new Set(owners.filter(owner => owner.ownerTable === NATIVE_VERSION_OWNER_TABLE).map(owner => owner.payloadRef));
  const seen = new Set<string>();
  const visit = async (value: unknown): Promise<void> => {
    if (!value || typeof value !== "object") return;
    if (isDurableContentRef(value)) {
      const ref = value.spectraContentRef;
      if (ref.artifactId !== artifactId || seen.has(ref.payloadRef)) return;
      seen.add(ref.payloadRef);
      const id = ctx.db.normalizeId("collaborationDurablePayloads", ref.payloadRef);
      const payload = id ? await ctx.db.get(id) : null;
      if (payload?.status === "active" && payload.artifactId === artifactId && payload.kind === "projection" && payload.digest === ref.digest && payload.byteLength === ref.byteLength) {
        for (const nativeRef of payload.dependencies?.nativePayloadRefs ?? []) refs.add(nativeRef);
      }
      return;
    }
    for (const child of Object.values(value)) await visit(child);
  };
  await visit(snapshot);
  return refs;
}
