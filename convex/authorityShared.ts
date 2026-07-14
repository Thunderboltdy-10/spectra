import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";

export type AuthorityCtx = QueryCtx | MutationCtx;
export type ResourceType = "workspace" | "artifact" | "agent";
export type AccessLevel = "read" | "modify";
export type Capability = "read" | "modify" | "share" | "delete" | "restore" | "use" | "comment" | "publish";

const ownerCapabilities: Capability[] = ["read", "modify", "share", "delete", "restore", "use", "comment", "publish"];
const levelCapabilities: Record<AccessLevel, Capability[]> = {
  // Comments are a collaboration layer over an artifact, not a mutation of
  // its authored content. A read-only invite therefore remains read-only while
  // still allowing the recipient to participate in anchored discussion.
  read: ["read", "use", "comment"],
  modify: ["read", "modify", "restore", "use", "comment"],
};

export function capabilitiesForLevel(level: AccessLevel) {
  return levelCapabilities[level];
}

export async function listDirectlyGrantedResourceIds(
  ctx: AuthorityCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  resourceType: ResourceType,
) {
  const now = Date.now();
  const [accountGrants, schoolGrants] = await Promise.all([
    ctx.db.query("accessGrants").withIndex("by_principal", (q) => q.eq("principalType", "account").eq("principalId", actor.accountId)).collect(),
    ctx.db.query("accessGrants").withIndex("by_principal", (q) => q.eq("principalType", "school").eq("principalId", actor.schoolId)).collect(),
  ]);
  return [...new Set([...accountGrants, ...schoolGrants]
    .filter((grant) => grant.resourceType === resourceType && grant.source === "direct" && activeGrant(grant, now))
    .map((grant) => grant.resourceId))];
}

export async function loadResource(ctx: AuthorityCtx, resourceType: ResourceType, resourceId: string) {
  if (resourceType === "workspace") {
    const id = ctx.db.normalizeId("spectraWorkspaces", resourceId);
    const resource = id ? await ctx.db.get(id) : null;
    if (!resource) return null;
    return { resource, ownerAccountId: resource.ownerAccountId, schoolId: resource.schoolId, lifecycle: resource.status };
  }
  const id = ctx.db.normalizeId("spectraArtifacts", resourceId);
  const resource = id ? await ctx.db.get(id) : null;
  if (!resource || (resourceType === "agent" && resource.blueprintKey !== "agent")) return null;
  return { resource, ownerAccountId: resource.ownerAccountId, schoolId: resource.schoolId, lifecycle: resource.status };
}

function activeGrant(grant: Doc<"accessGrants">, now: number) {
  return !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now);
}

function combineLevel(current: AccessLevel | null, candidate: AccessLevel): AccessLevel {
  return current === "modify" || candidate === "modify" ? "modify" : "read";
}

async function directAccess(ctx: AuthorityCtx, actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>, resourceType: ResourceType, resourceId: string) {
  const now = Date.now();
  const grants = await ctx.db.query("accessGrants").withIndex("by_resource", (q) => q.eq("resourceType", resourceType).eq("resourceId", resourceId)).collect();
  let level: AccessLevel | null = null;
  const sources: Array<{ kind: "direct" | "school"; grantId: Id<"accessGrants">; level: AccessLevel }> = [];
  for (const grant of grants) {
    if (!activeGrant(grant, now) || grant.source !== "direct") continue;
    const matchesAccount = grant.principalType === "account" && grant.principalId === actor.accountId;
    const matchesSchool = grant.principalType === "school" && grant.principalId === actor.schoolId;
    if (!matchesAccount && !matchesSchool) continue;
    level = combineLevel(level, grant.level);
    sources.push({ kind: matchesAccount ? "direct" : "school", grantId: grant._id, level: grant.level });
  }
  return { level, sources };
}

