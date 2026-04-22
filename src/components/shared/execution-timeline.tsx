"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Search,
  BookOpen,
  Wand2,
  Cog,
  Zap,
  ChevronDown,
  Loader2,
  Check,
  X,
  SkipForward,
  GitBranch,
  Code2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type {
  RouteTrace,
  RouteTraceExecutionEvent,
  RouteTracePhase,
  RouteTracePhaseStatus,
} from "@/types";

/* ─── Execution Event Types ──────────────────────────── */

export type ExecutionEventKind =
  | "thinking"
  | "search"
  | "memory"
  | "tool"
  | "skill"
  | "action"
  | "synthesis"
  | "routing"
  | "subcall";

export type ExecutionEventStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type ExecutionEvent = {
  id: string;
  kind: ExecutionEventKind;
  label: string;
  status: ExecutionEventStatus;
  detail?: string;
  durationMs?: number;
  startedAt?: number;
  finishedAt?: number;
  children?: ExecutionEvent[];
  /** Raw content (e.g. thinking text) rendered as markdown */
  content?: string;
  /** Token counts for subcalls */
  inputTokens?: number;
  outputTokens?: number;
};

/* ─── Kind → Icon & Color Mapping ────────────────────── */

const KIND_META: Record<
  ExecutionEventKind,
  { icon: LucideIcon; tint: string; label: string }
> = {
  thinking: { icon: Brain, tint: "var(--accent-cyan)", label: "Thinking" },
  search: { icon: Search, tint: "var(--accent-mint, #20b8b2)", label: "Search" },
  memory: { icon: BookOpen, tint: "var(--accent-orange, #f59f0a)", label: "Memory" },
  tool: { icon: Cog, tint: "var(--accent-cyan)", label: "Tool" },
  skill: { icon: Wand2, tint: "var(--accent-coral, #e8553e)", label: "Skill" },
  action: { icon: Zap, tint: "var(--success, #158f72)", label: "Action" },
  synthesis: { icon: Sparkles, tint: "var(--accent-cyan)", label: "Synthesis" },
  routing: { icon: GitBranch, tint: "var(--text-secondary)", label: "Route" },
  subcall: { icon: Code2, tint: "var(--accent-cyan)", label: "Sub-call" },
};

/* ─── Status Dot ─────────────────────────────────────── */

function StatusDot({ status, tint }: { status: ExecutionEventStatus; tint: string }) {
  if (status === "running") {
    return (
      <motion.span
        className="relative flex h-2.5 w-2.5 shrink-0"
        initial={false}
        animate={{ scale: 1 }}
      >
        <span
          className="absolute inset-0 rounded-full animate-ping opacity-40"
          style={{ background: tint }}
        />
        <span
          className="relative inline-flex h-2.5 w-2.5 rounded-full"
          style={{ background: tint }}
        />
      </motion.span>
    );
  }
  if (status === "completed") {
    return (
      <span
        className="inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--success, #158f72)" }}
      >
        <Check className="h-1.5 w-1.5 text-white" strokeWidth={3} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full bg-[var(--danger, #e8553e)]">
        <X className="h-1.5 w-1.5 text-white" strokeWidth={3} />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full bg-[var(--text-tertiary)]/30">
        <SkipForward className="h-1.5 w-1.5 text-[var(--text-tertiary)]" strokeWidth={3} />
      </span>
    );
  }
  // pending
  return (
    <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)]" />
  );
}

/* ─── Duration Chip ──────────────────────────────────── */

function DurationChip({ ms }: { ms?: number }) {
  if (ms == null || ms <= 0) return null;
  if (ms < 1000) return <span className="tabular-nums">{ms}ms</span>;
  return <span className="tabular-nums">{(ms / 1000).toFixed(1)}s</span>;
}

/* ─── Execution Event Row ────────────────────────────── */

