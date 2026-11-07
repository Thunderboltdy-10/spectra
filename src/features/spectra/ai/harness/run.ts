import { jsonSize, traceEvent, traceSpan } from "./run-trace";
import {
  runtimeFallbackLabel,
  subscriptionModelCaller,
  subscriptionProviderFrom,
  withRuntimeFallback,
  type RuntimeTarget,
} from "./subscription-runtime";
import type { HarnessBackend } from "./backend";
import { modelThreadTitleWriter, type ThreadTitleWriter } from "./thread-title";
import { createCompactor } from "./compaction";
import {
  emptyLoopState,
  runHarnessLoop,
  type Compactor,
  type LoopBudgets,
  type LoopOutcome,
  type LoopState,
  type ModelCaller,
} from "./loop";
import { callSpectraModel, createOpenRouterCaller, spectraModelContextWindow } from "./model";
import { permissionDecision, permissionSummary, type PermissionPrefs } from "./permissions";
import { buildSystemPrompt, type EnvironmentInput } from "./prompt";
import { SUMMARY_INSTRUCTIONS } from "./compaction";
import { buildHarnessTools, createSession } from "./tools";
import { rememberTitle } from "./tools/shared";
import type { RunSource } from "./sources";
import type {
  ArtifactTouch,
  HarnessContentPart,
  HarnessMessage,
  InputAnswer,
  PendingInput,
  Steer,
  TodoItem,
  ToolEffect,
  WidgetOutput,
} from "./types";

/*
 * One Spectra run: the system prompt and environment, this thread's history,
 * the loop, thread naming, compaction and durable bookkeeping, wired together.
 * Storage and transport arrive as a sink, so the same driver serves the app
 * (Convex) and the evals (in memory).
 */

export type HarnessEvent =
  | { type: "text"; delta: string }
  | { type: "text_reset"; text: string }
  | { type: "step_start"; id: string; label: string; effect: ToolEffect; work?: string }
  | { type: "step_end"; id: string; ok: boolean; label: string; durationMs: number }
  | { type: "reasoning"; id: string; delta: string; done?: boolean }
  | { type: "artifact"; artifact: ArtifactTouch }
  /** Everything the run has read that its reply may cite, so far. */
  | { type: "sources"; sources: RunSource[] }
  | { type: "todos"; todos: TodoItem[] }
  | { type: "widget"; id: string; widget: WidgetOutput }
  | { type: "ui_event"; key: string; payload?: Record<string, unknown> }
  | { type: "compacted"; summary: string }
  | { type: "input_required"; pending: PendingInput }
  | { type: "thread_title"; title: string; placeId?: string };

export type RunCheckpoint = {
  state: LoopState;
  status: "running" | "paused" | "completed" | "stopped" | "failed" | "yielded";
  /** The loop has nothing left to do unless the user sent something. */
  ending?: boolean;
};

export type HarnessSink = {
  /** Live events for the open client. Must not throw. */
  emit: (event: HarnessEvent) => void;
  /**
   * The durable checkpoint at a tool boundary (about one write per tool
   * call). Returns user messages sent while the run worked.
   */
  checkpoint: (checkpoint: RunCheckpoint) => Promise<{ steers?: Steer[] } | void>;
  /** The streamed reply, flushed about every 250 ms. */
  flushText?: (text: string) => Promise<void>;
};

export type HarnessRunInput = {
  runId: string;
  backend: HarnessBackend;
  sink: HarnessSink;
  signal: AbortSignal;
  /** The user's message for this run. */
  prompt: string;
  /** Images and files attached to the message, already as content parts. */
  attachments?: HarnessContentPart[];
  /** This thread's earlier turns, oldest first. Never other threads. */
  history?: HarnessMessage[];
  environment: Omit<EnvironmentInput, "permissions" | "timeZone"> & { timeZone?: string };
  permissions: PermissionPrefs;
  workspaceId?: string;
  /** The thread has no generated name yet. */
  wantTitle?: boolean;
  /** Resume a paused run with the user's answer. */
  resume?: { state: LoopState; answer?: InputAnswer };
  /** Continue after a crash or reload from the last checkpoint. */
  restore?: LoopState;
  callModel?: ModelCaller;
  /** The user's own choice of who runs the work. Unset is Spectra's model. */
  runtime?: RuntimeTarget & { provider?: unknown };
  titleWriter?: ThreadTitleWriter | null;
  compactor?: Compactor | null;
  budgets?: LoopBudgets;
  now?: () => number;
  textFlushMs?: number;
  /** Hand the run to a fresh worker at the next tool boundary. */
  shouldYield?: () => boolean;
};