async function inheritedArtifactAccess(ctx: AuthorityCtx, actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>, artifactId: Id<"spectraArtifacts">) {
  const override = await ctx.db.query("artifactAccessOverrides").withIndex("by_artifact_account", (q) => q.eq("artifactId", artifactId).eq("accountId", actor.accountId)).unique();
  if (override?.effect === "deny") return { level: null, denied: true, sources: [] as Array<{ kind: "workspace"; workspaceId: Id<"spectraWorkspaces">; grantId: Id<"accessGrants">; level: AccessLevel }> };

  const [artifact, placements] = await Promise.all([
    ctx.db.get(artifactId),
    ctx.db.query("spectraWorkspaceItems").withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", artifactId)).collect(),
  ]);
  let level: AccessLevel | null = null;
  const sources: Array<{ kind: "workspace"; workspaceId: Id<"spectraWorkspaces">; grantId: Id<"accessGrants">; level: AccessLevel }> = [];
  const now = Date.now();
  for (const placement of placements) {
    if (placement.viewData.hidden) continue;
    const workspace = await ctx.db.get(placement.workspaceId);
    if (!workspace || workspace.status !== "active" || workspace.schoolId !== actor.schoolId) continue;
    // A recipient may organize an accepted shared artifact in any workspace
    // they can modify. That personal placement must not silently re-share the
    // artifact with the workspace audience. Older placements predate this flag;
    // only an owner-to-owner placement is safe to treat as projecting access.
    const projectsAccess = placement.accessProjection === true
      || (placement.accessProjection === undefined && artifact?.ownerAccountId === workspace.ownerAccountId);
    if (!projectsAccess) continue;
    const grants = await ctx.db.query("accessGrants").withIndex("by_resource", (q) => q.eq("resourceType", "workspace").eq("resourceId", workspace._id)).collect();
    for (const grant of grants) {
      if (!activeGrant(grant, now) || grant.source !== "direct") continue;
      const accountMatch = grant.principalType === "account" && grant.principalId === actor.accountId;
      const schoolMatch = grant.principalType === "school" && grant.principalId === actor.schoolId;
      if (!accountMatch && !schoolMatch) continue;
      level = combineLevel(level, grant.level);
      sources.push({ kind: "workspace", workspaceId: workspace._id, grantId: grant._id, level: grant.level });
    }
  }
  if (override?.effect === "restrict" && override.maxLevel === "read" && level) level = "read";
  return { level, denied: false, sources };
}

export async function evaluateAccessForActor(
  ctx: AuthorityCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  resourceType: ResourceType,
  resourceId: string,
) {
  const loaded = await loadResource(ctx, resourceType, resourceId);
  if (!loaded) return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, reason: "not_found" as const, sources: [] };
  if (loaded.schoolId && loaded.schoolId !== actor.schoolId) return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, reason: "school_boundary" as const, sources: [] };
  if (loaded.ownerAccountId === actor.accountId) return { allowed: true as const, level: "modify" as const, capabilities: ownerCapabilities, actor, loaded, reason: "owner" as const, sources: [{ kind: "owner" as const }] };
  if (loaded.lifecycle === "deleted") return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, loaded, reason: "deleted" as const, sources: [] };

  const direct = await directAccess(ctx, actor, resourceType, resourceId);
  const inherited = resourceType === "artifact" || resourceType === "agent"
    ? await inheritedArtifactAccess(ctx, actor, loaded.resource._id as Id<"spectraArtifacts">)
    : { level: null, denied: false, sources: [] };
  if (inherited.denied) return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, loaded, reason: "artifact_exception" as const, sources: inherited.sources };
  const level = direct.level && inherited.level ? combineLevel(direct.level, inherited.level) : direct.level ?? inherited.level;
  if (!level) return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, loaded, reason: "private" as const, sources: [] };
  return { allowed: true as const, level, capabilities: capabilitiesForLevel(level), actor, loaded, reason: direct.level ? "grant" as const : "workspace_inheritance" as const, sources: [...direct.sources, ...inherited.sources] };
}

export async function evaluateAccess(ctx: AuthorityCtx, resourceType: ResourceType, resourceId: string) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return evaluateAccessForActor(ctx, actor, resourceType, resourceId);
}

export async function requireCapability(ctx: AuthorityCtx, resourceType: ResourceType, resourceId: string, capability: Capability) {
  const decision = await evaluateAccess(ctx, resourceType, resourceId);
  if (!decision.allowed || !decision.capabilities.includes(capability)) throw new Error("AUTH_RESOURCE_FORBIDDEN: You do not have permission for this action.");
  return decision;
}

export async function bumpPolicyVersion(ctx: MutationCtx, resourceType: ResourceType, resourceId: string, schoolId: Id<"schools"> | undefined, actorAccountId: Id<"accounts">) {
  const existing = await ctx.db.query("resourcePolicies").withIndex("by_resource", (q) => q.eq("resourceType", resourceType).eq("resourceId", resourceId)).unique();
  const now = Date.now();
  let version: number;
  if (existing) {
    version = existing.version + 1;
    await ctx.db.patch(existing._id, { version, schoolId, updatedByAccountId: actorAccountId, updatedAt: now });
  } else {
    version = 1;
    await ctx.db.insert("resourcePolicies", { resourceType, resourceId, schoolId, version, publicEnabled: false, updatedByAccountId: actorAccountId, createdAt: now, updatedAt: now });
  }
  if (resourceType === "artifact" || resourceType === "agent") {
    const artifactId = ctx.db.normalizeId("spectraArtifacts", resourceId);
    if (artifactId) {
      const rooms = await ctx.db.query("collaborationRooms").withIndex("by_artifact_partition", (q) => q.eq("artifactId", artifactId)).collect();
      await Promise.all(rooms.map((room) => ctx.db.patch(room._id, { policyVersion: version, updatedAt: now })));
    }
  }
  return version;
}
