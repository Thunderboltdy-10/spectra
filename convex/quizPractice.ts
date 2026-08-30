import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireArtifactCapability } from "./spectraShared";
import {
  canRevealQuizAnswers,
  canStartQuizAttempt,
  canViewQuizResults,
  normalizeQuizExperience,
  quizAttemptHasExpired,
  quizResponsesArePersisted,
  quizTimeRemainingMs,
  type QuizExperience,
} from "@/features/spectra/quiz/experience";
import {
  normalizeQuizContent,
  normalizeQuizQuestion,
  record,
  type QuizQuestion,
} from "@/features/spectra/quiz/model";
import {
  cleanQuizResponse,
  gradeQuizQuestion,
  quizCohortResponseLabel,
  quizQuestionTimeRemainingMs,
  safeQuizQuestion,
  selectQuizAttempt,
  type QuizPresentationEntry,
} from "@/features/spectra/quiz/operations";

function questionsFrom(artifact: Doc<"spectraArtifacts">) {
  return normalizeQuizContent(artifact.content).questions;
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

/**
 * Whether a verdict may accompany each response. Only an "immediate" reveal
 * policy releases an answer mid-attempt; everything else waits.
 */
function immediateFeedback(experience: QuizExperience) {
  return experience.revealAnswers === "immediate";
}

function timedExperience(
  settings: ReturnType<typeof normalizeQuizContent>["settings"],
): QuizExperience {
  const experience = normalizeQuizExperience(settings);
  if (experience.timing !== "countdown" || !experience.countdownSeconds)
    return experience;
  return {
    ...experience,
    countdownSeconds: Math.round(
      experience.countdownSeconds * settings.defaultTimeMultiplier,
    ),
  };
}

function median(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const questionResult = gradeQuizQuestion;

function projectReviewResult(
  result: ReturnType<typeof gradeQuizQuestion>,
  settings: ReturnType<typeof normalizeQuizContent>["settings"],
): ReturnType<typeof gradeQuizQuestion> & {
  scoreVisible: boolean;
  correctnessVisible: boolean;
  answersVisible: boolean;
} {
  const policy = settings.reviewPolicy;
  return {
    ...result,
    correct: policy.showCorrectness ? result.correct : null,
    awardedPoints: policy.showScore ? result.awardedPoints : 0,
    maxPoints: policy.showScore ? result.maxPoints : 0,
    expected: policy.showCorrectAnswers ? result.expected : "",
    explanation: policy.showExplanations ? result.explanation : undefined,
    advisoryFeedback: policy.showFeedback ? result.advisoryFeedback : undefined,
    answerFeedback: policy.showFeedback ? result.answerFeedback : undefined,
    partResults: result.partResults?.map((part) =>
      projectReviewResult(part, settings),
    ),
    scoreVisible: policy.showScore,
    correctnessVisible: policy.showCorrectness,
    answersVisible: policy.showCorrectAnswers,
  };
}

function questionTiming(
  attempt: Doc<"quizPracticeAttempts">,
  question: QuizQuestion,
  settings: ReturnType<typeof normalizeQuizContent>["settings"],
  now: number,
) {
  const startedAt = attempt.questionStartedAt?.[question.id];
  return {
    startedAt,
    remainingMs: quizQuestionTimeRemainingMs({
      question,
      startedAt,
      now,
      multiplier: settings.defaultTimeMultiplier,
      enforce: settings.enforceQuestionTimeLimits,
    }),
  };
}

async function attemptProjection(
  ctx: Parameters<typeof requireArtifactCapability>[0],
  attempt: Doc<"quizPracticeAttempts">,
) {
  const snapshot = record(attempt.quizSnapshot);
  const normalizedSnapshot = normalizeQuizContent({
    questions: snapshot.questions,
    settings: snapshot.settings,
  });
  const experience = timedExperience(normalizedSnapshot.settings);
  const questions = normalizedSnapshot.questions;
  const responses = await ctx.db
    .query("quizPracticeResponses")
    .withIndex("by_attempt", (q) => q.eq("attemptId", attempt._id))
    .collect();
  const responseByQuestion = new Map(
    responses.map((entry) => [entry.questionId, entry.response]),
  );
  const ordered = attempt.presentationManifest.flatMap((entry) => {
    const question = questions.find(
      (candidate) => candidate.id === entry.questionId,
    );
    if (!question) return [];
    const normalizedQuestion = normalizeQuizQuestion(question);
    const legacyOptionIds = entry.optionOrder.flatMap((option) => {
      const index = normalizedQuestion.options.indexOf(option);
      return index >= 0 ? [normalizedQuestion.optionIds[index]!] : [];
    });
    const presentation: QuizPresentationEntry = {
      questionId: entry.questionId,
      optionOrder: entry.optionOrder,
      optionIdOrder: entry.optionIdOrder?.length
        ? entry.optionIdOrder
        : legacyOptionIds,
    };
    return [safeQuizQuestion(normalizedQuestion, presentation)];
  });
  // Answers are withheld here, not in the browser. An answer that has not been
  // released never leaves the server, so no client, export or model can reach
  // it early (§11C).
  const now = Date.now();
  const revealed = canRevealQuizAnswers(experience, {
    attempt: {
      status: attempt.status === "submitted" ? "submitted" : "in_progress",
      ...(attempt.submittedAt ? { submittedAt: attempt.submittedAt } : {}),
    },
    viewer: "learner",
    now,
  });
  const result =
    attempt.status === "submitted" && revealed
      ? questions.map((question) =>
          projectReviewResult(
            questionResult(question, responseByQuestion.get(question.id) ?? ""),
            normalizedSnapshot.settings,
          ),
        )
      : undefined;
  const scoreVisible = normalizedSnapshot.settings.reviewPolicy.showScore;
  return {
    attemptId: attempt._id,
    artifactId: attempt.artifactId,
    artifactVersionId: attempt.artifactVersionId,
    contentHash: attempt.contentHash,
    status: attempt.status,
    questions: ordered,
    responses: Object.fromEntries(responseByQuestion),
    score: scoreVisible ? attempt.score : undefined,
    maxScore: scoreVisible ? attempt.maxScore : undefined,
    percentage: scoreVisible ? attempt.percentage : undefined,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    elapsedMs: attempt.elapsedMs,
    ...(attempt.timeElapsed ? { timeElapsed: true } : {}),
    settings: record(snapshot.settings),
    experience,
    // The clock is derived from the server's startedAt, so a refresh resumes
    // the same attempt with the time that has actually passed (§11C).
    timeRemainingMs: quizTimeRemainingMs(experience, attempt, now),
    questionTiming: Object.fromEntries(
      questions.map((question) => [
        question.id,
        questionTiming(attempt, question, normalizedSnapshot.settings, now),
      ]),
    ),
    answersRevealed: revealed,
    instructions:
      typeof record(snapshot.settings).instructions === "string"
        ? String(record(snapshot.settings).instructions)
        : "",
    ...(result ? { results: result } : {}),
  };
}

export const start = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    clientAttemptId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "use",
    );
    if (artifact.blueprintKey !== "quiz" || artifact.status !== "active")
      throw new Error("QUIZ_PRACTICE_UNAVAILABLE");
    if (record(artifact.content).published !== true)
      throw new Error("QUIZ_PRACTICE_NOT_PUBLISHED");
    const clientAttemptId = args.clientAttemptId.trim().slice(0, 180);
    if (clientAttemptId.length < 8) throw new Error("QUIZ_ATTEMPT_ID_INVALID");
    const existing = await ctx.db
      .query("quizPracticeAttempts")
      .withIndex("by_account_client", (q) =>
        q
          .eq("accountId", actor.accountId)
          .eq("clientAttemptId", clientAttemptId),
      )
      .unique();
    if (existing) return attemptProjection(ctx, existing);
    const content = normalizeQuizContent(artifact.content);
    if (!content.questions.length) throw new Error("QUIZ_HAS_NO_QUESTIONS");
    const settings = content.settings;
    const experience = timedExperience(settings);
    // One decision covers attempt limits and the closing deadline, so the
    // server and the surface can never disagree about whether a person may
    // start (§11C).
    const existingAttempts = await ctx.db
      .query("quizPracticeAttempts")
      .withIndex("by_account_artifact_started", (q) =>
        q.eq("accountId", actor.accountId).eq("artifactId", artifact._id),
      )
      .collect();
    const decision = canStartQuizAttempt(experience, {
      attemptsUsed: existingAttempts.length,
      now: Date.now(),
    });
    if (!decision.allowed)
      throw new Error(`QUIZ_PRACTICE_UNAVAILABLE: ${decision.reason}`);
    const selected = selectQuizAttempt(content, clientAttemptId);
    const selectedQuestions = selected.questions;
    const snapshot = {
      title: artifact.title,
      settings,
      questions: selectedQuestions,
    };
    const encoded = JSON.stringify(snapshot);
    const presentationManifest = selected.manifest;
    const now = Date.now();
    const firstQuestionId = presentationManifest[0]?.questionId;
    const attemptId = await ctx.db.insert("quizPracticeAttempts", {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      artifactId: artifact._id,
      artifactVersionId: artifact.currentVersionId,
      clientAttemptId,
      status: "in_progress",
      quizSnapshot: snapshot,
      contentHash: hash(encoded),
      presentationManifest,
      startedAt: now,
      ...(settings.enforceQuestionTimeLimits && firstQuestionId
        ? { questionStartedAt: { [firstQuestionId]: now } }
        : {}),
      updatedAt: now,
    });
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) throw new Error("QUIZ_ATTEMPT_UNAVAILABLE");
    return attemptProjection(ctx, attempt);
  },
});

