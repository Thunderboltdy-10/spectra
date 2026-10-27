"use client";

import { useCallback, useMemo } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import { useAuthedArgs } from "../data/use-authed-args";
import { identityFailureMessage } from "@/components/ui/truthful-state";

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
  /** The work type, as the type filter keys on it. */
  typeKey?: string;
  trashedAt?: number;
  /** The shelf stack this work is gathered into, if any. */
  stackId?: string;
  /** A work in a workspace that its people can see; absent, it is private to its author. */
  sharedWithWorkspace?: boolean;
  target?: {
    nodeId: string;
    kind: TreeNode["kind"];
    name: string;
    sourceId?: string;
    /** A linked work's type, so its card draws as that work. */
    typeKey?: string;
    available: boolean;
  };
  workspace?: {
    workspaceId: string;
    title: string;
    icon?: string;
    color?: string;
    status: "active" | "archived";
    starterKey?: string;
    isClass?: boolean;
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
    /** Leave threads out: they live behind the Threads button. */
    withoutThreads?: boolean;
  },
) {
  const enabled = options?.enabled ?? true;
  const result = usePaginatedQuery(
    api.orgTree.listChildren,
    useAuthedArgs(
      enabled
        ? {
            parentId: nodeArg(parentId),
            sortKey: options?.sortKey,
            direction: options?.direction,
            typeFilter: options?.typeFilter,
            withoutThreads: options?.withoutThreads,
          }
        : "skip",
    ),
    { initialNumItems: options?.pageSize ?? 50 },
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
  const result = usePaginatedQuery(
    api.orgTree.containersPage,
    useAuthedArgs(enabled ? { parentId: nodeArg(parentId) } : "skip"),
    { initialNumItems: 50 },
  );
  return {
    nodes: result.results as unknown as TreeNode[],
    status: result.status,
    loadMore: result.loadMore,
  };
}

export function useTreePath(nodeId: string | null) {
  const result = useQuery(
    api.orgTree.path,
    useAuthedArgs(nodeId ? { nodeId } : "skip"),
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
  typeFilter?: string,
) {
  const trimmed = term.trim();
  const result = usePaginatedQuery(
    api.orgTree.searchPage,
    useAuthedArgs(
      trimmed.length >= 2
        ? {
            term: trimmed,
            kinds,
            typeFilter,
            scopeNodeId: scopeNodeId ?? undefined,
          }
        : "skip",
    ),
    { initialNumItems: 50 },
  );
  return {
    active: trimmed.length >= 2,
    results: result.results as unknown as TreeNode[],
    status: result.status,
    loadMore: result.loadMore,
  };
}

export function useTreeQuickView(
  view: QuickViewKey | null,
  kinds?: TreeNode["kind"][],
  scopeNodeId?: string | null,
  typeFilter?: string,
) {
  const result = usePaginatedQuery(
    api.orgTree.quickViewPage,
    useAuthedArgs(
      view
        ? { view, kinds, typeFilter, scopeNodeId: scopeNodeId ?? undefined }
        : "skip",
    ),
    { initialNumItems: 50 },
  );
  return {
    nodes: result.results as unknown as TreeNode[],
    status: result.status,
    loadMore: result.loadMore,
  };
}

export function useTreeTrash(enabled: boolean) {
  const result = useQuery(
    api.orgTree.listTrash,
    useAuthedArgs(enabled ? {} : "skip"),
  );
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
    useAuthedArgs(sourceId ? { kind, sourceId } : "skip"),
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
    useAuthedArgs(
      boundedSources.length ? { sources: boundedSources } : "skip",
    ),
  );
  return result ? (result.identities as LiveIdentity[]) : EMPTY_LIVE_IDENTITIES;
}

/** Library transactions have no durable offline queue. Reject before enqueueing. */
function useOnlineTreeMutation<Mutation extends FunctionReference<"mutation">>(
  reference: Mutation,
) {
  const mutation = useMutation(reference);
  return useCallback((...args: Parameters<typeof mutation>) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return Promise.reject(new Error("This device is offline. Reconnect, then retry this Library change."));
    }
    return mutation(...args);
  }, [mutation]);
}

/**
 * Every write the organizer can perform. Each one is a single server
 * transaction: the client never sequences a move out of two calls, because a
 * half-applied move is a lost item.
 */
export function useTreeActions() {
  const createFolder = useOnlineTreeMutation(api.orgTree.createFolder);
  const rename = useOnlineTreeMutation(api.orgTree.rename);
  const move = useOnlineTreeMutation(api.orgTree.move);
  const trash = useOnlineTreeMutation(api.orgTree.trash);
  const restore = useOnlineTreeMutation(api.orgTree.restore);
  const purge = useOnlineTreeMutation(api.orgTree.purge);
  const setPinned = useOnlineTreeMutation(api.orgTree.setPinned);
  const createReference = useOnlineTreeMutation(api.orgTree.createReference);
  const ensureRoots = useOnlineTreeMutation(api.orgTree.ensureAccountRoots);
  const createWork = useOnlineTreeMutation(api.spectraArtifacts.create);

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
      purge: (nodeIds: string[]) =>
        purge({ nodeIds: nodeIds as Id<"orgNodes">[] }),
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
      purge,
      setPinned,
      createReference,
      ensureRoots,
      createWork,
    ],
  );
}

/**
 * LIBRARY_* codes are organizer/command preconditions, never connectivity.
 * Map them the same way describeFailure maps AUTH_* — raw codes must not reach
 * toasts or agent outcomes as the only user-visible text.
 */
function libraryFailureMessage(raw: string): string | null {
  if (/LIBRARY_FOLDER_NAME_REQUIRED/i.test(raw))
    return "Enter a folder name first.";
  if (/LIBRARY_TARGETS_REQUIRED/i.test(raw)) return "Select something first.";
  if (/LIBRARY_RENAME_PARAMS_REQUIRED/i.test(raw))
    return "Choose one item and enter a new name.";
  if (/LIBRARY_DESTINATION_REQUIRED/i.test(raw))
    return "Choose where to put it.";
  if (/\bLIBRARY_[A-Z0-9_]+\b/.test(raw))
    return "Could not update the Library. Try again.";
  return null;
}

/** A stable failure message: the server's reason, or a plain fallback. */
export function treeFailureMessage(error: unknown, fallback: string) {
  /* The sentence we wrote, from the ConvexError data production keeps. A
     redacted frame with no words reads as empty; use the fallback. */
  const message = error instanceof Error ? readConvexError(error).message : "";
  /* AUTH_* identity codes must win over LIBRARY_* if a frame ever carries both
     (LIBRARY catch-all must not mask sign-in / school membership failures). */
  return (
    identityFailureMessage(message) ??
    libraryFailureMessage(message) ??
    (message || fallback)
  );
}

export function useTreeErrorReporter(report: (message: string) => void) {
  return useCallback(
    (error: unknown, fallback: string) => {
      report(treeFailureMessage(error, fallback));
    },
    [report],
  );
}
