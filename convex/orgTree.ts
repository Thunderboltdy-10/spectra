import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  normalizeArtifactId,
  requireArtifactCapability,
  requireSpectraActor,
  requireWorkspaceCapability,
} from "./spectraShared";
import { evaluateAccess } from "./authorityShared";
import { projectArtifactForAccess } from "./quizPrivacy";
import {
  MAX_TREE_DEPTH,
  breadcrumbNodes,
  createFolderNode,
  createLinkNode,
  ensureGeneralNode,
  ensureWorkspaceNode,
  findPrimaryNode,
  isContainerKind,
  listChildNodes,
  moveNode,
  placeSourceNode,
  renameNode,
  requireOwnNode,
  restoreTrashedNode,
  subtreeNodes,
  trashNode,
  workspaceContextNodes,
  type OrgNode,
} from "./orgTreeShared";
import { hydrateNodes, type OrgNodeView } from "./orgTreeViews";

/**
 * The tree's public surface. Reads are account-scoped; every write validates
 * server-side (kind rules, cycles, depth, ownership) before it touches a row,
 * so a client cannot construct an impossible tree by calling the API directly.
 */

const vNodeKind = v.union(
  v.literal("folder"),
  v.literal("workspace"),
  v.literal("work"),
  v.literal("thread"),
  v.literal("link"),
);

async function resolveParentId(
  ctx: Parameters<typeof requireSpectraActor>[0],
  raw: string | undefined | null,
) {
  if (raw === undefined || raw === null || raw === "" || raw === "root")
    return null;
  return ctx.db.normalizeId("orgNodes", raw);
}

/* -------------------------------------------------------------------- reads */

/** One level of the tree, ordered, paginated. */
export const listChildren = query({
  args: {
    parentId: v.optional(v.union(v.string(), v.null())),
    paginationOpts: paginationOptsValidator,
    includeTrashed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const parentId = await resolveParentId(ctx, args.parentId ?? null);
    if (args.parentId && args.parentId !== "root" && !parentId)
      return { page: [], isDone: true, continueCursor: "" };
    if (parentId) {
      const parent = await ctx.db.get(parentId);
      if (!parent || parent.accountId !== actor.accountId)
        return { page: [], isDone: true, continueCursor: "" };
    }
    const result = await ctx.db
      .query("orgNodes")
      .withIndex("by_account_parent_order", (q) =>
        q.eq("accountId", actor.accountId).eq("parentId", parentId),
      )
      .paginate(args.paginationOpts);
    const rows = args.includeTrashed
      ? result.page
      : result.page.filter((row) => row.deletedAt === undefined);
    return {
      ...result,
      page: await hydrateNodes(ctx, rows, {
        withChildCounts: true,
        withSource: true,
        accountId: actor.accountId,
      }),
    };
  },
});

/** Everything under a node, for a workspace view or a bulk operation. */
export const subtree = query({
  args: {
    nodeId: v.string(),
    includeTrashed: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const nodeId = ctx.db.normalizeId("orgNodes", args.nodeId);
    if (!nodeId) return null;
    const node = await ctx.db.get(nodeId);
    if (!node || node.accountId !== actor.accountId) return null;
    const nodes = await subtreeNodes(ctx, node, {
      includeTrashed: args.includeTrashed,
    });
    const limited = nodes.slice(0, Math.min(args.limit ?? 2000, 5000));
    return {
      root: (await hydrateNodes(ctx, [node], {
        withSource: true,
        accountId: actor.accountId,
      }))[0]!,
      nodes: await hydrateNodes(ctx, limited.slice(1), {
        withChildCounts: true,
        withSource: true,
        accountId: actor.accountId,
      }),
      truncated: limited.length < nodes.length,
      total: nodes.length,
    };
  },
});

