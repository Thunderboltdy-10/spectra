import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { validateDurablePayload } from "./collaborationDurablePayload";
import { isDurableContentRef } from "../shared/durable-content";
import { classifyArtifactContentWipe } from "../src/features/spectra/operations/artifact-content-wipe";
import { canonicalArtifactWriteContent, resolveArtifactWriteInput } from "../src/features/spectra/operations/artifact-write-content";
import { isArtifactTypeKey } from "../src/features/spectra/artifacts/registry";
import {
  artifactOperationDigest, artifactOutput, artifactScopeDigest, artifactSourceIdentity,
  artifactWriteReceipt, currentArtifactApprovalScope, type ArtifactWriteScope,
} from "./spectraArtifactWriteScope";

const attemptArgs = { runId: v.id("spectraAiRuns"), executionId: v.string() };

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
  args: attemptArgs,
  handler: async (ctx, args) => {
    const { actor, run } = await ownedAttempt(ctx, args);
    if (run.status !== "running") throw new Error("AI_ARTIFACT_OPERATION_NOT_ACTIVE");
    const operations = await ctx.db.query("spectraOperations")
      .withIndex("by_run_execution_status", q => q.eq("runId", run._id).eq("executionId", args.executionId).eq("status", "proposed"))
      .filter(q => q.or(q.eq(q.field("type"), "artifact.update"), q.eq(q.field("type"), "artifact.archive")))
      .collect();
    const targets = [];
    const seen = new Set<string>();
    for (const operation of operations) {
      const input = artifactOutput(operation.input);
      // New artifacts are not existing content-wipe targets. Their later write
      // admission must resolve the same-attempt creation receipt, not an ID guess.
      if (operation.type === "artifact.update" && /^@created:\d+$/.test(String(input.artifactId))) continue;
      const artifactId = typeof input.artifactId === "string" ? ctx.db.normalizeId("spectraArtifacts", input.artifactId) : null;
      if (!artifactId) throw new Error("AI_ARTIFACT_TARGET_NOT_RESOLVED");
      await requireActorArtifactCapability(ctx, actor, artifactId, operation.type === "artifact.archive" ? "delete" : "modify");
      if (seen.has(artifactId)) continue;
      seen.add(artifactId);
      const artifact = (await ctx.db.get(artifactId))!;
      let storageId: Id<"_storage"> | undefined;
      if (isDurableContentRef(artifact.content)) {
        const ref = artifact.content.spectraContentRef;
        storageId = (await validateDurablePayload(ctx, {
          artifactId, payloadRef: ref.payloadRef, digest: ref.digest, byteLength: ref.byteLength, kind: "projection",
        })).storageId;
      }
      targets.push({ artifact, sourceContentIdentity: await artifactSourceIdentity(artifact), storageId });
    }
    return { operations, targets, prompt: run.userPrompt };
  },
});

export const commitPreparation = internalMutation({
  args: { ...attemptArgs, prepared: v.array(v.object({ operationId: v.id("spectraOperations"), scope: v.any(), reason: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    const { actor, run } = await ownedAttempt(ctx, args);
    if (run.status !== "running") throw new Error("AI_ARTIFACT_OPERATION_NOT_ACTIVE");
    const reasons: string[] = [];
    for (const prepared of args.prepared) {
      const operation = await ctx.db.get(prepared.operationId);
      const scope = prepared.scope as ArtifactWriteScope;
      const artifactId = ctx.db.normalizeId("spectraArtifacts", scope.artifactId);
      if (!operation || operation.runId !== run._id || operation.executionId !== args.executionId || operation.status !== "proposed" ||
          !artifactId || scope.operationDigest !== await artifactOperationDigest(operation))
        throw new Error("AI_ARTIFACT_PREPARATION_CHANGED");
      await requireActorArtifactCapability(ctx, actor, artifactId, scope.kind === "archive" ? "delete" : "modify");
      const artifact = (await ctx.db.get(artifactId))!;
      if (scope.sourceContentIdentity !== await artifactSourceIdentity(artifact)) throw new Error("AI_ARTIFACT_PREPARATION_CHANGED");
      await ctx.db.patch(operation._id, {
        requiresConfirmation: operation.requiresConfirmation || scope.kind !== "update",
        output: { ...artifactOutput(operation.output), artifactWriteScope: scope },
      });
      if (prepared.reason) reasons.push(prepared.reason);
    }
    return { approvalReasons: [...new Set(reasons)] };
  },
});

export const preparePlan = action({
  args: attemptArgs,
  handler: async (ctx, args): Promise<{ approvalReasons: string[] }> => {
    const context = await ctx.runQuery(makeFunctionReference<"query">("spectraArtifactWrites:preparationContext"), args) as {
      operations: Doc<"spectraOperations">[];
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
    for (const operation of context.operations) {
      const input = artifactOutput(operation.input);
      const target = targets.get(String(input.artifactId));
      if (!target) continue; // Same-plan newly created targets have no old body.
      const type = target.artifact.blueprintKey;
      if (!isArtifactTypeKey(type)) throw new Error("AI_ARTIFACT_BLUEPRINT_MISMATCH");
      if (operation.type === "artifact.update" && input.blueprintKey !== target.artifact.blueprintKey)
        throw new Error("AI_ARTIFACT_BLUEPRINT_MISMATCH");
      const before = target.content;
      const resolved = operation.type === "artifact.archive" ? { content: before, resolvedContent: before }
        : resolveArtifactWriteInput(type, before, input, context.prompt);
      const after = resolved.content;
      const wipe = operation.type === "artifact.archive" ? undefined
        : classifyArtifactContentWipe(type, target.authoredContent, resolved.resolvedContent);
      const kind = operation.type === "artifact.archive" ? "archive" as const : wipe?.fullContentDeletion ? "full_content_delete" as const : "update" as const;
      const scope: ArtifactWriteScope = {
        version: 1, artifactId: target.artifact._id, runId: args.runId, executionId: args.executionId, operationId: operation._id,
        operationDigest: await artifactOperationDigest(operation), sourceContentIdentity: target.sourceContentIdentity,
        baseContentDigest: await artifactScopeDigest(before), resultContentDigest: await artifactScopeDigest(after), kind,
        ...(target.previousOperationId ? { baseProducerOperationId: target.previousOperationId } : {}),
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
        operation.type !== "artifact.archive" || artifactOutput(operation.input).artifactId !== args.artifactId)
      throw new Error("AI_ARTIFACT_OPERATION_SCOPE_MISMATCH");
    const operationDigest = await artifactOperationDigest(operation);
    const receipt = artifactWriteReceipt(operation.output);
    if (receipt) {
      if (receipt.scope !== operationDigest) throw new Error("AI_ARTIFACT_RECEIPT_SCOPE_MISMATCH");
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
