import { internal } from "./_generated/api";
import { query } from "./_generated/server";
import { internalMutation, mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import {
  requireWorkspaceCapability,
  requireSpectraActor,
} from "./spectraShared";
import {
  bumpPolicyVersion,
  evaluateAccess,
  evaluateAccessForActor,
  evaluateAccessForActorWithLoadedResource,
  listDirectlyGrantedResourceIds,
} from "./authorityShared";
import type { Doc, Id } from "./_generated/dataModel";
import { incrementOperationalCounter } from "./operationalCounters";
import { normalizeWorkspaceView } from "../shared/workspace-view";
import { workspacePage } from "./catalogPages";
import {
  createFolderNode,
  createLinkNode,
  dissolveWorkspaceNode,
  ensureWorkspaceNode,
  findPrimaryNode,
  isGeneralWorkspace,
  listChildNodes,
  moveNode,
  placeSourceNode,
  purgeSourceNodes,
  relativeFolderPath,
  syncSourceNodes,
  workspaceContextNodes,
} from "./orgTreeShared";

const vDefaultView = v.union(
  v.literal("cards"),
  v.literal("library"),
);

const WORKSPACE_MANIFEST_FORMAT = "spectra-workspace";
const WORKSPACE_MANIFEST_VERSION = 1;
const MAX_WORKSPACE_MANIFEST_BYTES = 750_000;
const MAX_WORKSPACE_MANIFEST_PLACEMENTS = 1_000;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedText(value: unknown, max: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function liveWorkspace<
  T extends {
    title: string;
    description?: string;
    icon?: string;
    color?: string;
    aiState?: string;
    aiStateExpiresAt?: number;
    aiPreview?: {
      title?: string;
      description?: string;
      icon?: string;
      color?: string;
    };
    defaultView: "cards" | "canvas" | "timeline" | "library";
  },
>(workspace: T) {
  const currentWorkspace = {
    ...workspace,
    // Canvas and Timeline were abolished by D30. Historical rows remain
    // readable until the explicit data migration runs, but no current API may
    // project or write those values.
    defaultView: normalizeWorkspaceView(workspace.defaultView),
  };
  if (
    currentWorkspace.aiState === "edited" &&
    currentWorkspace.aiStateExpiresAt &&
    currentWorkspace.aiStateExpiresAt <= Date.now()
  )
    return { ...currentWorkspace, aiState: undefined };
  return currentWorkspace.aiState === "updating" && currentWorkspace.aiPreview
    ? {
        ...currentWorkspace,
        title: currentWorkspace.aiPreview.title ?? currentWorkspace.title,
        description: currentWorkspace.aiPreview.description ?? currentWorkspace.description,
        icon: currentWorkspace.aiPreview.icon ?? currentWorkspace.icon,
        color: currentWorkspace.aiPreview.color ?? currentWorkspace.color,
      }
    : currentWorkspace;
}

export const listPage = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: workspacePage,
});

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 30, 100));
    // Keep archived workspaces out of the active read path at the index
    // level; accounts with a large ManageBac archive should not make Library
    // scan thousands of full workspace records just to find current ones.
    const owned = args.includeArchived
      ? await ctx.db
          .query("spectraWorkspaces")
          .withIndex("by_account_activity", (q) =>
            q.eq("ownerAccountId", actor._id),
          )
          .order("desc")
          .take(Math.max(limit * 2, 60))
      : await ctx.db
          .query("spectraWorkspaces")
          .withIndex("by_account_status_activity", (q) =>
            q.eq("ownerAccountId", actor._id).eq("status", "active"),
          )
          .order("desc")
          .take(Math.max(limit * 8, 240));
    const grantedIds = await listDirectlyGrantedResourceIds(
      ctx,
      actor,
      "workspace",
    );
    const granted = (
      await Promise.all(
        grantedIds.map(async (resourceId) => {
          const id = ctx.db.normalizeId("spectraWorkspaces", resourceId);
          if (!id) return null;
          const decision = await evaluateAccessForActor(ctx, actor, "workspace", id);
          return decision.allowed
            ? (decision.loaded.resource as Doc<"spectraWorkspaces">)
            : null;
        }),
      )
    ).filter((workspace): workspace is Doc<"spectraWorkspaces"> =>
      Boolean(workspace),
    );
    const workspaces = [
      ...new Map(
        [...owned, ...granted].map((workspace) => [workspace._id, workspace]),
      ).values(),
    ];
    const visible = workspaces
      .filter((workspace) => workspace.schoolId === actor.schoolId)
      .filter(
        (workspace) => args.includeArchived || workspace.status === "active",
      )
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, limit);
    return Promise.all(
      visible.map(async (workspace) => {
        const [decision, invitations] = await Promise.all([
          evaluateAccessForActorWithLoadedResource(ctx, actor, "workspace", workspace._id, {
            resource: workspace,
            ownerAccountId: workspace.ownerAccountId,
            schoolId: workspace.schoolId,
            lifecycle: workspace.status,
          }),
          ctx.db
            .query("shareInvitations")
            .withIndex("by_resource", (q) =>
              q.eq("resourceType", "workspace").eq("resourceId", workspace._id),
            )
            .collect(),
        ]);
        const ownership =
          workspace.ownerAccountId === actor.accountId
            ? ("owned" as const)
            : ("shared" as const);
        const activeInvitations = invitations.filter(
          (invitation) =>
            (invitation.status === "pending" ||
              invitation.status === "accepted") &&
            (!invitation.expiresAt || invitation.expiresAt > Date.now()),
        );
        return liveWorkspace({
          ...workspace,
          ownership,
          accessLevel: decision.allowed ? decision.level : null,
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
        });
      }),
    );
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    defaultView: v.optional(vDefaultView),
    parentNodeId: v.optional(v.id("orgNodes")),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const now = Date.now();
    const workspaceId = await ctx.db.insert("spectraWorkspaces", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      title: args.title.trim() || "Untitled workspace",
      description: args.description?.trim() || undefined,
      icon: args.icon?.trim() || "Sparkles",
      color: args.color?.trim() || "cyan",
      status: "active",
      defaultView: args.defaultView ?? "library",
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
    /* A workspace *is* a place in the tree, so it appears there at creation
       rather than on the next read (D32). */
    const workspace = await ctx.db.get(workspaceId);
    if (workspace) {
      const node = await ensureWorkspaceNode(ctx, workspace);
      if (args.parentNodeId !== undefined)
        await moveNode(ctx, node, { parentId: args.parentNodeId });
    }
    await incrementOperationalCounter(ctx, {
      schoolId: actor.schoolId,
      category: "workspace_created",
      dimension: "manual",
      occurredAt: now,
    });
    return workspaceId;
  },
});