/** The live contents of a workspace, wherever they sit in the tree (D32). */
export const listWorkspaceContext = query({
  args: {
    workspaceId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const workspaceId = ctx.db.normalizeId(
      "spectraWorkspaces",
      args.workspaceId,
    );
    if (!workspaceId) return null;
    const decision = await evaluateAccess(ctx, "workspace", workspaceId);
    if (!decision.allowed) return null;
    const rows = await ctx.db
      .query("orgNodes")
      .withIndex("by_workspace_context", (q) =>
        q.eq("workspaceContextId", workspaceId),
      )
      .take(Math.min(args.limit ?? 500, 2000));
    const live = rows.filter((row) => row.deletedAt === undefined);
    return {
      workspace: decision.loaded.resource as Doc<"spectraWorkspaces">,
      nodes: await hydrateNodes(ctx, live, {
        withChildCounts: true,
        withSource: true,
        accountId: actor.accountId,
      }),
      accountScoped: live.every((row) => row.accountId === actor.accountId),
    };
  },
});

/** Root-first path so the client can render breadcrumbs without walking. */
export const path = query({
  args: { nodeId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const nodeId = ctx.db.normalizeId("orgNodes", args.nodeId);
    if (!nodeId) return null;
    const node = await ctx.db.get(nodeId);
    if (!node || node.accountId !== actor.accountId) return null;
    const ancestors = await breadcrumbNodes(ctx, node);
    return {
      node: (await hydrateNodes(ctx, [node]))[0]!,
      ancestors: await hydrateNodes(ctx, ancestors),
      depth: ancestors.length,
      maxDepth: MAX_TREE_DEPTH,
    };
  },
});

/**
 * The containers under a parent — what a navigation rail needs and nothing more.
 * Unpaginated on purpose: a rail that loaded folders in pages would collapse and
 * re-open as the reader scrolled, and a folder with 500 subfolders is not a
 * shape this product asks anyone to live with.
 */
export const listContainers = query({
  args: { parentId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const parentId = await resolveParentId(ctx, args.parentId ?? null);
    if (args.parentId && args.parentId !== "root" && !parentId)
      return { nodes: [] };
    const rows = await listChildNodes(ctx, actor.accountId, parentId);
    const containers = rows
      .filter((row) => isContainerKind(row.kind))
      .slice(0, 500);
    return {
      nodes: await hydrateNodes(ctx, containers, {
        withChildCounts: true,
        withSource: true,
        accountId: actor.accountId,
      }),
    };
  },
});

/**
 * The survivals from the old Library, as views over the same tree rather than
 * as rival organizational systems: Recent is activity order, Favorites is the
 * pin, Shared is who else can see it. Each returns nodes with their folder path
 * so a flat list stays navigable.
 */
