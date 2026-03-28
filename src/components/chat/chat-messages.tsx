"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/chat/chat-message";
import type { ActiveCollaborator } from "@/components/chat/collaborators-live";
import { QuizReveal, isQuizContent, type QuizSubmitResult } from "@/components/chat/quiz-reveal";
import { FlashcardReveal, isFlashcardContent, type FlashcardCard } from "@/components/chat/flashcard-reveal";
import { ClarificationCard } from "@/components/chat/clarification-card";
import { DocumentPanel } from "@/components/chat/document-panel";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { ProviderLogo } from "@/components/provider-logo";
import { isGeneratedDocumentContent, parseGeneratedDocument } from "@/lib/document-generator";
import { stripQuizMarkers } from "@/lib/quiz-parser";
import { autoCloseMarkdown } from "@/lib/stream-markdown";
import { getModeConfig } from "@/lib/modes";
import type { Message } from "@/hooks/use-chat-state";
import type { ClarificationBlock, RouteTrace, StudyMode } from "@/types";

type ChatMessagesProps = {
  messages: Message[];
  draftResponse: string;
  draftThinking?: string;
  hasRealThinking?: boolean;
  sending: boolean;
  streamPhase?: "idle" | "compacting" | "routing" | "searching" | "thinking" | "generating" | "synthesizing";
  streamError: string | null;
  searchStatusBanner?: "model_knowledge" | "real_search" | "error" | null;
  searchStatusInfo?: {
    status: "completed" | "failed";
    sourceCount: number;
  } | null;
  proactiveBanner?: {
    title: string;
    body: string;
    actionLabel: string;
  } | null;
  chatId?: string;
  onRetry: () => void;
  onApplyProactiveBanner?: () => void;
  onDismissProactiveBanner?: () => void;
  onSubmitQuizAnswers?: (payload: { messageId: string; result: QuizSubmitResult }) => void;
  onSaveFlashcardDeck?: (payload: { messageId: string; title: string; cards: FlashcardCard[] }) => void;
  onRateFlashcardCard?: (payload: { messageId: string; cardHash: string; quality: number }) => void;
  onEditFlashcardCard?: (
    payload: { messageId: string; cardHash: string; front: string; back: string },
  ) => Promise<{ updatedCardHash?: string; previousCardHash?: string; hashChanged?: boolean } | void> | void;
  onRegenerate?: () => void;
  onRegenerateWithModel?: (modelId: string) => void;
  onAssistantFeedback?: (messageId: string, positive: boolean, modelId?: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>;
  onBranchMessage?: (messageId: string) => Promise<void> | void;
  onToggleBookmarkMessage?: (messageId: string) => Promise<void> | void;
  onSaveAsArtifact?: (messageId: string, content: string) => void;
  artifactSavedMessageIds?: Map<string, string>;
  bookmarkedMessageIds?: Set<string>;
  bookmarkingMessageId?: string | null;
  onFollowUp?: (message: string, modeOverride?: StudyMode) => void;
  onModeChange?: (mode: string) => void;
  regenModels?: Array<{ modelId: string; name: string }>;
  emptyState?: React.ReactNode;
  mode: StudyMode;
  thinkingLevel?: "low" | "medium" | "high";
  lastModelUsed?: string;
  streamRouteTrace?: RouteTrace | null;
  lastAutoResult?: {
    modelUsed?: string;
    searchEnabled: boolean;
    thinkingLevel: "low" | "medium" | "high";
    promptEnhanced: boolean;
  } | null;
  activeCollaborators?: ActiveCollaborator[];
  collaboratorPhase?: "idle" | "running" | "synthesizing";
  onOpenCanvas?: (params: { code: string; language: string }) => void;
  onPinModel?: (modelId: string) => void;
  pinnedModelId?: string;
};

function hashContent(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function TagSkeleton({ type }: { type: "quiz" | "flashcard" | "document" }) {
  if (type === "quiz") {
    return (
      <div className="animate-pulse space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded bg-[var(--mode-quiz)]/20" />
          <div className="h-4 w-32 rounded bg-[var(--bg-secondary)]" />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 pl-2">
            <div className="h-3.5 w-3/4 rounded bg-[var(--bg-secondary)]" />
            <div className="flex flex-wrap gap-2">
              {["A", "B", "C", "D"].map((opt) => (
                <div key={opt} className="flex items-center gap-1.5">
                  <div className="h-3.5 w-3.5 rounded-full border border-[var(--border-default)]" />
                  <div className="h-3 w-16 rounded bg-[var(--bg-secondary)]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "flashcard") {
    return (
      <div className="animate-pulse space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded bg-[var(--mode-flashcard)]/20" />
          <div className="h-4 w-36 rounded bg-[var(--bg-secondary)]" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex h-24 flex-col items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]/50">
              <div className="h-3 w-20 rounded bg-[var(--bg-tertiary)]" />
              <div className="mt-2 h-2.5 w-14 rounded bg-[var(--bg-tertiary)]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Document skeleton
  return (
    <div className="animate-pulse space-y-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded bg-[var(--mode-document)]/20" />
        <div className="h-4 w-40 rounded bg-[var(--bg-secondary)]" />
      </div>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-3 rounded bg-[var(--bg-secondary)]" style={{ width: `${85 - i * 8}%` }} />
      ))}
    </div>
  );
}

function detectOpenTag(content: string): "quiz" | "flashcard" | "document" | null {
  const lower = content.toLowerCase();

  const quizOpen = lower.includes("<<quiz_start>>") || lower.includes("<<quiz start>>");
  const quizClose = lower.includes("<<quiz_end>>") || lower.includes("<<quiz end>>");
  if (quizOpen && !quizClose) return "quiz";

  const fcOpen = lower.includes("<<flashcards_start>>") || lower.includes("<<flashcard_start>>");
  const fcClose = lower.includes("<<flashcards_end>>") || lower.includes("<<flashcard_end>>");
  if (fcOpen && !fcClose) return "flashcard";

  const docOpen = lower.includes("<<document_start>>") || lower.includes("<<doc_start>>");
  const docClose = lower.includes("<<document_end>>") || lower.includes("<<doc_end>>");
  if (docOpen && !docClose) return "document";

  return null;
}

/** Detects whether completed content has closed tag markers (for persisted messages). */
function hasClosedTag(content: string): "quiz" | "flashcard" | "document" | null {
  const lower = content.toLowerCase();

  if (
    (lower.includes("<<quiz_start>>") || lower.includes("<<quiz start>>")) &&
    (lower.includes("<<quiz_end>>") || lower.includes("<<quiz end>>"))
  ) return "quiz";

  if (
    (lower.includes("<<flashcards_start>>") || lower.includes("<<flashcard_start>>")) &&
    (lower.includes("<<flashcards_end>>") || lower.includes("<<flashcard_end>>"))
  ) return "flashcard";

  if (
    (lower.includes("<<document_start>>") || lower.includes("<<doc_start>>")) &&
    (lower.includes("<<document_end>>") || lower.includes("<<doc_end>>"))
  ) return "document";

  return null;
}

export function ChatMessages({
  messages,
  draftResponse,
  draftThinking,
  hasRealThinking = false,
  sending,
  streamPhase = "idle",
  streamError,
  searchStatusBanner = null,
  searchStatusInfo = null,
  proactiveBanner = null,
  chatId,
  onRetry,
  onApplyProactiveBanner,
  onDismissProactiveBanner,
  onSubmitQuizAnswers,
  onSaveFlashcardDeck,
  onRateFlashcardCard,
  onEditFlashcardCard,
  onRegenerate,
  onRegenerateWithModel,
  onAssistantFeedback,
  onEditMessage,
  onBranchMessage,
  onToggleBookmarkMessage,
  onSaveAsArtifact,
  artifactSavedMessageIds = new Map<string, string>(),
  bookmarkedMessageIds = new Set<string>(),
  bookmarkingMessageId = null,
  onFollowUp,
  onModeChange,
  regenModels = [],
  emptyState,
  mode,
  thinkingLevel = "medium",
  lastModelUsed,
  streamRouteTrace = null,
  lastAutoResult,
  activeCollaborators = [],
  collaboratorPhase = "idle",
  onOpenCanvas,
  onPinModel,
  pinnedModelId,
}: ChatMessagesProps) {
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const topLoadSentinelRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const previousChatIdRef = useRef<string | undefined>(chatId);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [showStreamCursor, setShowStreamCursor] = useState(false);
  const [visibleStartIndex, setVisibleStartIndex] = useState(() => Math.max(0, messages.length - 36));
  const [activeSiblingByParent, setActiveSiblingByParent] = useState<Record<string, string>>({});
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    shouldAutoScrollRef.current = true;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const hasContent = messages.length > 0 || Boolean(draftResponse);
  const visibleMessages = useMemo(
    () => messages.slice(visibleStartIndex),
    [messages, visibleStartIndex],
  );
  const { siblingGroups, siblingGroupKeyByMessage, userSiblingGroupKeyByMessage } = useMemo(() => {
    const groups = new Map<string, Message[]>();
    const keyByMessage = new Map<string, string>();
    const userKeyByMessage = new Map<string, string>();
    let lastUserMessageId: string | undefined;

    for (const message of messages) {
      if (message.role === "user") {
        const userGroupRootId =
          message.parentMessageId
          ?? (typeof message.siblingCount === "number" && message.siblingCount > 1 ? message._id : undefined);
        if (userGroupRootId) {
          const groupKey = `user:${userGroupRootId}`;
          const list = groups.get(groupKey) ?? [];
          list.push(message);
          groups.set(groupKey, list);
          keyByMessage.set(message._id, groupKey);
          userKeyByMessage.set(message._id, groupKey);
        }
        lastUserMessageId = message._id;
        continue;
      }
      if (message.role !== "assistant") continue;

      const groupKey = message.parentMessageId
        ? `assistant-parent:${message.parentMessageId}`
        : (lastUserMessageId ? `assistant-implicit:${lastUserMessageId}` : undefined);
      if (!groupKey) continue;

      const list = groups.get(groupKey) ?? [];
      list.push(message);
      groups.set(groupKey, list);
      keyByMessage.set(message._id, groupKey);
    }

    for (const [groupKey, list] of groups.entries()) {
      const sorted = [...list].sort((a, b) => {
        const aIndex = typeof a.siblingIndex === "number" ? a.siblingIndex : Number.MAX_SAFE_INTEGER;
        const bIndex = typeof b.siblingIndex === "number" ? b.siblingIndex : Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return (a.createdAt ?? 0) - (b.createdAt ?? 0);
      });
      groups.set(groupKey, sorted);
    }

    return {
      siblingGroups: groups,
      siblingGroupKeyByMessage: keyByMessage,
      userSiblingGroupKeyByMessage: userKeyByMessage,
    };
  }, [messages]);
  const filteredVisibleMessages = useMemo(() => {
    return visibleMessages.filter((message) => {
      const groupKey = siblingGroupKeyByMessage.get(message._id);
      if (groupKey) {
        const siblings = siblingGroups.get(groupKey);
        if (siblings && siblings.length > 1) {
          const fallback = siblings[siblings.length - 1]?._id;
          const activeId = activeSiblingByParent[groupKey] ?? fallback;
          if (message._id !== activeId) return false;
        }
      }

      if (message.role === "assistant" && message.parentMessageId) {
        const parentUserGroupKey = userSiblingGroupKeyByMessage.get(message.parentMessageId);
        if (parentUserGroupKey) {
          const userSiblings = siblingGroups.get(parentUserGroupKey);
          if (userSiblings && userSiblings.length > 1) {
            const fallbackUserId = userSiblings[userSiblings.length - 1]?._id;
            const activeUserId = activeSiblingByParent[parentUserGroupKey] ?? fallbackUserId;
            if (activeUserId && message.parentMessageId !== activeUserId) {
              return false;
            }
          }
        }
      }

      return true;
    });
  }, [visibleMessages, siblingGroups, siblingGroupKeyByMessage, userSiblingGroupKeyByMessage, activeSiblingByParent]);

  useEffect(() => {
    setActiveSiblingByParent((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [groupKey, siblings] of siblingGroups.entries()) {
        if (siblings.length <= 1) continue;
        const existing = prev[groupKey];
        const activeStillExists = Boolean(existing && siblings.some((row) => row._id === existing));
        const fallback = siblings[siblings.length - 1]?._id;
        const selected = activeStillExists ? existing : fallback;
        if (selected) next[groupKey] = selected;
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) {
        changed = true;
      } else {
        for (const key of nextKeys) {
          if (prev[key] !== next[key]) {
            changed = true;
            break;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [siblingGroups]);

  const navigateSibling = useCallback((message: Message, direction: "prev" | "next") => {
    const groupKey = siblingGroupKeyByMessage.get(message._id);
    if (!groupKey) return;
    const siblings = siblingGroups.get(groupKey);
    if (!siblings || siblings.length <= 1) return;

    const fallback = siblings[siblings.length - 1]?._id;
    const currentId = activeSiblingByParent[groupKey] ?? fallback;
    const currentIndex = siblings.findIndex((row) => row._id === currentId);
    if (currentIndex < 0) return;
    const nextIndex =
      direction === "prev"
        ? Math.max(0, currentIndex - 1)
        : Math.min(siblings.length - 1, currentIndex + 1);
    const nextSibling = siblings[nextIndex];
    if (!nextSibling || nextSibling._id === currentId) return;

    setActiveSiblingByParent((prev) => ({
      ...prev,
      [groupKey]: nextSibling._id,
    }));
  }, [activeSiblingByParent, siblingGroups, siblingGroupKeyByMessage]);

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
    if (!shouldAutoScrollRef.current) return;
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: "auto" });
    });
  }, [draftResponse, messages.length]);

  useEffect(() => {
    const element = document.querySelector<HTMLElement>("[data-chat-scroll-root]");
    if (!element) return;
    scrollContainerRef.current = element;

    let rafId = 0;
    const onScroll = () => {
      rafId = requestAnimationFrame(() => {
        const scrollTop = element.scrollTop;
        const deltaFromBottom = element.scrollHeight - scrollTop - element.clientHeight;
        const deltaUp = lastScrollTopRef.current - scrollTop;
        const nearBottom = deltaFromBottom < 100;

        if (nearBottom) {
          shouldAutoScrollRef.current = true;
        } else if (deltaUp > 20) {
          shouldAutoScrollRef.current = false;
        }

        setShowJumpButton(deltaFromBottom > 120);
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
    shouldAutoScrollRef.current = true;
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

  useEffect(() => {
    const target = endRef.current;
    const root = scrollContainerRef.current;
    if (!target || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          shouldAutoScrollRef.current = true;
          setShowJumpButton(false);
        }
      },
      { root, rootMargin: "0px 0px 100px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

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
      return "Some models are temporarily unavailable right now.";
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
    if (/(budget|cost|pricing|spend|cheap-only|free_only)/.test(lower)) {
      return "Some models are temporarily unavailable right now.";
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
          preamble: stripQuizMarkers(content.slice(0, match.index)).trim(),
          structuredContent: content.slice(match.index).trim(),
        };
      }
    }
    if (contentMode === "flashcard") {
      const match = content.match(/(?:^|\n)\s*(?:Card\s*1|FRONT\s*:)/im);
      if (match?.index !== undefined && match.index > 0) {
        return {
          preamble: stripQuizMarkers(content.slice(0, match.index)).trim(),
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

  function getModeSuggestions(msg: Message): Array<{ mode: StudyMode; label: string; prompt: string }> {
    const suggestions = msg.routeTrace?.modeSuggestions;
    if (!Array.isArray(suggestions)) return [];
    return suggestions
      .map((row) => ({
        mode: row?.mode,
        label: row?.label,
        prompt: row?.prompt,
      }))
      .filter(
        (row): row is { mode: StudyMode; label: string; prompt: string } =>
          typeof row.mode === "string"
          && typeof row.label === "string"
          && row.label.trim().length > 0
          && typeof row.prompt === "string"
          && row.prompt.trim().length > 0,
      )
      .slice(0, 3);
  }

  function getClarificationBlock(msg: Message): ClarificationBlock | null {
    const block = (msg.routeTrace as { clarificationBlock?: unknown } | undefined)?.clarificationBlock;
    if (!block || typeof block !== "object") return null;
    const cast = block as ClarificationBlock;
    if (typeof cast.context !== "string" || !Array.isArray(cast.questions) || cast.questions.length === 0) {
      return null;
    }
    return cast;
  }

  const streamingStatus = (() => {
    switch (streamPhase) {
      case "compacting": return "Compacting context";
      case "routing": return "Selecting model";
      case "searching": return "Checking sources";
      case "thinking": return "Reasoning";
      case "synthesizing": return "Formatting result";
      case "generating": return "Generating response";
      default:
        if (collaboratorPhase === "synthesizing") return "Formatting result";
        if (lastAutoResult?.searchEnabled) return "Using search";
        if (activeCollaborators.length > 0) return "Running specialists";
        if (thinkingLevel !== "low") return "Reasoning";
        return "Generating response";
    }
  })();
  const streamingModelId = streamRouteTrace?.selected?.modelId ?? lastModelUsed;
  const activeProvider = streamingModelId?.split("/")[0] ?? "openrouter";
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

  const streamingOpenTag = sending ? detectOpenTag(visibleDraftResponse) : null;

  return (
    <section className="relative flex flex-1" aria-label="Conversation" data-conversation-export>
      <div
        className="w-full px-3 pb-32 pt-6 sm:px-6 md:pb-36 lg:px-10"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <div className="mx-auto w-full max-w-[680px] xl:max-w-[780px] 2xl:max-w-[860px] space-y-8">
          {!hasContent && emptyState}
          {searchStatusInfo ? (
            <div className={`rounded-xl border px-3 py-2 text-xs ${
              searchStatusInfo.status === "completed"
                ? "border-[color-mix(in_oklab,var(--success)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-[var(--success)]"
                : "border-[color-mix(in_oklab,var(--warning)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] text-[var(--warning)]"
            }`}>
              {searchStatusInfo.status === "completed"
                ? `Checked ${searchStatusInfo.sourceCount} web source${searchStatusInfo.sourceCount === 1 ? "" : "s"}.`
                : "Web search unavailable for this response."}
            </div>
          ) : searchStatusBanner === "model_knowledge" ? (
            <div className="rounded-xl border border-[color-mix(in_oklab,var(--warning)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] px-3 py-2 text-xs text-[var(--warning)]">
              Web search was unavailable for this response. The assistant used model knowledge instead.
            </div>
          ) : searchStatusBanner === "real_search" ? (
            <div className="rounded-xl border border-[color-mix(in_oklab,var(--success)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] px-3 py-2 text-xs text-[var(--success)]">
              Web search completed.
            </div>
          ) : searchStatusBanner === "error" ? (
            <div className="rounded-xl border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] px-3 py-2 text-xs text-[var(--danger)]">
              Web search failed.
            </div>
          ) : null}
          {proactiveBanner ? (
            <div className="flex items-center gap-3 rounded-lg border border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-primary))] px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-[var(--text-primary)]">
                  <span className="font-medium">{proactiveBanner.title}</span>
                  {" — "}
                  <span className="text-[var(--text-secondary)]">{proactiveBanner.body}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={onDismissProactiveBanner}
                  className="text-[10px] text-[var(--text-tertiary)] transition hover:text-[var(--text-secondary)]"
                >
                  Dismiss
                </button>
                <span className="text-[var(--border-default)]">·</span>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      localStorage.setItem("ai-school:flashcard-reminder-disabled", "1");
                    } catch {}
                    onDismissProactiveBanner?.();
                  }}
                  className="text-[10px] text-[var(--text-tertiary)] transition hover:text-[var(--text-secondary)]"
                >
                  Don&apos;t show again
                </button>
                <button
                  type="button"
                  onClick={onApplyProactiveBanner}
                  className="ml-1 rounded-md border border-[color-mix(in_oklab,var(--accent-cyan)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,var(--bg-primary))] px-2 py-0.5 text-[10px] font-medium text-[var(--text-primary)] transition hover:bg-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--bg-primary))]"
                >
                  {proactiveBanner.actionLabel}
                </button>
              </div>
            </div>
          ) : null}

          {visibleStartIndex > 0 ? (
            <div
              ref={topLoadSentinelRef}
              className="mb-4 text-center text-[11px] text-[var(--text-tertiary)]"
              aria-label="Load older messages"
            >
              {visibleStartIndex} older messages · scroll up to load
            </div>
          ) : null}

          {filteredVisibleMessages.map((msg, index) => {
            const isLastAssistant = msg.role === "assistant" && index === filteredVisibleMessages.length - 1;
            const msgMode = msg.mode ?? mode;
            const prevMsg = filteredVisibleMessages[index - 1];
            const showModeTransition =
              index > 0 &&
              prevMsg?.mode !== msg.mode &&
              msg.mode !== undefined;
            const siblingGroupKey = siblingGroupKeyByMessage.get(msg._id);
            const siblingGroup = siblingGroupKey ? siblingGroups.get(siblingGroupKey) : undefined;
            const fallbackSiblingIndex =
              siblingGroup && siblingGroup.length > 1
                ? siblingGroup.findIndex((row) => row._id === msg._id)
                : -1;
            const siblingNavigationProps =
              siblingGroup && siblingGroup.length > 1
                ? {
                    siblingIndex:
                      typeof msg.siblingIndex === "number"
                        ? msg.siblingIndex
                        : (fallbackSiblingIndex >= 0 ? fallbackSiblingIndex : undefined),
                    siblingCount:
                      typeof msg.siblingCount === "number"
                        ? msg.siblingCount
                        : siblingGroup.length,
                    onNavigateSibling: (direction: "prev" | "next") => navigateSibling(msg, direction),
                  }
                : {};
            const assistantIsBookmarked = bookmarkedMessageIds.has(msg._id);
            const assistantBookmarking = bookmarkingMessageId === msg._id;
            const modeSuggestions = msg.role === "assistant" ? getModeSuggestions(msg) : [];
            const clarificationBlock = msg.role === "assistant" ? getClarificationBlock(msg) : null;
            const quizDifficulty = inferQuizDifficulty(msg.routeTrace?.toolchain);

            if (msg.role === "assistant" && clarificationBlock) {
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
                    {...siblingNavigationProps}
                    messageId={msg._id}
                    role={msg.role}
                    cancelled={msg.cancelled}
                    content=""
                    thinkingContent={msg.thinkingContent}
                    enhancedContent={msg.enhancedContent}
                    attachments={msg.attachments}
                    attachmentResourceIds={msg.attachmentResourceIds}
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
                    onSaveAsArtifact={onSaveAsArtifact ? () => onSaveAsArtifact(msg._id, msg.content) : undefined}
                    isArtifactSaved={artifactSavedMessageIds.has(msg._id)}
                    isBookmarked={assistantIsBookmarked}
                    bookmarking={assistantBookmarking}
                    usageIn={msg.usageIn}
                    usageOut={msg.usageOut}
                    createdAt={msg.createdAt}
                    onFeedback={onAssistantFeedback}
                    onOpenCanvas={onOpenCanvas}
                    memoryUpdated={msg.memoryUpdated}
                    memoryUpdateSummary={msg.memoryUpdateSummary}
                    onPinModel={onPinModel}
                    isPinned={Boolean(pinnedModelId && msg.modelUsed === pinnedModelId)}
                  >
                    <ClarificationCard
                      block={clarificationBlock}
                      disabled={sending}
                      onSubmit={(answerMessage) => {
                        onFollowUp?.(answerMessage);
                      }}
                    />
                  </ChatMessage>
                </div>
              );
            }

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
                      {...siblingNavigationProps}
                      messageId={msg._id}
                      role={msg.role}
                      cancelled={msg.cancelled}
                      content=""
                      thinkingContent={msg.thinkingContent}
                      enhancedContent={msg.enhancedContent}
                      attachments={msg.attachments}
                      attachmentResourceIds={msg.attachmentResourceIds}
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
                      memoryUpdated={msg.memoryUpdated}
                      memoryUpdateSummary={msg.memoryUpdateSummary}
                      onPinModel={onPinModel}
                      isPinned={Boolean(pinnedModelId && msg.modelUsed === pinnedModelId)}
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
                      {...siblingNavigationProps}
                      messageId={msg._id}
                      role={msg.role}
                      cancelled={msg.cancelled}
                      content={stripQuizMarkers(msg.content)}
                      thinkingContent={msg.thinkingContent}
                      enhancedContent={msg.enhancedContent}
                      attachments={msg.attachments}
                      attachmentResourceIds={msg.attachmentResourceIds}
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
                      memoryUpdated={msg.memoryUpdated}
                      memoryUpdateSummary={msg.memoryUpdateSummary}
                      onPinModel={onPinModel}
                      isPinned={Boolean(pinnedModelId && msg.modelUsed === pinnedModelId)}
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
                    {...siblingNavigationProps}
                    messageId={msg._id}
                    role={msg.role}
                    cancelled={msg.cancelled}
                    content={stripQuizMarkers(msg.content)}
                    thinkingContent={msg.thinkingContent}
                    enhancedContent={msg.enhancedContent}
                    attachments={msg.attachments}
                    attachmentResourceIds={msg.attachmentResourceIds}
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
                    onSaveAsArtifact={onSaveAsArtifact ? () => onSaveAsArtifact(msg._id, msg.content) : undefined}
                    isArtifactSaved={artifactSavedMessageIds.has(msg._id)}
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
                    memoryUpdated={msg.memoryUpdated}
                    memoryUpdateSummary={msg.memoryUpdateSummary}
                    onPinModel={onPinModel}
                    isPinned={Boolean(pinnedModelId && msg.modelUsed === pinnedModelId)}
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
                      {...siblingNavigationProps}
                      messageId={msg._id}
                      role={msg.role}
                      cancelled={msg.cancelled}
                      content=""
                      thinkingContent={msg.thinkingContent}
                      enhancedContent={msg.enhancedContent}
                      attachments={msg.attachments}
                      attachmentResourceIds={msg.attachmentResourceIds}
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
                      memoryUpdated={msg.memoryUpdated}
                      memoryUpdateSummary={msg.memoryUpdateSummary}
                      onPinModel={onPinModel}
                      isPinned={Boolean(pinnedModelId && msg.modelUsed === pinnedModelId)}
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
                        onEditCard={(payload) => {
                          onEditFlashcardCard?.({
                            messageId: msg._id,
                            cardHash: payload.cardHash,
                            front: payload.front,
                            back: payload.back,
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
                    {...siblingNavigationProps}
                    messageId={msg._id}
                    role={msg.role}
                    cancelled={msg.cancelled}
                    content={stripQuizMarkers(msg.content)}
                    thinkingContent={msg.thinkingContent}
                    enhancedContent={msg.enhancedContent}
                    attachments={msg.attachments}
                    attachmentResourceIds={msg.attachmentResourceIds}
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
                    onSaveAsArtifact={onSaveAsArtifact ? () => onSaveAsArtifact(msg._id, msg.content) : undefined}
                    isArtifactSaved={artifactSavedMessageIds.has(msg._id)}
                    isBookmarked={assistantIsBookmarked}
                    bookmarking={assistantBookmarking}
                    usageIn={msg.usageIn}
                    usageOut={msg.usageOut}
                    createdAt={msg.createdAt}
                    onFeedback={onAssistantFeedback}
                    onOpenCanvas={onOpenCanvas}
                    memoryUpdated={msg.memoryUpdated}
                    memoryUpdateSummary={msg.memoryUpdateSummary}
                    onPinModel={onPinModel}
                    isPinned={Boolean(pinnedModelId && msg.modelUsed === pinnedModelId)}
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
                    {...siblingNavigationProps}
                    messageId={msg._id}
                    role={msg.role}
                    cancelled={msg.cancelled}
                    content=""
                    thinkingContent={msg.thinkingContent}
                    enhancedContent={msg.enhancedContent}
                    attachments={msg.attachments}
                    attachmentResourceIds={msg.attachmentResourceIds}
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
                    onSaveAsArtifact={onSaveAsArtifact ? () => onSaveAsArtifact(msg._id, msg.content) : undefined}
                    isArtifactSaved={artifactSavedMessageIds.has(msg._id)}
                    isBookmarked={assistantIsBookmarked}
                    bookmarking={assistantBookmarking}
                    usageIn={msg.usageIn}
                    usageOut={msg.usageOut}
                    createdAt={msg.createdAt}
                    onFeedback={onAssistantFeedback}
                    onOpenCanvas={onOpenCanvas}
                    memoryUpdated={msg.memoryUpdated}
                    memoryUpdateSummary={msg.memoryUpdateSummary}
                    onPinModel={onPinModel}
                    isPinned={Boolean(pinnedModelId && msg.modelUsed === pinnedModelId)}
                  >
                    {parsed.preamble ? <MarkdownRenderer content={parsed.preamble} citations={[]} /> : null}
                    <DocumentPanel content={msg.content} />
                  </ChatMessage>
                </div>
              );
            }

            // Last-resort tag detection: if the content has closed tags regardless of mode,
            // strip the markers and pass cleaned content. This prevents raw <<TAG>> text from showing.
            const closedTagType = msg.role === "assistant" ? hasClosedTag(msg.content) : null;
            const cleanedContent = closedTagType
              ? stripQuizMarkers(msg.content)
              : msg.content;

            // Force quiz rendering if content has closed quiz tags and parser finds valid content
            if (closedTagType === "quiz" && msg.role === "assistant" && isQuizContent(msg.content)) {
              const { preamble, structuredContent } = splitMixedContent(msg.content, "quiz");
              return (
                <div key={msg._id}>
                  <ChatMessage
                    {...siblingNavigationProps}
                    messageId={msg._id}
                    role={msg.role}
                    cancelled={msg.cancelled}
                    content=""
                    thinkingContent={msg.thinkingContent}
                    enhancedContent={msg.enhancedContent}
                    modelUsed={msg.modelUsed}
                    routeTrace={msg.routeTrace}
                    citations={msg.citations}
                    mode={msgMode}
                    isLastAssistant={isLastAssistant}
                    onRegenerate={isLastAssistant ? onRegenerate : undefined}
                    onRegenerateWithModel={isLastAssistant ? onRegenerateWithModel : undefined}
                    regenModels={regenModels}
                    onBranch={onBranchMessage ? () => void onBranchMessage(msg._id) : undefined}
                    onToggleBookmark={onToggleBookmarkMessage ? () => void onToggleBookmarkMessage(msg._id) : undefined}
                    onSaveAsArtifact={onSaveAsArtifact ? () => onSaveAsArtifact(msg._id, msg.content) : undefined}
                    isArtifactSaved={artifactSavedMessageIds.has(msg._id)}
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
                    onPinModel={onPinModel}
                    isPinned={Boolean(pinnedModelId && msg.modelUsed === pinnedModelId)}
                  >
                    {preamble ? <MarkdownRenderer content={preamble} citations={[]} /> : null}
                    <QuizReveal
                      content={structuredContent}
                      onFollowUp={(answerMessage) => {
                        onFollowUp?.(answerMessage);
                      }}
                    />
                  </ChatMessage>
                </div>
              );
            }

            // Force flashcard rendering
            if (closedTagType === "flashcard" && msg.role === "assistant" && isFlashcardContent(msg.content)) {
              const { preamble, structuredContent } = splitMixedContent(msg.content, "flashcard");
              return (
                <div key={msg._id}>
                  <ChatMessage
                    {...siblingNavigationProps}
                    messageId={msg._id}
                    role={msg.role}
                    cancelled={msg.cancelled}
                    content=""
                    thinkingContent={msg.thinkingContent}
                    enhancedContent={msg.enhancedContent}
                    modelUsed={msg.modelUsed}
                    routeTrace={msg.routeTrace}
                    citations={msg.citations}
                    mode={msgMode}
                    isLastAssistant={isLastAssistant}
                    onRegenerate={isLastAssistant ? onRegenerate : undefined}
                    onRegenerateWithModel={isLastAssistant ? onRegenerateWithModel : undefined}
                    regenModels={regenModels}
                    onBranch={onBranchMessage ? () => void onBranchMessage(msg._id) : undefined}
                    onToggleBookmark={onToggleBookmarkMessage ? () => void onToggleBookmarkMessage(msg._id) : undefined}
                    onSaveAsArtifact={onSaveAsArtifact ? () => onSaveAsArtifact(msg._id, msg.content) : undefined}
                    isArtifactSaved={artifactSavedMessageIds.has(msg._id)}
                    isBookmarked={assistantIsBookmarked}
                    bookmarking={assistantBookmarking}
                    usageIn={msg.usageIn}
                    usageOut={msg.usageOut}
                    createdAt={msg.createdAt}
                    onFeedback={onAssistantFeedback}
                    onOpenCanvas={onOpenCanvas}
                    onPinModel={onPinModel}
                    isPinned={Boolean(pinnedModelId && msg.modelUsed === pinnedModelId)}
                  >
                    {preamble ? <MarkdownRenderer content={preamble} citations={[]} /> : null}
                    <FlashcardReveal
                      content={structuredContent}
                      onSaveDeck={(payload) => {
                        onSaveFlashcardDeck?.({
                          messageId: msg._id,
                          title: payload.title,
                          cards: payload.cards,
                        });
                      }}
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
                  {...siblingNavigationProps}
                  messageId={msg._id}
                  role={msg.role}
                  cancelled={msg.cancelled}
                  content={cleanedContent}
                  thinkingContent={msg.thinkingContent}
                  enhancedContent={msg.enhancedContent}
                  attachments={msg.attachments}
                  attachmentResourceIds={msg.attachmentResourceIds}
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
                  onEdit={msg.role === "user" && onEditMessage ? (value) => onEditMessage(msg._id, value) : undefined}
                  onBranch={msg.role === "assistant" && onBranchMessage ? () => void onBranchMessage(msg._id) : undefined}
                  onToggleBookmark={msg.role === "assistant" && onToggleBookmarkMessage ? () => void onToggleBookmarkMessage(msg._id) : undefined}
                  onSaveAsArtifact={msg.role === "assistant" && onSaveAsArtifact ? () => onSaveAsArtifact(msg._id, msg.content) : undefined}
                  isArtifactSaved={msg.role === "assistant" ? artifactSavedMessageIds.has(msg._id) : undefined}
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
                  memoryUpdated={msg.role === "assistant" ? msg.memoryUpdated : undefined}
                  memoryUpdateSummary={msg.role === "assistant" ? msg.memoryUpdateSummary : undefined}
                  onPinModel={msg.role === "assistant" ? onPinModel : undefined}
                  isPinned={msg.role === "assistant" ? Boolean(pinnedModelId && msg.modelUsed === pinnedModelId) : undefined}
                />
                {msg.role === "assistant" && modeSuggestions.length > 0 ? (
                  <div className="mt-2 ml-14 flex flex-wrap gap-2">
                    {modeSuggestions.map((suggestion, suggestionIndex) => (
                      <button
                        key={`${msg._id}-mode-suggestion-${suggestionIndex}`}
                        type="button"
                        onClick={() => {
                          onModeChange?.(suggestion.mode);
                          onFollowUp?.(suggestion.prompt, suggestion.mode);
                        }}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                      >
                        {suggestion.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          {visibleDraftResponse && (mode === "quiz" || mode === "exam" || mode === "flashcard" || mode === "document") ? (
            <article className="chat-fade-in flex justify-start">
              <div className="w-full max-w-5xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3">
                <div className="mb-3 inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <ProviderLogo provider={activeProvider} modelId={streamingModelId} size={12} className="h-5 w-5 rounded-md" />
                  <span>{modelLabel(streamingModelId)} · {streamingStatus}</span>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-[var(--text-secondary)]">
                    {mode === "flashcard"
                      ? "Preparing flashcard view. Cards will appear only after the full structured result is ready."
                      : mode === "document"
                        ? "Generating document. It will render once the structured content is complete."
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
            <article className="chat-fade-in flex justify-start" aria-label="Assistant response">
              <div className="w-full max-w-5xl xl:max-w-6xl">
                <div className="message-journal flex min-w-0 items-start gap-3 px-1 py-4">
                  <ProviderLogo
                    provider={activeProvider}
                    modelId={streamingModelId}
                    className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                      <span>{modelLabel(streamingModelId)}</span>
                      <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
                      <span className="thinking-wave">{streamingStatus}</span>
                    </div>
                    {hasRealThinking && draftThinking ? (
                      <ThinkingBlock content={draftThinking} streaming={streamPhase === "thinking"} />
                    ) : null}
                    {streamingOpenTag ? (() => {
                      const tagPattern = /<<(?:quiz|flashcard|flashcards|document|doc)_?start>>/i;
                      const match = visibleDraftResponse.match(tagPattern);
                      const preamble = match?.index ? visibleDraftResponse.slice(0, match.index).trim() : "";
                      return (
                        <>
                          {preamble ? renderDraftMarkdown(preamble) : null}
                          <TagSkeleton type={streamingOpenTag} />
                        </>
                      );
                    })() : renderDraftMarkdown(visibleDraftResponse)}
                    {showStreamCursor ? (
                      <span className={`stream-cursor ${sending ? "" : "stream-cursor--fade"}`} aria-hidden>
                        |
                      </span>
                    ) : null}
                    <div className="mt-5 flex flex-wrap items-center gap-1.5 opacity-40">
                      <span className="h-7 w-14 animate-pulse rounded bg-[var(--bg-secondary)]" />
                      <span className="h-7 w-20 animate-pulse rounded bg-[var(--bg-secondary)]" />
                    </div>
                  </div>
                </div>
              </div>
            </article>
          ) : null}

          {sending && !visibleDraftResponse && (
            <article className="chat-fade-in flex justify-start" aria-label="Assistant thinking">
              <div className="w-full max-w-5xl xl:max-w-6xl">
                <div className="message-journal flex min-w-0 items-start gap-3 px-1 py-4">
                  <ProviderLogo
                    provider={activeProvider}
                    modelId={streamingModelId}
                    className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                      <span>{modelLabel(streamingModelId)}</span>
                      <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
                      <span className="thinking-wave">{streamingStatus}</span>
                    </div>
                    {hasRealThinking && draftThinking ? (
                      <ThinkingBlock content={draftThinking} streaming={streamPhase === "thinking"} />
                    ) : null}
                    {!hasRealThinking && activeCollaborators.length === 0 ? (
                      <div className="space-y-2">
                        <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--bg-secondary)]" />
                        <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--bg-secondary)]" />
                        <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--bg-secondary)]" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
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

      <button
        type="button"
        onClick={scrollToBottom}
        className={`absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-secondary)] shadow-md transition-all duration-300 ease-[var(--ease-standard)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ${showJumpButton ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none"}`}
        aria-label="Scroll to bottom"
      >
        <ArrowDown size={14} />
        <span>New messages</span>
      </button>
    </section>
  );
}
