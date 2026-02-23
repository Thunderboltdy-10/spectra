"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractFlashcardPairs } from "@/lib/flashcard-format";

type Flashcard = {
  front: string;
  back: string;
};

function parseFlashcardsFromContent(content: string): Flashcard[] | null {
  const cards = extractFlashcardPairs(content).map((pair) => ({ front: pair.front, back: pair.back }));

  return cards.length >= 2 ? cards : null;
}

export function isFlashcardContent(content: string): boolean {
  return extractFlashcardPairs(content).length >= 1;
}

type FlashcardViewProps = {
  content: string;
};

export function FlashcardView({ content }: FlashcardViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [showSummary, setShowSummary] = useState(false);

  const cards = parseFlashcardsFromContent(content);
  if (!cards) return null;

  const current = cards[currentIndex];
  const total = cards.length;
  const knownCount = known.size;

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

  function markKnown() {
    setKnown((prev) => new Set(prev).add(currentIndex));
    goNext();
  }

  function markReview() {
    setKnown((prev) => {
      const next = new Set(prev);
      next.delete(currentIndex);
      return next;
    });
    goNext();
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
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--mode-flashcard)] px-2.5 py-1 text-xs font-medium text-white">
            Flashcards Complete
          </span>
        </div>

        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 text-center shadow-[var(--shadow-card)]">
          <p className="text-3xl font-bold">
            {knownCount}/{total}
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {knownCount === total ? "You know all cards!" : `${total - knownCount} card(s) to review`}
          </p>

          <div className="mt-4 flex justify-center gap-3">
            <div className="rounded-[var(--radius-input)] bg-[color-mix(in_oklab,var(--success)_12%,var(--bg-secondary))] px-3 py-2 text-sm">
              <span className="font-medium text-[var(--success)]">{knownCount}</span> known
            </div>
            <div className="rounded-[var(--radius-input)] bg-[color-mix(in_oklab,var(--warning)_12%,var(--bg-secondary))] px-3 py-2 text-sm">
              <span className="font-medium text-[var(--warning)]">{total - knownCount}</span> review
            </div>
          </div>

          <Button className="mt-4" onClick={restart}>
            <RotateCcw className="h-4 w-4" /> Start Over
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--mode-flashcard)] px-2.5 py-1 text-xs font-medium text-white">
          Card {currentIndex + 1} of {total}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">
          {knownCount} known
        </span>
      </div>

      <div className="flashcard-container" style={{ minHeight: 200 }}>
        <div
          className={`flashcard-inner cursor-pointer ${flipped ? "flipped" : ""}`}
          onClick={() => setFlipped((prev) => !prev)}
          style={{ minHeight: 200 }}
        >
          <div className="flashcard-front flex items-center justify-center rounded-[var(--radius-container)] border-2 border-[var(--mode-flashcard)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-card)]">
            <div className="text-center">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                Front - Tap to flip
              </p>
              <p className="text-lg font-medium">{current.front}</p>
            </div>
          </div>

          <div className="flashcard-back flex items-center justify-center rounded-[var(--radius-container)] border-2 border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_4%,var(--bg-elevated))] p-6 shadow-[var(--shadow-card)]">
            <div className="text-center">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                Back - Tap to flip
              </p>
              <p className="text-lg font-medium">{current.back}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={goPrev}
          disabled={currentIndex === 0}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={markReview}
            className="border-[var(--warning)] text-[var(--warning)]"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Review again
          </Button>
          <Button
            size="sm"
            onClick={markKnown}
            className="bg-[var(--success)] hover:bg-[color-mix(in_oklab,var(--success)_85%,black)]"
          >
            <Check className="h-3.5 w-3.5" /> I know this
          </Button>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={goNext}
          disabled={currentIndex >= total - 1}
        >
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
    </div>
  );
}
