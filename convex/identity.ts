import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAccountByClerkId, getActiveMembership, getActorByClerkId } from "./identityShared";

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 120) || "Spectra user";

export const me = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getActorByClerkId(ctx, args.clerkId);
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

export const registerVerifiedAccount = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    emailVerified: v.boolean(),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.emailVerified) throw new Error("IDENTITY_EMAIL_UNVERIFIED: A verified email is required.");
    const email = normalizeEmail(args.email);
    if (!email.includes("@")) throw new Error("IDENTITY_EMAIL_INVALID: A valid email is required.");
    const now = Date.now();
    const existing = await getAccountByClerkId(ctx, args.clerkId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        email,
        emailVerified: true,
        name: normalizeName(args.name),
        avatarUrl: args.avatarUrl,
        lastSeenAt: now,
        updatedAt: now,
      });
      return existing._id;
    }
    const duplicate = await ctx.db.query("accounts").withIndex("by_email", (query) => query.eq("email", email)).unique();
    if (duplicate) throw new Error("IDENTITY_EMAIL_IN_USE: This verified email already belongs to another Spectra account.");
    return ctx.db.insert("accounts", {
      clerkId: args.clerkId,
      email,
      emailVerified: true,
      name: normalizeName(args.name),
      avatarUrl: args.avatarUrl,
      status: "active",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const ensureDevelopmentActor = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    schoolName: v.string(),
    schoolSlug: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.clerkId.startsWith("dev_")) {
      throw new Error("IDENTITY_DEV_ONLY: Development bootstrap requires a development identity.");
    }
    const now = Date.now();
    let account = await getAccountByClerkId(ctx, args.clerkId);
    if (!account) {
      const accountId = await ctx.db.insert("accounts", {
        clerkId: args.clerkId,
        email: normalizeEmail(args.email),
        emailVerified: true,
        name: normalizeName(args.name),
        status: "active",
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
      account = await ctx.db.get(accountId);
    }
    if (!account) throw new Error("IDENTITY_BOOTSTRAP_FAILED: Account creation failed.");
    const activeMembership = await getActiveMembership(ctx, account._id);
    if (activeMembership) return { accountId: account._id, schoolId: activeMembership.schoolId };

    const slug = args.schoolSlug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "local-spectra";
    let school = await ctx.db.query("schools").withIndex("by_slug", (query) => query.eq("slug", slug)).unique();
    if (!school) {
      const schoolId = await ctx.db.insert("schools", {
        name: normalizeName(args.schoolName),
        slug,
        verifiedDomains: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      school = await ctx.db.get(schoolId);
    }
    if (!school) throw new Error("IDENTITY_BOOTSTRAP_FAILED: School creation failed.");
    await ctx.db.insert("schoolMemberships", {
      accountId: account._id,
      schoolId: school._id,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId: account._id, schoolId: school._id };
  },
});
