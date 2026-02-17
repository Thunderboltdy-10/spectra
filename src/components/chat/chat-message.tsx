"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Code2, Copy, FileText, GitBranch, Globe, Info, Paperclip, Pencil, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
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
  children?: React.ReactNode;
};

function CitationCards({ citations, onOpen }: { citations: Citation[]; onOpen: () => void }) {
  if (citations.length === 0) return null;

  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {citations.map((citation, idx) => {
        const isSearch = citation.sourceType === "search";
        const href = citation.url ?? (citation.resourceId ? `/api/resources/${citation.resourceId}/download` : undefined);
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
            className={`cursor-pointer rounded-md border px-2 py-1.5 text-left text-[11px] transition hover:bg-[var(--bg-hover)] ${
              isSearch
                ? "border-[color-mix(in_oklab,var(--accent-cyan)_38%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)]"
                : "border-[var(--border-default)] bg-[var(--bg-secondary)]"
            }`}
          >
            <div className="mb-0.5 flex items-center gap-1 text-[var(--text-secondary)]">
              {isSearch ? <Globe className="h-2.5 w-2.5" /> : <Code2 className="h-2.5 w-2.5" />}
              <span className="uppercase tracking-[0.06em]">[{idx + 1}]</span>
            </div>
            <p className="truncate font-medium text-[var(--text-primary)]">{citation.filename}</p>
          </a>
        );
      })}
    </div>
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
  children,
}: ChatMessageProps) {
  const isUser = role === "user";
  const modeConfig = mode ? getModeConfig(mode) : undefined;
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [showEnhanced, setShowEnhanced] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const { togglePanel } = usePanel();
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(content);
  const [regenModel, setRegenModel] = useState(regenModels[0]?.modelId ?? "");
  const tts = useTextToSpeech();
  const validCitations = citations.filter((c) => c.url || c.resourceId || c.filename);
  const searchCitations = validCitations.filter((citation) => citation.sourceType === "search");
  const activeModelId = modelUsed ?? routeTrace?.selected.modelId;
  const activeProvider = activeModelId?.split("/")[0] ?? "AI";
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
    <article className={cn("chat-fade-in flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("w-full", isUser ? "max-w-3xl" : "max-w-5xl")}>
        {isUser ? (
          <div className="ml-auto rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3 shadow-[var(--shadow-soft)]">
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-cyan)] text-[11px] font-bold text-white">
                U
              </span>
              <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                {showEnhanced && hasEnhanced ? "Enhanced" : "You"}
              </span>
              {timeLabel ? (
                <>
                  <span className="text-[10px] text-[var(--text-secondary)]">·</span>
                  <span className="text-[10px] text-[var(--text-secondary)]">{timeLabel}</span>
                </>
              ) : null}
              {hasEnhanced ? (
                <button
                  type="button"
                  onClick={() => setShowEnhanced((prev) => !prev)}
                  className="cursor-pointer text-[10px] text-[var(--text-secondary)] underline underline-offset-2 transition hover:text-[var(--text-primary)]"
                >
                  {showEnhanced ? "Show original" : "See enhanced prompt"}
                </button>
              ) : null}
            </div>
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
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--text-primary)]">{displayUserContent}</p>
            )}
            {attachmentPreviews && attachmentPreviews.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {attachmentPreviews.map((attachment, index) => {
                  const extension = attachment.name.split(".").pop()?.toUpperCase().slice(0, 5) || "FILE";
                  if (attachment.isImage && attachment.thumbnailUrl) {
                    return (
                      <div
                        key={`${attachment.name}-${index}`}
                        className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]"
                      >
                        <Image
                          src={attachment.thumbnailUrl}
                          alt={attachment.name}
                          width={240}
                          height={180}
                          className="h-28 w-full object-cover"
                        />
                        <p className="truncate px-2 py-1 text-[10px] text-[var(--text-secondary)]">{attachment.name}</p>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={`${attachment.name}-${index}`}
                      className="flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2"
                    >
                      <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-1 text-[9px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        <FileText className="mr-1 h-2.5 w-2.5" />
                        {extension}
                      </span>
                      <p className="truncate text-[11px] text-[var(--text-secondary)]">{attachment.name}</p>
                    </div>
                  );
                })}
              </div>
            ) : attachments && attachments.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {attachments.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
                  >
                    <Paperclip className="h-3 w-3" />
                    {name}
                  </span>
                ))}
              </div>
            ) : null}
            {(onEdit || onBranch) && !editing ? (
              <div className="mt-1 flex items-center gap-1.5">
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
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex min-w-0 items-start gap-3 border-t border-[var(--border-default)] pt-4">
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
                          className="cursor-pointer rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                          [{index + 1}] {citation.filename}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
              {validCitations.length > 0 && (
                <button
                  type="button"
                  onClick={() => togglePanel("sources", { sources: validCitations })}
                  className="mt-4 cursor-pointer rounded-full border border-[var(--border-default)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
                >
                  View sources ({validCitations.length})
                </button>
              )}
              {validCitations.length > 0 && <CitationCards citations={validCitations} onOpen={() => togglePanel("sources", { sources: validCitations })} />}

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
                {isLastAssistant && onRegenerate && (
                  <>
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
                    {onRegenerateWithModel && regenModels.length > 0 ? (
                      <div className="flex items-center gap-1 rounded-full border border-[var(--border-default)] px-2 py-0.5 text-xs">
                        <select
                          value={regenModel}
                          onChange={(event) => setRegenModel(event.target.value)}
                          className="max-w-[180px] cursor-pointer bg-transparent text-[11px] outline-none"
                        >
                          {regenModels.map((model) => (
                            <option key={model.modelId} value={model.modelId}>
                              {sanitizeModelLabel(model.name)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="cursor-pointer text-[11px] text-[var(--accent-cyan)]"
                          onClick={() => onRegenerateWithModel(regenModel)}
                        >
                          Retry model
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`h-8 cursor-pointer gap-1.5 text-xs ${feedback === "up" ? "text-[var(--success)]" : ""}`}
                  onClick={() => {
                    setFeedback("up");
                    onFeedback?.(true, activeModelId);
                  }}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  Helpful
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`h-8 cursor-pointer gap-1.5 text-xs ${feedback === "down" ? "text-[var(--danger)]" : ""}`}
                  onClick={() => {
                    setFeedback("down");
                    onFeedback?.(false, activeModelId);
                  }}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                  Improve
                </Button>
                {tts.isSupported ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 cursor-pointer gap-1.5 text-xs"
                    onClick={() => (tts.isSpeaking ? tts.stop() : tts.speak(content))}
                  >
                    {tts.isSpeaking ? "Stop audio" : "Read aloud"}
                  </Button>
                ) : null}
                {whyThisResponse && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`h-8 cursor-pointer gap-1.5 text-xs ${showWhy ? "text-[var(--accent-cyan)]" : ""}`}
                    onClick={() => setShowWhy(!showWhy)}
                  >
                    <Info className="h-3.5 w-3.5" />
                    Why
                  </Button>
                )}
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
