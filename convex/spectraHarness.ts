import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { applicationApprovalScope } from "./spectraApplicationWriteScope";
import { currentArtifactApprovalScope } from "./spectraArtifactWriteScope";
import { requireCurrentExecution } from "./spectraRunLifecycle";
import { mergeUiObserverInterest } from "./spectraUiObservation";
import { vUiObserverInterest } from "./spectraUiObservationSchema";
import {
  PREFERENCE_SCHEMA_VERSION,
  mergePreferenceValues,
  preferenceLayerValuesSchema,
} from "../src/features/spectra/settings/schema/preferences";
import { isPermissionCategory, type PermissionCategory } from "../src/features/spectra/settings/schema/ai-permissions";
import { applicationApprovalCategory } from "../shared/ai-application-approval";

/*
 * Durable state for the AI harness (src/features/spectra/ai/harness): the
 * loop checkpoint at each tool boundary, the operation behind each writing
 * tool call, the open question or approval, the user's answer, and messages
 * the user sends while a run works.
 *
 * Approvals are verified here, from the answer the user gave to the exact
 * operation recorded for that tool call. The AI cannot answer for the user,
 * and only the user's answer can add an "Always allow" choice.
 */

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};

const ACTIVE = new Set(["queued", "running", "awaiting_confirmation", "awaiting_resolution"]);

async function ownedRun(ctx: QueryCtx | MutationCtx, runId: Id<"spectraAiRuns">) {
  const actor = await getAuthenticatedActor(ctx);
  const run = await ctx.db.get(runId);
  if (!actor || !run || run.ownerAccountId !== actor._id || run.schoolId !== actor.schoolId)
    throw new Error("AI run not found");
  return { actor, run };
}

async function stateRow(ctx: QueryCtx | MutationCtx, runId: Id<"spectraAiRuns">) {
  return ctx.db
    .query("spectraHarnessStates")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .unique();
}

/** The operations recorded for one tool call. */
function operationIdsFor(row: Doc<"spectraHarnessStates"> | null, toolCallId: string) {
  const entry = record(row?.toolOperations)[toolCallId];
  return (Array.isArray(entry) ? entry : typeof entry === "string" ? [entry] : []).filter(
    (id): id is string => typeof id === "string",
  );
}

export const load = query({
  args: { runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    await ownedRun(ctx, args.runId);
    const row = await stateRow(ctx, args.runId);
    if (!row) return null;
    return {
      executionId: row.executionId,
      state: row.state,
      toolOperations: row.toolOperations ?? {},
      pending: row.pending ?? null,
      answer: row.answer ?? null,
      updatedAt: row.updatedAt,
    };
  },
});

/**
 * The checkpoint at a tool boundary: about one write per tool call. Returns
 * (and clears) the messages the user sent meanwhile; they join the next turn.
 */
export const saveCheckpoint = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    state: v.any(),
    toolOperations: v.optional(v.any()),
    pending: v.optional(v.any()),
    clearPending: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { actor, run } = await ownedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    const now = Date.now();
    const row = await stateRow(ctx, args.runId);
    const steers = row?.executionId === args.executionId ? (row.steers ?? []) : [];
    const patch = {
      executionId: args.executionId,
      state: args.state,
      ...(args.toolOperations !== undefined
        ? { toolOperations: args.toolOperations }
        : row && row.executionId !== args.executionId
          ? { toolOperations: {} }
          : {}),
      ...(args.pending !== undefined ? { pending: args.pending, answer: undefined } : {}),
      ...(args.clearPending ? { pending: undefined, answer: undefined } : {}),
      steers: [],
      updatedAt: now,
    };
    if (row) await ctx.db.patch(row._id, patch);
    else
      await ctx.db.insert("spectraHarnessStates", {
        runId: args.runId,
        ownerAccountId: actor._id,
        ...patch,
      });
    return {
      steers: steers.map((steer) => ({ text: steer.text, ...(steer.attachmentIds?.length ? { attachmentIds: steer.attachmentIds } : {}) })),
      active: ACTIVE.has(run.status),
    };
  },
});

