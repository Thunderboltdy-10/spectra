import { type MutationCtx } from "./_generated/server";
import { query } from "./functions";
import { mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireArtifactCapability,
  requireSpectraActor,
} from "./spectraShared";
import { writeAuditEvent } from "./auditShared";
import { assertSchoolModelTokenCeiling, recordModelTokenUsage } from "./metering";
import { commitDirectHumanChange, commitHumanCheckpoint } from "./changeGroups";
import {
  BENCH_LIMITS,
  benchChecksEmpty,
  benchPromptKey,
  normalizeBenchChecks,
} from "../src/features/spectra/agents/foundry/bench";

const vEvalResult = v.object({
  caseId: v.string(),
  category: v.string(),
  layer: v.optional(v.string()),
  judgedBy: v.optional(v.string()),
  required: v.boolean(),
  score: v.number(),
  passed: v.boolean(),
  reason: v.string(),
  responseExcerpt: v.string(),
  latencyMs: v.number(),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
});

const vEvalLimitation = v.object({
  kind: v.string(),
  layer: v.optional(v.string()),
  detail: v.string(),
});

/** Layers whose verdict does not come from a model judging free text. */
const DETERMINISTIC_EVAL_LAYERS = new Set([
  "contract",
  "tool_sandbox",
  "regression",
]);

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

/** What the route signs for a model-work report; mirrored in the route. */
function agentModelWorkDigest(input: { purpose: string; inputTokens: number; outputTokens: number }) {
  return `${input.purpose}:${input.inputTokens}:${input.outputTokens}`;
}

/**
 * The agent routes run model work on the server and report its results back
 * under the signed-in user's session. The server-held bridge key signs what
 * the route reports (evaluation results, token counts), so a browser calling
 * the same mutation cannot invent or alter them, and a nonce stops replay.
 */
