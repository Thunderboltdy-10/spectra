import { query } from "./functions";
import { internalMutation, mutation } from "./orgNodeMutation";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  normalizeArtifactId,
  requireArtifactCapability,
  requireSpectraActor,
  requireWorkspaceCapability,
} from "./spectraShared";
import {
  evaluateAccess,
  evaluateArtifactAccessForActor,
  evaluateArtifactAccessForActorWithSummary,
  evaluateAccessForActorWithLoadedResource,
} from "./authorityShared";
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
  ARTIFACT_SUMMARY_READ_MODEL_VERSION,
  artifactSummaryFor,
  artifactSummaryProjection,
  type OrgNode,
} from "./orgTreeShared";
import { hydrateNodes, type OrgNodeView } from "./orgTreeViews";
import { orgNodeCountByWorkspace } from "./orgNodeAggregates";
import { enqueueStructureRequest } from "./bridgeStructure";
import { treePagination } from "./orgTreePagination";

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

const MAX_ORG_TREE_PAGE_SIZE = 50;

/**
 * The on-disk path a Library name maps to for a Bridge-mirrored file: same
 * folder, same extension, the node's (already validated) name as the stem.
 * Using the bare name dropped the extension ("Essay.docx" → "Essay draft"),
 * which left the file unopenable by its app. Null when nothing would change.
 */
function mirroredReplicaPath(currentPath: string, name: string) {
  const slash = currentPath.lastIndexOf("/");
  const folder = slash >= 0 ? currentPath.slice(0, slash + 1) : "";
  const base = currentPath.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 ? base.slice(dot) : "";
  let stem = name.trim();
  if (extension && stem.toLowerCase().endsWith(extension.toLowerCase()))
    stem = stem.slice(0, -extension.length);
  /* Windows drops trailing dots and spaces from a file name. */
  stem = stem.replace(/[. ]+$/, "");
  if (!stem) return null;
  const target = `${folder}${stem}${extension}`;
  return target === currentPath ? null : target;
}

async function resolveParentId(
  ctx: Parameters<typeof requireSpectraActor>[0],
  raw: string | undefined | null,
) {
  if (raw === undefined || raw === null || raw === "" || raw === "root")
    return null;
  return ctx.db.normalizeId("orgNodes", raw);
}

/* -------------------------------------------------------------------- reads */

type ChildOrder = "order" | "name" | "activity";

/**
 * The live children of a parent through the index for their order. Grouped by
 * type when asked, narrowed to one type when a filter names it.
 */
function liveChildren(
  ctx: QueryCtx,
  { accountId, parentId, order, byType, typeFilter }: {
    accountId: Doc<"orgNodes">["accountId"];
    parentId: Doc<"orgNodes">["parentId"];
    order: ChildOrder;
    byType: boolean;
    typeFilter: string | null;
  },
) {
  const nodes = ctx.db.query("orgNodes");
  if (byType) {
    if (order === "name")
      return nodes.withIndex("by_account_parent_live_type_name", (q) => {
        const parent = q.eq("accountId", accountId).eq("parentId", parentId).eq("deletedAt", undefined);
        return typeFilter === null ? parent : parent.eq("typeKey", typeFilter);
      });
    if (order === "activity")
      return nodes.withIndex("by_account_parent_live_type_activity", (q) => {
        const parent = q.eq("accountId", accountId).eq("parentId", parentId).eq("deletedAt", undefined);
        return typeFilter === null ? parent : parent.eq("typeKey", typeFilter);
      });
    return nodes.withIndex("by_account_parent_live_type_order", (q) => {
      const parent = q.eq("accountId", accountId).eq("parentId", parentId).eq("deletedAt", undefined);
      return typeFilter === null ? parent : parent.eq("typeKey", typeFilter);
    });
  }
  if (order === "name")
    return nodes.withIndex("by_account_parent_live_name", (q) =>
      q.eq("accountId", accountId).eq("parentId", parentId).eq("deletedAt", undefined),
    );
  if (order === "activity")
    return nodes.withIndex("by_account_parent_live_activity", (q) =>
      q.eq("accountId", accountId).eq("parentId", parentId).eq("deletedAt", undefined),
    );
  return nodes.withIndex("by_account_parent_live_order", (q) =>
    q.eq("accountId", accountId).eq("parentId", parentId).eq("deletedAt", undefined),
  );
}

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
    withoutThreads: v.optional(v.boolean()),
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
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(args.paginationOpts.numItems, MAX_ORG_TREE_PAGE_SIZE),
    };
    const live = (order: ChildOrder, byType = typeFilter !== null) =>
      liveChildren(ctx, { accountId: actor.accountId, parentId, order, byType, typeFilter });
    const ordered = args.includeTrashed
      ? ctx.db
          .query("orgNodes")
          .withIndex("by_account_parent_order", (q) =>
            q.eq("accountId", actor.accountId).eq("parentId", parentId),
          )
      : sortKey === "updated"
        ? live("activity").order(direction)
        : sortKey === "name" || sortKey === "type"
          ? live("name", typeFilter !== null || sortKey === "type").order(direction)
          : live("order");
    // Threads live behind the Threads button, not among the work (LIBRARY.md).
    const result = await (args.withoutThreads
      ? ordered.filter((q) => q.neq(q.field("kind"), "thread"))
      : ordered
    ).paginate(paginationOpts);
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

