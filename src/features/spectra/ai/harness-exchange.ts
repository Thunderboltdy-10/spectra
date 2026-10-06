import type { HarnessArtifactTouchView, HarnessInputView, SpectraStreamEvent } from "./stream-events";

/*
 * How the thread shows a harness run while it works: the captions are the
 * trace (one plain sentence per stretch of work, the tool steps behind it as
 * detail), the final caption names what was done, and artifact cards are the
 * work the run created, edited or referenced, each once.
 */

export type LiveStep = {
  id: string;
  title: string;
  summary?: string;
  status: "running" | "done" | "error";
  createdAt: number;
};

export type LiveTool = { id: string; label: string; status: "running" | "done" | "error" };

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
  /** The past-tense caption once the run finished. */
  caption?: string;
  tools?: LiveTool[];
  artifacts?: HarnessArtifactTouchView[];
  widgets?: LiveWidget[];
  todos?: LiveTodo[];
  sources?: LiveSource[];
  compacted?: boolean;
  /** The open question or approval, while the run waits for it. */
  input?: HarnessInputView;
  answers?: AnsweredInput[];
};

const MAX_STEPS = 12;

type HarnessEvent = Extract<
  SpectraStreamEvent,
  {
    type: "step" | "caption" | "artifact_touched" | "widget" | "todos" | "sources" | "compacted" | "input_required" | "input_answered";
  }
>;

export function isHarnessExchangeEvent(event: SpectraStreamEvent): event is HarnessEvent {
  return (
    event.type === "input_required" ||
    event.type === "input_answered" ||
    event.type === "step" ||
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
  };
  return list.map((entry, position) => (position === index ? merged : entry));
}

function toolDetail(tools: readonly LiveTool[] | undefined, stepIds: readonly string[]) {
  const labels = (tools ?? [])
    .filter((tool) => stepIds.includes(tool.id))
    .map((tool) => tool.label.trim())
    .filter(Boolean);
  return [...new Set(labels)].slice(0, 6).join("\n") || undefined;
}

export function applyHarnessEvent<T extends HarnessExchangeFields>(exchange: T, event: HarnessEvent, now = Date.now()): T {
  switch (event.type) {
    case "step": {
      const tools = exchange.tools ?? [];
      const known = tools.some((tool) => tool.id === event.id);
      const next = known
        ? tools.map((tool) => (tool.id === event.id ? { ...tool, label: event.label, status: event.status } : tool))
        : [...tools, { id: event.id, label: event.label, status: event.status }];
      // A step that failed marks the caption describing it.
      const steps =
        event.status === "error"
          ? exchange.steps.map((step) =>
              step.id === `caption:${event.id}` ? { ...step, status: "error" as const } : step,
            )
          : exchange.steps;
      return { ...exchange, tools: next.slice(-40), steps };
    }
    case "caption": {
      const text = event.text.trim();
      if (!text) return exchange;
      if (event.final) {
        return {
          ...exchange,
          caption: text,
          steps: exchange.steps.map((step) => (step.status === "running" ? { ...step, status: "done" as const } : step)),
        };
      }
      const last = exchange.steps.at(-1);
      const detail = event.detail?.trim() || toolDetail(exchange.tools, event.stepIds);
      if (last && last.title === text)
        return {
          ...exchange,
          steps: exchange.steps.map((step, index) =>
            index === exchange.steps.length - 1 ? { ...step, ...(detail ? { summary: detail } : {}) } : step,
          ),
        };
      const id = `caption:${event.stepIds[0] ?? `${now}:${exchange.steps.length}`}`;
      if (exchange.steps.some((step) => step.id === id)) return exchange;
      return {
        ...exchange,
        steps: [
          ...exchange.steps.map((step) => (step.status === "running" ? { ...step, status: "done" as const } : step)),
          { id, title: text, ...(detail ? { summary: detail } : {}), status: "running" as const, createdAt: now },
        ].slice(-MAX_STEPS),
      };
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
