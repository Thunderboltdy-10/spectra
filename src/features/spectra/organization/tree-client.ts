"use client";

import { useCallback, useMemo } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * The tree's client. Every read here is a live Convex subscription, so a rename
 * or a move lands on every open surface without a refetch — which is what makes
 * identity feel single rather than copied (D40).
 *
 * Nothing in this module caches, polls or reconciles. If a row is wrong, the
 * server is wrong.
 */

export type TreeNode = {
  nodeId: string;
  parentId: string | null;
  kind: "folder" | "workspace" | "work" | "thread" | "link";
  name: string;
  sourceId?: string;
  orderKey: string;
  workspaceContextId?: string;
  pinned: boolean;
  isContainer: boolean;
  childCount?: number;
  createdAt: number;
  updatedAt: number;
  /** When the thing itself last changed — what every recency view orders by. */
  activityAt: number;
  /** The work type, as the board's columns key on it. */
  typeKey?: string;
  trashedAt?: number;
  target?: {
    nodeId: string;
    kind: TreeNode["kind"];
    name: string;
    sourceId?: string;
    available: boolean;
  };
  workspace?: {
    workspaceId: string;
    title: string;
    icon?: string;
    color?: string;
    status: "active" | "archived";
    starterKey?: string;
  };
  source?: {
    blueprintKey?: string;
    title?: string;
    summary?: string;
    updatedAt: number;
    available: boolean;
    owned: boolean;
    shared: boolean;
    aiState?: string;
  };
  /** Present on flat listings (search, quick views) so a row stays locatable. */
  parentPath?: string[];
};

export type QuickViewKey = "recent" | "favorites" | "shared";

export type LiveIdentity = {
  kind: "work" | "thread" | "workspace";
  sourceId: string;
  nodeId: string;
  name: string;
  summary?: string;
  blueprintKey?: string;
  activityAt: number;
  workspaceContextId?: string;
  workspaceTitle?: string;
  pinned: boolean;
};

const EMPTY_LIVE_IDENTITIES: LiveIdentity[] = [];

/** How the board cuts its columns. Mirrors `convex/orgTreeBoard.ts`. */
export type BoardGroupBy = "type" | "workspace" | "updated" | "folder";

/**
 * One column, named but not filled. `identity` is what the column *is*, which is
 * where its colour comes from; `fixes` is what creating into it already decides,
 * so the create affordance asks only for what is still open (CANON D43).
 */
export type BoardColumn = {
  key: string;
  label: string;
  sublabel?: string;
  identity:
    | { kind: "type"; typeKey: string }
    | {
        kind: "workspace";
        workspaceId: string;
        color?: string;
        icon?: string;
      }
    | { kind: "band" }
    | { kind: "folder" }
    | { kind: "loose" };
  openNodeId?: string;
  fixes: { typeKey?: string; parentNodeId?: string | null };
  count?: number;
};

/** A card on the board: a tree row plus the folder it sits in. */
export type BoardCard = TreeNode & { parentName?: string };

const ROOT = "root";
const nodeArg = (parentId: string | null) => (parentId ?? ROOT) as string;

/** The children of one folder, paginated so a 2k-item folder still opens fast. */
export function useTreeChildren(
  parentId: string | null,
  options?: {
    enabled?: boolean;
    pageSize?: number;
    sortKey?: "manual" | "name" | "updated" | "type";
    direction?: "asc" | "desc";
    typeFilter?: string;
  },
) {
  const enabled = options?.enabled ?? true;
  const result = usePaginatedQuery(
    api.orgTree.listChildren,
    enabled
      ? {
          parentId: nodeArg(parentId),
          sortKey: options?.sortKey,
          direction: options?.direction,
          typeFilter: options?.typeFilter,
        }
      : "skip",
    { initialNumItems: options?.pageSize ?? 150 },
  );
  return {
    nodes: result.results as unknown as TreeNode[],
    status: result.status,
    loadMore: result.loadMore,
    isLoading: result.status === "LoadingFirstPage",
  };
}

