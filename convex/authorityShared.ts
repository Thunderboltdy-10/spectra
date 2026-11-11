import { internal } from "./_generated/api";
import { collaborationGatewayOrigin } from "./collaborationPolicyPush";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor, getActorForAccountId, type AuthenticatedActor } from "./identityShared";
import { evaluateCurrentPinnedArtifactPlacement } from "./artifactEmbedPlacementEvidence";
import {
  ARTIFACT_SUMMARY_READ_MODEL_VERSION,
  artifactSummaryFor,
  findNodesForSource,
  workspaceContextNodes,
  sharesWithWorkspace,
} from "./orgTreeShared";

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
    ctx.db.query("accessGrants").withIndex("by_principal_resource_source", (q) =>
      q.eq("principalType", "account")
        .eq("principalId", actor.accountId)
        .eq("resourceType", resourceType)
        .eq("source", "direct"),
    ).collect(),
    ctx.db.query("accessGrants").withIndex("by_principal_resource_source", (q) =>
      q.eq("principalType", "school")
        .eq("principalId", actor.schoolId)
        .eq("resourceType", resourceType)
        .eq("source", "direct"),
    ).collect(),
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

/**
 * The authority facts needed by discovery/status readers.  This deliberately
 * has no title, content, snapshot, plan, transcript or projection field: the
 * summary row is a permission source, not a cache of the payload row.
 */
export type ArtifactAuthorityResource = {
  _id: Id<"spectraArtifacts">;
  ownerAccountId: Id<"accounts">;
  schoolId?: Id<"schools">;
  blueprintKey: string;
  status: Doc<"spectraArtifacts">["status"];
};

export type LoadedArtifactAuthority = {
  resource: ArtifactAuthorityResource;
  ownerAccountId: Id<"accounts">;
  schoolId?: Id<"schools">;
  lifecycle: Doc<"spectraArtifacts">["status"];
  /** True only when a legacy/missing summary required the bounded fallback. */
  usedLegacyFallback?: boolean;
};

type ArtifactAuthoritySummary = Awaited<ReturnType<typeof artifactSummaryFor>>;

/**
 * Load only the current artifact authority facts for list/tree/status paths.
 * A missing or old projection is a bounded compatibility fallback, not a
 * second steady-state read model.  The migration below repairs those rows in
 * pages so this branch naturally disappears after rollout.
 */
export async function loadArtifactAuthority(
  ctx: AuthorityCtx,
  artifactId: Id<"spectraArtifacts">,
): Promise<LoadedArtifactAuthority | null> {
  return loadArtifactAuthorityFromSummary(
    ctx,
    artifactId,
    await artifactSummaryFor(ctx, artifactId),
  );
}

async function loadArtifactAuthorityFromSummary(
  ctx: AuthorityCtx,
  artifactId: Id<"spectraArtifacts">,
  summary: ArtifactAuthoritySummary,
): Promise<LoadedArtifactAuthority | null> {
  if (
    summary &&
    summary.readModelVersion === ARTIFACT_SUMMARY_READ_MODEL_VERSION
  ) {
    const resource = {
      _id: summary.artifactId,
      ownerAccountId: summary.ownerAccountId,
      schoolId: summary.schoolId,
      blueprintKey: summary.blueprintKey,
      status: summary.status,
    } satisfies ArtifactAuthorityResource;
    return {
      resource,
      ownerAccountId: resource.ownerAccountId,
      schoolId: resource.schoolId,
      lifecycle: resource.status,
    };
  }
  const artifact = await ctx.db.get(artifactId);
  if (!artifact) return null;
  return {
    resource: {
      _id: artifact._id,
      ownerAccountId: artifact.ownerAccountId,
      schoolId: artifact.schoolId,
      blueprintKey: artifact.blueprintKey,
      status: artifact.status,
    },
    ownerAccountId: artifact.ownerAccountId,
    schoolId: artifact.schoolId,
    lifecycle: artifact.status,
    usedLegacyFallback: true,
  };
}

function activeGrant(grant: Doc<"accessGrants">, now: number) {
  return !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now);
}

/** A read proof needs one active grant, not every member of the audience.
 * Used by bounded metadata discovery; full capability/source inspection keeps
 * using evaluateAccess. The index ranges preserve activeGrant's legacy zero
 * timestamp semantics and never scan expired/revoked history.
 */