export const quickView = query({
  args: {
    view: v.union(
      v.literal("recent"),
      v.literal("favorites"),
      v.literal("shared"),
    ),
    kinds: v.optional(v.array(vNodeKind)),
    limit: v.optional(v.number()),
    /** Same contract as `search`: inside a scope, a quick view is that scope's. */
    scopeNodeId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const limit = Math.min(args.limit ?? 200, 1000);
    const all = await ctx.db
      .query("orgNodes")
      .withIndex("by_account_deleted", (q) => q.eq("accountId", actor.accountId))
      .collect();
    const byId = new Map(all.map((row) => [row._id as string, row]));
    const scopeId =
      args.scopeNodeId && args.scopeNodeId !== "root"
        ? ctx.db.normalizeId("orgNodes", args.scopeNodeId)
        : null;
    const inScope = (row: OrgNode) => {
      if (!scopeId) return true;
      let current = row.parentId ? byId.get(row.parentId) : undefined;
      for (let depth = 0; depth < MAX_TREE_DEPTH && current; depth += 1) {
        if (current._id === scopeId) return true;
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return false;
    };
    const kinds = args.kinds;
    let live = all.filter(
      (row) =>
        row.deletedAt === undefined &&
        row.kind !== "link" &&
        (!kinds || kinds.includes(row.kind)) &&
        inScope(row),
    );
    if (args.view === "favorites") live = live.filter((row) => row.pinned === true);
    const hydrated = await hydrateNodes(ctx, live, {
      withSource: true,
      withChildCounts: true,
      accountId: actor.accountId,
    });
    let selected = hydrated;
    if (args.view === "shared")
      selected = hydrated.filter((row) => row.source?.shared === true);
    /* Recent means "last touched", which for a work is its own activity, not
       when its row happened to be re-stamped. */
    const activityOf = (row: OrgNodeView) => row.source?.updatedAt ?? row.updatedAt;
    const ordered =
      args.view === "favorites"
        ? selected.sort((a, b) => a.name.localeCompare(b.name))
        : selected.sort((a, b) => activityOf(b) - activityOf(a));
    const page = ordered.slice(0, limit);
    return {
      nodes: page.map((row) => {
        const parentPath: string[] = [];
        let current = byId.get(row.parentId ?? "");
        for (let depth = 0; depth < MAX_TREE_DEPTH && current; depth += 1) {
          parentPath.unshift(current.name);
          current = byId.get(current.parentId ?? "");
        }
        return { ...row, parentPath };
      }),
      total: ordered.length,
    };
  },
});

/**
 * Name search over the tree. One surface, deliberately provider-shaped: the
 * ranked ids come from here, so a semantic provider can replace the retrieval
 * step later without changing any caller (N-series).
 */
export const search = query({
  args: {
    term: v.string(),
    kinds: v.optional(v.array(vNodeKind)),
    limit: v.optional(v.number()),
    /**
     * Confine the search to one subtree. A reader inside a workspace is inside
     * its context (D32), so searching there means searching it — not the account
     * with the results mostly somewhere else.
     */
    scopeNodeId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const term = args.term.trim();
    if (!term) return { results: [], provider: "name" as const };
    const scopeId =
      args.scopeNodeId && args.scopeNodeId !== "root"
        ? ctx.db.normalizeId("orgNodes", args.scopeNodeId)
        : null;
    const limit = Math.min(args.limit ?? 40, 200);
    const matches = await ctx.db
      .query("orgNodes")
      .withSearchIndex("search_name", (q) =>
        q.search("name", term).eq("accountId", actor.accountId),
      )
      .take(limit * (scopeId ? 6 : 2));
    const kinds = args.kinds;
    const candidates = matches
      .filter((row) => row.deletedAt === undefined)
      .filter((row) => !kinds || kinds.includes(row.kind));
    /* Breadcrumbs make a flat result list navigable, and they are also how a
       scope is enforced: a hit belongs if the scope is one of its ancestors. */
    const withPaths: Array<OrgNodeView & { parentPath: string[] }> = [];
    for (const row of candidates) {
      if (withPaths.length >= limit) break;
      const ancestors = await breadcrumbNodes(ctx, row);
      if (scopeId && !ancestors.some((node) => node._id === scopeId)) continue;
      const view = (
        await hydrateNodes(ctx, [row], {
          withChildCounts: true,
          withSource: true,
          accountId: actor.accountId,
        })
      )[0]!;
      withPaths.push({ ...view, parentPath: ancestors.map((node) => node.name) });
    }
    return { results: withPaths, provider: "name" as const };
  },
});

/** Trashed roots, newest first, for a Trash view. */
export const listTrash = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const rows = await ctx.db
      .query("orgNodes")
      .withIndex("by_account_deleted", (q) =>
        q.eq("accountId", actor.accountId),
      )
      .collect();
    const roots = rows
      .filter((row) => row.deletedAt !== undefined && row.trashedRootId === row._id)
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
      .slice(0, Math.min(args.limit ?? 100, 500));
    return {
      nodes: await hydrateNodes(ctx, roots, {
        withChildCounts: true,
        withSource: true,
        accountId: actor.accountId,
      }),
    };
  },
});

