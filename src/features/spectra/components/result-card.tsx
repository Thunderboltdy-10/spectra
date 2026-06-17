"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type ResultCardView = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  variant?: "status" | "artifact" | "thread" | "operation" | "error";
  title: string;
  summary?: string;
  actions?: Array<{ key: string; label: string }>;
};

function statusTone(status: ResultCardView["status"]) {
  if (status === "completed") return "var(--success)";
  if (status === "failed" || status === "cancelled") return "var(--danger)";
  return "var(--accent-cyan)";
}

export function ResultCard({ card }: { card: ResultCardView }) {
  const tone = statusTone(card.status);

  return (
    <article className="group rounded-[8px] border border-[color-mix(in_oklab,var(--border-default)_84%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_94%,var(--bg-primary))] px-2.5 py-2 shadow-[0_10px_28px_-24px_rgba(8,22,40,0.48)] transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent-cyan)_30%,var(--border-default))]">
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px]"
          style={{
            color: tone,
            background: `color-mix(in oklab, ${tone} 12%, var(--bg-secondary))`,
          }}
        >
          {card.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
          {card.status === "failed" || card.status === "cancelled" ? <AlertCircle className="h-3.5 w-3.5" /> : null}
          {card.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {card.status === "queued" ? <Clock3 className="h-3.5 w-3.5" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{card.title}</h3>
            <span className="hidden text-[10.5px] capitalize text-[var(--text-tertiary)] sm:inline">{card.status}</span>
          </div>
          {card.summary ? (
            <p className="truncate text-[11.5px] text-[var(--text-secondary)]">{card.summary}</p>
          ) : null}
        </div>
        {card.actions?.length ? (
          <button
            type="button"
            className="hidden h-6 items-center gap-1 rounded-[6px] px-2 text-[10.5px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] sm:inline-flex"
          >
            {card.actions[0]?.label}
            <ChevronRight className="h-3 w-3" />
          </button>
        ) : null}
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] opacity-70 transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] group-hover:opacity-100"
          aria-label="Hide result"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}

export function ResultCardStack({
  cards,
  className,
}: {
  cards: ResultCardView[];
  className?: string;
}) {
  const stackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = stackRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [cards.length]);

  if (cards.length === 0) {
    return (
      <div className={cn("rounded-[16px] border border-dashed border-[color-mix(in_oklab,var(--border-default)_80%,transparent)] bg-[var(--bg-primary)]/42 px-3 py-2 text-[11.5px] font-medium text-[var(--text-tertiary)] backdrop-blur-xl", className)}>
        No recent workspace activity.
      </div>
    );
  }

  return (
    <div
      ref={stackRef}
      className={cn(
        "relative max-h-[126px] space-y-1.5 overflow-y-auto rounded-[18px] border border-[color-mix(in_oklab,var(--border-default)_76%,transparent)] bg-[var(--bg-primary)]/58 p-1.5 shadow-[0_18px_42px_-34px_rgba(8,22,40,0.55)] backdrop-blur-xl",
        "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-5 before:bg-[linear-gradient(to_bottom,var(--bg-primary),transparent)]",
        "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-5 after:bg-[linear-gradient(to_top,var(--bg-primary),transparent)]",
        className,
      )}
    >
      {cards.map((card) => (
        <ResultCard key={card.id} card={card} />
      ))}
    </div>
  );
}
