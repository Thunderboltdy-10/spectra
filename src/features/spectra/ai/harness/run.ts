import type { HarnessBackend } from "./backend";
import { CaptionScheduler, modelCaptionWriter, type CaptionEvent, type CaptionWriter } from "./captions";
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
import { callSpectraModel, openRouterModelCaller, spectraModelContextWindow } from "./model";
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
 * the loop, captions, compaction and durable bookkeeping, wired together.
 * Storage and transport arrive as a sink, so the same driver serves the app
 * (Convex) and the evals (in memory).
 */

export type HarnessEvent =
  | { type: "text"; delta: string }
  | { type: "text_reset"; text: string }
  | { type: "step_start"; id: string; label: string; effect: ToolEffect; work?: string }
  | { type: "step_end"; id: string; ok: boolean; label: string; durationMs: number }
  | ({ type: "caption" } & CaptionEvent)
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
  captionWriter?: CaptionWriter | null;
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
  });
  const tools = buildHarnessTools(session);
  // Labels name what the user pointed at from the first step, without a read.
  const environment = input.environment;
  for (const item of [...(environment.open ?? []), ...(environment.references ?? []), ...(environment.selection?.in ? [environment.selection.in] : [])])
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

  const writer = input.captionWriter === undefined ? modelCaptionWriter : input.captionWriter;
  const captions = writer
    ? new CaptionScheduler({
        prompt: input.prompt,
        write: writer,
        wantTitle: input.wantTitle,
        // An unfiled thread is filed with its title, in the one place it is clearly about.
        ...(input.environment.here ? {} : { places: input.environment.places }),
        onCaption: (caption) => emit({ type: "caption", ...caption }),
        onTitle: (title, placeId) => emit({ type: "thread_title", title, ...(placeId ? { placeId } : {}) }),
      })
    : null;

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

  const outcome = await runHarnessLoop(
    state,
    {
      systemPrompt,
      tools,
      callModel: input.callModel ?? openRouterModelCaller,
      policy: (effect, category) => permissionDecision(effect, category, input.permissions),
      runId: input.runId,
      signal: input.signal,
      budgets: input.budgets,
      compact: input.compactor === undefined ? defaultCompactor() : (input.compactor ?? undefined),
      now,
      shouldYield: input.shouldYield,
      hooks: {
        onText: (delta) => {
          latestText += delta;
          captions?.text(delta);
          emit({ type: "text", delta });
          scheduleFlush();
        },
        onTextReset: (text) => {
          latestText = text;
          emit({ type: "text_reset", text });
          scheduleFlush();
        },
        onToolStart: (step) => {
          if (step.tool?.quiet) return;
          const work = step.args ? step.tool?.shows?.(step.args) : undefined;
          emit({ type: "step_start", id: step.call.id, label: step.label, effect: step.effect, ...(work ? { work } : {}) });
          captions?.stepStarted({ id: step.call.id, label: step.label });
        },
        ...(captions ? { onReasoning: (delta: string) => captions.thinking(delta) } : {}),
        onToolDraft: (draft) => {
          emit({ type: "step_start", id: draft.id, label: draft.label, effect: "write" });
          captions?.stepStarted({ id: draft.id, label: draft.label });
        },
        onToolEnd: (step) => {
          if (step.tool?.quiet) return;
          const label = step.outcome.doneLabel ?? step.label;
          emit({ type: "step_end", id: step.call.id, ok: step.outcome.ok, label, durationMs: step.durationMs });
          captions?.stepEnded({ id: step.call.id, ok: step.outcome.ok, doneLabel: step.outcome.doneLabel });
        },
        onTodos: (todos) => emit({ type: "todos", todos }),
        onWidget: (widget, step) => emit({ type: "widget", id: step.call.id, widget }),
        onUiEvents: (events) => {
          for (const event of events) emit({ type: "ui_event", key: event.key, payload: event.payload });
        },
        onCompacted: (summary) => emit({ type: "compacted", summary }),
        onPause: (pending) => emit({ type: "input_required", pending }),
        checkpoint: async (current) => {
          for (const touch of current.artifacts.slice(artifactsSeen)) emit({ type: "artifact", artifact: touch });
          // Later touches of a known artifact update its card in place.
          artifactsSeen = current.artifacts.length;
          emitSources(current);
          const result = await quietly(() => input.sink.checkpoint({ state: current, status: "running" }));
          return result ?? undefined;
        },
      },
    },
    input.resume?.answer,
  );

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
  let titling: Promise<void> = Promise.resolve();
  if (outcome.status === "paused" || outcome.status === "yielded")
    titling = captions ? captions.suspend().catch(() => undefined) : titling;
  else await quietly(() => captions?.finish({ stopped: outcome.status !== "completed" }));
  await quietly(() => input.sink.checkpoint({ state: outcome.state, status }));
  return { ...outcome, durationMs: now() - started, titling };
}