async function verifyAgentBridge(
  ctx: MutationCtx,
  actor: Awaited<ReturnType<typeof requireSpectraActor>>,
  operation: "agent-eval-settle" | "agent-model-work",
  subjectId: string,
  input: {
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
      "AGENT_BRIDGE_CONFIG_MISSING: Configure a strong agent bridge key.",
    );
  if (Math.abs(Date.now() - input.timestamp) > 60_000)
    throw new Error("AGENT_BRIDGE_EXPIRED: The server report expired.");
  const replay = await ctx.db
    .query("secretBridgeNonces")
    .withIndex("by_nonce", (q) => q.eq("nonce", input.nonce))
    .unique();
  if (replay)
    throw new Error(
      "AGENT_BRIDGE_REPLAYED: This server report was already used.",
    );
  const canonicalInput = [
    operation,
    actor.clerkId,
    subjectId,
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
      "AGENT_BRIDGE_INVALID: Server authorization failed.",
    );
  await ctx.db.insert("secretBridgeNonces", {
    nonce: input.nonce,
    operation,
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
    // The layered suite compiled from the agent's own skills, mission and
    // evidence (§10.10). Built by the server route, not the browser. Legacy
    // agents with no compiled skills fall back to `content.evals`.
    cases: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "modify",
    );
    if (artifact.blueprintKey !== "agent" || !artifact.schoolId)
      throw new Error("AGENT_EVAL_INVALID: This artifact is not an agent.");
    // An evaluation is model work billed to the school, like a run.
    await assertSchoolModelTokenCeiling(ctx, actor.schoolId, Date.now());
    const content =
      artifact.content &&
      typeof artifact.content === "object" &&
      !Array.isArray(artifact.content)
        ? (artifact.content as Record<string, unknown>)
        : {};
    const supplied = Array.isArray(args.cases) ? args.cases : [];
    const cases = supplied.length
      ? supplied
      : Array.isArray(content.evals)
        ? content.evals
        : [];
    if (cases.length === 0)
      throw new Error(
        "AGENT_EVAL_CASE_REQUIRED: Compile at least one skill, or add an evaluation case.",
      );
    const now = Date.now();
    const staleRuns = await ctx.db
      .query("agentEvalRuns")
      .withIndex("by_agent_created", (q) => q.eq("agentId", artifact._id))
      .filter((q) => q.eq(q.field("status"), "running"))
      .collect();
    await Promise.all(
      staleRuns
        .filter((run) => run.startedAt < now - 10 * 60_000)
        .map((run) =>
          ctx.db.patch(run._id, {
            status: "failed",
            completedAt: now,
            updatedAt: now,
          }),
        ),
    );
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

/**
 * Admission for agent model work that is not a Spectra run (Agent Foundry and
 * the evaluation suite generator): the school model-token ceiling beginRun
 * applies. The route asks before each model call.
 */
export const admitModelWork = mutation({
  args: { agentId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(ctx, args.agentId, "modify");
    if (artifact.blueprintKey !== "agent")
      throw new Error("AGENT_INVALID: This artifact is not an agent.");
    await assertSchoolModelTokenCeiling(ctx, actor.schoolId, Date.now());
    return { admitted: true as const };
  },
});

/** The tokens the route actually spent, signed by the server, metered to the
 * signed-in user's school. */
export const recordModelWork = mutation({
  args: {
    agentId: v.id("spectraArtifacts"),
    purpose: v.union(
      v.literal("agent_foundry"),
      v.literal("agent_eval_generate"),
      v.literal("agent_bench"),
    ),
    inputTokens: v.number(),
    outputTokens: v.number(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    await verifyAgentBridge(ctx, actor, "agent-model-work", args.agentId, {
      payloadDigest: agentModelWorkDigest(args),
      timestamp: args.timestamp,
      nonce: args.nonce,
      signature: args.signature,
    });
    await recordModelTokenUsage(ctx, {
      schoolId: actor.schoolId,
      accountId: actor.accountId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      sourceType: args.purpose,
      sourceId: args.agentId,
      idempotencyPrefix: `agent-model-work:${args.nonce}`,
      occurredAt: Date.now(),
    });
    return { recorded: true as const };
  },
});

export const draftForEvaluation = query({
  args: { agentId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "modify",
    );
    if (artifact.blueprintKey !== "agent")
      throw new Error("AGENT_EVAL_INVALID");
    return {
      title: artifact.title,
      summary: artifact.summary,
      blueprintKey: artifact.blueprintKey,
      content: artifact.content,
    };
  },
});

export const settleEvalRun = mutation({
  args: {
    evalRunId: v.id("agentEvalRuns"),
    results: v.array(vEvalResult),
    limitations: v.optional(v.array(vEvalLimitation)),
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
      throw new Error(
        "AGENT_EVAL_PAYLOAD_INVALID: Results changed in transit.",
      );
    await verifyAgentBridge(ctx, actor, "agent-eval-settle", args.evalRunId, args);
    if (args.results.length !== run.caseCount)
      throw new Error(
        "AGENT_EVAL_RESULT_COUNT_INVALID: Every evaluation case must settle.",
      );
    const results = args.results.map((result) => ({
      caseId: result.caseId.slice(0, 180),
      category: result.category.slice(0, 100),
      ...(result.layer ? { layer: result.layer.slice(0, 60) } : {}),
      ...(result.judgedBy ? { judgedBy: result.judgedBy.slice(0, 40) } : {}),
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

    // Verification strength is derived here rather than trusted from the
    // caller, so the publish gate cannot be talked into accepting a run that
    // only ever asked a model to grade its own answer (§10.10).
    const layers = new Set(
      results.flatMap((result) => (result.layer ? [result.layer] : [])),
    );
    const judged = results.filter((result) => result.judgedBy);
    const hasDeterministic = [...layers].some((layer) =>
      DETERMINISTIC_EVAL_LAYERS.has(layer),
    );
    const hasExternalTruth =
      layers.has("mission_truth") ||
      judged.some((result) => result.judgedBy === "human");
    const hasAdversarial = layers.has("adversarial");
    const selfJudgedOnly =
      judged.length > 0 &&
      judged.every((result) => result.judgedBy === "self");
    const verificationStrength =
      results.length === 0
        ? "unverified"
        : hasExternalTruth && hasDeterministic && hasAdversarial
          ? "strong"
          : (hasDeterministic || hasExternalTruth) && hasAdversarial
            ? "moderate"
            : selfJudgedOnly && !hasDeterministic
              ? "weak"
              : "moderate";

    const limitations = (args.limitations ?? []).slice(0, 40).map((entry) => ({
      kind: entry.kind.slice(0, 60),
      ...(entry.layer ? { layer: entry.layer.slice(0, 60) } : {}),
      detail: entry.detail.replace(/\s+/g, " ").trim().slice(0, 600),
    }));

    const passed =
      averageScore >= run.threshold &&
      results.every((result) => !result.required || result.passed) &&
      // A suite with no adversarial layer has not shown the agent resists
      // instruction injection, so it cannot pass. Layerless legacy runs are
      // unaffected.
      (layers.size === 0 || hasAdversarial);
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: passed ? "passed" : "failed",
      passedCount,
      averageScore,
      results,
      ...(limitations.length > 0 ? { limitations } : {}),
      verificationStrength,
      completedAt: now,
      updatedAt: now,
    });
    // The per-case counts include the judge's; they arrive signed with the
    // results, so they meter the school's model tokens as a run's do.
    await recordModelTokenUsage(ctx, {
      schoolId: run.schoolId,
      accountId: actor.accountId,
      inputTokens: results.reduce((sum, result) => sum + (result.inputTokens ?? 0), 0),
      outputTokens: results.reduce((sum, result) => sum + (result.outputTokens ?? 0), 0),
      sourceType: "agent_evaluation",
      sourceId: String(run._id),
      idempotencyPrefix: `agent-eval:${run._id}`,
      occurredAt: now,
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
        verificationStrength,
      },
      retentionClass: "operational",
    });
    return {
      evalRunId: run._id,
      status: passed ? ("passed" as const) : ("failed" as const),
      passedCount,
      caseCount: results.length,
      averageScore,
      verificationStrength,
      limitations,
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

/* ------------------------------------------------------------------ */
/* Bench: sample prompts, their answers, and the tests saved from them */
/* ------------------------------------------------------------------ */

async function requireBenchAgent(
  ctx: Parameters<typeof requireArtifactCapability>[0],
  agentId: Id<"spectraArtifacts">,
) {
  const access = await requireArtifactCapability(ctx, agentId, "modify");
  if (access.artifact.blueprintKey !== "agent" || !access.artifact.schoolId)
    throw new Error("AGENT_INVALID: This is not an agent.");
  return { ...access, schoolId: access.artifact.schoolId };
}

function benchPrompt(prompt: string) {
  const text = prompt.trim();
  if (!text)
    throw new Error("AGENT_BENCH_PROMPT_REQUIRED: Write the question first.");
  if (text.length > BENCH_LIMITS.prompt)
    throw new Error(
      "AGENT_BENCH_PROMPT_TOO_LONG: Keep the question under 4,000 characters.",
    );
  return text;
}

function benchCaseView(row: Doc<"agentBenchCases">) {
  return {
    id: row._id as string,
    prompt: row.prompt,
    checks: {
      mustInclude: row.mustInclude,
      mustNotInclude: row.mustNotInclude,
      ...(row.rubric ? { rubric: row.rubric } : {}),
    },
    required: row.required,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Saved tests, oldest first, as the suite and the bench both read them. */
export async function loadBenchCases(
  ctx: Parameters<typeof requireArtifactCapability>[0],
  agentId: Id<"spectraArtifacts">,
) {
  return ctx.db
    .query("agentBenchCases")
    .withIndex("by_agent_created", (q) => q.eq("agentId", agentId))
    .take(BENCH_LIMITS.savedCases);
}

export const benchCases = query({
  args: { agentId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    await requireBenchAgent(ctx, args.agentId);
    return (await loadBenchCases(ctx, args.agentId)).map(benchCaseView);
  },
});

/**
 * Keeps a bench prompt as a test. The same question saved twice updates the
 * one test rather than adding a second.
 */
export const saveBenchCase = mutation({
  args: {
    agentId: v.id("spectraArtifacts"),
    caseId: v.optional(v.id("agentBenchCases")),
    prompt: v.string(),
    mustInclude: v.array(v.string()),
    mustNotInclude: v.array(v.string()),
    rubric: v.optional(v.string()),
    required: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { actor, schoolId } = await requireBenchAgent(ctx, args.agentId);
    const prompt = benchPrompt(args.prompt);
    const checks = normalizeBenchChecks(args);
    if (benchChecksEmpty(checks))
      throw new Error(
        "AGENT_BENCH_CHECKS_REQUIRED: Say what a good answer must or must not do.",
      );
    const promptKey = benchPromptKey(prompt);
    const now = Date.now();
    const fields = {
      prompt,
      promptKey,
      mustInclude: checks.mustInclude,
      mustNotInclude: checks.mustNotInclude,
      rubric: checks.rubric,
      required: args.required ?? true,
      updatedAt: now,
    };
    let existing: Doc<"agentBenchCases"> | null = null;
    if (args.caseId) {
      existing = await ctx.db.get(args.caseId);
      if (!existing || existing.agentId !== args.agentId)
        throw new Error("AGENT_BENCH_CASE_MISSING: That test is gone.");
    } else {
      existing = await ctx.db
        .query("agentBenchCases")
        .withIndex("by_agent_prompt", (q) =>
          q.eq("agentId", args.agentId).eq("promptKey", promptKey),
        )
        .first();
    }
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { caseId: existing._id, created: false };
    }
    const saved = await loadBenchCases(ctx, args.agentId);
    if (saved.length >= BENCH_LIMITS.savedCases)
      throw new Error(
        "AGENT_BENCH_FULL: An agent keeps up to 50 tests. Remove one first.",
      );
    const caseId = await ctx.db.insert("agentBenchCases", {
      ...fields,
      agentId: args.agentId,
      schoolId,
      creatorAccountId: actor.accountId,
      createdAt: now,
    });
    return { caseId, created: true };
  },
});

export const removeBenchCase = mutation({
  args: {
    agentId: v.id("spectraArtifacts"),
    caseId: v.id("agentBenchCases"),
  },
  handler: async (ctx, args) => {
    await requireBenchAgent(ctx, args.agentId);
    const row = await ctx.db.get(args.caseId);
    if (!row || row.agentId !== args.agentId) return { removed: false };
    await ctx.db.delete(row._id);
    return { removed: true };
  },
});

/** The signed-in person's recent bench answers for this agent, newest first. */
export const benchRuns = query({
  args: { agentId: v.id("spectraArtifacts"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { actor } = await requireBenchAgent(ctx, args.agentId);
    const rows = await ctx.db
      .query("agentBenchRuns")
      .withIndex("by_agent_account_created", (q) =>
        q.eq("agentId", args.agentId).eq("accountId", actor.accountId),
      )
      .order("desc")
      .take(Math.max(1, Math.min(120, args.limit ?? 120)));
    return rows.map((row) => ({
      id: row._id as string,
      prompt: row.prompt,
      target: row.target,
      ...(row.releaseNumber !== undefined
        ? { releaseNumber: row.releaseNumber }
        : {}),
      output: row.output,
      createdAt: row.createdAt,
    }));
  },
});

/**
 * Keeps one bench answer so the next run of the same prompt has something to
 * be compared with. Only the latest few per prompt and target are kept.
 */
export const recordBenchRun = mutation({
  args: {
    agentId: v.id("spectraArtifacts"),
    prompt: v.string(),
    target: v.union(v.literal("draft"), v.literal("release")),
    releaseNumber: v.optional(v.number()),
    output: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, schoolId } = await requireBenchAgent(ctx, args.agentId);
    const prompt = benchPrompt(args.prompt);
    const promptKey = benchPromptKey(prompt);
    const now = Date.now();
    const runId = await ctx.db.insert("agentBenchRuns", {
      agentId: args.agentId,
      schoolId,
      accountId: actor.accountId,
      prompt,
      promptKey,
      target: args.target,
      ...(args.target === "release" && args.releaseNumber !== undefined
        ? { releaseNumber: args.releaseNumber }
        : {}),
      output: args.output.slice(0, BENCH_LIMITS.output),
      createdAt: now,
    });
    const recent = await ctx.db
      .query("agentBenchRuns")
      .withIndex("by_agent_account_prompt", (q) =>
        q
          .eq("agentId", args.agentId)
          .eq("accountId", actor.accountId)
          .eq("promptKey", promptKey),
      )
      .order("desc")
      .take(BENCH_LIMITS.runsPerPrompt * 4);
    await Promise.all(
      recent
        .filter((row) => row.target === args.target)
        .slice(BENCH_LIMITS.runsPerPrompt)
        .map((row) => ctx.db.delete(row._id)),
    );
    return { runId, createdAt: now };
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
    if (args.decision === "accepted") {
      await commitHumanCheckpoint(
        ctx,
        proposal.agentId,
        "Saved agent draft before applying an improvement",
      );
      const artifact = await ctx.db.get(proposal.agentId);
      if (!artifact || artifact.blueprintKey !== "agent")
        throw new Error("AGENT_IMPROVEMENT_ARTIFACT_UNAVAILABLE");
      const patch =
        proposal.proposedPatch &&
        typeof proposal.proposedPatch === "object" &&
        !Array.isArray(proposal.proposedPatch)
          ? (proposal.proposedPatch as Record<string, unknown>)
          : {};
      const allowedKeys = new Set([
        "instructionsText",
        "routingDescription",
        "routingExamples",
        "boundaries",
      ]);
      if (
        Object.keys(patch).length === 0 ||
        Object.keys(patch).some((key) => !allowedKeys.has(key))
      )
        throw new Error(
          "AGENT_IMPROVEMENT_PATCH_INVALID: The proposal contains unsupported changes.",
        );
      const content =
        artifact.content &&
        typeof artifact.content === "object" &&
        !Array.isArray(artifact.content)
          ? ({ ...artifact.content } as Record<string, unknown>)
          : {};
      const instructions =
        content.instructions &&
        typeof content.instructions === "object" &&
        !Array.isArray(content.instructions)
          ? ({ ...content.instructions } as Record<string, unknown>)
          : {};
      const routing =
        content.routing &&
        typeof content.routing === "object" &&
        !Array.isArray(content.routing)
          ? ({ ...content.routing } as Record<string, unknown>)
          : {};
      const behavior =
        content.behavior &&
        typeof content.behavior === "object" &&
        !Array.isArray(content.behavior)
          ? ({ ...content.behavior } as Record<string, unknown>)
          : {};
      if (typeof patch.instructionsText === "string")
        instructions.text = patch.instructionsText.slice(0, 250_000);
      if (typeof patch.routingDescription === "string")
        routing.description = patch.routingDescription.slice(0, 4_000);
      if (Array.isArray(patch.routingExamples))
        routing.examples = patch.routingExamples
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().slice(0, 500))
          .filter(Boolean)
          .slice(0, 50);
      if (Array.isArray(patch.boundaries))
        behavior.boundaries = patch.boundaries
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().slice(0, 500))
          .filter(Boolean)
          .slice(0, 100);
      const before = {
        title: artifact.title,
        summary: artifact.summary,
        content: artifact.content,
        tags: artifact.tags,
      };
      const nextContent = { ...content, instructions, routing, behavior };
      const now = Date.now();
      await ctx.db.patch(artifact._id, {
        content: nextContent,
        contentHash: await digest({
          title: artifact.title,
          summary: artifact.summary,
          tags: artifact.tags,
          content: nextContent,
          schemaVersion: artifact.schemaVersion,
        }),
        textIndex: `${artifact.title}\n${artifact.summary ?? ""}\n${artifact.tags.join(" ")}\n${JSON.stringify(nextContent).slice(0, 80_000)}`,
        validity: "valid",
        validityIssues: [],
        syncState: "synchronized",
        lastSynchronizedAt: now,
        updatedAt: now,
      });
      await commitDirectHumanChange(ctx, {
        artifactId: artifact._id,
        actorAccountId: actor.accountId,
        before,
        regionIds: [
          ...(typeof patch.instructionsText === "string"
            ? ["agent:instructions"]
            : []),
          ...(typeof patch.routingDescription === "string" ||
          Array.isArray(patch.routingExamples)
            ? ["agent:routing"]
            : []),
          ...(Array.isArray(patch.boundaries) ? ["agent:behavior"] : []),
        ],
        summary: "Applied an agent improvement proposal",
      });
    }
    await ctx.db.patch(proposal._id, {
      status: args.decision,
      decidedByAccountId: actor.accountId,
      decisionNote: args.note?.trim().slice(0, 2_000),
      updatedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: `agent.improvement.${args.decision}`,
      targetType: "agent",
      targetId: proposal.agentId,
      metadata: { proposalId: proposal._id },
      retentionClass: "operational",
    });
    return { proposalId: proposal._id, status: args.decision };
  },
});

/* ------------------------------------------------------------------ */
/* Background Foundry compilation (§10.8)                              */
/* ------------------------------------------------------------------ */

const COMPILER_STAGE_LABELS: Array<{ stage: string; label: string }> = [
  { stage: "interpret_mission", label: "Reading the mission" },
  { stage: "extract_evidence", label: "Analysing sources" },
  { stage: "propose_skills", label: "Drafting skills" },
  { stage: "create_evaluations", label: "Writing checks" },
  {
    stage: "produce_routing_signature",
    label: "Working out when to use this agent",
  },
  { stage: "identify_failure_modes", label: "Looking for weak points" },
  { stage: "detect_overlap", label: "Checking for duplicate skills" },
  { stage: "compile_release", label: "Preparing the release" },
];

const vCompilerStage = v.object({
  stage: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("skipped"),
  ),
  label: v.string(),
  detail: v.optional(v.string()),
  processed: v.optional(v.number()),
  total: v.optional(v.number()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  error: v.optional(v.string()),
});

/**
 * Starts a compilation job. Only one runs per agent at a time; an existing job
 * for the same draft is returned rather than duplicated.
 */
export const beginCompilerJob = mutation({
  args: {
    agentId: v.id("spectraArtifacts"),
    skipStages: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "modify",
    );
    if (artifact.blueprintKey !== "agent" || !artifact.schoolId)
      throw new Error("AGENT_COMPILE_INVALID: This artifact is not an agent.");

    const now = Date.now();
    const draftHash = await agentDraftHash(artifact);

    const active = await ctx.db
      .query("agentCompilerJobs")
      .withIndex("by_agent_status", (q) =>
        q.eq("agentId", artifact._id).eq("status", "running"),
      )
      .collect();
    const queued = await ctx.db
      .query("agentCompilerJobs")
      .withIndex("by_agent_status", (q) =>
        q.eq("agentId", artifact._id).eq("status", "queued"),
      )
      .collect();

    for (const job of [...active, ...queued]) {
      // A job for the same draft is already in flight; reuse it. A job for an
      // older draft is superseded, so cancel it rather than letting two
      // compilations race to write the same result.
      if (job.draftHash === draftHash && job.startedAt > now - 15 * 60_000)
        return { jobId: job._id, runId: job.runId, reused: true };
      await ctx.db.patch(job._id, {
        status: "cancelled",
        completedAt: now,
        updatedAt: now,
      });
    }

    const skip = new Set(args.skipStages ?? []);
    const runId = `agent-compile-${artifact._id}-${now.toString(36)}`;
    const jobId = await ctx.db.insert("agentCompilerJobs", {
      agentId: artifact._id,
      schoolId: artifact.schoolId,
      creatorAccountId: actor.accountId,
      runId,
      draftHash,
      status: "queued",
      stages: COMPILER_STAGE_LABELS.map((entry) => ({
        stage: entry.stage,
        status: skip.has(entry.stage)
          ? ("skipped" as const)
          : ("pending" as const),
        label: entry.label,
      })),
      startedAt: now,
      updatedAt: now,
    });

    return { jobId, runId, draftHash, reused: false };
  },
});

export const updateCompilerJob = mutation({
  args: {
    jobId: v.id("agentCompilerJobs"),
    status: v.optional(
      v.union(
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
    stages: v.optional(v.array(vCompilerStage)),
    diagnostics: v.optional(
      v.array(
        v.object({
          severity: v.string(),
          stage: v.string(),
          message: v.string(),
          subjectId: v.optional(v.string()),
        }),
      ),
    ),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("AGENT_COMPILE_JOB_NOT_FOUND");
    await requireArtifactCapability(ctx, job.agentId, "modify");

    const now = Date.now();
    const terminal =
      args.status === "completed" ||
      args.status === "failed" ||
      args.status === "cancelled";

    await ctx.db.patch(args.jobId, {
      ...(args.status ? { status: args.status } : {}),
      ...(args.stages ? { stages: args.stages } : {}),
      ...(args.diagnostics ? { diagnostics: args.diagnostics } : {}),
      ...(args.result !== undefined ? { result: args.result } : {}),
      ...(terminal ? { completedAt: now } : {}),
      updatedAt: now,
    });
    return { jobId: args.jobId, updatedAt: now };
  },
});

/**
 * The newest compilation for this agent, with whether it is stale against the
 * current draft. Foundry renders this in place of a Live Dock tab.
 */
export const compilerJob = query({
  args: { agentId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "read",
    );
    if (artifact.blueprintKey !== "agent") return null;

    const [job] = await ctx.db
      .query("agentCompilerJobs")
      .withIndex("by_agent_started", (q) => q.eq("agentId", artifact._id))
      .order("desc")
      .take(1);
    if (!job) return null;

    const draftHash = await agentDraftHash(artifact);
    return {
      jobId: job._id,
      runId: job.runId,
      status: job.status,
      stages: job.stages,
      diagnostics: job.diagnostics ?? [],
      result: job.result ?? null,
      draftHash: job.draftHash,
      stale: job.draftHash !== draftHash,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    };
  },
});

export const cancelCompilerJob = mutation({
  args: { jobId: v.id("agentCompilerJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("AGENT_COMPILE_JOB_NOT_FOUND");
    await requireArtifactCapability(ctx, job.agentId, "modify");
    if (job.status === "completed" || job.status === "failed")
      return { jobId: args.jobId, cancelled: false };
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      completedAt: now,
      updatedAt: now,
    });
    return { jobId: args.jobId, cancelled: true };
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
    if (args.pinnedReleaseId) {
      const release = await ctx.db.get(args.pinnedReleaseId);
      if (
        !release ||
        release.agentId !== artifact._id ||
        release.status !== "published" ||
        !["limited", "published"].includes(release.rollout ?? "published")
      )
        throw new Error(
          "AGENT_FOLLOW_RELEASE_INVALID: Choose an available release of this agent.",
        );
    }
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

/** One more use of this agent by this person (once per run). */
export async function recordAgentUserUse(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  agentId: Id<"spectraArtifacts">,
  now: number,
) {
  const existing = await ctx.db
    .query("agentUserUsage")
    .withIndex("by_account_agent", (q) => q.eq("accountId", accountId).eq("agentId", agentId))
    .unique();
  if (existing) await ctx.db.patch(existing._id, { uses: existing.uses + 1, lastUsedAt: now });
  else await ctx.db.insert("agentUserUsage", { accountId, agentId, uses: 1, lastUsedAt: now });
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
