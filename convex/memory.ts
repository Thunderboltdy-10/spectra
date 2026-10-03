import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./functions";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { evaluateAccessForActor } from "./authorityShared";
import { getActorForAccountId, getAuthenticatedActor } from "./identityShared";
import {
  MEMORY_EMBEDDING_LEASE_MS, MEMORY_EMBEDDING_MAX_ATTEMPTS,
  memoryInputHash, memoryEmbeddingPartition, memoryQueryFitsBytes,
} from "./memoryEmbeddingPolicy";
import { EMBEDDING_FAILURES, embedQuery, embeddingVersion, validEmbeddingVector } from "./embeddingProvider";
import { createManagebacVisibilityReader } from "./managebacVisibility";

const DEFAULT_TARGET_TOKENS = 1_000;
const MAX_TARGET_TOKENS = 4_000;
const MAX_CLAIMS_PER_CONTEXT = 24;
const MAX_LIST = 300;
const EVIDENCE_WINDOW = 12;
const embeddingGenerate = makeFunctionReference<"action", { jobId: Id<"memoryJobs">; leaseOwner: string }, void>("memoryEmbeddings:generate");
const AUTHORED_EVIDENCE_TYPES = [
  "user_statement",
  "correction",
] as const;

const vScope = v.union(
  v.literal("private_global"),
  v.literal("private_school"),
  v.literal("workspace"),
  v.literal("shared_artifact"),
  v.literal("system"),
);

const vClaimType = v.union(
  v.literal("declared_fact"),
  v.literal("inferred_preference"),
  v.literal("correction"),
  v.literal("decision"),
  v.literal("recurring_workflow"),
  v.literal("commitment"),
  v.literal("mistake_avoidance"),
  v.literal("learning_signal"),
  v.literal("relationship"),
  v.literal("workspace_convention"),
);

const vCategoryControls = v.object({
  declaredFacts: v.boolean(),
  preferences: v.boolean(),
  decisions: v.boolean(),
  workflows: v.boolean(),
  commitments: v.boolean(),
  learningSignals: v.boolean(),
  relationships: v.boolean(),
  workspaceConventions: v.boolean(),
});

const DEFAULT_CATEGORIES = {
  declaredFacts: true,
  preferences: true,
  decisions: true,
  workflows: true,
  commitments: true,
  learningSignals: true,
  relationships: true,
  workspaceConventions: true,
};

type MemoryCtx = QueryCtx | MutationCtx;
type Actor = NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>;
type Scope = Doc<"memoryClaims">["scope"];
type ClaimType = Doc<"memoryClaims">["claimType"];
type EvidenceAccessCache = {
  results: Map<string, boolean>;
  managebac?: ReturnType<typeof createManagebacVisibilityReader>;
};

function newEvidenceAccessCache(): EvidenceAccessCache {
  return { results: new Map() };
}

function hash(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  const part = (number: number) => (number >>> 0).toString(16).padStart(8, "0");
  return `${part(first)}${part(second)}${part(first ^ second)}${part(Math.imul(first, second))}`;
}

function compact(value: unknown, maximum = 1_500) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function normalizeProposition(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[^\p{L}\p{N}\s'’-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenEstimate(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function terms(value: string) {
  return new Set(
    normalizeProposition(value)
      .split(" ")
      .filter((term) => term.length > 2)
      .slice(0, 80),
  );
}

function overlapScore(queryTerms: Set<string>, proposition: string) {
  if (queryTerms.size === 0) return 0;
  const propositionTerms = terms(proposition);
  let matches = 0;
  for (const term of queryTerms) if (propositionTerms.has(term)) matches += 1;
  return (
    matches / Math.sqrt(queryTerms.size * Math.max(1, propositionTerms.size))
  );
}

function propositionSimilarity(left: string, right: string) {
  const leftTerms = terms(left);
  const rightTerms = terms(right);
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  let intersection = 0;
  for (const term of leftTerms) if (rightTerms.has(term)) intersection += 1;
  return intersection / (leftTerms.size + rightTerms.size - intersection);
}

const forbiddenCapturePatterns = [
  /\b(?:password|passcode|pin)\s*(?:is|:|=)\s*\S+/i,
  /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret)\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:aws_secret_access_key|authorization:\s*bearer)\b/i,
  /\b(?:diagnos(?:is|ed)|mental illness|disciplinary record|protected characteristic)\b/i,
  /\b(?:race|ethnicity|religion|sexual orientation|gender identity)\s*(?:is|:)/i,
  /\b(?:self[- ]?harm|suicid(?:e|al))\b/i,
];

function captureRejectionReason(proposition: string) {
  if (proposition.length < 12) return "too_short";
  if (proposition.length > 1_500) return "too_long";
  if (forbiddenCapturePatterns.some((pattern) => pattern.test(proposition)))
    return "sensitive_or_secret";
  if (
    /\b(?:just for (?:today|this message)|right now only|temporary request)\b/i.test(
      proposition,
    )
  )
    return "transient";
  return null;
}

function categoryForClaim(type: ClaimType): keyof typeof DEFAULT_CATEGORIES {
  if (type === "declared_fact" || type === "correction") return "declaredFacts";
  if (type === "inferred_preference") return "preferences";
  if (type === "decision") return "decisions";
  if (type === "recurring_workflow" || type === "mistake_avoidance")
    return "workflows";
  if (type === "commitment") return "commitments";
  if (type === "learning_signal") return "learningSignals";
  if (type === "relationship") return "relationships";
  return "workspaceConventions";
}

function preferenceProjection(
  row: Doc<"memoryPreferences"> | null,
  actor: Actor,
) {
  return row
    ? {
        enabled: row.enabled,
        capturePaused: row.capturePaused,
        categoryControls: row.categoryControls,
        capsuleTargetTokens: row.capsuleTargetTokens,
        updatedAt: row.updatedAt,
      }
    : {
        enabled: true,
        capturePaused: false,
        categoryControls: DEFAULT_CATEGORIES,
        capsuleTargetTokens: DEFAULT_TARGET_TOKENS,
        updatedAt: actor.createdAt,
      };
}

async function requireActor(ctx: MemoryCtx) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor)
    throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

async function preferencesFor(
  ctx: MemoryCtx,
  actor: Actor,
): Promise<Doc<"memoryPreferences"> | null> {
  return ctx.db
    .query("memoryPreferences")
    .withIndex("by_account", (q) => q.eq("accountId", actor.accountId))
    .unique();
}

async function ensurePreferences(ctx: MutationCtx, actor: Actor) {
  const existing = await preferencesFor(ctx, actor);
  if (existing) {
    if (existing.schoolId !== actor.schoolId) {
      await ctx.db.patch(existing._id, {
        schoolId: actor.schoolId,
        updatedAt: Date.now(),
      });
    }
    return existing;
  }
  const now = Date.now();
  const id = await ctx.db.insert("memoryPreferences", {
    accountId: actor.accountId,
    schoolId: actor.schoolId,
    enabled: true,
    capturePaused: false,
    categoryControls: DEFAULT_CATEGORIES,
    capsuleTargetTokens: DEFAULT_TARGET_TOKENS,
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get(id))!;
}

async function canReadClaim(
  ctx: MemoryCtx,
  actor: Actor,
  claim: Doc<"memoryClaims">,
) {
  if (
    claim.scope === "private_global" ||
    claim.scope === "private_school" ||
    claim.scope === "system"
  ) {
    if (claim.accountId !== actor.accountId) return false;
  }
  if (claim.scope === "private_global" || claim.scope === "system") return true;
  if (claim.scopeSchoolId && claim.scopeSchoolId !== actor.schoolId)
    return false;
  if (claim.scope === "private_school")
    return claim.schoolId === actor.schoolId;
  if (claim.scope === "workspace" && claim.workspaceId) {
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      "workspace",
      claim.workspaceId,
    );
    return decision.allowed && decision.capabilities.includes("read");
  }
  if (claim.scope === "shared_artifact" && claim.artifactId) {
    const artifact = await ctx.db.get(claim.artifactId);
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      artifact?.blueprintKey === "agent" ? "agent" : "artifact",
      claim.artifactId,
    );
    return decision.allowed && decision.capabilities.includes("read");
  }
  return false;
}

async function canControlClaim(
  ctx: MutationCtx,
  actor: Actor,
  claim: Doc<"memoryClaims">,
) {
  if (
    claim.scope === "private_global" ||
    claim.scope === "private_school" ||
    claim.scope === "system"
  )
    return claim.accountId === actor.accountId;
  if (claim.scope === "workspace" && claim.workspaceId) {
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      "workspace",
      claim.workspaceId,
    );
    return decision.allowed && decision.capabilities.includes("modify");
  }
  if (claim.scope === "shared_artifact" && claim.artifactId) {
    const artifact = await ctx.db.get(claim.artifactId);
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      artifact?.blueprintKey === "agent" ? "agent" : "artifact",
      claim.artifactId,
    );
    return decision.allowed && decision.capabilities.includes("modify");
  }
  return false;
}

async function sharedScopedClaimsForActor(
  ctx: MemoryCtx,
  actor: Actor,
  status: Doc<"memoryClaims">["status"],
) {
  const schoolRows = await ctx.db
    .query("memoryClaims")
    .withIndex("by_school_status", (q) =>
      q.eq("schoolId", actor.schoolId).eq("status", status),
    )
    .order("desc")
    .take(MAX_LIST);
  return schoolRows.filter(
    (claim) => claim.scope === "workspace" || claim.scope === "shared_artifact",
  );
}

