import { query } from "./functions";
import { mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireSpectraActor } from "./spectraShared";
import { breadcrumbNodes, requireOwnNode, type OrgNode } from "./orgTreeShared";
import { hydrateNodes } from "./orgTreeViews";

/*
 * Stacks on a shelf (LIBRARY.md, "Stacks"): works laid on one another become
 * one card with a tab for each. Gathering never moves anything; each work
 * stays where it lives, and the stack is only how the shelf shows them. A
 * stack of one is no stack, so the last work left is let go too.
 */

/** A stack shows this many at most; more is a folder's job. */
const STACK_LIMIT = 12;

async function stackMembers(ctx: QueryCtx | MutationCtx, accountId: Id<"accounts">, stackId: string) {
  const rows = await ctx.db
    .query("orgNodes")
    .withIndex("by_account_stack", (q) => q.eq("accountId", accountId).eq("stackId", stackId))
    .take(STACK_LIMIT + 1);
  return rows.filter((row) => row.deletedAt === undefined);
}

/** Lets a stack go once fewer than two works are left in it. */
async function settle(ctx: MutationCtx, accountId: Id<"accounts">, stackId: string) {
  const left = await stackMembers(ctx, accountId, stackId);
  if (left.length < 2) for (const row of left) await ctx.db.patch(row._id, { stackId: undefined });
}

function requireWork(node: OrgNode) {
  if (node.kind !== "work") throw new Error("Only work can be stacked.");
  return node;
}

/** Lays one work on another: into its stack, or a new stack of the two. */
export const gather = mutation({
  args: { nodeId: v.id("orgNodes"), ontoNodeId: v.id("orgNodes") },
  handler: async (ctx, args) => {
    if (args.nodeId === args.ontoNodeId) throw new Error("An artifact cannot be stacked on itself.");
    const actor = await requireSpectraActor(ctx);
    const node = requireWork(await requireOwnNode(ctx, args.nodeId, actor.accountId));
    const onto = requireWork(await requireOwnNode(ctx, args.ontoNodeId, actor.accountId));
    const stackId = onto.stackId ?? onto._id;
    if (node.stackId === stackId) return { stackId };
    if ((await stackMembers(ctx, actor.accountId, stackId)).length >= STACK_LIMIT)
      throw new Error(`A stack holds ${STACK_LIMIT} artifacts at most. Put the rest in a folder.`);
    const previous = node.stackId;
    if (!onto.stackId) await ctx.db.patch(onto._id, { stackId });
    await ctx.db.patch(node._id, { stackId });
    if (previous) await settle(ctx, actor.accountId, previous);
    return { stackId };
  },
});

/** Takes one work out of its stack, or, with `all`, lets the whole stack go. */
export const release = mutation({
  args: { nodeId: v.id("orgNodes"), all: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const node = await requireOwnNode(ctx, args.nodeId, actor.accountId);
    const stackId = node.stackId;
    if (!stackId) return null;
    if (args.all)
      for (const row of await stackMembers(ctx, actor.accountId, stackId))
        await ctx.db.patch(row._id, { stackId: undefined });
    else {
      await ctx.db.patch(node._id, { stackId: undefined });
      await settle(ctx, actor.accountId, stackId);
    }
    return null;
  },
});

/**
 * Every work in the stacks a shelf is showing, newest first, so a stack shows
 * whole even when the rest of its works are further down the shelf's pages.
 */
export const members = query({
  args: { stackIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const stacks = await Promise.all(
      [...new Set(args.stackIds)].slice(0, 40).map(async (stackId) => {
        const rows = await stackMembers(ctx, actor.accountId, stackId);
        const views = await hydrateNodes(ctx, rows, { withSource: true, accountId: actor.accountId });
        const nodes = await Promise.all(
          views.map(async (view, index) => ({
            ...view,
            parentPath: (await breadcrumbNodes(ctx, rows[index]!)).map((row) => row.name),
          })),
        );
        nodes.sort((a, b) => b.activityAt - a.activityAt);
        return { stackId, nodes: nodes.filter((node) => node.source?.available !== false) };
      }),
    );
    return stacks;
  },
});
