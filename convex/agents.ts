import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireArtifactCapability,
  requireSpectraActor,
} from "./spectraShared";
import { writeAuditEvent } from "./auditShared";

const vEvalResult = v.object({
  caseId: v.string(),
  category: v.string(),
  required: v.boolean(),
  score: v.number(),
  passed: v.boolean(),
  reason: v.string(),
  responseExcerpt: v.string(),
  latencyMs: v.number(),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
});

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digest(value: unknown) {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(value)),
      ),
    ),
  );
}

export async function agentDraftHash(artifact: Doc<"spectraArtifacts">) {
  return digest({
    title: artifact.title,
    summary: artifact.summary,
    tags: artifact.tags,
    content: artifact.content,
    schemaVersion: artifact.schemaVersion,
  });
}

async function verifyEvalBridge(
  ctx: MutationCtx,
  actor: Awaited<ReturnType<typeof requireSpectraActor>>,
  input: {
    evalRunId: Id<"agentEvalRuns">;
    payloadDigest: string;
    timestamp: number;
    nonce: string;
    signature: string;
  },
) {
  const key =
    process.env.SPECTRA_AGENT_EVAL_BRIDGE_KEY ??
    process.env.SPECTRA_SECRET_BRIDGE_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "AGENT_EVAL_BRIDGE_CONFIG_MISSING: Configure a strong evaluation bridge key.",
    );
  if (Math.abs(Date.now() - input.timestamp) > 60_000)
    throw new Error("AGENT_EVAL_BRIDGE_EXPIRED: Evaluation result expired.");
  const replay = await ctx.db
    .query("secretBridgeNonces")
    .withIndex("by_nonce", (q) => q.eq("nonce", input.nonce))
    .unique();
  if (replay)
    throw new Error(
      "AGENT_EVAL_BRIDGE_REPLAYED: Evaluation result was already used.",
    );
  const canonicalInput = [
    "agent-eval-settle",
    actor.clerkId,
    input.evalRunId,
    input.timestamp,
    input.nonce,
    input.payloadDigest,
  ].join("|");
  const imported = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    imported,
    decodeBase64Url(input.signature),
    new TextEncoder().encode(canonicalInput),
  );
  if (!valid)
    throw new Error(
      "AGENT_EVAL_BRIDGE_INVALID: Evaluation authorization failed.",
    );
  await ctx.db.insert("secretBridgeNonces", {
    nonce: input.nonce,
    operation: "agent-eval-settle",
    accountId: actor.accountId,
    expiresAt: input.timestamp + 60_000,
    createdAt: Date.now(),
  });
}

