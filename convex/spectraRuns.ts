import { query } from "./_generated/server";
import { internalMutation, mutation } from "./orgNodeMutation";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";
import {
  ensureThreadWorkspacePlacement,
  requireArtifactCapability,
} from "./spectraShared";
import {
  canTransitionRunStatus,
  interruptionRecovery,
  isActiveRunStatus,
  isTerminalRunStatus,
  requireCurrentExecution,
} from "./spectraRunLifecycle";
import {
  findPrimaryNode,
  syncArtifactSummary,
  syncSourceNodes,
} from "./orgTreeShared";
import { releaseClaimsForRun } from "./regionClaims";
import { incrementOperationalCounter } from "./operationalCounters";
import { recordAgentInvocation, settleAgentInvocation } from "./agents";
import { recordMeterEvent } from "./metering";
import { writeAuditEvent } from "./auditShared";
import {
  projectRunTabSummary,
  RUN_TAB_PROJECTION_VERSION,
} from "./spectraRunProjection";

function usageTokenCounts(usage: unknown) {
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
  return {
    inputTokens: Math.max(0, Math.round(inputTokens)),
    outputTokens: Math.max(0, Math.round(outputTokens)),
  };
}

async function recordRunModelMeters(
  ctx: MutationCtx,
  run: Doc<"spectraAiRuns">,
  usage: unknown,
  occurredAt: number,
) {
  const { inputTokens, outputTokens } = usageTokenCounts(usage);
  if (inputTokens <= 0 && outputTokens <= 0) return;
  const dimensions = {
    surface: run.sourceSurface,
    status: run.status,
  };
  if (inputTokens > 0) {
    await recordMeterEvent(ctx, {
      schoolId: run.schoolId,
      accountId: run.ownerAccountId,
      category: "model_input_tokens",
      quantity: inputTokens,
      sourceType: "spectra_run",
      sourceId: String(run._id),
      idempotencyKey: `spectra-run:${run._id}:${run.executionId}:model_input_tokens`,
      dimensions,
      occurredAt,
    });
  }
  if (outputTokens > 0) {
    await recordMeterEvent(ctx, {
      schoolId: run.schoolId,
      accountId: run.ownerAccountId,
      category: "model_output_tokens",
      quantity: outputTokens,
      sourceType: "spectra_run",
      sourceId: String(run._id),
      idempotencyKey: `spectra-run:${run._id}:${run.executionId}:model_output_tokens`,
      dimensions,
      occurredAt,
    });
  }
}

const vSurface = v.union(
  v.literal("chat"),
  v.literal("workspace"),
  v.literal("artifact"),
);
const vRunStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("awaiting_confirmation"),
  v.literal("awaiting_resolution"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);
const vResultVariant = v.union(
  v.literal("status"),
  v.literal("artifact"),
  v.literal("thread"),
  v.literal("operation"),
  v.literal("error"),
);
const vRunPhase = v.union(
  v.literal("created"),
  v.literal("preparing"),
  v.literal("planning"),
  v.literal("reading"),
  v.literal("retrieving"),
  v.literal("creating"),
  v.literal("updating"),
  v.literal("applying"),
  v.literal("streaming"),
  v.literal("checking"),
  v.literal("approval"),
  v.literal("conflict"),
  v.literal("completed"),
  v.literal("stopped"),
  v.literal("interrupted"),
  v.literal("partial"),
  v.literal("failed"),
);
const vResultAction = v.object({
  key: v.string(),
  label: v.string(),
  targetType: v.optional(
    v.union(
      v.literal("artifact"),
      v.literal("thread"),
      v.literal("run"),
      v.literal("workspace"),
    ),
  ),
  targetId: v.optional(v.string()),
});

function eventStep(type: string, payload: unknown) {
  if (!["progress", "checkpoint", "operation_result"].includes(type))
    return undefined;
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const item =
    record.runItem && typeof record.runItem === "object"
      ? (record.runItem as Record<string, unknown>)
      : {};
  const itemPayload =
    item.payload && typeof item.payload === "object"
      ? (item.payload as Record<string, unknown>)
      : {};
  const checkpoint =
    itemPayload.checkpoint && typeof itemPayload.checkpoint === "object"
      ? (itemPayload.checkpoint as Record<string, unknown>)
      : {};
  const value =
    typeof checkpoint.summary === "string"
      ? checkpoint.summary
      : typeof record.detail === "string"
        ? record.detail
        : typeof record.title === "string"
          ? record.title
          : typeof record.message === "string"
            ? record.message
            : undefined;
  return value?.trim() || undefined;
}

function collapseDockSteps(values: readonly string[]) {
  return values.reduce<string[]>((steps, value) => {
    const previous = steps.at(-1);
    if (!previous) return [value];
    if (previous === value) return steps;
    const prior = previous.toLocaleLowerCase();
    const next = value.toLocaleLowerCase();
    if (prior.startsWith(next) || next.startsWith(prior))
      return [...steps.slice(0, -1), value.length >= previous.length ? value : previous];
    return [...steps, value];
  }, []).slice(-8);
}

function dockSummaryAfterEvents(
  run: Doc<"spectraAiRuns">,
  events: readonly { type: string; payload: unknown }[],
) {
  const steps = events.flatMap((event) => {
    const value = eventStep(event.type, event.payload);
    return value ? [value] : [];
  });
  if (!steps.length) return run.dockSummary;
  const recentSteps = collapseDockSteps([
    ...(run.dockSummary?.recentSteps ?? []),
    ...steps,
  ]);
  return {
    ...(run.dockSummary ?? {}),
    checkpointSummary: recentSteps.at(-1),
    recentSteps,
  };
}

function operationTargetIds(
  operations: readonly Doc<"spectraOperations">[],
) {
  const artifactIds = new Set<string>();
  const workspaceIds = new Set<string>();
  for (const operation of operations) {
    if (operation.pendingArtifactId)
      artifactIds.add(String(operation.pendingArtifactId));
    if (operation.pendingWorkspaceId)
      workspaceIds.add(String(operation.pendingWorkspaceId));
    if (operation.conflict?.artifactId)
      artifactIds.add(String(operation.conflict.artifactId));
    for (const affected of operation.affected) {
      if (affected.type === "artifact") artifactIds.add(affected.id);
      if (affected.type === "workspace") workspaceIds.add(affected.id);
    }
  }
  return { artifactIds, workspaceIds };
}

async function requireActor(ctx: Parameters<typeof getAuthenticatedActor>[0]) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor)
    throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

async function requireOwnedRun(
  ctx: Parameters<typeof getAuthenticatedActor>[0],
  runId: Id<"spectraAiRuns">,
) {
  const actor = await requireActor(ctx);
  const run = await ctx.db.get(runId);
  if (
    !run ||
    run.ownerAccountId !== actor._id ||
    run.schoolId !== actor.schoolId
  ) {
    throw new Error("AI run not found");
  }
  return { actor, run };
}

const ATTACHMENT_RETRY_MESSAGE =
  "Attached files are not retained for retry. Reattach them and start a new run.";

function messageHasAttachmentInput(message: Doc<"spectraMessages">) {
  if (message.role !== "user" || !message.metadata) return false;
  const metadata =
    typeof message.metadata === "object" && !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>)
      : undefined;
  return Array.isArray(metadata?.attachments) && metadata.attachments.length > 0;
}

async function runHasAttachmentInput(
  ctx: Parameters<typeof getAuthenticatedActor>[0],
  runId: Id<"spectraAiRuns">,
) {
  const messages = await ctx.db
    .query("spectraMessages")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .collect();
  return messages.some(messageHasAttachmentInput);
}

function recoveryForRun(
  operationStatuses: Parameters<typeof interruptionRecovery>[0],
  hasPartialResponse: boolean,
  hasAttachmentInput: boolean,
) {
  const recovery = interruptionRecovery(
    operationStatuses,
    hasPartialResponse,
  );
  return hasAttachmentInput ? { ...recovery, retryable: false } : recovery;
}

