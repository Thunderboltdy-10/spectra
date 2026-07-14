import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  buildArtifactTextIndex,
  defaultArtifactContent,
  fallbackArtifactSummary,
  normalizeArtifactId,
  requireArtifactCapability,
  requireWorkspaceCapability,
  requireSpectraActor,
  vArtifactStatus,
  vBlueprintKey,
  vCreatedFromSource,
  type BlueprintKey,
} from "./spectraShared";
import { evaluateAccess, listDirectlyGrantedResourceIds } from "./authorityShared";
import { hydrateVersion, releaseSnapshotObject, retainSnapshotObject, type SnapshotStrategy } from "./artifactSnapshots";

function versionSnapshotStrategy(typeKey: string): SnapshotStrategy {
  return ["presentation", "sheets", "code", "whiteboard"].includes(typeKey) ? "content_addressed" : "normalized";
}

async function versionSnapshotFields(ctx: MutationCtx, schoolId: Id<"schools"> | undefined, typeKey: string, before: unknown, after: unknown) {
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

async function listPlacementsForArtifact(ctx: Parameters<typeof requireSpectraActor>[0], artifactId: Id<"spectraArtifacts">) {
  const items = await ctx.db
    .query("spectraWorkspaceItems")
    .withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", artifactId))
    .collect();

  const visibleItems = items.filter((item) => item.viewData.hidden !== true);
  const placements = await Promise.all(
    visibleItems.map(async (item) => {
      const decision = await evaluateAccess(ctx, "workspace", item.workspaceId);
      const workspace = decision.allowed ? decision.loaded.resource : null;
      if (!workspace || workspace.status !== "active") return null;
      return {
        workspaceId: workspace._id,
        workspaceTitle: workspace.title,
        workspaceItemId: item._id,
        pinned: item.viewData.pinned === true,
      };
    }),
  );
  return placements.filter((placement): placement is NonNullable<typeof placement> => Boolean(placement));
}

export const list = query({
  args: {
    status: v.optional(vArtifactStatus),
    blueprintKey: v.optional(vBlueprintKey),
    placement: v.optional(v.union(v.literal("all"), v.literal("inbox"), v.literal("shared"), v.literal("workspace"))),
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
        .query("spectraArtifacts")
        .withIndex("by_account_blueprint", (q) => q.eq("ownerAccountId", actor._id).eq("blueprintKey", blueprintKey))
        .order("desc")
        .take(limit * 3)
      : await ctx.db
        .query("spectraArtifacts")
        .withIndex("by_account_status_updated", (q) => q.eq("ownerAccountId", actor._id).eq("status", baseStatus))
        .order("desc")
        .take(limit * 3);

    const [artifactGrantIds, agentGrantIds] = await Promise.all([
      listDirectlyGrantedResourceIds(ctx, actor, "artifact"),
      listDirectlyGrantedResourceIds(ctx, actor, "agent"),
    ]);
    const granted = (await Promise.all([...new Set([...artifactGrantIds, ...agentGrantIds])].map(async (resourceId) => {
      const id = ctx.db.normalizeId("spectraArtifacts", resourceId);
      if (!id) return null;
      const candidate = await ctx.db.get(id);
      if (!candidate) return null;
      const resourceType = candidate.blueprintKey === "agent" ? "agent" : "artifact";
      const decision = await evaluateAccess(ctx, resourceType, id);
      return decision.allowed ? decision.loaded.resource as Doc<"spectraArtifacts"> : null;
    }))).filter((artifact): artifact is Doc<"spectraArtifacts"> => Boolean(artifact));
    const rows = [...new Map([...owned, ...granted].map((artifact) => [artifact._id, artifact])).values()];

    const needle = args.search?.trim().toLowerCase();
    const ownedWorkspaces = await ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_account_status", (q) => q.eq("ownerAccountId", actor._id).eq("status", "active"))
      .collect();
    const workspaceGrantIds = await listDirectlyGrantedResourceIds(ctx, actor, "workspace");
    const grantedWorkspaces = (await Promise.all(workspaceGrantIds.map(async (resourceId) => {
      const id = ctx.db.normalizeId("spectraWorkspaces", resourceId);
      if (!id) return null;
      const decision = await evaluateAccess(ctx, "workspace", id);
      const workspace = decision.allowed ? decision.loaded.resource as Doc<"spectraWorkspaces"> : null;
      return workspace?.status === "active" ? workspace : null;
    }))).filter((workspace): workspace is Doc<"spectraWorkspaces"> => Boolean(workspace));
    const activeWorkspaces = [...new Map([...ownedWorkspaces, ...grantedWorkspaces].map((workspace) => [workspace._id, workspace])).values()];
    const placementRows = (await Promise.all(activeWorkspaces
      .filter((workspace) => workspace.schoolId === actor.schoolId)
      .map(async (workspace) => ({
        workspace,
        items: await ctx.db.query("spectraWorkspaceItems").withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id)).collect(),
      })))).flatMap(({ workspace, items }) => items
        .filter((item) => item.sourceType === "artifact" && item.viewData.hidden !== true)
        .map((item) => ({ sourceId: item.sourceId, workspaceId: workspace._id, workspaceTitle: workspace.title, workspaceItemId: item._id, pinned: item.viewData.pinned === true })));
    const placementsByArtifact = new Map<string, typeof placementRows>();
    for (const placement of placementRows) placementsByArtifact.set(placement.sourceId, [...(placementsByArtifact.get(placement.sourceId) ?? []), placement]);

    const candidateArtifacts = rows
        .filter((artifact) => artifact.schoolId === actor.schoolId)
        .filter((artifact) => artifact.blueprintKey !== "thread_reference")
        .filter((artifact) => artifact.status === baseStatus)
        .filter((artifact) => !needle || `${artifact.title}\n${artifact.summary ?? ""}\n${artifact.blueprintKey}\n${artifact.textIndex ?? ""}\n${(placementsByArtifact.get(artifact._id) ?? []).map((placement) => placement.workspaceTitle).join("\n")}`.toLowerCase().includes(needle));

    const artifacts = await Promise.all(candidateArtifacts.map(async (artifact) => {
      const placements = placementsByArtifact.get(artifact._id) ?? [];
      const ownership = artifact.ownerAccountId === actor.accountId ? "owned" as const : "shared" as const;
      const resourceType = artifact.blueprintKey === "agent" ? "agent" as const : "artifact" as const;
      const [decision, invitations] = await Promise.all([
        evaluateAccess(ctx, resourceType, artifact._id),
        ctx.db.query("shareInvitations").withIndex("by_resource", (q) => q.eq("resourceType", resourceType).eq("resourceId", artifact._id)).collect(),
      ]);
      const activeInvitations = invitations.filter((invitation) => (invitation.status === "pending" || invitation.status === "accepted") && (!invitation.expiresAt || invitation.expiresAt > Date.now()));
      return {
        ...artifact,
        placements,
        ownership,
        accessLevel: decision.allowed ? decision.level : null,
        accessReason: decision.reason,
        isShared: ownership === "shared" || activeInvitations.length > 0,
        sharedWithCount: ownership === "owned" ? new Set(activeInvitations.map((invitation) => invitation.inviteeAccountId)).size : undefined,
        // Shared is the recipient's accepted-but-not-yet-organized landing
        // state. Once placed, it behaves like any normal workspace artifact,
        // while `ownership` keeps it discoverable in the Shared collection.
        placementStatus: placements.length > 0 ? "workspace" as const : ownership === "shared" ? "shared" as const : "inbox" as const,
      };
    }));

    return artifacts
      .filter((artifact) => {
        if (!args.placement || args.placement === "all") return true;
        if (args.placement === "shared") return artifact.ownership === "shared";
        return artifact.placementStatus === args.placement;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  },
});

export const get = query({
  args: {
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    const { actor, artifact, decision } = await requireArtifactCapability(ctx, args.artifactId);
    if (artifact.schoolId !== actor.schoolId || artifact.blueprintKey === "thread_reference") throw new Error("Artifact not found");
    const placements = await listPlacementsForArtifact(ctx, args.artifactId);
    const resourceType = artifact.blueprintKey === "agent" ? "agent" as const : "artifact" as const;
    const invitations = await ctx.db.query("shareInvitations").withIndex("by_resource", (q) => q.eq("resourceType", resourceType).eq("resourceId", artifact._id)).collect();
    const ownership = artifact.ownerAccountId === actor.accountId ? "owned" as const : "shared" as const;
    const activeInvitations = invitations.filter((invitation) => (invitation.status === "pending" || invitation.status === "accepted") && (!invitation.expiresAt || invitation.expiresAt > Date.now()));
    return {
      ...artifact,
      placements,
      ownership,
      accessLevel: decision.level,
      accessReason: decision.reason,
      isShared: ownership === "shared" || activeInvitations.length > 0,
      sharedWithCount: ownership === "owned" ? new Set(activeInvitations.map((invitation) => invitation.inviteeAccountId)).size : undefined,
      placementStatus: placements.length > 0 ? "workspace" : ownership === "shared" ? "shared" : "inbox",
    };
  },
});

export const listAgentRoutingDescriptors = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSpectraActor(ctx);
    const owned = await ctx.db.query("spectraArtifacts").withIndex("by_account_blueprint", (q) => q.eq("ownerAccountId", actor._id).eq("blueprintKey", "agent")).collect();
    const grantedIds = await listDirectlyGrantedResourceIds(ctx, actor, "agent");
    const granted = (await Promise.all(grantedIds.map(async (resourceId) => {
      const id = ctx.db.normalizeId("spectraArtifacts", resourceId);
      return id ? ctx.db.get(id) : null;
    }))).filter((artifact): artifact is Doc<"spectraArtifacts"> => Boolean(artifact));
    const candidates = [...new Map([...owned, ...granted].map((artifact) => [artifact._id, artifact])).values()];
    const descriptors = [];
    for (const artifact of candidates) {
      if (artifact.schoolId !== actor.schoolId || artifact.status !== "active" || artifact.blueprintKey !== "agent") continue;
      const decision = await evaluateAccess(ctx, "agent", artifact._id);
      if (!decision.allowed || !decision.capabilities.includes("use")) continue;
      const content = artifact.content && typeof artifact.content === "object" && !Array.isArray(artifact.content) ? artifact.content as Record<string, unknown> : {};
      const routing = content.routing && typeof content.routing === "object" && !Array.isArray(content.routing) ? content.routing as Record<string, unknown> : {};
      if (routing.enabled !== true) continue;
      descriptors.push({
        agentId: artifact._id,
        versionId: artifact.currentVersionId,
        title: artifact.title,
        summary: artifact.summary,
        description: typeof routing.description === "string" ? routing.description.slice(0, 2_000) : "",
        examples: Array.isArray(routing.examples) ? routing.examples.filter((value): value is string => typeof value === "string").slice(0, 30) : [],
        updatedAt: artifact.updatedAt,
      });
    }
    return descriptors.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 100);
  },
});