export const update = mutation({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    defaultView: v.optional(vDefaultView),
    runId: v.optional(v.id("spectraAiRuns")),
    executionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, workspace: _workspace } = await requireWorkspaceCapability(
      ctx,
      args.workspaceId,
      "modify",
    );
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (
        !run ||
        run.ownerAccountId !== actor.accountId ||
        run.schoolId !== actor.schoolId ||
        run.status !== "running" ||
        !args.executionId ||
        run.executionId !== args.executionId
      )
        throw new Error("AI run not found");
    }
    const patch: {
      title?: string;
      description?: string;
      icon?: string;
      color?: string;
      defaultView?: "cards" | "library";
      updatedAt: number;
      lastActivityAt: number;
      aiState?: "edited";
      aiRunId?: undefined;
      aiExecutionId?: undefined;
      aiPreview?: undefined;
      aiStateExpiresAt?: number;
    } = {
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
      aiState: args.runId ? "edited" : undefined,
      aiRunId: undefined,
      aiExecutionId: undefined,
      aiPreview: undefined,
      aiStateExpiresAt: args.runId ? Date.now() + 8_000 : undefined,
    };
    if (args.title !== undefined)
      patch.title = args.title.trim() || "Untitled workspace";
    if (args.description !== undefined)
      patch.description = args.description.trim() || undefined;
    if (args.icon !== undefined) patch.icon = args.icon.trim() || undefined;
    if (args.color !== undefined) patch.color = args.color.trim() || undefined;
    if (args.defaultView !== undefined) patch.defaultView = args.defaultView;
    await ctx.db.patch(args.workspaceId, patch);
    if (patch.title !== undefined)
      await syncSourceNodes(
        ctx,
        "workspace",
        args.workspaceId,
        patch.title,
      );
    return { workspaceId: args.workspaceId };
  },
});

