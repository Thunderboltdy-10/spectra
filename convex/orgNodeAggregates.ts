import { TableAggregate } from "@convex-dev/aggregate";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

type CountKey = [state: string, dimension: string, typeKey: string, activityAt: number];

function stateOf(node: Doc<"orgNodes">) {
  return node.deletedAt === undefined &&
    (node.kind === "work" || node.kind === "thread" || node.kind === "link")
    ? "live-card"
    : "other";
}

function typeOf(node: Doc<"orgNodes">) {
  return node.typeKey ?? node.kind;
}

function activityOf(node: Doc<"orgNodes">) {
  return node.activityAt ?? node.updatedAt;
}

type OrgNodeAggregate = {
  Namespace: Id<"accounts">;
  Key: CountKey;
  DataModel: DataModel;
  TableName: "orgNodes";
};

export const orgNodeCountByType = new TableAggregate<OrgNodeAggregate>(
  components.orgNodeCountByType,
  {
    namespace: (node) => node.accountId,
    sortKey: (node) => [stateOf(node), typeOf(node), "", activityOf(node)],
  },
);

export const orgNodeCountByWorkspace = new TableAggregate<OrgNodeAggregate>(
  components.orgNodeCountByWorkspace,
  {
    namespace: (node) => node.accountId,
    sortKey: (node) => [
      stateOf(node),
      node.workspaceContextId ?? "root",
      typeOf(node),
      activityOf(node),
    ],
  },
);

export const orgNodeCountByParent = new TableAggregate<OrgNodeAggregate>(
  components.orgNodeCountByParent,
  {
    namespace: (node) => node.accountId,
    sortKey: (node) => [
      stateOf(node),
      node.parentId ?? "root",
      typeOf(node),
      activityOf(node),
    ],
  },
);

export const orgNodeAggregates = [
  orgNodeCountByType,
  orgNodeCountByWorkspace,
  orgNodeCountByParent,
] as const;

/** Idempotent, cursor-shaped backfill for the N1 migration and later repairs. */
export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("orgNodes").paginate({
      cursor: args.cursor,
      numItems: 200,
    });
    for (const node of page.page)
      for (const aggregate of orgNodeAggregates)
        await aggregate.insertIfDoesNotExist(ctx, node);
    return {
      processed: page.page.length,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});
