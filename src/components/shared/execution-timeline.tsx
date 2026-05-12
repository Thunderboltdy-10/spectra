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
  SkipForward,
  GitBranch,
  Code2,
  Sparkles,
  CheckCircle2,
  Circle,
  Clock3,
  AlertTriangle,
  TerminalSquare,
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
  | "resource"
  | "tool"
  | "skill"
  | "artifact"
  | "workspace"
  | "worker"
  | "clarification"
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
  resultPreview?: unknown;
  error?: string;
  durationMs?: number;
  startedAt?: number;
  finishedAt?: number;
  children?: ExecutionEvent[];
  /** Raw content (e.g. thinking text) rendered as markdown */
  content?: string;
  /** Token counts for subcalls */
  inputTokens?: number;
  outputTokens?: number;
  meta?: string;
};

/* ─── Kind → Icon & Color Mapping ────────────────────── */

const KIND_META: Record<
  ExecutionEventKind,
  { icon: LucideIcon; tint: string; label: string }
> = {
  thinking: { icon: Brain, tint: "var(--accent-cyan)", label: "Thinking" },
  search: { icon: Search, tint: "var(--accent-mint, #20b8b2)", label: "Search" },
  memory: { icon: BookOpen, tint: "var(--accent-orange, #f59f0a)", label: "Memory" },
  resource: { icon: BookOpen, tint: "var(--accent-orange, #f59f0a)", label: "Resource" },
  tool: { icon: TerminalSquare, tint: "var(--accent-cyan)", label: "Tool" },
  skill: { icon: Wand2, tint: "var(--accent-coral, #e8553e)", label: "Skill" },
  artifact: { icon: Wand2, tint: "var(--accent-coral, #e8553e)", label: "Artifact" },
  workspace: { icon: Zap, tint: "var(--success, #158f72)", label: "Workspace" },
  worker: { icon: GitBranch, tint: "var(--accent-cyan)", label: "Worker" },
  clarification: { icon: BookOpen, tint: "var(--accent-orange, #f59f0a)", label: "Clarification" },
  action: { icon: Zap, tint: "var(--success, #158f72)", label: "Action" },
  synthesis: { icon: Sparkles, tint: "var(--accent-cyan)", label: "Synthesis" },
  routing: { icon: GitBranch, tint: "var(--text-secondary)", label: "Routing" },
  subcall: { icon: Code2, tint: "var(--accent-cyan)", label: "Model call" },
};

/* ─── Status Dot ─────────────────────────────────────── */

function StatusDot({ status, tint }: { status: ExecutionEventStatus; tint: string }) {
  if (status === "running") {
    return (
      <motion.span
        className="relative flex h-4 w-4 shrink-0 items-center justify-center"
        initial={false}
        animate={{ scale: 1 }}
      >
        <span
          className="absolute inset-0 rounded-full animate-ping opacity-35"
          style={{ background: tint }}
        />
        <span
          className="relative inline-flex h-2.5 w-2.5 rounded-full shadow-[0_0_16px_currentColor]"
          style={{ background: tint }}
        />
      </motion.span>
    );
  }
  if (status === "completed") {
    return (
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--success,#158f72)]" strokeWidth={2.2} />
    );
  }
  if (status === "failed") {
    return (
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--danger,#e8553e)]" strokeWidth={2.2} />
    );
  }
  if (status === "skipped") {
    return (
      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)]">
        <SkipForward className="h-2 w-2 text-[var(--text-tertiary)]" strokeWidth={3} />
      </span>
    );
  }
  // pending
  return (
    <Circle className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.8} />
  );
}

