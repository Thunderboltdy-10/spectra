import { internalMutation, mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { validateContentAdoption } from "./collaborationDurablePayload";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  buildArtifactTextIndex,
  isHollowDefaultContent,
  requireArtifactCapability,
} from "./spectraShared";
import { getAuthenticatedActor } from "./identityShared";
import {
  canonicalSnapshotJson,
  loadVersionAfter,
  retainSnapshotObject,
  type SnapshotStrategy,
} from "./artifactSnapshots";
import {
  isOmittedChangeGroupSnapshot,
  resolveCommitSnapshotStrategy,
} from "../shared/collaboration-change-group-capacity";
import { confirmCanonicalPlacements } from "./artifactEmbeds";
import { fitsConvexNesting } from "../shared/convex-nesting.mjs";

export const HUMAN_CHANGE_IDLE_MS = 45_000;

async function hasPendingProjection(ctx: MutationCtx, artifactId: Id<"spectraArtifacts">) {
  const room = await ctx.db.query("collaborationRooms").withIndex("by_artifact_partition", q => q.eq("artifactId", artifactId).eq("partitionKey", "root")).unique();
  return Boolean(room && room.status !== "closed" && (room.lastProjectionSequence ?? 0) < room.nextSequence - 1);
}

async function requireCurrentProjection(ctx: MutationCtx, artifactId: Id<"spectraArtifacts">) {
  if (await hasPendingProjection(ctx, artifactId)) throw new Error("COLLABORATION_CHECKPOINT_REQUIRED");
}

function preferImportContent(
  blueprintKey: string,
  imported: unknown,
  live: unknown,
) {
  if (imported === undefined) return live;
  if (!isHollowDefaultContent(blueprintKey, imported)) return imported;
  if (!isHollowDefaultContent(blueprintKey, live)) return live;
  return imported;
}


async function retainLiveStateAfterRecoveredImport(
  ctx: MutationCtx,
  artifactId: Id<"spectraArtifacts">,
  actorAccountId: Id<"accounts">,
) {
  const artifact = await ctx.db.get(artifactId);
  if (!artifact || !artifact.currentVersionId) return null;
  const parent = await ctx.db.get(artifact.currentVersionId);
  if (!parent) return null;
  const before = await loadVersionAfter(ctx, parent);
  const after = {
    title: artifact.title,
    summary: artifact.summary,
    content: artifact.content,
    tags: artifact.tags,
  };
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  const { strategy, inline } = commitSnapshotPlan(
    artifact.blueprintKey,
    before,
    after,
  );
  const [beforeObject, afterObject] = await Promise.all([
    retainSnapshotObject(ctx, artifact.schoolId, before, strategy),
    retainSnapshotObject(ctx, artifact.schoolId, after, strategy),
  ]);
  const now = Date.now();
  const versionId = await ctx.db.insert("spectraArtifactVersions", {
    artifactId: artifact._id,
    ownerAccountId: artifact.ownerAccountId,
    schoolId: artifact.schoolId,
    parentVersionId: artifact.currentVersionId,
    source: "checkpoint",
    creatorAccountIds: [actorAccountId],
    schemaVersion: artifact.schemaVersion ?? 1,
    snapshotStrategy: strategy,
    snapshotRef: afterObject.snapshotRef,
    beforeSnapshotRef: beforeObject.snapshotRef,
    integrityHash: afterObject.integrityHash,
    before: inline ? before : undefined,
    after: inline ? after : undefined,
    summary: "Continued work after recovered import history",
    provenance: {
      source: "human",
      kind: "import_history_recovery",
    },
    createdAt: now,
  });
  await ctx.db.patch(artifact._id, { currentVersionId: versionId });
  return versionId;
}