/** Where a given work, thread or workspace lives right now. */
export const placementForSource = query({
  args: {
    kind: v.union(
      v.literal("work"),
      v.literal("thread"),
      v.literal("workspace"),
    ),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const node = await findPrimaryNode(
      ctx,
      actor.accountId,
      args.kind,
      args.sourceId,
    );
    if (!node) return null;
    return {
      node: (await hydrateNodes(ctx, [node]))[0]!,
      ancestors: await hydrateNodes(ctx, await breadcrumbNodes(ctx, node)),
    };
  },
});

/* ------------------------------------------------------------------- writes */

export const createFolder = mutation({
  args: {
    name: v.string(),
    parentId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const parentId = await resolveParentId(ctx, args.parentId ?? null);
    const node = await createFolderNode(ctx, {
      accountId: actor.accountId,
      schoolId: actor.schoolId ?? undefined,
      name: args.name,
      parentId,
    });
    return { nodeId: node._id, name: node.name, parentId: node.parentId };
  },
});

export const rename = mutation({
  args: { nodeId: v.id("orgNodes"), name: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const node = await requireOwnNode(ctx, args.nodeId, actor.accountId);
    const renamed = await renameNode(ctx, node, args.name);
    return { nodeId: renamed._id, name: renamed.name };
  },
});

export const move = mutation({
  args: {
    nodeIds: v.array(v.id("orgNodes")),
    parentId: v.optional(v.union(v.string(), v.null())),
    beforeSiblingId: v.optional(v.union(v.id("orgNodes"), v.null())),
    afterSiblingId: v.optional(v.union(v.id("orgNodes"), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    if (args.nodeIds.length === 0) return { moved: [] };
    if (args.nodeIds.length > 200)
      throw new Error("Move at most 200 items at a time.");
    const parentId = await resolveParentId(ctx, args.parentId ?? null);
    const moved: Id<"orgNodes">[] = [];
    /* Multi-select keeps the order the caller listed: each node lands after the
       previous one, so a dragged block stays a block. */
    let afterSiblingId = args.afterSiblingId ?? null;
    for (const nodeId of args.nodeIds) {
      const node = await requireOwnNode(ctx, nodeId, actor.accountId);
      const result = await moveNode(ctx, node, {
        parentId,
        beforeSiblingId: afterSiblingId ? null : (args.beforeSiblingId ?? null),
        afterSiblingId,
      });
      moved.push(result._id);
      afterSiblingId = result._id;
    }
    return { moved, parentId };
  },
});

export const createReference = mutation({
  args: {
    targetNodeId: v.id("orgNodes"),
    parentId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const parentId = await resolveParentId(ctx, args.parentId ?? null);
    const node = await createLinkNode(ctx, {
      accountId: actor.accountId,
      schoolId: actor.schoolId ?? undefined,
      targetNodeId: args.targetNodeId,
      parentId,
    });
    return { nodeId: node._id, targetNodeId: args.targetNodeId };
  },
});

/** Soft delete: the node and its subtree go to trash, restorable as one. */
export const trash = mutation({
  args: { nodeIds: v.array(v.id("orgNodes")) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    if (args.nodeIds.length > 200)
      throw new Error("Delete at most 200 items at a time.");
    const results = [];
    for (const nodeId of args.nodeIds) {
      const node = await requireOwnNode(ctx, nodeId, actor.accountId);
      results.push(await trashNode(ctx, node));
    }
    return { trashed: results };
  },
});

export const restore = mutation({
  args: { nodeIds: v.array(v.id("orgNodes")) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const results = [];
    for (const nodeId of args.nodeIds) {
      const node = await requireOwnNode(ctx, nodeId, actor.accountId);
      results.push(await restoreTrashedNode(ctx, node));
    }
    return { restored: results };
  },
});

export const setPinned = mutation({
  args: {
    nodeId: v.id("orgNodes"),
    pinned: v.boolean(),
    /** Make this the only pinned item in its workspace. */
    exclusive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const node = await requireOwnNode(ctx, args.nodeId, actor.accountId);
    const now = Date.now();
    if (args.pinned && args.exclusive && node.workspaceContextId)
      for (const sibling of await workspaceContextNodes(
        ctx,
        node.workspaceContextId,
      ))
        if (sibling._id !== node._id && sibling.pinned === true)
          await ctx.db.patch(sibling._id, { pinned: false, updatedAt: now });
    await ctx.db.patch(node._id, { pinned: args.pinned, updatedAt: now });
    return { nodeId: node._id, pinned: args.pinned };
  },
});

/**
 * Pin by source id rather than by node.
 *
 * Favorites used to be a list of artifact ids in one browser's localStorage, so
 * they were invisible on every other device and to everyone else. They are now
 * `pinned` on the node, which is one source of truth — and this is how the old
 * per-browser list is carried over on first load without asking the client to
 * resolve each id to a node first.
 */
export const pinSources = mutation({
  args: {
    kind: v.union(v.literal("work"), v.literal("thread")),
    sourceIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    if (args.sourceIds.length > 500)
      throw new Error("Pin at most 500 items at a time.");
    const now = Date.now();
    let pinned = 0;
    for (const sourceId of new Set(args.sourceIds)) {
      const node = await findPrimaryNode(
        ctx,
        actor.accountId,
        args.kind,
        sourceId,
      );
      if (!node || node.deletedAt !== undefined || node.pinned === true) continue;
      await ctx.db.patch(node._id, { pinned: true, updatedAt: now });
      pinned += 1;
    }
    return { pinned };
  },
});

/**
 * The account's tree floor: General plus every workspace's node. Idempotent, so
 * the client can call it on first Library load without coordination.
 */
export const ensureAccountRoots = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSpectraActor(ctx);
    const { workspace, node } = await ensureGeneralNode(
      ctx,
      actor.accountId,
      actor.schoolId ?? undefined,
    );
    const workspaces = await ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_account_status", (q) =>
        q.eq("ownerAccountId", actor.accountId).eq("status", "active"),
      )
      .collect();
    let created = 0;
    for (const row of workspaces) {
      const existing = await findPrimaryNode(
        ctx,
        actor.accountId,
        "workspace",
        row._id,
      );
      if (existing) continue;
      await ensureWorkspaceNode(ctx, row);
      created += 1;
    }
    const roots = await listChildNodes(ctx, actor.accountId, null);
    return {
      generalWorkspaceId: workspace._id,
      generalNodeId: node._id,
      workspaceNodesCreated: created,
      rootCount: roots.length,
    };
  },
});

