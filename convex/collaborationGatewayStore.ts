import { internalQuery } from "./_generated/server";
import { internalMutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  evaluateAccessForActor,
  evaluateArtifactAccessForActor,
  loadArtifactAuthority,
} from "./authorityShared";
import { getActorForAccountId } from "./identityShared";
import { internal } from "./_generated/api";
import { commitChangeGroup, HUMAN_CHANGE_IDLE_MS } from "./changeGroups";
import { timetableContentContainsPersonalState } from "./quizPrivacy";
import { changedArtifactRegionIds } from "../src/features/spectra/collaboration/artifact-yjs-model";
import { syncSourceNodes } from "./orgTreeShared";
import { isArtifactTypeKey } from "../src/features/spectra/artifacts/registry";
import { claimAuthorizesGatewayUpdate } from "./collaborationClaimAuthorization";
import { encodeArtifactContentForStorage } from "../shared/sheet-cells";
import { fitChangeGroupSnapshots } from "../shared/collaboration-change-group-capacity";
import { filenameFromRelativePath } from "../shared/native-filename";
import {
  finalizeArtifactSummary,
  isGeneratedArtifactSummary,
  type BlueprintKey,
} from "./spectraShared";

const NATIVE_PROJECTION_REGION = "$spectra:native-projection";
const MAX_GATEWAY_UPDATE_BYTES = 760 * 1024;
// Keep aligned with scripts/collaboration-update-envelope.mjs — fail closed on
// either JS string length or UTF-8 bytes so multibyte Office text cannot pass
// the character gate and still overflow the Convex document ceiling.
const MAX_PROJECTION_JSON_CHARS = 900_000;
const MAX_PROJECTION_JSON_UTF8_BYTES = 900_000;

function projectionExceedsDurableBound(projectionJson: string): boolean {
  if (projectionJson.length > MAX_PROJECTION_JSON_CHARS) return true;
  return (
    new TextEncoder().encode(projectionJson).byteLength >
    MAX_PROJECTION_JSON_UTF8_BYTES
  );
}

type GatewayProjection = {
  title: string;
  summary?: string;
  tags: string[];
  typeKey: string;
  schemaVersion: number;
  content: unknown;
};

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (!candidate || typeof candidate !== "object") return candidate;
    return Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  };
  return JSON.stringify(normalize(value));
}

function artifactProjectionPatch(
  projection: GatewayProjection,
  projectionHash: string,
) {
  return {
    title: projection.title,
    summary: projection.summary,
    tags: projection.tags,
    content: encodeArtifactContentForStorage(
      projection.typeKey,
      projection.content,
    ),
    schemaVersion: projection.schemaVersion,
    validity: "valid" as const,
    validityIssues: [] as [],
    contentHash: projectionHash,
    textIndex: `${projection.title}\n${projection.summary ?? ""}\n${projection.tags.join(" ")}\n${JSON.stringify(projection.content).slice(0, 80_000)}`,
  };
}

async function listingNameForNativeWork(
  ctx: MutationCtx,
  artifact: {
    _id: Id<"spectraArtifacts">;
    title: string;
    nativeFormat?: string;
  },
  projectedTitle: string,
) {
  if (!artifact.nativeFormat) return projectedTitle;
  const local = await ctx.db
    .query("workReplicas")
    .withIndex("by_work_kind", (q) =>
      q.eq("workId", artifact._id).eq("kind", "local"),
    )
    .first();
  if (!local?.relativePath) return artifact.title || projectedTitle;
  return filenameFromRelativePath(local.relativePath);
}

async function syncListingAfterProjection(
  ctx: MutationCtx,
  artifact: {
    _id: Id<"spectraArtifacts">;
    title: string;
    nativeFormat?: string;
  },
  projectedTitle: string,
) {
  const listingTitle = await listingNameForNativeWork(
    ctx,
    artifact,
    projectedTitle,
  );
  if (listingTitle !== projectedTitle)
    await ctx.db.patch(artifact._id, {
      title: listingTitle,
      updatedAt: Date.now(),
    });
  await syncSourceNodes(ctx, "work", artifact._id, listingTitle);
}

function parseGatewayProjection(
  projectionJson: string | undefined,
  projectionHash: string | undefined,
  artifact: {
    blueprintKey: string;
    summary?: string;
  },
): GatewayProjection | null {
  if (!projectionJson) return null;
  if (
    projectionExceedsDurableBound(projectionJson) ||
    !projectionHash ||
    projectionHash.length < 16
  )
    throw new Error("COLLABORATION_PROJECTION_SIZE");
  const parsed: unknown = JSON.parse(projectionJson);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("COLLABORATION_PROJECTION_INVALID");
  const value = parsed as Record<string, unknown>;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const rawSummary =
    typeof value.summary === "string" ? value.summary.trim() : undefined;
  const tags = Array.isArray(value.tags) ? value.tags : [];
  if (
    !title ||
    title.length > 300 ||
    (rawSummary?.length ?? 0) > 2_000 ||
    tags.length > 80 ||
    !tags.every((tag) => typeof tag === "string" && tag.length <= 100) ||
    value.typeKey !== artifact.blueprintKey ||
    !Number.isSafeInteger(value.schemaVersion) ||
    (value.schemaVersion as number) < 1 ||
    value.content === undefined
  )
    throw new Error("COLLABORATION_PROJECTION_INVALID");
  if (
    artifact.blueprintKey === "timetable" &&
    timetableContentContainsPersonalState(value.content)
  )
    throw new Error("COLLABORATION_TIMETABLE_PERSONAL_STATE_FORBIDDEN");
  const summary = isGeneratedArtifactSummary(
    artifact.summary,
    artifact.blueprintKey as BlueprintKey,
  )
    ? finalizeArtifactSummary({
        blueprintKey: artifact.blueprintKey as BlueprintKey,
        title,
        summary: undefined,
        content: value.content,
      })
    : rawSummary;
  return {
    title,
    ...(summary ? { summary } : {}),
    tags: tags as string[],
    typeKey: value.typeKey as string,
    schemaVersion: value.schemaVersion as number,
    content: value.content,
  };
}

