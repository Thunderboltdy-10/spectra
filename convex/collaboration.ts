import { internalMutation, mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import * as Y from "yjs";
import { requireArtifactCapability } from "./spectraShared";
import {
  projectTimetableSharedContent,
  timetableContentContainsPersonalState,
} from "./quizPrivacy";
import { personalStateFromLegacyTimetable } from "./artifactUserStates";
import { bumpPolicyVersion } from "./authorityShared";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireDurablePayloadAuthority, validateDurablePayload } from "./collaborationDurablePayload";

const RETIRED_ROOM_CLEANUP_BATCH = 128;

async function migrateLegacyTimetableState(
  ctx: MutationCtx,
  artifact: Doc<"spectraArtifacts">,
) {
  if (
    artifact.blueprintKey !== "timetable" ||
    !timetableContentContainsPersonalState(artifact.content)
  )
    return false;
  const existingState = await ctx.db
    .query("artifactUserStates")
    .withIndex("by_artifact_account_kind", (q) =>
      q
        .eq("artifactId", artifact._id)
        .eq("accountId", artifact.ownerAccountId)
        .eq("kind", "timetable"),
    )
    .unique();
  const now = Date.now();
  if (!existingState && artifact.schoolId) {
    const state = personalStateFromLegacyTimetable(artifact.content);
    const byteLength = new TextEncoder().encode(
      JSON.stringify(state),
    ).byteLength;
    await ctx.db.insert("artifactUserStates", {
      artifactId: artifact._id,
      schoolId: artifact.schoolId,
      accountId: artifact.ownerAccountId,
      kind: "timetable",
      state,
      revision: 1,
      byteLength,
      createdAt: now,
      updatedAt: now,
    });
  }
  const sharedContent = projectTimetableSharedContent(artifact.content);
  await ctx.db.patch(artifact._id, {
    content: sharedContent,
    contentHash: undefined,
    textIndex: `${artifact.title}\n${artifact.summary ?? ""}\n${artifact.tags.join(" ")}\n${JSON.stringify(sharedContent).slice(0, 80_000)}`,
    liveStateVectorHash: undefined,
    syncState: "synchronized",
    lastSynchronizedAt: now,
    updatedAt: now,
  });
  return true;
}

async function getRoom(
  ctx: Parameters<typeof requireArtifactCapability>[0],
  artifactId: Parameters<typeof requireArtifactCapability>[1],
  partitionKey: string,
) {
  return ctx.db
    .query("collaborationRooms")
    .withIndex("by_artifact_partition", (q) =>
      q.eq("artifactId", artifactId).eq("partitionKey", partitionKey),
    )
    .unique();
}

/**
 * A work that moved between this computer and the cloud starts a new room:
 * the old one holds a different history of the same words, and merging two
 * independent histories doubles every paragraph (F19). Open editors are
 * disconnected by the policy bump and rejoin the fresh room.
 */
