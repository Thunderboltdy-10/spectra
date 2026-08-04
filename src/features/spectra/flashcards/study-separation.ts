/**
 * Deck source vs personal study state (§11B).
 *
 * A deck has two owners. The cards belong to whoever authors the deck; the
 * record of how well someone knows those cards belongs to that person alone.
 * Editing a deck must never silently rewrite somebody's progress, and it must
 * never pretend that progress still applies to a card whose answer has changed.
 *
 * Everything here is pure: it compares two deck revisions and produces a plan.
 * The plan is applied on the server, where the study states actually live.
 */

// ------------------------------------------------------------------ shapes

/** The parts of a card this module reads. Anything else is deck presentation. */
export type StudyCardShape = {
  id: string;
  variant?: string;
  front: string;
  back: string;
  hint?: string;
  explanation?: string;
  acceptedAlternatives?: readonly string[];
  section?: string;
  tags?: readonly string[];
  bidirectional?: boolean;
  media?: { assetId?: string; placement?: string } | undefined;
  occlusions?: readonly { id: string; label?: string }[];
};

export type StudyDirection = "forward" | "reverse";

/**
 * Personal study state, named separately from the deck so the two are never
 * accidentally passed to each other's functions.
 */
export type PersonalStudyState = {
  cardId: string;
  direction: StudyDirection;
  attempts: number;
  ease: number;
  stabilityDays: number;
  difficulty: number;
  lapses: number;
  nextDueAt: number;
  lastReviewedAt?: number;
  /** The learner's own note on this card. Never written by the deck or by AI. */
  note?: string;
};

// ------------------------------------------------------- meaning fingerprint

function normalizeText(value: string | undefined) {
  return (value ?? "").replaceAll(/\s+/g, " ").trim().toLowerCase();
}

/**
 * A tiny stable string hash. This is a change detector, not a security
 * primitive, so it deliberately avoids node:crypto — the same function has to
 * run in the browser, in Convex and in tests and agree in all three.
 */