async function evidenceIsCurrentlyAvailable(
  ctx: MemoryCtx,
  actor: Actor,
  evidence: Doc<"memoryEvidence">,
  accessCache: EvidenceAccessCache,
) {
  if (evidence.accessStatus !== "available") return false;
  if (
    evidence.sourceType === "user_statement" ||
    evidence.sourceType === "correction"
  )
    return true;
  if (evidence.sourceType === "managebac") {
    if (!evidence.sourceId) return false;
    const reader = accessCache.managebac ??= createManagebacVisibilityReader(ctx, actor);
    return Boolean(await reader.readSource(evidence.sourceId));
  }
  if (evidence.sourceType === "thread") {
    const id = evidence.sourceId
      ? ctx.db.normalizeId("spectraThreads", evidence.sourceId)
      : null;
    const thread = id ? await ctx.db.get(id) : null;
    return (
      Boolean(thread) &&
      thread!.ownerAccountId === actor.accountId &&
      thread!.schoolId === actor.schoolId &&
      thread!.status !== "deleted"
    );
  }
  if (evidence.sourceType === "workspace" && evidence.sourceId) {
    const id = ctx.db.normalizeId("spectraWorkspaces", evidence.sourceId);
    if (!id) return false;
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      "workspace",
      id,
    );
    return decision.allowed && decision.capabilities.includes("read");
  }
  if (evidence.sourceType === "artifact" && evidence.sourceId) {
    const id = ctx.db.normalizeId("spectraArtifacts", evidence.sourceId);
    const artifact = id ? await ctx.db.get(id) : null;
    if (!artifact) return false;
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      artifact.blueprintKey === "agent" ? "agent" : "artifact",
      evidence.sourceId,
    );
    return decision.allowed && decision.capabilities.includes("read");
  }
  return false;
}

async function claimHasCurrentEvidence(
  ctx: MemoryCtx,
  actor: Actor,
  claimId: Id<"memoryClaims">,
  accessCache: EvidenceAccessCache = newEvidenceAccessCache(),
) {
  const evidence = await evidenceCandidatesForClaim(ctx, claimId);
  if (evidence.length === 0) return false;
  for (const item of evidence)
    if (await checkEvidenceAccess(ctx, actor, item, accessCache)) return true;
  return false;
}

async function requireScopeWrite(
  ctx: MutationCtx,
  actor: Actor,
  scope: Scope,
  workspaceId?: Id<"spectraWorkspaces">,
  artifactId?: Id<"spectraArtifacts">,
) {
  if (scope === "workspace") {
    if (!workspaceId)
      throw new Error("MEMORY_SCOPE_REQUIRED: Choose a workspace.");
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      "workspace",
      workspaceId,
    );
    if (!decision.allowed || !decision.capabilities.includes("modify"))
      throw new Error(
        "MEMORY_SCOPE_FORBIDDEN: Workspace conventions require modify access.",
      );
  }
  if (scope === "shared_artifact") {
    if (!artifactId)
      throw new Error("MEMORY_SCOPE_REQUIRED: Choose an artifact.");
    const artifact = await ctx.db.get(artifactId);
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      artifact?.blueprintKey === "agent" ? "agent" : "artifact",
      artifactId,
    );
    if (!decision.allowed || !decision.capabilities.includes("modify"))
      throw new Error(
        "MEMORY_SCOPE_FORBIDDEN: Artifact conventions require modify access.",
      );
  }
}

function claimProjection(
  claim: Doc<"memoryClaims">,
  evidence: Array<Doc<"memoryEvidence">>,
) {
  return {
    _id: claim._id,
    scope: claim.scope,
    workspaceId: claim.workspaceId,
    artifactId: claim.artifactId,
    subjectKind: claim.subjectKind,
    subjectId: claim.subjectId,
    claimType: claim.claimType,
    proposition: claim.proposition,
    assertion: claim.assertion,
    confidence: claim.confidence,
    status: claim.status,
    createdBy: claim.createdBy,
    validFrom: claim.validFrom,
    expiresAt: claim.expiresAt,
    lastConfirmedAt: claim.lastConfirmedAt,
    supersedesId: claim.supersedesId,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
    evidence: evidence.map((item) => ({
      _id: item._id,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceVersionId: item.sourceVersionId,
      sourceRegionId: item.sourceRegionId,
      excerptPreview: item.excerptPreview,
      captureReason: item.captureReason,
      accessStatus: item.accessStatus,
      observedAt: item.observedAt,
    })),
  };
}

async function evidenceForClaim(ctx: MemoryCtx, claimId: Id<"memoryClaims">) {
  return ctx.db
    .query("memoryEvidence")
    .withIndex("by_claim_created", (q) => q.eq("claimId", claimId))
    .order("desc")
    .take(EVIDENCE_WINDOW);
}

/** Keep bounded source previews without aging out an explicit user statement. */
async function evidenceCandidatesForClaim(
  ctx: MemoryCtx,
  claimId: Id<"memoryClaims">,
) {
  const recent = await evidenceForClaim(ctx, claimId);
  if (
    recent.length < EVIDENCE_WINDOW ||
    recent.some((item) =>
      item.accessStatus === "available" &&
      AUTHORED_EVIDENCE_TYPES.some((type) => item.sourceType === type),
    )
  ) return recent;
  const authored = await Promise.all(
    AUTHORED_EVIDENCE_TYPES.map((sourceType) =>
      ctx.db.query("memoryEvidence")
        .withIndex("by_claim_source_access_created", (q) => q
          .eq("claimId", claimId)
          .eq("sourceType", sourceType)
          .eq("accessStatus", "available"),
        )
        .order("desc")
        .first(),
    ),
  );
  return [
    ...recent,
    ...authored.filter((item): item is Doc<"memoryEvidence"> => item !== null),
  ];
}

/** Cache only within one authenticated database invocation, never across reads. */
async function checkEvidenceAccess(
  ctx: MemoryCtx,
  actor: Actor,
  evidence: Doc<"memoryEvidence">,
  accessCache: EvidenceAccessCache,
) {
  if (evidence.accessStatus !== "available") return false;
  const key = JSON.stringify([
    evidence.sourceType, evidence.sourceId, evidence.schoolId,
  ]);
  const cached = accessCache.results.get(key);
  if (cached !== undefined) return cached;
  const allowed = await evidenceIsCurrentlyAvailable(ctx, actor, evidence, accessCache);
  accessCache.results.set(key, allowed);
  return allowed;
}

async function currentEvidenceForClaim(
  ctx: MemoryCtx,
  actor: Actor,
  claimId: Id<"memoryClaims">,
  accessCache: EvidenceAccessCache,
) {
  const available: Array<Doc<"memoryEvidence">> = [];
  for (const item of await evidenceCandidatesForClaim(ctx, claimId))
    if (await checkEvidenceAccess(ctx, actor, item, accessCache))
      available.push(item);
  return available;
}

async function invalidateCapsules(ctx: MutationCtx, accountId: Id<"accounts">) {
  const capsules = await ctx.db
    .query("memoryCapsules")
    .withIndex("by_account_scope", (q) =>
      q.eq("accountId", accountId).eq("scope", "private_global"),
    )
    .collect();
  const schoolCapsules = await ctx.db
    .query("memoryCapsules")
    .withIndex("by_account_scope", (q) =>
      q.eq("accountId", accountId).eq("scope", "private_school"),
    )
    .collect();
  const workflowCapsules = await ctx.db
    .query("memoryCapsules")
    .withIndex("by_account_scope", (q) =>
      q.eq("accountId", accountId).eq("scope", "workflow"),
    )
    .collect();
  const now = Date.now();
  for (const capsule of [...capsules, ...schoolCapsules, ...workflowCapsules])
    await ctx.db.patch(capsule._id, { stale: true, updatedAt: now });
}

async function enqueueClaimEmbedding(ctx: MutationCtx, claim: Doc<"memoryClaims">, retryFailed = false, wake = true): Promise<boolean> {
  if (!(await canEmbedClaim(ctx, claim))) return false;
  const version = embeddingVersion();
  const partition = memoryEmbeddingPartition(claim, version);
  if (!version || !partition) return false;
  const inputHash = await memoryInputHash(claim.proposition);
  if (claim.embeddingVersion === version && claim.embeddingInputHash === inputHash &&
    validEmbeddingVector(claim.embedding)) {
    // Retention may have removed the completed job; the committed identity remains authoritative.
    if (claim.embeddingPartition !== partition) await ctx.db.patch(claim._id, { embeddingPartition: partition });
    return false;
  }
  const idempotencyKey = `embed:${claim._id}:${version}:${inputHash}`;
  const existing = await ctx.db.query("memoryJobs")
    .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey)).unique();
  const now = Date.now();
  if (existing) {
    if (!retryFailed || existing.status !== "failed") return false;
    await ctx.db.patch(existing._id, {
      status: "queued", attemptCount: 0, availableAt: now, updatedAt: now,
      leaseOwner: undefined, leaseExpiresAt: undefined, error: undefined,
      payload: { claimId: claim._id, inputHash, embeddingVersion: version, partition },
    });
  } else await ctx.db.insert("memoryJobs", {
    accountId: claim.accountId, schoolId: claim.schoolId, kind: "embed", idempotencyKey,
    payload: { claimId: claim._id, inputHash, embeddingVersion: version, partition },
    status: "queued", attemptCount: 0, availableAt: now, createdAt: now, updatedAt: now,
  });
  if (wake) await ctx.scheduler.runAfter(0, internal.memory.dispatchEmbeddings, {});
  return true;
}

function embeddingJobPayload(ctx: MemoryCtx, job: Doc<"memoryJobs">) {
  const payload = job.payload as { claimId?: unknown; inputHash?: unknown; embeddingVersion?: unknown; partition?: unknown } | null;
  const claimId = typeof payload?.claimId === "string" ? ctx.db.normalizeId("memoryClaims", payload.claimId) : null;
  return claimId && typeof payload?.inputHash === "string" && typeof payload.partition === "string" &&
    payload.embeddingVersion === embeddingVersion()
    ? { claimId, inputHash: payload.inputHash, partition: payload.partition } : null;
}

