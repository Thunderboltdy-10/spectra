"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, ExternalLink } from "lucide-react";

import type { Citation } from "@/types";

type MarkdownRendererProps = {
  content: string;
  citations?: Citation[];
};

type CodeBlockProps = {
  children?: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>;

function normalizeCode(children: React.ReactNode) {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.join("");
  return String(children ?? "");
}

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const language = className?.replace("language-", "") || "";
  const codeText = useMemo(() => normalizeCode(children).trim(), [children]);

  function handleCopy() {
    void navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-[var(--border-default)]">
      <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--bg-tertiary)] px-3 py-1.5">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
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

export function MarkdownRenderer({ content, citations = [] }: MarkdownRendererProps) {
  const cleanContent = useMemo(() => {
    const withoutVerboseRefs = content
      .replace(/\[[^\]\n]*\bp\.\s*\d+[^\]\n]*\]/gi, "")
      .replace(/\[general knowledge\]/gi, "")
      .replace(/\n{3,}/g, "\n\n");

    const withLinks = withoutVerboseRefs.replace(/\[(\d+)\]/g, (token, rawIdx) => {
      const index = Number(rawIdx) - 1;
      const citation = citations[index];
      const href = citation ? citationHref(citation) : undefined;
      if (!href) return token;
      return `[${rawIdx}](${href})`;
    });

    return withLinks.trim();
  }, [citations, content]);

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
            return (
              <a
                {...props}
                target="_blank"
                rel="noreferrer"
                className={
                  isCitationRef
                    ? "mx-0.5 inline-flex items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0 text-[11px] text-[var(--text-secondary)] no-underline hover:bg-[var(--bg-hover)]"
                    : "inline-flex items-center gap-1 text-[var(--accent-cyan)] underline decoration-[var(--accent-cyan)]/30 underline-offset-2 transition hover:decoration-[var(--accent-cyan)]"
                }
              >
                {children}
                {!isCitationRef ? <ExternalLink className="h-3 w-3" /> : null}
              </a>
            );
          },
          table: ({ ...props }) => (
            <div className="markdown-table-wrap">
              <table {...props} />
            </div>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className?.includes("language-");
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
            return <CodeBlock className={className} {...props}>{children}</CodeBlock>;
          },
        }}
      >
        {cleanContent}
      </ReactMarkdown>
    </div>
  );
}
