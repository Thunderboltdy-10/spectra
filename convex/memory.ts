import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { evaluateAccessForActor } from "./authorityShared";
import { getActorForAccountId, getAuthenticatedActor } from "./identityShared";
import { memoryEmbedding } from "./memoryEmbedding";
import {
  SOUL_TOKEN_CAP,
  boundSoulText,
  estimateSoulTokens,
  normalizeSoulText,
  soulTextIsWithinCap,
} from "../src/features/spectra/memory/soul-policy";
import {
  MODEL_MEMORY_PROPOSAL_MAX_COUNT,
  MODEL_MEMORY_PROPOSITION_MAX_CHARACTERS,
  MODEL_MEMORY_REASON_MAX_CHARACTERS,
  isModelMemoryClaimType,
} from "../src/features/spectra/memory/capture-policy";

export { SOUL_TOKEN_CAP } from "../src/features/spectra/memory/soul-policy";

const DEFAULT_TARGET_TOKENS = 1_000;
const MAX_TARGET_TOKENS = 4_000;
const MAX_CLAIMS_PER_CONTEXT = 24;
const MAX_LIST = 300;

const vRetrievalTier = v.union(
  v.literal("initial"),
  v.literal("focused"),
  v.literal("deep"),
);

type RetrievalTier = "initial" | "focused" | "deep";

function retrievalTierPolicy(tier: RetrievalTier, initialTargetTokens: number) {
  if (tier === "focused")
    return {
      targetTokens: 1_500,
      graphHops: 1,
      maxClaims: 12,
      seedLimit: 8,
      frontierLimit: 12,
      candidateLimit: 32,
      broadFallback: false,
    } as const;
  if (tier === "deep")
    return {
      targetTokens: 4_000,
      graphHops: 3,
      maxClaims: MAX_CLAIMS_PER_CONTEXT,
      seedLimit: 16,
      frontierLimit: 32,
      candidateLimit: 80,
      broadFallback: false,
    } as const;
  return {
    targetTokens: Math.max(
      250,
      Math.min(MAX_TARGET_TOKENS, Math.round(initialTargetTokens)),
    ),
    graphHops: 2,
    maxClaims: MAX_CLAIMS_PER_CONTEXT,
    seedLimit: 12,
    frontierLimit: 24,
    candidateLimit: 80,
    broadFallback: true,
  } as const;
}

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

export function captureSafetyRejectionReason(value: string) {
  if (forbiddenCapturePatterns.some((pattern) => pattern.test(value)))
    return "sensitive_or_secret";
  if (
    /\b(?:just for (?:today|this message)|right now only|temporary request)\b/i.test(
      value,
    )
  )
    return "transient";
  return null;
}

export function captureRejectionReason(proposition: string) {
  if (proposition.length < 12) return "too_short";
  if (proposition.length > 1_500) return "too_long";
  return captureSafetyRejectionReason(proposition);
}

function soulCaptureRejectionReason(text: string) {
  if (!soulTextIsWithinCap(text)) return "too_long";
  if (forbiddenCapturePatterns.some((pattern) => pattern.test(text)))
    return "sensitive_or_secret";
  return null;
}

function soulAuditSubject(accountId: Id<"accounts">) {
  return `soul:${accountId}`;
}

function isSoulAuditClaim(
  claim: Pick<Doc<"memoryClaims">, "accountId" | "subjectId">,
) {
  return claim.subjectId === soulAuditSubject(claim.accountId);
}

