"use client";

import { useMemo, useState } from "react";

type Card = { front: string; back: string };

type FlashcardRevealProps = {
  content: string;
};

function parseFlashcards(content: string): Card[] {
  const lines = content.split("\n");
  const cards: Card[] = [];
  let front: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const frontMatch = line.match(/^FRONT\s*:\s*(.+)$/i);
    if (frontMatch) {
      front = frontMatch[1]!.trim();
      continue;
    }
    const backMatch = line.match(/^BACK\s*:\s*(.+)$/i);
    if (backMatch && front) {
      cards.push({ front, back: backMatch[1]!.trim() });
      front = null;
    }
  }

  return cards;
}

export function FlashcardReveal({ content }: FlashcardRevealProps) {
  const cards = useMemo(() => parseFlashcards(content), [content]);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  if (cards.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((card, index) => {
        const flipped = Boolean(open[index]);
        return (
          <button
            key={`${card.front}-${index}`}
            type="button"
            onClick={() => setOpen((prev) => ({ ...prev, [index]: !flipped }))}
            className="min-h-[170px] rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-left shadow-[var(--shadow-soft)] transition hover:-translate-y-0.5"
          >
            <p className="text-[10px] uppercase tracking-[0.11em] text-[var(--text-secondary)]">{flipped ? "Back" : "Front"}</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-primary)]">
              {flipped ? card.back : card.front}
            </p>
            <p className="mt-3 text-xs text-[var(--text-secondary)]">Tap to {flipped ? "hide" : "reveal"}</p>
          </button>
        );
      })}
    </div>
  );
}
