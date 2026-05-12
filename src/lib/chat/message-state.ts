"use client";

import type { ChatStreamEvent } from "@/lib/chat/streaming";
import type { RouteTrace, RouteTraceExecutionEvent } from "@/types";

export type PanelChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  thinkingSegments?: Array<{ id: string; label: string; content: string; status: string }>;
  streaming?: boolean;
  phase?: string;
  modelUsed?: string;
  activeModel?: string;
  executionPath?: string;
  citations?: Array<{ url: string; title: string }>;
  routeTrace?: RouteTrace;
  createdAt: number;
};

function collapseSegments(segments: Array<{ id: string; label: string; content: string; status: string }>, activeId: string) {
  return segments.map((segment) =>
    segment.id === activeId
      ? { ...segment, status: segment.status === "completed" ? "completed" : "running" }
      : { ...segment, status: segment.status === "failed" ? "failed" : "completed" },
  );
}

export class ChatMessageAccumulator {
  private messagesValue: PanelChatMessage[];
  private assistantMessageId: string | null = null;
  private assistantContent = "";
  private thinkingContent = "";
  private thinkingSegments: Array<{ id: string; label: string; content: string; status: string }> = [];
  private modelUsed: string | undefined;
  private activeModel: string | undefined;
  private executionPath: string | undefined;
  private citations: PanelChatMessage["citations"];
  private phaseValue = "idle";
  private runtimeEvents: RouteTraceExecutionEvent[] = [];

  constructor(
    initialMessages: PanelChatMessage[] = [],
    private readonly nextId: () => string,
  ) {
    this.messagesValue = [...initialMessages];
  }

  get messages() {
    return this.messagesValue;
  }

  get phase() {
    return this.phaseValue;
  }

  appendUserMessage(content: string) {
    const id = this.nextId();
    this.messagesValue = [
      ...this.messagesValue,
      {
        id,
        role: "user",
        content,
        createdAt: Date.now(),
      },
    ];
    return id;
  }

  beginAssistantMessage() {
    const id = this.nextId();
    this.assistantMessageId = id;
    this.assistantContent = "";
    this.thinkingContent = "";
    this.thinkingSegments = [];
    this.modelUsed = undefined;
    this.activeModel = undefined;
    this.executionPath = undefined;
    this.citations = undefined;
    this.runtimeEvents = [];
    this.messagesValue = [
      ...this.messagesValue,
      {
        id,
        role: "assistant",
        content: "",
        streaming: true,
        createdAt: Date.now(),
      },
    ];
    return id;
  }