export const saveResponse = mutation({
  args: {
    attemptId: v.id("quizPracticeAttempts"),
    questionId: v.string(),
    response: v.any(),
    clientMutationId: v.string(),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("QUIZ_ATTEMPT_UNAVAILABLE");
    const { actor } = await requireArtifactCapability(
      ctx,
      attempt.artifactId,
      "use",
    );
    if (
      attempt.accountId !== actor.accountId ||
      attempt.status !== "in_progress"
    )
      throw new Error("QUIZ_ATTEMPT_NOT_EDITABLE");
    const snapshot = record(attempt.quizSnapshot);
    const normalizedSnapshot = normalizeQuizContent({
      questions: snapshot.questions,
      settings: snapshot.settings,
    });
    const experience = timedExperience(normalizedSnapshot.settings);
    // A timed attempt stops accepting responses when its own clock runs out,
    // whatever the tab believes the remaining time to be.
    if (quizAttemptHasExpired(experience, attempt, Date.now()))
      throw new Error("QUIZ_ATTEMPT_TIME_ELAPSED");
    const questions = normalizedSnapshot.questions;
    const questionId = args.questionId.trim();
    const question = questions.find((candidate) => candidate.id === questionId);
    if (!question) throw new Error("QUIZ_QUESTION_UNAVAILABLE");
    const now = Date.now();
    const questionStartedAt = attempt.questionStartedAt?.[questionId] ?? now;
    const itemRemainingMs = quizQuestionTimeRemainingMs({
      question,
      startedAt: questionStartedAt,
      now,
      multiplier: normalizedSnapshot.settings.defaultTimeMultiplier,
      enforce: normalizedSnapshot.settings.enforceQuestionTimeLimits,
    });
    if (itemRemainingMs === 0) throw new Error("QUIZ_QUESTION_TIME_ELAPSED");
    const clientMutationId = args.clientMutationId.trim().slice(0, 180);
    if (clientMutationId.length < 8)
      throw new Error("QUIZ_RESPONSE_ID_INVALID");
    const duplicate = await ctx.db
      .query("quizPracticeResponses")
      .withIndex("by_account_mutation", (q) =>
        q
          .eq("accountId", actor.accountId)
          .eq("clientMutationId", clientMutationId),
      )
      .unique();
    if (duplicate) {
      return {
        responseId: duplicate._id,
        reused: true,
        timeRemainingMs: quizTimeRemainingMs(experience, attempt, Date.now()),
        questionTimeRemainingMs: itemRemainingMs,
        ...(immediateFeedback(experience)
          ? {
              result: projectReviewResult(
                questionResult(question, duplicate.response),
                normalizedSnapshot.settings,
              ),
            }
          : {}),
      };
    }
    const current = await ctx.db
      .query("quizPracticeResponses")
      .withIndex("by_attempt_question", (q) =>
        q.eq("attemptId", attempt._id).eq("questionId", questionId),
      )
      .unique();
    const response = cleanQuizResponse(args.response);
    const responseId = current
      ? (await ctx.db.patch(current._id, {
          response,
          clientMutationId,
          updatedAt: now,
        }),
        current._id)
      : await ctx.db.insert("quizPracticeResponses", {
          attemptId: attempt._id,
          accountId: actor.accountId,
          questionId,
          response,
          clientMutationId,
          updatedAt: now,
        });
    await ctx.db.patch(attempt._id, {
      questionStartedAt: {
        ...(attempt.questionStartedAt ?? {}),
        [questionId]: questionStartedAt,
      },
      updatedAt: now,
    });
    return {
      responseId,
      reused: false,
      // The clock travels back with every saved answer, so a tab that has been
      // asleep, throttled or offline re-anchors on the server rather than
      // drifting further from it (§11C).
      timeRemainingMs: quizTimeRemainingMs(experience, attempt, now),
      questionTimeRemainingMs: itemRemainingMs,
      ...(immediateFeedback(experience)
        ? {
            result: projectReviewResult(
              questionResult(question, response),
              normalizedSnapshot.settings,
            ),
          }
        : {}),
    };
  },
});