async function permittedEmbeddingClaim(ctx: MemoryCtx, job: Doc<"memoryJobs">) {
  const payload = embeddingJobPayload(ctx, job);
  if (!payload || job.kind !== "embed") return null;
  const claim = await ctx.db.get(payload.claimId);
  if (!claim || claim.accountId !== job.accountId || claim.status !== "active" ||
    (claim.expiresAt !== undefined && claim.expiresAt <= Date.now()) ||
    memoryEmbeddingPartition(claim) !== payload.partition ||
    await memoryInputHash(claim.proposition) !== payload.inputHash) return null;
  return await canEmbedClaim(ctx, claim) ? claim : null;
}

async function canEmbedClaim(ctx: MemoryCtx, claim: Doc<"memoryClaims">) {
  if (claim.status !== "active" || (claim.expiresAt !== undefined && claim.expiresAt <= Date.now())) return false;
  const actor = await getActorForAccountId(ctx, claim.accountId);
  if (!actor) return false;
  const preferences = preferenceProjection(await preferencesFor(ctx, actor), actor);
  if (!preferences.enabled || !preferences.categoryControls[categoryForClaim(claim.claimType)] ||
    !(await canReadClaim(ctx, actor, claim)) || !(await claimHasCurrentEvidence(ctx, actor, claim._id))) return false;
  return true;
}

/** Global concurrency is two. Enqueue, completion and retry wake this dispatcher; cron only recovers loss. */
export const dispatchEmbeddings = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ dispatched: number }> => {
    const now = Date.now();
    const running = await ctx.db.query("memoryJobs").withIndex("by_kind_status_available", (q) =>
      q.eq("kind", "embed").eq("status", "leased").gt("availableAt", now)).take(2);
    const capacity = 2 - running.length;
    if (!capacity) return { dispatched: 0 };
    const queued = await ctx.db.query("memoryJobs").withIndex("by_kind_status_available", (q) =>
      q.eq("kind", "embed").eq("status", "queued").lte("availableAt", now)).take(capacity);
    const expired = await ctx.db.query("memoryJobs").withIndex("by_kind_status_available", (q) =>
      q.eq("kind", "embed").eq("status", "leased").lte("availableAt", now)).take(capacity);
    const jobs = [...queued, ...expired].sort((a, b) => a.availableAt - b.availableAt).slice(0, capacity);
    let dispatched = 0;
    for (const job of jobs) {
      if (job.attemptCount >= MEMORY_EMBEDDING_MAX_ATTEMPTS) {
        await ctx.db.patch(job._id, { status: "failed", error: "attempts_exhausted", leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: now });
        continue;
      }
      const leaseOwner = `embed:${job._id}:${crypto.randomUUID()}`;
      await ctx.db.patch(job._id, {
        status: "leased", leaseOwner, attemptCount: job.attemptCount + 1,
        availableAt: now + MEMORY_EMBEDDING_LEASE_MS, leaseExpiresAt: now + MEMORY_EMBEDDING_LEASE_MS, updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, embeddingGenerate, { jobId: job._id, leaseOwner });
      dispatched += 1;
    }
    if (jobs.length && !dispatched) await ctx.scheduler.runAfter(0, internal.memory.dispatchEmbeddings, {});
    return { dispatched };
  },
});

export const embeddingInput = internalQuery({
  args: { jobId: v.id("memoryJobs"), leaseOwner: v.string() },
  handler: async (ctx, args): Promise<{ proposition: string } | null> => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "leased" || job.leaseOwner !== args.leaseOwner ||
      (job.leaseExpiresAt ?? 0) <= Date.now()) return null;
    const claim = await permittedEmbeddingClaim(ctx, job);
    return claim ? { proposition: claim.proposition } : null;
  },
});

export const completeEmbedding = internalMutation({
  args: {
    jobId: v.id("memoryJobs"), leaseOwner: v.string(), vector: v.optional(v.array(v.float64())),
    error: v.optional(v.string()), retryable: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ committed: boolean }> => {
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (!job || job.kind !== "embed" || job.status !== "leased" || job.leaseOwner !== args.leaseOwner ||
      (job.leaseExpiresAt ?? 0) <= now) return { committed: false };
    const claim = await permittedEmbeddingClaim(ctx, job);
    if (claim && validEmbeddingVector(args.vector)) {
      const payload = embeddingJobPayload(ctx, job)!;
      await ctx.db.patch(claim._id, {
        embedding: args.vector, embeddingVersion: embeddingVersion()!,
        embeddingInputHash: payload.inputHash, embeddingUpdatedAt: now, embeddingPartition: payload.partition,
      });
      await ctx.db.patch(job._id, { status: "completed", completedAt: now, updatedAt: now, error: undefined, leaseOwner: undefined, leaseExpiresAt: undefined });
      await ctx.scheduler.runAfter(0, internal.memory.dispatchEmbeddings, {});
      return { committed: true };
    }
    const retry = Boolean(claim && args.retryable && job.attemptCount < MEMORY_EMBEDDING_MAX_ATTEMPTS);
    const delay = retry ? 2 ** (job.attemptCount - 1) * 5_000 : 0;
    // Persist only fixed status codes, never provider response text or input.
    const error = !claim ? "source_unavailable" :
      (EMBEDDING_FAILURES as readonly string[]).includes(args.error ?? "") ? args.error : "invalid_response";
    if (!claim) {
      const payload = embeddingJobPayload(ctx, job);
      const current = payload ? await ctx.db.get(payload.claimId) : null;
      if (payload && current && current.embeddingPartition === payload.partition && current.embeddingInputHash === payload.inputHash)
        await ctx.db.patch(current._id, { embeddingPartition: undefined });
    }
    await ctx.db.patch(job._id, {
      status: retry ? "queued" : "failed", error, availableAt: now + delay,
      leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.memory.dispatchEmbeddings, {});
    if (retry) await ctx.scheduler.runAfter(delay, internal.memory.dispatchEmbeddings, {});
    return { committed: false };
  },
});

/** Explicit, bounded backfill only. No request-time legacy catalog scan or automatic recursive backfill. */
export const backfillEmbeddings = internalMutation({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()), retryFailed: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("memoryClaims").withIndex("by_status_updated", (q) => q.eq("status", "active"))
      .paginate({ cursor: args.cursor ?? null, numItems: Math.max(1, Math.min(40, Math.round(Number.isFinite(args.limit) ? args.limit! : 20))) });
    let enqueued = 0;
    for (const claim of page.page) if (await enqueueClaimEmbedding(ctx, claim, args.retryFailed, false)) enqueued += 1;
    if (enqueued) await ctx.scheduler.runAfter(0, internal.memory.dispatchEmbeddings, {});
    return { enqueued, scanned: page.page.length, isDone: page.isDone, cursor: page.continueCursor };
  },
});