export const getAgentRuntime = query({
  args: { agentId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { artifact } = await requireArtifactCapability(ctx, args.agentId, "use");
    if (artifact.blueprintKey !== "agent" || artifact.status !== "active") throw new Error("Agent not found");
    const content = artifact.content && typeof artifact.content === "object" && !Array.isArray(artifact.content) ? artifact.content as Record<string, unknown> : {};
    const instructions = content.instructions && typeof content.instructions === "object" && !Array.isArray(content.instructions) ? content.instructions as Record<string, unknown> : {};
    const routing = content.routing && typeof content.routing === "object" && !Array.isArray(content.routing) ? content.routing as Record<string, unknown> : {};
    return {
      agentId: artifact._id,
      versionId: artifact.currentVersionId,
      title: artifact.title,
      summary: artifact.summary,
      instructions: typeof instructions.text === "string" ? instructions.text.slice(0, 24_000) : "",
      skills: Array.isArray(content.skills) ? content.skills.flatMap((value) => value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).enabled === true ? [{ id: (value as Record<string, unknown>).id, name: (value as Record<string, unknown>).name, instructions: (value as Record<string, unknown>).instructions }] : []).slice(0, 40) : [],
      tools: Array.isArray(content.tools) ? content.tools.flatMap((value) => value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).enabled === true ? [{ id: (value as Record<string, unknown>).id, key: (value as Record<string, unknown>).key, approval: (value as Record<string, unknown>).approval }] : []).slice(0, 60) : [],
      resources: Array.isArray(content.resources) ? content.resources.flatMap((value) => value && typeof value === "object" && !Array.isArray(value) ? [{ id: (value as Record<string, unknown>).id, artifactId: (value as Record<string, unknown>).artifactId, mode: (value as Record<string, unknown>).mode, label: (value as Record<string, unknown>).label }] : []).slice(0, 60) : [],
      routing: { description: typeof routing.description === "string" ? routing.description : "", examples: Array.isArray(routing.examples) ? routing.examples : [] },
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
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (!run || run.ownerAccountId !== actor._id || run.schoolId !== actor.schoolId || run.status !== "running" || !args.executionId || run.executionId !== args.executionId) throw new Error("This run is no longer allowed to create artifacts.");
    }
    if (args.workspaceId) {
      await requireWorkspaceCapability(ctx, args.workspaceId, "modify");
    }
    for (const sourceArtifactId of args.sourceArtifactIds ?? []) await requireArtifactCapability(ctx, sourceArtifactId);
    const now = Date.now();
    const title = args.title.trim() || "Untitled artifact";
    const summary = args.summary?.trim() || fallbackArtifactSummary(args.blueprintKey as BlueprintKey);
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      blueprintKey: args.blueprintKey,
      title,
      summary,
      content: args.content ?? defaultArtifactContent(args.blueprintKey as BlueprintKey),
      textIndex: buildArtifactTextIndex({ title, summary, content: args.content, tags: args.tags }),
      tags: args.tags ?? [],
      status: "active",
      createdFrom: {
        source: args.source ?? (args.workspaceId ? "workspace" : "manual"),
        workspaceId: args.workspaceId,
        runId: args.runId,
        threadId: args.threadId,
        sourceArtifactIds: args.sourceArtifactIds?.slice(0, 12),
        sourceThreadIds: args.sourceThreadIds?.slice(0, 4),
        sourceAttachmentNames: args.sourceAttachmentNames?.map((name) => name.slice(0, 180)).slice(0, 8),
        contextSummary: args.contextSummary?.slice(0, 400),
      },
      createdAt: now,
      updatedAt: now,
    });

    let workspaceItemId: Id<"spectraWorkspaceItems"> | undefined;
    if (args.workspaceId) {
      workspaceItemId = await ctx.db.insert("spectraWorkspaceItems", {
        workspaceId: args.workspaceId,
        sourceType: "artifact",
        sourceId: artifactId,
        placedByAccountId: actor.accountId,
        accessProjection: true,
        viewData: {
          compactSummary: summary,
          hidden: false,
        },
        layout: {
          view: "cards",
        },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(args.workspaceId, {
        updatedAt: now,
        lastActivityAt: now,
      });
    }

    const created = {
      title,
      summary,
      content: args.content ?? defaultArtifactContent(args.blueprintKey as BlueprintKey),
      tags: args.tags ?? [],
    };
    const initial = { title: "Untitled artifact", summary: undefined, content: null, tags: [] as string[] };
    const snapshots = await versionSnapshotFields(ctx, actor.schoolId, args.blueprintKey, initial, created);
    const versionId = await ctx.db.insert("spectraArtifactVersions", {
      artifactId,
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      source: args.source === "ai" ? "ai" : "manual",
      runId: args.runId,
      ...snapshots,
      summary: args.source === "ai" ? "Created with Spectra" : "Artifact created",
      createdAt: now,
    });
    await ctx.db.patch(artifactId, { currentVersionId: versionId });

    return { artifactId, workspaceItemId };
  },
});