export const beginRun = mutation({
  args: {
    sourceSurface: vSurface,
    userPrompt: v.string(),
    submissionKey: v.string(),
    threadId: v.optional(v.id("spectraThreads")),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    modelUsed: v.optional(v.string()),
    messageMetadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const cleanPrompt = args.userPrompt
      .replace(/\u0000/g, "")
      .trim()
      .slice(0, 12_000);
    if (!cleanPrompt) throw new Error("Write a message before starting a run.");
    const existingRun = await ctx.db
      .query("spectraAiRuns")
      .withIndex("by_account_submission", (q) =>
        q
          .eq("ownerAccountId", actor._id)
          .eq("submissionKey", args.submissionKey),
      )
      .first();
    if (existingRun) {
      const existingCard = await ctx.db
        .query("spectraResultCards")
        .withIndex("by_run", (q) => q.eq("runId", existingRun._id))
        .first();
      if (!existingRun.threadId || !existingCard)
        throw new Error(
          "This request could not be restored safely. Start it again.",
        );
      return {
        runId: existingRun._id,
        resultCardId: existingCard._id,
        threadId: existingRun.threadId,
        executionId: existingRun.executionId ?? "legacy",
        created: false,
      };
    }

    let thread = args.threadId ? await ctx.db.get(args.threadId) : null;
    if (
      args.threadId &&
      (!thread ||
        thread.ownerAccountId !== actor._id ||
        thread.schoolId !== actor.schoolId ||
        thread.status !== "active")
    )
      throw new Error("That conversation is no longer available.");
    // Continuing a thread is an explicit request to keep working with its
    // primary artifact. The caller may have no open studio on the new surface
    // (for example after opening a Dock tab in quick chat), so recover that
    // target from the durable thread binding instead of dropping it.
    let effectiveArtifactId = args.artifactId ?? thread?.artifactId;
    if (!effectiveArtifactId && thread) {
      const derivedArtifact = (
        await ctx.db
          .query("spectraArtifacts")
          .withIndex("by_created_thread", (q) =>
            q.eq("createdFrom.threadId", thread!._id),
          )
          .order("desc")
          .take(12)
      ).find(
        (artifact) =>
          artifact.ownerAccountId === actor._id && artifact.status !== "deleted",
      );
      if (derivedArtifact) {
        effectiveArtifactId = derivedArtifact._id;
        // Opportunistically migrate older create threads so every later
        // continuation takes the direct, indexed path.
        await ctx.db.patch(thread._id, {
          artifactId: derivedArtifact._id,
          updatedAt: Date.now(),
          readSchemaVersion: 1,
        });
        thread = { ...thread, artifactId: derivedArtifact._id };
      }
    }
    let requestedWorkspaceId = args.workspaceId;
    if (!thread && !requestedWorkspaceId && effectiveArtifactId) {
      /* The work lives in exactly one place, so a conversation about it
         starts there rather than guessing between competing rows. */
      const node = await findPrimaryNode(
        ctx,
        actor._id,
        "work",
        effectiveArtifactId,
      );
      const context =
        node && node.deletedAt === undefined
          ? node.workspaceContextId
          : undefined;
      const workspace = context ? await ctx.db.get(context) : null;
      if (
        workspace &&
        workspace.ownerAccountId === actor._id &&
        workspace.schoolId === actor.schoolId &&
        workspace.status === "active"
      )
        requestedWorkspaceId = workspace._id;
    }
    if (requestedWorkspaceId) {
      const workspace = await ctx.db.get(requestedWorkspaceId);
      if (
        !workspace ||
        workspace.ownerAccountId !== actor._id ||
        workspace.schoolId !== actor.schoolId ||
        workspace.status !== "active"
      )
        throw new Error("That workspace is no longer available.");
    }
    if (effectiveArtifactId) {
      // A directly shared artifact is a legitimate AI context even when its
      // owner belongs to another school. Keep the run/thread private in the
      // actor's school, but authorize the artifact through the same audited
      // capability graph as the editor. Mutation execution independently
      // requires `modify`, so read-only collaborators can ask grounded
      // questions without gaining write authority.
      const { artifact } = await requireArtifactCapability(
        ctx,
        effectiveArtifactId,
        "read",
      );
      if (artifact.status === "deleted")
        throw new Error("That artifact is no longer available.");
    }
    if (thread) {
      const activeRun = (
        await ctx.db
          .query("spectraAiRuns")
          .withIndex("by_thread", (q) => q.eq("threadId", thread!._id))
          .collect()
      ).find((run) => isActiveRunStatus(run.status));
      if (activeRun)
        throw new Error(
          "This conversation is still responding. Start a new thread to work in parallel, or wait for it to finish.",
        );
      if (
        thread.workspaceId &&
        requestedWorkspaceId &&
        thread.workspaceId !== requestedWorkspaceId
      )
        throw new Error(
          "This conversation belongs to another workspace. Open it there, or start a new thread in this workspace.",
        );
    }

    const now = Date.now();
    // A neutral status label is replaced by the first structured model title.
    // Never fabricate a prompt-truncation title before the model responds.
    const title = "New conversation";
    const workspaceId = thread ? thread.workspaceId : requestedWorkspaceId;
    let threadId = thread?._id;
    if (!threadId) {
      threadId = await ctx.db.insert("spectraThreads", {
        ownerAccountId: actor._id,
        schoolId: actor.schoolId,
        title,
        origin: args.sourceSurface,
        workspaceId,
        artifactId: effectiveArtifactId,
        status: "active",
        messageCount: 0,
        readSchemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      thread = await ctx.db.get(threadId);
    }
    const nodeId = await ensureThreadWorkspacePlacement(ctx, {
      threadId,
      ownerAccountId: actor._id,
      workspaceId,
      summary: "Conversation in progress",
      // A conversation belongs in its workspace immediately, but ordinary
      // creation must not silently promote it to the user's important shelf.
      // Pinning is an explicit organizational choice.
      pinned: false,
    });
    const executionId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      sourceSurface: args.sourceSurface,
      threadId,
      workspaceId,
      artifactId: effectiveArtifactId,
      status: "queued",
      userPrompt: cleanPrompt,
      modelUsed: args.modelUsed,
      submissionKey: args.submissionKey,
      executionId,
      eventSequence: 1,
      leaseExpiresAt: now + 2 * 60_000,
      phase: "created",
      heartbeatAt: now,
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const createdRun = await ctx.db.get(runId);
    if (!createdRun) throw new Error("AI run could not be created");
    const runSummary = projectRunTabSummary(createdRun);
    const resultCardId = await ctx.db.insert("spectraResultCards", {
      runId,
      surface: args.sourceSurface,
      workspaceId,
      artifactId: effectiveArtifactId,
      status: "queued",
      variant: "status",
      title: "Queued",
      summary: "Spectra is preparing this run.",
      actions: [],
      provenance: {
        threadId,
        workspaceId,
        artifactIds: effectiveArtifactId ? [effectiveArtifactId] : [],
        focusMode: effectiveArtifactId
          ? "artifact"
          : workspaceId
            ? "workspace"
            : "global",
      },
      createdAt: now,
      updatedAt: now,
    });
    const currentMessageCount =
      thread?.messageCount ??
      (await ctx.db
        .query("spectraMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect()).length;
    await ctx.db.insert("spectraMessages", {
      threadId,
      schoolId: actor.schoolId,
      role: "user",
      content: cleanPrompt,
      runId,
      clientMessageId: `user:${runId}`,
      metadata: args.messageMetadata,
      createdAt: now,
      ordinal: currentMessageCount + 1,
    });
    await ctx.db.patch(threadId, {
      messageCount: (thread?.messageCount ?? 0) + 1,
      messageCount: currentMessageCount + 1,
      previewText: cleanPrompt.replace(/\s+/g, " ").trim().slice(0, 240),
      contextWorkspaceIds: workspaceId
        ? [...new Set([...(thread?.contextWorkspaceIds ?? []), workspaceId])].slice(-8)
        : thread?.contextWorkspaceIds,
      contextArtifactIds: effectiveArtifactId
        ? [...new Set([...(thread?.contextArtifactIds ?? []), effectiveArtifactId])].slice(-8)
        : thread?.contextArtifactIds,
      readSchemaVersion: 1,
      lastMessageAt: now,
      lastRunId: runId,
      updatedAt: now,
    });
    if (workspaceId) {
      await ctx.db.patch(workspaceId, { updatedAt: now, lastActivityAt: now });
    }
    const openTabs = await ctx.db
      .query("spectraRunTabs")
      .withIndex("by_account_updated", (q) => q.eq("ownerAccountId", actor._id))
      .collect();
    await Promise.all(
      openTabs
        .filter(
          (tab) =>
            tab.schoolId === actor.schoolId && !tab.hiddenAt && tab.selected,
        )
        .map((tab) =>
          ctx.db.patch(tab._id, { selected: false, updatedAt: now }),
        ),
    );
    const threadTabs = openTabs
      .filter(
        (tab) => tab.schoolId === actor.schoolId && tab.threadId === threadId,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const canonicalTab = threadTabs[0];
    if (canonicalTab) {
      await ctx.db.patch(canonicalTab._id, {
        runId,
        workspaceId,
        surface: args.sourceSurface,
        selected: true,
        hiddenAt: undefined,
        projectionVersion: RUN_TAB_PROJECTION_VERSION,
        threadTitle: thread?.title ?? title,
        runSummary,
        updatedAt: now,
      });
      await Promise.all(
        threadTabs.slice(1).map((tab) =>
          ctx.db.patch(tab._id, {
            selected: false,
            hiddenAt: now,
            updatedAt: now,
          }),
        ),
      );
    } else {
      await ctx.db.insert("spectraRunTabs", {
        ownerAccountId: actor._id,
        schoolId: actor.schoolId,
        runId,
        threadId,
        workspaceId,
        surface: args.sourceSurface,
        selected: true,
        projectionVersion: RUN_TAB_PROJECTION_VERSION,
        threadTitle: thread?.title ?? title,
        runSummary,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.insert("spectraRunEvents", {
      runId,
      executionId,
      sequence: 1,
      type: "run_created",
      payload: { threadId, resultCardId, nodeId, title },
      createdAt: now,
    });
    await incrementOperationalCounter(ctx, {
      schoolId: actor.schoolId,
      category: "ai_run_started",
      dimension: args.sourceSurface,
      occurredAt: now,
    });
    await incrementOperationalCounter(ctx, {
      schoolId: actor.schoolId,
      category: "thread_message",
      dimension: "user",
      occurredAt: now,
    });
    return {
      runId,
      resultCardId,
      threadId,
      executionId,
      nodeId,
      created: true,
    };
  },
});

export const recordAuthorityDecision = mutation({
  args: {
    runId: v.optional(v.id("spectraAiRuns")),
    executionId: v.optional(v.string()),
    command: v.string(),
    decision: v.string(),
    target: v.string(),
    reason: v.string(),
    consequence: v.optional(v.string()),
    localFileCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (!run || run.ownerAccountId !== actor._id)
        throw new Error("AI run not found");
    }
    const eventId = await writeAuditEvent(ctx, {
      actorAccountId: actor._id,
      schoolId: actor.schoolId,
      action: `ai.authority.${args.decision.slice(0, 40)}`,
      targetType: "ai_run",
      targetId: args.runId ? String(args.runId) : args.command.slice(0, 80),
      metadata: {
        command: args.command.slice(0, 80),
        decision: args.decision.slice(0, 40),
        target: args.target.slice(0, 40),
        reason: args.reason.slice(0, 240),
        consequence: args.consequence?.slice(0, 240) ?? null,
        localFileCount:
          typeof args.localFileCount === "number"
            ? Math.max(0, Math.floor(args.localFileCount))
            : null,
        executionId: args.executionId?.slice(0, 80) ?? null,
      },
      retentionClass: "operational",
    });
    return { eventId };
  },
});

export const resolveBySubmissionKey = query({
  args: { submissionKey: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const submissionKey = args.submissionKey.trim();
    if (!submissionKey) return null;
    const run = await ctx.db
      .query("spectraAiRuns")
      .withIndex("by_account_submission", (q) =>
        q.eq("ownerAccountId", actor._id).eq("submissionKey", submissionKey),
      )
      .first();
    return run
      ? {
          runId: run._id,
          executionId: run.executionId,
          status: run.status,
        }
      : null;
  },
});

export const scheduleExecution = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    resultCardId: v.id("spectraResultCards"),
    executionId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const { actor, run } = await requireOwnedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    if (run.status !== "queued")
      return { scheduled: false, status: run.status };
    const card = await ctx.db.get(args.resultCardId);
    if (!card || card.runId !== args.runId)
      throw new Error("Result card not found");
    await ctx.scheduler.runAfter(
      0,
      internal.executionScheduler.dispatchSpectraRun,
      {
        actorClerkId: actor.clerkId,
        runId: args.runId,
        resultCardId: args.resultCardId,
        executionId: args.executionId,
        payload: args.payload,
      },
    );
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      heartbeatAt: now,
      updatedAt: now,
    });
    return { scheduled: true, status: run.status };
  },
});

export const updateStatus = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    status: vRunStatus,
    finalSummary: v.optional(v.string()),
    error: v.optional(v.string()),
    resultTitle: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    resultVariant: v.optional(vResultVariant),
    resultActions: v.optional(v.array(vResultAction)),
    modelUsed: v.optional(v.string()),
    providerUsed: v.optional(v.string()),
    usage: v.optional(v.any()),
    decision: v.optional(
      v.union(
        v.literal("answer"),
        v.literal("operate"),
        v.literal("clarify"),
        v.literal("refuse"),
      ),
    ),
    planIntent: v.optional(v.any()),
    provenance: v.optional(v.any()),
    executionId: v.string(),
    phase: v.optional(vRunPhase),
    approvalReasons: v.optional(v.array(v.string())),
    recoveryState: v.optional(
      v.union(v.literal("interrupted"), v.literal("partial")),
    ),
    retryable: v.optional(v.boolean()),
    preservedPartial: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    if (!canTransitionRunStatus(run.status, args.status))
      throw new Error("This run has already moved to a newer state.");
    if (
      args.status === "awaiting_confirmation" &&
      (!args.approvalReasons || args.approvalReasons.length === 0)
    ) {
      throw new Error("Confirmation requires a clear user-facing reason.");
    }
    const now = Date.now();
    const terminal = isTerminalRunStatus(args.status);
    if (
      terminal &&
      !run.agentUsageSettledAt &&
      run.selectedAgentId &&
      run.selectedAgentVersionId
    )
      await settleAgentInvocation(
        ctx,
        run,
        args.status as "completed" | "failed" | "cancelled",
        args.usage ?? run.usage,
        now,
      );
    if (terminal)
      await recordRunModelMeters(ctx, run, args.usage ?? run.usage, now);
    await ctx.db.patch(args.runId, {
      status: args.status,
      phase:
        args.phase ??
        (args.status === "completed"
          ? "completed"
          : args.status === "cancelled"
            ? "stopped"
            : args.status === "failed"
              ? "failed"
              : run.phase),
      finalSummary: args.finalSummary,
      error: args.error,
      updatedAt: now,
      heartbeatAt: now,
      startedAt:
        args.status === "running" ? (run.startedAt ?? now) : run.startedAt,
      completedAt: terminal ? now : run.completedAt,
      modelUsed: args.modelUsed ?? run.modelUsed,
      providerUsed: args.providerUsed ?? run.providerUsed,
      usage: args.usage ?? run.usage,
      decision: args.decision ?? run.decision,
      planIntent: args.planIntent ?? run.planIntent,
      approval:
        args.status === "awaiting_confirmation"
          ? {
              executionId: args.executionId,
              status: "pending",
              reasons: args
                .approvalReasons!.map((reason) =>
                  reason.replace(/\s+/g, " ").trim().slice(0, 240),
                )
                .filter(Boolean)
                .slice(0, 8),
              requestedAt: now,
            }
          : run.approval,
      recoveryState:
        args.status === "completed"
          ? undefined
          : (args.recoveryState ?? run.recoveryState),
      retryable:
        args.status === "completed"
          ? undefined
          : (args.retryable ?? run.retryable),
      preservedPartial:
        args.status === "completed"
          ? undefined
          : (args.preservedPartial ?? run.preservedPartial),
      workerId: terminal ? undefined : run.workerId,
      leaseExpiresAt: terminal ? undefined : run.leaseExpiresAt,
      agentUsageSettledAt:
        terminal && run.selectedAgentId
          ? (run.agentUsageSettledAt ?? now)
          : run.agentUsageSettledAt,
    });

    const cards = await ctx.db
      .query("spectraResultCards")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    await Promise.all(
      cards.map((card) =>
        ctx.db.patch(card._id, {
          status: args.status,
          variant:
            args.resultVariant ??
            (args.status === "failed" ? "error" : card.variant),
          title: args.resultTitle ?? card.title,
          summary:
            args.resultSummary ??
            args.finalSummary ??
            args.error ??
            card.summary,
          actions: args.resultActions ?? card.actions,
          provenance: args.provenance ?? card.provenance,
          updatedAt: now,
        }),
      ),
    );

    if (terminal && run.threadId) {
      const thread = await ctx.db.get(run.threadId);
      if (thread) await syncSourceNodes(ctx, "thread", thread._id, thread.title);
    }
    if (args.status === "failed" && run.status !== "failed")
      await incrementOperationalCounter(ctx, {
        schoolId: run.schoolId,
        category: "ai_run_failed",
        dimension: run.sourceSurface,
        occurredAt: now,
      });

    return { runId: args.runId };
  },
});

