import { normalizeQuizExperience, type QuizExperience } from "./experience";

export const QUIZ_SCHEMA_VERSION = 4 as const;

export const QUIZ_QUESTION_TYPES = [
  "multiple_choice",
  "short_answer",
  "true_false",
  "select_all",
  "ordering",
  "numeric",
  "fill_blank",
  "long_response",
  "matching",
  "hotspot",
  "multipart",
] as const;

export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];
export type QuizPartType = Exclude<QuizQuestionType, "multipart">;
export type QuizResponseAtom = string | string[];
export type QuizResponse = QuizResponseAtom | Record<string, QuizResponseAtom>;

export type QuizMatchingPair = {
  id: string;
  left: string;
  right: string;
};

export type QuizHotspotRegion = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  correct: boolean;
};

export type QuizScoring = {
  partialCredit: "none" | "proportional";
  penaltyPoints: number;
};

export type QuizAnswerModel = {
  options: string[];
  optionIds: string[];
  correctAnswer?: string;
  correctAnswers?: string[];
  correctOptionIds?: string[];
  numericTolerance?: number;
  rubric?: string;
  matchingPairs?: QuizMatchingPair[];
  matchingChoices?: string[];
  hotspot?: {
    allowMultiple: boolean;
    regions: QuizHotspotRegion[];
  };
  scoring: QuizScoring;
  correctFeedback?: string;
  incorrectFeedback?: string;
  answerFeedback: Record<string, string>;
};

export type QuizPart = QuizAnswerModel & {
  id: string;
  prompt: string;
  type: QuizPartType;
  points?: number;
};

export type QuizQuestion = QuizAnswerModel & {
  id: string;
  prompt: string;
  type: QuizQuestionType;
  parts: QuizPart[];
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
  points: number;
  timeLimitSeconds?: number;
  sourceRefs?: string[];
  feedback?: string;
  bloomLevel?:
    "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  standards?: string[];
  tags?: string[];
  bankId?: string;
  poolId?: string;
  /** v3 compatibility only. v4 pools own their draw count. */
  poolDrawCount?: number;
  section?: string;
  media?: {
    assetId: string;
    name: string;
    mediaType: string;
    altText?: string;
  };
};

export type QuizBank = {
  id: string;
  name: string;
  description?: string;
};

export type QuizPool = {
  id: string;
  name: string;
  drawCount: number;
};

export type QuizReviewPolicy = {
  showScore: boolean;
  showCorrectness: boolean;
  showCorrectAnswers: boolean;
  showFeedback: boolean;
  showExplanations: boolean;
};

export type QuizAccessibilityPolicy = {
  keyboardSafeRequired: boolean;
  showTimerWarnings: boolean;
};

export type QuizSettings = {
  instructions: string;
  showAnswersImmediately: boolean;
  feedbackRelease: "after_submission" | "on_each_response";
  timed: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  targetScore: number;
  maxAttempts?: number;
  allowResume: boolean;
  defaultTimeMultiplier: number;
  enforceQuestionTimeLimits: boolean;
  reviewPolicy: QuizReviewPolicy;
  accessibilityPolicy: QuizAccessibilityPolicy;
  experience: QuizExperience;
};

export type QuizContent = {
  schemaVersion: typeof QUIZ_SCHEMA_VERSION;
  questions: QuizQuestion[];
  banks: QuizBank[];
  pools: QuizPool[];
  settings: QuizSettings;
  published: boolean;
  publishedAt?: number;
  [key: string]: unknown;
};

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function strings(value: unknown, limit = 100) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.slice(0, 100_000))
        .slice(0, limit)
    : [];
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, finiteNumber(value, fallback)));
}

function unit(value: unknown, fallback: number) {
  return bounded(value, fallback, 0, 1);
}

function stableId(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 180)
    : fallback;
}

