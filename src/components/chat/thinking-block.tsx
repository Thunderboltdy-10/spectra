"use client";

import { useMemo, useRef, useEffect } from "react";
import { Brain, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExecutionTimeline } from "@/components/shared/execution-timeline";
import type { RouteTrace } from "@/types";


type ThinkingBlockProps = {
  content: string;
  streaming?: boolean;
  routeTrace?: RouteTrace;
};

export function ThinkingBlock({ content, streaming = false, routeTrace }: ThinkingBlockProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const clean = content.trim();

  // Auto-scroll to bottom when streaming new content
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onScroll = () => {
      const delta = node.scrollHeight - node.scrollTop - node.clientHeight;
      shouldAutoScrollRef.current = delta < 30;
    };
    node.addEventListener("scroll", onScroll);
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !streaming) return;
    if (!shouldAutoScrollRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [clean, streaming]);

  const segments = useMemo(() => {
    const sanitized = clean
      .replace(/\[\d{1,3}\]/g, "")
      .replace(/\[[^\]\n]*§[^\]\n]*\]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!sanitized) return [];

    const lines = sanitized.split(/\r?\n/);
    const output: string[] = [];
    const flush = (buffer: string[]) => {
      const joined = buffer.join("\n").trim();
      if (joined) output.push(joined);
      buffer.length = 0;
    };
    const segmentBuffer: string[] = [];
    const startsStructuredLine = (line: string) =>
      /^(\s*[-*+•]\s+|\s*\d+[.)]\s+|\s*#{1,6}\s+)/.test(line);

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index] ?? "";
      const line = rawLine.trim();
      if (!line) {
        flush(segmentBuffer);
        continue;
      }
      if (segmentBuffer.length === 0) {
        segmentBuffer.push(line);
        continue;
      }

      const previousLine = segmentBuffer[segmentBuffer.length - 1] ?? "";
      const previousEndsSentence = /[.!?:]["')\]]?$/.test(previousLine.trim());
      const shouldSplit = previousEndsSentence || startsStructuredLine(line);
      if (shouldSplit) {
        flush(segmentBuffer);
        segmentBuffer.push(line);
      } else {
        segmentBuffer.push(line);
      }
    }

    flush(segmentBuffer);
    return output;
  }, [clean]);

  const hasTimeline = routeTrace?.phasePlan && routeTrace.phasePlan.length > 0;
  const hasSearchTrace = routeTrace?.searchTrace && routeTrace.searchTrace.strategy && routeTrace.searchTrace.strategy !== "none";
  const hasExecutionContent = hasTimeline || hasSearchTrace;
  if (!clean && !hasExecutionContent) return null;

  return (
    <div className="mb-4">
      {/* Execution Timeline — visible, execution-native rendering */}
      {hasExecutionContent && (
        <div className="mb-2">
          <details
            className="group [&_summary::-webkit-details-marker]:hidden"
            open={streaming}
          >
            <summary className="flex w-max cursor-pointer items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)] transition hover:text-[var(--text-secondary)] select-none">
              <Brain className="h-3 w-3" />
              {streaming ? "Executing..." : "Execution Trace"}
              {streaming ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] px-1.5 py-0.5 text-[9px] ml-1 text-[var(--accent-cyan)]">
                  <Sparkles className="h-2 w-2 animate-pulse" />
                  live
                </span>
              ) : null}
            </summary>
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
              className="mt-2 ml-0.5"
            >
              <ExecutionTimeline
                routeTrace={routeTrace}
                streaming={streaming}
              />
            </motion.div>
          </details>
        </div>
      )}

      {/* Thinking Content — collapsible raw reasoning */}
      {clean && (
        <details
          className="group [&_summary::-webkit-details-marker]:hidden"
          open={streaming && !hasExecutionContent}
        >
          <summary className="flex w-max cursor-pointer items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)] transition hover:text-[var(--text-secondary)] select-none">
            <Brain className="h-3 w-3" />
            {streaming ? "Thinking..." : "Thinking Process"}
            {streaming ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] px-1.5 py-0.5 text-[9px] ml-1 text-[var(--accent-cyan)]">
                <Sparkles className="h-2 w-2 animate-pulse" />
                live
              </span>
            ) : null}
          </summary>
          <div className="mt-2 ml-1.5 border-l-2 border-[var(--border-default)]/50 pl-3">
            <div ref={scrollRef} className="max-h-48 overflow-y-auto pr-1 space-y-2 py-1">
              {segments.map((segment, index) => (
                <div key={`${index}-${segment.slice(0, 24)}`} className="text-[11px] leading-relaxed text-[var(--text-tertiary)] opacity-90">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{segment}</ReactMarkdown>
                </div>
              ))}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