async function importedContentHash(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function commitImportJob(
  ctx: MutationCtx,
  artifact: Doc<"spectraArtifacts">,
  job: Doc<"artifactImportJobs">,
  actorAccountId: Id<"accounts">,
  options: { preserveLiveCurrent?: boolean } = {},
) {
  if (
    job.artifactId !== artifact._id ||
    job.ownerAccountId !== actorAccountId ||
    !["imported", "awaiting_commit"].includes(job.status)
  )
    throw new Error("ARTIFACT_IMPORT_VERSION_INVALID");
  if (job.artifactVersionId) {
    if (
      job.importedContent !== undefined ||
      job.status !== "imported" ||
      job.completedAt === undefined
    )
      await ctx.db.patch(job._id, {
        importedContent: undefined,
        status: "imported",
        completedAt: job.completedAt ?? Date.now(),
        updatedAt: Date.now(),
      });
    return { versionId: job.artifactVersionId, reused: true as const };
  }
  if (job.importedContent === undefined)
    throw new Error("ARTIFACT_IMPORT_CONTENT_MISSING");
  await validateContentAdoption(ctx, artifact._id, actorAccountId, job.importedContent);
  const computedImportHash = await importedContentHash(job.importedContent);
  if (job.importedContentHash && computedImportHash !== job.importedContentHash)
    throw new Error("ARTIFACT_IMPORT_CONTENT_CHANGED");
  if (artifact.status !== "active") throw new Error("ARTIFACT_IMPORT_REVISION_STALE");
  if (job.baseRevisionCaptured) {
    if ((artifact.currentVersionId ?? null) !== (job.targetVersionId ?? null) ||
        (artifact.liveStateVectorHash ?? null) !== (job.targetStateVectorHash ?? null))
      throw new Error("ARTIFACT_IMPORT_REVISION_STALE");
  } else if (job.targetVersionId && artifact.currentVersionId !== job.targetVersionId) {
    throw new Error("ARTIFACT_IMPORT_REVISION_STALE");
  }
  if (job.targetRoomId || job.targetAppendHead !== undefined || job.targetProjectionHead !== undefined) {
    const room = await ctx.db
      .query("collaborationRooms")
      .withIndex("by_artifact_partition", (q) =>
        q.eq("artifactId", artifact._id).eq("partitionKey", "root"),
      )
      .unique();
    if (
      (room?._id ?? null) !== (job.targetRoomId ?? null) ||
      (room ? room.nextSequence - 1 : 0) !== (job.targetAppendHead ?? 0) ||
      (room?.lastProjectionSequence ?? 0) !== (job.targetProjectionHead ?? 0)
    ) throw new Error("ARTIFACT_IMPORT_CAUSAL_BASE_STALE");
  }
  const summary = `Imported ${job.originalName || job.format}`.slice(0, 500);
  const groups = await ctx.db
    .query("changeGroups")
    .withIndex("by_artifact_status_activity", (q) =>
      q.eq("artifactId", artifact._id).eq("status", "open"),
    )
    .collect();
  const mine = groups.filter(
    (group) =>
      group.actorAccountId === actorAccountId && group.source === "human",
  );
  for (const group of mine) {
    // TipTap/Yjs hydrate can open a human change group on a hollow shell while
    // Library import already projected real content onto the job. Committing
    // that shell as the import version discards the projection and the studio
    // then reloads empty — the "text appeared, then vanished" failure.
    if (job.importedContent !== undefined) {
      const finalSnapshot =
        group.finalSnapshot &&
        typeof group.finalSnapshot === "object" &&
        !Array.isArray(group.finalSnapshot)
          ? (group.finalSnapshot as { content?: unknown })
          : null;
      if (
        !isHollowDefaultContent(artifact.blueprintKey, job.importedContent) &&
        (finalSnapshot?.content === undefined ||
          isHollowDefaultContent(
            artifact.blueprintKey,
            finalSnapshot.content,
          ))
      ) {
        continue;
      }
    }
    const committed = await commitChangeGroup(ctx, group._id, {
      source: "import",
      summary,
      name: job.originalName,
    });
    if (committed?.status === "committed") {
      await ctx.db.patch(job._id, {
        artifactVersionId: committed.versionId,
        importedContent: undefined,
        status: "imported",
        completedAt: Date.now(),
        updatedAt: Date.now(),
        commitReceipt: job.commitReceipt ?? crypto.randomUUID(),
      });
      if (options.preserveLiveCurrent !== false)
        await retainLiveStateAfterRecoveredImport(
          ctx,
          artifact._id,
          actorAccountId,
        );
      return { versionId: committed.versionId, reused: false as const };
    }
  }
  const refreshed = await ctx.db.get(artifact._id);
  if (!refreshed) throw new Error("ARTIFACT_NOT_FOUND");
  const importContent = preferImportContent(
    refreshed.blueprintKey,
    job.importedContent,
    refreshed.content,
  );
  const after = {
    title: refreshed.title,
    summary: refreshed.summary,
    content: importContent,
    tags: refreshed.tags,
  };
  const parent = refreshed.currentVersionId
    ? await ctx.db.get(refreshed.currentVersionId)
    : null;
  const before = parent ? await loadVersionAfter(ctx, parent) : after;
  const { strategy, inline } = commitSnapshotPlan(
    refreshed.blueprintKey,
    before,
    after,
  );
  const [beforeObject, afterObject] = await Promise.all([
    retainSnapshotObject(ctx, refreshed.schoolId, before, strategy),
    retainSnapshotObject(ctx, refreshed.schoolId, after, strategy),
  ]);
  const now = Date.now();
  const versionId = await ctx.db.insert("spectraArtifactVersions", {
    artifactId: refreshed._id,
    ownerAccountId: refreshed.ownerAccountId,
    schoolId: refreshed.schoolId,
    parentVersionId: refreshed.currentVersionId,
    source: "import",
    creatorAccountIds: [actorAccountId],
    schemaVersion: refreshed.schemaVersion ?? 1,
    snapshotStrategy: strategy,
    snapshotRef: afterObject.snapshotRef,
    beforeSnapshotRef: beforeObject.snapshotRef,
    integrityHash: afterObject.integrityHash,
    before: inline ? before : undefined,
    after: inline ? after : undefined,
    summary,
    name: job.originalName?.slice(0, 180),
    provenance: {
      source: "human",
      kind: "artifact_import",
      importJobId: String(job._id),
    },
    createdAt: now,
  });
  const importNativeFormat = String(job.format ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 32);
  await ctx.db.patch(refreshed._id, {
    currentVersionId: versionId,
    ...(importNativeFormat && !refreshed.nativeFormat
      ? { nativeFormat: importNativeFormat }
      : {}),
    ...(job.importedContent !== undefined &&
    !isHollowDefaultContent(refreshed.blueprintKey, importContent)
      ? {
          content: importContent,
          textIndex: buildArtifactTextIndex({
            title: refreshed.title,
            summary: refreshed.summary,
            content: importContent,
            tags: refreshed.tags,
          }),
          updatedAt: now,
        }
      : {}),
  });
  await ctx.db.patch(job._id, {
    artifactVersionId: versionId,
    importedContent: undefined,
    status: "imported",
    completedAt: now,
    updatedAt: now,
    commitReceipt: job.commitReceipt ?? crypto.randomUUID(),
  });
  await confirmCanonicalPlacements(ctx, versionId);
  if (options.preserveLiveCurrent !== false)
    await retainLiveStateAfterRecoveredImport(
      ctx,
      artifact._id,
      actorAccountId,
    );
  return { versionId, reused: false as const };
}

type VersionSource =
  "manual" | "ai" | "import" | "restore" | "migration" | "checkpoint";

/** Prefer off-row refs when dual-inline before+after would exceed 1 MiB. */
function commitSnapshotPlan(typeKey: string, before: unknown, after: unknown) {
  const plan = resolveCommitSnapshotStrategy(typeKey, before, after);
  return {
    strategy: plan.strategy satisfies SnapshotStrategy,
    inline: plan.inline,
  };
}

export async function commitChangeGroup(
  ctx: MutationCtx,
  groupId: Id<"changeGroups">,
  options: { source?: VersionSource; summary?: string; name?: string; provenance?: Record<string, unknown> } = {},
) {
  const group = await ctx.db.get(groupId);
  if (!group || group.status !== "open")
    return group?.versionId
      ? { status: "committed" as const, versionId: group.versionId }
      : { status: "unavailable" as const };
  const artifact = await ctx.db.get(group.artifactId);
  if (!artifact) {
    await ctx.db.patch(group._id, {
      status: "abandoned",
      committedAt: Date.now(),
    });
    return { status: "abandoned" as const };
  }
  if (group.source === "human" && await hasPendingProjection(ctx, group.artifactId))
    return { status: "pending_projection" as const };
  let before = group.baseSnapshot;
  let after = group.finalSnapshot;
  const now = Date.now();
  // Open groups for oversized formal-paper / sheets omit inline content so the
  // changeGroups row stays under Convex's 1 MiB ceiling. Rebuild from the live
  // artifact (+ parent version) at commit time; commitSnapshotPlan then keeps
  // oversized before+after off-row (content_addressed) on spectraArtifactVersions.
  if (
    isOmittedChangeGroupSnapshot(before) ||
    isOmittedChangeGroupSnapshot(after)
  ) {
    const liveAfter = {
      title: artifact.title,
      summary: artifact.summary,
      content: artifact.content,
      tags: artifact.tags,
    };
    const parent = artifact.currentVersionId
      ? await ctx.db.get(artifact.currentVersionId)
      : null;
    before = parent ? await loadVersionAfter(ctx, parent) : liveAfter;
    after = liveAfter;
  }
  if (
    before === undefined ||
    after === undefined ||
    JSON.stringify(before) === JSON.stringify(after)
  ) {
    await ctx.db.patch(group._id, { status: "abandoned", committedAt: now });
    return { status: "abandoned" as const };
  }
  const source =
    options.source ??
    (group.source === "ai"
      ? "ai"
      : group.source === "human"
        ? "manual"
        : group.source);
  const summary =
    options.summary?.trim().slice(0, 500) ||
    group.summary?.trim().slice(0, 500) ||
    (source === "ai"
      ? "Spectra edited this artifact"
      : `Edited ${group.regionIds.length} ${group.regionIds.length === 1 ? "region" : "regions"}`);
  const { strategy, inline } = commitSnapshotPlan(
    artifact.blueprintKey,
    before,
    after,
  );
  const [beforeObject, afterObject] = await Promise.all([
    retainSnapshotObject(ctx, artifact.schoolId, before, strategy),
    retainSnapshotObject(ctx, artifact.schoolId, after, strategy),
  ]);
  const versionId = await ctx.db.insert("spectraArtifactVersions", {
    artifactId: artifact._id,
    ownerAccountId: artifact.ownerAccountId,
    schoolId: artifact.schoolId,
    parentVersionId: artifact.currentVersionId,
    source,
    runId: group.runId,
    operationIds: group.operationIds,
    changeGroupIds: [group._id],
    creatorAccountIds: [group.actorAccountId],
    schemaVersion: artifact.schemaVersion ?? 1,
    snapshotStrategy: strategy,
    snapshotRef: afterObject.snapshotRef,
    beforeSnapshotRef: beforeObject.snapshotRef,
    stateVectorHash: group.finalStateVectorHash,
    integrityHash: afterObject.integrityHash,
    before: inline ? before : undefined,
    after: inline ? after : undefined,
    summary,
    name: options.name?.trim().slice(0, 180),
    provenance: {
      ...options.provenance,
      regionIds: group.regionIds,
      clientId: group.clientId,
      source: group.source,
    },
    createdAt: now,
  });
  await ctx.db.patch(group._id, {
    status: "committed",
    summary,
    committedAt: now,
    versionId,
  });
  await ctx.db.patch(artifact._id, { currentVersionId: versionId });
  await confirmCanonicalPlacements(ctx, versionId);
  return { status: "committed" as const, versionId };
}

export async function commitHumanCheckpoint(
  ctx: MutationCtx,
  artifactId: Id<"spectraArtifacts">,
  summary: string,
  options: { kind?: "pre_ai_checkpoint" | "pre_native_checkpoint" | "pre_restore_checkpoint" } = {},
) {
  const groups = await ctx.db
    .query("changeGroups")
    .withIndex("by_artifact_status_activity", (q) =>
      q.eq("artifactId", artifactId).eq("status", "open"),
    )
    .collect();
  await requireCurrentProjection(ctx, artifactId);
  const humanGroups = groups.filter((group) => group.source === "human");
  if (humanGroups.length === 0) return [];
  const artifact = await ctx.db.get(artifactId);
  if (!artifact) return [];
  const after = {
    title: artifact.title,
    summary: artifact.summary,
    content: artifact.content,
    tags: artifact.tags,
  };
  const parent = artifact.currentVersionId
    ? await ctx.db.get(artifact.currentVersionId)
    : null;
  const before = parent
    ? await loadVersionAfter(ctx, parent)
    : (humanGroups.sort((left, right) => left.openedAt - right.openedAt)[0]
        ?.baseSnapshot ?? after);
  const now = Date.now();
  const comparableBefore = before && typeof before === "object"
    ? Object.fromEntries(Object.entries(before).filter(([key]) => key !== "nativeSources")) : before;
  if (JSON.stringify(comparableBefore) === JSON.stringify(after)) {
    await Promise.all(
      humanGroups.map((group) =>
        ctx.db.patch(group._id, { status: "abandoned", committedAt: now }),
      ),
    );
    return [];
  }
  const { strategy, inline } = commitSnapshotPlan(
    artifact.blueprintKey,
    before,
    after,
  );
  const [beforeObject, afterObject] = await Promise.all([
    retainSnapshotObject(ctx, artifact.schoolId, before, strategy),
    retainSnapshotObject(ctx, artifact.schoolId, after, strategy),
  ]);
  const regionIds = [
    ...new Set(humanGroups.flatMap((group) => group.regionIds)),
  ];
  const creatorAccountIds = [
    ...new Set(humanGroups.map((group) => group.actorAccountId)),
  ];
  const versionId = await ctx.db.insert("spectraArtifactVersions", {
    artifactId: artifact._id,
    ownerAccountId: artifact.ownerAccountId,
    schoolId: artifact.schoolId,
    parentVersionId: artifact.currentVersionId,
    source: "checkpoint",
    changeGroupIds: humanGroups.map((group) => group._id),
    creatorAccountIds,
    schemaVersion: artifact.schemaVersion ?? 1,
    snapshotStrategy: strategy,
    snapshotRef: afterObject.snapshotRef,
    beforeSnapshotRef: beforeObject.snapshotRef,
    stateVectorHash: artifact.liveStateVectorHash,
    integrityHash: afterObject.integrityHash,
    before: inline ? before : undefined,
    after: inline ? after : undefined,
    summary,
    provenance: { regionIds, source: "human", kind: options.kind ?? "pre_ai_checkpoint" },
    createdAt: now,
  });
  await Promise.all(
    humanGroups.map((group) =>
      ctx.db.patch(group._id, {
        status: "committed",
        summary,
        committedAt: now,
        versionId,
      }),
    ),
  );
  await ctx.db.patch(artifact._id, { currentVersionId: versionId });
  return [{ status: "committed" as const, versionId }];
}

/** A native package revision is a history boundary even when its visible
 * projection is unchanged. Native source hashes are part of the retained
 * snapshots, resolved through the still-current replica bindings by the
 * existing version ownership trigger before those replicas advance. */
export async function commitNativeReconciliationVersion(
  ctx: MutationCtx,
  input: {
    artifactId: Id<"spectraArtifacts">;
    actorAccountId: Id<"accounts">;
    syncOperationId: Id<"syncOperations">;
    changeGroupId?: Id<"changeGroups">;
    before: { title: string; summary?: string; content: unknown; tags: string[] };
    beforeNativeHashes: string[];
    afterNativeHash: string;
    regionIds: string[];
    nativeFormat: string;
  },
) {
  const artifact = await ctx.db.get(input.artifactId);
  if (!artifact) throw new Error("ARTIFACT_NOT_FOUND");
  const before = {
    ...input.before,
    nativeSources: [...new Set(input.beforeNativeHashes)].map(sourcePayloadHash => ({ sourcePayloadHash })),
  };
  const after = {
    title: artifact.title, summary: artifact.summary, content: artifact.content, tags: artifact.tags,
    nativeSources: [{ sourcePayloadHash: input.afterNativeHash }],
  };
  // The server action must spill each large body through immutable content
  // storage. Never replace this precise native boundary with a later head.
  if (isOmittedChangeGroupSnapshot(before) || isOmittedChangeGroupSnapshot(after) ||
      new TextEncoder().encode(JSON.stringify({ before, after })).byteLength > 850_000 ||
      !fitsConvexNesting({ baseSnapshot: before, finalSnapshot: after }))
    throw new Error("NATIVE_RECONCILIATION_SNAPSHOT_REQUIRED");
  const now = Date.now();
  const summary = `Imported changes from ${input.nativeFormat.toUpperCase()}`;
  let groupId = input.changeGroupId;
  if (groupId) {
    const group = await ctx.db.get(groupId);
    if (!group || group.artifactId !== artifact._id || group.actorAccountId !== input.actorAccountId || group.status !== "open")
      throw new Error("NATIVE_RECONCILIATION_GROUP_INVALID");
    await ctx.db.patch(groupId, { source: "import", baseSnapshot: before, finalSnapshot: after, summary });
  } else {
    groupId = await ctx.db.insert("changeGroups", {
      artifactId: artifact._id, schoolId: artifact.schoolId, source: "import",
      actorAccountId: input.actorAccountId, operationIds: [], regionIds: input.regionIds,
      baseStateVectorHash: `native:${input.syncOperationId}`, baseVersionId: artifact.currentVersionId,
      baseSnapshot: before, finalSnapshot: after, finalStateVectorHash: artifact.liveStateVectorHash,
      finalIntegrityHash: artifact.contentHash, summary, status: "open", openedAt: now, lastActivityAt: now,
    });
  }
  const committed = await commitChangeGroup(ctx, groupId, {
    source: "import", summary,
    provenance: { kind: "native_reconciliation", syncOperationId: input.syncOperationId,
      nativeFormat: input.nativeFormat, nativeBefore: input.beforeNativeHashes, nativeAfter: input.afterNativeHash },
  });
  if (committed.status !== "committed" || !committed.versionId)
    throw new Error("NATIVE_RECONCILIATION_VERSION_REQUIRED");
  return committed.versionId;
}

export async function commitDirectHumanChange(
  ctx: MutationCtx,
  input: {
    artifactId: Id<"spectraArtifacts">;
    actorAccountId: Id<"accounts">;
    before: {
      title: string;
      summary?: string;
      content: unknown;
      tags: string[];
    };
    regionIds: string[];
    summary: string;
    /** A trusted provider effect records import history in the same
     * transaction; it is never selectable by a public caller. */
    origin?: { source: "import"; provenance: Record<string, unknown> };
  },
) {
  const artifact = await ctx.db.get(input.artifactId);
  if (!artifact) throw new Error("ARTIFACT_NOT_FOUND");
  const after = {
    title: artifact.title,
    summary: artifact.summary,
    content: artifact.content,
    tags: artifact.tags,
  };
  if (JSON.stringify(input.before) === JSON.stringify(after))
    return { status: "unchanged" as const };
  const now = Date.now();
  const stateHash =
    artifact.contentHash ??
    artifact.liveStateVectorHash ??
    `direct:${artifact._id}:${now}`;
  const changeGroupId = await ctx.db.insert("changeGroups", {
    artifactId: artifact._id,
    schoolId: artifact.schoolId,
    source: input.origin?.source ?? "human",
    actorAccountId: input.actorAccountId,
    operationIds: [],
    regionIds: [...new Set(input.regionIds)].slice(0, 200),
    baseStateVectorHash:
      artifact.liveStateVectorHash ??
      (artifact.currentVersionId
        ? `version:${artifact.currentVersionId}`
        : `initial:${artifact._id}`),
    baseVersionId: artifact.currentVersionId,
    baseSnapshot: input.before,
    finalStateVectorHash: stateHash,
    finalSnapshot: after,
    finalIntegrityHash: artifact.contentHash,
    summary: input.summary.trim().slice(0, 500),
    status: "open",
    openedAt: now,
    lastActivityAt: now,
  });
  return commitChangeGroup(ctx, changeGroupId, {
    source: input.origin?.source ?? "manual",
    summary: input.summary,
    ...(input.origin ? { provenance: input.origin.provenance } : {}),
  });
}

export const commitIdle = internalMutation({
  args: { groupId: v.id("changeGroups"), expectedLastActivityAt: v.number() },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (
      !group ||
      group.status !== "open" ||
      group.lastActivityAt !== args.expectedLastActivityAt
    )
      return { status: "superseded" as const };
    if (Date.now() - group.lastActivityAt < HUMAN_CHANGE_IDLE_MS - 500)
      return { status: "not_idle" as const };
    const result = await commitChangeGroup(ctx, group._id);
    if (result.status === "pending_projection") await ctx.scheduler.runAfter(5_000, internal.changeGroups.commitIdle, args);
    return result;
  },
});

