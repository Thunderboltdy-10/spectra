import { mutation, query } from "./functions";
import { v } from "convex/values";
import { requireArtifactCapability } from "./spectraShared";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const HUMAN_LEASE_MS = 20_000;
const AI_LEASE_MS = 45_000;

export function regionDomainsIntersect(left: string[], right: string[]) {
  if (left.includes("artifact:structure") || right.includes("artifact:structure")) return true;
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

async function activeClaims(ctx: QueryCtx | MutationCtx, artifactId: Id<"spectraArtifacts">, now: number) {
  const claims = await ctx.db.query("regionClaims").withIndex("by_artifact_status", (q) => q.eq("artifactId", artifactId).eq("status", "active")).collect();
  return claims.filter((claim) => claim.leaseExpiresAt > now);
}

async function queuedClaims(ctx: QueryCtx | MutationCtx, artifactId: Id<"spectraArtifacts">) {
  return ctx.db.query("regionClaims").withIndex("by_artifact_status", (q) => q.eq("artifactId", artifactId).eq("status", "queued")).collect();
}

async function expireStaleClaims(ctx: MutationCtx, artifactId: Id<"spectraArtifacts">, now: number) {
  const pending = (await Promise.all((['active', 'queued'] as const).map((status) =>
    ctx.db.query("regionClaims").withIndex("by_artifact_status", (q) => q.eq("artifactId", artifactId).eq("status", status)).collect(),
  ))).flat();
  const expired = pending.filter((claim) => claim.leaseExpiresAt <= now);
  await Promise.all(expired.map((claim) => ctx.db.patch(claim._id, {
    status: "released",
    resolution: "expired",
    queuePosition: undefined,
    releasedAt: now,
    updatedAt: now,
  })));
  return expired;
}

async function promoteQueues(ctx: MutationCtx, artifactId: Id<"spectraArtifacts">, now: number) {
  await expireStaleClaims(ctx, artifactId, now);
  const active = await activeClaims(ctx, artifactId, now);
  const queued = (await queuedClaims(ctx, artifactId)).sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0) || a.createdAt - b.createdAt);
  const promoted: Doc<"regionClaims">[] = [];
  for (const candidate of queued) {
    const conflicts = [...active, ...promoted].some((claim) => regionDomainsIntersect(claim.overlapDomains, candidate.overlapDomains));
    if (conflicts) continue;
    // Queued AI serializes onto the region when nothing still overlaps.
    // Queued human and AI claims promote the same way; nothing pauses.
    const leaseMs = candidate.actorKind === "ai" ? AI_LEASE_MS : HUMAN_LEASE_MS;
    await ctx.db.patch(candidate._id, { status: "active", queuePosition: undefined, leaseExpiresAt: now + leaseMs, updatedAt: now });
    promoted.push(candidate);
  }
  const remaining = queued.filter((claim) => !promoted.some((promotedClaim) => promotedClaim._id === claim._id));
  await Promise.all(remaining.map((claim, index) => ctx.db.patch(claim._id, { queuePosition: index + 1, updatedAt: now })));
  return promoted.map((claim) => claim._id);
}

export async function releaseClaimsForAccount(
  ctx: MutationCtx,
  artifactId: Id<"spectraArtifacts">,
  accountId: Id<"accounts">,
  now: number,
) {
  const statuses = ["active", "queued"] as const;
  const claims = (await Promise.all(statuses.map((status) => ctx.db.query("regionClaims").withIndex("by_artifact_status", (q) => q.eq("artifactId", artifactId).eq("status", status)).collect()))).flat();
  await Promise.all(claims.filter((claim) => claim.actorAccountId === accountId).map((claim) => ctx.db.patch(claim._id, { status: "released", resolution: "permission_revoked", queuePosition: undefined, releasedAt: now, updatedAt: now })));
  return promoteQueues(ctx, artifactId, now);
}

export async function releaseClaimsForRun(
  ctx: MutationCtx,
  runId: Id<"spectraAiRuns">,
  now: number,
) {
  const statuses = ["active", "queued"] as const;
  const affected = (await Promise.all(statuses.map((status) => ctx.db.query("regionClaims").withIndex("by_run_status", (q) => q.eq("runId", runId).eq("status", status)).collect()))).flat();
  await Promise.all(affected.map((claim) => ctx.db.patch(claim._id, { status: "rejected", resolution: "run_stopped", queuePosition: undefined, releasedAt: now, updatedAt: now })));
  for (const artifactId of [...new Set(affected.map((claim) => claim.artifactId))]) await promoteQueues(ctx, artifactId, now);
  return affected.length;
}