export const visitQuestion = mutation({
  args: {
    attemptId: v.id("quizPracticeAttempts"),
    questionId: v.string(),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("QUIZ_ATTEMPT_UNAVAILABLE");
    const { actor } = await requireArtifactCapability(
      ctx,
      attempt.artifactId,
      "use",
    );
    if (
      attempt.accountId !== actor.accountId ||
      attempt.status !== "in_progress"
    )
      throw new Error("QUIZ_ATTEMPT_NOT_EDITABLE");
    const snapshot = record(attempt.quizSnapshot);
    const normalizedSnapshot = normalizeQuizContent({
      questions: snapshot.questions,
      settings: snapshot.settings,
    });
    if (
      quizAttemptHasExpired(
        timedExperience(normalizedSnapshot.settings),
        attempt,
        Date.now(),
      )
    )
      throw new Error("QUIZ_ATTEMPT_TIME_ELAPSED");
    const questionId = args.questionId.trim();
    const question = normalizedSnapshot.questions.find(
      (candidate) => candidate.id === questionId,
    );
    if (!question) throw new Error("QUIZ_QUESTION_UNAVAILABLE");
    const now = Date.now();
    const startedAt = attempt.questionStartedAt?.[questionId] ?? now;
    const remainingMs = quizQuestionTimeRemainingMs({
      question,
      startedAt,
      now,
      multiplier: normalizedSnapshot.settings.defaultTimeMultiplier,
      enforce: normalizedSnapshot.settings.enforceQuestionTimeLimits,
    });
    if (remainingMs === 0) throw new Error("QUIZ_QUESTION_TIME_ELAPSED");
    if (!attempt.questionStartedAt?.[questionId])
      await ctx.db.patch(attempt._id, {
        questionStartedAt: {
          ...(attempt.questionStartedAt ?? {}),
          [questionId]: startedAt,
        },
        updatedAt: now,
      });
    return {
      questionId,
      startedAt,
      questionTimeRemainingMs: remainingMs,
    };
  },
});