export const createPending = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
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
    const now = Date.now();
    const workspaceId = await ctx.db.insert("spectraWorkspaces", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      title: args.title.trim() || "New workspace",
      description: args.description?.trim() || "Awaiting your approval",
      icon: args.icon ?? "Sparkles",
      color: args.color ?? "cyan",
      status: "active",
      defaultView: "library",
      aiState: "creating",
      aiRunId: args.runId,
      aiExecutionId: args.executionId,
      aiPending: true,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
    const pending = await ctx.db.get(workspaceId);
    if (pending) await ensureWorkspaceNode(ctx, pending);
    await incrementOperationalCounter(ctx, {
      schoolId: actor.schoolId,
      category: "workspace_created",
      dimension: "ai",
      occurredAt: now,
    });
    return { workspaceId };
  },
});

export const finalizePending = mutation({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceCapability(
      ctx,
      args.workspaceId,
      "modify",
    );
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.executionId !== args.executionId ||
      workspace.aiRunId !== args.runId ||
      workspace.aiExecutionId !== args.executionId ||
      !workspace.aiPending ||
      (workspace.aiState !== "creating" && workspace.aiState !== undefined)
    )
      throw new Error("This pending workspace is no longer available.");
    const now = Date.now();
    await ctx.db.patch(args.workspaceId, {
      title: args.title.trim() || workspace.title,
      description: args.description?.trim() || undefined,
      icon: args.icon ?? workspace.icon,
      color: args.color ?? workspace.color,
      aiState: "edited",
      aiStateExpiresAt: now + 8_000,
      aiRunId: undefined,
      aiExecutionId: undefined,
      aiPending: undefined,
      aiPreview: undefined,
      updatedAt: now,
      lastActivityAt: now,
    });
    await syncSourceNodes(
      ctx,
      "workspace",
      args.workspaceId,
      args.title.trim() || workspace.title,
    );
    return { workspaceId: args.workspaceId };
  },
});

export const pauseForApproval = mutation({
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
    const rows = await ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_account_activity", (q) =>
        q.eq("ownerAccountId", actor._id),
      )
      .collect();
    const pending = rows.filter(
      (workspace) =>
        workspace.schoolId === actor.schoolId &&
        workspace.aiRunId === args.runId &&
        workspace.aiExecutionId === args.executionId &&
        workspace.aiPending,
    );
    const staged = rows.filter(
      (workspace) =>
        workspace.schoolId === actor.schoolId &&
        workspace.aiRunId === args.runId &&
        workspace.aiExecutionId === args.executionId &&
        !workspace.aiPending,
    );
    const now = Date.now();
    await Promise.all([
      ...pending.map((workspace) =>
        ctx.db.patch(workspace._id, {
          aiState: undefined,
          aiPreview: undefined,
          description: "Proposed workspace awaiting your approval.",
          updatedAt: now,
        }),
      ),
      ...staged.map((workspace) =>
        ctx.db.patch(workspace._id, {
          aiState: undefined,
          aiRunId: undefined,
          aiExecutionId: undefined,
          aiPreview: undefined,
          updatedAt: now,
        }),
      ),
    ]);
    return { pending: pending.length, staged: staged.length };
  },
});

export const resumePending = mutation({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, workspace } = await requireWorkspaceCapability(
      ctx,
      args.workspaceId,
      "modify",
    );
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor.accountId ||
      run.schoolId !== actor.schoolId ||
      run.status !== "running" ||
      run.executionId !== args.executionId ||
      workspace.aiRunId !== args.runId ||
      workspace.aiExecutionId !== args.executionId ||
      !workspace.aiPending
    )
      throw new Error("This pending workspace can no longer resume.");
    await ctx.db.patch(workspace._id, {
      aiState: "creating",
      updatedAt: Date.now(),
    });
    return { workspaceId: workspace._id };
  },
});