export const policy = internalQuery({
  args: { artifactId: v.id("spectraArtifacts"), partitionKey: v.string() },
  handler: async (ctx, args) => {
    // Authority summary only — never db.get the fat artifact row (200k sheets).
    const [authority, room] = await Promise.all([
      loadArtifactAuthority(ctx, args.artifactId),
      ctx.db
        .query("collaborationRooms")
        .withIndex("by_artifact_partition", (q) =>
          q
            .eq("artifactId", args.artifactId)
            .eq("partitionKey", args.partitionKey),
        )
        .unique(),
    ]);
    if (
      !authority ||
      !room ||
      room.status === "closed" ||
      authority.lifecycle === "deleted"
    )
      return {
        available: false as const,
        policyVersion: room?.policyVersion ?? null,
      };
    return {
      available: true as const,
      policyVersion: room.policyVersion,
      roomStatus: room.status,
    };
  },
});

export const authorize = internalQuery({
  args: {
    accountId: v.id("accounts"),
    artifactId: v.id("spectraArtifacts"),
    partitionKey: v.string(),
    policyVersion: v.number(),
  },
  handler: async (ctx, args) => {
    // Hot path for every collab message refresh: use the compact authority
    // summary, never spectraArtifacts.content. Loading a 200k-cell sheet body
    // inside this 1s query was the live beforeHandleMessage Convex timeout.
    const [actor, room] = await Promise.all([
      getActorForAccountId(ctx, args.accountId),
      ctx.db
        .query("collaborationRooms")
        .withIndex("by_artifact_partition", (q) =>
          q
            .eq("artifactId", args.artifactId)
            .eq("partitionKey", args.partitionKey),
        )
        .unique(),
    ]);
    if (!actor || !room || room.status === "closed")
      return { allowed: false as const, reason: "unavailable" as const };
    const decision = await evaluateArtifactAccessForActor(
      ctx,
      actor,
      args.artifactId,
    );
    const loaded = "loaded" in decision ? decision.loaded : null;
    if (
      !loaded ||
      (loaded.lifecycle !== "active" && loaded.lifecycle !== "draft") ||
      loaded.schoolId !== actor.schoolId
    )
      return { allowed: false as const, reason: "unavailable" as const };
    const resourceType =
      loaded.resource.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const policy = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", resourceType).eq("resourceId", args.artifactId),
      )
      .unique();
    const currentPolicyVersion = policy?.version ?? 0;
    // Ownership is the strongest edit grant. A stale or incomplete policy
    // projection must never turn an owner into a read-level room participant;
    // the surrounding policy version checks still fail closed on revocation.
    const canModify =
      loaded.ownerAccountId === actor.accountId ||
      decision.capabilities.includes("modify");
    if (
      loaded.resource.blueprintKey === "quiz" &&
      decision.allowed &&
      !canModify
    ) {
      return {
        allowed: false as const,
        reason: "quiz_practice_projection_required" as const,
        currentPolicyVersion,
      };
    }
    if (
      !decision.allowed ||
      currentPolicyVersion !== args.policyVersion ||
      room.policyVersion !== currentPolicyVersion
    ) {
      return {
        allowed: false as const,
        reason: decision.allowed
          ? ("policy_changed" as const)
          : decision.reason,
        currentPolicyVersion,
      };
    }
    return {
      allowed: true as const,
      level: decision.level,
      canModify,
      roomId: room._id,
      schoolId: actor.schoolId,
      displayName: actor.name || actor.email,
      currentPolicyVersion,
      schemaVersion: room.schemaVersion,
    };
  },
});

export const load = internalQuery({
  args: {
    artifactId: v.id("spectraArtifacts"),
    partitionKey: v.string(),
    afterSequence: v.number(),
    limit: v.number(),
    includeInitialProjection: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("collaborationRooms")
      .withIndex("by_artifact_partition", (q) =>
        q
          .eq("artifactId", args.artifactId)
          .eq("partitionKey", args.partitionKey),
      )
      .unique();
    if (!room || room.status === "closed") return null;
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) return null;
    const snapshot = await ctx.db
      .query("collaborationSnapshots")
      .withIndex("by_room_sequence", (q) => q.eq("roomId", room._id))
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "verified"))
      .first();
    const start = Math.max(args.afterSequence, snapshot?.throughSequence ?? 0);
    const limit = Math.max(1, Math.min(Math.floor(args.limit), 500));
    const updates = await ctx.db
      .query("collaborationUpdates")
      .withIndex("by_room_sequence", (q) =>
        q.eq("roomId", room._id).gt("sequence", start),
      )
      .order("asc")
      .take(limit);
    return {
      roomId: room._id,
      schemaVersion: room.schemaVersion,
      nextSequence: room.nextSequence,
      snapshot: snapshot
        ? {
            throughSequence: snapshot.throughSequence,
            update: snapshot.update,
            stateVector: snapshot.stateVector,
            contentHash: snapshot.contentHash,
            byteLength: snapshot.byteLength ?? snapshot.update.byteLength,
            payloadRef: snapshot.payloadRef ?? null,
            payloadDigest: snapshot.payloadDigest ?? null,
            payloadManifest: snapshot.payloadManifest ?? null,
          }
        : null,
      updates: updates.map((update) => ({
        sequence: update.sequence,
        update: update.update,
        byteLength: update.byteLength,
        payloadRef: update.payloadRef ?? null,
        payloadDigest: update.payloadDigest ?? null,
        payloadManifest: update.payloadManifest ?? null,
      })),
      hasMore:
        updates.length === limit &&
        updates[updates.length - 1]!.sequence < room.nextSequence - 1,
      uncompactedBytes: room.uncompactedBytes,
      lastSnapshotAt: room.lastSnapshotAt ?? null,
      lastProjectionSequence: room.lastProjectionSequence ?? null,
      liveStateVectorHash: artifact.liveStateVectorHash ?? null,
      // The gateway requests this explicitly only after it has determined
      // that the stored Yjs state is not native. Keeping the bootstrap
      // projection out of the normal state load avoids serializing the full
      // artifact on every native room reload while preserving legacy-room
      // migration.
      initialProjection:
        args.afterSequence === 0 && args.includeInitialProjection === true
          ? {
              title: artifact.title,
              summary: artifact.summary,
              tags: artifact.tags,
              typeKey: artifact.blueprintKey,
              schemaVersion: room.schemaVersion,
              // Keep spectra-sheet-cells-v1 chunks on the Convex wire.
              // Expanding here blows past the 1024-field return cap
              // (Object has too many fields) and leaves Live Reconnecting.
              // Gateway decodeSheetsContentForYjs + client sheetCellEntries
              // expand after the boundary.
              content: artifact.content,
              artifactUpdatedAt: artifact.updatedAt,
            }
          : null,
    };
  },
});