export const createPending = mutation({
  args: { blueprintKey: vBlueprintKey, title: v.string(), workspaceId: v.optional(v.id("spectraWorkspaces")), runId: v.id("spectraAiRuns"), executionId: v.string(), threadId: v.optional(v.id("spectraThreads")) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor._id || run.schoolId !== actor.schoolId || run.status !== "running" || run.executionId !== args.executionId) throw new Error("AI run not found");
    if (args.workspaceId) await requireWorkspaceCapability(ctx, args.workspaceId, "modify");
    const now = Date.now();
    const title = args.title.trim() || "Creating artifact";
    const summary = "Spectra is building this artifact now.";
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor._id, schoolId: actor.schoolId, blueprintKey: args.blueprintKey,
      title, summary, content: defaultArtifactContent(args.blueprintKey as BlueprintKey),
      textIndex: `${title} ${summary}`, tags: [], status: "active", aiState: "creating", aiRunId: args.runId, aiExecutionId: args.executionId, aiProgress: 0.05,
      createdFrom: { source: "ai", workspaceId: args.workspaceId, runId: args.runId, threadId: args.threadId },
      createdAt: now, updatedAt: now,
    });
    let workspaceItemId: Id<"spectraWorkspaceItems"> | undefined;
    if (args.workspaceId) {
      workspaceItemId = await ctx.db.insert("spectraWorkspaceItems", { workspaceId: args.workspaceId, sourceType: "artifact", sourceId: artifactId, placedByAccountId: actor.accountId, accessProjection: true, viewData: { compactSummary: summary, hidden: false }, layout: { view: "cards" }, createdAt: now, updatedAt: now });
      await ctx.db.patch(args.workspaceId, { updatedAt: now, lastActivityAt: now });
    }
    return { artifactId, workspaceItemId };
  },
});

