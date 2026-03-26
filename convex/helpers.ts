import type { Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { DEFAULT_ORG_SLUG, LIMITS } from "./constants";

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
  return orgId as Id<"orgs">;
}

export async function getUserByClerkId(ctx: QueryCtx | MutationCtx, clerkId: string) {
  return ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
}

export function assertRole(actorRole: Role, allowed: Role[]) {
  if (!allowed.includes(actorRole)) {
    throw new Error("Not authorized for this action");
  }
}

export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}