export const submit = mutation({
  args: {
    attemptId: v.id("quizPracticeAttempts"),
    clientSubmissionId: v.string(),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("QUIZ_ATTEMPT_UNAVAILABLE");
    const { actor } = await requireArtifactCapability(
      ctx,
      attempt.artifactId,
      "use",
    );
    if (attempt.accountId !== actor.accountId)
      throw new Error("QUIZ_ATTEMPT_UNAVAILABLE");
    if (attempt.status === "submitted") return attemptProjection(ctx, attempt);
    const clientSubmissionId = args.clientSubmissionId.trim().slice(0, 180);
    if (clientSubmissionId.length < 8)
      throw new Error("QUIZ_SUBMISSION_ID_INVALID");
    const responses = await ctx.db
      .query("quizPracticeResponses")
      .withIndex("by_attempt", (q) => q.eq("attemptId", attempt._id))
      .collect();
    const responseByQuestion = new Map(
      responses.map((entry) => [entry.questionId, entry.response]),
    );
    const snapshot = record(attempt.quizSnapshot);
    const experience = timedExperience(
      normalizeQuizContent({ settings: snapshot.settings }).settings,
    );
    const questions = Array.isArray(snapshot.questions)
      ? (snapshot.questions as QuizQuestion[])
      : [];
    const results = questions.map((question) =>
      questionResult(question, responseByQuestion.get(question.id) ?? ""),
    );
    const score = results.reduce(
      (total, result) => total + result.awardedPoints,
      0,
    );
    const maxScore = results.reduce(
      (total, result) => total + result.maxPoints,
      0,
    );
    const now = Date.now();
    // A submission after the clock ran out is still recorded, and the elapsed
    // time is capped at the time that was allowed rather than the wall clock —
    // a late network round trip is not extra time the learner took.
    const expired = quizAttemptHasExpired(experience, attempt, now);
    const allowedMs =
      experience.timing === "countdown" && experience.countdownSeconds
        ? experience.countdownSeconds * 1000
        : undefined;
    await ctx.db.patch(attempt._id, {
      status: "submitted",
      score,
      maxScore,
      percentage: maxScore ? Math.round((score / maxScore) * 10_000) / 100 : 0,
      clientSubmissionId,
      submittedAt: now,
      elapsedMs: Math.max(
        0,
        Math.min(now - attempt.startedAt, allowedMs ?? Number.MAX_SAFE_INTEGER),
      ),
      ...(expired ? { timeElapsed: true } : {}),
      updatedAt: now,
    });
    const submitted = await ctx.db.get(attempt._id);
    if (!submitted) throw new Error("QUIZ_ATTEMPT_UNAVAILABLE");
    return attemptProjection(ctx, submitted);
  },
});