function soulProjection(capsule: Doc<"memoryCapsules"> | null) {
  const generatedText = boundSoulText(capsule?.generatedText ?? "");
  const userText = boundSoulText(capsule?.userText ?? "");
  const text = userText || generatedText || boundSoulText(capsule?.text ?? "");
  return {
    text,
    tokenCount: estimateSoulTokens(text),
    maxTokens: SOUL_TOKEN_CAP,
    userEdited: Boolean(userText),
    updatedAt: capsule?.updatedAt ?? null,
  };
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
) {
  if (evidence.accessStatus !== "available") return false;
  if (
    evidence.sourceType === "user_statement" ||
    evidence.sourceType === "product_event" ||
    evidence.sourceType === "correction"
  )
    return true;
  if (evidence.sourceType === "managebac")
    return evidence.schoolId === actor.schoolId;
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
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      "workspace",
      evidence.sourceId,
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
) {
  const evidence = await evidenceForClaim(ctx, claimId);
  if (evidence.length === 0) return false;
  for (const item of evidence)
    if (await evidenceIsCurrentlyAvailable(ctx, actor, item)) return true;
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
    .take(12);
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
      embedding: duplicate.embedding ?? memoryEmbedding(proposition),
      lastConfirmedAt:
        input.assertion === "asserted" ? now : duplicate.lastConfirmedAt,
      updatedAt: now,
    });
    await insertEvidence(ctx, actor, duplicate._id, input.evidence);
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
    embedding: memoryEmbedding(proposition),
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

async function soulCapsuleForAccount(
  ctx: MemoryCtx,
  accountId: Id<"accounts">,
) {
  return ctx.db
    .query("memoryCapsules")
    .withIndex("by_account_kind", (q) =>
      q.eq("accountId", accountId).eq("kind", "soul"),
    )
    .unique();
}

async function activeSoulAuditClaim(
  ctx: MemoryCtx,
  actor: Actor,
  capsule: Doc<"memoryCapsules"> | null,
) {
  if (capsule?.userTextClaimId) {
    const recorded = await ctx.db.get(capsule.userTextClaimId);
    if (
      recorded?.accountId === actor.accountId &&
      recorded.status === "active" &&
      isSoulAuditClaim(recorded)
    )
      return recorded;
  }
  const active = await ctx.db
    .query("memoryClaims")
    .withIndex("by_account_status_updated", (q) =>
      q.eq("accountId", actor.accountId).eq("status", "active"),
    )
    .order("desc")
    .take(500);
  return active.find((claim) => isSoulAuditClaim(claim)) ?? null;
}

async function journalSoulEdit(
  ctx: MutationCtx,
  actor: Actor,
  text: string,
  capsule: Doc<"memoryCapsules"> | null,
) {
  const previous = await activeSoulAuditClaim(ctx, actor, capsule);
  const now = Date.now();
  if (!text) {
    if (previous) {
      await insertEvidence(ctx, actor, previous._id, {
        sourceType: "user_statement",
        sourceId: "settings:soul",
        captureReason:
          "You removed your direct edit and chose to use what Spectra learned.",
      });
      await ctx.db.patch(previous._id, {
        status: "superseded",
        updatedAt: now,
      });
    }
    return undefined;
  }

  const normalized = normalizeProposition(text);
  const claimId = await ctx.db.insert("memoryClaims", {
    accountId: actor.accountId,
    schoolId: actor.schoolId,
    scope: "private_global",
    subjectKind: "user",
    subjectId: soulAuditSubject(actor.accountId),
    claimType: previous ? "correction" : "declared_fact",
    proposition: text,
    normalizedProposition: normalized,
    propositionHash: hash(`soul:${actor.accountId}:${now}:${normalized}`),
    embedding: memoryEmbedding(text),
    assertion: "asserted",
    confidence: 1,
    sensitivity: "standard",
    status: "active",
    createdBy: "user",
    validFrom: now,
    lastConfirmedAt: now,
    supersedesId: previous?._id,
    createdAt: now,
    updatedAt: now,
  });
  await insertEvidence(ctx, actor, claimId, {
    sourceType: "user_statement",
    sourceId: "settings:soul",
    excerpt: text,
    captureReason: "You updated how Spectra knows you in Settings.",
  });
  if (previous) {
    await ctx.db.patch(previous._id, {
      status: "superseded",
      supersededById: claimId,
      updatedAt: now,
    });
    await ctx.db.insert("memoryRelations", {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      fromClaimId: claimId,
      toClaimId: previous._id,
      fromSubject: `claim:${claimId}`,
      toSubject: `claim:${previous._id}`,
      relationType: "corrected",
      confidence: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  return claimId;
}

export const soul = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    return soulProjection(await soulCapsuleForAccount(ctx, actor.accountId));
  },
});

