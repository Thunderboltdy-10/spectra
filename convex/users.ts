import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getOrCreateDefaultOrg, getUserByClerkId } from "./helpers";
import type { Role } from "./helpers";
import { api } from "./_generated/api";
import { addUserToPlatformStats, updateUserInPlatformStats } from "./platformStatsAggregates";
import { ensureStarterWorkspace, normalizeAccessEmail, requireCapacity } from "./accessControl";
import { isSuperAdminEmail } from "./constants";

function isAdminLike(actor: { role: Role; email: string }) {
  return actor.role === "admin" || isSuperAdminEmail(actor.email);
}

const normalizeEmail = normalizeAccessEmail;

function normalizeRole(inputRole?: string): "student" | "teacher" | "admin" {
  if (inputRole === "teacher" || inputRole === "admin") {
    return inputRole;
  }
  return "student";
}

async function expireSiblingPendingInvitations(params: {
  ctx: MutationCtx;
  email: string;
  orgId: Id<"orgs">;
  acceptedInvitationId: Id<"schoolInvitations">;
}) {
  const invitations = await params.ctx.db
    .query("schoolInvitations")
    .withIndex("by_email", (q) => q.eq("email", params.email.trim().toLowerCase()))
    .collect();

  for (const invitation of invitations) {
    if (invitation._id === params.acceptedInvitationId) continue;
    if (invitation.orgId !== params.orgId) continue;
    if (invitation.status !== "pending") continue;
    await params.ctx.db.patch(invitation._id, {
      status: "expired",
    });
  }
}

