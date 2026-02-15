"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { calculateNextReview } from "@/lib/spaced-repetition";

type DeckItem = {
  _id: string;
  title: string;
  cardCount: number;
  dueCount: number;
  updatedAt: number;
  lastReviewedAt?: number;
};

type DueCard = {
  deckId: string;
  deckTitle: string;
  front: string;
  back: string;
  cardHash: string;
  progress: {
    easeFactor: number;
    interval: number;
    repetitions: number;
    nextReviewAt: number;
  } | null;
};

const QUALITY_OPTIONS = [
  { label: "Again", value: 0 },
  { label: "Hard", value: 2 },
  { label: "Good", value: 4 },
  { label: "Easy", value: 5 },
];

export default function FlashcardsPage() {
  const [loading, setLoading] = useState(true);
  const [savingRating, setSavingRating] = useState(false);
  const [decks, setDecks] = useState<DeckItem[]>([]);
  const [dueCards, setDueCards] = useState<DueCard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const current = dueCards[index];
  const completed = index >= dueCards.length;

  async function loadData() {
    setLoading(true);
    try {
      const [deckRes, dueRes] = await Promise.all([
        fetch("/api/flashcards?action=list"),
        fetch("/api/flashcards?action=due"),
      ]);
      if (!deckRes.ok || !dueRes.ok) {
        throw new Error("Failed to load flashcards");
      }
      const deckPayload = (await deckRes.json()) as { decks?: DeckItem[] };
      const duePayload = (await dueRes.json()) as { cards?: DueCard[] };
      setDecks(deckPayload.decks ?? []);
      setDueCards(duePayload.cards ?? []);
      setIndex(0);
      setFlipped(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load flashcards");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const nextReviewHint = useMemo(() => {
    if (!current) return null;
    const baseline = current.progress ?? {
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: Date.now(),
    };
    const projected = calculateNextReview(4, baseline.easeFactor, baseline.interval, baseline.repetitions);
    return new Date(projected.nextReviewAt).toLocaleDateString();
  }, [current]);

  async function rateCurrent(quality: number) {
    if (!current || savingRating) return;
    setSavingRating(true);
    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rate_card",
          cardHash: current.cardHash,
          quality,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      setFlipped(false);
      setIndex((prev) => prev + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rate card");
    } finally {
      setSavingRating(false);
    }
  }

  return (
    <AppShell>
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl">Flashcard Review</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Review due cards with spaced repetition and track deck progress.
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={() => void loadData()}>
            <RotateCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Saved Decks</h2>
            {loading ? (
              <p className="text-sm text-[var(--text-secondary)]">Loading decks...</p>
            ) : decks.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">No saved decks yet. Generate flashcards in chat and save a deck.</p>
            ) : (
              <div className="space-y-2">
                {decks.map((deck) => (
                  <div
                    key={deck._id}
                    className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5"
                  >
                    <p className="text-sm font-medium text-[var(--text-primary)]">{deck.title}</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {deck.cardCount} cards • {deck.dueCount} due • updated {new Date(deck.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Due Review</h2>
            {loading ? (
              <p className="text-sm text-[var(--text-secondary)]">Loading due cards...</p>
            ) : dueCards.length === 0 || completed ? (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
                All due cards reviewed.
              </div>
            ) : current ? (
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.11em] text-[var(--text-secondary)]">
                  {current.deckTitle} • {index + 1}/{dueCards.length}
                </p>
                <button
                  type="button"
                  onClick={() => setFlipped((prev) => !prev)}
                  className="min-h-[220px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5 text-left"
                >
                  <p className="text-xs uppercase tracking-[0.11em] text-[var(--text-secondary)]">
                    {flipped ? "Back" : "Front"}
                  </p>
                  <p className="mt-3 text-base text-[var(--text-primary)]">{flipped ? current.back : current.front}</p>
                  <p className="mt-4 text-xs text-[var(--text-secondary)]">Tap to {flipped ? "hide" : "reveal"} answer</p>
                </button>
                {flipped ? (
                  <div className="flex flex-wrap gap-2">
                    {QUALITY_OPTIONS.map((option) => (
                      <Button
                        key={option.label}
                        type="button"
                        size="sm"
                        variant={option.value >= 4 ? "default" : "secondary"}
                        disabled={savingRating}
                        onClick={() => void rateCurrent(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <p className="text-xs text-[var(--text-secondary)]">Projected next review (Good): {nextReviewHint}</p>
              </div>
            ) : null}
          </article>
        </div>
      </section>
    </AppShell>
  );
}
