import { openRunRelay } from "@/features/spectra/ai/harness/run-relay";
import { modelMemoryReflector, worthReflecting, type ReflectionRequest } from "@/features/spectra/ai/harness/memory-reflection";
import type { MemoryChangeResult } from "../../../../../../shared/memory-files";
import { traceEvent, withRunTrace } from "@/features/spectra/ai/harness/run-trace";
import { createRunItem } from "@/features/spectra/actions/protocol";
import { threadFold, threadFoldTranscript } from "@/features/spectra/ai/harness/compaction";
import { modelSummariser, runHarness, type HarnessEvent, type RunCheckpoint } from "@/features/spectra/ai/harness/run";
import {
  RUNTIME_NAMES,
  RuntimeOrderExhaustedError,
  subscriptionProviderFrom,
  type UnreachableRuntime,
} from "@/features/spectra/ai/harness/subscription-runtime";
import type { LoopState } from "@/features/spectra/ai/harness/loop";
import { alwaysAllowLabel, withThreadAllows } from "@/features/spectra/ai/harness/permissions";
import { citedSources, withoutCitations } from "@/features/spectra/ai/harness/sources";
import type { ArtifactTouch, HarnessMessage, InputAnswer, PendingInput, Steer } from "@/features/spectra/ai/harness/types";
import { SPECTRA_RUN_HEARTBEAT_INTERVAL_MS, SPECTRA_RUN_QUIET_HEARTBEAT_MS } from "@/features/spectra/ai/run-lease";
import { runLog, withSpectraRunLog } from "@/features/spectra/ai/run-log";
import { runUsageSnapshot, withRunUsageLedger } from "@/features/spectra/ai/run-usage";
import { getSpectraModelId } from "@/features/spectra/ai/model-config";
import { plainEmphasis } from "@/features/spectra/ai/inline-emphasis";
import type { PreparedAttachment, ResultAction, RunPointers, Surface } from "./contract";
import { AGENT_UNAVAILABLE, AgentUnavailableError, loadAgent, readAgentIndex, readThreadSummary, type ThreadSummary } from "./agents";
import { loadRunAttachments } from "./attachments";
import { ConvexHarnessBackend } from "./convex-backend";
import {
  EMPTY_HISTORY,
  attachmentParts,
  buildEnvironment,
  readRunPreferences,
  readThreadHistory,
  validTimeZone,
  type RunPreferences,
  type ThreadHistory,
  readMemoryHead,
} from "./environment";
import { mutate, query } from "./io";
import {
  coalesceTextDeltas,
  latestCard,
  legacyEventForRunItem,
  protocolItemForLegacyEvent,
  publicError,
  saveAssistantMessage,
  streamCard,
} from "./report";
import { awaitedUiOperation, cancelUiObservation, notifyUiObservation } from "./ui-observation";

/*
 * One attempt of a Spectra run on the server: claim the lease, build the
 * environment, run the harness loop, and keep Convex in step. Live events go
 * to the open client and, batched, to the run's durable event log, so every
 * view (chat, side panel, Live Dock) shows the same progress after a reload.
 *
 * Bookkeeping never fails a run: event writes, titles and memory signals are
 * best effort. The only terminal failure is the model being unreachable.
 */

/** A serverless route stops at 300 s; hand the run on well before that. */
const YIELD_AFTER_MS = 230_000;
/** One small model call against the notes as they are now, after the reply went out. */
async function reflectOnRun(actorClerkId: string, runId: string, request: Omit<ReflectionRequest, "head">) {
  try {
    const head = await readMemoryHead(actorClerkId);
    if (!head.enabled) return;
    const changes = await modelMemoryReflector({ ...request, head }, AbortSignal.timeout(45_000));
    for (const change of changes)
      await mutate<unknown & object, MemoryChangeResult>("spectraMemory:update", { actorClerkId, runId, ...change });
  } catch (error) {
    runLog().warn("spectra.harness.memory_reflection", { error: error instanceof Error ? error.message : String(error) });
  }
}

/*
 * The open client reads the stream. The durable log is for reloads, other
 * devices and the saved trace, so it takes a few batched writes, not one per step.
 */
const STEP_FLUSH_MS = 1_500;
const TEXT_FLUSH_MS = 4_000;
/** With the live relay open the page already has it all, so the log can wait longer. */
const RELAYED_FLUSH_MS = 10_000;
/** Reasoning kept in the durable log; the live stream always has all of it. */
const STORED_REASONING_PER_PART = 6_000;
const STORED_REASONING_PER_RUN = 40_000;
/** The transcript is saved this often; a crash loses at most these seconds of work. */
const CHECKPOINT_EVERY_MS = 12_000;
const STATE_LIMIT_CHARS = 800_000;