async function enqueueClaimDeletion(
  ctx: MutationCtx,
  claim: Doc<"memoryClaims">,
  now = Date.now(),
) {
  const idempotencyKey = `delete:${claim._id}`;
  const existing = await ctx.db
    .query("memoryJobs")
    .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (existing) return existing._id;
  return ctx.db.insert("memoryJobs", {
    accountId: claim.accountId,
    schoolId: claim.schoolId,
    kind: "delete",
    idempotencyKey,
    payload: { claimId: claim._id },
    status: "queued",
    attemptCount: 0,
    availableAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertEvidence(
  ctx: MutationCtx,
  actor: Actor,
  claimId: Id<"memoryClaims">,
  input: {
    sourceType: Doc<"memoryEvidence">["sourceType"];
    sourceId?: string;
    sourceVersionId?: string;
    sourceRegionId?: string;
    sourceEventId?: string;
    excerpt?: string;
    captureReason: string;
  },
) {
  const excerpt = compact(input.excerpt, 240);
  return ctx.db.insert("memoryEvidence", {
    claimId,
    accountId: actor.accountId,
    schoolId: actor.schoolId,
    sourceType: input.sourceType,
    sourceId: compact(input.sourceId, 180) || undefined,
    sourceVersionId: compact(input.sourceVersionId, 180) || undefined,
    sourceRegionId: compact(input.sourceRegionId, 180) || undefined,
    sourceEventId: compact(input.sourceEventId, 180) || undefined,
    excerptHash: hash(excerpt || `${input.sourceType}:${input.sourceId ?? ""}`),
    excerptPreview: excerpt || undefined,
    captureReason: compact(input.captureReason, 240),
    accessStatus: "available",
    observedAt: Date.now(),
    createdAt: Date.now(),
  });
}

async function upsertClaim(
  ctx: MutationCtx,
  actor: Actor,
  input: {
    proposition: string;
    scope: Scope;
    claimType: ClaimType;
    assertion: "asserted" | "inferred";
    confidence: number;
    createdBy: "user" | "policy" | "model";
    status?: "proposed" | "active";
    workspaceId?: Id<"spectraWorkspaces">;
    artifactId?: Id<"spectraArtifacts">;
    subjectKind?: Doc<"memoryClaims">["subjectKind"];
    subjectId?: string;
    evidence: {
      sourceType: Doc<"memoryEvidence">["sourceType"];
      sourceId?: string;
      sourceVersionId?: string;
      sourceRegionId?: string;
      sourceEventId?: string;
      excerpt?: string;
      captureReason: string;
    };
  },
) {
  const proposition = compact(input.proposition);
  const rejection = captureRejectionReason(proposition);
  if (rejection)
    throw new Error(
      `MEMORY_CAPTURE_REJECTED: ${rejection.replaceAll("_", " ")}.`,
    );
  await requireScopeWrite(
    ctx,
    actor,
    input.scope,
    input.workspaceId,
    input.artifactId,
  );
  const preferences = await ensurePreferences(ctx, actor);
  if (!preferences.enabled)
    throw new Error("MEMORY_DISABLED: Memory is disabled.");
  if (!preferences.categoryControls[categoryForClaim(input.claimType)])
    throw new Error(
      "MEMORY_CATEGORY_DISABLED: This memory category is disabled.",
    );

  const normalized = normalizeProposition(proposition);
  const propositionHash = hash(
    `${input.scope}:${input.workspaceId ?? ""}:${input.artifactId ?? ""}:${normalized}`,
  );
  const existing = await ctx.db
    .query("memoryClaims")
    .withIndex("by_account_hash", (q) =>
      q.eq("accountId", actor.accountId).eq("propositionHash", propositionHash),
    )
    .filter((q) =>
      q.or(
        q.eq(q.field("status"), "active"),
        q.eq(q.field("status"), "proposed"),
      ),
    )
    .first();
  const nearDuplicate = existing
    ? null
    : (
        await ctx.db
          .query("memoryClaims")
          .withIndex("by_account_status_updated", (q) =>
            q.eq("accountId", actor.accountId).eq("status", "active"),
          )
          .order("desc")
          .take(120)
      ).find(
        (claim) =>
          claim.scope === input.scope &&
          claim.workspaceId === input.workspaceId &&
          claim.artifactId === input.artifactId &&
          claim.claimType === input.claimType &&
          propositionSimilarity(claim.proposition, proposition) >= 0.88,
      );
  const now = Date.now();
  const duplicate = existing ?? nearDuplicate;
  if (duplicate) {
    await ctx.db.patch(duplicate._id, {
      confidence: Math.max(duplicate.confidence, input.confidence),
      lastConfirmedAt:
        input.assertion === "asserted" ? now : duplicate.lastConfirmedAt,
      updatedAt: now,
    });
    await insertEvidence(ctx, actor, duplicate._id, input.evidence);
    await enqueueClaimEmbedding(ctx, (await ctx.db.get(duplicate._id))!);
    await invalidateCapsules(ctx, actor.accountId);
    return { claimId: duplicate._id, merged: true };
  }

  const claimId = await ctx.db.insert("memoryClaims", {
    accountId: actor.accountId,
    schoolId: actor.schoolId,
    scope: input.scope,
    scopeSchoolId:
      input.scope === "private_global" || input.scope === "system"
        ? undefined
        : actor.schoolId,
    workspaceId: input.workspaceId,
    artifactId: input.artifactId,
    subjectKind:
      input.subjectKind ??
      (input.scope === "workspace"
        ? "workspace"
        : input.scope === "shared_artifact"
          ? "artifact"
          : "user"),
    subjectId:
      compact(input.subjectId, 180) ||
      input.workspaceId ||
      input.artifactId ||
      actor.accountId,
    claimType: input.claimType,
    proposition,
    normalizedProposition: normalized,
    propositionHash,
    assertion: input.assertion,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    sensitivity: "standard",
    status:
      input.status ?? (input.assertion === "asserted" ? "active" : "proposed"),
    createdBy: input.createdBy,
    validFrom: now,
    lastConfirmedAt: input.assertion === "asserted" ? now : undefined,
    createdAt: now,
    updatedAt: now,
  });
  await insertEvidence(ctx, actor, claimId, input.evidence);
  await enqueueClaimEmbedding(ctx, (await ctx.db.get(claimId))!);
  const relatedCandidates = await ctx.db
    .query("memoryClaims")
    .withIndex("by_account_status_updated", (q) =>
      q.eq("accountId", actor.accountId).eq("status", "active"),
    )
    .order("desc")
    .take(100);
  const related = relatedCandidates
    .filter(
      (claim) =>
        claim._id !== claimId &&
        claim.scope === input.scope &&
        claim.workspaceId === input.workspaceId &&
        claim.artifactId === input.artifactId,
    )
    .map((claim) => ({
      claim,
      similarity: propositionSimilarity(claim.proposition, proposition),
    }))
    .filter((candidate) => candidate.similarity >= 0.32)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 4);
  const relationType =
    input.claimType === "inferred_preference"
      ? ("prefers" as const)
      : input.claimType === "recurring_workflow"
        ? ("follows_workflow" as const)
        : input.claimType === "decision" || input.claimType === "commitment"
          ? ("depends_on" as const)
          : ("related_to" as const);
  for (const candidate of related)
    await ctx.db.insert("memoryRelations", {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      fromClaimId: claimId,
      toClaimId: candidate.claim._id,
      fromSubject: `claim:${claimId}`,
      toSubject: `claim:${candidate.claim._id}`,
      relationType,
      confidence: Math.min(0.95, candidate.similarity + 0.2),
      createdAt: now,
      updatedAt: now,
    });
  await invalidateCapsules(ctx, actor.accountId);
  return { claimId, merged: false };
}

export const preferences = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    return preferenceProjection(await preferencesFor(ctx, actor), actor);
  },
});

export const updatePreferences = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    capturePaused: v.optional(v.boolean()),
    categoryControls: v.optional(vCategoryControls),
    capsuleTargetTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const current = await ensurePreferences(ctx, actor);
    const enabled = args.enabled ?? current.enabled;
    const capturePaused = enabled
      ? (args.capturePaused ?? current.capturePaused)
      : true;
    const now = Date.now();
    await ctx.db.patch(current._id, {
      enabled,
      capturePaused,
      categoryControls: args.categoryControls ?? current.categoryControls,
      capsuleTargetTokens:
        args.capsuleTargetTokens === undefined
          ? current.capsuleTargetTokens
          : Math.max(
              350,
              Math.min(MAX_TARGET_TOKENS, Math.round(args.capsuleTargetTokens)),
            ),
      schoolId: actor.schoolId,
      updatedAt: now,
    });
    if (!enabled) await invalidateCapsules(ctx, actor.accountId);
    return preferenceProjection((await ctx.db.get(current._id))!, actor);
  },
});

export const listMine = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("proposed"),
        v.literal("active"),
        v.literal("disputed"),
        v.literal("superseded"),
        v.literal("expired"),
      ),
    ),
    scope: v.optional(vScope),
    claimType: v.optional(vClaimType),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const preferences = preferenceProjection(
      await preferencesFor(ctx, actor),
      actor,
    );
    const wantedStatus = args.status;
    const ownedCandidates = wantedStatus
      ? await ctx.db
          .query("memoryClaims")
          .withIndex("by_account_status_updated", (q) =>
            q.eq("accountId", actor.accountId).eq("status", wantedStatus),
          )
          .order("desc")
          .take(MAX_LIST)
      : (
          await Promise.all(
            (
              [
                "active",
                "proposed",
                "disputed",
                "superseded",
                "expired",
              ] as const
            ).map((status) =>
              ctx.db
                .query("memoryClaims")
                .withIndex("by_account_status_updated", (q) =>
                  q.eq("accountId", actor.accountId).eq("status", status),
                )
                .order("desc")
                .take(MAX_LIST),
            ),
          )
        ).flat();
    const sharedCandidates = (
      await Promise.all(
        (wantedStatus
          ? [wantedStatus]
          : ([
              "active",
              "proposed",
              "disputed",
              "superseded",
              "expired",
            ] as const)
        ).map((claimStatus) =>
          sharedScopedClaimsForActor(ctx, actor, claimStatus),
        ),
      )
    ).flat();
    const candidates = [...ownedCandidates, ...sharedCandidates].filter(
      (claim, index, all) =>
        all.findIndex((candidate) => candidate._id === claim._id) === index,
    );
    const needle = normalizeProposition(args.search ?? "");
    const accessCache = newEvidenceAccessCache();
    const visible: Array<ReturnType<typeof claimProjection>> = [];
    for (const claim of candidates) {
      if (claim.status === "deleted") continue;
      if (args.scope && claim.scope !== args.scope) continue;
      if (args.claimType && claim.claimType !== args.claimType) continue;
      if (needle && !claim.normalizedProposition.includes(needle)) continue;
      if (!(await canReadClaim(ctx, actor, claim))) continue;
      const evidence = await currentEvidenceForClaim(ctx, actor, claim._id, accessCache);
      if (evidence.length === 0) continue;
      visible.push(claimProjection(claim, evidence));
      if (visible.length >= Math.max(1, Math.min(args.limit ?? 100, 200)))
        break;
    }
    return {
      preferences,
      claims: visible,
    };
  },
});

export const remember = mutation({
  args: {
    proposition: v.string(),
    scope: vScope,
    claimType: vClaimType,
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    sourceType: v.optional(
      v.union(
        v.literal("user_statement"),
        v.literal("thread"),
        v.literal("artifact"),
        v.literal("workspace"),
        v.literal("product_event"),
      ),
    ),
    sourceId: v.optional(v.string()),
    sourceVersionId: v.optional(v.string()),
    sourceRegionId: v.optional(v.string()),
    captureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (args.sourceType === "product_event")
      throw new Error("MEMORY_SOURCE_UNSUPPORTED: This product-event source cannot be verified. Save a direct statement instead.");
    return upsertClaim(ctx, actor, {
      proposition: args.proposition,
      scope: args.scope,
      claimType: args.claimType,
      assertion: "asserted",
      confidence: 1,
      createdBy: "user",
      workspaceId: args.workspaceId,
      artifactId: args.artifactId,
      evidence: {
        sourceType: args.sourceType ?? "user_statement",
        sourceId: args.sourceId,
        sourceVersionId: args.sourceVersionId,
        sourceRegionId: args.sourceRegionId,
        excerpt: args.proposition,
        captureReason:
          args.captureReason ??
          "You explicitly asked Spectra to remember this.",
      },
    });
  },
});