async function upsertUserFromInvitation(params: {
  ctx: MutationCtx;
  clerkId: string;
  email: string;
  name: string;
  invitation: {
    _id: Id<"schoolInvitations">;
    orgId: Id<"orgs">;
    role: "student" | "teacher" | "admin";
  };
}) {
  const { ctx, clerkId, email, name, invitation } = params;
  const now = Date.now();
  const normalizedEmail = normalizeEmail(email);
  const existing = await getUserByClerkId(ctx, clerkId);
  const existingByEmail = await ctx.db
    .query("users")
    .withIndex("by_org", (q) => q.eq("orgId", invitation.orgId))
    .collect()
    .then((users) => users.find((user) => normalizeEmail(user.email) === normalizedEmail) ?? null);

  const targetUser = existingByEmail ?? existing;

  if (existing && existingByEmail && existing._id !== existingByEmail._id) {
    throw new Error("INVITATION_ACCOUNT_CONFLICT: This email already belongs to another account in the school.");
  }

  if (existing && existing.orgId !== invitation.orgId) {
    throw new Error("ALREADY_IN_ANOTHER_SCHOOL: This account already belongs to another school.");
  }

  if (targetUser?.orgId === invitation.orgId) {
    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedBy: targetUser._id,
      acceptedAt: now,
      updatedAt: now,
    });
    await ensureStarterWorkspace(ctx, targetUser._id, invitation.orgId);
    return { userId: targetUser._id, orgId: invitation.orgId, role: targetUser.role, alreadyMember: true };
  }

  await requireCapacity(ctx, invitation.orgId, { excludeInvitationId: invitation._id });

  let userId = targetUser?._id;
  if (targetUser) {
    const previous = { _id: targetUser._id, role: targetUser.role };
    await ctx.db.patch(targetUser._id, {
      clerkId,
      email: normalizedEmail,
      name,
      role: invitation.role,
      orgId: invitation.orgId,
      invitedAt: now,
      updatedAt: now,
    });
    await updateUserInPlatformStats(ctx, previous, { _id: targetUser._id, role: invitation.role });
  } else {
    userId = await ctx.db.insert("users", {
      clerkId,
      email,
      name,
      role: invitation.role,
      orgId: invitation.orgId,
      invitedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await addUserToPlatformStats(ctx, { _id: userId, role: invitation.role });
  }

  await ctx.db.patch(invitation._id, {
    status: "accepted",
    acceptedBy: userId,
    acceptedAt: now,
    updatedAt: now,
  });
  await expireSiblingPendingInvitations({
    ctx,
    email: email.trim().toLowerCase(),
    orgId: invitation.orgId,
    acceptedInvitationId: invitation._id,
  });

  if (userId) {
    await ensureStarterWorkspace(ctx, userId, invitation.orgId);
    await ctx.runMutation(api.seed.seedDefaultAgents, {
      orgId: invitation.orgId,
      creatorUserId: userId,
    });
  }

  return { userId, orgId: invitation.orgId, role: invitation.role };
}

export const ensureUser = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    requestedRole: v.optional(v.string()),
    bootstrapAdmin: v.boolean(),
    orgId: v.optional(v.id("orgs")),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = normalizeEmail(args.email);
    const isSuperAdmin = isSuperAdminEmail(normalizedEmail);
    
    // If orgId is provided, we look for the user in THAT specific org.
    // If not, we fall back to any existing record (usually for non-super-admins who have only one).
    let existing = await getUserByClerkId(ctx, args.clerkId, args.orgId);

    if (!existing && !args.orgId) {
      // Try to find by email if not found by clerkId to support auto-linking
      // for users manually added by admin or following old links.
      const byEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
        .first();

      if (byEmail) {
        // If this record already has a DIFFERENT clerkId, we have a conflict.
        // We shouldn't auto-link in that case to prevent account hijacking.
        if (byEmail.clerkId && byEmail.clerkId !== args.clerkId) {
          // Fall through
        } else {
          existing = byEmail;
        }
      }
    }

    let orgId = args.orgId ?? existing?.orgId;

    // Super admins should remain operable even if their previous org was deleted.
    if (args.bootstrapAdmin || (isSuperAdmin && !orgId)) {
      if (!orgId) {
        orgId = await getOrCreateDefaultOrg(ctx);
      } else {
        const org = await ctx.db.get(orgId);
        if (!org) {
          orgId = await getOrCreateDefaultOrg(ctx);
        }
      }
    }
    const now = Date.now();

    if (!orgId) {
      throw new Error("INVITATION_TOKEN_REQUIRED: Account must be provisioned via invitation.");
    }

    let role = normalizeRole(args.requestedRole);
    if (args.bootstrapAdmin || isSuperAdmin) {
      role = "admin";
    }

    if (existing) {
      const nextRole = (existing.role === "admin" || isSuperAdmin) ? "admin" : role;
      const previous = { _id: existing._id, role: existing.role };
      await ctx.db.patch(existing._id, {
        clerkId: args.clerkId, // Ensure clerkId is set (links it if it was only email-based)
        email: normalizedEmail,
        name: args.name,
        role: nextRole,
        orgId,
        updatedAt: now,
      });
      await updateUserInPlatformStats(ctx, previous, { _id: existing._id, role: nextRole });

      await ctx.runMutation(api.seed.seedDefaultAgents, {
        orgId,
        creatorUserId: existing._id,
      });
      await ensureStarterWorkspace(ctx, existing._id, orgId);

      return { ...existing, role: nextRole, orgId, clerkId: args.clerkId };
    }

    // Check if they have ANY record to prevent duplicate accounts for non-super-admins
    if (!isSuperAdmin && !args.bootstrapAdmin) {
       const allMemberships = await ctx.db
         .query("users")
         .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
         .collect();
       
       if (allMemberships.length > 0) {
         const matchingOrg = allMemberships.find(m => m.orgId === orgId);
         if (!matchingOrg) {
            // They are trying to join a new org but already have an account elsewhere.
            // Non-super-admins MUST use an invitation token to join a different org.
            throw new Error("INVITATION_TOKEN_REQUIRED: Account must be provisioned via invitation.");
         }
       }
    }

    const userId = await ctx.db.insert("users", {
      clerkId: args.clerkId,
      email: normalizedEmail,
      name: args.name,
      role,
      orgId,
      createdAt: now,
      updatedAt: now,
    });
    await addUserToPlatformStats(ctx, { _id: userId, role });

    await ctx.runMutation(api.seed.seedDefaultAgents, {
      orgId,
      creatorUserId: userId,
    });
    await ensureStarterWorkspace(ctx, userId, orgId);

    return {
      _id: userId,
      clerkId: args.clerkId,
      email: normalizedEmail,
      name: args.name,
      role,
      orgId,
    };
  },
});

export const getAnyByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(args.email)))
      .first();
  },
});