/** Containers under a parent, for the navigation rail. */
export function useTreeContainers(parentId: string | null, enabled = true) {
  const result = useQuery(
    api.orgTree.listContainers,
    enabled ? { parentId: nodeArg(parentId) } : "skip",
  );
  return (result?.nodes ?? null) as TreeNode[] | null;
}

export function useTreePath(nodeId: string | null) {
  const result = useQuery(
    api.orgTree.path,
    nodeId ? { nodeId } : "skip",
  );
  if (!result) return null;
  return {
    node: result.node as unknown as TreeNode,
    ancestors: result.ancestors as unknown as TreeNode[],
    depth: result.depth,
    maxDepth: result.maxDepth,
  };
}

export function useTreeSearch(
  term: string,
  kinds?: TreeNode["kind"][],
  scopeNodeId?: string | null,
) {
  const trimmed = term.trim();
  const result = useQuery(
    api.orgTree.search,
    trimmed.length >= 2
      ? { term: trimmed, kinds, limit: 60, scopeNodeId: scopeNodeId ?? undefined }
      : "skip",
  );
  return {
    active: trimmed.length >= 2,
    results: (result?.results ?? null) as TreeNode[] | null,
  };
}

export function useTreeQuickView(
  view: QuickViewKey | null,
  kinds?: TreeNode["kind"][],
  scopeNodeId?: string | null,
) {
  const result = useQuery(
    api.orgTree.quickView,
    view
      ? { view, kinds, limit: 300, scopeNodeId: scopeNodeId ?? undefined }
      : "skip",
  );
  return {
    nodes: (result?.nodes ?? null) as TreeNode[] | null,
    total: result?.total ?? 0,
  };
}

export function useTreeTrash(enabled: boolean) {
  const result = useQuery(api.orgTree.listTrash, enabled ? {} : "skip");
  return (result?.nodes ?? null) as TreeNode[] | null;
}

/**
 * The node a work, thread or workspace lives at. A workspace surface needs this
 * to scope itself: the reader picked a workspace, but the tree is addressed by
 * node.
 */
export function useTreePlacement(
  kind: "work" | "thread" | "workspace",
  sourceId: string | null | undefined,
) {
  const result = useQuery(
    api.orgTree.placementForSource,
    sourceId ? { kind, sourceId } : "skip",
  );
  if (!result) return null;
  return {
    node: result.node as unknown as TreeNode,
    ancestors: result.ancestors as unknown as TreeNode[],
  };
}

/** One bounded subscription for the objects already open in the shell. */
export function useLiveOrgIdentities(
  sources: ReadonlyArray<{
    kind: LiveIdentity["kind"];
    sourceId: string;
  }>,
) {
  const boundedSources = useMemo(() => sources.slice(0, 64), [sources]);
  const result = useQuery(
    api.orgTree.liveIdentities,
    boundedSources.length ? { sources: boundedSources } : "skip",
  );
  return result ? (result.identities as LiveIdentity[]) : EMPTY_LIVE_IDENTITIES;
}

/**
 * The columns of a board: what they are called, what colour they carry, what
 * creating into one already decides. Contents are not here — a column's cards
 * are its own paginated query, so naming ten columns costs ten column-shaped
 * reads and not the account (CANON D42).
 */
export function useBoardColumns(
  scopeNodeId: string | null,
  groupBy: BoardGroupBy,
  typeFilter: string,
  enabled = true,
) {
  const result = useQuery(
    api.orgTreeBoard.columns,
    enabled
      ? { scopeNodeId: scopeNodeId ?? ROOT, groupBy, typeFilter }
      : "skip",
  );
  return {
    loading: enabled && result === undefined,
    /** Null when the scope has gone — a deleted workspace, a stale link. */
    missing: result === null,
    scope: (result?.scope ?? null) as TreeNode | null,
    columns: (result?.columns ?? []) as BoardColumn[],
  };
}

/**
 * One column's cards, newest activity first, a page at a time.
 *
 * `now` is passed in frozen by the caller so a recency band's boundary does not
 * slide between pages of the same scroll — a card must not appear twice, or
 * vanish, because the clock moved while the reader was reading.
 */
