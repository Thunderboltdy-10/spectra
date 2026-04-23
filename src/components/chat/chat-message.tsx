"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Bookmark, BookmarkCheck, Bot, Brain, ChevronDown, ChevronLeft, ChevronRight, Copy, FileText, GitBranch, Globe, Info, MoreHorizontal, Paperclip, Pencil, RefreshCw, ThumbsDown, ThumbsUp, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { ProviderLogo } from "@/components/provider-logo";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { ExecutionTimeline } from "@/components/shared/execution-timeline";
import { CollaboratorsBadge } from "@/components/chat/collaborators-badge";
import { type QuizSubmitResult } from "@/components/chat/quiz-reveal";
import { usePanel } from "@/context/panel-context";
import type { Citation, RouteTrace, StudyMode } from "@/types";
import { DocumentPanel } from "@/components/chat/document-panel";
import { parseGeneratedDocument } from "@/lib/document-generator";
import { cn } from "@/lib/utils";
import { useTextToSpeech } from "@/hooks/use-text-to-speech";

type ChatMessageProps = {
  messageId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  cancelled?: boolean;
  thinkingContent?: string;
  thinkingSegments?: Array<{ id: string; label: string; content: string; status: string }>;
  enhancedContent?: string;
  attachments?: string[];
  attachmentResourceIds?: string[];
  attachmentPreviews?: Array<{
    name: string;
    mimeType?: string;
    isImage?: boolean;
    thumbnailUrl?: string;
  }>;
  modelUsed?: string;
  whyThisResponse?: string;
  routeTrace?: RouteTrace;
  citations?: Citation[];
  mode?: StudyMode;
  isLastAssistant?: boolean;
  onRegenerate?: () => void;
  onRegenerateWithModel?: (modelId: string) => void;
  regenModels?: Array<{ modelId: string; name: string }>;
  onEdit?: (newContent: string) => void | Promise<void>;
  onFeedback?: (messageId: string, positive: boolean, modelId?: string) => void;
  usageIn?: number;
  usageOut?: number;
  createdAt?: number;
  onOpenCanvas?: (params: { code: string; language: string }) => void;
  onSubmitQuizAnswers?: (result: QuizSubmitResult) => void;
  onBranch?: () => void;
  onToggleBookmark?: () => void;
  isBookmarked?: boolean;
  bookmarking?: boolean;
  onSaveAsArtifact?: () => void;
  isArtifactSaved?: boolean;
  onPinModel?: (modelId: string) => void;
  isPinned?: boolean;
  siblingIndex?: number;
  siblingCount?: number;
  onNavigateSibling?: (direction: "prev" | "next") => void;
  preferRouteTraceModel?: boolean;
  animateIn?: boolean;
  memoryUpdated?: boolean;
  memoryUpdateSummary?: string;
  children?: React.ReactNode;
};

