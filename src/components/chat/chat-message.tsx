"use client";

import { useState } from "react";
import { Code2, Copy, Globe, Paperclip, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { ModelRoutingBadge } from "@/components/chat/model-routing-badge";
import { ProviderLogo } from "@/components/provider-logo";
import type { Citation, StudyMode } from "@/types";
import { getModeConfig } from "@/lib/modes";

type ChatMessageProps = {
  role: "user" | "assistant" | "system";
  content: string;
  enhancedContent?: string;
  attachments?: string[];
  modelUsed?: string;
  whyThisResponse?: string;
  citations?: Citation[];
  mode?: StudyMode;
  isLastAssistant?: boolean;
  onRegenerate?: () => void;
  onEdit?: (newContent: string) => void;
};

function CitationCards({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;

  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {citations.map((citation, idx) => {
        const isSearch = citation.sourceType === "search";
        const href = citation.url || (citation.resourceId ? `/api/resources/${citation.resourceId}/download` : undefined);
        const CardInner = (
          <div
            className={`rounded-lg border p-2 text-xs ${
              isSearch
                ? "border-[color-mix(in_oklab,var(--accent-cyan)_38%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)]"
                : "border-[var(--border-default)] bg-[var(--bg-secondary)]"
            }`}
          >
            <div className="mb-1 flex items-center gap-1 text-[var(--text-secondary)]">
              {isSearch ? <Globe className="h-3 w-3" /> : <Code2 className="h-3 w-3" />}
              <span className="uppercase tracking-[0.08em]">[{idx + 1}] {isSearch ? "web" : citation.sourceType}</span>
            </div>
            <p className="truncate font-medium text-[var(--text-primary)]">{citation.filename}</p>
            {citation.page ? <p className="text-[11px] text-[var(--text-secondary)]">Page {citation.page}</p> : null}
          </div>
        );

        if (href) {
          return (
            <a key={`${citation.filename}-${idx}`} href={href} target="_blank" rel="noreferrer">
              {CardInner}
            </a>
          );
        }

        return <div key={`${citation.filename}-${idx}`}>{CardInner}</div>;
      })}
    </div>
  );
}

export function ChatMessage({
  role,
  content,
  enhancedContent,
  attachments,
  modelUsed,
  whyThisResponse,
  citations = [],
  mode,
  isLastAssistant = false,
  onRegenerate,
}: ChatMessageProps) {
  const isUser = role === "user";
  const modeConfig = mode ? getModeConfig(mode) : undefined;
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [showEnhanced, setShowEnhanced] = useState(false);
  const hasInlineCitations = /\[\d+\]/.test(content);
  const searchCitations = citations.filter((citation) => citation.sourceType === "search");
  const renderedContent =
    !isUser && citations.length > 0 && !hasInlineCitations
      ? `${content}\n\n${citations
          .slice(0, 4)
          .map((_, index) => `[${index + 1}]`)
          .join(" ")}`
      : content;

  function handleCopy() {
    void navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  }

  return (
    <article className={`chat-fade-in ${isUser ? "flex justify-end" : "flex justify-start"}`}>
      <div className={isUser ? "w-full max-w-4xl" : "w-full max-w-5xl"}>
        {isUser ? (
          <div className="rounded-2xl bg-[var(--bg-user-bubble)] px-4 py-3 shadow-[var(--shadow-soft)]">
            <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--text-primary)]">{content}</p>
            {attachments && attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {attachments.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
                  >
                    <Paperclip className="h-3 w-3" />
                    {name}
                  </span>
                ))}
              </div>
            )}
            {enhancedContent && enhancedContent.trim() && enhancedContent.trim() !== content.trim() && (
              <div className="mt-3 rounded-xl border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_75%,transparent)] p-2.5">
                <button
                  type="button"
                  onClick={() => setShowEnhanced((prev) => !prev)}
                  className="text-xs font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
                >
                  {showEnhanced ? "Hide enhanced prompt" : "View enhanced prompt"}
                </button>
                {showEnhanced && (
                  <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[var(--text-secondary)]">
                    {enhancedContent}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <ProviderLogo
              provider={modelUsed?.split("/")[0]}
              modelId={modelUsed}
              className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)]"
            />
            <div className="min-w-0 flex-1 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3 shadow-[var(--shadow-soft)]">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {modeConfig && (
                  <span
                    className="inline-flex h-2 w-2 rounded-full"
                    style={{ backgroundColor: modeConfig.color }}
                  />
                )}
                <ModelRoutingBadge modelUsed={modelUsed} whyThisResponse={whyThisResponse} />
              </div>

              <MarkdownRenderer content={renderedContent} citations={citations} />
              {mode === "research" && searchCitations.length > 0 && (
                <div className="mt-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5">
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
                          className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                          [{index + 1}] {citation.filename}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
              <CitationCards citations={citations} />

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={handleCopy}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
                {isLastAssistant && onRegenerate && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onRegenerate}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Regenerate
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`h-8 gap-1.5 text-xs ${feedback === "up" ? "text-[var(--success)]" : ""}`}
                  onClick={() => setFeedback("up")}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  Helpful
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`h-8 gap-1.5 text-xs ${feedback === "down" ? "text-[var(--danger)]" : ""}`}
                  onClick={() => setFeedback("down")}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                  Improve
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
