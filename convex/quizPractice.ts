import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireArtifactCapability } from "./spectraShared";

type QuizQuestion = {
  id: string;
  prompt: string;
  type:
    | "multiple_choice"
    | "short_answer"
    | "true_false"
    | "select_all"
    | "ordering"
    | "numeric"
    | "fill_blank"
    | "long_response"
    | "matching";
  options: string[];
  correctAnswer?: string;
  correctAnswers?: string[];
  numericTolerance?: number;
  rubric?: string;
  matchingPairs?: Array<{ id: string; left: string; right: string }>;
  explanation?: string;
  feedback?: string;
  points: number;
  difficulty?: string;
  timeLimitSeconds?: number;
  media?: unknown;
  poolId?: string;
  poolDrawCount?: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown, limit = 100) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.slice(0, 2_000))
        .slice(0, limit)
    : [];
}

function questionsFrom(artifact: Doc<"spectraArtifacts">) {
  const content = record(artifact.content);
  return (Array.isArray(content.questions) ? content.questions : []).flatMap(
    (candidate, index): QuizQuestion[] => {
      const question = record(candidate);
      if (typeof question.id !== "string") return [];
      const type = [
        "multiple_choice",
        "short_answer",
        "true_false",
        "select_all",
        "ordering",
        "numeric",
        "fill_blank",
        "long_response",
        "matching",
      ].includes(String(question.type))
        ? (question.type as QuizQuestion["type"])
        : "short_answer";
      return [
        {
          id: question.id.slice(0, 180),
          prompt:
            typeof question.prompt === "string"
              ? question.prompt.slice(0, 8_000)
              : `Question ${index + 1}`,
          type,
          options: strings(question.options, 100),
          ...(typeof question.correctAnswer === "string"
            ? { correctAnswer: question.correctAnswer.slice(0, 4_000) }
            : {}),
          ...(Array.isArray(question.correctAnswers)
            ? { correctAnswers: strings(question.correctAnswers, 100) }
            : {}),
          ...(typeof question.numericTolerance === "number" &&
          Number.isFinite(question.numericTolerance)
            ? { numericTolerance: Math.max(0, question.numericTolerance) }
            : {}),
          ...(typeof question.rubric === "string"
            ? { rubric: question.rubric.slice(0, 8_000) }
            : {}),
          ...(Array.isArray(question.matchingPairs)
            ? {
                matchingPairs: question.matchingPairs
                  .map((candidate, pairIndex) => {
                    const pair = record(candidate);
                    return {
                      id:
                        typeof pair.id === "string"
                          ? pair.id.slice(0, 180)
                          : `pair-${pairIndex + 1}`,
                      left:
                        typeof pair.left === "string"
                          ? pair.left.slice(0, 4_000)
                          : "",
                      right:
                        typeof pair.right === "string"
                          ? pair.right.slice(0, 4_000)
                          : "",
                    };
                  })
                  .filter((pair) => pair.left && pair.right)
                  .slice(0, 100),
              }
            : {}),
          ...(typeof question.explanation === "string"
            ? { explanation: question.explanation.slice(0, 8_000) }
            : {}),
          ...(typeof question.feedback === "string"
            ? { feedback: question.feedback.slice(0, 8_000) }
            : {}),
          points:
            typeof question.points === "number" &&
            Number.isFinite(question.points)
              ? Math.max(0, Math.min(100, question.points))
              : 1,
          ...(typeof question.difficulty === "string"
            ? { difficulty: question.difficulty.slice(0, 40) }
            : {}),
          ...(typeof question.timeLimitSeconds === "number"
            ? { timeLimitSeconds: Math.max(0, question.timeLimitSeconds) }
            : {}),
          ...(question.media !== undefined ? { media: question.media } : {}),
          ...(typeof question.poolId === "string" && question.poolId.trim()
            ? { poolId: question.poolId.trim().slice(0, 180) }
            : {}),
          ...(typeof question.poolDrawCount === "number" &&
          Number.isFinite(question.poolDrawCount)
            ? {
                poolDrawCount: Math.max(
                  1,
                  Math.min(100, Math.floor(question.poolDrawCount)),
                ),
              }
            : {}),
        },
      ];
    },
  );
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function randomUnit(seed: { value: number }) {
  seed.value = (Math.imul(seed.value, 1664525) + 1013904223) >>> 0;
  return seed.value / 0x100000000;
}

function shuffled<T>(items: readonly T[], seed: { value: number }) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(randomUnit(seed) * (index + 1));
    [next[index], next[swap]] = [next[swap]!, next[index]!];
  }
  return next;
}

