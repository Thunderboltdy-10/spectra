"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMessageAccumulator, type PanelChatMessage } from "@/lib/chat/message-state";
import { createChatStream } from "@/lib/chat/streaming";

type UseChatPanelParams = {
  workstreamId?: string;
  artifactId?: string;
  threadType?: "conversation" | "artifact_edit";
  initialChatId?: string | null;
  mode?: string;
  thinkingLevel?: "low" | "medium" | "high";
  routerMode?: "auto" | "manual" | "openrouter_auto";
  usePersonalResources?: boolean;
  title?: string;
};

function toPanelMessages(messages: Array<Record<string, unknown>>): PanelChatMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      id: String(message._id),
      role: message.role as "user" | "assistant",
      content: String(message.content ?? ""),
      thinking: typeof message.thinkingContent === "string" ? message.thinkingContent : undefined,
      phase: undefined,
      streaming: false,
      modelUsed: typeof message.modelUsed === "string" ? message.modelUsed : undefined,
      citations: Array.isArray(message.citations)
        ? (message.citations as Array<{ url?: string; title?: string }>)
            .map((citation) => ({
              url: String(citation.url ?? ""),
              title: String(citation.title ?? ""),
            }))
            .filter((citation) => citation.url.length > 0)
        : undefined,
      createdAt: typeof message.createdAt === "number" ? message.createdAt : Date.now(),
    }));
}

export function useChatPanel(params: UseChatPanelParams = {}) {
  const [chatId, setChatId] = useState<string | null>(params.initialChatId ?? null);
  const [messages, setMessages] = useState<PanelChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const counterRef = useRef(0);
  const accumulatorRef = useRef(
    new ChatMessageAccumulator([], () => `msg-${++counterRef.current}-${Date.now()}`),
  );

  const syncAccumulator = useCallback(() => {
    setMessages([...accumulatorRef.current.messages]);
    setStreamPhase(accumulatorRef.current.phase);
  }, []);

  const hydrateChat = useCallback(async (targetChatId: string) => {
    const response = await fetch(`/api/chats/${encodeURIComponent(targetChatId)}`);
    if (!response.ok) throw new Error("Failed to load thread");
    const data = (await response.json()) as { chat?: { _id?: string }; messages?: Array<Record<string, unknown>> };
    accumulatorRef.current = new ChatMessageAccumulator(
      toPanelMessages(Array.isArray(data.messages) ? data.messages : []),
      () => `msg-${++counterRef.current}-${Date.now()}`,
    );
    setChatId(data.chat?._id ? String(data.chat._id) : targetChatId);
    syncAccumulator();
    return targetChatId;
  }, [syncAccumulator]);

  const getOrCreateChat = useCallback(async () => {
    if (chatId) return chatId;

    if (params.threadType === "artifact_edit" && params.artifactId) {
      const existingResponse = await fetch(`/api/chats?artifactId=${encodeURIComponent(params.artifactId)}&limit=1`);
      if (existingResponse.ok) {
        const existingData = (await existingResponse.json()) as { chats?: Array<{ _id: string }> };
        const existingChatId = existingData.chats?.[0]?._id;
        if (existingChatId) {
          await hydrateChat(existingChatId);
          return existingChatId;
        }
      }
    }

    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workstreamId: params.workstreamId,
        artifactId: params.artifactId,
        threadType: params.threadType,
        mode: params.mode ?? "tutor",
        thinkingLevel: params.thinkingLevel ?? "low",
        routerMode: params.routerMode ?? "auto",
        usePersonalResources: params.usePersonalResources ?? true,
        title: params.title,
      }),
    });
    if (!response.ok) throw new Error("Failed to create chat");
    const data = (await response.json()) as { chatId: string };
    setChatId(data.chatId);
    return data.chatId;
  }, [
    chatId,
    hydrateChat,
    params.artifactId,
    params.mode,
    params.routerMode,
    params.thinkingLevel,
    params.threadType,
    params.title,
    params.usePersonalResources,
    params.workstreamId,
  ]);

  useEffect(() => {
    if (!params.initialChatId) return;
    void hydrateChat(params.initialChatId).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load thread");
    });
  }, [hydrateChat, params.initialChatId]);

  useEffect(() => {
    if (!params.artifactId || params.threadType !== "artifact_edit" || params.initialChatId) return;
    const artifactId = params.artifactId;
    void (async () => {
      try {
        const response = await fetch(`/api/chats?artifactId=${encodeURIComponent(artifactId)}&limit=1`);
        if (!response.ok) return;
        const data = (await response.json()) as { chats?: Array<{ _id: string }> };
        const existingChatId = data.chats?.[0]?._id;
        if (existingChatId) {
          await hydrateChat(existingChatId);
        }
      } catch {
        // Best-effort hydration.
      }
    })();
  }, [hydrateChat, params.artifactId, params.initialChatId, params.threadType]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    setError(null);
    const accumulator = accumulatorRef.current;
    accumulator.appendUserMessage(text.trim());
    const assistantId = accumulator.beginAssistantMessage();
    syncAccumulator();

    setStreaming(true);
    setStreamPhase("routing");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const activeChatId = await getOrCreateChat();
      for await (const event of createChatStream({
        chatId: activeChatId,
        message: text.trim(),
        mode: params.mode ?? "tutor",
        thinkingLevel: params.thinkingLevel ?? "low",
        routerMode: params.routerMode ?? "auto",
        signal: abortRef.current.signal,
      })) {
        accumulator.consume(event);
        syncAccumulator();
        if (event.type === "error") {
          throw new Error(typeof event.error === "string" ? event.error : "Generation failed");
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        accumulator.cancel();
        syncAccumulator();
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
        accumulator.removeMessage(assistantId);
        syncAccumulator();
      }
    } finally {
      setStreaming(false);
      setStreamPhase("idle");
    }
  }, [
    getOrCreateChat,
    params.mode,
    params.routerMode,
    params.thinkingLevel,
    streaming,
    syncAccumulator,
  ]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    accumulatorRef.current = new ChatMessageAccumulator([], () => `msg-${++counterRef.current}-${Date.now()}`);
    setMessages([]);
    setChatId(null);
    setStreaming(false);
    setStreamPhase("idle");
    setError(null);
  }, []);

  return {
    chatId,
    messages,
    streaming,
    streamPhase,
    error,
    sendMessage,
    stopGeneration,
    reset,
    hydrateChat,
  };
}
