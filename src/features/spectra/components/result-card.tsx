"use client";

import { AlertCircle, CheckCircle2, Clock3, Loader2, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResultCardStreamView } from "../ai/stream-events";

export type ResultCardView = ResultCardStreamView;

function tone(card: ResultCardView) {
  if (card.status === "failed" || card.status === "cancelled") return "var(--danger)";
  if (card.status === "completed") return "var(--success)";
  if (card.actions.some((action) => action.key === "confirm")) return "#d88922";
  return "var(--accent-cyan)";
}

export function ResultCardStack({
  cards,
  className,
  onAction,
  onOpen,
}: {
  cards?: ResultCardView[];
  className?: string;
  onAction?: (card: ResultCardView, actionKey: string, targetId?: string) => void;
  onOpen?: (card: ResultCardView) => void;
}) {
  const visibleCards = cards?.slice(0, 12) ?? [];
  if (visibleCards.length === 0) return null;

  return (
    <div className={cn("relative max-h-[76px] overflow-y-auto rounded-[9px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_96%,var(--bg-primary))] shadow-[0_2px_9px_rgba(27,20,12,0.05)] [scrollbar-width:thin]", className)}>
      {visibleCards.map((card) => {
        const awaitingApproval = card.actions.some((action) => action.key === "confirm");
        return (
          <div
            key={card.id}
            role="button"
            tabIndex={0}
            className="group my-0.5 flex min-h-[35px] w-full cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 py-1 text-left text-[12px] transition hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-cyan)]"
            onClick={() => onOpen?.(card)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen?.(card); }}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,currentColor_10%,var(--bg-elevated))]" style={{ color: tone(card) }}>
              {card.status === "running" && !awaitingApproval ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : awaitingApproval ? <ShieldCheck className="h-3.5 w-3.5" /> : card.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : card.status === "failed" || card.status === "cancelled" ? <AlertCircle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="shrink-0 font-semibold text-[var(--text-primary)]">{card.title}</span>
                {card.summary ? <span className="truncate text-[var(--text-secondary)]">{card.summary}</span> : null}
              </span>
            </span>
            {card.actions.map((action) => (
              <button
                key={`${card.id}-${action.key}`}
                type="button"
                className={cn(
                  "h-7 shrink-0 rounded-[6px] border border-[var(--border-default)] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  action.key === "confirm" && "border-transparent bg-[var(--text-primary)] text-[var(--bg-primary)] hover:bg-[var(--text-primary)] hover:text-[var(--bg-primary)]",
                )}
                onClick={(event) => { event.stopPropagation(); onAction?.(card, action.key, action.targetId); }}
              >
                {action.label}
              </button>
            ))}
            <button type="button" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[var(--text-tertiary)] opacity-55 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] group-hover:opacity-100" aria-label="Hide result" onClick={(event) => { event.stopPropagation(); onAction?.(card, "hide"); }}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
