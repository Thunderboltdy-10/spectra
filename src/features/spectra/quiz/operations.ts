import {
  normalizeQuizContent,
  normalizeQuizQuestion,
  record,
  type QuizAnswerModel,
  type QuizContent,
  type QuizPart,
  type QuizPool,
  type QuizQuestion,
  type QuizResponse,
  type QuizResponseAtom,
} from "./model";

export type QuizQuestionResult = {
  questionId: string;
  correct: boolean | null;
  awardedPoints: number;
  maxPoints: number;
  scoreRatio: number | null;
  penaltyApplied: number;
  response: QuizResponse;
  expected: string | string[] | Record<string, string | string[]>;
  explanation?: string;
  advisoryFeedback?: string;
  answerFeedback?: string[];
  partResults?: QuizQuestionResult[];
};

export type QuizPresentationEntry = {
  questionId: string;
  optionOrder: string[];
  optionIdOrder: string[];
};

export type SafeQuizQuestion = {
  id: string;
  prompt: string;
  type: QuizQuestion["type"];
  options: string[];
  optionIds: string[];
  matchingPairs?: Array<{ id: string; left: string }>;
  matchingChoices?: string[];
  hotspot?: {
    allowMultiple: boolean;
    regions: Array<{
      id: string;
      label: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  };
  parts?: SafeQuizQuestion[];
  points: number;
  difficulty?: QuizQuestion["difficulty"];
  timeLimitSeconds?: number;
  media?: QuizQuestion["media"];
};

function normalized(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

function atomArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string" && value
      ? [value]
      : [];
}

function matchingPairFromResponse<T extends { id: string }>(
  pairs: readonly T[],
  value: string,
) {
  let match: T | undefined;
  for (const pair of pairs)
    if (
      value.startsWith(`${pair.id}:`) &&
      (!match || pair.id.length > match.id.length)
    )
      match = pair;
  return match;
}

export function cleanQuizResponse(value: unknown): QuizResponse {
  if (typeof value === "string") return value.slice(0, 12_000);
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.slice(0, 2_000))
      .slice(0, 100);
  return Object.fromEntries(
    Object.entries(record(value))
      .slice(0, 100)
      .map(([key, item]) => [key.slice(0, 180), cleanQuizResponseAtom(item)]),
  );
}

/**
 * Closed-choice labels are safe to aggregate. Free text and unknown submitted
 * values are deliberately refused so cohort reporting cannot echo private text.
 */
export function quizCohortResponseLabel(
  questionValue: unknown,
  response: unknown,
) {
  const question = normalizeQuizQuestion(questionValue);
  const values = Array.isArray(response)
    ? response.filter((value): value is string => typeof value === "string")
    : typeof response === "string"
      ? [response]
      : [];
  if (!values.length) return undefined;
  if (question.type === "hotspot") {
    const regionById = new Map(
      (question.hotspot?.regions ?? []).map((region) => [
        region.id,
        region.label,
      ]),
    );
    const labels = values.flatMap((value) => {
      const label = regionById.get(value);
      return label ? [label] : [];
    });
    return labels.length === values.length
      ? labels.join(", ").slice(0, 200)
      : undefined;
  }
  if (question.type === "matching") {
    const pairs = question.matchingPairs ?? [];
    const allowedChoices = new Set(
      question.matchingChoices?.length
        ? question.matchingChoices
        : pairs.map((pair) => pair.right),
    );
    const labels = values.flatMap((value) => {
      const pair = matchingPairFromResponse(pairs, value);
      if (!pair) return [];
      const right = value.slice(pair.id.length + 1);
      return allowedChoices.has(right) ? [`${pair.left} → ${right}`] : [];
    });
    return labels.length === values.length
      ? labels.join(", ").slice(0, 200)
      : undefined;
  }
  if (
    question.type !== "multiple_choice" &&
    question.type !== "true_false" &&
    question.type !== "select_all" &&
    question.type !== "ordering"
  )
    return undefined;
  const options =
    question.type === "true_false" && question.options.length === 0
      ? ["True", "False"]
      : question.options;
  const optionById = new Map(
    question.optionIds.map((id, index) => [id, options[index] ?? ""]),
  );
  const allowedOptions = new Set(options);
  const labels = values.flatMap((value) => {
    const label =
      optionById.get(value) ?? (allowedOptions.has(value) ? value : "");
    return label ? [label] : [];
  });
  return labels.length === values.length
    ? labels.join(", ").slice(0, 200)
    : undefined;
}

function cleanQuizResponseAtom(value: unknown): QuizResponseAtom {
  const response = cleanQuizResponse(value);
  return typeof response === "string" || Array.isArray(response)
    ? response
    : "";
}

