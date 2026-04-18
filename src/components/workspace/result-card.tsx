"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Loader2,
  RotateCcw,
  X,
  FileText,
  Code2,
  CalendarCheck,
  Wand2,
  Search,
  MessageSquare,
  AlertCircle,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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
  { verb: string; icon: LucideIcon; tint: string }
> = {
  created: {
    verb: "Created",
    icon: FileText,
    tint: "var(--accent-cyan)",
  },
  modified: {
    verb: "Modified",
    icon: Wand2,
    tint: "var(--accent-orange, #f59f0a)",
  },
  answered: {
    verb: "Sent to thread",
    icon: MessageSquare,
    tint: "var(--text-secondary)",
  },
  generated: {
    verb: "Generated",
    icon: Code2,
    tint: "var(--accent-cyan)",
  },
  searched: {
    verb: "Found",
    icon: Search,
    tint: "var(--accent-mint, #20b8b2)",
  },
  planned: {
    verb: "Planned",
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
  /** If set, the target item type for navigating to it */
  targetItemType?: string;
  createdAt: number;
};

type ResultCardProps = {
  id?: string;
  state: ResultCardState;
  promptSnippet: string;
  summary?: string;
  actionType?: ResultActionType;
  targetId?: string;
  targetItemType?: string;
  onClick?: () => void;
  onDismiss?: () => void;
  onReopen?: () => void;
  className?: string;
  stacked?: boolean;
};

/* ─── Shimmer Bar (loading animation) ────────────────── */

function ShimmerBar() {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--accent-cyan) 8%, transparent) 50%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "shimmerBg 2s infinite linear",
        }}
      />
    </div>
  );
}

/* ─── Island Result Card ──────────────────────────────── */

export function ResultCard({
  id,
  state,
  promptSnippet,
  summary,
  actionType = "answered",
  targetId,
  onClick,
  onDismiss,
  onReopen,
  className,
  stacked = false,
}: ResultCardProps) {
  const meta = ACTION_META[actionType];
  const ActionIcon = meta.icon;
  const [justCompleted, setJustCompleted] = useState(false);

  useEffect(() => {
    if (state === "done") {
      setJustCompleted(true);
      const timeout = setTimeout(() => setJustCompleted(false), 800);
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

  if (state === "dismissed") {
    return (
      <motion.button
        type="button"
        onClick={onReopen}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
          "border-[var(--border-default)]/25 bg-[var(--bg-elevated)]/80 backdrop-blur-lg",
          "text-[10px] font-medium text-[var(--text-tertiary)] transition-all duration-200",
          "hover:border-[var(--border-default)]/40 hover:text-[var(--text-secondary)]",
          className,
        )}
      >
        <RotateCcw className="h-2.5 w-2.5" />
        <span className="max-w-[140px] truncate">{summary || promptSnippet}</span>
      </motion.button>
    );
  }

  const isClickable = state === "done" && targetId && targetId !== "workspace-chat";
  const isError = state === "error";
  const isLoading = state === "loading";

  return (
    <motion.div
      layout
      layoutId={id ? `island-${id}` : undefined}
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
          type: "spring",
          stiffness: 350,
          damping: 28,
          mass: 0.8,
        },
      }}
      exit={{ opacity: 0, y: -10, scale: 0.95, transition: { duration: 0.2 } }}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      data-result-card-id={id}
      onClick={isClickable ? onClick : undefined}
      onKeyDown={(e) => {
        if (isClickable && e.key === "Enter") onClick?.();
      }}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-2xl text-left",
        "w-[min(480px,calc(100vw-200px))]",
        // Island aesthetic: prominent shadow + rounded corners + glass
        "border bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
        stacked ? "px-3 py-2" : "px-3.5 py-2.5",
        // Island shadow — deep, floating feel
        isLoading
          ? "shadow-[0_8px_32px_-10px_rgba(14,142,232,0.18),0_2px_8px_-4px_rgba(14,142,232,0.10)] border-[color-mix(in_oklab,var(--accent-cyan)_15%,var(--border-default))]"
          : "shadow-[0_12px_36px_-14px_rgba(8,22,40,0.22),0_4px_14px_-8px_rgba(8,22,40,0.12)] border-[var(--border-default)]/30",
        // Completion flash
        justCompleted && "shadow-[0_12px_36px_-14px_rgba(21,143,114,0.22)] border-[color-mix(in_oklab,var(--success,#158f72)_25%,var(--border-default))]",
        // Error state
        isError && "shadow-[0_12px_36px_-14px_rgba(232,85,62,0.18)] border-[color-mix(in_oklab,var(--accent-coral,#e8553e)_20%,var(--border-default))]",
        // Clickable hover
        isClickable && "cursor-pointer hover:shadow-[0_16px_44px_-14px_rgba(8,22,40,0.28)] hover:border-[var(--border-default)]/50 hover:-translate-y-[1px] active:translate-y-0",
        className,
      )}
    >
      {/* Shimmer for loading */}
      {isLoading && <ShimmerBar />}

      {/* Status icon */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl transition-all duration-300",
          isLoading && "bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-secondary))]",
          !isLoading && "bg-[var(--bg-secondary)]/50",
        )}
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />
        ) : isError ? (
          <AlertCircle className="h-3.5 w-3.5 text-[var(--accent-coral,#e8553e)]" />
        ) : justCompleted ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
          >
            <Check className="h-3.5 w-3.5 text-[var(--success,#158f72)]" />
          </motion.div>
        ) : (
          <ActionIcon className="h-3.5 w-3.5" style={{ color: meta.tint }} />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 relative z-10">
        <p className={cn(
          "truncate text-[12px] font-medium",
          isError ? "text-[var(--accent-coral,#e8553e)]" : "text-[var(--text-primary)]",
        )}>
          {isLoading ? promptSnippet : (summary || promptSnippet)}
        </p>
        {isLoading && (
          <p className="mt-0.5 text-[10px] text-[var(--accent-cyan)]/50">
            Generating…
          </p>
        )}
        {state === "done" && summary && summary !== promptSnippet && (
          <p className="mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">
            {promptSnippet}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5 relative z-10">
        {isClickable && (
          <span className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100">
            <ExternalLink className="h-3 w-3" />
          </span>
        )}
        {onDismiss && (state === "done" || isError) && (
          <button
            type="button"
            onClick={handleDismiss}
            className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-tertiary)]/0 transition-colors group-hover:text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Bottom progress bar for loading */}
      {isLoading && (
        <div className="absolute bottom-0 left-4 right-4 h-[2px] overflow-hidden rounded-full">
          <div
            className="h-full w-1/3 animate-[slideRight_1.5s_ease-in-out_infinite] rounded-full bg-[var(--accent-cyan)]/30"
          />
        </div>
      )}
    </motion.div>
  );
}

