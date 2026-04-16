"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, ExternalLink, Globe2 } from "lucide-react";

import { QuizReveal, isQuizContent, type QuizSubmitResult } from "@/components/chat/quiz-reveal";
import { FlashcardReveal, isFlashcardContent } from "@/components/chat/flashcard-reveal";
import { ImageReveal } from "@/components/chat/image-reveal";
import { CodePreview } from "@/components/chat/code-preview";
import { canPreview, type PreviewLanguage } from "@/lib/code-sandbox";
import type { Citation } from "@/types";
import type { StudyMode } from "@/types";

import { stripQuizMarkers } from "@/lib/quiz-parser";

type MarkdownRendererProps = {
  content: string;
  citations?: Citation[];
  mode?: StudyMode;
  userMessage?: boolean;
  chatId?: string;
  onOpenCanvas?: (params: { code: string; language: string }) => void;
  onCitationClick?: (index: number) => void;
  onSubmitQuizAnswers?: (result: QuizSubmitResult) => void;
};

type CodeBlockProps = {
  children?: React.ReactNode;
  className?: string;
  onOpenCanvas?: (params: { code: string; language: string }) => void;
  disablePreview?: boolean;
  disableCanvas?: boolean;
} & React.HTMLAttributes<HTMLElement>;

function normalizeCode(children: React.ReactNode) {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.join("");
  return String(children ?? "");
}