export const appendEvent = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    type: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    if (run.executionId !== args.executionId)
      return { ignored: true, sequence: run.eventSequence ?? 0 };
    const terminal = isTerminalRunStatus(run.status);
    const terminalEvent =
      args.type === "final" ||
      args.type === "error" ||
      args.type === "stopped" ||
      args.type === "interrupted" ||
      args.type === "approval_rejected" ||
      args.type === "approval_accepted" ||
      args.type === "choice_selected";
    if (terminal && !terminalEvent)
      return { ignored: true, sequence: run.eventSequence ?? 0 };
    if (terminalEvent) {
      const existing = (
        await ctx.db
          .query("spectraRunEvents")
          .withIndex("by_run_sequence", (q) => q.eq("runId", args.runId))
          .collect()
      ).find(
        (event) =>
          event.executionId === args.executionId && event.type === args.type,
      );
      if (existing) return { ignored: true, sequence: existing.sequence };
    }
    const sequence = (run.eventSequence ?? 0) + 1;
    const now = Date.now();
    await ctx.db.insert("spectraRunEvents", {
      runId: args.runId,
      executionId: args.executionId,
      sequence,
      type: args.type.slice(0, 80),
      payload: args.payload,
      createdAt: now,
    });
    await ctx.db.patch(args.runId, {
      eventSequence: sequence,
      heartbeatAt: now,
      updatedAt: now,
      ...(dockSummaryAfterEvents(run, [{ type: args.type, payload: args.payload }])
        ? { dockSummary: dockSummaryAfterEvents(run, [{ type: args.type, payload: args.payload }]) }
        : {}),
    });
    return { ignored: false, sequence };
  },
});

