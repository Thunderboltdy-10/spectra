"use client";

import { AlertCircle, CheckCircle2, Clock3, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ResultCardView = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  title: string;
  summary?: string;
};

function tone(status: ResultCardView["status"]) {
  if (status === "failed" || status === "cancelled") return "var(--danger)";
  if (status === "completed") return "var(--success)";
  return "var(--accent-cyan)";
}

export function ResultCardStack({
  cards,
  className,
}: {
  cards?: ResultCardView[];
  className?: string;
}) {
  const visibleCards = cards?.slice(0, 3) ?? [];
  if (visibleCards.length === 0) return null;

  return (
    <div className={cn("space-y-1", className)}>
      {visibleCards.map((card) => (
        <button
          key={card.id}
          type="button"
          className="flex w-full items-center gap-2 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-left text-[12px] shadow-[0_2px_8px_rgba(27,20,12,0.04)]"
        >
          <span style={{ color: tone(card.status) }}>
            {card.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : card.status === "failed" || card.status === "cancelled" ? <AlertCircle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold text-[var(--text-primary)]">{card.title}</span>
            {card.summary ? <span className="text-[var(--text-secondary)]"> · {card.summary}</span> : null}
          </span>
          <X className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
        </button>
      ))}
    </div>
  );
}