export const stageAiPatch = mutation({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, workspace: _workspace } = await requireWorkspaceCapability(
      ctx,
      args.workspaceId,
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
      throw new Error("AI run not found");
    await ctx.db.patch(args.workspaceId, {
      aiState: "updating",
      aiRunId: args.runId,
      aiExecutionId: args.executionId,
      aiPreview: {
        title: args.title,
        description: args.description,
        icon: args.icon,
        color: args.color,
        startedAt: Date.now(),
      },
      updatedAt: Date.now(),
    });
    return { workspaceId: args.workspaceId };
  },
});

export const settleForRun = mutation({
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
    const rows = await ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_account_activity", (q) =>
        q.eq("ownerAccountId", actor._id),
      )
      .collect();
    const affected = rows.filter(
      (workspace) =>
        workspace.schoolId === actor.schoolId &&
        workspace.aiRunId === args.runId &&
        workspace.aiExecutionId === args.executionId,
    );
    const now = Date.now();
    for (const workspace of affected) {
      if (workspace.aiPending) {
        await ctx.db.delete(workspace._id);
      } else
        await ctx.db.patch(workspace._id, {
          aiState: undefined,
          aiRunId: undefined,
          aiExecutionId: undefined,
          aiPreview: undefined,
          updatedAt: now,
        });
    }
    return { settled: affected.length };
  },
});

