import { boundedArtifactRead } from "@/features/spectra/ai/bounded-artifact-read";
import { hasNumericTableSource } from "@/features/spectra/quality/source-requirements";
import {
  applyContentPatch,
  effectChangedPathsForUpdate,
  executeOperation,
  operationEffectProgress,
  operationPhases,
  progressiveArtifactFrames,
  resolveCreatedArtifactDependencies,
} from "./loop/act";
import type {
  Body,
  AttachmentInput,
  NativeProgressUpdate,
  PreparedAttachment,
  ResultAction,
  RetryReset,
  RunDetail,
  RunState,
  Surface,
} from "./loop/contract";
import {
  buildContext,
  gatherResolvedArtifactContext,
  queueSilentMemoryMaintenance,
  summarizeArtifact,
} from "./loop/gather";
import {
  addDerivedVisualAttachments,
  agentCanHandleLikelyMutation,
  assertSelectedAgentAllowsOperations,
  attachmentNeedsVisualEvidence,
  enrichImageAttachments,
  hasNonCreationMutationIntent,
  normalizeNativeProgress,
  parallelCreationContract,
  provisionalSingleCreation,
  requestsOrdinarySpectra,
  selectAgentRuntime,
  selectedAgentOperationApprovalReasons,
} from "./loop/intake";
import { act, mutate, query } from "./loop/io";
import { hydrateApplicationLocalFileCounts } from "./loop/authority";
import { createAgentLoopExecution } from "./loop/orchestrator";
import {
  assertRequestedArtifactContent,
  callMixedTaskGraphWorkers,
  callModel,
  callParallelCreationWorkers,
  fastFocusedDeckHintPlan,
  fastFocusedMetadataPlan,
  fastFocusedPlannerPlan,
  fastFocusedQuizSettingsPlan,
  fastUnavailableManageBacPlan,
  normalizeCreationSummary,
  operationLabel,
  promptDirectlyUsesFocusedContent,
  safeOperationPreview,
} from "./loop/plan";
import {
  latestCard,
  legacyEventForRunItem,
  protocolItemForLegacyEvent,
  publicError,
  saveAssistantMessage,
  streamCard,
} from "./loop/report";
import {
  canUndoRunWithEffects,
  interruptedEffectActions,
  interruptedEffectSummary,
  reconcileInterruptedEffects,
  retainOutcomeThenVerify,
} from "./loop/receipt-report";
import {
  ownedReferences,
  promptExplicitlyTargetsFocusedArtifact,
  reconcileExplicitDocumentRegions,
  resolveAndValidatePlan,
} from "./loop/resolve";
import { verifyCommittedOutcomes } from "./loop/verify";
import { createRunItem } from "@/features/spectra/actions/protocol";
import type { EffectiveFocusMode } from "@/features/spectra/ai/context-builder";
import {
  getSpectraAttachmentStrategy,
  getSpectraModelId,
} from "@/features/spectra/ai/model-config";
import {
  AiArtifactRegionConflictError,
  applyAiArtifactMutation,
} from "@/features/spectra/ai/yjs-artifact-operation";
import { confirmationDiffSummary } from "@/features/spectra/ai/authority-execution";
import { interruptionRecovery } from "../../../../../shared/spectra-run-recovery";
import { encodeArtifactContentForStorage } from "../../../../../shared/sheet-cells";
import { prepareAttachments as prepareRunAttachments } from "@/features/spectra/compute/files/attachment-preprocessor";
import {
  attachmentBytesAsInput,
  attachmentInputBytes,
  attachmentSha256,
} from "@/features/spectra/compute/files/attachment-retention";
import { promptLooksLikeFocusedStructuralEdit } from "@/features/spectra/operations/intent-alignment";
import { isQuietRetryableApplyFailure } from "@/features/spectra/operations/plan-diagnostics";
import { evaluatePlanPolicy } from "@/features/spectra/operations/policy";
import {
  SPECTRA_BLUEPRINT_KEYS,
  parseModelOperation,
  requestIntentSchema,
} from "@/features/spectra/operations/schema";
import type {
  ModelOperation,
  SpectraPlan,
} from "@/features/spectra/operations/schema";
import { validatePlanAgainstIntent } from "@/features/spectra/operations/validate-plan";
import { RunStateMachine } from "@/features/spectra/runs/state";
import type { RunProtocolState } from "@/features/spectra/runs/state";
import { classifyRunAttemptAbort } from "@/features/spectra/ai/run-lifecycle";
import { SPECTRA_RUN_HEARTBEAT_INTERVAL_MS } from "@/features/spectra/ai/run-lease";
import { createNdjsonResponse } from "@/features/spectra/runs/streaming/ndjson-response";
import { requireActor } from "@/lib/auth-server";
import { withWorkerConvexToken } from "@/lib/convex-worker-context";
import { createClerkClient } from "@clerk/backend";
import { NextRequest } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

async function inferWorkspaceForRun(actorClerkId: string, body: Body) {
  if (body.workspaceId) return body.workspaceId;
  if (!body.artifactId) return undefined;
  try {
    const artifact = await query<
      unknown & object,
      { placements?: Array<{ workspaceId?: string }> }
    >("spectraArtifacts:get", {
      actorClerkId,
      artifactId: body.artifactId,
    });
    const workspaceIds = [
      ...new Set(
        (artifact.placements ?? []).flatMap((placement) =>
          typeof placement.workspaceId === "string"
            ? [placement.workspaceId]
            : [],
        ),
      ),
    ];
    return workspaceIds.length === 1 ? workspaceIds[0] : undefined;
  } catch {
    return undefined;
  }
}

function ndjson(task: (emit: (event: unknown) => void) => Promise<void>) {
  return createNdjsonResponse(task, publicError);
}


function operationTypesArmRunUndo(
  operations: ReadonlyArray<{ type: string }>,
): boolean {
  return operations.some(
    (operation) =>
      operation.type === "artifact.create" ||
      operation.type === "artifact.update",
  );
}

function revertRunResultAction(runId: string): ResultAction {
  return {
    key: "revert",
    label: "Undo this run",
    targetType: "run",
    targetId: runId,
  };
}

function durableArtifactWritesFromOutcomes(
  outcomes: ReadonlyArray<{
    operation: { type: string };
    affected: Array<{ type: string; id: string }>;
  }>,
): boolean {
  return outcomes.some(
    ({ operation, affected }) =>
      (operation.type === "artifact.create" ||
        operation.type === "artifact.update") &&
      affected.some((item) => item.type === "artifact" && Boolean(item.id)),
  );
}

function recoveryForAttempt(
  operationStatuses: Parameters<typeof interruptionRecovery>[0],
  hasPartialResponse: boolean,
  _hasAttachmentInput: boolean,
) {
  return interruptionRecovery(operationStatuses, hasPartialResponse);
}

