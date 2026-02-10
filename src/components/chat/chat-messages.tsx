"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Brain, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/chat/chat-message";
import { QuizView, isQuizContent } from "@/components/chat/quiz-view";
import { FlashcardView, isFlashcardContent } from "@/components/chat/flashcard-view";
import { ThinkingMessages } from "@/components/loading-states";
import type { Message } from "@/hooks/use-chat-state";
import type { StudyMode } from "@/types";

type ChatMessagesProps = {
  messages: Message[];
  draftResponse: string;
  sending: boolean;
  streamError: string | null;
  onRetry: () => void;
  onRegenerate?: () => void;
  emptyState?: React.ReactNode;
  mode: StudyMode;
  lastModelUsed?: string;
  lastAutoResult?: {
    modelUsed?: string;
    searchEnabled: boolean;
    thinkingLevel: "low" | "medium" | "high";
    promptEnhanced: boolean;
  } | null;
};

export function ChatMessages({
  messages,
  draftResponse,
  sending,
  streamError,
  onRetry,
  onRegenerate,
  emptyState,
  mode,
  lastModelUsed,
  lastAutoResult,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const shouldAutoScrollRef = useRef(true);

  const hasContent = messages.length > 0 || Boolean(draftResponse);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, draftResponse]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const onScroll = () => {
      const delta = element.scrollHeight - element.scrollTop - element.clientHeight;
      setShowJumpButton(delta > 260);
      shouldAutoScrollRef.current = delta < 180;
    };

    element.addEventListener("scroll", onScroll);
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  function modelLabel(modelId?: string) {
    if (!modelId) return "AI";
    return modelId.split("/").pop() ?? "AI";
  }

  function renderErrorText(error: string) {
    const lower = error.toLowerCase();

    if (lower.includes("monthly limit") || lower.includes("no_free_model_available")) {
      return "You've reached your monthly usage tier. Budget-safe models are still available.";
    }
    if (lower.includes("429") || lower.includes("rate")) {
      return "The model is busy. Trying a backup...";
    }
    if (lower.includes("network") || lower.includes("fetch") || lower.includes("connection")) {
      return "Connection lost. Retrying...";
    }
    if (lower.includes("auth") || lower.includes("401") || lower.includes("unauthorized")) {
      return "Session expired. Redirecting to sign-in...";
    }

    return error;
  }

  function renderDraft(text: string) {
    const lines = text.split("\n");
    return (
      <div className="space-y-1.5">
        {lines.map((line, idx) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return <div key={`sp-${idx}`} className="h-2" />;
          }
          if (/^#{1,3}\s/.test(trimmed)) {
            return (
              <p key={idx} className="font-semibold text-[var(--text-primary)]">
                {trimmed.replace(/^#{1,3}\s/, "")}
              </p>
            );
          }
          if (/^[-*]\s/.test(trimmed)) {
            return (
              <p key={idx} className="pl-4 text-[15px] leading-7 text-[var(--text-primary)]">
                • {trimmed.slice(2)}
              </p>
            );
          }
          return (
            <p key={idx} className="text-[15px] leading-7 text-[var(--text-primary)]">
              {line}
            </p>
          );
        })}
      </div>
    );
  }

  return (
    <section className="relative flex min-h-0 flex-1">
      <div ref={scrollRef} className="h-full w-full overflow-y-auto px-3 pb-40 pt-6 sm:px-6 lg:px-10">
        <div className="mx-auto w-full max-w-4xl space-y-5">
          {!hasContent && emptyState}

          {messages.map((msg, index) => {
            if (msg.role === "assistant" && mode === "quiz" && isQuizContent(msg.content)) {
              return <QuizView key={msg._id} content={msg.content} />;
            }
            if (msg.role === "assistant" && mode === "flashcard" && isFlashcardContent(msg.content)) {
              return <FlashcardView key={msg._id} content={msg.content} />;
            }
            const isLastAssistant = msg.role === "assistant" && index === messages.length - 1;
            return (
              <ChatMessage
                key={msg._id}
                role={msg.role}
                content={msg.content}
                enhancedContent={msg.enhancedContent}
                attachments={msg.attachments}
                modelUsed={msg.modelUsed}
                whyThisResponse={msg.whyThisResponse}
                citations={msg.citations}
                mode={msg.role === "assistant" ? mode : undefined}
                isLastAssistant={isLastAssistant}
                onRegenerate={isLastAssistant ? onRegenerate : undefined}
              />
            );
          })}

          {draftResponse && (
            <article className="chat-fade-in flex justify-start">
              <div className="w-full max-w-5xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3">
                <div className="mb-2 inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <span>{modelLabel(lastModelUsed)} is drafting...</span>
                  {lastAutoResult?.searchEnabled ? (
                    <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 thinking-wave">
                      Live search orchestration
                    </span>
                  ) : null}
                </div>
                {lastAutoResult && lastAutoResult.thinkingLevel !== "low" && (
                  <div className="mb-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setShowThinking((prev) => !prev)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]"
                    >
                      <Brain className="h-3.5 w-3.5" />
                      Reasoning {lastAutoResult.thinkingLevel}
                    </button>
                    {showThinking && (
                      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                        The model is using extended reasoning before finalizing the response.
                      </p>
                    )}
                  </div>
                )}
                <div>
                  {renderDraft(draftResponse)}
                  <span className="stream-cursor" aria-hidden>
                    |
                  </span>
                </div>
              </div>
            </article>
          )}

          {sending && !draftResponse && (
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
              <div className="flex items-center gap-3">
                <ThinkingMessages />
              </div>
            </div>
          )}

          {streamError && (
            <div className="rounded-2xl border border-[color-mix(in_oklab,var(--danger)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-secondary))] p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--danger)]/10">
                  {streamError.toLowerCase().includes("budget") ? (
                    <TriangleAlert className="h-4 w-4 text-[var(--danger)]" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-[var(--danger)]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[var(--text-primary)]">Request issue</div>
                  <div className="mt-1 text-sm text-[var(--text-secondary)]">{renderErrorText(streamError)}</div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button type="button" size="sm" onClick={onRetry} className="gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retry
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      {showJumpButton && (
        <Button
          type="button"
          size="icon"
          className="absolute bottom-36 right-5 rounded-full shadow-[var(--shadow-soft)]"
          onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })}
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      )}
    </section>
  );
}
