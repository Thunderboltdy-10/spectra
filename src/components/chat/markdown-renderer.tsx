"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, ExternalLink } from "lucide-react";

import { QuizReveal } from "@/components/chat/quiz-reveal";
import { FlashcardReveal } from "@/components/chat/flashcard-reveal";
import type { Citation } from "@/types";
import type { StudyMode } from "@/types";

type MarkdownRendererProps = {
  content: string;
  citations?: Citation[];
  mode?: StudyMode;
  onOpenCanvas?: (params: { code: string; language: string }) => void;
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

export function MarkdownRenderer({ content, citations = [], mode, onOpenCanvas }: MarkdownRendererProps) {
  const cleanContent = useMemo(() => {
    let processed = content;

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
      const href = citation ? citationHref(citation) : undefined;
      if (!href) return "";
      return `[${rawIdx}](${href})`;
    });

    return processed.replace(/\n{3,}/g, "\n\n").trim();
  }, [citations, content]);

  const isQuizMode = mode === "quiz" || mode === "exam";
  if (isQuizMode && /\n\d+[.)]\s+/.test(cleanContent) && /[A-D][.)]\s+/.test(cleanContent)) {
    return <QuizReveal content={cleanContent} />;
  }
  if (mode === "flashcard" && /FRONT\s*:/i.test(cleanContent) && /BACK\s*:/i.test(cleanContent)) {
    return <FlashcardReveal content={cleanContent} />;
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
              return (
                <sup>
                  <a
                    {...props}
                    target="_blank"
                    rel="noreferrer"
                    className="mx-0.5 inline-flex cursor-pointer items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0 text-[10px] font-medium text-[var(--accent-cyan)] no-underline transition hover:bg-[var(--bg-hover)]"
                  >
                    {children}
                  </a>
                </sup>
              );
            }
            return (
              <a
                {...props}
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
