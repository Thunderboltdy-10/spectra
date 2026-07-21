import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  requireWorkspaceCapability,
  requireSpectraActor,
} from "./spectraShared";
import {
  bumpPolicyVersion,
  evaluateAccess,
  listDirectlyGrantedResourceIds,
} from "./authorityShared";
import type { Doc } from "./_generated/dataModel";
import { incrementOperationalCounter } from "./operationalCounters";

const vDefaultView = v.union(
  v.literal("cards"),
  v.literal("canvas"),
  v.literal("timeline"),
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

function finiteNumber(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;
}

function sanitizeViewData(value: unknown) {
  const data = recordValue(value);
  return {
    titleOverride: boundedText(data?.titleOverride, 160),
    compactSummary: boundedText(data?.compactSummary, 500),
    cardVariant: boundedText(data?.cardVariant, 48),
    pinned: typeof data?.pinned === "boolean" ? data.pinned : undefined,
    hidden: typeof data?.hidden === "boolean" ? data.hidden : undefined,
  };
}

function sanitizeLayout(value: unknown): {
  view: "cards" | "canvas" | "timeline";
  position?: { x: number; y: number };
  size?: { w: number; h: number };
  zIndex?: number;
  collapsed?: boolean;
} {
  const layout = recordValue(value);
  const position = recordValue(layout?.position);
  const size = recordValue(layout?.size);
  const view =
    layout?.view === "canvas" || layout?.view === "timeline"
      ? layout.view
      : "cards";
  const x = finiteNumber(position?.x, -1_000_000, 1_000_000);
  const y = finiteNumber(position?.y, -1_000_000, 1_000_000);
  const w = finiteNumber(size?.w, 80, 10_000);
  const h = finiteNumber(size?.h, 60, 10_000);
  return {
    view,
    position: x !== undefined && y !== undefined ? { x, y } : undefined,
    size: w !== undefined && h !== undefined ? { w, h } : undefined,
    zIndex: finiteNumber(layout?.zIndex, -100_000, 100_000),
    collapsed:
      typeof layout?.collapsed === "boolean" ? layout.collapsed : undefined,
  };
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
  },
>(workspace: T) {
  if (
    workspace.aiState === "edited" &&
    workspace.aiStateExpiresAt &&
    workspace.aiStateExpiresAt <= Date.now()
  )
    return { ...workspace, aiState: undefined };
  return workspace.aiState === "updating" && workspace.aiPreview
    ? {
        ...workspace,
        title: workspace.aiPreview.title ?? workspace.title,
        description: workspace.aiPreview.description ?? workspace.description,
        icon: workspace.aiPreview.icon ?? workspace.icon,
        color: workspace.aiPreview.color ?? workspace.color,
      }
    : workspace;
}

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 30, 100));
    const owned = await ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_account_activity", (q) =>
        q.eq("ownerAccountId", actor._id),
      )
      .order("desc")
      .take(limit * 2);
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
          const decision = await evaluateAccess(ctx, "workspace", id);
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
          evaluateAccess(ctx, "workspace", workspace._id),
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
    const { actor, workspace } = await requireWorkspaceCapability(
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
      defaultView?: "cards" | "canvas" | "timeline" | "library";
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
    );
    const expected = `Remove ${workspace.title} permanently`;
    if (args.confirmation !== expected)
      throw new Error(`Type “${expected}” to confirm`);

    await bumpPolicyVersion(
      ctx,
      "workspace",
      workspace._id,
      workspace.schoolId,
      actor.accountId,
    );

    const items = await ctx.db
      .query("spectraWorkspaceItems")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const artifactIds = Array.from(
      new Set(
        items
          .filter((item) => item.sourceType === "artifact")
          .map((item) => item.sourceId),
      ),
    );

    // Workspaces organize artifacts; they never own their content. Removing a
    // workspace therefore detaches placements and provenance instead of
    // cascading into artifacts, history, links, AI runs, or collaborators'
    // work. Unplaced owned artifacts naturally return to Inbox.
    for (const sourceId of artifactIds) {
      const artifact = ctx.db.normalizeId("spectraArtifacts", sourceId);
      if (artifact) {
        const document = await ctx.db.get(artifact);
        if (document?.createdFrom?.workspaceId === args.workspaceId) {
          await ctx.db.patch(artifact, {
            createdFrom: { ...document.createdFrom, workspaceId: undefined },
          });
        }
      }
    }

    await Promise.all(
      items.map(async (item) => {
        const current = await ctx.db.get(item._id);
        if (current) await ctx.db.delete(item._id);
      }),
    );

    const [threads, runs] = await Promise.all([
      ctx.db
        .query("spectraThreads")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect(),
      ctx.db
        .query("spectraAiRuns")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect(),
    ]);
    await Promise.all([
      ...threads.map((thread) =>
        ctx.db.patch(thread._id, {
          workspaceId: undefined,
          updatedAt: Date.now(),
        }),
      ),
      ...runs.map((run) =>
        ctx.db.patch(run._id, {
          workspaceId: undefined,
          updatedAt: Date.now(),
        }),
      ),
    ]);

    const [memoryEvidence, workspaceClaims] = await Promise.all([
      ctx.db
        .query("memoryEvidence")
        .withIndex("by_source", (q) =>
          q.eq("sourceType", "workspace").eq("sourceId", args.workspaceId),
        )
        .collect(),
      ctx.db
        .query("memoryClaims")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("status", "active"),
        )
        .collect(),
    ]);
    const memoryChangedAt = Date.now();
    for (const evidence of memoryEvidence)
      await ctx.db.patch(evidence._id, {
        accessStatus: "deleted",
        excerptPreview: undefined,
      });
    for (const claim of workspaceClaims)
      await ctx.db.patch(claim._id, {
        status: "expired",
        expiresAt: memoryChangedAt,
        updatedAt: memoryChangedAt,
      });

    await ctx.db.delete(args.workspaceId);
    return {
      workspaceId: args.workspaceId,
      detachedArtifactCount: artifactIds.length,
      detachedThreadCount: threads.length,
      preservedRunCount: runs.length,
    };
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
    const items = await ctx.db
      .query("spectraWorkspaceItems")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const placements: Array<Record<string, unknown>> = [];
    const unsupported = new Set<string>();
    let inaccessible = 0;

    for (const item of items.slice(0, MAX_WORKSPACE_MANIFEST_PLACEMENTS)) {
      if (item.sourceType !== "artifact") {
        unsupported.add(item.sourceType);
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
        viewData: sanitizeViewData(item.viewData),
        layout: sanitizeLayout(item.layout),
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
    const defaultView =
      safeWorkspace.defaultView === "cards" ||
      safeWorkspace.defaultView === "canvas" ||
      safeWorkspace.defaultView === "timeline"
        ? safeWorkspace.defaultView
        : "library";
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

    let placed = 0;
    let skipped = 0;
    const unsupported = new Set<string>();
    const warnings: string[] = [];
    const seen = new Set<string>();
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
      await ctx.db.insert("spectraWorkspaceItems", {
        workspaceId,
        sourceType: "artifact",
        sourceId: String(artifact._id),
        placedByAccountId: actor._id,
        accessProjection: false,
        viewData: sanitizeViewData(placement?.viewData),
        layout: sanitizeLayout(placement?.layout),
        createdAt: now,
        updatedAt: now,
      });
      placed += 1;
    }
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