/* ─── Result Card Stack (Island Cluster) ──────────────── */

type ResultCardStackProps = {
  cards: ResultCardData[];
  onCardClick?: (card: ResultCardData) => void;
  onDismiss?: (cardId: string) => void;
  onReopen?: (cardId: string) => void;
  maxVisible?: number;
};

export function ResultCardStack({
  cards,
  onCardClick,
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
    <div className="flex flex-col items-center gap-2">
      <AnimatePresence mode="popLayout">
        {shown.map((card, idx) => (
          <motion.div
            key={card.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: {
                type: "spring",
                stiffness: 320,
                damping: 26,
                mass: 0.7,
                delay: idx * 0.05,
              },
            }}
            exit={{
              opacity: 0,
              y: 8,
              scale: 0.94,
              transition: { duration: 0.2 },
            }}
            style={{
              /* Staggered island depth: each card floats slightly higher */
              zIndex: shown.length - idx,
            }}
          >
            <ResultCard
              id={card.id}
              state={card.state}
              promptSnippet={card.promptSnippet}
              summary={card.summary}
              actionType={card.actionType}
              targetId={card.targetId}
              targetItemType={card.targetItemType}
              stacked={shown.length > 1}
              onClick={() => onCardClick?.(card)}
              onDismiss={onDismiss ? () => onDismiss(card.id) : undefined}
              onReopen={onReopen ? () => onReopen(card.id) : undefined}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Dismissed pills — only show the most recent */}
      <AnimatePresence>
        {dismissedCards.length > 0 && visibleCards.length === 0 && (
          <ResultCard
            key={dismissedCards[0].id}
            id={dismissedCards[0].id}
            state="dismissed"
            promptSnippet={dismissedCards[0].promptSnippet}
            summary={dismissedCards[0].summary}
            onReopen={onReopen ? () => onReopen(dismissedCards[0].id) : undefined}
          />
        )}
      </AnimatePresence>

      {overflow > 0 && (
        <span className="text-[9px] font-medium text-[var(--text-tertiary)]/40">
          +{overflow} more
        </span>
      )}
    </div>
  );
}
