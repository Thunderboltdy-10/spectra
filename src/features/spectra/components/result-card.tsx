"use client";

import { CheckCircle2, Clock3, ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type ResultCardView = {
  id: string;
  status: "running" | "completed" | "failed";
  title: string;
  summary: string;
  actions?: string[];
};

export function ResultCard({ card }: { card: ResultCardView }) {
  const Icon = card.status === "completed" ? CheckCircle2 : Clock3;
  return (
    <article className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-2 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]",
            card.status === "completed"
              ? "bg-[color-mix(in_oklab,var(--success)_12%,var(--bg-secondary))] text-[var(--success)]"
              : "bg-[color-mix(in_oklab,var(--accent-cyan)_12%,var(--bg-secondary))] text-[var(--accent-cyan)]",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{card.title}</h3>
            <p className="truncate text-[11.5px] text-[var(--text-secondary)]">{card.summary}</p>
          </div>
          {card.actions?.length ? (
            <div className="hidden shrink-0 gap-1.5 sm:flex">
              {card.actions.slice(0, 2).map((action) => (
                <button
                  key={action}
                  type="button"
                  className="inline-flex h-6 items-center gap-1 rounded-[6px] border border-[var(--border-default)] px-2 text-[10.5px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  {action}
                  <ExternalLink className="h-3 w-3" />
                </button>
              ))}
            </div>
          ) : null}
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Hide result"
            >
              <X className="h-3.5 w-3.5" />
            </button>
        </div>
      </div>
    </article>
  );
}

export function ResultCardStack({ className }: { className?: string }) {
  const stackRef = useRef<HTMLDivElement | null>(null);
  const cards: ResultCardView[] = [
    {
      id: "seed-run-1",
      status: "completed",
      title: "Flashcard deck drafted",
      summary: "Created one deck artifact from selected Biology notes.",
      actions: ["Open", "Details"],
    },
    {
      id: "seed-run-2",
      status: "running",
      title: "Reviewing workspace context",
      summary: "Checking recent artifacts and pinned thread references.",
      actions: ["Stop"],
    },
  ];

  useEffect(() => {
    const node = stackRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [cards.length]);

  return (
    <div
      ref={stackRef}
      className={cn(
        "relative max-h-[104px] space-y-1.5 overflow-y-auto rounded-[14px] border border-[var(--border-default)] bg-[var(--bg-primary)]/55 p-1.5 shadow-[0_10px_32px_-24px_rgba(8,22,40,0.35)]",
        "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-5 after:bg-[linear-gradient(to_top,var(--bg-primary),transparent)]",
        className,
      )}
    >
      {cards.map((card) => (
        <ResultCard key={card.id} card={card} />
      ))}
    </div>
  );
}