export type AttemptMode = "start" | "resume" | "retry";

export type AttemptParams = RunPointers & {
  actorClerkId: string;
  runId: string;
  resultCardId: string;
  executionId: string;
  workerId: string;
  prompt: string;
  surface: Surface;
  threadId?: string;
  workspaceId?: string;
  scopeNodeId?: string;
  artifactId?: string;
  timeZone?: string;
  /** A custom agent the user chose. */
  agentId?: string;
  attachments?: PreparedAttachment[];
  /**
   * start: a new request. resume: continue this attempt from its checkpoint
   * (an answer, or a hand-off from a worker that ran out of time). retry: a
   * new attempt that carries on from the previous attempt's checkpoint.
   */
  mode: AttemptMode;
  /** Scheduled workers may hand off long runs; inline streams finish in place. */
  scheduled?: boolean;
  /** One live request; automatic handoffs stay on the same relay. */
  relayId?: string;
  /** Runtimes the person's computer said it can't reach as they sent; only the first attempt uses it. */
  unreachable?: UnreachableRuntime[];
  signal?: AbortSignal;
};

/** The scheduled payload that resumes this run in a fresh worker. */
export function resumePayload(params: AttemptParams) {
  return {
    mode: "resume" as const,
    prompt: params.prompt,
    surface: params.surface,
    threadId: params.threadId,
    workspaceId: params.workspaceId,
    scopeNodeId: params.scopeNodeId,
    artifactId: params.artifactId,
    currentView: params.currentView,
    open: params.open,
    selection: params.selection,
    references: params.references,
    timeZone: params.timeZone,
    agentId: params.agentId,
    relayId: params.relayId,
  };
}

/** Convex stores at most 1 MB per value. Trim old tool output and images. */
/** What the user is looking at and pointed to, most important first: a search ranking hint. */
export function openItemIds(params: Pick<AttemptParams, "artifactId" | "open" | "references" | "threadId">) {
  const ids = [
    params.artifactId,
    ...(params.references ?? []).map((pointer) => pointer.id),
    ...(params.open ?? []).map((pointer) => pointer.id),
    params.threadId,
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)].slice(0, 12);
}

export function storableState(state: LoopState): LoopState {
  const plain = JSON.parse(JSON.stringify(state)) as LoopState;
  if (JSON.stringify(plain).length <= STATE_LIMIT_CHARS) return plain;
  const keepFrom = Math.max(0, plain.messages.length - 6);
  plain.messages = plain.messages.map((message, index): HarnessMessage => {
    if (message.role === "tool" && index < keepFrom && message.content.length > 1_500)
      return { ...message, content: `${message.content.slice(0, 1_500)}\n… (trimmed)` };
    if (message.role === "user" && Array.isArray(message.content))
      return {
        role: "user",
        content: message.content.map((part) =>
          part.type === "text"
            ? { ...part, text: part.text.length > 20_000 ? `${part.text.slice(0, 20_000)}\n… (trimmed)` : part.text }
            : { type: "text" as const, text: "[An attachment the user sent earlier.]" },
        ),
      };
    return message;
  });
  return plain;
}

/** A retry continues the transcript; calls left open by the last attempt are closed. */
function retriedState(state: LoopState): LoopState {
  const messages = [...state.messages];
  for (const call of state.pendingCalls)
    messages.push({ role: "tool", tool_call_id: call.id, content: "Not run: the request was retried. Do it again if it is still needed." });
  return { ...state, messages, pendingCalls: [], pending: undefined, turns: 0, elapsedMs: 0, budgetNoticeGiven: false };
}

function dedupeTouches(touches: ArtifactTouch[]) {
  const byId = new Map<string, ArtifactTouch>();
  for (const touch of touches) {
    const previous = byId.get(touch.id);
    // A creation stays a creation however often it is edited afterwards.
    // So does where the first edit landed.
    byId.set(touch.id, previous ? { ...touch, action: previous.action === "created" ? "created" : touch.action, change: touch.change ?? previous.change, region: previous.region ?? touch.region } : touch);
  }
  return [...byId.values()];
}

function answerLabel(pending: PendingInput | null | undefined, answer: InputAnswer) {
  if (answer.kind === "approval") return answer.allowed ? (answer.alwaysAllow ? "Allowed, and always allowed from now on" : "Allowed") : "Not allowed";
  return answer.text?.trim() || answer.choiceLabel || pending?.options?.find((option) => option.key === answer.choiceKey)?.label || "Answered";
}

/**
 * The agent for this run: the one the user chose, or the one this thread kept
 * using. Otherwise the model sees the user's agents and may hand off itself.
 */