async function runAttempt(
  params: {
    actorClerkId: string;
    runId: string;
    resultCardId: string;
    executionId: string;
    workerId: string;
    prompt: string;
    surface: Surface;
    threadId?: string;
    continuedThread?: boolean;
    workspaceId?: string;
    scopeNodeId?: string;
    artifactId?: string;
    focusMode?: EffectiveFocusMode;
    selectedArtifactIds?: string[];
    explicitContextObjects?: Body["explicitContextObjects"];
    currentView?: string;
    agentId?: string;
    disableAgentRouting?: boolean;
    clarificationId?: string;
    choiceMessageId?: string;
    choiceKey?: string;
    clarificationExecutionId?: string;
    continuationRunId?: string;
    batchSelections?: Body["batchSelections"];
    attachments?: PreparedAttachment[];
    signal?: AbortSignal;
  },
  emit: (event: unknown) => void,
) {
  const attemptStartedAt = Date.now();
  let phaseStartedAt = attemptStartedAt;
  const recordPhase = (phase: string) => {
    const now = Date.now();
    console.info("[spectra.run.phase]", {
      runId: params.runId,
      phase,
      elapsedMs: now - phaseStartedAt,
      totalMs: now - attemptStartedAt,
    });
    phaseStartedAt = now;
  };
  const loop = createAgentLoopExecution({
    runId: params.runId,
    onTransition: (entry) => console.info("[spectra.agent-loop]", entry),
  });
  loop.enter("intake");
  await mutate("spectraRuns:claimExecution", {
    actorClerkId: params.actorClerkId,
    runId: params.runId,
    executionId: params.executionId,
    workerId: params.workerId,
  });
  const protocolState = new RunStateMachine("created", attemptStartedAt);
  const advanceProtocolState = (next: RunProtocolState, reason?: string) =>
    protocolState.canTransition(next)
      ? protocolState.transition(next, reason)
      : protocolState.getSnapshot();
  advanceProtocolState("planning");
  let card = await latestCard(params.actorClerkId, params.runId);
  recordPhase("claim_and_initial_card");
  let commitStarted = false;
  let verificationIncomplete = false;
  let unacknowledgedOperationId: string | undefined;
  const operationOutcomes: Array<{
    operationId?: string;
    acknowledged?: boolean;
    operation: ModelOperation;
    affected: Array<{ type: string; id: string }>;
  }> = [];
  let publicText = "";
  let markedStreaming = false;
  let hadVisibleActivity = false;
  let streamedCreationPreview = false;
  let pendingArtifactCount = 0;
  const partialWrite: Promise<unknown> = Promise.resolve();
  let eventWrite: Promise<unknown> = Promise.resolve();
  let eventFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let queuedEvents: Array<{ type: string; payload: Record<string, unknown> }> =
    [];
  const progressiveWrites: Promise<unknown>[] = [];
  let eventPersistenceFailed = false;
  const leaseController = new AbortController();
  const executionSignal = params.signal
    ? AbortSignal.any([params.signal, leaseController.signal])
    : leaseController.signal;
  const heartbeat = setInterval(() => {
    void mutate<unknown & object, { alive: boolean }>("spectraRuns:heartbeat", {
      runId: params.runId,
      executionId: params.executionId,
      workerId: params.workerId,
    })
      .then((result) => {
        if (!result.alive) leaseController.abort();
      })
      .catch(() => null);
  }, SPECTRA_RUN_HEARTBEAT_INTERVAL_MS);
  const stopHeartbeat = () => clearInterval(heartbeat);
  const persistQueuedEvents = () => {
    if (eventFlushTimer) {
      clearTimeout(eventFlushTimer);
      eventFlushTimer = null;
    }
    const events = queuedEvents;
    queuedEvents = [];
    if (events.length === 0) return eventWrite;
    eventWrite = eventWrite
      .then(() =>
        mutate("spectraRuns:appendEvents", {
          actorClerkId: params.actorClerkId,
          runId: params.runId,
          executionId: params.executionId,
          events,
        }),
      )
      .catch(() => {
        eventPersistenceFailed = true;
        return null;
      });
    return eventWrite;
  };
  let runItemSequence = 0;
  const publish = (event: Record<string, unknown>) => {
    const runItem = createRunItem(
      params.runId,
      runItemSequence++,
      protocolItemForLegacyEvent(event),
    );
    // RunItem V2 is canonical. The top-level legacy event shape remains only
    // as a temporary rendering/history adapter until the Phase 12 removal gate.
    const compatibleEvent = legacyEventForRunItem(runItem, event);
    emit(compatibleEvent);
    const type = String(event.type ?? "status");
    queuedEvents.push({ type, payload: compatibleEvent });
    if (
      [
        "final",
        "error",
        "stopped",
        "interrupted",
        "confirmation_required",
      ].includes(type)
    )
      void persistQueuedEvents();
    else if (!eventFlushTimer)
      eventFlushTimer = setTimeout(() => void persistQueuedEvents(), 1_500);
  };
  const flushEvents = async () => {
    await persistQueuedEvents();
    await eventWrite;
    if (eventPersistenceFailed)
      await mutate("spectraRuns:markTraceDegraded", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
      }).catch(() => null);
  };
  try {
    await mutate("spectraRuns:updateStatus", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      status: "running",
      phase: "planning",
      resultTitle: "Spectra",
      resultSummary: params.artifactId
        ? "Loading workspace context"
        : params.workspaceId
          ? "Loading the active workspace map"
          : "Resolving the requested objects",
      resultActions: [],
    });
    const immediatePlan =
      params.agentId || params.continuedThread
        ? null
        : await fastUnavailableManageBacPlan(params.prompt);
    if (immediatePlan) {
      loop.enter("plan");
      publicText = immediatePlan.finalResponse;
      publish({
        type: "text_replace",
        runId: params.runId,
        content: immediatePlan.finalResponse,
      });
      if (
        params.threadId &&
        (immediatePlan.conversationTitle || immediatePlan.conversationSummary)
      )
        await mutate("spectraThreads:applyGeneratedMetadata", {
          actorClerkId: params.actorClerkId,
          threadId: params.threadId,
          runId: params.runId,
          executionId: params.executionId,
          title: immediatePlan.conversationTitle ?? undefined,
          summary: immediatePlan.conversationSummary ?? undefined,
        });
      await mutate("spectraOperations:recordPlan", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        operations: [],
      });
      const title =
        immediatePlan.decision === "clarify" ? "Needs clarification" : "Answer";
      const provenance = {
        threadId: params.threadId,
        workspaceId: params.workspaceId,
        focusMode: params.focusMode ?? (params.threadId ? "thread" : "global"),
      };
      await mutate("spectraRuns:updateStatus", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        status: immediatePlan.decision === "clarify" ? "awaiting_resolution" : "completed",
        outcome:
          immediatePlan.decision === "clarify"
            ? "awaiting_input"
            : "answer_only",
        decision: immediatePlan.decision,
        planIntent: immediatePlan.intent,
        finalSummary: immediatePlan.finalResponse,
        resultTitle: title,
        resultSummary: immediatePlan.finalResponse,
        resultVariant: "status",
        resultActions: [],
        provenance,
        modelUsed: "spectra/deterministic",
        providerUsed: "Spectra",
      });
      await saveAssistantMessage({
        actorClerkId: params.actorClerkId,
        threadId: params.threadId,
        runId: params.runId,
        executionId: params.executionId,
        content: immediatePlan.finalResponse,
        decision: immediatePlan.decision,
        model: "spectra/deterministic",
        provider: "Spectra",
        choices: immediatePlan.choices,
      });
      await queueSilentMemoryMaintenance({
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        prompt: params.prompt,
        threadId: params.threadId,
        workspaceId: params.workspaceId,
        artifactId: params.artifactId,
      });
      card = await latestCard(params.actorClerkId, params.runId);
      loop.enter("report", "immediate answer has no mutation stages");
      publish({
        type: "final",
        runId: params.runId,
        summary: immediatePlan.finalResponse,
        card: streamCard(card),
      });
      await flushEvents();
      advanceProtocolState("completed");
      return;
    }
    await mutate("spectraRuns:updateStatus", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      status: "running",
      phase: "reading",
      resultTitle: "Reading context",
      resultSummary: "Reading the visible and selected work",
      resultActions: [],
    });
    const earlyPendingByIndex = new Map<number, string>();
    const earlyPendingBlueprintByIndex = new Map<
      number,
      (typeof SPECTRA_BLUEPRINT_KEYS)[number]
    >();
    const earlyPendingWorkspaceByIndex = new Map<number, string>();
    const artifactEffectTargetByIndex = new Map<number, string>();
    const latestArtifactProgressByIndex = new Map<
      number,
      NativeProgressUpdate
    >();
    // Preview content and choreography effects both update the same artifact
    // projection. Model callbacks can arrive concurrently, so serialize all
    // preview writes per artifact; otherwise Convex retries the two mutations
    // against one summary row until the live run fails after useful work has
    // already been saved.
    const artifactPreviewWrites = new Map<string, Promise<unknown>>();
    const queueArtifactPreviewWrite = (
      artifactId: string,
      writeOperation: () => Promise<unknown>,
    ) => {
      const previous =
        artifactPreviewWrites.get(artifactId) ?? Promise.resolve();
      const write = previous
        .catch(() => null)
        .then(writeOperation)
        .catch(() => null);
      artifactPreviewWrites.set(artifactId, write);
      progressiveWrites.push(write);
      return write;
    };
    const queueArtifactEffect = (
      artifactId: string,
      progress: NativeProgressUpdate,
    ) => {
      if (progress.activity !== "create" && progress.activity !== "edit")
        return;
      const effectActivity = progress.activity;
      publish({
        type: "artifact_patch",
        runId: params.runId,
        operationId:
          progress.operationIndex !== undefined
            ? `effect-${progress.operationIndex + 1}`
            : "effect-focused",
        artifactId,
        patch: {
          effectRunId: params.runId,
          effectExecutionId: params.executionId,
          effectTitle: progress.title,
          effectDetail: progress.detail,
          effectActivity,
          effectRegionHint: progress.regionHint,
          effectOperationIndex: progress.operationIndex,
        },
      });
      queueArtifactPreviewWrite(artifactId, () =>
        mutate("spectraArtifacts:updateAiEffect", {
            actorClerkId: params.actorClerkId,
            artifactId,
            runId: params.runId,
            executionId: params.executionId,
            title: progress.title,
            detail: progress.detail,
            activity: effectActivity,
            regionHint: progress.regionHint,
            operationIndex: progress.operationIndex,
          }),
      );
    };
    const bindArtifactEffect = (operationIndex: number, artifactId: string) => {
      artifactEffectTargetByIndex.set(operationIndex, artifactId);
      const progress = latestArtifactProgressByIndex.get(operationIndex);
      if (progress) queueArtifactEffect(artifactId, progress);
    };
    const publishNativeProgress = (progress: NativeProgressUpdate) => {
      hadVisibleActivity = true;
      publish({ type: "progress", runId: params.runId, ...progress });
      if (progress.operationIndex !== undefined) {
        latestArtifactProgressByIndex.set(progress.operationIndex, progress);
        const target = artifactEffectTargetByIndex.get(progress.operationIndex);
        if (target) queueArtifactEffect(target, progress);
      }
    };
    const signalsMutationIntent =
      /\b(?:rename|edit|update|transform|rewrite|write|draft|add|remove|reorganize|change|set|replace|fix|correct)\b/i.test(
        params.prompt,
      );
    // A focused-artifact request is overwhelmingly an edit, even when the
    // user naturally says "write a hint" or "draft a better summary". Only
    // materialize a creation shell there when they explicitly ask for a new,
    // separate object. This prevents invisible orphan shells on every edit.
    // An open artifact is often the source or update target for a larger task;
    // it must not disable explicit creation work in that same request.
    const parallelCreations = parallelCreationContract(
      params.prompt,
      Boolean(params.artifactId),
    );
    const provisionalCreation =
      params.artifactId &&
      promptLooksLikeFocusedStructuralEdit(params.prompt) &&
      !/\b(?:new|another|separate)\b/i.test(params.prompt)
        ? null
        : !params.artifactId ||
            /\b(?:new|another|separate)\b/i.test(params.prompt)
          ? provisionalSingleCreation(params.prompt)
          : null;
    const provisionalShells = parallelCreations.length
      ? parallelCreations
      : provisionalCreation
        ? [provisionalCreation]
        : [];
    for (const [provisionalIndex, shell] of provisionalShells.entries()) {
      const provisionalTitle =
        shell.requestedTitle ?? `New ${shell.label.toLowerCase()}`;
      const workspaceId =
        params.surface === "workspace" || params.surface === "artifact"
          ? params.workspaceId
          : undefined;
      const pending = await mutate<unknown & object, { artifactId: string }>(
        "spectraArtifacts:createPending",
        {
          actorClerkId: params.actorClerkId,
          blueprintKey: shell.blueprintKey,
          title: provisionalTitle,
          workspaceId,
          runId: params.runId,
          executionId: params.executionId,
          threadId: params.threadId,
          sourceAttachmentIds: params.attachments?.flatMap((attachment) =>
            attachment.id ? [attachment.id] : [],
          ),
        },
      );
      earlyPendingByIndex.set(provisionalIndex, pending.artifactId);
      earlyPendingBlueprintByIndex.set(provisionalIndex, shell.blueprintKey);
      pendingArtifactCount = earlyPendingByIndex.size;
      bindArtifactEffect(provisionalIndex, pending.artifactId);
      hadVisibleActivity = true;
      publishNativeProgress({
        title: `Opening a live ${shell.label.toLowerCase()} canvas`,
        detail: `The artifact shell is visible while its typed content is formed`,
        activity: "create",
        operationIndex: provisionalIndex,
        artifactType: shell.blueprintKey,
        regionHint: "artifact:structure",
      });
      publish({
        type: "operation_preview",
        runId: params.runId,
        operationId: `preview-${provisionalIndex + 1}`,
        operationType: "artifact.create",
        preview: {
          action: "create",
          title: provisionalTitle,
          blueprintKey: shell.blueprintKey,
          pendingArtifactId: pending.artifactId,
        },
      });
    }
    const context = await buildContext(
      params.actorClerkId,
      {
        workspaceId: params.workspaceId,
        scopeNodeId: params.scopeNodeId,
        artifactId: params.artifactId,
        threadId: params.threadId,
        focusMode: params.focusMode,
        selectedArtifactIds: params.selectedArtifactIds,
        explicitContextObjects: params.explicitContextObjects,
        currentView: params.currentView,
        clarificationId: params.clarificationId,
        choiceMessageId: params.choiceMessageId,
        choiceKey: params.choiceKey,
        clarificationExecutionId: params.clarificationExecutionId,
        continuationRunId: params.continuationRunId,
        batchSelections: params.batchSelections,
        executionId: params.executionId,
      },
      params.prompt,
    );
    const explicitlyTargetsFocusedArtifact =
      promptExplicitlyTargetsFocusedArtifact(params.prompt, context.packet);
    const signalsFocusedEdit =
      Boolean(params.artifactId) &&
      signalsMutationIntent &&
      explicitlyTargetsFocusedArtifact;
    const ordinarySpectraRequested = requestsOrdinarySpectra(
      params.prompt,
      params.disableAgentRouting,
    );
    if (ordinarySpectraRequested && context.retainedAgentId)
      await mutate("spectraRuns:clearRetainedAgent", { runId: params.runId });
    let agentSelection = await selectAgentRuntime({
      actorClerkId: params.actorClerkId,
      prompt: params.prompt,
      requestedAgentId: params.agentId,
      disableRouting: params.disableAgentRouting,
      retainedAgentId: context.retainedAgentId,
    });
    if (
      agentSelection &&
      agentSelection.source !== "explicit" &&
      !agentCanHandleLikelyMutation(agentSelection.runtime, {
        hasCreation: provisionalShells.length > 0,
        hasFocusedEdit: signalsFocusedEdit,
      })
    ) {
      if (agentSelection.source === "continued")
        await mutate("spectraRuns:clearRetainedAgent", {
          runId: params.runId,
        });
      agentSelection = null;
    }
    if (
      agentSelection?.source === "explicit" &&
      !agentCanHandleLikelyMutation(agentSelection.runtime, {
        hasCreation: provisionalShells.length > 0,
        hasFocusedEdit: signalsFocusedEdit,
      })
    )
      throw new Error(
        `${agentSelection.descriptor.title} does not have the capability required for this change. Switch to ordinary Spectra or enable the capability and publish a new agent release.`,
      );
    if (agentSelection) {
      await mutate("spectraRuns:setAgentRouting", {
        runId: params.runId,
        executionId: params.executionId,
        agentId: agentSelection.descriptor.agentId,
        confidence: agentSelection.confidence,
        reason: agentSelection.reason,
        source: agentSelection.source,
      });
      publish({
        type: "agent_routed",
        runId: params.runId,
        agentId: agentSelection.descriptor.agentId,
        agentVersionId: agentSelection.runtime.versionId,
        title: agentSelection.descriptor.title,
        confidence: agentSelection.confidence,
        reason: agentSelection.reason,
        source: agentSelection.source,
        reversible: true,
      });
    }
    const modelContextPacket = agentSelection
      ? {
          ...context.packet,
          selectedAgent: {
            ...agentSelection.runtime,
            routingDecision: {
              confidence: agentSelection.confidence,
              reason: agentSelection.reason,
              source: agentSelection.source,
              reversible: true,
            },
          },
        }
      : context.packet;
    recordPhase("context_ready");
    await mutate("spectraRuns:updateStatus", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      status: "running",
      phase: "retrieving",
      resultTitle:
        explicitlyTargetsFocusedArtifact && context.focusedArtifact?.title
          ? `Reviewing ${context.focusedArtifact.title}`
          : context.currentWorkspace?.title
            ? `Mapping ${context.currentWorkspace.title}`
            : "Preparing the requested work",
      resultSummary:
        explicitlyTargetsFocusedArtifact && context.focusedArtifact?.title
          ? "Inspecting the permissioned live artifact state"
          : context.currentWorkspace?.title
            ? "Inspecting the permissioned workspace map"
            : "Assembling only the permissioned context needed for this request",
      resultActions: [],
    });
    const persistedConversation =
      context.conversation.at(-1)?.role === "user" &&
      context.conversation.at(-1)?.content === params.prompt
        ? context.conversation.slice(0, -1)
        : context.conversation;
    const conversation = persistedConversation.slice(-30);
    await mutate("spectraRuns:setContextSnapshot", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      contextSnapshot: {
        qualityRequirements: { numericSourceRequired: hasNumericTableSource(params.attachments ?? []) },
        workspaceId: params.workspaceId,
        scopeNodeId: params.scopeNodeId,
        artifactId: params.artifactId,
        threadId: params.threadId,
        focusMode: context.focusMode,
        selectedObjectIds: context.selectedArtifactIds,
        explicitContextObjects: params.explicitContextObjects,
        currentView: params.currentView,
        requestedAgentId: params.agentId,
        disableAgentRouting: params.disableAgentRouting,
        clarificationId: params.clarificationId,
        choiceMessageId: params.choiceMessageId,
        choiceKey: params.choiceKey,
        clarificationExecutionId: params.clarificationExecutionId,
        batchSelections: params.batchSelections,
        executionId: params.executionId,
        packetVersion: 2,
        capturedAt: Date.now(),
      },
    });
    const workspaceTitle = context.currentWorkspace?.title;
    let provenance = {
      artifactIds: context.selectedArtifactIds,
      artifactTitles: context.packet.selectedObjects.flatMap((item) =>
        typeof item.title === "string" && item.title.trim() ? [item.title] : [],
      ),
      threadId: params.threadId,
      workspaceId: params.workspaceId,
      workspaceTitle,
      attachmentNames:
        params.attachments?.map((attachment) => attachment.name) ?? [],
      attachmentIds:
        params.attachments?.flatMap((attachment) =>
          attachment.id ? [attachment.id] : [],
        ) ?? [],
      research: undefined as
        | {
            status: "partial" | "saved";
            sourceIds: string[];
            evidenceIds: string[];
            citationCount: number;
          }
        | undefined,
      focusMode: context.focusMode,
      ...(agentSelection
        ? {
            agentId: agentSelection.descriptor.agentId,
            agentVersionId: agentSelection.runtime.versionId,
            agentTitle: agentSelection.descriptor.title,
            agentRoutingReason: agentSelection.reason,
            agentRoutingSource: agentSelection.source,
          }
        : {}),
    };
    const owned = ownedReferences(context);
    if (
      explicitlyTargetsFocusedArtifact &&
      params.artifactId &&
      context.focusedArtifact?.title
    )
      publish({
        type: "progress",
        runId: params.runId,
        title: `Reviewing ${context.focusedArtifact.title}`,
        detail:
          "Inspecting the current live state and permitted linked context",
        activity: "inspect",
        artifactType: context.focusedArtifact.blueprintKey,
      });
    else if (workspaceTitle)
      publish({
        type: "progress",
        runId: params.runId,
        title: `Mapping ${workspaceTitle}`,
        detail: "Finding the permissioned objects relevant to this request",
        activity: "retrieve",
      });
    // Deterministic focused tools are whole-request shortcuts. Never let one
    // recognized field (for example a tag) swallow a larger create+link task;
    // mixed work belongs to the dependency-aware task graph below.
    // P4.I1 preserves the existing bounded context packet as intake input.
    // P4.I2 owns splitting breadth-first indexing from post-resolution depth.
    loop.enter("plan");
    const focusedToolPlan =
      parallelCreations.length || (params.attachments?.length ?? 0) > 0
        ? null
        : (explicitlyTargetsFocusedArtifact
            ? (fastFocusedPlannerPlan(params.prompt, context.focusedArtifact) ??
              fastFocusedDeckHintPlan(params.prompt, context.focusedArtifact) ??
              fastFocusedQuizSettingsPlan(
                params.prompt,
                context.focusedArtifact,
              ) ??
              fastFocusedMetadataPlan(params.prompt, context.focusedArtifact))
            : null);
    if (focusedToolPlan) {
      publish({
        type: "status",
        runId: params.runId,
        message: "Applying the requested focused fields",
      });
      const focusedOperation = focusedToolPlan.operations[0];
      if (
        focusedOperation?.type === "artifact.update" &&
        focusedOperation.input.contentPatch &&
        context.focusedArtifact?.content !== undefined
      ) {
        const patchedContent = applyContentPatch(
          context.focusedArtifact.content,
          focusedOperation.input.contentPatch,
        );
        const changedPaths = effectChangedPathsForUpdate(
          focusedOperation,
          patchedContent,
        );
        publish({
          type: "artifact_patch",
          runId: params.runId,
          operationId: "focused-preview",
          artifactId: focusedOperation.input.artifactId,
          patch: {
            content: patchedContent,
            contentPatch: focusedOperation.input.contentPatch,
            changedPaths,
            progress: 0.82,
          },
        });
      }
    }
    let modelAttachments = params.attachments ?? [];
    const visualSources = modelAttachments.filter((attachment) =>
      attachmentNeedsVisualEvidence(attachment, params.prompt),
    );
    if (
      !focusedToolPlan &&
      visualSources.length > 0 &&
      getSpectraAttachmentStrategy() === "legacy_visual_prepass"
    ) {
      publish({
        type: "progress",
        runId: params.runId,
        title:
          visualSources.length === 1
            ? `Inspecting ${visualSources[0]!.name}`
            : `Inspecting ${visualSources.length} attached files`,
        detail:
          "Reading only the visuals, layout, diagrams, and relationships needed for the request",
        activity: "inspect",
      });
      modelAttachments = await addDerivedVisualAttachments(
        modelAttachments,
        params.prompt,
      );
      if (
        modelAttachments.some(
          (attachment) =>
            attachment.handling === "image" &&
            attachment.data &&
            !attachment.extractedText,
        )
      )
        modelAttachments = await enrichImageAttachments(
          modelAttachments,
          executionSignal,
        );
    }
    const invokeModel: typeof callModel = parallelCreations.length
      ? (
          surface,
          prompt,
          modelContext,
          attachments,
          onPublicText,
          onReasoningText,
          signal,
          onPlanOperation,
          onRepairRetry,
          onProgressUpdate,
          onPartialCreation,
          actorClerkId,
          _forcedSingleCreation,
          _forceGeneralPlan,
          _forcedCoordination,
          onUiEvent,
        ) => {
          const callbacks = {
            onPublicText,
            onReasoningText,
            signal,
            onPlanOperation,
            onRepairRetry,
            onProgressUpdate,
            onPartialCreation,
            onUiEvent,
            actorClerkId,
          };
          return hasNonCreationMutationIntent(params.prompt)
            ? callMixedTaskGraphWorkers(
                surface,
                prompt,
                modelContext,
                attachments,
                parallelCreations,
                callbacks,
              )
            : callParallelCreationWorkers(
                surface,
                prompt,
                modelContext,
                attachments,
                parallelCreations,
                callbacks,
              );
        }
      : callModel;
    advanceProtocolState("running_model");
    const modelResult = focusedToolPlan
      ? {
          plan: focusedToolPlan,
          model: "spectra/focused-tools",
          provider: "Spectra",
          usage: undefined,
        }
      : await invokeModel(
          params.surface,
          params.prompt,
          {
            ...modelContextPacket,
            // The bounded packet normally carries only a focused excerpt.
            // A direct region edit needs the canonical block/field tree once;
            // including it here prevents a redundant read_artifact turn while
            // broad and ambiguous work keeps the compact on-demand strategy.
            ...(explicitlyTargetsFocusedArtifact &&
            promptDirectlyUsesFocusedContent(params.prompt) &&
            context.focusedArtifact
              ? { focusedArtifact: boundedArtifactRead(context.focusedArtifact, { prompt: params.prompt }) }
              : {}),
            conversation,
          },
          modelAttachments,
          (content, mode) => {
            if (!markedStreaming) {
              markedStreaming = true;
              eventWrite = eventWrite
                .then(() =>
                  mutate("spectraRuns:updateStatus", {
                    actorClerkId: params.actorClerkId,
                    runId: params.runId,
                    executionId: params.executionId,
                    status: "running",
                    phase: "streaming",
                  }),
                )
                .catch(() => null);
            }
            publicText = mode === "replace" ? content : publicText + content;
            // Success-facing prose stays withheld until every guarded native
            // operation has durably committed and verified. Progress and
            // artifact presence continue live, but the assistant cannot claim
            // completion while the actual work is still synchronizing.
          },
          undefined,
          executionSignal,
          (rawOperation, index) => {
            const progressiveWrite = (async () => {
              let operation: ModelOperation;
              try {
                operation = parseModelOperation(rawOperation);
              } catch {
                return;
              }
              assertRequestedArtifactContent([operation], params.prompt);
              if (operation.type === "artifact.create") {
                if (streamedCreationPreview)
                  await Promise.all(progressiveWrites);
                const workspaceId =
                  operation.input.placement === "inbox"
                    ? undefined
                    : (operation.input.workspaceId ??
                      (params.surface === "workspace" ||
                      params.surface === "artifact"
                        ? params.workspaceId
                        : undefined));
                const existingPendingId =
                  earlyPendingBlueprintByIndex.get(index) ===
                  operation.input.blueprintKey
                    ? earlyPendingByIndex.get(index)
                    : undefined;
                const pendingArtifactId =
                  existingPendingId ??
                  (
                    await mutate<unknown & object, { artifactId: string }>(
                      "spectraArtifacts:createPending",
                      {
                        actorClerkId: params.actorClerkId,
                        blueprintKey: operation.input.blueprintKey,
                        title: operation.input.title,
                        workspaceId,
                        runId: params.runId,
                        executionId: params.executionId,
                        threadId: params.threadId,
                        sourceAttachmentIds: params.attachments?.flatMap((attachment) =>
                          attachment.id ? [attachment.id] : [],
                        ),
                      },
                    )
                  ).artifactId;
                earlyPendingByIndex.set(index, pendingArtifactId);
                earlyPendingBlueprintByIndex.set(
                  index,
                  operation.input.blueprintKey,
                );
                pendingArtifactCount = earlyPendingByIndex.size;
                hadVisibleActivity = true;
                bindArtifactEffect(index, pendingArtifactId);
                publish({
                  type: "operation_preview",
                  runId: params.runId,
                  operationId: `preview-${index + 1}`,
                  operationType: operation.type,
                  preview: {
                    ...safeOperationPreview(operation),
                    pendingArtifactId,
                  },
                });
                const frames = streamedCreationPreview
                  ? [
                      {
                        content: operation.input.content,
                        progress: 0.94,
                      },
                    ]
                  : progressiveArtifactFrames(
                      operation.input.blueprintKey,
                      operation.input.content,
                    );
                for (
                  let frameIndex = 0;
                  frameIndex < frames.length;
                  frameIndex += 1
                ) {
                  const frame = frames[frameIndex]!;
                  await queueArtifactPreviewWrite(pendingArtifactId, () =>
                    mutate("spectraArtifacts:patchPendingContent", {
                      actorClerkId: params.actorClerkId,
                      artifactId: pendingArtifactId,
                      runId: params.runId,
                      executionId: params.executionId,
                      content: encodeArtifactContentForStorage(
                        operation.input.blueprintKey,
                        frame.content,
                      ),
                      progress: frame.progress,
                      title: operation.input.title,
                      // Progress belongs to aiProgress/the live trace. Never
                      // overwrite durable artifact metadata with an ephemeral
                      // implementation status, especially when an approval can
                      // leave the pending shell visible for several minutes.
                      // Still replace createPending placeholders with a derived
                      // content summary so hollow leftovers never keep
                      // "Spectra is building New sheets".
                      summary: normalizeCreationSummary(
                        operation.input.summary,
                        operation.input.blueprintKey,
                        operation.input.title,
                        frame.content,
                        params.prompt,
                      ),
                    }),
                  );
                  publish({
                    type: "artifact_patch",
                    runId: params.runId,
                    operationId: `preview-${index + 1}`,
                    artifactId: pendingArtifactId,
                    patch: {
                      content: frame.content,
                      progress: frame.progress,
                      // Whole-create frames replace content; advertise paths so
                      // mid-open studios light regions before Convex sync.
                      // Sheets keep [] (cell-exact only) via progressive frames.
                      changedPaths:
                        ("changedPaths" in frame
                          ? frame.changedPaths
                          : undefined) ??
                        (operation.input.blueprintKey === "sheets"
                          ? []
                          : ["/"]),
                    },
                  });
                  if (frameIndex < frames.length - 1)
                    await new Promise((resolve) => setTimeout(resolve, 90));
                }
              } else if (operation.type === "workspace.create") {
                const pending = await mutate<
                  unknown & object,
                  { workspaceId: string }
                >("spectraWorkspaces:createPending", {
                  actorClerkId: params.actorClerkId,
                  runId: params.runId,
                  executionId: params.executionId,
                  title: operation.input.title,
                  description: operation.input.description ?? undefined,
                  icon: operation.input.icon ?? undefined,
                  color: operation.input.color ?? undefined,
                });
                earlyPendingWorkspaceByIndex.set(index, pending.workspaceId);
                publish({
                  type: "operation_preview",
                  runId: params.runId,
                  operationId: `preview-${index + 1}`,
                  operationType: operation.type,
                  preview: safeOperationPreview(operation),
                });
              } else if (
                operation.type === "workspace.update" &&
                owned.workspaceIds.has(operation.input.workspaceId)
              ) {
                await mutate("spectraWorkspaces:stageAiPatch", {
                  actorClerkId: params.actorClerkId,
                  workspaceId: operation.input.workspaceId,
                  runId: params.runId,
                  executionId: params.executionId,
                  title: operation.input.title ?? undefined,
                  description: operation.input.description ?? undefined,
                  icon: operation.input.icon ?? undefined,
                  color: operation.input.color ?? undefined,
                });
                publish({
                  type: "operation_preview",
                  runId: params.runId,
                  operationId: `preview-${index + 1}`,
                  operationType: operation.type,
                  preview: safeOperationPreview(operation),
                });
              }
            })().catch(() => null);
            progressiveWrites.push(progressiveWrite);
          },
          () => {
            publishNativeProgress({
              title: "Taking another careful pass",
              detail: "Keeping your request in focus",
              activity: "plan",
            });
            void mutate("spectraRuns:patchResultCard", {
              actorClerkId: params.actorClerkId,
              resultCardId: params.resultCardId,
              executionId: params.executionId,
              title: "Taking another careful pass",
              summary: "Keeping your request in focus",
            }).catch(() => null);
          },
          (update) => {
            const progress = normalizeNativeProgress(update);
            if (!progress) return;
            publishNativeProgress(progress);
            // Durable tabs are rendered from the canonical result card, while
            // the open conversation uses the live event stream. Persist each
            // sparse, meaningful phase so both surfaces tell the same story
            // and refresh does not fall back to a stale generic label.
            eventWrite = eventWrite
              .then(() =>
                mutate("spectraRuns:patchResultCard", {
                  actorClerkId: params.actorClerkId,
                  resultCardId: params.resultCardId,
                  executionId: params.executionId,
                  title: progress.title,
                  summary:
                    progress.detail ?? progress.regionHint ?? progress.title,
                }),
              )
              .catch(() => null);
          },
          (
            { blueprintKey, title, content, itemCount, itemLabel },
            workerIndex = 0,
          ) => {
            streamedCreationPreview = true;
            hadVisibleActivity = true;
            console.info("[spectra.run.partial_creation]", {
              runId: params.runId,
              blueprintKey,
              itemCount,
              itemLabel,
              titleCharacters: title?.length ?? 0,
              totalMs: Date.now() - attemptStartedAt,
            });
            const progressiveWrite = (async () => {
              const pendingArtifactId = earlyPendingByIndex.get(workerIndex);
              if (
                !pendingArtifactId ||
                earlyPendingBlueprintByIndex.get(workerIndex) !== blueprintKey
              )
                return;
              const progress = Math.min(0.82, 0.14 + itemCount * 0.11);
              await queueArtifactPreviewWrite(pendingArtifactId, () =>
                mutate("spectraArtifacts:patchPendingContent", {
                  actorClerkId: params.actorClerkId,
                  artifactId: pendingArtifactId,
                  runId: params.runId,
                  executionId: params.executionId,
                  content: encodeArtifactContentForStorage(blueprintKey, content),
                  progress,
                  title,
                  summary: normalizeCreationSummary(
                    undefined,
                    blueprintKey,
                    title || `New ${itemLabel}`,
                    content,
                    params.prompt,
                  ),
                }),
              );
              publish({
                type: "artifact_patch",
                runId: params.runId,
                operationId: `preview-${workerIndex + 1}`,
                artifactId: pendingArtifactId,
                patch: {
                  blueprintKey,
                  content,
                  progress,
                  itemCount,
                },
              });
              publishNativeProgress({
                title: title
                  ? `Building ${title}`
                  : `Building ${itemLabel} ${itemCount}`,
                detail: `${itemCount} ${itemCount === 1 ? itemLabel : `${itemLabel}s`} formed in the live artifact`,
                activity: "create",
                operationIndex: workerIndex,
                artifactType: blueprintKey,
                regionHint: `${itemLabel}:${itemCount}`,
              });
            })().catch(() => null);
            progressiveWrites.push(progressiveWrite);
          },
          params.actorClerkId,
          provisionalCreation
            ? { ...provisionalCreation, clause: params.prompt }
            : undefined,
          false,
          false,
          (event) =>
            publish({
              type: "ui_event",
              runId: params.runId,
              key: event.key,
              payload: event.payload,
            }),
        );
    const researchEvidence =
      "researchEvidence" in modelResult
        ? modelResult.researchEvidence
        : undefined;
    const requiresResearchEvidence = Boolean(researchEvidence);
    const verificationOptions = { requireResearchEvidence: requiresResearchEvidence, prompt: params.prompt,
      numericSourceRequired: hasNumericTableSource(params.attachments ?? []) };
    if (researchEvidence) {
      await mutate("spectraRuns:setResearchEvidence", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        researchEvidence,
      });
      provenance = {
        ...provenance,
        research: {
          status:
            researchEvidence.partial === true ? "partial" : "saved",
          sourceIds: researchEvidence.sources.map((source) => source.id),
          evidenceIds: researchEvidence.evidence.map((span) => span.id),
          citationCount: researchEvidence.citations.length,
        },
      };
    }
    recordPhase("model_ready");
    await partialWrite;
    const progressiveWritesReady = Promise.all(progressiveWrites);
    let plan: SpectraPlan;
    let targetTitlesById = new Map<string, string>();
    try {
      loop.enter("resolve");
      const resolved = resolveAndValidatePlan(
        modelResult.plan,
        context,
        params.prompt,
      );
      plan = resolved.plan;
      const resolvedTargetIds = resolved.targetResolutions.flatMap((target) =>
        target.status === "resolved" &&
        target.resolvedArtifactId &&
        !target.resolvedArtifactId.startsWith("@created:")
          ? [target.resolvedArtifactId]
          : [],
      );
      loop.enter("gather");
      const resolvedTargetContext = await gatherResolvedArtifactContext(
        params.actorClerkId,
        resolvedTargetIds,
      );
      const gatheredTargetIds = new Set(
        resolvedTargetContext.flatMap(({ artifact }) =>
          typeof artifact._id === "string" ? [artifact._id] : [],
        ),
      );
      if (
        resolvedTargetIds.some(
          (artifactId) => !gatheredTargetIds.has(artifactId),
        )
      )
        throw new Error(
          "The resolved artifactId context could not be loaded safely before mutation.",
        );
      const resolvedSummaries = resolvedTargetContext.map(({ artifact }) =>
        summarizeArtifact(artifact, true),
      );
      const resolvedById = new Map(
        resolvedSummaries.flatMap((artifact) =>
          typeof artifact.id === "string"
            ? [[artifact.id, artifact] as const]
            : [],
        ),
      );
      const contextWithResolvedTargets = {
        ...context,
        artifacts: context.artifacts.map(
          (artifact) => resolvedById.get(String(artifact.id)) ?? artifact,
        ),
        focusedArtifact:
          context.focusedArtifact &&
          typeof context.focusedArtifact.id === "string"
            ? (resolvedById.get(context.focusedArtifact.id) ??
              context.focusedArtifact)
            : context.focusedArtifact,
      };
      if (resolvedTargetContext.length > 0) {
        plan = validatePlanAgainstIntent(
          reconcileExplicitDocumentRegions(
            plan,
            params.prompt,
            contextWithResolvedTargets,
          ),
          ownedReferences(contextWithResolvedTargets),
        );
      }
      targetTitlesById = new Map(
        resolved.targetResolutions.flatMap((target) =>
          target.status === "resolved" &&
          target.resolvedArtifactId &&
          target.resolvedTitle
            ? [[target.resolvedArtifactId, target.resolvedTitle] as const]
            : [],
        ),
      );
      const resolvedTitles = [...new Set(targetTitlesById.values())];
      provenance = {
        ...provenance,
        artifactIds: [
          ...new Set([...provenance.artifactIds, ...resolvedTargetIds]),
        ],
        artifactTitles: [
          ...new Set([...provenance.artifactTitles, ...resolvedTitles]),
        ],
      };
      await mutate("spectraRuns:setContextSnapshot", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        contextSnapshot: {
          workspaceId: params.workspaceId,
          scopeNodeId: params.scopeNodeId,
          artifactId: params.artifactId,
          threadId: params.threadId,
          focusMode: context.focusMode,
          selectedObjectIds: context.selectedArtifactIds,
          explicitContextObjects: params.explicitContextObjects,
          currentView: params.currentView,
          requestedAgentId: params.agentId,
          disableAgentRouting: params.disableAgentRouting,
          packetVersion: 2,
          targetResolutions: resolved.targetResolutions.map((target) => ({
            role: target.role,
            requestedReference: target.requestedReference,
            status: target.status,
            confidence: target.confidence,
            resolvedArtifactId: target.resolvedArtifactId,
            resolvedTitle: target.resolvedTitle,
            candidates: target.candidates.map((candidate) => ({
              id: candidate.id,
              title: candidate.title,
              confidence: candidate.confidence,
            })),
          })),
          capturedAt: Date.now(),
        },
      });
    } catch (resolveError) {
      // callModel already performs the single bounded repair against its
      // existing draft. Never restart the full model pass here.
      throw resolveError;
    }
    // The shallow index is always present; only resolved targets were hydrated
    // above, before any mutation is recorded or applied.
    assertSelectedAgentAllowsOperations(modelContextPacket, plan.operations);
    const primaryResolvedTitle = targetTitlesById.values().next().value as
      string | undefined;
    if (primaryResolvedTitle)
      publish({
        type: "progress",
        runId: params.runId,
        title: `Reviewing ${primaryResolvedTitle}`,
        detail: "Inspecting the resolved live target before applying changes",
        activity: "inspect",
      });
    if (plan.operations.length > 0)
      publish({
        type: "progress",
        runId: params.runId,
        title: `Validating ${plan.operations.length} planned ${plan.operations.length === 1 ? "change" : "changes"}`,
        detail:
          "Checking live permissions, typed inputs, and preservation rules before any commit",
        activity: "verify",
      });
    assertRequestedArtifactContent(plan.operations, params.prompt);
    const metadataWrite =
      plan.conversationTitle || plan.conversationSummary
        ? params.threadId
          ? mutate("spectraThreads:applyGeneratedMetadata", {
              actorClerkId: params.actorClerkId,
              threadId: params.threadId,
              runId: params.runId,
              executionId: params.executionId,
              title: plan.conversationTitle ?? undefined,
              summary: plan.conversationSummary ?? undefined,
            }).catch(() => null)
          : mutate("spectraRuns:setSuggestedThreadMetadata", {
              actorClerkId: params.actorClerkId,
              runId: params.runId,
              executionId: params.executionId,
              title: plan.conversationTitle ?? undefined,
              summary: plan.conversationSummary ?? undefined,
            }).catch(() => null)
        : Promise.resolve(null);
    await hydrateApplicationLocalFileCounts(
      params.actorClerkId,
      plan.operations,
    );
    const basePolicy = evaluatePlanPolicy(plan.operations, {
      intent: plan.intent,
    });
    const agentApprovalReasons = selectedAgentOperationApprovalReasons(
      modelContextPacket,
      plan.operations,
    );
    const policy = {
      requiresConfirmation:
        basePolicy.requiresConfirmation || agentApprovalReasons.length > 0,
      reasons: [...basePolicy.reasons, ...agentApprovalReasons],
    };
    const storedWrite = mutate<
      {
        actorClerkId: string;
        runId: string;
        executionId: string;
        operations: Array<{
          type: string;
          input: unknown;
          requiresConfirmation: boolean;
        }>;
      },
      { operationIds: string[] }
    >("spectraOperations:recordPlan", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      operations: plan.operations.map((operation) => ({
        type: operation.type,
        input: operation.input,
        requiresConfirmation: policy.requiresConfirmation,
      })),
    });
    const [stored] = await Promise.all([
      storedWrite,
      metadataWrite,
      progressiveWritesReady,
    ]);
    // Derive destructive artifact effects from the stored plan and authorized
    // current content; neither a model flag nor patch syntax grants approval.
    const artifactPolicy = await act<{ runId: string; executionId: string }, { approvalReasons: string[] }>(
      "spectraArtifactWrites:preparePlan",
      { runId: params.runId, executionId: params.executionId },
    );
    if (artifactPolicy.approvalReasons.length > 0) {
      policy.requiresConfirmation = true;
      policy.reasons.push(...artifactPolicy.approvalReasons);
    }
    recordPhase("plan_recorded");
    const pendingArtifacts = new Map<string, string>();
    for (let index = 0; index < stored.operationIds.length; index += 1) {
      const operationId = stored.operationIds[index]!;
      const operation = plan.operations[index];
      let pendingArtifactId: string | undefined;
      if (
        operation?.type === "artifact.create" &&
        !policy.requiresConfirmation
      ) {
        pendingArtifactId =
          earlyPendingBlueprintByIndex.get(index) ===
          operation.input.blueprintKey
            ? earlyPendingByIndex.get(index)
            : undefined;
        if (!pendingArtifactId) {
          const workspaceId =
            operation.input.placement === "inbox"
              ? undefined
              : (operation.input.workspaceId ??
                (params.surface === "workspace" || params.surface === "artifact"
                  ? params.workspaceId
                  : undefined));
          const pending = await mutate<
            unknown & object,
            { artifactId: string }
          >("spectraArtifacts:createPending", {
            actorClerkId: params.actorClerkId,
            blueprintKey: operation.input.blueprintKey,
            title: operation.input.title,
            workspaceId,
            runId: params.runId,
            executionId: params.executionId,
            threadId: params.threadId,
            sourceAttachmentIds: params.attachments?.flatMap((attachment) =>
              attachment.id ? [attachment.id] : [],
            ),
          });
          pendingArtifactId = pending.artifactId;
          earlyPendingByIndex.set(index, pendingArtifactId);
          earlyPendingBlueprintByIndex.set(index, operation.input.blueprintKey);
          pendingArtifactCount = earlyPendingByIndex.size;
          hadVisibleActivity = true;
        }
        pendingArtifacts.set(operationId, pendingArtifactId);
      }
      if (
        operation?.type === "artifact.create" &&
        earlyPendingByIndex.get(index) &&
        earlyPendingBlueprintByIndex.get(index) === operation.input.blueprintKey
      ) {
        pendingArtifactId = earlyPendingByIndex.get(index);
        pendingArtifacts.set(operationId, pendingArtifactId!);
        await mutate("spectraOperations:attachPendingArtifact", {
          actorClerkId: params.actorClerkId,
          operationId,
          artifactId: pendingArtifactId,
          executionId: params.executionId,
        });
      }
      if (operation?.type === "artifact.create" && pendingArtifactId)
        bindArtifactEffect(index, pendingArtifactId);
      if (operation?.type === "artifact.update")
        bindArtifactEffect(index, operation.input.artifactId);
      if (operation && !latestArtifactProgressByIndex.has(index)) {
        const fallbackProgress = operationEffectProgress(
          operation,
          index,
          operation.type === "artifact.update"
            ? targetTitlesById.get(operation.input.artifactId)
            : undefined,
        );
        if (fallbackProgress) publishNativeProgress(fallbackProgress);
      }
      if (
        operation?.type === "workspace.create" &&
        earlyPendingWorkspaceByIndex.get(index)
      ) {
        await mutate("spectraOperations:attachPendingWorkspace", {
          actorClerkId: params.actorClerkId,
          operationId,
          workspaceId: earlyPendingWorkspaceByIndex.get(index)!,
          executionId: params.executionId,
        });
      }
      publish({
        type: "operation_preview",
        runId: params.runId,
        operationId,
        operationType: operation?.type ?? "unknown",
        preview: operation
          ? {
              ...safeOperationPreview(
                operation,
                operation.type === "artifact.update" ||
                  operation.type === "artifact.archive" ||
                  operation.type === "workspaceItem.add"
                  ? targetTitlesById.get(operation.input.artifactId)
                  : operation.type === "artifact.link"
                    ? targetTitlesById.get(operation.input.sourceArtifactId)
                    : undefined,
              ),
              pendingArtifactId,
            }
          : undefined,
      });
    }

    if (plan.decision !== "operate") {
      loop.enter("report", "answer, clarification, and refusal do not mutate");
      await Promise.all([
        mutate("spectraArtifacts:discardPendingForRun", {
          actorClerkId: params.actorClerkId,
          runId: params.runId,
          executionId: params.executionId,
        }).catch(() => null),
        mutate("spectraArtifacts:settleStagedForRun", {
          actorClerkId: params.actorClerkId,
          runId: params.runId,
          executionId: params.executionId,
          outcome: "clear",
        }).catch(() => null),
        mutate("spectraWorkspaces:settleForRun", {
          actorClerkId: params.actorClerkId,
          runId: params.runId,
          executionId: params.executionId,
          outcome: "clear",
        }).catch(() => null),
      ]);
      const title =
        plan.decision === "clarify"
          ? "Needs clarification"
          : plan.decision === "refuse"
            ? "Unable to apply"
            : "Answer";
      await mutate("spectraRuns:updateStatus", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        status: plan.decision === "clarify" ? "awaiting_resolution" : "completed",
        outcome:
          plan.decision === "clarify" ? "awaiting_input" : "answer_only",
        decision: plan.decision,
        planIntent: plan.intent,
        finalSummary: plan.finalResponse,
        resultTitle: title,
        resultSummary: plan.finalResponse,
        resultVariant: "status",
        resultActions: [],
        provenance,
        modelUsed: modelResult.model,
        providerUsed: modelResult.provider,
        usage: modelResult.usage,
      });
      stopHeartbeat();
      await saveAssistantMessage({
        actorClerkId: params.actorClerkId,
        threadId: params.threadId,
        runId: params.runId,
        executionId: params.executionId,
        content: plan.finalResponse,
        decision: plan.decision,
        model: modelResult.model,
        provider: modelResult.provider,
        usage: modelResult.usage,
        choices: plan.choices,
      });
      await queueSilentMemoryMaintenance({
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        prompt: params.prompt,
        threadId: params.threadId,
        workspaceId: params.workspaceId,
        artifactId: params.artifactId,
        retrieval: context.memoryRetrieval,
      });
      card = await latestCard(params.actorClerkId, params.runId);
      publish({
        type: "text_replace",
        runId: params.runId,
        content: plan.finalResponse,
      });
      publish({
        type: "final",
        runId: params.runId,
        summary: plan.finalResponse,
        card: streamCard(card),
      });
      await flushEvents();
      advanceProtocolState("completed");
      return;
    }

    if (policy.requiresConfirmation) {
      loop.enter("report", "mutation is paused for confirmation");
      advanceProtocolState("waiting_for_user", "approval_required");
      const codeProposal = policy.reasons.some((reason) =>
        /Code|runtime resources|network-policy|dependency/i.test(reason),
      );
      const actions: ResultAction[] = [
        {
          key: "confirm",
          label: codeProposal ? "Apply proposal" : "Confirm",
          targetType: "run",
          targetId: params.runId,
        },
        {
          key: "cancel",
          label: "Cancel",
          targetType: "run",
          targetId: params.runId,
        },
      ];
      await mutate("spectraRuns:updateStatus", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        status: "awaiting_confirmation",
        phase: "approval",
        approvalReasons: policy.reasons,
        decision: plan.decision,
        planIntent: plan.intent,
        finalSummary: plan.finalResponse,
        resultTitle: codeProposal
          ? "Review Code proposal"
          : "Confirmation required",
        resultSummary:
          confirmationDiffSummary({
            targetTitles: provenance.artifactTitles ?? [],
            reasons: policy.reasons,
          }) || policy.reasons.join(" · "),
        resultVariant: "operation",
        resultActions: actions,
        provenance,
        modelUsed: modelResult.model,
        providerUsed: modelResult.provider,
        usage: modelResult.usage,
      });
      stopHeartbeat();
      await Promise.all([
        mutate("spectraArtifacts:pausePendingForApproval", {
          actorClerkId: params.actorClerkId,
          runId: params.runId,
          executionId: params.executionId,
        }).catch(() => null),
        mutate("spectraArtifacts:settleStagedForRun", {
          actorClerkId: params.actorClerkId,
          runId: params.runId,
          executionId: params.executionId,
          outcome: "clear",
        }).catch(() => null),
        mutate("spectraWorkspaces:pauseForApproval", {
          actorClerkId: params.actorClerkId,
          runId: params.runId,
          executionId: params.executionId,
        }).catch(() => null),
      ]);
      await saveAssistantMessage({
        actorClerkId: params.actorClerkId,
        threadId: params.threadId,
        runId: params.runId,
        executionId: params.executionId,
        content: plan.finalResponse,
        decision: plan.decision,
        awaitingConfirmation: true,
        model: modelResult.model,
        provider: modelResult.provider,
        usage: modelResult.usage,
      });
      card = await latestCard(params.actorClerkId, params.runId);
      publish({
        type: "text_replace",
        runId: params.runId,
        content: plan.finalResponse,
      });
      publish({
        type: "confirmation_required",
        runId: params.runId,
        reasons: policy.reasons,
        card: streamCard(card),
      });
      await flushEvents();
      return;
    }

    loop.enter("act");
    advanceProtocolState("performing_action");

    await mutate("spectraRuns:updateStatus", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      status: "running",
      phase: "applying",
      resultActions: [],
    });
    const allAffected: Array<{ type: string; id: string }> = [];
    const createdArtifactIds = new Map<number, string>();
    for (let index = 0; index < plan.operations.length; index += 1) {
      const operation = resolveCreatedArtifactDependencies(
        plan.operations[index]!,
        createdArtifactIds,
      );
      const operationId = stored.operationIds[index]!;
      if (operation.type === "artifact.update") {
        // The live performer is the sole source of provisional artifact state.
        // Publishing final JSON here used to make the editor reload first and
        // play decorative interaction frames afterwards.
      }
      const phases = operationPhases(
        operation,
        typeof workspaceTitle === "string" ? workspaceTitle : undefined,
      );
      for (const phase of phases)
        publish({ type: "status", runId: params.runId, message: phase });
      const lastPhase = phases.at(-1);
      if (lastPhase) {
        const effectProgress = operationEffectProgress(
          operation,
          index,
          operation.type === "artifact.update"
            ? targetTitlesById.get(operation.input.artifactId)
            : undefined,
        );
        await mutate("spectraRuns:patchResultCard", {
          actorClerkId: params.actorClerkId,
          resultCardId: params.resultCardId,
          executionId: params.executionId,
          title: effectProgress?.title ?? operationLabel(operation),
          summary: effectProgress?.detail ?? lastPhase,
        });
      }
      let lastApplyAcknowledged = false;
      try {
        commitStarted = true;
        const executeContext = {
          executionId: params.executionId,
          surface: params.surface,
          threadId: params.threadId,
          workspaceId: params.workspaceId,
          scopeNodeId: params.scopeNodeId,
          selectedArtifactIds: context.selectedArtifactIds,
          attachmentIds: params.attachments?.flatMap((attachment) =>
            attachment.id ? [attachment.id] : [],
          ),
          attachmentNames: params.attachments?.map(
            (attachment) => attachment.name,
          ),
          prompt: params.prompt,
          researchEvidence,
          contextSummary: context.selectedArtifactIds.length
            ? `Based on ${context.selectedArtifactIds.length} selected artifact${context.selectedArtifactIds.length === 1 ? "" : "s"}${params.threadId ? " and a continued thread" : ""}`
            : params.threadId
              ? "Based on a continued thread and visible focus"
              : params.artifactId
                ? "Based on the open artifact"
                : params.workspaceId
                  ? "Based on workspace context"
                  : "Based on global context",
          pendingArtifactId: pendingArtifacts.get(operationId),
          pendingWorkspaceId: earlyPendingWorkspaceByIndex.get(index),
          signal: executionSignal,
          operationIndex: index,
          onArtifactRegions: ({
            artifactId,
            regionIds,
          }: {
            artifactId: string;
            regionIds: string[];
          }) => {
            publish({
              type: "artifact_patch",
              runId: params.runId,
              operationId,
              artifactId,
              patch: {
                regionIds,
                effectRegionIds: regionIds,
              },
            });
          },
          onRegionConflict: async (conflict: {
            regionId: string;
            queuePosition: number;
            actorKind: "human" | "ai";
          }) => {
            publish({
              type: "operation_conflict",
              runId: params.runId,
              operationId,
              artifactId:
                operation.type === "artifact.update"
                  ? operation.input.artifactId
                  : undefined,
              regionId: conflict.regionId,
              queuePosition: conflict.queuePosition,
              actorKind: conflict.actorKind,
            });
            publish({
              type: "status",
              runId: params.runId,
              message: "Waiting for an active edit to finish",
            });
            await mutate("spectraRuns:patchResultCard", {
              actorClerkId: params.actorClerkId,
              resultCardId: params.resultCardId,
              executionId: params.executionId,
              title: "Waiting for an active edit",
              summary:
                "Spectra will continue automatically without overwriting the occupied region.",
            });
          },
          onRegionConflictResolved: async () => {
            const progress = operationEffectProgress(
              operation,
              index,
              operation.type === "artifact.update"
                ? targetTitlesById.get(operation.input.artifactId)
                : undefined,
            );
            publish({
              type: "status",
              runId: params.runId,
              message: progress?.detail ?? "Continuing the edit",
            });
            await mutate("spectraRuns:patchResultCard", {
              actorClerkId: params.actorClerkId,
              resultCardId: params.resultCardId,
              executionId: params.executionId,
              title: progress?.title ?? operationLabel(operation),
              summary:
                progress?.detail ??
                "The active control is free. Continuing from the current saved state.",
            });
          },
          onUiEvent: (event: {
            key: string;
            payload?: Record<string, unknown>;
          }) => {
            publish({
              type: "ui_event",
              runId: params.runId,
              key: event.key,
              payload: event.payload,
            });
            const note = event.payload?.note;
            if (
              event.key === "authority_notice" &&
              typeof note === "string" &&
              note.trim()
            )
              publish({
                type: "status",
                runId: params.runId,
                message: note,
              });
          },
        };
        // A thrown apply may follow a committed write. Content equality and
        // generic error wording cannot acknowledge this operation or authorize
        // replay. Leave ambiguous outcomes to exact-attempt journal reconciliation.
        unacknowledgedOperationId = operationId;
        let affected = await executeOperation(
          params.actorClerkId,
          params.runId,
          operationId,
          operation,
          executeContext,
        );
        lastApplyAcknowledged = true;
        unacknowledgedOperationId = undefined;
        const retainedOutcome = { operationId, operation, affected, acknowledged: lastApplyAcknowledged };
        await retainOutcomeThenVerify(operationOutcomes, retainedOutcome, async () => {
          if (operation.type === "artifact.update") {
            verificationIncomplete = true;
            const outcome = { operation, affected };
            try {
              await verifyCommittedOutcomes(params.actorClerkId, [outcome], {
                ...verificationOptions,
              });
            } catch (firstVerifyError) {
              if (!isQuietRetryableApplyFailure(firstVerifyError))
                throw firstVerifyError;
              // A projection can briefly lag the Yjs commit. Check once after a
              // short settle window; if the durable value is still wrong,
              // resume this exact operation against the artifact's current
              // state. Never restart planning or replay earlier operations.
              await new Promise((resolve) => setTimeout(resolve, 400));
              try {
                await verifyCommittedOutcomes(params.actorClerkId, [outcome], {
                  ...verificationOptions,
                });
              } catch (secondVerifyError) {
                if (!isQuietRetryableApplyFailure(secondVerifyError))
                  throw secondVerifyError;
                console.warn("[spectra.operation.current_state_retry]", {
                  operationId,
                  type: operation.type,
                  error: publicError(secondVerifyError),
                });
                publishNativeProgress({
                  title: "Finishing this edit",
                  detail: "Continuing from the current saved state",
                  activity: "edit",
                  operationIndex: index,
                  artifactType: operation.input.blueprintKey,
                });
                await mutate("spectraRuns:patchResultCard", {
                  actorClerkId: params.actorClerkId,
                  resultCardId: params.resultCardId,
                  executionId: params.executionId,
                  title: "Finishing this edit",
                  summary: "Continuing from the current saved state",
                }).catch(() => null);
                await mutate("spectraOperations:reopenForCurrentStateRetry", {
                  actorClerkId: params.actorClerkId,
                  operationId,
                  executionId: params.executionId,
                });
                lastApplyAcknowledged = false;
                verificationIncomplete = false;
                unacknowledgedOperationId = operationId;
                affected = await executeOperation(
                  params.actorClerkId,
                  params.runId,
                  operationId,
                  operation,
                  {
                    ...executeContext,
                    preclaimed: true,
                  },
                );
                lastApplyAcknowledged = true;
                unacknowledgedOperationId = undefined;
                retainedOutcome.acknowledged = true;
                retainedOutcome.affected = affected;
                verificationIncomplete = true;
                await verifyCommittedOutcomes(
                  params.actorClerkId,
                  [{ operation, affected }],
                  verificationOptions,
                );
              }
            }
          }
          verificationIncomplete = false;
        });
        allAffected.push(...affected);
        if (operation.type === "artifact.create") {
          const artifactId = affected.find(
            (item) => item.type === "artifact",
          )?.id;
          if (artifactId) createdArtifactIds.set(index, artifactId);
        }
        // A commit event is a durable fact, not an instruction to begin.
        // Publishing it before executeOperation made every client ledger claim
        // success while the native collaborator had only just acquired the
        // control. Keep the conversation, interaction performer, and saved
        // state on one causal timeline.
        publish({
          type: "operation_commit",
          runId: params.runId,
          operationId,
        });
        publish({
          type: "operation_result",
          runId: params.runId,
          operationId,
          affected,
        });
      } catch (error) {
        if (error instanceof AiArtifactRegionConflictError) {
          const pendingArtifactId = pendingArtifacts.get(operationId);
          await mutate("spectraOperations:pauseForRegionConflict", {
            actorClerkId: params.actorClerkId,
            operationId,
            executionId: params.executionId,
            artifactId: error.artifactId,
            claimId: error.claim.claimId,
            clientId: error.clientId,
            regionId: error.claim.conflict?.regionId ?? "occupied region",
            blockerActorKind: error.claim.conflict?.actorKind ?? "human",
            queuePosition: error.claim.conflict?.queuePosition ?? 1,
            baseSnapshot: error.baseSnapshot,
            proposedSnapshot: error.proposedSnapshot,
          });
          if (pendingArtifactId === error.artifactId) {
            await mutate("spectraArtifacts:pausePendingForConflict", {
              actorClerkId: params.actorClerkId,
              artifactId: pendingArtifactId,
              runId: params.runId,
              executionId: params.executionId,
            }).catch(() => null);
          }
          await mutate("spectraRuns:updateStatus", {
            actorClerkId: params.actorClerkId,
            runId: params.runId,
            executionId: params.executionId,
            status: "awaiting_resolution",
            phase: "conflict",
            decision: plan.decision,
            planIntent: plan.intent,
            finalSummary: plan.finalResponse,
            resultTitle: "Edit conflict",
            resultSummary:
              "Compare the current region with Spectra's proposal before deciding what to keep.",
            resultVariant: "operation",
            resultActions: [
              {
                key: "resolve_conflict",
                label: "Review conflict",
                targetType: "run",
                targetId: params.runId,
              },
            ],
            provenance,
            modelUsed: modelResult.model,
            providerUsed: modelResult.provider,
            usage: modelResult.usage,
          });
          stopHeartbeat();
          await Promise.all([
            mutate("spectraArtifacts:settleStagedForRun", {
              actorClerkId: params.actorClerkId,
              runId: params.runId,
              executionId: params.executionId,
              outcome: "clear",
            }),
            mutate("spectraWorkspaces:settleForRun", {
              actorClerkId: params.actorClerkId,
              runId: params.runId,
              executionId: params.executionId,
              outcome: "clear",
            }),
          ]);
          publish({
            type: "conflict_resolution_required",
            runId: params.runId,
            operationId,
            artifactId: error.artifactId,
            claimId: error.claim.claimId,
            regionId: error.claim.conflict?.regionId ?? "occupied region",
          });
          await flushEvents();
          return;
        }
        const pendingArtifactId = pendingArtifacts.get(operationId);
        if (pendingArtifactId)
          await mutate("spectraArtifacts:markAiState", {
            actorClerkId: params.actorClerkId,
            artifactId: pendingArtifactId,
            runId: params.runId,
            executionId: params.executionId,
            state: "failed",
          }).catch(() => null);
        if (operation.type === "artifact.update")
          await mutate("spectraArtifacts:markAiState", {
            actorClerkId: params.actorClerkId,
            artifactId: operation.input.artifactId,
            runId: params.runId,
            executionId: params.executionId,
            state: "failed",
          }).catch(() => null);
        if (!lastApplyAcknowledged) {
          await mutate("spectraOperations:markFailed", {
            actorClerkId: params.actorClerkId,
            operationId,
            executionId: params.executionId,
            error: publicError(error, { explanationOnly: true }),
          }).catch(() => null);
        }
        throw error;
      }
    }
    publish({
      type: "status",
      runId: params.runId,
      message: "Checking the saved result · Verifying the requested objects",
    });
    loop.enter("verify");
    verificationIncomplete = true;
    try {
      await verifyCommittedOutcomes(params.actorClerkId, operationOutcomes, {
        ...verificationOptions,
      });
    } catch (firstVerifyError) {
      // Projection/Yjs races can fail verify once after a successful apply.
      // Keep the strip streaming and retry once before any failed publish.
      if (!isQuietRetryableApplyFailure(firstVerifyError)) {
        throw firstVerifyError;
      } else {
        console.warn("[spectra.verify.encouragement_retry]", {
          error: publicError(firstVerifyError),
        });
        publishNativeProgress({
          title: "Taking another careful pass",
          detail: "Keeping your request in focus",
          activity: "verify",
        });
        await mutate("spectraRuns:patchResultCard", {
          actorClerkId: params.actorClerkId,
          resultCardId: params.resultCardId,
          executionId: params.executionId,
          title: "Taking another careful pass",
          summary: "Keeping your request in focus",
        }).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await verifyCommittedOutcomes(
          params.actorClerkId,
          operationOutcomes,
          verificationOptions,
        );
      }
    }
    verificationIncomplete = false;
    await Promise.all([
      mutate("spectraArtifacts:settleStagedForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        outcome: "clear",
      }),
      mutate("spectraWorkspaces:settleForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        outcome: "clear",
      }),
    ]);
    recordPhase("operations_committed_and_verified");
    // A speculative shell is finalized by a matching artifact.create. If the
    // final plan instead updates, answers, or creates a different object, it
    // must not leak into the workspace. Finalized artifacts no longer have the
    // pending AI state, so this only removes unused provisional shells.
    if (provisionalCreation)
      await mutate("spectraArtifacts:discardPendingForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
      }).catch(() => null);
    const presentedIds = [
      ...new Set(
        (plan.presentedArtifactIds ?? []).filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        ),
      ),
    ].slice(0, 8);
    const provenanceArtifactIds = [
      ...new Set([
        ...(provenance.artifactIds ?? []),
        ...allAffected
          .filter((item) => item.type === "artifact")
          .map((item) => item.id),
        ...presentedIds,
      ]),
    ].slice(0, 24);
    const actions: ResultAction[] = [
      ...provenanceArtifactIds.map((targetId) => ({
        key: "open" as const,
        label: "Open",
        targetType: "artifact" as const,
        targetId,
      })),
      ...(operationTypesArmRunUndo(plan.operations)
        ? [revertRunResultAction(params.runId)]
        : []),
    ];
    const mergedProvenance = {
      ...provenance,
      artifactIds: provenanceArtifactIds,
    };
    loop.enter("report");
    // Persist terminal run status before the assistant message. Chat hides the
    // live exchange and surfaces open-artifact cards as soon as that message
    // appears; racing the two lets the side panel look finished while Live Dock
    // is still on a running tab.
    await mutate("spectraRuns:updateStatus", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      status: "completed",
      decision: plan.decision,
      planIntent: plan.intent,
      finalSummary: plan.finalResponse,
      resultTitle: "Done",
      resultSummary: plan.finalResponse,
      resultVariant: provenanceArtifactIds.length > 0 ? "artifact" : "status",
      resultActions: actions,
      provenance: mergedProvenance,
      outcome: "canonical_saved",
      modelUsed: modelResult.model,
      providerUsed: modelResult.provider,
      usage: modelResult.usage,
    });
    stopHeartbeat();
    await saveAssistantMessage({
      actorClerkId: params.actorClerkId,
      threadId: params.threadId,
      runId: params.runId,
      executionId: params.executionId,
      content: plan.finalResponse,
      decision: plan.decision,
      affected: allAffected,
      model: modelResult.model,
      provider: modelResult.provider,
      usage: modelResult.usage,
    });
    await queueSilentMemoryMaintenance({
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      prompt: params.prompt,
      threadId: params.threadId,
      workspaceId: params.workspaceId,
      artifactId: params.artifactId,
      retrieval: context.memoryRetrieval,
    });
    card = await latestCard(params.actorClerkId, params.runId);
    recordPhase("final_state_persisted");
    publish({
      type: "text_replace",
      runId: params.runId,
      content: plan.finalResponse,
    });
    publish({
      type: "final",
      runId: params.runId,
      summary: plan.finalResponse,
      card: streamCard(card),
    });
    await flushEvents();
    advanceProtocolState("completed");
  } catch (error) {
    if (loop.currentStage() !== "report")
      loop.enter("report", "run failed before later stages completed");
    console.error(
      "[spectra.run.failure]",
      JSON.stringify({
        runId: params.runId,
        executionId: params.executionId,
        commitStarted,
        publicTextLength: publicText.length,
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        stack:
          error instanceof Error
            ? error.stack?.split("\n").slice(0, 8).join(" | ")
            : undefined,
      }),
    );
    // A streamed operation preview may still be writing when final plan parsing
    // or validation fails. Let those writes finish before cleanup so a late
    // stage cannot resurrect an `updating` artifact after the run is terminal.
    await Promise.allSettled(progressiveWrites);
    const latestAttempt = await query<
      { actorClerkId: string; runId: string },
      RunDetail
    >("spectraRuns:get", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
    })
      .catch(() => null);
    const abortDisposition = classifyRunAttemptAbort({
      current: latestAttempt
        ? {
            status: latestAttempt.run.status,
            executionId: latestAttempt.run.executionId,
            workerId: latestAttempt.run.workerId,
          }
        : null,
      executionId: params.executionId,
      workerId: params.workerId,
    });
    const effects = reconcileInterruptedEffects({
      executionId: params.executionId,
      acknowledged: operationOutcomes,
      operations: latestAttempt?.operations,
      run: latestAttempt?.run,
      attemptedEffect: commitStarted,
      unacknowledgedOperationId,
    });
    if (abortDisposition === "user_stopped") {
      advanceProtocolState("cancelled", "run_cancelled");
      await mutate("spectraOperations:cancelPending", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
      }).catch(() => null);
      await mutate("spectraArtifacts:discardPendingForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
      }).catch(() => null);
      await mutate("spectraArtifacts:settleStagedForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        outcome: "failed",
      }).catch(() => null);
      await mutate("spectraWorkspaces:settleForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        outcome: "failed",
      }).catch(() => null);
      await partialWrite;
      const stoppedWithVisibleWork = Boolean(
        publicText.trim() ||
        commitStarted ||
        hadVisibleActivity ||
        streamedCreationPreview ||
        pendingArtifactCount > 0,
      );
      const recovery = recoveryForAttempt(
        commitStarted ? ["executing"] : [],
        Boolean(publicText.trim()),
        false,
      );
      const durableArtifactWrite = effects.undoAvailable;
      // Stop API's spectraRuns:stopRun may already have armed retry/continue and
      // revert from durable executed ops. Only replace resultActions when this
      // worker still holds outcome evidence; otherwise preserve stopRun's card
      // actions so a late empty-outcomes cancel cannot strip Undo.
      await mutate("spectraRuns:updateStatus", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        status: "cancelled",
        resultTitle: "Stopped",
        resultSummary: interruptedEffectSummary(effects,
          recovery.retryable ? "You can retry the remaining request." : "Continue in this conversation for the remaining work.",
          { stopped: true, verificationFailed: verificationIncomplete }),
        outcome: effects.outcome,
        ...(durableArtifactWrite || effects.committedCount
          ? {
              resultActions: [
                ...(recovery.retryable
                  ? [
                      {
                        key: "retry" as const,
                        label: "Retry",
                        targetType: "run" as const,
                        targetId: params.runId,
                      },
                    ]
                  : params.threadId
                    ? [
                        {
                          key: "continue" as const,
                          label: "Continue in thread",
                          targetType: "thread" as const,
                          targetId: params.threadId,
                        },
                      ]
                    : []),
                ...interruptedEffectActions(effects, params.runId),
              ],
            }
          : {}),
        recoveryState: recovery.recoveryState,
        retryable: recovery.retryable,
        preservedPartial: recovery.preservedPartial,
      }).catch(() => null);
      publish({
        type: "stopped",
        runId: params.runId,
        partial: stoppedWithVisibleWork,
      });
      await flushEvents();
      return;
    }
    // A worker whose lease was replaced must not settle the newer owner's run
    // as failed, and an abort after a terminal transition must not replace the
    // already durable result. The active owner or stale-run reconciler will
    // publish the authoritative state.
    if (
      abortDisposition === "already_settled" ||
      abortDisposition === "ownership_lost" ||
      abortDisposition === "state_unavailable"
    ) {
      if (abortDisposition !== "already_settled")
        publish({ type: "interrupted", runId: params.runId });
      await flushEvents();
      return;
    }
    const preservedOutcome = effects.committedCount > 0;
    const recovery = recoveryForAttempt(
      commitStarted ? [preservedOutcome ? "executed" : "executing"] : [],
      Boolean(publicText.trim()),
      false,
    );
    advanceProtocolState(
      recovery.retryable ? "paused" : "failed_terminal",
      recovery.retryable
        ? "run_paused_after_recovery"
        : preservedOutcome
          ? "unrecoverable_run_failure"
          : "run_failed_after_commit_boundary",
    );
    const message = publicError(error, { explanationOnly: true });
    await mutate("spectraOperations:cancelPending", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
    }).catch(() => null);
    if (!commitStarted && !preservedOutcome)
      await mutate("spectraArtifacts:discardPendingForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
      }).catch(() => null);
    await mutate("spectraArtifacts:failPendingForRun", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
    }).catch(() => null);
    await mutate("spectraArtifacts:settleStagedForRun", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      outcome: "failed",
    }).catch(() => null);
    await mutate("spectraWorkspaces:settleForRun", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      outcome: "failed",
    }).catch(() => null);
    const resultSummary = interruptedEffectSummary(effects, message,
      { verificationFailed: verificationIncomplete });
    await mutate("spectraRuns:updateStatus", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      workerId: params.workerId,
      status: "failed",
      phase: preservedOutcome ? "partial" : "failed",
      outcome: effects.outcome,
      error: message,
      finalSummary: resultSummary,
      resultTitle: verificationIncomplete && effects.saved
        ? "Saved; verification incomplete"
        : preservedOutcome
          ? "Partially completed"
          : recovery.retryable
            ? "Paused"
            : "Needs review",
      resultSummary,
      resultVariant: "status",
      resultActions: [
        ...(recovery.retryable
          ? [
              {
                key: "retry" as const,
                label: "Retry",
                targetType: "run" as const,
                targetId: params.runId,
              },
            ]
          : params.threadId
            ? [
                {
                  key: "continue" as const,
                  label: "Continue in thread",
                  targetType: "thread" as const,
                  targetId: params.threadId,
                },
              ]
            : []),
        ...interruptedEffectActions(effects, params.runId),
      ],
      recoveryState: recovery.recoveryState,
      retryable: recovery.retryable,
      preservedPartial: recovery.preservedPartial,
    }).catch(() => null);
    stopHeartbeat();
    card = await latestCard(params.actorClerkId, params.runId).catch(
      () => card,
    );
    publish({
      type: "error",
      runId: params.runId,
      message: resultSummary,
      card: card ? streamCard(card) : undefined,
    });
    await flushEvents();
  } finally {
    clearInterval(heartbeat);
  }
}

