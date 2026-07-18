import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireArtifactCapability } from "./spectraShared";

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

function projection(state: Doc<"flashcardStudyStates">, now: number) {
  const previews = Object.fromEntries(
    (["again", "hard", "good", "easy"] as const).map((candidate) => {
      const next = schedule(state, candidate, now);
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
    stabilityDays: state.stabilityDays,
    difficulty: state.difficulty,
    lapses: state.lapses,
    nextDueAt: state.nextDueAt,
    lastReviewedAt: state.lastReviewedAt,
    previews,
  };
}

function cardDirections(artifact: Doc<"spectraArtifacts">) {
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
      return typeof id === "string" && id.trim()
        ? [[id.trim(), card.bidirectional === true] as const]
        : [];
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
    const activeCards = cardDirections(artifact);
    const states = await ctx.db
      .query("flashcardStudyStates")
      .withIndex("by_account_artifact", (q) =>
        q.eq("accountId", actor.accountId).eq("artifactId", artifact._id),
      )
      .collect();
    const now = Date.now();
    return {
      states: states
        .filter(
          (state) =>
            activeCards.has(state.cardId) &&
            ((state.direction ?? "forward") === "forward" ||
              activeCards.get(state.cardId) === true),
        )
        .map((state) => projection(state, now)),
      dueCount: states.filter(
        (state) =>
          activeCards.has(state.cardId) &&
          ((state.direction ?? "forward") === "forward" ||
            activeCards.get(state.cardId) === true) &&
          state.nextDueAt <= now,
      ).length,
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
    const activeCards = cardDirections(artifact);
    if (
      !cardId ||
      !activeCards.has(cardId) ||
      (direction === "reverse" && activeCards.get(cardId) !== true)
    )
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
      return { state: projection(existing, Date.now()), reused: true };
    const now = Date.now();
    const next = schedule(existing ?? null, args.rating, now);
    const fields = {
      cardVersionId: artifact.currentVersionId,
      algorithm: "spectra_scheduler",
      algorithmVersion: 1,
      attempts: next.attempts,
      ease: next.ease,
      stabilityDays: next.stabilityDays,
      difficulty: next.difficulty,
      lapses: next.lapses,
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
    return { state: projection(state, now), reused: false };
  },
});
