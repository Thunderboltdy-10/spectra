"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Grid2x2,
  LayoutList,
  RotateCcw,
  Shuffle,
  XCircle,
  ClipboardCheck,
  BookOpen,
  Plus,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/chat/rich-text";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { extractFlashcardPairs } from "@/lib/flashcard-format";

export type FlashcardCard = {
  front: string;
  back: string;
  cardHash: string;
};

type StudyViewMode = "cards" | "grid" | "test";

type FlashcardRevealProps = {
  content: string;
  onSaveDeck?: (payload: { title: string; cards: FlashcardCard[] }) => Promise<void> | void;
  onRateCard?: (payload: { cardHash: string; quality: number }) => Promise<void> | void;
  onEditCard?: (
    payload: { cardHash: string; front: string; back: string },
  ) => Promise<{ updatedCardHash?: string; previousCardHash?: string; hashChanged?: boolean } | void> | void;
  onFollowUp?: (message: string) => void;
};

const FLIP_DURATION_MS = 600;

// ── helpers ────────────────────────────────────────────────────────────────

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
  for (const pair of extractFlashcardPairs(content)) {
    const cardHash = hashCard(pair.front, pair.back);
    if (seen.has(cardHash)) continue;
    seen.add(cardHash);
    cards.push({ front: pair.front, back: pair.back, cardHash });
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

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function buildStableShuffleOrder(cards: FlashcardCard[]) {
  return shuffleArray(cards.map((_, index) => index));
}

// ── Test mode helpers ──────────────────────────────────────────────────────

type TestQuestion = {
  cardIndex: number;
  question: string;
  correctAnswer: string;
  options: string[];
  correctOption: number;
};

function buildTestQuestions(cards: FlashcardCard[]): TestQuestion[] {
  return cards.map((card, idx) => {
    const distractors = cards
      .filter((_, i) => i !== idx)
      .map((c) => c.back);
    const shuffledDistractors = shuffleArray(distractors).slice(0, 3);
    const allOptions = shuffleArray([card.back, ...shuffledDistractors]);
    const correctOption = allOptions.indexOf(card.back);
    return {
      cardIndex: idx,
      question: card.front,
      correctAnswer: card.back,
      options: allOptions,
      correctOption,
    };
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────

type ViewTabProps = {
  active: StudyViewMode;
  onChange: (v: StudyViewMode) => void;
  total: number;
};

function ViewTabs({ active, onChange, total }: ViewTabProps) {
  const tabs: { key: StudyViewMode; label: string; icon: React.ReactNode }[] = [
    { key: "cards", label: "Cards", icon: <LayoutList className="h-3.5 w-3.5" /> },
    { key: "grid", label: "Grid", icon: <Grid2x2 className="h-3.5 w-3.5" /> },
    { key: "test", label: "Test", icon: <ClipboardCheck className="h-3.5 w-3.5" />, },
  ];
  return (
    <div className="flex gap-1 rounded-[var(--radius-pill)] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          disabled={tab.key === "test" && total < 4}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
            active === tab.key
              ? "bg-[var(--mode-flashcard)] text-white shadow-sm"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
          title={tab.key === "test" && total < 4 ? "Need at least 4 cards for test mode" : undefined}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Cards view ─────────────────────────────────────────────────────────────

type CardsViewProps = {
  cards: FlashcardCard[];
  onRateCard?: (payload: { cardHash: string; quality: number }) => Promise<void> | void;
  onEditCard?: (
    payload: { cardHash: string; front: string; back: string },
  ) => Promise<{ updatedCardHash?: string; previousCardHash?: string; hashChanged?: boolean } | void> | void;
  onUpdateCard?: (payload: { cardHash: string; updatedCardHash: string; front: string; back: string }) => void;
  onLearningCountChange?: (count: number) => void;
};

function CardsView({ cards, onRateCard, onEditCard, onUpdateCard, onLearningCountChange }: CardsViewProps) {
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));
  const [currentPos, setCurrentPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [pendingMove, setPendingMove] = useState<"next" | "prev" | null>(null);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [stillLearning, setStillLearning] = useState<Set<number>>(new Set());
  const [showSummary, setShowSummary] = useState(false);
  const [busyRating, setBusyRating] = useState(false);
  const [isShuffled, setIsShuffled] = useState(false);
  const [shuffleNotice, setShuffleNotice] = useState(false);
  const [editingCardHash, setEditingCardHash] = useState<string | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const currentIndex = order[currentPos] ?? 0;
  const current = cards[currentIndex];
  const total = order.length;
  const knownCount = known.size;

  useEffect(() => {
    onLearningCountChange?.(stillLearning.size);
  }, [onLearningCountChange, stillLearning.size]);

  function performMove(direction: "next" | "prev") {
    if (direction === "next") {
      if (currentPos < total - 1) {
        setCurrentPos((prev) => prev + 1);
      } else {
        setShowSummary(true);
      }
      return;
    }
    if (currentPos > 0) {
      setCurrentPos((prev) => prev - 1);
    }
  }

  function queueMove(direction: "next" | "prev") {
    if (pendingMove) return;
    if (!flipped) {
      performMove(direction);
      return;
    }
    setPendingMove(direction);
    setFlipped(false);
  }

  function toggleShuffle() {
    if (isShuffled) {
      setOrder(cards.map((_, i) => i));
    } else {
      setOrder(shuffleArray(cards.map((_, i) => i)));
    }
    setCurrentPos(0);
    setFlipped(false);
    setIsShuffled((prev) => !prev);
    setShuffleNotice(true);
    window.setTimeout(() => setShuffleNotice(false), 900);
  }

  function beginEdit() {
    if (!current) return;
    setEditingCardHash(current.cardHash);
    setEditFront(current.front);
    setEditBack(current.back);
  }

  function cancelEdit() {
    setEditingCardHash(null);
    setEditFront("");
    setEditBack("");
  }

  async function saveEdit() {
    if (!current || !editingCardHash || savingEdit) return;
    const nextFront = editFront.trim();
    const nextBack = editBack.trim();
    if (!nextFront || !nextBack) return;
    setSavingEdit(true);
    try {
      const editResult = await onEditCard?.({
        cardHash: editingCardHash,
        front: nextFront,
        back: nextBack,
      });
      const updatedCardHash = (editResult as { updatedCardHash?: string } | undefined)?.updatedCardHash?.trim()
        || hashCard(nextFront, nextBack);
      onUpdateCard?.({
        cardHash: editingCardHash,
        updatedCardHash,
        front: nextFront,
        back: nextBack,
      });
      cancelEdit();
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRate(quality: number, markKnown: boolean) {
    if (!current || busyRating) return;
    setBusyRating(true);
    try {
      await onRateCard?.({ cardHash: current.cardHash, quality });
      setKnown((prev) => {
        const next = new Set(prev);
        if (markKnown) {
          next.add(currentIndex);
        } else {
          next.delete(currentIndex);
        }
        return next;
      });
      setStillLearning((prev) => {
        const next = new Set(prev);
        if (!markKnown) {
          next.add(currentIndex);
        } else {
          next.delete(currentIndex);
        }
        return next;
      });
      queueMove("next");
    } finally {
      setBusyRating(false);
    }
  }

  function restart() {
    setCurrentPos(0);
    setFlipped(false);
    setKnown(new Set());
    setStillLearning(new Set());
    setShowSummary(false);
    setOrder(cards.map((_, i) => i));
    setIsShuffled(false);
  }

  if (showSummary) {
    const masteredCount = knownCount;
    const reviewCount = total - masteredCount;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--mode-flashcard)] px-3 py-1.5 text-xs font-semibold text-white">
            Round Complete
          </span>
          <Button type="button" size="sm" variant="secondary" onClick={restart}>
            <RotateCcw className="h-3.5 w-3.5" />
            Restart
          </Button>
        </div>

        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 text-center shadow-[var(--shadow-card)]">
          <p className="text-4xl font-bold">
            {masteredCount}<span className="text-[var(--text-tertiary)]">/{total}</span>
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {masteredCount === total
              ? "You know all cards. Excellent!"
              : `${reviewCount} card${reviewCount !== 1 ? "s" : ""} still need review`}
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <div className="rounded-[var(--radius-input)] bg-[color-mix(in_oklab,var(--success)_12%,var(--bg-secondary))] px-4 py-2 text-sm">
              <span className="font-semibold text-[var(--success)]">{masteredCount}</span>
              <span className="ml-1 text-[var(--text-secondary)]">mastered</span>
            </div>
            {reviewCount > 0 && (
              <div className="rounded-[var(--radius-input)] bg-[color-mix(in_oklab,var(--warning)_12%,var(--bg-secondary))] px-4 py-2 text-sm">
                <span className="font-semibold text-[var(--warning)]">{reviewCount}</span>
                <span className="ml-1 text-[var(--text-secondary)]">to review</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!current) return null;

  const isEditingCurrent = editingCardHash === current.cardHash;

  return (
    <div className="space-y-4">
      {/* Counter + shuffle */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--text-secondary)]">
          {currentPos + 1} <span className="text-[var(--text-tertiary)]">/ {total}</span>
        </span>
        <div className="flex items-center gap-2">
          {shuffleNotice ? (
            <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
              Shuffled
            </span>
          ) : null}
          <button
            type="button"
            onClick={toggleShuffle}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs transition ${
              isShuffled
                ? "border-[var(--mode-flashcard)] bg-[color-mix(in_oklab,var(--mode-flashcard)_12%,var(--bg-secondary))] text-[var(--mode-flashcard)]"
                : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
            }`}
          >
            <Shuffle className="h-3 w-3" />
            Shuffle
          </button>
          <button
            type="button"
            onClick={beginEdit}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            Edit card
          </button>
        </div>
      </div>

      {/* The big flashcard */}
      <div className="flashcard-container flashcard-container--main" style={{ minHeight: "min(400px, 50vh)" }}>
        <div
          className={`flashcard-inner cursor-pointer select-none ${flipped ? "flipped" : ""}`}
          onClick={() => setFlipped((prev) => !prev)}
          style={{ minHeight: "min(400px, 50vh)", transitionDuration: `${FLIP_DURATION_MS}ms` }}
          onTransitionEnd={() => {
            if (!pendingMove) return;
            const move = pendingMove;
            setPendingMove(null);
            performMove(move);
          }}
          role="button"
          aria-label={flipped ? "Click to see front" : "Click to see back"}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped((p) => !p); } }}
        >
          {/* Front */}
          <div className="flashcard-front flex flex-col items-center justify-center rounded-[var(--radius-container)] border-2 border-[var(--mode-flashcard)] bg-[var(--bg-elevated)] p-8 shadow-[var(--shadow-card)]">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--mode-flashcard)] opacity-70">
              Term
            </p>
            <div className="text-center">
              <RichText content={current.front} className="text-xl font-semibold leading-relaxed" />
            </div>
            <p className="mt-6 text-[11px] text-[var(--text-tertiary)]">Click to reveal definition</p>
          </div>

          {/* Back */}
          <div className="flashcard-back flex flex-col items-center justify-center rounded-[var(--radius-container)] border-2 border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_5%,var(--bg-elevated))] p-8 shadow-[var(--shadow-card)]">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)] opacity-70">
              Definition
            </p>
            <div className="text-center">
              <RichText content={current.back} className="text-lg leading-relaxed" />
            </div>
            <p className="mt-6 text-[11px] text-[var(--text-tertiary)]">Click to flip back</p>
          </div>
        </div>
      </div>

      {isEditingCurrent ? (
        <div className="space-y-2 rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Edit Card
          </p>
          <label className="space-y-1 text-xs text-[var(--text-secondary)]">
            <span>Front</span>
            <textarea
              value={editFront}
              onChange={(event) => setEditFront(event.target.value)}
              className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
              rows={2}
            />
          </label>
          <label className="space-y-1 text-xs text-[var(--text-secondary)]">
            <span>Back</span>
            <textarea
              value={editBack}
              onChange={(event) => setEditBack(event.target.value)}
              className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
              rows={3}
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={cancelEdit} disabled={savingEdit}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void saveEdit()} disabled={savingEdit || !editFront.trim() || !editBack.trim()}>
              Save
            </Button>
          </div>
        </div>
      ) : null}

      {/* Navigation + rating */}
      <div className="flex items-center justify-between gap-2 pt-4">
        <Button variant="secondary" size="sm" onClick={() => queueMove("prev")} disabled={currentPos === 0} className="cursor-pointer">
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {flipped ? (
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleRate(0, false)}
              disabled={busyRating}
              title="Forgot — repeat tomorrow (SM-2 quality 0)"
              className="cursor-pointer border-[var(--danger)] text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_10%,var(--bg-primary))]"
            >
              Again
              <span className="ml-1 text-[10px] opacity-70">~1 day</span>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleRate(1, false)}
              disabled={busyRating}
              title="Remembered with difficulty (SM-2 quality 1)"
              className="cursor-pointer border-[var(--warning)] text-[var(--warning)] hover:bg-[color-mix(in_oklab,var(--warning)_10%,var(--bg-primary))]"
            >
              Hard
              <span className="ml-1 text-[10px] opacity-70">~2 days</span>
            </Button>
            <Button
              size="sm"
              onClick={() => void handleRate(3, true)}
              disabled={busyRating}
              title="Recalled correctly with some effort (SM-2 quality 3)"
              className="cursor-pointer bg-[var(--success)] hover:bg-[color-mix(in_oklab,var(--success)_85%,black)]"
            >
              Good
              <span className="ml-1 text-[10px] opacity-70">~5 days</span>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleRate(5, true)}
              disabled={busyRating}
              title="Perfect recall with no hesitation (SM-2 quality 5)"
              className="cursor-pointer border-[var(--accent-cyan)] text-[var(--accent-cyan)] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-primary))]"
            >
              Easy
              <span className="ml-1 text-[10px] opacity-70">~9 days</span>
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFlipped(true)}
            className="cursor-pointer rounded-[var(--radius-pill)] bg-[var(--mode-flashcard)] px-6 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Flip card
          </button>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={() => queueMove("next")}
          disabled={currentPos >= total - 1}
          className="cursor-pointer"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Dot tracker */}
      <div className="flex gap-1">
        {order.map((cardIdx, pos) => (
          <button
            key={pos}
            type="button"
            onClick={() => { setFlipped(false); setCurrentPos(pos); }}
            className={`h-1.5 flex-1 cursor-pointer rounded-full transition ${
              pos === currentPos
                ? "bg-[var(--mode-flashcard)]"
                : known.has(cardIdx)
                  ? "bg-[var(--success)]"
                  : stillLearning.has(cardIdx)
                    ? "bg-[var(--warning)]"
                    : "bg-[var(--border-default)]"
            }`}
            title={`Card ${pos + 1}`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px] text-[var(--text-tertiary)]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--success)]" />
          Mastered ({knownCount})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--warning)]" />
          Learning ({stillLearning.size})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--border-default)]" />
          Unseen ({total - knownCount - stillLearning.size})
        </span>
      </div>
    </div>
  );
}

// ── Grid view ──────────────────────────────────────────────────────────────

type GridViewProps = {
  cards: FlashcardCard[];
};

function GridView({ cards }: GridViewProps) {
  const [flippedSet, setFlippedSet] = useState<Set<number>>(new Set());
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));
  const [isShuffled, setIsShuffled] = useState(false);

  useEffect(() => {
    setOrder(cards.map((_, i) => i));
    setIsShuffled(false);
    setFlippedSet(new Set());
  }, [cards]);

  function toggleCard(idx: number) {
    setFlippedSet((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  function toggleShuffle() {
    if (isShuffled) {
      setOrder(cards.map((_, i) => i));
    } else {
      setOrder(shuffleArray(cards.map((_, i) => i)));
    }
    setIsShuffled((prev) => !prev);
    setFlippedSet(new Set());
  }

  const orderedCards = order.map((i) => cards[i]).filter((c): c is FlashcardCard => Boolean(c));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={toggleShuffle}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs transition ${
            isShuffled
              ? "border-[var(--mode-flashcard)] bg-[color-mix(in_oklab,var(--mode-flashcard)_12%,var(--bg-secondary))] text-[var(--mode-flashcard)]"
              : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
          }`}
        >
          <Shuffle className="h-3 w-3" />
          {isShuffled ? "Shuffled" : "Shuffle"}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {orderedCards.map((card, idx) => {
        const isFlipped = flippedSet.has(idx);
        return (
          <div
            key={card.cardHash}
            className="flashcard-container cursor-pointer"
            style={{ minHeight: 260 }}
            onClick={() => toggleCard(idx)}
          >
            <div
              className={`flashcard-inner ${isFlipped ? "flipped" : ""}`}
              style={{ minHeight: 260, transitionDuration: `${FLIP_DURATION_MS}ms` }}
            >
              <div className="flashcard-front flex flex-col items-center justify-center rounded-[var(--radius-container)] border-2 border-[var(--mode-flashcard)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]">
                <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-[var(--mode-flashcard)] opacity-70">
                  Term
                </p>
                <RichText content={card.front} className="text-center text-sm font-medium" />
              </div>
              <div className="flashcard-back flex flex-col items-center justify-center rounded-[var(--radius-container)] border-2 border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_5%,var(--bg-elevated))] p-5 shadow-[var(--shadow-card)]">
                <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-[var(--accent)] opacity-70">
                  Definition
                </p>
                <RichText content={card.back} className="text-center text-sm" />
              </div>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ── Test view ──────────────────────────────────────────────────────────────

type TestViewProps = {
  cards: FlashcardCard[];
  onFollowUp?: (message: string) => void;
};

function TestView({ cards, onFollowUp }: TestViewProps) {
  const baseQuestions = useMemo(() => buildTestQuestions(cards), [cards]);
  const [questionOrder, setQuestionOrder] = useState<number[]>(() => baseQuestions.map((_, i) => i));
  const [isShuffled, setIsShuffled] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({}); // questionIdx -> optionIdx
  const [submitted, setSubmitted] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    setQuestionOrder(baseQuestions.map((_, i) => i));
    setIsShuffled(false);
    setAnswers({});
    setSubmitted(false);
    setActiveIdx(0);
  }, [baseQuestions]);

  const questions = useMemo(() => questionOrder.map((i) => baseQuestions[i]).filter((q): q is TestQuestion => Boolean(q)), [baseQuestions, questionOrder]);

  const score = useMemo(() => {
    if (!submitted) return 0;
    return questions.filter((q, idx) => answers[idx] === q.correctOption).length;
  }, [answers, questions, submitted]);

  const total = questions.length;
  const currentQ = questions[activeIdx];
  const isLast = activeIdx >= total - 1;
  const selectedAnswer = answers[activeIdx];
  const hasAnsweredCurrent = selectedAnswer !== undefined;
  const currentAnswerIsCorrect = hasAnsweredCurrent && selectedAnswer === currentQ?.correctOption;

  function submit() {
    if (submitted) return;
    setSubmitted(true);
  }

  function restart() {
    setAnswers({});
    setSubmitted(false);
    setActiveIdx(0);
    if (isShuffled) {
      setQuestionOrder(shuffleArray(baseQuestions.map((_, i) => i)));
    }
  }

  function toggleShuffle() {
    if (isShuffled) {
      setQuestionOrder(baseQuestions.map((_, i) => i));
    } else {
      setQuestionOrder(shuffleArray(baseQuestions.map((_, i) => i)));
    }
    setIsShuffled((prev) => !prev);
    setAnswers({});
    setSubmitted(false);
    setActiveIdx(0);
  }

  function requestExplainWrong() {
    const wrongTerms = questions
      .filter((q, idx) => answers[idx] !== q.correctOption)
      .map((q) => `"${q.question}"`)
      .join(", ");
    onFollowUp?.(`Explain in detail these flashcard concepts that I got wrong: ${wrongTerms}`);
  }

  function requestMoreCards() {
    const topic = cards[0]?.front ?? "this topic";
    onFollowUp?.(`Add more flashcards on the topic of "${topic}" and related concepts.`);
  }

  if (!currentQ) return null;

  const scorePct = total > 0 ? score / total : 0;
  const isPerfect = score === total;
  const isGood = scorePct >= 0.7;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[color-mix(in_oklab,var(--mode-flashcard)_15%,var(--bg-secondary))] px-3 py-1 text-xs font-semibold text-[var(--mode-flashcard)]">
          <ClipboardCheck className="h-3.5 w-3.5" />
          Test Mode
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleShuffle}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs transition ${
              isShuffled
                ? "border-[var(--mode-flashcard)] bg-[color-mix(in_oklab,var(--mode-flashcard)_12%,var(--bg-secondary))] text-[var(--mode-flashcard)]"
                : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
            }`}
          >
            <Shuffle className="h-3 w-3" />
            {isShuffled ? "Shuffled" : "Shuffle"}
          </button>
          {submitted ? (
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {score}/{total}
            </span>
          ) : (
            <span className="text-xs text-[var(--text-secondary)]">
              {activeIdx + 1} / {total}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border-default)]">
        <div
          className="h-full rounded-full bg-[var(--mode-flashcard)] transition-all duration-300"
          style={{ width: `${submitted ? (score / total) * 100 : (activeIdx / total) * 100}%` }}
        />
      </div>

      {/* Question card */}
      <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
          Question {activeIdx + 1}
        </p>
        <RichText content={currentQ.question} className="mb-4 text-base font-medium" />

        <div className="space-y-2.5">
          {currentQ.options.map((option, optIdx) => {
            const selected = answers[activeIdx] === optIdx;
            const isCorrect = submitted && optIdx === currentQ.correctOption;
            const isWrong = submitted && selected && optIdx !== currentQ.correctOption;

            return (
              <button
                key={optIdx}
                type="button"
                disabled={submitted}
                onClick={() => setAnswers((prev) => ({ ...prev, [activeIdx]: optIdx }))}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-[var(--radius-input)] border px-4 py-3 text-left text-sm transition disabled:cursor-default ${
                  isCorrect
                    ? "border-[var(--success)] bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-primary))]"
                    : isWrong
                      ? "border-[var(--danger)] bg-[color-mix(in_oklab,var(--danger)_10%,var(--bg-primary))]"
                      : selected
                        ? "border-[var(--mode-flashcard)] bg-[color-mix(in_oklab,var(--mode-flashcard)_10%,var(--bg-primary))]"
                        : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                    isCorrect
                      ? "border-[var(--success)] bg-[var(--success)] text-white"
                      : isWrong
                        ? "border-[var(--danger)] bg-[var(--danger)] text-white"
                        : selected
                          ? "border-[var(--mode-flashcard)] bg-[var(--mode-flashcard)] text-white"
                          : "border-[var(--border-default)] text-[var(--text-secondary)]"
                  }`}
                >
                  {String.fromCharCode(65 + optIdx)}
                </span>
                <RichText content={option} className="flex-1 text-sm" />
                {isCorrect ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--success)]" /> : null}
                {isWrong ? <XCircle className="h-5 w-5 shrink-0 text-[var(--danger)]" /> : null}
              </button>
            );
          })}
        </div>

        {hasAnsweredCurrent ? (
          <div
            className={`mt-3 rounded-[var(--radius-input)] border px-4 py-2.5 text-sm font-semibold ${
              currentAnswerIsCorrect
                ? "border-[color-mix(in_oklab,var(--success)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-secondary))] text-[var(--success)]"
                : "border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_10%,var(--bg-secondary))] text-[var(--danger)]"
            }`}
          >
            {currentAnswerIsCorrect ? (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                Correct
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <XCircle className="h-4 w-4" />
                Incorrect — review the answer below
              </span>
            )}
          </div>
        ) : null}

        {(submitted || hasAnsweredCurrent) && (
          <div className="mt-3 rounded-[var(--radius-input)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm text-[var(--text-secondary)]">
            <span className="font-semibold">Answer: </span>
            <RichText content={currentQ.correctAnswer} className="inline text-sm" />
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={activeIdx === 0}
          onClick={() => setActiveIdx((prev) => Math.max(0, prev - 1))}
          className="cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {!submitted ? (
          <Button
            size="sm"
            onClick={() => {
              if (isLast) {
                submit();
              } else {
                setActiveIdx((prev) => prev + 1);
              }
            }}
            className="cursor-pointer"
          >
            {isLast ? "Check Answers" : "Next"}
          </Button>
        ) : !isLast ? (
          <Button
            size="sm"
            onClick={() => setActiveIdx((prev) => Math.min(total - 1, prev + 1))}
            className="cursor-pointer"
          >
            Next
          </Button>
        ) : null}

        <Button
          variant="secondary"
          size="sm"
          disabled={activeIdx >= total - 1}
          onClick={() => setActiveIdx((prev) => Math.min(total - 1, prev + 1))}
          className="cursor-pointer"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Dot tracker */}
      <div className="flex gap-1">
        {questions.map((q, idx) => {
          const ans = answers[idx];
          const isAnswered = ans !== undefined;
          const isCorrect = submitted && ans === q.correctOption;
          const isWrong = submitted && isAnswered && ans !== q.correctOption;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`h-1.5 flex-1 cursor-pointer rounded-full transition ${
                idx === activeIdx
                  ? "bg-[var(--mode-flashcard)]"
                  : isCorrect
                    ? "bg-[var(--success)]"
                    : isWrong
                      ? "bg-[var(--danger)]"
                      : isAnswered
                        ? "bg-[color-mix(in_oklab,var(--mode-flashcard)_50%,var(--border-default))]"
                        : "bg-[var(--border-default)]"
              }`}
            />
          );
        })}
      </div>

      {/* Results panel */}
      {submitted && activeIdx === total - 1 && (
        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5 text-center">
          <p className="text-4xl font-bold">
            {score}
            <span className="text-[var(--text-tertiary)]">/{total}</span>
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {isPerfect
              ? "Perfect score! You know this material well."
              : isGood
                ? "Great work! A little more practice and you'll have it mastered."
                : "Keep at it - flashcard review will help cement these concepts."}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={restart} className="cursor-pointer">
              <RotateCcw className="h-3.5 w-3.5" />
              Retry test
            </Button>
            {!isPerfect && onFollowUp ? (
              <Button type="button" size="sm" onClick={requestExplainWrong} className="cursor-pointer">
                <HelpCircle className="h-3.5 w-3.5" />
                Explain wrong answers
              </Button>
            ) : null}
            {onFollowUp ? (
              <Button type="button" size="sm" variant="secondary" onClick={requestMoreCards} className="cursor-pointer">
                <Plus className="h-3.5 w-3.5" />
                Add more cards
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Follow-up actions bar ──────────────────────────────────────────────────

type FollowUpBarProps = {
  cards: FlashcardCard[];
  onFollowUp: (message: string) => void;
  stillLearningCount?: number;
};

function FollowUpBar({ cards, onFollowUp, stillLearningCount = 0 }: FollowUpBarProps) {
  const topic = cards[0]?.front ?? "this topic";

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <button
        type="button"
        onClick={() => onFollowUp(`Quiz me on these flashcard topics: ${cards.slice(0, 6).map((c) => `"${c.front}"`).join(", ")}`)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
      >
        <ClipboardCheck className="h-3.5 w-3.5" />
        Quiz me on these
      </button>
      <button
        type="button"
        onClick={() => onFollowUp(`Add 5 more flashcards about "${topic}" covering related concepts I haven't seen yet.`)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
      >
        <Plus className="h-3.5 w-3.5" />
        Add more cards
      </button>
      {stillLearningCount > 0 ? (
        <button
          type="button"
          onClick={() => onFollowUp(`I'm still learning ${stillLearningCount} card(s) in my flashcard deck. Please explain each of the difficult terms in more depth with examples.`)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Explain difficult ones
        </button>
      ) : null}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function FlashcardReveal({ content, onSaveDeck, onRateCard, onEditCard, onFollowUp }: FlashcardRevealProps) {
  const parsedCards = useMemo(() => parseFlashcards(content), [content]);
  const [cardOverrides, setCardOverrides] = useState<
    Record<string, { front: string; back: string; cardHash?: string }>
  >({});
  const cards = useMemo(
    () =>
      parsedCards
        .filter((card) => card.front.trim() && card.back.trim())
        .map((card) => {
          const override = cardOverrides[card.cardHash];
          return override
            ? {
                ...card,
                front: override.front,
                back: override.back,
                cardHash: override.cardHash ?? card.cardHash,
              }
            : card;
        }),
    [parsedCards, cardOverrides],
  );
  const [viewMode, setViewMode] = useState<StudyViewMode>("cards");
  const [stillLearningCount, setStillLearningCount] = useState(0);
  const [shuffledOrder, setShuffledOrder] = useState<number[]>([]);
  const [isShuffled, setIsShuffled] = useState(false);
  const saveSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const hashes = new Set(parsedCards.map((card) => card.cardHash));
    setCardOverrides((prev) => {
      const next: Record<string, { front: string; back: string; cardHash?: string }> = {};
      let changed = false;
      for (const [hash, values] of Object.entries(prev)) {
        if (!hashes.has(hash)) {
          changed = true;
          continue;
        }
        next[hash] = values;
      }
      return changed ? next : prev;
    });
  }, [parsedCards]);

  const applyCardOverride = useCallback((payload: { cardHash: string; updatedCardHash: string; front: string; back: string }) => {
    setCardOverrides((prev) => ({
      ...prev,
      [payload.cardHash]: {
        cardHash: payload.updatedCardHash,
        front: payload.front,
        back: payload.back,
      },
    }));
  }, []);

  useEffect(() => {
    if (!onSaveDeck || cards.length === 0) return;
    const signature = cards.map((card) => `${card.cardHash}:${card.front}:${card.back}`).join("|");
    if (saveSignatureRef.current === signature) return;
    saveSignatureRef.current = signature;
    void onSaveDeck({ title: inferDeckTitle(cards), cards });
  }, [cards, onSaveDeck]);

  useEffect(() => {
    setShuffledOrder(cards.map((_, index) => index));
    setIsShuffled(false);
  }, [cards]);

  if (cards.length === 0) {
    return <MarkdownRenderer content={content} citations={[]} />;
  }

  const title = inferDeckTitle(cards);
  const orderedCards = (isShuffled ? shuffledOrder : cards.map((_, index) => index))
    .map((index) => cards[index])
    .filter((card): card is FlashcardCard => Boolean(card));

  function handleToggleShuffle() {
    if (isShuffled) {
      setShuffledOrder(cards.map((_, index) => index));
      setIsShuffled(false);
      return;
    }
    setShuffledOrder(buildStableShuffleOrder(cards));
    setIsShuffled(true);
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--mode-flashcard)] px-3 py-1.5 text-xs font-semibold text-white">
            <BookOpen className="h-3.5 w-3.5" />
            {title}
          </span>
          <span className="text-xs text-[var(--text-tertiary)]">{cards.length} cards</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleShuffle}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-medium transition ${
              isShuffled
                ? "border-[var(--mode-flashcard)] bg-[color-mix(in_oklab,var(--mode-flashcard)_12%,var(--bg-secondary))] text-[var(--mode-flashcard)]"
                : "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Shuffle className="h-3.5 w-3.5" />
            {isShuffled ? "Shuffled" : "Shuffle"}
          </button>
          <ViewTabs active={viewMode} onChange={setViewMode} total={cards.length} />
        </div>
      </div>

      {/* View content */}
      {viewMode === "cards" && (
        <CardsView
          cards={orderedCards}
          onRateCard={onRateCard}
          onEditCard={onEditCard}
          onUpdateCard={applyCardOverride}
          onLearningCountChange={setStillLearningCount}
        />
      )}
      {viewMode === "grid" && <GridView cards={orderedCards} />}
      {viewMode === "test" && <TestView cards={orderedCards} onFollowUp={onFollowUp} />}

      {/* Follow-up actions */}
      {onFollowUp && (
        <FollowUpBar
          cards={cards}
          onFollowUp={onFollowUp}
          stillLearningCount={stillLearningCount}
        />
      )}
    </div>
  );
}