export const appendEvents = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    events: v.array(v.object({ type: v.string(), payload: v.any() })),
  },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    if (run.executionId !== args.executionId || args.events.length === 0)
      return { ignored: true, sequence: run.eventSequence ?? 0, count: 0 };
    const terminalTypes = new Set([
      "final",
      "error",
      "stopped",
      "interrupted",
      "approval_rejected",
      "approval_accepted",
      "choice_selected",
    ]);
    const batchHasTerminal = args.events.some((event) =>
      terminalTypes.has(event.type),
    );
    const allowed =
      isTerminalRunStatus(run.status) && !batchHasTerminal
        ? args.events.filter((event) => terminalTypes.has(event.type))
        : args.events;
    if (allowed.length === 0)
      return { ignored: true, sequence: run.eventSequence ?? 0, count: 0 };
    const existingTerminalTypes = new Set(
      (
        await ctx.db
          .query("spectraRunEvents")
          .withIndex("by_run_sequence", (q) => q.eq("runId", args.runId))
          .collect()
      )
        .filter(
          (event) =>
            event.executionId === args.executionId &&
            terminalTypes.has(event.type),
        )
        .map((event) => event.type),
    );
    const unique = allowed.filter(
      (event) =>
        !terminalTypes.has(event.type) ||
        !existingTerminalTypes.has(event.type),
    );
    if (unique.length === 0)
      return { ignored: true, sequence: run.eventSequence ?? 0, count: 0 };
    const now = Date.now();
    let sequence = run.eventSequence ?? 0;
    for (const event of unique) {
      sequence += 1;
      await ctx.db.insert("spectraRunEvents", {
        runId: args.runId,
        executionId: args.executionId,
        sequence,
        type: event.type.slice(0, 80),
        payload: event.payload,
        createdAt: now,
      });
    }
    await ctx.db.patch(args.runId, {
      eventSequence: sequence,
      heartbeatAt: now,
      updatedAt: now,
      ...(dockSummaryAfterEvents(run, unique)
        ? { dockSummary: dockSummaryAfterEvents(run, unique) }
        : {}),
    });
    return { ignored: false, sequence, count: unique.length };
  },
});

export const claimExecution = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    workerId: v.string(),
  },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    if (run.status !== "queued" && run.status !== "running")
      throw new Error("This run is no longer available for execution.");
    const now = Date.now();
    if (
      run.workerId &&
      run.workerId !== args.workerId &&
      (run.leaseExpiresAt ?? 0) > now
    ) {
      throw new Error("This run is already owned by another active worker.");
    }
    const workerId = args.workerId
      .replace(/[^a-zA-Z0-9:_-]/g, "")
      .slice(0, 160);
    if (!workerId) throw new Error("Execution worker identity is required.");
    await ctx.db.patch(args.runId, {
      workerId,
      leaseExpiresAt: now + 2 * 60_000,
      heartbeatAt: now,
      phase: run.phase === "created" ? "preparing" : run.phase,
      updatedAt: now,
    });
    return { claimed: true, leaseExpiresAt: now + 2 * 60_000 };
  },
});

export const heartbeat = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    workerId: v.string(),
  },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    if (
      run.executionId !== args.executionId ||
      run.workerId !== args.workerId ||
      (run.status !== "queued" && run.status !== "running")
    )
      return { alive: false };
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      heartbeatAt: now,
      leaseExpiresAt: now + 2 * 60_000,
    });
    return { alive: true };
  },
});

export const markTraceDegraded = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    if (run.executionId !== args.executionId) return { ignored: true };
    const now = Date.now();
    await ctx.db.patch(args.runId, { traceDegraded: true, updatedAt: now });
    const cards = await ctx.db
      .query("spectraResultCards")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    await Promise.all(
      cards.map((card) =>
        ctx.db.patch(card._id, {
          summary: `${card.summary ?? "Run finished."} Some live progress could not be saved.`,
          updatedAt: now,
        }),
      ),
    );
    return { ignored: false };
  },
});

export const listEvents = query({
  args: {
    runId: v.id("spectraAiRuns"),
    after: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnedRun(ctx, args.runId);
    const rows = await ctx.db
      .query("spectraRunEvents")
      .withIndex("by_run_sequence", (q) =>
        q.eq("runId", args.runId).gt("sequence", args.after ?? 0),
      )
      .take(Math.min(args.limit ?? 300, 800));
    return rows.sort((a, b) => a.sequence - b.sequence);
  },
});

export const listTabs = query({
  args: {
    includeHidden: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const tabs = await ctx.db
      .query("spectraRunTabs")
      .withIndex("by_account_updated", (q) => q.eq("ownerAccountId", actor._id))
      .order("desc")
      .take(Math.min(args.limit ?? 80, 200));
    const canonicalByThread = new Map<string, (typeof tabs)[number]>();
    for (const tab of tabs.filter(
      (row) =>
        row.schoolId === actor.schoolId &&
        (args.includeHidden || !row.hiddenAt),
    )) {
      const existing = canonicalByThread.get(tab.threadId);
      if (!existing || tab.updatedAt > existing.updatedAt)
        canonicalByThread.set(tab.threadId, tab);
    }
    return Promise.all(
      [...canonicalByThread.values()].map(async (tab) => {
        const cards = await ctx.db
          .query("spectraResultCards")
          .withIndex("by_run", (q) => q.eq("runId", tab.runId))
          .order("desc")
          .take(1);
        const card = cards[0] ?? null;
        const runSummary = tab.runSummary ?? {
          _id: tab.runId,
          status: card?.status ?? ("completed" as const),
          sourceSurface: tab.surface,
          threadId: tab.threadId,
          workspaceId: tab.workspaceId,
          artifactId: card?.artifactId,
          userPrompt: "",
          createdAt: tab.createdAt,
          updatedAt: Math.max(tab.updatedAt, card?.updatedAt ?? 0),
        };
        const { dockSummary, ...run } = runSummary;
        const {
          runSummary: _storedRunSummary,
          threadTitle,
          projectionVersion: _projectionVersion,
          ...publicTab
        } = tab;
        return {
          ...publicTab,
          run,
          thread: {
            _id: tab.threadId,
            title: threadTitle ?? "Conversation",
            origin: tab.surface,
            workspaceId: tab.workspaceId,
            artifactId: run.artifactId,
            status: "active" as const,
            createdAt: tab.createdAt,
            updatedAt: tab.updatedAt,
            lastRunId: tab.runId,
          },
          card,
          inputRequest: dockSummary?.inputRequest ?? null,
          checkpointSummary: dockSummary?.checkpointSummary,
          recentSteps: dockSummary?.recentSteps ?? [],
        };
      }),
    );
  },
});