export const finalizePendingLive = mutation({
  args: { artifactId: v.id("spectraArtifacts"), runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor.accountId || run.status !== "running" || run.executionId !== args.executionId || artifact.aiRunId !== args.runId || artifact.aiExecutionId !== args.executionId || (artifact.aiState !== "creating" && artifact.aiState !== undefined)) throw new Error("This pending artifact is no longer editable by that run.");
    if (!artifact.currentVersionId || !artifact.liveStateVectorHash) throw new Error("The live artifact has not finished synchronizing.");
    const version = await ctx.db.get(artifact.currentVersionId);
    if (!version || version.artifactId !== artifact._id || version.source !== "ai" || version.runId !== args.runId) throw new Error("The synchronized AI version is unavailable.");
    const now = Date.now();
    await ctx.db.patch(version._id, { summary: "Created with Spectra" });
    await ctx.db.patch(args.artifactId, { aiState: "edited", aiExecutionId: undefined, aiStateExpiresAt: now + 8_000, aiProgress: undefined, aiPreview: undefined, updatedAt: now });
    const placements = await ctx.db.query("spectraWorkspaceItems").withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", args.artifactId)).collect();
    await Promise.all(placements.map((placement) => ctx.db.patch(placement._id, { viewData: { ...placement.viewData, compactSummary: artifact.summary }, updatedAt: now })));
    return { artifactId: args.artifactId, workspaceItemId: placements[0]?._id };
  },
});

