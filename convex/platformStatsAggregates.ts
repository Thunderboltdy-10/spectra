import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

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

async function paginateTable<T extends "orgs" | "users" | "messages">(
  ctx: MutationCtx,
  tableName: T,
  onPage: (docs: Array<Doc<T>>) => Promise<void>,
) {
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const result = await ctx.db.query(tableName).paginate({ cursor, numItems: 256 });
    await onPage(result.page);
    cursor = result.continueCursor;
    isDone = result.isDone;
  }
}

export async function rebuildPlatformStatsAggregates(ctx: MutationCtx) {
  await clearPlatformStatsAggregates(ctx);

  await paginateTable(ctx, "orgs", async (orgs) => {
    for (const org of orgs) {
      await addOrgToPlatformStats(ctx, org._id);
    }
  });

  await paginateTable(ctx, "users", async (users) => {
    for (const user of users) {
      await addUserToPlatformStats(ctx, user);
    }
  });

  await paginateTable(ctx, "messages", async (messages) => {
    for (const message of messages) {
      await addMessageToPlatformStats(ctx, message._id);
    }
  });

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
