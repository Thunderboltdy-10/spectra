import { mutation, query } from "./functions";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireArtifactCapability } from "./spectraShared";
import {
  cardMeaningFingerprint,
  type StudyCardShape,
} from "@/features/spectra/flashcards/study-separation";

const rating = v.union(
  v.literal("again"),
  v.literal("hard"),
  v.literal("good"),
  v.literal("easy"),
);

type Rating = "again" | "hard" | "good" | "easy";
type StudyDirection = "forward" | "reverse";
type StudyState = Pick<
  Doc<"flashcardStudyStates">,
  "attempts" | "ease" | "stabilityDays" | "difficulty" | "lapses"
>;

const DAY = 86_400_000;
const MINUTE = 60_000;

function bounded(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function schedule(state: StudyState | null, value: Rating, now: number) {
  const attempts = state?.attempts ?? 0;
  const currentStability = state?.stabilityDays ?? 0;
  const currentDifficulty = state?.difficulty ?? 5;
  const currentEase = state?.ease ?? 2.5;
  let intervalMs: number;
  let stabilityDays: number;
  let lapses = state?.lapses ?? 0;
  let ease = currentEase;
  let difficulty = currentDifficulty;

  if (attempts === 0) {
    intervalMs =
      value === "again"
        ? MINUTE
        : value === "hard"
          ? 6 * MINUTE
          : value === "good"
            ? DAY
            : 4 * DAY;
    stabilityDays = intervalMs / DAY;
  } else if (value === "again") {
    intervalMs = 10 * MINUTE;
    stabilityDays = Math.max(0.08, currentStability * 0.34);
    lapses += 1;
  } else if (value === "hard") {
    stabilityDays = Math.max(0.25, currentStability * 1.2);
    intervalMs = Math.max(10 * MINUTE, stabilityDays * DAY);
  } else if (value === "good") {
    stabilityDays = Math.max(1, currentStability * currentEase);
    intervalMs = stabilityDays * DAY;
  } else {
    stabilityDays = Math.max(4, currentStability * currentEase * 1.45);
    intervalMs = stabilityDays * DAY;
  }

  ease = bounded(
    ease +
      (value === "again"
        ? -0.2
        : value === "hard"
          ? -0.08
          : value === "easy"
            ? 0.12
            : 0.02),
    1.3,
    3.2,
  );
  difficulty = bounded(
    difficulty +
      (value === "again"
        ? 0.7
        : value === "hard"
          ? 0.3
          : value === "easy"
            ? -0.45
            : -0.1),
    1,
    10,
  );
  intervalMs = bounded(intervalMs, MINUTE, 3650 * DAY);
  return {
    attempts: attempts + 1,
    ease,
    stabilityDays,
    difficulty,
    lapses,
    nextDueAt: now + intervalMs,
    scheduledDays: intervalMs / DAY,
  };
}

function intervalLabel(milliseconds: number) {
  if (milliseconds < 60 * MINUTE)
    return `${Math.max(1, Math.round(milliseconds / MINUTE))} min`;
  if (milliseconds < DAY)
    return `${Math.max(1, Math.round(milliseconds / (60 * MINUTE)))} hr`;
  if (milliseconds < 30 * DAY)
    return `${Math.max(1, Math.round(milliseconds / DAY))} d`;
  if (milliseconds < 365 * DAY)
    return `${Math.max(1, Math.round(milliseconds / (30 * DAY)))} mo`;
  return `${Math.max(1, Math.round(milliseconds / (365 * DAY)))} yr`;
}

function projection(
  state: Doc<"flashcardStudyStates">,
  now: number,
  fingerprint?: string,
) {
  // A card whose question changed after this state was last touched is due now,
  // whatever the schedule said. The stored record is left alone until the
  // learner reviews or reconciles, so nothing is lost by simply reading (§11B).
  const changed = Boolean(
    fingerprint && state.meaningFingerprint && state.meaningFingerprint !== fingerprint,
  );
  const previews = Object.fromEntries(
    (["again", "hard", "good", "easy"] as const).map((candidate) => {
      const next = schedule(changed ? null : state, candidate, now);
      return [
        candidate,
        {
          nextDueAt: next.nextDueAt,
          label: intervalLabel(next.nextDueAt - now),
        },
      ];
    }),
  );
  return {
    stateId: state._id,
    cardId: state.cardId,
    direction: state.direction ?? "forward",
    cardVersionId: state.cardVersionId,
    algorithm: state.algorithm,
    algorithmVersion: state.algorithmVersion,
    attempts: state.attempts,
    ease: state.ease,
    stabilityDays: changed ? 0 : state.stabilityDays,
    difficulty: state.difficulty,
    lapses: state.lapses,
    nextDueAt: changed ? now : state.nextDueAt,
    lastReviewedAt: state.lastReviewedAt,
    note: state.note,
    /** The card was rewritten since this was last studied. */
    changedSinceStudied: changed,
    previews,
  };
}

/** A card of a deck kept on a computer: Spectra holds its progress, never its words. */
const DEVICE_CARD = { fingerprint: undefined, bidirectional: true };

function studyCard(artifact: Doc<"spectraArtifacts">, cardId: string) {
  return artifact.storageHome === "device" ? DEVICE_CARD : deckCardIndex(artifact).get(cardId);
}

/**
 * The deck's cards as this module needs them: which directions each offers and
 * what each is currently asking. Anything else on a card is deck presentation
 * and has no bearing on someone's progress.
 */
function deckCardIndex(artifact: Doc<"spectraArtifacts">) {
  const content =
    artifact.content &&
    typeof artifact.content === "object" &&
    !Array.isArray(artifact.content)
      ? (artifact.content as Record<string, unknown>)
      : {};
  return new Map(
    (Array.isArray(content.cards) ? content.cards : []).flatMap((candidate) => {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      )
        return [];
      const card = candidate as Record<string, unknown>;
      const id = card.id;
      if (typeof id !== "string" || !id.trim()) return [];
      const shape: StudyCardShape = {
        id: id.trim(),
        front: typeof card.front === "string" ? card.front : "",
        back: typeof card.back === "string" ? card.back : "",
        ...(typeof card.variant === "string" ? { variant: card.variant } : {}),
        ...(Array.isArray(card.acceptedAlternatives)
          ? {
              acceptedAlternatives: card.acceptedAlternatives.filter(
                (entry): entry is string => typeof entry === "string",
              ),
            }
          : {}),
        ...(card.media && typeof card.media === "object"
          ? { media: card.media as StudyCardShape["media"] }
          : {}),
        ...(Array.isArray(card.occlusions)
          ? { occlusions: card.occlusions as StudyCardShape["occlusions"] }
          : {}),
      };
      return [
        [
          shape.id,
          {
            bidirectional: card.bidirectional === true,
            fingerprint: cardMeaningFingerprint(shape),
          },
        ] as const,
      ];
    }),
  );
}

