import { query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireSpectraActor } from "./spectraShared";
import { isContainerKind, type OrgNode } from "./orgTreeShared";
import { hydrateNodes, type OrgNodeView } from "./orgTreeViews";

/**
 * The board, as windows.
 *
 * A board is a set of columns, and a column is a question with an answer that
 * arrives a page at a time: "the twenty most recently touched quizzes in this
 * workspace", not "every node in the account, regrouped in the browser". That
 * distinction is the whole file (CANON D42, ARCHITECTURE-STORAGE §12). The
 * previous implementation collected the account — up to 800 hydrated rows — to
 * draw a screen that shows perhaps thirty cards, which was slow, unbounded, and
 * billed to the reader.
 *
 * Two queries, and only two:
 *
 *   `columns` names the columns. It reads what a header must say and nothing a
 *   card would say, so its cost is the number of *columns*, not of contents.
 *
 *   `column` is one column's page, ordered by activity, resolved against an
 *   index whose last key is `activityAt`. Changing the grouping changes which
 *   index is used; it never re-partitions a fetched array. Switching List⇄Board
 *   over one scope fetches nothing the other already had.
 *
 * A workspace boundary stays a wall, not a filter (D32): `workspaceContextId` is
 * the nearest ancestor workspace, so a scope of one workspace excludes a nested
 * workspace's contents by construction, and the nested workspace itself arrives
 * as a single card that opens it.
 */

/** How the columns are cut. */
const vGroupBy = v.union(
  v.literal("type"),
  v.literal("workspace"),
  v.literal("updated"),
  v.literal("folder"),
);

export type BoardGroupBy = "type" | "workspace" | "updated" | "folder";

/**
 * The work types a board column can be, in the order the product introduces
 * them. Fixed rather than discovered: a column list that changed shape as the
 * account filled up would move the reader's target between visits, and
 * discovering it would cost exactly the scan this file exists to avoid.
 */
const TYPE_COLUMNS: readonly string[] = [
  "document",
  "flashcard_deck",
  "quiz",
  "planner_task",
  "agent",
  "presentation",
  "sheets",
  "code",
  "whiteboard",
  "thread",
];

const DAY = 86_400_000;

/**
 * Recency bands. Each is a half-open range on `activityAt`, so a band is an
 * indexed range read rather than a filter over everything newer.
 */
const BANDS: readonly { key: string; label: string; within: number }[] = [
  { key: "today", label: "Today", within: DAY },
  { key: "week", label: "This week", within: 7 * DAY },
  { key: "month", label: "This month", within: 30 * DAY },
  { key: "older", label: "Earlier", within: Number.POSITIVE_INFINITY },
];

/** The half-open `[from, to)` window a band covers, relative to now. */
function bandRange(key: string, now: number) {
  const index = BANDS.findIndex((band) => band.key === key);
  if (index < 0) return null;
  const inner = index === 0 ? 0 : BANDS[index - 1]!.within;
  const outer = BANDS[index]!.within;
  return {
    from: Number.isFinite(outer) ? now - outer : Number.NEGATIVE_INFINITY,
    to: now - inner,
  };
}

/**
 * A node's place on the activity axis. Rows written before `activityAt` existed
 * fall back to their placement time, which is the best fact available about them
 * and keeps them orderable rather than invisible.
 */
function activityOf(node: OrgNode) {
  return node.activityAt ?? node.updatedAt;
}

/** Board cards are things, not places. Folders are the rail's job. */
function isCardKind(node: OrgNode, scoped: boolean) {
  if (node.kind === "folder") return false;
  if (node.kind === "workspace") return scoped;
  return true;
}

type BoardScope = {
  /** Null at the account root. */
  node: OrgNodeView | null;
  /** Set when the scope is a workspace, which is what the indexes key on. */
  workspaceId: Id<"spectraWorkspaces"> | null;
  /** Set when the scope is a plain folder, which keys on parent instead. */
  folderId: Id<"orgNodes"> | null;
  /** How many ancestor names the surface itself has already spent. */
  depth: number;
};

async function resolveScope(
  ctx: Parameters<typeof requireSpectraActor>[0],
  accountId: Id<"accounts">,
  raw: string | null | undefined,
): Promise<BoardScope | null> {
  if (!raw || raw === "root")
    return { node: null, workspaceId: null, folderId: null, depth: 0 };
  const nodeId = ctx.db.normalizeId("orgNodes", raw);
  if (!nodeId) return null;
  const node = await ctx.db.get(nodeId);
  if (
    !node ||
    node.accountId !== accountId ||
    node.deletedAt !== undefined ||
    !isContainerKind(node.kind)
  )
    return null;
  const view = (
    await hydrateNodes(ctx, [node], { withSource: true, accountId })
  )[0]!;
  /* A workspace scope is a context; a folder scope is a parent. The two need
     different indexes, and conflating them would either leak a sibling folder's
     work into the board or hide a subfolder's. */
  const workspaceId =
    node.kind === "workspace" && node.sourceId
      ? (node.sourceId as Id<"spectraWorkspaces">)
      : null;
  let depth = 1;
  for (
    let current = node.parentId ? await ctx.db.get(node.parentId) : null;
    current && depth < 32;
    current = current.parentId ? await ctx.db.get(current.parentId) : null
  )
    depth += 1;
  return {
    node: view,
    workspaceId,
    folderId: workspaceId ? null : node._id,
    depth,
  };
}