export const pausePendingForConflict = mutation({
  args: { artifactId: v.id("spectraArtifacts"), runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor.accountId || run.executionId !== args.executionId || artifact.aiRunId !== args.runId || artifact.aiExecutionId !== args.executionId) throw new Error("This pending artifact does not belong to the paused run.");
    if (artifact.aiState !== "creating") return { paused: false };
    await ctx.db.patch(artifact._id, {
      aiState: undefined,
      aiProgress: undefined,
      aiPreview: undefined,
      summary: artifact.summary === "Spectra is building this artifact now." ? "Draft paused while an overlapping edit is resolved." : artifact.summary,
      updatedAt: Date.now(),
    });
    return { paused: true };
  },
});

export const patchPendingContent = mutation({
  args: { artifactId: v.id("spectraArtifacts"), runId: v.id("spectraAiRuns"), executionId: v.string(), content: v.any(), progress: v.number(), title: v.optional(v.string()), summary: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor.accountId || run.status !== "running" || run.executionId !== args.executionId || artifact.aiRunId !== args.runId || artifact.aiExecutionId !== args.executionId || artifact.aiState !== "creating") throw new Error("This pending artifact is no longer editable by that run.");
    const progress = Math.max(0, Math.min(0.98, args.progress));
    const title = args.title?.trim() || artifact.title;
    await ctx.db.patch(args.artifactId, {
      title,
      summary: args.summary ?? artifact.summary,
      textIndex: `${title} ${args.summary ?? artifact.summary ?? ""}`,
      aiProgress: progress,
      aiPreview: {
        ...(artifact.aiPreview ?? {}),
        title,
        summary: args.summary ?? artifact.summary,
        content: args.content,
        changedPaths: ["/"],
        startedAt: artifact.aiPreview?.startedAt ?? Date.now(),
      },
      updatedAt: Date.now(),
    });
    return { artifactId: args.artifactId, progress };
  },
});