/** Validate a requested subtree before reading any candidates. */
async function pageScope(
  ctx: Parameters<typeof requireSpectraActor>[0],
  accountId: Id<"accounts">,
  raw?: string | null,
) {
  if (!raw || raw === "root") return null;
  const id = ctx.db.normalizeId("orgNodes", raw);
  const node = id ? await ctx.db.get(id) : null;
  if (!node || node.accountId !== accountId || node.deletedAt !== undefined || !isContainerKind(node.kind))
    throw new Error("This folder is no longer available.");
  return node._id;
}

/** Visible rail branches paginate raw siblings, including empty filtered pages. */
export const containersPage = query({
  args: {
    parentId: v.optional(v.union(v.string(), v.null())),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const parentId = await pageScope(ctx, actor.accountId, args.parentId);
    const paging = treePagination(args.paginationOpts, ["containers", actor.accountId, parentId]);
    const result = await ctx.db.query("orgNodes")
      .withIndex("by_account_parent_live_order", (q) => q.eq("accountId", actor.accountId).eq("parentId", parentId).eq("deletedAt", undefined))
      .paginate(paging.options);
    return paging.result({ ...result, page: await hydrateNodes(ctx, result.page.filter((row) => isContainerKind(row.kind)), {
      withChildCounts: true, withSource: true, accountId: actor.accountId,
    }) });
  },
});

/** Ranked name search with a resumable, bounded candidate scan. */
export const searchPage = query({
  args: {
    term: v.string(),
    kinds: v.optional(v.array(vNodeKind)),
    scopeNodeId: v.optional(v.union(v.string(), v.null())),
    typeFilter: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const scopeId = await pageScope(ctx, actor.accountId, args.scopeNodeId);
    const term = args.term.trim();
    if (!term) return { page: [], isDone: true, continueCursor: "" };
    const paging = treePagination(args.paginationOpts, ["search", actor.accountId, scopeId, term, args.kinds ?? null, args.typeFilter ?? "all"]);
    const result = await ctx.db.query("orgNodes")
      .withSearchIndex("search_name", (q) => q.search("name", term).eq("accountId", actor.accountId))
      .paginate(paging.options);
    const page: Array<OrgNodeView & { parentPath: string[] }> = [];
    for (const row of result.page) {
      if (row.deletedAt !== undefined || (args.kinds && !args.kinds.includes(row.kind))) continue;
      if (args.typeFilter && args.typeFilter !== "all" && row.typeKey !== args.typeFilter) continue;
      const ancestors = await breadcrumbNodes(ctx, row);
      if (scopeId && !ancestors.some((node) => node._id === scopeId)) continue;
      const view = (await hydrateNodes(ctx, [row], { withChildCounts: true, withSource: true, accountId: actor.accountId }))[0];
      if (view) page.push({ ...view, parentPath: ancestors.map((node) => node.name) });
    }
    return paging.result({ ...result, page });
  },
});

