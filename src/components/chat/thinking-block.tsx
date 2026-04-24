"use client";

import { useMemo } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { ExecutionTimeline } from "@/components/shared/execution-timeline";
import { cn } from "@/lib/utils";
import type { RouteTrace } from "@/types";

function extractTitle(chunk: string): string {
  const firstLine = chunk.split("\n")[0]?.replace(/^[#>*\-\d.\s]+/, "").trim() ?? "";
  if (firstLine.length > 0 && firstLine.length <= 70) return firstLine;
  if (firstLine.length > 70) return `${firstLine.slice(0, 67)}…`;
  return "Thinking…";
}

function splitIntoParagraphs(text: string): string[] {
  return text.split(/(?:\r?\n){2,}/).map((s) => s.trim()).filter(Boolean);
}

type ThinkingBlockProps = {
  content: string;
  streaming?: boolean;
  routeTrace?: RouteTrace;
  segments?: Array<{ id: string; label: string; content: string; status: string }>;
};

export function ThinkingBlock({ content, streaming = false, routeTrace, segments = [] }: ThinkingBlockProps) {
  const clean = content.trim();

  const hasTimeline = routeTrace?.phasePlan && routeTrace.phasePlan.length > 0;
  const hasSearchTrace = routeTrace?.searchTrace && routeTrace.searchTrace.strategy && routeTrace.searchTrace.strategy !== "none";

  const paragraphs = useMemo(() => {
    if (segments.length > 0) {
      return segments.map((seg, i) => ({
        id: seg.id || `seg-${i}`,
        title: extractTitle(seg.content),
        body: seg.content,
        isStreaming: streaming && i === segments.length - 1,
      }));
    }
    const chunks = splitIntoParagraphs(clean);
    return chunks.map((chunk, i) => ({
      id: `chunk-${i}`,
      title: extractTitle(chunk),
      body: chunk,
      isStreaming: streaming && i === chunks.length - 1,
    }));
  }, [clean, segments, streaming]);

  const hasExecutionContent = hasTimeline || hasSearchTrace || paragraphs.length > 0;
  if (!hasExecutionContent) return null;

  return (
    <div className="mb-4 space-y-1">
      {/* Inline thinking indicator */}
      {streaming && (
        <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--text-tertiary)] mb-2">
          <span className="relative inline-flex h-5 w-5 items-center justify-center">
            <Brain className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
            <span className="absolute inset-0 rounded-full animate-ping opacity-20 bg-[var(--accent-cyan)]" />
          </span>
          <span className="tracking-wide">Thinking</span>
        </div>
      )}

      {/* Paragraph sections */}
      {paragraphs.map((para, idx) => {
        const isLast = idx === paragraphs.length - 1;
        const shouldBeOpen = para.isStreaming || (!streaming && isLast && paragraphs.length === 1);
        return (
          <details
            key={para.id}
            className="group thinking-paragraph"
            open={shouldBeOpen}
          >
            <summary className="flex cursor-pointer items-center gap-2 py-1 select-none list-none [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-tertiary)] transition-transform duration-200 group-open:rotate-90" />
              <span className={cn(
                "text-xs font-medium text-[var(--text-secondary)] truncate",
                para.isStreaming && "stream-glow-text"
              )}>
                {para.title}
              </span>
              {para.isStreaming && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)] animate-pulse" />
              )}
            </summary>
            <div className="pl-5 pr-2 py-1 text-sm leading-relaxed text-[var(--text-secondary)]">
              {para.body}
            </div>
          </details>
        );
      })}

      {/* Route execution events */}
      {(hasTimeline || hasSearchTrace) && (
        <div className="pt-2">
          <ExecutionTimeline routeTrace={routeTrace} compact />
        </div>
      )}
    </div>
  );
}