export function useBoardColumnCards(
  scopeNodeId: string | null,
  groupBy: BoardGroupBy,
  columnKey: string,
  typeFilter: string,
  now: number,
  pageSize = 20,
) {
  const result = usePaginatedQuery(
    api.orgTreeBoard.column,
    {
      scopeNodeId: scopeNodeId ?? ROOT,
      groupBy,
      columnKey,
      typeFilter,
      now,
    },
    { initialNumItems: pageSize },
  );
  return {
    cards: result.results as unknown as BoardCard[],
    status: result.status,
    loadMore: result.loadMore,
    loading: result.status === "LoadingFirstPage",
    /** True while more pages exist, which is what makes a count an `n+`. */
    hasMore: result.status === "CanLoadMore" || result.status === "LoadingMore",
  };
}

/**
 * Every write the organizer can perform. Each one is a single server
 * transaction: the client never sequences a move out of two calls, because a
 * half-applied move is a lost item.
 */
export function useTreeActions() {
  const createFolder = useMutation(api.orgTree.createFolder);
  const rename = useMutation(api.orgTree.rename);
  const move = useMutation(api.orgTree.move);
  const trash = useMutation(api.orgTree.trash);
  const restore = useMutation(api.orgTree.restore);
  const setPinned = useMutation(api.orgTree.setPinned);
  const createReference = useMutation(api.orgTree.createReference);
  const ensureRoots = useMutation(api.orgTree.ensureAccountRoots);
  const createWork = useMutation(api.spectraArtifacts.create);

  return useMemo(
    () => ({
      createFolder: (name: string, parentId: string | null) =>
        createFolder({ name, parentId: nodeArg(parentId) }),
      rename: (nodeId: string, name: string) =>
        rename({ nodeId: nodeId as Id<"orgNodes">, name }),
      move: (
        nodeIds: string[],
        parentId: string | null,
        neighbours?: { beforeSiblingId?: string; afterSiblingId?: string },
      ) =>
        move({
          nodeIds: nodeIds as Id<"orgNodes">[],
          parentId: nodeArg(parentId),
          beforeSiblingId:
            (neighbours?.beforeSiblingId as Id<"orgNodes">) ?? undefined,
          afterSiblingId:
            (neighbours?.afterSiblingId as Id<"orgNodes">) ?? undefined,
        }),
      trash: (nodeIds: string[]) =>
        trash({ nodeIds: nodeIds as Id<"orgNodes">[] }),
      restore: (nodeIds: string[]) =>
        restore({ nodeIds: nodeIds as Id<"orgNodes">[] }),
      setPinned: (nodeId: string, pinned: boolean) =>
        setPinned({ nodeId: nodeId as Id<"orgNodes">, pinned }),
      createReference: (targetNodeId: string, parentId: string | null) =>
        createReference({
          targetNodeId: targetNodeId as Id<"orgNodes">,
          parentId: nodeArg(parentId),
        }),
      ensureRoots: () => ensureRoots({}),
      createWorkHere: (input: {
        blueprintKey: string;
        title: string;
        summary?: string;
        content?: unknown;
        parentId: string | null;
      }) =>
        createWork({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          blueprintKey: input.blueprintKey as any,
          title: input.title,
          summary: input.summary,
          content: input.content,
          source: "manual",
          parentNodeId: (input.parentId ?? ROOT) as Id<"orgNodes"> | "root",
        }),
    }),
    [
      createFolder,
      rename,
      move,
      trash,
      restore,
      setPinned,
      createReference,
      ensureRoots,
      createWork,
    ],
  );
}

/** A stable failure message: the server's reason, or a plain fallback. */
export function useTreeErrorReporter(report: (message: string) => void) {
  return useCallback(
    (error: unknown, fallback: string) => {
      const raw = error instanceof Error ? error.message : "";
      /* Convex prefixes thrown messages; the sentence we wrote is what a reader
         needs, not the frame around it. */
      const match = raw.match(/Uncaught Error:\s*([^\n]+)/);
      report((match?.[1] ?? raw ?? "").trim() || fallback);
    },
    [report],
  );
}