export const me = query({
  args: { clerkId: v.string(), orgId: v.optional(v.id("orgs")) },
  handler: async (ctx, args) => {
    return getUserByClerkId(ctx, args.clerkId, args.orgId);
  },
});

export const accessState = query({
  args: { clerkId: v.string(), orgId: v.optional(v.id("orgs")) },
  handler: async (ctx, args) => {
    const user = await getUserByClerkId(ctx, args.clerkId, args.orgId);
    if (!user) {
      return {
        hasUser: false,
        hasOrg: false,
        orgActive: false,
      };
    }

    const org = await ctx.db.get(user.orgId);
    return {
      hasUser: true,
      hasOrg: Boolean(org),
      orgActive: org ? (org.isActive !== false) : false,
      role: user.role,
      orgId: user.orgId,
      userId: user._id,
    };
  },
});

export const pendingInvitationsForEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const now = Date.now();
    const invitations = await ctx.db
      .query("schoolInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    const active = invitations.filter((invitation) => invitation.status === "pending" && invitation.expiresAt > now);
    return Promise.all(active.map(async (invitation) => {
      const org = await ctx.db.get(invitation.orgId);
      return {
        token: invitation.token,
        email: invitation.email,
        role: invitation.role,
        orgId: invitation.orgId,
        orgName: org?.name ?? "School",
        expiresAt: invitation.expiresAt,
      };
    }));
  },
});

export const syncFromWebhook = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await getUserByClerkId(ctx, args.clerkId);
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: normalizeEmail(args.email),
        name: args.name,
        updatedAt: now,
      });

      await ctx.runMutation(api.seed.seedDefaultAgents, {
        orgId: existing.orgId,
        creatorUserId: existing._id,
      });

      return { userId: existing._id, updated: true };
    }

    return {
      rejected: true,
      reason: "INVITATION_TOKEN_REQUIRED",
    };
  },
});

export const acceptInvitationByToken = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db
      .query("schoolInvitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!invitation) {
      throw new Error("INVITATION_NOT_FOUND: Invitation not found.");
    }
    if (invitation.status !== "pending") {
      if (invitation.status === "accepted") {
        const existing = await getUserByClerkId(ctx, args.clerkId);
        if (existing?.orgId === invitation.orgId && normalizeEmail(existing.email) === normalizeEmail(args.email)) {
          await ensureStarterWorkspace(ctx, existing._id, existing.orgId);
          return { userId: existing._id, orgId: existing.orgId, role: existing.role, alreadyMember: true };
        }
      }
      throw new Error(`INVITATION_${invitation.status.toUpperCase()}: This invitation is ${invitation.status}.`);
    }
    if (invitation.expiresAt <= Date.now()) {
      await ctx.db.patch(invitation._id, { status: "expired" });
      throw new Error("INVITATION_EXPIRED: This invitation has expired.");
    }
    if (invitation.email.toLowerCase() !== args.email.trim().toLowerCase()) {
      throw new Error("INVITATION_EMAIL_MISMATCH: This invitation belongs to a different email address.");
    }

    return upsertUserFromInvitation({
      ctx,
      clerkId: args.clerkId,
      email: args.email,
      name: args.name,
      invitation,
    });
  },
});

export const listUsersInOrg = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || !isAdminLike(actor)) {
      throw new Error("Only admin can list users");
    }

    return ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();
  },
});

export const updateRole = mutation({
  args: {
    actorClerkId: v.string(),
    targetUserId: v.id("users"),
    role: v.union(v.literal("student"), v.literal("teacher"), v.literal("admin")),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || !isAdminLike(actor)) {
      throw new Error("Only admin can update roles");
    }
    if (args.role === "admin") {
      throw new Error("Only super admin can assign admin role");
    }

    const target = await ctx.db.get(args.targetUserId);
    if (!target || target.orgId !== actor.orgId) {
      throw new Error("Invalid target user");
    }
    if (target.role === "admin") {
      throw new Error("Only super admin can demote an admin");
    }

    await ctx.db.patch(args.targetUserId, { role: args.role, updatedAt: Date.now() });
    await updateUserInPlatformStats(
      ctx,
      { _id: target._id, role: target.role },
      { _id: target._id, role: args.role },
    );
    return { ok: true };
  },
});