export const correct = mutation({
  args: {
    claimId: v.id("memoryClaims"),
    proposition: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const original = await ctx.db.get(args.claimId);
    if (!original || !(await canControlClaim(ctx, actor, original)))
      throw new Error("MEMORY_NOT_FOUND: This memory is unavailable.");
    if (!(await canReadClaim(ctx, actor, original)))
      throw new Error(
        "MEMORY_SCOPE_FORBIDDEN: This memory is no longer in scope.",
      );
    const result = await upsertClaim(ctx, actor, {
      proposition: args.proposition,
      scope: original.scope,
      claimType: "correction",
      assertion: "asserted",
      confidence: 1,
      createdBy: "user",
      workspaceId: original.workspaceId,
      artifactId: original.artifactId,
      subjectKind: original.subjectKind,
      subjectId: original.subjectId,
      evidence: {
        sourceType: "correction",
        sourceId: original._id,
        excerpt: args.proposition,
        captureReason: "You corrected a previous memory.",
      },
    });
    if (result.claimId !== original._id) {
      const now = Date.now();
      await ctx.db.patch(original._id, {
        status: "superseded",
        embeddingPartition: undefined,
        supersededById: result.claimId,
        updatedAt: now,
      });
      await ctx.db.patch(result.claimId, {
        supersedesId: original._id,
        updatedAt: now,
      });
      await ctx.db.insert("memoryRelations", {
        accountId: actor.accountId,
        schoolId: actor.schoolId,
        fromClaimId: result.claimId,
        toClaimId: original._id,
        fromSubject: `claim:${result.claimId}`,
        toSubject: `claim:${original._id}`,
        relationType: "corrected",
        confidence: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    await invalidateCapsules(ctx, actor.accountId);
    return result;
  },
});

export const setDisputed = mutation({
  args: { claimId: v.id("memoryClaims"), disputed: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const claim = await ctx.db.get(args.claimId);
    if (!claim || !(await canControlClaim(ctx, actor, claim)))
      throw new Error("MEMORY_NOT_FOUND: This memory is unavailable.");
    const now = Date.now();
    await ctx.db.patch(claim._id, {
      status: args.disputed ? "disputed" : "active",
      embeddingPartition: undefined,
      lastConfirmedAt: args.disputed ? claim.lastConfirmedAt : now,
      updatedAt: now,
    });
    await invalidateCapsules(ctx, actor.accountId);
    if (!args.disputed) await enqueueClaimEmbedding(ctx, (await ctx.db.get(claim._id))!);
    return {
      claimId: claim._id,
      status: args.disputed ? "disputed" : "active",
    };
  },
});

export const forget = mutation({
  args: { claimId: v.id("memoryClaims") },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const claim = await ctx.db.get(args.claimId);
    if (!claim || !(await canControlClaim(ctx, actor, claim)))
      throw new Error("MEMORY_NOT_FOUND: This memory is unavailable.");
    const now = Date.now();
    await ctx.db.patch(claim._id, {
      status: "deleted",
      embedding: undefined,
      embeddingVersion: undefined,
      embeddingInputHash: undefined,
      embeddingUpdatedAt: undefined,
      embeddingPartition: undefined,
      deletionRequestedAt: now,
      proposition: "[forgotten]",
      normalizedProposition: "",
      updatedAt: now,
    });
    for (const evidence of await evidenceForClaim(ctx, claim._id)) {
      await ctx.db.patch(evidence._id, {
        accessStatus: "deleted",
        excerptPreview: undefined,
      });
    }
    await invalidateCapsules(ctx, actor.accountId);
    await enqueueClaimDeletion(ctx, claim, now);
    return { forgotten: true };
  },
});

export const clearAll = mutation({
  args: { confirmation: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (args.confirmation.trim().toUpperCase() !== "FORGET ALL")
      throw new Error("MEMORY_CONFIRMATION_REQUIRED: Type FORGET ALL.");
    const ownedClaims = await ctx.db
      .query("memoryClaims")
      .withIndex("by_account_status_updated", (q) =>
        q.eq("accountId", actor.accountId).eq("status", "active"),
      )
      .collect();
    const proposed = await ctx.db
      .query("memoryClaims")
      .withIndex("by_account_status_updated", (q) =>
        q.eq("accountId", actor.accountId).eq("status", "proposed"),
      )
      .collect();
    const disputed = await ctx.db
      .query("memoryClaims")
      .withIndex("by_account_status_updated", (q) =>
        q.eq("accountId", actor.accountId).eq("status", "disputed"),
      )
      .collect();
    const now = Date.now();
    const privateClaims = [...ownedClaims, ...proposed, ...disputed].filter(
      (claim) =>
        claim.scope === "private_global" ||
        claim.scope === "private_school" ||
        claim.scope === "system",
    );
    for (const claim of privateClaims) {
      await ctx.db.patch(claim._id, {
        status: "deleted",
        embedding: undefined,
        embeddingVersion: undefined,
        embeddingInputHash: undefined,
        embeddingUpdatedAt: undefined,
        embeddingPartition: undefined,
        deletionRequestedAt: now,
        proposition: "[forgotten]",
        normalizedProposition: "",
        updatedAt: now,
      });
      for (const evidence of await evidenceForClaim(ctx, claim._id))
        await ctx.db.patch(evidence._id, {
          accessStatus: "deleted",
          excerptPreview: undefined,
        });
      await enqueueClaimDeletion(ctx, claim, now);
    }
    const capsules = await ctx.db
      .query("memoryCapsules")
      .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
      .collect();
    for (const capsule of capsules)
      if (capsule.accountId === actor.accountId)
        await ctx.db.delete(capsule._id);
    return { forgottenCount: privateClaims.length };
  },
});

export const exportMine = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    const claims = (
      await Promise.all(
        (
          ["active", "proposed", "disputed", "superseded", "expired"] as const
        ).map((status) =>
          ctx.db
            .query("memoryClaims")
            .withIndex("by_account_status_updated", (q) =>
              q.eq("accountId", actor.accountId).eq("status", status),
            )
            .collect(),
        ),
      )
    ).flat();
    const visible = [];
    const accessCache = newEvidenceAccessCache();
    for (const claim of claims) {
      if (!(await canReadClaim(ctx, actor, claim))) continue;
      const evidence = await currentEvidenceForClaim(ctx, actor, claim._id, accessCache);
      if (evidence.length > 0) visible.push(claimProjection(claim, evidence));
    }
    return {
      format: "spectra-memory-export",
      version: 1,
      exportedAt: Date.now(),
      account: { name: actor.name, email: actor.email },
      preferences: preferenceProjection(
        await preferencesFor(ctx, actor),
        actor,
      ),
      claims: visible,
    };
  },
});

type RetrievalDestination = { workspaceId?: Id<"spectraWorkspaces">; artifactId?: Id<"spectraArtifacts"> };
type RetrievalPartition = RetrievalDestination & { scope: Scope; accountId?: Id<"accounts">; schoolId?: Id<"schools">; key: string };

async function authorizedMemoryPartitions(ctx: MemoryCtx, actor: Actor, destination: RetrievalDestination) {
  const partitions: RetrievalPartition[] = (["private_global", "private_school", "system"] as const).map((scope) => ({
    scope, accountId: actor.accountId, schoolId: scope === "private_school" ? actor.schoolId : undefined,
    key: memoryEmbeddingPartition({ scope, accountId: actor.accountId, schoolId: actor.schoolId }) ?? "",
  }));
  if (destination.workspaceId) {
    const access = await evaluateAccessForActor(ctx, actor, "workspace", destination.workspaceId);
    if (access.allowed && access.capabilities.includes("read")) partitions.push({
      scope: "workspace", workspaceId: destination.workspaceId,
      key: memoryEmbeddingPartition({ scope: "workspace", accountId: actor.accountId, schoolId: actor.schoolId, workspaceId: destination.workspaceId }) ?? "",
    });
  }
  if (destination.artifactId) {
    const artifact = await ctx.db.get(destination.artifactId);
    const access = await evaluateAccessForActor(ctx, actor, artifact?.blueprintKey === "agent" ? "agent" : "artifact", destination.artifactId);
    if (access.allowed && access.capabilities.includes("read")) partitions.push({
      scope: "shared_artifact", artifactId: destination.artifactId,
      key: memoryEmbeddingPartition({ scope: "shared_artifact", accountId: actor.accountId, schoolId: actor.schoolId, artifactId: destination.artifactId }) ?? "",
    });
  }
  return partitions;
}

export const retrievalIdentity = internalQuery({
  args: { workspaceId: v.optional(v.id("spectraWorkspaces")), artifactId: v.optional(v.id("spectraArtifacts")) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const preferences = preferenceProjection(await preferencesFor(ctx, actor), actor);
    return { accountId: actor.accountId, enabled: preferences.enabled,
      partitions: preferences.enabled ? await authorizedMemoryPartitions(ctx, actor, args) : [] };
  },
});