export async function hasDirectReadGrant(
  ctx: AuthorityCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  resourceType: ResourceType,
  resourceId: string,
  accountOnly = false,
) {
  const now = Date.now();
  const principals = accountOnly ? ["account"] as const : ["account", "school"] as const;
  for (const principalType of principals) {
    // Most negative checks have no grant at all. One bounded prefix probe
    // avoids six empty expiry ranges while still handling historical grants.
    const first = await ctx.db.query("accessGrants")
      .withIndex("by_resource_principal_live_expiry", q => q
        .eq("resourceType", resourceType).eq("resourceId", resourceId)
        .eq("principalType", principalType)
        .eq("principalId", principalType === "account" ? actor.accountId : actor.schoolId)
        .eq("source", "direct"))
      .first();
    if (!first) continue;
    if (activeGrant(first, now)) return true;
    for (const revokedAt of [undefined, 0]) {
      for (const expiry of ["future", "absent", "zero"] as const) {
        const grant = await ctx.db.query("accessGrants")
          .withIndex("by_resource_principal_live_expiry", (q) => {
            const prefix = q.eq("resourceType", resourceType).eq("resourceId", resourceId)
              .eq("principalType", principalType)
              .eq("principalId", principalType === "account" ? actor.accountId : actor.schoolId)
              .eq("source", "direct").eq("revokedAt", revokedAt);
            return expiry === "future" ? prefix.gt("expiresAt", now)
              : prefix.eq("expiresAt", expiry === "zero" ? 0 : undefined);
          }).first();
        if (grant && activeGrant(grant, now)) return true;
      }
    }
  }
  return false;
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
  _ownerAccountId: Id<"accounts">,
) {
  const override = await ctx.db.query("artifactAccessOverrides").withIndex("by_artifact_account", (q) => q.eq("artifactId", artifactId).eq("accountId", actor.accountId)).unique();
  if (override?.effect === "deny") return { level: null, denied: true, sources: [] as Array<{ kind: "workspace"; workspaceId: Id<"spectraWorkspaces">; grantId: Id<"accessGrants">; level: AccessLevel }> };

  const nodes = await findNodesForSource(ctx, "work", artifactId);
  let level: AccessLevel | null = null;
  const sources: Array<{ kind: "workspace"; workspaceId: Id<"spectraWorkspaces">; grantId: Id<"accessGrants">; level: AccessLevel }> = [];
  const now = Date.now();
  for (const placement of nodes) {
    if (placement.deletedAt !== undefined || !placement.workspaceContextId) continue;
    const workspace = await ctx.db.get(placement.workspaceContextId);
    if (!workspace || workspace.status !== "active" || workspace.schoolId !== actor.schoolId) continue;
    // A recipient may organize an accepted shared artifact in any workspace
    // they can modify. That personal placement must not silently re-share the
    // artifact with the workspace audience, and the owner's own placement
    // shares only once they share it.
    const projectsAccess = sharesWithWorkspace(placement);
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
  // Private: only evaluateRetainedPinAccess may request this, after proving
  // the exact current placement. Public live/history evaluators never pass it.
  retainedPinRead = false,
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
  if (loaded.lifecycle === "deleted" && !retainedPinRead) return { allowed: false as const, level: null, capabilities: [] as Capability[], actor, loaded, reason: "deleted" as const, sources: [] };

  // Same-school ownership needs no grant scan. Keep cross-school ownership
  // behind the explicit account-grant check below, and lifecycle/type checks
  // above this fast path.
  if (loaded.schoolId === actor.schoolId && loaded.ownerAccountId === actor.accountId)
    return { allowed: true as const, level: "modify" as const, capabilities: ownerCapabilities, actor, loaded, reason: "owner" as const, sources: [{ kind: "owner" as const }] };
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
  if (loaded.schoolId === actor.schoolId && loaded.ownerAccountId === actor.accountId) return { allowed: true as const, level: "modify" as const, capabilities: ownerCapabilities, actor, loaded, reason: "owner" as const, sources: [{ kind: "owner" as const }] };
  const inherited = resourceType === "artifact" || resourceType === "agent"
    ? await inheritedArtifactAccess(
        ctx,
        actor,
        loadedResource._id as Id<"spectraArtifacts">,
        loadedResource.ownerAccountId,
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

export type RetainedPinAccess = {
  allowed: false;
  reason: "placement_unavailable";
  placementRefreshKey?: string;
} | {
  allowed: false;
  reason: "host_unavailable" | "source_forbidden" | "version_unavailable";
} | {
  allowed: true;
  embed: Doc<"artifactEmbeds">;
  source: Doc<"spectraArtifacts">;
  version: Doc<"spectraArtifactVersions">;
  /** Used only for existing quiz learner redaction, never write authority. */
  sourceLevel: AccessLevel;
  capabilities: readonly ["read"];
};

/** Exact retained-pin authority. Host access never creates source access.
 * Kept beside the private grant core so no generic deleted-source option is
 * exported to live, history, restoration or modification callers. */
export async function evaluateRetainedPinAccess(
  ctx: AuthorityCtx,
  actor: AuthenticatedActor,
  embedId: Id<"artifactEmbeds">,
): Promise<RetainedPinAccess> {
  const current = await getActorForAccountId(ctx, actor.accountId);
  if (!current || current.schoolId !== actor.schoolId)
    return { allowed: false, reason: "source_forbidden" };
  const embed = await ctx.db.get(embedId);
  if (!embed || embed.removedAt !== undefined || embed.placementState === "removed" || embed.versionPolicy !== "pinned" || !embed.pinnedVersionId)
    return { allowed: false, reason: "placement_unavailable" };
  const source = await ctx.db.get(embed.sourceArtifactId);
  if (!source) return { allowed: false, reason: "source_forbidden" };
  const version = await ctx.db.get(embed.pinnedVersionId);
  if (!version || version.artifactId !== source._id ||
      (version.schoolId !== undefined && version.schoolId !== source.schoolId))
    return { allowed: false, reason: "version_unavailable" };

  if (embed.containerType === "thread") {
    const threadId = ctx.db.normalizeId("spectraThreads", embed.containerId);
    const host = threadId ? await ctx.db.get(threadId) : null;
    if (!host || host.status === "deleted" || host.ownerAccountId !== current.accountId || host.schoolId !== current.schoolId ||
        (embed.schoolId !== undefined && embed.schoolId !== host.schoolId))
      return { allowed: false, reason: "host_unavailable" };
    // The thread row is the placement; there is no second editor save.
    if (embed.placementState !== "confirmed" ||
        (embed.placementExpiresAt !== undefined && embed.placementExpiresAt <= Date.now()))
      return { allowed: false, reason: "placement_unavailable" };
  } else {
    const hostId = ctx.db.normalizeId("spectraArtifacts", embed.containerId);
    const host = hostId ? await ctx.db.get(hostId) : null;
    if (!host || (host.status !== "active" && host.status !== "draft") ||
        (embed.schoolId !== undefined && embed.schoolId !== host.schoolId))
      return { allowed: false, reason: "host_unavailable" };
    const hostAccess = await evaluateLoadedResourceAccess(ctx, current,
      host.blueprintKey === "agent" ? "agent" : "artifact", host._id,
      { resource: host, ownerAccountId: host.ownerAccountId, schoolId: host.schoolId, lifecycle: host.status });
    if (!hostAccess.allowed || !hostAccess.capabilities.includes("read"))
      return { allowed: false, reason: "host_unavailable" };
    // HISTORY owns canonical/legacy/offload/room-head proof. A state flag or
    // old insertion receipt alone never proves a surviving current placement.
    const placement = await evaluateCurrentPinnedArtifactPlacement(ctx, { embed, host });
    if (!placement.present)
      return { allowed: false, reason: "placement_unavailable", ...(placement.headHash ? { placementRefreshKey: placement.headHash } : {}) };
  }

  const sourceAccess = await evaluateLoadedResourceAccess(ctx, current,
    source.blueprintKey === "agent" ? "agent" : "artifact", source._id,
    { resource: source, ownerAccountId: source.ownerAccountId, schoolId: source.schoolId, lifecycle: source.status }, true);
  if (!sourceAccess.allowed || !sourceAccess.level || !sourceAccess.capabilities.includes("read"))
    return { allowed: false, reason: "source_forbidden" };
  return { allowed: true, embed, source, version, sourceLevel: sourceAccess.level, capabilities: ["read"] };
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

async function evaluateLoadedArtifactAuthority(
  ctx: AuthorityCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  resourceType: "artifact" | "agent",
  resourceId: string,
  loaded: LoadedArtifactAuthority | null,
) {
  if (!loaded)
    return {
      allowed: false as const,
      level: null,
      capabilities: [] as Capability[],
      actor,
      reason: "not_found" as const,
      sources: [],
    };
  const expectedResourceId = ctx.db.normalizeId("spectraArtifacts", resourceId);
  if (
    !expectedResourceId ||
    loaded.resource._id !== expectedResourceId ||
    (resourceType === "agent" && loaded.resource.blueprintKey !== "agent") ||
    (resourceType === "artifact" && loaded.resource.blueprintKey === "agent")
  )
    return {
      allowed: false as const,
      level: null,
      capabilities: [] as Capability[],
      actor,
      reason: "not_found" as const,
      sources: [],
    };
  if (loaded.lifecycle === "deleted")
    return {
      allowed: false as const,
      level: null,
      capabilities: [] as Capability[],
      actor,
      loaded,
      reason: "deleted" as const,
      sources: [],
    };

  if (loaded.schoolId === actor.schoolId && loaded.ownerAccountId === actor.accountId)
    return {
      allowed: true as const,
      level: "modify" as const,
      capabilities: ownerCapabilities,
      actor,
      loaded,
      reason: "owner" as const,
      sources: [{ kind: "owner" as const }],
    };
  const direct = await directAccess(ctx, actor, resourceType, resourceId);
  if (loaded.schoolId && loaded.schoolId !== actor.schoolId) {
    let directAccountLevel: AccessLevel | null = null;
    for (const source of direct.sources) {
      if (source.kind !== "direct") continue;
      directAccountLevel = directAccountLevel
        ? combineLevel(directAccountLevel, source.level)
        : source.level;
    }
    if (!directAccountLevel)
      return {
        allowed: false as const,
        level: null,
        capabilities: [] as Capability[],
        actor,
        loaded,
        reason: "school_boundary" as const,
        sources: [],
      };
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
  const inherited = await inheritedArtifactAccess(
    ctx,
    actor,
    loaded.resource._id,
    loaded.ownerAccountId,
  );
  if (inherited.denied && !direct.level)
    return {
      allowed: false as const,
      level: null,
      capabilities: [] as Capability[],
      actor,
      loaded,
      reason: "artifact_exception" as const,
      sources: inherited.sources,
    };
  const inheritedLevel = inherited.denied ? null : inherited.level;
  const level = direct.level && inheritedLevel
    ? combineLevel(direct.level, inheritedLevel)
    : direct.level ?? inheritedLevel;
  if (!level)
    return {
      allowed: false as const,
      level: null,
      capabilities: [] as Capability[],
      actor,
      loaded,
      reason: "private" as const,
      sources: [],
    };
  return {
    allowed: true as const,
    level,
    capabilities: capabilitiesForLevel(level),
    actor,
    loaded,
    reason: direct.level ? ("grant" as const) : ("workspace_inheritance" as const),
    sources: [...direct.sources, ...inherited.sources],
  };
}

/**
 * Permission evaluation for list/tree/status reads.  It uses the versioned
 * compact artifact authority row and the live grant/placement policy, never a
 * client projection and never the artifact body in the steady state.
 */
export async function evaluateArtifactAccessForActor(
  ctx: AuthorityCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  artifactId: Id<"spectraArtifacts">,
  resourceType?: "artifact" | "agent",
) {
  const loaded = await loadArtifactAuthority(ctx, artifactId);
  const type = resourceType ??
    (loaded?.resource.blueprintKey === "agent" ? "agent" : "artifact");
  return evaluateLoadedArtifactAuthority(ctx, actor, type, artifactId, loaded);
}

/** Reuse a summary row already read by a list/context query. */
export async function evaluateArtifactAccessForActorWithSummary(
  ctx: AuthorityCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  artifactId: Id<"spectraArtifacts">,
  resourceType: "artifact" | "agent" | undefined,
  summary: ArtifactAuthoritySummary,
) {
  const loaded = await loadArtifactAuthorityFromSummary(
    ctx,
    artifactId,
    summary,
  );
  const type = resourceType ??
    (loaded?.resource.blueprintKey === "agent" ? "agent" : "artifact");
  return evaluateLoadedArtifactAuthority(ctx, actor, type, artifactId, loaded);
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
        const projectsAccess = sharesWithWorkspace(placement);
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
      await pushPolicyChange(ctx, [...affectedArtifactIds].map(String));
    }
  }
  if (resourceType === "artifact" || resourceType === "agent") await pushPolicyChange(ctx, [resourceId]);
  return version;
}

/** Open rooms learn of the change straight away instead of at the next sweep. */
async function pushPolicyChange(ctx: MutationCtx, artifactIds: string[]) {
  if (!artifactIds.length || !collaborationGatewayOrigin()) return;
  await ctx.scheduler.runAfter(0, internal.collaborationPolicyPush.notify, { artifactIds: artifactIds.slice(0, 500) });
}