export type BoardColumnDescriptor = {
  /** Stable across renders: the value the column's page query is keyed by. */
  key: string;
  label: string;
  sublabel?: string;
  /**
   * What the column *is*, so the client can colour it from identity where it has
   * one and from its position where it does not.
   */
  identity:
    | { kind: "type"; typeKey: string }
    | {
        kind: "workspace";
        workspaceId: Id<"spectraWorkspaces">;
        color?: string;
        icon?: string;
      }
    | { kind: "band" }
    | { kind: "folder" }
    | { kind: "loose" };
  /** Set when the column header is a place the reader can open. */
  openNodeId?: Id<"orgNodes">;
  /**
   * What creating into this column already decides. The create affordance asks
   * only for what is still open (CANON D43): a type column fixes the type and
   * asks where; a workspace or folder column fixes the place and asks what.
   */
  fixes: { typeKey?: string; parentNodeId?: Id<"orgNodes"> | null };
};

/**
 * The columns of a board, and nothing inside them.
 *
 * Cost is one bounded read per *column source*: the account's workspace nodes
 * for a workspace grouping, the scope's own child containers for a folder
 * grouping, and nothing at all for a type or recency grouping, whose columns are
 * fixed. No column list costs a scan of the account's contents.
 */
export const columns = query({
  args: {
    scopeNodeId: v.optional(v.union(v.string(), v.null())),
    groupBy: vGroupBy,
    /** Restrict every column to one work type. `"all"` or absent is no filter. */
    typeFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const scope = await resolveScope(ctx, actor.accountId, args.scopeNodeId);
    if (!scope) return null;
    const filter =
      args.typeFilter && args.typeFilter !== "all" ? args.typeFilter : null;

    const columns: BoardColumnDescriptor[] = [];

    if (args.groupBy === "type") {
      /* A type filter and a type grouping are the same axis, so the filter picks
         the column rather than narrowing all of them. */
      const keys = filter ? [filter] : TYPE_COLUMNS;
      for (const typeKey of keys)
        columns.push({
          key: `type:${typeKey}`,
          label: typeKey,
          identity: { kind: "type", typeKey },
          fixes: { typeKey, parentNodeId: undefined },
        });
      /* Inside a scope a nested workspace is one openable card, so it needs a
         column of its own — it belongs to no work type. */
      if (scope.node && !filter)
        columns.push({
          key: "type:workspace",
          label: "workspace",
          identity: { kind: "type", typeKey: "workspace" },
          fixes: {},
        });
      return { scope: scope.node, scopeDepth: scope.depth, columns };
    }

    if (args.groupBy === "workspace") {
      /* Every workspace is a column even when it is empty: at the account level
         the columns *are* the reader's workspaces, and one that vanished for
         being empty reads as a bug rather than as an invitation. */
      const nodes = (
        await ctx.db
          .query("orgNodes")
          .withIndex("by_account_kind_source", (q) =>
            q.eq("accountId", actor.accountId).eq("kind", "workspace"),
          )
          .collect()
      ).filter(
        (row) =>
          row.deletedAt === undefined &&
          row.sourceId &&
          /* Inside a workspace the columns are its children, not itself. */
          (!scope.workspaceId || row.sourceId !== scope.workspaceId),
      );
      const views = await hydrateNodes(ctx, nodes, {
        withSource: true,
        accountId: actor.accountId,
      });
      views.sort((a, b) =>
        (a.workspace?.title ?? a.name).localeCompare(
          b.workspace?.title ?? b.name,
        ),
      );
      for (const view of views) {
        if (!view.workspace) continue;
        columns.push({
          key: `workspace:${view.workspace.workspaceId}`,
          label: view.workspace.title,
          identity: {
            kind: "workspace",
            workspaceId: view.workspace.workspaceId,
            color: view.workspace.color,
            icon: view.workspace.icon,
          },
          openNodeId: view.nodeId,
          fixes: { parentNodeId: view.nodeId, typeKey: filter ?? undefined },
        });
      }
      /* Work filed in the Library itself belongs to no workspace. It is a real
         place, so it gets a real column rather than being dropped. */
      if (!scope.workspaceId)
        columns.push({
          key: "workspace:loose",
          label: "Top level",
          sublabel: "Filed in the Library, not in a workspace",
          identity: { kind: "loose" },
          fixes: { parentNodeId: null, typeKey: filter ?? undefined },
        });
      return { scope: scope.node, scopeDepth: scope.depth, columns };
    }

    if (args.groupBy === "folder") {
      /* The folders directly under the scope, plus the scope itself for what is
         filed there loose. Deeper folders are the rail's business: a column per
         folder in a 200-folder tree is not a board, it is a worse tree. */
      const parentId = scope.folderId ?? null;
      const children = scope.workspaceId
        ? await ctx.db
            .query("orgNodes")
            .withIndex("by_account_parent_order", (q) =>
              q
                .eq("accountId", actor.accountId)
                .eq("parentId", scope.node!.nodeId),
            )
            .collect()
        : await ctx.db
            .query("orgNodes")
            .withIndex("by_account_parent_order", (q) =>
              q.eq("accountId", actor.accountId).eq("parentId", parentId),
            )
            .collect();
      const here = scope.node?.nodeId ?? null;
      columns.push({
        key: `folder:${here ?? "root"}`,
        label: scope.node?.name ?? "Library",
        sublabel: "Filed here, not in a folder below",
        identity: { kind: "folder" },
        fixes: { parentNodeId: here, typeKey: filter ?? undefined },
      });
      const folders = children
        .filter((row) => row.deletedAt === undefined && isContainerKind(row.kind))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const folder of await hydrateNodes(ctx, folders, {
        withSource: true,
        accountId: actor.accountId,
      }))
        columns.push({
          key: `folder:${folder.nodeId}`,
          label: folder.workspace?.title ?? folder.name,
          identity:
            folder.kind === "workspace" && folder.workspace
              ? {
                  kind: "workspace",
                  workspaceId: folder.workspace.workspaceId,
                  color: folder.workspace.color,
                  icon: folder.workspace.icon,
                }
              : { kind: "folder" },
          openNodeId: folder.nodeId,
          fixes: { parentNodeId: folder.nodeId, typeKey: filter ?? undefined },
        });
      return { scope: scope.node, scopeDepth: scope.depth, columns };
    }

    for (const band of BANDS)
      columns.push({
        key: `band:${band.key}`,
        label: band.label,
        identity: { kind: "band" },
        /* A recency column fixes nothing a creator could act on — new work is
           new today by definition — so it decides the place from the scope and
           leaves the type open. */
        fixes: {
          parentNodeId: scope.node?.nodeId ?? null,
          typeKey: filter ?? undefined,
        },
      });
    return { scope: scope.node, scopeDepth: scope.depth, columns };
  },
});