function pooledQuestions(
  questions: readonly QuizQuestion[],
  seed: { value: number },
) {
  const pools = new Map<string, QuizQuestion[]>();
  for (const question of questions) {
    if (!question.poolId) continue;
    pools.set(question.poolId, [
      ...(pools.get(question.poolId) ?? []),
      question,
    ]);
  }
  const selectedIds = new Set(
    [...pools.values()].flatMap((pool) => {
      const count = Math.min(
        pool.length,
        Math.max(1, pool[0]?.poolDrawCount ?? 1),
      );
      return shuffled(pool, seed)
        .slice(0, count)
        .map((question) => question.id);
    }),
  );
  return questions.filter(
    (question) => !question.poolId || selectedIds.has(question.id),
  );
}

function safeQuestion(question: QuizQuestion, optionOrder: string[]) {
  return {
    id: question.id,
    prompt: question.prompt,
    type: question.type,
    options: optionOrder,
    ...(question.type === "matching"
      ? {
          matchingPairs: (question.matchingPairs ?? []).map((pair) => ({
            id: pair.id,
            left: pair.left,
          })),
          matchingChoices: optionOrder,
        }
      : {}),
    points: question.points,
    difficulty: question.difficulty,
    timeLimitSeconds: question.timeLimitSeconds,
    media: question.media,
  };
}

function cleanResponse(value: unknown) {
  if (typeof value === "string") return value.slice(0, 12_000);
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.slice(0, 2_000))
      .slice(0, 100);
  return "";
}

