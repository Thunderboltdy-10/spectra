import type { HarnessArtifactTouchView, HarnessInputView, SpectraStreamEvent } from "./stream-events";

/*
 * How the thread shows a harness run while it works: the trace is what it
 * thought and did in the order it happened, and artifact cards are the work the
 * run created, edited or referenced, each once.
 */

export type LiveStep = {
  id: string;
  title: string;
  /** A stretch of reasoning: `summary` holds its words; on a plain step, why it happened. */
  kind?: "thinking";
  summary?: string;
  status: "running" | "done" | "error";
  createdAt: number;
  /** How much of the reply was written when this began: where it sits among the words. */
  textAt?: number;
};

export type LiveWidget = { id: string; title: string; html: string };

export type LiveTodo = { content: string; status: "pending" | "in_progress" | "completed" };

/** Something the run read, which a citation in the reply can open. */
export type LiveSource = { id: string; title: string } & ({ workId: string } | { url: string });

export type HarnessAnswerValue =
  | { kind: "approval"; allowed: boolean; alwaysAllow?: boolean }
  | { kind: "question"; choiceKey?: string; text?: string };

/** An answered question or approval, kept as one line. */
export type AnsweredInput = { toolCallId: string; kind: HarnessInputView["kind"]; question: string; label: string };

export type HarnessExchangeFields = {
  steps: LiveStep[];
  artifacts?: HarnessArtifactTouchView[];
  widgets?: LiveWidget[];
  todos?: LiveTodo[];
  sources?: LiveSource[];
  compacted?: boolean;
  /** The open question or approval, while the run waits for it. */
  input?: HarnessInputView;
  answers?: AnsweredInput[];
  /** Characters of the reply so far, for a trace rebuilt from saved events. */
  written?: number;
};

const writtenSoFar = (exchange: HarnessExchangeFields & { content?: unknown }) =>
  typeof exchange.content === "string" ? exchange.content.length : (exchange.written ?? 0);

export type ReplyBlock<T> = { kind: "work"; steps: T[] } | { kind: "text"; text: string };

/**
 * A reply in the order it happened: the work before the first words, then words,
 * then whatever was done after them, and so on. Always starts with a work block,
 * which is where the run's time is shown, even when nothing was done before writing.
 */
export function replyBlocks<T extends { textAt?: number }>(content: string, steps: readonly T[]): ReplyBlock<T>[] {
  const positionOf = (step: T) => {
    const at = Math.min(step.textAt ?? 0, content.length);
    // A turn's words end where the next turn's blank line starts. Anything else
    // (a saved reply that was tidied up) moves to the paragraph's end, never mid-sentence.
    if (at === 0 || at === content.length || /^\s/.test(content.slice(at, at + 1))) return at;
    const next = content.indexOf("\n\n", at);
    return next < 0 ? content.length : next;
  };
  const stops = [...new Set(steps.map(positionOf))].sort((a, b) => a - b);
  const blocks: ReplyBlock<T>[] = [{ kind: "work", steps: steps.filter((step) => positionOf(step) === 0) }];
  let from = 0;
  for (const stop of stops) {
    if (stop === 0) continue;
    const text = content.slice(from, stop).trim();
    if (text) blocks.push({ kind: "text", text });
    from = stop;
    const work = steps.filter((step) => positionOf(step) === stop);
    const last = blocks[blocks.length - 1]!;
    if (last.kind === "work") last.steps.push(...work);
    else blocks.push({ kind: "work", steps: work });
  }
  const rest = content.slice(from).trim();
  if (rest) blocks.push({ kind: "text", text: rest });
  return blocks;
}

const MAX_STEPS = 120;
const MAX_THINKING = 12_000;

type HarnessEvent = Extract<
  SpectraStreamEvent,
  {
    type: "step" | "reasoning_delta" | "caption" | "artifact_touched" | "widget" | "todos" | "sources" | "compacted" | "input_required" | "input_answered";
  }
>;

export function isHarnessExchangeEvent(event: SpectraStreamEvent): event is HarnessEvent {
  return (
    event.type === "input_required" ||
    event.type === "input_answered" ||
    event.type === "step" ||
    event.type === "reasoning_delta" ||
    event.type === "caption" ||
    event.type === "artifact_touched" ||
    event.type === "widget" ||
    event.type === "todos" ||
    event.type === "sources" ||
    event.type === "compacted"
  );
}