export const list = query({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "use",
    );
    if (
      artifact.blueprintKey !== "flashcard_deck" ||
      artifact.status !== "active"
    )
      throw new Error("FLASHCARD_DECK_UNAVAILABLE");
    const index = deckCardIndex(artifact);
    const cardOf = (cardId: string) => (artifact.storageHome === "device" ? DEVICE_CARD : index.get(cardId));
    const states = await ctx.db
      .query("flashcardStudyStates")
      .withIndex("by_account_artifact", (q) =>
        q.eq("accountId", actor.accountId).eq("artifactId", artifact._id),
      )
      .collect();
    const now = Date.now();
    const studiable = (state: Doc<"flashcardStudyStates">) => {
      const card = cardOf(state.cardId);
      if (!card) return false;
      return (state.direction ?? "forward") === "forward" || card.bidirectional;
    };
    const active = states.filter(studiable);
    const projected = active.map((state) =>
      projection(state, now, cardOf(state.cardId)?.fingerprint),
    );
    // Progress for cards the deck no longer offers is kept, not deleted, so
    // restoring a card or turning reverse study back on restores the history
    // with it. It is reported separately rather than counted as due (§11B).
    const retired = states.filter((state) => !studiable(state));
    const changed = projected.filter((entry) => entry.changedSinceStudied);
    return {
      states: projected,
      dueCount: projected.filter((entry) => entry.nextDueAt <= now).length,
      update: {
        changedCardIds: [...new Set(changed.map((entry) => entry.cardId))],
        retainedCardIds: [...new Set(retired.map((state) => state.cardId))],
        studiedCardIds: [...new Set(active.map((state) => state.cardId))],
      },
    };
  },
});

