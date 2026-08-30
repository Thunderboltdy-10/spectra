import type { FlashcardSchedulerOptions } from "./model";

export const FSRS_ALGORITHM = "fsrs-family";
export const FSRS_ALGORITHM_VERSION = 4;
export const FSRS_DAY_MS = 86_400_000;

export type FsrsRating = "again" | "hard" | "good" | "easy";
export type FsrsMemoryState = "new" | "learning" | "review" | "relearning";

export type FsrsCardState = {
  attempts: number;
  stabilityDays: number;
  difficulty: number;
  lapses: number;
  lastReviewedAt?: number;
  memoryState?: FsrsMemoryState;
  learningStep?: number;
};

export type FsrsSchedule = FsrsCardState & {
  algorithm: typeof FSRS_ALGORITHM;
  algorithmVersion: typeof FSRS_ALGORITHM_VERSION;
  nextDueAt: number;
  scheduledDays: number;
  elapsedDays: number;
  retrievability: number;
  leech: boolean;
};

// FSRS-5 default weights. Spectra owns the user-facing deck parameters while
// these coefficients stay versioned implementation detail.
const W = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616,
  0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466, 0.5034,
  0.6567,
] as const;
const DECAY = -0.5;
const FACTOR = 19 / 81;
const MINUTE_DAYS = 1 / 1_440;

function bounded(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function ratingValue(rating: FsrsRating) {
  return rating === "again"
    ? 1
    : rating === "hard"
      ? 2
      : rating === "good"
        ? 3
        : 4;
}

export function fsrsRetrievability(stabilityDays: number, elapsedDays: number) {
  if (stabilityDays <= 0) return 0;
  return bounded(
    Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stabilityDays, DECAY),
    0,
    1,
  );
}

export function fsrsIntervalDays(
  stabilityDays: number,
  desiredRetention: number,
  maximumIntervalDays: number,
) {
  const retention = bounded(desiredRetention, 0.7, 0.97);
  const interval =
    (Math.max(MINUTE_DAYS, stabilityDays) / FACTOR) *
    (Math.pow(retention, 1 / DECAY) - 1);
  return bounded(interval, MINUTE_DAYS, maximumIntervalDays);
}

function initialDifficulty(rating: FsrsRating) {
  return bounded(W[4] - Math.exp(W[5] * (ratingValue(rating) - 1)) + 1, 1, 10);
}

function nextDifficulty(current: number, rating: FsrsRating) {
  const changed = current - W[6] * (ratingValue(rating) - 3);
  const reverted = W[7] * initialDifficulty("good") + (1 - W[7]) * changed;
  return bounded(reverted, 1, 10);
}

function initialStability(rating: FsrsRating) {
  return Math.max(MINUTE_DAYS, W[ratingValue(rating) - 1]);
}

function nextForgetStability(
  stability: number,
  difficulty: number,
  retrievability: number,
) {
  return Math.max(
    MINUTE_DAYS,
    W[11] *
      Math.pow(difficulty, -W[12]) *
      (Math.pow(stability + 1, W[13]) - 1) *
      Math.exp(W[14] * (1 - retrievability)),
  );
}

function nextRecallStability(
  stability: number,
  difficulty: number,
  retrievability: number,
  rating: FsrsRating,
) {
  const hardPenalty = rating === "hard" ? W[15] : 1;
  const easyBonus = rating === "easy" ? W[16] : 1;
  const growth =
    Math.exp(W[8]) *
    (11 - difficulty) *
    Math.pow(Math.max(MINUTE_DAYS, stability), -W[9]) *
    (Math.exp((1 - retrievability) * W[10]) - 1) *
    hardPenalty *
    easyBonus;
  return Math.max(MINUTE_DAYS, stability * (1 + Math.max(0, growth)));
}

function stepInterval(steps: readonly number[], index: number) {
  const fallback = steps[steps.length - 1] ?? 10;
  return Math.max(1, steps[index] ?? fallback) / 1_440;
}

function dueFromDays(now: number, days: number) {
  return now + Math.max(60_000, Math.round(days * FSRS_DAY_MS));
}

function longTermInterval(
  stability: number,
  rating: FsrsRating,
  options: FlashcardSchedulerOptions,
) {
  const base = fsrsIntervalDays(
    stability,
    options.desiredRetention,
    options.maximumIntervalDays,
  );
  const adjusted =
    rating === "hard"
      ? base * 0.8
      : rating === "easy"
        ? Math.max(4, base * 1.3)
        : base;
  return bounded(adjusted, MINUTE_DAYS, options.maximumIntervalDays);
}

/**
 * Deterministic FSRS-family transition. It uses FSRS stability, difficulty,
 * retrievability, and desired-retention equations, plus explicit deck-owned
 * learning/relearning steps. No randomness or wall clock is hidden inside it.
 */