function CodeBlock({
  children,
  className,
  onOpenCanvas,
  disablePreview = false,
  disableCanvas = false,
  ...props
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const language = className?.match(/language-(\S+)/)?.[1] || "";
  const codeText = useMemo(() => normalizeCode(children).trim(), [children]);
  const canOpenCanvas = !disableCanvas && Boolean(onOpenCanvas) && codeText.split("\n").length > 10;
  const previewable = !disablePreview && canPreview(language);
  const [viewMode, setViewMode] = useState<"preview" | "code">(previewable ? "preview" : "code");

  function handleCopy() {
    void navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative my-4 flex flex-col rounded-xl border border-[var(--border-default)] bg-[var(--bg-code)] shadow-sm">
      <div className="flex items-center justify-between rounded-t-xl border-b border-[var(--border-default)] bg-[var(--bg-tertiary)] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
            {language ? language.charAt(0).toUpperCase() + language.slice(1) : "Code"}
          </span>
          {previewable ? (
            <div className="ml-2 flex items-center overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)]">
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition ${viewMode === "preview" ? "bg-[var(--bg-primary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
              >
                Preview
              </button>
              <div className="h-3 w-px bg-[var(--border-default)]" />
              <button
                type="button"
                onClick={() => setViewMode("code")}
                className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition ${viewMode === "code" ? "bg-[var(--bg-primary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
              >
                Code
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-[var(--success)]" />
                <span className="text-[var(--success)]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>Copy</span>
              </>
            )}
          </button>
          {canOpenCanvas ? (
            <button
              type="button"
              onClick={() => onOpenCanvas?.({ code: codeText, language: language || "text" })}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--accent-cyan)] transition hover:bg-[var(--bg-hover)]"
            >
              Open in Canvas
            </button>
          ) : null}
        </div>
      </div>
      {previewable && viewMode === "preview" ? (
        <div className="relative min-h-[260px] rounded-b-xl overflow-hidden bg-[var(--bg-elevated)] p-1">
          <CodePreview code={codeText} language={language as PreviewLanguage} />
        </div>
      ) : (
        <pre className="!m-0 overflow-x-auto rounded-b-xl !p-4" {...props}>
          <code className={className}>{children}</code>
        </pre>
      )}
    </div>
  );
}

function citationHref(citation: Citation) {
  if (citation.url) return citation.url;
  if (citation.resourceId) return `/api/resources/${citation.resourceId}/download`;
  return undefined;
}

function sanitizeLinkHref(value: string | undefined) {
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

function sanitizeImageSrc(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/")) return trimmed;
  if (/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }
  return sanitizeLinkHref(trimmed);
}

function displayCitationDomain(citation: Citation) {
  if (citation.domain) return citation.domain;
  if (!citation.url) return undefined;
  try {
    return new URL(citation.url).hostname.replace(/^www\./i, "");
  } catch {
    return undefined;
  }
}

function reliabilityTone(label: Citation["reliabilityLabel"]) {
  if (label === "high") {
    return "border-[color-mix(in_oklab,var(--success)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-[var(--success)]";
  }
  if (label === "low") {
    return "border-[color-mix(in_oklab,var(--warning)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] text-[var(--warning)]";
  }
  return "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]";
}

function normalizeCitationToken(value: string) {
  return value
    .toLowerCase()
    .replace(/§\s*\d+(\.\d+)*/g, " ")
    .replace(/\.[a-z0-9]{2,5}$/i, " ")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImagePayload(content: string) {
  const imageMatch = content.match(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/i);
  if (!imageMatch) return null;
  const alt = imageMatch[1]?.trim() || "Generated image";
  const src = imageMatch[2]?.trim();
  if (!src) return null;

  const promptMatch = content.match(/(?:^|\n)\*{0,2}Prompt:\*{0,2}\s*(.+)$/im);
  const prompt = promptMatch?.[1]?.trim();
  return { src, alt, prompt };
}

function normalizeMathDelimiters(content: string) {
  let result = content;
  // Only normalize block math if delimiters are balanced (prevents breaking during streaming)
  const openBrackets = (result.match(/\\\[/g) ?? []).length;
  const closeBrackets = (result.match(/\\\]/g) ?? []).length;
  if (openBrackets > 0 && openBrackets === closeBrackets) {
    result = result.replace(/\\\[([\s\S]+?)\\\]/g, (_m, expr: string) => `\n$$\n${expr.trim()}\n$$\n`);
  }
  // Only normalize inline math if delimiters are balanced
  const openParens = (result.match(/\\\(/g) ?? []).length;
  const closeParens = (result.match(/\\\)/g) ?? []).length;
  if (openParens > 0 && openParens === closeParens) {
    result = result.replace(/\\\((.+?)\\\)/g, (_m, expr: string) => `$${String(expr).trim()}$`);
  }
  return result;
}

export function MarkdownRenderer({
  content,
  citations = [],
  mode,
  userMessage = false,
  chatId,
  onOpenCanvas,
  onCitationClick,
  onSubmitQuizAnswers,
}: MarkdownRendererProps) {
  const cleanContent = useMemo(() => {
    let baseContent = normalizeMathDelimiters(content);
    if (mode === "quiz" || mode === "exam" || mode === "flashcard" || isQuizContent(content) || isFlashcardContent(content)) {
      baseContent = stripQuizMarkers(baseContent);
    }
    baseContent = baseContent.replace(/<<\s*(?:quiz|flashcards)_(?:start|end)\s*>>/gi, "");

    if (citations.length === 0) {
      return baseContent.replace(/\n{3,}/g, "\n\n").trim();
    }

    const rewriteSegment = (segment: string) => {
      let processed = segment;
      processed = processed.replace(/\[([^\]\n]+?)\s+p\.\s*(\d+)\]/gi, (match, filename, page) => {
        const target = normalizeCitationToken(String(filename));
        const idx = citations.findIndex(
          (citation) =>
            normalizeCitationToken(citation.filename).includes(target) &&
            (citation.page === Number(page) || !citation.page),
        );
        return idx >= 0 ? `[${idx + 1}]` : match;
      });

      processed = processed.replace(/\[([^\]\n]{3,60})\]/gi, (match, name) => {
        const token = String(name).trim();
        if (/^\d+$/.test(token)) return match;
        const normalizedToken = normalizeCitationToken(token);
        const idx = citations.findIndex((citation) =>
          normalizeCitationToken(citation.filename).includes(normalizedToken),
        );
        return idx >= 0 ? `[${idx + 1}]` : match;
      });

      processed = processed.replace(/\[(\d+)\]/g, (token, rawIdx) => {
        const index = Number(rawIdx) - 1;
        const citation = citations[index];
        if (!citation) return token;
        const href = sanitizeLinkHref(citationHref(citation)) ?? `#source-${rawIdx}`;
        return `[${rawIdx}](${href})`;
      });
      return processed;
    };

    const chunks = baseContent.split(/(```[\s\S]*?```)/g);
    const rewritten = chunks
      .map((chunk) => (chunk.startsWith("```") ? chunk : rewriteSegment(chunk)))
      .join("");
    return rewritten.replace(/\n{3,}/g, "\n\n").trim();
  }, [citations, content, mode]);

  const isQuizMode = mode === "quiz" || mode === "exam";

  // Pure mode rendering for full-content matches
  if (isQuizMode && isQuizContent(cleanContent)) {
    return <QuizReveal content={cleanContent} chatId={chatId} onSubmitAnswers={onSubmitQuizAnswers} />;
  }
  if (isFlashcardContent(cleanContent) && (mode === "flashcard" || /(?:^|\n)\s*FRONT\s*:/i.test(cleanContent))) {
    return <FlashcardReveal content={cleanContent} />;
  }
  if (mode === "image") {
    const image = extractImagePayload(cleanContent);
    if (image) {
      return <ImageReveal src={image.src} alt={image.alt} prompt={image.prompt} />;
    }
  }

  // Mixed content: check if content has embedded quiz/flashcard segments within text
  if (isQuizMode || mode === "flashcard") {
    // Try to split content into text preamble + structured content
    const quizStart = cleanContent.search(/(?:^|\n)(?:Q(?:uestion)?\s*)?1[.):-]\s+/m);
    const flashcardStart = cleanContent.search(/(?:^|\n)\s*(?:Card\s*1|FRONT)\s*:/im);
    const structuredStart = isQuizMode ? quizStart : flashcardStart;

    if (structuredStart > 20) {
      const textPart = cleanContent.slice(0, structuredStart).trim();
      const structuredPart = cleanContent.slice(structuredStart).trim();
      const hasValidStructured = isQuizMode
        ? isQuizContent(structuredPart)
        : isFlashcardContent(structuredPart);

      if (hasValidStructured && textPart) {
        return (
          <div className="space-y-4">
            <div className="chat-markdown text-[15px] leading-7 text-[var(--text-primary)]">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]}>
                {textPart}
              </ReactMarkdown>
            </div>
            {isQuizMode ? <QuizReveal content={structuredPart} chatId={chatId} onSubmitAnswers={onSubmitQuizAnswers} /> : <FlashcardReveal content={structuredPart} />}
          </div>
        );
      }
    }
  }

  return (
    <div className="chat-markdown text-[15px] leading-7 text-[var(--text-primary)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          a: ({ children, ...props }) => {
            const textValue = (Array.isArray(children) ? children : [children])
              .map((item) => (typeof item === "string" ? item : ""))
              .join("");
            const citationMatch = textValue.trim().match(/^\[?(\d+)\]?$/);
            const isCitationRef = Boolean(citationMatch);
            if (isCitationRef) {
              const citationNumber = Number.parseInt(citationMatch?.[1] ?? "", 10);
              const citationIndex = citationNumber - 1;
              const href = sanitizeLinkHref(props.href) ?? "";
              const isDeadAnchor = !href || href.startsWith("#source-");
              const citation = citationIndex >= 0 ? citations[citationIndex] : undefined;
              const citationDomain = citation ? displayCitationDomain(citation) : undefined;
              const citationTitle = citation?.title || citation?.filename || citationDomain || `Source ${citationIndex + 1}`;
              const handleClick = (e: React.MouseEvent) => {
                if (isDeadAnchor && onCitationClick) {
                  e.preventDefault();
                  onCitationClick(citationIndex);
                }
              };
              return (
                <sup className="group relative mx-0.5 align-super">
                  <a
                    {...props}
                    href={isDeadAnchor ? undefined : href}
                    target={isDeadAnchor ? undefined : "_blank"}
                    rel={isDeadAnchor ? undefined : "noreferrer"}
                    onClick={handleClick}
                    className="inline-flex h-4 min-w-4 cursor-pointer items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,var(--bg-secondary))] px-1 text-[9px] font-semibold leading-none text-[var(--accent-cyan)] no-underline transition hover:bg-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--bg-secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)]/40"
                  >
                    {citationIndex >= 0 ? citationNumber : children}
                  </a>
                  {citation ? (
                    <span className="pointer-events-none absolute bottom-[130%] left-1/2 z-20 hidden w-[min(24rem,80vw)] -translate-x-1/2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-left opacity-0 shadow-[var(--shadow-card)] transition group-hover:block group-hover:opacity-100 group-focus-within:block group-focus-within:opacity-100">
                      <span className="mb-1 inline-flex w-full items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        {citation.favicon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={citation.favicon}
                            alt=""
                            className="h-4 w-4 rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] object-cover"
                          />
                        ) : (
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-[var(--border-default)] bg-[var(--bg-secondary)]">
                            <Globe2 className="h-2.5 w-2.5" />
                          </span>
                        )}
                        <span className="truncate">{citationDomain || "source"}</span>
                      </span>
                      <span className="line-clamp-2 block text-[11px] font-semibold leading-snug text-[var(--text-primary)]">
                        {citationTitle}
                      </span>
                      {citation.snippet ? (
                        <span className="mt-1 line-clamp-3 block text-[11px] leading-snug text-[var(--text-secondary)]">
                          {citation.snippet}
                        </span>
                      ) : null}
                      <span className="mt-2 inline-flex flex-wrap items-center gap-1.5">
                        {typeof citation.relevanceScore === "number" ? (
                          <span className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                            Relevance {citation.relevanceScore.toFixed(2)}
                          </span>
                        ) : null}
                        {citation.reliabilityLabel ? (
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] capitalize ${reliabilityTone(citation.reliabilityLabel)}`}>
                            Reliability {citation.reliabilityLabel}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  ) : null}
                </sup>
              );
            }
            const safeHref = sanitizeLinkHref(props.href);
            if (!safeHref) {
              return <span className="text-[var(--text-secondary)]">{children}</span>;
            }
            return (
              <a
                {...props}
                href={safeHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex cursor-pointer items-center gap-1 text-[var(--accent-cyan)] underline decoration-[var(--accent-cyan)]/30 underline-offset-2 transition hover:decoration-[var(--accent-cyan)]"
              >
                {children}
                <ExternalLink className="h-3 w-3" />
              </a>
            );
          },
          table: ({ ...props }) => (
            <div className="markdown-table-wrap">
              <table {...props} />
            </div>
          ),
          img: ({ src: imgSrc, alt: imgAlt }) => {
            const srcStr = typeof imgSrc === "string" ? sanitizeImageSrc(imgSrc) : undefined;
            if (srcStr) {
              return <ImageReveal src={srcStr} alt={typeof imgAlt === "string" ? imgAlt : undefined} />;
            }
            return null;
          },
          code: ({ className, children, ...props }) => {
            const codeText = normalizeCode(children);
            const isInline = !className?.includes("language-") && !codeText.includes("\n");
            if (isInline) {
              return (
                <code
                  className="rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--text-primary)]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <CodeBlock
                className={className}
                onOpenCanvas={onOpenCanvas}
                disablePreview={userMessage}
                disableCanvas={userMessage}
                {...props}
              >
                {children}
              </CodeBlock>
            );
          },
        }}
      >
        {cleanContent}
      </ReactMarkdown>
    </div>
  );
}
