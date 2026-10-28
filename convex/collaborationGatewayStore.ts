import { internalQuery } from "./functions";
import { internalMutation } from "./orgNodeMutation";
import { v, type ObjectType } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  evaluateAccessForActorWithLoadedResource,
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
import { isDurableContentRef } from "../shared/durable-content";
import { assertPlannerSourceEdit } from "../shared/planner-source.mjs";
import { validateDurablePayload } from "./collaborationDurablePayload";
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

/** Provider facts and official deadlines in a planner change only through
 * the trusted provider context; an ordinary editor keeps personal fields. */
function assertEditorSourceBoundary(
  artifact: Doc<"spectraArtifacts">,
  projection: GatewayProjection | null,
  providerAppend = false,
) {
  if (providerAppend || !projection || artifact.blueprintKey !== "planner_task" ||
      isDurableContentRef(artifact.content) || isDurableContentRef(projection.content)) return;
  assertPlannerSourceEdit(artifact.content, projection.content);
}

export async function parseGatewayProjection(
  ctx: MutationCtx,
  projectionJson: string | undefined,
  projectionHash: string | undefined,
  artifact: {
    _id: Id<"spectraArtifacts">;
    blueprintKey: string;
    summary?: string;
  },
  authority?: { accountId: Id<"accounts">; policyVersion: number },
  /** A trusted provider merge supplies its exact summary; never a client. */
  options: { preserveSummary?: boolean } = {},
): Promise<GatewayProjection | null> {
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
  if (isDurableContentRef(value.content)) {
    const ref = value.content.spectraContentRef;
    if (ref.artifactId !== artifact._id) throw new Error("COLLABORATION_DURABLE_PAYLOAD_INVALID");
    const payload = await validateDurablePayload(ctx, {
      artifactId: ref.artifactId as Id<"spectraArtifacts">,
      payloadRef: ref.payloadRef, digest: ref.digest, kind: "projection", byteLength: ref.byteLength,
      ...authority,
    });
    if (JSON.stringify(ref.dependencies) !== JSON.stringify(payload.dependencies)) throw new Error("COLLABORATION_CONTENT_DEPENDENCY_INVALID");
  }
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
  const summary = !options.preserveSummary && isGeneratedArtifactSummary(
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
      roomId: room._id,
      nextSequence: room.nextSequence,
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
      return { allowed: false as const, reason: "access_revoked" as const };
    const decision = await evaluateArtifactAccessForActor(
      ctx,
      actor,
      args.artifactId,
    );
    const loaded = "loaded" in decision ? decision.loaded : null;
    if (
      !loaded ||
      (loaded.lifecycle !== "active" && loaded.lifecycle !== "draft")
    )
      return { allowed: false as const, reason: "access_revoked" as const };
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
    // The central evaluator includes ownership and exact account invitations.
    // A cross-school read grant must not become modify via an owner shortcut.
    const canModify =
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
    const snapshot = args.afterSequence > 0 || args.includeInitialProjection ? null : await ctx.db
      .query("collaborationSnapshots")
      .withIndex("by_room_sequence", (q) => q.eq("roomId", room._id))
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "verified"))
      .first();
    const start = Math.max(args.afterSequence, snapshot?.throughSequence ?? 0);
    const limit = Math.max(1, Math.min(Math.floor(args.limit), 500));
    const updates: Doc<"collaborationUpdates">[] = [];
    let inlineBytes = snapshot ? Math.ceil(snapshot.update.byteLength * 4 / 3) + snapshot.stateVector.byteLength * 2 : 0;
    if (!args.includeInitialProjection) {
      for await (const update of ctx.db.query("collaborationUpdates")
        .withIndex("by_room_sequence", q => q.eq("roomId", room._id).gt("sequence", start)).order("asc")) {
        const bytes = Math.ceil(update.update.byteLength * 4 / 3) + 2048;
        if (inlineBytes + bytes > 1400 * 1024 || updates.length >= limit) break;
        updates.push(update);
        inlineBytes += bytes;
      }
    }
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
        regionIds: update.regionIds,
        nativeReconciliationOperationId: (update as typeof update & { nativeReconciliationOperationId?: string }).nativeReconciliationOperationId ?? null,
        providerSourceOperationId: update.providerSourceOperationId ?? null,
        update: update.update,
        byteLength: update.byteLength,
        payloadRef: update.payloadRef ?? null,
        payloadDigest: update.payloadDigest ?? null,
        payloadManifest: update.payloadManifest ?? null,
      })),
      hasMore:
        !args.includeInitialProjection && (updates.at(-1)?.sequence ?? start) < room.nextSequence - 1,
      afterSequence: updates.at(-1)?.sequence ?? start,
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
      !isArtifactTypeKey(artifact.blueprintKey)
    )
      throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
    const resourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const [decision, policy, snapshots, updates] = await Promise.all([
      evaluateAccessForActorWithLoadedResource(ctx, actor, resourceType, artifact._id, {
        resource: artifact, ownerAccountId: artifact.ownerAccountId,
        schoolId: artifact.schoolId, lifecycle: artifact.status,
      }),
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
      const observedProjection = await parseGatewayProjection(
      ctx,
        args.observedProjectionJson,
        args.observedProjectionHash,
        artifact,
      { accountId: args.accountId, policyVersion: args.policyVersion },
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
      throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
    const resourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const [decision, policy, existingUpdate] = await Promise.all([
      evaluateAccessForActorWithLoadedResource(ctx, actor, resourceType, artifact._id, {
        resource: artifact, ownerAccountId: artifact.ownerAccountId,
        schoolId: artifact.schoolId, lifecycle: artifact.status,
      }),
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
      await validateDurablePayload(ctx, {
        artifactId: args.artifactId, accountId: args.accountId, policyVersion: args.policyVersion,
        payloadRef: args.payloadRef!, digest: args.payloadDigest ?? "", byteLength: effectiveByteLength, kind: "yjs-update",
      });
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
      ? await parseGatewayProjection(
          ctx,
          args.projectionJson,
          args.projectionHash,
          artifact,
      { accountId: args.accountId, policyVersion: args.policyVersion },
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

export const appendRoomUpdateArgs = {
    accountId: v.id("accounts"),
    actorKind: v.union(v.literal("human"), v.literal("ai")),
    artifactId: v.id("spectraArtifacts"),
    partitionKey: v.string(),
    clientId: v.string(),
    policyVersion: v.number(),
    idempotencyKey: v.string(),
    update: v.bytes(),
    baseStateVectorHash: v.string(),
    expectedRoomId: v.id("collaborationRooms"),
    expectedNextSequence: v.number(),
    claimBaseStateVectorHash: v.optional(v.string()),
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
};

/** Function-only capability supplied by the signed ManageBac domain wrapper.
 * Public append arguments cannot select an import actor or bypass personal ACLs. */
export type ProviderAppendContext = {
  source: "import";
  operationId: string;
  authorize: (input: {
    actor: NonNullable<Awaited<ReturnType<typeof getActorForAccountId>>>;
    artifact: Doc<"spectraArtifacts">;
    room: Doc<"collaborationRooms">;
  }) => Promise<void>;
  validateProjection: (projection: GatewayProjection) => Promise<void>;
};
export type AppendRoomUpdateOptions = {
  provider?: ProviderAppendContext;
  /** The atomic AI wrapper commits history after admitting its native intent. */
  deferAiHistory?: boolean;
};

export async function appendRoomUpdate(
  ctx: MutationCtx,
  args: ObjectType<typeof appendRoomUpdateArgs>,
  options: AppendRoomUpdateOptions = {},
) {
    const providerContext = options.provider;
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
      !["active", "compacting"].includes(room.status) ||
      (artifact.status !== "active" && artifact.status !== "draft")
    )
      throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
    if (providerContext) {
      if (artifact.blueprintKey !== "planner_task" || args.partitionKey !== "root" ||
        providerContext.source !== "import" || providerContext.operationId !== args.idempotencyKey ||
        !providerContext.operationId || providerContext.operationId.length > 180)
        throw new Error("COLLABORATION_PROVIDER_CONTEXT_INVALID");
      await providerContext.authorize({ actor, artifact, room });
    }
    const resourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const decision = providerContext ? null : await evaluateAccessForActorWithLoadedResource(
      ctx,
      actor,
      resourceType,
      artifact._id,
      {
        resource: artifact, ownerAccountId: artifact.ownerAccountId,
        schoolId: artifact.schoolId, lifecycle: artifact.status,
      },
    );
    const policy = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", resourceType).eq("resourceId", artifact._id),
      )
      .unique();
    const currentPolicyVersion = policy?.version ?? 0;
    const canModify =
      decision?.capabilities.includes("modify");
    if (
      (!providerContext && (!decision?.allowed || !canModify)) ||
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
    const updateDigest = args.payloadDigest ?? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", args.update)), byte => byte.toString(16).padStart(2, "0")).join("");
    const receipt = await ctx.db.query("collaborationReceipts").withIndex("by_room_idempotency", q => q.eq("roomId", room._id).eq("idempotencyKey", idempotencyKey)).unique();
    const duplicate = receipt ?? await ctx.db
      .query("collaborationUpdates")
      .withIndex("by_room_idempotency", (q) =>
        q.eq("roomId", room._id).eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (duplicate) {
      const duplicateDigest = receipt?.digest ?? ("update" in duplicate
        ? duplicate.payloadDigest ?? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", duplicate.update)), byte => byte.toString(16).padStart(2, "0")).join("")
        : null);
      if (
        room._id !== args.expectedRoomId ||
        duplicate.actorAccountId !== actor.accountId ||
        duplicate.clientId !== clientId ||
        duplicateDigest !== updateDigest ||
        duplicate.byteLength !== effectiveByteLength
      )
        throw new Error("COLLABORATION_GATEWAY_UPDATE_INVALID");
      return {
        sequence: duplicate.sequence,
        duplicate: true,
        projected: false,
        stateVectorHash: duplicate.stateVectorHash,
      };
    }
    // Receipts survive log compaction and body GC; require old bytes only for
    // new appends, after current authority and exact receipt matching above.
    if (spilled) {
      await validateDurablePayload(ctx, {
        artifactId: args.artifactId, accountId: args.accountId, policyVersion: args.policyVersion,
        payloadRef: args.payloadRef!, digest: args.payloadDigest ?? "", byteLength: effectiveByteLength, kind: "yjs-update",
      });
    }
    // Sequence fences deletes as well as inserts; room ID fences a reset.
    // A changed base requires actual replay and projection recomputation.
    if (room._id !== args.expectedRoomId ||
        !Number.isSafeInteger(args.expectedNextSequence) || args.expectedNextSequence < 1 ||
        room.nextSequence !== args.expectedNextSequence ||
        (artifact.liveStateVectorHash && artifact.liveStateVectorHash !== args.baseStateVectorHash))
      throw new Error("COLLABORATION_BASE_STATE_STALE");
    const projection = await parseGatewayProjection(
      ctx,
      args.projectionJson,
      args.projectionHash,
      artifact,
      { accountId: args.accountId, policyVersion: args.policyVersion },
      { preserveSummary: Boolean(providerContext) },
    );
    assertEditorSourceBoundary(artifact, projection, Boolean(providerContext));
    if (providerContext) {
      if (!projection) throw new Error("COLLABORATION_PROVIDER_PROJECTION_REQUIRED");
      await providerContext.validateProjection(projection);
    }
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
        baseStateVectorHash: args.claimBaseStateVectorHash ?? args.baseStateVectorHash,
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
          byteLength: effectiveByteLength,
          payloadRef: args.payloadRef,
          payloadDigest: args.payloadDigest,
          payloadManifest: args.payloadManifest,
          stateVectorHash: args.stateVectorHash,
          actorAccountId: actor.accountId,
          clientId,
          idempotencyKey,
          regionIds: [],
          createdAt: now,
        }),
        ctx.db.patch(room._id, {
          nextSequence: sequence + 1,
          uncompactedBytes: room.uncompactedBytes + effectiveByteLength,
          updatedAt: now,
        }),
        ctx.db.patch(artifact._id, {
          syncState: "synchronized",
          liveStateVectorHash: args.stateVectorHash,
          lastSynchronizedAt: now,
        }),
      ]);
      await ctx.db.insert("collaborationReceipts", { roomId: room._id, idempotencyKey, clientId, actorAccountId: actor.accountId,
        sequence, stateVectorHash: args.stateVectorHash, digest: updateDigest, byteLength: effectiveByteLength, createdAt: now });
      return { sequence, duplicate: false, stateVectorHash: args.stateVectorHash, regionIds: [] };
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
    const claimsRequired = !providerContext && args.actorKind === "ai";
    if (claimsRequired && uncovered.length > 0)
      throw new Error(`COLLABORATION_REGION_UNCLAIMED: ${uncovered[0]}`);
    const aiClaims = coveringClaims.filter((claim) => claim.actorKind === "ai");
    const changeSource = providerContext?.source ?? args.actorKind;
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
        : changeSource === "ai" ? openGroups.find(
            (group) =>
              group.actorAccountId === actor.accountId &&
              group.clientId === clientId &&
              group.source === "ai" &&
              group.runId === aiRunId,
          ) : undefined;
    if (
      changeGroup &&
      now - changeGroup.lastActivityAt > HUMAN_CHANGE_IDLE_MS
    ) {
      const committed = await commitChangeGroup(ctx, changeGroup._id);
      if (committed.status !== "pending_projection") changeGroup = undefined;
    }
    const snapshotIntegrityHash =
      args.projectionHash ?? args.stateVectorHash;
    const fittedSnapshots = fitChangeGroupSnapshots(
      beforeSnapshot,
      finalSnapshot,
      { contentHash: snapshotIntegrityHash },
    );
    const openedChangeGroup = !changeGroup;
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
    await ctx.db.insert("collaborationReceipts", {
      roomId: room._id, idempotencyKey, sequence, actorAccountId: actor.accountId,
      clientId, stateVectorHash: args.stateVectorHash, digest: updateDigest,
      byteLength: effectiveByteLength, createdAt: now,
    });
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
      providerSourceOperationId: providerContext?.operationId,
      regionIds,
      createdAt: now,
      payloadRef: args.payloadRef,
      payloadDigest: args.payloadDigest,
      payloadManifest: args.payloadManifest,
    });
    await ctx.db.patch(room._id, {
      nextSequence: sequence + 1,
      ...(projection ? {lastProjectionSequence:sequence,lastProjectionAt:now} : {}),
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
      if (changeSource === "ai" && !options.deferAiHistory)
        await commitChangeGroup(ctx, changeGroup._id, {
          source: "ai",
          summary: `Spectra updated ${regionIds.length} ${regionIds.length === 1 ? "region" : "regions"}`,
        });
      // One check follows this editing session until it becomes idle. Queuing
      // a new job per append reread the same snapshots for obsolete checks.
      else if (changeSource === "human" && openedChangeGroup)
        await ctx.scheduler.runAfter(
          HUMAN_CHANGE_IDLE_MS,
          internal.changeGroups.commitIdle,
          { groupId: changeGroup._id, expectedLastActivityAt: now },
        );
    }
    return {
      sequence,
      duplicate: false,
      stateVectorHash: args.stateVectorHash,
      changeGroupId: changeGroup?._id,
      regionIds,
      projected: Boolean(projection),
    };
}

export const append = internalMutation({ args: appendRoomUpdateArgs, handler: appendRoomUpdate });

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
      (artifact.status !== "active" && artifact.status !== "draft")
    )
      throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
    const resourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const decision = await evaluateAccessForActorWithLoadedResource(
      ctx,
      actor,
      resourceType,
      artifact._id,
      {
        resource: artifact, ownerAccountId: artifact.ownerAccountId,
        schoolId: artifact.schoolId, lifecycle: artifact.status,
      },
    );
    const policy = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", resourceType).eq("resourceId", artifact._id),
      )
      .unique();
    const currentPolicyVersion = policy?.version ?? 0;
    const canModify =
      decision.capabilities.includes("modify");
    if (
      !decision.allowed ||
      !canModify ||
      currentPolicyVersion !== args.policyVersion ||
      room.policyVersion !== currentPolicyVersion
    )
      throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
    const projection = await parseGatewayProjection(
      ctx,
      args.projectionJson,
      args.projectionHash,
      artifact,
      { accountId: args.accountId, policyVersion: args.policyVersion },
    );
    if (!projection) throw new Error("COLLABORATION_PROJECTION_INVALID");
    assertEditorSourceBoundary(artifact, projection);
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
      || requestedSequence !== room.nextSequence - 1
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
    // Completing a delayed projection wakes its idle history now, without
    // waiting for the recovery check's backoff or delaying the saved version.
    for (const group of openGroups) {
      if (group.source === "human" && now - group.lastActivityAt >= HUMAN_CHANGE_IDLE_MS)
        await commitChangeGroup(ctx, group._id);
    }
    return { sequence: throughSequence, duplicate: false };
  },
});
