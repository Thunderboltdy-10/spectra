"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Brain, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/chat/chat-message";
import { CollaboratorsLive, type ActiveCollaborator } from "@/components/chat/collaborators-live";
import { QuizReveal, isQuizContent, type QuizSubmitResult } from "@/components/chat/quiz-reveal";
import { FlashcardReveal, isFlashcardContent, type FlashcardCard } from "@/components/chat/flashcard-reveal";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { ThinkingMessages } from "@/components/loading-states";
import { ContextualTip } from "@/components/ui/contextual-tip";
import { usePanel } from "@/context/panel-context";
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

export function ChatMessages({
  messages,
  draftResponse,
  draftThinking,
  hasRealThinking = false,
  sending,
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
  const panel = usePanel();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
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

  return (
    <section className="relative flex min-h-0 flex-1" aria-label="Conversation">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-y-auto px-3 pb-40 pt-6 sm:px-6 lg:px-10"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <div className="mx-auto w-full max-w-6xl space-y-8">
          {!hasContent && emptyState}

          {messages.length > 30 ? (
            <ContextualTip
              tipId="long-conversation-new-chat"
              message="Start a new conversation for best results."
            />
          ) : null}

          {messages.map((msg, index) => {
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
                        content={structuredContent}
                        chatId={chatId}
                        difficulty={quizDifficulty}
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

          {sending && activeCollaborators.length > 0 ? (
            <CollaboratorsLive collaborators={activeCollaborators} phase={collaboratorPhase} />
          ) : null}

          {sending ? (
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => panel.openPanel("orchestration")}
                className="cursor-pointer rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
              >
                View orchestration
              </button>
            </div>
          ) : null}

          {draftResponse && (mode === "quiz" || mode === "exam" || mode === "flashcard") ? (
            <article className="chat-fade-in flex justify-start">
              <div className="w-full max-w-5xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <span>
                    {modelLabel(lastModelUsed)} is generating {(mode === "quiz" || mode === "exam") ? "quiz" : "flashcards"}...
                  </span>
                </div>
                <p className="text-sm text-[var(--text-secondary)]">
                  {(mode === "quiz" || mode === "exam")
                    ? "Generating quiz structure and answer key."
                    : "Generating flashcard fronts and backs."}
                </p>
                <div className="mt-3 text-xs italic text-[var(--text-secondary)]">
                  {(mode === "quiz" || mode === "exam")
                    ? "Answers will appear after generation completes."
                    : "Card backs will reveal after generation completes."}
                </div>
              </div>
            </article>
          ) : draftResponse ? (
            <article className="chat-fade-in flex justify-start">
              <div className="w-full max-w-5xl px-1 py-1">
                <div className="mb-2 inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <span>{modelLabel(lastModelUsed)} is drafting...</span>
                  {lastAutoResult?.searchEnabled ? (
                    <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 thinking-wave">
                      Live search orchestration
                    </span>
                  ) : null}
                </div>
                {!hasRealThinking && thinkingLevel !== "low" ? (
                  <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                    <Brain className="h-3.5 w-3.5" />
                    Reasoning enabled. Some models keep reasoning private.
                  </div>
                ) : null}
                <div>
                  {hasRealThinking && draftThinking ? (
                    <ThinkingBlock content={draftThinking} streaming />
                  ) : null}
                  {renderDraftMarkdown(draftResponse)}
                  <span className="stream-cursor" aria-hidden>
                    |
                  </span>
                </div>
              </div>
            </article>
          ) : null}

          {sending && !draftResponse && (
            <div className="chat-fade-in">
              <div className="flex items-center gap-3">
                <ThinkingMessages />
              </div>
              {thinkingLevel !== "low" && !hasRealThinking ? (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                  <Brain className="h-3.5 w-3.5 animate-pulse" />
                  Reasoning...
                </div>
              ) : null}
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