function canonicalOptionIds(model: QuizAnswerModel, response: unknown) {
  return atomArray(response).flatMap((candidate) => {
    const directIndex = model.optionIds.indexOf(candidate);
    if (directIndex >= 0) return [model.optionIds[directIndex]!];
    const normalizedCandidate = normalized(candidate);
    const textIndex = model.options.findIndex(
      (option) => normalized(option) === normalizedCandidate,
    );
    return textIndex >= 0 ? [model.optionIds[textIndex]!] : [candidate];
  });
}

function expectedOptionIds(model: QuizAnswerModel) {
  if (model.correctOptionIds?.length) return model.correctOptionIds;
  const expectedText = new Set(
    [model.correctAnswer, ...(model.correctAnswers ?? [])]
      .filter((item): item is string => typeof item === "string")
      .map(normalized),
  );
  return model.optionIds.filter((_, index) =>
    expectedText.has(normalized(model.options[index])),
  );
}

function exactSet(actual: readonly string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    [...actual].sort().join("\u0000") === [...expected].sort().join("\u0000")
  );
}

function selectionRatio(
  actual: readonly string[],
  expected: readonly string[],
) {
  if (!expected.length) return 0;
  const expectedSet = new Set(expected);
  const selected = new Set(actual);
  const correct = [...selected].filter((item) => expectedSet.has(item)).length;
  const incorrect = [...selected].filter(
    (item) => !expectedSet.has(item),
  ).length;
  return Math.max(0, Math.min(1, (correct - incorrect) / expected.length));
}

function orderedRatio(actual: readonly string[], expected: readonly string[]) {
  if (!expected.length || actual.length !== expected.length) return 0;
  const matches = actual.filter(
    (value, index) => value === expected[index],
  ).length;
  return matches / expected.length;
}

function matchingRatio(model: QuizAnswerModel, response: unknown) {
  const pairs = model.matchingPairs ?? [];
  const responseByPair = new Map<string, string>();
  for (const item of atomArray(response)) {
    const pair = matchingPairFromResponse(pairs, item);
    if (!pair) continue;
    responseByPair.set(pair.id, normalized(item.slice(pair.id.length + 1)));
  }
  const actual = [...responseByPair].map(
    ([pairId, answer]) => `${pairId}:${answer}`,
  );
  const expected = pairs.map((pair) => `${pair.id}:${normalized(pair.right)}`);
  const selectedIds = [...responseByPair.keys()];
  if (!expected.length) return { ratio: 0, actual, expected, selectedIds };
  const expectedSet = new Set(expected);
  const correct = actual.filter((item) => expectedSet.has(item)).length;
  return {
    ratio: Math.max(0, Math.min(1, correct / expected.length)),
    actual,
    expected,
    selectedIds,
  };
}

function feedbackForSelections(model: QuizAnswerModel, selections: string[]) {
  return selections.flatMap((id) => {
    const feedback = model.answerFeedback[id];
    return feedback ? [feedback] : [];
  });
}

