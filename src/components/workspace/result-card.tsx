"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
  FileText,
  Code2,
  Image,
  CalendarCheck,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Action Type Taxonomy ────────────────────────────── */

export type ResultActionType =
  | "created"
  | "modified"
  | "answered"
  | "generated"
  | "searched"
  | "planned";

const ACTION_META: Record<
  ResultActionType,
  { label: string; icon: LucideIcon; tint: string }
> = {
  created: {
    label: "Created",
    icon: FileText,
    tint: "var(--accent-cyan)",
  },
  modified: {
    label: "Modified",
    icon: Wand2,
    tint: "var(--accent-orange, #f59f0a)",
  },
  answered: {
    label: "Answered",
    icon: Sparkles,
    tint: "var(--accent-cyan)",
  },
  generated: {
    label: "Generated",
    icon: Code2,
    tint: "color-mix(in oklab, var(--accent-cyan) 70%, #ba4f26)",
  },
  searched: {
    label: "Found",
    icon: Image,
    tint: "var(--accent-mint, #20b8b2)",
  },
  planned: {
    label: "Planned",
    icon: CalendarCheck,
    tint: "var(--success, #158f72)",
  },
};

/* ─── Result Card Props ───────────────────────────────── */

export type ResultCardState = "loading" | "done" | "dismissed" | "error";

export type ResultCardData = {
  id: string;
  state: ResultCardState;
  promptSnippet: string;
  summary?: string;
  actionType?: ResultActionType;
  targetId?: string;
  createdAt: number;
};

type ResultCardProps = {
  id?: string;
  state: ResultCardState;
  promptSnippet: string;
  summary?: string;
  actionType?: ResultActionType;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onDismiss?: () => void;
  onReopen?: () => void;
  className?: string;
  /** When true the card renders in compact stacked mode */
  stacked?: boolean;
};

/* ─── Progress Shimmer ────────────────────────────────── */

function LoadingShimmer() {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-[18px] pointer-events-none">
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmer_2s_ease-in-out_infinite]"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--accent-cyan) 6%, transparent) 40%, color-mix(in oklab, var(--accent-cyan) 12%, transparent) 50%, color-mix(in oklab, var(--accent-cyan) 6%, transparent) 60%, transparent 100%)",
        }}
      />
    </div>
  );
}

/* ─── Completion Checkmark ────────────────────────────── */

function CompletionCheck({ visible }: { visible: boolean }) {
  return (
    <div
      className={cn(
        "absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full transition-all duration-300",
        visible
          ? "scale-100 opacity-100 bg-[var(--success,#158f72)] shadow-[0_2px_8px_-2px_rgba(21,143,114,0.5)]"
          : "scale-0 opacity-0 bg-transparent",
      )}
    >
      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
    </div>
  );
}

/* ─── Main Result Card ────────────────────────────────── */