export function scheduleFsrsReview(
  state: FsrsCardState | null,
  rating: FsrsRating,
  now: number,
  options: FlashcardSchedulerOptions,
): FsrsSchedule {
  const attempts = Math.max(0, Math.round(state?.attempts ?? 0));
  const previousState: FsrsMemoryState =
    state?.memoryState ?? (attempts ? "review" : "new");
  const elapsedDays = state?.lastReviewedAt
    ? Math.max(0, (now - state.lastReviewedAt) / FSRS_DAY_MS)
    : 0;
  const oldStability = Math.max(MINUTE_DAYS, state?.stabilityDays ?? 0);
  const oldDifficulty = bounded(state?.difficulty ?? 5, 1, 10);
  const retrievability = attempts
    ? fsrsRetrievability(oldStability, elapsedDays)
    : 0;
  let stabilityDays = attempts
    ? rating === "again"
      ? nextForgetStability(oldStability, oldDifficulty, retrievability)
      : nextRecallStability(oldStability, oldDifficulty, retrievability, rating)
    : initialStability(rating);
  const difficulty = attempts
    ? nextDifficulty(oldDifficulty, rating)
    : initialDifficulty(rating);
  const lapse =
    rating === "again" &&
    (previousState === "review" || previousState === "relearning");
  const lapses = Math.max(0, Math.round(state?.lapses ?? 0)) + (lapse ? 1 : 0);
  let memoryState: FsrsMemoryState;
  let learningStep = Math.max(0, Math.round(state?.learningStep ?? 0));
  let scheduledDays: number;

  if (previousState === "new") {
    if (rating === "again") {
      memoryState = "learning";
      learningStep = 0;
      scheduledDays = stepInterval(options.learningStepsMinutes, 0);
    } else if (rating === "hard") {
      memoryState = "learning";
      learningStep = 0;
      const first = stepInterval(options.learningStepsMinutes, 0);
      const second = stepInterval(options.learningStepsMinutes, 1);
      scheduledDays = (first + second) / 2;
    } else if (rating === "good" && options.learningStepsMinutes.length > 1) {
      memoryState = "learning";
      learningStep = 1;
      scheduledDays = stepInterval(options.learningStepsMinutes, 1);
    } else {
      memoryState = "review";
      learningStep = 0;
      scheduledDays = longTermInterval(stabilityDays, rating, options);
    }
  } else if (previousState === "learning" || previousState === "relearning") {
    const steps =
      previousState === "relearning"
        ? options.relearningStepsMinutes
        : options.learningStepsMinutes;
    if (rating === "again") {
      memoryState = previousState;
      learningStep = 0;
      scheduledDays = stepInterval(steps, 0);
    } else if (rating === "hard") {
      memoryState = previousState;
      scheduledDays = stepInterval(steps, learningStep);
    } else if (rating === "good" && learningStep + 1 < steps.length) {
      memoryState = previousState;
      learningStep += 1;
      scheduledDays = stepInterval(steps, learningStep);
    } else {
      memoryState = "review";
      learningStep = 0;
      scheduledDays = longTermInterval(stabilityDays, rating, options);
    }
  } else if (rating === "again") {
    memoryState = "relearning";
    learningStep = 0;
    scheduledDays = stepInterval(options.relearningStepsMinutes, 0);
  } else {
    memoryState = "review";
    learningStep = 0;
    scheduledDays = longTermInterval(stabilityDays, rating, options);
  }

  // A hard response cannot gain more stability than a good one from the same
  // memory state, and easy keeps the documented FSRS bonus.
  if (rating === "hard")
    stabilityDays = Math.min(stabilityDays, oldStability * 1.2);

  return {
    algorithm: FSRS_ALGORITHM,
    algorithmVersion: FSRS_ALGORITHM_VERSION,
    attempts: attempts + 1,
    stabilityDays,
    difficulty,
    lapses,
    lastReviewedAt: now,
    memoryState,
    learningStep,
    nextDueAt: dueFromDays(now, scheduledDays),
    scheduledDays,
    elapsedDays,
    retrievability,
    leech: lapses >= options.leechThreshold,
  };
}

export function previewFsrsRatings(
  state: FsrsCardState | null,
  now: number,
  options: FlashcardSchedulerOptions,
) {
  return Object.fromEntries(
    (["again", "hard", "good", "easy"] as const).map((rating) => [
      rating,
      scheduleFsrsReview(state, rating, now, options),
    ]),
  ) as Record<FsrsRating, FsrsSchedule>;
}

export function fsrsIntervalLabel(milliseconds: number) {
  const minute = 60_000;
  if (milliseconds < 60 * minute)
    return `${Math.max(1, Math.round(milliseconds / minute))} min`;
  if (milliseconds < FSRS_DAY_MS)
    return `${Math.max(1, Math.round(milliseconds / (60 * minute)))} hr`;
  if (milliseconds < 30 * FSRS_DAY_MS)
    return `${Math.max(1, Math.round(milliseconds / FSRS_DAY_MS))} d`;
  if (milliseconds < 365 * FSRS_DAY_MS)
    return `${Math.max(1, Math.round(milliseconds / (30 * FSRS_DAY_MS)))} mo`;
  return `${Math.max(1, Math.round(milliseconds / (365 * FSRS_DAY_MS)))} yr`;
}