function surfaceFromRun(run: RunState): Surface {
  // Maps durable run origin onto the active Spectra surface label.
  if (run.sourceSurface === "artifact")
    return run.artifactId ? "artifact" : "artifacts";
  return run.sourceSurface;
}

function verifyScheduledCallback(request: NextRequest, rawBody: string) {
  const base = process.env.SPECTRA_COLLAB_BRIDGE_KEY?.trim();
  if (!base || base.length < 32) return false;
  const key = createHmac("sha256", base)
    .update("spectra-event-callback:v1")
    .digest("base64url");
  const timestampText =
    request.headers.get("x-spectra-scheduler-timestamp") ?? "";
  const signature = request.headers.get("x-spectra-scheduler-signature") ?? "";
  const timestamp = Number(timestampText);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Date.now() - timestamp) > 30_000
  )
    return false;
  const digest = createHash("sha256").update(rawBody).digest("base64url");
  const expected = createHmac("sha256", key)
    .update(`${timestamp}.${digest}`)
    .digest();
  const received = Buffer.from(signature, "base64url");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

async function persistRunAttachments(
  runId: string,
  executionId: string,
  input: AttachmentInput[] | undefined,
  prepared: PreparedAttachment[],
) {
  const rows = Array.isArray(input) ? input.slice(0, 4) : [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const preparedRow = prepared[index];
    if (!preparedRow || !row.handling)
      throw new Error("ATTACHMENT_SERIALIZATION_INVALID");
    const bytes = attachmentInputBytes(row);
    const beginning = await mutate<
      Record<string, unknown>,
      {
        runAttachmentId: string;
        reused: boolean;
        uploadReceipt?: string;
        uploadUrl?: string;
      }
    >("spectraRuns:beginRunAttachmentUpload", {
      runId,
      executionId,
      originalFileId:
        preparedRow.id ?? row.assetId ?? row.importId ?? `file:${preparedRow.name}:${bytes.byteLength}`,
      name: preparedRow.name,
      mimeType: preparedRow.mimeType,
      size: bytes.byteLength,
      handling: row.handling,
      sha256: attachmentSha256(bytes),
      sourceMap: preparedRow.sourceMap,
      provenance: {
        ...preparedRow.provenance,
        ...(row.sourceRef ? { sourceRef: row.sourceRef } : {}),
      },
    });
    if (beginning.reused) continue;
    if (!beginning.uploadUrl || !beginning.uploadReceipt)
      throw new Error("ATTACHMENT_UPLOAD_INTENT_MISSING");
    const uploaded = await fetch(beginning.uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": preparedRow.mimeType,
        "Content-Length": String(bytes.byteLength),
      },
      body: bytes,
    });
    if (!uploaded.ok) throw new Error("ATTACHMENT_STORAGE_UPLOAD_FAILED");
    const payload = (await uploaded.json()) as { storageId?: string };
    if (!payload.storageId) throw new Error("ATTACHMENT_STORAGE_ID_MISSING");
    const stored = await act<
      { runAttachmentId: string; storageId: string; uploadReceipt: string },
      { status?: string; errorCode?: string }
    >("artifactIntakeActions:verifyUploadedRunAttachment", {
      runAttachmentId: beginning.runAttachmentId,
      storageId: payload.storageId,
      uploadReceipt: beginning.uploadReceipt,
    });
    if (stored.status !== "active")
      throw new Error(stored.errorCode ?? "ATTACHMENT_UPLOAD_INTEGRITY_FAILED");
  }
}

