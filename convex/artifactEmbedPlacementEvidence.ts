import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { containsPinnedArtifactPlacement, type PinnedPlacementTarget } from "../shared/artifact-embed-placement";
import { isDurableContentRef } from "../shared/durable-content";
import { snapshotHash } from "./snapshotHash";
import { validateDurablePayload } from "./durablePayloadIntegrity";

// Leaf module: placement evidence reads content and room identity only. It
// must not import authorityShared (which consumes this evidence), so the
// authority core never re-enters itself while modules are being evaluated.
export type PlacementInput = { embed: Doc<"artifactEmbeds">; host: Doc<"spectraArtifacts"> };

export function pinnedPlacementTarget({ embed, host }: PlacementInput): PinnedPlacementTarget | null {
  if (embed.removedAt !== undefined || embed.placementState === "removed" ||
      embed.containerType !== "artifact" || embed.containerId !== String(host._id) ||
      (embed.schoolId !== undefined && embed.schoolId !== host.schoolId) || !["active", "draft"].includes(host.status) ||
      embed.versionPolicy !== "pinned" || !embed.pinnedVersionId) return null;
  return {
    embedId: String(embed._id), containerId: String(host._id),
    containerRegionId: embed.containerRegionId, sourceArtifactId: String(embed.sourceArtifactId),
    pinnedVersionId: String(embed.pinnedVersionId),
    ...(embed.placementOperationId ? { placementOperationId: embed.placementOperationId } : {}),
  };
}

/**
 * Placement evidence only. The caller must independently authorize the current
 * host and source and validate the exact retained version. This predicate never
 * changes retention or treats a legacy/confirmed flag as insertion evidence.
 */
export async function hasCurrentPinnedArtifactPlacement(
  ctx: QueryCtx | MutationCtx,
  input: PlacementInput,
): Promise<boolean> {
  return (await evaluateCurrentPinnedArtifactPlacement(ctx, input)).present;
}

/** The exact head is also the refresh deduplication key. Compute it once for
 * callers that need both the placement decision and recovery identity. */
export async function evaluateCurrentPinnedArtifactPlacement(
  ctx: QueryCtx | MutationCtx,
  input: PlacementInput,
): Promise<{ present: boolean; headHash?: string }> {
  const head = await currentPinnedPlacementHead(ctx, input);
  return head ? { present: hasPlacementAtHead(input, head), headHash: head.headHash } : { present: false };
}

/** Request-local evidence identity; callers may use headHash to dedupe refresh. */
export async function currentPinnedPlacementHead(ctx: QueryCtx | MutationCtx, input: PlacementInput) {
  const target = pinnedPlacementTarget(input);
  if (!target) return null;
  const room = await ctx.db.query("collaborationRooms").withIndex("by_artifact_partition", q =>
    q.eq("artifactId", input.host._id).eq("partitionKey", "root")).unique();
  if (room && room.status !== "closed" &&
      (!["active", "compacting"].includes(room.status) || room.typeKey !== input.host.blueprintKey ||
       !Number.isSafeInteger(room.nextSequence) || room.nextSequence < 1 ||
       (room.lastProjectionSequence ?? 0) < 0 || (room.lastProjectionSequence ?? 0) >= room.nextSequence ||
       room.snapshotSequence < 0 || room.snapshotSequence >= room.nextSequence)) return null;
  const projectionCurrent = !room || room.status === "closed" ||
    (room.lastProjectionSequence ?? 0) >= room.nextSequence - 1;
  if (projectionCurrent && isDurableContentRef(input.host.content)) {
    const ref = input.host.content.spectraContentRef;
    if (ref.artifactId !== String(input.host._id)) return null;
    try {
      await validateDurablePayload(ctx, { artifactId: input.host._id, payloadRef: ref.payloadRef,
        digest: ref.digest, byteLength: ref.byteLength, kind: "projection" });
    } catch { return null; }
  }
  // No preview/presence timestamps: only actual canonical content and durable
  // room identity can invalidate observed membership. Hash the raw content,
  // since legacy contentHash fields need not describe every canonical write.
  const { hash: headHash } = await snapshotHash({
    target, typeKey: input.host.blueprintKey, content: input.host.content,
    versionId: input.host.currentVersionId ?? null,
    liveStateVectorHash: input.host.liveStateVectorHash ?? null,
    room: room ? {
      id: room._id, status: room.status, typeKey: room.typeKey, schemaVersion: room.schemaVersion,
      nextSequence: room.nextSequence, snapshotSequence: room.snapshotSequence,
      lastProjectionSequence: room.lastProjectionSequence ?? 0, policyVersion: room.policyVersion,
    } : null,
  });
  return { target, room, projectionCurrent, headHash };
}

export type PlacementHead = NonNullable<Awaited<ReturnType<typeof currentPinnedPlacementHead>>>;

export function hasPlacementAtHead(input: PlacementInput, head: PlacementHead) {
  if (head.projectionCurrent && !isDurableContentRef(input.host.content)) {
    return containsPinnedArtifactPlacement(input.host.blueprintKey, input.host.content, head.target);
  }
  return input.embed.placementProof?.version === 1 && input.embed.placementProof.headHash === head.headHash;
}
