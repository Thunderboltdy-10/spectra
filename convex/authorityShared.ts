import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { findNodesForSource, workspaceContextNodes } from "./orgTreeShared";

export type AuthorityCtx = QueryCtx | MutationCtx;
export type ResourceType = "workspace" | "artifact" | "agent";
export type AccessLevel = "read" | "modify";
export type Capability = "read" | "modify" | "share" | "delete" | "restore" | "use" | "comment" | "publish";

export type VerifiedViewerDomain = {
  authenticated: boolean;
  verified: boolean;
  domain: string | null;
};

/**
 * Read the domain from Convex's verified JWT identity, never from request
 * headers or a browser argument. A signed-in identity with no verified,
 * well-formed email is deliberately not eligible for a restricted link.
 */
export async function getVerifiedViewerDomain(
  ctx: AuthorityCtx,
): Promise<VerifiedViewerDomain> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return { authenticated: false, verified: false, domain: null };

  const email = identity.email?.trim().toLowerCase() ?? "";
  const at = email.lastIndexOf("@");
  const hasValidEmail =
    identity.emailVerified === true &&
    at > 0 &&
    at < email.length - 1 &&
    email.indexOf("@") === at &&
    !/\s/.test(email);
  if (!hasValidEmail)
    return { authenticated: true, verified: false, domain: null };

  return {
    authenticated: true,
    verified: true,
    domain: email.slice(at + 1),
  };
}

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

export type LoadedResource = NonNullable<Awaited<ReturnType<typeof loadResource>>>;

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

async function inheritedArtifactAccess(
  ctx: AuthorityCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  artifactId: Id<"spectraArtifacts">,
  loadedArtifact?: Doc<"spectraArtifacts">,
) {
  const override = await ctx.db.query("artifactAccessOverrides").withIndex("by_artifact_account", (q) => q.eq("artifactId", artifactId).eq("accountId", actor.accountId)).unique();
  if (override?.effect === "deny") return { level: null, denied: true, sources: [] as Array<{ kind: "workspace"; workspaceId: Id<"spectraWorkspaces">; grantId: Id<"accessGrants">; level: AccessLevel }> };

  const [artifact, nodes] = await Promise.all([
    loadedArtifact ?? ctx.db.get(artifactId),
    findNodesForSource(ctx, "work", artifactId),
  ]);
  let level: AccessLevel | null = null;
  const sources: Array<{ kind: "workspace"; workspaceId: Id<"spectraWorkspaces">; grantId: Id<"accessGrants">; level: AccessLevel }> = [];
  const now = Date.now();
  for (const placement of nodes) {
    if (placement.deletedAt !== undefined || !placement.workspaceContextId) continue;
    const workspace = await ctx.db.get(placement.workspaceContextId);
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

async function evaluateLoadedResourceAccess(
  ctx: AuthorityCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  resourceType: ResourceType,
  resourceId: string,
  loaded: LoadedResource | null,
) {
  if (!loaded) return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, reason: "not_found" as const, sources: [] };
  // The only preloaded-resource caller is server-side workspace hydration,
  // which first obtains the row from ctx.db. Keep the resource/type binding
  // explicit so a caller cannot pair a loaded agent with an artifact grant (or
  // vice versa), and never treat a client-supplied projection as authority.
  const expectedResourceId = ctx.db.normalizeId(
    resourceType === "workspace" ? "spectraWorkspaces" : "spectraArtifacts",
    resourceId,
  );
  const loadedResource = loaded.resource;
  const isArtifactResource = "blueprintKey" in loadedResource;
  const artifactResource = isArtifactResource
    ? (loadedResource as Doc<"spectraArtifacts">)
    : null;
  if (
    !expectedResourceId ||
    loadedResource._id !== expectedResourceId ||
    (resourceType === "workspace" ? isArtifactResource : !isArtifactResource) ||
    (resourceType === "agent" && artifactResource?.blueprintKey !== "agent")
  )
    return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, reason: "not_found" as const, sources: [] };
  if (loaded.lifecycle === "deleted") return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, loaded, reason: "deleted" as const, sources: [] };

  const direct = await directAccess(ctx, actor, resourceType, resourceId);
  if (loaded.schoolId && loaded.schoolId !== actor.schoolId) {
    // Cross-school access is never inherited and never projected from a
    // school principal. A deliberate account-level invitation is the sole
    // exception: legacy/external collaborators who already have an active
    // direct grant must receive the same authority in AI, comments, history,
    // and live editing. New-share policy remains enforced by the share flow.
    let directAccountLevel: AccessLevel | null = null;
    for (const source of direct.sources) {
      if (source.kind !== "direct") continue;
      directAccountLevel = directAccountLevel
        ? combineLevel(directAccountLevel, source.level)
        : source.level;
    }
    if (!directAccountLevel)
      return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, loaded, reason: "school_boundary" as const, sources: [] };
    return {
      allowed: true as const,
      level: directAccountLevel,
      capabilities: capabilitiesForLevel(directAccountLevel),
      actor,
      loaded,
      reason: "grant" as const,
      sources: direct.sources.filter((source) => source.kind === "direct"),
    };
  }
  if (loaded.ownerAccountId === actor.accountId) return { allowed: true as const, level: "modify" as const, capabilities: ownerCapabilities, actor, loaded, reason: "owner" as const, sources: [{ kind: "owner" as const }] };
  const inherited = resourceType === "artifact" || resourceType === "agent"
    ? await inheritedArtifactAccess(
        ctx,
        actor,
        loadedResource._id as Id<"spectraArtifacts">,
        loadedResource as Doc<"spectraArtifacts">,
      )
    : { level: null, denied: false, sources: [] };
  if (inherited.denied && !direct.level) return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, loaded, reason: "artifact_exception" as const, sources: inherited.sources };
  // Artifact exceptions narrow only workspace-projected access. A deliberate
  // direct invitation is an independent grant and therefore takes precedence.
  const inheritedLevel = inherited.denied ? null : inherited.level;
  const level = direct.level && inheritedLevel ? combineLevel(direct.level, inheritedLevel) : direct.level ?? inheritedLevel;
  if (!level) return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, loaded, reason: "private" as const, sources: [] };
  return { allowed: true as const, level, capabilities: capabilitiesForLevel(level), actor, loaded, reason: direct.level ? "grant" as const : "workspace_inheritance" as const, sources: [...direct.sources, ...inherited.sources] };
}