export function ResultCard({
  id,
  state,
  promptSnippet,
  summary,
  actionType = "answered",
  onClick,
  onDoubleClick,
  onDismiss,
  onReopen,
  className,
  stacked = false,
}: ResultCardProps) {
  const meta = ACTION_META[actionType];
  const ActionIcon = meta.icon;
  const [justCompleted, setJustCompleted] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Brief highlight flash when transitioning from loading → done
  useEffect(() => {
    if (state === "done") {
      setJustCompleted(true);
      const timeout = setTimeout(() => setJustCompleted(false), 1200);
      return () => clearTimeout(timeout);
    }
  }, [state]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss?.();
    },
    [onDismiss],
  );

  const handleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpanded((prev) => !prev);
    },
    [],
  );

  if (state === "dismissed") {
    // Dismissed card — compact reopen pill
    return (
      <button
        type="button"
        onClick={onReopen}
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5",
          "border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/80 backdrop-blur-lg",
          "text-[11px] font-medium text-[var(--text-tertiary)] transition-all duration-200",
          "hover:border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] hover:text-[var(--text-secondary)] hover:shadow-[0_6px_16px_-10px_rgba(8,22,40,0.16)]",
          className,
        )}
      >
        <RotateCcw className="h-3 w-3" />
        <span className="max-w-[160px] truncate">{promptSnippet}</span>
      </button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-result-card-id={id}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick?.();
      }}
      className={cn(
        "group relative flex items-start gap-3 rounded-[18px] border text-left",
        "border-[var(--border-default)]/45 bg-[var(--bg-elevated)]/96 backdrop-blur-xl",
        "transition-all duration-300 ease-[var(--ease-standard)]",
        // Sizing
        stacked
          ? "w-[min(480px,calc(100vw-240px))] px-3 py-2"
          : "w-[min(540px,calc(100vw-220px))] px-4 py-3.5",
        // Hover lift
        "hover:-translate-y-0.5 hover:shadow-[0_20px_48px_-20px_rgba(8,22,40,0.28)]",
        // Loading subtle pulse border
        state === "loading" &&
          "border-[color-mix(in_oklab,var(--accent-cyan)_18%,var(--border-default))]",
        // Completion flash
        justCompleted &&
          "border-[color-mix(in_oklab,var(--success,#158f72)_30%,var(--border-default))] shadow-[0_20px_48px_-20px_rgba(21,143,114,0.18)]",
        // Normal done state
        state === "done" &&
          !justCompleted &&
          "shadow-[0_16px_40px_-20px_rgba(8,22,40,0.24)]",
        // Error state
        state === "error" &&
          "border-[color-mix(in_oklab,var(--accent-coral,#e8553e)_25%,var(--border-default))]",
        className,
      )}
    >
      {/* Loading shimmer overlay */}
      {state === "loading" && <LoadingShimmer />}

      {/* Completion check badge */}
      <CompletionCheck visible={justCompleted} />

      {/* Action icon */}
      <div
        className={cn(
          "relative mt-0.5 flex shrink-0 items-center justify-center rounded-xl transition-all duration-300",
          stacked ? "h-7 w-7" : "h-8 w-8",
        )}
        style={{
          backgroundColor: `color-mix(in oklab, ${meta.tint} 10%, var(--bg-secondary))`,
          color: meta.tint,
        }}
      >
        {state === "loading" ? (
          <Loader2
            className={cn(
              "animate-spin",
              stacked ? "h-3.5 w-3.5" : "h-4 w-4",
            )}
          />
        ) : (
          <ActionIcon
            className={cn(stacked ? "h-3.5 w-3.5" : "h-4 w-4")}
          />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Action badge + status */}
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: `color-mix(in oklab, ${meta.tint} 80%, transparent)` }}
          >
            {state === "loading" ? "Processing" : state === "error" ? "Failed" : meta.label}
          </span>
          {state === "done" && (
            <span className="text-[9px] text-[var(--text-tertiary)]/40 font-medium">
              just now
            </span>
          )}
        </div>

        {/* Prompt snippet */}
        <div
          className={cn(
            "mt-0.5 font-medium text-[var(--text-primary)]",
            stacked ? "truncate text-[12px]" : "line-clamp-1 text-[13px]",
          )}
        >
          {promptSnippet}
        </div>

        {/* Summary — expandable */}
        {summary && (
          <p
            className={cn(
              "mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)] transition-all duration-200",
              expanded ? "" : "line-clamp-2",
            )}
          >
            {summary}
          </p>
        )}
      </div>

      {/* Card controls (visible on hover) */}
      <div className="flex shrink-0 flex-col items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        {onDismiss && state === "done" && (
          <button
            type="button"
            onClick={handleDismiss}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {summary && summary.length > 100 && (
          <button
            type="button"
            onClick={handleExpand}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Result Card Stack ───────────────────────────────── */

type ResultCardStackProps = {
  cards: ResultCardData[];
  onCardClick?: (card: ResultCardData) => void;
  onCardDoubleClick?: (card: ResultCardData) => void;
  onDismiss?: (cardId: string) => void;
  onReopen?: (cardId: string) => void;
  maxVisible?: number;
};

export function ResultCardStack({
  cards,
  onCardClick,
  onCardDoubleClick,
  onDismiss,
  onReopen,
  maxVisible = 3,
}: ResultCardStackProps) {
  if (cards.length === 0) return null;

  const visibleCards = cards.filter((c) => c.state !== "dismissed");
  const dismissedCards = cards.filter((c) => c.state === "dismissed");
  const shown = visibleCards.slice(0, maxVisible);
  const overflow = visibleCards.length - maxVisible;

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* Stacked visible cards */}
      {shown.map((card, idx) => (
        <div
          key={card.id}
          className="transition-all duration-300"
          style={{
            // Subtle stacking depth effect
            transform:
              idx > 0
                ? `scale(${1 - idx * 0.015})`
                : undefined,
            opacity: idx > 1 ? 0.85 : 1,
          }}
        >
          <ResultCard
            id={card.id}
            state={card.state}
            promptSnippet={card.promptSnippet}
            summary={card.summary}
            actionType={card.actionType}
            stacked={shown.length > 1}
            onClick={() => onCardClick?.(card)}
            onDoubleClick={() => onCardDoubleClick?.(card)}
            onDismiss={onDismiss ? () => onDismiss(card.id) : undefined}
            onReopen={onReopen ? () => onReopen(card.id) : undefined}
          />
        </div>
      ))}

      {/* Overflow indicator */}
      {overflow > 0 && (
        <span className="text-[10px] font-medium text-[var(--text-tertiary)]/50">
          +{overflow} more
        </span>
      )}

      {/* Dismissed card reopeners */}
      {dismissedCards.length > 0 && (
        <div className="flex items-center gap-1.5">
          {dismissedCards.slice(0, 3).map((card) => (
            <ResultCard
              key={card.id}
              id={card.id}
              state="dismissed"
              promptSnippet={card.promptSnippet}
              onReopen={onReopen ? () => onReopen(card.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