export const recoverNativeSnapshot = internalMutation({
  args: {
    accountId: v.id("accounts"),
    artifactId: v.id("spectraArtifacts"),
    partitionKey: v.string(),
    clientId: v.string(),
    policyVersion: v.number(),
    expectedNextSequence: v.number(),
    expectedStateVectorHash: v.string(),
    observedStateVectorHash: v.string(),
    // Optional when oversized: gateway attests via observedProjectionHash only
    // (must equal artifact.contentHash) so recover never ships 2M+ JSON.
    observedProjectionJson: v.optional(v.string()),
    observedProjectionHash: v.string(),
    observedProjectionPayloadRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [actor, artifact, room] = await Promise.all([
      getActorForAccountId(ctx, args.accountId),
      ctx.db.get(args.artifactId),
      ctx.db
        .query("collaborationRooms")
        .withIndex("by_artifact_partition", (q) =>
          q
            .eq("artifactId", args.artifactId)
            .eq("partitionKey", args.partitionKey),
        )
        .unique(),
    ]);
    if (
      !actor ||
      !artifact ||
      !room ||
      room.status === "closed" ||
      (artifact.status !== "active" && artifact.status !== "draft") ||
      artifact.schoolId !== actor.schoolId ||
      !isArtifactTypeKey(artifact.blueprintKey)
    )
      throw new Error("COLLABORATION_GATEWAY_UNAVAILABLE");
    const resourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const [decision, policy, snapshots, updates] = await Promise.all([
      evaluateAccessForActor(ctx, actor, resourceType, artifact._id),
      ctx.db
        .query("resourcePolicies")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", resourceType).eq("resourceId", artifact._id),
        )
        .unique(),
      ctx.db
        .query("collaborationSnapshots")
        .withIndex("by_room_sequence", (q) => q.eq("roomId", room._id))
        .collect(),
      ctx.db
        .query("collaborationUpdates")
        .withIndex("by_room_sequence", (q) => q.eq("roomId", room._id))
        .collect(),
    ]);
    const currentPolicyVersion = policy?.version ?? 0;
    const canModify =
      artifact.ownerAccountId === actor.accountId ||
      decision.capabilities.includes("modify");
    if (
      !decision.allowed ||
      !canModify ||
      currentPolicyVersion !== args.policyVersion ||
      room.policyVersion !== currentPolicyVersion
    )
      throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
    const clientId = args.clientId.trim().slice(0, 180);
    let projectionMatchesArtifact = false;
    if (args.observedProjectionJson) {
      const observedProjection = parseGatewayProjection(
        args.observedProjectionJson,
        args.observedProjectionHash,
        artifact,
      );
      const observedProjectionDigest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(args.observedProjectionJson),
      );
      const observedProjectionHash = btoa(
        String.fromCharCode(...new Uint8Array(observedProjectionDigest)),
      )
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
      // The gateway derives this projection from the stored Y.Doc. Exact equality
      // with the current artifact proves a reset can be rebuilt without losing
      // semantic edits, even when compaction removed bootstrap idempotency data.
      projectionMatchesArtifact =
        observedProjection !== null &&
        observedProjectionHash === args.observedProjectionHash &&
        observedProjection.title === artifact.title &&
        (observedProjection.summary ?? "") === (artifact.summary ?? "") &&
        observedProjection.schemaVersion === room.schemaVersion &&
        canonicalJson(observedProjection.tags) === canonicalJson(artifact.tags) &&
        canonicalJson(
          encodeArtifactContentForStorage(
            observedProjection.typeKey,
            observedProjection.content,
          ),
        ) === canonicalJson(artifact.content);
    } else {
      // Hash-only / spilled-ref path: do not require inline JSON in the bridge.
      projectionMatchesArtifact =
        typeof artifact.contentHash === "string" &&
        artifact.contentHash.length >= 16 &&
        artifact.contentHash === args.observedProjectionHash;
    }
    if (
      !clientId ||
      !Number.isSafeInteger(args.expectedNextSequence) ||
      args.expectedNextSequence < 2 ||
      args.expectedStateVectorHash.length < 16 ||
      args.observedStateVectorHash.length < 16 ||
      args.observedProjectionHash.length < 16 ||
      !projectionMatchesArtifact ||
      artifact.liveStateVectorHash !== args.expectedStateVectorHash ||
      room.nextSequence !== args.expectedNextSequence
    )
      throw new Error("COLLABORATION_DURABLE_RECOVERY_STALE");
    const headSequence = room.nextSequence - 1;
    // Two gateway instances can race while creating the first native room. If
    // both bootstrap snapshots land, their Yjs client clocks differ even though
    // both represent the unchanged artifact projection. That makes the merged
    // state vector disagree with the last bootstrap hash. These records contain
    // no authored change, so resetting only a contiguous bootstrap-only log is
    // lossless; any human/AI update still requires the stricter snapshot path.
    const orderedUpdates = [...updates].sort(
      (left, right) => left.sequence - right.sequence,
    );
    const bootstrapOnly =
      snapshots.length === 0 &&
      orderedUpdates.length === headSequence &&
      orderedUpdates.every(
        (update, index) =>
          update.sequence === index + 1 &&
          update.idempotencyKey.startsWith("bootstrap:") &&
          update.regionIds.length === 1 &&
          update.regionIds[0] === "artifact:structure",
      );
    if (bootstrapOnly) {
      const now = Date.now();
      await Promise.all(
        orderedUpdates.map((update) => ctx.db.delete(update._id)),
      );
      await Promise.all([
        ctx.db.patch(room._id, {
          status: "active",
          nextSequence: 1,
          snapshotSequence: 0,
          uncompactedBytes: 0,
          lastSnapshotAt: undefined,
          lastProjectionSequence: undefined,
          lastProjectionAt: undefined,
          updatedAt: now,
        }),
        ctx.db.patch(artifact._id, {
          liveStateVectorHash: undefined,
          syncState: "synchronized",
          lastSynchronizedAt: now,
          updatedAt: now,
        }),
      ]);
      return {
        recovered: true,
        previousHeadSequence: headSequence,
        bootstrapReset: true,
      };
    }
    const verifiedSnapshots = snapshots
      .filter((snapshot) => snapshot.status === "verified")
      .sort((left, right) => right.throughSequence - left.throughSequence);
    const headSnapshot = verifiedSnapshots[0];
    if (
      !headSnapshot ||
      headSnapshot.throughSequence !== headSequence ||
      room.snapshotSequence !== headSequence ||
      updates.length !== 0
    )
      throw new Error("COLLABORATION_DURABLE_RECOVERY_UNSAFE");
    const observedDigest = await crypto.subtle.digest(
      "SHA-256",
      headSnapshot.stateVector,
    );
    const observedHash = btoa(
      String.fromCharCode(...new Uint8Array(observedDigest)),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    if (observedHash !== args.observedStateVectorHash)
      throw new Error("COLLABORATION_DURABLE_RECOVERY_STALE");

    const now = Date.now();
    await Promise.all(snapshots.map((snapshot) => ctx.db.delete(snapshot._id)));
    await Promise.all([
      ctx.db.patch(room._id, {
        status: "active",
        nextSequence: 1,
        snapshotSequence: 0,
        uncompactedBytes: 0,
        lastSnapshotAt: undefined,
        lastProjectionSequence: undefined,
        lastProjectionAt: undefined,
        updatedAt: now,
      }),
      ctx.db.patch(artifact._id, {
        liveStateVectorHash: undefined,
        syncState: "synchronized",
        lastSynchronizedAt: now,
        updatedAt: now,
      }),
    ]);
    return { recovered: true, previousHeadSequence: headSequence };
  },
});