export const updateSoul = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const text = normalizeSoulText(args.text);
    const rejection = soulCaptureRejectionReason(text);
    if (rejection === "too_long")
      throw new Error(
        `SOUL_TOO_LONG: Keep this text within ${SOUL_TOKEN_CAP} tokens.`,
      );
    if (rejection)
      throw new Error(
        "MEMORY_CAPTURE_REJECTED: Remove secrets or sensitive personal information before saving.",
      );

    const existing = await soulCapsuleForAccount(ctx, actor.accountId);
    const previousUserText = boundSoulText(existing?.userText ?? "");
    if (existing && text === previousUserText) return soulProjection(existing);

    const userTextClaimId = await journalSoulEdit(ctx, actor, text, existing);
    const generatedText = boundSoulText(existing?.generatedText ?? "");
    const effectiveText = text || generatedText;
    const now = Date.now();
    const patch = {
      kind: "soul" as const,
      schoolId: actor.schoolId,
      text: effectiveText,
      generatedText,
      userText: text || undefined,
      userTextClaimId,
      tokenCount: estimateSoulTokens(effectiveText),
      generationVersion: (existing?.generationVersion ?? 0) + 1,
      contentHash: hash(`soul:${generatedText}|user:${text}`),
      stale: false,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return soulProjection((await ctx.db.get(existing._id))!);
    }
    const capsuleId = await ctx.db.insert("memoryCapsules", {
      accountId: actor.accountId,
      scope: "private_global",
      workspaceId: undefined,
      claimIds: [],
      createdAt: now,
      ...patch,
    });
    return soulProjection((await ctx.db.get(capsuleId))!);
  },
});

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
    createdBy: v.optional(
      v.union(v.literal("user"), v.literal("policy"), v.literal("model")),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const preferences = preferenceProjection(
      await preferencesFor(ctx, actor),
      actor,
    );
    const wantedStatus = args.status;
    const createdBy = args.createdBy;
    const ownedForStatus = async (
      status: "proposed" | "active" | "disputed" | "superseded" | "expired",
    ) => {
      const indexed = ctx.db
        .query("memoryClaims")
        .withIndex("by_account_status_updated", (q) =>
          q.eq("accountId", actor.accountId).eq("status", status),
        );
      const filtered = createdBy
        ? indexed.filter((q) => q.eq(q.field("createdBy"), createdBy))
        : indexed;
      return filtered.order("desc").take(MAX_LIST);
    };
    const ownedCandidates = wantedStatus
      ? await ownedForStatus(wantedStatus)
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
            ).map(ownedForStatus),
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
    const visible: Array<Doc<"memoryClaims">> = [];
    for (const claim of candidates) {
      if (claim.status === "deleted") continue;
      if (args.scope && claim.scope !== args.scope) continue;
      if (args.claimType && claim.claimType !== args.claimType) continue;
      if (args.createdBy && claim.createdBy !== args.createdBy) continue;
      if (needle && !claim.normalizedProposition.includes(needle)) continue;
      if (!(await canReadClaim(ctx, actor, claim))) continue;
      visible.push(claim);
      if (visible.length >= Math.max(1, Math.min(args.limit ?? 100, 200)))
        break;
    }
    return {
      preferences,
      claims: await Promise.all(
        visible.map(async (claim) =>
          claimProjection(claim, await evidenceForClaim(ctx, claim._id)),
        ),
      ),
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
      lastConfirmedAt: args.disputed ? claim.lastConfirmedAt : now,
      updatedAt: now,
    });
    await invalidateCapsules(ctx, actor.accountId);
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
    for (const claim of claims)
      if (await canReadClaim(ctx, actor, claim))
        visible.push(
          claimProjection(claim, await evidenceForClaim(ctx, claim._id)),
        );
    return {
      format: "spectra-memory-export",
      version: 1,
      exportedAt: Date.now(),
      account: { name: actor.name, email: actor.email },
      preferences: preferenceProjection(
        await preferencesFor(ctx, actor),
        actor,
      ),
      soul: soulProjection(await soulCapsuleForAccount(ctx, actor.accountId)),
      claims: visible,
    };
  },
});