export const commitCurrent = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    summary: v.optional(v.string()),
    name: v.optional(v.string()),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    await requireCurrentProjection(ctx, args.artifactId);
    const groups = await ctx.db
      .query("changeGroups")
      .withIndex("by_artifact_status_activity", (q) =>
        q.eq("artifactId", args.artifactId).eq("status", "open"),
      )
      .collect();
    const clientId = args.clientId?.trim().slice(0, 180);
    const mine = groups.filter(
      (group) =>
        group.actorAccountId === actor.accountId &&
        group.source === "human" &&
        (!clientId || group.clientId === clientId),
    );
    const committed = [];
    for (const group of mine)
      committed.push(
        await commitChangeGroup(ctx, group._id, {
          summary: args.summary,
          name: args.name,
        }),
      );
    return committed;
  },
});

export const createNamedCheckpoint = mutation({
  args: { artifactId: v.id("spectraArtifacts"), name: v.string() },
  handler: async (ctx, args) => {
    const { actor, artifact: _artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    await requireCurrentProjection(ctx, args.artifactId);
    const name = args.name.trim().slice(0, 180);
    if (!name) throw new Error("ARTIFACT_CHECKPOINT_NAME_REQUIRED");
    const openGroups = await ctx.db
      .query("changeGroups")
      .withIndex("by_artifact_status_activity", (q) =>
        q.eq("artifactId", args.artifactId).eq("status", "open"),
      )
      .collect();
    for (const group of openGroups.filter(
      (candidate) =>
        candidate.actorAccountId === actor.accountId &&
        candidate.source === "human",
    )) {
      await commitChangeGroup(ctx, group._id);
    }
    const refreshed = await ctx.db.get(args.artifactId);
    if (!refreshed) throw new Error("ARTIFACT_NOT_FOUND");
    const after = {
      title: refreshed.title,
      summary: refreshed.summary,
      content: refreshed.content,
      tags: refreshed.tags,
    };
    const parent = refreshed.currentVersionId
      ? await ctx.db.get(refreshed.currentVersionId)
      : null;
    const before = parent ? await loadVersionAfter(ctx, parent) : after;
    // The same checkpoint again with nothing changed since (a retried publish)
    // is the one already there, not a second entry in the history.
    if (
      parent?.source === "checkpoint" &&
      parent.name === name &&
      canonicalSnapshotJson(before) === canonicalSnapshotJson(after)
    )
      return { versionId: parent._id, name, createdAt: parent.createdAt };
    const { strategy, inline } = commitSnapshotPlan(
      refreshed.blueprintKey,
      before,
      after,
    );
    const [beforeObject, afterObject] = await Promise.all([
      retainSnapshotObject(ctx, refreshed.schoolId, before, strategy),
      retainSnapshotObject(ctx, refreshed.schoolId, after, strategy),
    ]);
    const now = Date.now();
    const versionId = await ctx.db.insert("spectraArtifactVersions", {
      artifactId: refreshed._id,
      ownerAccountId: refreshed.ownerAccountId,
      schoolId: refreshed.schoolId,
      parentVersionId: refreshed.currentVersionId,
      source: "checkpoint",
      creatorAccountIds: [actor.accountId],
      schemaVersion: refreshed.schemaVersion ?? 1,
      snapshotStrategy: strategy,
      snapshotRef: afterObject.snapshotRef,
      beforeSnapshotRef: beforeObject.snapshotRef,
      integrityHash: afterObject.integrityHash,
      before: inline ? before : undefined,
      after: inline ? after : undefined,
      summary: `Checkpoint: ${name}`,
      name,
      provenance: { source: "human", kind: "named_checkpoint" },
      createdAt: now,
    });
    await ctx.db.patch(refreshed._id, { currentVersionId: versionId });
    return { versionId, name, createdAt: now };
  },
});

export const commitImport = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    importJobId: v.id("artifactImportJobs"),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    const job = await ctx.db.get(args.importJobId);
    if (!job) throw new Error("ARTIFACT_IMPORT_VERSION_INVALID");
    const result = await commitImportJob(ctx, artifact, job, actor.accountId);
    const committedJob = await ctx.db.get(job._id);
    return {
      ...result,
      importJobId: job._id,
      artifactId: artifact._id,
      commitReceipt: committedJob?.commitReceipt ?? null,
      receipt: committedJob?.commitReceipt
        ? {
            kind: "artifact-import" as const,
            operationId: committedJob.operationId ?? null,
            importJobId: job._id,
            artifactId: artifact._id,
            versionId: result.versionId,
            commitReceipt: committedJob.commitReceipt,
          }
        : null,
    };
  },
});