export const archive = mutation({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
  },
  handler: async (ctx, args) => {
    const { actor, workspace } = await requireWorkspaceCapability(
      ctx,
      args.workspaceId,
      "delete",
    );
    /* General is the floor everything falls back to; archiving it would leave
       work with nowhere to be (D31). Its node stays in the tree either way, so
       archiving another workspace never orphans what is inside it. */
    if (isGeneralWorkspace(workspace))
      throw new Error(
        "General cannot be archived — it is where work with no other home lives.",
      );
    await ctx.db.patch(args.workspaceId, {
      status: "archived",
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    await bumpPolicyVersion(
      ctx,
      "workspace",
      workspace._id,
      workspace.schoolId,
      actor.accountId,
    );
    return { workspaceId: args.workspaceId };
  },
});

export const permanentlyDelete = mutation({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, workspace } = await requireWorkspaceCapability(
      ctx,
      args.workspaceId,
      "delete",
      { allowPermanentDelete: true },
    );
    if (isGeneralWorkspace(workspace))
      throw new Error(
        "General cannot be deleted — it is where work with no other home lives.",
      );
    const expected = `Remove ${workspace.title} permanently`;
    if (args.confirmation !== expected)
      throw new Error(`Type “${expected}” to confirm`);

    if (workspace.permanentDeleteJobId) {
      const existingJob = await ctx.db.get(workspace.permanentDeleteJobId);
      if (existingJob && existingJob.phase !== "complete") {
        await ctx.scheduler.runAfter(
          0,
          internal.spectraWorkspaces.continuePermanentDelete,
          { workspaceId: workspace._id, jobId: existingJob._id },
        );
        return {
          workspaceId: workspace._id,
          jobId: existingJob._id,
          status: "in_progress" as const,
        };
      }
    }

    const now = Date.now();
    const jobId = await ctx.db.insert("workspaceDeletionJobs", {
      workspaceId: workspace._id,
      ownerAccountId: workspace.ownerAccountId,
      schoolId: workspace.schoolId,
      requestedByAccountId: actor.accountId,
      phase: "detach_artifact_metadata",
      movedChildCount: 0,
      detachedArtifactCount: 0,
      detachedThreadCount: 0,
      detachedRunCount: 0,
      deletedEvidenceCount: 0,
      expiredClaimCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(workspace._id, {
      permanentDeleteJobId: jobId,
      updatedAt: now,
    });
    await bumpPolicyVersion(
      ctx,
      "workspace",
      workspace._id,
      workspace.schoolId,
      actor.accountId,
    );
    await ctx.scheduler.runAfter(
      0,
      internal.spectraWorkspaces.continuePermanentDelete,
      { workspaceId: workspace._id, jobId },
    );
    return {
      workspaceId: workspace._id,
      jobId,
      status: "in_progress" as const,
    };
  },
});

const WORKSPACE_DELETE_PAGE = 20;

export const continuePermanentDelete = internalMutation({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    jobId: v.id("workspaceDeletionJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.workspaceId !== args.workspaceId ||
      job.phase === "complete"
    )
      return;
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      await ctx.db.patch(job._id, {
        phase: "complete",
        cursor: undefined,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return;
    }
    if (workspace.permanentDeleteJobId !== job._id) return;

    const now = Date.now();
    let completed = false;
    if (job.phase === "detach_artifact_metadata") {
      const page = await ctx.db
        .query("orgNodes")
        .withIndex("by_workspace_context", (q) =>
          q.eq("workspaceContextId", workspace._id),
        )
        .paginate({ numItems: WORKSPACE_DELETE_PAGE, cursor: job.cursor ?? null });
      let detached = 0;
      for (const node of page.page) {
        if (node.kind !== "work" || !node.sourceId) continue;
        const artifactId = ctx.db.normalizeId("spectraArtifacts", node.sourceId);
        const artifact = artifactId ? await ctx.db.get(artifactId) : null;
        if (artifact?.createdFrom?.workspaceId !== workspace._id) continue;
        await ctx.db.patch(artifact._id, {
          createdFrom: { ...artifact.createdFrom, workspaceId: undefined },
        });
        detached += 1;
      }
      await ctx.db.patch(job._id, {
        phase: page.isDone ? "move_children" : job.phase,
        cursor: page.isDone ? undefined : page.continueCursor,
        detachedArtifactCount: job.detachedArtifactCount + detached,
        updatedAt: now,
      });
    } else if (job.phase === "move_children") {
      const dissolved = await dissolveWorkspaceNode(ctx, workspace, {
        limit: DISSOLVE_CHILD_BATCH,
        preserveWorkspaceNode: true,
        allowDeletingWorkspace: true,
      });
      await ctx.db.patch(job._id, {
        phase: dissolved.remaining > 0 ? job.phase : "detach_threads",
        cursor: undefined,
        movedChildCount: job.movedChildCount + dissolved.moved,
        updatedAt: now,
      });
    } else if (job.phase === "detach_threads") {
      const rows = await ctx.db
        .query("spectraThreads")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .take(WORKSPACE_DELETE_PAGE);
      for (const thread of rows)
        await ctx.db.patch(thread._id, {
          workspaceId: undefined,
          updatedAt: now,
          readSchemaVersion: 1,
        });
      await ctx.db.patch(job._id, {
        phase: rows.length < WORKSPACE_DELETE_PAGE ? "detach_runs" : job.phase,
        detachedThreadCount: job.detachedThreadCount + rows.length,
        updatedAt: now,
      });
    } else if (job.phase === "detach_runs") {
      const rows = await ctx.db
        .query("spectraAiRuns")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .take(WORKSPACE_DELETE_PAGE);
      for (const run of rows)
        await ctx.db.patch(run._id, { workspaceId: undefined, updatedAt: now });
      await ctx.db.patch(job._id, {
        phase:
          rows.length < WORKSPACE_DELETE_PAGE
            ? "delete_memory_evidence"
            : job.phase,
        detachedRunCount: job.detachedRunCount + rows.length,
        updatedAt: now,
      });
    } else if (job.phase === "delete_memory_evidence") {
      const page = await ctx.db
        .query("memoryEvidence")
        .withIndex("by_source", (q) =>
          q.eq("sourceType", "workspace").eq("sourceId", String(workspace._id)),
        )
        .paginate({ numItems: WORKSPACE_DELETE_PAGE, cursor: job.cursor ?? null });
      for (const evidence of page.page)
        await ctx.db.patch(evidence._id, {
          accessStatus: "deleted",
          excerptPreview: undefined,
        });
      await ctx.db.patch(job._id, {
        phase: page.isDone ? "expire_memory_claims" : job.phase,
        cursor: page.isDone ? undefined : page.continueCursor,
        deletedEvidenceCount: job.deletedEvidenceCount + page.page.length,
        updatedAt: now,
      });
    } else if (job.phase === "expire_memory_claims") {
      const rows = await ctx.db
        .query("memoryClaims")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", workspace._id).eq("status", "active"),
        )
        .take(WORKSPACE_DELETE_PAGE);
      for (const claim of rows)
        await ctx.db.patch(claim._id, {
          status: "expired",
          expiresAt: now,
          updatedAt: now,
        });
      await ctx.db.patch(job._id, {
        phase: rows.length < WORKSPACE_DELETE_PAGE ? "finalize" : job.phase,
        expiredClaimCount: job.expiredClaimCount + rows.length,
        updatedAt: now,
      });
    } else if (job.phase === "finalize") {
      const workspaceNode = await findPrimaryNode(
        ctx,
        workspace.ownerAccountId,
        "workspace",
        workspace._id,
      );
      const remainingChildren = workspaceNode
        ? await listChildNodes(ctx, workspaceNode.accountId, workspaceNode._id, {
            includeTrashed: true,
            limit: 1,
          })
        : [];
      if (remainingChildren.length > 0) {
        await ctx.db.patch(job._id, {
          phase: "move_children",
          cursor: undefined,
          updatedAt: now,
        });
      } else {
        await purgeSourceNodes(ctx, "workspace", workspace._id);
        await ctx.db.delete(workspace._id);
        await ctx.db.patch(job._id, {
          phase: "complete",
          cursor: undefined,
          completedAt: now,
          updatedAt: now,
        });
        completed = true;
      }
    }

    if (!completed)
      await ctx.scheduler.runAfter(
        0,
        internal.spectraWorkspaces.continuePermanentDelete,
        args,
      );
  },
});