export const retrievalIdentity = internalQuery({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    return { accountId: actor.accountId, schoolId: actor.schoolId };
  },
});

export const contextForRunBase = internalQuery({
  args: {
    queryText: v.string(),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    tier: v.optional(vRetrievalTier),
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
        tier: args.tier ?? "initial",
        text: "",
        selectedClaimIds: [],
        candidateClaimIds: [],
        exclusions: {
          scope: 0,
          permission: 0,
          stale: 0,
          disputed: 0,
          budget: 0,
        },
        estimatedTokens: 0,
        actualTokens: 0,
      };
    const tier = args.tier ?? "initial";
    const policy = retrievalTierPolicy(tier, preferences.capsuleTargetTokens);
    const target = policy.targetTokens;
    const ownedClaims = await ctx.db
      .query("memoryClaims")
      .withIndex("by_account_status_updated", (q) =>
        q.eq("accountId", actor.accountId).eq("status", "active"),
      )
      .order("desc")
      .take(500);
    const workspaceClaims = args.workspaceId
      ? await ctx.db
          .query("memoryClaims")
          .withIndex("by_workspace_status", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("status", "active"),
          )
          .take(200)
      : [];
    const artifactClaims = args.artifactId
      ? await ctx.db
          .query("memoryClaims")
          .withIndex("by_artifact_status", (q) =>
            q.eq("artifactId", args.artifactId).eq("status", "active"),
          )
          .take(200)
      : [];
    const semanticClaims = (
      await Promise.all(
        (args.semanticMatches ?? [])
          .slice(0, 80)
          .map((match) => ctx.db.get(match.claimId)),
      )
    ).filter((claim): claim is Doc<"memoryClaims"> => Boolean(claim));
    const claims = [
      ...ownedClaims,
      ...workspaceClaims,
      ...artifactClaims,
      ...semanticClaims,
    ].filter(
      (claim, index, all) =>
        all.findIndex((candidate) => candidate._id === claim._id) === index,
    );
    const queryTerms = terms(args.queryText);
    const semanticScores = new Map(
      (args.semanticMatches ?? []).map((match) => [
        String(match.claimId),
        Math.max(0, Math.min(1, match.score)),
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
      retrievalSignal: number;
    }> = [];
    for (const claim of claims) {
      // The user-authored soul revision is already injected at the front of
      // every packet. Do not spend the ordinary retrieval budget on a second
      // copy of the same text.
      if (isSoulAuditClaim(claim)) continue;
      if (claim.status !== "active") {
        if (claim.status === "disputed") exclusions.disputed += 1;
        else exclusions.stale += 1;
        continue;
      }
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
      if (!(await claimHasCurrentEvidence(ctx, actor, claim._id))) {
        exclusions.permission += 1;
        continue;
      }
      const lexical = overlapScore(queryTerms, claim.proposition);
      const semantic = semanticScores.get(String(claim._id)) ?? 0;
      const correctionBoost = claim.claimType === "correction" ? 0.3 : 0;
      const assertedBoost = claim.assertion === "asserted" ? 0.18 : 0;
      const recency = Math.max(
        0,
        1 - (Date.now() - claim.updatedAt) / 31_536_000_000,
      );
      ranked.push({
        claim,
        retrievalSignal: lexical + semantic,
        score:
          lexical * 1.8 +
          semantic * 1.35 +
          claim.confidence * 0.65 +
          correctionBoost +
          assertedBoost +
          recency * 0.12,
      });
    }
    const rankedById = new Map(
      ranked.map((item) => [String(item.claim._id), item]),
    );
    let frontier = ranked
      .filter((item) => item.retrievalSignal >= 0.12)
      .sort((left, right) => right.score - left.score)
      .slice(0, policy.seedLimit)
      .map((item) => item.claim._id);
    const traversed = new Set(frontier.map(String));
    for (
      let depth = 0;
      depth < policy.graphHops && frontier.length;
      depth += 1
    ) {
      const relationSets = await Promise.all(
        frontier.map(async (claimId) => ({
          claimId,
          relations: [
            ...(await ctx.db
              .query("memoryRelations")
              .withIndex("by_from_claim", (q) => q.eq("fromClaimId", claimId))
              .collect()),
            ...(await ctx.db
              .query("memoryRelations")
              .withIndex("by_to_claim", (q) => q.eq("toClaimId", claimId))
              .collect()),
          ],
        })),
      );
      const next: Id<"memoryClaims">[] = [];
      for (const { claimId, relations } of relationSets)
        for (const relation of relations) {
          if (relation.accountId !== actor.accountId) continue;
          const neighborId =
            relation.fromClaimId === claimId
              ? relation.toClaimId
              : relation.fromClaimId;
          if (!neighborId) continue;
          const item = rankedById.get(String(neighborId));
          if (item)
            item.score +=
              Math.max(0, Math.min(1, relation.confidence)) *
              (depth === 0 ? 0.22 : depth === 1 ? 0.1 : 0.05);
          if (!traversed.has(String(neighborId))) {
            traversed.add(String(neighborId));
            next.push(neighborId);
          }
        }
      frontier = next.slice(0, policy.frontierLimit);
    }
    const eligible = (
      policy.broadFallback
        ? ranked
        : ranked.filter((item) => traversed.has(String(item.claim._id)))
    ).sort(
      (a, b) => b.score - a.score || b.claim.updatedAt - a.claim.updatedAt,
    );
    const selected: Array<Doc<"memoryClaims">> = [];
    let used = 0;
    for (const item of eligible) {
      const cost = tokenEstimate(item.claim.proposition) + 12;
      if (selected.length >= policy.maxClaims || used + cost > target) {
        exclusions.budget += 1;
        continue;
      }
      selected.push(item.claim);
      used += cost;
    }
    const contextClaims = await Promise.all(
      selected.map(async (claim, index) => {
        const evidence = [];
        for (const item of await evidenceForClaim(ctx, claim._id))
          if (await evidenceIsCurrentlyAvailable(ctx, actor, item))
            evidence.push(item);
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
    const lineForClaim = (claim: (typeof contextClaims)[number]) =>
      `[${claim.citation}] ${claim.proposition} (${claim.scope.replaceAll("_", " ")}; ${claim.assertion}; confidence ${Math.round(claim.confidence * 100)}%)`;
    let boundedClaims = contextClaims;
    let boundedSelected = selected;
    let text = boundedClaims.map(lineForClaim).join("\n");
    const promptProjection = () => ({
      tier,
      text,
      claims: boundedClaims,
      exclusions,
      estimatedTokens: tokenEstimate(text),
      targetTokens: target,
    });
    while (
      boundedClaims.length > 0 &&
      tokenEstimate(JSON.stringify(promptProjection())) > target
    ) {
      boundedClaims = boundedClaims.slice(0, -1);
      boundedSelected = boundedSelected.slice(0, -1);
      exclusions.budget += 1;
      text = boundedClaims.map(lineForClaim).join("\n");
    }
    const actualTokens = tokenEstimate(JSON.stringify(promptProjection()));
    return {
      enabled: true,
      tier,
      text,
      claims: boundedClaims,
      selectedClaimIds: boundedSelected.map((claim) => claim._id),
      candidateClaimIds: eligible
        .map((item) => item.claim._id)
        .slice(0, policy.candidateLimit),
      exclusions,
      estimatedTokens: tokenEstimate(text),
      actualTokens,
      targetTokens: target,
    };
  },
});

export const contextForRun = action({
  args: {
    queryText: v.string(),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    tier: v.optional(vRetrievalTier),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const identity = await ctx.runQuery(internal.memory.retrievalIdentity, {});
    const queryText = compact(args.queryText, 4_000);
    const semanticMatches = queryText
      ? await ctx.vectorSearch("memoryClaims", "by_embedding", {
          vector: memoryEmbedding(queryText),
          limit: 80,
          filter: (q) => q.eq("accountId", identity.accountId),
        })
      : [];
    return ctx.runQuery(internal.memory.contextForRunBase, {
      ...args,
      queryText,
      semanticMatches: semanticMatches.map((match) => ({
        claimId: match._id,
        score: match._score,
      })),
    });
  },
});

export const recordRetrieval = mutation({
  args: {
    runId: v.optional(v.id("spectraAiRuns")),
    tier: vRetrievalTier,
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
    const tokenLimit = retrievalTierPolicy(
      args.tier,
      DEFAULT_TARGET_TOKENS,
    ).targetTokens;
    const actualTokens = args.actualTokens ?? args.estimatedTokens;
    if (
      args.estimatedTokens < 0 ||
      actualTokens < 0 ||
      args.estimatedTokens > tokenLimit ||
      actualTokens > tokenLimit
    )
      throw new Error(
        `MEMORY_RETRIEVAL_OVER_BUDGET: ${args.tier} retrieval exceeded its ${tokenLimit}-token limit.`,
      );
    for (const claimId of args.selectedClaimIds) {
      const claim = await ctx.db.get(claimId);
      if (
        !claim ||
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
      tier: args.tier,
      purpose: compact(args.purpose, 180),
      queryHash: compact(args.queryHash, 128),
      candidateClaimIds: args.candidateClaimIds.slice(0, 100),
      selectedClaimIds: args.selectedClaimIds.slice(0, 40),
      exclusionCounts: args.exclusionCounts,
      estimatedTokens: args.estimatedTokens,
      actualTokens,
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

export const captureModelProposals = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    prompt: v.string(),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    proposals: v.array(
      v.object({
        claimType: v.union(
          v.literal("correction"),
          v.literal("recurring_workflow"),
          v.literal("mistake_avoidance"),
        ),
        proposition: v.string(),
        reason: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const preferences = await ensurePreferences(ctx, actor);
    if (!preferences.enabled || preferences.capturePaused)
      return {
        queued: 0,
        refused: args.proposals.length,
        outcomes: args.proposals.map((_, index) => ({
          index,
          queued: false,
          reason: preferences.enabled ? "paused" : "disabled",
        })),
      };

    const scope: Scope = args.workspaceId ? "private_school" : "private_global";
    const outcomes: Array<{
      index: number;
      queued: boolean;
      duplicate?: boolean;
      reason?: string;
      jobId?: Id<"memoryJobs">;
    }> = [];
    for (const [index, candidate] of args.proposals.entries()) {
      if (index >= MODEL_MEMORY_PROPOSAL_MAX_COUNT) {
        outcomes.push({ index, queued: false, reason: "proposal_limit" });
        continue;
      }
      const proposition = compact(
        candidate.proposition,
        MODEL_MEMORY_PROPOSITION_MAX_CHARACTERS + 1,
      );
      const reason = compact(
        candidate.reason,
        MODEL_MEMORY_REASON_MAX_CHARACTERS + 1,
      );
      const rejection =
        proposition.length > MODEL_MEMORY_PROPOSITION_MAX_CHARACTERS
          ? "too_long"
          : reason.length > MODEL_MEMORY_REASON_MAX_CHARACTERS
            ? "reason_too_long"
            : !reason
              ? "reason_required"
              : (captureRejectionReason(proposition) ??
                captureSafetyRejectionReason(reason));
      if (rejection) {
        outcomes.push({ index, queued: false, reason: rejection });
        continue;
      }
      if (!isModelMemoryClaimType(candidate.claimType)) {
        outcomes.push({
          index,
          queued: false,
          reason: "unsupported_category",
        });
        continue;
      }
      if (
        !preferences.categoryControls[categoryForClaim(candidate.claimType)]
      ) {
        outcomes.push({
          index,
          queued: false,
          reason: "category_disabled",
        });
        continue;
      }

      const normalized = normalizeProposition(proposition);
      const idempotencyKey = `model-capture:${actor.accountId}:${args.runId}:${hash(`${scope}:${candidate.claimType}:${normalized}`).slice(0, 40)}`;
      const existing = await ctx.db
        .query("memoryJobs")
        .withIndex("by_idempotency", (q) =>
          q.eq("idempotencyKey", idempotencyKey),
        )
        .unique();
      if (existing) {
        outcomes.push({
          index,
          queued: existing.status !== "failed",
          duplicate: true,
          reason:
            existing.status === "failed" ? "previously_refused" : undefined,
          jobId: existing._id,
        });
        continue;
      }
      const now = Date.now();
      const jobId = await ctx.db.insert("memoryJobs", {
        accountId: actor.accountId,
        schoolId: actor.schoolId,
        kind: "capture",
        idempotencyKey,
        payload: {
          proposition,
          claimType: candidate.claimType,
          scope,
          workspaceId: args.workspaceId,
          artifactId: args.artifactId,
          sourceType: "product_event",
          sourceId: args.runId,
          excerpt: proposition,
          reason,
          createdBy: "model",
          assertion: "inferred",
          confidence: 0.72,
          status: "active",
          subjectKind:
            candidate.claimType === "correction" ? "user" : "workflow",
        },
        status: "queued",
        attemptCount: 0,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      });
      outcomes.push({ index, queued: true, jobId });
    }
    return {
      queued: outcomes.filter((outcome) => outcome.queued).length,
      refused: outcomes.filter((outcome) => !outcome.queued).length,
      outcomes,
    };
  },
});

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
  const generatedSoulCandidates = claims
    .filter(
      (claim) =>
        !isSoulAuditClaim(claim) &&
        (claim.assertion === "asserted" ||
          claim.claimType === "correction" ||
          claim.confidence >= 0.72),
    )
    .sort(
      (left, right) =>
        Number(right.claimType === "correction") -
          Number(left.claimType === "correction") ||
        Number(right.assertion === "asserted") -
          Number(left.assertion === "asserted") ||
        right.confidence - left.confidence ||
        right.updatedAt - left.updatedAt,
    );
  const generatedSoulClaims: Array<Doc<"memoryClaims">> = [];
  let generatedSoulText = "";
  for (const claim of generatedSoulCandidates) {
    const candidate = [
      ...generatedSoulClaims.map((item) => `- ${item.proposition}`),
      `- ${claim.proposition}`,
    ].join("\n");
    if (estimateSoulTokens(candidate) > SOUL_TOKEN_CAP) continue;
    generatedSoulClaims.push(claim);
    generatedSoulText = candidate;
  }
  const existingSoul = await soulCapsuleForAccount(ctx, actor.accountId);
  const userSoulText = boundSoulText(existingSoul?.userText ?? "");
  const effectiveSoulText = userSoulText || generatedSoulText;
  const now = Date.now();
  const soulFields = {
    kind: "soul" as const,
    schoolId: actor.schoolId,
    scope: "private_global" as const,
    text: effectiveSoulText,
    generatedText: generatedSoulText,
    userText: userSoulText || undefined,
    claimIds: generatedSoulClaims.map((claim) => claim._id),
    tokenCount: estimateSoulTokens(effectiveSoulText),
    generationVersion: (existingSoul?.generationVersion ?? 0) + 1,
    contentHash: hash(
      `generated:${generatedSoulClaims.map((claim) => `${claim._id}:${claim.updatedAt}`).join("|")}|user:${userSoulText}`,
    ),
    stale: false,
    updatedAt: now,
  };
  if (existingSoul) await ctx.db.patch(existingSoul._id, soulFields);
  else
    await ctx.db.insert("memoryCapsules", {
      accountId: actor.accountId,
      workspaceId: undefined,
      userTextClaimId: undefined,
      createdAt: now,
      ...soulFields,
    });

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

  for (const definition of definitions) {
    const ranked = [...definition.claims]
      .filter((claim) => !isSoulAuditClaim(claim))
      .sort(
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
        ).find((capsule) => !capsule.workspaceId && capsule.kind !== "soul");
    if (existing) {
      await ctx.db.patch(existing._id, {
        kind: "context",
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
        kind: "context",
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
    const unembedded = await ctx.db
      .query("memoryClaims")
      .withIndex("by_status_updated", (q) => q.eq("status", "active"))
      .filter((q) => q.eq(q.field("embedding"), undefined))
      .take(80);
    await Promise.all(
      unembedded.map((claim) =>
        ctx.db.patch(claim._id, {
          embedding: memoryEmbedding(claim.proposition),
          updatedAt: claim.updatedAt,
        }),
      ),
    );
    const queued = await ctx.db
      .query("memoryJobs")
      .withIndex("by_status_available", (q) =>
        q.eq("status", "queued").lte("availableAt", now),
      )
      .take(20);
    const staleLeases = await ctx.db
      .query("memoryJobs")
      .withIndex("by_status_available", (q) =>
        q.eq("status", "leased").lte("availableAt", now),
      )
      .take(20);
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
          const createdBy =
            payload.createdBy === "model"
              ? ("model" as const)
              : ("policy" as const);
          const reason = compact(
            payload.reason,
            MODEL_MEMORY_REASON_MAX_CHARACTERS + 1,
          );
          const permittedTypes =
            createdBy === "model"
              ? ["correction", "recurring_workflow", "mistake_avoidance"]
              : [
                  "declared_fact",
                  "correction",
                  "recurring_workflow",
                  "inferred_preference",
                  "decision",
                ];
          if (!permittedTypes.includes(claimType))
            throw new Error("Unsupported background memory candidate.");
          if (
            createdBy === "model" &&
            (proposition.length > MODEL_MEMORY_PROPOSITION_MAX_CHARACTERS ||
              !reason ||
              reason.length > MODEL_MEMORY_REASON_MAX_CHARACTERS ||
              captureRejectionReason(proposition) ||
              captureSafetyRejectionReason(reason))
          )
            throw new Error(
              "Model-authored memory candidate failed capture rails.",
            );
          await upsertClaim(ctx, actor, {
            proposition,
            scope:
              payload.scope === "private_school"
                ? "private_school"
                : "private_global",
            claimType,
            assertion: createdBy === "model" ? "inferred" : "asserted",
            confidence:
              createdBy === "model"
                ? Math.max(
                    0.5,
                    Math.min(
                      0.85,
                      typeof payload.confidence === "number"
                        ? payload.confidence
                        : 0.72,
                    ),
                  )
                : 1,
            createdBy,
            status: createdBy === "model" ? "active" : undefined,
            subjectKind:
              payload.subjectKind === "workflow" ? "workflow" : "user",
            evidence: {
              sourceType:
                payload.sourceType === "artifact" ||
                payload.sourceType === "workspace" ||
                payload.sourceType === "product_event"
                  ? payload.sourceType
                  : "thread",
              sourceId: compact(payload.sourceId, 180),
              sourceVersionId:
                compact(payload.sourceVersionId, 180) || undefined,
              excerpt:
                createdBy === "model"
                  ? proposition
                  : compact(payload.excerpt, 240) || proposition,
              captureReason: reason,
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
