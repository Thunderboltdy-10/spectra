"use client";

import { useRef, useEffect, useMemo, useState } from "react";
import { Brain, ChevronDown, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { ExecutionTimeline } from "@/components/shared/execution-timeline";
import type { RouteTrace } from "@/types";


type ThinkingBlockProps = {
  content: string;
  streaming?: boolean;
  routeTrace?: RouteTrace;
  segments?: Array<{ id: string; label: string; content: string; status: string }>;
};

export function ThinkingBlock({ content, streaming = false, routeTrace, segments = [] }: ThinkingBlockProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const clean = content.trim();
  const normalizedSegments = useMemo(
    () => segments.filter((segment) => segment.content.trim().length > 0),
    [segments],
  );
  const [openSegmentId, setOpenSegmentId] = useState<string | null>(
    normalizedSegments[normalizedSegments.length - 1]?.id ?? null,
  );

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

  useEffect(() => {
    if (normalizedSegments.length === 0) return;
    const running = normalizedSegments.find((segment) => segment.status === "running");
    if (running) {
      setOpenSegmentId(running.id);
      return;
    }
    setOpenSegmentId(normalizedSegments[normalizedSegments.length - 1]?.id ?? null);
  }, [normalizedSegments]);

  const hasTimeline = routeTrace?.phasePlan && routeTrace.phasePlan.length > 0;
  const hasSearchTrace = routeTrace?.searchTrace && routeTrace.searchTrace.strategy && routeTrace.searchTrace.strategy !== "none";
  const hasExecutionContent = hasTimeline || hasSearchTrace;
  if (!clean && !hasExecutionContent) return null;

  return (
    <div className="mb-4">
      <details className="group [&_summary::-webkit-details-marker]:hidden" open>
        <summary className="flex w-max cursor-pointer items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)] transition hover:text-[var(--text-secondary)] select-none">
          <Brain className="h-3 w-3" />
          {streaming ? "Thinking & Executing" : "Execution Trace"}
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
          <div className="space-y-2">
            {normalizedSegments.length > 0 ? (
              <div ref={scrollRef} className="space-y-2">
                {normalizedSegments.map((segment) => {
                  const isOpen = openSegmentId === segment.id;
                  const isRunning = segment.status === "running";
                  return (
                    <div key={segment.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]/55">
                      <button
                        type="button"
                        onClick={() => setOpenSegmentId((current) => current === segment.id ? null : segment.id)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                      >
                        <span className="text-[11px] font-medium text-[var(--text-secondary)]">{segment.label}</span>
                        <span className="flex items-center gap-2">
                          {isRunning ? (
                            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--accent-cyan)]">live</span>
                          ) : null}
                          <ChevronDown className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition ${isOpen ? "rotate-180" : ""}`} />
                        </span>
                      </button>
                      {isOpen ? (
                        <div className="border-t border-[var(--border-default)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                          {segment.content}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
            <ExecutionTimeline
              routeTrace={routeTrace}
              thinkingContent={normalizedSegments.length === 0 ? clean : undefined}
              streaming={streaming}
            />
          </div>
        </motion.div>
      </details>
    </div>
  );
}
