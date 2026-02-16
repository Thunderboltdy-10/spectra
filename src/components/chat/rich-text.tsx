"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";

type RichTextProps = {
  content: string;
  className?: string;
};

export function RichText({ content, className }: RichTextProps) {
  return (
    <div className={cn("chat-rich", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code: ({ className: codeClass, children, ...props }) => {
            const isInline = !codeClass?.includes("language-");
            if (isInline) {
              return (
                <code
                  className="rounded border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-[0.88em]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <pre className="overflow-x-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-code)] p-3">
                <code className={codeClass}>{children}</code>
              </pre>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

