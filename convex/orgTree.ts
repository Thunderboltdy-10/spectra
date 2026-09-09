import { query } from "./_generated/server";
import { internalMutation, mutation } from "./orgNodeMutation";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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
  purgeTrashedNodes,
  refuseTrashedPurge,
  renameNode,
  requireOwnNode,
  restoreTrashedNode,
  subtreeNodes,
  trashNode,
  workspaceContextNodes,
  artifactSummaryProjection,
  type OrgNode,
} from "./orgTreeShared";
import { hydrateNodes, type OrgNodeView } from "./orgTreeViews";
import { enqueueStructureRequest } from "./bridgeStructure";

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
    sortKey: v.optional(
      v.union(v.literal("manual"), v.literal("name"), v.literal("updated"), v.literal("type")),
    ),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    typeFilter: v.optional(v.string()),
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
    const sortKey = args.sortKey ?? "manual";
    const direction = args.direction ?? "asc";
    const typeFilter =
      args.typeFilter && args.typeFilter !== "all" ? args.typeFilter : null;
    const result = args.includeTrashed
      ? await ctx.db
          .query("orgNodes")
          .withIndex("by_account_parent_order", (q) =>
            q.eq("accountId", actor.accountId).eq("parentId", parentId),
          )
          .paginate(args.paginationOpts)
      : sortKey === "updated"
        ? typeFilter
          ? await ctx.db
              .query("orgNodes")
              .withIndex("by_account_parent_live_type_activity", (q) =>
                q.eq("accountId", actor.accountId).eq("parentId", parentId).eq("deletedAt", undefined).eq("typeKey", typeFilter),
              )
              .order(direction)
              .paginate(args.paginationOpts)
          : await ctx.db
              .query("orgNodes")
              .withIndex("by_account_parent_live_activity", (q) =>
                q.eq("accountId", actor.accountId).eq("parentId", parentId).eq("deletedAt", undefined),
              )
              .order(direction)
              .paginate(args.paginationOpts)
        : sortKey === "name" || sortKey === "type"
          ? typeFilter
            ? await ctx.db
                .query("orgNodes")
                .withIndex("by_account_parent_live_type_name", (q) =>
                  q.eq("accountId", actor.accountId).eq("parentId", parentId).eq("deletedAt", undefined).eq("typeKey", typeFilter),
                )
                .order(direction)
                .paginate(args.paginationOpts)
            : sortKey === "type"
              ? await ctx.db
                  .query("orgNodes")
                  .withIndex("by_account_parent_live_type_name", (q) =>
                    q.eq("accountId", actor.accountId).eq("parentId", parentId).eq("deletedAt", undefined),
                  )
                  .order(direction)
                  .paginate(args.paginationOpts)
              : await ctx.db
                  .query("orgNodes")
                  .withIndex("by_account_parent_live_name", (q) =>
                    q.eq("accountId", actor.accountId).eq("parentId", parentId).eq("deletedAt", undefined),
                  )
                  .order(direction)
                  .paginate(args.paginationOpts)
          : typeFilter
            ? await ctx.db
                .query("orgNodes")
                .withIndex("by_account_parent_live_type_order", (q) =>
                  q.eq("accountId", actor.accountId).eq("parentId", parentId).eq("deletedAt", undefined).eq("typeKey", typeFilter),
                )
                .paginate(args.paginationOpts)
            : await ctx.db
                .query("orgNodes")
                .withIndex("by_account_parent_live_order", (q) =>
                  q.eq("accountId", actor.accountId).eq("parentId", parentId).eq("deletedAt", undefined),
                )
                .paginate(args.paginationOpts);
    return {
      ...result,
      page: await hydrateNodes(ctx, result.page, {
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
 * Source truth for things that are already open in the shell.
 *
 * The caller sends only its open tabs, tiles, splits, thread panel and current
 * workspace. That keeps this subscription bounded while letting a rename,
 * move or metadata edit update every open surface in place (D40). Tree rows
 * and board cards already subscribe through their own windowed reads; they do
 * not need to join this selector.
 */
export const liveIdentities = query({
  args: {
    sources: v.array(
      v.object({
        kind: v.union(
          v.literal("work"),
          v.literal("thread"),
          v.literal("workspace"),
        ),
        sourceId: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    if (args.sources.length > 64)
      throw new Error("Observe at most 64 open objects at a time.");
    const seen = new Set<string>();
    const identities = [];
    for (const source of args.sources) {
      const key = `${source.kind}:${source.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const node = await findPrimaryNode(
        ctx,
        actor.accountId,
        source.kind,
        source.sourceId,
      );
      if (!node || node.deletedAt !== undefined) continue;
      const view = (
        await hydrateNodes(ctx, [node], {
          withSource: true,
          accountId: actor.accountId,
        })
      )[0]!;
      const workspace = view.workspaceContextId
        ? await ctx.db.get(view.workspaceContextId)
        : null;
      identities.push({
        kind: source.kind,
        sourceId: source.sourceId,
        nodeId: view.nodeId,
        name: view.workspace?.title ?? view.source?.title ?? view.name,
        summary: view.source?.summary,
        blueprintKey: view.source?.blueprintKey,
        activityAt: view.source?.updatedAt ?? view.activityAt,
        workspaceContextId: view.workspaceContextId,
        workspaceTitle: workspace?.title,
        pinned: view.pinned,
      });
    }
    return { identities };
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
    const rows = await ctx.db
      .query("orgNodes")
      .withIndex("by_account_parent_live_order", (q) =>
        q
          .eq("accountId", actor.accountId)
          .eq("parentId", parentId)
          .eq("deletedAt", undefined),
      )
      .take(500);
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
    const limit = Math.min(args.limit ?? 200, 300);
    const scopeId =
      args.scopeNodeId && args.scopeNodeId !== "root"
        ? ctx.db.normalizeId("orgNodes", args.scopeNodeId)
        : null;
    const kinds = args.kinds;
    const readLimit = Math.min(limit * (scopeId ? 6 : 2), 600);
    const candidates =
      args.view === "favorites"
        ? await ctx.db
            .query("orgNodes")
            .withIndex("by_account_live_pinned_name", (q) =>
              q
                .eq("accountId", actor.accountId)
                .eq("deletedAt", undefined)
                .eq("pinned", true),
            )
            .take(readLimit)
        : await ctx.db
            .query("orgNodes")
            .withIndex("by_account_live_activity", (q) =>
              q.eq("accountId", actor.accountId).eq("deletedAt", undefined),
            )
            .order("desc")
            .take(readLimit);
    const page: Array<OrgNodeView & { parentPath: string[] }> = [];
    for (const row of candidates) {
      if (page.length >= limit) break;
      if (row.kind === "link" || (kinds && !kinds.includes(row.kind))) continue;
      const ancestors = await breadcrumbNodes(ctx, row);
      if (scopeId && !ancestors.some((ancestor) => ancestor._id === scopeId))
        continue;
      const view = (
        await hydrateNodes(ctx, [row], {
          withSource: true,
          withChildCounts: true,
          accountId: actor.accountId,
        })
      )[0]!;
      if (args.view === "shared" && view.source?.shared !== true) continue;
      page.push({ ...view, parentPath: ancestors.map((node) => node.name) });
    }
    return {
      nodes: page,
      total: page.length,
      hasMore: candidates.length === readLimit,
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
    const roots = await ctx.db
      .query("orgNodes")
      .withIndex("by_account_trash_root", (q) =>
        q.eq("accountId", actor.accountId).eq("isTrashRoot", true),
      )
      .order("desc")
      .take(Math.min(args.limit ?? 100, 500));
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
    if (renamed.kind === "work" && renamed.sourceId) {
      const replica = (await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", ctx.db.normalizeId("spectraArtifacts", renamed.sourceId!)!).eq("kind", "local")).take(1))[0];
      if (replica?.relativePath) {
        const slash = replica.relativePath.lastIndexOf("/");
        await enqueueStructureRequest(ctx, actor.accountId, ctx.db.normalizeId("spectraArtifacts", renamed.sourceId!)!, "rename", replica.relativePath, `${slash >= 0 ? replica.relativePath.slice(0, slash + 1) : ""}${args.name}`, renamed._id);
      }
    }
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
      if (result.kind === "work" && result.sourceId) {
        const workId = ctx.db.normalizeId("spectraArtifacts", result.sourceId);
        const replica = workId ? (await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", workId).eq("kind", "local")).take(1))[0] : null;
        if (workId && replica?.relativePath) {
          const slash = replica.relativePath.lastIndexOf("/");
          await enqueueStructureRequest(ctx, actor.accountId, workId, "move", replica.relativePath, `${slash >= 0 ? replica.relativePath.slice(0, slash + 1) : ""}${result.name}`, result._id);
        }
      }
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
      const sourceWorkId = node.kind === "work" && node.sourceId
        ? ctx.db.normalizeId("spectraArtifacts", node.sourceId)
        : null;
      const replica = sourceWorkId
        ? (await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", sourceWorkId).eq("kind", "local")).take(1))[0]
        : null;
      const sourcePath = replica?.relativePath;
      const trashed = await trashNode(ctx, node);
      if (sourceWorkId && sourcePath) await enqueueStructureRequest(ctx, actor.accountId, sourceWorkId, "delete", sourcePath, undefined, node._id);
      results.push(trashed);
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

const COLLAB_DRAIN_PAGE = 100;

async function drainArtifactCollaboration(
  ctx: MutationCtx,
  artifactId: Id<"spectraArtifacts">,
) {
  for (;;) {
    const rooms = await ctx.db
      .query("collaborationRooms")
      .withIndex("by_artifact_partition", (q) => q.eq("artifactId", artifactId))
      .take(COLLAB_DRAIN_PAGE);
    if (rooms.length === 0) break;
    for (const room of rooms) {
      for (;;) {
        const updates = await ctx.db
          .query("collaborationUpdates")
          .withIndex("by_room_sequence", (q) => q.eq("roomId", room._id))
          .take(COLLAB_DRAIN_PAGE);
        if (updates.length === 0) break;
        for (const row of updates) await ctx.db.delete(row._id);
      }
      for (;;) {
        const snapshots = await ctx.db
          .query("collaborationSnapshots")
          .withIndex("by_room_sequence", (q) => q.eq("roomId", room._id))
          .take(COLLAB_DRAIN_PAGE);
        if (snapshots.length === 0) break;
        for (const row of snapshots) await ctx.db.delete(row._id);
      }
      await ctx.db.delete(room._id);
    }
  }
}

/**
 * One permanent-trash contract for every trashable launch object. Mixed
 * folder/thread/work selections purge atomically with an itemized result, or
 * refuse before any write with a plain sentence.
 */
export const purge = mutation({
  args: { nodeIds: v.array(v.id("orgNodes")) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const roots: OrgNode[] = [];
    for (const nodeId of args.nodeIds) {
      roots.push(await requireOwnNode(ctx, nodeId, actor.accountId));
    }
    const refusal = await refuseTrashedPurge(ctx, roots);
    if (refusal) throw new Error(refusal);
    const workIds = new Set<string>();
    for (const root of roots) {
      const subtree = await subtreeNodes(ctx, root, { includeTrashed: true });
      for (const node of subtree)
        if (node.kind === "work" && node.sourceId) workIds.add(node.sourceId);
    }
    for (const sourceId of workIds) {
      const artifactId = ctx.db.normalizeId("spectraArtifacts", sourceId);
      if (artifactId) await drainArtifactCollaboration(ctx, artifactId);
    }
    return await purgeTrashedNodes(ctx, roots);
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

/** One-time, cursor-shaped repair for rows created before childCount existed. */
export const backfillChildCounts = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("orgNodes").paginate({
      cursor: args.cursor,
      numItems: 100,
    });
    let containers = 0;
    for (const node of page.page) {
      if (!isContainerKind(node.kind)) continue;
      const children = await ctx.db
        .query("orgNodes")
        .withIndex("by_parent", (q) => q.eq("parentId", node._id))
        .collect();
      await ctx.db.patch(node._id, {
        childCount: children.filter((child) => child.deletedAt === undefined)
          .length,
      });
      containers += 1;
    }
    return {
      processed: page.page.length,
      containers,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
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
  includeDetails: boolean,
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
  const visibleArtifact = includeDetails
    ? projected
    : artifactSummaryProjection(projected);
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
    ...visibleArtifact,
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

function summarizeWorkspaceThread(thread: Doc<"spectraThreads">) {
  return {
    _id: thread._id,
    title: thread.title,
    summaryShort: thread.summaryShort,
    origin: thread.origin,
    workspaceId: thread.workspaceId,
    artifactId: thread.artifactId,
    pinned: thread.pinned,
    messageCount: thread.messageCount,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessageAt: thread.lastMessageAt,
    lastRunId: thread.lastRunId,
  };
}

async function readWorkspaceContents(
  ctx: Parameters<typeof requireSpectraActor>[0],
  workspaceId: Id<"spectraWorkspaces">,
  includeDetails = true,
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
      const artifact = await hydrateWorkNode(
        ctx,
        node,
        actor.accountId,
        includeDetails,
      );
      if (artifact) items.push({ ...base, artifact, thread: null });
      continue;
    }
    const threadId = ctx.db.normalizeId("spectraThreads", node.sourceId);
    const thread = threadId ? await ctx.db.get(threadId) : null;
    if (!thread || thread.status === "deleted") continue;
    const run = includeDetails && thread.lastRunId
      ? await ctx.db.get(thread.lastRunId)
      : null;
    items.push({
      ...base,
      artifact: null,
      thread: includeDetails
        ? { ...thread, run }
        : summarizeWorkspaceThread(thread),
    });
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
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    includeDetails: v.optional(v.boolean()),
  },
  handler: (ctx, args) =>
    readWorkspaceContents(
      ctx,
      args.workspaceId,
      args.includeDetails ?? true,
    ),
});

// HTTP query-string ids are untrusted. Normalize before entering a table-typed
// validator so a stale id becomes a controlled miss, not a Convex
// ArgumentValidationError for spectraWorkspaces.
export const listWorkspaceContentsPublic = query({
  args: {
    workspaceId: v.string(),
    includeDetails: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const workspaceId = ctx.db.normalizeId(
      "spectraWorkspaces",
      args.workspaceId,
    );
    if (!workspaceId) return null;
    try {
      return await readWorkspaceContents(
        ctx,
        workspaceId,
        args.includeDetails ?? true,
      );
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
