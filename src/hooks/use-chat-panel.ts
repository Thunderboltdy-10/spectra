"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMessageAccumulator, type PanelChatMessage } from "@/lib/chat/message-state";
import { createChatStream, normalizeChatStreamError, type ChatStreamEvent } from "@/lib/chat/streaming";
import { notifyWorkspaceContentMutated } from "@/lib/workspace/events";

type UseChatPanelParams = {
  workstreamId?: string;
  artifactId?: string;
  agentId?: string;
  threadType?: "conversation" | "artifact_edit";
  initialChatId?: string | null;
  mode?: string;
  thinkingLevel?: "low" | "medium" | "high";
  routerMode?: "auto" | "manual" | "openrouter_auto";
  usePersonalResources?: boolean;
  title?: string;
  scopeLevel?: "global" | "workspace" | "artifact";
  manualModel?: string;
  onStreamEvent?: (event: ChatStreamEvent) => void;
};

function createPanelMessageIdFactory() {
  let counter = 0;
  return () => `msg-${++counter}-${Date.now()}`;
}

function phaseFromPhaseUpdate(event: ChatStreamEvent): string | null {
  const status = typeof event.status === "string" ? event.status : "";
  if (status !== "in_progress") return null;
  const raw = event as Record<string, unknown>;
  const phaseId = typeof raw.phaseId === "string" ? raw.phaseId.toLowerCase() : "";
  if (!phaseId) return null;
  if (phaseId.includes("route")) return "routing";
  if (phaseId.includes("search")) return "searching";
  if (phaseId.includes("compact") || phaseId.includes("history")) return "compacting";
  if (phaseId.includes("author") || phaseId.includes("compose") || phaseId.includes("write")) return "generating";
  if (phaseId.includes("synth") || phaseId.includes("verif") || phaseId.includes("repair")) return "synthesizing";
  return "thinking";
}

function phaseFromEvent(event: ChatStreamEvent): string | null {
  if (event.type === "phase" && typeof event.phase === "string") {
    return event.phase;
  }
  if (event.type === "phase_update") {
    return phaseFromPhaseUpdate(event);
  }
  return null;
}

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
      activeModel: typeof (message as { activeModel?: unknown }).activeModel === "string" ? String((message as { activeModel?: unknown }).activeModel) : undefined,
      executionPath: typeof (message as { executionPath?: unknown }).executionPath === "string" ? String((message as { executionPath?: unknown }).executionPath) : undefined,
      citations: Array.isArray(message.citations)
        ? (message.citations as Array<{ url?: string; title?: string }>)
            .map((citation) => ({
              url: String(citation.url ?? ""),
              title: String(citation.title ?? ""),
            }))
            .filter((citation) => citation.url.length > 0)
        : undefined,
      routeTrace: message.routeTrace as PanelChatMessage["routeTrace"],
      createdAt: typeof message.createdAt === "number" ? message.createdAt : Date.now(),
    }));
}