async function loadPersistedRunAttachments(runId: string, executionId: string) {
  const rows = await query<
    { runId: string; executionId: string },
    Array<{
      runAttachmentId: string;
      originalFileId?: string;
      name: string;
      mimeType: string;
      size: number;
      handling: PreparedAttachment["handling"];
      sourceMap?: PreparedAttachment["sourceMap"];
      provenance?: PreparedAttachment["provenance"];
      url: string | null;
    }>
  >("spectraRuns:listRunAttachments", { runId, executionId });
  const raw = await Promise.all(
    rows.map(async (row) => {
      if (!row.url) throw new Error("ATTACHMENT_STORAGE_URL_EXPIRED");
      const response = await fetch(row.url);
      if (!response.ok) throw new Error("ATTACHMENT_STORAGE_READ_FAILED");
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        row,
        input: attachmentBytesAsInput(bytes, {
          id: row.originalFileId ?? row.runAttachmentId,
          name: row.name,
          mimeType: row.mimeType,
          handling: row.handling,
        }),
      };
    }),
  );
  const prepared = await prepareRunAttachments(raw.map(({ input }) => input));
  return prepared.map((attachment, index) => ({
    ...attachment,
    id: raw[index]!.row.originalFileId ?? raw[index]!.row.runAttachmentId,
    sourceMap: raw[index]!.row.sourceMap ?? attachment.sourceMap,
    provenance: raw[index]!.row.provenance ?? attachment.provenance,
  }));
}

