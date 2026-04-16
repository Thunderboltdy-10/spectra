"use client";

import { useEffect, useMemo, useRef } from "react";
import { Brain, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ThinkingBlockProps = {
  content: string;
  streaming?: boolean;
};

export function ThinkingBlock({ content, streaming = false }: ThinkingBlockProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const startTimeRef = useRef<number>(0);
  const elapsedRef = useRef(0);
  const clean = content.trim();

  // Elapsed timer while streaming (stored in ref, not state — avoids re-renders)
  useEffect(() => {
    if (!streaming) return;
    startTimeRef.current = Date.now();
    elapsedRef.current = 0;
    const interval = setInterval(() => {
      elapsedRef.current = Math.floor((Date.now() - startTimeRef.current) / 1000);
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
  }, [segments, streaming]);

  if (!clean) return null;

  return (
    <details className="mb-3 group [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex w-max cursor-pointer items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)] transition hover:text-[var(--text-secondary)] select-none">
        <Brain className="h-3 w-3" />
        {streaming ? "Thinking…" : "Thinking Process"}
        {streaming ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] ml-1">
            <Sparkles className="h-2 w-2 animate-pulse" />
            live
          </span>
        ) : null}
      </summary>
      <div className="mt-2 ml-1.5 border-l-2 border-[var(--border-default)] pl-3">
        <div ref={scrollRef} className="max-h-48 overflow-y-auto pr-1 space-y-2 py-1">
          {segments.map((segment, index) => (
            <div key={`${index}-${segment.slice(0, 24)}`} className="text-[11px] leading-relaxed text-[var(--text-tertiary)] opacity-90">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{segment}</ReactMarkdown>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