export const stageAiPatch = mutation({
  args: { artifactId: v.id("spectraArtifacts"), runId: v.id("spectraAiRuns"), executionId: v.string(), title: v.optional(v.string()), summary: v.optional(v.string()), content: v.optional(v.any()), tags: v.optional(v.array(v.string())), changedPaths: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor.accountId || run.status !== "running" || run.executionId !== args.executionId) throw new Error("This run is no longer allowed to preview changes.");
    await ctx.db.patch(args.artifactId, { aiState: "updating", aiRunId: args.runId, aiExecutionId: args.executionId, aiPreview: { title: args.title, summary: args.summary, content: args.content, tags: args.tags, changedPaths: args.changedPaths, startedAt: Date.now() }, updatedAt: Date.now() });
    return { artifactId: args.artifactId };
  },
});

export const discardPendingForRun = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor._id || run.schoolId !== actor.schoolId || run.executionId !== args.executionId) throw new Error("This run attempt is no longer active.");
    const artifacts = await ctx.db.query("spectraArtifacts").withIndex("by_account_status", (q) => q.eq("ownerAccountId", actor._id).eq("status", "active")).collect();
    const pending = artifacts.filter((artifact) => artifact.schoolId === actor.schoolId && artifact.aiRunId === args.runId && artifact.aiExecutionId === args.executionId && (artifact.aiState === "creating" || (artifact.aiState === "failed" && artifact.createdFrom?.runId === args.runId)));
    for (const artifact of pending) {
      const placements = await ctx.db.query("spectraWorkspaceItems").withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", artifact._id)).collect();
      await Promise.all(placements.map((placement) => ctx.db.delete(placement._id)));
      await ctx.db.delete(artifact._id);
    }
    return { discarded: pending.length };
  },
});

export const failPendingForRun = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor._id || run.schoolId !== actor.schoolId || run.executionId !== args.executionId) throw new Error("This run attempt is no longer active.");
    const artifacts = await ctx.db.query("spectraArtifacts").withIndex("by_account_status", (q) => q.eq("ownerAccountId", actor._id).eq("status", "active")).collect();
    const pending = artifacts.filter((artifact) => artifact.schoolId === actor.schoolId && artifact.aiRunId === args.runId && artifact.aiExecutionId === args.executionId && artifact.aiState === "creating");
    let removed = 0;
    await Promise.all(pending.map(async (artifact) => {
      // A provisional shell with no generated content is not useful work. Do
      // not leave an empty red artifact behind after an internal format error.
      if ((artifact.aiProgress ?? 0) <= 0.05) {
        const placements = await ctx.db.query("spectraWorkspaceItems").withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", artifact._id)).collect();
        await Promise.all(placements.map((placement) => ctx.db.delete(placement._id)));
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
        summary: "Incomplete draft preserved from an interrupted Spectra run.",
        updatedAt: Date.now(),
      });
    }));
    return { failed: pending.length - removed, removed };
  },
});

export const settleStagedForRun = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string(), outcome: v.union(v.literal("clear"), v.literal("failed")) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor._id || run.schoolId !== actor.schoolId || run.executionId !== args.executionId) throw new Error("This run attempt is no longer active.");
    const artifacts = await ctx.db.query("spectraArtifacts").withIndex("by_account_status", (q) => q.eq("ownerAccountId", actor._id).eq("status", "active")).collect();
    const staged = artifacts.filter((artifact) =>
      artifact.schoolId === actor.schoolId &&
      artifact.aiRunId === args.runId &&
      (artifact.aiExecutionId === args.executionId || (artifact.aiExecutionId === undefined && artifact.aiState === "edited")) &&
      (artifact.aiState === "updating" || artifact.aiState === "edited"),
    );
    const now = Date.now();
    await Promise.all(staged.map((artifact) => ctx.db.patch(artifact._id, {
      aiState: undefined,
      aiRunId: undefined,
      aiExecutionId: undefined,
      aiStateExpiresAt: undefined,
      aiProgress: undefined,
      aiPreview: undefined,
      updatedAt: now,
    })));
    return { settled: staged.length };
  },
});

