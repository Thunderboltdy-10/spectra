import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireArtifactCapability } from "./spectraShared";
import {
  cardMeaningFingerprint,
  type StudyCardShape,
} from "@/features/spectra/flashcards/study-separation";
import {
  FSRS_ALGORITHM,
  FSRS_ALGORITHM_VERSION,
  FSRS_DAY_MS,
  fsrsIntervalLabel,
  previewFsrsRatings,
  scheduleFsrsReview,
  type FsrsCardState,
} from "@/features/spectra/flashcards/fsrs";
import {
  normalizeFlashcardDeckContent,
  type FlashcardSchedulerOptions,
} from "@/features/spectra/flashcards/model";

const rating = v.union(
  v.literal("again"),
  v.literal("hard"),
  v.literal("good"),
  v.literal("easy"),
);

type StudyDirection = "forward" | "reverse";
type StudyState = Pick<
  Doc<"flashcardStudyStates">,
  | "attempts"
  | "stabilityDays"
  | "difficulty"
  | "lapses"
  | "lastReviewedAt"
  | "memoryState"
  | "learningStep"
>;

const DAY = FSRS_DAY_MS;

function bounded(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function studySnapshot(state: Doc<"flashcardStudyStates">) {
  return Object.fromEntries(
    Object.entries({
      algorithm: state.algorithm,
      algorithmVersion: state.algorithmVersion,
      attempts: state.attempts,
      ease: state.ease,
      stabilityDays: state.stabilityDays,
      difficulty: state.difficulty,
      lapses: state.lapses,
      nextDueAt: state.nextDueAt,
      lastReviewedAt: state.lastReviewedAt,
      memoryState: state.memoryState,
      learningStep: state.learningStep,
      elapsedDays: state.elapsedDays,
      retrievability: state.retrievability,
      leech: state.leech,
      buriedUntil: state.buriedUntil,
      suspendedAt: state.suspendedAt,
    }).filter(([, value]) => value !== undefined),
  );
}

function schedulerState(state: StudyState | null): FsrsCardState | null {
  if (!state) return null;
  return {
    attempts: state.attempts,
    stabilityDays: state.stabilityDays,
    difficulty: state.difficulty,
    lapses: state.lapses,
    lastReviewedAt: state.lastReviewedAt,
    memoryState: state.memoryState,
    learningStep: state.learningStep,
  };
}

function projection(
  state: Doc<"flashcardStudyStates">,
  now: number,
  options: FlashcardSchedulerOptions,
  fingerprint?: string,
) {
  // A card whose question changed after this state was last touched is due now,
  // whatever the schedule said. The stored record is left alone until the
  // learner reviews or reconciles, so nothing is lost by simply reading (§11B).
  const changed = Boolean(
    fingerprint &&
    state.meaningFingerprint &&
    state.meaningFingerprint !== fingerprint,
  );
  const ratings = previewFsrsRatings(
    changed ? null : schedulerState(state),
    now,
    options,
  );
  const previews = Object.fromEntries(
    (["again", "hard", "good", "easy"] as const).map((candidate) => {
      const next = ratings[candidate];
      return [
        candidate,
        {
          nextDueAt: next.nextDueAt,
          label: fsrsIntervalLabel(next.nextDueAt - now),
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
    memoryState: state.memoryState ?? (state.attempts ? "review" : "new"),
    learningStep: state.learningStep ?? 0,
    elapsedDays: state.elapsedDays ?? 0,
    retrievability: changed ? 0 : (state.retrievability ?? 0),
    leech: state.leech ?? state.lapses >= options.leechThreshold,
    buriedUntil: state.buriedUntil,
    suspendedAt: state.suspendedAt,
    nextDueAt: changed ? now : state.nextDueAt,
    lastReviewedAt: state.lastReviewedAt,
    note: state.note,
    /** The card was rewritten since this was last studied. */
    changedSinceStudied: changed,
    previews,
  };
}

/**
 * The deck's cards as this module needs them: which directions each offers and
 * what each is currently asking. Anything else on a card is deck presentation
 * and has no bearing on someone's progress.
 */
function deckModel(artifact: Doc<"spectraArtifacts">) {
  const content = normalizeFlashcardDeckContent(artifact.content);
  const cards = new Map(
    content.cards.flatMap((card) => {
      const id = card.id;
      if (!id.trim()) return [];
      const shape: StudyCardShape = {
        id: id.trim(),
        front: card.front,
        back: card.back,
        ...(card.variant ? { variant: card.variant } : {}),
        ...(card.acceptedAlternatives
          ? {
              acceptedAlternatives: card.acceptedAlternatives,
            }
          : {}),
        ...(card.media ? { media: card.media as StudyCardShape["media"] } : {}),
        ...(card.occlusions
          ? { occlusions: card.occlusions as StudyCardShape["occlusions"] }
          : {}),
      };
      return [
        [
          shape.id,
          {
            bidirectional: card.bidirectional === true,
            fingerprint: cardMeaningFingerprint(shape),
            section: card.section ?? "Section 1",
          },
        ] as const,
      ];
    }),
  );
  return { cards, options: content.settings.scheduler };
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
    const deck = deckModel(artifact);
    const index = deck.cards;
    const states = await ctx.db
      .query("flashcardStudyStates")
      .withIndex("by_account_artifact", (q) =>
        q.eq("accountId", actor.accountId).eq("artifactId", artifact._id),
      )
      .collect();
    const now = Date.now();
    const studiable = (state: Doc<"flashcardStudyStates">) => {
      const card = index.get(state.cardId);
      if (!card) return false;
      return (state.direction ?? "forward") === "forward" || card.bidirectional;
    };
    const active = states.filter(studiable);
    const projected = active.map((state) =>
      projection(
        state,
        now,
        deck.options,
        index.get(state.cardId)?.fingerprint,
      ),
    );
    const reviews = (
      await ctx.db
        .query("flashcardStudyReviews")
        .withIndex("by_account_artifact_created", (q) =>
          q.eq("accountId", actor.accountId).eq("artifactId", artifact._id),
        )
        .collect()
    ).filter((entry) => !entry.undoneAt);
    const remembered = reviews.filter(
      (entry) => entry.rating !== "again",
    ).length;
    const forecast = Array.from({ length: 30 }, (_, offset) => ({
      date: new Date(now + offset * DAY).toISOString().slice(0, 10),
      count: 0,
    }));
    for (const state of projected) {
      if (state.suspendedAt) continue;
      const offset = Math.floor((Math.max(now, state.nextDueAt) - now) / DAY);
      if (forecast[offset]) forecast[offset].count += 1;
    }
    const heatmapCounts = new Map<string, number>();
    for (const entry of reviews) {
      const date = new Date(entry.reviewedAt).toISOString().slice(0, 10);
      heatmapCounts.set(date, (heatmapCounts.get(date) ?? 0) + 1);
    }
    // Progress for cards the deck no longer offers is kept, not deleted, so
    // restoring a card or turning reverse study back on restores the history
    // with it. It is reported separately rather than counted as due (§11B).
    const retired = states.filter((state) => !studiable(state));
    const changed = projected.filter((entry) => entry.changedSinceStudied);
    return {
      states: projected,
      dueCount: projected.filter(
        (entry) =>
          entry.nextDueAt <= now &&
          !entry.suspendedAt &&
          (!entry.buriedUntil || entry.buriedUntil <= now),
      ).length,
      update: {
        changedCardIds: [...new Set(changed.map((entry) => entry.cardId))],
        retainedCardIds: [...new Set(retired.map((state) => state.cardId))],
        studiedCardIds: [...new Set(active.map((state) => state.cardId))],
      },
      options: deck.options,
      statistics: {
        retention: {
          reviews: reviews.length,
          remembered,
          rememberedRate: reviews.length ? remembered / reviews.length : null,
          desiredRetention: deck.options.desiredRetention,
        },
        forecast,
        heatmap: [...heatmapCounts.entries()]
          .map(([date, count]) => ({ date, count }))
          .sort((left, right) => left.date.localeCompare(right.date))
          .slice(-365),
        leeches: projected
          .filter((state) => state.leech)
          .map((state) => ({
            cardId: state.cardId,
            direction: state.direction,
            lapses: state.lapses,
            suspended: Boolean(state.suspendedAt),
          })),
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
    const deck = deckModel(artifact);
    const card = deck.cards.get(cardId);
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
        state: projection(existing, Date.now(), deck.options, card.fingerprint),
        reused: true,
      };
    if (existing?.suspendedAt) throw new Error("FLASHCARD_STUDY_SUSPENDED");
    const now = Date.now();
    // The card was rewritten since this person last saw it, so it is scheduled
    // from first sight rather than from a history that described a different
    // question. Their lifetime counts still carry across (§11B).
    const rewritten = Boolean(
      existing?.meaningFingerprint &&
      existing.meaningFingerprint !== card.fingerprint,
    );
    const next = scheduleFsrsReview(
      rewritten ? null : schedulerState(existing ?? null),
      args.rating,
      now,
      deck.options,
    );
    const fields = {
      cardVersionId: artifact.currentVersionId,
      meaningFingerprint: card.fingerprint,
      algorithm: FSRS_ALGORITHM,
      algorithmVersion: FSRS_ALGORITHM_VERSION,
      attempts: rewritten ? (existing?.attempts ?? 0) + 1 : next.attempts,
      // Kept for backward-compatible clients and filters. Difficulty is the
      // FSRS source of truth; ease is only a derived legacy projection.
      ease: bounded(3.3 - next.difficulty * 0.2, 1.3, 3.1),
      stabilityDays: next.stabilityDays,
      difficulty: next.difficulty,
      lapses: rewritten ? (existing?.lapses ?? 0) : next.lapses,
      nextDueAt: next.nextDueAt,
      lastReviewedAt: now,
      memoryState: next.memoryState,
      learningStep: next.learningStep,
      elapsedDays: next.elapsedDays,
      retrievability: next.retrievability,
      leech: rewritten
        ? (existing?.lapses ?? 0) >= deck.options.leechThreshold
        : next.leech,
      buriedUntil: undefined,
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
      ...(existing ? { previousState: studySnapshot(existing) } : {}),
      scheduledDays: next.scheduledDays,
      ...(typeof args.elapsedMs === "number"
        ? { elapsedMs: bounded(Math.round(args.elapsedMs), 0, 3_600_000) }
        : {}),
      reviewedAt: now,
    });
    const state = await ctx.db.get(stateId);
    if (!state) throw new Error("FLASHCARD_STUDY_STATE_UNAVAILABLE");
    return {
      state: projection(state, now, deck.options, card.fingerprint),
      reused: false,
    };
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
    const deck = deckModel(artifact);
    const card = deck.cards.get(cardId);
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
      algorithm: FSRS_ALGORITHM,
      algorithmVersion: FSRS_ALGORITHM_VERSION,
      attempts: 0,
      ease: 2.5,
      stabilityDays: 0,
      difficulty: 5,
      lapses: 0,
      nextDueAt: now,
      memoryState: "new",
      learningStep: 0,
      elapsedDays: 0,
      retrievability: 0,
      leech: false,
      createdAt: now,
      updatedAt: now,
    });
    return { cardId, direction, note };
  },
});

const studyAction = v.union(
  v.literal("undo"),
  v.literal("bury"),
  v.literal("suspend"),
  v.literal("resume"),
  v.literal("reschedule"),
  v.literal("reset"),
  v.literal("leech-clear"),
  v.literal("leech-suspend"),
);

/** Private scheduling controls. None of these mutations touch authored cards. */
export const manage = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    cardId: v.string(),
    direction: v.optional(v.union(v.literal("forward"), v.literal("reverse"))),
    action: studyAction,
    nextDueAt: v.optional(v.number()),
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
    const deck = deckModel(artifact);
    const card = deck.cards.get(cardId);
    if (!card || (direction === "reverse" && !card.bidirectional))
      throw new Error("FLASHCARD_CARD_UNAVAILABLE");
    const matches = await ctx.db
      .query("flashcardStudyStates")
      .withIndex("by_account_artifact_card", (q) =>
        q
          .eq("accountId", actor.accountId)
          .eq("artifactId", artifact._id)
          .eq("cardId", cardId),
      )
      .collect();
    let state = matches.find(
      (entry) => (entry.direction ?? "forward") === direction,
    );
    const now = Date.now();

    if (args.action === "undo") {
      const latest = (
        await ctx.db
          .query("flashcardStudyReviews")
          .withIndex("by_account_artifact_created", (q) =>
            q.eq("accountId", actor.accountId).eq("artifactId", artifact._id),
          )
          .collect()
      )
        .filter(
          (entry) =>
            entry.cardId === cardId &&
            (entry.direction ?? "forward") === direction &&
            !entry.undoneAt,
        )
        .sort((left, right) => right.reviewedAt - left.reviewedAt)[0];
      if (!latest) throw new Error("FLASHCARD_REVIEW_UNDO_UNAVAILABLE");
      if (state && latest.previousState) {
        await ctx.db.patch(state._id, {
          ...(latest.previousState as Partial<Doc<"flashcardStudyStates">>),
          updatedAt: now,
        });
      } else if (state) {
        await ctx.db.delete(state._id);
        state = undefined;
      }
      await ctx.db.patch(latest._id, { undoneAt: now });
      if (!state) return { removed: true as const };
      const restored = await ctx.db.get(state._id);
      if (!restored) return { removed: true as const };
      return {
        removed: false as const,
        state: projection(restored, now, deck.options, card.fingerprint),
      };
    }

    if (args.action === "reset") {
      if (state) await ctx.db.delete(state._id);
      return { removed: true as const };
    }

    if (!state) {
      const stateId = await ctx.db.insert("flashcardStudyStates", {
        accountId: actor.accountId,
        schoolId: actor.schoolId,
        artifactId: artifact._id,
        cardId,
        direction,
        cardVersionId: artifact.currentVersionId,
        meaningFingerprint: card.fingerprint,
        algorithm: FSRS_ALGORITHM,
        algorithmVersion: FSRS_ALGORITHM_VERSION,
        attempts: 0,
        ease: 2.5,
        stabilityDays: 0,
        difficulty: 5,
        lapses: 0,
        nextDueAt: now,
        memoryState: "new",
        learningStep: 0,
        elapsedDays: 0,
        retrievability: 0,
        leech: false,
        createdAt: now,
        updatedAt: now,
      });
      state = (await ctx.db.get(stateId)) ?? undefined;
    }
    if (!state) throw new Error("FLASHCARD_STUDY_STATE_UNAVAILABLE");

    if (args.action === "bury") {
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(24, 0, 0, 0);
      await ctx.db.patch(state._id, {
        buriedUntil: tomorrow.getTime(),
        updatedAt: now,
      });
    } else if (args.action === "suspend" || args.action === "leech-suspend") {
      await ctx.db.patch(state._id, {
        suspendedAt: now,
        ...(args.action === "leech-suspend" ? { leech: true } : {}),
        updatedAt: now,
      });
    } else if (args.action === "resume") {
      await ctx.db.patch(state._id, { suspendedAt: undefined, updatedAt: now });
    } else if (args.action === "reschedule") {
      if (
        typeof args.nextDueAt !== "number" ||
        !Number.isFinite(args.nextDueAt)
      )
        throw new Error("FLASHCARD_DUE_DATE_INVALID");
      await ctx.db.patch(state._id, {
        nextDueAt: Math.max(0, Math.round(args.nextDueAt)),
        buriedUntil: undefined,
        updatedAt: now,
      });
    } else if (args.action === "leech-clear") {
      await ctx.db.patch(state._id, {
        lapses: 0,
        leech: false,
        updatedAt: now,
      });
    }
    const updated = await ctx.db.get(state._id);
    if (!updated) throw new Error("FLASHCARD_STUDY_STATE_UNAVAILABLE");
    return {
      removed: false as const,
      state: projection(updated, now, deck.options, card.fingerprint),
    };
  },
});

export const resetDeck = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    confirmation: v.literal("RESET"),
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
    const [states, reviews] = await Promise.all([
      ctx.db
        .query("flashcardStudyStates")
        .withIndex("by_account_artifact", (q) =>
          q.eq("accountId", actor.accountId).eq("artifactId", artifact._id),
        )
        .collect(),
      ctx.db
        .query("flashcardStudyReviews")
        .withIndex("by_account_artifact_created", (q) =>
          q.eq("accountId", actor.accountId).eq("artifactId", artifact._id),
        )
        .collect(),
    ]);
    await Promise.all([
      ...states.map((entry) => ctx.db.delete(entry._id)),
      ...reviews.map((entry) => ctx.db.delete(entry._id)),
    ]);
    return {
      reset: true as const,
      states: states.length,
      reviews: reviews.length,
    };
  },
});