function sanitizeNavigationHref(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function SourceBlock({ citations, onOpen }: { citations: Citation[]; onOpen: () => void }) {
  const [expanded, setExpanded] = useState(false);
  if (citations.length === 0) return null;
  const grouped = [
    {
      id: "web",
      label: "Web Sources",
      Icon: Globe,
      items: citations.filter((citation) => citation.sourceType === "search"),
    },
    {
      id: "files",
      label: "From Your Files",
      Icon: FileText,
      items: citations.filter(
        (citation) => citation.sourceType === "pack" || citation.sourceType === "personal" || citation.sourceType === "general",
      ),
    },
    {
      id: "agent",
      label: "From Agent Resources",
      Icon: Bot,
      items: citations.filter((citation) => citation.sourceType === "agent"),
    },
  ].filter((group) => group.items.length > 0);

  const reliabilityTone = (label: Citation["reliabilityLabel"]) => {
    if (label === "high") {
      return "border-[color-mix(in_oklab,var(--success)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-[var(--success)]";
    }
    if (label === "low") {
      return "border-[color-mix(in_oklab,var(--warning)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] text-[var(--warning)]";
    }
    return "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]";
  };

  return (
    <section className="mt-6 border-t border-[var(--border-default)] pt-3">
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex cursor-pointer items-center gap-2 text-left"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              Sources
            </span>
            <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
              {citations.length}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 text-[var(--text-secondary)] transition ${expanded ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="cursor-pointer rounded-md border border-[var(--border-default)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
          >
            Full panel
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {grouped.map((group) => (
            <span
              key={group.id}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
            >
              <group.Icon className="h-3 w-3" />
              {group.label} {group.items.length}
            </span>
          ))}
        </div>
        {expanded ? (
          <div className="mt-3 space-y-3">
            {grouped.map((group) => (
              <div key={group.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5">
                <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                  <group.Icon className="h-3.5 w-3.5" />
                  {group.label}
                </p>
                <div className="space-y-2">
                  {group.items.map((citation, index) => {
                    const href = sanitizeNavigationHref(
                      citation.url ?? (citation.resourceId ? `/api/resources/${citation.resourceId}/download` : undefined),
                    );
                    const title = citation.title || citation.filename || citation.domain || citation.url || "Source";
                    const subtitle = citation.domain || citation.filename;
                    return (
                      <article key={`${group.id}:${citation.url ?? citation.resourceId ?? citation.filename}:${index}`} className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-[var(--text-primary)]">{title}</p>
                            <p className="truncate text-[10px] text-[var(--text-secondary)]">{subtitle}</p>
                          </div>
                          <a
                            href={href ?? "#"}
                            onClick={(event) => {
                              if (!href) {
                                event.preventDefault();
                                onOpen();
                              }
                            }}
                            target={href ? "_blank" : undefined}
                            rel={href ? "noreferrer" : undefined}
                            className="shrink-0 rounded-md border border-[var(--border-default)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
                          >
                            {citation.url ? "Open" : "View"}
                          </a>
                        </div>
                        {citation.snippet ? (
                          <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">{citation.snippet}</p>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {typeof citation.relevanceScore === "number" ? (
                            <span className="inline-flex rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                              Relevance {citation.relevanceScore.toFixed(2)}
                            </span>
                          ) : null}
                          {citation.reliabilityLabel ? (
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] capitalize ${reliabilityTone(citation.reliabilityLabel)}`}>
                              {citation.reliabilityLabel} reliability
                            </span>
                          ) : null}
                          {Array.isArray(citation.inlinePositions) && citation.inlinePositions.length > 0 ? (
                            <span className="inline-flex rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                              Inline ×{citation.inlinePositions.length}
                            </span>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ChatMessage({
  messageId,
  role,
  content,
  cancelled = false,
  thinkingContent,
  thinkingSegments,
  enhancedContent,
  attachments,
  attachmentResourceIds,
  attachmentPreviews,
  modelUsed,
  whyThisResponse,
  routeTrace,
  citations = [],
  mode,
  isLastAssistant = false,
  onRegenerate,
  onRegenerateWithModel,
  regenModels = [],
  onEdit,
  onFeedback,
  usageIn,
  usageOut,
  createdAt,
  onOpenCanvas,
  onSubmitQuizAnswers,
  onBranch,
  onToggleBookmark,
  isBookmarked = false,
  bookmarking = false,
  onSaveAsArtifact,
  isArtifactSaved = false,
  onPinModel,
  isPinned,
  siblingIndex,
  siblingCount,
  onNavigateSibling,
  preferRouteTraceModel = false,
  animateIn = true,
  memoryUpdated = false,
  memoryUpdateSummary,
  children,
}: ChatMessageProps) {
  const isUser = role === "user";
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [showEnhanced, setShowEnhanced] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [showRelatedMemory, setShowRelatedMemory] = useState(false);
  const { openPanel } = usePanel();
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(content);
  const [editPending, setEditPending] = useState(false);
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const tts = useTextToSpeech();
  const validCitations = citations.filter((c) => c.url || c.resourceId || c.filename);
  const activeModelId = preferRouteTraceModel
    ? routeTrace?.selected?.modelId ?? modelUsed
    : modelUsed ?? routeTrace?.selected?.modelId;
  const activeProvider = activeModelId?.split("/")[0] ?? "openrouter";
  const renderedContent = content;
  const parsedDocument = useMemo(() => parseGeneratedDocument(renderedContent), [renderedContent]);
  const subcallInputTokens = routeTrace?.subcalls?.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0) ?? 0;
  const subcallOutputTokens = routeTrace?.subcalls?.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0) ?? 0;
  const hasSubcallTotals = subcallInputTokens + subcallOutputTokens > 0;
  const displayInputTokens = hasSubcallTotals ? subcallInputTokens : (usageIn ?? 0);
  const displayOutputTokens = hasSubcallTotals ? subcallOutputTokens : (usageOut ?? 0);
  const timeLabel = useMemo(() => formatRelativeTime(createdAt), [createdAt]);
  const hasEnhanced = Boolean(enhancedContent && enhancedContent.trim());
  const displayedContent = pendingContent ?? content;
  const displayUserContent = isUser && showEnhanced && hasEnhanced ? enhancedContent ?? displayedContent : displayedContent;
  const hasSiblingVersions =
    typeof siblingCount === "number" && siblingCount > 1 && typeof siblingIndex === "number";
  const siblingIndexValue = typeof siblingIndex === "number" ? siblingIndex : 0;
  const siblingCountValue = typeof siblingCount === "number" ? siblingCount : 1;
  const assistantAttachmentLinks = !isUser && attachments?.length
    ? attachments.map((name, index) => ({
        name,
        href: attachmentResourceIds?.[index] ? `/api/resources/${attachmentResourceIds[index]}/download` : undefined,
      }))
    : [];

  const sanitizeModelLabel = (value: string) =>
    value
      .replace(/:free$/i, "")
      .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

  function handleCopy() {
    void navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  }

  async function handleSaveEdit() {
    const clean = editedContent.trim();
    if (!clean || clean === content.trim()) {
      setEditing(false);
      return;
    }
    if (!onEdit) {
      setEditing(false);
      return;
    }
    setPendingContent(clean);
    setEditPending(true);
    setEditing(false);
    try {
      await onEdit(clean);
    } catch {
      // Revert: restore editing state with original content
      setPendingContent(null);
      setEditedContent(content);
      setEditing(true);
    } finally {
      setEditPending(false);
      setPendingContent(null);
    }
  }

  return (
    <article
      className={cn("flex", animateIn && "chat-fade-in", isUser ? "justify-end" : "justify-start")}
      aria-label={isUser ? "Your message" : "Assistant response"}
    >
      <div className={cn("w-full", isUser ? "w-fit max-w-[60%]" : "max-w-5xl xl:max-w-6xl")}>
        {isUser ? (
          <div className={cn("ml-auto rounded-2xl border border-[var(--border-default)] bg-[var(--bg-user-bubble)] px-4 py-3 shadow-sm", editing && "min-w-[min(600px,90vw)]")}>
            {editing ? (
              <div className="space-y-2">
                <textarea
                  value={editedContent}
                  onChange={(event) => setEditedContent(event.target.value)}
                  className="min-h-[96px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-[var(--accent-cyan)]/35"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" onClick={() => void handleSaveEdit()}>
                    Save
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className={editPending ? "opacity-60" : undefined}>
                <MarkdownRenderer content={displayUserContent} userMessage />
              </div>
            )}
            {attachmentPreviews && attachmentPreviews.length > 0 ? (
              <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {attachmentPreviews.map((attachment, index) => {
                  const extension = attachment.name.split(".").pop()?.toUpperCase().slice(0, 5) || "FILE";
                  if (attachment.isImage && attachment.thumbnailUrl) {
                    return (
                      <div
                        key={`${attachment.name}-${index}`}
                        className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]"
                      >
                        <div
                          className="flex h-40 w-full items-center justify-center bg-[var(--bg-secondary)]"
                        >
                          <Image
                            src={attachment.thumbnailUrl}
                            alt={attachment.name}
                            width={300}
                            height={220}
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <p className="truncate px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)]">{attachment.name}</p>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={`${attachment.name}-${index}`}
                      className="flex min-h-[4.75rem] items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5"
                    >
                      <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-1 text-[9px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        <FileText className="mr-1 h-3 w-3" />
                        {extension}
                      </span>
                      <p className="line-clamp-2 text-[12px] text-[var(--text-secondary)]">{attachment.name}</p>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {!editing ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                {onEdit ? (
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setEditing(true)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                ) : null}
                {onBranch ? (
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={onBranch}>
                    <GitBranch className="h-3.5 w-3.5" />
                    Branch
                  </Button>
                ) : null}
                {hasEnhanced ? (
                  <button
                    type="button"
                    onClick={() => setShowEnhanced((prev) => !prev)}
                    className="cursor-pointer rounded-md border border-[var(--border-default)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
                  >
                    {showEnhanced ? "Show original" : "Show enhanced"}
                  </button>
                ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {hasSiblingVersions ? (
                    <span className="inline-flex items-center gap-0.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1 text-[10px] text-[var(--text-secondary)]">
                      <button
                        type="button"
                        disabled={siblingIndexValue <= 0}
                        onClick={() => onNavigateSibling?.("prev")}
                        className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded transition hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-30"
                        aria-label="Previous version"
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                      <span className="tabular-nums">{siblingIndexValue + 1}/{siblingCountValue}</span>
                      <button
                        type="button"
                        disabled={siblingIndexValue >= siblingCountValue - 1}
                        onClick={() => onNavigateSibling?.("next")}
                        className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded transition hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-30"
                        aria-label="Next version"
                      >
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </span>
                  ) : null}
                  {timeLabel ? <span className="text-[11px] text-[var(--text-secondary)]">{timeLabel}</span> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="message-journal flex min-w-0 items-start gap-3 px-1 py-4">
            <ProviderLogo
              provider={activeProvider}
              modelId={activeModelId}
              className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]"
            />
            <div className="min-w-0 flex-1">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                
                {cancelled ? (
                  <span className="inline-flex items-center rounded-full border border-[color-mix(in_oklab,var(--warning)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_12%,var(--bg-secondary))] px-2 py-0.5 text-[10px] text-[var(--warning)]">
                    Cancelled
                  </span>
                ) : null}
                {hasSiblingVersions ? (
                  <span className="inline-flex items-center gap-0.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1 text-[10px] text-[var(--text-secondary)]">
                    <button
                        type="button"
                      disabled={siblingIndexValue <= 0}
                      onClick={() => onNavigateSibling?.("prev")}
                      className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded transition hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-30"
                      aria-label="Previous version"
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <span className="tabular-nums">{siblingIndexValue + 1}/{siblingCountValue}</span>
                    <button
                      type="button"
                      disabled={siblingIndexValue >= siblingCountValue - 1}
                      onClick={() => onNavigateSibling?.("next")}
                      className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded transition hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-30"
                      aria-label="Next version"
                    >
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </span>
                ) : null}
              </div>

              

              <ThinkingBlock
                content={thinkingContent ?? ""}
                segments={thinkingSegments}
                routeTrace={routeTrace}
                streaming={!isLastAssistant ? false : !content && !!thinkingContent}
              />
              {children ? children : parsedDocument.document ? (
                <>
                  {parsedDocument.preamble ? (
                  <MarkdownRenderer
                      content={parsedDocument.preamble}
                      citations={citations}
                      mode={mode}
                      onOpenCanvas={onOpenCanvas}
                      onCitationClick={() => openPanel("sources", { sources: validCitations })}
                      onSubmitQuizAnswers={onSubmitQuizAnswers}
                    />
                  ) : null}
                  <DocumentPanel content={renderedContent} />
                </>
              ) : (
                <MarkdownRenderer
                  content={renderedContent}
                  citations={citations}
                  mode={mode}
                  onOpenCanvas={onOpenCanvas}
                  onCitationClick={() => openPanel("sources", { sources: validCitations })}
                  onSubmitQuizAnswers={onSubmitQuizAnswers}
                />
              )}
              <CollaboratorsBadge collaborators={routeTrace?.collaborators} />
              {assistantAttachmentLinks.length > 0 ? (
                <section className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                  <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                    Downloads
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {assistantAttachmentLinks.map((attachment) => (
                      attachment.href ? (
                        <a
                          key={`${attachment.name}-${attachment.href}`}
                          href={attachment.href}
                          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          {attachment.name}
                        </a>
                      ) : (
                        <span
                          key={attachment.name}
                          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          {attachment.name}
                        </span>
                      )
                    ))}
                  </div>
                </section>
              ) : null}
              {validCitations.length > 0 && <SourceBlock citations={validCitations} onOpen={() => openPanel("sources", { sources: validCitations })} />}

              <div className="mt-5 flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 cursor-pointer gap-1.5 text-xs"
                  onClick={handleCopy}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>

                {isLastAssistant && onRegenerate ? (
                  onRegenerateWithModel && regenModels.length > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="sm" className="h-8 cursor-pointer gap-1.5 text-xs">
                          <RefreshCw className="h-3.5 w-3.5" />
                          Retry model
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                        <DropdownMenuItem onSelect={() => onRegenerate()}>
                          Use current route
                        </DropdownMenuItem>
                        {regenModels.map((model) => (
                          <DropdownMenuItem
                            key={model.modelId}
                            onSelect={() => onRegenerateWithModel(model.modelId)}
                          >
                            {sanitizeModelLabel(model.name)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onRegenerate}
                      className="h-8 cursor-pointer gap-1.5 text-xs"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Regenerate
                    </Button>
                  )
                ) : null}

                {onToggleBookmark ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 cursor-pointer gap-1.5 text-xs"
                    onClick={onToggleBookmark}
                    disabled={bookmarking}
                  >
                    {isBookmarked ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
                    {bookmarking ? "Saving..." : isBookmarked ? "Saved" : "Save"}
                  </Button>
                ) : null}

                {onSaveAsArtifact ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 cursor-pointer gap-1.5 text-xs"
                    onClick={onSaveAsArtifact}
                    disabled={isArtifactSaved}
                  >
                    {isArtifactSaved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                    {isArtifactSaved ? "Saved to artifacts" : "Save to artifacts"}
                  </Button>
                ) : null}

                

                {onFeedback ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`h-8 cursor-pointer gap-1.5 px-2 ${feedback === "up" ? "text-[var(--success)]" : ""}`}
                      onClick={() => {
                        setFeedback("up");
                      if (messageId) onFeedback?.(messageId, true, activeModelId);
                      }}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`h-8 cursor-pointer gap-1.5 px-2 ${feedback === "down" ? "text-[var(--danger)]" : ""}`}
                      onClick={() => {
                        setFeedback("down");
                      if (messageId) onFeedback?.(messageId, false, activeModelId);
                      }}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : null}

                {(onBranch || tts.isSupported || whyThisResponse) ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" className="h-8 cursor-pointer gap-1.5 text-xs">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                        More
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {onBranch ? (
                        <DropdownMenuItem onSelect={() => onBranch()}>
                          <GitBranch className="mr-2 h-3.5 w-3.5" />
                          Branch
                        </DropdownMenuItem>
                      ) : null}
                      {whyThisResponse ? (
                        <DropdownMenuItem onSelect={() => setShowWhy((prev) => !prev)}>
                          <Info className="mr-2 h-3.5 w-3.5" />
                          {showWhy ? "Hide reasoning trace" : "Why this response"}
                        </DropdownMenuItem>
                      ) : null}
                      {tts.isSupported ? (
                        <DropdownMenuItem onSelect={() => (tts.isSpeaking ? tts.stop() : tts.speak(content))}>
                          {tts.isSpeaking ? "Stop audio" : "Read aloud"}
                        </DropdownMenuItem>
                      ) : null}
                      {onPinModel && activeModelId ? (
                        <DropdownMenuItem onSelect={() => onPinModel(activeModelId)}>
                          {isPinned ? "Unpin model" : "Pin model"}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              {showWhy && (whyThisResponse || routeTrace) && (
                <div className="mt-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Why this response</p>
                  {whyThisResponse && (
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{whyThisResponse}</p>
                  )}
                  {routeTrace && (
                    <div className="mt-2">
                      <ExecutionTimeline routeTrace={routeTrace} compact />
                    </div>
                  )}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
                <span className="inline-flex items-center gap-1">
                  <Zap className="h-2.5 w-2.5" />
                  <span className="tabular-nums">{displayInputTokens.toLocaleString()}</span>
                  <span className="opacity-50">/</span>
                  <span className="tabular-nums">{displayOutputTokens.toLocaleString()}</span>
                </span>
                {routeTrace?.inputTokenBreakdown ? (
                  <>
                    <span className="opacity-30">·</span>
                    <span className="group/tok relative cursor-default tabular-nums">
                      {routeTrace.inputTokenBreakdown.systemPrompt.toLocaleString()} sys
                      <span className="invisible absolute bottom-full left-1/2 z-30 mb-1.5 w-44 -translate-x-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)] shadow-lg group-hover/tok:visible">
                        <span className="font-medium text-[var(--text-primary)]">System prompt</span><br />Tokens used by the system prompt that defines the agent&apos;s behavior and capabilities.
                      </span>
                    </span>
                    <span className="opacity-30">·</span>
                    <span className="group/tok relative cursor-default tabular-nums">
                      {routeTrace.inputTokenBreakdown.history.toLocaleString()} hist
                      <span className="invisible absolute bottom-full left-1/2 z-30 mb-1.5 w-44 -translate-x-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)] shadow-lg group-hover/tok:visible">
                        <span className="font-medium text-[var(--text-primary)]">Conversation history</span><br />Tokens from previous messages in this chat session.
                      </span>
                    </span>
                    <span className="opacity-30">·</span>
                    <span className="group/tok relative cursor-default tabular-nums">
                      {routeTrace.inputTokenBreakdown.memory.toLocaleString()} mem
                      <span className="invisible absolute bottom-full left-1/2 z-30 mb-1.5 w-44 -translate-x-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)] shadow-lg group-hover/tok:visible">
                        <span className="font-medium text-[var(--text-primary)]">Memory context</span><br />Tokens from your persistent memory and learning profile.
                      </span>
                    </span>
                    <span className="opacity-30">·</span>
                    <span className="group/tok relative cursor-default tabular-nums">
                      {routeTrace.inputTokenBreakdown.sources.toLocaleString()} src
                      <span className="invisible absolute bottom-full left-1/2 z-30 mb-1.5 w-44 -translate-x-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)] shadow-lg group-hover/tok:visible">
                        <span className="font-medium text-[var(--text-primary)]">Source documents</span><br />Tokens from retrieved files, packs, and web search results.
                      </span>
                    </span>
                  </>
                ) : null}
                {timeLabel ? (
                  <>
                    <span className="opacity-30">·</span>
                    <span>{timeLabel}</span>
                  </>
                ) : null}
              </div>
              {memoryUpdated && (
                <div className="group/memory relative mt-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]">
                  <Brain size={12} />
                  <span>Memory updated</span>
                  {memoryUpdateSummary && (
                    <div className="invisible absolute bottom-full left-0 z-30 mb-1 w-64 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5 text-xs text-[var(--text-secondary)] shadow-lg group-hover/memory:visible">
                      <p className="font-medium text-[var(--text-primary)]">What was saved</p>
                      <p className="mt-1 leading-relaxed">{memoryUpdateSummary}</p>
                    </div>
                  )}
                </div>
              )}
              {routeTrace?.relatedMemory && routeTrace.relatedMemory.length > 0 ? (
                <section className="mt-3 max-w-2xl rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]/75 p-3">
                  <button
                    type="button"
                    onClick={() => setShowRelatedMemory((value) => !value)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
                  >
                    <span className="inline-flex items-center gap-2 text-[11px] font-medium text-[var(--text-secondary)]">
                      <Brain className="h-3.5 w-3.5" />
                      Related memory
                      <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10px]">
                        {routeTrace.relatedMemory.length}
                      </span>
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 text-[var(--text-secondary)] transition ${showRelatedMemory ? "rotate-180" : ""}`} />
                  </button>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                    These cues matched the prompt but were kept out of the prompt unless they were fresh and high-confidence enough.
                  </p>
                  {showRelatedMemory ? (
                    <div className="mt-3 space-y-2">
                      {routeTrace.relatedMemory.map((entry) => (
                        <article
                          key={entry.id}
                          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] capitalize text-[var(--text-secondary)]">
                              {entry.source}
                            </span>
                            <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] capitalize text-[var(--text-secondary)]">
                              {entry.reason.replace(/_/g, " ")}
                            </span>
                            <span className="text-[10px] text-[var(--text-tertiary)]">
                              conf {entry.confidence.toFixed(2)} · fresh {entry.freshness.toFixed(2)}
                            </span>
                          </div>
                          <p className="mt-2 text-xs font-medium text-[var(--text-primary)]">
                            {entry.key.replace(/_/g, " ")}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                            {entry.text}
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) return "";
  const now = Date.now();
  const diffMs = timestamp - now;
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const minutes = Math.round(diffMs / 60000);
  if (absMs < 60_000) return "just now";
  if (absMs < 3_600_000) return rtf.format(minutes, "minute");
  const hours = Math.round(diffMs / 3_600_000);
  if (absMs < 86_400_000) return rtf.format(hours, "hour");
  const days = Math.round(diffMs / 86_400_000);
  if (Math.abs(days) <= 6) return rtf.format(days, "day");
  return new Date(timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
