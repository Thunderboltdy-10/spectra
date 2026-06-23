import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";

type PlatformStatsNamespace = "orgs" | "users" | "messages" | "admins";

const PLATFORM_STATS_NS = {
  orgs: "orgs",
  users: "users",
  messages: "messages",
  admins: "admins",
} as const satisfies Record<PlatformStatsNamespace, PlatformStatsNamespace>;

const platformCountsAggregate = new DirectAggregate<{
  Namespace: PlatformStatsNamespace;
  Key: null;
  Id: string;
}>(components.aggregate);

function countKeyArgs(namespace: PlatformStatsNamespace, id: string) {
  return {
    namespace,
    key: null,
    id,
  };
}

export async function countPlatformStats(ctx: QueryCtx | MutationCtx) {
  const [totalOrgs, totalUsers, totalMessages, totalAdmins] = await Promise.all([
    platformCountsAggregate.count(ctx, { namespace: PLATFORM_STATS_NS.orgs }),
    platformCountsAggregate.count(ctx, { namespace: PLATFORM_STATS_NS.users }),
    platformCountsAggregate.count(ctx, { namespace: PLATFORM_STATS_NS.messages }),
    platformCountsAggregate.count(ctx, { namespace: PLATFORM_STATS_NS.admins }),
  ]);

  return {
    totalOrgs,
    totalUsers,
    totalMessages,
    totalAdmins,
  };
}

export async function addOrgToPlatformStats(ctx: MutationCtx, orgId: Id<"orgs">) {
  await platformCountsAggregate.insertIfDoesNotExist(ctx, countKeyArgs(PLATFORM_STATS_NS.orgs, String(orgId)));
}

export async function removeOrgFromPlatformStats(ctx: MutationCtx, orgId: Id<"orgs">) {
  await platformCountsAggregate.deleteIfExists(ctx, countKeyArgs(PLATFORM_STATS_NS.orgs, String(orgId)));
}

export async function addMessageToPlatformStats(ctx: MutationCtx, messageId: Id<"messages">) {
  await platformCountsAggregate.insertIfDoesNotExist(
    ctx,
    countKeyArgs(PLATFORM_STATS_NS.messages, String(messageId)),
  );
}

export async function removeMessageFromPlatformStats(ctx: MutationCtx, messageId: Id<"messages">) {
  await platformCountsAggregate.deleteIfExists(
    ctx,
    countKeyArgs(PLATFORM_STATS_NS.messages, String(messageId)),
  );
}

export async function addUserToPlatformStats(
  ctx: MutationCtx,
  user: Pick<Doc<"users">, "_id" | "role">,
) {
  await platformCountsAggregate.insertIfDoesNotExist(ctx, countKeyArgs(PLATFORM_STATS_NS.users, String(user._id)));
  if (user.role === "admin") {
    await platformCountsAggregate.insertIfDoesNotExist(
      ctx,
      countKeyArgs(PLATFORM_STATS_NS.admins, String(user._id)),
    );
  } else {
    await platformCountsAggregate.deleteIfExists(ctx, countKeyArgs(PLATFORM_STATS_NS.admins, String(user._id)));
  }
}

export async function removeUserFromPlatformStats(
  ctx: MutationCtx,
  user: Pick<Doc<"users">, "_id" | "role">,
) {
  await platformCountsAggregate.deleteIfExists(ctx, countKeyArgs(PLATFORM_STATS_NS.users, String(user._id)));
  if (user.role === "admin") {
    await platformCountsAggregate.deleteIfExists(ctx, countKeyArgs(PLATFORM_STATS_NS.admins, String(user._id)));
  }
}

export async function updateUserInPlatformStats(
  ctx: MutationCtx,
  previous: Pick<Doc<"users">, "_id" | "role">,
  next: Pick<Doc<"users">, "_id" | "role">,
) {
  await platformCountsAggregate.insertIfDoesNotExist(ctx, countKeyArgs(PLATFORM_STATS_NS.users, String(next._id)));
  if (previous.role !== "admin" && next.role === "admin") {
    await platformCountsAggregate.insertIfDoesNotExist(
      ctx,
      countKeyArgs(PLATFORM_STATS_NS.admins, String(next._id)),
    );
    return;
  }
  if (previous.role === "admin" && next.role !== "admin") {
    await platformCountsAggregate.deleteIfExists(ctx, countKeyArgs(PLATFORM_STATS_NS.admins, String(next._id)));
    return;
  }
  if (next.role === "admin") {
    await platformCountsAggregate.insertIfDoesNotExist(
      ctx,
      countKeyArgs(PLATFORM_STATS_NS.admins, String(next._id)),
    );
  }
}