function roundScore(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function applyScore(ratio: number, model: QuizAnswerModel, points: number) {
  const effectiveRatio =
    model.scoring.partialCredit === "proportional"
      ? ratio
      : ratio === 1
        ? 1
        : 0;
  const penalty = effectiveRatio < 1 ? model.scoring.penaltyPoints : 0;
  return {
    awardedPoints: roundScore(Math.max(0, points * effectiveRatio - penalty)),
    penaltyApplied: Math.min(points * effectiveRatio, penalty),
  };
}

function partAsQuestion(part: QuizPart): QuizQuestion {
  return normalizeQuizQuestion({
    ...part,
    id: part.id,
    prompt: part.prompt,
    type: part.type,
    points: part.points ?? 1,
  });
}

export function gradeQuizQuestion(
  input: QuizQuestion,
  responseValue: unknown,
): QuizQuestionResult {
  const question = normalizeQuizQuestion(input);
  const response = cleanQuizResponse(responseValue);
  if (question.type === "long_response")
    return {
      questionId: question.id,
      correct: null,
      awardedPoints: 0,
      maxPoints: 0,
      scoreRatio: null,
      penaltyApplied: 0,
      response,
      expected: "Advisory review, no single auto-scored answer",
      explanation: question.explanation,
      advisoryFeedback:
        question.feedback ||
        question.rubric ||
        "Review your response against the guidance. Long responses are formative and are not auto-scored.",
    };

  if (question.type === "multipart") {
    const responseByPart = record(response);
    const partResults = question.parts.map((part) =>
      gradeQuizQuestion(partAsQuestion(part), responseByPart[part.id]),
    );
    const partMax = partResults.reduce(
      (sum, result) => sum + result.maxPoints,
      0,
    );
    const partEarned = partResults.reduce(
      (sum, result) => sum + result.awardedPoints,
      0,
    );
    const ratio = partMax ? partEarned / partMax : 0;
    const score = applyScore(ratio, question, question.points);
    return {
      questionId: question.id,
      correct: ratio === 1,
      ...score,
      maxPoints: question.points,
      scoreRatio: ratio,
      response,
      expected: Object.fromEntries(
        partResults.map((result) => [
          result.questionId,
          typeof result.expected === "string" || Array.isArray(result.expected)
            ? result.expected
            : "",
        ]),
      ),
      explanation: question.explanation,
      advisoryFeedback:
        ratio === 1
          ? question.correctFeedback || question.feedback
          : question.incorrectFeedback || question.feedback,
      answerFeedback: partResults.flatMap(
        (result) => result.answerFeedback ?? [],
      ),
      partResults,
    };
  }

  let ratio = 0;
  let expected: string | string[] = question.correctAnswer ?? "";
  let selections: string[] = [];
  if (
    question.type === "multiple_choice" ||
    question.type === "true_false" ||
    question.type === "select_all"
  ) {
    selections = canonicalOptionIds(question, response);
    const expectedIds = expectedOptionIds(question);
    expected = expectedIds;
    ratio =
      question.type === "select_all"
        ? selectionRatio(selections, expectedIds)
        : exactSet(selections.slice(0, 1), expectedIds.slice(0, 1))
          ? 1
          : 0;
  } else if (question.type === "ordering") {
    selections = canonicalOptionIds(question, response);
    const expectedIds = question.optionIds;
    expected = expectedIds;
    ratio = orderedRatio(selections, expectedIds);
  } else if (question.type === "matching") {
    const matching = matchingRatio(question, response);
    selections = matching.selectedIds;
    expected = (question.matchingPairs ?? []).map(
      (pair) => `${pair.left} → ${pair.right}`,
    );
    ratio = matching.ratio;
  } else if (question.type === "hotspot") {
    selections = atomArray(response);
    const expectedIds = (question.hotspot?.regions ?? [])
      .filter((region) => region.correct)
      .map((region) => region.id);
    expected = expectedIds;
    ratio = selectionRatio(selections, expectedIds);
  } else if (question.type === "numeric") {
    const actual = Number(response);
    const correct = Number(question.correctAnswer);
    ratio =
      Number.isFinite(actual) &&
      Number.isFinite(correct) &&
      Math.abs(actual - correct) <= (question.numericTolerance ?? 0)
        ? 1
        : 0;
  } else if (question.type === "fill_blank") {
    const answers = [question.correctAnswer, ...(question.correctAnswers ?? [])]
      .filter((item): item is string => typeof item === "string")
      .map(normalized);
    expected = answers;
    ratio = answers.includes(normalized(response)) ? 1 : 0;
  } else {
    ratio = normalized(response) === normalized(question.correctAnswer) ? 1 : 0;
  }
  const score = applyScore(ratio, question, question.points);
  const correct = ratio === 1;
  return {
    questionId: question.id,
    correct,
    ...score,
    maxPoints: question.points,
    scoreRatio: ratio,
    response,
    expected,
    explanation: question.explanation,
    advisoryFeedback:
      (correct
        ? question.correctFeedback || question.feedback
        : question.incorrectFeedback || question.feedback) ||
      (question.type === "short_answer" && !correct
        ? "Compare your response with the formative answer and explanation. Exact matching is advisory for practice."
        : undefined),
    answerFeedback: feedbackForSelections(question, selections),
  };
}

export function safeQuizQuestion(
  input: QuizQuestion,
  presentation?: QuizPresentationEntry,
): SafeQuizQuestion {
  const question = normalizeQuizQuestion(input);
  const orderedIds = presentation?.optionIdOrder?.length
    ? presentation.optionIdOrder
    : question.optionIds;
  const optionById = new Map(
    question.optionIds.map((id, index) => [id, question.options[index] ?? ""]),
  );
  const options = orderedIds.map((id) => optionById.get(id) ?? "");
  return {
    id: question.id,
    prompt: question.prompt,
    type: question.type,
    options,
    optionIds: orderedIds,
    ...(question.type === "matching"
      ? {
          matchingPairs: (question.matchingPairs ?? []).map((pair) => ({
            id: pair.id,
            left: pair.left,
          })),
          matchingChoices:
            presentation?.optionOrder ??
            (question.matchingPairs ?? []).map((pair) => pair.right),
        }
      : {}),
    ...(question.type === "hotspot"
      ? {
          hotspot: {
            allowMultiple: question.hotspot?.allowMultiple === true,
            regions: (question.hotspot?.regions ?? []).map(
              ({ correct: _correct, ...region }) => region,
            ),
          },
        }
      : {}),
    ...(question.type === "multipart"
      ? {
          parts: question.parts.map((part) =>
            safeQuizQuestion(partAsQuestion(part)),
          ),
        }
      : {}),
    points: question.points,
    difficulty: question.difficulty,
    timeLimitSeconds: question.timeLimitSeconds,
    media: question.media,
  };
}

function hashSeed(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function randomUnit(seed: { value: number }) {
  seed.value = (Math.imul(seed.value, 1664525) + 1013904223) >>> 0;
  return seed.value / 0x100000000;
}

export function seededShuffle<T>(items: readonly T[], seed: { value: number }) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(randomUnit(seed) * (index + 1));
    [next[index], next[swap]] = [next[swap]!, next[index]!];
  }
  return next;
}

