import { query } from "./_generated/server";
import { internalMutation, mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  buildArtifactTextIndex,
  defaultArtifactContent,
  defaultArtifactSchemaVersion,
  fallbackArtifactSummary,
  finalizeArtifactSummary,
  hollowFinalizeFailureMessage,
  isGeneratedArtifactSummary,
  isHollowDefaultContent,
  isPlaceholderBuildingSummary,
  normalizeArtifactId,
  requireArtifactCapability,
  requireWorkspaceCapability,
  requireSpectraActor,
  vArtifactStatus,
  vBlueprintKey,
  vCreatedFromSource,
  type BlueprintKey,
} from "./spectraShared";
import {
  bumpPolicyVersion,
  capabilitiesForLevel,
  evaluateAccess,
  listDirectlyGrantedResourceIds,
} from "./authorityShared";
import {
  ARTIFACT_SUMMARY_READ_MODEL_VERSION,
  artifactSummaryProjection,
  artifactSummarySearchText,
  findPrimaryNode,
  placementStatusFor,
  placementsForSource,
  placeSourceNode,
  purgeSourceNodes,
  syncSourceNodes,
  upsertArtifactSummary,
} from "./orgTreeShared";
import {
  hydrateVersionSafely,
  loadVersionAfter,
  retainSnapshotObject,
  type SnapshotStrategy,
} from "./artifactSnapshots";
import { scheduleDeletion } from "./spectraArtifactDeletion";
import { writeAuditEvent } from "./auditShared";
import { incrementOperationalCounter } from "./operationalCounters";
import { agentDraftHash } from "./agents";
import {
  projectArtifactForAccess,
  projectTimetableSharedContent,
  projectTimetableSnapshot,
} from "./quizPrivacy";
import { validateArtifactContent } from "../src/features/spectra/artifacts/registry";
import { normalizeSheetsContent } from "../src/features/spectra/sheets/model";
import { encodeArtifactContentForStorage } from "../shared/sheet-cells";

