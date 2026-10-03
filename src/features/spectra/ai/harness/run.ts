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
import type {
  ArtifactTouch,
  HarnessContentPart,
  HarnessMessage,
  InputAnswer,
  PendingInput,
  TodoItem,
  ToolEffect,
  WidgetOutput,
} from "./types";

/*
 * One Spectra run: the system prompt and environment, this thread's history,
 * the loop, captions, compaction and durable bookkeeping, wired together.
 * Storage and transport arrive as a sink, so the same driver serves the app
 * (Convex) and the smoke run (in memory).
 */

export type HarnessEvent =
  | { type: "text"; delta: string }
  | { type: "text_reset"; text: string }
  | { type: "step_start"; id: string; label: string; effect: ToolEffect }
  | { type: "step_end"; id: string; ok: boolean; label: string; durationMs: number }
  | ({ type: "caption" } & CaptionEvent)
  | { type: "artifact"; artifact: ArtifactTouch }
  | { type: "todos"; todos: TodoItem[] }
  | { type: "widget"; id: string; widget: WidgetOutput }
  | { type: "ui_event"; key: string; payload?: Record<string, unknown> }
  | { type: "compacted"; summary: string }
  | { type: "input_required"; pending: PendingInput }
  | { type: "thread_title"; title: string };

export type RunCheckpoint = {
  state: LoopState;
  status: "running" | "paused" | "completed" | "stopped" | "failed";
};

export type HarnessSink = {
  /** Live events for the open client. Must not throw. */
  emit: (event: HarnessEvent) => void;
  /**
   * The durable checkpoint at a tool boundary (about one write per tool
   * call). Returns user messages sent while the run worked.
   */
  checkpoint: (checkpoint: RunCheckpoint) => Promise<{ steers?: string[] } | void>;
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
};

export type HarnessRunResult = LoopOutcome & { durationMs: number };

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
  const session = createSession({ backend: input.backend, prompt: input.prompt, workspaceId: input.workspaceId });
  const tools = buildHarnessTools(session);
  const focused = input.environment.focused;
  // Labels name the focused artifact from the first step, without a read.
  if (focused) rememberTitle(session, focused.id, focused.title, focused.type);
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
        onCaption: (caption) => emit({ type: "caption", ...caption }),
        onTitle: (title) => emit({ type: "thread_title", title }),
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
  let widgetCount = 0;

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
          emit({ type: "step_start", id: step.call.id, label: step.label, effect: step.effect });
          captions?.stepStarted({ id: step.call.id, label: step.label });
        },
        onToolEnd: (step) => {
          const label = step.outcome.doneLabel ?? step.label;
          emit({ type: "step_end", id: step.call.id, ok: step.outcome.ok, label, durationMs: step.durationMs });
          captions?.stepEnded({ id: step.call.id, ok: step.outcome.ok, doneLabel: step.outcome.doneLabel });
        },
        onTodos: (todos) => emit({ type: "todos", todos }),
        onWidget: (widget, step) => {
          widgetCount += 1;
          emit({ type: "widget", id: `${step.call.id}-${widgetCount}`, widget });
        },
        onUiEvents: (events) => {
          for (const event of events) emit({ type: "ui_event", key: event.key, payload: event.payload });
        },
        onCompacted: (summary) => emit({ type: "compacted", summary }),
        onPause: (pending) => emit({ type: "input_required", pending }),
        checkpoint: async (current) => {
          for (const touch of current.artifacts.slice(artifactsSeen)) emit({ type: "artifact", artifact: touch });
          // Later touches of a known artifact update its card in place.
          artifactsSeen = current.artifacts.length;
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

  const status: RunCheckpoint["status"] =
    outcome.status === "paused" ? "paused" : outcome.status;
  if (outcome.status === "paused") captions?.cancel();
  else await quietly(() => captions?.finish({ stopped: outcome.status !== "completed" }));
  await quietly(() => input.sink.checkpoint({ state: outcome.state, status }));
  return { ...outcome, durationMs: now() - started };
}