export async function retireRoomsForStorageMove(ctx: MutationCtx, artifact: Doc<"spectraArtifacts">) {
  const rooms = await ctx.db
    .query("collaborationRooms")
    .withIndex("by_artifact_partition", (q) => q.eq("artifactId", artifact._id))
    .take(16);
  const now = Date.now();
  let retired = 0;
  for (const room of rooms) {
    if (room.status === "closed" || room.partitionKey.startsWith("__retired__:")) continue;
    await ctx.db.patch(room._id, { partitionKey: `__retired__:${room._id}`, status: "closed", updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.collaboration.compactRetiredRoom, { roomId: room._id });
    retired += 1;
  }
  if (retired) await bumpPolicyVersion(ctx, "artifact", artifact._id, artifact.schoolId, artifact.ownerAccountId);
  return retired;
}

async function rotateRoomForSchema(
  ctx: MutationCtx,
  room: Doc<"collaborationRooms">,
  artifact: Doc<"spectraArtifacts">,
  schemaVersion: number,
  policyVersion: number,
) {
  const now = Date.now();
  const partitionKey = room.partitionKey;
  await ctx.db.patch(room._id, {
    partitionKey: `__retired__:${room._id}`,
    status: "closed",
    updatedAt: now,
  });
  const roomId = await ctx.db.insert("collaborationRooms", {
    artifactId: artifact._id,
    schoolId: artifact.schoolId,
    typeKey: artifact.blueprintKey,
    provider: "self_hosted_yjs",
    partitionKey,
    schemaVersion,
    policyVersion,
    status: "active",
    nextSequence: 1,
    snapshotSequence: 0,
    uncompactedBytes: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(artifact._id, { schemaVersion });
  await ctx.scheduler.runAfter(
    0,
    internal.collaboration.compactRetiredRoom,
    { roomId: room._id },
  );
  return {
    roomId,
    provider: "self_hosted_yjs" as const,
    policyVersion,
    schemaVersion,
    nextSequence: 1,
  };
}

export const ensureRoom = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    partitionKey: v.optional(v.string()),
    schemaVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const { artifact, capabilities } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "read",
    );
    if (artifact.status !== "active" && artifact.status !== "draft")
      throw new Error(
        "COLLABORATION_ROOM_CLOSED: Archived artifacts are read-only.",
      );
    const partitionKey = args.partitionKey?.trim().slice(0, 180) || "root";
    const existing = await getRoom(ctx, args.artifactId, partitionKey);
    const migrated = await migrateLegacyTimetableState(ctx, artifact);
    const migrationPolicyVersion = migrated
      ? await bumpPolicyVersion(
          ctx,
          "artifact",
          artifact._id,
          artifact.schoolId,
          artifact.ownerAccountId,
        )
      : undefined;
    if (existing) {
      if (existing.status === "closed")
        throw new Error(
          "COLLABORATION_ROOM_CLOSED: This artifact is no longer editable.",
        );
      const requestedVersion = Math.max(1, Math.floor(args.schemaVersion));
      if (requestedVersion < existing.schemaVersion)
        throw new Error("COLLABORATION_CLIENT_SCHEMA_OUTDATED");
      if (
        !migrated &&
        requestedVersion > existing.schemaVersion &&
        capabilities.includes("modify")
      ) {
        const policyVersion = await bumpPolicyVersion(
          ctx,
          "artifact",
          artifact._id,
          artifact.schoolId,
          artifact.ownerAccountId,
        );
        return rotateRoomForSchema(
          ctx,
          existing,
          artifact,
          requestedVersion,
          policyVersion,
        );
      }
      if (migrated) {
        return rotateRoomForSchema(
          ctx,
          existing,
          artifact,
          Math.max(requestedVersion, existing.schemaVersion + 1),
          migrationPolicyVersion ?? existing.policyVersion,
        );
      }
      return {
        roomId: existing._id,
        provider: existing.provider,
        policyVersion: existing.policyVersion,
        schemaVersion: existing.schemaVersion,
        nextSequence: existing.nextSequence,
      };
    }
    const now = Date.now();
    const policy = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_resource", (q) =>
        q
          .eq(
            "resourceType",
            artifact.blueprintKey === "agent" ? "agent" : "artifact",
          )
          .eq("resourceId", artifact._id),
      )
      .unique();
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
    return {
      roomId,
      provider: "self_hosted_yjs" as const,
      policyVersion: policy?.version ?? 0,
      schemaVersion: Math.max(1, Math.floor(args.schemaVersion)),
      nextSequence: 1,
    };
  },
});

