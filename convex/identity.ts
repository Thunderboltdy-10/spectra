import { mutation, query } from "./functions";
import { v } from "convex/values";
import { getAccountByClerkId, getAuthenticatedAccount, getAuthenticatedActor, getAuthenticatedIdentity, isPlatformOperatorEmail } from "./identityShared";
import { writeAuditEvent } from "./auditShared";
import { internal } from "./_generated/api";
import { SCHOOL_SYNC_IDLE_AFTER_MS } from "../shared/school-sync-rest";

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

/**
 * Who is signed in, in one query (LAUNCH-REVIEW E4): the account, its school
 * memberships, the school identity catalog reads wait for, and whether a
 * Bridge is paired. These almost never change; as four queries each
 * re-ran on every identity refresh on every page.
 */
export const session = query({
  args: {},
  handler: async (ctx) => {
    const current = await getAuthenticatedAccount(ctx);
    if (!current) return null;
    const rows = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_account", (q) => q.eq("accountId", current._id))
      .collect();
    const schools = await Promise.all(rows.map((row) => ctx.db.get(row.schoolId)));
    const memberships = rows.map((membership, index) => {
      const school = schools[index];
      return {
        membershipId: membership._id,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
        endedAt: membership.endedAt,
        school: school
          ? { schoolId: school._id, name: school.name, slug: school.slug, status: school.status, timezone: school.timezone }
          : null,
      };
    });
    // As catalogGraph:identity: exactly one active membership in an active school.
    const active = rows.filter((row) => row.status === "active");
    const activeSchool = active.length === 1 ? schools[rows.indexOf(active[0]!)] : null;
    const catalog =
      active.length === 1 && activeSchool?.status === "active"
        ? { accountId: current._id, schoolId: activeSchool._id, membershipId: active[0]!._id }
        : null;
    const device = await ctx.db
      .query("bridgeDevices")
      .withIndex("by_account_state", (q) => q.eq("accountId", current._id).eq("state", "active"))
      .first();
    return {
      account: {
        accountId: current._id,
        email: current.email,
        emailVerified: current.emailVerified,
        name: current.name,
        avatarUrl: current.avatarUrl,
        status: current.status,
        platformOperator: isPlatformOperatorEmail(current.email),
      },
      memberships,
      catalog,
      hasDevice: device !== null,
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
    const duplicates = await ctx.db.query("accounts").withIndex("by_email", (query) => query.eq("email", email)).collect();
    if (duplicates.some((duplicate) => duplicate._id !== existing?._id))
      throw new Error("IDENTITY_EMAIL_IN_USE: This verified email already belongs to another Spectra account.");
    if (existing) {
      // A session token can outlive the IdP identity by a few seconds. The
      // erased subject must not write its name and email back.
      const erasure = await ctx.db.query("accountErasureJobs").withIndex("by_account", (query) => query.eq("accountId", existing._id)).unique();
      if (erasure) throw new Error("IDENTITY_ACCOUNT_ERASED: This account was deleted.");
      await ctx.db.patch(existing._id, {
        email,
        emailVerified: true,
        name,
        avatarUrl,
        lastSeenAt: now,
        updatedAt: now,
      });
      // Back after a while away: school syncs that rested start again now.
      if (now - (existing.lastSeenAt ?? 0) > SCHOOL_SYNC_IDLE_AFTER_MS)
        await ctx.scheduler.runAfter(0, internal.managebac.resumeRestedSyncs, { accountId: existing._id });
      return existing._id;
    }
    // Spectra is invitation-only: a new account needs a live invitation sent to
    // this exact email, unless it is a platform operator's.
    if (!isPlatformOperatorEmail(email)) {
      const pending = await ctx.db
        .query("membershipInvitations")
        .withIndex("by_email_status", (q) => q.eq("email", email).eq("status", "pending"))
        .take(20);
      if (!pending.some((invitation) => invitation.expiresAt > now))
        throw new Error("IDENTITY_NOT_INVITED: No Spectra invitation was sent to this email.");
    }
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