function confirmedApplicationSummary(
  command: string,
  result: Record<string, unknown>,
): string {
  if (command === "trigger_managebac_sync") {
    if (result.started === true)
      return "ManageBac refresh started. Spectra will use the new school data once the provider sync completes.";
    const reason = typeof result.reason === "string" ? result.reason : "";
    if (reason === "not_connected")
      return "ManageBac refresh was not started because ManageBac is not connected. No school data changed.";
    if (reason === "identity_required")
      return "ManageBac refresh was not started because the provider identity still needs verification.";
    if (reason === "fresh")
      return "ManageBac is already fresh enough for this request, so no duplicate refresh was started.";
    if (reason === "already_running")
      return "A ManageBac refresh is already running, so Spectra did not start a duplicate.";
    return "ManageBac accepted the refresh request. Spectra will report new data only after the provider confirms it.";
  }
  if (command === "select_managebac_classes") {
    const selected = Array.isArray(result.selectedClassIds)
      ? result.selectedClassIds.length
      : undefined;
    return selected === undefined
      ? "ManageBac class selection was updated."
      : `ManageBac class selection was updated: ${selected} class${selected === 1 ? "" : "es"} selected.`;
  }
  if (command === "delete_library_items") {
    const count = Array.isArray(result.affected)
      ? result.affected.length
      : undefined;
    return count === undefined
      ? "The selected Library items were moved to Trash."
      : `${count} Library item${count === 1 ? "" : "s"} were moved to Trash.`;
  }
  if (command === "change_spectra_settings")
    return "Spectra settings were updated and are now active.";
  if (command === "change_sync_policy")
    return "The requested sync policy was updated.";
  if (command === "change_sharing")
    return "The requested sharing change was applied.";
  if (command === "write_memory")
    return "That memory was saved with its source attribution.";
  if (command === "organize_library")
    return "The requested Library organization change was applied.";
  if (command === "insert_reference")
    return "The live reference is ready in the focused work surface.";
  return "The approved Spectra action was applied successfully.";
}

