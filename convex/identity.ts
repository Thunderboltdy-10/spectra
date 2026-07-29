import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAccountByClerkId, getAuthenticatedAccount, getAuthenticatedActor, getAuthenticatedIdentity, isPlatformOperatorEmail } from "./identityShared";
import { writeAuditEvent } from "./auditShared";

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 120) || "Spectra user";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) return null;
    return {
      accountId: actor.accountId,
      clerkId: actor.clerkId,
      email: actor.email,
      emailVerified: actor.emailVerified,
      name: actor.name,
      avatarUrl: actor.avatarUrl,
      schoolId: actor.schoolId,
      schoolRole: actor.schoolRole,
      membershipId: actor.membershipId,
    };
  },
});

export const account = query({
  args: {},
  handler: async (ctx) => {
    const current = await getAuthenticatedAccount(ctx);
    if (!current) return null;
    return {
      accountId: current._id,
      email: current.email,
      emailVerified: current.emailVerified,
      name: current.name,
      avatarUrl: current.avatarUrl,
      status: current.status,
      platformOperator: isPlatformOperatorEmail(current.email),
    };
  },
});

export const registerSelf = mutation({
  args: {
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await getAuthenticatedIdentity(ctx);
    if (!identity.email || identity.emailVerified !== true) throw new Error("IDENTITY_EMAIL_UNVERIFIED: A verified email is required.");
    const clerkId = identity.subject;
    const email = normalizeEmail(identity.email);
    if (!email.includes("@")) throw new Error("IDENTITY_EMAIL_INVALID: A valid email is required.");
    const now = Date.now();
    const existing = await getAccountByClerkId(ctx, clerkId);
    const name = normalizeName(args.name ?? identity.name ?? identity.givenName ?? identity.preferredUsername ?? "Spectra user");
    const avatarUrl = args.avatarUrl ?? identity.pictureUrl;
    if (existing) {
      await ctx.db.patch(existing._id, {
        email,
        emailVerified: true,
        name,
        avatarUrl,
        lastSeenAt: now,
        updatedAt: now,
      });
      return existing._id;
    }
    const duplicate = await ctx.db.query("accounts").withIndex("by_email", (query) => query.eq("email", email)).unique();
    if (duplicate) throw new Error("IDENTITY_EMAIL_IN_USE: This verified email already belongs to another Spectra account.");
    const accountId = await ctx.db.insert("accounts", {
      clerkId,
      email,
      emailVerified: true,
      name,
      avatarUrl,
      status: "active",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, { actorAccountId: accountId, action: "identity.account.registered", targetType: "account", targetId: accountId, metadata: { emailVerified: true }, retentionClass: "security" });
    return accountId;
  },
});