export const bootstrapNative = internalMutation({
  args: {
    accountId: v.id("accounts"),
    artifactId: v.id("spectraArtifacts"),
    partitionKey: v.string(),
    clientId: v.string(),
    policyVersion: v.number(),
    artifactUpdatedAt: v.number(),
    expectedNextSequence: v.number(),
    update: v.bytes(),
    stateVectorHash: v.string(),
    // Optional: oversized formal-paper / 200k projections must not ride the
    // signed bridge envelope. Artifact content is already authoritative from
    // import; spill ref or omit keeps Yjs head durable without PAYLOAD_TOO_LARGE.
    projectionJson: v.optional(v.string()),
    projectionHash: v.optional(v.string()),
    payloadRef: v.optional(v.string()),
    payloadDigest: v.optional(v.string()),
    payloadManifest: v.optional(v.any()),
    byteLength: v.optional(v.number()),
    projectionPayloadRef: v.optional(v.string()),
    projectionPayloadDigest: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [actor, artifact, room] = await Promise.all([
      getActorForAccountId(ctx, args.accountId),
      ctx.db.get(args.artifactId),
      ctx.db
        .query("collaborationRooms")
        .withIndex("by_artifact_partition", (q) =>
          q
            .eq("artifactId", args.artifactId)
            .eq("partitionKey", args.partitionKey),
        )
        .unique(),
    ]);
    if (!actor || !artifact || !room || room.status !== "active")
      throw new Error("COLLABORATION_GATEWAY_UNAVAILABLE");
    const resourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const [decision, policy, existingUpdate] = await Promise.all([
      evaluateAccessForActor(ctx, actor, resourceType, artifact._id),
      ctx.db
        .query("resourcePolicies")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", resourceType).eq("resourceId", artifact._id),
        )
        .unique(),
      ctx.db
        .query("collaborationUpdates")
        .withIndex("by_room_sequence", (q) =>
          q.eq("roomId", room._id).eq("sequence", args.expectedNextSequence),
        )
        .unique(),
    ]);
    const currentPolicyVersion = policy?.version ?? 0;
    const canModify =
      artifact.ownerAccountId === actor.accountId ||
      decision.capabilities.includes("modify");
    if (
      !decision.allowed ||
      !canModify ||
      currentPolicyVersion !== args.policyVersion ||
      room.policyVersion !== currentPolicyVersion
    )
      throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
    const spilled = Boolean(args.payloadRef);
    const effectiveByteLength = spilled
      ? (args.byteLength ?? 0)
      : args.update.byteLength;
    if (
      !Number.isSafeInteger(args.expectedNextSequence) ||
      args.expectedNextSequence < 1 ||
      artifact.updatedAt !== args.artifactUpdatedAt ||
      args.stateVectorHash.length < 16
    )
      throw new Error("COLLABORATION_NATIVE_BOOTSTRAP_STALE");
    if (spilled) {
      if (
        !args.payloadDigest ||
        args.update.byteLength !== 0 ||
        !Number.isSafeInteger(effectiveByteLength) ||
        effectiveByteLength <= 0
      )
        throw new Error("COLLABORATION_GATEWAY_UPDATE_INVALID");
    } else if (
      args.update.byteLength <= 0 ||
      args.update.byteLength > MAX_GATEWAY_UPDATE_BYTES
    ) {
      throw new Error("COLLABORATION_NATIVE_BOOTSTRAP_STALE");
    }
    const projection = args.projectionJson
      ? parseGatewayProjection(
          args.projectionJson,
          args.projectionHash,
          artifact,
        )
      : null;
    if (args.projectionJson && !projection)
      throw new Error("COLLABORATION_NATIVE_PROJECTION_INVALID");
    if (
      !projection &&
      !args.projectionPayloadRef &&
      args.projectionJson === undefined
    ) {
      // Omit path: require a projection hash so the gateway attested the head.
      if (!args.projectionHash || args.projectionHash.length < 16)
        throw new Error("COLLABORATION_NATIVE_PROJECTION_INVALID");
    }
    if (existingUpdate) {
      if (existingUpdate.stateVectorHash !== args.stateVectorHash)
        throw new Error("COLLABORATION_NATIVE_BOOTSTRAP_STALE");
      return { sequence: existingUpdate.sequence, duplicate: true };
    }
    if (room.nextSequence !== args.expectedNextSequence)
      throw new Error("COLLABORATION_NATIVE_BOOTSTRAP_STALE");
    const now = Date.now();
    const clientId = args.clientId.trim().slice(0, 180);
    if (!clientId) throw new Error("COLLABORATION_GATEWAY_UPDATE_INVALID");
    await ctx.db.insert("collaborationUpdates", {
      roomId: room._id,
      schoolId: room.schoolId,
      sequence: args.expectedNextSequence,
      update: args.update,
      byteLength: effectiveByteLength,
      stateVectorHash: args.stateVectorHash,
      actorAccountId: actor.accountId,
      clientId,
      idempotencyKey: `bootstrap:${artifact.updatedAt}:${args.stateVectorHash}`,
      regionIds: ["artifact:structure"],
      createdAt: now,
      payloadRef: args.payloadRef,
      payloadDigest: args.payloadDigest,
      payloadManifest: args.payloadManifest,
    });
    let projectionPatch: Record<string, unknown> = projection
      ? artifactProjectionPatch(projection, args.projectionHash!)
      : {};
    if (args.projectionPayloadRef) {
      projectionPatch = {
        ...projectionPatch,
        projectionPayloadRef: args.projectionPayloadRef,
        projectionPayloadDigest: args.projectionPayloadDigest,
      };
      if (!projection && args.projectionHash) {
        projectionPatch.contentHash = args.projectionHash;
      }
    } else if (!projection && args.projectionHash) {
      // Omit: keep import content; only advance sync head + contentHash attest.
      projectionPatch = { contentHash: args.projectionHash };
    }
    await Promise.all([
      ctx.db.patch(room._id, {
        nextSequence: args.expectedNextSequence + 1,
        uncompactedBytes: room.uncompactedBytes + effectiveByteLength,
        lastProjectionSequence: args.expectedNextSequence,
        lastProjectionAt: now,
        updatedAt: now,
      }),
      ctx.db.patch(artifact._id, {
        ...projectionPatch,
        syncState: "synchronized",
        liveStateVectorHash: args.stateVectorHash,
        lastSynchronizedAt: now,
      }),
    ]);
    /* Every commit is activity, whether or not the title moved: the tree caches
       both the name and the moment, so a recency-ordered column can be an
       indexed window instead of a scan (D42, D40). */
    if (projection)
      await syncListingAfterProjection(ctx, artifact, projection.title);
    else await syncSourceNodes(ctx, "work", artifact._id, artifact.title);
    return { sequence: args.expectedNextSequence, duplicate: false };
  },
});