/** Record the operation(s) a tool call will perform, before it runs or asks. */
export const recordToolOperations = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    toolCallId: v.string(),
    operationIds: v.array(v.id("spectraOperations")),
  },
  handler: async (ctx, args) => {
    const { actor, run } = await ownedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    const row = await stateRow(ctx, args.runId);
    // A retry is a new attempt: operations of the previous one never carry over.
    const current = row?.executionId === args.executionId ? record(row?.toolOperations) : {};
    const toolOperations = { ...current, [args.toolCallId]: args.operationIds };
    if (row) await ctx.db.patch(row._id, { executionId: args.executionId, toolOperations, updatedAt: Date.now() });
    else
      await ctx.db.insert("spectraHarnessStates", {
        runId: args.runId,
        ownerAccountId: actor._id,
        executionId: args.executionId,
        state: null,
        toolOperations,
        updatedAt: Date.now(),
      });
    return null;
  },
});

/**
 * A message the user sent while the run works or waits, with any files they
 * attached (already stored as this attempt's run attachments). It joins the
 * next turn.
 */
export const queueSteer = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    text: v.string(),
    attachmentIds: v.optional(v.array(v.id("spectraRunAttachments"))),
  },
  handler: async (ctx, args) => {
    const { actor, run } = await ownedRun(ctx, args.runId);
    const text = args.text.trim().slice(0, 8_000);
    const attachmentIds = [...new Set(args.attachmentIds ?? [])].slice(0, 4);
    if (!text && !attachmentIds.length) throw new Error("HARNESS_STEER_EMPTY: Write a message first.");
    for (const id of attachmentIds) {
      const attachment = await ctx.db.get(id);
      if (!attachment || attachment.runId !== run._id || attachment.executionId !== args.executionId || attachment.ownerAccountId !== actor._id)
        throw new Error("HARNESS_STEER_ATTACHMENT_INVALID: That file belongs to another request. Attach it again.");
    }
    if (run.executionId !== args.executionId || (run.status !== "running" && run.status !== "queued"))
      throw new Error("HARNESS_RUN_NOT_ACTIVE: This response has already finished. Send it as a new message.");
    const row = await stateRow(ctx, args.runId);
    if (!row || row.executionId !== args.executionId)
      throw new Error("HARNESS_RUN_NOT_ACTIVE: This response has already finished. Send it as a new message.");
    await ctx.db.patch(row._id, {
      steers: [...(row.steers ?? []), { text, ...(attachmentIds.length ? { attachmentIds } : {}), createdAt: Date.now() }].slice(-10),
      updatedAt: Date.now(),
    });
    return { queued: true, threadId: run.threadId ?? null };
  },
});

/**
 * The run a new message joins instead of starting another: the named run, or
 * the thread's most recent active run. A paused run reports its open
 * question or approval, so the message can answer it. One read, so joining
 * costs no more than the check it replaces.
 */
export const joinableRun = query({
  args: { runId: v.optional(v.id("spectraAiRuns")), threadId: v.optional(v.id("spectraThreads")) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) return null;
    let run: Doc<"spectraAiRuns"> | null = null;
    if (args.runId) {
      run = await ctx.db.get(args.runId);
    } else if (args.threadId) {
      const threadId = args.threadId;
      run =
        (
          await ctx.db
            .query("spectraAiRuns")
            .withIndex("by_thread", (q) => q.eq("threadId", threadId))
            .order("desc")
            .take(20)
        )
          .filter((candidate) => ACTIVE.has(candidate.status))
          .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
    }
    if (!run || run.ownerAccountId !== actor._id || run.schoolId !== actor.schoolId) return null;
    if (!ACTIVE.has(run.status) || !run.executionId) return null;
    const row = await stateRow(ctx, run._id);
    const pending = row && row.executionId === run.executionId && !row.answer ? record(row.pending) : {};
    const waiting = run.status === "awaiting_resolution" || run.status === "awaiting_confirmation";
    // A waiting run without its open question cannot take an answer here.
    if (waiting && typeof pending.toolCallId !== "string") return null;
    return {
      runId: run._id,
      executionId: run.executionId,
      threadId: run.threadId ?? null,
      status: run.status,
      pending: waiting
        ? { toolCallId: String(pending.toolCallId), kind: pending.kind === "approval" ? ("approval" as const) : ("question" as const) }
        : null,
    };
  },
});

