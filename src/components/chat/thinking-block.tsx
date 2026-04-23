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
  const clean = content.trim();

  const hasTimeline = routeTrace?.phasePlan && routeTrace.phasePlan.length > 0;
  const hasSearchTrace = routeTrace?.searchTrace && routeTrace.searchTrace.strategy && routeTrace.searchTrace.strategy !== "none";
  const hasExecutionContent = hasTimeline || hasSearchTrace || clean || segments.length > 0;
  if (!hasExecutionContent) return null;

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
            <ExecutionTimeline
              routeTrace={routeTrace}
              thinkingContent={clean}
              thinkingSegments={segments}
              streaming={streaming}
            />
          </div>
        </motion.div>
      </details>
    </div>
  );
}
