"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type RichTextProps = { content: string; className?: string };

function normalizeStreamingMath(content: string) {
  let value = content;
  const blockOpen = (value.match(/\\\[/g) ?? []).length;
  const blockClose = (value.match(/\\\]/g) ?? []).length;
  if (blockOpen > 0 && blockOpen === blockClose) value = value.replace(/\\\[([\s\S]+?)\\\]/g, (_match, math: string) => `\n$$\n${math.trim()}\n$$\n`);
  const inlineOpen = (value.match(/\\\(/g) ?? []).length;
  const inlineClose = (value.match(/\\\)/g) ?? []).length;
  if (inlineOpen > 0 && inlineOpen === inlineClose) value = value.replace(/\\\((.+?)\\\)/g, (_match, math: string) => `$${String(math).trim()}$`);
  return value;
}

function safeHref(value?: string) {
  if (!value) return undefined;
  if (value.startsWith("/")) return value;
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? value : undefined; } catch { return undefined; }
}

export function RichText({ content, className }: RichTextProps) {
  const normalized = useMemo(() => normalizeStreamingMath(content), [content]);
  return <div className={cn("chat-rich max-w-none", className)}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeHighlight]}
      components={{
        h1: ({ children }) => <h1 className="mb-4 mt-7 font-display text-[1.7em] font-semibold leading-tight tracking-[-0.02em] first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-3 mt-7 font-display text-[1.38em] font-semibold leading-tight tracking-[-0.015em] first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-6 text-[1.08em] font-semibold first:mt-0">{children}</h3>,
        p: ({ children }) => <p className="my-3 leading-[1.78] first:mt-0 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="my-4 list-disc space-y-1.5 pl-6 marker:text-[var(--accent-cyan)]">{children}</ul>,
        ol: ({ children }) => <ol className="my-4 list-decimal space-y-1.5 pl-6 marker:font-semibold marker:text-[var(--text-secondary)]">{children}</ol>,
        blockquote: ({ children }) => <blockquote className="my-5 border-l-2 border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,transparent)] px-4 py-2 text-[var(--text-secondary)]">{children}</blockquote>,
        table: ({ children }) => <div className="my-5 overflow-x-auto rounded-[9px] border border-[var(--border-default)]"><table className="w-full border-collapse text-left text-[0.9em]">{children}</table></div>,
        thead: ({ children }) => <thead className="bg-[var(--bg-secondary)] text-[var(--text-primary)]">{children}</thead>,
        th: ({ children }) => <th className="border-b border-r border-[var(--border-default)] px-3 py-2 font-semibold last:border-r-0">{children}</th>,
        td: ({ children }) => <td className="border-b border-r border-[var(--border-subtle)] px-3 py-2 align-top last:border-r-0">{children}</td>,
        a: ({ href, children }) => { const safe = safeHref(href); return safe ? <a href={safe} target={safe.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="inline-flex items-baseline gap-1 font-medium text-[var(--accent-cyan)] underline decoration-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)] underline-offset-2 hover:decoration-current">{children}{!safe.startsWith("/") ? <ExternalLink className="h-3 w-3 self-center" /> : null}</a> : <span>{children}</span>; },
        pre: ({ children }) => <pre className="my-5 overflow-x-auto rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-code)] p-4 text-[0.86em] leading-6 shadow-[inset_0_1px_0_color-mix(in_oklab,white_4%,transparent)]">{children}</pre>,
        code: ({ className: codeClass, children, ...props }) => codeClass?.includes("language-")
          ? <code className={codeClass} {...props}>{children}</code>
          : <code className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[0.88em]" {...props}>{children}</code>,
        hr: () => <hr className="my-7 border-0 border-t border-[var(--border-default)]" />,
      }}
    >{normalized}</ReactMarkdown>
  </div>;
}