/* ------------------------------------------------- a workspace's contents */

/**
 * What a workspace holds, as the product talks about it: the live work and
 * threads inside it, hydrated for display. This replaces the old placement
 * table's listing — the tree is now the only thing that knows where work lives,
 * so there is one answer rather than a row per view.
 */
export type WorkspaceContentItem = {
  nodeId: Id<"orgNodes">;
  workspaceId: Id<"spectraWorkspaces">;
  parentId: Id<"orgNodes"> | null;
  kind: "work" | "thread";
  sourceId: string;
  name: string;
  pinned: boolean;
  orderKey: string;
  createdAt: number;
  updatedAt: number;
  artifact: unknown | null;
  thread: unknown | null;
};

async function hydrateWorkNode(
  ctx: Parameters<typeof requireSpectraActor>[0],
  node: OrgNode,
  accountId: Id<"accounts">,
) {
  const artifactId = normalizeArtifactId(ctx, node.sourceId ?? "");
  if (!artifactId) return null;
  const candidate = await ctx.db.get(artifactId);
  const resourceType =
    candidate?.blueprintKey === "agent" ? ("agent" as const) : ("artifact" as const);
  const decision = await evaluateAccess(ctx, resourceType, artifactId);
  if (!decision.allowed) return null;
  const artifact = decision.loaded.resource as Doc<"spectraArtifacts">;
  if (artifact.status === "deleted") return null;
  const projected = decision.level
    ? projectArtifactForAccess(artifact, decision.level)
    : artifact;
  const ownership =
    artifact.ownerAccountId === accountId
      ? ("owned" as const)
      : ("shared" as const);
  const invitations = await ctx.db
    .query("shareInvitations")
    .withIndex("by_resource", (q) =>
      q.eq("resourceType", resourceType).eq("resourceId", artifact._id),
    )
    .collect();
  const now = Date.now();
  const active = invitations.filter(
    (invitation) =>
      (invitation.status === "pending" || invitation.status === "accepted") &&
      (!invitation.expiresAt || invitation.expiresAt > now),
  );
  const workspace = node.workspaceContextId
    ? await ctx.db.get(node.workspaceContextId)
    : null;
  return {
    ...projected,
    ownership,
    accessLevel: decision.level ?? null,
    accessReason: decision.reason,
    isShared: ownership === "shared" || active.length > 0,
    sharedWithCount:
      ownership === "owned"
        ? new Set(active.map((invitation) => invitation.inviteeAccountId)).size
        : undefined,
    placements: workspace
      ? [
          {
            workspaceId: workspace._id,
            workspaceTitle: workspace.title,
            nodeId: node._id,
            pinned: node.pinned === true,
          },
        ]
      : [],
    placementStatus: "workspace" as const,
  };
}