export const beginEvalRun = mutation({
  args: {
    agentId: v.id("spectraArtifacts"),
    modelId: v.string(),
    provider: v.string(),
    threshold: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "modify",
    );
    if (artifact.blueprintKey !== "agent" || !artifact.schoolId)
      throw new Error("AGENT_EVAL_INVALID: This artifact is not an agent.");
    const content =
      artifact.content &&
      typeof artifact.content === "object" &&
      !Array.isArray(artifact.content)
        ? (artifact.content as Record<string, unknown>)
        : {};
    const cases = Array.isArray(content.evals) ? content.evals : [];
    if (cases.length === 0)
      throw new Error(
        "AGENT_EVAL_CASE_REQUIRED: Add at least one synthetic evaluation case.",
      );
    const now = Date.now();
    const contentHash = await agentDraftHash(artifact);
    const evalRunId = await ctx.db.insert("agentEvalRuns", {
      agentId: artifact._id,
      schoolId: artifact.schoolId,
      creatorAccountId: actor.accountId,
      contentHash,
      status: "running",
      modelId: args.modelId.slice(0, 200),
      provider: args.provider.slice(0, 100),
      threshold: Math.max(0.5, Math.min(1, args.threshold ?? 0.8)),
      caseCount: Math.min(50, cases.length),
      passedCount: 0,
      averageScore: 0,
      results: [],
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return {
      evalRunId,
      contentHash,
      cases: cases.slice(0, 50),
      agent: {
        title: artifact.title,
        summary: artifact.summary,
        content: artifact.content,
      },
    };
  },
});

export const settleEvalRun = mutation({
  args: {
    evalRunId: v.id("agentEvalRuns"),
    results: v.array(vEvalResult),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const run = await ctx.db.get(args.evalRunId);
    if (
      !run ||
      run.creatorAccountId !== actor.accountId ||
      run.schoolId !== actor.schoolId ||
      run.status !== "running"
    )
      throw new Error(
        "AGENT_EVAL_RUN_UNAVAILABLE: This evaluation run cannot be settled.",
      );
    const expectedDigest = await digest({ results: args.results });
    if (expectedDigest !== args.payloadDigest)
      throw new Error("AGENT_EVAL_PAYLOAD_INVALID: Results changed in transit.");
    await verifyEvalBridge(ctx, actor, args);
    if (args.results.length !== run.caseCount)
      throw new Error(
        "AGENT_EVAL_RESULT_COUNT_INVALID: Every evaluation case must settle.",
      );
    const results = args.results.map((result) => ({
      caseId: result.caseId.slice(0, 180),
      category: result.category.slice(0, 100),
      required: result.required,
      score: Math.max(0, Math.min(1, result.score)),
      passed: result.passed,
      reason: result.reason.replace(/\s+/g, " ").trim().slice(0, 1_000),
      responseExcerpt: result.responseExcerpt.slice(0, 1_500),
      latencyMs: Math.max(0, Math.round(result.latencyMs)),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    }));
    const passedCount = results.filter((result) => result.passed).length;
    const averageScore =
      results.reduce((sum, result) => sum + result.score, 0) /
      Math.max(1, results.length);
    const passed =
      averageScore >= run.threshold &&
      results.every((result) => !result.required || result.passed);
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: passed ? "passed" : "failed",
      passedCount,
      averageScore,
      results,
      completedAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "agent.evaluation.completed",
      targetType: "agent",
      targetId: run.agentId,
      metadata: {
        evalRunId: run._id,
        passed,
        caseCount: results.length,
        averageScore: Math.round(averageScore * 1_000) / 1_000,
      },
      retentionClass: "operational",
    });
    return {
      evalRunId: run._id,
      status: passed ? ("passed" as const) : ("failed" as const),
      passedCount,
      caseCount: results.length,
      averageScore,
      results,
    };
  },
});

export const evalRuns = query({
  args: { agentId: v.id("spectraArtifacts"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "modify",
    );
    const runs = await ctx.db
      .query("agentEvalRuns")
      .withIndex("by_agent_created", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .take(Math.max(1, Math.min(50, args.limit ?? 12)));
    return {
      currentContentHash: await agentDraftHash(artifact),
      runs,
    };
  },
});

export const submitFeedback = mutation({
  args: {
    agentId: v.id("spectraArtifacts"),
    agentVersionId: v.id("spectraArtifactVersions"),
    runId: v.optional(v.id("spectraAiRuns")),
    rating: v.number(),
    category: v.union(
      v.literal("helpful"),
      v.literal("accuracy"),
      v.literal("clarity"),
      v.literal("safety"),
      v.literal("resource_quality"),
      v.literal("other"),
    ),
    comment: v.optional(v.string()),
    consentToShareComment: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "use",
    );
    if (artifact.blueprintKey !== "agent" || !artifact.schoolId)
      throw new Error("AGENT_FEEDBACK_INVALID");
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (
        !run ||
        run.ownerAccountId !== actor.accountId ||
        run.selectedAgentId !== artifact._id ||
        run.selectedAgentVersionId !== args.agentVersionId
      )
        throw new Error(
          "AGENT_FEEDBACK_RUN_INVALID: Feedback must match your private invocation.",
        );
      const duplicate = await ctx.db
        .query("agentFeedback")
        .withIndex("by_reviewer_run", (q) =>
          q.eq("reviewerAccountId", actor.accountId).eq("runId", run._id),
        )
        .unique();
      if (duplicate)
        throw new Error(
          "AGENT_FEEDBACK_DUPLICATE: Feedback was already submitted for this run.",
        );
    }
    const version = await ctx.db.get(args.agentVersionId);
    if (!version || version.artifactId !== artifact._id)
      throw new Error("AGENT_VERSION_INVALID");
    const rating = Math.max(1, Math.min(5, Math.round(args.rating)));
    const feedbackId = await ctx.db.insert("agentFeedback", {
      agentId: artifact._id,
      agentVersionId: version._id,
      schoolId: artifact.schoolId,
      reviewerAccountId: actor.accountId,
      runId: args.runId,
      rating,
      category: args.category,
      comment: args.consentToShareComment
        ? args.comment?.trim().slice(0, 4_000)
        : undefined,
      consentToShareComment: args.consentToShareComment,
      createdAt: Date.now(),
    });
    return { feedbackId };
  },
});

