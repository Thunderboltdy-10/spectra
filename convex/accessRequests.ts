import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";
import { vRole } from "./shared";
import { api } from "./_generated/api";
import { addUserToPlatformStats } from "./platformStatsAggregates";
import { ensureStarterWorkspace, normalizeAccessEmail, requireCapacity } from "./accessControl";

function normalizeEmail(value: string) {
  return normalizeAccessEmail(value);
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizeMessage(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 600) : undefined;
}

async function requireAdmin(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string, orgId?: Id<"orgs">) {
  const actor = await getUserByClerkId(ctx, actorClerkId, orgId);
  if (!actor || actor.role !== "admin") {
    throw new Error("Admin access required");
  }
  return actor;
}

export const searchSchools = query({
  args: {
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const needle = args.query?.trim().toLowerCase() ?? "";
    const orgs = await ctx.db.query("orgs").collect();

    return orgs
      .filter((org) => org.isActive !== false)
      .filter((org) => {
        if (!needle) return true;
        return org.name.toLowerCase().includes(needle) || org.slug.toLowerCase().includes(needle);
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((org) => ({
        _id: org._id,
        name: org.name,
        slug: org.slug,
        description: org.description,
      }));
  },
});

export const createAccessRequest = mutation({
  args: {
    requesterClerkId: v.optional(v.string()),
    orgId: v.id("orgs"),
    email: v.string(),
    name: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org || org.isActive === false) {
      throw new Error("School not found");
    }

    const email = normalizeEmail(args.email);
    const name = normalizeName(args.name);
    if (!email.includes("@")) throw new Error("Valid email is required");
    if (!name) throw new Error("Name is required");

    const members = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    if (members.some((member) => normalizeEmail(member.email) === email)) {
      return {
        status: "already_member" as const,
        orgName: org.name,
      };
    }

    const now = Date.now();
    const existingInvite = await ctx.db
      .query("schoolInvitations")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect()
      .then((rows) => rows.find((row) => normalizeEmail(row.email) === email && row.status === "pending" && row.expiresAt > now));
    if (existingInvite) {
      return {
        status: "invite_pending" as const,
        orgName: org.name,
      };
    }

    const existingRequest = await ctx.db
      .query("accessRequests")
      .withIndex("by_org_email", (q) => q.eq("orgId", args.orgId).eq("email", email))
      .first();

    let requestId = existingRequest?._id;
    if (existingRequest && existingRequest.status === "pending") {
      await ctx.db.patch(existingRequest._id, {
        requesterClerkId: args.requesterClerkId ?? existingRequest.requesterClerkId,
        name,
        message: normalizeMessage(args.message),
        updatedAt: now,
      });
    } else if (existingRequest) {
      await ctx.db.patch(existingRequest._id, {
        requesterClerkId: args.requesterClerkId ?? existingRequest.requesterClerkId,
        name,
        message: normalizeMessage(args.message),
        status: "pending",
        resolvedRole: undefined,
        resolvedBy: undefined,
        updatedAt: now,
      });
    } else {
      requestId = await ctx.db.insert("accessRequests", {
        orgId: args.orgId,
        requesterClerkId: args.requesterClerkId,
        email,
        name,
        message: normalizeMessage(args.message),
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }

    const admins = await ctx.db
      .query("users")
      .withIndex("by_org_role", (q) => q.eq("orgId", args.orgId).eq("role", "admin"))
      .collect();
    for (const admin of admins) {
      await ctx.db.insert("notifications", {
        userId: admin._id,
        orgId: admin.orgId,
        type: "access_request",
        title: "New access request",
        body: `${name} requested access for ${email}.`,
        actionUrl: "/admin",
        read: false,
        createdAt: now,
      });
    }

    return {
      status: "requested" as const,
      requestId,
      orgName: org.name,
    };
  },
});

export const listOrgAccessRequests = query({
  args: {
    actorClerkId: v.string(),
    orgId: v.optional(v.id("orgs")),
    status: v.optional(v.union(v.literal("pending"), v.literal("invited"), v.literal("approved"), v.literal("rejected"))),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);
    const requests = await ctx.db
      .query("accessRequests")
      .withIndex("by_org_status", (q) => q.eq("orgId", actor.orgId).eq("status", args.status ?? "pending"))
      .collect();

    return requests.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const approveAccessRequest = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.optional(v.id("orgs")),
    requestId: v.id("accessRequests"),
    role: vRole,
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);
    if (args.role === "admin") throw new Error("Only the superadmin can promote school admins.");
    const request = await ctx.db.get(args.requestId);
    if (!request || request.orgId !== actor.orgId) throw new Error("Access request not found");
    if (request.status === "rejected") throw new Error("This request was rejected. Ask the user to submit a new request.");
    if (!request.requesterClerkId) throw new Error("REQUEST_IDENTITY_MISSING: The requester must sign in and submit again.");

    const now = Date.now();
    const existing = await getUserByClerkId(ctx, request.requesterClerkId);
    if (existing && existing.orgId !== request.orgId) {
      throw new Error("ALREADY_IN_ANOTHER_SCHOOL: This user already belongs to another school.");
    }
    if (existing?.orgId === request.orgId) {
      await ctx.db.patch(request._id, {
        status: "approved",
        resolvedRole: existing.role,
        resolvedBy: actor._id,
        resolvedAt: now,
        updatedAt: now,
      });
      await ensureStarterWorkspace(ctx, existing._id, existing.orgId);
      return { ok: true, alreadyMember: true, userId: existing._id };
    }

    const activeInvitation = await ctx.db
      .query("schoolInvitations")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(request.email)))
      .collect()
      .then((rows) => rows.find((row) => row.orgId === request.orgId && row.status === "pending" && row.expiresAt > now));
    await requireCapacity(ctx, request.orgId, { excludeInvitationId: activeInvitation?._id });

    const userId = await ctx.db.insert("users", {
      clerkId: request.requesterClerkId,
      email: normalizeEmail(request.email),
      name: request.name,
      role: args.role,
      orgId: request.orgId,
      invitedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await addUserToPlatformStats(ctx, { _id: userId, role: args.role });
    if (activeInvitation) {
      await ctx.db.patch(activeInvitation._id, {
        status: "accepted",
        acceptedBy: userId,
        acceptedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(request._id, {
      status: "approved",
      resolvedRole: args.role,
      resolvedBy: actor._id,
      resolvedAt: now,
      updatedAt: now,
    });
    await ensureStarterWorkspace(ctx, userId, request.orgId);
    await ctx.runMutation(api.seed.seedDefaultAgents, { orgId: request.orgId, creatorUserId: userId });
    return { ok: true, userId };
  },
});

export const rejectAccessRequest = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.optional(v.id("orgs")),
    requestId: v.id("accessRequests"),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.orgId !== actor.orgId) throw new Error("Access request not found");
    if (request.status === "approved") throw new Error("An approved request cannot be rejected.");
    if (request.status === "rejected") return { ok: true, alreadyRejected: true };
    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: "rejected",
      resolvedRole: undefined,
      resolvedBy: actor._id,
      resolvedAt: now,
      updatedAt: now,
    });
    return { ok: true };
  },
});

export const getRequesterState = query({
  args: { requesterClerkId: v.string() },
  handler: async (ctx, args) => {
    const requests = await ctx.db
      .query("accessRequests")
      .withIndex("by_requester", (q) => q.eq("requesterClerkId", args.requesterClerkId))
      .collect();
    const latest = requests.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!latest) return null;
    const org = await ctx.db.get(latest.orgId);
    return {
      requestId: latest._id,
      status: latest.status,
      orgId: latest.orgId,
      orgName: org?.name ?? "School",
      updatedAt: latest.updatedAt,
    };
  },
});
