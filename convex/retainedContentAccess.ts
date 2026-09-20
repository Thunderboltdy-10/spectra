import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import type { AuthenticatedActor } from "./identityShared";
import { evaluateAccessForActor } from "./authorityShared";
import { isSurvivingPinnedEmbed } from "./artifactEmbedOwnership";
import { loadVersionAfter } from "./artifactSnapshots";

/** A retained body is readable only through an authorized surviving pin that
 * references that exact body. Source deletion grants no new authority. */
export async function canReadPinnedContent(ctx: QueryCtx, actor: AuthenticatedActor, artifactId: Id<"spectraArtifacts">, contains: (snapshot: unknown) => boolean) {
  const pins = await ctx.db.query("artifactEmbeds").withIndex("by_source", q => q.eq("sourceArtifactId", artifactId)).collect();
  for (const pin of pins) {
    if (!isSurvivingPinnedEmbed(pin) || pin.schoolId !== actor.schoolId) continue;
    let allowed = false;
    if (pin.containerType === "thread") {
      const id = ctx.db.normalizeId("spectraThreads", pin.containerId);
      const thread = id ? await ctx.db.get(id) : null;
      allowed = Boolean(thread && thread.status !== "deleted" && thread.ownerAccountId === actor.accountId && thread.schoolId === actor.schoolId);
    } else {
      const id = ctx.db.normalizeId("spectraArtifacts", pin.containerId);
      const container = id ? await ctx.db.get(id) : null;
      if (container?.status === "active" && container.schoolId === actor.schoolId) {
        const access = await evaluateAccessForActor(ctx, actor, container.blueprintKey === "agent" ? "agent" : "artifact", container._id);
        allowed = access.allowed && access.capabilities.includes("read");
      }
    }
    if (!allowed) continue;
    const version = await ctx.db.get(pin.pinnedVersionId!);
    if (!version || version.artifactId !== artifactId) continue;
    if (contains(await loadVersionAfter(ctx, version))) return true;
  }
  return false;
}

export function snapshotReferencesNative(value: unknown, hash: string, refs = new Set<string>()): boolean {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  if (source.sourcePayloadHash === hash) return true;
  if (Array.isArray(source.nativePayloadRefs)) for (const ref of source.nativePayloadRefs) if (typeof ref === "string") refs.add(ref);
  if (Array.isArray(source.nativePayloadHashes) && source.nativePayloadHashes.includes(hash)) return true;
  return Object.values(source).some(child => snapshotReferencesNative(child, hash, refs));
}