export const exportPortableManifest = query({
  args: { workspaceId: v.id("spectraWorkspaces") },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceCapability(
      ctx,
      args.workspaceId,
      "read",
    );
    const contents = await workspaceContextNodes(ctx, workspace._id);
    const items = contents.filter(
      (node) => node.kind === "work" || node.kind === "thread",
    );
    const placements: Array<Record<string, unknown>> = [];
    const unsupported = new Set<string>();
    let inaccessible = 0;

    for (const item of items.slice(0, MAX_WORKSPACE_MANIFEST_PLACEMENTS)) {
      if (item.kind !== "work" || !item.sourceId) {
        unsupported.add(item.kind);
        continue;
      }
      const artifactId = ctx.db.normalizeId("spectraArtifacts", item.sourceId);
      if (!artifactId) {
        inaccessible += 1;
        continue;
      }
      const access = await evaluateAccess(ctx, "artifact", artifactId);
      if (!access.allowed || !access.capabilities.includes("read")) {
        inaccessible += 1;
        continue;
      }
      const artifact = access.loaded.resource as Doc<"spectraArtifacts">;
      placements.push({
        artifactId: String(artifact._id),
        title: artifact.title,
        blueprintKey: artifact.blueprintKey,
        /* The folders a reader built are part of the workspace, so they travel
           with it. An older importer ignores this field harmlessly. */
        path: await relativeFolderPath(ctx, item),
        pinned: item.pinned === true,
      });
    }

    const warnings = [
      ...(items.length > MAX_WORKSPACE_MANIFEST_PLACEMENTS
        ? [
            `Only the first ${MAX_WORKSPACE_MANIFEST_PLACEMENTS} placements were exported.`,
          ]
        : []),
      ...(inaccessible
        ? [
            `${inaccessible} inaccessible or stale artifact reference${inaccessible === 1 ? " was" : "s were"} omitted.`,
          ]
        : []),
    ];
    return {
      manifest: {
        format: WORKSPACE_MANIFEST_FORMAT,
        version: WORKSPACE_MANIFEST_VERSION,
        exportedAt: Date.now(),
        workspace: {
          title: workspace.title,
          description: workspace.description,
          icon: workspace.icon,
          color: workspace.color,
          defaultView: workspace.defaultView,
        },
        placements,
      },
      report: {
        exported: placements.length,
        omitted: inaccessible,
        unsupported: Array.from(unsupported),
        warnings,
      },
    };
  },
});

