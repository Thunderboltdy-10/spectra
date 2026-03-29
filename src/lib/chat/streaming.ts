"use client";

export type ChatStreamEvent = {
  type: string;
  content?: string;
  message?: string;
  phase?: string;
  modelUsed?: string;
  error?: string;
  messageId?: string;
  citations?: Array<{ url: string; title: string }>;
  thinkingContent?: string;
  toolName?: string;
  toolCallId?: string;
  summary?: string;
  mode?: string;
  title?: string;
  status?: string;
  reason?: string;
  result?: unknown;
};

export type CreateChatStreamParams = {
  chatId: string;
  message: string;
  mode?: string;
  thinkingLevel?: "low" | "medium" | "high";
  routerMode?: "auto" | "manual" | "openrouter_auto";
  signal?: AbortSignal;
  autoSettings?: {
    enhancePrompt?: boolean;
    autoModel?: boolean;
    autoThinking?: boolean;
    autoSearch?: boolean;
    enhanceMode?: "off" | "auto";
    thinkingMode?: "auto" | "manual";
    searchMode?: "auto" | "manual";
  };
};

export async function* createChatStream(params: CreateChatStreamParams): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: params.chatId,
      message: params.message,
      mode: params.mode ?? "tutor",
      thinkingLevel: params.thinkingLevel ?? "low",
      routerMode: params.routerMode ?? "auto",
      autoSettings: params.autoSettings ?? {
        enhancePrompt: false,
        autoModel: true,
        autoThinking: true,
        autoSearch: true,
        enhanceMode: "off",
        thinkingMode: "auto",
        searchMode: "auto",
      },
    }),
    signal: params.signal,
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text();
    throw new Error(errorText || "Request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as ChatStreamEvent;
      } catch {
        continue;
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer) as ChatStreamEvent;
    } catch {
      // Ignore a trailing partial line.
    }
  }
}