function fingerprint(parts: readonly string[]) {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x1f;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

/**
 * What is actually being recalled: the prompt, the answer, what counts as
 * correct, and the shape of the exercise. A change to any of these makes past
 * performance a claim about a different question.
 */
export function cardMeaningFingerprint(card: StudyCardShape) {
  return fingerprint([
    card.variant ?? "basic",
    normalizeText(card.front),
    normalizeText(card.back),
    [...(card.acceptedAlternatives ?? [])].map(normalizeText).sort().join("|"),
    (card.occlusions ?? [])
      .map((occlusion) => `${occlusion.id}:${normalizeText(occlusion.label)}`)
      .sort()
      .join("|"),
    card.media?.assetId ?? "",
    card.media?.placement ?? "",
  ]);
}

/**
 * Everything a person sees but does not have to recall: hints, explanations,
 * tags and where the card sits. Changing these is a refinement, not a new
 * question, so progress carries over untouched.
 */
export function cardPresentationFingerprint(card: StudyCardShape) {
  return fingerprint([
    normalizeText(card.hint),
    normalizeText(card.explanation),
    normalizeText(card.section),
    [...(card.tags ?? [])].map(normalizeText).sort().join("|"),
  ]);
}

// ------------------------------------------------------------ reconciliation

export type DeckCardChange =
  /** Nothing a learner would notice. */
  | "unchanged"
  /** Wording around the question moved; the question itself did not. */
  | "refined"
  /** The prompt or the answer changed. Past reviews no longer describe it. */
  | "rewritten"
  | "added"
  | "removed";

export type DeckCardOutcome = {
  cardId: string;
  change: DeckCardChange;
  /** Directions whose study state stays exactly as it is. */
  keep: readonly StudyDirection[];
  /**
   * Directions whose scheduling is reset to "due now, first sight". The record
   * survives so the learner keeps their history and is told what happened.
   */
  reset: readonly StudyDirection[];
  /**
   * Directions that no longer exist on this card — a removed card, or reverse
   * study switched off. Their state is retired rather than deleted, so turning
   * the direction back on restores the progress instead of starting over.
   */
  retire: readonly StudyDirection[];
  /** Directions studied here for the first time. */
  introduce: readonly StudyDirection[];
};

export type DeckStudyReconciliation = {
  outcomes: readonly DeckCardOutcome[];
  /** Card ids whose scheduling was reset, for the notice shown to the learner. */
  resetCardIds: readonly string[];
  retiredCardIds: readonly string[];
  addedCardIds: readonly string[];
  removedCardIds: readonly string[];
  /** True when nothing about the update touches anyone's progress. */
  progressUntouched: boolean;
};

function directionsOf(card: StudyCardShape): StudyDirection[] {
  return card.bidirectional === true ? ["forward", "reverse"] : ["forward"];
}

function classify(
  previous: StudyCardShape,
  next: StudyCardShape,
): DeckCardChange {
  if (cardMeaningFingerprint(previous) !== cardMeaningFingerprint(next))
    return "rewritten";
  if (cardPresentationFingerprint(previous) !== cardPresentationFingerprint(next))
    return "refined";
  return "unchanged";
}

/**
 * Compares the deck a learner has been studying against the deck as it is now,
 * and says what should happen to each piece of their progress.
 *
 * The rule is conservative in the learner's favour: progress is preserved
 * wherever it still means something, reset only where the question changed, and
 * never deleted outright.
 */
export function reconcileDeckRevision(
  previousCards: readonly StudyCardShape[],
  nextCards: readonly StudyCardShape[],
  studiedKeys: ReadonlySet<string> = new Set(),
): DeckStudyReconciliation {
  const previousById = new Map(previousCards.map((card) => [card.id, card]));
  const nextById = new Map(nextCards.map((card) => [card.id, card]));
  const outcomes: DeckCardOutcome[] = [];
  const studied = (cardId: string, direction: StudyDirection) =>
    studiedKeys.size === 0 || studiedKeys.has(`${cardId}:${direction}`);

  for (const next of nextCards) {
    const previous = previousById.get(next.id);
    const nextDirections = directionsOf(next);
    if (!previous) {
      outcomes.push({
        cardId: next.id,
        change: "added",
        keep: [],
        reset: [],
        retire: [],
        introduce: nextDirections,
      });
      continue;
    }
    const previousDirections = directionsOf(previous);
    const change = classify(previous, next);
    const shared = nextDirections.filter((direction) =>
      previousDirections.includes(direction),
    );
    outcomes.push({
      cardId: next.id,
      change,
      keep: change === "rewritten" ? [] : shared,
      reset:
        change === "rewritten"
          ? shared.filter((direction) => studied(next.id, direction))
          : [],
      retire: previousDirections.filter(
        (direction) => !nextDirections.includes(direction),
      ),
      introduce: nextDirections.filter(
        (direction) => !previousDirections.includes(direction),
      ),
    });
  }

  for (const previous of previousCards) {
    if (nextById.has(previous.id)) continue;
    outcomes.push({
      cardId: previous.id,
      change: "removed",
      keep: [],
      reset: [],
      retire: directionsOf(previous),
      introduce: [],
    });
  }

  const resetCardIds = outcomes
    .filter((outcome) => outcome.reset.length > 0)
    .map((outcome) => outcome.cardId);
  const retiredCardIds = outcomes
    .filter((outcome) => outcome.retire.length > 0)
    .map((outcome) => outcome.cardId);

  return {
    outcomes,
    resetCardIds,
    retiredCardIds,
    addedCardIds: outcomes
      .filter((outcome) => outcome.change === "added")
      .map((outcome) => outcome.cardId),
    removedCardIds: outcomes
      .filter((outcome) => outcome.change === "removed")
      .map((outcome) => outcome.cardId),
    progressUntouched: resetCardIds.length === 0 && retiredCardIds.length === 0,
  };
}

/**
 * The sentence a learner reads after the deck they study has been edited. It
 * says what changed for them, not what the author did.
 */
export function describeDeckUpdate(
  reconciliation: DeckStudyReconciliation,
): string {
  const parts: string[] = [];
  const { resetCardIds, addedCardIds, removedCardIds, retiredCardIds } =
    reconciliation;
  if (resetCardIds.length)
    parts.push(
      `${resetCardIds.length} card${resetCardIds.length === 1 ? "" : "s"} you have studied changed answer, so ${resetCardIds.length === 1 ? "it is" : "they are"} due again`,
    );
  if (addedCardIds.length)
    parts.push(`${addedCardIds.length} new to study`);
  const gone = new Set([...removedCardIds, ...retiredCardIds]);
  if (gone.size)
    parts.push(
      `${gone.size} no longer in the deck — your progress is kept in case ${gone.size === 1 ? "it comes" : "they come"} back`,
    );
  if (!parts.length) return "The deck changed. Your progress is unaffected.";
  return `${parts.join(". ")}.`;
}

// -------------------------------------------------- applying to study states

/** A reset scheduling record: seen before, but due now and treated as new. */
export function resetStudyState(
  state: PersonalStudyState,
  now: number,
): PersonalStudyState {
  return {
    ...state,
    // Attempts and lapses stay: the learner did that work, and the Progress
    // mode should still show it. Only the schedule goes back to the start.
    ease: 2.5,
    stabilityDays: 0,
    difficulty: Math.min(10, Math.max(1, state.difficulty)),
    nextDueAt: now,
  };
}

export type StudyStatePlanEntry = {
  cardId: string;
  direction: StudyDirection;
  action: "keep" | "reset" | "retire" | "restore";
};

/**
 * Turns a reconciliation into the exact per-state operations to run, given the
 * study states that exist today. A direction that was retired earlier and is
 * offered again comes back as `restore` rather than a fresh start.
 */
export function planStudyStateUpdates(
  reconciliation: DeckStudyReconciliation,
  existing: readonly { cardId: string; direction: StudyDirection; retired?: boolean }[],
): readonly StudyStatePlanEntry[] {
  const byKey = new Map(
    existing.map((state) => [`${state.cardId}:${state.direction}`, state]),
  );
  const plan: StudyStatePlanEntry[] = [];
  for (const outcome of reconciliation.outcomes) {
    for (const direction of outcome.reset) {
      if (byKey.has(`${outcome.cardId}:${direction}`))
        plan.push({ cardId: outcome.cardId, direction, action: "reset" });
    }
    for (const direction of outcome.retire) {
      const state = byKey.get(`${outcome.cardId}:${direction}`);
      if (state && state.retired !== true)
        plan.push({ cardId: outcome.cardId, direction, action: "retire" });
    }
    for (const direction of [...outcome.introduce, ...outcome.keep]) {
      const state = byKey.get(`${outcome.cardId}:${direction}`);
      if (state?.retired === true)
        plan.push({ cardId: outcome.cardId, direction, action: "restore" });
    }
  }
  return plan;
}

// ----------------------------------------------------------- write boundary

/**
 * Fields on a card that AI and collaborative edits may write. Personal study
 * state is not here and has no path into deck content, which is what keeps
 * "improve these cards" from quietly resetting somebody's revision (§11B).
 */
export const DECK_SOURCE_FIELDS = [
  "id",
  "variant",
  "front",
  "back",
  "hint",
  "explanation",
  "acceptedAlternatives",
  "section",
  "tags",
  "confidence",
  "difficulty",
  "learningObjective",
  "language",
  "bidirectional",
  "media",
  "occlusions",
  "sourceRefs",
] as const;

/** Legacy per-card scheduling. Personal state supersedes it; it is read, never written. */
export const DECK_LEGACY_PROGRESS_FIELD = "review";

export type DeckWriteViolation = { cardId: string; field: string; reason: string };

/**
 * Checks a proposed card write against the source/progress boundary. Used on
 * the AI mutation path so a model that returns a whole card object cannot carry
 * a `review` block back into the deck.
 */
export function checkDeckWrite(
  cardId: string,
  patch: Record<string, unknown>,
): readonly DeckWriteViolation[] {
  const allowed = new Set<string>(DECK_SOURCE_FIELDS);
  return Object.keys(patch).flatMap((field) => {
    if (allowed.has(field)) return [];
    if (field === DECK_LEGACY_PROGRESS_FIELD)
      return [
        {
          cardId,
          field,
          reason:
            "Study progress belongs to each person, not to the deck. Edit the card instead.",
        },
      ];
    return [
      { cardId, field, reason: `${field} is not part of a card's source content.` },
    ];
  });
}

/** Strips anything outside the source boundary, for import and AI paths. */
export function sanitizeDeckCardWrite(patch: Record<string, unknown>) {
  const allowed = new Set<string>(DECK_SOURCE_FIELDS);
  return Object.fromEntries(
    Object.entries(patch).filter(([field]) => allowed.has(field)),
  );
}
