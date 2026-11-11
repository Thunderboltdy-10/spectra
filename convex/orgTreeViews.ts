import type { Id } from "./_generated/dataModel";
import { requireSpectraActor } from "./spectraShared";
import {
  ARTIFACT_SUMMARY_READ_MODEL_VERSION,
  artifactSummaryProjection,
  artifactSummaryFor,
  isContainerKind,
  sharesWithWorkspace,
  workspaceIsClass,
  type OrgNode,
} from "./orgTreeShared";

/**
 * How a tree row is presented — one implementation, used by every read of the
 * tree (CANON D41).
 *
 * The shape exists so a row can be drawn from a single query result. A surface
 * that had to fetch a work record per row would be N+1 queries deep and would
 * flash the wrong icon and title while it waited, so the type it needs travels
 * with it: the cached name, the source's own title and activity, whether it is
 * shared, and for containers how much is inside.
 */

export type OrgNodeView = {
  nodeId: Id<"orgNodes">;
  parentId: Id<"orgNodes"> | null;
  kind: OrgNode["kind"];
  name: string;
  sourceId?: string;
  orderKey: string;
  workspaceContextId?: Id<"spectraWorkspaces">;
  pinned: boolean;
  isContainer: boolean;
  childCount?: number;
  createdAt: number;
  updatedAt: number;
  /** When the thing itself last changed, which is what recency views order by. */
  activityAt: number;
  /** The work type, as the board's columns key on it. */
  typeKey?: string;
  trashedAt?: number;
  /** The shelf stack this work is gathered into, if any. */
  stackId?: string;
  /** A work in a workspace that its people can see; absent, it is private to its author. */
  sharedWithWorkspace?: boolean;
  /** For links: what they point at, resolved for display. */
  target?: {
    nodeId: Id<"orgNodes">;
    kind: OrgNode["kind"];
    name: string;
    sourceId?: string;
    /** The work type a linked work is, so its card draws as that work. */
    typeKey?: string;
    available: boolean;
  };
  /** Workspace nodes carry their own state so a row can render without a join. */
  workspace?: {
    workspaceId: Id<"spectraWorkspaces">;
    title: string;
    icon?: string;
    color?: string;
    status: "active" | "archived";
    starterKey?: string;
    /** Whether the workspace is a class, as chosen or from where it came. */
    isClass: boolean;
  };
  /**
   * Enough of a work's or thread's own record to draw its row — type, activity,
   * whether it is shared.
   */
  source?: {
    blueprintKey?: string;
    title?: string;
    summary?: string;
    updatedAt: number;
    available: boolean;
    /** False when the row points at somebody else's work shared with you. */
    owned: boolean;
    shared: boolean;
    aiState?: string;
    /** Kept on one computer, so it opens only where that computer's Bridge answers. */
    storageHome?: "device";
    storageStoreId?: string;
  };
};

type ViewCtx = Parameters<typeof requireSpectraActor>[0];

/**
 * Check only the work resources in this page. Scanning the account's first
 * thousand pending and accepted invitations on every tree page made a normal
 * Library read scale with unrelated shares elsewhere in the account.
 */
export async function sharedByActor(
  ctx: ViewCtx,
  accountId: Id<"accounts">,
  resourceIds: string[],
) {
  const uniqueResourceIds = [...new Set(resourceIds)];
  let now: number | undefined;
  const rows = await Promise.all(
    uniqueResourceIds.map(async (resourceId) => {
      const activeInvitations = await Promise.all(
        (["pending", "accepted"] as const).map(async (status) => {
          const invitations = ctx.db
            .query("shareInvitations")
            .withIndex("by_resource_inviter_status", (q) =>
              q
                .eq("resourceType", "artifact")
                .eq("resourceId", resourceId)
                .eq("inviterAccountId", accountId)
                .eq("status", status),
            );
          for await (const invitation of invitations) {
            if (invitation.expiresAt === undefined || invitation.expiresAt > (now ??= Date.now()))
              return invitation;
          }
          return null;
        }),
      );
      return activeInvitations.some(Boolean) ? resourceId : null;
    }),
  );
  return new Set(rows.filter((resourceId): resourceId is string => Boolean(resourceId)));
}

export function baseView(node: OrgNode): OrgNodeView {
  return {
    nodeId: node._id,
    parentId: node.parentId,
    kind: node.kind,
    name: node.name,
    sourceId: node.sourceId,
    orderKey: node.orderKey,
    workspaceContextId: node.workspaceContextId,
    pinned: node.pinned === true,
    isContainer: isContainerKind(node.kind),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    /* Rows written before the field existed fall back to their placement time,
       which is the best fact available and keeps them orderable. */
    activityAt: node.activityAt ?? node.updatedAt,
    typeKey: node.typeKey,
    trashedAt: node.deletedAt,
    stackId: node.stackId,
    sharedWithWorkspace:
      node.kind === "work" && node.workspaceContextId && sharesWithWorkspace(node) ? true : undefined,
  };
}

