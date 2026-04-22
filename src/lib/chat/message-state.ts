"use client";

import type { ChatStreamEvent } from "@/lib/chat/streaming";
import type { RouteTrace } from "@/types";

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

function appendThinkingNote(existing: string, next: string) {
  if (!next.trim()) return existing;
  return existing ? `${existing}\n${next}` : next;
}

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

    if (event.type === "delta" && event.content) {
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
      this.thinkingContent = appendThinkingNote(this.thinkingContent, `[Tool] ${event.toolName.replace(/_/g, " ")}...`);
      this.patchAssistant({ thinking: this.thinkingContent });
      return;
    }

    if (event.type === "tool_result" && event.summary) {
      this.thinkingContent = appendThinkingNote(this.thinkingContent, `[Tool] ${event.summary}`);
      this.patchAssistant({ thinking: this.thinkingContent });
      return;
    }

    if ((event.type === "mode_switch" || event.type === "mode_switched") && event.mode) {
      this.thinkingContent = appendThinkingNote(this.thinkingContent, `[Mode] Switched to ${event.mode}.`);
      this.patchAssistant({ thinking: this.thinkingContent });
      return;
    }

    if (event.type === "skill_loaded") {
      this.thinkingContent = appendThinkingNote(this.thinkingContent, "[Skill] Loaded runtime skill.");
      this.patchAssistant({ thinking: this.thinkingContent });
      return;
    }

    if (event.type === "thread_fork" || event.type === "navigation_instruction") {
      this.thinkingContent = appendThinkingNote(
        this.thinkingContent,
        `[Thread] Forked${event.title ? ` ${event.title}` : ""}.`,
      );
      this.patchAssistant({ thinking: this.thinkingContent });
      return;
    }

    if (event.type === "notice" && (event.content || event.message)) {
      this.thinkingContent = appendThinkingNote(this.thinkingContent, event.content ?? event.message ?? "");
      this.patchAssistant({ thinking: this.thinkingContent });
      return;
    }

    if ((event.type === "route_model" || event.type === "model_selected") && event.modelUsed) {
      this.activeModel = event.modelUsed;
      this.executionPath = typeof (event as { executionPath?: unknown }).executionPath === "string"
        ? String((event as { executionPath?: unknown }).executionPath)
        : this.executionPath;
      this.patchAssistant({
        activeModel: this.activeModel,
        modelUsed: event.type === "route_model" ? this.modelUsed : this.modelUsed ?? this.activeModel,
        executionPath: this.executionPath,
        routeTrace: event.routeTrace as RouteTrace | undefined,
      });
      return;
    }

    if (event.type === "done") {
      this.modelUsed = event.modelUsed ?? this.modelUsed ?? this.activeModel;
      this.activeModel = this.modelUsed ?? this.activeModel;
      if (event.citations) {
        this.citations = event.citations;
      }
      this.phaseValue = "idle";
      this.thinkingSegments = this.thinkingSegments.map((segment) => ({
        ...segment,
        status: segment.status === "failed" ? "failed" : "completed",
      }));
      this.patchAssistant({
        content: this.assistantContent,
        thinking: this.thinkingContent || undefined,
        thinkingSegments: this.thinkingSegments.length > 0 ? this.thinkingSegments : undefined,
        streaming: false,
        modelUsed: this.modelUsed,
        activeModel: this.activeModel,
        executionPath: this.executionPath,
        citations: this.citations,
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
}
