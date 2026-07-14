import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireArtifactCapability } from "./spectraShared";
import { retainSnapshotObject, type SnapshotStrategy } from "./artifactSnapshots";

export const HUMAN_CHANGE_IDLE_MS = 45_000;

type VersionSource = "manual" | "ai" | "import" | "restore" | "migration" | "checkpoint";

function snapshotStrategy(typeKey: string) {
  return ["presentation", "sheets", "code", "whiteboard"].includes(typeKey)
    ? "content_addressed" as const
    : "normalized" as const;
}

export async function commitChangeGroup(
  ctx: MutationCtx,
  groupId: Id<"changeGroups">,
  options: { source?: VersionSource; summary?: string; name?: string } = {},
) {
  const group = await ctx.db.get(groupId);
  if (!group || group.status !== "open") return group?.versionId ? { status: "committed" as const, versionId: group.versionId } : { status: "unavailable" as const };
  const artifact = await ctx.db.get(group.artifactId);
  if (!artifact) {
    await ctx.db.patch(group._id, { status: "abandoned", committedAt: Date.now() });
    return { status: "abandoned" as const };
  }
  const before = group.baseSnapshot;
  const after = group.finalSnapshot;
  const now = Date.now();
  if (before === undefined || after === undefined || JSON.stringify(before) === JSON.stringify(after)) {
    await ctx.db.patch(group._id, { status: "abandoned", committedAt: now });
    return { status: "abandoned" as const };
  }
  const source = options.source ?? (group.source === "ai" ? "ai" : group.source === "human" ? "manual" : group.source);
  const summary = options.summary?.trim().slice(0, 500) || group.summary?.trim().slice(0, 500) || (source === "ai"
    ? "Spectra edited this artifact"
    : `Edited ${group.regionIds.length} ${group.regionIds.length === 1 ? "region" : "regions"}`);
  const strategy = snapshotStrategy(artifact.blueprintKey) satisfies SnapshotStrategy;
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
    provenance: { regionIds: group.regionIds, clientId: group.clientId, source: group.source },
    createdAt: now,
  });
  await ctx.db.patch(group._id, { status: "committed", summary, committedAt: now, versionId });
  await ctx.db.patch(artifact._id, { currentVersionId: versionId });
  return { status: "committed" as const, versionId };
}

export const commitIdle = internalMutation({
  args: { groupId: v.id("changeGroups"), expectedLastActivityAt: v.number() },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group || group.status !== "open" || group.lastActivityAt !== args.expectedLastActivityAt) return { status: "superseded" as const };
    if (Date.now() - group.lastActivityAt < HUMAN_CHANGE_IDLE_MS - 500) return { status: "not_idle" as const };
    return commitChangeGroup(ctx, group._id);
  },
});

export const commitBeforeAi = internalMutation({
  args: { artifactId: v.id("spectraArtifacts"), actorAccountId: v.id("accounts"), runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== args.actorAccountId || run.status !== "running") throw new Error("CHANGE_GROUP_AI_RUN_INVALID");
    const groups = await ctx.db.query("changeGroups").withIndex("by_artifact_status_activity", (q) => q.eq("artifactId", args.artifactId).eq("status", "open")).collect();
    const committed = [];
    for (const group of groups.filter((candidate) => candidate.source === "human")) {
      committed.push(await commitChangeGroup(ctx, group._id, { source: "checkpoint", summary: "Your work before Spectra edited" }));
    }
    return committed;
  },
});

export const commitCurrent = mutation({
  args: { artifactId: v.id("spectraArtifacts"), summary: v.optional(v.string()), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { actor } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    const groups = await ctx.db.query("changeGroups").withIndex("by_artifact_status_activity", (q) => q.eq("artifactId", args.artifactId).eq("status", "open")).collect();
    const mine = groups.filter((group) => group.actorAccountId === actor.accountId && group.source === "human");
    const committed = [];
    for (const group of mine) committed.push(await commitChangeGroup(ctx, group._id, { summary: args.summary, name: args.name }));
    return committed;
  },
});

export const checkpointBeforeAi = mutation({
  args: { artifactId: v.id("spectraArtifacts"), runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { actor } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor.accountId || run.status !== "running" || run.executionId !== args.executionId) throw new Error("CHANGE_GROUP_AI_RUN_INVALID");
    const groups = await ctx.db.query("changeGroups").withIndex("by_artifact_status_activity", (q) => q.eq("artifactId", args.artifactId).eq("status", "open")).collect();
    const committed = [];
    for (const group of groups.filter((candidate) => candidate.source === "human")) {
      committed.push(await commitChangeGroup(ctx, group._id, { source: "checkpoint", summary: "Live work before Spectra edited" }));
    }
    return committed;
  },
});

export const commitRestore = mutation({
  args: { artifactId: v.id("spectraArtifacts"), sourceVersionId: v.id("spectraArtifactVersions") },
  handler: async (ctx, args) => {
    const { actor } = await requireArtifactCapability(ctx, args.artifactId, "restore");
    const sourceVersion = await ctx.db.get(args.sourceVersionId);
    if (!sourceVersion || sourceVersion.artifactId !== args.artifactId) throw new Error("ARTIFACT_RESTORE_VERSION_INVALID");
    const groups = await ctx.db.query("changeGroups").withIndex("by_artifact_status_activity", (q) => q.eq("artifactId", args.artifactId).eq("status", "open")).collect();
    const mine = groups.filter((group) => group.actorAccountId === actor.accountId && group.source === "human");
    if (mine.length === 0) throw new Error("ARTIFACT_RESTORE_NOT_SYNCHRONIZED: Synchronize the restored state before recording history.");
    const committed = [];
    const sourceLabel = sourceVersion.name || sourceVersion.summary || new Date(sourceVersion.createdAt).toISOString();
    for (const group of mine) committed.push(await commitChangeGroup(ctx, group._id, { source: "restore", summary: `Restored ${sourceLabel}` }));
    return committed;
  },
});