export const acquire = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"), partitionKey: v.optional(v.string()), clientId: v.string(), regionId: v.string(), overlapDomains: v.array(v.string()), baseStateVectorHash: v.string(),
    actorKind: v.union(v.literal("human"), v.literal("ai")), runId: v.optional(v.id("spectraAiRuns")), operationId: v.optional(v.id("spectraOperations")), proposedStateRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    const clientId = args.clientId.trim().slice(0, 180);
    const regionId = args.regionId.trim().slice(0, 240);
    const overlapDomains = [...new Set(args.overlapDomains.map((domain) => domain.trim().slice(0, 240)).filter(Boolean))];
    if (!clientId || !regionId || overlapDomains.length === 0 || overlapDomains.length > 32 || args.baseStateVectorHash.length < 16) throw new Error("REGION_CLAIM_INVALID: Region, overlap domain, client, and base state are required.");
    if (args.actorKind === "ai") {
      const run = args.runId ? await ctx.db.get(args.runId) : null;
      if (!run || run.ownerAccountId !== actor.accountId || run.status !== "running") throw new Error("REGION_CLAIM_RUN_INVALID: The AI run is no longer active.");
    } else if (args.runId || args.operationId) throw new Error("REGION_CLAIM_ACTOR_INVALID: Human claims cannot impersonate an AI operation.");

    const now = Date.now();
    await expireStaleClaims(ctx, artifact._id, now);
    const room = await ctx.db.query("collaborationRooms").withIndex("by_artifact_partition", (q) => q.eq("artifactId", artifact._id).eq("partitionKey", args.partitionKey?.trim() || "root")).unique();
    const sameClient = (await ctx.db.query("regionClaims").withIndex("by_client_status", (q) => q.eq("clientId", clientId).eq("status", "active")).collect())
      .find((claim) => claim.artifactId === artifact._id && claim.actorAccountId === actor.accountId && claim.actorKind === args.actorKind && claim.runId === args.runId && claim.operationId === args.operationId && claim.regionId === regionId && claim.leaseExpiresAt > now);
    const leaseExpiresAt = now + (args.actorKind === "ai" ? AI_LEASE_MS : HUMAN_LEASE_MS);
    if (sameClient) {
      const conflict = (await activeClaims(ctx, artifact._id, now)).find((claim) =>
        claim._id !== sameClient._id && regionDomainsIntersect(claim.overlapDomains, overlapDomains),
      );
      if (conflict) throw new Error("REGION_CLAIM_CONFLICT: This client already holds an overlapping region.");
      await ctx.db.patch(sameClient._id, { overlapDomains, baseStateVectorHash: args.baseStateVectorHash, proposedStateRef: args.proposedStateRef, leaseExpiresAt, updatedAt: now });
      return { claimId: sameClient._id, status: "active" as const, leaseExpiresAt, conflict: null };
    }

    const pendingForClient = await ctx.db.query("regionClaims").withIndex("by_client_status", (q) => q.eq("clientId", clientId).eq("status", "queued")).collect();
    const samePending = pendingForClient.find((claim) => claim.artifactId === artifact._id && claim.actorAccountId === actor.accountId && claim.actorKind === args.actorKind && claim.runId === args.runId && claim.operationId === args.operationId && claim.regionId === regionId && claim.leaseExpiresAt > now);
    if (samePending) {
      const blocking = (await activeClaims(ctx, artifact._id, now)).find((claim) => regionDomainsIntersect(claim.overlapDomains, overlapDomains));
      const nextStatus = blocking ? "queued" as const : "active" as const;
      await ctx.db.patch(samePending._id, { status: nextStatus, queuePosition: blocking ? samePending.queuePosition : undefined, overlapDomains, baseStateVectorHash: args.baseStateVectorHash, proposedStateRef: args.proposedStateRef, leaseExpiresAt, updatedAt: now });
      if (nextStatus === "active") return { claimId: samePending._id, status: "active" as const, leaseExpiresAt, conflict: null };
      return { claimId: samePending._id, status: nextStatus, leaseExpiresAt, conflict: blocking ? { claimId: blocking._id, actorKind: blocking.actorKind, regionId: blocking.regionId, leaseExpiresAt: blocking.leaseExpiresAt, queuePosition: samePending.queuePosition ?? 1 } : null };
    }

    const active = await activeClaims(ctx, artifact._id, now);
    const conflict = active.find((claim) => regionDomainsIntersect(claim.overlapDomains, overlapDomains));
    const queued = (await queuedClaims(ctx, artifact._id)).filter((claim) => claim.leaseExpiresAt > now);
    const status = conflict ? "queued" as const : "active" as const;
    const claimId = await ctx.db.insert("regionClaims", {
      artifactId: artifact._id, roomId: room?._id, schoolId: artifact.schoolId,
      actorKind: args.actorKind, actorAccountId: actor.accountId, runId: args.runId, operationId: args.operationId,
      clientId, regionId, overlapDomains, baseStateVectorHash: args.baseStateVectorHash, proposedStateRef: args.proposedStateRef,
      status, queuePosition: conflict ? queued.length + 1 : undefined, leaseExpiresAt, createdAt: now, updatedAt: now,
    });
    return {
      claimId, status, leaseExpiresAt,
      conflict: conflict ? { claimId: conflict._id, actorKind: conflict.actorKind, regionId: conflict.regionId, leaseExpiresAt: conflict.leaseExpiresAt, queuePosition: queued.length + 1 } : null,
    };
  },
});

