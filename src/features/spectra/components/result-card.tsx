"use client";

import { AlertCircle, CheckCircle2, Clock3, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ResultCardView = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  title: string;
  summary?: string;
  meta?: string;
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
    <div className={cn("relative max-h-[92px] space-y-1 overflow-y-auto rounded-[10px] [mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%-10px),transparent)]", className)}>
      {visibleCards.map((card) => (
        <button
          key={card.id}
          type="button"
          className="group flex w-full items-center gap-3 rounded-[8px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_94%,var(--bg-primary))] px-3 py-2 text-left text-[12px] shadow-[0_2px_8px_rgba(27,20,12,0.04)] transition duration-150 hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--text-tertiary)_35%,var(--border-default))]"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,currentColor_10%,var(--bg-elevated))]" style={{ color: tone(card.status) }}>
            {card.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : card.status === "failed" || card.status === "cancelled" ? <AlertCircle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
          </span>
          <span className="grid min-w-0 flex-1 grid-cols-[minmax(130px,0.7fr)_minmax(180px,1fr)_auto] items-center gap-3">
            <span className="truncate font-semibold text-[var(--text-primary)]">{card.title}</span>
            {card.summary ? <span className="truncate text-[var(--text-secondary)]">{card.summary}</span> : <span />}
            <span className="hidden text-[11px] text-[var(--text-tertiary)] sm:inline">{card.meta}</span>
          </span>
          <X className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] opacity-55 transition group-hover:opacity-100" />
        </button>
      ))}
    </div>
  );
}
