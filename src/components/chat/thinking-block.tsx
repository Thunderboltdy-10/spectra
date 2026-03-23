"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, ChevronDown, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type ThinkingBlockProps = {
  content: string;
  streaming?: boolean;
};

export function ThinkingBlock({ content, streaming = false }: ThinkingBlockProps) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const startTimeRef = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);
  const clean = content.trim();

  // Elapsed timer while streaming
  useEffect(() => {
    if (!streaming) return;
    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [streaming]);
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
  const visibleSegments = showAll ? segments : segments.slice(0, 12);
  const hasHiddenSegments = segments.length > 12;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !open) return;
    const onScroll = () => {
      const delta = node.scrollHeight - node.scrollTop - node.clientHeight;
      shouldAutoScrollRef.current = delta < 30;
    };
    node.addEventListener("scroll", onScroll);
    return () => node.removeEventListener("scroll", onScroll);
  }, [open]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !open || !streaming) return;
    if (!shouldAutoScrollRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [segments, open, streaming]);

  useEffect(() => {
    if (streaming && clean) {
      setOpen(true);
    }
  }, [clean, streaming]);

  useEffect(() => {
    if (!hasHiddenSegments) {
      setShowAll(false);
    }
  }, [hasHiddenSegments]);

  if (!clean) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--accent-cyan)_34%,var(--border-default))] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--accent-cyan)_10%,transparent),transparent)]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.11em] text-[var(--text-secondary)]">
          <Brain className="h-3.5 w-3.5" />
          {streaming ? `Thinking for ${elapsed}s...` : "Thinking Process"}
          {streaming ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px]">
              <Sparkles className="h-2.5 w-2.5 animate-pulse" />
              live
            </span>
          ) : null}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-[var(--text-secondary)] transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="border-t border-[var(--border-default)] px-3 py-2">
          <div ref={scrollRef} className="max-h-56 overflow-y-auto pr-1">
            <div className="relative pl-6">
              <div className="absolute left-[5px] top-0 bottom-0 w-0.5 bg-[var(--border-default)]" />
              {visibleSegments.map((segment, index) => (
                <div key={`${index}-${segment.slice(0, 24)}`} className="relative mb-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                  <div className="absolute -left-6 top-1 h-3 w-3 rounded-full border-2 border-[var(--accent-cyan)] bg-[var(--bg-elevated)]" />
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{segment}</ReactMarkdown>
                </div>
              ))}
            </div>
          </div>
          {hasHiddenSegments ? (
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAll((prev) => !prev)}
                className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
              >
                {showAll ? "Show less" : `Show ${segments.length - 12} more`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