async function resumeOperationsAttempt(params: {
  actorClerkId: string;
  runId: string;
  resultCardId: string;
  executionId: string;
  workerId: string;
  conflictOperationId?: string;
  collaborationClientId?: string;
}) {
  const loop = createAgentLoopExecution({
    runId: params.runId,
    startAt: "act",
    onTransition: (entry) => console.info("[spectra.agent-loop]", entry),
  });
  loop.enter("act");
  await mutate("spectraRuns:claimExecution", {
    actorClerkId: params.actorClerkId,
    runId: params.runId,
    executionId: params.executionId,
    workerId: params.workerId,
  });
  const state = await query<{ actorClerkId: string; runId: string }, RunDetail>(
    "spectraRuns:get",
    { actorClerkId: params.actorClerkId, runId: params.runId },
  );
  const operations = [...state.operations]
    .filter((operation) => operation.executionId === params.executionId)
    .sort(
      (left, right) => (left._creationTime ?? 0) - (right._creationTime ?? 0),
    );
  const resumedTargetContext = await gatherResolvedArtifactContext(
    params.actorClerkId,
    operations.flatMap((row) => {
      try {
        const operation = parseModelOperation({
          type: row.type,
          input: row.input,
        });
        if (
          operation.type === "artifact.update" ||
          operation.type === "artifact.archive" ||
          operation.type === "workspaceItem.add"
        )
          return [operation.input.artifactId];
        if (operation.type === "artifact.link")
          return [
            operation.input.sourceArtifactId,
            operation.input.targetArtifactId,
          ];
      } catch {
        return [];
      }
      return [];
    }),
  );
  const resumedTargetTitles = new Map(
    resumedTargetContext.flatMap(({ artifact }) =>
      typeof artifact._id === "string" && typeof artifact.title === "string"
        ? [[artifact._id, artifact.title] as const]
        : [],
    ),
  );
  const createdArtifactIds = new Map<number, string>();
  for (let index = 0; index < operations.length; index += 1) {
    const row = operations[index]!;
    if (row.status !== "executed" || row.type !== "artifact.create") continue;
    const artifactId = row.affected?.find(
      (item) => item.type === "artifact",
    )?.id;
    if (artifactId) createdArtifactIds.set(index, artifactId);
  }
  const outcomes: Array<{
    operationId?: string;
    operation: ModelOperation;
    affected: Array<{ type: string; id: string }>;
  }> = operations.flatMap((row) => {
    if (row.status !== "executed") return [];
    try {
      return [
        {
          operationId: row._id,
          operation: resolveCreatedArtifactDependencies(
            parseModelOperation({ type: row.type, input: row.input }),
            createdArtifactIds,
          ),
          affected: row.affected ?? [],
        },
      ];
    } catch {
      return [];
    }
  });
  const applicationSummaries: string[] = [];
  let verificationIncomplete = false;
  let attemptedEffect = false;
  let unacknowledgedOperationId: string | undefined;
  const allAffected = operations.flatMap(
    (operation) => operation.affected ?? [],
  );
  const heartbeat = setInterval(() => {
    void mutate<unknown & object, { alive: boolean }>("spectraRuns:heartbeat", {
      runId: params.runId,
      executionId: params.executionId,
      workerId: params.workerId,
    }).catch(() => null);
  }, SPECTRA_RUN_HEARTBEAT_INTERVAL_MS);
  const stopHeartbeat = () => clearInterval(heartbeat);
  try {
    for (let index = 0; index < operations.length; index += 1) {
      const row = operations[index]!;
      if (row.status !== "proposed") continue;
      const parsed = parseModelOperation({ type: row.type, input: row.input });
      const operation = resolveCreatedArtifactDependencies(
        parsed,
        createdArtifactIds,
      );
      try {
        const effectProgress = operationEffectProgress(
          operation,
          index,
          operation.type === "artifact.update"
            ? resumedTargetTitles.get(operation.input.artifactId)
            : undefined,
        );
        if (
          operation.type === "artifact.create" &&
          row.pendingArtifactId &&
          effectProgress
        ) {
          await mutate("spectraArtifacts:updateAiEffect", {
            actorClerkId: params.actorClerkId,
            artifactId: row.pendingArtifactId,
            runId: params.runId,
            executionId: params.executionId,
            title: effectProgress.title,
            detail: effectProgress.detail,
            activity: "create",
            regionHint: effectProgress.regionHint,
            operationIndex: index,
          });
        } else if (operation.type === "artifact.update" && effectProgress) {
          await mutate("spectraArtifacts:updateAiEffect", {
            actorClerkId: params.actorClerkId,
            artifactId: operation.input.artifactId,
            runId: params.runId,
            executionId: params.executionId,
            title: effectProgress.title,
            detail: effectProgress.detail,
            activity: "edit",
            regionHint: effectProgress.regionHint,
            operationIndex: index,
            changedPaths: [],
          });
        } else if (
          operation.type === "workspace.create" &&
          row.pendingWorkspaceId
        ) {
          await mutate("spectraWorkspaces:resumePending", {
            actorClerkId: params.actorClerkId,
            workspaceId: row.pendingWorkspaceId,
            runId: params.runId,
            executionId: params.executionId,
          });
        } else if (operation.type === "workspace.update") {
          await mutate("spectraWorkspaces:stageAiPatch", {
            actorClerkId: params.actorClerkId,
            workspaceId: operation.input.workspaceId,
            runId: params.runId,
            executionId: params.executionId,
            title: operation.input.title ?? undefined,
            description: operation.input.description ?? undefined,
            icon: operation.input.icon ?? undefined,
            color: operation.input.color ?? undefined,
          });
        }
        if (effectProgress)
          await mutate("spectraRuns:appendEvent", {
            actorClerkId: params.actorClerkId,
            runId: params.runId,
            executionId: params.executionId,
            type: "progress",
            payload: {
              type: "progress",
              runId: params.runId,
              ...effectProgress,
            },
          });
        const resumeExecuteContext = {
          executionId: params.executionId,
          surface: state.run.sourceSurface,
          threadId: state.run.threadId,
          workspaceId: state.run.workspaceId,
          scopeNodeId: state.run.contextSnapshot?.scopeNodeId,
          selectedArtifactIds: state.run.contextSnapshot?.selectedObjectIds,
          researchEvidence: state.run.contextSnapshot?.researchEvidence,
          pendingArtifactId: row.pendingArtifactId,
          pendingWorkspaceId: row.pendingWorkspaceId,
          operationIndex: index,
          collaborationClientId:
            row._id === params.conflictOperationId
              ? params.collaborationClientId
              : undefined,
          onUiEvent: (event: {
            key: string;
            payload?: Record<string, unknown>;
          }) =>
            mutate("spectraRuns:appendEvent", {
              actorClerkId: params.actorClerkId,
              runId: params.runId,
              executionId: params.executionId,
              type: "ui_event",
              payload: {
                type: "ui_event",
                runId: params.runId,
                key: event.key,
                payload: event.payload,
              },
            }).then(() => {
              const note = event.payload?.note;
              if (
                event.key === "authority_notice" &&
                typeof note === "string" &&
                note.trim()
              )
                return mutate("spectraRuns:appendEvent", {
                  actorClerkId: params.actorClerkId,
                  runId: params.runId,
                  executionId: params.executionId,
                  type: "progress",
                  payload: {
                    type: "progress",
                    runId: params.runId,
                    title: note,
                    detail: note,
                  },
                }).then(() => undefined);
              return undefined;
            }),
          onApplicationResult: ({
            command,
            result,
          }: {
            command: string;
            args: Record<string, unknown>;
            result: Record<string, unknown>;
          }) => {
            const summary = confirmedApplicationSummary(command, result);
            if (summary) applicationSummaries.push(summary);
          },
        };
        // Confirmation does not make an unacknowledged write replayable.
        attemptedEffect = true;
        unacknowledgedOperationId = row._id;
        const affected = await executeOperation(
          params.actorClerkId,
          params.runId,
          row._id,
          operation,
          resumeExecuteContext,
        );
        // executeOperation owns the claim -> apply -> executed transition for
        // every operation, including confirmation continuations. A second
        // markExecuted here races the already-executed row and turns a durable
        // workspace/artifact save into a false failed run.
        allAffected.push(...affected);
        outcomes.push({ operationId: row._id, operation, affected });
        unacknowledgedOperationId = undefined;
        if (operation.type === "artifact.create") {
          const artifactId = affected.find(
            (item) => item.type === "artifact",
          )?.id;
          if (artifactId) createdArtifactIds.set(index, artifactId);
        }
        await mutate("spectraRuns:appendEvent", {
          actorClerkId: params.actorClerkId,
          runId: params.runId,
          executionId: params.executionId,
          type: "operation_result",
          payload: {
            type: "operation_result",
            runId: params.runId,
            operationId: row._id,
            affected,
          },
        });
      } catch (error) {
        if (error instanceof AiArtifactRegionConflictError) {
          await mutate("spectraOperations:pauseForRegionConflict", {
            actorClerkId: params.actorClerkId,
            operationId: row._id,
            executionId: params.executionId,
            artifactId: error.artifactId,
            claimId: error.claim.claimId,
            clientId: error.clientId,
            regionId: error.claim.conflict?.regionId ?? "occupied region",
            blockerActorKind: error.claim.conflict?.actorKind ?? "human",
            queuePosition: error.claim.conflict?.queuePosition ?? 1,
            baseSnapshot: error.baseSnapshot,
            proposedSnapshot: error.proposedSnapshot,
          });
          if (row.pendingArtifactId === error.artifactId) {
            await mutate("spectraArtifacts:pausePendingForConflict", {
              actorClerkId: params.actorClerkId,
              artifactId: row.pendingArtifactId,
              runId: params.runId,
              executionId: params.executionId,
            }).catch(() => null);
          }
          await mutate("spectraRuns:appendEvent", {
            actorClerkId: params.actorClerkId,
            runId: params.runId,
            executionId: params.executionId,
            type: "conflict_resolution_required",
            payload: {
              type: "conflict_resolution_required",
              runId: params.runId,
              operationId: row._id,
              artifactId: error.artifactId,
              claimId: error.claim.claimId,
            },
          });
          loop.enter("report", "region conflict paused the mutation path");
          return;
        }
        if (!outcomes.some((outcome) => outcome.operationId === row._id)) {
          await mutate("spectraOperations:markFailed", {
            actorClerkId: params.actorClerkId,
            operationId: row._id,
            executionId: params.executionId,
            error: publicError(error, { explanationOnly: true }),
          }).catch(() => null);
        }
        throw error;
      }
    }
    loop.enter("verify");
    const requireResearchEvidence = Boolean(
      state.run.contextSnapshot?.researchEvidence,
    );
    const verificationOptions = { requireResearchEvidence, prompt: state.run.userPrompt,
      numericSourceRequired: state.run.contextSnapshot?.qualityRequirements?.numericSourceRequired === true };
    verificationIncomplete = true;
    try {
      await verifyCommittedOutcomes(params.actorClerkId, outcomes, {
        ...verificationOptions,
      });
    } catch (firstVerifyError) {
      if (!isQuietRetryableApplyFailure(firstVerifyError)) {
        throw firstVerifyError;
      } else {
        console.warn("[spectra.resume.verify.encouragement_retry]", {
          error: publicError(firstVerifyError),
        });
        await mutate("spectraRuns:appendEvent", {
          actorClerkId: params.actorClerkId,
          runId: params.runId,
          executionId: params.executionId,
          type: "progress",
          payload: {
            type: "progress",
            runId: params.runId,
            title: "Taking another careful pass",
            detail: "Keeping your request in focus",
            activity: "verify",
          },
        }).catch(() => null);
        await mutate("spectraRuns:patchResultCard", {
          actorClerkId: params.actorClerkId,
          resultCardId: params.resultCardId,
          executionId: params.executionId,
          title: "Taking another careful pass",
          summary: "Keeping your request in focus",
        }).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await verifyCommittedOutcomes(params.actorClerkId, outcomes, {
          ...verificationOptions,
        });
      }
    }
    verificationIncomplete = false;
    await Promise.all([
      mutate("spectraArtifacts:settleStagedForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        outcome: "clear",
      }),
      mutate("spectraWorkspaces:settleForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        outcome: "clear",
      }),
    ]);
    const artifact = allAffected.find((item) => item.type === "artifact");
    const finalSummary =
      applicationSummaries.join(" ").trim() ||
      state.run.finalSummary ||
      "The resolved operations are complete.";
    loop.enter("report");
    // Same ordering as the primary operate path: terminal run status first so
    // chat/Live Dock agree on "finished" before open-artifact cards appear.
    await mutate("spectraRuns:updateStatus", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      status: "completed",
      decision: state.run.decision,
      planIntent: state.run.planIntent,
      finalSummary,
      resultTitle: "Done",
      resultSummary: finalSummary,
      resultVariant: artifact ? "artifact" : "status",
      resultActions: [
        ...(artifact
          ? [
              {
                key: "open" as const,
                label: "Open",
                targetType: "artifact" as const,
                targetId: artifact.id,
              },
            ]
          : []),
        // Prefer post-Apply outcomes (affected ids) so Undo arms after
        // confirmation Apply even when the pre-claim ledger snapshot was empty
        // of executed rows; fall back to operation types for the same create/update.
        ...(durableArtifactWritesFromOutcomes(outcomes) ||
        operationTypesArmRunUndo(operations)
          ? [revertRunResultAction(params.runId)]
          : []),
      ],
      outcome: "canonical_saved",
    });
    stopHeartbeat();
    await saveAssistantMessage({
      actorClerkId: params.actorClerkId,
      threadId: state.run.threadId,
      runId: params.runId,
      executionId: params.executionId,
      content: finalSummary,
      decision: state.run.decision,
      affected: allAffected,
    });
    await mutate("spectraRuns:appendEvent", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      type: "final",
      payload: { type: "final", runId: params.runId, summary: finalSummary },
    });
  } catch (error) {
    if (loop.currentStage() !== "report")
      loop.enter("report", "resumed run failed before later stages completed");
    const message = publicError(error, { explanationOnly: true });
    const latestAttempt = await query<{ actorClerkId: string; runId: string }, RunDetail>(
      "spectraRuns:get", { actorClerkId: params.actorClerkId, runId: params.runId },
    ).catch(() => null);
    const abortDisposition = classifyRunAttemptAbort({
      current: latestAttempt?.run ?? null,
      executionId: params.executionId, workerId: params.workerId,
    });
    if (abortDisposition === "already_settled" || abortDisposition === "ownership_lost" || abortDisposition === "state_unavailable")
      return;
    const stopped = abortDisposition === "user_stopped";
    const effects = reconcileInterruptedEffects({
      executionId: params.executionId, acknowledged: outcomes,
      operations: latestAttempt?.operations, run: latestAttempt?.run, attemptedEffect,
      unacknowledgedOperationId,
    });
    // A resumed approval can fail after one operation has committed and before
    // later proposed rows are consumed. Clear the unconsumed operation/shell
    // state before settling staged work, otherwise a failed continuation can
    // leave an orphaned draft that appears editable but is not owned by any
    // active run anymore.
    await Promise.all([
      mutate("spectraOperations:cancelPending", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
      }).catch(() => null),
      mutate("spectraArtifacts:failPendingForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
      }).catch(() => null),
      mutate("spectraArtifacts:settleStagedForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        outcome: "failed",
      }).catch(() => null),
      mutate("spectraWorkspaces:settleForRun", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        outcome: "failed",
      }).catch(() => null),
    ]);
    const partial = effects.committedCount > 0;
    const summary = interruptedEffectSummary(effects, stopped ? "Continue in this conversation for the remaining work." : message,
      { stopped, verificationFailed: verificationIncomplete });
    await mutate("spectraRuns:updateStatus", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      status: stopped ? "cancelled" : "failed",
      phase: stopped ? "stopped" : partial ? "partial" : "failed",
      outcome: effects.outcome,
      error: stopped ? undefined : message,
      finalSummary: summary,
      resultTitle: stopped ? "Stopped" : verificationIncomplete && effects.saved ? "Saved; verification incomplete" : partial ? "Partially completed" : "Run failed",
      resultSummary: summary,
      resultVariant: "error",
      resultActions: [
        ...(state.run.threadId ? [{ key: "continue", label: "Continue in thread", targetType: "thread", targetId: state.run.threadId }] : []),
        ...interruptedEffectActions(effects, params.runId),
      ],
      recoveryState: partial || effects.ambiguous ? "partial" : "interrupted",
      retryable: false,
      preservedPartial: partial || effects.ambiguous,
    }).catch(() => null);
    stopHeartbeat();
    await Promise.all([
      saveAssistantMessage({
        actorClerkId: params.actorClerkId,
        threadId: state.run.threadId,
        runId: params.runId,
        executionId: params.executionId,
        content: summary,
        decision: state.run.decision,
        affected: effects.affected,
      }).catch(() => undefined),
      mutate("spectraRuns:appendEvent", {
        actorClerkId: params.actorClerkId,
        runId: params.runId,
        executionId: params.executionId,
        type: stopped ? "stopped" : "error",
        payload: { type: stopped ? "stopped" : "error", runId: params.runId, message: summary },
      }).catch(() => null),
    ]);
    if (!stopped) throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

