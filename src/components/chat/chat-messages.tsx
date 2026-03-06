"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/chat/chat-message";
import type { ActiveCollaborator } from "@/components/chat/collaborators-live";
import { QuizReveal, isQuizContent, type QuizSubmitResult } from "@/components/chat/quiz-reveal";
import { FlashcardReveal, isFlashcardContent, type FlashcardCard } from "@/components/chat/flashcard-reveal";
import { DocumentPanel } from "@/components/chat/document-panel";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { ThinkingMessages } from "@/components/loading-states";
import { ProviderLogo } from "@/components/provider-logo";
import { isGeneratedDocumentContent, parseGeneratedDocument } from "@/lib/document-generator";
import { autoCloseMarkdown } from "@/lib/stream-markdown";
import { getModeConfig } from "@/lib/modes";
import type { Message } from "@/hooks/use-chat-state";
import type { StudyMode } from "@/types";

type ChatMessagesProps = {
  messages: Message[];
  draftResponse: string;
  draftThinking?: string;
  hasRealThinking?: boolean;
  sending: boolean;
  streamPhase?: "idle" | "compacting" | "routing" | "searching" | "thinking" | "generating" | "synthesizing";
  streamError: string | null;
  chatId?: string;
  onRetry: () => void;
  onSubmitQuizAnswers?: (payload: { messageId: string; result: QuizSubmitResult }) => void;
  onSaveFlashcardDeck?: (payload: { messageId: string; title: string; cards: FlashcardCard[] }) => void;
  onRateFlashcardCard?: (payload: { messageId: string; cardHash: string; quality: number }) => void;
  onRegenerate?: () => void;
  onRegenerateWithModel?: (modelId: string) => void;
  onAssistantFeedback?: (positive: boolean, modelId?: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>;
  onBranchMessage?: (messageId: string) => Promise<void> | void;
  onToggleBookmarkMessage?: (messageId: string) => Promise<void> | void;
  bookmarkedMessageIds?: Set<string>;
  bookmarkingMessageId?: string | null;
  onFollowUp?: (message: string) => void;
  onModeChange?: (mode: string) => void;
  regenModels?: Array<{ modelId: string; name: string }>;
  emptyState?: React.ReactNode;
  mode: StudyMode;
  thinkingLevel?: "low" | "medium" | "high";
  lastModelUsed?: string;
  lastAutoResult?: {
    modelUsed?: string;
    searchEnabled: boolean;
    thinkingLevel: "low" | "medium" | "high";
    promptEnhanced: boolean;
  } | null;
  activeCollaborators?: ActiveCollaborator[];
  collaboratorPhase?: "idle" | "running" | "synthesizing";
  onOpenCanvas?: (params: { code: string; language: string }) => void;
};

function hashContent(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function ChatMessages({
  messages,
  draftResponse,
  draftThinking,
  hasRealThinking = false,
  sending,
  streamPhase = "idle",
  streamError,
  chatId,
  onRetry,
  onSubmitQuizAnswers,
  onSaveFlashcardDeck,
  onRateFlashcardCard,
  onRegenerate,
  onRegenerateWithModel,
  onAssistantFeedback,
  onEditMessage,
  onBranchMessage,
  onToggleBookmarkMessage,
  bookmarkedMessageIds = new Set<string>(),
  bookmarkingMessageId = null,
  onFollowUp,
  onModeChange,
  regenModels = [],
  emptyState,
  mode,
  thinkingLevel = "medium",
  lastModelUsed,
  lastAutoResult,
  activeCollaborators = [],
  collaboratorPhase = "idle",
  onOpenCanvas,
}: ChatMessagesProps) {
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const topLoadSentinelRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const previousChatIdRef = useRef<string | undefined>(chatId);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [showStreamCursor, setShowStreamCursor] = useState(false);
  const [visibleStartIndex, setVisibleStartIndex] = useState(() => Math.max(0, messages.length - 36));
  const shouldAutoScrollRef = useRef(true);
  const stickyBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  const hasContent = messages.length > 0 || Boolean(draftResponse);
  const visibleMessages = useMemo(
    () => messages.slice(visibleStartIndex),
    [messages, visibleStartIndex],
  );

  useEffect(() => {
    const chatChanged = previousChatIdRef.current !== chatId;
    previousChatIdRef.current = chatId;

    if (chatChanged) {
      setVisibleStartIndex(Math.max(0, messages.length - 36));
      return;
    }

    if (messages.length === 0) {
      setVisibleStartIndex(0);
      return;
    }

    setVisibleStartIndex((prev) => {
      const next = Math.min(prev, Math.max(0, messages.length - 1));
      return next === prev ? prev : next;
    });
  }, [chatId, messages.length]);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      endRef.current?.scrollIntoView({
        behavior: sending ? "auto" : scrollContainerRef.current ? "smooth" : "auto",
      });
    }
  }, [draftResponse, messages, sending]);

  useEffect(() => {
    const element = document.querySelector<HTMLElement>("[data-chat-scroll-root]");
    if (!element) return;
    scrollContainerRef.current = element;

    let rafId = 0;
    const onScroll = () => {
      rafId = requestAnimationFrame(() => {
        const scrollTop = element.scrollTop;
        const deltaFromBottom = element.scrollHeight - scrollTop - element.clientHeight;
        const scrolledUp = scrollTop < lastScrollTopRef.current;
        const nearBottom = deltaFromBottom < 72;

        if (nearBottom) {
          shouldAutoScrollRef.current = true;
          stickyBottomRef.current = true;
        } else if (shouldAutoScrollRef.current && stickyBottomRef.current && scrolledUp && deltaFromBottom > 140) {
          shouldAutoScrollRef.current = false;
          stickyBottomRef.current = false;
        }

        setShowJumpButton(deltaFromBottom > 180);
        lastScrollTopRef.current = scrollTop;
      });
    };

    onScroll();
    element.addEventListener("scroll", onScroll);
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (!sending) return;
    if (stickyBottomRef.current) {
      shouldAutoScrollRef.current = true;
    }
  }, [sending]);

  useEffect(() => {
    const root = scrollContainerRef.current;
    const target = topLoadSentinelRef.current;
    if (!root || !target || visibleStartIndex <= 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (visibleStartIndex <= 0) return;

        const previousHeight = root.scrollHeight;
        const previousTop = root.scrollTop;
        setVisibleStartIndex((prev) => Math.max(0, prev - 24));
        requestAnimationFrame(() => {
          const nextHeight = root.scrollHeight;
          root.scrollTop = previousTop + (nextHeight - previousHeight);
        });
      },
      {
        root,
        rootMargin: "220px 0px 0px 0px",
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [visibleStartIndex]);

  function modelLabel(modelId?: string) {
    if (!modelId) return "Routing model";
    return modelId.split("/").pop() ?? "Model";
  }

  useEffect(() => {
    if (sending) {
      setShowStreamCursor(true);
      return;
    }
    const timeout = window.setTimeout(() => setShowStreamCursor(false), 220);
    return () => window.clearTimeout(timeout);
  }, [sending]);

  function renderErrorText(error: string) {
    const lower = error.toLowerCase();

    if (lower.includes("monthly limit") || lower.includes("no_free_model_available")) {
      return "Current usage guardrails are active. Guardrail-safe models are still available.";
    }
    if (lower.includes("429") || lower.includes("rate")) {
      return "The model is busy. Backup models were attempted automatically.";
    }
    if (lower.includes("network") || lower.includes("fetch") || lower.includes("connection")) {
      return "Connection lost. Retrying...";
    }
    if (lower.includes("auth") || lower.includes("401") || lower.includes("unauthorized")) {
      return "Session expired. Redirecting to sign-in...";
    }

    return error;
  }

  function renderDraftMarkdown(text: string) {
    return <MarkdownRenderer content={autoCloseMarkdown(text)} citations={[]} />;
  }

  function isLikelyClarifyingText(value: string) {
    const clean = value.trim();
    if (!clean) return false;
    if (!clean.includes("?")) return false;
    if (isQuizContent(clean) || isFlashcardContent(clean)) return false;
    const lines = clean.split("\n").filter((line) => line.trim().length > 0);
    return clean.length < 420 && lines.length <= 7;
  }

  function splitMixedContent(content: string, contentMode: StudyMode): { preamble: string; structuredContent: string } {
    if (contentMode === "quiz" || contentMode === "exam") {
      const match = content.match(/(?:^|\n)\s*(?:Q(?:uestion)?\s*)?1[.):-]\s/m);
      if (match?.index !== undefined && match.index > 0) {
        return {
          preamble: content.slice(0, match.index).trim(),
          structuredContent: content.slice(match.index).trim(),
        };
      }
    }
    if (contentMode === "flashcard") {
      const match = content.match(/(?:^|\n)\s*(?:Card\s*1|FRONT\s*:)/im);
      if (match?.index !== undefined && match.index > 0) {
        return {
          preamble: content.slice(0, match.index).trim(),
          structuredContent: content.slice(match.index).trim(),
        };
      }
    }
    return { preamble: "", structuredContent: content };
  }

  function inferQuizDifficulty(toolchain?: string[]) {
    if (toolchain?.includes("quiz_difficulty_easy")) return "easy" as const;
    if (toolchain?.includes("quiz_difficulty_hard")) return "hard" as const;
    return "medium" as const;
  }

  const streamingStatus = (() => {
    switch (streamPhase) {
      case "compacting": return "Compacting...";
      case "routing": return "Routing...";
      case "searching": return "Searching...";
      case "thinking": return "Thinking...";
      case "synthesizing": return "Synthesizing...";
      case "generating": return "Drafting...";
      default:
        if (collaboratorPhase === "synthesizing") return "Synthesizing...";
        return lastAutoResult?.searchEnabled
          ? "Searching..."
          : activeCollaborators.length > 0 || thinkingLevel !== "low"
            ? "Thinking..."
            : "Drafting...";
    }
  })();
  const activeProvider = lastModelUsed?.split("/")[0] ?? "openrouter";
  const visibleDraftResponse = (() => {
    const cleanDraft = draftResponse.trim();
    if (!cleanDraft) return "";
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") return draftResponse;
    const cleanFinal = lastMessage.content.trim();
    if (!cleanFinal) return draftResponse;
    const duplicate =
      cleanDraft === cleanFinal
      || cleanFinal.endsWith(cleanDraft)
      || cleanDraft.endsWith(cleanFinal);
    return duplicate ? "" : draftResponse;
  })();
  const showQuizSkeletonOnly =
    sending &&
    (mode === "quiz" || mode === "exam") &&
    visibleDraftResponse.trim().length < 100;

  return (
    <section className="relative flex flex-1" aria-label="Conversation" data-conversation-export>
      <div
        className="w-full px-3 pb-32 pt-6 sm:px-6 md:pb-36 lg:px-10"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <div className="mx-auto w-full max-w-6xl space-y-8">
          {!hasContent && emptyState}

          {visibleStartIndex > 0 ? (
            <div
              ref={topLoadSentinelRef}
              className="mb-4 text-center text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)]"
              aria-label="Load older messages"
            >
              Loading earlier messages...
            </div>
          ) : null}

          {visibleMessages.map((msg, localIndex) => {
            const index = visibleStartIndex + localIndex;
            const isLastAssistant = msg.role === "assistant" && index === messages.length - 1;
            const msgMode = msg.mode ?? mode;
            const prevMsg = messages[index - 1];
            const showModeTransition =
              index > 0 &&
              prevMsg?.mode !== msg.mode &&
              msg.mode !== undefined;
            const assistantIsBookmarked = bookmarkedMessageIds.has(msg._id);
            const assistantBookmarking = bookmarkingMessageId === msg._id;
            const quizDifficulty = inferQuizDifficulty(msg.routeTrace?.toolchain);

            if (msg.role === "assistant" && (msgMode === "quiz" || msgMode === "exam")) {
              if (isQuizContent(msg.content)) {
                const { preamble, structuredContent } = splitMixedContent(msg.content, msgMode);
                return (
                  <div key={msg._id}>
                    {showModeTransition && (
                      <div className="flex items-center gap-2 py-2">
                        <div className="h-px flex-1 bg-[var(--border-default)]" />
                        <span className="text-[10px] text-[var(--text-tertiary)]">
                          Switched to {getModeConfig(msg.mode!)?.label ?? msg.mode} mode
                        </span>
                        <div className="h-px flex-1 bg-[var(--border-default)]" />
                      </div>
                    )}
                    <ChatMessage
                      role={msg.role}
                      content=""
                      thinkingContent={msg.thinkingContent}
                      enhancedContent={msg.enhancedContent}
                      attachments={msg.attachments}
                      attachmentPreviews={msg.attachmentPreviews}
                      modelUsed={msg.modelUsed}
                      whyThisResponse={msg.whyThisResponse}
                      routeTrace={msg.routeTrace}
                      citations={msg.citations}
                      mode={msgMode}
                      isLastAssistant={isLastAssistant}
                      animateIn={!isLastAssistant}
                      onRegenerate={isLastAssistant ? onRegenerate : undefined}
                      onRegenerateWithModel={isLastAssistant ? onRegenerateWithModel : undefined}
                      regenModels={regenModels}
                      onEdit={undefined}
                      onBranch={onBranchMessage ? () => void onBranchMessage(msg._id) : undefined}
                      onToggleBookmark={onToggleBookmarkMessage ? () => void onToggleBookmarkMessage(msg._id) : undefined}
                      isBookmarked={assistantIsBookmarked}
                      bookmarking={assistantBookmarking}
                      usageIn={msg.usageIn}
                      usageOut={msg.usageOut}
                      createdAt={msg.createdAt}
                      onFeedback={onAssistantFeedback}
                      onOpenCanvas={onOpenCanvas}
                      onSubmitQuizAnswers={(result) => {
                        onSubmitQuizAnswers?.({ messageId: msg._id, result });
                      }}
                    >
                      {preamble && <MarkdownRenderer content={preamble} citations={[]} />}
                      <QuizReveal
                        key={`${msg._id}-${hashContent(structuredContent)}`}
                        content={structuredContent}
                        messageId={msg._id}
                        chatId={chatId}
                        difficulty={quizDifficulty}
                        autoOpen={isLastAssistant}
                        onSubmitAnswers={(result) => {
                          onSubmitQuizAnswers?.({ messageId: msg._id, result });
                        }}
                        onFollowUp={onFollowUp}
                        onModeChange={onModeChange}
                      />
                    </ChatMessage>
                  </div>
                );
              }
              if (isLikelyClarifyingText(msg.content)) {
                return (
                  <div key={msg._id}>
                    {showModeTransition && (
                      <div className="flex items-center gap-2 py-2">
                        <div className="h-px flex-1 bg-[var(--border-default)]" />
                        <span className="text-[10px] text-[var(--text-tertiary)]">
                          Switched to {getModeConfig(msg.mode!)?.label ?? msg.mode} mode
                        </span>
                        <div className="h-px flex-1 bg-[var(--border-default)]" />
                      </div>
                    )}
                    <ChatMessage
                      role={msg.role}
                      content={msg.content}
                      thinkingContent={msg.thinkingContent}
                      enhancedContent={msg.enhancedContent}
                      attachments={msg.attachments}
                      attachmentPreviews={msg.attachmentPreviews}
                      modelUsed={msg.modelUsed}
                      whyThisResponse={msg.whyThisResponse}
                      routeTrace={msg.routeTrace}
                      citations={msg.citations}
                      mode={msgMode}
                      isLastAssistant={isLastAssistant}
                      animateIn={!isLastAssistant}
                      onRegenerate={isLastAssistant ? onRegenerate : undefined}
                      onRegenerateWithModel={isLastAssistant ? onRegenerateWithModel : undefined}
                      regenModels={regenModels}
                      onEdit={undefined}
                      onBranch={onBranchMessage ? () => void onBranchMessage(msg._id) : undefined}
                      onToggleBookmark={onToggleBookmarkMessage ? () => void onToggleBookmarkMessage(msg._id) : undefined}
                      isBookmarked={assistantIsBookmarked}
                      bookmarking={assistantBookmarking}
                      usageIn={msg.usageIn}
                      usageOut={msg.usageOut}
                      createdAt={msg.createdAt}
                      onFeedback={onAssistantFeedback}
                      onOpenCanvas={onOpenCanvas}
                      onSubmitQuizAnswers={(result) => {
                        onSubmitQuizAnswers?.({ messageId: msg._id, result });
                      }}
                    />
                  </div>
                );
              }
              return (
                <div key={msg._id}>
                  {showModeTransition && (
                    <div className="flex items-center gap-2 py-2">
                      <div className="h-px flex-1 bg-[var(--border-default)]" />
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        Switched to {getModeConfig(msg.mode!)?.label ?? msg.mode} mode
                      </span>
                      <div className="h-px flex-1 bg-[var(--border-default)]" />
                    </div>
                  )}
                  <ChatMessage
                    role={msg.role}
                    content={msg.content}
                    thinkingContent={msg.thinkingContent}
                    enhancedContent={msg.enhancedContent}
                    attachments={msg.attachments}
                    attachmentPreviews={msg.attachmentPreviews}
                    modelUsed={msg.modelUsed}
                    whyThisResponse={msg.whyThisResponse}
                    routeTrace={msg.routeTrace}
                    citations={msg.citations}
                    mode={msgMode}
                    isLastAssistant={isLastAssistant}
                    animateIn={!isLastAssistant}
                    onRegenerate={isLastAssistant ? onRegenerate : undefined}
                    onRegenerateWithModel={isLastAssistant ? onRegenerateWithModel : undefined}
                    regenModels={regenModels}
                    onEdit={undefined}
                    onBranch={onBranchMessage ? () => void onBranchMessage(msg._id) : undefined}
                    onToggleBookmark={onToggleBookmarkMessage ? () => void onToggleBookmarkMessage(msg._id) : undefined}
                    isBookmarked={assistantIsBookmarked}
                    bookmarking={assistantBookmarking}
                    usageIn={msg.usageIn}
                    usageOut={msg.usageOut}
                    createdAt={msg.createdAt}
                    onFeedback={onAssistantFeedback}
                    onOpenCanvas={onOpenCanvas}
                    onSubmitQuizAnswers={(result) => {
                      onSubmitQuizAnswers?.({ messageId: msg._id, result });
                    }}
                  />
                </div>
              );
            }

            if (msg.role === "assistant" && msgMode === "flashcard") {
              if (isFlashcardContent(msg.content)) {
                const { preamble, structuredContent } = splitMixedContent(msg.content, msgMode);
                return (
                  <div key={msg._id}>
                    {showModeTransition && (
                      <div className="flex items-center gap-2 py-2">
                        <div className="h-px flex-1 bg-[var(--border-default)]" />
                        <span className="text-[10px] text-[var(--text-tertiary)]">
                          Switched to {getModeConfig(msg.mode!)?.label ?? msg.mode} mode
                        </span>
                        <div className="h-px flex-1 bg-[var(--border-default)]" />
                      </div>
                    )}
                    <ChatMessage
                      role={msg.role}
                      content=""
                      thinkingContent={msg.thinkingContent}
                      enhancedContent={msg.enhancedContent}
                      attachments={msg.attachments}
                      attachmentPreviews={msg.attachmentPreviews}
                      modelUsed={msg.modelUsed}
                      whyThisResponse={msg.whyThisResponse}
                      routeTrace={msg.routeTrace}
                      citations={msg.citations}
                      mode={msgMode}
                      isLastAssistant={isLastAssistant}
                      animateIn={!isLastAssistant}
                      onRegenerate={isLastAssistant ? onRegenerate : undefined}
                      onRegenerateWithModel={isLastAssistant ? onRegenerateWithModel : undefined}
                      regenModels={regenModels}
                      onEdit={undefined}
                      onBranch={onBranchMessage ? () => void onBranchMessage(msg._id) : undefined}
                      onToggleBookmark={onToggleBookmarkMessage ? () => void onToggleBookmarkMessage(msg._id) : undefined}
                      isBookmarked={assistantIsBookmarked}
                      bookmarking={assistantBookmarking}
                      usageIn={msg.usageIn}
                      usageOut={msg.usageOut}
                      createdAt={msg.createdAt}
                      onFeedback={onAssistantFeedback}
                      onOpenCanvas={onOpenCanvas}
                    >
                      {preamble && <MarkdownRenderer content={preamble} citations={[]} />}
                      <FlashcardReveal
                        content={structuredContent}
                        onSaveDeck={(payload) => {
                          onSaveFlashcardDeck?.({
                            messageId: msg._id,
                            title: payload.title,
                            cards: payload.cards,
                          });
                        }}
                        onRateCard={(payload) => {
                          onRateFlashcardCard?.({
                            messageId: msg._id,
                            cardHash: payload.cardHash,
                            quality: payload.quality,
                          });
                        }}
                        onFollowUp={onFollowUp}
                      />
                    </ChatMessage>
                  </div>
                );
              }
              return (
                <div key={msg._id}>
                  {showModeTransition && (
                    <div className="flex items-center gap-2 py-2">
                      <div className="h-px flex-1 bg-[var(--border-default)]" />
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        Switched to {getModeConfig(msg.mode!)?.label ?? msg.mode} mode
                      </span>
                      <div className="h-px flex-1 bg-[var(--border-default)]" />
                    </div>
                  )}
                  <ChatMessage
                    role={msg.role}
                    content={msg.content}
                    thinkingContent={msg.thinkingContent}
                    enhancedContent={msg.enhancedContent}
                    attachments={msg.attachments}
                    attachmentPreviews={msg.attachmentPreviews}
                    modelUsed={msg.modelUsed}
                    whyThisResponse={msg.whyThisResponse}
                    routeTrace={msg.routeTrace}
                    citations={msg.citations}
                    mode={msgMode}
                    isLastAssistant={isLastAssistant}
                    animateIn={!isLastAssistant}
                    onRegenerate={isLastAssistant ? onRegenerate : undefined}
                    onRegenerateWithModel={isLastAssistant ? onRegenerateWithModel : undefined}
                    regenModels={regenModels}
                    onEdit={undefined}
                    onBranch={onBranchMessage ? () => void onBranchMessage(msg._id) : undefined}
                    onToggleBookmark={onToggleBookmarkMessage ? () => void onToggleBookmarkMessage(msg._id) : undefined}
                    isBookmarked={assistantIsBookmarked}
                    bookmarking={assistantBookmarking}
                    usageIn={msg.usageIn}
                    usageOut={msg.usageOut}
                    createdAt={msg.createdAt}
                    onFeedback={onAssistantFeedback}
                    onOpenCanvas={onOpenCanvas}
                  />
                </div>
              );
            }

            if (msg.role === "assistant" && msgMode === "document" && isGeneratedDocumentContent(msg.content)) {
              const parsed = parseGeneratedDocument(msg.content);
              return (
                <div key={msg._id}>
                  {showModeTransition && (
                    <div className="flex items-center gap-2 py-2">
                      <div className="h-px flex-1 bg-[var(--border-default)]" />
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        Switched to {getModeConfig(msg.mode!)?.label ?? msg.mode} mode
                      </span>
                      <div className="h-px flex-1 bg-[var(--border-default)]" />
                    </div>
                  )}
                  <ChatMessage
                    role={msg.role}
                    content=""
                    thinkingContent={msg.thinkingContent}
                    enhancedContent={msg.enhancedContent}
                    attachments={msg.attachments}
                    attachmentPreviews={msg.attachmentPreviews}
                    modelUsed={msg.modelUsed}
                    whyThisResponse={msg.whyThisResponse}
                    routeTrace={msg.routeTrace}
                    citations={msg.citations}
                    mode={msgMode}
                    isLastAssistant={isLastAssistant}
                    onRegenerate={isLastAssistant ? onRegenerate : undefined}
                    onRegenerateWithModel={isLastAssistant ? onRegenerateWithModel : undefined}
                    regenModels={regenModels}
                    onBranch={onBranchMessage ? () => void onBranchMessage(msg._id) : undefined}
                    onToggleBookmark={onToggleBookmarkMessage ? () => void onToggleBookmarkMessage(msg._id) : undefined}
                    isBookmarked={assistantIsBookmarked}
                    bookmarking={assistantBookmarking}
                    usageIn={msg.usageIn}
                    usageOut={msg.usageOut}
                    createdAt={msg.createdAt}
                    onFeedback={onAssistantFeedback}
                    onOpenCanvas={onOpenCanvas}
                  >
                    {parsed.preamble ? <MarkdownRenderer content={parsed.preamble} citations={[]} /> : null}
                    <DocumentPanel content={msg.content} />
                  </ChatMessage>
                </div>
              );
            }

            return (
              <div key={msg._id}>
                {showModeTransition && (
                  <div className="flex items-center gap-2 py-2">
                    <div className="h-px flex-1 bg-[var(--border-default)]" />
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      Switched to {getModeConfig(msg.mode!)?.label ?? msg.mode} mode
                    </span>
                    <div className="h-px flex-1 bg-[var(--border-default)]" />
                  </div>
                )}
                <ChatMessage
                  role={msg.role}
                  content={msg.content}
                  thinkingContent={msg.thinkingContent}
                  enhancedContent={msg.enhancedContent}
                  attachments={msg.attachments}
                  attachmentPreviews={msg.attachmentPreviews}
                  modelUsed={msg.modelUsed}
                  whyThisResponse={msg.whyThisResponse}
                    routeTrace={msg.routeTrace}
                    citations={msg.citations}
                    mode={msg.role === "assistant" ? msgMode : undefined}
                    isLastAssistant={isLastAssistant}
                    animateIn={msg.role === "assistant" ? !isLastAssistant : true}
                    onRegenerate={isLastAssistant ? onRegenerate : undefined}
                  onRegenerateWithModel={isLastAssistant ? onRegenerateWithModel : undefined}
                  regenModels={regenModels}
                  onEdit={msg.role === "user" && onEditMessage ? (value) => void onEditMessage(msg._id, value) : undefined}
                  onBranch={msg.role === "assistant" && onBranchMessage ? () => void onBranchMessage(msg._id) : undefined}
                  onToggleBookmark={msg.role === "assistant" && onToggleBookmarkMessage ? () => void onToggleBookmarkMessage(msg._id) : undefined}
                  isBookmarked={msg.role === "assistant" ? assistantIsBookmarked : undefined}
                  bookmarking={msg.role === "assistant" ? assistantBookmarking : undefined}
                  usageIn={msg.usageIn}
                  usageOut={msg.usageOut}
                  createdAt={msg.createdAt}
                  onFeedback={msg.role === "assistant" ? onAssistantFeedback : undefined}
                  onOpenCanvas={onOpenCanvas}
                  onSubmitQuizAnswers={(result) => {
                    onSubmitQuizAnswers?.({ messageId: msg._id, result });
                  }}
                />
              </div>
            );
          })}

          {visibleDraftResponse && (mode === "quiz" || mode === "exam" || mode === "flashcard") ? (
            <article className="chat-fade-in flex justify-start">
              <div className="w-full max-w-5xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3">
                <div className="mb-3 inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <ProviderLogo provider={activeProvider} modelId={lastModelUsed} size={12} className="h-5 w-5 rounded-md" />
                  <span>{modelLabel(lastModelUsed)} · {streamingStatus}</span>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-[var(--text-secondary)]">
                    {mode === "flashcard"
                      ? "Preparing flashcard view. Cards will appear only after the full structured result is ready."
                      : "Preparing quiz interface. Questions and answers will appear only after the final structured result is ready."}
                  </p>
                  <div className="space-y-2">
                    {(showQuizSkeletonOnly ? [0, 1, 2] : [0, 1, 2, 3]).map((index) => (
                      <div
                        key={`structured-stream-skeleton-${index}`}
                        className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-3"
                      >
                        <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--bg-primary)]" />
                        <div className="mt-2 h-2.5 w-full animate-pulse rounded bg-[var(--bg-primary)]" />
                        <div className="mt-1.5 h-2.5 w-5/6 animate-pulse rounded bg-[var(--bg-primary)]" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          ) : visibleDraftResponse ? (
            <article className="chat-fade-in flex justify-start">
              <div className="w-full max-w-5xl px-1 py-1">
                <div className="mb-2 inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <ProviderLogo provider={activeProvider} modelId={lastModelUsed} size={12} className="h-5 w-5 rounded-md" />
                  <span>{modelLabel(lastModelUsed)} · {streamingStatus}</span>
                </div>
                <div>
                  {hasRealThinking && draftThinking ? (
                    <ThinkingBlock content={draftThinking} streaming />
                  ) : null}
                  {renderDraftMarkdown(visibleDraftResponse)}
                  {showStreamCursor ? (
                    <span className={`stream-cursor ${sending ? "" : "stream-cursor--fade"}`} aria-hidden>
                      |
                    </span>
                  ) : null}
                </div>
              </div>
            </article>
          ) : null}

          {sending && !visibleDraftResponse && (
            <div className="chat-fade-in">
              <div className="flex items-center gap-3">
                <ThinkingMessages />
              </div>
              {hasRealThinking && draftThinking ? (
                <div className="mt-3">
                  <ThinkingBlock content={draftThinking} streaming />
                </div>
              ) : null}
              {/* Shimmer skeleton for slow initial response */}
              {!hasRealThinking && activeCollaborators.length === 0 ? (
                <div className="mt-4 space-y-2">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--bg-secondary)]" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--bg-secondary)]" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--bg-secondary)]" />
                </div>
              ) : null}
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
          className="fixed bottom-28 right-5 z-30 rounded-full shadow-[var(--shadow-soft)]"
          onClick={() => {
            shouldAutoScrollRef.current = true;
            stickyBottomRef.current = true;
            endRef.current?.scrollIntoView({
              behavior: scrollContainerRef.current ? "smooth" : "auto",
            });
          }}
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      )}
    </section>
  );
}
