"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, ExternalLink } from "lucide-react";

import { QuizReveal, isQuizContent, type QuizSubmitResult } from "@/components/chat/quiz-reveal";
import { FlashcardReveal, isFlashcardContent } from "@/components/chat/flashcard-reveal";
import { ImageReveal } from "@/components/chat/image-reveal";
import type { Citation } from "@/types";
import type { StudyMode } from "@/types";

import { stripQuizMarkers } from "@/lib/quiz-parser";

type MarkdownRendererProps = {
  content: string;
  citations?: Citation[];
  mode?: StudyMode;
  chatId?: string;
  onOpenCanvas?: (params: { code: string; language: string }) => void;
  onCitationClick?: (index: number) => void;
  onSubmitQuizAnswers?: (result: QuizSubmitResult) => void;
};

type CodeBlockProps = {
  children?: React.ReactNode;
  className?: string;
  onOpenCanvas?: (params: { code: string; language: string }) => void;
} & React.HTMLAttributes<HTMLElement>;

function normalizeCode(children: React.ReactNode) {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.join("");
  return String(children ?? "");
}

function CodeBlock({ children, className, onOpenCanvas, ...props }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const language = className?.replace("language-", "") || "";
  const codeText = useMemo(() => normalizeCode(children).trim(), [children]);
  const canOpenCanvas = Boolean(onOpenCanvas) && codeText.split("\n").length > 10;

  function handleCopy() {
    void navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative my-4 overflow-hidden rounded-b-xl border border-[var(--border-default)]">
      <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--bg-tertiary)] px-3 py-1.5">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
          {language || "code"}
        </span>
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
      <pre className="!m-0 overflow-x-auto bg-[var(--bg-code)] !p-4" {...props}>
        <code className={className}>{children}</code>
      </pre>
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

export function MarkdownRenderer({ content, citations = [], mode, chatId, onOpenCanvas, onCitationClick, onSubmitQuizAnswers }: MarkdownRendererProps) {
  const cleanContent = useMemo(() => {
    let baseContent = normalizeMathDelimiters(content);
    if (mode === "quiz" || mode === "exam" || isQuizContent(content)) {
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
            const isCitationRef = /^\[\d+\]$/.test(textValue.trim());
            if (isCitationRef) {
              const citationIndex = Number.parseInt(textValue.replace(/[[\]]/g, ""), 10) - 1;
              const href = sanitizeLinkHref(props.href) ?? "";
              const isDeadAnchor = !href || href.startsWith("#source-");
              const handleClick = (e: React.MouseEvent) => {
                if (isDeadAnchor && onCitationClick) {
                  e.preventDefault();
                  onCitationClick(citationIndex);
                }
              };
              return (
                <sup>
                  <a
                    {...props}
                    href={isDeadAnchor ? undefined : href}
                    target={isDeadAnchor ? undefined : "_blank"}
                    rel={isDeadAnchor ? undefined : "noreferrer"}
                    onClick={handleClick}
                    title={
                      citationIndex >= 0 && citations[citationIndex]
                        ? `${citations[citationIndex].title || citations[citationIndex].filename}${
                            citations[citationIndex].snippet
                              ? ` — ${citations[citationIndex].snippet.slice(0, 140)}`
                              : ""
                          }`
                        : undefined
                    }
                    className="mx-0.5 inline-flex cursor-pointer items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0 text-[10px] font-medium text-[var(--accent-cyan)] no-underline transition hover:bg-[var(--bg-hover)]"
                  >
                    {citationIndex >= 0 ? `S${citationIndex + 1}` : children}
                  </a>
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
              <CodeBlock className={className} onOpenCanvas={onOpenCanvas} {...props}>
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