/**
 * One column's page, newest activity first.
 *
 * Every branch below resolves to an index range whose final key is `activityAt`,
 * so the page is the read: N cards cost N rows plus the parents they name. The
 * `now` argument is the client's clock, passed in so a recency band's boundary
 * is stable across pages of the same scroll instead of sliding while the reader
 * pages through it.
 */
export const column = query({
  args: {
    scopeNodeId: v.optional(v.union(v.string(), v.null())),
    groupBy: vGroupBy,
    columnKey: v.string(),
    typeFilter: v.optional(v.string()),
    now: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const empty = { page: [], isDone: true, continueCursor: "" };
    const actor = await requireSpectraActor(ctx);
    const scope = await resolveScope(ctx, actor.accountId, args.scopeNodeId);
    if (!scope) return empty;
    const filter =
      args.typeFilter && args.typeFilter !== "all" ? args.typeFilter : null;
    const scoped = scope.node !== null;
    const account = actor.accountId;
    const [prefix, value] = splitKey(args.columnKey);

    let result: {
      page: OrgNode[];
      isDone: boolean;
      continueCursor: string;
    } | null = null;

    if (args.groupBy === "type" && prefix === "type") {
      /* One type, ordered by activity: the narrowest window the schema can
         express, and the reason `typeKey` is denormalized onto the node. */
      result = scope.workspaceId
        ? await ctx.db
            .query("orgNodes")
            .withIndex("by_account_live_workspace_type_activity", (q) =>
              q
                .eq("accountId", account)
                .eq("deletedAt", undefined)
                .eq("workspaceContextId", scope.workspaceId!)
                .eq("typeKey", value),
            )
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("orgNodes")
            .withIndex("by_account_live_type_activity", (q) =>
              q
                .eq("accountId", account)
                .eq("deletedAt", undefined)
                .eq("typeKey", value),
            )
            .order("desc")
            .paginate(args.paginationOpts);
    } else if (args.groupBy === "workspace" && prefix === "workspace") {
      const context =
        value === "loose"
          ? undefined
          : (value as Id<"spectraWorkspaces">);
      result = filter
        ? await ctx.db
            .query("orgNodes")
            .withIndex("by_account_live_workspace_type_activity", (q) =>
              q
                .eq("accountId", account)
                .eq("deletedAt", undefined)
                .eq("workspaceContextId", context)
                .eq("typeKey", filter),
            )
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("orgNodes")
            .withIndex("by_account_live_workspace_activity", (q) =>
              q
                .eq("accountId", account)
                .eq("deletedAt", undefined)
                .eq("workspaceContextId", context),
            )
            .order("desc")
            .paginate(args.paginationOpts);
    } else if (args.groupBy === "folder" && prefix === "folder") {
      const parentId =
        value === "root" ? null : ctx.db.normalizeId("orgNodes", value);
      if (value !== "root" && !parentId) return empty;
      const base = ctx.db
        .query("orgNodes")
        .withIndex("by_parent_live_activity", (q) =>
          q.eq("parentId", parentId).eq("deletedAt", undefined),
        );
      result = await (filter
        ? base.filter((q) => q.eq(q.field("typeKey"), filter))
        : base
      )
        .order("desc")
        .paginate(args.paginationOpts);
    } else if (args.groupBy === "updated" && prefix === "band") {
      const range = bandRange(value, args.now ?? Date.now());
      if (!range) return empty;
      /* A band is a range on the same key the index already orders by, so
         "This week" costs this week's rows and not the account's. */
      if (scope.workspaceId && filter)
        result = await ctx.db
          .query("orgNodes")
          .withIndex("by_account_live_workspace_type_activity", (q) =>
            q
              .eq("accountId", account)
              .eq("deletedAt", undefined)
              .eq("workspaceContextId", scope.workspaceId!)
              .eq("typeKey", filter)
              .gte("activityAt", range.from)
              .lt("activityAt", range.to),
          )
          .order("desc")
          .paginate(args.paginationOpts);
      else if (scope.workspaceId)
        result = await ctx.db
          .query("orgNodes")
          .withIndex("by_account_live_workspace_activity", (q) =>
            q
              .eq("accountId", account)
              .eq("deletedAt", undefined)
              .eq("workspaceContextId", scope.workspaceId!)
              .gte("activityAt", range.from)
              .lt("activityAt", range.to),
          )
          .order("desc")
          .paginate(args.paginationOpts);
      else if (filter)
        result = await ctx.db
          .query("orgNodes")
          .withIndex("by_account_live_type_activity", (q) =>
            q
              .eq("accountId", account)
              .eq("deletedAt", undefined)
              .eq("typeKey", filter)
              .gte("activityAt", range.from)
              .lt("activityAt", range.to),
          )
          .order("desc")
          .paginate(args.paginationOpts);
      else
        result = await ctx.db
          .query("orgNodes")
          .withIndex("by_account_live_activity", (q) =>
            q
              .eq("accountId", account)
              .eq("deletedAt", undefined)
              .gte("activityAt", range.from)
              .lt("activityAt", range.to),
          )
          .order("desc")
          .paginate(args.paginationOpts);
    }

    if (!result) return empty;

    /* Folders are places; a folder column already *is* its folder. Dropping them
       here rather than in the index costs a few rows per page and keeps the
       schema from growing an index per exclusion. */
    const rows = result.page.filter((row) => isCardKind(row, scoped));
    const views = await hydrateNodes(ctx, rows, {
      withChildCounts: true,
      withSource: true,
      accountId: account,
    });

    /* Where each card lives, resolved once per distinct parent per page rather
       than once per card. A card needs the folder it sits in; the chain above
       that is what the rail and the breadcrumb are for. */
    const parents = new Map<string, string>();
    for (const row of rows) {
      const parentId = row.parentId;
      if (!parentId || parents.has(parentId)) continue;
      const parent = await ctx.db.get(parentId);
      parents.set(parentId, parent?.name ?? "");
    }

    return {
      ...result,
      page: views.map((view) => ({
        ...view,
        /* Suppressed when the column header already says it: repeating the
           column's own name on every one of its cards spends the most valuable
           line on the card saying nothing. */
        parentName:
          view.parentId && parents.get(view.parentId)
            ? parents.get(view.parentId)!
            : undefined,
      })),
    };
  },
});

/** `"type:quiz"` → `["type", "quiz"]`. Values may contain no colon. */
function splitKey(key: string): [string, string] {
  const at = key.indexOf(":");
  return at < 0 ? [key, ""] : [key.slice(0, at), key.slice(at + 1)];
}

export type BoardCard = OrgNodeView & { parentName?: string };