async function executeScheduledResume(body: Body) {
  const required = (value: string | undefined, name: string) => {
    const normalized = value?.trim();
    if (!normalized) throw new Error(`Scheduled resume ${name} is required.`);
    return normalized;
  };
  const actorClerkId = required(body.actorClerkId, "actorClerkId");
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey)
    throw new Error("Scheduled execution authentication is unavailable.");
  const clerk = createClerkClient({ secretKey });
  const sessions = await clerk.sessions.getSessionList({
    userId: actorClerkId,
    status: "active",
    limit: 10,
  });
  const session = sessions.data.sort(
    (left, right) => right.lastActiveAt - left.lastActiveAt,
  )[0];
  if (!session)
    throw new Error("The owner has no active session for this scheduled edit.");
  const token = await clerk.sessions.getToken(session.id, "convex", 1_800);
  await withWorkerConvexToken(token.jwt, () =>
    resumeOperationsAttempt({
      actorClerkId,
      runId: required(body.runId, "runId"),
      resultCardId: required(body.resultCardId, "resultCardId"),
      executionId: required(body.executionId, "executionId"),
      workerId: `event-resume:${crypto.randomUUID()}`,
      conflictOperationId: body.conflictOperationId?.trim(),
      collaborationClientId: body.collaborationClientId?.trim(),
    }),
  );
}

async function persistScheduledRunPreflightFailure(params: {
  actorClerkId: string;
  runId: string;
  executionId: string;
  error: unknown;
}) {
  const message = publicError(params.error);
  await mutate("spectraRuns:updateStatus", {
    actorClerkId: params.actorClerkId,
    runId: params.runId,
    executionId: params.executionId,
    status: "failed",
    error: message,
    finalSummary: message,
    resultTitle: "Paused",
    resultSummary: `${message} You can retry when ready.`,
    resultVariant: "status",
    resultActions: [
      {
        key: "retry",
        label: "Retry",
        targetType: "run",
        targetId: params.runId,
      },
    ],
    recoveryState: "interrupted",
    retryable: true,
    preservedPartial: false,
  });
  await mutate("spectraRuns:appendEvent", {
    actorClerkId: params.actorClerkId,
    runId: params.runId,
    executionId: params.executionId,
    type: "error",
    payload: { type: "error", runId: params.runId, message },
  }).catch(() => null);
}

async function executeScheduledRun(body: Body) {
  const required = (value: string | undefined, name: string) => {
    const normalized = value?.trim();
    if (!normalized) throw new Error(`Scheduled run ${name} is required.`);
    return normalized;
  };
  const actorClerkId = required(body.actorClerkId, "actorClerkId");
  const payload = body.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Scheduled run payload is required.");
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey)
    throw new Error("Scheduled execution authentication is unavailable.");
  const clerk = createClerkClient({ secretKey });
  const sessions = await clerk.sessions.getSessionList({
    userId: actorClerkId,
    status: "active",
    limit: 10,
  });
  const session = sessions.data.sort(
    (left, right) => right.lastActiveAt - left.lastActiveAt,
  )[0];
  if (!session)
    throw new Error("The owner has no active session for this scheduled run.");
  const token = await clerk.sessions.getToken(session.id, "convex", 1_800);
  const surface =
    payload.surface === "workspace" ||
    payload.surface === "artifact" ||
    payload.surface === "artifacts"
      ? payload.surface
      : "chat";
  await withWorkerConvexToken(token.jwt, async () => {
    const runId = required(body.runId, "runId");
    const executionId = required(body.executionId, "executionId");
    try {
      const attachments = await loadPersistedRunAttachments(runId, executionId);
      await runAttempt(
        {
          actorClerkId,
          runId,
          resultCardId: required(body.resultCardId, "resultCardId"),
          executionId,
          workerId: `event-run:${body.executionId}`,
          prompt: typeof payload.prompt === "string" ? payload.prompt : "",
          surface,
          threadId:
            typeof payload.threadId === "string" ? payload.threadId : undefined,
          continuedThread: payload.continuedThread === true,
          workspaceId:
            typeof payload.workspaceId === "string"
              ? payload.workspaceId
              : undefined,
          artifactId:
            typeof payload.artifactId === "string"
              ? payload.artifactId
              : undefined,
          focusMode:
            typeof payload.focusMode === "string"
              ? (payload.focusMode as EffectiveFocusMode)
              : undefined,
          selectedArtifactIds: Array.isArray(payload.selectedArtifactIds)
            ? payload.selectedArtifactIds.filter(
                (value): value is string => typeof value === "string",
              )
            : undefined,
          explicitContextObjects: Array.isArray(payload.explicitContextObjects)
            ? (payload.explicitContextObjects as Body["explicitContextObjects"])
            : undefined,
          currentView:
            typeof payload.currentView === "string"
              ? payload.currentView
              : undefined,
          agentId:
            typeof payload.agentId === "string" ? payload.agentId : undefined,
          disableAgentRouting: payload.disableAgentRouting === true,
          clarificationId:
            typeof payload.clarificationId === "string"
              ? payload.clarificationId
              : undefined,
          choiceMessageId:
            typeof payload.choiceMessageId === "string"
              ? payload.choiceMessageId
              : undefined,
          choiceKey:
            typeof payload.choiceKey === "string" ? payload.choiceKey : undefined,
          clarificationExecutionId:
            typeof payload.clarificationExecutionId === "string"
              ? payload.clarificationExecutionId
              : undefined,
          continuationRunId:
            typeof payload.continuationRunId === "string"
              ? payload.continuationRunId
              : undefined,
          batchSelections: Array.isArray(payload.batchSelections)
            ? payload.batchSelections.filter(
                (value): value is NonNullable<Body["batchSelections"]>[number] =>
                  Boolean(value) &&
                  typeof value === "object" &&
                  typeof (value as Record<string, unknown>).questionId === "string" &&
                  typeof (value as Record<string, unknown>).choiceKey === "string" &&
                  typeof (value as Record<string, unknown>).choiceTitle === "string",
              )
            : undefined,
          attachments,
        },
        () => undefined,
      );
    } catch (error) {
      // Attachment hydration, execution claiming, and the first card read all
      // happen before runAttempt's main failure boundary. If one of those
      // preflight steps fails, leave a durable retryable result instead of
      // returning a 500 while the UI still shows the run as queued.
      const current = await query<
        { actorClerkId: string; runId: string },
        RunDetail
      >("spectraRuns:get", { actorClerkId, runId });
      if (current.run.status !== "queued" && current.run.status !== "running")
        return;
      await persistScheduledRunPreflightFailure({
        actorClerkId,
        runId,
        executionId,
        error,
      });
    }
  });
}