export const backfillRunTabProjections = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tabs = await ctx.db
      .query("spectraRunTabs")
      .withIndex("by_projection_version", (q) =>
        q.eq("projectionVersion", undefined),
      )
      .take(100);
    let updated = 0;
    let removed = 0;
    for (const tab of tabs) {
      const [run, thread] = await Promise.all([
        ctx.db.get(tab.runId),
        ctx.db.get(tab.threadId),
      ]);
      if (!run || !thread) {
        await ctx.db.delete(tab._id);
        removed += 1;
        continue;
      }
      await ctx.db.patch(tab._id, {
        projectionVersion: RUN_TAB_PROJECTION_VERSION,
        threadTitle: thread.title.slice(0, 120),
        runSummary: projectRunTabSummary(run),
      });
      updated += 1;
    }
    return { scanned: tabs.length, updated, removed };
  },
});

export const reconcileStaleRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [queued, running] = await Promise.all([
      ctx.db
        .query("spectraAiRuns")
        .withIndex("by_status_lease", (q) =>
          q.eq("status", "queued").lt("leaseExpiresAt", now),
        )
        .take(100),
      ctx.db
        .query("spectraAiRuns")
        .withIndex("by_status_lease", (q) =>
          q.eq("status", "running").lt("leaseExpiresAt", now),
        )
        .take(100),
    ]);
    const active = [...queued, ...running];
    let interrupted = 0;
    for (const run of active) {
      const [operations, messages] = await Promise.all([
        ctx.db
          .query("spectraOperations")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .collect(),
        ctx.db
          .query("spectraMessages")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .collect(),
      ]);
      const currentOperations = operations.filter(
        (operation) => operation.executionId === run.executionId,
      );
      const hasPartialResponse = messages.some(
        (message) =>
          message.role === "assistant" && message.content.trim().length > 0,
      );
      const hasAttachmentInput = messages.some(messageHasAttachmentInput);
      const recovery = recoveryForRun(
        currentOperations.map((operation) => operation.status),
        hasPartialResponse,
        hasAttachmentInput,
      );
      await Promise.all(
        currentOperations
          .filter((operation) => operation.status === "executing")
          .map((operation) =>
            ctx.db.patch(operation._id, {
              status: "failed",
              output: {
                error:
                  "Execution was interrupted after approval. Review affected objects before continuing.",
              },
              executedAt: now,
            }),
          ),
      );
      const error =
        hasAttachmentInput
          ? ATTACHMENT_RETRY_MESSAGE
          : recovery.recoveryState === "partial"
          ? "The run was interrupted after partial work was preserved. Review the affected objects before continuing."
          : "The run was interrupted before changes were applied and can be retried safely.";
      if (
        !run.agentUsageSettledAt &&
        run.selectedAgentId &&
        run.selectedAgentVersionId
      )
        await settleAgentInvocation(ctx, run, "failed", run.usage, now);
      await ctx.db.patch(run._id, {
        status: "failed",
        phase: recovery.recoveryState,
        error,
        recoveryState: recovery.recoveryState,
        retryable: recovery.retryable,
        preservedPartial: recovery.preservedPartial,
        workerId: undefined,
        leaseExpiresAt: undefined,
        completedAt: now,
        agentUsageSettledAt:
          run.selectedAgentId && run.selectedAgentVersionId
            ? now
            : run.agentUsageSettledAt,
        updatedAt: now,
      });
      const cards = await ctx.db
        .query("spectraResultCards")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();
      await Promise.all(
        cards.map((card) =>
          ctx.db.patch(card._id, {
            status: "failed",
            variant: "error",
            title:
              recovery.recoveryState === "partial"
                ? "Partial work preserved"
                : "Run interrupted",
            summary: error,
            actions: recovery.retryable
              ? [
                  {
                    key: "retry",
                    label: "Retry",
                    targetType: "run",
                    targetId: run._id,
                  },
                ]
              : run.threadId
                ? [
                    {
                      key: "continue",
                      label: "Continue in thread",
                      targetType: "thread",
                      targetId: run.threadId,
                    },
                  ]
                : [],
            updatedAt: now,
          }),
        ),
      );
      const sequence = (run.eventSequence ?? 0) + 1;
      await ctx.db.insert("spectraRunEvents", {
        runId: run._id,
        executionId: run.executionId ?? "interrupted",
        sequence,
        type: "interrupted",
        payload: {
          type: "interrupted",
          runId: run._id,
          recoveryState: recovery.recoveryState,
          retryable: recovery.retryable,
          preservedPartial: recovery.preservedPartial,
        },
        createdAt: now,
      });
      await ctx.db.patch(run._id, { eventSequence: sequence });
      const operationTargets = operationTargetIds(currentOperations);
      if (run.artifactId)
        operationTargets.artifactIds.add(String(run.artifactId));
      if (run.workspaceId)
        operationTargets.workspaceIds.add(String(run.workspaceId));
      const indexedArtifacts = await ctx.db
        .query("spectraArtifacts")
        .withIndex("by_ai_run", (q) => q.eq("aiRunId", run._id))
        .collect();
      const operationArtifacts = await Promise.all(
        [...operationTargets.artifactIds].flatMap((rawId) => {
          const artifactId = ctx.db.normalizeId("spectraArtifacts", rawId);
          return artifactId ? [ctx.db.get(artifactId)] : [];
        }),
      );
      const artifacts = [
        ...new Map(
          [...indexedArtifacts, ...operationArtifacts]
            .filter(
              (artifact): artifact is Doc<"spectraArtifacts"> =>
                Boolean(artifact),
            )
            .map((artifact) => [artifact._id, artifact]),
        ).values(),
      ];
      await Promise.all(
        artifacts
          .filter(
            (artifact) =>
              artifact.aiRunId === run._id ||
              (artifact.aiEffects ?? []).some(
                (effect) => effect.runId === run._id,
              ),
          )
          .map(async (artifact) => {
            const remainingEffects = (artifact.aiEffects ?? []).filter(
              (effect) => effect.runId !== run._id,
            );
            const latestEffect = remainingEffects.at(-1);
            await ctx.db.patch(artifact._id, {
              aiState: remainingEffects.length ? "updating" : undefined,
              aiRunId: latestEffect?.runId,
              aiExecutionId: latestEffect?.executionId,
              aiStateExpiresAt: undefined,
              aiProgress: remainingEffects.length
                ? artifact.aiProgress
                : undefined,
              aiPreview:
                artifact.aiRunId === run._id ? undefined : artifact.aiPreview,
              aiEffects: remainingEffects.length ? remainingEffects : undefined,
              summary:
                artifact.aiState === "creating" && remainingEffects.length === 0
                  ? "Incomplete draft preserved from an interrupted Spectra run."
                  : artifact.summary,
              updatedAt: now,
            });
            await syncArtifactSummary(ctx, artifact._id);
          }),
      );
      const indexedWorkspaces = await ctx.db
        .query("spectraWorkspaces")
        .withIndex("by_ai_run", (q) => q.eq("aiRunId", run._id))
        .collect();
      const operationWorkspaces = await Promise.all(
        [...operationTargets.workspaceIds].flatMap((rawId) => {
          const workspaceId = ctx.db.normalizeId("spectraWorkspaces", rawId);
          return workspaceId ? [ctx.db.get(workspaceId)] : [];
        }),
      );
      const workspaces = [
        ...new Map(
          [...indexedWorkspaces, ...operationWorkspaces]
            .filter(
              (workspace): workspace is Doc<"spectraWorkspaces"> =>
                Boolean(workspace),
            )
            .map((workspace) => [workspace._id, workspace]),
        ).values(),
      ];
      await Promise.all(
        workspaces
          .filter(
            (workspace) =>
              workspace.aiRunId === run._id &&
              (workspace.aiState === "creating" ||
                workspace.aiState === "updating"),
          )
          .map((workspace) =>
            ctx.db.patch(workspace._id, {
              aiState: undefined,
              aiRunId: undefined,
              aiExecutionId: undefined,
              aiPreview: undefined,
              updatedAt: now,
            }),
          ),
      );
      interrupted += 1;
    }
    return { interrupted };
  },
});

export const hideTab = mutation({
  args: { runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const tab = await ctx.db
      .query("spectraRunTabs")
      .withIndex("by_account_run", (q) =>
        q.eq("ownerAccountId", actor._id).eq("runId", args.runId),
      )
      .first();
    if (!tab || tab.schoolId !== actor.schoolId)
      return { runId: args.runId, hidden: false };
    await ctx.db.patch(tab._id, {
      hiddenAt: Date.now(),
      selected: false,
      updatedAt: Date.now(),
    });
    return { runId: args.runId };
  },
});