export const analytics = query({
  args: { agentId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.agentId, "modify");
    const [usage, feedback, evals, proposals] = await Promise.all([
      ctx.db
        .query("agentUsageAggregates")
        .withIndex("by_agent_day", (q) => q.eq("agentId", args.agentId))
        .collect(),
      ctx.db
        .query("agentFeedback")
        .withIndex("by_agent_created", (q) => q.eq("agentId", args.agentId))
        .collect(),
      ctx.db
        .query("agentEvalRuns")
        .withIndex("by_agent_created", (q) => q.eq("agentId", args.agentId))
        .order("desc")
        .take(20),
      ctx.db
        .query("agentImprovementProposals")
        .withIndex("by_agent_status", (q) =>
          q.eq("agentId", args.agentId).eq("status", "proposed"),
        )
        .collect(),
    ]);
    const invocations = usage.reduce((sum, row) => sum + row.invocations, 0);
    const completed = usage.reduce((sum, row) => sum + row.completed, 0);
    const latency = usage.reduce((sum, row) => sum + row.totalLatencyMs, 0);
    return {
      invocations,
      completionRate: invocations ? completed / invocations : null,
      averageLatencyMs: completed ? latency / completed : null,
      feedback: {
        count: feedback.length,
        averageRating: feedback.length
          ? feedback.reduce((sum, row) => sum + row.rating, 0) / feedback.length
          : null,
        categories: Object.entries(
          feedback.reduce<Record<string, number>>((result, row) => {
            result[row.category] = (result[row.category] ?? 0) + 1;
            return result;
          }, {}),
        ),
        comments: feedback
          .filter((row) => row.consentToShareComment && row.comment)
          .slice(-30)
          .map((row) => ({
            rating: row.rating,
            category: row.category,
            comment: row.comment,
            createdAt: row.createdAt,
          })),
      },
      usage,
      evals,
      proposals,
      privacy:
        "Aggregates never include invocation prompts, thread titles or content, memory, or unrelated artifacts.",
    };
  },
});

export const proposeImprovement = mutation({
  args: {
    agentId: v.id("spectraArtifacts"),
    evidence: v.string(),
    proposedPatch: v.any(),
    expectedImpact: v.string(),
    evalRunId: v.optional(v.id("agentEvalRuns")),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "modify",
    );
    if (!artifact.schoolId || artifact.blueprintKey !== "agent")
      throw new Error("AGENT_IMPROVEMENT_INVALID");
    const proposalId = await ctx.db.insert("agentImprovementProposals", {
      agentId: artifact._id,
      schoolId: artifact.schoolId,
      proposedByAccountId: actor.accountId,
      evidence: args.evidence.trim().slice(0, 4_000),
      proposedPatch: args.proposedPatch,
      expectedImpact: args.expectedImpact.trim().slice(0, 2_000),
      evalRunId: args.evalRunId,
      status: "proposed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { proposalId };
  },
});

export const decideImprovement = mutation({
  args: {
    proposalId: v.id("agentImprovementProposals"),
    decision: v.union(v.literal("accepted"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.status !== "proposed")
      throw new Error("AGENT_IMPROVEMENT_UNAVAILABLE");
    const { actor } = await requireArtifactCapability(
      ctx,
      proposal.agentId,
      "modify",
    );
    await ctx.db.patch(proposal._id, {
      status: args.decision,
      decidedByAccountId: actor.accountId,
      decisionNote: args.note?.trim().slice(0, 2_000),
      updatedAt: Date.now(),
    });
    return { proposalId: proposal._id, status: args.decision };
  },
});

export const follow = mutation({
  args: {
    agentId: v.id("spectraArtifacts"),
    following: v.boolean(),
    pinnedReleaseId: v.optional(v.id("agentReleases")),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "use",
    );
    if (artifact.blueprintKey !== "agent" || !artifact.schoolId)
      throw new Error("AGENT_FOLLOW_INVALID");
    const existing = await ctx.db
      .query("agentFollows")
      .withIndex("by_agent_account", (q) =>
        q.eq("agentId", artifact._id).eq("accountId", actor.accountId),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.following ? "following" : "unfollowed",
        pinnedReleaseId: args.following ? args.pinnedReleaseId : undefined,
        updatedAt: now,
      });
      return { followId: existing._id, following: args.following };
    }
    const followId = await ctx.db.insert("agentFollows", {
      agentId: artifact._id,
      schoolId: artifact.schoolId,
      accountId: actor.accountId,
      pinnedReleaseId: args.pinnedReleaseId,
      status: args.following ? "following" : "unfollowed",
      createdAt: now,
      updatedAt: now,
    });
    return { followId, following: args.following };
  },
});

function utcDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export async function recordAgentInvocation(
  ctx: MutationCtx,
  run: Doc<"spectraAiRuns">,
  agentId: Id<"spectraArtifacts">,
  versionId: Id<"spectraArtifactVersions">,
  now: number,
) {
  if (!run.schoolId) return;
  const day = utcDay(now);
  const existing = await ctx.db
    .query("agentUsageAggregates")
    .withIndex("by_agent_version_day", (q) =>
      q.eq("agentId", agentId).eq("agentVersionId", versionId).eq("day", day),
    )
    .unique();
  if (existing)
    await ctx.db.patch(existing._id, {
      invocations: existing.invocations + 1,
      updatedAt: now,
    });
  else
    await ctx.db.insert("agentUsageAggregates", {
      agentId,
      agentVersionId: versionId,
      schoolId: run.schoolId,
      day,
      invocations: 1,
      completed: 0,
      failed: 0,
      cancelled: 0,
      totalLatencyMs: 0,
      modelInputTokens: 0,
      modelOutputTokens: 0,
      updatedAt: now,
    });
}

export async function settleAgentInvocation(
  ctx: MutationCtx,
  run: Doc<"spectraAiRuns">,
  status: "completed" | "failed" | "cancelled",
  usage: unknown,
  now: number,
) {
  if (!run.selectedAgentId || !run.selectedAgentVersionId || !run.schoolId)
    return;
  const aggregate = await ctx.db
    .query("agentUsageAggregates")
    .withIndex("by_agent_version_day", (q) =>
      q
        .eq("agentId", run.selectedAgentId!)
        .eq("agentVersionId", run.selectedAgentVersionId!)
        .eq("day", utcDay(run.agentUsageStartedAt ?? run.createdAt)),
    )
    .unique();
  if (!aggregate) return;
  const usageRecord =
    usage && typeof usage === "object" && !Array.isArray(usage)
      ? (usage as Record<string, unknown>)
      : {};
  const inputTokens =
    typeof usageRecord.promptTokens === "number"
      ? usageRecord.promptTokens
      : typeof usageRecord.input_tokens === "number"
        ? usageRecord.input_tokens
        : 0;
  const outputTokens =
    typeof usageRecord.completionTokens === "number"
      ? usageRecord.completionTokens
      : typeof usageRecord.output_tokens === "number"
        ? usageRecord.output_tokens
        : 0;
  await ctx.db.patch(aggregate._id, {
    completed: aggregate.completed + (status === "completed" ? 1 : 0),
    failed: aggregate.failed + (status === "failed" ? 1 : 0),
    cancelled: aggregate.cancelled + (status === "cancelled" ? 1 : 0),
    totalLatencyMs:
      aggregate.totalLatencyMs +
      Math.max(0, now - (run.startedAt ?? run.createdAt)),
    modelInputTokens: aggregate.modelInputTokens + inputTokens,
    modelOutputTokens: aggregate.modelOutputTokens + outputTokens,
    updatedAt: now,
  });
}