/** The category a recorded operation asks under, decided by the server. */
function operationCategory(operation: Doc<"spectraOperations">): PermissionCategory | null {
  if (operation.type !== "app.command") return "permanent_delete";
  const input = record(operation.input);
  return applicationApprovalCategory(String(input.command), record(input.args));
}

/** The user's stored choice: full control, or "Always allow" this category, unless they set it to Never. */
async function storedAllows(ctx: QueryCtx | MutationCtx, accountId: Id<"accounts">, category: PermissionCategory) {
  const layer = await ctx.db
    .query("accountPreferences")
    .withIndex("by_account_scope_key", (q) =>
      q.eq("accountId", accountId).eq("scope", "account").eq("scopeKey", "account"),
    )
    .unique();
  const ai = record(record(layer?.values).ai);
  if (Array.isArray(ai.permissionDeny) && ai.permissionDeny.includes(category)) return false;
  if (ai.permissionFullControl === true) return true;
  return Array.isArray(ai.permissionAllow) && ai.permissionAllow.includes(category);
}

async function addAlwaysAllow(ctx: MutationCtx, accountId: Id<"accounts">, category: string) {
  if (!isPermissionCategory(category)) return;
  const existing = await ctx.db
    .query("accountPreferences")
    .withIndex("by_account_scope_key", (q) =>
      q.eq("accountId", accountId).eq("scope", "account").eq("scopeKey", "account"),
    )
    .unique();
  const ai = record(record(existing?.values).ai);
  const allow = Array.isArray(ai.permissionAllow) ? ai.permissionAllow.filter(isPermissionCategory) : [];
  const deny = Array.isArray(ai.permissionDeny) ? ai.permissionDeny.filter(isPermissionCategory) : [];
  if (allow.includes(category) && !deny.includes(category)) return;
  // Choosing "Always allow" on an approval replaces an earlier Never.
  const values = preferenceLayerValuesSchema.parse(
    mergePreferenceValues(existing?.values ?? {}, {
      ai: {
        permissionAllow: allow.includes(category) ? allow : [...allow, category],
        permissionDeny: deny.filter((entry) => entry !== category),
      },
    }),
  );
  const now = Date.now();
  if (existing)
    await ctx.db.patch(existing._id, { values, schemaVersion: PREFERENCE_SCHEMA_VERSION, updatedAt: now });
  else
    await ctx.db.insert("accountPreferences", {
      accountId,
      scope: "account",
      scopeKey: "account",
      values,
      schemaVersion: PREFERENCE_SCHEMA_VERSION,
      updatedAt: now,
    });
}

/**
 * The user's answer to the open question or approval. An approval is bound
 * to the exact operations recorded for that tool call; their presented scope
 * must still match, exactly as for a confirmation. The run is re-queued so a
 * worker can resume it from the checkpoint.
 */
