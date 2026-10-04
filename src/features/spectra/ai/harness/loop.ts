import { deniedResult } from "./permissions";
import {
  ProviderUnavailableError,
  providerToolSpec,
  toolEffect,
  ToolInputError,
  type AnyHarnessTool,
  type ArtifactTouch,
  type HarnessMessage,
  type HarnessToolCall,
  type InputAnswer,
  type ModelTurn,
  type PendingInput,
  type PermissionCategory,
  type ProviderToolSpec,
  type Steer,
  type TodoItem,
  type ToolEffect,
  type ToolOutcome,
  type ShownWidget,
  type WidgetOutput,
} from "./types";

/*
 * One model <-> tools loop.
 *
 *   repeat:
 *     stream the model's response with every tool available
 *     no tool calls -> done
 *     run the calls (independent ones in parallel, same-artifact writes in order)
 *     append every result, checkpoint, take any user message sent meanwhile
 *
 * The only terminal failure is the provider being unreachable after retries.
 * Every other problem becomes a tool result the model reads and handles.
 */

export const DEFAULT_LOOP_BUDGETS = {
  wallClockMs: 20 * 60_000,
  maxTurns: 200,
} as const;

export type LoopBudgets = { wallClockMs: number; maxTurns: number };

/** Widgets a reply keeps; older ones stay in the transcript only. */
const MAX_WIDGETS = 4;

export type RepeatRecord = { resultHash: string; count: number };

/** Everything needed to resume a run after a pause, a reload or a restart. */
export type LoopState = {
  /** The transcript after the system prompt. */
  messages: HarnessMessage[];
  turns: number;
  elapsedMs: number;
  /** The reply the user has seen so far, across turns. */
  text: string;
  artifacts: ArtifactTouch[];
  todos?: TodoItem[];
  /** The last widgets shown, newest last; the saved reply shows them again. */
  widgets?: ShownWidget[];
  /** Calls still waiting for the user; the first is the open question. */
  pendingCalls: HarnessToolCall[];
  pending?: PendingInput;
  repeats: Record<string, RepeatRecord>;
  budgetNoticeGiven?: boolean;
};

export function emptyLoopState(messages: HarnessMessage[]): LoopState {
  return {
    messages,
    turns: 0,
    elapsedMs: 0,
    text: "",
    artifacts: [],
    pendingCalls: [],
    repeats: {},
  };
}

export type ModelCaller = (input: {
  messages: HarnessMessage[];
  tools: ProviderToolSpec[];
  toolChoice: "auto" | "none";
  signal: AbortSignal;
  onText: (delta: string) => void;
  /** A failed attempt streamed text; the retry starts the turn again. */
  onRetry: () => void;
}) => Promise<ModelTurn>;

export type PermissionDecision = "allow" | "ask" | "deny";

export type ToolStepInfo = {
  call: HarnessToolCall;
  tool?: AnyHarnessTool;
  args?: Record<string, unknown>;
  label: string;
  effect: ToolEffect;
};

export type LoopHooks = {
  onTurnStart?: (turn: number) => void;
  onText?: (delta: string) => void;
  /** Replace the visible reply (a failed provider attempt is withdrawn). */
  onTextReset?: (text: string) => void;
  onModelTurn?: (turn: ModelTurn) => void;
  onToolStart?: (step: ToolStepInfo) => void;
  onToolEnd?: (
    step: ToolStepInfo & { outcome: ToolOutcome; durationMs: number },
  ) => void;
  onTodos?: (todos: TodoItem[]) => void;
  onWidget?: (widget: WidgetOutput, step: ToolStepInfo) => void;
  onUiEvents?: (
    events: NonNullable<ToolOutcome["uiEvents"]>,
    step: ToolStepInfo,
  ) => void;
  onCompacted?: (summary: string) => void;
  onPause?: (pending: PendingInput) => void;
  /**
   * Durable checkpoint at a tool boundary. Returns user messages sent while
   * the run worked; they join the next turn. Never throws into the loop.
   */
  checkpoint?: (
    state: LoopState,
  ) => Promise<{ steers?: Steer[] } | void> | { steers?: Steer[] } | void;
};

