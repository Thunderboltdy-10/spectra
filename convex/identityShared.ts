import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export type IdentityCtx = QueryCtx | MutationCtx;

export async function getAccountByClerkId(ctx: IdentityCtx, clerkId: string) {
  return ctx.db
    .query("accounts")
    .withIndex("by_clerk_id", (query) => query.eq("clerkId", clerkId))
    .unique();
}

export async function getActiveMembership(ctx: IdentityCtx, accountId: Id<"accounts">) {
  const memberships = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_account_status", (query) => query.eq("accountId", accountId).eq("status", "active"))
    .collect();

  if (memberships.length > 1) {
    throw new Error("IDENTITY_INVARIANT: An account cannot have more than one active school membership.");
  }
  return memberships[0] ?? null;
}

export async function getActorByClerkId(ctx: IdentityCtx, clerkId: string) {
  const account = await getAccountByClerkId(ctx, clerkId);
  if (!account || account.status !== "active") return null;
  const membership = await getActiveMembership(ctx, account._id);
  if (!membership) return null;
  const school = await ctx.db.get(membership.schoolId);
  if (!school || school.status !== "active") return null;
  return {
    ...account,
    accountId: account._id,
    schoolId: school._id,
    schoolRole: membership.role,
    membershipId: membership._id,
  };
}