function stringMap(value: unknown) {
  return Object.fromEntries(
    Object.entries(record(value))
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      )
      .map(([key, text]) => [key.slice(0, 180), text.slice(0, 100_000)]),
  );
}

function questionType(value: unknown): QuizQuestionType {
  return QUIZ_QUESTION_TYPES.includes(value as QuizQuestionType)
    ? (value as QuizQuestionType)
    : "short_answer";
}

function partType(value: unknown): QuizPartType {
  const type = questionType(value);
  return type === "multipart" ? "short_answer" : type;
}

function normalizeScoring(value: unknown): QuizScoring {
  const scoring = record(value);
  return {
    partialCredit:
      scoring.partialCredit === "proportional" ? "proportional" : "none",
    penaltyPoints: bounded(scoring.penaltyPoints, 0, 0, 100),
  };
}

function correctOptionIdsFromLegacy(
  source: Record<string, unknown>,
  options: string[],
  optionIds: string[],
) {
  const explicit = strings(source.correctOptionIds).filter((candidate) =>
    optionIds.includes(candidate),
  );
  if (explicit.length) return [...new Set(explicit)];
  const expected = new Set(
    [
      typeof source.correctAnswer === "string" ? source.correctAnswer : "",
      ...strings(source.correctAnswers),
    ].map((item) => item.trim().toLocaleLowerCase()),
  );
  return optionIds.filter((_, index) =>
    expected.has((options[index] ?? "").trim().toLocaleLowerCase()),
  );
}

function normalizeAnswerModel(
  source: Record<string, unknown>,
  ownerId: string,
): QuizAnswerModel {
  const options = strings(source.options);
  const existingOptionIds = strings(source.optionIds);
  const optionIds = options.map(
    (_, index) => existingOptionIds[index] ?? `${ownerId}:option:${index + 1}`,
  );
  const hotspot = record(source.hotspot);
  return {
    options,
    optionIds,
    correctAnswer:
      typeof source.correctAnswer === "string" ? source.correctAnswer : "",
    correctAnswers: strings(source.correctAnswers),
    correctOptionIds: correctOptionIdsFromLegacy(source, options, optionIds),
    numericTolerance: bounded(source.numericTolerance, 0, 0, 1_000_000_000),
    rubric: typeof source.rubric === "string" ? source.rubric : "",
    matchingPairs: records(source.matchingPairs).map((pair, index) => ({
      id: stableId(pair.id, `${ownerId}:pair:${index + 1}`),
      left: typeof pair.left === "string" ? pair.left : "",
      right: typeof pair.right === "string" ? pair.right : "",
    })),
    matchingChoices: strings(source.matchingChoices),
    hotspot: {
      allowMultiple: hotspot.allowMultiple === true,
      regions: records(hotspot.regions).map((region, index) => {
        const x = unit(region.x, 0);
        const y = unit(region.y, 0);
        return {
          id: stableId(region.id, `${ownerId}:region:${index + 1}`),
          label:
            typeof region.label === "string"
              ? region.label
              : `Region ${index + 1}`,
          x,
          y,
          width: Math.min(1 - x, unit(region.width, 0.2)),
          height: Math.min(1 - y, unit(region.height, 0.2)),
          correct: region.correct === true,
        };
      }),
    },
    scoring: normalizeScoring(source.scoring),
    correctFeedback:
      typeof source.correctFeedback === "string" ? source.correctFeedback : "",
    incorrectFeedback:
      typeof source.incorrectFeedback === "string"
        ? source.incorrectFeedback
        : "",
    answerFeedback: stringMap(source.answerFeedback),
  };
}

function normalizePart(
  value: unknown,
  questionId: string,
  index: number,
): QuizPart {
  const source = record(value);
  const id = stableId(source.id, `${questionId}:part:${index + 1}`);
  return {
    id,
    prompt: typeof source.prompt === "string" ? source.prompt : "",
    type: partType(source.type),
    points:
      typeof source.points === "number"
        ? bounded(source.points, 1, 0.01, 100)
        : undefined,
    ...normalizeAnswerModel(source, id),
  };
}