function normalized(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

function questionResult(question: QuizQuestion, response: unknown) {
  const actualArray = Array.isArray(response) ? response.map(normalized) : [];
  const expectedArray = (
    question.correctAnswers?.length
      ? question.correctAnswers
      : question.type === "ordering"
        ? question.options
        : []
  ).map(normalized);
  const matchingExpected = (question.matchingPairs ?? []).map(
    (pair) => `${pair.id}:${normalized(pair.right)}`,
  );
  const correct: boolean | null =
    question.type === "long_response"
      ? null
      : question.type === "numeric"
        ? (() => {
            const actual = Number(response);
            const expected = Number(question.correctAnswer);
            return (
              Number.isFinite(actual) &&
              Number.isFinite(expected) &&
              Math.abs(actual - expected) <= (question.numericTolerance ?? 0)
            );
          })()
        : question.type === "fill_blank"
          ? [question.correctAnswer, ...(question.correctAnswers ?? [])]
              .map(normalized)
              .filter(Boolean)
              .includes(normalized(response))
          : question.type === "matching"
            ? actualArray.length === matchingExpected.length &&
              [...actualArray].sort().join("\u0000") ===
                [...matchingExpected].sort().join("\u0000")
            : question.type === "select_all"
              ? [...actualArray].sort().join("\u0000") ===
                [...expectedArray].sort().join("\u0000")
              : question.type === "ordering"
                ? actualArray.length === expectedArray.length &&
                  actualArray.every(
                    (value, index) => value === expectedArray[index],
                  )
                : normalized(response) === normalized(question.correctAnswer);
  return {
    questionId: question.id,
    correct,
    awardedPoints: correct === true ? question.points : 0,
    maxPoints: correct === null ? 0 : question.points,
    response,
    expected:
      question.type === "matching"
        ? (question.matchingPairs?.map(
            (pair) => `${pair.left} → ${pair.right}`,
          ) ?? [])
        : question.type === "select_all" || question.type === "ordering"
          ? question.correctAnswers?.length
            ? question.correctAnswers
            : question.options
          : (question.correctAnswer ?? ""),
    explanation: question.explanation,
    advisoryFeedback:
      question.feedback ||
      (question.type === "long_response"
        ? question.rubric ||
          "Review your response against the explanation. Long responses are formative and are not auto-scored."
        : undefined) ||
      (question.type === "short_answer" && !correct
        ? "Compare your response with the formative answer and explanation. Exact matching is advisory for practice."
        : undefined),
  };
}

async function attemptProjection(
  ctx: Parameters<typeof requireArtifactCapability>[0],
  attempt: Doc<"quizPracticeAttempts">,
) {
  const snapshot = record(attempt.quizSnapshot);
  const questions = Array.isArray(snapshot.questions)
    ? (snapshot.questions as QuizQuestion[])
    : [];
  const _manifestByQuestion = new Map(
    attempt.presentationManifest.map((entry) => [entry.questionId, entry]),
  );
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
    return question ? [safeQuestion(question, entry.optionOrder)] : [];
  });
  const result =
    attempt.status === "submitted"
      ? questions.map((question) =>
          questionResult(question, responseByQuestion.get(question.id) ?? ""),
        )
      : undefined;
  return {
    attemptId: attempt._id,
    artifactId: attempt.artifactId,
    artifactVersionId: attempt.artifactVersionId,
    contentHash: attempt.contentHash,
    status: attempt.status,
    questions: ordered,
    responses: Object.fromEntries(responseByQuestion),
    score: attempt.score,
    maxScore: attempt.maxScore,
    percentage: attempt.percentage,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    elapsedMs: attempt.elapsedMs,
    settings: record(snapshot.settings),
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
    const questions = questionsFrom(artifact);
    if (!questions.length) throw new Error("QUIZ_HAS_NO_QUESTIONS");
    const settings = record(record(artifact.content).settings);
    const maxAttempts =
      typeof settings.maxAttempts === "number"
        ? Math.max(1, Math.min(100, Math.floor(settings.maxAttempts)))
        : undefined;
    if (maxAttempts) {
      const existingAttempts = await ctx.db
        .query("quizPracticeAttempts")
        .withIndex("by_account_artifact_started", (q) =>
          q.eq("accountId", actor.accountId).eq("artifactId", artifact._id),
        )
        .collect();
      if (existingAttempts.length >= maxAttempts)
        throw new Error("QUIZ_PRACTICE_ATTEMPT_LIMIT_REACHED");
    }
    const seed = { value: Number.parseInt(hash(clientAttemptId), 16) >>> 0 };
    const selectedQuestions = pooledQuestions(questions, seed);
    const snapshot = {
      title: artifact.title,
      settings,
      questions: selectedQuestions,
    };
    const encoded = JSON.stringify(snapshot);
    const orderedQuestions =
      settings.shuffleQuestions === true
        ? shuffled(selectedQuestions, seed)
        : selectedQuestions;
    const presentationManifest = orderedQuestions.map((question) => ({
      questionId: question.id,
      optionOrder:
        question.type === "matching"
          ? shuffled(
              (question.matchingPairs ?? []).map((pair) => pair.right),
              seed,
            )
          : question.type === "ordering" || settings.shuffleOptions === true
            ? shuffled(question.options, seed)
            : question.options,
    }));
    const now = Date.now();
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
    const questions = Array.isArray(snapshot.questions)
      ? (snapshot.questions as QuizQuestion[])
      : [];
    const questionId = args.questionId.trim();
    if (!questions.some((question) => question.id === questionId))
      throw new Error("QUIZ_QUESTION_UNAVAILABLE");
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
      const snapshot = record(attempt.quizSnapshot);
      const settings = record(snapshot.settings);
      const questions = Array.isArray(snapshot.questions)
        ? (snapshot.questions as QuizQuestion[])
        : [];
      const question = questions.find(
        (candidate) => candidate.id === args.questionId.trim(),
      );
      return {
        responseId: duplicate._id,
        reused: true,
        ...(question &&
        (settings.feedbackRelease === "on_each_response" ||
          settings.showAnswersImmediately === true)
          ? { result: questionResult(question, duplicate.response) }
          : {}),
      };
    }
    const current = await ctx.db
      .query("quizPracticeResponses")
      .withIndex("by_attempt_question", (q) =>
        q.eq("attemptId", attempt._id).eq("questionId", questionId),
      )
      .unique();
    const now = Date.now();
    const response = cleanResponse(args.response);
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
    await ctx.db.patch(attempt._id, { updatedAt: now });
    const settings = record(snapshot.settings);
    const question = questions.find((candidate) => candidate.id === questionId);
    return {
      responseId,
      reused: false,
      ...(question &&
      (settings.feedbackRelease === "on_each_response" ||
        settings.showAnswersImmediately === true)
        ? { result: questionResult(question, response) }
        : {}),
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
    await ctx.db.patch(attempt._id, {
      status: "submitted",
      score,
      maxScore,
      percentage: maxScore ? Math.round((score / maxScore) * 10_000) / 100 : 0,
      clientSubmissionId,
      submittedAt: now,
      elapsedMs: Math.max(0, now - attempt.startedAt),
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