export const listMine = query({
  args: { artifactId: v.id("spectraArtifacts"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "use",
    );
    if (artifact.blueprintKey !== "quiz")
      throw new Error("QUIZ_PRACTICE_UNAVAILABLE");
    const attempts = await ctx.db
      .query("quizPracticeAttempts")
      .withIndex("by_account_artifact_started", (q) =>
        q.eq("accountId", actor.accountId).eq("artifactId", artifact._id),
      )
      .order("desc")
      .take(Math.max(1, Math.min(args.limit ?? 20, 100)));
    return Promise.all(
      attempts
        .filter((attempt) => {
          if (attempt.status === "submitted") return true;
          const snapshot = record(attempt.quizSnapshot);
          return record(snapshot.settings).allowResume !== false;
        })
        .map((attempt) => attemptProjection(ctx, attempt)),
    );
  },
});

/**
 * What the owner is allowed to know about everyone's attempts (§11C).
 *
 * This reports on the cohort, never on a person: no account is named and no
 * individual response is returned, so a quiz configured for anonymous responses
 * is served by exactly the same code path as an assigned one. The quiz's own
 * configuration decides whether there is anything to report at all — a quiz that
 * keeps nothing has nothing to aggregate, and one whose results belong to the
 * learner is not the owner's to read.
 */
