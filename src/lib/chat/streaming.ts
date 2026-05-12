"use client";

export type ChatStreamEvent = {
  type: string;
  content?: string;
  message?: string;
  phase?: string;
  phaseId?: string;
  detail?: string;
  phasePlan?: unknown;
  modelUsed?: string;
  model?: string;
  fromModel?: string;
  toModel?: string;
  error?: string;
  messageId?: string;
  chatId?: string;
  citations?: Array<{ url: string; title: string }>;
  thinkingContent?: string;
  toolName?: string;
  toolCallId?: string;
  arguments?: string;
  summary?: string;
  mode?: string;
  title?: string;
  status?: string;
  reason?: string;
  result?: unknown;
  agent?: string | { id?: string; name?: string };
  preview?: string;
  routeTrace?: unknown;
  skill?: unknown;
  executionPath?: string;
  segment?: {
    id?: string;
    label?: string;
    content?: string;
    status?: string;
  };
};

export type CreateChatStreamParams = {
  chatId: string;
  message: string;
  mode?: string;
  thinkingLevel?: "low" | "medium" | "high";
  routerMode?: "auto" | "manual" | "openrouter_auto";
  agentId?: string;
  workstreamId?: string;
  artifactId?: string;
  scopeLevel?: "global" | "workspace" | "artifact";
  manualModel?: string;
  confirmExpensiveModel?: boolean;
  attachmentTypes?: string[];
  attachmentResourceIds?: string[];
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

export function normalizeChatStreamError(error: unknown, fallback = "Generation failed") {
  const raw = typeof error === "string"
    ? error
    : error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string }; message?: string };
    return parsed.error?.message ?? parsed.message ?? fallback;
  } catch {
    return trimmed;
  }
}

export async function* createChatStream(params: CreateChatStreamParams): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: params.chatId,
      message: params.message,
      mode: params.mode ?? "tutor",
      agentId: params.agentId,
      workstreamId: params.workstreamId,
      artifactId: params.artifactId,
      scopeLevel: params.scopeLevel,
      manualModel: params.manualModel,
      confirmExpensiveModel: params.confirmExpensiveModel,
      attachmentTypes: params.attachmentTypes,
      attachmentResourceIds: params.attachmentResourceIds,
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
    throw new Error(normalizeChatStreamError(errorText, "Request failed"));
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