export const selectTab = mutation({
  args: {
    runId: v.optional(v.id("spectraAiRuns")),
    threadId: v.optional(v.id("spectraThreads")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const tabs = await ctx.db
      .query("spectraRunTabs")
      .withIndex("by_account_updated", (q) => q.eq("ownerAccountId", actor._id))
      .collect();
    const now = Date.now();
    const schoolTabs = tabs.filter(
      (tab) => !tab.schoolId || tab.schoolId === actor.schoolId,
    );
    let targetRunId = args.runId;
    let targetThreadId = args.threadId;

    if (args.threadId) {
      const thread = await ctx.db.get(args.threadId);
      if (!thread || thread.schoolId !== actor.schoolId)
        throw new Error("That conversation is not available.");
      targetThreadId = thread._id;
      const forThread = schoolTabs
        .filter((tab) => tab.threadId === thread._id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      // Prefer the conversation's latest run. Selecting an older dock tab
      // updates that tab's timestamp, so tab order is not conversation order.
      targetRunId =
        thread.lastRunId ?? forThread[0]?.runId ?? args.runId ?? targetRunId;
    }

    if (targetRunId && !targetThreadId) {
      const run = await ctx.db.get(targetRunId);
      if (!run || run.schoolId !== actor.schoolId)
        throw new Error("That run is not available.");
      targetThreadId = run.threadId;
    }

    // Explicit deselect: clear selected flags without requiring a target run.
    if (!args.runId && !args.threadId) {
      for (const tab of schoolTabs) {
        if (tab.selected)
          await ctx.db.patch(tab._id, {
            selected: false,
            updatedAt: now,
          });
      }
      return { selected: false };
    }

    if (!targetRunId || !targetThreadId)
      return { selected: false, reason: "no_run" as const };

    let selected = false;
    const threadTabs = schoolTabs
      .filter((tab) => tab.threadId === targetThreadId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const canonical = threadTabs[0];
    for (const tab of schoolTabs) {
      if (canonical && tab._id === canonical._id) {
        await ctx.db.patch(tab._id, {
          runId: targetRunId,
          selected: true,
          hiddenAt: undefined,
          updatedAt: now,
        });
        selected = true;
        continue;
      }
      if (tab.threadId === targetThreadId) {
        await ctx.db.patch(tab._id, {
          selected: false,
          hiddenAt: now,
          updatedAt: now,
        });
        continue;
      }
      if (tab.selected)
        await ctx.db.patch(tab._id, {
          selected: false,
          updatedAt: now,
        });
    }

    if (!selected) {
      const run = await ctx.db.get(targetRunId);
      if (!run || run.schoolId !== actor.schoolId)
        throw new Error("That run is not available.");
      const surface =
        run.sourceSurface === "chat" ||
        run.sourceSurface === "workspace" ||
        run.sourceSurface === "artifact"
          ? run.sourceSurface
          : "workspace";
      await ctx.db.insert("spectraRunTabs", {
        ownerAccountId: actor._id,
        schoolId: actor.schoolId,
        runId: targetRunId,
        threadId: targetThreadId,
        workspaceId: run.workspaceId,
        surface,
        selected: true,
        createdAt: now,
        updatedAt: now,
      });
      selected = true;
    }

    return { runId: targetRunId, threadId: targetThreadId, selected };
  },
});

export const claimConfirmation = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    if (run.status !== "awaiting_confirmation")
      throw new Error("This approval was already handled in another view.");
    if (
      !run.approval ||
      run.approval.executionId !== args.executionId ||
      run.approval.status !== "pending"
    )
      throw new Error("This approval was already handled in another view.");
    const operations = await ctx.db
      .query("spectraOperations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const currentOperations = operations.filter(
      (operation) => operation.executionId === args.executionId,
    );
    const proposed = currentOperations.filter(
      (operation) =>
        operation.status === "proposed" && operation.requiresConfirmation,
    );
    if (
      proposed.length === 0 ||
      currentOperations.some(
        (operation) =>
          operation.status === "executing" || operation.status === "executed",
      )
    ) {
      throw new Error("This approval was already handled in another view.");
    }
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "queued",
      phase: "applying",
      approval: {
        ...run.approval,
        status: "accepted",
        claimedAt: now,
        decidedAt: now,
      },
      workerId: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: now,
      updatedAt: now,
    });
    const cards = await ctx.db
      .query("spectraResultCards")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    await Promise.all(
      cards.map((card) =>
        ctx.db.patch(card._id, {
          status: "queued",
          title: "Applying confirmed changes",
          summary:
            "Your approval is saved. Spectra is applying each authorized operation.",
          actions: [],
          updatedAt: now,
        }),
      ),
    );
    return {
      operationIds: proposed.map((operation) => operation._id),
      resultCardId: cards[0]?._id,
      queued: true,
    };
  },
});

export const rejectConfirmation = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    if (run.status === "cancelled" && run.approval?.status === "rejected")
      return { alreadyRejected: true };
    if (run.status !== "awaiting_confirmation")
      throw new Error("This approval was already handled in another view.");
    if (
      !run.approval ||
      run.approval.executionId !== args.executionId ||
      run.approval.status !== "pending"
    )
      throw new Error("This approval was already handled in another view.");
    const operations = await ctx.db
      .query("spectraOperations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const currentOperations = operations.filter(
      (operation) => operation.executionId === args.executionId,
    );
    if (
      currentOperations.some(
        (operation) =>
          operation.status === "executing" || operation.status === "executed",
      )
    )
      throw new Error("These changes are already being applied.");
    const now = Date.now();
    if (
      !run.agentUsageSettledAt &&
      run.selectedAgentId &&
      run.selectedAgentVersionId
    )
      await settleAgentInvocation(ctx, run, "cancelled", run.usage, now);
    await Promise.all(
      currentOperations
        .filter((operation) => operation.status === "proposed")
        .map((operation) =>
          ctx.db.patch(operation._id, { status: "cancelled" }),
        ),
    );
    await ctx.db.patch(args.runId, {
      status: "cancelled",
      phase: "stopped",
      approval: { ...run.approval, status: "rejected", decidedAt: now },
      finalSummary: "No proposed changes were applied.",
      retryable: true,
      completedAt: now,
      agentUsageSettledAt:
        run.selectedAgentId && run.selectedAgentVersionId
          ? now
          : run.agentUsageSettledAt,
      heartbeatAt: now,
      workerId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    const cards = await ctx.db
      .query("spectraResultCards")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    await Promise.all(
      cards.map((card) =>
        ctx.db.patch(card._id, {
          status: "cancelled",
          title: "Cancelled",
          summary: "No proposed changes were applied.",
          actions: [],
          updatedAt: now,
        }),
      ),
    );
    return { alreadyRejected: false };
  },
});

export const reviseConfirmation = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    revision: v.string(),
  },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    if (
      run.status !== "awaiting_confirmation" ||
      !run.approval ||
      run.approval.status !== "pending" ||
      run.approval.executionId !== args.executionId
    ) {
      throw new Error("This approval was already handled in another view.");
    }
    const revision = args.revision
      .replace(/\u0000/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2_000);
    if (!revision) throw new Error("Describe what Spectra should revise.");
    const operations = await ctx.db
      .query("spectraOperations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const current = operations.filter(
      (operation) => operation.executionId === args.executionId,
    );
    if (
      current.some(
        (operation) =>
          operation.status === "executing" || operation.status === "executed",
      )
    )
      throw new Error("These changes are already being applied.");
    const now = Date.now();
    if (
      !run.agentUsageSettledAt &&
      run.selectedAgentId &&
      run.selectedAgentVersionId
    )
      await settleAgentInvocation(ctx, run, "cancelled", run.usage, now);
    await Promise.all(
      current
        .filter((operation) => operation.status === "proposed")
        .map((operation) =>
          ctx.db.patch(operation._id, { status: "cancelled" }),
        ),
    );
    await ctx.db.patch(args.runId, {
      status: "cancelled",
      phase: "stopped",
      approval: {
        ...run.approval,
        status: "revised",
        revision,
        decidedAt: now,
      },
      finalSummary:
        "The proposal was returned for revision. Continue the thread with the requested changes.",
      retryable: false,
      completedAt: now,
      agentUsageSettledAt:
        run.selectedAgentId && run.selectedAgentVersionId
          ? now
          : run.agentUsageSettledAt,
      heartbeatAt: now,
      workerId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    const cards = await ctx.db
      .query("spectraResultCards")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    await Promise.all(
      cards.map((card) =>
        ctx.db.patch(card._id, {
          status: "cancelled",
          title: "Revision requested",
          summary: revision,
          actions: run.threadId
            ? [
                {
                  key: "continue",
                  label: "Continue with revision",
                  targetType: "thread",
                  targetId: run.threadId,
                },
              ]
            : [],
          updatedAt: now,
        }),
      ),
    );
    const sequence = (run.eventSequence ?? 0) + 1;
    await ctx.db.insert("spectraRunEvents", {
      runId: args.runId,
      executionId: args.executionId,
      sequence,
      type: "approval_revised",
      payload: { type: "approval_revised", runId: args.runId, revision },
      createdAt: now,
    });
    await ctx.db.patch(args.runId, { eventSequence: sequence });
    return { revised: true, threadId: run.threadId, revision };
  },
});