export async function clearPlatformStatsAggregates(ctx: MutationCtx) {
  await Promise.all([
    platformCountsAggregate.clear(ctx, { namespace: PLATFORM_STATS_NS.orgs }),
    platformCountsAggregate.clear(ctx, { namespace: PLATFORM_STATS_NS.users }),
    platformCountsAggregate.clear(ctx, { namespace: PLATFORM_STATS_NS.messages }),
    platformCountsAggregate.clear(ctx, { namespace: PLATFORM_STATS_NS.admins }),
  ]);
}

type RebuildTable = "orgs" | "users" | "messages";
type RebuildPageResult = { continueCursor: string; isDone: boolean };
const REBUILD_PAGE_SIZE = 16;
const PLATFORM_STATS_SINGLETON = "global";
const rebuildPageReference = makeFunctionReference<"mutation", { tableName: RebuildTable; cursor: string | null }, RebuildPageResult>("platformStatsAggregates:rebuildPlatformStatsPage");

// Convex permits one paginated query per function invocation. Each page is
// therefore isolated in its own internal mutation and the coordinator below
// only loops over child mutations; it never paginates directly.
export const rebuildPlatformStatsPage = internalMutation({
  args: {
    tableName: v.union(v.literal("orgs"), v.literal("users"), v.literal("messages")),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<RebuildPageResult> => {
    if (args.tableName === "orgs") {
      const result = await ctx.db.query("orgs").paginate({ cursor: args.cursor, numItems: REBUILD_PAGE_SIZE });
      for (const org of result.page) await addOrgToPlatformStats(ctx, org._id);
      if (result.isDone) await ctx.scheduler.runAfter(0, rebuildPageReference, { tableName: "users", cursor: null });
      else await ctx.scheduler.runAfter(0, rebuildPageReference, { tableName: "orgs", cursor: result.continueCursor });
      return { continueCursor: result.continueCursor, isDone: result.isDone };
    }
    if (args.tableName === "users") {
      const result = await ctx.db.query("users").paginate({ cursor: args.cursor, numItems: REBUILD_PAGE_SIZE });
      for (const user of result.page) await addUserToPlatformStats(ctx, user);
      if (result.isDone) await ctx.scheduler.runAfter(0, rebuildPageReference, { tableName: "messages", cursor: null });
      else await ctx.scheduler.runAfter(0, rebuildPageReference, { tableName: "users", cursor: result.continueCursor });
      return { continueCursor: result.continueCursor, isDone: result.isDone };
    }
    const result = await ctx.db.query("messages").paginate({ cursor: args.cursor, numItems: REBUILD_PAGE_SIZE });
    for (const message of result.page) await addMessageToPlatformStats(ctx, message._id);
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, rebuildPageReference, { tableName: "messages", cursor: result.continueCursor });
    } else {
      const counts = await countPlatformStats(ctx);
      const now = Date.now();
      const existing = await ctx.db.query("platformStats").withIndex("by_singleton", (q) => q.eq("singletonKey", PLATFORM_STATS_SINGLETON)).unique();
      if (existing) await ctx.db.patch(existing._id, { ...counts, lastComputedAt: now });
      else await ctx.db.insert("platformStats", { singletonKey: PLATFORM_STATS_SINGLETON, ...counts, lastComputedAt: now });
    }
    return { continueCursor: result.continueCursor, isDone: result.isDone };
  },
});

export async function rebuildPlatformStatsAggregates(ctx: MutationCtx) {
  await clearPlatformStatsAggregates(ctx);
  await ctx.scheduler.runAfter(0, rebuildPageReference, { tableName: "orgs", cursor: null });
  return countPlatformStats(ctx);
}

export async function hasPlatformSourceData(ctx: QueryCtx | MutationCtx) {
  const [orgs, users, messages] = await Promise.all([
    ctx.db.query("orgs").take(1),
    ctx.db.query("users").take(1),
    ctx.db.query("messages").take(1),
  ]);
  return orgs.length > 0 || users.length > 0 || messages.length > 0;
}