function formatStatus(status: ExecutionEventStatus) {
  if (status === "completed") return "done";
  return status;
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
  autoExpanded = false,
}: {
  event: ExecutionEvent;
  depth?: number;
  streaming?: boolean;
  defaultOpen?: boolean;
  autoExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(() => defaultOpen || event.status === "running");
  const meta = KIND_META[event.kind];
  const Icon = meta.icon;
  const hasChildren = event.children && event.children.length > 0;
  const hasContent = Boolean(event.content?.trim());
  const hasDetail = Boolean(event.detail?.trim());
  const hasStructuredPayload = event.resultPreview != null || Boolean(event.error?.trim());
  const expandable = hasChildren || hasContent || hasDetail || hasStructuredPayload;

  useEffect(() => {
    if (!streaming) return;
    if (autoExpanded && expandable) setExpanded(true);
    if (!autoExpanded && event.status !== "running") setExpanded(false);
  }, [autoExpanded, event.status, expandable, streaming]);

  return (
    <div className="relative">
      {/* Timeline connector line */}
      {depth === 0 && (
        <div className="absolute left-[7px] top-7 bottom-0 w-px bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--text-tertiary)_46%,transparent),color-mix(in_oklab,var(--text-tertiary)_16%,transparent),transparent)]" />
      )}

      <div className={cn("flex items-start gap-2.5 relative", depth > 0 && "ml-5")}>
        {/* Status indicator */}
        <div className="mt-[9px] shrink-0 rounded-full bg-[var(--bg-primary)] ring-2 ring-[var(--bg-primary)]">
          <StatusDot status={event.status} tint={meta.tint} />
        </div>

        {/* Event content */}
        <div
          className={cn(
            "min-w-0 flex-1 pb-2.5",
            depth === 0 && "px-2 transition-colors",
            event.status === "running" && "rounded-xl bg-[color-mix(in_oklab,var(--accent-cyan)_5%,transparent)]",
          )}
        >
          {/* Header row */}
          <div
            className={cn(
              "group/evt flex min-h-8 items-center gap-2 cursor-default select-none py-1 transition-colors",
              expandable && "cursor-pointer",
              expandable && "hover:text-[var(--text-primary)]"
            )}
            onClick={() => expandable && setExpanded((v) => !v)}
          >
            <Icon
              className="h-3.5 w-3.5 shrink-0 drop-shadow-[0_0_8px_color-mix(in_oklab,currentColor_40%,transparent)]"
              style={{ color: meta.tint }}
            />
            <span
              className={cn(
                "text-[13px] font-semibold leading-tight truncate",
                event.status === "running" && streaming
                  ? "stream-glow-text"
                  : event.status === "running"
                  ? "text-[var(--text-primary)]"
                  : event.status === "completed"
                  ? "text-[var(--text-secondary)]"
                  : "text-[var(--text-tertiary)]"
              )}
            >
              {event.label}
            </span>

            {/* Status badge */}
            {event.meta ? (
              <span className="hidden shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)] sm:inline-flex">
                {event.meta}
              </span>
            ) : null}

            {event.status === "running" && streaming ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-cyan)]">
                <span className="h-1 w-1 rounded-full bg-[var(--accent-cyan)] animate-pulse" />
                live
              </span>
            ) : (
              <span className="hidden shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-tertiary)] sm:inline">
                {formatStatus(event.status)}
              </span>
            )}

            {/* Duration */}
            {(event.durationMs != null || (event.startedAt && event.finishedAt)) && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] tabular-nums">
                <Clock3 className="h-3 w-3" />
                <DurationChip ms={event.durationMs ?? (event.finishedAt! - event.startedAt!)} />
              </span>
            )}

            {/* Token counts for subcalls */}
            {(event.inputTokens != null || event.outputTokens != null) && (
              <span className="text-xs text-[var(--text-tertiary)] tabular-nums">
                {event.inputTokens != null && `${event.inputTokens.toLocaleString()}→`}
                {event.outputTokens != null && `${event.outputTokens.toLocaleString()}`}
              </span>
            )}

            {/* Expand chevron */}
            {expandable && (
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform duration-200",
                  expanded && "rotate-180"
                )}
              />
            )}
          </div>

          {/* Preview when collapsed */}
          {hasContent && !expanded && (
            <div className="pl-5 pb-1">
              <div className="text-xs leading-relaxed text-[var(--text-tertiary)] line-clamp-1">
                {event.content!.trim().slice(0, 120).replace(/[#*_`]/g, "")}
                {event.content!.trim().length > 120 ? "…" : ""}
              </div>
            </div>
          )}

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
                    <p className="rounded-lg border border-[var(--border-default)]/70 bg-[var(--bg-secondary)] px-2.5 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                      {event.detail}
                    </p>
                  )}
                  {event.error ? (
                    <p className="rounded-lg border border-[color-mix(in_oklab,var(--danger,#e8553e)_35%,transparent)] bg-[color-mix(in_oklab,var(--danger,#e8553e)_8%,transparent)] px-2.5 py-2 text-xs leading-relaxed text-[var(--danger,#e8553e)]">
                      {event.error}
                    </p>
                  ) : null}
                  {event.resultPreview != null ? (
                    <pre className="max-h-44 overflow-auto rounded-lg border border-[var(--border-default)]/70 bg-[var(--bg-primary)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      {typeof event.resultPreview === "string"
                        ? event.resultPreview
                        : JSON.stringify(event.resultPreview, null, 2)}
                    </pre>
                  ) : null}
                  {hasContent && (
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border-default)]/70 bg-[var(--bg-secondary)] px-3 py-2">
                      <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
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
                        autoExpanded={autoExpanded && child.status === "running"}
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
    resultPreview: event.resultPreview,
    error: event.error,
    content: event.content,
    startedAt: event.startedAt,
    finishedAt: event.finishedAt,
    durationMs: event.durationMs,
    meta: event.toolName,
  };
}