export const stopRun = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    requireCurrentExecution(run.executionId, args.executionId);
    if (run.status === "cancelled")
      return { alreadyStopped: true, executionId: run.executionId };
    if (
      run.status !== "queued" &&
      run.status !== "running" &&
      run.status !== "awaiting_resolution"
    )
      throw new Error("This run is no longer active.");
    const operations = await ctx.db
      .query("spectraOperations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const currentOperations = operations.filter(
      (operation) => operation.executionId === args.executionId,
    );
    // Cancellation is a durable request even while an operation is in
    // progress. Marking the run terminal makes the worker heartbeat return
    // `alive: false`; it then aborts at the next safe boundary and performs
    // the same pending/staged cleanup. Rejecting here can otherwise make a
    // stalled executing operation literally impossible to stop.
    const hasAttachmentInput = await runHasAttachmentInput(ctx, args.runId);
    const recovery = recoveryForRun(
      currentOperations.map((operation) => operation.status),
      false,
      hasAttachmentInput,
    );
    const now = Date.now();
    if (
      !run.agentUsageSettledAt &&
      run.selectedAgentId &&
      run.selectedAgentVersionId
    )
      await settleAgentInvocation(ctx, run, "cancelled", run.usage, now);
    await Promise.all(
      currentOperations
        .filter(
          (operation) =>
            operation.status === "proposed" || operation.status === "waiting",
        )
        .map((operation) =>
          ctx.db.patch(operation._id, {
            status: "cancelled",
            conflict: undefined,
          }),
        ),
    );
    await releaseClaimsForRun(ctx, args.runId, now);
    const sequence = (run.eventSequence ?? 0) + 1;
    await ctx.db.patch(args.runId, {
      status: "cancelled",
      phase: "stopped",
      recoveryState: recovery.recoveryState,
      retryable: recovery.retryable,
      preservedPartial: recovery.preservedPartial,
      completedAt: now,
      agentUsageSettledAt:
        run.selectedAgentId && run.selectedAgentVersionId
          ? now
          : run.agentUsageSettledAt,
      heartbeatAt: now,
      workerId: undefined,
      leaseExpiresAt: undefined,
      eventSequence: sequence,
      updatedAt: now,
    });
    await ctx.db.insert("spectraRunEvents", {
      runId: args.runId,
      executionId: args.executionId,
      sequence,
      type: "stopped",
      payload: {
        type: "stopped",
        runId: args.runId,
        partial: recovery.preservedPartial,
      },
      createdAt: now,
    });
    const cards = await ctx.db
      .query("spectraResultCards")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    await Promise.all(
      cards.map((card) =>
        ctx.db.patch(card._id, {
          status: "cancelled",
          title: "Stopped",
          summary: hasAttachmentInput
            ? `Stopped by you. ${ATTACHMENT_RETRY_MESSAGE}`
            : recovery.retryable
              ? "Stopped by you. Any partial response remains available in the thread."
              : "Stopped by you. Some work may already be visible — review it before continuing.",
          actions: recovery.retryable
            ? [
                {
                  key: "retry",
                  label: "Retry",
                  targetType: "run",
                  targetId: args.runId,
                },
              ]
            : run.threadId
              ? [
                  {
                    key: "continue",
                    label: "Continue in thread",
                    targetType: "thread",
                    targetId: run.threadId,
                  },
                ]
              : [],
          updatedAt: now,
        }),
      ),
    );
    return { alreadyStopped: false, executionId: run.executionId };
  },
});

export const setSuggestedThreadMetadata = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    if (run.status !== "running" || run.executionId !== args.executionId)
      throw new Error("This title belongs to an older run attempt.");
    await ctx.db.patch(args.runId, {
      suggestedThreadTitle: args.title?.trim().slice(0, 88),
      suggestedThreadSummary: args.summary
        ?.replace(/\s+/g, " ")
        .trim()
        .slice(0, 320),
      updatedAt: Date.now(),
    });
    return { runId: args.runId };
  },
});

export const patchResultCard = mutation({
  args: {
    resultCardId: v.id("spectraResultCards"),
    executionId: v.string(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    variant: v.optional(vResultVariant),
    actions: v.optional(v.array(vResultAction)),
    provenance: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const card = await ctx.db.get(args.resultCardId);
    if (!card) throw new Error("Result card not found");
    const run = await ctx.db.get(card.runId);
    if (
      !run ||
      run.ownerAccountId !== actor._id ||
      run.schoolId !== actor.schoolId
    )
      throw new Error("Result card not found");
    requireCurrentExecution(run.executionId, args.executionId);
    await ctx.db.patch(args.resultCardId, {
      title: args.title ?? card.title,
      summary: args.summary ?? card.summary,
      variant: args.variant ?? card.variant,
      actions: args.actions ?? card.actions,
      provenance: args.provenance ?? card.provenance,
      updatedAt: Date.now(),
    });
    return { resultCardId: args.resultCardId };
  },
});

export const get = query({
  args: { runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    const cards = await ctx.db
      .query("spectraResultCards")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const operations = await ctx.db
      .query("spectraOperations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    return { run, cards, operations };
  },
});

export const resetForRetry = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    retryKey: v.string(),
  },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    if (await runHasAttachmentInput(ctx, args.runId))
      throw new Error(ATTACHMENT_RETRY_MESSAGE);
    if (
      run.status === "queued" &&
      run.lastRetryKey === args.retryKey &&
      run.executionId
    ) {
      const cards = await ctx.db
        .query("spectraResultCards")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .collect();
      return {
        runId: args.runId,
        resultCardId: cards[0]?._id,
        prompt: run.userPrompt,
        workspaceId: run.workspaceId,
        artifactId: run.artifactId,
        sourceSurface: run.sourceSurface,
        contextSnapshot: run.contextSnapshot,
        executionId: run.executionId,
        previousExecutionId: args.executionId,
        created: false,
      };
    }
    requireCurrentExecution(run.executionId, args.executionId);
    if (run.status !== "failed" && run.status !== "cancelled")
      throw new Error("Only failed or cancelled runs can be retried");
    if (
      run.retryable === false ||
      (run.recoveryState === "partial" && run.retryable !== true)
    ) {
      throw new Error(
        "This run preserved partial work. Review the affected objects and continue in the thread instead of retrying.",
      );
    }
    const allOperations = await ctx.db
      .query("spectraOperations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const priorOperations = allOperations.filter(
      (operation) => operation.executionId === args.executionId,
    );
    if (
      priorOperations.some(
        (operation) =>
          operation.status === "executing" ||
          operation.status === "executed" ||
          operation.status === "failed",
      )
    ) {
      throw new Error(
        "This run may have partially applied changes. Review its details and use a follow-up command instead of retrying.",
      );
    }
    const now = Date.now();
    await Promise.all(
      priorOperations
        .filter((operation) => operation.status === "proposed")
        .map((operation) =>
          ctx.db.patch(operation._id, { status: "cancelled" }),
        ),
    );
    const previousExecutionId = run.executionId;
    const executionId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const sequence = (run.eventSequence ?? 0) + 1;
    await ctx.db.patch(args.runId, {
      status: "queued",
      finalSummary: undefined,
      error: undefined,
      completedAt: undefined,
      attemptCount: (run.attemptCount ?? 1) + 1,
      executionId,
      lastRetryKey: args.retryKey,
      phase: "created",
      heartbeatAt: now,
      workerId: undefined,
      leaseExpiresAt: undefined,
      approval: undefined,
      recoveryState: undefined,
      retryable: undefined,
      preservedPartial: undefined,
      agentUsageStartedAt: undefined,
      agentUsageSettledAt: undefined,
      eventSequence: sequence,
      updatedAt: now,
    });
    await ctx.db.insert("spectraRunEvents", {
      runId: args.runId,
      executionId,
      sequence,
      type: "attempt_started",
      payload: {
        type: "attempt_started",
        runId: args.runId,
        attempt: (run.attemptCount ?? 1) + 1,
      },
      createdAt: now,
    });
    const cards = await ctx.db
      .query("spectraResultCards")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    await Promise.all(
      cards.map((card) =>
        ctx.db.patch(card._id, {
          status: "queued",
          variant: "status",
          title: "Retrying",
          summary: "Analysing request",
          actions: [],
          hiddenAt: undefined,
          updatedAt: now,
        }),
      ),
    );
    const priorAssistantMessages = (
      await ctx.db
        .query("spectraMessages")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .collect()
    ).filter((message) => message.role === "assistant");
    await Promise.all(
      priorAssistantMessages.map((message) => {
        const metadata =
          message.metadata && typeof message.metadata === "object"
            ? (message.metadata as Record<string, unknown>)
            : {};
        return ctx.db.patch(message._id, {
          metadata: {
            ...metadata,
            choices: null,
            retrying: true,
          },
        });
      }),
    );
    const tabs = await ctx.db
      .query("spectraRunTabs")
      .withIndex("by_account_run", (q) =>
        q.eq("ownerAccountId", run.ownerAccountId).eq("runId", args.runId),
      )
      .collect();
    await Promise.all(
      tabs.map((tab) =>
        ctx.db.patch(tab._id, {
          hiddenAt: undefined,
          selected: true,
          updatedAt: now,
        }),
      ),
    );
    return {
      runId: args.runId,
      resultCardId: cards[0]?._id,
      prompt: run.userPrompt,
      workspaceId: run.workspaceId,
      artifactId: run.artifactId,
      sourceSurface: run.sourceSurface,
      contextSnapshot: run.contextSnapshot,
      executionId,
      previousExecutionId,
      created: true,
    };
  },
});

