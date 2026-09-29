import { mutation, query } from "./functions";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { resolveActorContext } from "./identityShared";

/**
 * Local-only rehearsal seam. It still resolves the caller through the normal
 * verified Clerk identity and platform-operator policy; the local guard is an
 * additional fence, not an alternate login or an authorization bypass.
 */
function assertLocalRehearsal() {
  const deployment = process.env.CONVEX_DEPLOYMENT ?? "";
  const localSelfHosted = process.env.SPECTRA_LOCAL_SELF_HOSTED === "1";
  if ((!/^local[-:]/.test(deployment) && !localSelfHosted) || (process.env.NODE_ENV === "production" && !localSelfHosted))
    throw new Error("LOCAL_REHEARSAL_FORBIDDEN: This helper only runs on a local Convex deployment.");
}

async function requireLocalOperator(ctx: Parameters<typeof resolveActorContext>[0]) {
  assertLocalRehearsal();
  const actor = await resolveActorContext(ctx);
  if (!actor.platformOperator)
    throw new Error("AUTH_OPERATOR_REQUIRED: A configured local platform operator is required.");
  return actor;
}

export const snapshot = query({
  args: { accountEmail: v.string(), schoolId: v.optional(v.id("schools")) },
  handler: async (ctx, args) => {
    const operator = await requireLocalOperator(ctx);
    const email = args.accountEmail.trim().toLowerCase();
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!account) throw new Error("LOCAL_REHEARSAL_ACCOUNT_NOT_FOUND");
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const scopedSchoolId = args.schoolId ?? memberships.find((row) => row.status === "active")?.schoolId;
    const operatorSessions = await ctx.db
      .query("operatorSchoolSessions")
      .withIndex("by_operator", (q) => q.eq("operatorAccountId", operator.accountId))
      .collect();
    const onboarding = scopedSchoolId
      ? await ctx.db.query("schoolOnboardingSagas").withIndex("by_school", (q) => q.eq("schoolId", scopedSchoolId)).collect()
      : [];
    const invitations = scopedSchoolId
      ? await ctx.db.query("membershipInvitations").withIndex("by_school_status", (q) => q.eq("schoolId", scopedSchoolId)).collect()
      : [];
    return {
      schemaVersion: 1,
      capturedAt: Date.now(),
      operatorAccountId: operator.accountId,
      account: {
        _id: account._id,
        clerkId: account.clerkId,
        email: account.email,
        emailVerified: account.emailVerified,
        name: account.name,
        status: account.status,
      },
      memberships,
      operatorSessions,
      onboarding,
      invitations,
    };
  },
});

export const apply = mutation({
  args: {
    accountEmail: v.string(),
    schoolId: v.id("schools"),
    role: v.optional(v.union(v.literal("student"), v.literal("teacher"), v.literal("school_admin"))),
  },
  handler: async (ctx, args) => {
    await requireLocalOperator(ctx);
    const account = await ctx.db.query("accounts").withIndex("by_email", (q) => q.eq("email", args.accountEmail.trim().toLowerCase())).unique();
    const school = await ctx.db.get(args.schoolId);
    if (!account || !school || school.status !== "active") throw new Error("LOCAL_REHEARSAL_TARGET_UNAVAILABLE");
    if (account.status !== "active" || !account.emailVerified) throw new Error("LOCAL_REHEARSAL_IDENTITY_UNVERIFIED");
    const existing = await ctx.db.query("schoolMemberships").withIndex("by_account", (q) => q.eq("accountId", account._id)).collect();
    const active = existing.find((row) => row.status === "active");
    if (active && active.schoolId !== school._id) throw new Error("LOCAL_REHEARSAL_SINGLE_SCHOOL_CONFLICT");
    const now = Date.now();
    if (active) {
      await ctx.db.patch(active._id, { role: args.role ?? "student", status: "active", joinedAt: active.joinedAt ?? now, endedAt: undefined, updatedAt: now });
      return { accountId: account._id, schoolId: school._id, membershipId: active._id, created: false };
    }
    const membershipId = await ctx.db.insert("schoolMemberships", {
      accountId: account._id,
      schoolId: school._id,
      role: args.role ?? "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId: account._id, schoolId: school._id, membershipId, created: true };
  },
});

export const restore = mutation({
  args: { snapshot: v.any() },
  handler: async (ctx, args) => {
    await requireLocalOperator(ctx);
    const snapshot = args.snapshot as {
      account?: { _id?: Id<"accounts"> };
      memberships?: Array<{ _id: Id<"schoolMemberships">; role: "student" | "teacher" | "school_admin"; status: "active" | "invited" | "suspended" | "ended"; joinedAt?: number; endedAt?: number; createdAt: number; updatedAt: number; accountId: Id<"accounts">; schoolId: Id<"schools"> }>;
    };
    const accountId = snapshot.account?._id;
    if (!accountId || !Array.isArray(snapshot.memberships)) throw new Error("LOCAL_REHEARSAL_SNAPSHOT_INVALID");
    const priorIds = new Set(snapshot.memberships.map((row) => row._id));
    const current = await ctx.db.query("schoolMemberships").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect();
    for (const row of current) {
      if (!priorIds.has(row._id)) await ctx.db.delete(row._id);
    }
    for (const row of snapshot.memberships) {
      const existing = await ctx.db.get(row._id);
      if (existing) {
        await ctx.db.patch(existing._id, { role: row.role, status: row.status, joinedAt: row.joinedAt, endedAt: row.endedAt, updatedAt: row.updatedAt });
      } else {
        await ctx.db.insert("schoolMemberships", {
          accountId: row.accountId as Id<"accounts">,
          schoolId: row.schoolId as Id<"schools">,
          role: row.role,
          status: row.status,
          joinedAt: row.joinedAt,
          endedAt: row.endedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }
    }
    return { restored: true, membershipCount: snapshot.memberships.length };
  },
});