export const reconcileImports = mutation({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    const jobs = await ctx.db
      .query("artifactImportJobs")
      .withIndex("by_artifact", (q) => q.eq("artifactId", artifact._id))
      .collect();
    const pending = jobs
      .filter(
        (job) =>
          job.ownerAccountId === actor.accountId &&
          ["imported", "awaiting_commit"].includes(job.status) &&
          !job.artifactVersionId,
      )
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(0, 20);
    const versionIds: Id<"spectraArtifactVersions">[] = [];
    for (const job of pending) {
      const result = await commitImportJob(
        ctx,
        artifact,
        job,
        actor.accountId,
        {
          preserveLiveCurrent: false,
        },
      );
      versionIds.push(result.versionId);
    }
    const recoveryVersionId = versionIds.length
      ? await retainLiveStateAfterRecoveredImport(
          ctx,
          artifact._id,
          actor.accountId,
        )
      : null;
    return { reconciled: versionIds.length, versionIds, recoveryVersionId };
  },
});

export const checkpointBeforeAi = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor.accountId ||
      run.status !== "running" ||
      run.executionId !== args.executionId
    )
      throw new Error("CHANGE_GROUP_AI_RUN_INVALID");
    return commitHumanCheckpoint(
      ctx,
      args.artifactId,
      "Live work before Spectra edited",
    );
  },
});