  consume(event: ChatStreamEvent) {
    if (event.type === "phase" && event.phase) {
      this.phaseValue = event.phase;
      this.patchAssistant({ phase: event.phase });
      return;
    }

    if ((event.type === "delta" || event.type === "text_delta") && event.content) {
      this.assistantContent += event.content;
      this.patchAssistant({
        content: this.assistantContent,
        streaming: true,
      });
      return;
    }

    if (event.type === "thinking" && event.content) {
      this.thinkingContent += event.content;
      this.patchAssistant({ thinking: this.thinkingContent, thinkingSegments: this.thinkingSegments });
      return;
    }

    if (event.type === "thinking_segment" && event.segment) {
      const nextSegment = {
        id: String(event.segment.id ?? `segment-${this.thinkingSegments.length + 1}`),
        label: String(event.segment.label ?? "Thinking"),
        content: String(event.segment.content ?? ""),
        status: String(event.segment.status ?? "running"),
      };
      const existingIndex = this.thinkingSegments.findIndex((segment) => segment.id === nextSegment.id);
      if (existingIndex >= 0) {
        this.thinkingSegments[existingIndex] = nextSegment;
      } else {
        this.thinkingSegments = [...this.thinkingSegments, nextSegment];
      }
      this.thinkingSegments = collapseSegments(this.thinkingSegments, nextSegment.id);
      this.thinkingContent = this.thinkingSegments.map((segment) => segment.content).filter(Boolean).join("\n\n");
      this.patchAssistant({ thinking: this.thinkingContent, thinkingSegments: this.thinkingSegments });
      return;
    }

    if (event.type === "tool_call" && event.toolName) {
      this.upsertRuntimeEvent({
        id: `tool:${event.toolCallId ?? event.toolName}`,
        kind: "tool",
        label: formatRuntimeLabel(event.toolName, "Tool"),
        status: "running",
        detail: typeof event.summary === "string" ? event.summary : undefined,
        inputPreview: typeof event.arguments === "string" ? event.arguments : undefined,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        startedAt: Date.now(),
      });
      return;
    }

    if (event.type === "tool_result" && event.toolName) {
      const eventError = typeof event.error === "string"
        ? event.error
        : event.error && typeof event.error === "object" && "message" in event.error
          ? String((event.error as { message?: unknown }).message ?? "")
          : undefined;
      this.upsertRuntimeEvent({
        id: `tool:${event.toolCallId ?? event.toolName ?? "unknown"}`,
        kind: "tool",
        label: formatRuntimeLabel(event.toolName, "Tool"),
        status: event.status === "failed" ? "failed" : "completed",
        detail: event.summary,
        resultPreview: event.result,
        error: eventError,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        finishedAt: Date.now(),
      });
      return;
    }

    if ((event.type === "mode_switch" || event.type === "mode_switched") && event.mode) {
      this.upsertRuntimeEvent({
        id: `mode:${event.mode}`,
        kind: "action",
        label: `Switched to ${formatRuntimeLabel(event.mode, "mode")}`,
        status: "completed",
        detail: event.reason,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
      return;
    }

    if (event.type === "skill_loaded") {
      this.upsertRuntimeEvent({
        id: `skill:${Date.now()}`,
        kind: "skill",
        label: "Loaded runtime skill",
        status: "completed",
        finishedAt: Date.now(),
      });
      return;
    }

    if (event.type === "thread_fork" || event.type === "navigation_instruction") {
      this.upsertRuntimeEvent({
        id: `thread:${event.chatId ?? event.title ?? Date.now()}`,
        kind: "action",
        label: `Opened ${formatRuntimeLabel(event.title, "thread")}`,
        status: "completed",
        detail: event.reason,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
      return;
    }

    if (event.type === "notice" && (event.content || event.message)) {
      this.upsertRuntimeEvent({
        id: `notice:${Date.now()}`,
        kind: "notice",
        label: "Runtime notice",
        status: "completed",
        detail: event.content ?? event.message,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
      return;
    }

    if (event.type === "memory_read" || event.type === "memory_write") {
      this.upsertRuntimeEvent({
        id: `${event.type}:${Date.now()}`,
        kind: "memory",
        label: event.type === "memory_read" ? "Read memory" : "Saved memory",
        status: event.status === "failed" ? "failed" : "completed",
        detail: event.summary ?? event.message ?? event.content,
        resultPreview: event.result,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
      return;
    }

    if (event.type === "search_status" || event.type === "rag_used") {
      this.upsertRuntimeEvent({
        id: event.type === "search_status" ? "search:status" : `resource:rag:${Date.now()}`,
        kind: event.type === "search_status" ? "search" : "resource",
        label: event.type === "search_status" ? "Search activity" : "Referenced resources",
        status: event.status === "failed" ? "failed" : "completed",
        detail: event.summary ?? event.message ?? event.reason,
        resultPreview: event.result,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
      return;
    }

    if (event.type === "helper_worker_started" || event.type === "agent_summoned" || event.type === "collab_progress" || event.type === "collab_done" || event.type === "helper_worker_finished") {
      const workerId = typeof event.agent === "string"
        ? event.agent
        : event.agent && typeof event.agent === "object" && "id" in event.agent
          ? String((event.agent as { id?: unknown }).id ?? "worker")
          : String(event.toolCallId ?? event.title ?? "worker");
      const finished = event.type === "collab_done" || event.type === "helper_worker_finished";
      this.upsertRuntimeEvent({
        id: `worker:${workerId}`,
        kind: "worker",
        label: formatRuntimeLabel(workerId, "Worker"),
        status: event.status === "failed" ? "failed" : finished ? "completed" : "running",
        detail: event.preview ?? event.summary ?? event.message,
        startedAt: Date.now(),
        finishedAt: finished ? Date.now() : undefined,
      });
      return;
    }

    if ((event.type === "route_model" || event.type === "model_selected") && event.modelUsed) {
      this.activeModel = event.modelUsed;
      this.executionPath = typeof (event as { executionPath?: unknown }).executionPath === "string"
        ? String((event as { executionPath?: unknown }).executionPath)
        : this.executionPath;
      const routeTrace = event.routeTrace as RouteTrace | undefined;
      this.patchAssistant({
        activeModel: this.activeModel,
        modelUsed: event.type === "route_model" ? this.modelUsed : this.modelUsed ?? this.activeModel,
        executionPath: this.executionPath,
        routeTrace: routeTrace ? { ...routeTrace, executionEvents: mergeRuntimeEvents(routeTrace.executionEvents, this.runtimeEvents) } : undefined,
      });
      this.upsertRuntimeEvent({
        id: "runtime-routing",
        kind: "routing",
        label: `Selected ${formatRuntimeLabel(event.modelUsed, "model")}`,
        status: "completed",
        detail: this.executionPath ? `Execution path: ${this.executionPath}` : undefined,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
      return;
    }

    if (event.type === "model_fallback" && event.toModel) {
      this.activeModel = event.toModel;
      this.modelUsed = event.toModel;
      this.upsertRuntimeEvent({
        id: `model-fallback:${event.fromModel ?? "model"}:${event.toModel}`,
        kind: "routing",
        label: `Switched to ${formatRuntimeLabel(event.toModel, "fallback model")}`,
        status: "completed",
        detail: event.reason ?? (event.fromModel ? `Fallback from ${event.fromModel}` : undefined),
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
      this.patchAssistant({
        activeModel: this.activeModel,
        modelUsed: this.modelUsed,
      });
      return;
    }

    if (event.type === "done") {
      this.modelUsed = event.modelUsed ?? this.modelUsed ?? this.activeModel;
      this.activeModel = this.modelUsed ?? this.activeModel;
      const routeTrace = event.routeTrace as RouteTrace | undefined;
      if (event.citations) {
        this.citations = event.citations;
      }
      this.phaseValue = "idle";
      this.thinkingSegments = this.thinkingSegments.map((segment) => ({
        ...segment,
        status: segment.status === "failed" ? "failed" : "completed",
      }));
      const existingRouteTrace = this.messagesValue.find((row) => row.id === this.assistantMessageId)?.routeTrace;
      this.patchAssistant({
        content: this.assistantContent,
        thinking: this.thinkingContent || undefined,
        thinkingSegments: this.thinkingSegments.length > 0 ? this.thinkingSegments : undefined,
        streaming: false,
        modelUsed: this.modelUsed,
        activeModel: this.activeModel,
        executionPath: this.executionPath,
        citations: this.citations,
        routeTrace: routeTrace
          ? { ...routeTrace, executionEvents: mergeRuntimeEvents(routeTrace.executionEvents, this.runtimeEvents) }
          : existingRouteTrace
            ? { ...existingRouteTrace, executionEvents: mergeRuntimeEvents(existingRouteTrace.executionEvents, this.runtimeEvents) }
            : undefined,
      });
      return;
    }

    if (event.type === "error") {
      this.phaseValue = "idle";
      this.thinkingSegments = this.thinkingSegments.map((segment) => ({
        ...segment,
        status: segment.status === "completed" ? "completed" : "failed",
      }));
      this.patchAssistant({ streaming: false, thinkingSegments: this.thinkingSegments });
    }
  }

  cancel() {
    this.phaseValue = "idle";
    this.patchAssistant({ streaming: false });
  }

  removeMessage(id: string) {
    this.messagesValue = this.messagesValue.filter((message) => message.id !== id);
    if (this.assistantMessageId === id) {
      this.assistantMessageId = null;
      this.assistantContent = "";
      this.thinkingContent = "";
      this.thinkingSegments = [];
      this.modelUsed = undefined;
      this.citations = undefined;
      this.runtimeEvents = [];
    }
  }

  private patchAssistant(patch: Partial<PanelChatMessage>) {
    if (!this.assistantMessageId) return;
    this.messagesValue = this.messagesValue.map((message) =>
      message.id === this.assistantMessageId
        ? {
            ...message,
            ...patch,
          }
        : message,
    );
  }

  private upsertRuntimeEvent(next: RouteTraceExecutionEvent) {
    if (!this.assistantMessageId) return;
    const now = Date.now();
    const message = this.messagesValue.find((row) => row.id === this.assistantMessageId);
    const events = [...this.runtimeEvents];
    const index = events.findIndex((event) => event.id === next.id);
    const normalized = {
      ...next,
      startedAt: next.startedAt ?? (next.status === "running" ? now : undefined),
      finishedAt: next.finishedAt ?? (next.status === "completed" || next.status === "failed" ? now : undefined),
    };
    if (index >= 0) {
      events[index] = {
        ...events[index],
        ...normalized,
        startedAt: events[index]?.startedAt ?? normalized.startedAt,
      };
    } else {
      events.push(normalized);
    }
    this.runtimeEvents = events;
    if (message?.routeTrace) {
      this.patchAssistant({
        routeTrace: {
          ...message.routeTrace,
          executionEvents: mergeRuntimeEvents(message.routeTrace.executionEvents, events),
        },
      });
    }
  }
}

function formatRuntimeLabel(value: string | undefined, fallback: string) {
  const normalized = (value ?? "").trim();
  if (!normalized) return fallback;
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function mergeRuntimeEvents(existing: RouteTraceExecutionEvent[] | undefined, incoming: RouteTraceExecutionEvent[]) {
  const merged = [...(existing ?? [])];
  for (const event of incoming) {
    const index = merged.findIndex((candidate) => candidate.id === event.id);
    if (index >= 0) {
      merged[index] = {
        ...merged[index],
        ...event,
        startedAt: merged[index]?.startedAt ?? event.startedAt,
      };
    } else {
      merged.push(event);
    }
  }
  return merged;
}