export const contextForRunBase = internalQuery({
  args: {
    queryText: v.string(),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    targetTokens: v.optional(v.number()),
    claimIds: v.optional(v.array(v.id("memoryClaims"))),
    retrievalStatus: v.optional(v.string()),
    semanticMatches: v.optional(
      v.array(
        v.object({
          claimId: v.id("memoryClaims"),
          score: v.number(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const preferences = preferenceProjection(
      await preferencesFor(ctx, actor),
      actor,
    );
    if (!preferences.enabled)
      return {
        enabled: false,
        text: "",
        selectedClaimIds: [],
        returnedClaimIds: [],
        candidateClaimIds: [],
        exclusions: {
          scope: 0,
          permission: 0,
          stale: 0,
          disputed: 0,
          budget: 0,
        },
        estimatedTokens: 0,
        retrieval: { status: "disabled", truncated: false, candidateEvidence: true },
      };
    const target = Math.max(
      1,
      Math.min(
        MAX_TARGET_TOKENS,
        Math.round(Number.isFinite(args.targetTokens) ? args.targetTokens! : preferences.capsuleTargetTokens),
      ),
    );
    const partitions = await authorizedMemoryPartitions(ctx, actor, args);
    const queryTooLarge = !memoryQueryFitsBytes(args.queryText) || args.retrievalStatus === "query_too_large";
    const literalText = queryTooLarge ? "" : normalizeProposition(args.queryText);
    let literalUnavailable = false;
    let truncated = (args.claimIds?.length ?? 0) > 8;
    const literalClaims: Doc<"memoryClaims">[] = [];
    // Use the whole normalized query. An oversized query is reported, never silently shortened.
    if (literalText) {
      const perPartition = Math.floor(20 / partitions.length);
      for (const partition of partitions) {
        try {
          const rows = await ctx.db.query("memoryClaims").withSearchIndex("search_normalized_proposition", (q) => {
            let search = q.search("normalizedProposition", literalText).eq("status", "active").eq("scope", partition.scope);
            if (partition.accountId) search = search.eq("accountId", partition.accountId);
            if (partition.schoolId) search = search.eq("schoolId", partition.schoolId);
            if (partition.workspaceId) search = search.eq("workspaceId", partition.workspaceId);
            if (partition.artifactId) search = search.eq("artifactId", partition.artifactId);
            return search;
          }).take(perPartition);
          literalClaims.push(...rows);
          if (rows.length === perPartition) truncated = true;
        } catch { literalUnavailable = true; }
      }
    }
    const exactIds = (args.claimIds ?? []).slice(0, 8);
    const semanticMatches = queryTooLarge ? [] : (args.semanticMatches ?? []).slice(0, 80);
    const identities = [...new Set([...exactIds, ...literalClaims.map((claim) => claim._id), ...semanticMatches.map((match) => match.claimId)])];
    if (identities.length > 80 || semanticMatches.length === 80) truncated = true;
    const literalById = new Map(literalClaims.map((claim) => [String(claim._id), claim]));
    const claims = (await Promise.all(identities.slice(0, 80).map((id) => literalById.get(String(id)) ?? ctx.db.get(id))))
      .filter((claim): claim is Doc<"memoryClaims"> => Boolean(claim));
    const queryTerms = terms(args.queryText);
    const semanticScores = new Map(
      semanticMatches.filter((match) => Number.isFinite(match.score)).map((match) => [
        String(match.claimId),
        Math.max(-1, Math.min(1, match.score)),
      ]),
    );
    const exclusions = {
      scope: 0,
      permission: 0,
      stale: 0,
      disputed: 0,
      budget: 0,
    };
    const ranked: Array<{
      claim: Doc<"memoryClaims">;
      score: number;
    }> = [];
    const accessCache = newEvidenceAccessCache();
    for (const claim of claims) {
      if (claim.status !== "active") {
        if (claim.status === "disputed") exclusions.disputed += 1;
        else exclusions.stale += 1;
        continue;
      }
      const semanticValid = semanticScores.has(String(claim._id)) &&
        claim.embeddingVersion === embeddingVersion() &&
        claim.embeddingPartition === memoryEmbeddingPartition(claim) &&
        partitions.some((partition) => partition.key === claim.embeddingPartition) &&
        claim.embeddingInputHash === await memoryInputHash(claim.proposition);
      if (!semanticValid) semanticScores.delete(String(claim._id));
      if (!semanticValid && !literalById.has(String(claim._id)) && !exactIds.includes(claim._id)) continue;
      if (!preferences.categoryControls[categoryForClaim(claim.claimType)]) {
        exclusions.scope += 1;
        continue;
      }
      if (claim.expiresAt && claim.expiresAt <= Date.now()) {
        exclusions.stale += 1;
        continue;
      }
      if (
        claim.scope === "workspace" &&
        (!args.workspaceId || claim.workspaceId !== args.workspaceId)
      ) {
        exclusions.scope += 1;
        continue;
      }
      if (
        claim.scope === "shared_artifact" &&
        (!args.artifactId || claim.artifactId !== args.artifactId)
      ) {
        exclusions.scope += 1;
        continue;
      }
      if (!(await canReadClaim(ctx, actor, claim))) {
        exclusions.permission += 1;
        continue;
      }
      if (!(await claimHasCurrentEvidence(ctx, actor, claim._id, accessCache))) {
        exclusions.permission += 1;
        continue;
      }
      const lexical = overlapScore(queryTerms, claim.proposition);
      const semantic = semanticScores.get(String(claim._id)) ?? 0;
      ranked.push({
        claim,
        score: (exactIds.includes(claim._id) ? 2 : 0) + lexical + semantic,
      });
    }
    const rankedById = new Map(
      ranked.map((item) => [String(item.claim._id), item]),
    );
    let frontier = ranked
      .sort((left, right) => right.score - left.score)
      .slice(0, 12)
      .map((item) => item.claim._id);
    const traversed = new Set(frontier.map(String));
    for (let depth = 0; depth < 2 && frontier.length; depth += 1) {
      const relationSets = await Promise.all(
        frontier.map(async (claimId) => ({
          claimId,
          relations: [
            ...(await ctx.db
              .query("memoryRelations")
              .withIndex("by_from_claim", (q) => q.eq("fromClaimId", claimId))
              .take(8)),
            ...(await ctx.db
              .query("memoryRelations")
              .withIndex("by_to_claim", (q) => q.eq("toClaimId", claimId))
              .take(8)),
          ],
        })),
      );
      const next: Id<"memoryClaims">[] = [];
      for (const { claimId, relations } of relationSets)
        for (const relation of relations) {
          if (relation.accountId !== actor.accountId || relation.schoolId !== actor.schoolId) continue;
          const neighborId =
            relation.fromClaimId === claimId
              ? relation.toClaimId
              : relation.fromClaimId;
          if (!neighborId) continue;
          const item = rankedById.get(String(neighborId));
          // Never traverse through an unreadable intermediary or hydrate an unbounded frontier.
          if (!item) continue;
          item.score +=
              Math.max(0, Math.min(1, relation.confidence)) *
              (depth === 0 ? 0.22 : 0.1);
          if (!traversed.has(String(neighborId))) {
            traversed.add(String(neighborId));
            next.push(neighborId);
          }
        }
      frontier = next.slice(0, 24);
    }
    ranked.sort(
      (a, b) => b.score - a.score || b.claim.updatedAt - a.claim.updatedAt,
    );
    const selected: Array<Doc<"memoryClaims">> = [];
    const rendered: string[] = [];
    for (const item of ranked) {
      const claim = item.claim;
      const line = `[M${selected.length + 1}] ${claim.proposition} (${claim.scope.replaceAll("_", " ")}; ${claim.assertion}; confidence ${Math.round(claim.confidence * 100)}%)`;
      if (selected.length >= MAX_CLAIMS_PER_CONTEXT || tokenEstimate([...rendered, line].join("\n")) > target) {
        exclusions.budget += 1;
        continue;
      }
      selected.push(item.claim);
      rendered.push(line);
    }
    const contextClaims = await Promise.all(
      selected.map(async (claim, index) => {
        const evidence = await currentEvidenceForClaim(ctx, actor, claim._id, accessCache);
        return {
          citation: `M${index + 1}`,
          claimId: claim._id,
          proposition: claim.proposition,
          scope: claim.scope,
          confidence: claim.confidence,
          assertion: claim.assertion,
          evidence: evidence.slice(0, 2).map((item) => ({
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            sourceVersionId: item.sourceVersionId,
            sourceRegionId: item.sourceRegionId,
            observedAt: item.observedAt,
          })),
        };
      }),
    );
    const text = rendered.join("\n");
    return {
      enabled: true,
      text,
      claims: contextClaims,
      selectedClaimIds: selected.map((claim) => claim._id),
      returnedClaimIds: selected.map((claim) => claim._id),
      candidateClaimIds: ranked.map((item) => item.claim._id).slice(0, 80),
      exclusions,
      estimatedTokens: text ? tokenEstimate(text) : 0,
      targetTokens: target,
      retrieval: {
        status: queryTooLarge ? "query_too_large" : args.retrievalStatus ?? "literal_only",
        literalUnavailable, truncated: truncated || exclusions.budget > 0, candidateEvidence: true,
        guidance: queryTooLarge ? "Use a more specific complete query within 8000 UTF-8 bytes; the query was not shortened." :
          "These are candidate memories. Use only evidence relevant to the current request; none may be applicable.",
      },
    };
  },
});

export const contextForRun = action({
  args: {
    queryText: v.string(),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    targetTokens: v.optional(v.number()),
    claimIds: v.optional(v.array(v.id("memoryClaims"))),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const identity = await ctx.runQuery(internal.memory.retrievalIdentity, { workspaceId: args.workspaceId, artifactId: args.artifactId });
    const queryText = args.queryText;
    let retrievalStatus = memoryQueryFitsBytes(queryText) ? "exact_only" : "query_too_large";
    let semanticMatches: { claimId: Id<"memoryClaims">; score: number }[] = [];
    if (identity.enabled && retrievalStatus !== "query_too_large" && queryText.trim()) {
      try {
        const result = await embedQuery(identity.accountId, queryText);
        if (result.ok) {
          const matches = await ctx.vectorSearch("memoryClaims", "by_embedding", {
            vector: result.vector, limit: 80,
            filter: (q) => q.or(...identity.partitions.map((partition) => q.eq("embeddingPartition", partition.key))),
          });
          semanticMatches = matches.map((match) => ({ claimId: match._id, score: match._score }));
          retrievalStatus = "semantic_and_literal";
        } else retrievalStatus = result.code;
      } catch { retrievalStatus = "semantic_unavailable"; }
    }
    return ctx.runQuery(internal.memory.contextForRunBase, {
      ...args,
      queryText,
      semanticMatches, retrievalStatus,
    });
  },
});

export const recordRetrieval = mutation({
  args: {
    runId: v.optional(v.id("spectraAiRuns")),
    purpose: v.string(),
    queryHash: v.string(),
    candidateClaimIds: v.array(v.id("memoryClaims")),
    selectedClaimIds: v.array(v.id("memoryClaims")),
    exclusionCounts: v.object({
      scope: v.number(),
      permission: v.number(),
      stale: v.number(),
      disputed: v.number(),
      budget: v.number(),
    }),
    estimatedTokens: v.number(),
    actualTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    for (const claimId of args.selectedClaimIds) {
      const claim = await ctx.db.get(claimId);
      if (
        !claim ||
        claim.status !== "active" ||
        (claim.expiresAt !== undefined && claim.expiresAt <= Date.now()) ||
        !(await canReadClaim(ctx, actor, claim)) ||
        !(await claimHasCurrentEvidence(ctx, actor, claim._id))
      )
        throw new Error(
          "MEMORY_RETRIEVAL_STALE: A selected memory is no longer permitted.",
        );
    }
    return ctx.db.insert("memoryRetrievalEvents", {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      runId: args.runId,
      purpose: compact(args.purpose, 180),
      queryHash: compact(args.queryHash, 128),
      candidateClaimIds: args.candidateClaimIds.slice(0, 100),
      selectedClaimIds: args.selectedClaimIds.slice(0, 40),
      exclusionCounts: args.exclusionCounts,
      estimatedTokens: Math.max(0, args.estimatedTokens),
      actualTokens: args.actualTokens,
      createdAt: Date.now(),
    });
  },
});

function explicitCandidateFromText(text: string) {
  const compacted = compact(text);
  const remember = compacted.match(
    /\b(?:please\s+)?remember(?:\s+that)?\s+(.+?)(?:[.!?]\s*$|$)/i,
  );
  if (remember?.[1])
    return {
      proposition: remember[1],
      claimType: "declared_fact" as const,
      reason: "You explicitly asked Spectra to remember this.",
    };
  const future = compacted.match(/\bfrom now on[,:\s]+(.+?)(?:[.!?]\s*$|$)/i);
  if (future?.[1])
    return {
      proposition: future[1],
      claimType: "recurring_workflow" as const,
      reason: "You established a recurring way of working.",
    };
  const correction = compacted.match(
    /^(?:actually|correction|to correct that)[,:\s]+(.+?)(?:[.!?]\s*$|$)/i,
  );
  if (correction?.[1])
    return {
      proposition: correction[1],
      claimType: "correction" as const,
      reason: "You directly corrected prior context.",
    };
  const preference = compacted.match(
    /^(?:i\s+(?:strongly\s+)?prefer|my\s+preference\s+is)\s+(.+?)(?:[.!?]\s*$|$)/i,
  );
  if (preference?.[1])
    return {
      proposition: `I prefer ${preference[1]}`,
      claimType: "inferred_preference" as const,
      reason: "You directly stated a durable preference.",
    };
  const decision = compacted.match(
    /^(?:i(?:'ve| have)\s+decided(?:\s+that)?|my\s+decision\s+is)\s+(.+?)(?:[.!?]\s*$|$)/i,
  );
  if (decision?.[1])
    return {
      proposition: decision[1],
      claimType: "decision" as const,
      reason: "You explicitly recorded a durable decision.",
    };
  return null;
}

export const captureExplicitSignal = mutation({
  args: {
    text: v.string(),
    sourceType: v.union(
      v.literal("thread"),
      v.literal("artifact"),
      v.literal("workspace"),
    ),
    sourceId: v.string(),
    sourceVersionId: v.optional(v.string()),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const preferences = await ensurePreferences(ctx, actor);
    if (!preferences.enabled || preferences.capturePaused)
      return { queued: false, reason: "paused" };
    const candidate = explicitCandidateFromText(args.text);
    if (!candidate) return { queued: false, reason: "no_strong_signal" };
    const rejection = captureRejectionReason(candidate.proposition);
    if (rejection) return { queued: false, reason: rejection };
    if (!preferences.categoryControls[categoryForClaim(candidate.claimType)])
      return { queued: false, reason: "category_disabled" };
    const scope: Scope = args.workspaceId ? "private_school" : "private_global";
    const normalized = normalizeProposition(candidate.proposition);
    const idempotencyKey = `capture:${actor.accountId}:${hash(`${scope}:${normalized}:${args.sourceType}:${args.sourceId}`).slice(0, 40)}`;
    const existing = await ctx.db
      .query("memoryJobs")
      .withIndex("by_idempotency", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existing)
      return { queued: existing.status !== "failed", duplicate: true };
    const now = Date.now();
    const jobId = await ctx.db.insert("memoryJobs", {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      kind: "capture",
      idempotencyKey,
      payload: {
        proposition: candidate.proposition,
        claimType: candidate.claimType,
        scope,
        sourceType: args.sourceType,
        sourceId: compact(args.sourceId, 180),
        sourceVersionId: compact(args.sourceVersionId, 180) || undefined,
        workspaceId: args.workspaceId,
        artifactId: args.artifactId,
        reason: candidate.reason,
      },
      status: "queued",
      attemptCount: 0,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { queued: true, jobId };
  },
});

async function rebuildCapsulesForAccount(
  ctx: MutationCtx,
  actor: Actor,
  claims: Array<Doc<"memoryClaims">>,
) {
  const preferences = preferenceProjection(
    await preferencesFor(ctx, actor),
    actor,
  );
  const definitions: Array<{
    scope: Doc<"memoryCapsules">["scope"];
    workspaceId?: Id<"spectraWorkspaces">;
    claims: Array<Doc<"memoryClaims">>;
  }> = [
    {
      scope: "private_global",
      claims: claims.filter(
        (claim) => claim.scope === "private_global" || claim.scope === "system",
      ),
    },
    {
      scope: "private_school",
      claims: claims.filter((claim) => claim.scope === "private_school"),
    },
    {
      scope: "workflow",
      claims: claims.filter((claim) =>
        ["recurring_workflow", "mistake_avoidance", "correction"].includes(
          claim.claimType,
        ),
      ),
    },
  ];
  const workspaceIds = [
    ...new Set(
      claims.flatMap((claim) =>
        claim.scope === "workspace" && claim.workspaceId
          ? [claim.workspaceId]
          : [],
      ),
    ),
  ];
  for (const workspaceId of workspaceIds)
    definitions.push({
      scope: "workspace",
      workspaceId,
      claims: claims.filter(
        (claim) =>
          claim.scope === "workspace" && claim.workspaceId === workspaceId,
      ),
    });

  const now = Date.now();
  for (const definition of definitions) {
    const ranked = definition.claims.sort(
      (a, b) =>
        Number(b.assertion === "asserted") -
          Number(a.assertion === "asserted") ||
        b.confidence - a.confidence ||
        b.updatedAt - a.updatedAt,
    );
    const selected: Array<Doc<"memoryClaims">> = [];
    let tokens = 0;
    const scopeTarget =
      definition.scope === "private_global"
        ? Math.round(preferences.capsuleTargetTokens * 0.3)
        : definition.scope === "private_school"
          ? Math.round(preferences.capsuleTargetTokens * 0.18)
          : definition.scope === "workflow"
            ? Math.round(preferences.capsuleTargetTokens * 0.22)
            : Math.round(preferences.capsuleTargetTokens * 0.38);
    for (const claim of ranked) {
      const cost = tokenEstimate(claim.proposition) + 2;
      if (
        selected.length >= 32 ||
        (selected.length > 0 && tokens + cost > scopeTarget)
      )
        continue;
      selected.push(claim);
      tokens += cost;
    }
    const text = selected.map((claim) => `- ${claim.proposition}`).join("\n");
    const contentHash = hash(
      selected.map((claim) => `${claim._id}:${claim.updatedAt}`).join("|"),
    );
    const existing = definition.workspaceId
      ? await ctx.db
          .query("memoryCapsules")
          .withIndex("by_account_workspace", (q) =>
            q
              .eq("accountId", actor.accountId)
              .eq("workspaceId", definition.workspaceId),
          )
          .unique()
      : (
          await ctx.db
            .query("memoryCapsules")
            .withIndex("by_account_scope", (q) =>
              q.eq("accountId", actor.accountId).eq("scope", definition.scope),
            )
            .collect()
        ).find((capsule) => !capsule.workspaceId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        text,
        claimIds: selected.map((claim) => claim._id),
        tokenCount: tokenEstimate(text),
        generationVersion: existing.generationVersion + 1,
        contentHash,
        stale: false,
        schoolId: actor.schoolId,
        updatedAt: now,
      });
    } else if (text) {
      await ctx.db.insert("memoryCapsules", {
        accountId: actor.accountId,
        schoolId: actor.schoolId,
        scope: definition.scope,
        workspaceId: definition.workspaceId,
        text,
        claimIds: selected.map((claim) => claim._id),
        tokenCount: tokenEstimate(text),
        generationVersion: 1,
        contentHash,
        stale: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

export const maintain = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    await ctx.scheduler.runAfter(0, internal.memory.dispatchEmbeddings, {});
    // Embedding backlog never consumes capture/delete admission. Bounded per-kind reads,
    // followed by the original 20 queued / 20 expired-lease aggregate quotas.
    const otherKinds = ["capture", "consolidate", "regenerate_capsule", "expire", "delete"] as const;
    const queued = (await Promise.all(otherKinds.map((kind) => ctx.db.query("memoryJobs")
      .withIndex("by_kind_status_available", (q) => q.eq("kind", kind).eq("status", "queued").lte("availableAt", now)).take(20))))
      .flat().sort((a, b) => a.availableAt - b.availableAt).slice(0, 20);
    const staleLeases = (await Promise.all(otherKinds.map((kind) => ctx.db.query("memoryJobs")
      .withIndex("by_kind_status_available", (q) => q.eq("kind", kind).eq("status", "leased").lte("availableAt", now)).take(20))))
      .flat().filter((job) => (job.leaseExpiresAt ?? 0) <= now)
      .sort((a, b) => a.availableAt - b.availableAt).slice(0, 20);
    const jobs = [
      ...queued,
      ...staleLeases.filter((job) => (job.leaseExpiresAt ?? 0) <= now),
    ];
    const touchedAccounts = new Map<string, Actor>();
    for (const job of jobs) {
      const leaseOwner = `memory-maintainer:${now}:${job._id}`;
      await ctx.db.patch(job._id, {
        status: "leased",
        leaseOwner,
        leaseExpiresAt: now + 45_000,
        attemptCount: job.attemptCount + 1,
        updatedAt: now,
      });
      try {
        const actor = await getActorForAccountId(ctx, job.accountId);
        if (!actor || actor.schoolId !== job.schoolId)
          throw new Error(
            "School membership changed; scoped memory was invalidated.",
          );
        if (job.kind === "capture") {
          const payload =
            job.payload && typeof job.payload === "object"
              ? (job.payload as Record<string, unknown>)
              : {};
          const proposition = compact(payload.proposition);
          const claimType = compact(payload.claimType) as ClaimType;
          if (
            ![
              "declared_fact",
              "correction",
              "recurring_workflow",
              "inferred_preference",
              "decision",
            ].includes(claimType)
          )
            throw new Error("Unsupported background memory candidate.");
          await upsertClaim(ctx, actor, {
            proposition,
            scope:
              payload.scope === "private_school"
                ? "private_school"
                : "private_global",
            claimType,
            assertion: "asserted",
            confidence: 1,
            createdBy: "policy",
            evidence: {
              sourceType:
                payload.sourceType === "artifact" ||
                payload.sourceType === "workspace"
                  ? payload.sourceType
                  : "thread",
              sourceId: compact(payload.sourceId, 180),
              sourceVersionId:
                compact(payload.sourceVersionId, 180) || undefined,
              excerpt: proposition,
              captureReason: compact(payload.reason, 240),
            },
          });
        }
        if (job.kind === "delete") {
          const payload =
            job.payload && typeof job.payload === "object"
              ? (job.payload as { claimId?: unknown })
              : {};
          const claimId =
            typeof payload.claimId === "string"
              ? ctx.db.normalizeId("memoryClaims", payload.claimId)
              : null;
          if (claimId) {
            const claim = await ctx.db.get(claimId);
            if (claim?.accountId === actor.accountId) {
              for (const evidence of await evidenceForClaim(ctx, claimId))
                await ctx.db.delete(evidence._id);
              for (const relation of await ctx.db
                .query("memoryRelations")
                .withIndex("by_from_claim", (q) => q.eq("fromClaimId", claimId))
                .collect())
                await ctx.db.delete(relation._id);
              for (const relation of await ctx.db
                .query("memoryRelations")
                .withIndex("by_to_claim", (q) => q.eq("toClaimId", claimId))
                .collect())
                await ctx.db.delete(relation._id);
            }
          }
        }
        touchedAccounts.set(actor.accountId, actor);
        await ctx.db.patch(job._id, {
          status: "completed",
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          error: undefined,
          completedAt: Date.now(),
          updatedAt: Date.now(),
        });
      } catch (error) {
        const failed = job.attemptCount + 1 >= 5;
        await ctx.db.patch(job._id, {
          status: failed ? "failed" : "queued",
          availableAt:
            Date.now() + Math.min(3_600_000, 2 ** job.attemptCount * 30_000),
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          error: compact(
            error instanceof Error ? error.message : String(error),
            500,
          ),
          updatedAt: Date.now(),
        });
      }
    }
    for (const actor of touchedAccounts.values()) {
      const active = await ctx.db
        .query("memoryClaims")
        .withIndex("by_account_status_updated", (q) =>
          q.eq("accountId", actor.accountId).eq("status", "active"),
        )
        .collect();
      const permitted = [];
      for (const claim of active)
        if (
          (await canReadClaim(ctx, actor, claim)) &&
          (await claimHasCurrentEvidence(ctx, actor, claim._id))
        )
          permitted.push(claim);
      await rebuildCapsulesForAccount(ctx, actor, permitted);
    }

    const inferredCutoff = now - 180 * 86_400_000;
    const proposedCutoff = now - 30 * 86_400_000;
    const oldInferences = await ctx.db
      .query("memoryClaims")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "active").lt("updatedAt", inferredCutoff),
      )
      .take(80);
    const expiredAccountIds = new Set<Id<"accounts">>();
    for (const claim of oldInferences) {
      if (
        claim.assertion !== "inferred" ||
        (claim.lastConfirmedAt ?? 0) > inferredCutoff
      )
        continue;
      await ctx.db.patch(claim._id, {
        status: "expired",
        embeddingPartition: undefined,
        expiresAt: now,
        updatedAt: now,
      });
      expiredAccountIds.add(claim.accountId);
    }
    const rejectedCandidates = await ctx.db
      .query("memoryClaims")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "proposed").lt("updatedAt", proposedCutoff),
      )
      .take(80);
    for (const claim of rejectedCandidates) {
      await ctx.db.patch(claim._id, {
        status: "expired",
        embeddingPartition: undefined,
        expiresAt: now,
        updatedAt: now,
      });
      expiredAccountIds.add(claim.accountId);
    }
    for (const accountId of expiredAccountIds)
      await invalidateCapsules(ctx, accountId);

    const retrievalCutoff = now - 30 * 86_400_000;
    const oldRetrievals = await ctx.db
      .query("memoryRetrievalEvents")
      .withIndex("by_created", (q) => q.lt("createdAt", retrievalCutoff))
      .take(100);
    for (const event of oldRetrievals) await ctx.db.delete(event._id);
    const oldJobs = await ctx.db
      .query("memoryJobs")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "completed").lt("updatedAt", retrievalCutoff),
      )
      .take(100);
    for (const job of oldJobs) await ctx.db.delete(job._id);

    return { processed: jobs.length, accounts: touchedAccounts.size };
  },
});

/**
 * Privacy-safe invariant evaluation. It stores counts and rates only: never
 * propositions, evidence previews, source identifiers, or account IDs.
 */
export const evaluateSafety = internalMutation({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    const claims = await ctx.db.query("memoryClaims").order("desc").take(160);
    const capsules = await ctx.db
      .query("memoryCapsules")
      .order("desc")
      .take(100);
    const active = claims.filter((claim) => claim.status === "active");
    const deleted = claims.filter((claim) => claim.status === "deleted");
    const corrections = active.filter(
      (claim) => claim.claimType === "correction" && claim.supersedesId,
    );

    let evidenceBacked = 0;
    let correctionFailures = 0;
    let deletionFailures = 0;
    let contaminationFailures = 0;
    let scopeFailures = 0;
    const duplicateKeys = new Set<string>();
    const actorCache = new Map<string, Actor | null>();
    let duplicates = 0;

    for (const claim of active) {
      const duplicateKey = `${claim.accountId}:${claim.propositionHash}`;
      if (duplicateKeys.has(duplicateKey)) duplicates += 1;
      else duplicateKeys.add(duplicateKey);

      if (captureRejectionReason(claim.proposition)) contaminationFailures += 1;
      if (
        ((claim.scope === "private_school" ||
          claim.scope === "workspace" ||
          claim.scope === "shared_artifact") &&
          claim.scopeSchoolId !== claim.schoolId) ||
        (claim.scope === "workspace" && !claim.workspaceId) ||
        (claim.scope === "shared_artifact" && !claim.artifactId)
      )
        scopeFailures += 1;

      const actorKey = String(claim.accountId);
      let actor = actorCache.get(actorKey);
      if (actor === undefined) {
        actor = await getActorForAccountId(ctx, claim.accountId);
        actorCache.set(actorKey, actor);
      }
      if (
        actor &&
        (await canReadClaim(ctx, actor, claim)) &&
        (await claimHasCurrentEvidence(ctx, actor, claim._id))
      )
        evidenceBacked += 1;
    }

    for (const correction of corrections) {
      const prior = correction.supersedesId
        ? await ctx.db.get(correction.supersedesId)
        : null;
      if (
        !prior ||
        prior.status !== "superseded" ||
        prior.supersededById !== correction._id
      )
        correctionFailures += 1;
    }

    for (const claim of deleted) {
      const evidence = await evidenceForClaim(ctx, claim._id);
      if (
        evidence.some(
          (item) =>
            item.accessStatus === "available" || Boolean(item.excerptPreview),
        )
      )
        deletionFailures += 1;
    }

    let capsuleBudgetFailures = 0;
    const preferenceCache = new Map<string, Doc<"memoryPreferences"> | null>();
    for (const capsule of capsules) {
      const accountKey = String(capsule.accountId);
      let preference = preferenceCache.get(accountKey);
      if (preference === undefined) {
        preference = await ctx.db
          .query("memoryPreferences")
          .withIndex("by_account", (q) => q.eq("accountId", capsule.accountId))
          .unique();
        preferenceCache.set(accountKey, preference);
      }
      const target = preference?.capsuleTargetTokens ?? DEFAULT_TARGET_TOKENS;
      if (capsule.tokenCount > target || capsule.stale)
        capsuleBudgetFailures += 1;
    }

    const rate = (failures: number, total: number) =>
      total > 0 ? failures / total : 0;
    const metrics = {
      evidenceBackedRate: active.length ? evidenceBacked / active.length : 1,
      duplicateRate: rate(duplicates, active.length),
      correctionFailureRate: rate(correctionFailures, corrections.length),
      deletionFailureRate: rate(deletionFailures, deleted.length),
      contaminationFailureRate: rate(contaminationFailures, active.length),
      scopeFailureRate: rate(scopeFailures, active.length),
      capsuleBudgetFailureRate: rate(capsuleBudgetFailures, capsules.length),
    };
    const passed =
      metrics.evidenceBackedRate >= 0.98 &&
      metrics.duplicateRate <= 0.01 &&
      metrics.correctionFailureRate === 0 &&
      metrics.deletionFailureRate === 0 &&
      metrics.contaminationFailureRate === 0 &&
      metrics.scopeFailureRate === 0 &&
      metrics.capsuleBudgetFailureRate <= 0.02;
    const evaluationId = await ctx.db.insert("memoryEvaluationRuns", {
      scope: "platform",
      sampledClaims: claims.length,
      sampledCapsules: capsules.length,
      metrics,
      passed,
      durationMs: Date.now() - startedAt,
      createdAt: Date.now(),
    });

    const cutoff = Date.now() - 90 * 86_400_000;
    const oldRuns = await ctx.db
      .query("memoryEvaluationRuns")
      .withIndex("by_scope_created", (q) =>
        q.eq("scope", "platform").lt("createdAt", cutoff),
      )
      .take(50);
    for (const run of oldRuns) await ctx.db.delete(run._id);
    return { evaluationId, passed, metrics };
  },
});
