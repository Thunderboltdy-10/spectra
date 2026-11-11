import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation, internalQuery, mutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { validateDurablePayload } from "./collaborationDurablePayload";
import { isDurableContentRef } from "../shared/durable-content";
import { unpackOperationInput } from "../shared/operation-content";
import { classifyArtifactContentWipe } from "../src/features/spectra/operations/artifact-content-wipe";
import { canonicalArtifactWriteContent, resolveArtifactWriteInput } from "../src/features/spectra/operations/artifact-write-content";
import { isArtifactTypeKey } from "../src/features/spectra/artifacts/registry";
import { computeEffectivePolicy } from "./syncPolicy";
import type { PermissionCategory } from "../src/features/spectra/settings/schema/ai-permissions";
import {
  artifactOperationDigest, artifactOutput, artifactScopeDigest, artifactSourceIdentity,
  artifactWriteReceipt, currentArtifactApprovalScope, approvalSemanticDigest, type ArtifactWriteScope,
  artifactOperationTarget, artifactCreationIdentity,
} from "./spectraArtifactWriteScope";

const attemptArgs = { runId: v.id("spectraAiRuns"), executionId: v.string() };
const preparationArgs = { ...attemptArgs, operationId: v.optional(v.id("spectraOperations")) };

async function ownedAttempt(ctx: QueryCtx | MutationCtx, args: { runId: Id<"spectraAiRuns">; executionId: string }) {
  const actor = await getAuthenticatedActor(ctx);
  const run = await ctx.db.get(args.runId);
  if (!actor || !run || run.ownerAccountId !== actor.accountId || run.schoolId !== actor.schoolId)
    throw new Error("AI_ARTIFACT_OPERATION_NOT_OWNED");
  if (run.executionId !== args.executionId) throw new Error("AI_ARTIFACT_ATTEMPT_SUPERSEDED");
  return { actor, run };
}

// Storage identifiers are returned only to the action, after current capability
// and payload binding checks. The model cannot submit a classification result.
export const preparationContext = internalQuery({
  args: preparationArgs,
  handler: async (ctx, args) => {
    const { actor, run } = await ownedAttempt(ctx, args);
    if (run.status !== "running") throw new Error("AI_ARTIFACT_OPERATION_NOT_ACTIVE");
    const selected = args.operationId ? await ctx.db.get(args.operationId) : null;
    if (args.operationId && (!selected || selected.runId !== run._id || selected.executionId !== args.executionId ||
        selected.actorType !== "ai" || !["artifact.create", "artifact.update"].includes(selected.type) ||
        !["proposed", "executing"].includes(selected.status) || (selected.type === "artifact.update" && selected.status !== "proposed")))
      throw new Error("AI_ARTIFACT_PREPARATION_CHANGED");
    const operations = selected ? [selected] : await ctx.db.query("spectraOperations")
      .withIndex("by_run_execution_status", q => q.eq("runId", run._id).eq("executionId", args.executionId).eq("status", "proposed"))
      .filter(q => q.or(q.eq(q.field("type"), "artifact.create"), q.eq(q.field("type"), "artifact.update"), q.eq(q.field("type"), "artifact.archive")))
      .collect();
    const targets = [];
    const operationTargets: Array<{ operationId: Id<"spectraOperations">; artifactId: Id<"spectraArtifacts"> }> = [];
    const seen = new Set<string>();
    for (const operation of operations) {
      const artifactId = await artifactOperationTarget(ctx, operation, "preparation");
      operationTargets.push({ operationId: operation._id, artifactId });
      const access = await requireActorArtifactCapability(ctx, actor, artifactId, operation.type === "artifact.archive" ? "delete" : "modify");
      const artifact = access.loaded!.resource as Doc<"spectraArtifacts">;
      if (operation.type === "artifact.create" && (
        artifact.createdFrom?.operationId !== operation._id || artifact.createdFrom.runId !== run._id ||
        artifact.aiRunId !== run._id || artifact.aiExecutionId !== args.executionId || artifact.aiState !== "creating" ||
        artifact.currentVersionId || !isArtifactTypeKey(artifact.blueprintKey) ||
        !artifact.createdFrom.allocationContentDigest || artifact.createdFrom.allocationContentDigest !== await artifactScopeDigest(canonicalArtifactWriteContent(artifact.blueprintKey, artifact.content))
      )) throw new Error("AI_ARTIFACT_CREATION_SOURCE_CHANGED");
      if (seen.has(artifactId)) continue;
      seen.add(artifactId);
      let storageId: Id<"_storage"> | undefined;
      if (isDurableContentRef(artifact.content)) {
        const ref = artifact.content.spectraContentRef;
        storageId = (await validateDurablePayload(ctx, {
          artifactId, payloadRef: ref.payloadRef, digest: ref.digest, byteLength: ref.byteLength, kind: "projection",
        })).storageId;
      }
      targets.push({ artifact, sourceContentIdentity: await artifactSourceIdentity(artifact), storageId });
    }
    return { operations, operationTargets, targets, prompt: run.userPrompt };
  },
});

