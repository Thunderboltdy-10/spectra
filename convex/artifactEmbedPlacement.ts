import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { containsPinnedArtifactPlacement, type PinnedPlacementTarget } from "../shared/artifact-embed-placement";
import { isDurableContentRef } from "../shared/durable-content";
import { snapshotHash } from "./artifactSnapshots";
import { validateDurablePayload } from "./collaborationDurablePayload";
import { getAuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";

type PlacementInput = { embed: Doc<"artifactEmbeds">; host: Doc<"spectraArtifacts"> };

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
  const head = await currentPinnedPlacementHead(ctx, input);
  return head !== null && hasPlacementAtHead(input, head);
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

type PlacementHead = NonNullable<Awaited<ReturnType<typeof currentPinnedPlacementHead>>>;

function hasPlacementAtHead(input: PlacementInput, head: PlacementHead) {
  if (head.projectionCurrent && !isDurableContentRef(input.host.content)) {
    return containsPinnedArtifactPlacement(input.host.blueprintKey, input.host.content, head.target);
  }
  return input.embed.placementProof?.version === 1 && input.embed.placementProof.headHash === head.headHash;
}

async function authorizedHead(ctx: QueryCtx | MutationCtx, embedId: Id<"artifactEmbeds">) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
  const embed = await ctx.db.get(embedId);
  const hostId = embed?.containerType === "artifact"
    ? ctx.db.normalizeId("spectraArtifacts", embed.containerId) : null;
  const host = hostId ? await ctx.db.get(hostId) : null;
  if (!embed || !host) return null;
  await requireActorArtifactCapability(ctx, actor, host._id, "read");
  const head = await currentPinnedPlacementHead(ctx, { embed, host });
  return head ? { embed, host, head } : null;
}

/** Internal-only head: no host body is exposed by the public refresh action. */
export const loadHead = internalQuery({
  args: { embedId: v.id("artifactEmbeds") },
  handler: async (ctx, args) => {
    const value = await authorizedHead(ctx, args.embedId);
    if (!value) return null;
    return { ...value.head, content: value.host.content, typeKey: value.host.blueprintKey,
      proven: hasPlacementAtHead(value, value.head) };
  },
});

/** A covering snapshot and keyset pages of at most 100 current-head updates.
 * No retained-version scan, arbitrary snapshot-history cap, or partial proof. */
export const loadRoomPage = internalQuery({
  args: { embedId: v.id("artifactEmbeds"), headHash: v.string(), afterSequence: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const current = await authorizedHead(ctx, args.embedId);
    if (!current || current.head.headHash !== args.headHash) return null;
    const room = current.head.room;
    if (!room || room.status === "closed") return null;
    const snapshot = args.afterSequence === undefined
      ? await ctx.db.query("collaborationSnapshots").withIndex("by_room_status_sequence", q =>
        q.eq("roomId", room._id).eq("status", "verified").lte("throughSequence", room.nextSequence - 1))
        .order("desc").first() : null;
    const after = args.afterSequence ?? snapshot?.throughSequence ?? 0;
    const result = await ctx.db.query("collaborationUpdates").withIndex("by_room_sequence", q =>
      q.eq("roomId", room._id).gt("sequence", after).lt("sequence", room.nextSequence)).order("asc")
      .paginate({ cursor: null, numItems: 100, maximumRowsRead: 100, maximumBytesRead: 1_400_000 });
    return {
      roomId: room._id, nextSequence: room.nextSequence, afterSequence: after,
      snapshot: snapshot ? {
        id: snapshot._id, throughSequence: snapshot.throughSequence, update: snapshot.update,
        contentHash: snapshot.contentHash, byteLength: snapshot.byteLength ?? snapshot.update.byteLength,
        stateVector: snapshot.stateVector, payloadRef: snapshot.payloadRef ?? null,
        payloadDigest: snapshot.payloadDigest ?? null,
      } : null,
      updates: result.page.map(update => ({
        sequence: update.sequence, update: update.update, byteLength: update.byteLength,
        stateVectorHash: update.stateVectorHash,
        payloadRef: update.payloadRef ?? null, payloadDigest: update.payloadDigest ?? null,
      })),
    };
  },
});

/** Only the server action that read and verified the actual content calls this.
 * A CAS failure writes nothing. Permission is not part of the stored proof. */
export const recordProof = internalMutation({
  args: { embedId: v.id("artifactEmbeds"), headHash: v.string() },
  handler: async (ctx, args) => {
    const current = await authorizedHead(ctx, args.embedId);
    if (!current || current.head.headHash !== args.headHash) return false;
    if (current.embed.placementProof?.headHash === args.headHash) return true;
    await ctx.db.patch(current.embed._id, {
      placementProof: { version: 1, headHash: args.headHash, observedAt: Date.now() },
    });
    return true;
  },
});