export function useChatPanel(params: UseChatPanelParams = {}) {
  const [chatId, setChatId] = useState<string | null>(params.initialChatId ?? null);
  const [messages, setMessages] = useState<PanelChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<string>("idle");
  const [latestRouteTrace, setLatestRouteTrace] = useState<PanelChatMessage["routeTrace"]>();
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const createChatPromiseRef = useRef<Promise<string> | null>(null);
  const inflightLookupRef = useRef<Promise<string> | null>(null);
  const accumulatorRef = useRef(
    new ChatMessageAccumulator([], createPanelMessageIdFactory()),
  );

  const syncAccumulator = useCallback(() => {
    const nextMessages = [...accumulatorRef.current.messages];
    setMessages(nextMessages);
    const latestTrace = [...nextMessages]
      .reverse()
      .find((message) => message.role === "assistant" && message.routeTrace)?.routeTrace;
    setLatestRouteTrace(latestTrace);
  }, []);

  const hydrateChat = useCallback(async (targetChatId: string) => {
    const response = await fetch(`/api/chats/${encodeURIComponent(targetChatId)}`);
    if (!response.ok) throw new Error("Failed to load thread");
    const data = (await response.json()) as { chat?: { _id?: string }; messages?: Array<Record<string, unknown>> };
    accumulatorRef.current = new ChatMessageAccumulator(
      toPanelMessages(Array.isArray(data.messages) ? data.messages : []),
      createPanelMessageIdFactory(),
    );
    setChatId(data.chat?._id ? String(data.chat._id) : targetChatId);
    syncAccumulator();
    return targetChatId;
  }, [syncAccumulator]);

  const getOrCreateChat = useCallback(async () => {
    if (chatId) return chatId;
    if (createChatPromiseRef.current) return createChatPromiseRef.current;
    if (inflightLookupRef.current) return inflightLookupRef.current;

    const createPromise = (async () => {
      const shouldHydrateExistingArtifactThread =
        params.threadType === "artifact_edit"
        && params.artifactId
        && !params.title
        && !params.initialChatId;

      if (shouldHydrateExistingArtifactThread) {
        const existingResponse = await fetch(`/api/chats?artifactId=${encodeURIComponent(params.artifactId ?? "")}&limit=1`);
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
          agentId: params.agentId,
          threadType: params.threadType,
          mode: params.mode ?? "tutor",
          thinkingLevel: params.thinkingLevel ?? "low",
          routerMode: params.routerMode ?? "auto",
        manualModel: params.manualModel,
          usePersonalResources: params.usePersonalResources ?? true,
          title: params.title,
        }),
      });
      if (!response.ok) throw new Error("Failed to create chat");
      const data = (await response.json()) as { chatId: string };
      setChatId(data.chatId);
      notifyWorkspaceContentMutated({
        workstreamId: params.workstreamId,
        refreshHub: true,
        refreshWorkstreams: true,
      });
      return data.chatId;
    })();

    try {
      inflightLookupRef.current = createPromise;
      createChatPromiseRef.current = createPromise;
      return await createPromise;
    } finally {
      inflightLookupRef.current = null;
      createChatPromiseRef.current = null;
    }
  }, [
    chatId,
    hydrateChat,
    params.artifactId,
    params.agentId,
    params.initialChatId,
    params.mode,
    params.manualModel,
    params.routerMode,
    params.thinkingLevel,
    params.threadType,
    params.title,
    params.usePersonalResources,
    params.workstreamId,
  ]);

  useEffect(() => {
    if (!params.initialChatId || params.initialChatId === "new") return;
    void hydrateChat(params.initialChatId).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load thread");
    });
  }, [hydrateChat, params.initialChatId]);

  useEffect(() => {
    if (!params.artifactId || params.threadType !== "artifact_edit" || params.initialChatId || params.title) return;
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
  }, [hydrateChat, params.artifactId, params.initialChatId, params.threadType, params.title]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    setError(null);
    setLatestRouteTrace(undefined);
    const accumulator = accumulatorRef.current;
    const userMessageId = accumulator.appendUserMessage(text.trim());
    const assistantId = accumulator.beginAssistantMessage();
    syncAccumulator();

    setStreaming(true);
    setStreamPhase("routing");
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    let activeChatId: string | null = null;
    let didComplete = false;

    try {
      activeChatId = await getOrCreateChat();
      const scopeLevel = params.scopeLevel
        ?? (params.artifactId ? "artifact" : params.workstreamId ? "workspace" : undefined);
      for await (const event of createChatStream({
        chatId: activeChatId,
        message: text.trim(),
        mode: params.mode ?? "tutor",
        thinkingLevel: params.thinkingLevel ?? "low",
        routerMode: params.routerMode ?? "auto",
        manualModel: params.manualModel,
        agentId: params.agentId,
        workstreamId: params.workstreamId,
        artifactId: params.artifactId,
        scopeLevel,
        signal: abortRef.current.signal,
      })) {
        const phase = phaseFromEvent(event);
        if (phase) setStreamPhase(phase);
        if ((event.type === "route_model" || event.type === "done") && event.routeTrace) {
          setLatestRouteTrace(event.routeTrace as PanelChatMessage["routeTrace"]);
        }
        params.onStreamEvent?.(event);
        accumulator.consume(event);
        syncAccumulator();
        if (event.type === "error") {
          throw new Error(normalizeChatStreamError(event.error, "Generation failed"));
        }
      }
      didComplete = true;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        accumulator.cancel();
        syncAccumulator();
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
        accumulator.removeMessage(assistantId);
        if (!activeChatId) {
          accumulator.removeMessage(userMessageId);
        }
        syncAccumulator();
      }
    } finally {
      if (didComplete) {
        notifyWorkspaceContentMutated({
          workstreamId: params.workstreamId,
          refreshHub: true,
        });
      }
      setStreaming(false);
      setStreamPhase("idle");
    }
  }, [getOrCreateChat, params, streaming, syncAccumulator]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    createChatPromiseRef.current = null;
    inflightLookupRef.current = null;
    accumulatorRef.current = new ChatMessageAccumulator([], createPanelMessageIdFactory());
    setMessages([]);
    setChatId(null);
    setStreaming(false);
    setStreamPhase("idle");
    setLatestRouteTrace(undefined);
    setError(null);
  }, []);

  return {
    chatId,
    messages,
    streaming,
    streamPhase,
    latestRouteTrace,
    error,
    sendMessage,
    stopGeneration,
    reset,
    hydrateChat,
  };
}