export const commitPreparation = internalMutation({
  args: { ...preparationArgs, prepared: v.array(v.object({ operationId: v.id("spectraOperations"), scope: v.any(), reason: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    const { actor, run } = await ownedAttempt(ctx, args);
    if (run.status !== "running") throw new Error("AI_ARTIFACT_OPERATION_NOT_ACTIVE");
    const reasons: string[] = [];
    const approvalCategories = new Set<PermissionCategory>();
    for (const prepared of args.prepared) {
      const operation = await ctx.db.get(prepared.operationId);
      const scope = prepared.scope as ArtifactWriteScope;
      const artifactId = ctx.db.normalizeId("spectraArtifacts", scope.artifactId);
      if (!operation || operation.runId !== run._id || operation.executionId !== args.executionId ||
          (operation.status !== "proposed" && !(args.operationId === operation._id && operation.type === "artifact.create" && operation.status === "executing")) ||
          !artifactId || scope.operationDigest !== await artifactOperationDigest(operation) ||
          artifactId !== await artifactOperationTarget(ctx, operation, "preparation"))
        throw new Error("AI_ARTIFACT_PREPARATION_CHANGED");
      await requireActorArtifactCapability(ctx, actor, artifactId, scope.kind === "archive" ? "delete" : "modify");
      const artifact = (await ctx.db.get(artifactId))!;
      if (scope.sourceContentIdentity !== await artifactSourceIdentity(artifact)) throw new Error("AI_ARTIFACT_PREPARATION_CHANGED");
      const categories: PermissionCategory[] = scope.kind === "archive" || scope.kind === "full_content_delete" ? ["permanent_delete"] : [];
      if (operation.type === "artifact.update" && ["docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "xlam", "pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "ppam"].includes(artifact.nativeFormat ?? "")) {
        const replica = await ctx.db.query("workReplicas").withIndex("by_work_kind", q => q.eq("workId", artifactId).eq("kind", "local"))
          .filter(q => q.and(q.eq(q.field("accountId"), actor.accountId), q.neq(q.field("state"), "unavailable"))).first();
        if (replica) {
          const policy = await computeEffectivePolicy(ctx, actor.accountId, { item: String(artifactId), mount: replica.mountId ? String(replica.mountId) : undefined });
          if (policy.contentDirection === "bidirectional" || policy.contentDirection === "spectra-to-local") {
            categories.push("bridge_files");
            reasons.push("This also changes a file on your computer through Spectra Bridge. Go ahead?");
          }
        }
      }
      for (const category of categories) approvalCategories.add(category);
      const boundScope = { ...scope };
      delete boundScope.approvalCategories;
      if (categories.length) boundScope.approvalCategories = categories;
      await ctx.db.patch(operation._id, {
        requiresConfirmation: operation.requiresConfirmation || categories.length > 0,
        output: { ...artifactOutput(operation.output), artifactWriteScope: boundScope },
      });
      if (prepared.reason) reasons.push(prepared.reason);
    }
    return { approvalReasons: [...new Set(reasons)], ...(approvalCategories.size ? { approvalCategories: [...approvalCategories] } : {}) };
  },
});

export const preparePlan = action({
  args: preparationArgs,
  handler: async (ctx, args): Promise<{ approvalReasons: string[]; approvalCategories?: PermissionCategory[] }> => {
    const context = await ctx.runQuery(makeFunctionReference<"query">("spectraArtifactWrites:preparationContext"), args) as {
      operations: Doc<"spectraOperations">[];
      operationTargets: Array<{ operationId: Id<"spectraOperations">; artifactId: Id<"spectraArtifacts"> }>;
      targets: Array<{ artifact: Doc<"spectraArtifacts">; sourceContentIdentity: string; storageId?: Id<"_storage"> }>;
      prompt: string;
    };
    const targets = new Map<string, { artifact: Doc<"spectraArtifacts">; sourceContentIdentity: string; content: unknown; authoredContent: unknown; previousOperationId?: string }>();
    for (const target of context.targets) {
      let content = target.artifact.content;
      if (isDurableContentRef(content)) {
        const ref = content.spectraContentRef;
        if (ref.artifactId !== target.artifact._id) throw new Error("AI_ARTIFACT_CONTENT_INTEGRITY_FAILED");
        const blob = target.storageId ? await ctx.storage.get(target.storageId) : null;
        if (!blob) throw new Error("AI_ARTIFACT_CONTENT_UNAVAILABLE");
        const bytes = await blob.arrayBuffer();
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
        if (bytes.byteLength !== ref.byteLength || digest !== ref.digest) throw new Error("AI_ARTIFACT_CONTENT_INTEGRITY_FAILED");
        const body = JSON.parse(new TextDecoder().decode(bytes));
        content = ref.path === "content" ? body.content : body;
      }
      const type = target.artifact.blueprintKey;
      if (!isArtifactTypeKey(type)) throw new Error("AI_ARTIFACT_BLUEPRINT_MISMATCH");
      targets.set(target.artifact._id, { ...target, authoredContent: content, content: canonicalArtifactWriteContent(type, content) });
    }
    const prepared = [];
    const resolvedTargets = new Map(context.operationTargets.map(target => [target.operationId, target.artifactId]));
    for (const operation of context.operations) {
      const input = artifactOutput(unpackOperationInput(operation.input));
      const target = targets.get(String(resolvedTargets.get(operation._id)));
      if (!target) throw new Error("AI_ARTIFACT_TARGET_NOT_RESOLVED");
      const type = target.artifact.blueprintKey;
      if (!isArtifactTypeKey(type)) throw new Error("AI_ARTIFACT_BLUEPRINT_MISMATCH");
      if ((operation.type === "artifact.update" || operation.type === "artifact.create") && input.blueprintKey !== target.artifact.blueprintKey)
        throw new Error("AI_ARTIFACT_BLUEPRINT_MISMATCH");
      if (operation.type === "artifact.create" && target.previousOperationId)
        throw new Error("AI_ARTIFACT_CREATION_SOURCE_CHANGED");
      const before = target.content;
      const resolved = operation.type === "artifact.archive" ? { content: before, resolvedContent: before }
        : resolveArtifactWriteInput(type, before, input, context.prompt);
      const after = resolved.content;
      const wipe = operation.type === "artifact.archive" || operation.type === "artifact.create" ? undefined
        : classifyArtifactContentWipe(type, target.authoredContent, resolved.resolvedContent);
      const kind = operation.type === "artifact.create" ? "create" as const : operation.type === "artifact.archive" ? "archive" as const : wipe?.fullContentDeletion ? "full_content_delete" as const : "update" as const;
      const scope: ArtifactWriteScope = {
        version: 1, artifactId: target.artifact._id, runId: args.runId, executionId: args.executionId, operationId: operation._id,
        operationDigest: await artifactOperationDigest(operation), sourceContentIdentity: target.sourceContentIdentity,
        baseContentDigest: await artifactScopeDigest(before), resultContentDigest: await artifactScopeDigest(after), kind,
        semanticBaseDigest: await approvalSemanticDigest(before), semanticResultDigest: await approvalSemanticDigest(after),
        ...(target.previousOperationId ? { baseProducerOperationId: target.previousOperationId } : {}),
        ...(kind === "create" ? { creationSourceIdentity: await artifactCreationIdentity(target.artifact) } : {}),
      };
      prepared.push({ operationId: operation._id, scope, ...(kind === "archive" ? { reason: "Archive the selected artifact" } : wipe?.reason ? { reason: wipe.reason } : {}) });
      target.content = after;
      target.authoredContent = resolved.resolvedContent;
      target.previousOperationId = operation._id;
    }
    return ctx.runMutation(makeFunctionReference<"mutation">("spectraArtifactWrites:commitPreparation"), { ...args, prepared });
  },
});

export const archive = mutation({
  args: { ...attemptArgs, operationId: v.id("spectraOperations"), artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args): Promise<unknown> => {
    const { actor, run } = await ownedAttempt(ctx, args);
    const operation = await ctx.db.get(args.operationId);
    if (!operation || operation.actorType !== "ai" || operation.runId !== run._id || operation.executionId !== args.executionId ||
        operation.type !== "artifact.archive" || await artifactOperationTarget(ctx, operation) !== args.artifactId)
      throw new Error("AI_ARTIFACT_OPERATION_SCOPE_MISMATCH");
    const operationDigest = await artifactOperationDigest(operation);
    const receipt = artifactWriteReceipt(operation.output);
    if (receipt) {
      if (receipt.scope !== operationDigest) throw new Error("AI_ARTIFACT_RECEIPT_SCOPE_MISMATCH");
      await requireActorArtifactCapability(ctx, actor, args.artifactId, "delete");
      return receipt.result;
    }
    if (run.status !== "running" || operation.status !== "executing") throw new Error("AI_ARTIFACT_OPERATION_NOT_ACTIVE");
    await requireActorArtifactCapability(ctx, actor, args.artifactId, "delete");
    const { scope, digest } = await currentArtifactApprovalScope(ctx, operation, run, "effect");
    if (scope.kind !== "archive" || run.approval?.status !== "accepted" || run.approval.executionId !== args.executionId ||
        artifactOutput(operation.output).approvedArtifactScope !== digest)
      throw new Error("AI_ARTIFACT_APPROVAL_SCOPE_REQUIRED");
    const result = await ctx.runMutation(makeFunctionReference<"mutation">("spectraArtifacts:archive"), { artifactId: args.artifactId });
    await ctx.db.patch(operation._id, { output: { ...artifactOutput(operation.output), artifactWriteReceipt: { scope: operationDigest, result } } });
    return result;
  },
});
