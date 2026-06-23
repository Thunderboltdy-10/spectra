import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type DbCtx = MutationCtx | QueryCtx;

export const SEAT_LIMIT_ERROR = "SEAT_LIMIT_REACHED";

export function normalizeAccessEmail(value: string) {
  return value.trim().toLowerCase();
}

export function calculateCapacity(maxMembersValue: number | null, memberCount: number, reservedInvitations: number) {
  const maxMembers = typeof maxMembersValue === "number" && Number.isFinite(maxMembersValue)
    ? Math.max(1, Math.floor(maxMembersValue))
    : null;
  const used = Math.max(0, memberCount) + Math.max(0, reservedInvitations);
  return {
    maxMembers,
    memberCount: Math.max(0, memberCount),
    reservedInvitations: Math.max(0, reservedInvitations),
    used,
    available: maxMembers === null ? null : Math.max(0, maxMembers - used),
    full: maxMembers !== null && used >= maxMembers,
  };
}

export async function getCapacitySnapshot(ctx: DbCtx, orgId: Id<"orgs">, options?: {
  excludeInvitationId?: Id<"schoolInvitations">;
  excludeMemberId?: Id<"users">;
}) {
  const now = Date.now();
  const [org, members, pendingInvitations] = await Promise.all([
    ctx.db.get(orgId),
    ctx.db.query("users").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db
      .query("schoolInvitations")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .collect(),
  ]);

  if (!org) throw new Error("SCHOOL_NOT_FOUND: School not found.");
  const memberCount = members.filter((member) => member._id !== options?.excludeMemberId).length;
  const reservedInvitations = pendingInvitations.filter(
    (invitation) => invitation._id !== options?.excludeInvitationId && invitation.expiresAt > now,
  ).length;
  return calculateCapacity(org.maxStudents ?? null, memberCount, reservedInvitations);
}

export async function requireCapacity(ctx: DbCtx, orgId: Id<"orgs">, options?: {
  excludeInvitationId?: Id<"schoolInvitations">;
  excludeMemberId?: Id<"users">;
}) {
  const snapshot = await getCapacitySnapshot(ctx, orgId, options);
  if (snapshot.full) {
    throw new Error(`${SEAT_LIMIT_ERROR}: No seats are available. Revoke an active invitation or remove a member first.`);
  }
  return snapshot;
}

export async function ensureStarterWorkspace(
  ctx: MutationCtx,
  userId: Id<"users">,
  orgId: Id<"orgs">,
) {
  const existing = await ctx.db
    .query("spectraWorkspaces")
    .withIndex("by_owner_starter", (q) => q.eq("ownerUserId", userId).eq("starterKey", "first-access"))
    .unique();
  if (existing) return existing._id;

  const now = Date.now();
  const workspaceId = await ctx.db.insert("spectraWorkspaces", {
    ownerUserId: userId,
    orgId,
    title: "Start here",
    description: "A quiet place to try Spectra. Add a question, document, or study task when you are ready.",
    icon: "Sparkles",
    color: "cyan",
    starterKey: "first-access",
    status: "active",
    defaultView: "cards",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });
  await ctx.db.patch(userId, { starterWorkspaceCreatedAt: now, updatedAt: now });
  return workspaceId;
}