export async function evaluateAccessForActor(
  ctx: AuthorityCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  resourceType: ResourceType,
  resourceId: string,
) {
  return evaluateLoadedResourceAccess(
    ctx,
    actor,
    resourceType,
    resourceId,
    await loadResource(ctx, resourceType, resourceId),
  );
}

/** Reuse an artifact row already loaded by a discovery query. */
export async function evaluateAccessForActorWithLoadedResource(
  ctx: AuthorityCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  resourceType: ResourceType,
  resourceId: string,
  loaded: LoadedResource | null,
) {
  // Discovery supplies an explicit agent/artifact grant scope. Generic
  // artifact readers still support agent work through loadResource.
  if (
    resourceType === "artifact" &&
    loaded &&
    "blueprintKey" in loaded.resource &&
    loaded.resource.blueprintKey === "agent"
  )
    return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, reason: "not_found" as const, sources: [] };
  return evaluateLoadedResourceAccess(
    ctx,
    actor,
    resourceType,
    resourceId,
    loaded,
  );
}

export async function evaluateAccess(ctx: AuthorityCtx, resourceType: ResourceType, resourceId: string) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return evaluateAccessForActor(ctx, actor, resourceType, resourceId);
}

/** Replica/payload writes use WORK_NOT_FOUND so existence is not leaked. */
export async function requireActorArtifactCapability(
  ctx: AuthorityCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  workId: Id<"spectraArtifacts">,
  capability: Capability,
) {
  const access = await evaluateAccessForActor(ctx, actor, "artifact", workId);
  if (!access.allowed || !access.capabilities.includes(capability)) {
    throw new Error("WORK_NOT_FOUND");
  }
  return access;
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
  if (resourceType === "workspace") {
    const workspaceId = ctx.db.normalizeId("spectraWorkspaces", resourceId);
    const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
    if (workspace) {
      const placements = await workspaceContextNodes(ctx, workspace._id, "work");
      const affectedArtifactIds = new Set<Id<"spectraArtifacts">>();
      for (const placement of placements) {
        if (!placement.sourceId) continue;
        const artifactId = ctx.db.normalizeId("spectraArtifacts", placement.sourceId);
        const artifact = artifactId ? await ctx.db.get(artifactId) : null;
        if (!artifact || artifact.status === "deleted" || artifact.schoolId !== workspace.schoolId) continue;
        const projectsAccess = placement.accessProjection === true
          || (placement.accessProjection === undefined && artifact.ownerAccountId === workspace.ownerAccountId);
        if (projectsAccess) affectedArtifactIds.add(artifact._id);
      }
      for (const artifactId of affectedArtifactIds) {
        const artifact = await ctx.db.get(artifactId);
        if (!artifact) continue;
        const artifactResourceType = artifact.blueprintKey === "agent" ? "agent" as const : "artifact" as const;
        const artifactPolicy = await ctx.db.query("resourcePolicies").withIndex("by_resource", (q) => q.eq("resourceType", artifactResourceType).eq("resourceId", artifact._id)).unique();
        const artifactVersion = (artifactPolicy?.version ?? 0) + 1;
        if (artifactPolicy) {
          await ctx.db.patch(artifactPolicy._id, { version: artifactVersion, updatedByAccountId: actorAccountId, updatedAt: now });
        } else {
          await ctx.db.insert("resourcePolicies", { resourceType: artifactResourceType, resourceId: artifact._id, schoolId: artifact.schoolId, version: artifactVersion, publicEnabled: false, updatedByAccountId: actorAccountId, createdAt: now, updatedAt: now });
        }
        const rooms = await ctx.db.query("collaborationRooms").withIndex("by_artifact_partition", (q) => q.eq("artifactId", artifact._id)).collect();
        await Promise.all(rooms.map((room) => ctx.db.patch(room._id, { policyVersion: artifactVersion, updatedAt: now })));
      }
    }
  }
  return version;
}