export function normalizeQuizQuestion(value: unknown, index = 0): QuizQuestion {
  const source = record(value);
  const id = stableId(source.id, `question-${index + 1}`);
  const options = strings(source.options);
  const type = QUIZ_QUESTION_TYPES.includes(source.type as QuizQuestionType)
    ? (source.type as QuizQuestionType)
    : options.length
      ? "multiple_choice"
      : "short_answer";
  const media = record(source.media);
  return {
    id,
    prompt: typeof source.prompt === "string" ? source.prompt : "",
    type,
    parts: records(source.parts).map((part, partIndex) =>
      normalizePart(part, id, partIndex),
    ),
    ...normalizeAnswerModel(source, id),
    explanation:
      typeof source.explanation === "string" ? source.explanation : "",
    difficulty:
      source.difficulty === "easy" || source.difficulty === "hard"
        ? source.difficulty
        : "medium",
    points: bounded(source.points, 1, 0.01, 100),
    timeLimitSeconds:
      typeof source.timeLimitSeconds === "number"
        ? bounded(source.timeLimitSeconds, 90, 5, 12 * 60 * 60)
        : undefined,
    sourceRefs: strings(source.sourceRefs),
    feedback: typeof source.feedback === "string" ? source.feedback : "",
    bloomLevel: [
      "remember",
      "understand",
      "apply",
      "analyze",
      "evaluate",
      "create",
    ].includes(String(source.bloomLevel))
      ? (source.bloomLevel as QuizQuestion["bloomLevel"])
      : "remember",
    standards: strings(source.standards),
    tags: strings(source.tags),
    bankId:
      typeof source.bankId === "string" && source.bankId.trim()
        ? source.bankId.trim().slice(0, 180)
        : undefined,
    poolId:
      typeof source.poolId === "string" && source.poolId.trim()
        ? source.poolId.trim().slice(0, 180)
        : undefined,
    poolDrawCount:
      typeof source.poolDrawCount === "number"
        ? Math.floor(bounded(source.poolDrawCount, 1, 1, 100))
        : undefined,
    section:
      typeof source.section === "string" && source.section.trim()
        ? source.section.trim().slice(0, 500)
        : undefined,
    media:
      typeof media.assetId === "string" && media.assetId.trim()
        ? {
            assetId: media.assetId.slice(0, 180),
            name:
              typeof media.name === "string" ? media.name.slice(0, 500) : "",
            mediaType:
              typeof media.mediaType === "string"
                ? media.mediaType.slice(0, 160)
                : "application/octet-stream",
            altText:
              typeof media.altText === "string"
                ? media.altText.slice(0, 2_000)
                : undefined,
          }
        : undefined,
  };
}

function normalizeReviewPolicy(value: unknown): QuizReviewPolicy {
  const policy = record(value);
  return {
    showScore: policy.showScore !== false,
    showCorrectness: policy.showCorrectness !== false,
    showCorrectAnswers: policy.showCorrectAnswers !== false,
    showFeedback: policy.showFeedback !== false,
    showExplanations: policy.showExplanations !== false,
  };
}

function normalizeAccessibilityPolicy(value: unknown): QuizAccessibilityPolicy {
  const policy = record(value);
  return {
    keyboardSafeRequired: policy.keyboardSafeRequired !== false,
    showTimerWarnings: policy.showTimerWarnings !== false,
  };
}

