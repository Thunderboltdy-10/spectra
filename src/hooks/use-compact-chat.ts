"use client";

import { useCallback, useRef, useState } from "react";

export type CompactMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  streaming?: boolean;
  phase?: string;
  modelUsed?: string;
  citations?: Array<{ url: string; title: string }>;
  createdAt: number;
};

type StreamPayload = {
  type: string;
  content?: string;
  phase?: string;
  modelUsed?: string;
  error?: string;
  messageId?: string;
  citations?: Array<{ url: string; title: string }>;
  thinkingContent?: string;
  toolName?: string;
  summary?: string;
  mode?: string;
  title?: string;
};

export function useCompactChat(workstreamId?: string) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CompactMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const counterRef = useRef(0);

  const nextId = () => `msg-${++counterRef.current}-${Date.now()}`;

  const getOrCreateChat = useCallback(async (): Promise<string> => {
    if (chatId) return chatId;

    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "tutor",
        thinkingLevel: "low",
        routerMode: "auto",
        // Pass workstreamId when API supports it
        ...(workstreamId ? { workstreamId } : {}),
      }),
    });

    if (!res.ok) throw new Error("Failed to create chat");
    const data = (await res.json()) as { chatId: string };
    setChatId(data.chatId);
    return data.chatId;
  }, [chatId, workstreamId]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;
      setError(null);

      const userMsgId = nextId();
      const assistantMsgId = nextId();

      // Add user message immediately
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: text.trim(), createdAt: Date.now() },
      ]);

      // Add streaming placeholder
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgId, role: "assistant", content: "", streaming: true, createdAt: Date.now() },
      ]);

      setStreaming(true);
      setStreamPhase("routing");

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const activeChatId = await getOrCreateChat();

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: activeChatId,
            message: text.trim(),
            mode: "tutor",
            thinkingLevel: "low",
            routerMode: "auto",
            autoSettings: {
              enhancePrompt: false,
              autoModel: true,
              autoThinking: true,
              autoSearch: true,
              enhanceMode: "off",
              thinkingMode: "auto",
              searchMode: "auto",
            },
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok || !response.body) {
          const errText = await response.text();
          throw new Error(errText || "Request failed");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantContent = "";
        let thinkingContent = "";
        let modelUsed: string | undefined;
        let citations: CompactMessage["citations"];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            let payload: StreamPayload;
            try {
              payload = JSON.parse(line) as StreamPayload;
            } catch {
              continue;
            }

            if (payload.type === "phase" && payload.phase) {
              setStreamPhase(payload.phase);
            } else if (payload.type === "delta" && payload.content) {
              assistantContent += payload.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: assistantContent, streaming: true }
                    : m,
                ),
              );
            } else if (payload.type === "thinking" && payload.content) {
              thinkingContent += payload.content;
            } else if (payload.type === "tool_call" && payload.toolName) {
              thinkingContent += `\n[Tool] ${payload.toolName.replace(/_/g, " ")}…`;
            } else if (payload.type === "tool_result" && payload.summary) {
              thinkingContent += `\n[Tool] ${payload.summary}`;
            } else if (payload.type === "mode_switch" && payload.mode) {
              thinkingContent += `\n[Mode] Switched to ${payload.mode}.`;
            } else if (payload.type === "thread_fork") {
              thinkingContent += `\n[Thread] Forked${payload.title ? ` ${payload.title}` : ""}.`;
            } else if (payload.type === "route_model" && payload.modelUsed) {
              modelUsed = payload.modelUsed;
            } else if (payload.type === "done") {
              modelUsed = payload.modelUsed ?? modelUsed;
              if (payload.citations) citations = payload.citations as CompactMessage["citations"];
            } else if (payload.type === "error") {
              const msg = typeof payload.error === "string" ? payload.error : "Generation failed";
              throw new Error(msg);
            }
          }
        }

        // Finalize the assistant message
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: assistantContent,
                  thinking: thinkingContent || undefined,
                  streaming: false,
                  modelUsed,
                  citations,
                }
              : m,
          ),
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // Cancelled — mark assistant message as done with what we have
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, streaming: false } : m,
            ),
          );
        } else {
          const msg = (err as Error).message || "Something went wrong";
          setError(msg);
          // Remove the empty assistant message on error
          setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
        }
      } finally {
        setStreaming(false);
        setStreamPhase("idle");
      }
    },
    [streaming, getOrCreateChat],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
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
  };
}