async function readAgents(params: AttemptParams, thread: Promise<ThreadSummary | null>) {
  const routing = { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId };
  if (params.agentId) {
    const chosen = await loadAgent(routing, params.agentId, "explicit", "Selected by you");
    if (!chosen) throw new AgentUnavailableError();
    return { agent: chosen, agents: [] };
  }
  const [index, retainedId] = await Promise.all([
    readAgentIndex(params.actorClerkId, params.prompt),
    thread.then((summary) => summary?.retainedAgentId),
  ]);
  const retained =
    retainedId && index.some((entry) => entry.id === retainedId)
      ? await loadAgent(routing, retainedId, "continued", "Used earlier in this conversation")
      : null;
  return retained ? { agent: retained, agents: [] } : { agent: null, agents: index };
}

/** How long folding a thread's notes may take after the reply is out. */
const FOLD_TIMEOUT_MS = 90_000;

/**
 * Fold the oldest of a long thread's messages into its running notes, so the
 * next run, however much later, still knows the whole conversation.
 */
async function foldThreadHistory(params: AttemptParams, history: ThreadHistory, runtime: RunPreferences["runtime"] & { accountId?: string }) {
  const fold = params.threadId ? threadFold(history.unfolded) : null;
  if (!fold) return;
  const notes = (
    await modelSummariser({
      runtime,
      transcript: threadFoldTranscript(history.notes, fold.older),
      signal: AbortSignal.timeout(FOLD_TIMEOUT_MS),
    })
  ).trim();
  if (!notes) return;
  await mutate("spectraThreads:recordThreadNotes", {
    actorClerkId: params.actorClerkId,
    threadId: params.threadId,
    runId: params.runId,
    executionId: params.executionId,
    notes,
    through: fold.through,
  });
}

/** Attempts working in this process, so Stop reaches one at once instead of at its next heartbeat (F09). */
const liveAttempts = new Map<string, () => void>();

/** Stop an attempt running here now. False when it runs elsewhere; its heartbeat then ends it. */
export function stopLiveAttempt(runId: string, executionId: string | undefined) {
  const stop = executionId ? liveAttempts.get(`${runId}:${executionId}`) : undefined;
  stop?.();
  return Boolean(stop);
}

export function runHarnessAttempt(params: AttemptParams, emit: (event: unknown) => void) {
  return withRunUsageLedger(() =>
    withSpectraRunLog({ runId: params.runId, executionId: params.executionId }, () =>
      withRunTrace(params.runId, async () => {
        traceEvent("attempt.start", { mode: params.mode, executionId: params.executionId, worker: params.workerId?.split(":")[0] });
        try {
          return await attempt(params, emit);
        } finally {
          traceEvent("attempt.end", {});
        }
      }),
    ),
  );
}

type SavedHarnessState = {
  executionId: string;
  state: LoopState | null;
  toolOperations: Record<string, string[]>;
  pending: PendingInput | null;
  answer: InputAnswer | null;
};

/** What the saved reply says about the run itself: how long it worked, and who finished it if the run moved. */
function runAccount(result: { state: LoopState; finishedWith: keyof typeof RUNTIME_NAMES; moved: boolean }) {
  return { workedMs: result.state.elapsedMs, ...(result.moved ? { finishedWith: RUNTIME_NAMES[result.finishedWith] } : {}) };
}

/**
 * Everything the first model turn needs, read in parallel. These are reads
 * (an explicit agent also records its routing, which checks the attempt), so
 * they start before the claim instead of after it: the claim, the saved
 * state and the environment together cost one round trip, not four.
 */
async function readBeforeFirstTurn(params: AttemptParams) {
  const { actorClerkId, runId } = params;
  const thread = readThreadSummary(actorClerkId, params.threadId);
  const [loaded, agents, preferences, environment, history, threadSummary] = await Promise.all([
    query<unknown & object, SavedHarnessState | null>("spectraHarness:load", { actorClerkId, runId }).catch(() => null),
    readAgents(params, thread),
    readRunPreferences(actorClerkId),
    buildEnvironment({
      actorClerkId,
      currentView: params.currentView,
      open: params.open,
      selection: params.selection,
      references: params.references,
      surface: params.surface,
      workspaceId: params.workspaceId,
      attachments: params.attachments,
    }),
    params.mode === "start" ? readThreadHistory(actorClerkId, params.threadId, runId) : Promise.resolve(EMPTY_HISTORY),
    thread,
  ]);
  return { loaded, agents, preferences, environment, history, threadSummary };
}