export function normalizeQuizSettings(value: unknown): QuizSettings {
  const settings = record(value);
  const experience = normalizeQuizExperience(settings);
  return {
    instructions:
      typeof settings.instructions === "string" ? settings.instructions : "",
    showAnswersImmediately: experience.revealAnswers === "immediate",
    feedbackRelease:
      experience.revealAnswers === "immediate"
        ? "on_each_response"
        : "after_submission",
    timed: experience.timing !== "untimed",
    shuffleQuestions: settings.shuffleQuestions === true,
    shuffleOptions: settings.shuffleOptions === true,
    targetScore: bounded(
      settings.targetScore ?? settings.passingScore,
      70,
      0,
      100,
    ),
    maxAttempts:
      experience.attempts === "unlimited" ? undefined : experience.attempts,
    allowResume: settings.allowResume !== false,
    defaultTimeMultiplier: bounded(settings.defaultTimeMultiplier, 1, 1, 3),
    enforceQuestionTimeLimits: settings.enforceQuestionTimeLimits === true,
    reviewPolicy: normalizeReviewPolicy(settings.reviewPolicy),
    accessibilityPolicy: normalizeAccessibilityPolicy(
      settings.accessibilityPolicy,
    ),
    experience,
  };
}

function defaultQuestion(): QuizQuestion {
  return normalizeQuizQuestion({
    id: "question-1",
    prompt: "",
    type: "multiple_choice",
    options: ["", "", "", ""],
    optionIds: [
      "question-1:option:1",
      "question-1:option:2",
      "question-1:option:3",
      "question-1:option:4",
    ],
    correctAnswer: "",
    difficulty: "medium",
    points: 1,
    timeLimitSeconds: 90,
  });
}

/**
 * The one v3 -> v4 migration and the read-time normalizer for collaborative
 * drafts. It is idempotent and preserves unknown extension fields.
 */
export function migrateQuizContent(value: unknown): QuizContent {
  const root = record(value);
  const normalizedQuestions = records(root.questions).map((question, index) =>
    normalizeQuizQuestion(question, index),
  );
  const questions = normalizedQuestions.length
    ? normalizedQuestions
    : [defaultQuestion()];
  const banks: QuizBank[] = records(root.banks).map((bank, index) => ({
    id: stableId(bank.id, `bank-${index + 1}`),
    name:
      typeof bank.name === "string" && bank.name.trim()
        ? bank.name.trim().slice(0, 500)
        : `Bank ${index + 1}`,
    description:
      typeof bank.description === "string"
        ? bank.description.slice(0, 2_000)
        : undefined,
  }));
  const bankIds = new Set(banks.map((bank) => bank.id));
  for (const bankId of new Set(
    questions.flatMap((question) => question.bankId ?? []),
  )) {
    if (!bankIds.has(bankId)) {
      banks.push({ id: bankId, name: bankId });
      bankIds.add(bankId);
    }
  }
  const pools: QuizPool[] = records(root.pools).map((pool, index) => ({
    id: stableId(pool.id, `pool-${index + 1}`),
    name:
      typeof pool.name === "string" && pool.name.trim()
        ? pool.name.trim().slice(0, 500)
        : `Pool ${index + 1}`,
    drawCount: Math.floor(bounded(pool.drawCount, 1, 1, 100)),
  }));
  const poolIds = new Set(pools.map((pool) => pool.id));
  for (const poolId of new Set(
    questions.flatMap((question) => question.poolId ?? []),
  )) {
    if (!poolIds.has(poolId)) {
      const legacyQuestion = questions.find(
        (question) => question.poolId === poolId,
      );
      pools.push({
        id: poolId,
        name: poolId,
        drawCount: legacyQuestion?.poolDrawCount ?? 1,
      });
      poolIds.add(poolId);
    }
  }
  return {
    ...root,
    schemaVersion: QUIZ_SCHEMA_VERSION,
    questions,
    banks,
    pools,
    settings: normalizeQuizSettings(root.settings),
    published: root.published === true,
    publishedAt:
      typeof root.publishedAt === "number" ? root.publishedAt : undefined,
  };
}

export const normalizeQuizContent = migrateQuizContent;

export function quizQuestions(content: unknown) {
  return migrateQuizContent(content).questions;
}

