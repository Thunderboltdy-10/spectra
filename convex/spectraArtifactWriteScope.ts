import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { applicationOperationScope } from "./spectraApplicationWriteScope";
import { getActorForAccountId } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { canonicalArtifactWriteContent, resolveArtifactWriteInput } from "../src/features/spectra/operations/artifact-write-content";
import { classifyArtifactContentWipe } from "../src/features/spectra/operations/artifact-content-wipe";
import { isArtifactTypeKey } from "../src/features/spectra/artifacts/registry";

export type ArtifactWriteScope = {
  version: 1;
  artifactId: string;
  runId: string;
  executionId: string;
  operationId: string;
  operationDigest: string;
  sourceContentIdentity: string;
  baseContentDigest: string;
  resultContentDigest: string;
  kind: "update" | "full_content_delete" | "archive";
  baseProducerOperationId?: string;
};

export function artifactOutput(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function artifactScopeDigest(value: unknown): Promise<string> {
  const canonical = applicationOperationScope({ type: "artifact-write-v1", input: value });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export const artifactOperationDigest = (operation: Doc<"spectraOperations">) => artifactScopeDigest({
  id: operation._id, runId: operation.runId, executionId: operation.executionId,
  type: operation.type, input: operation.input,
});

/** UI presence/preview timestamps do not change the authored target. */
export const artifactSourceIdentity = (artifact: Doc<"spectraArtifacts">) => artifactScopeDigest({
  artifactId: artifact._id, ownerAccountId: artifact.ownerAccountId, schoolId: artifact.schoolId,
  blueprintKey: artifact.blueprintKey, status: artifact.status, title: artifact.title,
  content: artifact.content, currentVersionId: artifact.currentVersionId,
  contentHash: artifact.contentHash, liveStateVectorHash: artifact.liveStateVectorHash,
});

export function preparedArtifactScope(operation: Doc<"spectraOperations">): ArtifactWriteScope | undefined {
  const scope = artifactOutput(artifactOutput(operation.output).artifactWriteScope);
  if (scope.version !== 1 || !["update", "full_content_delete", "archive"].includes(String(scope.kind))) return undefined;
  for (const key of ["artifactId", "runId", "executionId", "operationId", "operationDigest", "sourceContentIdentity", "baseContentDigest", "resultContentDigest"])
    if (typeof scope[key] !== "string") return undefined;
  return scope as ArtifactWriteScope;
}

/** Preparation and acceptance run before any operation in the plan commits. */
export async function currentArtifactApprovalScope(
  ctx: QueryCtx | MutationCtx,
  operation: Doc<"spectraOperations">,
  run: Doc<"spectraAiRuns">,
  phase: "presentation" | "effect" = "presentation",
) {
  const scope = preparedArtifactScope(operation);
  const artifactId = scope ? ctx.db.normalizeId("spectraArtifacts", scope.artifactId) : null;
  const artifact = artifactId ? await ctx.db.get(artifactId) : null;
  if (!scope || !artifact || scope.runId !== run._id || scope.operationId !== operation._id ||
      scope.executionId !== run.executionId || operation.executionId !== run.executionId ||
      scope.operationDigest !== await artifactOperationDigest(operation) ||
      !(phase === "effect"
        ? await artifactEffectSourceMatches(ctx, scope, run, await artifactSourceIdentity(artifact))
        : scope.sourceContentIdentity === await artifactSourceIdentity(artifact)))
    throw new Error("AI_ARTIFACT_APPROVAL_SCOPE_CHANGED: The artifact or proposed edit changed. Prepare a new approval.");
  return { scope, digest: await artifactScopeDigest(scope), artifact };
}

export function artifactWriteReceipt(output: unknown): { scope: string; result: unknown; sourceContentIdentity?: string; resultContentDigest?: string } | undefined {
  const receipt = artifactOutput(artifactOutput(output).artifactWriteReceipt);
  return typeof receipt.scope === "string" && "result" in receipt ? receipt as { scope: string; result: unknown } : undefined;
}

/** A later operation may consume only the exact prior admitted effect. A
 * reported completion or matching current content is not a write receipt. */
async function artifactEffectSourceMatches(
  ctx: QueryCtx | MutationCtx,
  scope: ArtifactWriteScope,
  run: Doc<"spectraAiRuns">,
  sourceIdentity: string,
): Promise<boolean> {
  if (!scope.baseProducerOperationId) return sourceIdentity === scope.sourceContentIdentity;
  const producerId = ctx.db.normalizeId("spectraOperations", scope.baseProducerOperationId);
  const producer = producerId ? await ctx.db.get(producerId) : null;
  const receipt = producer ? artifactWriteReceipt(producer.output) : undefined;
  return Boolean(producer && producer.actorType === "ai" && producer.type === "artifact.update" &&
    artifactOutput(producer.input).artifactId === scope.artifactId &&
    producer.runId === run._id && producer.executionId === run.executionId && receipt &&
    receipt.scope === await artifactOperationDigest(producer) && receipt.sourceContentIdentity === sourceIdentity &&
    receipt.resultContentDigest === scope.baseContentDigest);
}

export type AiArtifactOperationIdentity = {
  runId: Id<"spectraAiRuns">;
  executionId: string;
  operationId: Id<"spectraOperations">;
};

type AdmissionIdentity = {
  actorAccountId: Id<"accounts">;
  artifactId: Id<"spectraArtifacts">;
  aiOperation: AiArtifactOperationIdentity;
};

/** Only a verified server signer may supply this instead of actual content. */
export type AiArtifactContentEvidence = {
  version: 1;
  operationDigest: string;
  sourceContentIdentity: string;
  baseContentDigest: string;
  resultContentDigest: string;
  fullContentDeletion: boolean;
};

/** Receipt lookup for the already authenticated internal transport. Recheck
 * present authority and the exact operation, but do not turn a committed
 * operation into a new effect when its old room/source or status has changed.
 * The wrapper distinguishes a stored null result from no receipt. */
export async function lookupVerifiedAiArtifactWriteReplay(
  ctx: MutationCtx,
  args: AdmissionIdentity & { evidence: AiArtifactContentEvidence },
): Promise<{ result: unknown } | null> {
  const operation = await ctx.db.get(args.aiOperation.operationId);
  const receipt = operation ? artifactWriteReceipt(operation.output) : undefined;
  if (!operation || !receipt) return null;
  const actor = await getActorForAccountId(ctx, args.actorAccountId);
  const run = await ctx.db.get(args.aiOperation.runId);
  if (!actor || !run || run.ownerAccountId !== actor.accountId || run.schoolId !== actor.schoolId ||
      operation.actorType !== "ai" || operation.runId !== run._id ||
      operation.executionId !== args.aiOperation.executionId || run.executionId !== args.aiOperation.executionId)
    throw new Error("AI_ARTIFACT_OPERATION_NOT_OWNED");
  if (operation.type !== "artifact.update" || artifactOutput(operation.input).artifactId !== args.artifactId)
    throw new Error("AI_ARTIFACT_OPERATION_SCOPE_MISMATCH");
  const digest = await artifactOperationDigest(operation);
  if (args.evidence.version !== 1 || args.evidence.operationDigest !== digest || receipt.scope !== digest)
    throw new Error("AI_ARTIFACT_RECEIPT_SCOPE_MISMATCH");
  await requireActorArtifactCapability(ctx, actor, args.artifactId, "modify");
  return { result: receipt.result };
}

/**
 * Invoke inside the transaction that admits the actual effect, after current
 * room/payload CAS and attribution. Before/after must describe that very
 * persisted effect, not a client-supplied alternative projection or hashes.
 * The caller owns sink-specific idempotency and commits its receipt atomically.
 */
async function artifactAdmissionContext(ctx: MutationCtx, args: AdmissionIdentity) {
  const actor = await getActorForAccountId(ctx, args.actorAccountId);
  const run = await ctx.db.get(args.aiOperation.runId);
  const operation = await ctx.db.get(args.aiOperation.operationId);
  if (!actor || !run || run.ownerAccountId !== actor.accountId || run.schoolId !== actor.schoolId ||
      !operation || operation.actorType !== "ai" || operation.runId !== run._id ||
      operation.executionId !== args.aiOperation.executionId || run.executionId !== args.aiOperation.executionId)
    throw new Error("AI_ARTIFACT_OPERATION_NOT_OWNED");
  if (run.status !== "running" || operation.status !== "executing" || artifactOutput(operation.output).clarificationDraft !== undefined)
    throw new Error("AI_ARTIFACT_OPERATION_NOT_ACTIVE");
  const access = await requireActorArtifactCapability(ctx, actor, args.artifactId, "modify");
  const artifact = access.loaded!.resource as Doc<"spectraArtifacts">;
  const scope = preparedArtifactScope(operation);
  const input = artifactOutput(operation.input);
  if (!scope || operation.type !== "artifact.update" || input.artifactId !== args.artifactId ||
      scope.artifactId !== args.artifactId || scope.runId !== run._id || scope.executionId !== run.executionId ||
      scope.operationId !== operation._id || scope.operationDigest !== await artifactOperationDigest(operation))
    throw new Error("AI_ARTIFACT_OPERATION_SCOPE_MISMATCH");
  return { run, operation, artifact, scope, input, sourceIdentity: await artifactSourceIdentity(artifact) };
}

async function assertAdmissionEvidence(ctx: MutationCtx, admission: Awaited<ReturnType<typeof artifactAdmissionContext>>, evidence: AiArtifactContentEvidence) {
  const { run, operation, scope, sourceIdentity } = admission;
  if (evidence.version !== 1 || evidence.operationDigest !== scope.operationDigest || evidence.sourceContentIdentity !== sourceIdentity)
    throw new Error("AI_ARTIFACT_EVIDENCE_SCOPE_CHANGED");
  const beforeDigest = evidence.baseContentDigest;
  const afterDigest = evidence.resultContentDigest;
  // On the exact prepared base/result, retain the server's classification of
  // the original authored input, before adapters manufacture blank defaults.
  // A rebase must classify again against the actual current content.
  const destructive = scope.kind === "full_content_delete" ||
    ((beforeDigest !== scope.baseContentDigest || afterDigest !== scope.resultContentDigest) &&
      evidence.fullContentDeletion);
  if (destructive || operation.requiresConfirmation) {
    const sourceMatches = await artifactEffectSourceMatches(ctx, scope, run, sourceIdentity);
    if (!sourceMatches || beforeDigest !== scope.baseContentDigest || afterDigest !== scope.resultContentDigest ||
        (destructive && scope.kind !== "full_content_delete") || run.approval?.status !== "accepted" ||
        run.approval.executionId !== run.executionId || artifactOutput(operation.output).approvedArtifactScope !== await artifactScopeDigest(scope))
      throw new Error("AI_ARTIFACT_APPROVAL_SCOPE_REQUIRED");
  }
  return { operation, operationDigest: scope.operationDigest, scope, resultContentDigest: afterDigest };
}

export async function assertAiArtifactWriteAdmission(ctx: MutationCtx, args: AdmissionIdentity & { beforeContent: unknown; afterContent: unknown }) {
  const admission = await artifactAdmissionContext(ctx, args);
  const { artifact, run, input, scope } = admission;
  const type = artifact.blueprintKey;
  if (!isArtifactTypeKey(type)) throw new Error("AI_ARTIFACT_BLUEPRINT_MISMATCH");
  const before = canonicalArtifactWriteContent(type, args.beforeContent);
  const after = canonicalArtifactWriteContent(type, args.afterContent);
  const expected = resolveArtifactWriteInput(type, before, input, run.userPrompt);
  const afterDigest = await artifactScopeDigest(after);
  if (afterDigest !== await artifactScopeDigest(expected.content)) throw new Error("AI_ARTIFACT_RESULT_SCOPE_MISMATCH");
  return assertAdmissionEvidence(ctx, admission, {
    version: 1, operationDigest: scope.operationDigest, sourceContentIdentity: admission.sourceIdentity,
    baseContentDigest: await artifactScopeDigest(before), resultContentDigest: afterDigest,
    fullContentDeletion: classifyArtifactContentWipe(type, before, expected.resolvedContent).fullContentDeletion,
  });
}

/**
 * Large-payload alternative ONLY for existing authenticated Node/internal
 * transport. The caller verifies a signature covering this evidence, exact
 * native/projection payload refs+hashes+bytes, actor/run/op and room/replica CAS.
 * The trusted signer must hydrate and verify those bytes, resolve the persisted
 * operation through the common normalizer, and reject a different actual result.
 * Never expose this as a public mutation accepting client digests/booleans.
 */
export async function assertVerifiedAiArtifactWriteAdmission(ctx: MutationCtx, args: AdmissionIdentity & { evidence: AiArtifactContentEvidence }) {
  return assertAdmissionEvidence(ctx, await artifactAdmissionContext(ctx, args), args.evidence);
}