export type Compactor = (input: {
  system: HarnessMessage;
  messages: HarnessMessage[];
  signal: AbortSignal;
}) => Promise<{ messages: HarnessMessage[]; summary: string } | null>;

export type LoopDeps = {
  systemPrompt: string;
  tools: readonly AnyHarnessTool[];
  callModel: ModelCaller;
  /** Reads only the effect and its category; the user's choices are bound in. */
  policy: (effect: ToolEffect, category: PermissionCategory | undefined) => PermissionDecision;
  runId: string;
  signal: AbortSignal;
  budgets?: LoopBudgets;
  hooks?: LoopHooks;
  compact?: Compactor;
  now?: () => number;
  /**
   * The host must hand the run to a fresh worker (a serverless time limit).
   * Checked at tool boundaries only, so the run resumes from a checkpoint.
   */
  shouldYield?: () => boolean;
};

export type LoopOutcome =
  | { status: "completed"; state: LoopState }
  | { status: "paused"; state: LoopState; pending: PendingInput }
  | { status: "stopped"; state: LoopState }
  | { status: "yielded"; state: LoopState }
  | { status: "failed"; state: LoopState; error: ProviderUnavailableError };

const STOPPED_RESULT =
  "Stopped by the user before this finished. Nothing more was done for this step.";