async function readWorkspaceContents(
  ctx: Parameters<typeof requireSpectraActor>[0],
  workspaceId: Id<"spectraWorkspaces">,
) {
  const { actor, workspace } = await requireWorkspaceCapability(
    ctx,
    workspaceId,
  );
  const nodes = await workspaceContextNodes(ctx, workspaceId);
  const items: WorkspaceContentItem[] = [];
  for (const node of nodes) {
    if (node.kind !== "work" && node.kind !== "thread") continue;
    if (!node.sourceId) continue;
    const base = {
      nodeId: node._id,
      workspaceId,
      parentId: node.parentId,
      kind: node.kind,
      sourceId: node.sourceId,
      name: node.name,
      pinned: node.pinned === true,
      orderKey: node.orderKey,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
    if (node.kind === "work") {
      const artifact = await hydrateWorkNode(ctx, node, actor.accountId);
      if (artifact) items.push({ ...base, artifact, thread: null });
      continue;
    }
    const threadId = ctx.db.normalizeId("spectraThreads", node.sourceId);
    const thread = threadId ? await ctx.db.get(threadId) : null;
    if (!thread || thread.status === "deleted") continue;
    const run = thread.lastRunId ? await ctx.db.get(thread.lastRunId) : null;
    items.push({ ...base, artifact: null, thread: { ...thread, run } });
  }

  /* The AI's own edits settle after a beat, and a staged patch previews in
     place. Both belong to how the workspace reads, not to the tree. */
  const settled =
    workspace.aiState === "edited" &&
    workspace.aiStateExpiresAt &&
    workspace.aiStateExpiresAt <= Date.now()
      ? { ...workspace, aiState: undefined }
      : workspace;
  const visible =
    settled.aiState === "updating" && settled.aiPreview
      ? {
          ...settled,
          title: settled.aiPreview.title ?? settled.title,
          description: settled.aiPreview.description ?? settled.description,
          icon: settled.aiPreview.icon ?? settled.icon,
          color: settled.aiPreview.color ?? settled.color,
        }
      : settled;
  return { workspace: visible, items };
}

export const listWorkspaceContents = query({
  args: { workspaceId: v.id("spectraWorkspaces") },
  handler: (ctx, args) => readWorkspaceContents(ctx, args.workspaceId),
});

// HTTP query-string ids are untrusted. Normalize before entering a table-typed
// validator so a stale id becomes a controlled miss, not a Convex
// ArgumentValidationError for spectraWorkspaces.
export const listWorkspaceContentsPublic = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const workspaceId = ctx.db.normalizeId(
      "spectraWorkspaces",
      args.workspaceId,
    );
    if (!workspaceId) return null;
    try {
      return await readWorkspaceContents(ctx, workspaceId);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes("workspace not found")
      )
        return null;
      throw error;
    }
  },
});