export const markAiState = mutation({
  args: { artifactId: v.id("spectraArtifacts"), runId: v.id("spectraAiRuns"), executionId: v.string(), state: v.union(v.literal("updating"), v.literal("edited"), v.literal("failed")) },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor.accountId || run.executionId !== args.executionId || artifact.aiRunId !== args.runId || artifact.aiExecutionId !== args.executionId) throw new Error("This artifact belongs to a different run attempt.");
    const now = Date.now();
    await ctx.db.patch(args.artifactId, args.state === "failed"
      ? { aiState: undefined, aiRunId: undefined, aiExecutionId: undefined, aiStateExpiresAt: undefined, aiProgress: undefined, aiPreview: undefined, updatedAt: now }
      : { aiState: args.state, aiRunId: args.runId, aiExecutionId: args.state === "edited" ? undefined : args.executionId, aiStateExpiresAt: args.state === "edited" ? now + 8_000 : undefined, aiPreview: args.state === "edited" ? undefined : artifact.aiPreview, updatedAt: now });
    return { artifactId: args.artifactId };
  },
});

export const listVersions = query({
  args: { artifactId: v.id("spectraArtifacts"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.artifactId);
    const versions = await ctx.db.query("spectraArtifactVersions")
      .withIndex("by_artifact_created", (q) => q.eq("artifactId", args.artifactId))
      .order("desc")
      .take(Math.max(1, Math.min(args.limit ?? 30, 100)));
    return Promise.all(versions.map((version) => hydrateVersion(ctx, version)));
  },
});

export const archive = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.artifactId, "delete");
    await ctx.db.patch(args.artifactId, {
      status: "archived",
      updatedAt: Date.now(),
    });
    return { artifactId: args.artifactId };
  },
});

export const permanentlyDelete = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.artifactId, "delete");

    const placements = await ctx.db
      .query("spectraWorkspaceItems")
      .withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", args.artifactId))
      .collect();
    await Promise.all(placements.map((placement) => ctx.db.delete(placement._id)));

    const versions = await ctx.db.query("spectraArtifactVersions").withIndex("by_artifact_created", (q) => q.eq("artifactId", args.artifactId)).collect();
    const [outgoingLinks, incomingLinks] = await Promise.all([
      ctx.db.query("spectraArtifactLinks").withIndex("by_source", (q) => q.eq("sourceArtifactId", args.artifactId)).collect(),
      ctx.db.query("spectraArtifactLinks").withIndex("by_target", (q) => q.eq("targetArtifactId", args.artifactId)).collect(),
    ]);
    const linkRows = [...new Map([...outgoingLinks, ...incomingLinks].map((link) => [link._id, link])).values()];
    for (const version of versions) {
      if (version.snapshotRef) await releaseSnapshotObject(ctx, version.schoolId, version.snapshotRef);
      if (version.beforeSnapshotRef) await releaseSnapshotObject(ctx, version.schoolId, version.beforeSnapshotRef);
      await ctx.db.delete(version._id);
    }
    await Promise.all(linkRows.map((link) => ctx.db.delete(link._id)));

    const runs = await ctx.db
      .query("spectraAiRuns")
      .withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId))
      .collect();
    for (const run of runs) {
      const [operations, cards] = await Promise.all([
        ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
        ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
      ]);
      await Promise.all([...operations.map((operation) => ctx.db.delete(operation._id)), ...cards.map((card) => ctx.db.delete(card._id))]);
      await ctx.db.delete(run._id);
    }

    await ctx.db.delete(args.artifactId);
    return { artifactId: args.artifactId, placementCount: placements.length, runCount: runs.length };
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