function isAbort(error: unknown, signal: AbortSignal) {
  return (
    signal.aborted ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function canonicalArguments(raw: string) {
  try {
    return JSON.stringify(sortKeys(JSON.parse(raw)));
  } catch {
    return raw.trim();
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  return value;
}

function hashText(value: string) {
  // FNV-1a: stable, cheap, enough to tell "the same result again".
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function mergeArtifactTouches(
  current: ArtifactTouch[],
  incoming: ArtifactTouch[] | undefined,
) {
  if (!incoming?.length) return current;
  const rank = { created: 3, edited: 2, referenced: 1 } as const;
  const byId = new Map(current.map((touch) => [touch.id, touch]));
  for (const touch of incoming) {
    const existing = byId.get(touch.id);
    if (!existing) {
      byId.set(touch.id, touch);
      continue;
    }
    byId.set(touch.id, {
      ...existing,
      title: touch.title || existing.title,
      action:
        rank[touch.action] > rank[existing.action] ? touch.action : existing.action,
      // A card for something made in this run says what it is, not its latest tweak.
      change:
        existing.action === "created" && touch.action !== "created"
          ? (existing.change ?? touch.change)
          : (touch.change ?? existing.change),
    });
  }
  return [...byId.values()];
}

type Prepared = {
  call: HarnessToolCall;
  tool?: AnyHarnessTool;
  args?: Record<string, unknown>;
  effect: ToolEffect;
  label: string;
  category?: PermissionCategory;
  error?: string;
  targets: string[];
};

function prepare(call: HarnessToolCall, tools: Map<string, AnyHarnessTool>): Prepared {
  const tool = tools.get(call.name);
  if (!tool)
    return {
      call,
      effect: "read",
      label: "Checking a step",
      targets: [],
      error: `There is no tool called "${call.name}". Available tools: ${[...tools.keys()].join(", ")}.`,
    };
  let raw: Record<string, unknown>;
  try {
    const parsed = call.arguments.trim() ? JSON.parse(call.arguments) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not an object");
    raw = parsed as Record<string, unknown>;
  } catch {
    return {
      call,
      tool,
      effect: "read",
      label: fallbackLabel(tool.name),
      targets: [],
      error: `The arguments for ${tool.name} were not one valid JSON object. Send them again as a single JSON object.`,
    };
  }
  let args = raw;
  try {
    args = tool.parse ? tool.parse(raw) : raw;
  } catch (error) {
    return {
      call,
      tool,
      args: raw,
      effect: "read",
      label: safeLabel(tool, raw),
      targets: [],
      error:
        error instanceof ToolInputError || error instanceof Error
          ? `${tool.name}: ${error.message}`
          : `${tool.name}: the arguments are invalid.`,
    };
  }
  let effect: ToolEffect = "write";
  try {
    effect = toolEffect(tool, args);
  } catch {
    effect = "write";
  }
  let targets: string[] = [];
  try {
    targets = tool.targets?.(args) ?? [];
  } catch {
    targets = [];
  }
  let category: PermissionCategory | undefined;
  try {
    category = tool.category?.(args);
  } catch {
    category = undefined;
  }
  return { call, tool, args, effect, category, label: safeLabel(tool, args), targets };
}

function fallbackLabel(name: string) {
  return name.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function safeQuestion(prepared: Prepared) {
  try {
    const question = prepared.tool?.question?.(prepared.args ?? {})?.trim();
    if (question) return question;
  } catch {
    // Fall through to the label.
  }
  return `Allow Spectra to continue: ${prepared.label.replace(/^\w/, (letter) => letter.toLowerCase())}?`;
}

function safeLabel(tool: AnyHarnessTool, args: Record<string, unknown>) {
  try {
    const label = tool.label(args).trim();
    return label || fallbackLabel(tool.name);
  } catch {
    return fallbackLabel(tool.name);
  }
}

export async function runHarnessLoop(
  initial: LoopState,
  deps: LoopDeps,
  resumeAnswer?: InputAnswer,
): Promise<LoopOutcome> {
  const now = deps.now ?? Date.now;
  const budgets = deps.budgets ?? DEFAULT_LOOP_BUDGETS;
  const hooks = deps.hooks ?? {};
  const tools = new Map(deps.tools.map((tool) => [tool.name, tool]));
  const providerTools = deps.tools.map(providerToolSpec);
  const system: HarnessMessage = { role: "system", content: deps.systemPrompt };
  const segmentStartedAt = now();
  const state: LoopState = {
    ...initial,
    messages: [...initial.messages],
    artifacts: [...initial.artifacts],
    pendingCalls: [...initial.pendingCalls],
    repeats: { ...initial.repeats },
  };
  const baseElapsed = state.elapsedMs;
  const elapsed = () => baseElapsed + (now() - segmentStartedAt);

  const checkpoint = async () => {
    state.elapsedMs = elapsed();
    try {
      const result = await hooks.checkpoint?.(state);
      return result && Array.isArray(result.steers) ? result.steers : [];
    } catch {
      return [];
    }
  };

  const appendSteers = (steers: Steer[]) => {
    for (const steer of steers) {
      const text = steer.text.trim();
      if (steer.parts?.length)
        state.messages.push({ role: "user", content: [{ type: "text", text: text || "Files I attached:" }, ...steer.parts] });
      else if (text) state.messages.push({ role: "user", content: text });
    }
  };

  const noteRepeat = (prepared: Prepared, outcome: ToolOutcome): ToolOutcome => {
    const signature = `${prepared.call.name}:${canonicalArguments(prepared.call.arguments)}`;
    const key = hashText(signature);
    const resultHash = hashText(outcome.content);
    const previous = state.repeats[key];
    const count = previous && previous.resultHash === resultHash ? previous.count + 1 : 1;
    state.repeats[key] = { resultHash, count };
    const keys = Object.keys(state.repeats);
    if (keys.length > 64) delete state.repeats[keys[0]!];
    if (count < 3) return outcome;
    return {
      ...outcome,
      content: `${outcome.content}\n\nNote: this is call ${count} with exactly the same arguments and exactly the same result. Repeating it will not change anything.`,
    };
  };

  const finishStep = (prepared: Prepared, outcome: ToolOutcome, startedAt: number) => {
    const step: ToolStepInfo = {
      call: prepared.call,
      tool: prepared.tool,
      args: prepared.args,
      label: prepared.label,
      effect: prepared.effect,
    };
    state.artifacts = mergeArtifactTouches(state.artifacts, outcome.artifacts);
    if (outcome.todos) {
      state.todos = outcome.todos;
      hooks.onTodos?.(outcome.todos);
    }
    if (outcome.widget) {
      state.widgets = [...(state.widgets ?? []).filter((widget) => widget.id !== prepared.call.id), { id: prepared.call.id, ...outcome.widget }].slice(-MAX_WIDGETS);
      hooks.onWidget?.(outcome.widget, step);
    }
    if (outcome.uiEvents?.length) hooks.onUiEvents?.(outcome.uiEvents, step);
    hooks.onToolEnd?.({ ...step, outcome, durationMs: now() - startedAt });
  };

  const asksFirst = (prepared: Prepared) =>
    Boolean(prepared.tool && prepared.args && !prepared.error) &&
    (prepared.effect === "irreversible" || prepared.effect === "settings") &&
    deps.policy(prepared.effect, prepared.category) === "ask";

  const executeOne = async (prepared: Prepared, approved = false): Promise<ToolOutcome> => {
    const startedAt = now();
    const step: ToolStepInfo = {
      call: prepared.call,
      tool: prepared.tool,
      args: prepared.args,
      label: prepared.label,
      effect: prepared.effect,
    };
    hooks.onToolStart?.(step);
    let outcome: ToolOutcome;
    if (prepared.error || !prepared.tool || !prepared.args) {
      outcome = { ok: false, content: prepared.error ?? "This call could not run." };
    } else if (deps.signal.aborted) {
      outcome = { ok: false, content: STOPPED_RESULT };
    } else if (
      (prepared.effect === "irreversible" || prepared.effect === "settings") &&
      deps.policy(prepared.effect, prepared.category) === "deny"
    ) {
      outcome = { ok: false, content: deniedResult(prepared.category) };
    } else {
      try {
        const run = (granted: boolean) =>
          prepared.tool!.execute(prepared.args!, {
            signal: deps.signal,
            runId: deps.runId,
            toolCallId: prepared.call.id,
            approved: granted,
          });
        outcome = await run(approved);
        // A tool can discover mid-call that its effect needs approval (a
        // Bridge move that touches desktop files). The user's stored choices
        // apply exactly as they do to declared effects.
        if (outcome.pause?.kind === "approval") {
          if (approved)
            outcome = {
              ok: false,
              content: `${prepared.tool.name} asked for approval again after it was given. Nothing more was done for this step.`,
            };
          else if (deps.policy("irreversible", outcome.pause.category) === "deny")
            outcome = { ok: false, content: deniedResult(outcome.pause.category) };
          else if (deps.policy("irreversible", outcome.pause.category) === "allow")
            outcome = await run(true);
        }
      } catch (error) {
        outcome = isAbort(error, deps.signal)
          ? { ok: false, content: STOPPED_RESULT }
          : {
              ok: false,
              content: `${prepared.tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
            };
      }
    }
    if (!outcome.pause) {
      outcome = noteRepeat(prepared, outcome);
      finishStep(prepared, outcome, startedAt);
    }
    return outcome;
  };

  /** Pauses a call already returned this segment, so it is not run twice. */
  const knownPauses = new Map<string, NonNullable<ToolOutcome["pause"]>>();

  const toolMessage = (call: HarnessToolCall, outcome: ToolOutcome): HarnessMessage => ({
    role: "tool",
    tool_call_id: call.id,
    content: outcome.content,
  });

  /**
   * Work through calls that wait for the user, in order. Returns a pause when
   * one still needs an answer.
   */
  const drainDeferred = async (answer?: InputAnswer): Promise<PendingInput | null> => {
    let pendingAnswer = answer;
    while (state.pendingCalls.length) {
      const call = state.pendingCalls[0]!;
      const prepared = prepare(call, tools);
      const open = state.pending && state.pending.toolCallId === call.id ? state.pending : undefined;
      if (open && pendingAnswer) {
        const startedAt = now();
        let outcome: ToolOutcome;
        if (open.kind === "approval" && pendingAnswer.kind === "approval") {
          if (!pendingAnswer.allowed)
            hooks.onToolStart?.({
              call,
              tool: prepared.tool,
              args: prepared.args,
              label: prepared.label,
              effect: prepared.effect,
            });
          outcome = pendingAnswer.allowed
            ? await executeOne(prepared, true)
            : {
                ok: false,
                content: `The user did not allow this (${prepared.label}). Do not try it again in this run. Continue with anything else that is left, then tell the user what was not done.`,
              };
          if (!pendingAnswer.allowed) finishStep(prepared, outcome, startedAt);
        } else if (open.kind === "question" && pendingAnswer.kind === "question") {
          outcome =
            prepared.tool?.answer && prepared.args
              ? prepared.tool.answer(prepared.args, pendingAnswer)
              : {
                  ok: true,
                  content: `The user answered: ${pendingAnswer.text ?? pendingAnswer.choiceLabel ?? pendingAnswer.choiceKey ?? "(no answer)"}`,
                };
          finishStep(prepared, outcome, startedAt);
        } else {
          outcome = { ok: false, content: "The answer did not match the question, so this step was skipped." };
          finishStep(prepared, outcome, startedAt);
        }
        state.messages.push(toolMessage(call, outcome));
        state.pendingCalls.shift();
        state.pending = undefined;
        pendingAnswer = undefined;
        continue;
      }
      // A fresh deferred call: ask for approval, or run it to get its question.
      if (asksFirst(prepared)) {
        if (prepared.tool?.stage && !(open && open.kind === "approval")) {
          try {
            await prepared.tool.stage(prepared.args, {
              signal: deps.signal,
              runId: deps.runId,
              toolCallId: call.id,
            });
          } catch (error) {
            const startedAt = now();
            hooks.onToolStart?.({ call, tool: prepared.tool, args: prepared.args, label: prepared.label, effect: prepared.effect });
            const outcome: ToolOutcome = isAbort(error, deps.signal)
              ? { ok: false, content: STOPPED_RESULT }
              : { ok: false, content: `${prepared.tool.name} failed: ${error instanceof Error ? error.message : String(error)}` };
            finishStep(prepared, outcome, startedAt);
            state.messages.push(toolMessage(call, outcome));
            state.pendingCalls.shift();
            continue;
          }
        }
        const pending: PendingInput = {
          kind: "approval",
          toolCallId: call.id,
          toolName: call.name,
          question: safeQuestion(prepared),
          category: prepared.category,
        };
        state.pending = pending;
        return pending;
      }
      const known = knownPauses.get(call.id);
      knownPauses.delete(call.id);
      const outcome = known ? { ok: true, content: "", pause: known } : await executeOne(prepared);
      if (outcome.pause) {
        const pending: PendingInput = {
          ...outcome.pause,
          toolCallId: call.id,
          toolName: call.name,
        };
        state.pending = pending;
        return pending;
      }
      state.messages.push(toolMessage(call, outcome));
      state.pendingCalls.shift();
    }
    return null;
  };

  const runCalls = async (calls: HarnessToolCall[]): Promise<PendingInput | null> => {
    const prepared = calls.map((call) => prepare(call, tools));
    const deferred = new Set<string>();
    const outcomes = new Map<string, ToolOutcome>();
    const chains = new Map<string, Promise<void>>();
    const tasks: Promise<void>[] = [];
    for (const item of prepared) {
      if (asksFirst(item)) {
        deferred.add(item.call.id);
        continue;
      }
      const waits = item.targets.flatMap((target) => {
        const chain = chains.get(target);
        return chain ? [chain] : [];
      });
      const task = Promise.all(waits).then(async () => {
        const outcome = await executeOne(item);
        if (outcome.pause) {
          deferred.add(item.call.id);
          knownPauses.set(item.call.id, outcome.pause);
        }
        else outcomes.set(item.call.id, outcome);
      });
      const settled = task.then(
        () => undefined,
        () => undefined,
      );
      for (const target of item.targets) chains.set(target, settled);
      tasks.push(settled);
    }
    await Promise.all(tasks);
    for (const item of prepared) {
      const outcome = outcomes.get(item.call.id);
      if (outcome) state.messages.push(toolMessage(item.call, outcome));
    }
    state.pendingCalls = prepared
      .filter((item) => deferred.has(item.call.id))
      .map((item) => item.call);
    return drainDeferred();
  };

  const pause = async (pending: PendingInput): Promise<LoopOutcome> => {
    hooks.onPause?.(pending);
    await checkpoint();
    return { status: "paused", state, pending };
  };

  // Resume: answer the open question, then finish the turn's other calls.
  if (state.pendingCalls.length) {
    const pending = await drainDeferred(resumeAnswer);
    if (pending) return pause(pending);
    appendSteers(await checkpoint());
  }

  const turnsAtStart = state.turns;
  while (true) {
    if (deps.signal.aborted) {
      await checkpoint();
      return { status: "stopped", state };
    }
    if (state.turns > turnsAtStart && deps.shouldYield?.()) {
      await checkpoint();
      return { status: "yielded", state };
    }
    const budgetSpent =
      state.turns >= budgets.maxTurns || elapsed() >= budgets.wallClockMs;
    if (budgetSpent && !state.budgetNoticeGiven) {
      state.budgetNoticeGiven = true;
      state.messages.push({
        role: "user",
        content:
          "[Spectra] This run has used its time and step budget. Do not call any more tools. Tell the user plainly what is done and what is still left, so they can continue in a new message.",
      });
    }
    if (deps.compact) {
      try {
        const compacted = await deps.compact({
          system,
          messages: state.messages,
          signal: deps.signal,
        });
        if (compacted) {
          state.messages = compacted.messages;
          hooks.onCompacted?.(compacted.summary);
        }
      } catch {
        // Compaction is an optimisation; the next turn still has the full context.
      }
    }
    hooks.onTurnStart?.(state.turns + 1);
    const textBeforeTurn = state.text;
    let separatorPending = Boolean(state.text) && !/\n\n$/.test(state.text);
    let turn: ModelTurn;
    try {
      turn = await deps.callModel({
        messages: [system, ...state.messages],
        tools: providerTools,
        toolChoice: budgetSpent ? "none" : "auto",
        signal: deps.signal,
        onText: (delta) => {
          if (!delta) return;
          if (separatorPending) {
            separatorPending = false;
            const separator = state.text.endsWith("\n") ? "\n" : "\n\n";
            state.text += separator;
            hooks.onText?.(separator);
          }
          state.text += delta;
          hooks.onText?.(delta);
        },
        onRetry: () => {
          if (state.text !== textBeforeTurn) {
            state.text = textBeforeTurn;
            hooks.onTextReset?.(state.text);
          }
          separatorPending = Boolean(state.text) && !/\n\n$/.test(state.text);
        },
      });
    } catch (error) {
      if (isAbort(error, deps.signal)) {
        await checkpoint();
        return { status: "stopped", state };
      }
      const failure =
        error instanceof ProviderUnavailableError
          ? error
          : new ProviderUnavailableError(
              error instanceof Error ? error.message : "The model could not be reached.",
              error,
            );
      await checkpoint();
      return { status: "failed", state, error: failure };
    }
    state.turns += 1;
    hooks.onModelTurn?.(turn);
    const calls = budgetSpent ? [] : turn.toolCalls;
    state.messages.push({
      role: "assistant",
      content: turn.text,
      ...(calls.length
        ? {
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments || "{}" },
            })),
          }
        : {}),
    });
    if (!calls.length) {
      const steers = budgetSpent ? [] : await checkpoint();
      if (steers.length) {
        appendSteers(steers);
        continue;
      }
      if (budgetSpent) await checkpoint();
      return { status: "completed", state };
    }
    const pending = await runCalls(calls);
    if (pending) return pause(pending);
    if (deps.signal.aborted) {
      await checkpoint();
      return { status: "stopped", state };
    }
    appendSteers(await checkpoint());
  }
}