/**
 * File a work in a workspace, or in General when no workspace is named. One
 * call covers adding, moving between workspaces, and taking something out of a
 * workspace, because a work has exactly one home (I1, I4).
 */
export const placeWork = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    parentId: v.optional(v.id("orgNodes")),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    if (args.workspaceId)
      await requireWorkspaceCapability(ctx, args.workspaceId, "modify");
    const { artifact, capabilities } = await requireArtifactCapability(
      ctx,
      args.artifactId,
    );
    if (
      artifact.blueprintKey === "timetable" &&
      ((artifact.tags ?? []).includes("system-timetable") ||
        (artifact.tags ?? []).includes("managebac") ||
        artifact.createdFrom?.contextSummary === "Personal Spectra timetable" ||
        artifact.createdFrom?.contextSummary ===
          "Automatic ManageBac timetable bootstrap")
    )
      throw new Error(
        "Your Timetable stays in General and cannot be moved into a workspace.",
      );
    const parent = args.parentId
      ? await requireOwnNode(ctx, args.parentId, actor.accountId)
      : null;
    const before = await findPrimaryNode(
      ctx,
      actor.accountId,
      "work",
      args.artifactId,
    );
    const node = await placeSourceNode(ctx, {
      accountId: actor.accountId,
      schoolId: actor.schoolId ?? undefined,
      kind: "work",
      sourceId: args.artifactId,
      name: artifact.title,
      target: parent
        ? { parentId: parent._id }
        : args.workspaceId
          ? { workspaceId: args.workspaceId }
          : {},
      placedByAccountId: actor.accountId,
      /* Never let a recipient's own filing promote itself into an access grant:
         only somebody who can share the work can project access with it. */
      accessProjection: capabilities.includes("share") ? true : undefined,
      relocate: !parent && !args.workspaceId,
    });
    const workspaceId = node.workspaceContextId;
    if (workspaceId) {
      const now = Date.now();
      await ctx.db.patch(workspaceId, { updatedAt: now, lastActivityAt: now });
    }
    return {
      nodeId: node._id,
      workspaceId,
      created: before === null || before.deletedAt !== undefined,
    };
  },
});

/**
 * Take an item out of a workspace. It moves to General rather than disappearing:
 * removing something from a shelf is not deleting it (D31).
 */
export const removeFromWorkspace = mutation({
  args: { nodeId: v.id("orgNodes") },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const node = await requireOwnNode(ctx, args.nodeId, actor.accountId);
    if (node.workspaceContextId)
      await requireWorkspaceCapability(ctx, node.workspaceContextId, "modify");
    const general = await ensureGeneralNode(
      ctx,
      actor.accountId,
      actor.schoolId ?? undefined,
    );
    const from = node.workspaceContextId;
    if (from !== general.workspace._id)
      await moveNode(ctx, node, { parentId: general.node._id });
    if (from) {
      const now = Date.now();
      await ctx.db.patch(from, { updatedAt: now, lastActivityAt: now });
    }
    let artifactStillExists = true;
    if (node.kind === "work" && node.sourceId) {
      const artifactId = normalizeArtifactId(ctx, node.sourceId);
      const artifact = artifactId ? await ctx.db.get(artifactId) : null;
      artifactStillExists = Boolean(artifact && artifact.status !== "deleted");
    }
    return {
      nodeId: node._id,
      workspaceId: from,
      generalWorkspaceId: general.workspace._id,
      kind: node.kind,
      sourceId: node.sourceId,
      artifactStillExists,
    };
  },
});