/** Quick views share the same continuation semantics as folders and search. */
export const quickViewPage = query({
  args: {
    view: v.union(v.literal("recent"), v.literal("favorites"), v.literal("shared")),
    kinds: v.optional(v.array(vNodeKind)),
    scopeNodeId: v.optional(v.union(v.string(), v.null())),
    typeFilter: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const scopeId = await pageScope(ctx, actor.accountId, args.scopeNodeId);
    const paging = treePagination(args.paginationOpts, ["quick", actor.accountId, scopeId, args.view, args.kinds ?? null, args.typeFilter ?? "all"]);
    const result = args.view === "favorites"
      ? await ctx.db.query("orgNodes")
        .withIndex("by_account_live_pinned_name", (q) => q.eq("accountId", actor.accountId).eq("deletedAt", undefined).eq("pinned", true))
        .paginate(paging.options)
      : await ctx.db.query("orgNodes")
        .withIndex("by_account_live_activity", (q) => q.eq("accountId", actor.accountId).eq("deletedAt", undefined))
        .order("desc").paginate(paging.options);
    const page: Array<OrgNodeView & { parentPath: string[] }> = [];
    for (const row of result.page) {
      if (row.kind === "link" || (args.kinds && !args.kinds.includes(row.kind))) continue;
      if (args.typeFilter && args.typeFilter !== "all" && row.typeKey !== args.typeFilter) continue;
      const ancestors = await breadcrumbNodes(ctx, row);
      if (scopeId && !ancestors.some((node) => node._id === scopeId)) continue;
      const view = (await hydrateNodes(ctx, [row], { withChildCounts: true, withSource: true, accountId: actor.accountId }))[0];
      if (!view || (args.view === "shared" && view.source?.shared !== true)) continue;
      if (row.kind === "work" && row.sourceId && !(view.source?.available && view.source.owned)) {
        const artifactId = normalizeArtifactId(ctx, row.sourceId);
        const access = artifactId
          ? await evaluateArtifactAccessForActor(ctx, actor, artifactId)
          : null;
        if (
          !view.source?.available ||
          !access?.allowed ||
          !access.capabilities.includes("read")
        )
          continue;
      }
      page.push({ ...view, parentPath: ancestors.map((node) => node.name) });
    }
    return paging.result({ ...result, page });
  },
});

/** The Library row that places each named work; ids that are not works are left out. */
export const rowsForWorks = query({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const rows: Record<string, string> = {};
    for (const id of new Set(args.ids.slice(0, 200))) {
      const workId = ctx.db.normalizeId("spectraArtifacts", id);
      const node = workId ? await findPrimaryNode(ctx, actor.accountId, "work", workId) : null;
      if (node) rows[id] = node._id;
    }
    return rows;
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
      const target = replica?.relativePath ? mirroredReplicaPath(replica.relativePath, renamed.name) : null;
      if (replica?.relativePath && target)
        await enqueueStructureRequest(ctx, actor.accountId, ctx.db.normalizeId("spectraArtifacts", renamed.sourceId!)!, "rename", replica.relativePath, target, renamed._id);
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
        /* A Library move keeps the file in its folder on disk; it only
           mirrors a name that differs from the file's. */
        const target = replica?.relativePath ? mirroredReplicaPath(replica.relativePath, result.name) : null;
        if (workId && replica?.relativePath && target)
          await enqueueStructureRequest(ctx, actor.accountId, workId, "move", replica.relativePath, target, result._id);
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
      /* Only a work that just entered Trash asks for its file: trashing one
         already there (a stale second tab, a retried request) changes
         nothing, so it must not queue another deletion of the file. */
      if (sourceWorkId && sourcePath && trashed.trashed > 0) await enqueueStructureRequest(ctx, actor.accountId, sourceWorkId, "delete", sourcePath, undefined, node._id);
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
      await withdrawFileDeletion(ctx, node);
    }
    return { restored: results };
  },
});

/**
 * Restoring a Bridge-linked work keeps its file. A deletion still waiting for
 * approval or for the device is withdrawn, so the Recycle Bin prompt (or the
 * device) no longer removes the file of a work that is back in the Library.
 * A deletion the device has already claimed or done is left as it is.
 */
async function withdrawFileDeletion(ctx: MutationCtx, node: Doc<"orgNodes">) {
  const workId = node.kind === "work" && node.sourceId
    ? ctx.db.normalizeId("spectraArtifacts", node.sourceId)
    : null;
  if (!workId) return;
  const requests = await ctx.db
    .query("bridgeFsRequests")
    .withIndex("by_work_created", (q) => q.eq("workId", workId))
    .order("desc")
    .take(50);
  const now = Date.now();
  for (const request of requests) {
    if (request.kind !== "delete") continue;
    if (request.state !== "approval-required" && request.state !== "pending") continue;
    await ctx.db.patch(request._id, {
      state: "ignored",
      explanation: "The work was restored from Trash, so its file stays on disk.",
      updatedAt: now,
    });
  }
}

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