function ExecutionEventRow({
  event,
  depth = 0,
  streaming = false,
  defaultOpen = false,
}: {
  event: ExecutionEvent;
  depth?: number;
  streaming?: boolean;
  defaultOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(
    defaultOpen || event.status === "running" || !!streaming
  );
  const meta = KIND_META[event.kind];
  const Icon = meta.icon;
  const hasChildren = event.children && event.children.length > 0;
  const hasContent = Boolean(event.content?.trim());
  const hasDetail = Boolean(event.detail?.trim());
  const expandable = hasChildren || hasContent || hasDetail;

  return (
    <div className="relative">
      {/* Timeline connector line */}
      {depth === 0 && (
        <div className="absolute left-[5px] top-3 bottom-0 w-px bg-[var(--border-default)]/50" />
      )}

      <div className={cn("flex items-start gap-2.5 relative", depth > 0 && "ml-4")}>
        {/* Status indicator */}
        <div className="mt-[5px] shrink-0">
          <StatusDot status={event.status} tint={meta.tint} />
        </div>

        {/* Event content */}
        <div className="min-w-0 flex-1 pb-2">
          {/* Header row */}
          <div
            className={cn(
              "flex items-center gap-2 cursor-pointer select-none group/evt",
              expandable && "hover:bg-[var(--bg-hover)]/40 -mx-1 px-1 rounded-md transition-colors"
            )}
            onClick={() => expandable && setExpanded((v) => !v)}
          >
            <Icon
              className="h-3 w-3 shrink-0"
              style={{ color: meta.tint }}
            />
            <span
              className={cn(
                "text-[11px] font-semibold leading-tight",
                event.status === "running"
                  ? "text-[var(--text-primary)]"
                  : event.status === "completed"
                  ? "text-[var(--text-secondary)]"
                  : "text-[var(--text-tertiary)]"
              )}
            >
              {event.label}
            </span>

            {/* Status badge */}
            {event.status === "running" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] px-1.5 py-[1px] text-[9px] font-medium text-[var(--accent-cyan)]">
                <Loader2 className="h-2 w-2 animate-spin" />
                live
              </span>
            )}

            {/* Duration */}
            {(event.durationMs != null || (event.startedAt && event.finishedAt)) && (
              <span className="text-[9px] text-[var(--text-tertiary)] tabular-nums">
                <DurationChip ms={event.durationMs ?? (event.finishedAt! - event.startedAt!)} />
              </span>
            )}

            {/* Token counts for subcalls */}
            {(event.inputTokens != null || event.outputTokens != null) && (
              <span className="text-[9px] text-[var(--text-tertiary)] tabular-nums">
                {event.inputTokens != null && `${event.inputTokens.toLocaleString()}→`}
                {event.outputTokens != null && `${event.outputTokens.toLocaleString()}`}
              </span>
            )}

            {/* Expand chevron */}
            {expandable && (
              <ChevronDown
                className={cn(
                  "h-3 w-3 text-[var(--text-tertiary)] transition-transform duration-200",
                  expanded && "rotate-180"
                )}
              />
            )}
          </div>

          {/* Expandable detail/content */}
          <AnimatePresence initial={false}>
            {expanded && expandable && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-1.5 ml-1 space-y-1.5">
                  {hasDetail && !hasContent && (
                    <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                      {event.detail}
                    </p>
                  )}
                  {hasContent && (
                    <div className="max-h-48 overflow-y-auto pr-1 rounded-md bg-[var(--bg-secondary)]/50 border border-[var(--border-default)]/30 p-2">
                      <div className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {event.content!.trim()}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                  {hasChildren &&
                    event.children!.map((child) => (
                      <ExecutionEventRow
                        key={child.id}
                        event={child}
                        depth={depth + 1}
                        streaming={streaming}
                      />
                    ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ─── RouteTrace → ExecutionEvent conversion ─────────── */

function phaseStatusToEventStatus(status: RouteTracePhaseStatus): ExecutionEventStatus {
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  return "pending";
}

function inferEventKind(phase: RouteTracePhase): ExecutionEventKind {
  const label = phase.label.toLowerCase();
  if (label.includes("think") || label.includes("reason")) return "thinking";
  if (label.includes("search") || label.includes("web")) return "search";
  if (label.includes("memory") || label.includes("recall")) return "memory";
  if (label.includes("tool") || label.includes("execut")) return "tool";
  if (label.includes("skill")) return "skill";
  if (label.includes("synthesis") || label.includes("compos")) return "synthesis";
  if (label.includes("route") || label.includes("select")) return "routing";
  return "action";
}

function traceExecutionEventToExecutionEvent(event: RouteTraceExecutionEvent): ExecutionEvent {
  return {
    id: event.id,
    kind: event.kind === "notice" ? "action" : event.kind,
    label: event.label,
    status: phaseStatusToEventStatus(event.status),
    detail: event.detail,
    content: event.content,
    startedAt: event.startedAt,
    finishedAt: event.finishedAt,
    durationMs: event.durationMs,
  };
}

function routeTraceToEvents(trace: RouteTrace, streaming: boolean): ExecutionEvent[] {
  if (trace.executionEvents && trace.executionEvents.length > 0) {
    return trace.executionEvents.map(traceExecutionEventToExecutionEvent);
  }
  const events: ExecutionEvent[] = [];
  const routingPhase = trace.phasePlan?.find((phase) =>
    phase.id === "routing"
    || phase.id === "planning"
    || /\b(route|routing|select|plan)\b/i.test(phase.label),
  );
  const shouldShowStandaloneRouting = !routingPhase;
  const routingStatus = routingPhase
    ? phaseStatusToEventStatus(routingPhase.status)
    : (streaming && !trace.routingDurationMs ? "running" : "completed");

  // Routing as first event
  if (shouldShowStandaloneRouting) {
    events.push({
      id: `route-${trace.selected.modelId}`,
      kind: "routing",
      label: `Routed → ${trace.selected.modelId.split("/").pop()}`,
      status: routingStatus,
      detail: trace.selected.reason,
      durationMs: trace.routingDurationMs,
    });
  }

  // Phase plan events
  if (trace.phasePlan && trace.phasePlan.length > 0) {
    for (const phase of trace.phasePlan) {
      // Find subcalls for this phase
      const phaseSubcalls = trace.subcalls?.filter(
        (sc) => sc.phaseId === phase.id
      );

      const children: ExecutionEvent[] = (phaseSubcalls ?? []).map((sc) => ({
        id: sc.id,
        kind: "subcall" as ExecutionEventKind,
        label: sc.label,
        status: (sc.status === "ok" ? "completed" : "failed") as ExecutionEventStatus,
        detail: sc.reason,
        durationMs: sc.durationMs,
        inputTokens: sc.inputTokens,
        outputTokens: sc.outputTokens,
      }));

      events.push({
        id: phase.id,
        kind: inferEventKind(phase),
        label: phase.label,
        status: phaseStatusToEventStatus(phase.status),
        detail: phase.detail,
        durationMs:
          phase.startedAt && phase.finishedAt
            ? phase.finishedAt - phase.startedAt
            : undefined,
        startedAt: phase.startedAt,
        finishedAt: phase.finishedAt,
        children: children.length > 0 ? children : undefined,
      });
    }
  }

  // Search trace
  if (trace.searchTrace && trace.searchTrace.strategy && trace.searchTrace.strategy !== "none") {
    const searchPhase = trace.phasePlan?.find((phase) =>
      phase.id === "search"
      || phase.id === "retrieval"
      || /\b(search|retriev)\b/i.test(phase.label),
    );
    const operations = trace.searchTrace.operations ?? [];
    const anyCompleted = operations.some((op) => op.status === "completed");
    const anyFailed = operations.some((op) => op.status === "failed");
    const allSkipped = operations.length > 0 && operations.every((op) => op.status === "skipped");
    const searchStatus: ExecutionEventStatus = searchPhase
      ? phaseStatusToEventStatus(searchPhase.status)
      : anyCompleted
        ? "completed"
        : anyFailed
          ? (streaming ? "running" : "failed")
          : allSkipped
            ? "skipped"
            : (streaming ? "running" : "pending");
    const searchChildren: ExecutionEvent[] = (trace.searchTrace.operations ?? []).map((op, idx) => ({
      id: `search-op-${idx}`,
      kind: (op.tool === "search" ? "search" : "tool") as ExecutionEventKind,
      label: `${op.tool}${op.query ? `: ${op.query.slice(0, 60)}` : ""}`,
      status: (op.status === "completed" ? "completed" : op.status === "failed" ? "failed" : "skipped") as ExecutionEventStatus,
      durationMs: op.durationMs,
      detail: op.reason,
    }));

    events.push({
      id: "search-trace",
      kind: "search",
      label: `Search · ${trace.searchTrace.strategy}`,
      status: searchStatus,
      detail: trace.searchTrace.fallbackReason,
      children: searchChildren.length > 0 ? searchChildren : undefined,
    });
  }

  return events;
}

/* ─── Public Component ───────────────────────────────── */

export type ExecutionTimelineProps = {
  /** Direct execution events */
  events?: ExecutionEvent[];
  /** Or derive from a RouteTrace */
  routeTrace?: RouteTrace;
  /** Thinking content to attach as a "thinking" event */
  thinkingContent?: string;
  /** Whether the AI is currently streaming */
  streaming?: boolean;
  /** Compact mode — shows only active/completed events in a tighter layout */
  compact?: boolean;
  /** Optional class name */
  className?: string;
};

export function ExecutionTimeline({
  events: directEvents,
  routeTrace,
  thinkingContent,
  streaming = false,
  compact = false,
  className,
}: ExecutionTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  // Build events from routeTrace or use direct events
  const events = useMemo(() => {
    if (directEvents && directEvents.length > 0) return directEvents;
    if (!routeTrace) return [] as ExecutionEvent[];

    const traceEvents = routeTraceToEvents(routeTrace, streaming);

    // Inject thinking content as a thinking event if present
    if (thinkingContent?.trim()) {
      const existingThinkIdx = traceEvents.findIndex(
        (e) => e.kind === "thinking"
      );
      if (existingThinkIdx >= 0) {
        traceEvents[existingThinkIdx] = {
          ...traceEvents[existingThinkIdx],
          content: thinkingContent,
        };
      } else {
        // Prepend thinking event
        traceEvents.unshift({
          id: "thinking-content",
          kind: "thinking",
          label: "Thinking",
          status: streaming ? "running" : "completed",
          content: thinkingContent,
        });
      }
    }

    return traceEvents;
  }, [directEvents, routeTrace, thinkingContent, streaming]);

  // Auto-scroll management
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
  }, [events, streaming]);

  if (events.length === 0) return null;

  const hasRunning = events.some((e) => e.status === "running");

  return (
    <div
      className={cn(
        "execution-timeline",
        compact ? "space-y-1" : "space-y-2",
        className
      )}
    >
      {/* Timeline header — only show when streaming or has running events */}
      {hasRunning && (
        <div className="flex items-center gap-2 mb-2">
          <div className="h-px flex-1 bg-gradient-to-r from-[var(--accent-cyan)]/30 via-[var(--border-default)]/50 to-transparent" />
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-cyan)] animate-pulse">
            Executing
          </span>
          <div className="h-px flex-1 bg-gradient-to-l from-[var(--accent-cyan)]/30 via-[var(--border-default)]/50 to-transparent" />
        </div>
      )}

      <div
        ref={scrollRef}
        className={cn(
          compact ? "max-h-32" : "max-h-64",
          "overflow-y-auto space-y-0 pr-1"
        )}
      >
        {events.map((event, idx) => (
          <ExecutionEventRow
            key={event.id}
            event={event}
            streaming={streaming}
            defaultOpen={idx === events.length - 1 && streaming}
          />
        ))}
      </div>
    </div>
  );
}