function contentForArtifactStorage(typeKey: string, content: unknown) {
  const canonical =
    typeKey === "sheets" ? normalizeSheetsContent(content) : content;
  const validated = validateArtifactContent(typeKey, canonical);
  if (!validated.success) {
    throw new Error(
      `ARTIFACT_CONTENT_INVALID: ${validated.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const stored =
    typeKey === "timetable"
      ? projectTimetableSharedContent(validated.data)
      : validated.data;
  return encodeArtifactContentForStorage(typeKey, stored);
}

// Keep editorial ink visible long enough for peers to notice (15 minutes).
const AI_EDITED_FLASH_MS = 90_000;

function currentAiEffects(artifact: Doc<"spectraArtifacts">, now = Date.now()) {
  return (artifact.aiEffects ?? []).filter(
    (effect) => !effect.expiresAt || effect.expiresAt > now,
  );
}

function effectsForRun(
  artifact: Doc<"spectraArtifacts">,
  runId: Id<"spectraAiRuns">,
  executionId: string,
  now = Date.now(),
) {
  return currentAiEffects(artifact, now).filter(
    (effect) => effect.runId === runId && effect.executionId === executionId,
  );
}

function effectsExcludingRun(
  artifact: Doc<"spectraArtifacts">,
  runId: Id<"spectraAiRuns">,
  executionId: string,
  now = Date.now(),
) {
  return currentAiEffects(artifact, now).filter(
    (effect) => effect.runId !== runId || effect.executionId !== executionId,
  );
}

function preferLineScopedPaths(next: string[], previous?: string[]) {
  const prior = (previous ?? []).filter(Boolean);
  const incoming = next.filter(Boolean);
  if (incoming.length === 0) return prior.slice(0, 256);
  const incomingHasLines = incoming.some((path) => path.includes("/lines/"));
  const priorHasLines = prior.some((path) => path.includes("/lines/"));
  const stripCoarseBlockPaths = (paths: string[]) => {
    const hasLines = paths.some((path) => path.includes("/lines/"));
    if (!hasLines) return paths.filter((path) => path !== "/");
    return paths.filter((path) => {
      if (path === "/") return false;
      if (path.includes("/lines/")) return true;
      // Drop coarse block text pointers once a line-scoped path exists.
      return !/^\/(?:content\/)?blocks\/[^/]+(?:\/text)?$/i.test(path);
    });
  };
  if (!incomingHasLines && priorHasLines) {
    return stripCoarseBlockPaths([
      ...new Set([
        ...prior.filter((path) => path.includes("/lines/")),
        ...incoming,
      ]),
    ]).slice(0, 256);
  }
  return stripCoarseBlockPaths(incoming).slice(0, 256);
}

function toSettlingEffects(
  effects: NonNullable<Doc<"spectraArtifacts">["aiEffects"]>,
  now: number,
  expiresAt: number,
  fallbackPaths?: string[],
) {
  const fallback = (fallbackPaths ?? [])
    .map((path) => path.trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 256);
  const fallbackHasLines = fallback.some((path) => path.includes("/lines/"));
  return effects.map((effect) => {
    const current = effect.changedPaths ?? [];
    const currentHasLines = current.some((path) => path.includes("/lines/"));
    const changedPaths =
      fallbackHasLines && !currentHasLines && fallback.length > 0
        ? fallback
        : current.length > 0
          ? current
          : fallback.length > 0
            ? fallback
            : current;
    return {
      ...effect,
      changedPaths,
      state: "settling" as const,
      expiresAt,
      updatedAt: now,
    };
  });
}

function previewChangedPathsOnly(
  preview: Doc<"spectraArtifacts">["aiPreview"],
  fallbackPaths?: string[],
) {
  const changedPaths =
    preview?.changedPaths?.filter(Boolean).slice(0, 256) ??
    fallbackPaths?.filter(Boolean).slice(0, 256);
  if (!changedPaths?.length) return undefined;
  return {
    changedPaths,
    startedAt: preview?.startedAt ?? Date.now(),
  };
}

function versionSnapshotStrategy(typeKey: string): SnapshotStrategy {
  return ["presentation", "sheets", "code", "whiteboard"].includes(typeKey)
    ? "content_addressed"
    : "normalized";
}

async function versionSnapshotFields(
  ctx: MutationCtx,
  schoolId: Id<"schools"> | undefined,
  typeKey: string,
  before: unknown,
  after: unknown,
) {
  const snapshotStrategy = versionSnapshotStrategy(typeKey);
  const [beforeObject, afterObject] = await Promise.all([
    retainSnapshotObject(ctx, schoolId, before, snapshotStrategy),
    retainSnapshotObject(ctx, schoolId, after, snapshotStrategy),
  ]);
  const inline = snapshotStrategy === "normalized";
  return {
    snapshotStrategy,
    snapshotRef: afterObject.snapshotRef,
    beforeSnapshotRef: beforeObject.snapshotRef,
    integrityHash: afterObject.integrityHash,
    before: inline ? before : undefined,
    after: inline ? after : undefined,
  };
}

/**
 * Where an artifact lives, read from the tree and filtered to the workspaces
 * this caller may see. A placement in a workspace the caller cannot open stays
 * invisible rather than leaking a title.
 */
async function listPlacementsForArtifact(
  ctx: Parameters<typeof requireSpectraActor>[0],
  artifactId: Id<"spectraArtifacts">,
) {
  const nodes = await ctx.db
    .query("orgNodes")
    .withIndex("by_kind_source", (q) =>
      q.eq("kind", "work").eq("sourceId", artifactId),
    )
    .collect();
  const visible = new Map<string, Doc<"spectraWorkspaces">>();
  for (const node of nodes) {
    if (node.deletedAt !== undefined || !node.workspaceContextId) continue;
    if (visible.has(node.workspaceContextId)) continue;
    const decision = await evaluateAccess(
      ctx,
      "workspace",
      node.workspaceContextId,
    );
    if (!decision.allowed) continue;
    const workspace = decision.loaded.resource as Doc<"spectraWorkspaces">;
    if (workspace.status !== "active") continue;
    visible.set(workspace._id, workspace);
  }
  return placementsForSource(ctx, "work", artifactId, visible);
}

type DirectGrantLevels = {
  account: "read" | "modify" | null;
  school: "read" | "modify" | null;
};

function strongerLevel(
  left: "read" | "modify" | null,
  right: "read" | "modify" | null,
) {
  if (left === "modify" || right === "modify") return "modify" as const;
  return left ?? right;
}

function activeDirectGrant(grant: Doc<"accessGrants">, now: number) {
  return (
    grant.source === "direct" &&
    !grant.revokedAt &&
    (!grant.expiresAt || grant.expiresAt > now)
  );
}

const ARTIFACT_OWNER_CAPABILITIES = [
  "read",
  "modify",
  "share",
  "delete",
  "restore",
  "use",
  "comment",
  "publish",
] as const;
const LIBRARY_METADATA_READ_LIMIT = 1_000;
type ArtifactListSummary = Omit<
  Doc<"spectraArtifactSummaries">,
  "_id" | "_creationTime"
>;

export const list = query({
  args: {
    status: v.optional(vArtifactStatus),
    blueprintKey: v.optional(vBlueprintKey),
    placement: v.optional(
      v.union(
        v.literal("all"),
        v.literal("inbox"),
        v.literal("shared"),
        v.literal("workspace"),
      ),
    ),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 80, 150));
    const baseStatus = args.status ?? "active";
    const blueprintKey = args.blueprintKey;
    const owned = blueprintKey
      ? await ctx.db
          .query("spectraArtifactSummaries")
          .withIndex("by_account_blueprint_status_updated", (q) =>
            q
              .eq("ownerAccountId", actor._id)
              .eq("blueprintKey", blueprintKey)
              .eq("status", baseStatus),
          )
          .order("desc")
          .take(limit * 3)
      : await ctx.db
          .query("spectraArtifactSummaries")
          .withIndex("by_account_status_updated", (q) =>
            q.eq("ownerAccountId", actor._id).eq("status", baseStatus),
          )
          .order("desc")
          .take(limit * 3);
    const now = Date.now();
    const [accountGrants, schoolGrants, ownPlacementNodes, pendingInvites, acceptedInvites] =
      await Promise.all([
        ctx.db
          .query("accessGrants")
          .withIndex("by_principal", (q) =>
            q.eq("principalType", "account").eq("principalId", actor.accountId),
          )
          .take(LIBRARY_METADATA_READ_LIMIT),
        ctx.db
          .query("accessGrants")
          .withIndex("by_principal", (q) =>
            q.eq("principalType", "school").eq("principalId", actor.schoolId),
          )
          .take(LIBRARY_METADATA_READ_LIMIT),
        ctx.db
          .query("orgNodes")
          .withIndex("by_account_live_kind_activity", (q) =>
            q
              .eq("accountId", actor.accountId)
              .eq("deletedAt", undefined)
              .eq("kind", "work"),
          )
          .order("desc")
          .take(limit * 3),
        ctx.db
          .query("shareInvitations")
          .withIndex("by_inviter_status", (q) =>
            q.eq("inviterAccountId", actor.accountId).eq("status", "pending"),
          )
          .take(LIBRARY_METADATA_READ_LIMIT),
        ctx.db
          .query("shareInvitations")
          .withIndex("by_inviter_status", (q) =>
            q.eq("inviterAccountId", actor.accountId).eq("status", "accepted"),
          )
          .take(LIBRARY_METADATA_READ_LIMIT),
      ]);

    const grantLevels = new Map<string, DirectGrantLevels>();
    for (const grant of [...accountGrants, ...schoolGrants]) {
      if (!activeDirectGrant(grant, now)) continue;
      const key = `${grant.resourceType}:${grant.resourceId}`;
      const levels = grantLevels.get(key) ?? { account: null, school: null };
      const side = grant.principalType === "account" ? "account" : "school";
      levels[side] = strongerLevel(levels[side], grant.level);
      grantLevels.set(key, levels);
    }

    const workspaceEntries = (
      await Promise.all(
        [...grantLevels.entries()]
          .filter(([key]) => key.startsWith("workspace:"))
          .map(async ([key, levels]) => {
            const resourceId = key.slice("workspace:".length);
            const workspaceId = ctx.db.normalizeId(
              "spectraWorkspaces",
              resourceId,
            );
            const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
            const level = strongerLevel(levels.account, levels.school);
            return workspace &&
              level &&
              workspace.status === "active" &&
              workspace.schoolId === actor.schoolId
              ? ([workspace._id, { workspace, level }] as const)
              : null;
          }),
      )
    ).filter(
      (
        entry,
      ): entry is readonly [
        Id<"spectraWorkspaces">,
        { workspace: Doc<"spectraWorkspaces">; level: "read" | "modify" },
      ] => Boolean(entry),
    );
    const grantedWorkspaces = new Map(workspaceEntries);
    const grantedPlacementNodes = (
      await Promise.all(
        workspaceEntries.map(([workspaceId]) =>
          ctx.db
            .query("orgNodes")
            .withIndex("by_workspace_context_live_kind_activity", (q) =>
              q
                .eq("workspaceContextId", workspaceId)
                .eq("deletedAt", undefined)
                .eq("kind", "work"),
            )
            .order("desc")
            .take(limit * 3),
        ),
      )
    ).flat();

    const candidateIds = new Set<string>(owned.map((row) => row.artifactId));
    for (const [key] of grantLevels) {
      const [resourceType, resourceId] = key.split(":", 2);
      if (resourceType === "artifact" || resourceType === "agent")
        candidateIds.add(resourceId!);
    }
    for (const node of [...ownPlacementNodes, ...grantedPlacementNodes])
      if (node.sourceId) candidateIds.add(node.sourceId);

    const summaries = (
      await Promise.all(
        [...candidateIds].map(async (resourceId) => {
          const artifactId = ctx.db.normalizeId("spectraArtifacts", resourceId);
          if (!artifactId) return null;
          const summary = await ctx.db
            .query("spectraArtifactSummaries")
            .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
            .unique();
          if (
            summary &&
            summary.readModelVersion === ARTIFACT_SUMMARY_READ_MODEL_VERSION
          )
            return summary;
          // Mixed-record rollout fallback: one bounded canonical read repairs
          // discovery for a legacy/missing summary without putting the body on
          // the list response. The mutation backfill remains responsible for
          // making this path disappear over time.
          const artifact = await ctx.db.get(artifactId);
          if (!artifact) return null;
          return {
            artifactId: artifact._id,
            ownerAccountId: artifact.ownerAccountId,
            schoolId: artifact.schoolId,
            blueprintKey: artifact.blueprintKey,
            status: artifact.status,
            updatedAt: artifact.updatedAt,
            searchText: artifactSummarySearchText(artifact),
            createdAt: artifact.createdAt,
            createdFromThreadId: artifact.createdFrom?.threadId,
            createdFromWorkspaceId: artifact.createdFrom?.workspaceId,
            aiRunId: artifact.aiRunId,
            currentVersionId: artifact.currentVersionId,
            contentHash: artifact.contentHash,
            schemaVersion: artifact.schemaVersion,
            deletionGeneration: artifact.deletionGeneration,
            projection: artifactSummaryProjection(artifact),
          } satisfies ArtifactListSummary;
        }),
      )
    ).filter((row) => row !== null) as ArtifactListSummary[];
    const rows = [...new Map(summaries.map((row) => [row.artifactId, row])).values()];
    const rowByArtifact = new Map<string, ArtifactListSummary>(
      rows.map((row) => [String(row.artifactId), row]),
    );

    const visibleWorkspaceIds = new Set<Id<"spectraWorkspaces">>();
    for (const node of [...ownPlacementNodes, ...grantedPlacementNodes])
      if (node.workspaceContextId) visibleWorkspaceIds.add(node.workspaceContextId);
    const workspaces = new Map(
      (
        await Promise.all(
          [...visibleWorkspaceIds].map(async (workspaceId) => {
            const workspace =
              grantedWorkspaces.get(workspaceId)?.workspace ??
              (await ctx.db.get(workspaceId));
            return workspace?.status === "active" &&
              workspace.schoolId === actor.schoolId
              ? ([workspaceId, workspace] as const)
              : null;
          }),
        )
      ).filter(
        (entry): entry is readonly [Id<"spectraWorkspaces">, Doc<"spectraWorkspaces">] =>
          Boolean(entry),
      ),
    );
    const placementsByArtifact = new Map<string, Array<{
      workspaceId: Id<"spectraWorkspaces">;
      workspaceTitle: string;
      nodeId: Id<"orgNodes">;
      pinned: boolean;
    }>>();
    for (const node of [
      ...new Map(
        [...ownPlacementNodes, ...grantedPlacementNodes].map((row) => [
          row._id,
          row,
        ]),
      ).values(),
    ]) {
      if (!node.sourceId || !node.workspaceContextId) continue;
      const workspace = workspaces.get(node.workspaceContextId);
      if (!workspace) continue;
      placementsByArtifact.set(node.sourceId, [
        ...(placementsByArtifact.get(node.sourceId) ?? []),
        {
          workspaceId: workspace._id,
          workspaceTitle: workspace.title,
          nodeId: node._id,
          pinned: node.pinned === true,
        },
      ]);
    }

    const inheritedLevels = new Map<string, "read" | "modify">();
    for (const node of grantedPlacementNodes) {
      if (!node.sourceId || !node.workspaceContextId) continue;
      const summary = rowByArtifact.get(node.sourceId);
      const workspaceAccess = grantedWorkspaces.get(node.workspaceContextId);
      if (!summary || !workspaceAccess) continue;
      const projectsAccess =
        node.accessProjection === true ||
        (node.accessProjection === undefined &&
          summary.ownerAccountId === workspaceAccess.workspace.ownerAccountId);
      if (!projectsAccess) continue;
      inheritedLevels.set(
        node.sourceId,
        strongerLevel(
          inheritedLevels.get(node.sourceId) ?? null,
          workspaceAccess.level,
        )!,
      );
    }

    // Overrides are security-sensitive: never cap an account-wide batch and
    // accidentally miss a deny. Read the one indexed row for each bounded
    // summary candidate instead.
    const overrideByArtifact = new Map(
      (
        await Promise.all(
          rows.map(async (row) => {
            const override = await ctx.db
              .query("artifactAccessOverrides")
              .withIndex("by_artifact_account", (q) =>
                q
                  .eq("artifactId", row.artifactId)
                  .eq("accountId", actor.accountId),
              )
              .unique();
            return override ? ([row.artifactId, override] as const) : null;
          }),
        )
      ).filter(
        (
          entry,
        ): entry is readonly [
          Id<"spectraArtifacts">,
          Doc<"artifactAccessOverrides">,
        ] => Boolean(entry),
      ),
    );
    const inviteesByResource = new Map<string, Set<string>>();
    for (const invitation of [...pendingInvites, ...acceptedInvites]) {
      if (invitation.expiresAt && invitation.expiresAt <= now) continue;
      const key = `${invitation.resourceType}:${invitation.resourceId}`;
      const invitees = inviteesByResource.get(key) ?? new Set<string>();
      invitees.add(invitation.inviteeAccountId);
      inviteesByResource.set(key, invitees);
    }

    const needle = args.search?.trim().toLowerCase();
    const candidateArtifacts = rows
      .filter((row) => row.schoolId === actor.schoolId)
      .filter((row) => row.blueprintKey !== "thread_reference")
      .filter((row) => row.status === baseStatus)
      .filter((row) => !blueprintKey || row.blueprintKey === blueprintKey)
      .filter((row) => {
        if (!needle) return true;
        const projection = row.projection as {
          title?: string;
          summary?: string;
          tags?: string[];
        };
        const maySearchBody =
          row.blueprintKey !== "timetable" &&
          (row.blueprintKey !== "quiz" ||
            row.ownerAccountId === actor.accountId);
        return `${projection.title ?? ""}\n${projection.summary ?? ""}\n${row.blueprintKey}\n${(projection.tags ?? []).join(" ")}\n${maySearchBody ? row.searchText : ""}\n${(placementsByArtifact.get(row.artifactId) ?? []).map((placement) => placement.workspaceTitle).join("\n")}`
          .toLowerCase()
          .includes(needle);
      });

    const artifacts = (
      await Promise.all(
        candidateArtifacts.map(async (row) => {
          const projection = row.projection as Record<string, unknown> & {
            blueprintKey?: string;
            updatedAt?: number;
          };
          const ownership =
            row.ownerAccountId === actor.accountId
              ? ("owned" as const)
              : ("shared" as const);
          const resourceType =
            row.blueprintKey === "agent" ? ("agent" as const) : ("artifact" as const);
          const direct = grantLevels.get(`${resourceType}:${row.artifactId}`);
          const directLevel = direct
            ? strongerLevel(direct.account, direct.school)
            : null;
          const override = overrideByArtifact.get(row.artifactId);
          let inheritedLevel = inheritedLevels.get(row.artifactId) ?? null;
          if (override?.effect === "deny") inheritedLevel = null;
          if (
            override?.effect === "restrict" &&
            override.maxLevel === "read" &&
            inheritedLevel
          )
            inheritedLevel = "read";
          const accessLevel =
            ownership === "owned"
              ? ("modify" as const)
              : strongerLevel(directLevel, inheritedLevel);
          if (!accessLevel) return null;
          const placements = placementsByArtifact.get(row.artifactId) ?? [];
          const activeInvitees =
            inviteesByResource.get(`${resourceType}:${row.artifactId}`) ??
            new Set<string>();
          const agentRelease =
            row.blueprintKey === "agent"
              ? await latestPublishedAgentRelease(ctx, row.artifactId)
              : undefined;
          const owner =
            row.blueprintKey === "agent"
              ? await ctx.db.get(row.ownerAccountId)
              : null;
          return {
            ...projection,
            placements,
            ownership,
            accessLevel,
            capabilities:
              ownership === "owned"
                ? [...ARTIFACT_OWNER_CAPABILITIES]
                : capabilitiesForLevel(accessLevel),
            accessReason:
              ownership === "owned"
                ? "owner"
                : directLevel
                  ? "grant"
                  : "workspace_inheritance",
            isShared: ownership === "shared" || activeInvitees.size > 0,
            sharedWithCount:
              ownership === "owned" ? activeInvitees.size : undefined,
            ...(row.blueprintKey === "agent"
              ? {
                  owner: owner
                    ? { name: owner.name, avatarUrl: owner.avatarUrl }
                    : undefined,
                  agentRelease: agentRelease
                    ? {
                        versionId: agentRelease.versionId,
                        releaseNumber: agentRelease.releaseNumber,
                        publishedAt: agentRelease.publishedAt,
                      }
                    : null,
                }
              : {}),
            placementStatus: placementStatusFor(placements, ownership),
          };
        }),
      )
    ).filter((artifact) => artifact !== null);

    return artifacts
      .filter((artifact) => {
        if (!args.placement || args.placement === "all") return true;
        if (args.placement === "shared") return artifact.ownership === "shared";
        return artifact.placementStatus === args.placement;
      })
      .sort(
        (a, b) =>
          Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0),
      )
      .slice(0, limit);
  },
});

/** One-time, cursor-shaped projection fill for artifacts created before P9.I3. */
export const backfillSummaries = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("spectraArtifacts").paginate({
      cursor: args.cursor,
      numItems: 100,
    });
    for (const artifact of page.page)
      await upsertArtifactSummary(ctx, artifact);
    return {
      processed: page.page.length,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

export const get = query({
  args: {
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    const { actor, artifact, decision } = await requireArtifactCapability(
      ctx,
      args.artifactId,
    );
    if (
      artifact.schoolId !== actor.schoolId ||
      artifact.blueprintKey === "thread_reference"
    )
      throw new Error("Artifact not found");
    const placements = await listPlacementsForArtifact(ctx, args.artifactId);
    const resourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const invitations = await ctx.db
      .query("shareInvitations")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", resourceType).eq("resourceId", artifact._id),
      )
      .collect();
    const ownership =
      artifact.ownerAccountId === actor.accountId
        ? ("owned" as const)
        : ("shared" as const);
    const activeInvitations = invitations.filter(
      (invitation) =>
        (invitation.status === "pending" || invitation.status === "accepted") &&
        (!invitation.expiresAt || invitation.expiresAt > Date.now()),
    );
    return {
      ...projectArtifactForAccess(artifact, decision.level),
      placements,
      ownership,
      accessLevel: decision.level,
      capabilities: decision.capabilities,
      accessReason: decision.reason,
      isShared: ownership === "shared" || activeInvitations.length > 0,
      sharedWithCount:
        ownership === "owned"
          ? new Set(
              activeInvitations.map(
                (invitation) => invitation.inviteeAccountId,
              ),
            ).size
          : undefined,
      placementStatus: placementStatusFor(placements, ownership),
    };
  },
});

const allowedAgentToolKeys = new Set([
  "artifact_search",
  "artifact_read",
  "artifact_create",
  "artifact_edit",
  "memory_retrieve",
  "school_data",
  "web_search",
]);

async function latestPublishedAgentRelease(
  ctx: Parameters<typeof requireSpectraActor>[0],
  agentId: Id<"spectraArtifacts">,
  allowedRollouts: Array<"internal_test" | "limited" | "published"> = [
    "published",
  ],
) {
  const releases = await ctx.db
    .query("agentReleases")
    .withIndex("by_agent_status", (q) =>
      q.eq("agentId", agentId).eq("status", "published"),
    )
    .collect();
  return releases
    .filter((release) =>
      allowedRollouts.includes(release.rollout ?? "published"),
    )
    .sort((left, right) => right.releaseNumber - left.releaseNumber)[0];
}

function publicAgentProjection(
  snapshot: unknown,
  fallback: Doc<"spectraArtifacts">,
) {
  const state =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>)
      : {};
  const content =
    state.content &&
    typeof state.content === "object" &&
    !Array.isArray(state.content)
      ? (state.content as Record<string, unknown>)
      : {};
  const profile =
    content.profile &&
    typeof content.profile === "object" &&
    !Array.isArray(content.profile)
      ? (content.profile as Record<string, unknown>)
      : {};
  const routing =
    content.routing &&
    typeof content.routing === "object" &&
    !Array.isArray(content.routing)
      ? (content.routing as Record<string, unknown>)
      : {};
  const skills = Array.isArray(content.skills)
    ? content.skills.flatMap((candidate) => {
        if (
          !candidate ||
          typeof candidate !== "object" ||
          Array.isArray(candidate)
        )
          return [];
        const skill = candidate as Record<string, unknown>;
        return skill.enabled !== false && typeof skill.name === "string"
          ? [skill.name.trim().slice(0, 100)]
          : [];
      })
    : [];
  return {
    title:
      typeof state.title === "string"
        ? state.title.slice(0, 200)
        : fallback.title,
    summary:
      typeof state.summary === "string"
        ? state.summary.slice(0, 1_000)
        : fallback.summary,
    tags: Array.isArray(state.tags)
      ? state.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.slice(0, 80))
          .slice(0, 12)
      : fallback.tags.slice(0, 12),
    purpose:
      typeof profile.purpose === "string"
        ? profile.purpose.slice(0, 1_000)
        : "",
    audienceIntent:
      typeof profile.audienceIntent === "string"
        ? profile.audienceIntent.slice(0, 500)
        : "",
    routingDescription:
      typeof routing.description === "string"
        ? routing.description.slice(0, 1_000)
        : "",
    skills: skills.slice(0, 12),
  };
}

/**
 * Agents this account has explicitly installed from Discover (§10.13).
 * Installing references a published release; it never copies the agent, so an
 * installed agent stays owned by whoever built it.
 */
export const listInstalledAgents = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSpectraActor(ctx);
    const follows = await ctx.db
      .query("agentFollows")
      .withIndex("by_account_status", (q) =>
        q.eq("accountId", actor.accountId).eq("status", "following"),
      )
      .order("desc")
      .take(200);

    const rows = [];
    for (const follow of follows) {
      const artifact = await ctx.db.get(follow.agentId);
      if (
        !artifact ||
        artifact.schoolId !== actor.schoolId ||
        artifact.blueprintKey !== "agent" ||
        artifact.status !== "active"
      )
        continue;
      // An installed agent the owner has since unpublished is no longer usable.
      const pinned = follow.pinnedReleaseId
        ? await ctx.db.get(follow.pinnedReleaseId)
        : null;
      const release =
        pinned && pinned.status === "published"
          ? pinned
          : await latestPublishedAgentRelease(ctx, artifact._id);
      if (!release) continue;
      const version = await ctx.db.get(release.versionId);
      if (!version) continue;

      const owner = await ctx.db.get(artifact.ownerAccountId);
      rows.push({
        agentId: artifact._id,
        ...publicAgentProjection(
          await loadVersionAfter(ctx, version),
          artifact,
        ),
        owner: owner
          ? { name: owner.name, avatarUrl: owner.avatarUrl }
          : { name: "Spectra creator" },
        releaseNumber: release.releaseNumber,
        publishedAt: release.publishedAt,
        installedAt: follow.createdAt,
        pinnedReleaseId: follow.pinnedReleaseId ?? undefined,
        ownedByViewer: artifact.ownerAccountId === actor.accountId,
        rating: null,
        ratingCount: 0,
      });
    }
    return rows.sort((left, right) => right.installedAt - left.installedAt);
  },
});

export const listPublicAgents = query({
  args: { search: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 40, 100));
    const policies = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_school", (q) => q.eq("schoolId", actor.schoolId))
      .order("desc")
      .take(400);
    const needle = args.search?.trim().toLowerCase();
    const now = Date.now();
    const viewerDomain = actor.email.split("@").at(-1)?.toLowerCase() ?? "";
    const rows = [];
    for (const policy of policies) {
      if (
        policy.resourceType !== "agent" ||
        !policy.publicEnabled ||
        rows.length >= limit
      )
        continue;
      const agentId = ctx.db.normalizeId("spectraArtifacts", policy.resourceId);
      const artifact = agentId ? await ctx.db.get(agentId) : null;
      if (
        !artifact ||
        artifact.schoolId !== actor.schoolId ||
        artifact.blueprintKey !== "agent" ||
        artifact.status !== "active"
      )
        continue;
      const publicLinks = await ctx.db
        .query("publicLinks")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "agent").eq("resourceId", artifact._id),
        )
        .collect();
      const discoverable = publicLinks.some(
        (link) =>
          !link.revokedAt &&
          (!link.expiresAt || link.expiresAt > now) &&
          (!link.domainRestriction || link.domainRestriction === viewerDomain),
      );
      if (!discoverable) continue;
      const release = await latestPublishedAgentRelease(ctx, artifact._id);
      const version = release ? await ctx.db.get(release.versionId) : null;
      if (!release || !version) continue;
      const projection = publicAgentProjection(
        await loadVersionAfter(ctx, version),
        artifact,
      );
      if (
        needle &&
        !`${projection.title}\n${projection.summary ?? ""}\n${projection.tags.join(" ")}\n${projection.skills.join(" ")}\n${projection.routingDescription}`
          .toLowerCase()
          .includes(needle)
      )
        continue;
      const owner = await ctx.db.get(artifact.ownerAccountId);
      const feedback = await ctx.db
        .query("agentFeedback")
        .withIndex("by_agent_created", (q) => q.eq("agentId", artifact._id))
        .collect();
      rows.push({
        agentId: artifact._id,
        ...projection,
        owner: owner
          ? { name: owner.name, avatarUrl: owner.avatarUrl }
          : { name: "Spectra creator" },
        releaseNumber: release.releaseNumber,
        publishedAt: release.publishedAt,
        rating: feedback.length
          ? feedback.reduce((sum, item) => sum + item.rating, 0) /
            feedback.length
          : null,
        ratingCount: feedback.length,
      });
    }
    return rows.sort((left, right) => right.publishedAt - left.publishedAt);
  },
});

export const addPublicAgent = mutation({
  args: { agentId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const artifact = await ctx.db.get(args.agentId);
    if (
      !artifact ||
      artifact.schoolId !== actor.schoolId ||
      artifact.blueprintKey !== "agent" ||
      artifact.status !== "active"
    )
      throw new Error("AGENT_PUBLIC_UNAVAILABLE");
    const policy = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", "agent").eq("resourceId", artifact._id),
      )
      .unique();
    if (!policy?.publicEnabled) throw new Error("AGENT_PUBLIC_UNAVAILABLE");
    const now = Date.now();
    const viewerDomain = actor.email.split("@").at(-1)?.toLowerCase() ?? "";
    const links = await ctx.db
      .query("publicLinks")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", "agent").eq("resourceId", artifact._id),
      )
      .collect();
    if (
      !links.some(
        (link) =>
          !link.revokedAt &&
          (!link.expiresAt || link.expiresAt > now) &&
          (!link.domainRestriction || link.domainRestriction === viewerDomain),
      )
    )
      throw new Error("AGENT_PUBLIC_UNAVAILABLE");
    if (!(await latestPublishedAgentRelease(ctx, artifact._id)))
      throw new Error("AGENT_RELEASE_REQUIRED");
    const existing = await ctx.db
      .query("accessGrants")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", "agent").eq("resourceId", artifact._id),
      )
      .collect();
    const current = existing.find(
      (grant) =>
        grant.principalType === "account" &&
        grant.principalId === actor.accountId &&
        grant.source === "direct" &&
        !grant.revokedAt &&
        (!grant.expiresAt || grant.expiresAt > now),
    );
    const existingFollow = await ctx.db
      .query("agentFollows")
      .withIndex("by_agent_account", (q) =>
        q.eq("agentId", artifact._id).eq("accountId", actor.accountId),
      )
      .unique();
    if (current) {
      if (existingFollow)
        await ctx.db.patch(existingFollow._id, {
          status: "following",
          updatedAt: now,
        });
      else
        await ctx.db.insert("agentFollows", {
          agentId: artifact._id,
          schoolId: artifact.schoolId,
          accountId: actor.accountId,
          status: "following",
          createdAt: now,
          updatedAt: now,
        });
      return { grantId: current._id, added: false };
    }
    const grantId = await ctx.db.insert("accessGrants", {
      schoolId: actor.schoolId,
      resourceType: "agent",
      resourceId: artifact._id,
      principalType: "account",
      principalId: actor.accountId,
      level: "read",
      capabilities: ["read", "use", "comment"],
      source: "direct",
      createdByAccountId: actor.accountId,
      createdAt: now,
      updatedAt: now,
    });
    const policyVersion = await bumpPolicyVersion(
      ctx,
      "agent",
      artifact._id,
      artifact.schoolId,
      actor.accountId,
    );
    if (existingFollow)
      await ctx.db.patch(existingFollow._id, {
        status: "following",
        pinnedReleaseId: undefined,
        updatedAt: now,
      });
    else
      await ctx.db.insert("agentFollows", {
        agentId: artifact._id,
        schoolId: artifact.schoolId,
        accountId: actor.accountId,
        status: "following",
        createdAt: now,
        updatedAt: now,
      });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "agent.public_added",
      targetType: "agent",
      targetId: artifact._id,
      metadata: { grantId, policyVersion },
      retentionClass: "operational",
    });
    return { grantId, added: true };
  },
});

export const publishAgent = mutation({
  args: {
    agentId: v.id("spectraArtifacts"),
    releaseNotes: v.optional(v.string()),
    rollout: v.optional(
      v.union(
        v.literal("internal_test"),
        v.literal("limited"),
        v.literal("published"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "publish",
    );
    if (
      artifact.blueprintKey !== "agent" ||
      artifact.status !== "active" ||
      !artifact.schoolId
    )
      throw new Error("AGENT_PUBLISH_INVALID");
    const content =
      artifact.content &&
      typeof artifact.content === "object" &&
      !Array.isArray(artifact.content)
        ? (artifact.content as Record<string, unknown>)
        : {};
    const instructions =
      content.instructions &&
      typeof content.instructions === "object" &&
      !Array.isArray(content.instructions)
        ? (content.instructions as Record<string, unknown>)
        : {};
    const routing =
      content.routing &&
      typeof content.routing === "object" &&
      !Array.isArray(content.routing)
        ? (content.routing as Record<string, unknown>)
        : {};
    if (
      typeof instructions.text !== "string" ||
      instructions.text.trim().length < 40
    )
      throw new Error("AGENT_INSTRUCTIONS_INCOMPLETE");
    if (
      routing.enabled === true &&
      (typeof routing.description !== "string" ||
        routing.description.trim().length < 30)
    )
      throw new Error("AGENT_ROUTING_DESCRIPTION_INCOMPLETE");
    const tools = Array.isArray(content.tools) ? content.tools : [];
    for (const candidate of tools) {
      const tool =
        candidate && typeof candidate === "object" && !Array.isArray(candidate)
          ? (candidate as Record<string, unknown>)
          : {};
      if (
        tool.enabled === true &&
        (typeof tool.key !== "string" || !allowedAgentToolKeys.has(tool.key))
      )
        throw new Error("AGENT_TOOL_UNSUPPORTED");
    }
    const resources = Array.isArray(content.resources) ? content.resources : [];
    for (const candidate of resources) {
      const resource =
        candidate && typeof candidate === "object" && !Array.isArray(candidate)
          ? (candidate as Record<string, unknown>)
          : {};
      if (typeof resource.artifactId !== "string")
        throw new Error("AGENT_RESOURCE_INVALID");
      const resourceId = ctx.db.normalizeId(
        "spectraArtifacts",
        resource.artifactId,
      );
      if (!resourceId) throw new Error("AGENT_RESOURCE_INVALID");
      await requireArtifactCapability(ctx, resourceId, "read");
      if (typeof resource.pinnedVersionId === "string") {
        const pinnedId = ctx.db.normalizeId(
          "spectraArtifactVersions",
          resource.pinnedVersionId,
        );
        const pinned = pinnedId ? await ctx.db.get(pinnedId) : null;
        if (!pinned || pinned.artifactId !== resourceId)
          throw new Error("AGENT_RESOURCE_VERSION_INVALID");
      }
    }
    const rollout = args.rollout ?? "published";
    const contentHash = await agentDraftHash(artifact);
    const passingEval =
      rollout === "internal_test"
        ? null
        : await ctx.db
            .query("agentEvalRuns")
            .withIndex("by_agent_hash_status", (q) =>
              q
                .eq("agentId", artifact._id)
                .eq("contentHash", contentHash)
                .eq("status", "passed"),
            )
            .order("desc")
            .first();
    if (rollout !== "internal_test" && !passingEval)
      throw new Error(
        "AGENT_EVAL_GATE_REQUIRED: Run and pass the current draft evaluation suite before release.",
      );
    const previous = artifact.currentVersionId
      ? await ctx.db.get(artifact.currentVersionId)
      : null;
    const before = previous
      ? await loadVersionAfter(ctx, previous)
      : {
          title: artifact.title,
          summary: artifact.summary,
          content: null,
          tags: artifact.tags,
        };
    const after = {
      title: artifact.title,
      summary: artifact.summary,
      content: artifact.content,
      tags: artifact.tags,
    };
    const snapshots = await versionSnapshotFields(
      ctx,
      artifact.schoolId,
      "agent",
      before,
      after,
    );
    const existing = await ctx.db
      .query("agentReleases")
      .withIndex("by_agent_number", (q) => q.eq("agentId", artifact._id))
      .collect();
    const releaseNumber =
      existing.reduce(
        (maximum, release) => Math.max(maximum, release.releaseNumber),
        0,
      ) + 1;
    const now = Date.now();
    const versionId = await ctx.db.insert("spectraArtifactVersions", {
      artifactId: artifact._id,
      ownerAccountId: artifact.ownerAccountId,
      schoolId: artifact.schoolId,
      parentVersionId: artifact.currentVersionId,
      source: "checkpoint",
      creatorAccountIds: [actor.accountId],
      schemaVersion: artifact.schemaVersion ?? 1,
      ...snapshots,
      summary: `Published agent release ${releaseNumber}`,
      name: `Release ${releaseNumber}`,
      provenance: {
        source: "human",
        kind: "agent_release",
        releaseNumber,
      },
      createdAt: now,
    });
    const releaseId = await ctx.db.insert("agentReleases", {
      agentId: artifact._id,
      schoolId: artifact.schoolId,
      versionId,
      releaseNumber,
      status: "published",
      rollout,
      evalRunId: passingEval?._id,
      contentHash,
      releaseNotes: args.releaseNotes?.trim().slice(0, 4_000),
      publishedByAccountId: actor.accountId,
      publishedAt: now,
    });
    await ctx.db.patch(artifact._id, {
      currentVersionId: versionId,
      updatedAt: now,
    });
    return {
      releaseId,
      versionId,
      releaseNumber,
      rollout,
      evalRunId: passingEval?._id,
      publishedAt: now,
    };
  },
});

export const listAgentReleases = query({
  args: { agentId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.agentId, "read");
    const releases = await ctx.db
      .query("agentReleases")
      .withIndex("by_agent_number", (q) => q.eq("agentId", args.agentId))
      .collect();
    return releases
      .sort((left, right) => right.releaseNumber - left.releaseNumber)
      .map((release) => ({
        releaseId: release._id,
        versionId: release.versionId,
        releaseNumber: release.releaseNumber,
        status: release.status,
        rollout: release.rollout,
        evalRunId: release.evalRunId,
        releaseNotes: release.releaseNotes,
        publishedAt: release.publishedAt,
      }));
  },
});

export const manageAgentRelease = mutation({
  args: {
    releaseId: v.id("agentReleases"),
    action: v.union(
      v.literal("promote"),
      v.literal("rollback"),
      v.literal("suspend"),
      v.literal("deprecate"),
    ),
  },
  handler: async (ctx, args) => {
    const release = await ctx.db.get(args.releaseId);
    if (!release) throw new Error("AGENT_RELEASE_NOT_FOUND");
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      release.agentId,
      "publish",
    );
    if (artifact.blueprintKey !== "agent" || !artifact.schoolId)
      throw new Error("AGENT_RELEASE_INVALID");
    const now = Date.now();
    if (args.action === "promote") {
      if (release.status !== "published")
        throw new Error("Only an active staged release can be promoted.");
      if (!release.evalRunId)
        throw new Error("A passing evaluation is required before promotion.");
      const evaluation = await ctx.db.get(release.evalRunId);
      if (
        !evaluation ||
        evaluation.status !== "passed" ||
        evaluation.contentHash !== release.contentHash
      )
        throw new Error(
          "The release evaluation is unavailable or no longer matches.",
        );
      await ctx.db.patch(release._id, { rollout: "published" });
    } else if (args.action === "rollback") {
      if (release.status === "deprecated")
        throw new Error("A deprecated release cannot be restored.");
      if (!release.evalRunId)
        throw new Error(
          "A passing evaluation is required before this release can receive new invocations.",
        );
      const evaluation = await ctx.db.get(release.evalRunId);
      if (
        !evaluation ||
        evaluation.status !== "passed" ||
        evaluation.contentHash !== release.contentHash
      )
        throw new Error(
          "This release no longer has matching passing evaluation evidence.",
        );
      const releases = await ctx.db
        .query("agentReleases")
        .withIndex("by_agent_number", (q) => q.eq("agentId", release.agentId))
        .collect();
      await Promise.all(
        releases.map((candidate) =>
          candidate._id === release._id
            ? ctx.db.patch(candidate._id, {
                status: "published",
                rollout: "published",
              })
            : candidate.releaseNumber > release.releaseNumber &&
                candidate.status === "published" &&
                (!candidate.rollout || candidate.rollout === "published")
              ? ctx.db.patch(candidate._id, { status: "suspended" })
              : Promise.resolve(),
        ),
      );
    } else {
      await ctx.db.patch(release._id, {
        status: args.action === "suspend" ? "suspended" : "deprecated",
      });
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: artifact.schoolId,
      action: `agent.release.${args.action}`,
      targetType: "agent",
      targetId: artifact._id,
      metadata: {
        releaseId: release._id,
        releaseNumber: release.releaseNumber,
      },
      retentionClass: "operational",
    });
    return {
      releaseId: release._id,
      action: args.action,
      updatedAt: now,
    };
  },
});

export const agentResourceHealth = query({
  args: { agentId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { actor: _actor, artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "modify",
    );
    if (artifact.blueprintKey !== "agent")
      throw new Error("AGENT_RESOURCE_HEALTH_INVALID");
    const content =
      artifact.content &&
      typeof artifact.content === "object" &&
      !Array.isArray(artifact.content)
        ? (artifact.content as Record<string, unknown>)
        : {};
    const bindings = Array.isArray(content.resources)
      ? content.resources
          .filter((value): value is Record<string, unknown> =>
            Boolean(
              value && typeof value === "object" && !Array.isArray(value),
            ),
          )
          .slice(0, 100)
      : [];
    return Promise.all(
      bindings.map(async (binding) => {
        const rawArtifactId =
          typeof binding.artifactId === "string" ? binding.artifactId : "";
        const resourceId = ctx.db.normalizeId(
          "spectraArtifacts",
          rawArtifactId,
        );
        if (!resourceId)
          return {
            id: binding.id,
            artifactId: rawArtifactId,
            health: "missing" as const,
          };
        try {
          const { artifact: resource } = await requireArtifactCapability(
            ctx,
            resourceId,
            "read",
          );
          const pinnedId =
            typeof binding.pinnedVersionId === "string"
              ? ctx.db.normalizeId(
                  "spectraArtifactVersions",
                  binding.pinnedVersionId,
                )
              : null;
          const pinned = pinnedId ? await ctx.db.get(pinnedId) : null;
          if (
            binding.versionPolicy === "reviewed" &&
            (!pinned || pinned.artifactId !== resource._id)
          )
            return {
              id: binding.id,
              artifactId: resource._id,
              health: "version_unavailable" as const,
            };
          return {
            id: binding.id,
            artifactId: resource._id,
            health: "available" as const,
            versionId: pinned?._id ?? resource.currentVersionId,
            title: resource.title,
            blueprintKey: resource.blueprintKey,
          };
        } catch {
          return {
            id: binding.id,
            artifactId: rawArtifactId,
            health: "permission_revoked" as const,
          };
        }
      }),
    );
  },
});

export const listAgentRoutingDescriptors = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSpectraActor(ctx);
    const owned = await ctx.db
      .query("spectraArtifacts")
      .withIndex("by_account_blueprint", (q) =>
        q.eq("ownerAccountId", actor._id).eq("blueprintKey", "agent"),
      )
      .collect();
    const grantedIds = await listDirectlyGrantedResourceIds(
      ctx,
      actor,
      "agent",
    );
    const granted = (
      await Promise.all(
        grantedIds.map(async (resourceId) => {
          const id = ctx.db.normalizeId("spectraArtifacts", resourceId);
          return id ? ctx.db.get(id) : null;
        }),
      )
    ).filter((artifact): artifact is Doc<"spectraArtifacts"> =>
      Boolean(artifact),
    );
    const candidates = [
      ...new Map(
        [...owned, ...granted].map((artifact) => [artifact._id, artifact]),
      ).values(),
    ];
    const descriptors = [];
    for (const artifact of candidates) {
      if (
        artifact.schoolId !== actor.schoolId ||
        artifact.status !== "active" ||
        artifact.blueprintKey !== "agent"
      )
        continue;
      const decision = await evaluateAccess(ctx, "agent", artifact._id);
      if (!decision.allowed || !decision.capabilities.includes("use")) continue;
      const release = await latestPublishedAgentRelease(
        ctx,
        artifact._id,
        artifact.ownerAccountId === actor.accountId
          ? ["internal_test", "limited", "published"]
          : ["limited", "published"],
      );
      if (!release) continue;
      const version = await ctx.db.get(release.versionId);
      if (!version) continue;
      const snapshot = await loadVersionAfter(ctx, version);
      const releaseState =
        snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
          ? (snapshot as Record<string, unknown>)
          : {};
      const content =
        releaseState.content &&
        typeof releaseState.content === "object" &&
        !Array.isArray(releaseState.content)
          ? (releaseState.content as Record<string, unknown>)
          : {};
      const routing =
        content.routing &&
        typeof content.routing === "object" &&
        !Array.isArray(content.routing)
          ? (content.routing as Record<string, unknown>)
          : {};
      if (routing.enabled !== true) continue;
      descriptors.push({
        agentId: artifact._id,
        versionId: release.versionId,
        title:
          typeof releaseState.title === "string"
            ? releaseState.title
            : artifact.title,
        summary:
          typeof releaseState.summary === "string"
            ? releaseState.summary
            : artifact.summary,
        description:
          typeof routing.description === "string"
            ? routing.description.slice(0, 2_000)
            : "",
        examples: Array.isArray(routing.examples)
          ? routing.examples
              .filter((value): value is string => typeof value === "string")
              .slice(0, 30)
          : [],
        negativeExamples: Array.isArray(routing.negativeExamples)
          ? routing.negativeExamples
              .filter((value): value is string => typeof value === "string")
              .slice(0, 30)
          : [],
        // Compiled competence for competence-aware routing (§10.11). Carried
        // as published-release data so a draft edit cannot change routing.
        foundry: content.foundry ?? null,
        updatedAt: release.publishedAt,
      });
    }
    return descriptors
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 100);
  },
});

export const getAgentRuntime = query({
  args: { agentId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "use",
    );
    if (artifact.blueprintKey !== "agent" || artifact.status !== "active")
      throw new Error("Agent not found");
    const release = await latestPublishedAgentRelease(
      ctx,
      artifact._id,
      artifact.ownerAccountId === actor.accountId
        ? ["internal_test", "limited", "published"]
        : ["limited", "published"],
    );
    if (!release) throw new Error("Agent has no published release");
    const version = await ctx.db.get(release.versionId);
    if (!version) throw new Error("Published agent release is unavailable");
    const snapshot = await loadVersionAfter(ctx, version);
    const releaseState =
      snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
        ? (snapshot as Record<string, unknown>)
        : {};
    const content =
      releaseState.content &&
      typeof releaseState.content === "object" &&
      !Array.isArray(releaseState.content)
        ? (releaseState.content as Record<string, unknown>)
        : {};
    const instructions =
      content.instructions &&
      typeof content.instructions === "object" &&
      !Array.isArray(content.instructions)
        ? (content.instructions as Record<string, unknown>)
        : {};
    const routing =
      content.routing &&
      typeof content.routing === "object" &&
      !Array.isArray(content.routing)
        ? (content.routing as Record<string, unknown>)
        : {};
    const resourceBindings = Array.isArray(content.resources)
      ? content.resources
          .filter((value): value is Record<string, unknown> =>
            Boolean(
              value && typeof value === "object" && !Array.isArray(value),
            ),
          )
          .slice(0, 60)
      : [];
    const resolvedResources = await Promise.all(
      resourceBindings.map(async (binding) => {
        const rawArtifactId =
          typeof binding.artifactId === "string" ? binding.artifactId : "";
        const resourceId = ctx.db.normalizeId(
          "spectraArtifacts",
          rawArtifactId,
        );
        if (!resourceId)
          return {
            id: binding.id,
            artifactId: rawArtifactId,
            label: binding.label,
            mode: binding.mode,
            health: "missing",
          };
        try {
          const { artifact: resource } = await requireArtifactCapability(
            ctx,
            resourceId,
            "read",
          );
          const pinnedId =
            typeof binding.pinnedVersionId === "string"
              ? ctx.db.normalizeId(
                  "spectraArtifactVersions",
                  binding.pinnedVersionId,
                )
              : null;
          const pinned = pinnedId ? await ctx.db.get(pinnedId) : null;
          if (
            binding.versionPolicy === "reviewed" &&
            (!pinned || pinned.artifactId !== resource._id)
          )
            return {
              id: binding.id,
              artifactId: resource._id,
              label: binding.label,
              mode: binding.mode,
              versionPolicy: binding.versionPolicy,
              health: "version_unavailable",
            };
          const state = pinned
            ? await loadVersionAfter(ctx, pinned)
            : {
                title: resource.title,
                summary: resource.summary,
                content: resource.content,
                tags: resource.tags,
              };
          return {
            id: binding.id,
            artifactId: resource._id,
            label: binding.label,
            mode: binding.mode,
            versionPolicy: binding.versionPolicy,
            versionId: pinned?._id ?? resource.currentVersionId,
            health: "available",
            snapshot: {
              id: resource._id,
              title:
                state &&
                typeof state === "object" &&
                !Array.isArray(state) &&
                typeof (state as Record<string, unknown>).title === "string"
                  ? (state as Record<string, unknown>).title
                  : resource.title,
              summary:
                state &&
                typeof state === "object" &&
                !Array.isArray(state) &&
                typeof (state as Record<string, unknown>).summary === "string"
                  ? (state as Record<string, unknown>).summary
                  : resource.summary,
              blueprintKey: resource.blueprintKey,
              content:
                state && typeof state === "object" && !Array.isArray(state)
                  ? (state as Record<string, unknown>).content
                  : resource.content,
              tags:
                state &&
                typeof state === "object" &&
                !Array.isArray(state) &&
                Array.isArray((state as Record<string, unknown>).tags)
                  ? (state as Record<string, unknown>).tags
                  : resource.tags,
            },
          };
        } catch {
          return {
            id: binding.id,
            artifactId: rawArtifactId,
            label: binding.label,
            mode: binding.mode,
            versionPolicy: binding.versionPolicy,
            health: "permission_revoked",
          };
        }
      }),
    );
    return {
      agentId: artifact._id,
      versionId: release.versionId,
      title:
        typeof releaseState.title === "string"
          ? releaseState.title
          : artifact.title,
      summary:
        typeof releaseState.summary === "string"
          ? releaseState.summary
          : artifact.summary,
      instructions:
        typeof instructions.text === "string"
          ? instructions.text.slice(0, 24_000)
          : "",
      skills: Array.isArray(content.skills)
        ? content.skills
            .flatMap((value) =>
              value &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              (value as Record<string, unknown>).enabled === true
                ? [
                    {
                      id: (value as Record<string, unknown>).id,
                      name: (value as Record<string, unknown>).name,
                      instructions: (value as Record<string, unknown>)
                        .instructions,
                    },
                  ]
                : [],
            )
            .slice(0, 40)
        : [],
      tools: Array.isArray(content.tools)
        ? content.tools
            .flatMap((value) =>
              value &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              (value as Record<string, unknown>).enabled === true
                ? [
                    {
                      id: (value as Record<string, unknown>).id,
                      key: (value as Record<string, unknown>).key,
                      approval: (value as Record<string, unknown>).approval,
                    },
                  ]
                : [],
            )
            .slice(0, 60)
        : [],
      resources: resolvedResources,
      runtimeBudget:
        content.runtimeBudget &&
        typeof content.runtimeBudget === "object" &&
        !Array.isArray(content.runtimeBudget)
          ? content.runtimeBudget
          : undefined,
      routing: {
        description:
          typeof routing.description === "string" ? routing.description : "",
        examples: Array.isArray(routing.examples) ? routing.examples : [],
        negativeExamples: Array.isArray(routing.negativeExamples)
          ? routing.negativeExamples
          : [],
      },
      // The compiled Foundry package. The run route resolves only the skills,
      // evidence and contracts one request activates (§10.14), rather than
      // flattening the whole agent into a prompt.
      foundry: content.foundry ?? null,
    };
  },
});

export const create = mutation({
  args: {
    blueprintKey: vBlueprintKey,
    title: v.string(),
    summary: v.optional(v.string()),
    content: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    source: v.optional(vCreatedFromSource),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    /**
     * Exact destination in the tree. Wins over `workspaceId` when both come.
     * `"root"` is the account's top level, spelled the same way every other
     * tree call spells it — without it, a work created while the reader is at
     * the top of their Library would silently land in General instead.
     */
    parentNodeId: v.optional(v.union(v.id("orgNodes"), v.literal("root"))),
    runId: v.optional(v.id("spectraAiRuns")),
    executionId: v.optional(v.string()),
    threadId: v.optional(v.id("spectraThreads")),
    sourceArtifactIds: v.optional(v.array(v.id("spectraArtifacts"))),
    sourceThreadIds: v.optional(v.array(v.id("spectraThreads"))),
    sourceAttachmentNames: v.optional(v.array(v.string())),
    contextSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    if (args.blueprintKey === "timetable") {
      throw new Error(
        "Calendar is an application surface, not creatable work. Open Calendar to schedule tasks, work blocks, or personal events.",
      );
    }
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (
        !run ||
        run.ownerAccountId !== actor._id ||
        run.schoolId !== actor.schoolId ||
        run.status !== "running" ||
        !args.executionId ||
        run.executionId !== args.executionId
      )
        throw new Error("This run is no longer allowed to create artifacts.");
    }
    if (args.workspaceId) {
      await requireWorkspaceCapability(ctx, args.workspaceId, "modify");
    }
    for (const sourceArtifactId of args.sourceArtifactIds ?? [])
      await requireArtifactCapability(ctx, sourceArtifactId);
    const now = Date.now();
    const title = args.title.trim() || "Untitled artifact";
    const summary =
      args.summary?.trim() ||
      fallbackArtifactSummary(args.blueprintKey as BlueprintKey);
    const content = contentForArtifactStorage(
      args.blueprintKey,
      args.content ?? defaultArtifactContent(args.blueprintKey as BlueprintKey),
    );
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      blueprintKey: args.blueprintKey,
      schemaVersion: defaultArtifactSchemaVersion(
        args.blueprintKey as BlueprintKey,
      ),
      title,
      summary,
      content,
      textIndex: buildArtifactTextIndex({
        title,
        summary,
        content,
        tags: args.tags,
      }),
      tags: args.tags ?? [],
      status: "active",
      createdFrom: {
        source: args.source ?? (args.workspaceId ? "workspace" : "manual"),
        workspaceId: args.workspaceId,
        runId: args.runId,
        threadId: args.threadId,
        sourceArtifactIds: args.sourceArtifactIds?.slice(0, 12),
        sourceThreadIds: args.sourceThreadIds?.slice(0, 4),
        sourceAttachmentNames: args.sourceAttachmentNames
          ?.map((name) => name.slice(0, 180))
          .slice(0, 8),
        contextSummary: args.contextSummary?.slice(0, 400),
      },
      createdAt: now,
      updatedAt: now,
    });
    /* Every created work is placed. With no workspace named it lands in
       General, so the Library never has to invent an "unplaced" state (D31). */
    const placementNode = await placeSourceNode(ctx, {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      kind: "work",
      sourceId: artifactId,
      name: title,
      target: args.parentNodeId
        ? { parentId: args.parentNodeId === "root" ? null : args.parentNodeId }
        : args.workspaceId
          ? { workspaceId: args.workspaceId }
          : {},
      placedByAccountId: actor.accountId,
      accessProjection: true,
    });
    const nodeId = placementNode._id;
    if (args.workspaceId) {
      await ctx.db.patch(args.workspaceId, {
        updatedAt: now,
        lastActivityAt: now,
      });
    }

    const created = {
      title,
      summary,
      content,
      tags: args.tags ?? [],
    };
    const initial = {
      title: "Untitled artifact",
      summary: undefined,
      content: null,
      tags: [] as string[],
    };
    const snapshots = await versionSnapshotFields(
      ctx,
      actor.schoolId,
      args.blueprintKey,
      initial,
      created,
    );
    const versionId = await ctx.db.insert("spectraArtifactVersions", {
      artifactId,
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      source: args.source === "ai" ? "ai" : "manual",
      runId: args.runId,
      ...snapshots,
      summary:
        args.source === "ai" ? "Created with Spectra" : "Artifact created",
      createdAt: now,
    });
    await ctx.db.patch(artifactId, { currentVersionId: versionId });
    await incrementOperationalCounter(ctx, {
      schoolId: actor.schoolId,
      category: "artifact_created",
      dimension: args.blueprintKey,
      occurredAt: now,
    });

    return { artifactId, nodeId };
  },
});


/**
 * Library Import for ordinary files (CANON D29): PDFs, images, and unknown
 * binaries land as real `resource` work with preserved bytes — never as a
 * hollow document projection.
 */
export const createImportedResource = mutation({
  args: {
    title: v.string(),
    nativeFormat: v.string(),
    bytes: v.number(),
    contentHash: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    parentNodeId: v.optional(v.union(v.id("orgNodes"), v.literal("root"))),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    if (args.workspaceId) {
      await requireWorkspaceCapability(ctx, args.workspaceId, "modify");
    }
    const now = Date.now();
    const title = args.title.trim() || "Untitled file";
    const nativeFormat = args.nativeFormat
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "")
      .slice(0, 32) || "bin";
    if (!Number.isSafeInteger(args.bytes) || args.bytes < 0) {
      throw new Error("RESOURCE_BYTES_INVALID");
    }
    const summary =
      args.bytes > 0
        ? `${Math.round(args.bytes).toLocaleString()} bytes · ${nativeFormat}`
        : nativeFormat;
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      blueprintKey: "resource",
      resourceClass: "resource",
      nativeFormat,
      compatibilityProfile: "strict-native",
      schemaVersion: 1,
      title,
      summary,
      content: null,
      contentHash: args.contentHash,
      textIndex: buildArtifactTextIndex({
        title,
        summary,
        content: null,
        tags: args.tags,
      }),
      tags: args.tags ?? ["imported"],
      status: "active",
      createdFrom: {
        source: "manual",
        workspaceId: args.workspaceId,
      },
      createdAt: now,
      updatedAt: now,
    });
    const placementNode = await placeSourceNode(ctx, {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      kind: "work",
      sourceId: artifactId,
      name: title,
      target: args.parentNodeId
        ? { parentId: args.parentNodeId === "root" ? null : args.parentNodeId }
        : args.workspaceId
          ? { workspaceId: args.workspaceId }
          : {},
      placedByAccountId: actor.accountId,
      typeKey: "resource",
      accessProjection: true,
    });
    if (args.workspaceId) {
      await ctx.db.patch(args.workspaceId, {
        updatedAt: now,
        lastActivityAt: now,
      });
    }
    await incrementOperationalCounter(ctx, {
      schoolId: actor.schoolId,
      category: "artifact_created",
      dimension: "resource",
      occurredAt: now,
    });
    return { artifactId, nodeId: placementNode._id };
  },
});

export const createPending = mutation({
  args: {
    blueprintKey: vBlueprintKey,
    title: v.string(),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    threadId: v.optional(v.id("spectraThreads")),
    sourceAttachmentIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor._id ||
      run.schoolId !== actor.schoolId ||
      run.status !== "running" ||
      run.executionId !== args.executionId
    )
      throw new Error("AI run not found");
    if (args.workspaceId)
      await requireWorkspaceCapability(ctx, args.workspaceId, "modify");
    const now = Date.now();
    const title = args.title.trim() || "Creating artifact";
    const summary = `Spectra is building ${title}.`;
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      blueprintKey: args.blueprintKey,
      schemaVersion: defaultArtifactSchemaVersion(
        args.blueprintKey as BlueprintKey,
      ),
      title,
      summary,
      content: defaultArtifactContent(args.blueprintKey as BlueprintKey),
      textIndex: `${title} ${summary}`,
      tags: [],
      status: "active",
      aiState: "creating",
      aiRunId: args.runId,
      aiExecutionId: args.executionId,
      aiProgress: 0.05,
      createdFrom: {
        source: "ai",
        workspaceId: args.workspaceId,
        runId: args.runId,
        threadId: args.threadId,
        sourceAttachmentIds: args.sourceAttachmentIds,
      },
      createdAt: now,
      updatedAt: now,
    });
    if (args.threadId && run.threadId === args.threadId) {
      const thread = await ctx.db.get(args.threadId);
      if (
        thread &&
        thread.ownerAccountId === actor._id &&
        thread.schoolId === actor.schoolId &&
        !thread.artifactId
      ) {
        await ctx.db.patch(thread._id, {
          artifactId,
          updatedAt: now,
          readSchemaVersion: 1,
        });
        await ctx.db.patch(thread._id, {
          contextArtifactIds: [
            ...new Set([...(thread.contextArtifactIds ?? []), artifactId]),
          ].slice(-8),
          readSchemaVersion: 1,
        });
      }
    }
    /* A pending artifact is placed at creation like any other, so a run that
       fails part-way still leaves the work findable rather than nowhere. */
    const pendingNode = await placeSourceNode(ctx, {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      kind: "work",
      sourceId: artifactId,
      name: title,
      target: args.workspaceId ? { workspaceId: args.workspaceId } : {},
      placedByAccountId: actor.accountId,
      accessProjection: true,
    });
    const nodeId = pendingNode._id;
    if (args.workspaceId) {
      await ctx.db.patch(args.workspaceId, {
        updatedAt: now,
        lastActivityAt: now,
      });
    }
    await incrementOperationalCounter(ctx, {
      schoolId: actor.schoolId,
      category: "artifact_created",
      dimension: args.blueprintKey,
      occurredAt: now,
    });
    return { artifactId, nodeId };
  },
});

export const finalizePendingLive = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    const run = await ctx.db.get(args.runId);
    const existingVersion = artifact.currentVersionId
      ? await ctx.db.get(artifact.currentVersionId)
      : null;
    const alreadyFinalizedByThisAttempt = Boolean(
      run &&
      run.ownerAccountId === actor.accountId &&
      run.status === "running" &&
      run.executionId === args.executionId &&
      artifact.aiState === "edited" &&
      !artifact.aiRunId &&
      existingVersion &&
      existingVersion.artifactId === artifact._id &&
      existingVersion.source === "ai" &&
      existingVersion.runId === args.runId,
    );
    if (alreadyFinalizedByThisAttempt) {
      // Convex mutations are atomic, but a caller can lose the response after
      // the commit and retry the exact operation. Treat that retry as success
      // instead of turning already-saved work into a user-visible failure.
      const node = await findPrimaryNode(
        ctx,
        actor.accountId,
        "work",
        args.artifactId,
      );
      return node
        ? { artifactId: args.artifactId, nodeId: node._id }
        : { artifactId: args.artifactId };
    }
    if (
      !run ||
      run.ownerAccountId !== actor.accountId ||
      run.status !== "running" ||
      run.executionId !== args.executionId ||
      artifact.aiRunId !== args.runId ||
      artifact.aiExecutionId !== args.executionId ||
      (artifact.aiState !== "creating" &&
        artifact.aiState !== "updating" &&
        artifact.aiState !== undefined)
    )
      throw new Error(
        "This pending artifact is no longer editable by that run.",
      );
    if (!artifact.currentVersionId || !artifact.liveStateVectorHash)
      throw new Error("The live artifact has not finished synchronizing.");
    const version = existingVersion;
    if (
      !version ||
      version.artifactId !== artifact._id ||
      version.source !== "ai" ||
      version.runId !== args.runId
    )
      throw new Error("The synchronized AI version is unavailable.");
    const blueprintKey = artifact.blueprintKey as BlueprintKey;
    // Never finalize an empty default shell as a completed create — leave it
    // pending so fail/discard cleanup (or a quiet retry) can remove it.
    if (isHollowDefaultContent(blueprintKey, artifact.content))
      throw new Error(hollowFinalizeFailureMessage(blueprintKey));
    const summary = finalizeArtifactSummary({
      blueprintKey,
      title: artifact.title,
      summary: args.summary?.trim() || artifact.summary,
      content: artifact.content,
    });
    const now = Date.now();
    const expiresAt = now + AI_EDITED_FLASH_MS;
    const settlingEffects = toSettlingEffects(
      currentAiEffects(artifact, now),
      now,
      expiresAt,
      artifact.aiPreview?.changedPaths,
    );
    await ctx.db.patch(version._id, { summary: "Created with Spectra" });
    await ctx.db.patch(args.artifactId, {
      summary,
      textIndex: buildArtifactTextIndex({
        title: artifact.title,
        summary,
        content: artifact.content,
        tags: artifact.tags,
      }),
      aiState: "edited",
      aiRunId: undefined,
      aiExecutionId: undefined,
      aiStateExpiresAt: expiresAt,
      aiProgress: undefined,
      aiPreview: previewChangedPathsOnly(
        artifact.aiPreview,
        artifact.blueprintKey === "sheets" ? [] : ["/"],
      ),
      aiEffects: settlingEffects.length ? settlingEffects : undefined,
      updatedAt: now,
    });
    /* The tree caches the work's name so listings need no fan-out read; a
       finalize can have retitled it. */
    await syncSourceNodes(ctx, "work", args.artifactId, artifact.title);
    const node = await findPrimaryNode(
      ctx,
      actor.accountId,
      "work",
      args.artifactId,
    );
    return node
      ? { artifactId: args.artifactId, nodeId: node._id }
      : { artifactId: args.artifactId };
  },
});

export const pausePendingForConflict = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    const run = await ctx.db.get(args.runId);
    const ownsActivePreview =
      artifact.aiRunId === args.runId &&
      artifact.aiExecutionId === args.executionId;
    const ownsEffect = (artifact.aiEffects ?? []).some(
      (effect) =>
        effect.runId === args.runId && effect.executionId === args.executionId,
    );
    if (
      !run ||
      run.ownerAccountId !== actor.accountId ||
      run.executionId !== args.executionId ||
      (!ownsActivePreview && !ownsEffect)
    )
      throw new Error(
        "This pending artifact does not belong to the paused run.",
      );
    const now = Date.now();
    const wasCreating = artifact.aiState === "creating";
    const remainingEffects = currentAiEffects(artifact, now).filter(
      (effect) =>
        effect.runId !== args.runId || effect.executionId !== args.executionId,
    );
    const latest = remainingEffects.at(-1);
    await ctx.db.patch(artifact._id, {
      aiState: remainingEffects.length ? "updating" : undefined,
      aiRunId: latest?.runId,
      aiExecutionId: latest?.executionId,
      aiStateExpiresAt: undefined,
      aiProgress: remainingEffects.length ? artifact.aiProgress : undefined,
      aiPreview: ownsActivePreview ? undefined : artifact.aiPreview,
      aiEffects: remainingEffects.length ? remainingEffects : undefined,
      summary:
        wasCreating && artifact.summary?.startsWith("Spectra is building ")
          ? "Draft paused while an overlapping edit is resolved."
          : artifact.summary,
      updatedAt: now,
    });
    return { paused: true };
  },
});

export const patchPendingContent = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    content: v.any(),
    progress: v.number(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor.accountId ||
      run.status !== "running" ||
      run.executionId !== args.executionId ||
      artifact.aiRunId !== args.runId ||
      artifact.aiExecutionId !== args.executionId ||
      artifact.aiState !== "creating"
    )
      throw new Error(
        "This pending artifact is no longer editable by that run.",
      );
    const progress = Math.max(0, Math.min(0.98, args.progress));
    const title = args.title?.trim() || artifact.title;
    const content = contentForArtifactStorage(
      artifact.blueprintKey,
      args.content,
    );
    await ctx.db.patch(args.artifactId, {
      title,
      summary: args.summary ?? artifact.summary,
      textIndex: `${title} ${args.summary ?? artifact.summary ?? ""}`,
      aiProgress: progress,
      aiPreview: {
        ...(artifact.aiPreview ?? {}),
        title,
        summary: args.summary ?? artifact.summary,
        content,
        // Sheets cell grids must stay cell-exact; other creates use "/".
        changedPaths:
          artifact.blueprintKey === "sheets"
            ? (artifact.aiPreview?.changedPaths ?? [])
            : ["/"],
        startedAt: artifact.aiPreview?.startedAt ?? Date.now(),
      },
      updatedAt: Date.now(),
    });
    return { artifactId: args.artifactId, progress };
  },
});

export const updateAiEffect = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    title: v.string(),
    detail: v.optional(v.string()),
    activity: v.union(
      v.literal("create"),
      v.literal("edit"),
      v.literal("verify"),
      v.literal("other"),
    ),
    regionHint: v.optional(v.string()),
    operationIndex: v.optional(v.number()),
    regionIds: v.optional(v.array(v.string())),
    changedPaths: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor.accountId ||
      run.schoolId !== actor.schoolId ||
      run.status !== "running" ||
      run.executionId !== args.executionId
    )
      throw new Error(
        "This run is no longer allowed to show an artifact effect.",
      );
    const now = Date.now();
    const effectTitle = args.title.replace(/\s+/g, " ").trim().slice(0, 88);
    if (effectTitle.length < 4)
      throw new Error("The artifact effect title is too vague.");
    const effectDetail = args.detail?.replace(/\s+/g, " ").trim().slice(0, 240);
    const effectRegionHint = args.regionHint
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    const effectId =
      args.operationIndex !== undefined
        ? `${args.runId}:${args.operationIndex}`
        : `${args.runId}:focused:${effectRegionHint ?? args.activity}`;
    const existingEffects = currentAiEffects(artifact, now).filter(
      (effect) =>
        effect.runId !== args.runId || effect.executionId === args.executionId,
    );
    const previous = existingEffects.find(
      (effect) => effect.effectId === effectId,
    );
    const nextEffect = {
      effectId,
      runId: args.runId,
      executionId: args.executionId,
      ...(args.operationIndex !== undefined
        ? { operationIndex: Math.max(0, Math.floor(args.operationIndex)) }
        : {}),
      title: effectTitle,
      ...(effectDetail ? { detail: effectDetail } : {}),
      activity: args.activity,
      ...(effectRegionHint ? { regionHint: effectRegionHint } : {}),
      regionIds: [
        ...new Set(
          (args.regionIds ?? previous?.regionIds ?? [])
            .map((regionId) => regionId.trim().slice(0, 240))
            .filter(Boolean),
        ),
      ].slice(0, 128),
      changedPaths: [
        ...new Set(
          (
            (args.changedPaths && args.changedPaths.length > 0
              ? args.changedPaths
              : undefined) ??
            (previous?.changedPaths && previous.changedPaths.length > 0
              ? previous.changedPaths
              : undefined) ??
            (artifact.aiPreview?.changedPaths &&
            artifact.aiPreview.changedPaths.length > 0
              ? artifact.aiPreview.changedPaths
              : undefined) ??
            // Creating shells often receive progress effects before content
            // patches; default to whole-artifact so mid-open studios light.
            // Sheets stay cell-exact (no "/"). Empty arrays must not win over
            // this fallback via `??`.
            (artifact.blueprintKey !== "sheets" &&
            (artifact.aiState === "creating" ||
              (artifact.createdFrom?.runId === args.runId &&
                !artifact.currentVersionId))
              ? ["/"]
              : [])
          )
            .map((path) => path.trim().slice(0, 500))
            .filter(Boolean),
        ),
      ].slice(0, 256),
      state: "active" as const,
      startedAt: previous?.startedAt ?? now,
      updatedAt: now,
    };
    const creating =
      artifact.aiState === "creating" ||
      (artifact.createdFrom?.runId === args.runId &&
        !artifact.currentVersionId);
    await ctx.db.patch(args.artifactId, {
      aiState: creating ? "creating" : "updating",
      aiRunId: args.runId,
      aiExecutionId: args.executionId,
      aiEffects: [
        ...existingEffects.filter((effect) => effect.effectId !== effectId),
        nextEffect,
      ].slice(-24),
      aiPreview: {
        ...(artifact.aiPreview ?? { startedAt: now }),
        ...(creating && !artifact.aiPreview?.changedPaths?.length
          ? { changedPaths: nextEffect.changedPaths }
          : {}),
        effectTitle,
        ...(effectDetail ? { effectDetail } : {}),
        effectActivity: args.activity,
        ...(effectRegionHint ? { effectRegionHint } : {}),
        ...(args.operationIndex !== undefined
          ? { effectOperationIndex: args.operationIndex }
          : {}),
      },
      updatedAt: now,
    });
    return { artifactId: args.artifactId };
  },
});

export const stageAiPatch = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    content: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    changedPaths: v.optional(v.array(v.string())),
    operationIndex: v.optional(v.number()),
    /** When true, also write durable artifact fields so verify cannot race a lagging gateway projection. */
    commit: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
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
      throw new Error("This run is no longer allowed to preview changes.");
    const now = Date.now();
    const content =
      args.content === undefined
        ? undefined
        : contentForArtifactStorage(artifact.blueprintKey, args.content);
    const changedPaths = (args.changedPaths ?? [])
      .map((path) => path.trim().slice(0, 500))
      .filter(Boolean)
      .slice(0, 256);
    const effects = currentAiEffects(artifact, now).map((effect) => {
      if (
        effect.runId !== args.runId ||
        effect.executionId !== args.executionId ||
        (args.operationIndex !== undefined &&
          effect.operationIndex !== args.operationIndex)
      ) {
        return effect;
      }
      // Never wipe a concrete region list with an empty mid-stream frame
      // (approach / select gestures have no content delta yet).
      const nextPaths = preferLineScopedPaths(
        changedPaths.length > 0
          ? changedPaths
          : (effect.changedPaths ?? []).filter(Boolean).slice(0, 256),
        effect.changedPaths,
      );
      return { ...effect, changedPaths: nextPaths, updatedAt: now };
    });
    const nextTitle = args.title?.trim() || artifact.title;
    const previousGeneratedSummary = finalizeArtifactSummary({
      blueprintKey: artifact.blueprintKey as BlueprintKey,
      title: artifact.title,
      summary: undefined,
      content: artifact.content,
    });
    const shouldRefreshGeneratedSummary =
      content !== undefined &&
      (artifact.summary === previousGeneratedSummary ||
        isGeneratedArtifactSummary(artifact.summary, artifact.blueprintKey as BlueprintKey));
    const nextSummary = shouldRefreshGeneratedSummary
      ? finalizeArtifactSummary({
          blueprintKey: artifact.blueprintKey as BlueprintKey,
          title: nextTitle,
          summary: undefined,
          content,
        })
      : args.summary !== undefined
        ? args.summary
        : artifact.summary;
    const nextTags = args.tags ?? artifact.tags;
    const previewPaths = preferLineScopedPaths(
      changedPaths.length > 0
        ? changedPaths
        : (artifact.aiPreview?.changedPaths ?? [])
            .map((path) => path.trim().slice(0, 500))
            .filter(Boolean)
            .slice(0, 256),
      artifact.aiPreview?.changedPaths,
    );
    await ctx.db.patch(args.artifactId, {
      aiState: "updating",
      aiRunId: args.runId,
      aiExecutionId: args.executionId,
      ...(args.commit && content !== undefined
        ? {
            title: nextTitle,
            summary: nextSummary,
            tags: nextTags,
            content,
            textIndex: buildArtifactTextIndex({
              title: nextTitle,
              summary: nextSummary,
              content,
              tags: nextTags,
            }),
            syncState: "synchronized",
            lastSynchronizedAt: now,
          }
        : {}),
      aiPreview: {
        ...(artifact.aiPreview ?? {}),
        title: args.title,
        summary: args.summary,
        content,
        tags: args.tags,
        changedPaths: previewPaths,
        startedAt: artifact.aiPreview?.startedAt ?? now,
      },
      aiEffects: effects,
      updatedAt: now,
    });
    return { artifactId: args.artifactId };
  },
});

function researchRefsInContent(value: unknown, output = new Set<string>(), depth = 0): Set<string> {
  if (depth > 12 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) researchRefsInContent(item, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.sourceRefs)) {
    for (const ref of record.sourceRefs)
      if (typeof ref === "string" && /^(?:source|evidence):/.test(ref))
        output.add(ref);
  }
  for (const child of Object.values(record))
    researchRefsInContent(child, output, depth + 1);
  return output;
}

function citationsForResearchContent(bundle: unknown, content: unknown) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return bundle;
  const record = bundle as Record<string, unknown>;
  const sources = Array.isArray(record.sources) ? record.sources : [];
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  const sourceIds = new Set(
    sources.flatMap((source) =>
      source && typeof source === "object" && typeof (source as Record<string, unknown>).id === "string"
        ? [(source as Record<string, unknown>).id as string]
        : [],
    ),
  );
  const evidenceBySource = new Map<string, string[]>();
  const evidenceIds = new Set<string>();
  for (const span of evidence) {
    if (!span || typeof span !== "object") continue;
    const row = span as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.sourceId !== "string") continue;
    if (!sourceIds.has(row.sourceId)) continue;
    evidenceIds.add(row.id);
    evidenceBySource.set(row.sourceId, [
      ...(evidenceBySource.get(row.sourceId) ?? []),
      row.id,
    ]);
  }
  const citations = new Map<string, { sourceId: string; evidenceIds: string[] }>();
  for (const ref of researchRefsInContent(content)) {
    if (ref.startsWith("source:")) {
      if (!sourceIds.has(ref)) throw new Error("RESEARCH_SOURCE_REF_NOT_ISSUED");
      const ids = evidenceBySource.get(ref) ?? [];
      const source = sources.find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          (candidate as Record<string, unknown>).id === ref,
      ) as Record<string, unknown> | undefined;
      // Partial/unverified search results remain visible as sourceRefs, but
      // cannot be upgraded into a portable citation.
      if (source?.verified === true && ids.length)
        citations.set(ref, { sourceId: ref, evidenceIds: [ids[0]!] });
    } else {
      if (!evidenceIds.has(ref)) throw new Error("RESEARCH_EVIDENCE_REF_NOT_ISSUED");
      const span = evidence.find(
        (candidate) => candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).id === ref,
      ) as Record<string, unknown> | undefined;
      if (span && typeof span.sourceId === "string") {
        const source = sources.find(
          (candidate) =>
            candidate &&
            typeof candidate === "object" &&
            (candidate as Record<string, unknown>).id === span.sourceId,
        ) as Record<string, unknown> | undefined;
        if (source?.verified !== true) continue;
        const prior = citations.get(span.sourceId);
        citations.set(span.sourceId, {
          sourceId: span.sourceId,
          evidenceIds: [...new Set([...(prior?.evidenceIds ?? []), ref])],
        });
      }
    }
  }
  return { ...record, citations: [...citations.values()] };
}

export const attachResearchEvidence = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor.accountId ||
      run.executionId !== args.executionId
    )
      throw new Error("This research evidence belongs to another run.");
    const snapshot =
      run.contextSnapshot &&
      typeof run.contextSnapshot === "object" &&
      !Array.isArray(run.contextSnapshot)
        ? (run.contextSnapshot as Record<string, unknown>)
        : {};
    const bundle = snapshot.researchEvidence;
    if (!bundle) return { artifactId: artifact._id, attached: false };
    const createdFrom = artifact.createdFrom ?? { source: "ai" as const };
    const persistedBundle = citationsForResearchContent(bundle, artifact.content);
    await ctx.db.patch(artifact._id, {
      createdFrom: { ...createdFrom, sourceBundle: persistedBundle },
      updatedAt: Date.now(),
    });
    return { artifactId: artifact._id, attached: true };
  },
});

export const discardPendingForRun = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor._id ||
      run.schoolId !== actor.schoolId ||
      run.executionId !== args.executionId
    )
      throw new Error("This run attempt is no longer active.");
    const artifacts = await ctx.db
      .query("spectraArtifacts")
      .withIndex("by_account_status", (q) =>
        q.eq("ownerAccountId", actor._id).eq("status", "active"),
      )
      .collect();
    const pending = artifacts.filter(
      (artifact) =>
        artifact.schoolId === actor.schoolId &&
        artifact.aiRunId === args.runId &&
        artifact.aiExecutionId === args.executionId &&
        (artifact.aiState === "creating" ||
          (artifact.createdFrom?.runId === args.runId &&
            !artifact.currentVersionId)),
    );
    for (const artifact of pending) {
      await purgeSourceNodes(ctx, "work", artifact._id);
      await ctx.db.delete(artifact._id);
    }
    return { discarded: pending.length };
  },
});

export const pausePendingForApproval = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor._id ||
      run.schoolId !== actor.schoolId ||
      run.status !== "awaiting_confirmation" ||
      run.executionId !== args.executionId
    )
      throw new Error("This run is not waiting for approval.");
    const artifacts = await ctx.db
      .query("spectraArtifacts")
      .withIndex("by_account_status", (q) =>
        q.eq("ownerAccountId", actor._id).eq("status", "active"),
      )
      .collect();
    const pending = artifacts.filter(
      (artifact) =>
        artifact.schoolId === actor.schoolId &&
        artifact.aiRunId === args.runId &&
        artifact.aiExecutionId === args.executionId &&
        artifact.createdFrom?.runId === args.runId &&
        !artifact.currentVersionId,
    );
    const now = Date.now();
    await Promise.all(
      pending.map((artifact) =>
        ctx.db.patch(artifact._id, {
          aiState: undefined,
          aiProgress: undefined,
          aiPreview: undefined,
          aiEffects: undefined,
          summary: "Proposed artifact awaiting your approval.",
          updatedAt: now,
        }),
      ),
    );
    return { paused: pending.length };
  },
});

export const failPendingForRun = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor._id ||
      run.schoolId !== actor.schoolId ||
      run.executionId !== args.executionId
    )
      throw new Error("This run attempt is no longer active.");
    const artifacts = await ctx.db
      .query("spectraArtifacts")
      .withIndex("by_account_status", (q) =>
        q.eq("ownerAccountId", actor._id).eq("status", "active"),
      )
      .collect();
    const pending = artifacts.filter(
      (artifact) =>
        artifact.schoolId === actor.schoolId &&
        artifact.aiRunId === args.runId &&
        artifact.aiExecutionId === args.executionId &&
        artifact.aiState === "creating",
    );
    let removed = 0;
    await Promise.all(
      pending.map(async (artifact) => {
        // A provisional shell with no generated content is not useful work. Do
        // not leave an empty red artifact behind after an internal format error.
        // Also discard shells that only ever received hollow defaults (empty
        // timetable events, trivial <main></main> code, empty sheets, etc.)
        // even if progress streamed past the early threshold.
        const hollowDefaults = isHollowDefaultContent(
          artifact.blueprintKey,
          artifact.content,
        );
        if ((artifact.aiProgress ?? 0) <= 0.05 || hollowDefaults) {
          await purgeSourceNodes(ctx, "work", artifact._id);
          await ctx.db.delete(artifact._id);
          removed += 1;
          return;
        }
        await ctx.db.patch(artifact._id, {
          aiState: undefined,
          aiRunId: undefined,
          aiExecutionId: undefined,
          aiStateExpiresAt: undefined,
          aiProgress: undefined,
          aiPreview: undefined,
          aiEffects: undefined,
          summary: isPlaceholderBuildingSummary(artifact.summary)
            ? "Incomplete draft preserved from an interrupted Spectra run."
            : artifact.summary,
          updatedAt: Date.now(),
        });
      }),
    );
    return { failed: pending.length - removed, removed };
  },
});

export const settleStagedForRun = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    outcome: v.union(v.literal("clear"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor._id ||
      run.schoolId !== actor.schoolId ||
      run.executionId !== args.executionId
    )
      throw new Error("This run attempt is no longer active.");
    const [ownedArtifacts, operations] = await Promise.all([
      ctx.db
        .query("spectraArtifacts")
        .withIndex("by_account_status", (q) =>
          q.eq("ownerAccountId", actor._id).eq("status", "active"),
        )
        .collect(),
      ctx.db
        .query("spectraOperations")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .collect(),
    ]);
    // A run may edit an artifact through an explicit direct grant. Settlement
    // must follow the run's recorded operation targets, not only artifacts
    // owned by the run owner, otherwise the durable edit succeeds while its
    // streaming preview and AI presence remain stuck forever.
    const operationArtifactIds = new Set<string>();
    for (const operation of operations) {
      if (operation.executionId !== args.executionId) continue;
      if (operation.pendingArtifactId)
        operationArtifactIds.add(operation.pendingArtifactId);
      if (operation.conflict?.artifactId)
        operationArtifactIds.add(operation.conflict.artifactId);
      for (const affected of operation.affected) {
        if (affected.type === "artifact") operationArtifactIds.add(affected.id);
      }
      const input =
        operation.input &&
        typeof operation.input === "object" &&
        !Array.isArray(operation.input)
          ? (operation.input as Record<string, unknown>)
          : undefined;
      if (typeof input?.artifactId === "string")
        operationArtifactIds.add(input.artifactId);
    }
    const operationArtifacts = (
      await Promise.all(
        [...operationArtifactIds].map((artifactId) =>
          ctx.db.get(artifactId as Id<"spectraArtifacts">),
        ),
      )
    ).filter((artifact): artifact is Doc<"spectraArtifacts"> =>
      Boolean(artifact),
    );
    const artifacts = [
      ...new Map(
        [...ownedArtifacts, ...operationArtifacts].map((artifact) => [
          artifact._id,
          artifact,
        ]),
      ).values(),
    ];
    const staged = artifacts.filter(
      (artifact) =>
        artifact.aiRunId === args.runId ||
        (artifact.aiEffects ?? []).some(
          (effect) =>
            effect.runId === args.runId &&
            effect.executionId === args.executionId,
        ),
    );
    const now = Date.now();
    const expiresAt = now + AI_EDITED_FLASH_MS;
    const referencedRunIds = [
      ...new Set(
        staged.flatMap((artifact) =>
          (artifact.aiEffects ?? []).map((effect) => effect.runId),
        ),
      ),
    ];
    const referencedRuns = new Map(
      (
        await Promise.all(
          referencedRunIds.map(
            async (runId) => [runId, await ctx.db.get(runId)] as const,
          ),
        )
      ).filter(
        (
          entry,
        ): entry is readonly [Id<"spectraAiRuns">, Doc<"spectraAiRuns">] =>
          Boolean(entry[1]),
      ),
    );
    await Promise.all(
      staged.map((artifact) => {
        const remainingEffects = effectsExcludingRun(
          artifact,
          args.runId,
          args.executionId,
          now,
        ).filter((effect) => {
          if (effect.state === "settling")
            return effect.expiresAt !== undefined && effect.expiresAt > now;
          const effectRun = referencedRuns.get(effect.runId);
          return (
            effectRun?.executionId === effect.executionId &&
            (effectRun.status === "running" ||
              effectRun.status === "awaiting_confirmation" ||
              effectRun.status === "awaiting_resolution")
          );
        });
        const keepCurrentPreview =
          artifact.aiRunId !== args.runId ||
          artifact.aiExecutionId !== args.executionId;
        const latest = remainingEffects.at(-1);
        if (remainingEffects.length) {
          return ctx.db.patch(artifact._id, {
            aiState: "updating",
            aiRunId: latest?.runId,
            aiExecutionId: latest?.executionId,
            aiStateExpiresAt: undefined,
            aiProgress: artifact.aiProgress,
            aiPreview: keepCurrentPreview ? artifact.aiPreview : undefined,
            aiEffects: remainingEffects,
            updatedAt: now,
          });
        }
        if (args.outcome === "failed") {
          return ctx.db.patch(artifact._id, {
            aiState: undefined,
            aiRunId: undefined,
            aiExecutionId: undefined,
            aiStateExpiresAt: undefined,
            aiProgress: undefined,
            aiPreview: undefined,
            aiEffects: undefined,
            updatedAt: now,
          });
        }
        // pausePendingForApproval intentionally removes the visible creating
        // state while retaining the run identity on an unfinalized shell.
        // Do not turn that shell into an "edited" artifact or clear its run
        // identity here: the confirmation continuation needs to reclaim it
        // and write the real content into the same artifact.
        const awaitingApprovalCreate =
          artifact.createdFrom?.runId === args.runId &&
          !artifact.currentVersionId &&
          artifact.aiRunId === args.runId &&
          artifact.aiExecutionId === args.executionId;
        if (awaitingApprovalCreate) {
          return ctx.db.patch(artifact._id, {
            aiState: undefined,
            aiStateExpiresAt: undefined,
            aiProgress: undefined,
            aiPreview: undefined,
            aiEffects: undefined,
            updatedAt: now,
          });
        }
        const settlingEffects = toSettlingEffects(
          effectsForRun(artifact, args.runId, args.executionId, now),
          now,
          expiresAt,
          artifact.aiPreview?.changedPaths,
        );
        return ctx.db.patch(artifact._id, {
          aiState: "edited",
          aiRunId: undefined,
          aiExecutionId: undefined,
          aiStateExpiresAt: expiresAt,
          aiProgress: undefined,
          aiPreview: keepCurrentPreview
            ? artifact.aiPreview
            : previewChangedPathsOnly(artifact.aiPreview),
          aiEffects: settlingEffects.length ? settlingEffects : undefined,
          updatedAt: now,
        });
      }),
    );
    return { settled: staged.length };
  },
});

export const markAiState = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    state: v.union(
      v.literal("updating"),
      v.literal("edited"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor.accountId ||
      run.executionId !== args.executionId ||
      ((artifact.aiRunId !== args.runId ||
        artifact.aiExecutionId !== args.executionId) &&
        !(artifact.aiEffects ?? []).some(
          (effect) =>
            effect.runId === args.runId &&
            effect.executionId === args.executionId,
        ))
    )
      throw new Error("This artifact belongs to a different run attempt.");
    const now = Date.now();
    if (args.state === "updating") {
      await ctx.db.patch(args.artifactId, {
        aiState: "updating",
        aiRunId: args.runId,
        aiExecutionId: args.executionId,
        updatedAt: now,
      });
    } else if (args.state === "edited") {
      const expiresAt = now + AI_EDITED_FLASH_MS;
      const remainingEffects = effectsExcludingRun(
        artifact,
        args.runId,
        args.executionId,
        now,
      );
      const settlingEffects = toSettlingEffects(
        effectsForRun(artifact, args.runId, args.executionId, now),
        now,
        expiresAt,
        artifact.aiPreview?.changedPaths,
      );
      const latest = remainingEffects.at(-1);
      const nextEffects = [...remainingEffects, ...settlingEffects];
      await ctx.db.patch(args.artifactId, {
        aiState: "edited",
        aiRunId: latest?.runId,
        aiExecutionId: latest?.executionId,
        aiStateExpiresAt: expiresAt,
        aiProgress: remainingEffects.length ? artifact.aiProgress : undefined,
        aiPreview:
          artifact.aiRunId === args.runId
            ? previewChangedPathsOnly(artifact.aiPreview)
            : artifact.aiPreview,
        aiEffects: nextEffects.length ? nextEffects : undefined,
        updatedAt: now,
      });
    } else {
      const remainingEffects = effectsExcludingRun(
        artifact,
        args.runId,
        args.executionId,
        now,
      );
      const activeRemaining = remainingEffects.filter(
        (effect) => effect.state === "active",
      );
      const latest = activeRemaining.at(-1) ?? remainingEffects.at(-1);
      await ctx.db.patch(args.artifactId, {
        aiState: activeRemaining.length
          ? "updating"
          : remainingEffects.length
            ? "edited"
            : undefined,
        aiRunId: latest?.runId,
        aiExecutionId: latest?.executionId,
        aiStateExpiresAt: remainingEffects.length
          ? now + AI_EDITED_FLASH_MS
          : undefined,
        aiProgress: activeRemaining.length ? artifact.aiProgress : undefined,
        aiPreview:
          artifact.aiRunId === args.runId ? undefined : artifact.aiPreview,
        // Failed attempts must not leave settling sweeps pulsing on cards.
        aiEffects: remainingEffects.length ? remainingEffects : undefined,
        updatedAt: now,
      });
    }
    return { artifactId: args.artifactId };
  },
});

export const dismissAiEdit = mutation({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.artifactId, "modify");
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      aiState: undefined,
      aiRunId: undefined,
      aiExecutionId: undefined,
      aiStateExpiresAt: undefined,
      aiProgress: undefined,
      aiPreview: undefined,
      aiEffects: undefined,
      updatedAt: now,
    });
    return { artifactId: args.artifactId, dismissed: true as const };
  },
});

export const listVersions = query({
  args: { artifactId: v.id("spectraArtifacts"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { artifact, decision } = await requireArtifactCapability(
      ctx,
      args.artifactId,
    );
    if (artifact.blueprintKey === "quiz" && decision.level === "read")
      return [];
    const allVersions = await ctx.db
      .query("spectraArtifactVersions")
      .withIndex("by_artifact_created", (q) =>
        q.eq("artifactId", args.artifactId),
      )
      .order("asc")
      .collect();
    const limit = Math.max(1, Math.min(args.limit ?? 30, 100));
    const selected = allVersions.slice(-limit).reverse();
    return Promise.all(
      selected.map(async (version) => {
        const [hydrated, creators, run] = await Promise.all([
          hydrateVersionSafely(ctx, version),
          Promise.all(
            (version.creatorAccountIds ?? []).map((accountId) =>
              ctx.db.get(accountId),
            ),
          ),
          version.runId ? ctx.db.get(version.runId) : null,
        ]);
        const projectedHydrated =
          artifact.blueprintKey === "timetable"
            ? {
                ...hydrated,
                ...("before" in hydrated && hydrated.before !== undefined
                  ? { before: projectTimetableSnapshot(hydrated.before) }
                  : {}),
                ...("after" in hydrated && hydrated.after !== undefined
                  ? { after: projectTimetableSnapshot(hydrated.after) }
                  : {}),
              }
            : hydrated;
        return {
          ...projectedHydrated,
          versionNumber:
            allVersions.findIndex(
              (candidate) => candidate._id === version._id,
            ) + 1,
          creators: creators
            .filter((creator): creator is NonNullable<typeof creator> =>
              Boolean(creator),
            )
            .map((creator) => ({
              accountId: creator._id,
              name: creator.name,
              avatarUrl: creator.avatarUrl,
            })),
          run: run
            ? { runId: run._id, finalSummary: run.finalSummary }
            : undefined,
        };
      }),
    );
  },
});

function isProtectedTimetable(artifact: Doc<"spectraArtifacts">) {
  if (artifact.blueprintKey !== "timetable") return false;
  const tags = artifact.tags ?? [];
  return (
    tags.includes("system-timetable") ||
    tags.includes("managebac") ||
    artifact.createdFrom?.contextSummary ===
      "Automatic ManageBac timetable bootstrap" ||
    artifact.createdFrom?.contextSummary === "Personal Spectra timetable"
  );
}

export const archive = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "delete",
    );
    if (isProtectedTimetable(artifact))
      throw new Error(
        "Your Timetable stays in General and cannot be archived.",
      );
    await ctx.db.patch(args.artifactId, {
      status: "archived",
      updatedAt: Date.now(),
    });
    await bumpPolicyVersion(
      ctx,
      artifact.blueprintKey === "agent" ? "agent" : "artifact",
      artifact._id,
      artifact.schoolId,
      actor.accountId,
    );
    return { artifactId: args.artifactId };
  },
});

export const permanentlyDelete = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "delete",
    );
    if (isProtectedTimetable(artifact))
      throw new Error("Your Timetable stays in General and cannot be deleted.");
    await bumpPolicyVersion(
      ctx,
      artifact.blueprintKey === "agent" ? "agent" : "artifact",
      artifact._id,
      artifact.schoolId,
      actor.accountId,
    );
    return scheduleDeletion(ctx, args.artifactId, artifact, actor.accountId);
  },
});

export const artifactStillExists = query({
  args: {
    artifactId: v.string(),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeArtifactId(ctx, args.artifactId);
    if (!normalized) return false;
    const { artifact } = await requireArtifactCapability(ctx, normalized);
    return artifact.status !== "deleted";
  },
});

/** Every user has exactly one personal timetable in General (not workspace-placed). */
export const ensurePersonalTimetable = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSpectraActor(ctx);
    const owned = await ctx.db
      .query("spectraArtifacts")
      .withIndex("by_account_blueprint", (q) =>
        q.eq("ownerAccountId", actor._id).eq("blueprintKey", "timetable"),
      )
      .collect();
    const active = owned
      .filter((artifact) => artifact.status === "active")
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const preferred =
      active.find((artifact) =>
        (artifact.tags ?? []).includes("system-timetable"),
      ) ??
      active.find((artifact) => isProtectedTimetable(artifact)) ??
      active[0];
    if (preferred) {
      const tags = new Set(preferred.tags ?? []);
      tags.add("system-timetable");
      tags.add("general");
      await ctx.db.patch(preferred._id, {
        tags: [...tags],
        updatedAt: Date.now(),
      });
      return { artifactId: preferred._id, created: false };
    }
    const now = Date.now();
    const content = defaultArtifactContent("timetable");
    const title = "Timetable";
    const summary = "Your personal schedule for school, class, and tasks.";
    const tags = ["system-timetable", "general"];
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      blueprintKey: "timetable",
      schemaVersion: defaultArtifactSchemaVersion("timetable"),
      title,
      summary,
      content,
      textIndex: buildArtifactTextIndex({
        title,
        summary,
        content,
        tags,
      }),
      tags,
      status: "active",
      createdFrom: {
        source: "manual",
        contextSummary: "Personal Spectra timetable",
      },
      createdAt: now,
      updatedAt: now,
    });
    return { artifactId, created: true };
  },
});