export const append = internalMutation({
  args: {
    accountId: v.id("accounts"),
    actorKind: v.union(v.literal("human"), v.literal("ai")),
    artifactId: v.id("spectraArtifacts"),
    partitionKey: v.string(),
    clientId: v.string(),
    policyVersion: v.number(),
    idempotencyKey: v.string(),
    update: v.bytes(),
    baseStateVectorHash: v.string(),
    stateVectorHash: v.string(),
    regionIds: v.array(v.string()),
    nativeInitialization: v.optional(v.boolean()),
    projectionJson: v.optional(v.string()),
    projectionHash: v.optional(v.string()),
    payloadRef: v.optional(v.string()),
    payloadDigest: v.optional(v.string()),
    payloadManifest: v.optional(v.any()),
    byteLength: v.optional(v.number()),
    projectionPayloadRef: v.optional(v.string()),
    projectionPayloadDigest: v.optional(v.string()),
    projectionHotStub: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const [actor, artifact, room] = await Promise.all([
      getActorForAccountId(ctx, args.accountId),
      ctx.db.get(args.artifactId),
      ctx.db
        .query("collaborationRooms")
        .withIndex("by_artifact_partition", (q) =>
          q
            .eq("artifactId", args.artifactId)
            .eq("partitionKey", args.partitionKey),
        )
        .unique(),
    ]);
    if (
      !actor ||
      !artifact ||
      !room ||
      room.status !== "active" ||
      (artifact.status !== "active" && artifact.status !== "draft") ||
      artifact.schoolId !== actor.schoolId
    )
      throw new Error("COLLABORATION_GATEWAY_UNAVAILABLE");
    const resourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      resourceType,
      artifact._id,
    );
    const policy = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", resourceType).eq("resourceId", artifact._id),
      )
      .unique();
    const currentPolicyVersion = policy?.version ?? 0;
    const canModify =
      artifact.ownerAccountId === actor.accountId ||
      decision.capabilities.includes("modify");
    if (
      !decision.allowed ||
      !canModify ||
      currentPolicyVersion !== args.policyVersion ||
      room.policyVersion !== currentPolicyVersion
    )
      throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
    const spilled = Boolean(args.payloadRef);
    const effectiveByteLength = spilled
      ? (args.byteLength ?? 0)
      : args.update.byteLength;
    if (spilled) {
      if (
        !args.payloadDigest ||
        args.update.byteLength !== 0 ||
        !Number.isSafeInteger(effectiveByteLength) ||
        effectiveByteLength <= 0
      )
        throw new Error("COLLABORATION_GATEWAY_UPDATE_INVALID");
    } else if (
      args.update.byteLength <= 0 ||
      args.update.byteLength > MAX_GATEWAY_UPDATE_BYTES
    ) {
      throw new Error("COLLABORATION_GATEWAY_UPDATE_SIZE");
    }
    const clientId = args.clientId.trim().slice(0, 180);
    const idempotencyKey = args.idempotencyKey.trim().slice(0, 180);
    if (
      !clientId ||
      !idempotencyKey ||
      args.baseStateVectorHash.length < 16 ||
      args.stateVectorHash.length < 16
    )
      throw new Error("COLLABORATION_GATEWAY_UPDATE_INVALID");
    const duplicate = await ctx.db
      .query("collaborationUpdates")
      .withIndex("by_room_idempotency", (q) =>
        q.eq("roomId", room._id).eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (duplicate) {
      if (
        duplicate.actorAccountId !== actor.accountId ||
        duplicate.clientId !== clientId ||
        duplicate.stateVectorHash !== args.stateVectorHash ||
        duplicate.byteLength !== effectiveByteLength
      )
        throw new Error("COLLABORATION_GATEWAY_UPDATE_INVALID");
      return {
        sequence: duplicate.sequence,
        duplicate: true,
        projected: false,
      };
    }
    // Overlapping Yjs writers capture `baseStateVectorHash` at apply time, then
    // Convex appends later. A later CAS-lose is a CRDT rebase, not a dead
    // socket: the update already lives in the gateway document and must join
    // the durable log against the current live head.
    const rebased =
      Boolean(artifact.liveStateVectorHash) &&
      artifact.liveStateVectorHash !== args.baseStateVectorHash;
    const projection = parseGatewayProjection(
      args.projectionJson,
      args.projectionHash,
      artifact,
    );
    const now = Date.now();
    const [activeClaims, releasedClaims] = await Promise.all(
      (["active", "released"] as const).map((status) =>
        ctx.db
          .query("regionClaims")
          .withIndex("by_artifact_status", (q) =>
            q.eq("artifactId", artifact._id).eq("status", status),
          )
          .collect(),
      ),
    );
    const actorClaims = [...activeClaims, ...releasedClaims].filter((claim) =>
      claimAuthorizesGatewayUpdate(claim, {
        actorAccountId: actor.accountId,
        actorKind: args.actorKind,
        clientId,
        baseStateVectorHash: args.baseStateVectorHash,
        now,
      }),
    );
    const declaredRegionIds = [
      ...new Set(
        args.regionIds.map((regionId) => regionId.trim()).filter(Boolean),
      ),
    ];
    const nativeProjection = declaredRegionIds.includes(
      NATIVE_PROJECTION_REGION,
    );
    if (nativeProjection && declaredRegionIds.length !== 1)
      throw new Error("COLLABORATION_NATIVE_PROJECTION_INVALID");
    const nativeTypeKey = isArtifactTypeKey(artifact.blueprintKey)
      ? artifact.blueprintKey
      : null;
    if (nativeProjection && !nativeTypeKey)
      throw new Error("COLLABORATION_NATIVE_PROJECTION_INVALID");
    const regionIds = nativeProjection
      ? projection
        ? [
            ...new Set([
              ...(args.nativeInitialization ? ["artifact:structure"] : []),
              ...changedArtifactRegionIds(
                nativeTypeKey!,
                artifact.content,
                projection.content,
              ),
              ...(artifact.title !== projection.title
                ? ["metadata:title"]
                : []),
              ...((artifact.summary ?? "") !== (projection.summary ?? "")
                ? ["metadata:summary"]
                : []),
              ...(JSON.stringify(artifact.tags) !==
              JSON.stringify(projection.tags)
                ? ["metadata:tags"]
                : []),
            ]),
          ]
        : []
      : declaredRegionIds;
    if (nativeProjection && regionIds.length === 0) {
      // A reconnect can legitimately add Yjs-only convergence metadata while
      // projecting to the exact artifact value already stored in Convex. The
      // state-vector delta still has to be durably appended; rejecting it as a
      // missing semantic claim creates an endless reconnect/synchronizing loop.
      const sequence = room.nextSequence;
      await Promise.all([
        ctx.db.insert("collaborationUpdates", {
          roomId: room._id,
          schoolId: room.schoolId,
          sequence,
          update: args.update,
          byteLength: args.update.byteLength,
          stateVectorHash: args.stateVectorHash,
          actorAccountId: actor.accountId,
          clientId,
          idempotencyKey,
          regionIds: [],
          createdAt: now,
        }),
        ctx.db.patch(room._id, {
          nextSequence: sequence + 1,
          uncompactedBytes: room.uncompactedBytes + args.update.byteLength,
          updatedAt: now,
        }),
        ctx.db.patch(artifact._id, {
          syncState: "synchronized",
          liveStateVectorHash: args.stateVectorHash,
          lastSynchronizedAt: now,
        }),
      ]);
      return { sequence, duplicate: false, rebased, regionIds: [] };
    }
    if (regionIds.length === 0 || regionIds.length > 128)
      throw new Error("COLLABORATION_REGION_CLAIM_REQUIRED");
    const claimCoversRegion = (
      claim: (typeof actorClaims)[number],
      regionId: string,
    ) =>
      // `artifact:structure` is the explicit whole-document lease. Pending AI
      // creates use it to replace the visible placeholder atomically; the
      // native projection then expands that one structural operation into the
      // fine-grained semantic regions it produced. Requiring a second lease
      // for every newly introduced question/card/slide makes an authorized
      // structural replace impossible to persist.
      claim.regionId === "artifact:structure" ||
      claim.overlapDomains.includes("artifact:structure") ||
      claim.regionId === regionId ||
      claim.overlapDomains.includes(regionId);
    const coveringClaims = actorClaims.filter((claim) =>
      regionIds.some((regionId) => claimCoversRegion(claim, regionId)),
    );
    const conflictingClaim = activeClaims.find(
      (claim) =>
        claim.leaseExpiresAt > now &&
        !actorClaims.includes(claim) &&
        regionIds.some((regionId) => claimCoversRegion(claim, regionId)),
    );
    if (conflictingClaim)
      throw new Error(
        `COLLABORATION_REGION_HELD: ${conflictingClaim.regionId}`,
      );
    const uncovered = regionIds.filter(
      (regionId) =>
        !coveringClaims.some((claim) => claimCoversRegion(claim, regionId)),
    );
    // Human changes are authorized and conflict-checked by the gateway, then
    // committed optimistically. Requiring a separate structure lease put a
    // network round trip in front of basic actions like adding a card or slide.
    // AI writes remain lease-bound for attribution and overlap safety.
    const claimsRequired = args.actorKind === "ai";
    if (claimsRequired && uncovered.length > 0)
      throw new Error(`COLLABORATION_REGION_UNCLAIMED: ${uncovered[0]}`);
    const aiClaims = coveringClaims.filter((claim) => claim.actorKind === "ai");
    const changeSource = args.actorKind;
    const aiRunId =
      changeSource === "ai"
        ? aiClaims.find((claim) => claim.runId)?.runId
        : undefined;
    const aiOperationIds =
      changeSource === "ai"
        ? [
            ...new Set(
              aiClaims.flatMap((claim) =>
                claim.operationId ? [claim.operationId] : [],
              ),
            ),
          ]
        : [];
    if (
      changeSource === "ai" &&
      (!aiRunId ||
        aiOperationIds.length === 0 ||
        aiClaims.some((claim) => claim.runId !== aiRunId) ||
        uncovered.length > 0)
    )
      throw new Error("COLLABORATION_AI_ATTRIBUTION_INVALID");
    const beforeSnapshot = {
      title: artifact.title,
      summary: artifact.summary,
      content: artifact.content,
      tags: artifact.tags,
    };
    const finalSnapshot = projection
      ? {
          title: projection.title,
          summary: projection.summary,
          content: encodeArtifactContentForStorage(
            projection.typeKey,
            projection.content,
          ),
          tags: projection.tags,
        }
      : beforeSnapshot;
    const openGroups = await ctx.db
      .query("changeGroups")
      .withIndex("by_artifact_status_activity", (q) =>
        q.eq("artifactId", artifact._id).eq("status", "open"),
      )
      .collect();
    let changeGroup =
      changeSource === "human"
        ? openGroups.find(
            (group) =>
              group.actorAccountId === actor.accountId &&
              group.clientId === clientId &&
              group.source === "human",
          )
        : openGroups.find(
            (group) =>
              group.actorAccountId === actor.accountId &&
              group.clientId === clientId &&
              group.source === "ai" &&
              group.runId === aiRunId,
          );
    if (
      changeGroup &&
      now - changeGroup.lastActivityAt > HUMAN_CHANGE_IDLE_MS
    ) {
      await commitChangeGroup(ctx, changeGroup._id);
      changeGroup = undefined;
    }
    const snapshotIntegrityHash =
      args.projectionHash ?? args.stateVectorHash;
    const fittedSnapshots = fitChangeGroupSnapshots(
      beforeSnapshot,
      finalSnapshot,
      { contentHash: snapshotIntegrityHash },
    );
    if (!changeGroup) {
      const changeGroupId = await ctx.db.insert("changeGroups", {
        artifactId: artifact._id,
        schoolId: artifact.schoolId,
        source: changeSource,
        actorAccountId: actor.accountId,
        clientId,
        runId: aiRunId,
        operationIds: aiOperationIds,
        regionIds,
        baseStateVectorHash:
          artifact.liveStateVectorHash ?? `initial:${artifact._id}`,
        baseVersionId: artifact.currentVersionId,
        baseSnapshot: fittedSnapshots.baseSnapshot,
        finalStateVectorHash: args.stateVectorHash,
        finalSnapshot: fittedSnapshots.finalSnapshot,
        finalIntegrityHash: snapshotIntegrityHash,
        status: "open",
        openedAt: now,
        lastActivityAt: now,
      });
      changeGroup = (await ctx.db.get(changeGroupId)) ?? undefined;
    } else {
      const patchSnapshots = projection
        ? fitChangeGroupSnapshots(
            (changeGroup.baseSnapshot as typeof beforeSnapshot) ??
              beforeSnapshot,
            finalSnapshot,
            { contentHash: snapshotIntegrityHash },
          )
        : null;
      await ctx.db.patch(changeGroup._id, {
        regionIds: [...new Set([...changeGroup.regionIds, ...regionIds])],
        operationIds: [
          ...new Set([...changeGroup.operationIds, ...aiOperationIds]),
        ],
        finalStateVectorHash: args.stateVectorHash,
        ...(patchSnapshots
          ? {
              baseSnapshot: patchSnapshots.baseSnapshot,
              finalSnapshot: patchSnapshots.finalSnapshot,
              finalIntegrityHash: snapshotIntegrityHash,
            }
          : {}),
        lastActivityAt: now,
      });
    }
    const sequence = room.nextSequence;
    await ctx.db.insert("collaborationUpdates", {
      roomId: room._id,
      schoolId: room.schoolId,
      sequence,
      update: args.update,
      byteLength: effectiveByteLength,
      stateVectorHash: args.stateVectorHash,
      actorAccountId: actor.accountId,
      clientId,
      idempotencyKey,
      changeGroupId: changeGroup?._id,
      regionIds,
      createdAt: now,
      payloadRef: args.payloadRef,
      payloadDigest: args.payloadDigest,
      payloadManifest: args.payloadManifest,
    });
    await ctx.db.patch(room._id, {
      nextSequence: sequence + 1,
      uncompactedBytes: room.uncompactedBytes + effectiveByteLength,
      updatedAt: now,
    });
    let projectionPatch: Record<string, unknown> = projection
      ? artifactProjectionPatch(projection, args.projectionHash!)
      : {};
    if (projection && args.projectionPayloadRef) {
      projectionPatch = {
        ...projectionPatch,
        projectionPayloadRef: args.projectionPayloadRef,
        projectionPayloadDigest: args.projectionPayloadDigest,
      };
    } else if (!projection && args.projectionPayloadRef) {
      // Spill refs only — do not write $spectraProjectionPayload stubs into
      // hot artifact.content until a payload reader exists. Leave legacy
      // content untouched; Yjs remains the authority for full state.
      projectionPatch = {
        projectionPayloadRef: args.projectionPayloadRef,
        projectionPayloadDigest: args.projectionPayloadDigest,
      };
    }
    await ctx.db.patch(artifact._id, {
      ...projectionPatch,
      syncState: "synchronized",
      liveStateVectorHash: args.stateVectorHash,
      lastSynchronizedAt: now,
      updatedAt: now,
    });
    /* A title typed in the editor is a rename. The tree caches names so a
       Library row never has to fan out — which means it has to follow here, in
       the same transaction, not on the next full read (D40). The same write
       records that the work was touched, which is what recency-ordered columns
       page against (D42). */
    if (projection)
      await syncListingAfterProjection(ctx, artifact, projection.title);
    if (projection) {
      // Every open human session must point at a renderable global state, even
      // when another collaborator changed a non-overlapping region afterward.
      // Attribution remains scoped by each group's own regionIds; the snapshot
      // itself never regresses the artifact when groups commit in another order.
      await Promise.all(
        openGroups
          .filter(
            (group) =>
              group.source === "human" && group._id !== changeGroup?._id,
          )
          .map((group) => {
            const fitted = fitChangeGroupSnapshots(
              (group.baseSnapshot as typeof beforeSnapshot) ?? beforeSnapshot,
              finalSnapshot,
              {
                contentHash:
                  args.projectionHash ?? args.stateVectorHash,
              },
            );
            return ctx.db.patch(group._id, {
              finalStateVectorHash: args.stateVectorHash,
              baseSnapshot: fitted.baseSnapshot,
              finalSnapshot: fitted.finalSnapshot,
              finalIntegrityHash: args.projectionHash ?? args.stateVectorHash,
            });
          }),
      );
    }
    if (changeGroup) {
      if (changeSource === "ai")
        await commitChangeGroup(ctx, changeGroup._id, {
          source: "ai",
          summary: `Spectra updated ${regionIds.length} ${regionIds.length === 1 ? "region" : "regions"}`,
        });
      else
        await ctx.scheduler.runAfter(
          HUMAN_CHANGE_IDLE_MS,
          internal.changeGroups.commitIdle,
          { groupId: changeGroup._id, expectedLastActivityAt: now },
        );
    }
    return {
      sequence,
      duplicate: false,
      rebased,
      regionIds,
      projected: Boolean(projection),
    };
  },
});

