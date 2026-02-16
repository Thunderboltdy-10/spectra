"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/chat/rich-text";

export type FlashcardCard = {
  front: string;
  back: string;
  cardHash: string;
};

type FlashcardRevealProps = {
  content: string;
  onSaveDeck?: (payload: { title: string; cards: FlashcardCard[] }) => Promise<void> | void;
  onRateCard?: (payload: { cardHash: string; quality: number }) => Promise<void> | void;
};

function hashCard(front: string, back: string) {
  const input = `${front.trim().toLowerCase()}::${back.trim().toLowerCase()}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return `fc_${(hash >>> 0).toString(16)}`;
}

function parseFlashcards(content: string): FlashcardCard[] {
  const cards: FlashcardCard[] = [];
  const seen = new Set<string>();
  const normalized = content.replace(/\r/g, "");

  const inlinePairRegex = /(?:^|\n|\s)FRONT\s*:\s*([\s\S]*?)\s+BACK\s*:\s*([\s\S]*?)(?=(?:\s+FRONT\s*:)|$)/gi;
  for (const match of normalized.matchAll(inlinePairRegex)) {
    const front = (match[1] ?? "").replace(/\n{3,}/g, "\n\n").trim();
    const back = (match[2] ?? "").replace(/\n{3,}/g, "\n\n").trim();
    if (!front || !back) continue;
    const cardHash = hashCard(front, back);
    if (seen.has(cardHash)) continue;
    seen.add(cardHash);
    cards.push({ front, back, cardHash });
  }

  const lines = normalized.split("\n");
  let front: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const frontMatch = line.match(/^(?:[-*]\s*)?(?:Card\s*\d+\s*[:.)-]\s*)?FRONT\s*:\s*(.+)$/i);
    if (frontMatch) {
      front = frontMatch[1]?.trim() ?? null;
      continue;
    }
    const backMatch = line.match(/^(?:[-*]\s*)?BACK\s*:\s*(.+)$/i);
    if (backMatch && front) {
      const back = backMatch[1]?.trim() ?? "";
      if (front && back) {
        const cardHash = hashCard(front, back);
        if (!seen.has(cardHash)) {
          seen.add(cardHash);
          cards.push({
            front,
            back,
            cardHash,
          });
        }
      }
      front = null;
    }
  }

  return cards;
}

export function isFlashcardContent(content: string): boolean {
  return parseFlashcards(content).length >= 1;
}

function inferDeckTitle(cards: FlashcardCard[]) {
  const first = cards[0]?.front ?? "";
  const cleaned = first.replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Study Deck";
  const words = cleaned.split(" ").slice(0, 5).join(" ");
  return `${words} Deck`;
}

export function FlashcardReveal({ content, onSaveDeck, onRateCard }: FlashcardRevealProps) {
  const cards = useMemo(() => parseFlashcards(content), [content]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [showSummary, setShowSummary] = useState(false);
  const [busyRating, setBusyRating] = useState(false);
  const autoSavedRef = useRef(false);

  useEffect(() => {
    if (autoSavedRef.current || !onSaveDeck || cards.length === 0) return;
    autoSavedRef.current = true;
    void onSaveDeck({ title: inferDeckTitle(cards), cards });
  }, [cards, onSaveDeck]);

  if (cards.length === 0) return null;

  const current = cards[currentIndex];
  const total = cards.length;
  const knownCount = known.size;
  const title = inferDeckTitle(cards);

  function goNext() {
    setFlipped(false);
    if (currentIndex < total - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setShowSummary(true);
    }
  }

  function goPrev() {
    setFlipped(false);
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }

  async function handleRate(quality: number, markKnown: boolean) {
    if (!current || busyRating) return;
    setBusyRating(true);
    try {
      await onRateCard?.({
        cardHash: current.cardHash,
        quality,
      });
      setKnown((prev) => {
        const next = new Set(prev);
        if (markKnown) next.add(currentIndex);
        else next.delete(currentIndex);
        return next;
      });
      goNext();
    } finally {
      setBusyRating(false);
    }
  }

  function restart() {
    setCurrentIndex(0);
    setFlipped(false);
    setKnown(new Set());
    setShowSummary(false);
  }

  if (showSummary) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--mode-flashcard)] px-2.5 py-1 text-xs font-medium text-white">
            Flashcards Complete
          </span>
          <Button type="button" size="sm" variant="secondary" onClick={restart}>
            <RotateCcw className="h-3.5 w-3.5" />
            Restart
          </Button>
        </div>

        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 text-center shadow-[var(--shadow-card)]">
          <p className="text-3xl font-bold">
            {knownCount}/{total}
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {knownCount === total ? "You know all cards." : `${total - knownCount} card(s) still due`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--mode-flashcard)] px-2.5 py-1 text-xs font-medium text-white">
          {title}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">
          {currentIndex + 1}/{total}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-secondary)]">
          Known: {knownCount}/{total}
        </span>
      </div>

      <div className="flashcard-container" style={{ minHeight: 220 }}>
        <div
          className={`flashcard-inner cursor-pointer ${flipped ? "flipped" : ""}`}
          onClick={() => setFlipped((prev) => !prev)}
          style={{ minHeight: 220 }}
        >
          <div className="flashcard-front flex items-center justify-center rounded-[var(--radius-container)] border-2 border-[var(--mode-flashcard)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-card)]">
            <div className="text-center">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">Front - Tap to flip</p>
              <RichText content={current.front} className="text-lg font-medium" />
            </div>
          </div>
          <div className="flashcard-back flex items-center justify-center rounded-[var(--radius-container)] border-2 border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_4%,var(--bg-elevated))] p-6 shadow-[var(--shadow-card)]">
            <div className="text-center">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">Back - Tap to flip</p>
              <RichText content={current.back} className="text-lg font-medium" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={goPrev} disabled={currentIndex === 0}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {flipped ? (
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void handleRate(0, false)} disabled={busyRating}>
              Again
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleRate(2, false)} disabled={busyRating}>
              Hard
            </Button>
            <Button size="sm" onClick={() => void handleRate(4, true)} disabled={busyRating}>
              Good
            </Button>
            <Button size="sm" onClick={() => void handleRate(5, true)} disabled={busyRating}>
              Easy
            </Button>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-secondary)]">Flip card to rate recall</p>
        )}

        <Button variant="secondary" size="sm" onClick={goNext} disabled={currentIndex >= total - 1}>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex gap-1">
        {cards.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition ${
              i === currentIndex
                ? "bg-[var(--mode-flashcard)]"
                : known.has(i)
                  ? "bg-[var(--success)]"
                  : "bg-[var(--border-default)]"
            }`}
          />
        ))}
      </div>

      <div className="text-xs text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1">
          <Check className="h-3.5 w-3.5" />
          SM-2 ratings: Again(0), Hard(2), Good(4), Easy(5)
        </span>
      </div>
    </div>
  );
}
