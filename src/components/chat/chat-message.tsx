"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Bookmark, BookmarkCheck, Code2, Copy, FileText, GitBranch, Globe, Info, MoreHorizontal, Paperclip, Pencil, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { RichText } from "@/components/chat/rich-text";
import { ModelRoutingBadge } from "@/components/chat/model-routing-badge";
import { ProviderLogo } from "@/components/provider-logo";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { CollaboratorsBadge } from "@/components/chat/collaborators-badge";
import { type QuizSubmitResult } from "@/components/chat/quiz-reveal";
import { usePanel } from "@/context/panel-context";
import type { Citation, RouteTrace, StudyMode } from "@/types";
import { getModeConfig } from "@/lib/modes";
import { cn } from "@/lib/utils";
import { useTextToSpeech } from "@/hooks/use-text-to-speech";

type ChatMessageProps = {
  role: "user" | "assistant" | "system";
  content: string;
  thinkingContent?: string;
  enhancedContent?: string;
  attachments?: string[];
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
  onEdit?: (newContent: string) => void;
  onFeedback?: (positive: boolean, modelId?: string) => void;
  usageIn?: number;
  usageOut?: number;
  createdAt?: number;
  onOpenCanvas?: (params: { code: string; language: string }) => void;
  onSubmitQuizAnswers?: (result: QuizSubmitResult) => void;
  onBranch?: () => void;
  onToggleBookmark?: () => void;
  isBookmarked?: boolean;
  bookmarking?: boolean;
  animateIn?: boolean;
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

function CitationCards({ citations, onOpen }: { citations: Citation[]; onOpen: () => void }) {
  if (citations.length === 0) return null;
  const ragFiles = Array.from(
    new Set(
      citations
        .filter((citation) => citation.sourceType === "pack" || citation.sourceType === "personal")
        .map((citation) => citation.filename)
        .filter(Boolean),
    ),
  ).slice(0, 5);

  return (
    <section className="mt-8 border-t border-[var(--border-default)] pt-4">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-[var(--border-default)] pb-2">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Sources</p>
        <button
          type="button"
          onClick={onOpen}
          className="cursor-pointer rounded-md border border-[var(--border-default)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
        >
          Open all
        </button>
      </div>
      {ragFiles.length > 0 ? (
        <p className="mb-3 text-[11px] text-[var(--text-secondary)]">
          Files used: {ragFiles.join(", ")}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {citations.map((citation, idx) => {
          const isSearch = citation.sourceType === "search";
          const href = sanitizeNavigationHref(
            citation.url ?? (citation.resourceId ? `/api/resources/${citation.resourceId}/download` : undefined),
          );
          const label = citation.title || citation.filename || citation.domain || citation.url || "Source";
          const domain = citation.domain;
          return (
            <a
              key={`${citation.filename}-${idx}`}
              href={href ?? "#"}
              onClick={(event) => {
                if (!href) {
                  event.preventDefault();
                  onOpen();
                }
              }}
              target={href ? "_blank" : undefined}
              rel={href ? "noreferrer" : undefined}
              className={`flex min-h-[4.75rem] max-w-full cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-[11px] transition hover:bg-[var(--bg-hover)] ${
                isSearch
                  ? "border-[color-mix(in_oklab,var(--accent-cyan)_38%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)]"
                  : "border-[var(--border-default)] bg-[var(--bg-secondary)]"
              }`}
              title={label}
            >
              {isSearch ? <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Code2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0">
                <span className="line-clamp-2 block font-medium text-[var(--text-primary)]">
                  Source {idx + 1}: {label}
                </span>
                {isSearch && domain ? (
                  <span className="mt-1 block truncate text-[10px] text-[var(--text-secondary)]">{domain}</span>
                ) : null}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

export function ChatMessage({
  role,
  content,
  thinkingContent,
  enhancedContent,
  attachments,
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
  animateIn = true,
  children,
}: ChatMessageProps) {
  const isUser = role === "user";
  const modeConfig = mode ? getModeConfig(mode) : undefined;
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [showEnhanced, setShowEnhanced] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const { openPanel } = usePanel();
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(content);
  const tts = useTextToSpeech();
  const validCitations = citations.filter((c) => c.url || c.resourceId || c.filename);
  const searchCitations = validCitations.filter((citation) => citation.sourceType === "search");
  const activeModelId = modelUsed ?? routeTrace?.selected.modelId;
  const activeProvider = activeModelId?.split("/")[0] ?? "openrouter";
  const renderedContent = content;
  const directTokens = (usageIn ?? 0) + (usageOut ?? 0);
  const collaboratorExtraTokens =
    routeTrace?.collaborators
      ?.filter((item) => item.role !== "synthesizer")
      .reduce((sum, item) => sum + (item.tokensUsed ?? 0), 0) ?? 0;
  const collaboratorTotalTokens = routeTrace?.collaborators?.reduce((sum, item) => sum + (item.tokensUsed ?? 0), 0) ?? 0;
  const totalTokens =
    directTokens > 0
      ? directTokens + collaboratorExtraTokens
      : collaboratorTotalTokens;
  const timeLabel = useMemo(() => formatRelativeTime(createdAt), [createdAt]);
  const hasEnhanced = Boolean(enhancedContent && enhancedContent.trim());
  const displayUserContent = isUser && showEnhanced && hasEnhanced ? enhancedContent ?? content : content;

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

  function handleSaveEdit() {
    const clean = editedContent.trim();
    if (!clean || clean === content.trim()) {
      setEditing(false);
      return;
    }
    onEdit?.(clean);
    setEditing(false);
  }

  return (
    <article
      className={cn("flex", animateIn && "chat-fade-in", isUser ? "justify-end" : "justify-start")}
      aria-label={isUser ? "Your message" : "Assistant response"}
    >
      <div className={cn("w-full", isUser ? "max-w-3xl" : "max-w-5xl xl:max-w-6xl")}>
        {isUser ? (
          <div className="ml-auto rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3 shadow-[var(--shadow-soft)]">
            {editing ? (
              <div className="space-y-2">
                <textarea
                  value={editedContent}
                  onChange={(event) => setEditedContent(event.target.value)}
                  className="min-h-[96px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-[var(--accent-cyan)]/35"
                />
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" onClick={handleSaveEdit}>
                    Save
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <RichText content={displayUserContent} className="text-[15px] leading-7 text-[var(--text-primary)]" />
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
            ) : attachments && attachments.length > 0 ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {attachments.map((name) => (
                  <span
                    key={name}
                    className="inline-flex min-h-[3.5rem] items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[12px] text-[var(--text-secondary)]"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    {name}
                  </span>
                ))}
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
                {timeLabel ? <span className="text-[11px] text-[var(--text-secondary)]">{timeLabel}</span> : null}
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
                {modeConfig && (
                  <span
                    className="inline-flex h-2 w-2 rounded-full"
                    style={{ background: modeConfig.color }}
                  />
                )}
                <ModelRoutingBadge
                  modelUsed={modelUsed}
                  whyThisResponse={whyThisResponse}
                  routeTrace={routeTrace}
                />
              </div>

              <ThinkingBlock content={thinkingContent ?? ""} />
              {children ? children : <MarkdownRenderer content={renderedContent} citations={citations} mode={mode} onOpenCanvas={onOpenCanvas} onSubmitQuizAnswers={onSubmitQuizAnswers} />}
              <CollaboratorsBadge collaborators={routeTrace?.collaborators} />
              {mode === "research" && searchCitations.length > 0 && (
                <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5">
                  <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                    Web Evidence
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {searchCitations.slice(0, 4).map((citation, index) => {
                      const href = citation.url;
                      if (!href) return null;
                      return (
                        <a
                          key={`${href}-${index}`}
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="cursor-pointer rounded-md border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          title={citation.domain ?? citation.filename}
                        >
                          Source {index + 1}: {citation.title || citation.filename}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
              {validCitations.length > 0 && <CitationCards citations={validCitations} onOpen={() => openPanel("sources", { sources: validCitations })} />}

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

                {onFeedback ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`h-8 cursor-pointer gap-1.5 px-2 ${feedback === "up" ? "text-[var(--success)]" : ""}`}
                      onClick={() => {
                        setFeedback("up");
                        onFeedback?.(true, activeModelId);
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
                        onFeedback?.(false, activeModelId);
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              {showWhy && whyThisResponse && (
                <div className="mt-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Why this response</p>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{whyThisResponse}</p>
                  {routeTrace && routeTrace.toolchain.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {routeTrace.toolchain.map((tool) => (
                        <span key={tool} className="inline-flex items-center rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] border border-[var(--border-default)]">
                          {tool.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}
                  {routeTrace && (
                    <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--text-secondary)]">
                      {routeTrace.routingDurationMs > 0 && <span>Routing: {routeTrace.routingDurationMs}ms</span>}
                      {routeTrace.totalDurationMs && routeTrace.totalDurationMs > 0 && <span>Total: {(routeTrace.totalDurationMs / 1000).toFixed(1)}s</span>}
                      {routeTrace.fallbacks.length > 0 && <span className="text-[var(--warning)]">{routeTrace.fallbacks.length} fallback{routeTrace.fallbacks.length > 1 ? "s" : ""}</span>}
                    </div>
                  )}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                {totalTokens > 0 ? <span>{totalTokens.toLocaleString()} tokens</span> : null}
                {timeLabel ? <span>{timeLabel}</span> : null}
              </div>
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