export type HarnessRunResult = LoopOutcome & {
  durationMs: number;
  /**
   * A run that paused or handed off still names a thread that needs it; the
   * title is written after the run has durably paused, so the question is not
   * held back. Await it before the worker ends.
   */
  titling: Promise<void>;
  /** The agent changed its notes itself during this run. */
  memoryWritten: boolean;
};

function userMessage(prompt: string, attachments?: HarnessContentPart[]): HarnessMessage {
  if (!attachments?.length) return { role: "user", content: prompt };
  return { role: "user", content: [{ type: "text", text: prompt }, ...attachments] };
}

export const modelSummariser = async ({ transcript, signal }: { transcript: string; signal: AbortSignal }) => {
  const turn = await callSpectraModel({
    messages: [
      { role: "system", content: SUMMARY_INSTRUCTIONS },
      { role: "user", content: transcript },
    ],
    signal,
    title: "Spectra compaction",
  });
  return turn.text;
};

export function defaultCompactor(): Compactor {
  return createCompactor({
    contextWindow: () => spectraModelContextWindow(),
    summarise: modelSummariser,
  });
}

/** Swallow bookkeeping failures: they never fail the run. */
async function quietly<T>(work: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await work();
  } catch {
    return undefined;
  }
}

export async function runHarness(input: HarnessRunInput): Promise<HarnessRunResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const session = createSession({
    backend: input.backend,
    prompt: input.prompt,
    workspaceId: input.workspaceId,
    agents: input.environment.agent ? [] : input.environment.agents,
    places: input.environment.places,
    learner: input.environment.user?.role === "student",
  });
  const tools = buildHarnessTools(session);
  // Labels name what the user pointed at from the first step, without a read.
  const environment = input.environment;
  for (const item of [...(environment.recent ?? []), ...(environment.open ?? []), ...(environment.references ?? []), ...(environment.selection?.in ? [environment.selection.in] : [])])
    rememberTitle(session, item.id, item.title, item.type);
  const systemPrompt = buildSystemPrompt({
    ...input.environment,
    timeZone: input.environment.timeZone ?? input.backend.timeZone,
    now: input.environment.now ?? started,
    permissions: permissionSummary(input.permissions),
  });
  const emit = (event: HarnessEvent) => {
    try {
      input.sink.emit(event);
    } catch {
      // A dropped live event is recovered from the checkpoint.
    }
  };

  // A new thread is named beside the run; nothing waits for it. An unfiled one
  // is filed with its title, in the one place it is clearly about.
  const writeTitle = input.titleWriter === undefined ? modelThreadTitleWriter : input.titleWriter;
  const places = input.environment.here ? undefined : input.environment.places;
  const titling: Promise<void> =
    writeTitle && input.wantTitle
      ? writeTitle({ prompt: input.prompt, ...(places?.length ? { places } : {}) }, AbortSignal.timeout(45_000))
          .then((named) => {
            if (!named?.title) return;
            const placeId = places?.some((place) => place.id === named.placeId) ? named.placeId : undefined;
            if (placeId && !session.workspaceId) session.workspaceId = placeId;
            emit({ type: "thread_title", title: named.title, ...(placeId ? { placeId } : {}) });
          })
          .catch(() => undefined)
      : Promise.resolve();

  // One stretch of reasoning is one part of the trace; anything else ends it.
  let thinkingCount = 0;
  let thinkingPart: string | null = null;
  const endThinking = () => {
    if (!thinkingPart) return;
    emit({ type: "reasoning", id: thinkingPart, delta: "", done: true });
    thinkingPart = null;
  };

  // Text flushes at most every ~250 ms; the client also gets every delta live.
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let latestText = "";
  const flushText = () => {
    flushTimer = null;
    if (input.sink.flushText) void quietly(() => input.sink.flushText!(latestText));
  };
  const scheduleFlush = () => {
    if (!input.sink.flushText || flushTimer) return;
    flushTimer = setTimeout(flushText, input.textFlushMs ?? 250);
  };

  let state: LoopState;
  if (input.resume) state = input.resume.state;
  else if (input.restore) state = input.restore;
  else state = emptyLoopState([...(input.history ?? []), userMessage(input.prompt, input.attachments)]);
  latestText = state.text;
  let artifactsSeen = state.artifacts.length;
  let sourcesSeen = state.sources?.length ?? 0;
  const emitSources = (current: LoopState) => {
    const sources = current.sources ?? [];
    if (sources.length === sourcesSeen) return;
    sourcesSeen = sources.length;
    emit({ type: "sources", sources });
  };

  const provider = input.callModel ? null : subscriptionProviderFrom(input.runtime?.provider);
  const subscriptionCaller = provider ? subscriptionModelCaller(provider, input.runtime) : null;
  const openRouter = createOpenRouterCaller(input.runtime?.reasoning);
  const baseCaller =
    input.callModel ??
    (subscriptionCaller
      ? withRuntimeFallback(subscriptionCaller, openRouter, (reason) => {
          // Said once, in the trace, in words that tell the user what happened.
          const id = "runtime-fallback";
          const label = runtimeFallbackLabel(reason);
          emit({ type: "step_start", id, label, effect: "read" });
          emit({ type: "step_end", id, ok: true, label, durationMs: 0 });
        })
      : openRouter);
  traceEvent("run.harness_start", {
    runtime: provider ?? "openrouter",
    preference: input.runtime?.provider,
    systemChars: systemPrompt.length,
    toolCount: tools.length,
    priorMessages: state.messages.length,
    resumed: Boolean(input.resume || input.restore),
    promptChars: input.prompt.length,
  });
  let modelCallIndex = 0;
  const tracedCaller: ModelCaller = async (call) => {
    const index = ++modelCallIndex;
    const started = Date.now();
    let firstText: number | undefined;
    let firstReasoning: number | undefined;
    let firstDraft: number | undefined;
    let reasoningChars = 0;
    traceEvent("model.send", {
      index,
      messages: call.messages.length,
      promptChars: jsonSize(call.messages),
      toolSchemaChars: jsonSize(call.tools),
      toolChoice: call.toolChoice,
    });
    try {
      const turn = await baseCaller({
        ...call,
        onText: (delta) => {
          firstText ??= Date.now() - started;
          call.onText(delta);
        },
        onReasoning: (delta) => {
          firstReasoning ??= Date.now() - started;
          reasoningChars += delta.length;
          call.onReasoning?.(delta);
        },
        onToolDraft: (draft) => {
          firstDraft ??= Date.now() - started;
          call.onToolDraft?.(draft);
        },
      });
      traceEvent("model.end", {
        index,
        ms: Date.now() - started,
        firstText,
        firstReasoning,
        firstDraft,
        reasoningChars,
        textChars: turn.text.length,
        toolCalls: turn.toolCalls.map((tool) => ({ name: tool.name, argChars: tool.arguments.length })),
        finishReason: turn.finishReason,
        model: turn.model,
        provider: turn.provider,
        usage: turn.usage,
      });
      return turn;
    } catch (error) {
      traceEvent("model.error", {
        index,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      });
      throw error;
    }
  };

  const baseCompactor = input.compactor === undefined ? defaultCompactor() : (input.compactor ?? undefined);
  const outcome = await runHarnessLoop(
    state,
    {
      systemPrompt,
      tools,
      callModel: tracedCaller,
      policy: (effect, category) => permissionDecision(effect, category, input.permissions),
      runId: input.runId,
      signal: input.signal,
      budgets: input.budgets,
      compact: baseCompactor
        ? (request) => traceSpan("compact.check", { messages: request.messages.length }, () => baseCompactor(request))
        : undefined,
      now,
      shouldYield: input.shouldYield,
      hooks: {
        onText: (delta) => {
          latestText += delta;
          endThinking();
          emit({ type: "text", delta });
          scheduleFlush();
        },
        onTextReset: (text) => {
          latestText = text;
          emit({ type: "text_reset", text });
          scheduleFlush();
        },
        onToolStart: (step) => {
          traceEvent("tool.start", { id: step.call.id, name: step.call.name, argChars: step.call.arguments.length, effect: step.effect });
          if (step.tool?.quiet) return;
          endThinking();
          const work = step.args ? step.tool?.shows?.(step.args) : undefined;
          emit({ type: "step_start", id: step.call.id, label: step.label, effect: step.effect, ...(work ? { work } : {}) });
        },
        onReasoning: (delta: string) => {
          if (!delta) return;
          if (!thinkingPart) {
            thinkingCount += 1;
            thinkingPart = `thinking:${started}:${thinkingCount}`;
          }
          emit({ type: "reasoning", id: thinkingPart, delta });
        },
        onToolDraft: (draft) => {
          endThinking();
          emit({ type: "step_start", id: draft.id, label: draft.label, effect: "write" });
        },
        onToolEnd: (step) => {
          traceEvent("tool.end", {
            id: step.call.id,
            name: step.call.name,
            ok: step.outcome.ok,
            ms: step.durationMs,
            code: (step.outcome as { code?: unknown }).code,
            ...(step.outcome.ok ? {} : { error: String((step.outcome as { content?: unknown }).content ?? "").slice(0, 600) }),
            resultChars: jsonSize(step.outcome),
          });
          if (step.tool?.quiet) return;
          const label = step.outcome.doneLabel ?? step.label;
          emit({ type: "step_end", id: step.call.id, ok: step.outcome.ok, label, durationMs: step.durationMs });
        },
        onTodos: (todos) => emit({ type: "todos", todos }),
        onWidget: (widget, step) => emit({ type: "widget", id: step.call.id, widget }),
        onUiEvents: (events) => {
          for (const event of events) emit({ type: "ui_event", key: event.key, payload: event.payload });
        },
        onCompacted: (summary) => {
          traceEvent("compact.done", { summaryChars: summary.length });
          emit({ type: "compacted", summary });
        },
        onPause: (pending) => emit({ type: "input_required", pending }),
        checkpoint: async (current, info) => {
          for (const touch of current.artifacts.slice(artifactsSeen)) emit({ type: "artifact", artifact: touch });
          // Later touches of a known artifact update its card in place.
          artifactsSeen = current.artifacts.length;
          emitSources(current);
          const result = await traceSpan("checkpoint", { stateChars: jsonSize(current) }, () =>
            quietly(() => input.sink.checkpoint({ state: current, status: "running", ...(info?.ending ? { ending: true } : {}) })),
          );
          return result ?? undefined;
        },
      },
    },
    input.resume?.answer,
  );

  subscriptionCaller?.dispose?.();
  traceEvent("run.loop_end", { status: outcome.status, turns: outcome.state.turns, modelCalls: modelCallIndex });
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  latestText = outcome.state.text;
  if (input.sink.flushText) await quietly(() => input.sink.flushText!(latestText));
  for (const touch of outcome.state.artifacts.slice(artifactsSeen)) emit({ type: "artifact", artifact: touch });
  emitSources(outcome.state);

  const status: RunCheckpoint["status"] =
    outcome.status === "paused" ? "paused" : outcome.status;
  endThinking();
  await traceSpan("checkpoint.final", { stateChars: jsonSize(outcome.state) }, () =>
    quietly(() => input.sink.checkpoint({ state: outcome.state, status })),
  );
  traceEvent("run.harness_end", { status: outcome.status, ms: now() - started });
  return { ...outcome, durationMs: now() - started, titling, memoryWritten: session.memoryWritten === true };
}
