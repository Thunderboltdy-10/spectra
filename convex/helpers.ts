import type { Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { DEFAULT_ORG_SLUG, LIMITS } from "./constants";
import { addOrgToPlatformStats } from "./platformStatsAggregates";

export type Role = "student" | "teacher" | "admin";

export async function getOrCreateDefaultOrg(ctx: MutationCtx): Promise<Id<"orgs">> {
  const existing = await ctx.db
    .query("orgs")
    .withIndex("by_slug", (q) => q.eq("slug", DEFAULT_ORG_SLUG))
    .unique();
  if (existing) {
    return existing._id as Id<"orgs">;
  }
  const now = Date.now();
  const orgId = await ctx.db.insert("orgs", {
    name: "Spectra Demo Workspace",
    slug: DEFAULT_ORG_SLUG,
    tokenBudgetDaily: LIMITS.defaultTokenBudgetPerOrgDaily,
    verifyMarkerPassEnabled: false,
    orchestratorV2Enabled: true,
    soulEnabled: true,
    agentModelBoostEnabled: true,
    adaptiveQuizEnabled: true,
    spacedRepetitionEnabled: true,
    createdAt: now,
    updatedAt: now,
  });
  await addOrgToPlatformStats(ctx, orgId);
  return orgId as Id<"orgs">;
}

export async function getUserByClerkId(ctx: QueryCtx | MutationCtx, clerkId: string, orgId?: Id<"orgs">) {
  if (orgId) {
    return ctx.db
      .query("users")
      .withIndex("by_clerk_id_org", (q) => q.eq("clerkId", clerkId).eq("orgId", orgId))
      .unique();
  }
  return ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
}

export async function adjustWorkstreamArtifactCount(
  ctx: Pick<MutationCtx, "db">,
  workstreamId: Id<"workstreams"> | undefined,
  delta: number,
) {
  if (!workstreamId || delta === 0) return;
  const workstream = await ctx.db.get(workstreamId);
  if (!workstream) return;
  await ctx.db.patch(workstreamId, {
    artifactCount: Math.max(0, (workstream.artifactCount ?? 0) + delta),
    updatedAt: Date.now(),
  });
}

export function assertRole(actorRole: Role, allowed: Role[]) {
  if (!allowed.includes(actorRole)) {
    throw new Error("Not authorized for this action");
  }
}

export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}
