import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery, internalMutation } from "./functions";
import { v } from "convex/values";
import { getAuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { currentPinnedPlacementHead, hasPlacementAtHead } from "./artifactEmbedPlacementEvidence";

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