/** Delete one bounded page of a room generation retired by ensureRoom. */
export const compactRetiredRoom = internalMutation({
  args: { roomId: v.id("collaborationRooms") },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (
      !room ||
      room.status !== "closed" ||
      !room.partitionKey.startsWith("__retired__:")
    )
      return { cleaned: 0, done: true };
    const [updates, snapshots, receipts] = await Promise.all([
      ctx.db
        .query("collaborationUpdates")
        .withIndex("by_room_sequence", (q) => q.eq("roomId", room._id))
        .take(RETIRED_ROOM_CLEANUP_BATCH),
      ctx.db
        .query("collaborationSnapshots")
        .withIndex("by_room_sequence", (q) => q.eq("roomId", room._id))
        .take(RETIRED_ROOM_CLEANUP_BATCH),
      ctx.db.query("collaborationReceipts").withIndex("by_room_idempotency", q => q.eq("roomId", room._id)).take(RETIRED_ROOM_CLEANUP_BATCH),
    ]);
    await Promise.all([
      ...updates.map((update) => ctx.db.delete(update._id)),
      ...snapshots.map((snapshot) => ctx.db.delete(snapshot._id)),
      ...receipts.map((receipt) => ctx.db.delete(receipt._id)),
    ]);
    const done =
      updates.length < RETIRED_ROOM_CLEANUP_BATCH &&
      snapshots.length < RETIRED_ROOM_CLEANUP_BATCH && receipts.length < RETIRED_ROOM_CLEANUP_BATCH;
    if (done) {
      await ctx.db.patch(room._id, {
        nextSequence: 1,
        snapshotSequence: 0,
        uncompactedBytes: 0,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.collaboration.compactRetiredRoom,
        { roomId: room._id },
      );
    }
    return { cleaned: updates.length + snapshots.length, done };
  },
});