/** How many works and threads each workspace holds, however deep they sit in its folders. */
export const workspaceTallies = query({
  args: { workspaceIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const ids = [...new Set(args.workspaceIds)].slice(0, 60);
    if (!ids.length) return {};
    const counts = await orgNodeCountByWorkspace.countBatch(
      ctx,
      ids.flatMap((id) => [
        { namespace: actor.accountId, bounds: { prefix: ["live-card", id] as [string, string] } },
        { namespace: actor.accountId, bounds: { prefix: ["live-card", id, "thread"] as [string, string, string] } },
        { namespace: actor.accountId, bounds: { prefix: ["live-card", id, "link"] as [string, string, string] } },
      ]),
    );
    return Object.fromEntries(
      ids.map((id, index) => {
        const all = counts[index * 3] ?? 0;
        const threads = counts[index * 3 + 1] ?? 0;
        const links = counts[index * 3 + 2] ?? 0;
        return [id, { artifacts: Math.max(0, all - threads - links), threads }];
      }),
    ) as Record<string, { artifacts: number; threads: number }>;
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
  actor: Awaited<ReturnType<typeof requireSpectraActor>>,
  includeDetails: boolean,
) {
  const artifactId = normalizeArtifactId(ctx, node.sourceId ?? "");
  if (!artifactId) return null;
  let summary: Awaited<ReturnType<typeof artifactSummaryFor>> = null;
  let artifact: Doc<"spectraArtifacts"> | null = null;
  let decision:
    | Awaited<ReturnType<typeof evaluateArtifactAccessForActor>>
    | Awaited<ReturnType<typeof evaluateAccess>>;
  let visibleArtifact: Record<string, unknown>;

  if (includeDetails) {
    // An opened workspace item is an explicit content read. Keep the rich
    // editor/detail path unchanged, but reuse this one row for authority.
    artifact = await ctx.db.get(artifactId);
    const resourceType =
      artifact?.blueprintKey === "agent" ? ("agent" as const) : ("artifact" as const);
    decision = await evaluateAccessForActorWithLoadedResource(
      ctx,
      actor,
      resourceType,
      artifactId,
      artifact
        ? {
            resource: artifact,
            ownerAccountId: artifact.ownerAccountId,
            schoolId: artifact.schoolId,
            lifecycle: artifact.status,
          }
        : null,
    );
    if (!decision.allowed) return null;
    if (!artifact) return null;
    if (artifact.status === "deleted") return null;
    const projected = decision.level
      ? projectArtifactForAccess(artifact, decision.level)
      : artifact;
    visibleArtifact = projected;
  } else {
    // Workspace overview/list requests use the compact authority row. They do
    // not decode content, protected bases, Yjs snapshots or native payloads.
    summary = await artifactSummaryFor(ctx, artifactId);
    if (summary?.readModelVersion === ARTIFACT_SUMMARY_READ_MODEL_VERSION) {
      const resourceType =
        summary.blueprintKey === "agent" ? ("agent" as const) : ("artifact" as const);
      decision = await evaluateArtifactAccessForActorWithSummary(
        ctx,
        actor,
        artifactId,
        resourceType,
        summary,
      );
      if (!decision.allowed) return null;
      visibleArtifact = summary.projection;
    } else {
      // Bounded mixed-record fallback: old/missing summaries may hydrate once
      // while the migration catches up, then the next read is small. Reuse the
      // same canonical row for authority and projection so this branch is one
      // payload read, not a fallback read plus a second permission read.
      artifact = await ctx.db.get(artifactId);
      if (!artifact || artifact.status === "deleted") return null;
      const resourceType =
        artifact.blueprintKey === "agent" ? ("agent" as const) : ("artifact" as const);
      decision = await evaluateAccessForActorWithLoadedResource(
        ctx,
        actor,
        resourceType,
        artifactId,
        {
          resource: artifact,
          ownerAccountId: artifact.ownerAccountId,
          schoolId: artifact.schoolId,
          lifecycle: artifact.status,
        },
      );
      if (!decision.allowed) return null;
      visibleArtifact = artifactSummaryProjection(artifact);
    }
  }
  const authority = decision.loaded;
  if (!authority) return null;
  const authorityResource = authority.resource;
  const authorityBlueprintKey =
    "blueprintKey" in authorityResource ? authorityResource.blueprintKey : undefined;
  const ownership =
    authority.ownerAccountId === actor.accountId
      ? ("owned" as const)
      : ("shared" as const);
  const resourceType =
    authorityBlueprintKey === "agent" ? ("agent" as const) : ("artifact" as const);
  const invitations = await ctx.db
    .query("shareInvitations")
    .withIndex("by_resource", (q) =>
      q.eq("resourceType", resourceType).eq("resourceId", artifactId),
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
        actor,
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
      mayShare: capabilities.includes("share"),
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
