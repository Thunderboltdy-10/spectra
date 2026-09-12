import type { Id } from "./_generated/dataModel";
import { requireSpectraActor } from "./spectraShared";
import {
  ARTIFACT_SUMMARY_READ_MODEL_VERSION,
  artifactSummaryProjection,
  artifactSummaryFor,
  isContainerKind,
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
  /** For links: what they point at, resolved for display. */
  target?: {
    nodeId: Id<"orgNodes">;
    kind: OrgNode["kind"];
    name: string;
    sourceId?: string;
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
  };
};

type ViewCtx = Parameters<typeof requireSpectraActor>[0];
const SHARED_RESOURCE_BATCH_LIMIT = 1_000;

/**
 * Every resource this account has shared out, in two indexed queries rather than
 * one per row: a "Shared" quick view over a thousand rows must not cost a
 * thousand reads.
 */
export async function sharedByActor(
  ctx: ViewCtx,
  accountId: Id<"accounts">,
) {
  const shared = new Set<string>();
  const now = Date.now();
  for (const status of ["pending", "accepted"] as const) {
    const rows = await ctx.db
      .query("shareInvitations")
      .withIndex("by_inviter_status", (q) =>
        q.eq("inviterAccountId", accountId).eq("status", status),
      )
      .take(SHARED_RESOURCE_BATCH_LIMIT);
    for (const row of rows)
      if (!row.expiresAt || row.expiresAt > now) shared.add(row.resourceId);
  }
  return shared;
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
  const views: OrgNodeView[] = [];
  const sharedOut =
    options?.withSource && options.accountId
      ? await sharedByActor(ctx, options.accountId)
      : null;
  for (const node of nodes) {
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
            }
          | undefined;
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
    views.push(view);
  }
  return views;
}
