import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { getActiveMembership, resolveActorContext } from "./identityShared";
import { writeAuditEvent } from "./auditShared";
import type { Id } from "./_generated/dataModel";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function requireSchoolManager(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  operatorSessionId?: Id<"operatorSchoolSessions">,
) {
  const actor = await resolveActorContext(ctx, operatorSessionId);
  const localAdmin =
    actor.membership?.schoolId === schoolId &&
    actor.membership.role === "school_admin";
  const operationalAdmin =
    actor.operatorSession?.schoolId === schoolId &&
    actor.operatorSession.mode === "manage";
  if (!localAdmin && !operationalAdmin) {
    throw new Error(
      "AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.",
    );
  }
  return actor;
}

async function completeOnboardingIfInitialAdmin(
  ctx: MutationCtx,
  invitation: {
    _id: Id<"membershipInvitations">;
    schoolId: Id<"schools">;
    role: "student" | "teacher" | "school_admin";
  },
  actorAccountId: Id<"accounts">,
  now: number,
) {
  if (invitation.role !== "school_admin") return;
  const saga = await ctx.db
    .query("schoolOnboardingSagas")
    .withIndex("by_school", (q) => q.eq("schoolId", invitation.schoolId))
    .unique();
  if (
    !saga ||
    saga.invitationId !== invitation._id ||
    saga.status !== "invited"
  )
    return;
  await ctx.db.patch(saga._id, { status: "ready", updatedAt: now });
  await writeAuditEvent(ctx, {
    actorAccountId,
    schoolId: invitation.schoolId,
    action: "school.onboarding.ready",
    targetType: "school_onboarding",
    targetId: saga._id,
    retentionClass: "security",
  });
}

export const acceptInvitation = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    const invitation = await ctx.db
      .query("membershipInvitations")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!invitation)
      throw new Error("INVITATION_INVALID: This invitation is unavailable.");
    if (normalizeEmail(invitation.email) !== actor.account.email)
      throw new Error(
        "INVITATION_EMAIL_MISMATCH: Sign in with the invited verified email.",
      );
    const now = Date.now();
    const existing = await getActiveMembership(ctx, actor.accountId);
    if (invitation.status === "accepted") {
      if (existing?.schoolId === invitation.schoolId)
        return {
          membershipId: existing._id,
          schoolId: existing.schoolId,
          alreadyMember: true,
        };
      throw new Error("INVITATION_INVALID: This invitation is unavailable.");
    }
    if (invitation.status !== "pending")
      throw new Error("INVITATION_INVALID: This invitation is unavailable.");
    if (invitation.expiresAt <= now) {
      await ctx.db.patch(invitation._id, { status: "expired", updatedAt: now });
      throw new Error("INVITATION_EXPIRED: This invitation has expired.");
    }
    if (existing) {
      if (existing.schoolId === invitation.schoolId) {
        await ctx.db.patch(invitation._id, {
          status: "accepted",
          acceptedAt: now,
          updatedAt: now,
        });
        await completeOnboardingIfInitialAdmin(
          ctx,
          invitation,
          actor.accountId,
          now,
        );
        return {
          membershipId: existing._id,
          schoolId: existing.schoolId,
          alreadyMember: true,
        };
      }
      throw new Error(
        "MEMBERSHIP_SINGLE_SCHOOL: Leave your current school before joining another one.",
      );
    }
    const school = await ctx.db.get(invitation.schoolId);
    if (!school || school.status !== "active")
      throw new Error(
        "INVITATION_SCHOOL_UNAVAILABLE: The school is unavailable.",
      );
    const membershipId = await ctx.db.insert("schoolMemberships", {
      accountId: actor.accountId,
      schoolId: invitation.schoolId,
      role: invitation.role,
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedAt: now,
      updatedAt: now,
    });
    await completeOnboardingIfInitialAdmin(
      ctx,
      invitation,
      actor.accountId,
      now,
    );
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: invitation.schoolId,
      action: "membership.invitation.accepted",
      targetType: "membership",
      targetId: membershipId,
      retentionClass: "security",
    });
    return {
      membershipId,
      schoolId: invitation.schoolId,
      alreadyMember: false,
    };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const actor = await resolveActorContext(ctx);
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_account", (q) => q.eq("accountId", actor.accountId))
      .collect();
    return Promise.all(
      memberships.map(async (membership) => {
        const school = await ctx.db.get(membership.schoolId);
        return {
          membershipId: membership._id,
          role: membership.role,
          status: membership.status,
          joinedAt: membership.joinedAt,
          endedAt: membership.endedAt,
          school: school
            ? {
                schoolId: school._id,
                name: school.name,
                slug: school.slug,
                status: school.status,
                timezone: school.timezone,
              }
            : null,
        };
      }),
    );
  },
});

export const searchSchoolMembers = query({
  args: { search: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    if (!actor.membership || !actor.membershipSchool)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
    const needle = args.search.trim().toLowerCase();
    if (needle.length < 2) return [];
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_school_status", (q) =>
        q.eq("schoolId", actor.membership!.schoolId).eq("status", "active"),
      )
      .collect();
    const accounts = await Promise.all(
      memberships
        .filter((membership) => membership.accountId !== actor.accountId)
        .map(async (membership) => ({
          membership,
          account: await ctx.db.get(membership.accountId),
        })),
    );
    return accounts
      .filter(
        (entry) =>
          entry.account?.status === "active" &&
          `${entry.account.name}\n${entry.account.email}`
            .toLowerCase()
            .includes(needle),
      )
      .sort((left, right) =>
        left.account!.name.localeCompare(right.account!.name),
      )
      .slice(0, Math.max(1, Math.min(args.limit ?? 20, 50)))
      .map(({ account, membership }) => ({
        accountId: account!._id,
        name: account!.name,
        email: account!.email,
        avatarUrl: account!.avatarUrl,
        role: membership.role,
      }));
  },
});

export const invite = mutation({
  args: {
    schoolId: v.id("schools"),
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    email: v.string(),
    role: v.union(
      v.literal("student"),
      v.literal("teacher"),
      v.literal("school_admin"),
    ),
    tokenHash: v.string(),
    expiresAt: v.number(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSchoolManager(
      ctx,
      args.schoolId,
      args.operatorSessionId,
    );
    const email = normalizeEmail(args.email);
    if (!email.includes("@"))
      throw new Error("INVITATION_EMAIL_INVALID: Enter a valid school email.");
    const now = Date.now();
    if (
      args.expiresAt < now + 60_000 ||
      args.expiresAt > now + 30 * 24 * 60 * 60_000
    )
      throw new Error(
        "INVITATION_EXPIRY_INVALID: Invitation expiry must be between one minute and thirty days.",
      );
    const existing = await ctx.db
      .query("membershipInvitations")
      .withIndex("by_email_status", (q) =>
        q.eq("email", email).eq("status", "pending"),
      )
      .collect();
    for (const invite of existing)
      if (invite.schoolId === args.schoolId)
        await ctx.db.patch(invite._id, {
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
        });
    const invitationId = await ctx.db.insert("membershipInvitations", {
      schoolId: args.schoolId,
      email,
      role: args.role,
      tokenHash: args.tokenHash,
      status: "pending",
      invitedByAccountId: actor.accountId,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: args.schoolId,
      operatorSessionId: actor.operatorSession?._id,
      action: "membership.invitation.created",
      targetType: "invitation",
      targetId: invitationId,
      metadata: { email, role: args.role, expiresAt: args.expiresAt },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { invitationId, expiresAt: args.expiresAt };
  },
});