export function quizSettingsFromContent(content: unknown) {
  return migrateQuizContent(content).settings;
}

export function newQuizQuestion(id: string): QuizQuestion {
  return normalizeQuizQuestion({
    id,
    prompt: "",
    type: "multiple_choice",
    options: ["", "", "", ""],
    optionIds: [0, 1, 2, 3].map(
      (optionIndex) => `${id}:option:${optionIndex + 1}`,
    ),
    points: 1,
    timeLimitSeconds: 90,
  });
}

export function newQuizPart(questionId: string, index = 0): QuizPart {
  return normalizePart(
    {
      id: `${questionId}:part:${index + 1}`,
      prompt: "",
      type: "multiple_choice",
      options: ["", "", "", ""],
      optionIds: [0, 1, 2, 3].map(
        (optionIndex) =>
          `${questionId}:part:${index + 1}:option:${optionIndex + 1}`,
      ),
      points: 1,
    },
    questionId,
    index,
  );
}

function duplicateAnswerModel(
  source: QuizAnswerModel,
  ownerId: string,
  extraIds: ReadonlyMap<string, string> = new Map(),
) {
  const ids = new Map(extraIds);
  const optionIds = source.options.map((_, index) => {
    const next = `${ownerId}:option:${index + 1}`;
    const previous = source.optionIds[index];
    if (previous) ids.set(previous, next);
    return next;
  });
  const matchingPairs = (source.matchingPairs ?? []).map((pair, index) => {
    const next = `${ownerId}:pair:${index + 1}`;
    ids.set(pair.id, next);
    return { ...pair, id: next };
  });
  const regions = (source.hotspot?.regions ?? []).map((region, index) => {
    const next = `${ownerId}:region:${index + 1}`;
    ids.set(region.id, next);
    return { ...region, id: next };
  });
  return {
    ids,
    value: {
      options: [...source.options],
      optionIds,
      correctAnswer: source.correctAnswer,
      correctAnswers: [...(source.correctAnswers ?? [])],
      correctOptionIds: (source.correctOptionIds ?? []).flatMap((id) => {
        const next = ids.get(id);
        return next ? [next] : [];
      }),
      numericTolerance: source.numericTolerance,
      rubric: source.rubric,
      matchingPairs,
      matchingChoices: [...(source.matchingChoices ?? [])],
      hotspot: {
        allowMultiple: source.hotspot?.allowMultiple === true,
        regions,
      },
      scoring: { ...source.scoring },
      correctFeedback: source.correctFeedback,
      incorrectFeedback: source.incorrectFeedback,
      answerFeedback: Object.fromEntries(
        Object.entries(source.answerFeedback).flatMap(([key, feedback]) => {
          const next = ids.get(key);
          return next ? [[next, feedback]] : [];
        }),
      ),
    } satisfies QuizAnswerModel,
  };
}

export function duplicateQuizQuestion(
  source: QuizQuestion,
  nextId: string,
): QuizQuestion {
  const partIds = new Map(
    source.parts.map((part, index) => [part.id, `${nextId}:part:${index + 1}`]),
  );
  const duplicatedParts = source.parts.map((part, index): QuizPart => {
    const id = partIds.get(part.id) ?? `${nextId}:part:${index + 1}`;
    const answer = duplicateAnswerModel(part, id);
    return {
      ...part,
      ...answer.value,
      id,
      prompt: part.prompt,
      type: part.type,
      points: part.points,
    };
  });
  const answer = duplicateAnswerModel(source, nextId, partIds);
  return normalizeQuizQuestion({
    ...source,
    ...answer.value,
    id: nextId,
    parts: duplicatedParts,
    answerFeedback: Object.fromEntries(
      Object.entries(source.answerFeedback).flatMap(([key, feedback]) => {
        const next = answer.ids.get(key);
        return next ? [[next, feedback]] : [];
      }),
    ),
  });
}