export const checkpoint = internalMutation({
  args: {
    accountId: v.id("accounts"),
    artifactId: v.id("spectraArtifacts"),
    partitionKey: v.string(),
    clientId: v.string(),
    policyVersion: v.number(),
    roomId: v.optional(v.id("collaborationRooms")),
    expectedNextSequence: v.optional(v.number()),
    expectedLastProjectionSequence: v.optional(v.number()),
    stateVectorHash: v.string(),
    projectionJson: v.string(),
    projectionHash: v.string(),
    throughSequence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const [actor, artifact, room] = await Promise.all([
      getActorForAccountId(ctx, args.accountId),
      ctx.db.get(args.artifactId),
      ctx.db
        .query("collaborationRooms")
        .withIndex("by_artifact_partition", (q) =>
          q
            .eq("artifactId", args.artifactId)
            .eq("partitionKey", args.partitionKey),
        )
        .unique(),
    ]);
    if (
      !actor ||
      !artifact ||
      !room ||
      room.status === "closed" ||
      (artifact.status !== "active" && artifact.status !== "draft") ||
      artifact.schoolId !== actor.schoolId
    )
      throw new Error("COLLABORATION_GATEWAY_UNAVAILABLE");
    const resourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      resourceType,
      artifact._id,
    );
    const policy = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", resourceType).eq("resourceId", artifact._id),
      )
      .unique();
    const currentPolicyVersion = policy?.version ?? 0;
    const canModify =
      artifact.ownerAccountId === actor.accountId ||
      decision.capabilities.includes("modify");
    if (
      !decision.allowed ||
      !canModify ||
      currentPolicyVersion !== args.policyVersion ||
      room.policyVersion !== currentPolicyVersion
    )
      throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
    const projection = parseGatewayProjection(
      args.projectionJson,
      args.projectionHash,
      artifact,
    );
    if (!projection) throw new Error("COLLABORATION_PROJECTION_INVALID");
    if (args.roomId !== undefined && room._id !== args.roomId)
      throw new Error("COLLABORATION_DURABLE_RECOVERY_STALE");
    const currentProjectionSequence = room.lastProjectionSequence ?? 0;
    const requestedSequence = Math.max(
      0,
      Math.min(
        args.throughSequence ?? room.nextSequence - 1,
        room.nextSequence - 1,
      ),
    );
    const alreadyApplied =
      artifact.contentHash === args.projectionHash &&
      artifact.liveStateVectorHash === args.stateVectorHash &&
      currentProjectionSequence >= requestedSequence;
    // A retried gateway request may arrive after this room has accepted a
    // newer append. Content hash plus a monotonic projection sequence is the
    // existing idempotency proof; do not require the old head again.
    if (alreadyApplied)
      return {
        sequence: currentProjectionSequence,
        duplicate: true,
      };
    if (
      (args.expectedNextSequence !== undefined &&
        (!Number.isSafeInteger(args.expectedNextSequence) ||
          args.expectedNextSequence < 1 ||
          room.nextSequence !== args.expectedNextSequence)) ||
      (args.expectedLastProjectionSequence !== undefined &&
        (!Number.isSafeInteger(args.expectedLastProjectionSequence) ||
          args.expectedLastProjectionSequence < 0 ||
          currentProjectionSequence !== args.expectedLastProjectionSequence)) ||
      requestedSequence < currentProjectionSequence
    )
      return {
        sequence: currentProjectionSequence,
        stale: true,
      };
    if (
      artifact.liveStateVectorHash &&
      artifact.liveStateVectorHash !== args.stateVectorHash
    )
      return {
        sequence: room.lastProjectionSequence ?? room.nextSequence - 1,
        stale: true,
      };
    const throughSequence = requestedSequence;
    const now = Date.now();
    if (!args.clientId.trim())
      throw new Error("COLLABORATION_GATEWAY_UPDATE_INVALID");
    const listingTitle = await listingNameForNativeWork(
      ctx,
      artifact,
      projection.title,
    );
    const finalSnapshot = {
      title: listingTitle,
      summary: projection.summary,
      content: encodeArtifactContentForStorage(
        projection.typeKey,
        projection.content,
      ),
      tags: projection.tags,
    };
    await ctx.db.patch(artifact._id, {
      ...artifactProjectionPatch(projection, args.projectionHash),
      title: listingTitle,
      syncState: "synchronized",
      liveStateVectorHash: args.stateVectorHash,
      lastSynchronizedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(room._id, {
      lastProjectionSequence: throughSequence,
      lastProjectionAt: now,
      updatedAt: now,
    });
    await syncSourceNodes(ctx, "work", artifact._id, listingTitle);
    const openGroups = await ctx.db
      .query("changeGroups")
      .withIndex("by_artifact_status_activity", (q) =>
        q.eq("artifactId", artifact._id).eq("status", "open"),
      )
      .collect();
    await Promise.all(
      openGroups
        .filter((group) => group.source === "human")
        .map((group) => {
          const fitted = fitChangeGroupSnapshots(
            (group.baseSnapshot as typeof finalSnapshot) ?? finalSnapshot,
            finalSnapshot,
            { contentHash: args.projectionHash },
          );
          return ctx.db.patch(group._id, {
            finalStateVectorHash: args.stateVectorHash,
            baseSnapshot: fitted.baseSnapshot,
            finalSnapshot: fitted.finalSnapshot,
            finalIntegrityHash: args.projectionHash,
          });
        }),
    );
    return { sequence: throughSequence, duplicate: false };
  },
});
