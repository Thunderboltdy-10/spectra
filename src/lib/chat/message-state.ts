"use client";

import type { ChatStreamEvent } from "@/lib/chat/streaming";
import type { RouteTrace } from "@/types";

export type PanelChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  streaming?: boolean;
  phase?: string;
  modelUsed?: string;
  citations?: Array<{ url: string; title: string }>;
  routeTrace?: RouteTrace;
  createdAt: number;
};

function appendThinkingNote(existing: string, next: string) {
  if (!next.trim()) return existing;
  return existing ? `${existing}\n${next}` : next;
}

export class ChatMessageAccumulator {
  private messagesValue: PanelChatMessage[];
  private assistantMessageId: string | null = null;
  private assistantContent = "";
  private thinkingContent = "";
  private modelUsed: string | undefined;
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
    this.modelUsed = undefined;
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
      this.patchAssistant({ thinking: this.thinkingContent });
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

    if (event.type === "route_model" && event.modelUsed) {
      this.modelUsed = event.modelUsed;
      this.patchAssistant({
        modelUsed: this.modelUsed,
        routeTrace: event.routeTrace as RouteTrace | undefined,
      });
      return;
    }

    if (event.type === "done") {
      this.modelUsed = event.modelUsed ?? this.modelUsed;
      if (event.citations) {
        this.citations = event.citations;
      }
      this.phaseValue = "idle";
      this.patchAssistant({
        content: this.assistantContent,
        thinking: this.thinkingContent || undefined,
        streaming: false,
        modelUsed: this.modelUsed,
        citations: this.citations,
      });
      return;
    }

    if (event.type === "error") {
      this.phaseValue = "idle";
      this.patchAssistant({ streaming: false });
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