export const storeSnapshot = internalMutation({
  args: {
    accountId: v.optional(v.id("accounts")),
    policyVersion: v.optional(v.number()),
    roomId: v.id("collaborationRooms"),
    throughSequence: v.number(),
    update: v.bytes(),
    stateVector: v.bytes(),
    contentHash: v.string(),
    schemaVersion: v.number(),
    createdBy: v.union(
      v.literal("compactor"),
      v.literal("recovery"),
      v.literal("migration"),
    ),
    payloadRef: v.optional(v.string()),
    payloadDigest: v.optional(v.string()),
    payloadManifest: v.optional(v.any()),
    byteLength: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (room && args.accountId !== undefined && args.policyVersion !== undefined)
      await requireDurablePayloadAuthority(ctx, { accountId: args.accountId, policyVersion: args.policyVersion, artifactId: room.artifactId, partitionKey: room.partitionKey }, true);
    if (
      !room ||
      args.throughSequence <= room.snapshotSequence ||
      args.throughSequence >= room.nextSequence
    )
      throw new Error(
        "COLLABORATION_SNAPSHOT_BOUNDARY: Snapshot boundary is invalid.",
      );
    const durableHead = await ctx.db
      .query("collaborationUpdates")
      .withIndex("by_room_sequence", (q) =>
        q.eq("roomId", room._id).eq("sequence", args.throughSequence),
      )
      .unique();
    const stateVectorDigest = await crypto.subtle.digest(
      "SHA-256",
      args.stateVector,
    );
    const stateVectorHash = btoa(
      String.fromCharCode(...new Uint8Array(stateVectorDigest)),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    if (!durableHead || durableHead.stateVectorHash !== stateVectorHash)
      throw new Error(
        "COLLABORATION_SNAPSHOT_HEAD_MISMATCH: Snapshot state is not the durable sequence head.",
      );
    const now = Date.now();
    if (args.payloadRef) {
      await validateDurablePayload(ctx, { artifactId: room.artifactId, accountId: args.accountId, policyVersion: args.policyVersion,
        payloadRef: args.payloadRef, digest: args.payloadDigest ?? "", byteLength: args.byteLength, kind: "yjs-snapshot" });
      if (!args.payloadDigest || !args.byteLength)
        throw new Error("COLLABORATION_SNAPSHOT_PAYLOAD_INVALID");
      if (args.update.byteLength !== 0)
        throw new Error("COLLABORATION_SNAPSHOT_PAYLOAD_INLINE_CONFLICT");
    } else if (args.update.byteLength <= 0) {
      throw new Error("COLLABORATION_SNAPSHOT_UPDATE_INVALID");
    }
    const snapshotId = await ctx.db.insert("collaborationSnapshots", {
      roomId: room._id,
      artifactId: room.artifactId,
      schoolId: room.schoolId,
      throughSequence: args.throughSequence,
      update: args.update,
      stateVector: args.stateVector,
      contentHash: args.contentHash,
      schemaVersion: args.schemaVersion,
      status: "pending",
      createdBy: args.createdBy,
      createdAt: now,
      accountId: args.accountId,
      policyVersion: args.policyVersion,
      payloadRef: args.payloadRef,
      payloadDigest: args.payloadDigest,
      payloadManifest: args.payloadManifest,
      byteLength: args.byteLength ?? args.update.byteLength,
    });
    await ctx.db.patch(room._id, { status: "compacting", updatedAt: now });
    return snapshotId;
  },
});

export const verifySnapshot = internalMutation({
  args: { snapshotId: v.id("collaborationSnapshots"), verifiedPayloadDigest: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get(args.snapshotId);
    if (!snapshot) throw new Error("COLLABORATION_SNAPSHOT_NOT_FOUND");
    const room = await ctx.db.get(snapshot.roomId);
    if (!room) throw new Error("COLLABORATION_ROOM_NOT_FOUND");
    if (snapshot.accountId !== undefined && snapshot.policyVersion !== undefined)
      await requireDurablePayloadAuthority(ctx, { accountId: snapshot.accountId, policyVersion: snapshot.policyVersion, artifactId: room.artifactId, partitionKey: room.partitionKey }, true);
    const now = Date.now();
    if (snapshot.status === "verified") return { status: "verified" as const, compacted: 0 };
    if (snapshot.throughSequence <= room.snapshotSequence) {
      await ctx.db.patch(snapshot._id, { status: "superseded", verifiedAt: now });
      return { status: "superseded" as const, compacted: 0 };
    }
    let valid = false;
    try {
      const updateBytes = new Uint8Array(snapshot.update);
      if (snapshot.payloadRef) {
        await validateDurablePayload(ctx, { artifactId: snapshot.artifactId, payloadRef: snapshot.payloadRef,
          digest: snapshot.payloadDigest ?? "", byteLength: snapshot.byteLength, kind: "yjs-snapshot" });
        valid = args.verifiedPayloadDigest === snapshot.payloadDigest;
      } else {
      const digest = await crypto.subtle.digest("SHA-256", updateBytes);
      const hash = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
      const document = new Y.Doc();
      Y.applyUpdate(document, updateBytes);
      const expectedStateVector = Y.encodeStateVector(document);
      const storedStateVector = new Uint8Array(snapshot.stateVector);
      valid =
        hash === snapshot.contentHash &&
        expectedStateVector.byteLength === storedStateVector.byteLength &&
        expectedStateVector.every(
          (byte, index) => byte === storedStateVector[index],
        );
      document.destroy();
      }
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
    const previous = await ctx.db
      .query("collaborationSnapshots")
      .withIndex("by_room_sequence", (q) => q.eq("roomId", room._id))
      .collect();
    await Promise.all(
      previous
        .filter(
          (candidate) =>
            candidate._id !== snapshot._id &&
            (candidate.status === "verified" ||
              candidate.status === "superseded") &&
            candidate.throughSequence <= snapshot.throughSequence,
        )
        .map((candidate) => ctx.db.delete(candidate._id)),
    );
    const compacted = await ctx.db
      .query("collaborationUpdates")
      .withIndex("by_room_sequence", (q) =>
        q.eq("roomId", room._id).lte("sequence", snapshot.throughSequence),
      )
      .collect();
    await Promise.all(compacted.map((update) => ctx.db.delete(update._id)));
    const remainingBytes = Math.max(
      0,
      room.uncompactedBytes -
        compacted.reduce((total, update) => total + update.byteLength, 0),
    );
    await ctx.db.patch(snapshot._id, { status: "verified", verifiedAt: now });
    await ctx.db.patch(room._id, {
      status: "active",
      snapshotSequence: snapshot.throughSequence,
      uncompactedBytes: remainingBytes,
      lastSnapshotAt: now,
      updatedAt: now,
    });
    return { status: "verified" as const, compacted: compacted.length };
  },
});