/** One card per piece of work; a creation stays a creation when it is edited after. */
export function mergeTouch(list: readonly HarnessArtifactTouchView[], touch: HarnessArtifactTouchView) {
  const index = list.findIndex((entry) => entry.id === touch.id);
  if (index < 0) return [...list, touch];
  const previous = list[index]!;
  const rank = { referenced: 0, edited: 1, created: 2 } as const;
  const merged: HarnessArtifactTouchView = {
    ...previous,
    title: touch.title || previous.title,
    action: rank[touch.action] > rank[previous.action] ? touch.action : previous.action,
    ...(touch.change ?? previous.change ? { change: touch.change ?? previous.change } : {}),
    ...(previous.region ?? touch.region ? { region: previous.region ?? touch.region } : {}),
  };
  return list.map((entry, position) => (position === index ? merged : entry));
}

/** Whatever was thinking stops when something else starts. */
function settleThinking(steps: readonly LiveStep[]) {
  return steps.map((step) => (step.kind === "thinking" && step.status === "running" ? { ...step, status: "done" as const } : step));
}

export function applyHarnessEvent<T extends HarnessExchangeFields>(exchange: T, event: HarnessEvent, now = Date.now()): T {
  switch (event.type) {
    case "step": {
      const known = exchange.steps.some((step) => step.id === event.id);
      const steps = known
        ? exchange.steps.map((step) => (step.id === event.id ? { ...step, title: event.label, status: event.status, ...(event.detail ? { summary: event.detail } : {}) } : step))
        : [...settleThinking(exchange.steps), { id: event.id, title: event.label, status: event.status, createdAt: now, textAt: writtenSoFar(exchange), ...(event.detail ? { summary: event.detail } : {}) }];
      return { ...exchange, steps: steps.slice(-MAX_STEPS) };
    }
    case "reasoning_delta": {
      const part = exchange.steps.find((step) => step.id === event.id);
      if (part) {
        const summary = `${part.summary ?? ""}${event.content}`.slice(-MAX_THINKING);
        return {
          ...exchange,
          steps: exchange.steps.map((step) =>
            step.id === event.id ? { ...step, summary, status: event.done ? ("done" as const) : step.status } : step,
          ),
        };
      }
      if (!event.content) return exchange;
      return {
        ...exchange,
        steps: [
          ...settleThinking(exchange.steps),
          { id: event.id, kind: "thinking" as const, title: "Thinking", summary: event.content, status: event.done ? ("done" as const) : ("running" as const), createdAt: now, textAt: writtenSoFar(exchange) },
        ].slice(-MAX_STEPS),
      };
    }
    case "caption": {
      // A run from before reasoning was shown: its captions are its trace.
      const text = event.text.trim();
      if (!text || event.final) return exchange;
      const id = `caption:${event.stepIds[0] ?? `${now}:${exchange.steps.length}`}`;
      if (exchange.steps.some((step) => step.id === id || step.title === text)) return exchange;
      return { ...exchange, steps: [...exchange.steps, { id, title: text, status: "done" as const, createdAt: now, textAt: writtenSoFar(exchange) }].slice(-MAX_STEPS) };
    }
    case "artifact_touched":
      return { ...exchange, artifacts: mergeTouch(exchange.artifacts ?? [], event.artifact) };
    case "widget": {
      const widgets = (exchange.widgets ?? []).filter((widget) => widget.id !== event.id);
      return { ...exchange, widgets: [...widgets, { id: event.id, title: event.title, html: event.html }].slice(-4) };
    }
    case "todos":
      return { ...exchange, todos: event.todos };
    case "sources":
      return { ...exchange, sources: event.sources };
    case "compacted":
      return { ...exchange, compacted: true };
    case "input_required":
      return { ...exchange, input: event.input };
    case "input_answered": {
      if ((exchange.answers ?? []).some((entry) => entry.toolCallId === event.toolCallId))
        return exchange.input?.toolCallId === event.toolCallId ? { ...exchange, input: undefined } : exchange;
      const open = exchange.input?.toolCallId === event.toolCallId ? exchange.input : undefined;
      return {
        ...exchange,
        input: open ? undefined : exchange.input,
        answers: [
          ...(exchange.answers ?? []),
          { toolCallId: event.toolCallId, kind: open?.kind ?? "question", question: open?.question ?? "", label: event.label },
        ],
      };
    }
    default:
      return exchange;
  }
}