export async function handleSpectraRunRequest(request: NextRequest) {
  const rawBody = await request.text();
  let body: Body;
  try {
    body = JSON.parse(rawBody) as Body;
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }
  const action = body.action ?? "run";

  if (action === "scheduled_run") {
    if (!verifyScheduledCallback(request, rawBody))
      return new Response("Forbidden", { status: 403 });
    try {
      await executeScheduledRun(body);
      return Response.json({ completed: true });
    } catch (error) {
      return Response.json(
        { completed: false, error: publicError(error) },
        { status: 500 },
      );
    }
  }

  if (action === "scheduled_resume") {
    if (!verifyScheduledCallback(request, rawBody))
      return new Response("Forbidden", { status: 403 });
    try {
      await executeScheduledResume(body);
      return Response.json({ completed: true });
    } catch (error) {
      return Response.json(
        { completed: false, error: publicError(error) },
        { status: 500 },
      );
    }
  }

  const actor = await requireActor();

  if (action === "clear_agent") {
    const runId = body.runId?.trim();
    if (!runId) return new Response("runId is required", { status: 400 });
    try {
      const result = await mutate("spectraRuns:clearRetainedAgent", { runId });
      return Response.json(result);
    } catch (error) {
      return new Response(publicError(error), { status: 409 });
    }
  }

  if (action === "run") {
    const prompt = body.prompt?.trim();
    const surface = body.surface;
    if (!prompt) return new Response("Invalid prompt", { status: 400 });
    if (
      !surface ||
      !["chat", "workspace", "artifacts", "artifact"].includes(surface)
    )
      return new Response("Invalid surface", { status: 400 });
    if (body.clarificationId || body.choiceKey || body.choiceMessageId) {
      if (!body.clarificationId || !body.choiceKey || !body.choiceMessageId || !body.executionId)
        return new Response("This clarification reply is incomplete. Choose one of the current options again.", { status: 409 });
    }
    const sourceSurface = surface === "artifacts" ? "artifact" : surface;
    let attachments: PreparedAttachment[];
    try {
      attachments = await prepareRunAttachments(body.attachments);
    } catch (error) {
      return new Response(publicError(error), { status: 400 });
    }
    const placementWorkspaceId = await inferWorkspaceForRun(
      actor.clerkId,
      body,
    );
    let created: {
      runId: string;
      resultCardId: string;
      threadId: string;
      executionId: string;
      continuationRunId?: string;
      retainedAttachments?: boolean;
      created: boolean;
    };
    try {
      created = await mutate<
        unknown & object,
        {
          runId: string;
          resultCardId: string;
          threadId: string;
          executionId: string;
          continuationRunId?: string;
          retainedAttachments?: boolean;
          created: boolean;
        }
      >("spectraRuns:beginRun", {
        actorClerkId: actor.clerkId,
        sourceSurface,
        userPrompt: prompt,
        // A repeated clarification reply is the same logical continuation,
        // even when the first response was lost after the durable mutation.
        submissionKey:
          body.clarificationId && body.choiceMessageId && body.choiceKey
            ? `clarification:${createHash("sha256")
                .update(`${body.choiceMessageId}:${body.clarificationId}:${body.choiceKey}`)
                .digest("hex")}`
            : body.submissionKey?.trim() || crypto.randomUUID(),
        threadId: body.threadId?.trim() || undefined,
        workspaceId: placementWorkspaceId,
        artifactId: body.artifactId,
        modelUsed: getSpectraModelId(),
        messageMetadata: {
          attachments: attachments.map(
            ({ name, mimeType, size, handling }) => ({
              name,
              mimeType,
              size,
              handling,
            }),
          ),
        },
        ...(body.clarificationId
          ? {
              clarificationId: body.clarificationId,
              clarificationMessageId: body.choiceMessageId,
              clarificationExecutionId: body.executionId,
              choiceKey: body.choiceKey,
              batchSelections: body.batchSelections,
            }
          : {}),
      });
    } catch (error) {
      return new Response(publicError(error), { status: 409 });
    }
    if (created.created && attachments.length > 0) {
      try {
        await persistRunAttachments(
          created.runId,
          created.executionId,
          body.attachments,
          attachments,
        );
      } catch (error) {
        return new Response(publicError(error), { status: 409 });
      }
    }
    const threadId = created.threadId;
    const inlinePlan =
      created.created &&
      !body.agentId &&
      !body.threadId?.trim() &&
      attachments.length === 0
        ? await fastUnavailableManageBacPlan(prompt)
        : null;
    if (inlinePlan) {
      const initialCard = await latestCard(actor.clerkId, created.runId);
      return ndjson(async (emit) => {
        emit({
          type: "run_created",
          runId: created.runId,
          card: streamCard(initialCard),
        });
        emit({ type: "thread_ready", runId: created.runId, threadId });
        await runAttempt(
          {
            actorClerkId: actor.clerkId,
            runId: created.runId,
            resultCardId: created.resultCardId,
            executionId: created.executionId,
            workerId: `inline-fast:${crypto.randomUUID()}`,
            prompt,
            surface,
            threadId,
            continuedThread: false,
            workspaceId: placementWorkspaceId,
            scopeNodeId: body.scopeNodeId,
            artifactId: body.artifactId,
            focusMode: body.focusMode,
            selectedArtifactIds: body.selectedArtifactIds,
            explicitContextObjects: body.explicitContextObjects,
            currentView: body.currentView,
            disableAgentRouting: body.disableAgentRouting,
            clarificationId: body.clarificationId,
            choiceMessageId: body.choiceMessageId,
            choiceKey: body.choiceKey,
            clarificationExecutionId: body.executionId,
            batchSelections: body.batchSelections,
            attachments,
          },
          emit,
        );
      });
    }
    if (!created.created) {
      const card = await latestCard(actor.clerkId, created.runId);
      return ndjson(async (emit) => {
        emit({
          type: "run_created",
          runId: created.runId,
          card: streamCard(card),
        });
        emit({ type: "thread_ready", runId: created.runId, threadId });
      });
    }
    const initialCard = await latestCard(actor.clerkId, created.runId);
    const executionPayload = {
      prompt,
      surface,
      threadId,
      continuedThread: Boolean(body.threadId?.trim()),
      continuationRunId: created.continuationRunId,
      workspaceId: placementWorkspaceId,
      scopeNodeId: body.scopeNodeId,
      artifactId: body.artifactId,
      focusMode: body.focusMode,
      selectedArtifactIds: body.selectedArtifactIds,
      explicitContextObjects: body.explicitContextObjects,
      currentView: body.currentView,
      agentId: body.agentId,
      disableAgentRouting: body.disableAgentRouting,
      clarificationId: body.clarificationId,
      choiceMessageId: body.choiceMessageId,
      choiceKey: body.choiceKey,
      clarificationExecutionId: body.executionId,
      batchSelections: body.batchSelections,
      attachments: [],
    };
    if (
      process.env.SPECTRA_TEST_INLINE_RUNS !== "1" &&
      Boolean(process.env.SPECTRA_APP_URL?.trim())
    ) {
      await mutate("spectraRuns:scheduleExecution", {
        runId: created.runId,
        resultCardId: created.resultCardId,
        executionId: created.executionId,
        payload: executionPayload,
      });
      return ndjson(async (emit) => {
        emit({
          type: "run_created",
          runId: created.runId,
          card: streamCard(initialCard),
        });
        emit({ type: "thread_ready", runId: created.runId, threadId });
      });
    }
    return ndjson(async (emit) => {
      emit({
        type: "run_created",
        runId: created.runId,
        card: streamCard(initialCard),
      });
      emit({ type: "thread_ready", runId: created.runId, threadId });
      const continuedAttachments =
        created.continuationRunId || created.retainedAttachments
        ? await loadPersistedRunAttachments(created.runId, created.executionId)
        : attachments;
      await runAttempt(
        {
          actorClerkId: actor.clerkId,
          runId: created.runId,
          resultCardId: created.resultCardId,
          executionId: created.executionId,
          workerId: `event:${crypto.randomUUID()}`,
          ...executionPayload,
          attachments: continuedAttachments,
        },
        emit,
      );
    });
  }

  let runId = body.runId?.trim();
  const resolvedPendingSubmission =
    action === "stop" && !runId && Boolean(body.submissionKey?.trim());
  if (!runId && action === "stop" && body.submissionKey?.trim()) {
    const resolved = await query<
      { submissionKey: string },
      { runId: string; executionId?: string; status: string } | null
    >("spectraRuns:resolveBySubmissionKey", {
      submissionKey: body.submissionKey.trim(),
    }).catch(() => null);
    runId = resolved?.runId;
  }
  if (!runId) return new Response("runId is required", { status: 400 });
  // A submission key is the supported pre-ack cancellation identity. Once a
  // versioned run is displayed, controls must carry the execution they showed;
  // resolving a missing execution from a run id could cancel a newer retry.
  let expectedExecutionId = body.executionId?.trim();
  if (!expectedExecutionId) {
    if (!resolvedPendingSubmission)
      return new Response(
        "This run control is missing the displayed attempt. Refresh it and try again.",
        { status: 409 },
      );
    try {
      const detail = await query<unknown & object, RunDetail>(
        "spectraRuns:get",
        { actorClerkId: actor.clerkId, runId },
      );
      expectedExecutionId = detail.run.executionId;
    } catch {
      return new Response("Run not found", { status: 404 });
    }
  }
  if (!expectedExecutionId)
    return new Response("This run has no active execution.", { status: 409 });
  if (body.attemptId?.trim() && body.attemptId.trim() !== expectedExecutionId)
    return new Response(
      "This run attempt is no longer current. Refresh it and try again.",
      { status: 409 },
    );

  if (action === "stop") {
    let stopped: { alreadyStopped: boolean; executionId?: string };
    try {
      stopped = await mutate<
        unknown & object,
        { alreadyStopped: boolean; executionId?: string }
      >("spectraRuns:stopRun", {
        actorClerkId: actor.clerkId,
        runId,
        executionId: expectedExecutionId,
      });
    } catch (error) {
      const internalMessage =
        error instanceof Error ? error.message : String(error);
      const message = publicError(error);
      if (!internalMessage.includes("currently committing an operation"))
        return new Response(message, { status: 409 });

      // Older Convex deployments rejected cancellation while an operation was
      // marked `executing`, which leaves a stalled operation impossible to
      // stop. Persist the terminal run state through the existing transition
      // mutation; the worker heartbeat then aborts the operation at its next
      // safe boundary and the cleanup below removes provisional state.
      const fallbackDetail = await query<
        { actorClerkId: string; runId: string },
        RunDetail
      >("spectraRuns:get", { actorClerkId: actor.clerkId, runId }).catch(
        () => null,
      );
      await mutate("spectraRuns:updateStatus", {
        actorClerkId: actor.clerkId,
        runId,
        executionId: expectedExecutionId,
        status: "cancelled",
        resultTitle: "Stopped",
        resultSummary: "Stopped by you. Any completed work remains available.",
        resultActions: [
          ...(fallbackDetail?.run.threadId
            ? [
                {
                  key: "continue" as const,
                  label: "Continue in thread",
                  targetType: "thread" as const,
                  targetId: fallbackDetail.run.threadId,
                },
              ]
            : []),
          // Committing path already has visible work; arm Undo so Dock matches
          // stopRun's durable-write behavior instead of leaving an empty card.
          revertRunResultAction(runId),
        ],
        recoveryState: "partial",
        retryable: false,
        preservedPartial: true,
      });
      stopped = {
        alreadyStopped: false,
        executionId: expectedExecutionId,
      };
    }
    await mutate("spectraArtifacts:discardPendingForRun", {
      actorClerkId: actor.clerkId,
      runId,
      executionId: stopped.executionId,
    }).catch(() => null);
    await mutate("spectraArtifacts:settleStagedForRun", {
      actorClerkId: actor.clerkId,
      runId,
      executionId: stopped.executionId,
      outcome: "failed",
    }).catch(() => null);
    await mutate("spectraWorkspaces:settleForRun", {
      actorClerkId: actor.clerkId,
      runId,
      executionId: stopped.executionId,
      outcome: "failed",
    }).catch(() => null);
    return new Response(null, { status: 204 });
  }

  if (action === "retry") {
    const retryKey = body.submissionKey?.trim() || crypto.randomUUID();
    const current = await query<
      { actorClerkId: string; runId: string },
      RunDetail
    >("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    if (current.run.executionId !== expectedExecutionId)
      return new Response(
        "This run attempt is no longer current. Refresh it and try again.",
        { status: 409 },
      );
    await mutate("spectraOperations:cancelPending", {
      actorClerkId: actor.clerkId,
      runId,
      executionId: expectedExecutionId,
    }).catch(() => null);
    await mutate("spectraArtifacts:discardPendingForRun", {
      actorClerkId: actor.clerkId,
      runId,
      executionId: expectedExecutionId,
    }).catch(() => null);
    await mutate("spectraArtifacts:settleStagedForRun", {
      actorClerkId: actor.clerkId,
      runId,
      executionId: expectedExecutionId,
      outcome: "clear",
    }).catch(() => null);
    await mutate("spectraWorkspaces:settleForRun", {
      actorClerkId: actor.clerkId,
      runId,
      executionId: expectedExecutionId,
      outcome: "clear",
    }).catch(() => null);
    let reset: RetryReset;
    try {
      reset = await mutate<unknown & object, RetryReset>(
        "spectraRuns:resetForRetry",
        {
          actorClerkId: actor.clerkId,
          runId,
          executionId: expectedExecutionId,
          retryKey,
        },
      );
    } catch (error) {
      return new Response(publicError(error), { status: 409 });
    }
    if (!reset.resultCardId)
      return new Response("Result card not found", { status: 409 });
    if (!reset.created) {
      const card = await latestCard(actor.clerkId, runId);
      return ndjson(async (emit) =>
        emit({ type: "run_created", runId, card: streamCard(card) }),
      );
    }
    const run: RunState = {
      status: "queued",
      sourceSurface: reset.sourceSurface,
      workspaceId: reset.workspaceId,
      scopeNodeId: reset.contextSnapshot?.scopeNodeId,
      artifactId: reset.artifactId,
      userPrompt: reset.prompt,
    };
    const state = await query<
      { actorClerkId: string; runId: string },
      RunDetail
    >("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    const usesScheduledExecution =
      process.env.SPECTRA_TEST_INLINE_RUNS !== "1" &&
      Boolean(process.env.SPECTRA_APP_URL?.trim());
    const retryAttachments = usesScheduledExecution
      ? []
      : await loadPersistedRunAttachments(runId, reset.executionId);
    const initialCard = await latestCard(actor.clerkId, runId);
    const retryPayload = {
      prompt: reset.prompt,
      surface: surfaceFromRun(run),
      threadId: state.run.threadId,
      continuedThread: true,
      workspaceId: reset.workspaceId,
      artifactId: reset.artifactId,
      focusMode: reset.contextSnapshot?.focusMode,
      selectedArtifactIds: reset.contextSnapshot?.selectedObjectIds,
      explicitContextObjects: reset.contextSnapshot?.explicitContextObjects,
      currentView: reset.contextSnapshot?.currentView,
      agentId:
        state.run.selectedAgentId ?? reset.contextSnapshot?.requestedAgentId,
      disableAgentRouting: reset.contextSnapshot?.disableAgentRouting,
      attachments: retryAttachments,
    };
    if (
      usesScheduledExecution
    ) {
      await mutate("spectraRuns:scheduleExecution", {
        runId,
        resultCardId: reset.resultCardId,
        executionId: reset.executionId,
        payload: retryPayload,
      });
      return ndjson(async (emit) => {
        emit({ type: "run_created", runId, card: streamCard(initialCard) });
        emit({ type: "thread_ready", runId, threadId: state.run.threadId });
      });
    }
    return ndjson(async (emit) => {
      emit({ type: "run_created", runId, card: streamCard(initialCard) });
      emit({ type: "thread_ready", runId, threadId: state.run.threadId });
      await runAttempt(
        {
          actorClerkId: actor.clerkId,
          runId,
          resultCardId: reset.resultCardId!,
          executionId: reset.executionId,
          workerId: `event-retry:${crypto.randomUUID()}`,
          prompt: reset.prompt,
          surface: surfaceFromRun(run),
          threadId: state.run.threadId,
          continuedThread: true,
          workspaceId: reset.workspaceId,
          scopeNodeId: reset.contextSnapshot?.scopeNodeId,
          artifactId: reset.artifactId,
          focusMode: reset.contextSnapshot?.focusMode,
          selectedArtifactIds: reset.contextSnapshot?.selectedObjectIds,
          explicitContextObjects: reset.contextSnapshot?.explicitContextObjects,
          currentView: reset.contextSnapshot?.currentView,
          agentId:
            state.run.selectedAgentId ??
            reset.contextSnapshot?.requestedAgentId,
          disableAgentRouting: reset.contextSnapshot?.disableAgentRouting,
          attachments: retryAttachments,
        },
        emit,
      );
    });
  }

  if (action === "revert") {
    const state = await query<
      { actorClerkId: string; runId: string },
      RunDetail
    >("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    const effects = reconcileInterruptedEffects({
      executionId: state.run.executionId ?? "", acknowledged: [],
      operations: state.operations, run: state.run,
    });
    if (!canUndoRunWithEffects(state.run.status, effects))
      return new Response(
        "Undo is available after Spectra finishes this run.",
        { status: 409 },
      );
    const plan = await mutate<
      { runId: string },
      {
        restored: Array<{
          artifactId: string;
          snapshot: {
            title?: string;
            summary?: string | null;
            content?: unknown;
            tags?: string[];
          };
        }>;
        blocked: Array<{ artifactId: string; reason: string }>;
      }
    >("changeGroups:revertPlanForRun", {
      runId,
    });
    if (plan.restored.length === 0) {
      const blocked = plan.blocked[0]?.reason;
      return new Response(
        blocked ??
          "This run did not keep a snapshot that can be undone. Archive created work from Library if you want to remove it.",
        { status: 409 },
      );
    }
    const restored: string[] = [];
    const failed: string[] = [];
    for (const item of plan.restored) {
      const snapshot = item.snapshot ?? {};
      try {
        await applyAiArtifactMutation({
          artifactId: item.artifactId,
          runId,
          // restore:* ids are human Undo fencing, never AI claim identities.
          operationId: `restore:${runId}:${item.artifactId}`,
          executionId:
            expectedExecutionId ??
            state.run.executionId ??
            `restore:${runId}`,
          checkpointBeforeAi: false,
          claimActorKind: "human",
          resolveDesired: (current) => ({
            title: snapshot.title ?? current.title,
            summary:
              typeof snapshot.summary === "string"
                ? snapshot.summary
                : current.summary,
            content: snapshot.content ?? current.content,
            tags: snapshot.tags ?? current.tags,
          }),
        });
        restored.push(item.artifactId);
      } catch (error) {
        failed.push(
          error instanceof Error
            ? publicError(error)
            : "Spectra could not restore that earlier copy.",
        );
      }
    }
    if (restored.length === 0)
      return new Response(
        failed[0] ??
          plan.blocked[0]?.reason ??
          "Spectra could not undo this run.",
        { status: 409 },
      );
    await mutate("spectraArtifacts:settleStagedForRun", {
      runId,
      executionId: expectedExecutionId,
      outcome: "failed",
    }).catch(() => null);
    const executionId =
      expectedExecutionId ?? state.run.executionId ?? `restore:${runId}`;
    await Promise.all(
      state.cards.map((card) =>
        mutate("spectraRuns:patchResultCard", {
          resultCardId: card._id,
          executionId,
          summary: "Restored the earlier copy of this work.",
          actions: [
            ...card.actions.filter((action) => action.key !== "revert"),
            { key: "undone", label: "Undone" },
          ].filter(
            (action, index, all) =>
              all.findIndex((candidate) => candidate.key === action.key) ===
              index,
          ),
        }).catch(() => null),
      ),
    );
    return Response.json({
      restored: restored.length,
      blocked: plan.blocked,
      failed,
    });
  }

  if (action === "cancel") {
    const state = await query<
      { actorClerkId: string; runId: string },
      RunDetail
    >("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    if (!state.run.executionId)
      return new Response(
        "This older approval cannot be resumed safely. Start a new thread instead.",
        { status: 409 },
      );
    const approval = state.run.approval;
    const approvalPending =
      approval !== undefined &&
      approval.executionId === state.run.executionId &&
      approval.status === "pending";
    if (
      state.run.status !== "awaiting_confirmation" &&
      state.run.status !== "cancelled" &&
      !(state.run.status === "running" && approvalPending)
    )
      return new Response(
        "This approval was already handled in another view.",
        { status: 409 },
      );
    let rejection: { alreadyRejected: boolean };
    try {
      rejection = await mutate<unknown & object, { alreadyRejected: boolean }>(
        "spectraRuns:rejectConfirmation",
        {
          actorClerkId: actor.clerkId,
          runId,
          executionId: state.run.executionId,
        },
      );
    } catch (error) {
      return new Response(publicError(error), { status: 409 });
    }
    await mutate("spectraArtifacts:discardPendingForRun", {
      actorClerkId: actor.clerkId,
      runId,
      executionId: state.run.executionId,
    }).catch(() => null);
    await mutate("spectraArtifacts:settleStagedForRun", {
      actorClerkId: actor.clerkId,
      runId,
      executionId: state.run.executionId,
      outcome: "clear",
    }).catch(() => null);
    await mutate("spectraWorkspaces:settleForRun", {
      actorClerkId: actor.clerkId,
      runId,
      executionId: state.run.executionId,
      outcome: "clear",
    }).catch(() => null);
    await saveAssistantMessage({
      actorClerkId: actor.clerkId,
      threadId: state.run.threadId,
      runId,
      executionId: state.run.executionId,
      content: "No proposed changes were applied.",
      decision: state.run.decision,
      awaitingConfirmation: false,
    });
    if (!rejection.alreadyRejected && state.run.executionId)
      await mutate("spectraRuns:appendEvent", {
        actorClerkId: actor.clerkId,
        runId,
        executionId: state.run.executionId,
        type: "approval_rejected",
        payload: { type: "approval_rejected", runId },
      });
    const card = await latestCard(actor.clerkId, runId);
    return ndjson(async (emit) =>
      emit({
        type: "final",
        runId,
        summary: "No proposed changes were applied.",
        card: streamCard(card),
      }),
    );
  }

  if (action === "revise") {
    const revision = body.revision?.trim();
    if (!revision)
      return new Response("Describe what Spectra should revise", {
        status: 400,
      });
    const state = await query<
      { actorClerkId: string; runId: string },
      RunDetail
    >("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    if (!state.run.executionId)
      return new Response(
        "This older approval cannot be revised safely. Start a new thread instead.",
        { status: 409 },
      );
    try {
      await mutate("spectraRuns:reviseConfirmation", {
        actorClerkId: actor.clerkId,
        runId,
        executionId: state.run.executionId,
        revision,
      });
    } catch (error) {
      return new Response(publicError(error), { status: 409 });
    }
    await Promise.all([
      mutate("spectraArtifacts:discardPendingForRun", {
        actorClerkId: actor.clerkId,
        runId,
        executionId: state.run.executionId,
      }).catch(() => null),
      mutate("spectraArtifacts:settleStagedForRun", {
        actorClerkId: actor.clerkId,
        runId,
        executionId: state.run.executionId,
        outcome: "clear",
      }).catch(() => null),
      mutate("spectraWorkspaces:settleForRun", {
        actorClerkId: actor.clerkId,
        runId,
        executionId: state.run.executionId,
        outcome: "clear",
      }).catch(() => null),
    ]);
    await saveAssistantMessage({
      actorClerkId: actor.clerkId,
      threadId: state.run.threadId,
      runId,
      executionId: state.run.executionId,
      content: `I have returned that proposal for revision: ${revision}`,
      decision: state.run.decision,
      awaitingConfirmation: false,
    });
    const card = await latestCard(actor.clerkId, runId);
    return ndjson(async (emit) =>
      emit({
        type: "final",
        runId,
        summary: "Proposal returned for revision.",
        card: streamCard(card),
      }),
    );
  }

  if (action === "confirm") {
    const state = await query<
      { actorClerkId: string; runId: string },
      RunDetail
    >("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    const approvalExecutionId = state.run.executionId;
    if (!approvalExecutionId)
      return new Response(
        "This older approval cannot be resumed safely. Start a new thread instead.",
        { status: 409 },
      );
    const approval = state.run.approval;
    const approvalPending =
      approval !== undefined &&
      approval.executionId === state.run.executionId &&
      approval.status === "pending";
    if (
      state.run.status !== "awaiting_confirmation" &&
      !(state.run.status === "running" && approvalPending)
    )
      return new Response("Run is not awaiting confirmation", { status: 409 });
    const intent = requestIntentSchema.parse(state.run.planIntent);
    const proposed = state.operations.filter(
      (row) =>
        row.status === "proposed" &&
        (!row.executionId || row.executionId === approvalExecutionId),
    );
    if (
      !proposed.some((row) => row.requiresConfirmation) ||
      proposed.length === 0
    )
      return new Response("No confirmable operations", { status: 409 });
    const operations = proposed.map((row) =>
      parseModelOperation({ type: row.type, input: row.input }),
    );
    const context = await buildContext(
      actor.clerkId,
      {
        workspaceId: state.run.workspaceId,
        scopeNodeId: state.run.contextSnapshot?.scopeNodeId,
        artifactId: state.run.artifactId,
        threadId: state.run.threadId,
        focusMode: state.run.contextSnapshot?.focusMode,
        selectedArtifactIds: state.run.contextSnapshot?.selectedObjectIds,
        explicitContextObjects:
          state.run.contextSnapshot?.explicitContextObjects,
        currentView: state.run.contextSnapshot?.currentView,
      },
      state.run.userPrompt,
    );
    validatePlanAgainstIntent(
      {
        decision: "operate",
        intent,
        finalResponse: state.run.finalSummary ?? "Confirmed changes completed.",
        presentedArtifactIds: [],
        operations,
      },
      ownedReferences(context),
    );
    evaluatePlanPolicy(operations, { intent });
    let confirmation: { resultCardId?: string };
    try {
      confirmation = await mutate<unknown & object, { resultCardId?: string }>(
        "spectraRuns:claimConfirmation",
        {
          actorClerkId: actor.clerkId,
          runId,
          executionId: approvalExecutionId,
        },
      );
      await mutate("spectraRuns:appendEvent", {
        actorClerkId: actor.clerkId,
        runId,
        executionId: approvalExecutionId,
        type: "approval_accepted",
        payload: { type: "approval_accepted", runId },
      });
    } catch (error) {
      return new Response(publicError(error), { status: 409 });
    }
    if (!confirmation.resultCardId)
      return new Response("Result card not found", { status: 409 });
    const card = await latestCard(actor.clerkId, runId);
    return ndjson(async (emit) => {
      emit({ type: "approval_accepted", runId });
      emit({ type: "result_card", runId, card: streamCard(card) });
      await resumeOperationsAttempt({
        actorClerkId: actor.clerkId,
        runId,
        resultCardId: confirmation.resultCardId!,
        executionId: approvalExecutionId,
        workerId: `event-confirm:${crypto.randomUUID()}`,
      });
    });
  }

  return new Response("Unknown action", { status: 400 });
}