export function routeTraceToExecutionEvents(trace: RouteTrace, streaming: boolean): ExecutionEvent[] {
  if (trace.executionEvents && trace.executionEvents.length > 0) {
    return trace.executionEvents
      .map(traceExecutionEventToExecutionEvent)
      .filter((event) => event.kind !== "routing");
  }
  const events: ExecutionEvent[] = [];
  const routingPhase = trace.phasePlan?.find((phase) =>
    phase.id === "routing"
    || phase.id === "planning"
    || /\b(route|routing|select|plan)\b/i.test(phase.label),
  );
  const shouldShowStandaloneRouting = false;
  const rawRoutingStatus = routingPhase
    ? phaseStatusToEventStatus(routingPhase.status)
    : (streaming && !trace.routingDurationMs ? "running" : "completed");
  const routingStatus = !streaming && rawRoutingStatus === "running" ? "completed" : rawRoutingStatus;

  // Routing is shown only when no real routing phase exists. This fallback is
  // derived from the route trace itself; it avoids decorative "thinking" copy.
  if (shouldShowStandaloneRouting) {
    events.push({
      id: `route-${trace.selected.modelId}`,
      kind: "routing",
      label: "Model selected",
      status: routingStatus,
      detail: trace.selected.reason,
      durationMs: trace.routingDurationMs,
      meta: trace.selected.modelId.split("/").pop(),
    });
  }

  // Phase plan events
  if (trace.phasePlan && trace.phasePlan.length > 0) {
    for (const phase of trace.phasePlan) {
      if (phase.status === "planned") continue;
      if (phase.id === "routing" || phase.id === "modelSelection") continue;

      // Find subcalls for this phase
      const phaseSubcalls = trace.subcalls?.filter(
        (sc) => sc.phaseId === phase.id
      );
      const normalizedStatus: ExecutionEventStatus =
        !streaming && phase.status === "running"
          ? "completed"
          : phaseStatusToEventStatus(phase.status);

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
        label:
          phase.id === "analysis"
            ? "Runtime operations"
            : phase.id === "authoring"
              ? "Answer stream"
              : phase.label,
        status: normalizedStatus,
        detail: phase.detail,
        durationMs:
          phase.startedAt && phase.finishedAt
            ? phase.finishedAt - phase.startedAt
            : undefined,
        startedAt: phase.startedAt,
        finishedAt: phase.finishedAt,
        meta: phase.model?.split("/").pop(),
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
    const rawSearchStatus: ExecutionEventStatus = searchPhase
      ? phaseStatusToEventStatus(searchPhase.status)
      : anyCompleted
        ? "completed"
        : anyFailed
          ? (streaming ? "running" : "failed")
          : allSkipped
            ? "skipped"
            : (streaming ? "running" : "pending");
    
    const searchStatus = !streaming && rawSearchStatus === "running" ? "completed" : rawSearchStatus;
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
      label: "Search activity",
      status: searchStatus,
      detail: trace.searchTrace.fallbackReason,
      meta: trace.searchTrace.strategy,
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
  thinkingSegments?: Array<{ id: string; label: string; content: string; status: string }>;
  /** Whether the AI is currently streaming */
  streaming?: boolean;
  /** Compact mode — shows only active/completed events in a tighter layout */
  compact?: boolean;
  /** Only render explicit runtime execution events; do not derive phase/search fallbacks. */
  realEventsOnly?: boolean;
  /** Limit the number of rendered events, keeping the most recent entries. */
  maxVisible?: number;
  /** Optional class name */
  className?: string;
};

export function ExecutionTimeline({
  events: directEvents,
  routeTrace,
  thinkingContent,
  thinkingSegments = [],
  streaming = false,
  compact = false,
  realEventsOnly = false,
  maxVisible,
  className,
}: ExecutionTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  // Build events from routeTrace or use direct events
  const events = useMemo(() => {
    if (directEvents && directEvents.length > 0) return directEvents;
    if (!routeTrace && !thinkingContent && thinkingSegments.length === 0) return [] as ExecutionEvent[];

    const traceEvents = routeTrace
      ? realEventsOnly
        ? routeTrace.executionEvents?.map(traceExecutionEventToExecutionEvent) ?? []
        : routeTraceToExecutionEvents(routeTrace, streaming)
      : [];

    let thinkingEvents: ExecutionEvent[] = [];

    // Prioritize explicit segments over raw thinkingContent
    const realThinkingSegments = thinkingSegments.filter((seg) => isRenderableThinking(seg.content));
    if (realThinkingSegments.length > 0) {
      thinkingEvents = realThinkingSegments.map((seg, i) => {
        const isLast = i === realThinkingSegments.length - 1;
        const firstLine = seg.content.split("\n")[0]?.replace(/^[#>*\-\d.\s]+/, "").trim() ?? "";
        const label = firstLine.length > 0 && firstLine.length <= 70
          ? firstLine
          : firstLine.length > 70
            ? `${firstLine.slice(0, 67)}…`
            : `Runtime update ${i + 1}`;
        return {
          id: `thinking-seg-${seg.id || i}`,
          kind: "thinking" as const,
          label,
          status: (streaming && isLast) ? "running" as const : "completed" as const,
          content: seg.content,
        };
      });
    } else if (isRenderableThinking(thinkingContent)) {
      const chunks = (thinkingContent ?? "").split(/(?:\r?\n){2,}/).map(s => s.trim()).filter(Boolean);
      thinkingEvents = chunks.map((chunk, i) => ({
        id: `thinking-chunk-${i}`,
        kind: "thinking" as const,
        label: "Provider reasoning",
        status: (streaming && i === chunks.length - 1) ? "running" as const : "completed" as const,
        content: chunk,
      }));
    }

    if (thinkingEvents.length > 0) {
      const existingThinkIdx = traceEvents.findIndex(e => e.kind === "thinking" && !e.id.startsWith("thinking-"));
      if (existingThinkIdx >= 0) {
         traceEvents.splice(existingThinkIdx, 1, ...thinkingEvents);
      } else {
         traceEvents.unshift(...thinkingEvents);
      }
    }

    return traceEvents;
  }, [directEvents, routeTrace, thinkingContent, thinkingSegments, streaming, realEventsOnly]);

  const visibleEvents = useMemo(() => {
    if (!maxVisible || maxVisible <= 0 || events.length <= maxVisible) return events;
    return events.slice(-maxVisible);
  }, [events, maxVisible]);

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
  }, [visibleEvents, streaming]);

  if (visibleEvents.length === 0) return null;

  return (
    <div
      className={cn(
        "execution-timeline",
        compact ? "space-y-1 py-1" : "space-y-2 py-2",
        className
      )}
    >
      {/* Timeline header — only show when streaming or has running events */}
      <div
        ref={scrollRef}
        className={cn(
          compact ? "max-h-40" : "max-h-[28rem]",
          "overflow-y-auto space-y-0 pr-1"
        )}
      >
        <AnimatePresence initial={false}>
          {visibleEvents.map((event, idx) => {
            const lastRunningIndex = visibleEvents.map((item) => item.status).lastIndexOf("running");
            const autoExpanded = lastRunningIndex >= 0 ? idx === lastRunningIndex : idx === visibleEvents.length - 1 && streaming;
            return (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <ExecutionEventRow
                event={event}
                streaming={streaming}
                defaultOpen={autoExpanded}
                autoExpanded={autoExpanded}
              />
            </motion.div>
          )})}
        </AnimatePresence>
      </div>
    </div>
  );
}

function isRenderableThinking(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return false;
  const withoutPunctuation = trimmed.replace(/[.\s…·•\-_*`]+/g, "");
  return withoutPunctuation.length >= 2;
}