/** Bind the attempt's owner once for its main and auxiliary CLI calls. */
async function runtimeFor(actorClerkId: string, runtime: RunPreferences["runtime"]) {
  if (!subscriptionProviderFrom(runtime.provider)) return runtime;
  const me = await query<unknown & object, { accountId?: unknown } | null>("identity:me", { actorClerkId }).catch(() => null);
  return me?.accountId ? { ...runtime, accountId: String(me.accountId) } : runtime;
}

async function attempt(params: AttemptParams, emit: (event: unknown) => void) {
  const started = Date.now();
  const { actorClerkId, runId, executionId } = params;
  const reads = readBeforeFirstTurn(params);
  // A lost claim ends the attempt before anything is written; the reads'
  // own failures surface below, inside the run's error handling.
  reads.catch(() => undefined);
  await mutate("spectraRuns:claimExecution", { actorClerkId, runId, executionId, workerId: params.workerId });
  traceEvent("attempt.claimed", {});

  // Live and durable events.
  let sequence = 0;
  let queued: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushDueAt = 0;
  let eventWrite: Promise<unknown> = Promise.resolve();
  let persistenceFailed = false;
  let wroteText = false;
  // Title writes finish before the worker ends, never before the reply.
  const titleWrites: Array<Promise<unknown>> = [];
  let steerWaiting = false;
  let lostRun: (() => void) | null = null;
  const storedReasoning = new Map<string, number>();
  let storedReasoningTotal = 0;
  const persist = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const events = coalesceTextDeltas(queued);
    queued = [];
    if (!events.length) return eventWrite;
    eventWrite = eventWrite
      .then(() =>
        mutate<unknown & object, { stopped?: boolean; steerWaiting?: boolean }>("spectraRuns:appendEvents", { actorClerkId, runId, executionId, events }),
      )
      .then((result) => {
        if (result?.steerWaiting) steerWaiting = true;
        if (result?.stopped) lostRun?.();
        return result;
      })
      .catch(() => {
        persistenceFailed = true;
        return null;
      });
    return eventWrite;
  };
  const IMMEDIATE = new Set(["final", "error", "stopped", "input_required", "artifact_touched", "compacted", "thread_title"]);
  // A scheduled worker has no stream to the page. The relay is that stream.
  const relay = params.scheduled ? openRunRelay(runId, executionId, params.relayId) : null;
  const publish = (event: Record<string, unknown>) => {
    const runItem = createRunItem(runId, sequence++, protocolItemForLegacyEvent(event));
    const wire = legacyEventForRunItem(runItem, event);
    try {
      emit(wire);
    } catch {
      // The client went away; the durable log still has everything.
    }
    relay?.send(wire);
    const type = String(event.type);
    if (type === "reasoning_delta") {
      const id = String(event.id);
      const length = String(event.content ?? "").length;
      const part = storedReasoning.get(id) ?? 0;
      if (!event.done && (part + length > STORED_REASONING_PER_PART || storedReasoningTotal + length > STORED_REASONING_PER_RUN)) return;
      storedReasoning.set(id, part + length);
      storedReasoningTotal += length;
    }
    queued.push({ type, payload: wire });
    // The first words reach a client that reads the durable log (a scheduled
    // run) at once; later text is batched.
    const firstText = type === "text_delta" && !wroteText;
    if (firstText) wroteText = true;
    const relayed = Boolean(relay?.connected());
    if ((firstText && !relayed) || IMMEDIATE.has(type)) {
      void persist();
      return;
    }
    // A step brings a waiting batch of words forward; words never delay a step.
    const delay = relayed ? RELAYED_FLUSH_MS : type === "text_delta" || type === "reasoning_delta" ? TEXT_FLUSH_MS : STEP_FLUSH_MS;
    const dueAt = Date.now() + delay;
    if (flushTimer && flushDueAt <= dueAt) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushDueAt = dueAt;
    flushTimer = setTimeout(() => void persist(), delay);
  };
  const flushEvents = async () => {
    await persist();
    await eventWrite;
    if (persistenceFailed)
      await mutate("spectraRuns:markTraceDegraded", { actorClerkId, runId, executionId }).catch(() => null);
  };
  /** A paused or handed-off run names its thread after the pause is durable. */
  const settleTitle = async (titling: Promise<void>) => {
    await titling;
    await Promise.all(titleWrites);
    await flushEvents();
  };

  // The lease: renewed by a heartbeat; losing it (Stop, takeover) aborts.
  const lease = new AbortController();
  const signal = params.signal ? AbortSignal.any([params.signal, lease.signal]) : lease.signal;
  lostRun = () => {
    lease.abort();
    cancelUiObservation(runId, executionId);
  };
  liveAttempts.set(`${runId}:${executionId}`, lostRun);
  let lastHeartbeat = Date.now();
  const heartbeat = setInterval(() => {
    const awaitedOperationId = awaitedUiOperation(runId, executionId);
    if (!awaitedOperationId && Date.now() - lastHeartbeat < SPECTRA_RUN_QUIET_HEARTBEAT_MS) return;
    lastHeartbeat = Date.now();
    const usage = runUsageSnapshot();
    void mutate<unknown & object, { alive: boolean; observation?: unknown }>("spectraRuns:heartbeat", {
      actorClerkId,
      runId,
      executionId,
      workerId: params.workerId,
      ...(awaitedOperationId ? { awaitedOperationId } : {}),
      ...(usage ? { usage } : {}),
    })
      .then((result) => {
        if (!result.alive) {
          lease.abort();
          cancelUiObservation(runId, executionId);
        }
        if (awaitedOperationId && result.observation)
          notifyUiObservation({ runId, executionId, operationId: awaitedOperationId }, result.observation as never);
      })
      .catch(() => null);
  }, SPECTRA_RUN_HEARTBEAT_INTERVAL_MS);

  // Whatever this attempt touched stops saying it is being written. An artifact
  // left marked would show Spectra's writing band until somebody refreshed.
  const settleArtifacts = (outcome: "clear" | "failed") =>
    mutate("spectraArtifacts:settleStagedForRun", { actorClerkId, runId, executionId, outcome }).catch(() => null);

  try {
    const { loaded, agents, preferences, environment, history, threadSummary } = await reads;
    const sameAttempt = loaded?.executionId === executionId;
    const timeZone = validTimeZone(params.timeZone) ?? "UTC";
    const backend = new ConvexHarnessBackend({
      actorClerkId,
      runId,
      executionId,
      threadId: params.threadId,
      workspaceId: params.workspaceId,
      scopeNodeId: params.scopeNodeId,
      prompt: params.prompt,
      timeZone,
      permissions: withThreadAllows(preferences.permissions, threadSummary?.allowedPermissionCategories),
      toolOperations: sameAttempt ? loaded?.toolOperations : {},
      openItemIds: openItemIds(params),
      onUiEvent: (event) => publish({ type: "ui_event", runId, key: event.key, ...(event.payload ? { payload: event.payload } : {}) }),
    });

    let resume: { state: LoopState; answer?: InputAnswer } | undefined;
    let restore: LoopState | undefined;
    const saved = loaded?.state && Array.isArray(loaded.state.messages) ? loaded.state : null;
    if (saved && params.mode === "resume" && sameAttempt) {
      if (loaded?.pending && loaded.answer) {
        resume = { state: saved, answer: loaded.answer };
        publish({ type: "input_answered", runId, toolCallId: loaded.pending.toolCallId, label: answerLabel(loaded.pending, loaded.answer) });
      } else restore = saved;
    } else if (saved && params.mode === "retry") restore = retriedState(saved);
    if (resume?.state.pending && resume.answer?.kind === "approval" && !resume.answer.allowed)
      backend.toolOperations.delete(resume.state.pending.toolCallId);

    // Files sent with a message that joined the run, read back for the model.
    const withFiles = async (steer: { text: string; attachmentIds?: string[] }): Promise<Steer> => {
      if (!steer.attachmentIds?.length) return { text: steer.text };
      const files = await loadRunAttachments(runId, executionId, steer.attachmentIds).catch(() => null);
      if (!files) return { text: `${steer.text}\n\n(The files I attached could not be read.)`.trim() };
      return { text: steer.text, parts: attachmentParts(files) };
    };
    let firstCheckpoint = true;
    const resumed = Boolean(resume);
    let lastSaved = 0;
    const takeSteers = async () => {
      steerWaiting = false;
      const result = await mutate<unknown & object, { steers: Array<{ text: string; attachmentIds?: string[] }>; active: boolean }>(
        "spectraHarness:takeSteers",
        { actorClerkId, runId, executionId },
      );
      if (!result.active) lease.abort();
      return { steers: await Promise.all(result.steers.map((steer) => withFiles(steer))) };
    };
    const checkpoint = async ({ state, status, ending }: RunCheckpoint) => {
      // A finished run's words are in its thread.
      if (status === "completed") {
        await mutate("spectraHarness:discardCheckpoint", { actorClerkId, runId }).catch(() => null);
        return { steers: [] };
      }
      // Between saves, the only thing a boundary needs is a message the user sent.
      const due = status !== "running" || firstCheckpoint || Date.now() - lastSaved >= CHECKPOINT_EVERY_MS;
      if (!due) return steerWaiting || ending ? takeSteers() : { steers: [] };
      lastSaved = Date.now();
      steerWaiting = false;
      const result = await mutate<
        unknown & object,
        { steers: Array<{ text: string; attachmentIds?: string[] }>; active: boolean }
      >("spectraHarness:saveCheckpoint", {
        actorClerkId,
        runId,
        executionId,
        state: storableState(state),
        ...(status === "paused" && state.pending ? { pending: state.pending } : firstCheckpoint && resumed ? { clearPending: true } : {}),
      });
      firstCheckpoint = false;
      if (!result.active) lease.abort();
      return { steers: await Promise.all(result.steers.map((steer) => withFiles(steer))) };
    };

    const onEvent = (event: HarnessEvent) => {
      switch (event.type) {
        case "text":
          publish({ type: "text_delta", runId, content: event.delta });
          return;
        case "text_reset":
          publish({ type: "text_replace", runId, content: event.text });
          return;
        case "step_start":
          publish({ type: "step", runId, id: event.id, label: event.label, status: "running", ...(event.work ? { work: event.work } : {}), ...(event.detail ? { detail: event.detail } : {}) });
          return;
        case "step_end":
          publish({ type: "step", runId, id: event.id, label: event.label, status: event.ok ? "done" : "error", durationMs: event.durationMs, ...(event.detail ? { detail: event.detail } : {}) });
          return;
        case "reasoning":
          publish({ type: "reasoning_delta", runId, id: event.id, content: event.delta, ...(event.done ? { done: true } : {}) });
          return;
        case "artifact":
          publish({ type: "artifact_touched", runId, artifact: event.artifact });
          return;
        case "todos":
          publish({ type: "todos", runId, todos: event.todos });
          return;
        case "sources":
          publish({ type: "sources", runId, sources: event.sources });
          return;
        case "widget":
          publish({ type: "widget", runId, id: event.id, title: event.widget.title, html: event.widget.html });
          return;
        case "ui_event":
          publish({ type: "ui_event", runId, key: event.key, ...(event.payload ? { payload: event.payload } : {}) });
          return;
        case "compacted":
          publish({ type: "compacted", runId });
          return;
        case "thread_title":
          if (params.threadId)
            titleWrites.push(
              mutate("spectraThreads:applyGeneratedMetadata", {
                actorClerkId,
                threadId: params.threadId,
                runId,
                executionId,
                title: event.title,
                ...(event.placeId ? { workspaceId: event.placeId } : {}),
              }).catch(() => null),
            );
          publish({ type: "thread_title", runId, title: event.title });
          return;
        case "input_required":
          // Published with its card once the run has durably paused.
          return;
      }
    };

    const runtime = {
      ...(await runtimeFor(actorClerkId, preferences.runtime)),
      ...(params.mode === "start" && params.unreachable?.length ? { unreachable: params.unreachable } : {}),
    };
    const result = await runHarness({
      runId,
      backend,
      signal,
      prompt: params.prompt,
      attachments: attachmentParts(params.attachments),
      history: history.messages,
      environment: {
        ...environment,
        timeZone,
        ...(agents.agent ? { agent: { title: agents.agent.title, instructions: agents.agent.instructions } } : {}),
        ...(agents.agents.length ? { agents: agents.agents } : {}),
      },
      permissions: withThreadAllows(preferences.permissions, threadSummary?.allowedPermissionCategories),
      runtime,
      workspaceId: params.workspaceId,
      // Any attempt names a thread that still needs it, resumed ones too.
      wantTitle: Boolean(threadSummary?.needsTitle),
      otherThreadTitles: async () => {
        const listed = await query<unknown & object, { threads?: Array<{ _id?: string; title?: string }> } | null>(
          "spectraThreads:list",
          { limit: 13, brief: true },
        );
        return (listed?.threads ?? [])
          .filter((thread) => thread._id !== params.threadId && typeof thread.title === "string" && thread.title.trim())
          .map((thread) => String(thread.title).trim())
          .slice(0, 12);
      },
      ...(resume ? { resume } : restore ? { restore } : {}),
      textFlushMs: TEXT_FLUSH_MS,
      shouldYield: params.scheduled ? () => Date.now() - started > YIELD_AFTER_MS : undefined,
      sink: {
        emit: onEvent,
        checkpoint,
        flushText: async () => {
          await persist();
        },
      },
    });
    clearInterval(heartbeat);
    const usage = runUsageSnapshot();
    const reply = result.state.text.trim();
    // What the run closed with: the words after its last tool call. A tab's summary and the reply peek open on
    // these, not on what it said before it started working.
    const lastMessage = result.state.messages.at(-1);
    const closing =
      lastMessage?.role === "assistant" && !("tool_calls" in lastMessage && lastMessage.tool_calls?.length) && typeof lastMessage.content === "string"
        ? lastMessage.content.trim()
        : "";
    const touches = dedupeTouches(result.state.artifacts);

    if (result.status === "yielded") {
      await flushEvents();
      await mutate("spectraHarness:handoff", {
        actorClerkId,
        runId,
        executionId,
        resultCardId: params.resultCardId,
        payload: resumePayload(params),
      });
      await settleTitle(result.titling);
      return;
    }

    if (result.status === "paused") {
      const pending = result.pending;
      await flushEvents();
      await settleArtifacts("clear");
      await mutate("spectraRuns:updateStatus", {
        actorClerkId,
        runId,
        executionId,
        status: pending.kind === "approval" ? "awaiting_confirmation" : "awaiting_resolution",
        outcome: "awaiting_input",
        // "clarify" lets the Dock take a typed answer; the route sends it to this run.
        ...(pending.kind === "approval" ? { approvalReasons: [plainEmphasis(pending.question).slice(0, 400)] } : { decision: "clarify" as const }),
        resultTitle: pending.kind === "approval" ? "Needs your OK" : "Needs your answer",
        resultSummary: plainEmphasis(pending.question).slice(0, 600),
        resultVariant: "status",
        // The Dock answers an approval in place; a question is answered in the thread.
        resultActions:
          pending.kind === "approval"
            ? [
                { key: "confirm", label: "Allow", targetType: "run", targetId: runId },
                { key: "cancel", label: "Don't allow", targetType: "run", targetId: runId },
              ]
            : params.threadId
              ? [{ key: "continue", label: "Answer in the conversation", targetType: "thread", targetId: params.threadId }]
              : [],
        ...(usage ? { usage } : {}),
      });
      const card = await latestCard(actorClerkId, runId);
      const allowLabel = pending.kind === "approval" ? alwaysAllowLabel(pending.category) : undefined;
      publish({
        type: "input_required",
        runId,
        input: {
          kind: pending.kind,
          toolCallId: pending.toolCallId,
          executionId,
          question: pending.question,
          ...(pending.options?.length ? { options: pending.options } : {}),
          ...(pending.allowText ? { allowText: true } : {}),
          ...(allowLabel ? { alwaysAllowLabel: allowLabel } : {}),
        },
        card: streamCard(card),
      });
      await flushEvents();
      await settleTitle(result.titling);
      return;
    }

    if (result.status === "stopped") {
      // A stopped run always leaves its reply in the thread, however little it said: the words so far, the work it
      // touched and its trace stay with the conversation instead of vanishing with the live view.
      const content = reply || (touches.some((touch) => touch.action !== "referenced") ? "Stopped. What was done before stopping is kept." : "Stopped before replying.");
      await saveAssistantMessage({
        actorClerkId,
        threadId: params.threadId,
        runId,
        executionId,
        content,
        affected: backend.affected,
        artifacts: touches,
        widgets: result.state.widgets,
        sources: citedSources(content, result.state.sources),
        model: getSpectraModelId(),
        ...runAccount(result),
      }).catch(() => null);
      publish({ type: "stopped", runId, partial: Boolean(reply || touches.length) });
      await flushEvents();
      return;
    }

    if (result.status === "failed") {
      runLog().error("spectra.harness.provider_unreachable", result.error);
      // An order the person emptied ends in their own words; anything else is Spectra's model failing.
      const message = result.error instanceof RuntimeOrderExhaustedError
        ? result.error.message
        : "Spectra could not reach the AI model just now. Your artifact so far is kept; try again in a moment.";
      await flushEvents();
      await settleArtifacts("clear");
      await mutate("spectraRuns:updateStatus", {
        actorClerkId,
        runId,
        executionId,
        status: "failed",
        error: message,
        finalSummary: message,
        resultTitle: "Could not reach the AI",
        resultSummary: message,
        resultVariant: "status",
        resultActions: [{ key: "retry", label: "Try again", targetType: "run", targetId: runId }],
        recoveryState: "interrupted",
        retryable: true,
        preservedPartial: Boolean(reply || touches.length),
        ...(usage ? { usage } : {}),
      });
      const card = await latestCard(actorClerkId, runId);
      publish({ type: "error", runId, message, card: streamCard(card) });
      await flushEvents();
      return;
    }

    // Completed.
    const artifactIds = [...new Set(touches.map((touch) => touch.id))].slice(0, 24);
    const changed = backend.changedWorkspace || touches.some((touch) => touch.action !== "referenced");
    const actions: ResultAction[] = [
      ...artifactIds.map((targetId) => ({ key: "open", label: "Open", targetType: "artifact" as const, targetId })),
      ...(changed ? [{ key: "revert", label: "Undo this run", targetType: "run" as const, targetId: runId }] : []),
    ];
    const content = reply || (touches.length ? "Done." : "I could not put an answer together. Please try again.");
    await flushEvents();
    await settleArtifacts("clear");
    await mutate("spectraRuns:updateStatus", {
      actorClerkId,
      runId,
      executionId,
      status: "completed",
      decision: backend.executedAny ? "operate" : "answer",
      finalSummary: withoutCitations(closing || content),
      resultTitle: "Done",
      resultSummary: withoutCitations(closing || content).slice(0, 2_000),
      resultVariant: artifactIds.length ? "artifact" : "status",
      resultActions: actions,
      provenance: {
        artifactIds,
        artifactTitles: touches.map((touch) => touch.title).slice(0, 24),
        artifactTypes: touches.map((touch) => touch.type).slice(0, 24),
        // What the reply peek and the artifact card need: which works are new, and where each edit landed.
        createdIds: touches.filter((touch) => touch.action === "created").map((touch) => touch.id).slice(0, 24),
        regions: touches.flatMap((touch) => (touch.action === "edited" && touch.region ? [{ artifactId: touch.id, regionId: touch.region }] : [])).slice(0, 24),
        ...(params.threadId ? { threadId: params.threadId } : {}),
        ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
        workedMs: Math.round(result.state.elapsedMs),
      },
      providerUsed: result.finishedWith,
      outcome: backend.executedAny ? "canonical_saved" : "answer_only",
      modelUsed: getSpectraModelId(),
      ...(usage ? { usage } : {}),
    });
    await saveAssistantMessage({
      actorClerkId,
      threadId: params.threadId,
      runId,
      executionId,
      content,
      decision: backend.executedAny ? "operate" : "answer",
      affected: backend.affected,
      artifacts: touches,
      widgets: result.state.widgets,
      sources: citedSources(content, result.state.sources),
      model: getSpectraModelId(),
      ...runAccount(result),
    }).catch(() => null);
    // The reply is out; the notes catch up behind it.
    if (params.mode === "start" && !params.scheduled && !result.memoryWritten && worthReflecting(params.prompt))
      titleWrites.push(
        reflectOnRun(actorClerkId, runId, {
          runtime,
          prompt: params.prompt,
          reply: content,
          context: [environment.page, ...touches.slice(0, 2).map((touch) => touch.title)].filter(Boolean).join(", "),
        }),
      );
    const card = await latestCard(actorClerkId, runId);
    publish({ type: "text_replace", runId, content });
    publish({ type: "final", runId, summary: content, card: streamCard(card) });
    await flushEvents();
    // A short run can end before its thread is named; the reply is already out.
    await settleTitle(result.titling);
    titleWrites.push(
      foldThreadHistory(params, history, runtime).catch((error) =>
        runLog().warn("spectra.harness.thread_fold", { error: error instanceof Error ? error.message : String(error) }),
      ),
    );
    runLog().info("spectra.harness.completed", { durationMs: Date.now() - started, turns: result.state.turns });
  } catch (error) {
    clearInterval(heartbeat);
    // A bug or an unavailable store, not the model: report it plainly and
    // keep the run retryable. Stop already settled a cancelled run.
    runLog().error("spectra.harness.attempt", error instanceof Error ? error : new Error(String(error)));
    const current = await query<unknown & object, { run: { status: string } }>("spectraRuns:get", { actorClerkId, runId }).catch(() => null);
    if (current && current.run.status !== "running" && current.run.status !== "queued") return;
    // The chosen agent went away: retrying cannot help, choosing again can.
    const agentGone = error instanceof AgentUnavailableError;
    const message = agentGone ? error.message : publicError(error);
    await flushEvents().catch(() => null);
    await settleArtifacts("clear");
    await mutate("spectraRuns:updateStatus", {
      actorClerkId,
      runId,
      executionId,
      status: "failed",
      error: agentGone ? `${AGENT_UNAVAILABLE}: ${message}` : message,
      finalSummary: message,
      resultTitle: agentGone ? "Agent unavailable" : "Something went wrong",
      resultSummary: message,
      resultVariant: "status",
      resultActions: agentGone ? [] : [{ key: "retry", label: "Try again", targetType: "run", targetId: runId }],
      recoveryState: "interrupted",
      retryable: !agentGone,
      preservedPartial: false,
    }).catch(() => null);
    const card = await latestCard(actorClerkId, runId).catch(() => null);
    publish({ type: "error", runId, message, ...(agentGone ? { code: AGENT_UNAVAILABLE } : {}), ...(card ? { card: streamCard(card) } : {}) });
    await flushEvents().catch(() => null);
  } finally {
    clearInterval(heartbeat);
    liveAttempts.delete(`${runId}:${executionId}`);
    await Promise.all(titleWrites);
    if (flushTimer) clearTimeout(flushTimer);
    relay?.close();
  }
}