export const importPortableManifest = mutation({
  args: {
    fileName: v.string(),
    sha256: v.string(),
    manifest: v.any(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const now = Date.now();
    const fileName = args.fileName.trim().slice(0, 220) || "workspace.json";
    const sha256 = args.sha256.toLowerCase();
    const root = recordValue(args.manifest);
    const workspaceValue = recordValue(root?.workspace);
    const placementsValue = Array.isArray(root?.placements)
      ? root.placements
      : null;
    let byteLength = MAX_WORKSPACE_MANIFEST_BYTES + 1;
    try {
      byteLength = new TextEncoder().encode(
        JSON.stringify(args.manifest),
      ).length;
    } catch {
      // The quarantine record below deliberately keeps only a compact reason.
    }
    const quarantineReason = !/^[a-f0-9]{64}$/.test(sha256)
      ? "The file fingerprint is invalid."
      : byteLength > MAX_WORKSPACE_MANIFEST_BYTES
        ? "The workspace manifest is larger than 750 KB."
        : root?.format !== WORKSPACE_MANIFEST_FORMAT
          ? "This is not a Spectra workspace manifest."
          : root?.version !== WORKSPACE_MANIFEST_VERSION
            ? "This workspace manifest version is not supported."
            : !workspaceValue || !placementsValue
              ? "The workspace manifest is incomplete."
              : placementsValue.length > MAX_WORKSPACE_MANIFEST_PLACEMENTS
                ? `A workspace manifest may contain at most ${MAX_WORKSPACE_MANIFEST_PLACEMENTS} placements.`
                : undefined;

    if (quarantineReason) {
      const jobId = await ctx.db.insert("workspaceImportJobs", {
        schoolId: actor.schoolId,
        accountId: actor._id,
        fileName,
        sha256,
        status: "quarantined",
        formatVersion:
          typeof root?.version === "number" ? root.version : undefined,
        originalManifest:
          byteLength <= MAX_WORKSPACE_MANIFEST_BYTES
            ? args.manifest
            : undefined,
        report: {
          placed: 0,
          skipped: placementsValue?.length ?? 0,
          unsupported: [],
          warnings: [quarantineReason],
        },
        createdAt: now,
        completedAt: now,
      });
      return {
        status: "quarantined" as const,
        jobId,
        reason: quarantineReason,
      };
    }

    // Every null shape returns through quarantine above. These aliases make
    // that validation boundary explicit to TypeScript and future readers.
    const safeWorkspace = workspaceValue as Record<string, unknown>;
    const safePlacements = placementsValue as unknown[];

    const title = boundedText(safeWorkspace.title, 160) ?? "Imported workspace";
    const defaultView = normalizeWorkspaceView(safeWorkspace.defaultView);
    const workspaceId = await ctx.db.insert("spectraWorkspaces", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      title,
      description: boundedText(safeWorkspace.description, 2_000),
      icon: boundedText(safeWorkspace.icon, 48) ?? "Sparkles",
      color: boundedText(safeWorkspace.color, 48) ?? "cyan",
      status: "active",
      defaultView,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });

    const imported = await ctx.db.get(workspaceId);
    const workspaceNode = imported
      ? await ensureWorkspaceNode(ctx, imported)
      : null;

    let placed = 0;
    let skipped = 0;
    let referenced = 0;
    const unsupported = new Set<string>();
    const warnings: string[] = [];
    const seen = new Set<string>();
    /* Folders are rebuilt once per distinct path, so a repeated path reuses the
       folder already made instead of stacking duplicates. */
    const folders = new Map<string, Id<"orgNodes"> | null>();
    const folderFor = async (raw: unknown) => {
      if (!workspaceNode) return null;
      const segments = (Array.isArray(raw) ? raw : [])
        .map((part) => boundedText(part, 200))
        .filter((part): part is string => Boolean(part))
        .slice(0, 8);
      let parentId: Id<"orgNodes"> | null = workspaceNode._id;
      let key = "";
      for (const segment of segments) {
        key = key ? key + "/" + segment : segment;
        const known = folders.get(key);
        if (known !== undefined) {
          parentId = known;
          continue;
        }
        const siblings = await listChildNodes(ctx, actor._id, parentId);
        const existing = siblings.find(
          (row) => row.kind === "folder" && row.name === segment,
        );
        let next: Id<"orgNodes"> | null;
        try {
          next = existing
            ? existing._id
            : (
                await createFolderNode(ctx, {
                  accountId: actor._id,
                  schoolId: actor.schoolId,
                  name: segment,
                  parentId,
                })
              )._id;
        } catch {
          /* An unusable folder name must not cost the reader the artifact, so
             the item lands at the workspace root instead. */
          next = parentId;
        }
        folders.set(key, next);
        parentId = next;
      }
      return parentId;
    };
    for (const rawPlacement of safePlacements) {
      const placement = recordValue(rawPlacement);
      const artifactIdText = boundedText(placement?.artifactId, 100);
      if (!artifactIdText || seen.has(artifactIdText)) {
        skipped += 1;
        continue;
      }
      seen.add(artifactIdText);
      const artifactId = ctx.db.normalizeId("spectraArtifacts", artifactIdText);
      if (!artifactId) {
        skipped += 1;
        continue;
      }
      const access = await evaluateAccess(ctx, "artifact", artifactId);
      if (!access.allowed || !access.capabilities.includes("read")) {
        skipped += 1;
        continue;
      }
      const artifact = access.loaded.resource as Doc<"spectraArtifacts">;
      if (artifact.schoolId !== actor.schoolId) {
        skipped += 1;
        continue;
      }
      const sourceType = boundedText(placement?.sourceType, 32);
      if (sourceType && sourceType !== "artifact") unsupported.add(sourceType);
      const parentId = await folderFor(placement?.path);
      /* An artifact already filed somewhere keeps that home: an import adds a
         place to find it, it never moves a reader's work (I1, D30). */
      const existingNode = await findPrimaryNode(
        ctx,
        actor._id,
        "work",
        artifact._id,
      );
      if (existingNode && existingNode.deletedAt === undefined) {
        await createLinkNode(ctx, {
          accountId: actor._id,
          schoolId: actor.schoolId,
          targetNodeId: existingNode._id,
          parentId,
        });
        referenced += 1;
      } else
        await placeSourceNode(ctx, {
          accountId: actor._id,
          schoolId: actor.schoolId,
          kind: "work",
          sourceId: artifact._id,
          name: artifact.title,
          target: { parentId },
          placedByAccountId: actor._id,
          pinned: placement?.pinned === true ? true : undefined,
        });
      placed += 1;
    }
    if (referenced)
      warnings.push(
        referenced === 1
          ? "1 artifact was added as a reference because it is already filed elsewhere."
          : referenced +
              " artifacts were added as references because they are already filed elsewhere.",
      );
    if (skipped)
      warnings.push(
        `${skipped} inaccessible, stale, duplicate, or malformed artifact reference${skipped === 1 ? " was" : "s were"} skipped.`,
      );
    const jobId = await ctx.db.insert("workspaceImportJobs", {
      schoolId: actor.schoolId,
      accountId: actor._id,
      fileName,
      sha256,
      status: "imported",
      formatVersion: WORKSPACE_MANIFEST_VERSION,
      originalManifest: args.manifest,
      workspaceId,
      report: {
        placed,
        skipped,
        unsupported: Array.from(unsupported),
        warnings,
      },
      createdAt: now,
      completedAt: Date.now(),
    });
    await incrementOperationalCounter(ctx, {
      schoolId: actor.schoolId,
      category: "workspace_imported",
      dimension: skipped ? "partial" : "complete",
      occurredAt: now,
    });
    return {
      status: "imported" as const,
      jobId,
      workspaceId,
      report: {
        placed,
        skipped,
        unsupported: Array.from(unsupported),
        warnings,
      },
    };
  },
});
