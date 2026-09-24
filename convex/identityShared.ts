import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export type IdentityCtx = QueryCtx | MutationCtx;

export async function getAuthenticatedIdentity(ctx: IdentityCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.");
  return identity;
}

export async function getAccountByClerkId(ctx: IdentityCtx, clerkId: string) {
  return ctx.db
    .query("accounts")
    .withIndex("by_clerk_id", (query) => query.eq("clerkId", clerkId))
    .unique();
}

function operatorEmailSet() {
  return new Set((process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
}

export function isPlatformOperatorEmail(email: string) {
  return operatorEmailSet().has(email.trim().toLowerCase());
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

export async function getAuthenticatedAccount(ctx: IdentityCtx) {
  const identity = await getAuthenticatedIdentity(ctx);
  const account = await getAccountByClerkId(ctx, identity.subject);
  if (!account || account.status !== "active") return null;
  const tokenEmail = identity.email?.trim().toLowerCase();
  if (!tokenEmail || identity.emailVerified !== true) {
    throw new Error("AUTH_EMAIL_UNVERIFIED: A verified email claim is required.");
  }
  if (account.email !== tokenEmail || !account.emailVerified) {
    // Let the authenticated-session repair path call registerSelf. That
    // mutation checks that the verified address is not owned by another
    // account before it updates this stable Clerk-subject mapping.
    return null;
  }
  return account;
}

export async function getAuthenticatedActor(ctx: IdentityCtx) {
  const account = await getAuthenticatedAccount(ctx);
  if (!account) return null;
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

export type AuthenticatedActor = NonNullable<
  Awaited<ReturnType<typeof getAuthenticatedActor>>
>;

/** Product queries must not crash the tree when the browser is offline. */
export async function getOptionalAuthenticatedActor(ctx: IdentityCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return getAuthenticatedActor(ctx);
}

export async function getActorForAccountId(ctx: IdentityCtx, accountId: Id<"accounts">) {
  const account = await ctx.db.get(accountId);
  if (!account || account.status !== "active" || !account.emailVerified) return null;
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

export async function resolveActorContext(ctx: IdentityCtx, operatorSessionId?: Id<"operatorSchoolSessions">) {
  const account = await getAuthenticatedAccount(ctx);
  if (!account) throw new Error("AUTH_ACCOUNT_REQUIRED: Complete account registration first.");
  const membership = await getActiveMembership(ctx, account._id);
  const membershipSchool = membership ? await ctx.db.get(membership.schoolId) : null;
  const platformOperator = isPlatformOperatorEmail(account.email);

  let operatorSession = null;
  let operationalSchool = null;
  if (operatorSessionId) {
    if (!platformOperator) throw new Error("AUTH_OPERATOR_REQUIRED: Platform operator access is required.");
    const candidate = await ctx.db.get(operatorSessionId);
    if (!candidate || candidate.operatorAccountId !== account._id || candidate.revokedAt || candidate.expiresAt <= Date.now()) {
      throw new Error("AUTH_OPERATOR_SESSION_INVALID: The operational school session is unavailable or expired.");
    }
    operationalSchool = await ctx.db.get(candidate.schoolId);
    if (!operationalSchool || operationalSchool.status !== "active") {
      throw new Error("AUTH_OPERATOR_SCHOOL_UNAVAILABLE: The selected school is unavailable.");
    }
    operatorSession = candidate;
  }

  return {
    account,
    accountId: account._id,
    membership: membership && membershipSchool?.status === "active" ? membership : null,
    membershipSchool: membershipSchool?.status === "active" ? membershipSchool : null,
    platformOperator,
    operatorSession,
    operationalSchool,
  };
}