export const aggregateForOwner = query({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { artifact } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "modify",
    );
    if (artifact.blueprintKey !== "quiz")
      throw new Error("QUIZ_PRACTICE_UNAVAILABLE");
    const experience = normalizeQuizExperience(
      record(record(artifact.content).settings),
    );
    if (!quizResponsesArePersisted(experience))
      return {
        available: false as const,
        reason:
          "This quiz does not keep responses, so there is nothing to report.",
      };
    if (!canViewQuizResults(experience, "teacher"))
      return {
        available: false as const,
        reason: "Results for this quiz belong to the learner.",
      };
    const attempts = await ctx.db
      .query("quizPracticeAttempts")
      .withIndex("by_artifact_started", (q) => q.eq("artifactId", artifact._id))
      .order("desc")
      .take(1_000);
    const submitted = attempts.filter(
      (attempt) => attempt.status === "submitted",
    );
    const questions = questionsFrom(artifact);
    const perQuestion = new Map(
      questions.map((question) => [
        question.id,
        {
          questionId: question.id,
          answered: 0,
          correct: 0,
          // How often each distinct answer was given. Options are the quiz's own
          // words, so this shows which distractor is doing the work.
          responses: new Map<string, number>(),
        },
      ]),
    );
    for (const attempt of submitted) {
      const responses = await ctx.db
        .query("quizPracticeResponses")
        .withIndex("by_attempt", (q) => q.eq("attemptId", attempt._id))
        .collect();
      const snapshot = record(attempt.quizSnapshot);
      const pinned = Array.isArray(snapshot.questions)
        ? (snapshot.questions as QuizQuestion[])
        : [];
      for (const entry of responses) {
        const bucket = perQuestion.get(entry.questionId);
        if (!bucket) continue;
        const question = pinned.find(
          (candidate) => candidate.id === entry.questionId,
        );
        if (!question) continue;
        bucket.answered += 1;
        if (questionResult(question, entry.response).correct === true)
          bucket.correct += 1;
        const key = quizCohortResponseLabel(question, entry.response);
        if (key)
          bucket.responses.set(key, (bucket.responses.get(key) ?? 0) + 1);
      }
    }
    const scores = submitted.flatMap((attempt) =>
      typeof attempt.percentage === "number" ? [attempt.percentage] : [],
    );
    const durations = submitted.flatMap((attempt) =>
      typeof attempt.elapsedMs === "number" ? [attempt.elapsedMs] : [],
    );
    const scoreBuckets = [
      { label: "0–59%", min: 0, max: 59 },
      { label: "60–69%", min: 60, max: 69 },
      { label: "70–79%", min: 70, max: 79 },
      { label: "80–89%", min: 80, max: 89 },
      { label: "90–100%", min: 90, max: 100 },
    ];
    return {
      available: true as const,
      // Cohort size, not a roster. Anonymity is a property of the data returned,
      // not of what the surface chooses to draw.
      attemptCount: attempts.length,
      submittedCount: submitted.length,
      inProgressCount: attempts.length - submitted.length,
      timeElapsedCount: submitted.filter((attempt) => attempt.timeElapsed)
        .length,
      averagePercentage: scores.length
        ? Math.round(
            (scores.reduce((total, value) => total + value, 0) /
              scores.length) *
              10,
          ) / 10
        : undefined,
      scoreDistribution: scoreBuckets.map((bucket) => ({
        ...bucket,
        count: scores.filter(
          (score) => score >= bucket.min && score <= bucket.max,
        ).length,
      })),
      duration:
        durations.length > 0
          ? {
              medianMs: median(durations) ?? 0,
              minMs: Math.min(...durations),
              maxMs: Math.max(...durations),
            }
          : undefined,
      questions: [...perQuestion.values()].map((bucket) => ({
        questionId: bucket.questionId,
        answered: bucket.answered,
        correct: bucket.correct,
        commonResponses: [...bucket.responses.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 5)
          .map(([response, count]) => ({ response, count })),
      })),
    };
  },
});