export const answer = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    toolCallId: v.string(),
    answer: v.union(
      v.object({
        kind: v.literal("question"),
        choiceKey: v.optional(v.string()),
        text: v.optional(v.string()),
      }),
      v.object({
        kind: v.literal("approval"),
        allowed: v.boolean(),
        alwaysAllow: v.optional(v.boolean()),
      }),
    ),
    /** The open client watches a settings change land in its own UI. */
    uiObserver: v.optional(vUiObserverInterest),
  },
  handler: async (ctx, args) => {
    const { actor, run } = await ownedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    const row = await stateRow(ctx, args.runId);
    const pending = record(row?.pending);
    if (!row || row.executionId !== args.executionId || pending.toolCallId !== args.toolCallId)
      throw new Error("HARNESS_INPUT_CHANGED: This question was already answered in another view.");
    if (row.answer) return { alreadyAnswered: true };
    if (pending.kind !== args.answer.kind)
      throw new Error("HARNESS_INPUT_CHANGED: This question changed. Refresh and answer again.");
    const now = Date.now();
    if (args.answer.kind === "question") {
      if (run.status !== "awaiting_resolution")
        throw new Error("HARNESS_INPUT_CHANGED: This question was already answered in another view.");
      const given = args.answer;
      const options = Array.isArray(pending.options) ? pending.options.map(record) : [];
      const chosen = given.choiceKey ? options.find((option) => option.key === given.choiceKey) : undefined;
      if (given.choiceKey && !chosen)
        throw new Error("HARNESS_INPUT_CHANGED: That option is no longer offered. Refresh and answer again.");
      const text = given.text?.trim().slice(0, 2_000);
      if (!chosen && !text) throw new Error("HARNESS_ANSWER_EMPTY: Choose an option or write an answer.");
      await ctx.db.patch(row._id, {
        answer: {
          kind: "question",
          ...(chosen ? { choiceKey: String(chosen.key), choiceLabel: String(chosen.label ?? "") } : {}),
          ...(text ? { text } : {}),
        },
        updatedAt: now,
      });
      await ctx.db.patch(run._id, {
        status: "queued",
        outcome: "proposed",
        phase: "applying",
        workerId: undefined,
        leaseExpiresAt: undefined,
        heartbeatAt: now,
        updatedAt: now,
      });
      return { alreadyAnswered: false, label: text || String(chosen?.label ?? "") };
    }
    const approvalOpen =
      run.status === "awaiting_confirmation" ||
      (run.status === "running" && run.approval?.status === "pending" && run.approval.executionId === args.executionId);
    if (!approvalOpen) throw new Error("HARNESS_INPUT_CHANGED: This approval was already handled in another view.");
    const operations = (
      await Promise.all(
        operationIdsFor(row, args.toolCallId).map(async (id) => {
          const normalized = ctx.db.normalizeId("spectraOperations", id);
          return normalized ? await ctx.db.get(normalized) : null;
        }),
      )
    ).filter((operation): operation is Doc<"spectraOperations"> => Boolean(operation));
    for (const operation of operations) {
      if (operation.runId !== run._id || operation.executionId !== args.executionId || operation.status !== "proposed")
        throw new Error("HARNESS_INPUT_CHANGED: This approval was already handled in another view.");
      const output = record(operation.output);
      if (!args.answer.allowed) {
        await ctx.db.patch(operation._id, { status: "cancelled" });
        continue;
      }
      if (operation.type === "app.command") {
        const scope = await applicationApprovalScope(ctx, operation, run);
        if (output.pendingApplicationScope !== scope)
          throw new Error("AI_APPLICATION_APPROVAL_SCOPE_CHANGED: The proposed targets changed. Ask Spectra to prepare a new approval.");
        await ctx.db.patch(operation._id, { output: { ...output, approvedApplicationScope: scope } });
      } else if (operation.type === "artifact.update" || operation.type === "artifact.create" || operation.type === "artifact.archive") {
        const { digest } = await currentArtifactApprovalScope(ctx, operation, run);
        if (output.pendingArtifactScope !== digest)
          throw new Error("AI_ARTIFACT_APPROVAL_SCOPE_CHANGED: The proposed edit changed. Ask Spectra to prepare a new approval.");
        await ctx.db.patch(operation._id, { output: { ...output, approvedArtifactScope: digest } });
      }
    }
    if (args.answer.allowed && args.answer.alwaysAllow && typeof pending.category === "string")
      await addAlwaysAllow(ctx, actor._id, pending.category);
    await ctx.db.patch(row._id, {
      answer: { kind: "approval", allowed: args.answer.allowed, ...(args.answer.alwaysAllow ? { alwaysAllow: true } : {}) },
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "queued",
      outcome: "proposed",
      phase: "applying",
      approval: run.approval
        ? { ...run.approval, status: args.answer.allowed ? "accepted" : "rejected", claimedAt: now, decidedAt: now }
        : undefined,
      ...(args.uiObserver && args.answer.allowed
        ? { uiObserverInterests: mergeUiObserverInterest(run, args.executionId, args.uiObserver) }
        : {}),
      workerId: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: now,
      updatedAt: now,
    });
    return { alreadyAnswered: false, label: args.answer.allowed ? "Allowed" : "Not allowed" };
  },
});

