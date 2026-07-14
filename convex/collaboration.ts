import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";
import * as Y from "yjs";
import { requireArtifactCapability } from "./spectraShared";

async function getRoom(ctx: Parameters<typeof requireArtifactCapability>[0], artifactId: Parameters<typeof requireArtifactCapability>[1], partitionKey: string) {
  return ctx.db.query("collaborationRooms")
    .withIndex("by_artifact_partition", (q) => q.eq("artifactId", artifactId).eq("partitionKey", partitionKey))
    .unique();
}

export const ensureRoom = mutation({
  args: { artifactId: v.id("spectraArtifacts"), partitionKey: v.optional(v.string()), schemaVersion: v.number() },
  handler: async (ctx, args) => {
    const { artifact } = await requireArtifactCapability(ctx, args.artifactId, "read");
    const partitionKey = args.partitionKey?.trim().slice(0, 180) || "root";
    const existing = await getRoom(ctx, args.artifactId, partitionKey);
    if (existing) {
      if (existing.status === "closed") throw new Error("COLLABORATION_ROOM_CLOSED: This artifact is no longer editable.");
      return { roomId: existing._id, provider: existing.provider, policyVersion: existing.policyVersion, schemaVersion: existing.schemaVersion, nextSequence: existing.nextSequence };
    }
    const now = Date.now();
    const policy = await ctx.db.query("resourcePolicies").withIndex("by_resource", (q) => q.eq("resourceType", artifact.blueprintKey === "agent" ? "agent" : "artifact").eq("resourceId", artifact._id)).unique();
    const roomId = await ctx.db.insert("collaborationRooms", {
      artifactId: artifact._id,
      schoolId: artifact.schoolId,
      typeKey: artifact.blueprintKey,
      provider: "self_hosted_yjs",
      partitionKey,
      schemaVersion: Math.max(1, Math.floor(args.schemaVersion)),
      policyVersion: policy?.version ?? 0,
      status: "active",
      nextSequence: 1,
      snapshotSequence: 0,
      uncompactedBytes: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { roomId, provider: "self_hosted_yjs" as const, policyVersion: policy?.version ?? 0, schemaVersion: Math.max(1, Math.floor(args.schemaVersion)), nextSequence: 1 };
  },
});

export const storeSnapshot = internalMutation({
  args: { roomId: v.id("collaborationRooms"), throughSequence: v.number(), update: v.bytes(), stateVector: v.bytes(), contentHash: v.string(), schemaVersion: v.number(), createdBy: v.union(v.literal("compactor"), v.literal("recovery"), v.literal("migration")) },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room || args.throughSequence <= room.snapshotSequence || args.throughSequence >= room.nextSequence) throw new Error("COLLABORATION_SNAPSHOT_BOUNDARY: Snapshot boundary is invalid.");
    const now = Date.now();
    const snapshotId = await ctx.db.insert("collaborationSnapshots", { roomId: room._id, artifactId: room.artifactId, schoolId: room.schoolId, throughSequence: args.throughSequence, update: args.update, stateVector: args.stateVector, contentHash: args.contentHash, schemaVersion: args.schemaVersion, status: "pending", createdBy: args.createdBy, createdAt: now });
    await ctx.db.patch(room._id, { status: "compacting", updatedAt: now });
    return snapshotId;
  },
});

export const verifySnapshot = internalMutation({
  args: { snapshotId: v.id("collaborationSnapshots") },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get(args.snapshotId);
    if (!snapshot) throw new Error("COLLABORATION_SNAPSHOT_NOT_FOUND");
    const room = await ctx.db.get(snapshot.roomId);
    if (!room) throw new Error("COLLABORATION_ROOM_NOT_FOUND");
    const now = Date.now();
    let valid = false;
    try {
      const digest = await crypto.subtle.digest("SHA-256", snapshot.update);
      const hash = btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      const document = new Y.Doc();
      Y.applyUpdate(document, new Uint8Array(snapshot.update));
      const expectedStateVector = Y.encodeStateVector(document);
      const storedStateVector = new Uint8Array(snapshot.stateVector);
      valid = hash === snapshot.contentHash
        && expectedStateVector.byteLength === storedStateVector.byteLength
        && expectedStateVector.every((byte, index) => byte === storedStateVector[index]);
      document.destroy();
    } catch {
      valid = false;
    }
    if (!valid) {
      await ctx.db.patch(snapshot._id, { status: "corrupt", verifiedAt: now });
      // The update log and previous verified snapshot remain authoritative, so
      // a failed candidate must not take the active room offline.
      await ctx.db.patch(room._id, { status: "active", updatedAt: now });
      return { status: "corrupt" as const };
    }
    const previous = await ctx.db.query("collaborationSnapshots").withIndex("by_room_sequence", (q) => q.eq("roomId", room._id)).collect();
    await Promise.all(previous.filter((candidate) => candidate._id !== snapshot._id && candidate.status === "verified" && candidate.throughSequence <= snapshot.throughSequence).map((candidate) => ctx.db.patch(candidate._id, { status: "superseded" })));
    const compacted = await ctx.db.query("collaborationUpdates").withIndex("by_room_sequence", (q) => q.eq("roomId", room._id).lte("sequence", snapshot.throughSequence)).collect();
    await Promise.all(compacted.map((update) => ctx.db.delete(update._id)));
    const remainingBytes = Math.max(0, room.uncompactedBytes - compacted.reduce((total, update) => total + update.byteLength, 0));
    await ctx.db.patch(snapshot._id, { status: "verified", verifiedAt: now });
    await ctx.db.patch(room._id, { status: "active", snapshotSequence: snapshot.throughSequence, uncompactedBytes: remainingBytes, lastSnapshotAt: now, updatedAt: now });
    return { status: "verified" as const, compacted: compacted.length };
  },
});
