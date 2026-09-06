import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  buildArtifactTextIndex,
  isHollowDefaultContent,
  requireArtifactCapability,
} from "./spectraShared";
import { getAuthenticatedActor } from "./identityShared";
import {
  loadVersionAfter,
  retainSnapshotObject,
  type SnapshotStrategy,
} from "./artifactSnapshots";

export const HUMAN_CHANGE_IDLE_MS = 45_000;

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
  const strategy = snapshotStrategy(
    artifact.blueprintKey,
  ) satisfies SnapshotStrategy;
  const [beforeObject, afterObject] = await Promise.all([
    retainSnapshotObject(ctx, artifact.schoolId, before, strategy),
    retainSnapshotObject(ctx, artifact.schoolId, after, strategy),
  ]);
  const inline = strategy === "normalized";
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
    job.status !== "imported"
  )
    throw new Error("ARTIFACT_IMPORT_VERSION_INVALID");
  if (job.artifactVersionId) {
    if (job.importedContent !== undefined)
      await ctx.db.patch(job._id, { importedContent: undefined });
    return { versionId: job.artifactVersionId, reused: true as const };
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
  const strategy = snapshotStrategy(
    refreshed.blueprintKey,
  ) satisfies SnapshotStrategy;
  const [beforeObject, afterObject] = await Promise.all([
    retainSnapshotObject(ctx, refreshed.schoolId, before, strategy),
    retainSnapshotObject(ctx, refreshed.schoolId, after, strategy),
  ]);
  const inline = strategy === "normalized";
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
  await ctx.db.patch(refreshed._id, {
    currentVersionId: versionId,
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
  });
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

function snapshotStrategy(typeKey: string) {
  return ["presentation", "sheets", "code", "whiteboard"].includes(typeKey)
    ? ("content_addressed" as const)
    : ("normalized" as const);
}

export async function commitChangeGroup(
  ctx: MutationCtx,
  groupId: Id<"changeGroups">,
  options: { source?: VersionSource; summary?: string; name?: string } = {},
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
  const before = group.baseSnapshot;
  const after = group.finalSnapshot;
  const now = Date.now();
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
  const strategy = snapshotStrategy(
    artifact.blueprintKey,
  ) satisfies SnapshotStrategy;
  const [beforeObject, afterObject] = await Promise.all([
    retainSnapshotObject(ctx, artifact.schoolId, before, strategy),
    retainSnapshotObject(ctx, artifact.schoolId, after, strategy),
  ]);
  const inline = strategy === "normalized";
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
  return { status: "committed" as const, versionId };
}

export async function commitHumanCheckpoint(
  ctx: MutationCtx,
  artifactId: Id<"spectraArtifacts">,
  summary: string,
) {
  const groups = await ctx.db
    .query("changeGroups")
    .withIndex("by_artifact_status_activity", (q) =>
      q.eq("artifactId", artifactId).eq("status", "open"),
    )
    .collect();
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
  if (JSON.stringify(before) === JSON.stringify(after)) {
    await Promise.all(
      humanGroups.map((group) =>
        ctx.db.patch(group._id, { status: "abandoned", committedAt: now }),
      ),
    );
    return [];
  }
  const strategy = snapshotStrategy(
    artifact.blueprintKey,
  ) satisfies SnapshotStrategy;
  const [beforeObject, afterObject] = await Promise.all([
    retainSnapshotObject(ctx, artifact.schoolId, before, strategy),
    retainSnapshotObject(ctx, artifact.schoolId, after, strategy),
  ]);
  const inline = strategy === "normalized";
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
    provenance: { regionIds, source: "human", kind: "pre_ai_checkpoint" },
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
    source: "human",
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
    source: "manual",
    summary: input.summary,
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
    return commitChangeGroup(ctx, group._id);
  },
});

export const commitBeforeAi = internalMutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    actorAccountId: v.id("accounts"),
    runId: v.id("spectraAiRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== args.actorAccountId ||
      run.status !== "running"
    )
      throw new Error("CHANGE_GROUP_AI_RUN_INVALID");
    return commitHumanCheckpoint(
      ctx,
      args.artifactId,
      "Your work before Spectra edited",
    );
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
    const strategy = snapshotStrategy(
      refreshed.blueprintKey,
    ) satisfies SnapshotStrategy;
    const [beforeObject, afterObject] = await Promise.all([
      retainSnapshotObject(ctx, refreshed.schoolId, before, strategy),
      retainSnapshotObject(ctx, refreshed.schoolId, after, strategy),
    ]);
    const inline = strategy === "normalized";
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
    return commitImportJob(ctx, artifact, job, actor.accountId);
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
          job.status === "imported" &&
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
  handler: async (ctx, args) => {
    const { actor } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "restore",
    );
    const sourceVersion = await ctx.db.get(args.sourceVersionId);
    if (!sourceVersion || sourceVersion.artifactId !== args.artifactId)
      throw new Error("ARTIFACT_RESTORE_VERSION_INVALID");
    const groups = await ctx.db
      .query("changeGroups")
      .withIndex("by_artifact_status_activity", (q) =>
        q.eq("artifactId", args.artifactId).eq("status", "open"),
      )
      .collect();
    const clientId = args.clientId.trim().slice(0, 180);
    const mine = groups.filter(
      (group) =>
        group.actorAccountId === actor.accountId &&
        group.clientId === clientId &&
        group.source === "human",
    );
    if (mine.length === 0)
      throw new Error(
        "ARTIFACT_RESTORE_NOT_SYNCHRONIZED: Synchronize the restored state before recording history.",
      );
    const committed = [];
    const sourceLabel =
      sourceVersion.name ||
      sourceVersion.summary ||
      new Date(sourceVersion.createdAt).toISOString();
    for (const group of mine)
      committed.push(
        await commitChangeGroup(ctx, group._id, {
          source: "restore",
          summary: `Restored ${sourceLabel}`,
        }),
      );
    return committed;
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