/**
 * Make sure the operations of one tool call are approved: by the user's
 * answer to this call, or else by their stored choice ("Always allow" or full
 * control), verified here rather than trusted from the worker. Throws
 * AI_PERMISSION_REQUIRED when the user must be asked.
 */
export const ensureApproved = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    toolCallId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, run } = await ownedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    if (run.status !== "running") throw new Error("AI_APPLICATION_OPERATION_NOT_ACTIVE");
    const row = await stateRow(ctx, args.runId);
    const ids = operationIdsFor(row, args.toolCallId);
    if (!ids.length) throw new Error("AI_PERMISSION_REQUIRED: Nothing was recorded for this step.");
    const now = Date.now();
    let grantedByPreference = false;
    for (const id of ids) {
      const operationId = ctx.db.normalizeId("spectraOperations", id);
      const operation = operationId ? await ctx.db.get(operationId) : null;
      if (!operation || operation.runId !== run._id || operation.executionId !== args.executionId || operation.status !== "proposed")
        throw new Error("AI_PERMISSION_REQUIRED: This step changed.");
      // Ordinary writes need no approval; only asking effects are checked.
      if (!operation.requiresConfirmation) continue;
      const output = record(operation.output);
      const scope =
        operation.type === "app.command"
          ? await applicationApprovalScope(ctx, operation, run)
          : (await currentArtifactApprovalScope(ctx, operation, run)).digest;
      const approvedByUser =
        run.approval?.status === "accepted" &&
        run.approval.executionId === args.executionId &&
        (output.approvedApplicationScope ?? output.approvedArtifactScope) === scope;
      if (approvedByUser) continue;
      const category = operationCategory(operation);
      if (!category || !(await storedAllows(ctx, actor._id, category)))
        throw new Error("AI_PERMISSION_REQUIRED: Ask the user first.");
      if (operation.type === "app.command") {
        await ctx.db.patch(operation._id, { output: { ...output, pendingApplicationScope: scope, approvedApplicationScope: scope } });
      } else {
        await ctx.db.patch(operation._id, { output: { ...output, pendingArtifactScope: scope, approvedArtifactScope: scope } });
      }
      grantedByPreference = true;
    }
    if (!grantedByPreference) return null;
    await ctx.db.patch(run._id, {
      approval: {
        executionId: args.executionId,
        status: "accepted",
        reasons: ["Allowed by your Spectra permission settings"],
        requestedAt: now,
        claimedAt: now,
        decidedAt: now,
      },
      updatedAt: now,
    });
    return null;
  },
});

/**
 * Hand a long run to a fresh worker. A serverless route has a time limit; the
 * loop stops at a tool boundary after its checkpoint, and the next worker
 * resumes from that checkpoint in the same attempt.
 */
export const handoff = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    resultCardId: v.id("spectraResultCards"),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const { actor, run } = await ownedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    if (run.status !== "running") return { handedOff: false };
    const card = await ctx.db.get(args.resultCardId);
    if (!card || card.runId !== args.runId) throw new Error("Result card not found");
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "queued",
      workerId: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.executionScheduler.dispatchSpectraRun, {
      actorClerkId: actor.clerkId,
      runId: args.runId,
      resultCardId: args.resultCardId,
      executionId: args.executionId,
      payload: args.payload,
    });
    return { handedOff: true };
  },
});
