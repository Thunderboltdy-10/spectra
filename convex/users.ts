import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getOrCreateDefaultOrg, getUserByClerkId } from "./helpers";
import { api } from "./_generated/api";
import { addUserToPlatformStats, updateUserInPlatformStats } from "./platformStatsAggregates";

function normalizeRole(inputRole?: string): "student" | "teacher" | "admin" {
  if (inputRole === "teacher" || inputRole === "admin") {
    return inputRole;
  }
  return "student";
}

async function countStudentSeats(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  excludeUserId?: Id<"users">,
) {
  const students = await ctx.db
    .query("users")
    .withIndex("by_org_role", (q) => q.eq("orgId", orgId).eq("role", "student"))
    .collect();

  if (!excludeUserId) {
    return students.length;
  }

  return students.filter((student) => student._id !== excludeUserId).length;
}

async function ensureSeatAvailableForRole(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  role: "student" | "teacher" | "admin",
  excludeUserId?: Id<"users">,
) {
  const org = await ctx.db.get(orgId);
  const maxMembers =
    typeof org?.maxStudents === "number" && Number.isFinite(org.maxStudents) && org.maxStudents > 0
      ? Math.floor(org.maxStudents)
      : null;

  if (!maxMembers) return;

  if (role === "student") {
    const currentStudents = await countStudentSeats(ctx, orgId, excludeUserId);
    if (currentStudents >= maxMembers) {
      throw new Error("SEAT_LIMIT_REACHED: No member seats are currently available for this school.");
    }
    return;
  }

  const members = await ctx.db
    .query("users")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const currentMembers = excludeUserId
    ? members.filter((member) => member._id !== excludeUserId).length
    : members.length;
  if (currentMembers >= maxMembers) {
    throw new Error("SEAT_LIMIT_REACHED: No member seats are currently available for this school.");
  }
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
  const existing = await getUserByClerkId(ctx, clerkId);

  await ensureSeatAvailableForRole(ctx, invitation.orgId, invitation.role, existing?._id);

  let userId = existing?._id;
  if (existing) {
    const previous = { _id: existing._id, role: existing.role };
    await ctx.db.patch(existing._id, {
      email,
      name,
      role: invitation.role,
      orgId: invitation.orgId,
      invitedAt: now,
      updatedAt: now,
    });
    await updateUserInPlatformStats(ctx, previous, { _id: existing._id, role: invitation.role });
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
  });
  await expireSiblingPendingInvitations({
    ctx,
    email: email.trim().toLowerCase(),
    orgId: invitation.orgId,
    acceptedInvitationId: invitation._id,
  });

  if (userId) {
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
  },
  handler: async (ctx, args) => {
    const existing = await getUserByClerkId(ctx, args.clerkId);
    let orgId = existing?.orgId;

    // Super admins should remain operable even if their previous org was deleted.
    if (args.bootstrapAdmin) {
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
    if (args.bootstrapAdmin) {
      role = "admin";
    }

    if (existing) {
      const nextRole = existing.role === "admin" ? "admin" : role;
      const previous = { _id: existing._id, role: existing.role };
      await ctx.db.patch(existing._id, {
        email: args.email,
        name: args.name,
        role: nextRole,
        orgId,
        updatedAt: now,
      });
      await updateUserInPlatformStats(ctx, previous, { _id: existing._id, role: nextRole });

      await ctx.runMutation(api.seed.seedDemoPack, {
        orgId,
        ownerUserId: existing._id,
      });
      await ctx.runMutation(api.seed.seedDefaultAgents, {
        orgId,
        creatorUserId: existing._id,
      });
      await ctx.runMutation(api.seed.migrateLegacyDemoCopy, { orgId });

      return { ...existing, role: nextRole, orgId };
    }

    if (!args.bootstrapAdmin) {
      throw new Error("INVITATION_TOKEN_REQUIRED: Account must be provisioned via invitation.");
    }

    const userId = await ctx.db.insert("users", {
      clerkId: args.clerkId,
      email: args.email,
      name: args.name,
      role,
      orgId,
      createdAt: now,
      updatedAt: now,
    });
    await addUserToPlatformStats(ctx, { _id: userId, role });

    await ctx.runMutation(api.seed.seedDemoPack, {
      orgId,
      ownerUserId: userId,
    });
    await ctx.runMutation(api.seed.seedDefaultAgents, {
      orgId,
      creatorUserId: userId,
    });
    await ctx.runMutation(api.seed.migrateLegacyDemoCopy, { orgId });

    return {
      _id: userId,
      clerkId: args.clerkId,
      email: args.email,
      name: args.name,
      role,
      orgId,
    };
  },
});

export const me = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    return getUserByClerkId(ctx, args.clerkId);
  },
});

export const accessState = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserByClerkId(ctx, args.clerkId);
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
        email: args.email,
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
      throw new Error("INVITATION_NOT_PENDING: This invitation is no longer pending.");
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
    if (!actor || actor.role !== "admin") {
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
    if (!actor || actor.role !== "admin") {
      throw new Error("Only admin can update roles");
    }
    if (args.role === "admin") {
      throw new Error("Only super admin can assign admin role");
    }

    const target = await ctx.db.get(args.targetUserId);
    if (!target || target.orgId !== actor.orgId) {
      throw new Error("Invalid target user");
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