export const listResultCards = query({
  args: {
    surface: v.optional(vSurface),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    includeHidden: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const runs = await ctx.db
      .query("spectraAiRuns")
      .withIndex("by_account_created", (q) => q.eq("ownerAccountId", actor._id))
      .order("desc")
      .take(limit * 4);
    const allowed = runs
      .filter((run) => run.schoolId === actor.schoolId)
      .filter((run) => !args.surface || run.sourceSurface === args.surface)
      .filter(
        (run) => !args.workspaceId || run.workspaceId === args.workspaceId,
      )
      .filter((run) => !args.artifactId || run.artifactId === args.artifactId);
    const cards = (
      await Promise.all(
        allowed.map(async (run) => {
          const rows = await ctx.db
            .query("spectraResultCards")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .collect();
          return rows.map((card) => ({ ...card, run }));
        }),
      )
    ).flat();
    return cards
      .filter((card) => args.includeHidden || !card.hiddenAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  },
});

export const listRecent = query({
  args: {
    surface: v.optional(vSurface),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const runs = await ctx.db
      .query("spectraAiRuns")
      .withIndex("by_account_created", (q) => q.eq("ownerAccountId", actor._id))
      .order("desc")
      .take(limit * 3);
    return runs
      .filter((run) => run.schoolId === actor.schoolId)
      .filter((run) =>
        args.surface ? run.sourceSurface === args.surface : true,
      )
      .slice(0, limit);
  },
});

export const hideResultCard = mutation({
  args: {
    resultCardId: v.id("spectraResultCards"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const card = await ctx.db.get(args.resultCardId);
    if (!card) throw new Error("Result card not found");
    const run = await ctx.db.get(card.runId);
    if (
      !run ||
      run.ownerAccountId !== actor._id ||
      run.schoolId !== actor.schoolId
    ) {
      throw new Error("Result card not found");
    }
    await ctx.db.patch(args.resultCardId, {
      hiddenAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { resultCardId: args.resultCardId };
  },
});

export const unhideResultCard = mutation({
  args: { resultCardId: v.id("spectraResultCards") },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const card = await ctx.db.get(args.resultCardId);
    if (!card) throw new Error("Result card not found");
    const run = await ctx.db.get(card.runId);
    if (
      !run ||
      run.ownerAccountId !== actor._id ||
      run.schoolId !== actor.schoolId
    )
      throw new Error("Result card not found");
    await ctx.db.patch(args.resultCardId, {
      hiddenAt: undefined,
      updatedAt: Date.now(),
    });
    return { resultCardId: args.resultCardId };
  },
});

export const keepResultCard = mutation({
  args: { resultCardId: v.id("spectraResultCards") },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const card = await ctx.db.get(args.resultCardId);
    if (!card) throw new Error("Result card not found");
    const run = await ctx.db.get(card.runId);
    if (
      !run ||
      run.ownerAccountId !== actor._id ||
      run.schoolId !== actor.schoolId
    )
      throw new Error("Result card not found");
    const now = Date.now();
    await ctx.db.patch(args.resultCardId, {
      keptAt: now,
      hiddenAt: undefined,
      updatedAt: now,
    });
    return { resultCardId: args.resultCardId };
  },
});

export const setAgentRouting = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    agentId: v.id("spectraArtifacts"),
    confidence: v.number(),
    reason: v.string(),
    source: v.union(
      v.literal("automatic"),
      v.literal("continued"),
      v.literal("explicit"),
    ),
  },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    if (
      (run.status !== "queued" && run.status !== "running") ||
      run.executionId !== args.executionId
    )
      throw new Error("This routing decision belongs to an older run attempt.");
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.agentId,
      "use",
    );
    if (artifact.blueprintKey !== "agent" || artifact.status !== "active")
      throw new Error("Agent not found");
    const release = (
      await ctx.db
        .query("agentReleases")
        .withIndex("by_agent_status", (q) =>
          q.eq("agentId", artifact._id).eq("status", "published"),
        )
        .collect()
    )
      .filter((candidate) => {
        const rollout = candidate.rollout ?? "published";
        return artifact.ownerAccountId === actor.accountId
          ? rollout === "internal_test" ||
              rollout === "limited" ||
              rollout === "published"
          : rollout === "limited" || rollout === "published";
      })
      .sort((left, right) => right.releaseNumber - left.releaseNumber)[0];
    if (!release)
      throw new Error("This agent has no active published release.");
    const confidence = Math.max(0, Math.min(1, args.confidence));
    const reason = args.reason.replace(/\s+/g, " ").trim().slice(0, 500);
    const routing = {
      confidence,
      reason,
      source: args.source,
      reversible: true,
    } as const;
    const now = Date.now();
    await ctx.db.patch(run._id, {
      selectedAgentId: artifact._id,
      selectedAgentVersionId: release.versionId,
      agentUsageStartedAt: run.agentUsageStartedAt ?? now,
      agentUsageSettledAt: undefined,
      agentRouting: routing,
      updatedAt: now,
    });
    if (!run.agentUsageStartedAt)
      await recordAgentInvocation(
        ctx,
        run,
        artifact._id,
        release.versionId,
        now,
      );
    if (run.threadId)
      await ctx.db.patch(run.threadId, {
        retainedAgentId: artifact._id,
        retainedAgentVersionId: release.versionId,
        updatedAt: now,
        readSchemaVersion: 1,
      });
    return {
      agentId: artifact._id,
      versionId: release.versionId,
      title: artifact.title,
      routing,
    };
  },
});

export const clearRetainedAgent = mutation({
  args: { runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    if (!run.threadId) return { cleared: false };
    const thread = await ctx.db.get(run.threadId);
    if (
      !thread ||
      thread.ownerAccountId !== run.ownerAccountId ||
      thread.schoolId !== run.schoolId
    )
      throw new Error("Thread not found");
    await ctx.db.patch(thread._id, {
      retainedAgentId: undefined,
      retainedAgentVersionId: undefined,
      updatedAt: Date.now(),
      readSchemaVersion: 1,
    });
    return { cleared: true, threadId: thread._id };
  },
});

export const setContextSnapshot = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    contextSnapshot: v.any(),
  },
  handler: async (ctx, args) => {
    const { run } = await requireOwnedRun(ctx, args.runId);
    if (
      (run.status !== "queued" && run.status !== "running") ||
      run.executionId !== args.executionId
    )
      throw new Error("This context belongs to an older run attempt.");
    await ctx.db.patch(args.runId, {
      contextSnapshot: args.contextSnapshot,
      updatedAt: Date.now(),
    });
    return { runId: args.runId };
  },
});