export const commitRestore = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    sourceVersionId: v.id("spectraArtifactVersions"),
    clientId: v.string(),
  },
  handler: async () => {
    // Older clients must not label a prior optimistic write as an admitted
    // restore. The signed artifactRestore transaction now owns this boundary.
    throw new Error("ARTIFACT_RESTORE_ADMISSION_REQUIRED");
  },
});

export const revertPlanForRun = mutation({
  args: { runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor.accountId)
      throw new Error("AI run not found");
    const groups = await ctx.db
      .query("changeGroups")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const restored: Array<{
      artifactId: Id<"spectraArtifacts">;
      snapshot: unknown;
    }> = [];
    const blocked: Array<{ artifactId: string; reason: string }> = [];
    for (const group of groups) {
      if (group.source !== "ai" || group.baseSnapshot === undefined) continue;
      const versions = await ctx.db
        .query("spectraArtifactVersions")
        .withIndex("by_artifact_created", (q) =>
          q.eq("artifactId", group.artifactId),
        )
        .order("desc")
        .take(12);
      const cutoff = group.committedAt ?? group.lastActivityAt;
      const laterHuman = versions.some(
        (version) =>
          version.createdAt > cutoff &&
          version.source !== "ai" &&
          version.source !== "restore" &&
          version.source !== "checkpoint",
      );
      if (laterHuman) {
        blocked.push({
          artifactId: String(group.artifactId),
          reason:
            "You edited this after Spectra finished. Undo from Version history if you want the earlier copy.",
        });
        continue;
      }
      restored.push({
        artifactId: group.artifactId,
        snapshot: group.baseSnapshot,
      });
    }
    return { restored, blocked };
  },
});