export async function hydrateNodes(
  ctx: ViewCtx,
  nodes: OrgNode[],
  options?: {
    withChildCounts?: boolean;
    withSource?: boolean;
    accountId?: Id<"accounts">;
  },
) {
  const workSourceIds = nodes
    .filter((node) => node.kind === "work" && Boolean(node.sourceId))
    .map((node) => node.sourceId!);
  const sharedOutPromise =
    options?.withSource && options.accountId && workSourceIds.length > 0
      ? sharedByActor(ctx, options.accountId, workSourceIds)
      : Promise.resolve<Set<string> | null>(null);

  return Promise.all(nodes.map(async (node) => {
    const view = baseView(node);
    if (node.kind === "workspace" && node.sourceId) {
      const workspaceId = ctx.db.normalizeId(
        "spectraWorkspaces",
        node.sourceId,
      );
      const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
      if (workspace)
        view.workspace = {
          workspaceId: workspace._id,
          title: workspace.title,
          icon: workspace.icon,
          color: workspace.color,
          status: workspace.status,
          starterKey: workspace.starterKey,
          isClass: workspaceIsClass(workspace),
        };
    }
    if (node.kind === "link" && node.sourceId) {
      const targetId = ctx.db.normalizeId("orgNodes", node.sourceId);
      const target = targetId ? await ctx.db.get(targetId) : null;
      view.target = target
        ? {
            nodeId: target._id,
            kind: target.kind,
            name: target.name,
            sourceId: target.sourceId,
            typeKey: target.typeKey,
            available: target.deletedAt === undefined,
          }
        : undefined;
    }
    if (options?.withChildCounts && isContainerKind(node.kind)) {
      view.childCount = node.childCount ?? 0;
    }
    if (options?.withSource && node.sourceId) {
      if (node.kind === "work") {
        const artifactId = ctx.db.normalizeId(
          "spectraArtifacts",
          node.sourceId,
        );
        const summary = artifactId
          ? await artifactSummaryFor(ctx, artifactId)
          : null;
        const summaryIsCurrent =
          summary?.readModelVersion === ARTIFACT_SUMMARY_READ_MODEL_VERSION;
        let artifact = summaryIsCurrent
          ? (summary?.projection as
              | {
                  blueprintKey?: string;
                  title?: string;
                  summary?: string;
                  updatedAt?: number;
                  status?: string;
                  aiState?: string;
                }
              | undefined)
          : undefined;
        let ownerAccountId = summaryIsCurrent
          ? summary?.ownerAccountId
          : undefined;
        let status = summaryIsCurrent ? summary?.status : undefined;
        if (!summaryIsCurrent && artifactId) {
          // A bounded mixed-record fallback keeps old/missing rows safe while
          // the versioned backfill catches up. A missing canonical row is
          // rendered as unavailable rather than inferred as live.
          const canonical = await ctx.db.get(artifactId);
          if (canonical) {
            artifact = artifactSummaryProjection(canonical);
            ownerAccountId = canonical.ownerAccountId;
            status = canonical.status;
          }
        }
        const artifactProjection = artifact as
          | {
              blueprintKey?: string;
              title?: string;
              summary?: string;
              updatedAt?: number;
              aiState?: string;
              storageHome?: "device";
              storageStoreId?: string;
            }
          | undefined;
        const sharedOut = await sharedOutPromise;
        view.source = {
          blueprintKey:
            (summaryIsCurrent ? summary?.blueprintKey : undefined) ??
            artifactProjection?.blueprintKey ??
            node.typeKey,
          title: artifactProjection?.title ?? node.name,
          summary: artifactProjection?.summary,
          updatedAt:
            artifactProjection?.updatedAt ?? node.activityAt ?? node.updatedAt,
          available: status !== undefined ? status !== "deleted" : false,
          owned: ownerAccountId
            ? ownerAccountId === node.accountId
            : node.accessProjection !== true,
          shared:
            (ownerAccountId !== undefined && ownerAccountId !== node.accountId) ||
            sharedOut?.has(node.sourceId) === true,
          aiState: artifactProjection?.aiState,
          ...(artifactProjection?.storageHome
            ? { storageHome: artifactProjection.storageHome, storageStoreId: artifactProjection.storageStoreId }
            : {}),
        };
      } else if (node.kind === "thread") {
        const threadId = ctx.db.normalizeId("spectraThreads", node.sourceId);
        const thread = threadId ? await ctx.db.get(threadId) : null;
        view.source = {
          title: thread?.title,
          summary: thread?.summaryShort,
          updatedAt: thread?.updatedAt ?? node.updatedAt,
          available: Boolean(thread) && thread?.status !== "deleted",
          owned: thread?.ownerAccountId === node.accountId,
          shared: false,
        };
      }
    }
    return view;
  }));
}
