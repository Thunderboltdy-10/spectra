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
  { label: "Again (~1 day)", value: 0, className: "border-[var(--danger)] text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_10%,var(--bg-primary))]" },
  { label: "Hard (~2 days)", value: 2, className: "border-[var(--warning)] text-[var(--warning)] hover:bg-[color-mix(in_oklab,var(--warning)_10%,var(--bg-primary))]" },
  { label: "Good (~5 days)", value: 4, className: "bg-[var(--success)] text-white hover:bg-[color-mix(in_oklab,var(--success)_85%,black)]" },
  { label: "Easy (~9 days)", value: 5, className: "border-[var(--accent-cyan)] text-[var(--accent-cyan)] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-primary))]" },
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
  const [refreshSpinning, setRefreshSpinning] = useState(false);
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

  function toggleShuffle() {
    setShuffle((prev) => {
      const next = !prev;
      toast.success(next ? "Shuffle enabled" : "Shuffle disabled");
      return next;
    });
  }

  async function refreshDecks() {
    setRefreshSpinning(true);
    await loadData();
    window.setTimeout(() => setRefreshSpinning(false), 550);
  }

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <section className="space-y-6">
        <div data-tour="flashcards-header" className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">Flashcard Studio</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Auto-saved decks, shuffle review, and spaced repetition scheduling.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={toggleShuffle}>
              <Shuffle className="h-4 w-4" />
              {shuffle ? "Shuffle on" : "Shuffle off"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void refreshDecks()}>
              <RotateCcw className={`h-4 w-4 ${refreshSpinning ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              {dueNowCount > 0 ? `${dueNowCount} card${dueNowCount === 1 ? "" : "s"} due for review` : "You are caught up"}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {dueNowCount > 0
                ? "Start a session to reinforce retention with SM-2 spacing."
                : "No cards are currently due. Rate more cards to schedule next reviews."}
            </p>
          </div>
          <Button type="button" onClick={startDueReview} disabled={dueNowCount === 0}>
            Start Review
          </Button>
        </div>

        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside data-tour="flashcards-decks" className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Saved Decks</h2>
              <span className="text-xs text-[var(--text-secondary)]">{decks.length} total</span>
            </div>
            <div className="divide-y divide-[var(--border-default)] border-t border-[var(--border-default)]">
              <button
                type="button"
                onClick={() => {
                  setSelectedDeckId(null);
                  setDeckCards([]);
                }}
                className={`w-full border-l-2 px-3 py-2.5 text-left text-sm transition ${
                  !selectedDeckId
                    ? "border-l-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)]"
                    : "border-l-transparent hover:bg-[var(--bg-hover)]"
                }`}
              >
                <p className="font-medium">Due review queue</p>
                <p className="text-xs text-[var(--text-secondary)]">{dueCards.length} cards due now</p>
              </button>

              {loading ? (
                <p className="px-3 py-3 text-sm text-[var(--text-secondary)]">Loading decks...</p>
              ) : decks.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[var(--text-secondary)]">
                  No decks yet. Generate flashcards in chat and they save automatically.
                </p>
              ) : (
                decks.map((deck) => (
                  <div key={deck._id} className={`border-l-2 px-3 py-2.5 transition ${
                    selectedDeckId === deck._id
                      ? "border-l-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)]"
                      : "border-l-transparent hover:bg-[var(--bg-hover)]"
                  }`}>
                    <button
                      type="button"
                      onClick={() => void loadDeckCards(deck._id)}
                      className="w-full text-left"
                    >
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{deck.title}</p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {deck.cardCount} cards · {deck.dueCount} due
                      </p>
                    </button>
                    <div className="mt-1.5 flex items-center justify-between">
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

          <article data-tour="flashcards-review" ref={reviewSectionRef} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 sm:p-6">
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

                <div className="flashcard-container flashcard-container--main" style={{ minHeight: 280 }}>
                  <button
                    type="button"
                    onClick={() => setFlipped((prev) => !prev)}
                    className={`flashcard-inner w-full text-left ${flipped ? "flipped" : ""}`}
                    style={{ minHeight: 280 }}
                    aria-label={flipped ? "Flip to front" : "Flip to back"}
                  >
                    <div className="flashcard-front flex flex-col justify-center rounded-2xl border-2 border-[var(--mode-flashcard)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-card)]">
                      <p className="mt-5 text-xl font-semibold text-[var(--text-primary)]">
                        {current.front}
                      </p>
                      <p className="mt-6 text-xs text-[var(--text-secondary)]">Tap to reveal answer</p>
                    </div>
                    <div className="flashcard-back flex flex-col justify-center rounded-2xl border-2 border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-elevated))] p-6 shadow-[var(--shadow-card)]">
                      <p className="mt-5 text-xl font-semibold text-[var(--text-primary)]">
                        {current.back}
                      </p>
                      <p className="mt-6 text-xs text-[var(--text-secondary)]">Tap to flip back</p>
                    </div>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={index <= 0}
                    onClick={() => {
                      setFlipped(false);
                      setIndex((prev) => Math.max(0, prev - 1));
                    }}
                  >
                    Previous
                  </Button>
                  <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2">
                    {reviewQueue.map((card, dotIndex) => (
                      <button
                        key={`${card.cardHash}-${dotIndex}`}
                        type="button"
                        onClick={() => {
                          setFlipped(false);
                          setIndex(dotIndex);
                        }}
                        className={`h-1.5 flex-1 rounded-full transition ${
                          dotIndex === index
                            ? "bg-[var(--mode-flashcard)]"
                            : "bg-[var(--border-default)] hover:bg-[var(--text-secondary)]"
                        }`}
                        aria-label={`Go to card ${dotIndex + 1}`}
                      />
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={index >= reviewQueue.length - 1}
                    onClick={() => {
                      setFlipped(false);
                      setIndex((prev) => Math.min(reviewQueue.length - 1, prev + 1));
                    }}
                  >
                    Next
                  </Button>
                </div>

                {flipped ? (
                  <div className="flex flex-wrap gap-2">
                    {QUALITY_OPTIONS.map((option) => (
                      <Button
                        key={option.label}
                        type="button"
                        size="sm"
                        variant={option.value === 4 ? "default" : "secondary"}
                        className={option.className}
                        disabled={savingRating}
                        onClick={() => void rateCurrent(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                ) : null}

                <p className="text-xs text-[var(--text-secondary)]">
                  Next review: {projectedDates.map((item) => `${item.label.split("(")[0].trim()}: ${item.date}`).join(" · ")}
                </p>
              </div>
            ) : null}
          </article>
        </div>
      </section>
    </AppShell>
  );
}
