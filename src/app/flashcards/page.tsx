"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Layers, RotateCcw, Shuffle, Trash2 } from "lucide-react";
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
  nextReviewAt?: number;
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
] as const;

function shuffleCards(items: DueCard[]) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export default function FlashcardsPage() {
  const [loading, setLoading] = useState(true);
  const [savingRating, setSavingRating] = useState(false);
  const [decks, setDecks] = useState<DeckItem[]>([]);
  const [dueCards, setDueCards] = useState<DueCard[]>([]);
  const [deckCards, setDeckCards] = useState<DueCard[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [reviewQueue, setReviewQueue] = useState<DueCard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const reviewSectionRef = useRef<HTMLElement | null>(null);

  const reviewScopeLabel = selectedDeckId ? "Selected deck" : "Due across all decks";
  const activeCards = selectedDeckId ? deckCards : dueCards;

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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load flashcards");
    } finally {
      setLoading(false);
    }
  }

  async function loadDeckCards(deckId: string) {
    try {
      const response = await fetch(`/api/flashcards?action=due&deckId=${encodeURIComponent(deckId)}&includeAll=true&limit=500`);
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { cards?: DueCard[] };
      setDeckCards(payload.cards ?? []);
      setSelectedDeckId(deckId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load deck cards");
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const nextQueue = shuffle ? shuffleCards(activeCards) : [...activeCards];
    setReviewQueue(nextQueue);
    setIndex(0);
    setFlipped(false);
  }, [activeCards, selectedDeckId, shuffle]);

  const current = reviewQueue[index];
  const completed = reviewQueue.length === 0 || index >= reviewQueue.length;

  const selectedDeck = useMemo(
    () => decks.find((deck) => deck._id === selectedDeckId) ?? null,
    [decks, selectedDeckId],
  );
  const dueNowCount = useMemo(
    () =>
      dueCards.filter((card) => {
        const nextReviewAt = card.progress?.nextReviewAt ?? 0;
        return nextReviewAt <= Date.now();
      }).length,
    [dueCards],
  );

  const projectedDates = useMemo(() => {
    if (!current) return [] as Array<{ label: string; date: string }>;
    const baseline = current.progress ?? {
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: Date.now(),
    };
    return QUALITY_OPTIONS.map((option) => {
      const next = calculateNextReview(option.value, baseline.easeFactor, baseline.interval, baseline.repetitions);
      return {
        label: option.label,
        date: new Date(next.nextReviewAt).toLocaleDateString(),
      };
    });
  }, [current]);

  async function rateCurrent(quality: number) {
    if (!current || savingRating) return;
    const ratedCardHash = current.cardHash;
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
      setReviewQueue((prev) => {
        const next = prev.filter((_, idx) => idx !== index);
        const nextIndex = Math.min(index, Math.max(0, next.length - 1));
        setIndex(nextIndex);
        return next;
      });
      if (selectedDeckId) {
        setDeckCards((prev) => prev.filter((card) => card.cardHash !== ratedCardHash));
      }
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rate card");
    } finally {
      setSavingRating(false);
    }
  }

  async function deleteDeck(deckId: string) {
    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_deck", deckId }),
      });
      if (!response.ok) throw new Error(await response.text());
      if (selectedDeckId === deckId) {
        setSelectedDeckId(null);
        setDeckCards([]);
      }
      await loadData();
      toast.success("Deck removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete deck");
    }
  }

  function startDueReview() {
    setSelectedDeckId(null);
    setDeckCards([]);
    setIndex(0);
    setFlipped(false);
    reviewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">Flashcard Studio</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Auto-saved decks, shuffle review, and spaced repetition scheduling.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setShuffle((prev) => !prev)}>
              <Shuffle className="h-4 w-4" />
              {shuffle ? "Shuffle on" : "Shuffle off"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void loadData()}>
              <RotateCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        <section className="relative overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 sm:p-5">
          <div
            className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle at center, color-mix(in oklab, var(--mode-flashcard) 50%, transparent), transparent 68%)" }}
          />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">Due for review</p>
              <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
                {dueNowCount > 0 ? `${dueNowCount} card${dueNowCount === 1 ? "" : "s"} ready now` : "You are caught up for now"}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {dueNowCount > 0
                  ? "Start a due-card session to reinforce retention with SM-2 spacing."
                  : "No cards are currently due. Rate more cards to schedule the next reviews."}
              </p>
            </div>
            <Button type="button" onClick={startDueReview} disabled={dueNowCount === 0}>
              Start Review
            </Button>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Saved Decks</h2>
              <span className="text-xs text-[var(--text-secondary)]">{decks.length} total</span>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedDeckId(null);
                  setDeckCards([]);
                }}
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                  !selectedDeckId
                    ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)]"
                    : "border-[var(--border-default)] bg-[var(--bg-secondary)]"
                }`}
              >
                <p className="font-medium">Due review queue</p>
                <p className="text-xs text-[var(--text-secondary)]">{dueCards.length} cards due now</p>
              </button>

              {loading ? (
                <p className="text-sm text-[var(--text-secondary)]">Loading decks...</p>
              ) : decks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--border-default)] p-3 text-sm text-[var(--text-secondary)]">
                  No decks yet. Generate flashcards in chat and they save automatically.
                </p>
              ) : (
                decks.map((deck) => (
                  <div key={deck._id} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                    <button
                      type="button"
                      onClick={() => void loadDeckCards(deck._id)}
                      className="w-full text-left"
                    >
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{deck.title}</p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {deck.cardCount} cards • {deck.dueCount} due • updated {new Date(deck.updatedAt).toLocaleDateString()}
                      </p>
                    </button>
                    <div className="mt-2 flex items-center justify-between">
                      <Button type="button" size="sm" variant="secondary" onClick={() => void loadDeckCards(deck._id)}>
                        <Layers className="h-3.5 w-3.5" />
                        Review
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-[var(--danger)]"
                        onClick={() => void deleteDeck(deck._id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          <article ref={reviewSectionRef} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{selectedDeck?.title ?? "Due Review"}</h2>
              <p className="text-xs text-[var(--text-secondary)]">{reviewScopeLabel}</p>
            </div>

            {completed ? (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-6 text-center">
                <p className="text-lg font-semibold text-[var(--text-primary)]">All done for this round</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {selectedDeckId ? "This deck has no remaining cards in the current queue." : "No cards are currently due."}
                </p>
              </div>
            ) : current ? (
              <div className="space-y-4">
                <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                  {current.deckTitle} • {index + 1}/{reviewQueue.length}
                </p>

                <button
                  type="button"
                  onClick={() => setFlipped((prev) => !prev)}
                  className="min-h-[320px] w-full rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-6 text-left transition hover:border-[var(--accent-cyan)]"
                >
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                    {flipped ? "Back" : "Front"}
                  </p>
                  <p className="mt-5 text-xl font-semibold text-[var(--text-primary)]">
                    {flipped ? current.back : current.front}
                  </p>
                  <p className="mt-6 text-xs text-[var(--text-secondary)]">Click to {flipped ? "hide" : "reveal"} answer</p>
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

                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                    Spaced review projection
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {projectedDates.map((item) => (
                      <div key={item.label} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2">
                        <p className="text-xs text-[var(--text-secondary)]">{item.label}</p>
                        <p className="text-sm font-medium text-[var(--text-primary)]">{item.date}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </article>
        </div>
      </section>
    </AppShell>
  );
}