export const review = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    cardId: v.string(),
    direction: v.optional(v.union(v.literal("forward"), v.literal("reverse"))),
    rating,
    clientReviewId: v.string(),
    elapsedMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "use",
    );
    if (
      artifact.blueprintKey !== "flashcard_deck" ||
      artifact.status !== "active"
    )
      throw new Error("FLASHCARD_DECK_UNAVAILABLE");
    const cardId = args.cardId.trim();
    const direction: StudyDirection = args.direction ?? "forward";
    const card = studyCard(artifact, cardId);
    if (!cardId || !card || (direction === "reverse" && !card.bidirectional))
      throw new Error("FLASHCARD_CARD_UNAVAILABLE");
    const clientReviewId = args.clientReviewId.trim().slice(0, 180);
    if (clientReviewId.length < 8)
      throw new Error("FLASHCARD_REVIEW_ID_INVALID");
    const duplicate = await ctx.db
      .query("flashcardStudyReviews")
      .withIndex("by_account_client", (q) =>
        q.eq("accountId", actor.accountId).eq("clientReviewId", clientReviewId),
      )
      .unique();
    const matchingStates = await ctx.db
      .query("flashcardStudyStates")
      .withIndex("by_account_artifact_card", (q) =>
        q
          .eq("accountId", actor.accountId)
          .eq("artifactId", artifact._id)
          .eq("cardId", cardId),
      )
      .collect();
    const existing = matchingStates.find(
      (state) => (state.direction ?? "forward") === direction,
    );
    if (duplicate && existing)
      return {
        state: projection(existing, Date.now(), card.fingerprint),
        reused: true,
      };
    const now = Date.now();
    // The card was rewritten since this person last saw it, so it is scheduled
    // from first sight rather than from a history that described a different
    // question. Their lifetime counts still carry across (§11B).
    const rewritten = Boolean(
      existing?.meaningFingerprint &&
        existing.meaningFingerprint !== card.fingerprint,
    );
    const next = schedule(rewritten ? null : (existing ?? null), args.rating, now);
    const fields = {
      cardVersionId: artifact.currentVersionId,
      meaningFingerprint: card.fingerprint,
      algorithm: "spectra_scheduler",
      algorithmVersion: 1,
      attempts: rewritten ? (existing?.attempts ?? 0) + 1 : next.attempts,
      ease: next.ease,
      stabilityDays: next.stabilityDays,
      difficulty: next.difficulty,
      lapses: rewritten ? (existing?.lapses ?? 0) : next.lapses,
      nextDueAt: next.nextDueAt,
      lastReviewedAt: now,
      updatedAt: now,
    };
    const stateId = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert("flashcardStudyStates", {
          accountId: actor.accountId,
          schoolId: actor.schoolId,
          artifactId: artifact._id,
          cardId,
          direction,
          ...fields,
          createdAt: now,
        });
    await ctx.db.insert("flashcardStudyReviews", {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      artifactId: artifact._id,
      cardId,
      direction,
      cardVersionId: artifact.currentVersionId,
      clientReviewId,
      rating: args.rating,
      previousNextDueAt: existing?.nextDueAt,
      scheduledDays: next.scheduledDays,
      ...(typeof args.elapsedMs === "number"
        ? { elapsedMs: bounded(Math.round(args.elapsedMs), 0, 3_600_000) }
        : {}),
      reviewedAt: now,
    });
    const state = await ctx.db.get(stateId);
    if (!state) throw new Error("FLASHCARD_STUDY_STATE_UNAVAILABLE");
    return { state: projection(state, now, card.fingerprint), reused: false };
  },
});

/**
 * A learner's own note on a card. It lives with their study state, never in the
 * deck, so writing one changes nothing for anyone else studying the same deck.
 */
export const setNote = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    cardId: v.string(),
    direction: v.optional(v.union(v.literal("forward"), v.literal("reverse"))),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "use",
    );
    if (
      artifact.blueprintKey !== "flashcard_deck" ||
      artifact.status !== "active"
    )
      throw new Error("FLASHCARD_DECK_UNAVAILABLE");
    const cardId = args.cardId.trim();
    const direction: StudyDirection = args.direction ?? "forward";
    const card = studyCard(artifact, cardId);
    if (!card || (direction === "reverse" && !card.bidirectional))
      throw new Error("FLASHCARD_CARD_UNAVAILABLE");
    const note = args.note.slice(0, 4_000);
    const now = Date.now();
    const existing = (
      await ctx.db
        .query("flashcardStudyStates")
        .withIndex("by_account_artifact_card", (q) =>
          q
            .eq("accountId", actor.accountId)
            .eq("artifactId", artifact._id)
            .eq("cardId", cardId),
        )
        .collect()
    ).find((state) => (state.direction ?? "forward") === direction);
    if (existing) {
      await ctx.db.patch(existing._id, { note, updatedAt: now });
      return { cardId, direction, note };
    }
    // A note can precede the first review, so the state is created unstudied
    // and due now rather than the note being dropped.
    await ctx.db.insert("flashcardStudyStates", {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      artifactId: artifact._id,
      cardId,
      direction,
      meaningFingerprint: card.fingerprint,
      note,
      algorithm: "spectra_scheduler",
      algorithmVersion: 1,
      attempts: 0,
      ease: 2.5,
      stabilityDays: 0,
      difficulty: 5,
      lapses: 0,
      nextDueAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { cardId, direction, note };
  },
});