export const renew = mutation({
  args: { claimId: v.id("regionClaims"), clientId: v.string(), baseStateVectorHash: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId);
    if (!claim || (claim.status !== "active" && claim.status !== "queued")) throw new Error("REGION_CLAIM_UNAVAILABLE: Reacquire the region.");
    const { actor } = await requireArtifactCapability(ctx, claim.artifactId, "modify");
    if (claim.actorAccountId !== actor.accountId || claim.clientId !== args.clientId) throw new Error("REGION_CLAIM_FORBIDDEN: This claim belongs to another collaborator.");
    const now = Date.now();
    if (claim.leaseExpiresAt <= now) {
      await ctx.db.patch(claim._id, { status: "released", resolution: "expired", queuePosition: undefined, releasedAt: now, updatedAt: now });
      await promoteQueues(ctx, claim.artifactId, now);
      throw new Error("REGION_CLAIM_EXPIRED: Reacquire the region before editing.");
    }
    const leaseExpiresAt = now + (claim.actorKind === "ai" ? AI_LEASE_MS : HUMAN_LEASE_MS);
    await ctx.db.patch(claim._id, { baseStateVectorHash: args.baseStateVectorHash ?? claim.baseStateVectorHash, leaseExpiresAt, updatedAt: now });
    return { claimId: claim._id, status: claim.status, leaseExpiresAt };
  },
});

export const release = mutation({
  args: { claimId: v.id("regionClaims"), clientId: v.string(), resolution: v.optional(v.union(v.literal("apply"), v.literal("keep_current"), v.literal("cancel"))) },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId);
    if (!claim) return { released: false, promoted: [] };
    const { actor } = await requireArtifactCapability(ctx, claim.artifactId, "modify");
    if (claim.actorAccountId !== actor.accountId || claim.clientId !== args.clientId) throw new Error("REGION_CLAIM_FORBIDDEN: This claim belongs to another collaborator.");
    const now = Date.now();
    await ctx.db.patch(claim._id, { status: args.resolution === "cancel" ? "rejected" : "released", resolution: args.resolution ?? "apply", releasedAt: now, updatedAt: now });
    const promoted = await promoteQueues(ctx, claim.artifactId, now);
    return { released: true, promoted };
  },
});

export const listForArtifact = query({
  args: { artifactId: v.id("spectraArtifacts"), includeResolved: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.artifactId, "read");
    const now = Date.now();
    const statuses = args.includeResolved ? ["active", "queued", "released", "rejected"] as const : ["active", "queued"] as const;
    const groups = await Promise.all(statuses.map((status) => ctx.db.query("regionClaims").withIndex("by_artifact_status", (q) => q.eq("artifactId", args.artifactId).eq("status", status)).collect()));
    return groups.flat().filter((claim) => args.includeResolved || claim.leaseExpiresAt > now).map((claim) => {
      const expired = claim.leaseExpiresAt <= now && (claim.status === "active" || claim.status === "queued");
      return { claimId: claim._id, actorKind: claim.actorKind, actorAccountId: claim.actorAccountId, runId: claim.runId, regionId: claim.regionId, overlapDomains: claim.overlapDomains, status: expired ? "released" as const : claim.status, queuePosition: expired ? undefined : claim.queuePosition, leaseExpiresAt: claim.leaseExpiresAt, resolution: expired ? "expired" as const : claim.resolution, createdAt: claim.createdAt };
    });
  },
});