function poolMap(content: QuizContent) {
  return new Map(content.pools.map((pool) => [pool.id, pool]));
}

export function selectQuizAttempt(
  value: unknown,
  seedValue: string,
): { questions: QuizQuestion[]; manifest: QuizPresentationEntry[] } {
  const content = normalizeQuizContent(value);
  const seed = { value: hashSeed(seedValue) };
  const pools = poolMap(content);
  const grouped = new Map<string, QuizQuestion[]>();
  for (const question of content.questions) {
    if (!question.poolId) continue;
    grouped.set(question.poolId, [
      ...(grouped.get(question.poolId) ?? []),
      question,
    ]);
  }
  const selectedPoolIds = new Set(
    [...grouped].flatMap(([poolId, questions]) => {
      const pool: QuizPool | undefined = pools.get(poolId);
      const drawCount = Math.min(
        questions.length,
        pool?.drawCount ?? questions[0]?.poolDrawCount ?? 1,
      );
      return seededShuffle(questions, seed)
        .slice(0, drawCount)
        .map((question) => question.id);
    }),
  );
  const selected = content.questions.filter(
    (question) => !question.poolId || selectedPoolIds.has(question.id),
  );
  const questions = content.settings.shuffleQuestions
    ? seededShuffle(selected, seed)
    : selected;
  const manifest = questions.map((question) => {
    if (question.type === "matching") {
      return {
        questionId: question.id,
        optionOrder: seededShuffle(
          (question.matchingPairs ?? []).map((pair) => pair.right),
          seed,
        ),
        optionIdOrder: [],
      };
    }
    const optionIdOrder =
      question.type === "ordering" || content.settings.shuffleOptions
        ? seededShuffle(question.optionIds, seed)
        : [...question.optionIds];
    const optionById = new Map(
      question.optionIds.map((id, index) => [
        id,
        question.options[index] ?? "",
      ]),
    );
    return {
      questionId: question.id,
      optionIdOrder,
      optionOrder: optionIdOrder.map((id) => optionById.get(id) ?? ""),
    };
  });
  return { questions, manifest };
}

export function quizQuestionTimeRemainingMs(input: {
  question: Pick<QuizQuestion, "timeLimitSeconds">;
  startedAt?: number;
  now: number;
  multiplier?: number;
  enforce: boolean;
}) {
  if (!input.enforce || !input.question.timeLimitSeconds || !input.startedAt)
    return null;
  const allowed =
    input.question.timeLimitSeconds *
    1_000 *
    Math.max(1, Math.min(3, input.multiplier ?? 1));
  return Math.max(0, allowed - Math.max(0, input.now - input.startedAt));
}

export function moveQuizQuestion(
  questions: readonly QuizQuestion[],
  questionId: string,
  toIndex: number,
) {
  const fromIndex = questions.findIndex(
    (question) => question.id === questionId,
  );
  if (fromIndex < 0 || toIndex < 0 || toIndex >= questions.length)
    return [...questions];
  const next = [...questions];
  const [question] = next.splice(fromIndex, 1);
  if (!question) return next;
  next.splice(toIndex, 0, question);
  return next;
}

export function removeQuizBank(content: QuizContent, bankId: string) {
  return {
    ...content,
    banks: content.banks.filter((bank) => bank.id !== bankId),
    questions: content.questions.map((question) =>
      question.bankId === bankId
        ? { ...question, bankId: undefined }
        : question,
    ),
  };
}

export function removeQuizPool(content: QuizContent, poolId: string) {
  return {
    ...content,
    pools: content.pools.filter((pool) => pool.id !== poolId),
    questions: content.questions.map((question) =>
      question.poolId === poolId
        ? { ...question, poolId: undefined, poolDrawCount: undefined }
        : question,
    ),
  };
}
