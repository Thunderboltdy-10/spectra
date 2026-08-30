import type { SpectraBlueprintKey } from "../data/api";
import { normalizeFoundryContent } from "../agents/foundry/foundry-document";
import { normalizeCodeContent } from "../code/model";
import { normalizePresentationContent } from "../presentation/model";
import { normalizePlanContent } from "../plan/model";
import { normalizeSheetsContent } from "../sheets/model";
import { sharedTimetableContent } from "../timetable/model";
import { normalizeWhiteboardContent } from "../whiteboard/model";
import { normalizeFlashcardDeckContent as normalizeFlashcardDeckV4 } from "../flashcards/model";

type Row = Record<string, unknown>;

function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Row) }
    : {};
}

function stableId(value: unknown, prefix: string, index: number) {
  return typeof value === "string" && value.trim()
    ? value
    : `${prefix}-${index + 1}`;
}

/** Rewrite colliding ids so Yjs region maps never throw ARTIFACT_REGION_DUPLICATE. */
export function ensureUniqueRecordIds<T extends Record<string, unknown>>(
  rows: T[],
  idKey: string,
  prefix: string,
): T[] {
  const seen = new Set<string>();
  return rows.map((entry, index) => {
    const raw = entry[idKey];
    let id = stableId(raw, prefix, index);
    if (seen.has(id)) {
      const base = id;
      let n = 2;
      while (seen.has(`${base}~${n}`)) n += 1;
      id = `${base}~${n}`;
    }
    seen.add(id);
    return id === raw ? entry : { ...entry, [idKey]: id };
  });
}

function stringValue(...values: unknown[]) {
  return (
    values.find((value): value is string => typeof value === "string") ?? ""
  );
}

export function normalizeDocumentContent(value: unknown) {
  const content = row(value);
  if (!Array.isArray(content.blocks)) return content;
  const aliases: Record<string, string> = {
    text: "paragraph",
    section: "heading",
    title: "heading",
    subheading: "heading",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    bullet: "list",
    bullets: "list",
    bullet_list: "list",
    ordered_list: "list",
    formula: "math",
    tip: "callout",
    remember: "callout",
    info: "callout",
    note: "callout",
    study_note: "callout",
    collapsible: "callout",
    accordion: "callout",
    details: "callout",
    highlight: "paragraph",
  };
  content.blocks = ensureUniqueRecordIds(
    content.blocks.map((value, index) => {
      const block = row(value);
      if (Object.keys(block).length === 0)
        return {
          id: `block-${index + 1}`,
          type: "paragraph",
          text: String(value ?? ""),
        };
      const rawType = stringValue(block.type, "paragraph")
        .trim()
        .toLowerCase()
        .replace(/[\s.-]+/g, "_");
      block.id = stableId(block.id, "block", index);
      block.type = aliases[rawType] ?? rawType;
      if (typeof block.text !== "string") {
        if (Array.isArray(block.rows))
          block.text = block.rows
            .map((item) =>
              Array.isArray(item) ? item.join(" | ") : String(item),
            )
            .join("\n");
        else {
          const title = stringValue(block.title, block.label);
          const body = stringValue(block.content, block.body, block.description);
          block.text = title && body ? `${title}: ${body}` : title || body;
        }
      }
      if (block.type === "heading") {
        const attrs = row(block.attrs);
        if (typeof attrs.level !== "number") {
          const inferred =
            rawType === "h1"
              ? 1
              : rawType === "h3"
                ? 3
                : typeof block.level === "number"
                  ? block.level
                  : 2;
          attrs.level = Math.max(1, Math.min(3, inferred));
        }
        block.attrs = attrs;
      }
      return block;
    }),
    "id",
    "block",
  );
  return content;
}

export function normalizeFlashcardDeckContent(value: unknown) {
  return normalizeFlashcardDeckV4(value);
}

export function normalizeQuizContent(value: unknown) {
  const content = row(value);
  if (!Array.isArray(content.questions)) return content;
  const incomingSettings = row(content.settings);
  const feedbackRelease =
    incomingSettings.feedbackRelease === "on_each_response"
      ? "on_each_response"
      : "after_submission";
  content.settings = {
    instructions:
      typeof incomingSettings.instructions === "string"
        ? incomingSettings.instructions
        : "",
    feedbackRelease,
    showAnswersImmediately: feedbackRelease === "on_each_response",
    timed: incomingSettings.timed === true,
    shuffleQuestions: incomingSettings.shuffleQuestions === true,
    shuffleOptions: incomingSettings.shuffleOptions === true,
    allowResume: incomingSettings.allowResume !== false,
    defaultTimeMultiplier:
      typeof incomingSettings.defaultTimeMultiplier === "number"
        ? Math.max(1, Math.min(3, incomingSettings.defaultTimeMultiplier))
        : 1,
    targetScore:
      typeof incomingSettings.targetScore === "number"
        ? Math.max(0, Math.min(100, incomingSettings.targetScore))
        : 70,
    ...(typeof incomingSettings.maxAttempts === "number"
      ? {
          maxAttempts: Math.max(
            1,
            Math.min(100, Math.floor(incomingSettings.maxAttempts)),
          ),
        }
      : {}),
  };
  // Normalization runs on live collaborative state as well as freshly
  // generated drafts. Missing publication state is safely unpublished, but a
  // real owner publish must survive the normalization/Yjs projection cycle.
  content.published = content.published === true;
  const typeAliases: Record<string, string> = {
    mcq: "multiple_choice",
    multiplechoice: "multiple_choice",
    multiple_choice_question: "multiple_choice",
    short: "short_answer",
    free_response: "short_answer",
    truefalse: "true_false",
    boolean: "true_false",
    multi_select: "select_all",
    multiple_answers: "select_all",
    sequence: "ordering",
    number: "numeric",
    calculation: "numeric",
    fill: "fill_blank",
    cloze: "fill_blank",
    essay: "long_response",
    free_text: "long_response",
    match: "matching",
  };
  content.questions = content.questions.map((value, index) => {
    const question = row(value);
    question.id = stableId(question.id, "question", index);
    question.prompt = stringValue(
      question.prompt,
      question.question,
      question.text,
      question.title,
    ).trim();
    const rawType = stringValue(
      question.type,
      Array.isArray(question.options) ? "multiple_choice" : "short_answer",
    )
      .trim()
      .toLowerCase()
      .replace(/[\s.-]+/g, "_");
    question.type = typeAliases[rawType] ?? rawType;
    if (question.type === "true_false" && !Array.isArray(question.options))
      question.options = ["True", "False"];
    if (!Array.isArray(question.options) && Array.isArray(question.choices))
      question.options = question.choices;
    const options = (
      Array.isArray(question.options) ? question.options : []
    ).flatMap((option) => {
      if (typeof option === "string") {
        const text = option.trim();
        return text ? [text] : [];
      }
      if (!option || typeof option !== "object" || Array.isArray(option))
        return [];
      const rowOption = option as Record<string, unknown>;
      const text = stringValue(
        rowOption.text,
        rowOption.label,
        rowOption.value,
        rowOption.title,
        rowOption.option,
        rowOption.answer,
      ).trim();
      return text ? [text] : [];
    });
    question.options = options;
    if (question.type === "true_false" && options.length < 2)
      question.options = ["True", "False"];
    if (
      (question.type === "multiple_choice" ||
        question.type === "select_all" ||
        question.type === "ordering") &&
      options.length < 2
    ) {
      // Models sometimes emit MCQ shells with blank options. Prefer a
      // short-answer fallback over failing the entire create plan.
      question.type = "short_answer";
      question.options = [];
      question.optionIds = [];
    }
    const existingOptionIds = Array.isArray(question.optionIds)
      ? question.optionIds.map(String)
      : [];
    question.optionIds = (Array.isArray(question.options)
      ? question.options
      : []
    ).map(
      (_, optionIndex) =>
        existingOptionIds[optionIndex] ??
        `${String(question.id)}:option:${optionIndex + 1}`,
    );
    if (
      typeof question.correctAnswer !== "string" ||
      !question.correctAnswer.trim()
    ) {
      if (typeof question.answer === "number" && options[question.answer])
        question.correctAnswer = options[question.answer];
      else
        question.correctAnswer = stringValue(
          question.answer,
          question.correct,
          question.solution,
          question.sampleAnswer,
          question.expectedAnswer,
        ).trim();
    }
    if (
      options.length &&
      typeof question.correctAnswer === "string" &&
      !options.includes(question.correctAnswer)
    ) {
      const answerIndex = Number(question.correctAnswer);
      if (Number.isInteger(answerIndex) && options[answerIndex])
        question.correctAnswer = options[answerIndex];
    }
    if (question.type === "select_all") {
      const answers = Array.isArray(question.correctAnswers)
        ? question.correctAnswers.map(String)
        : Array.isArray(question.answers)
          ? question.answers.map(String)
          : question.correctAnswer
            ? [String(question.correctAnswer)]
            : [];
      question.correctAnswers = answers.filter((answer) =>
        options.includes(answer),
      );
    }
    if (question.type === "ordering")
      question.correctAnswers = Array.isArray(question.correctAnswers)
        ? question.correctAnswers.map(String)
        : options;
    if (question.type === "matching" && Array.isArray(question.matchingPairs))
      question.matchingPairs = question.matchingPairs.map(
        (value, pairIndex) => {
          const pair = row(value);
          return {
            id: stableId(pair.id, "pair", pairIndex),
            left: stringValue(pair.left, pair.prompt, pair.term).trim(),
            right: stringValue(pair.right, pair.answer, pair.match).trim(),
          };
        },
      );
    if (typeof question.correctAnswer !== "string") question.correctAnswer = "";
    if (
      typeof question.points !== "number" ||
      !Number.isFinite(question.points)
    )
      question.points = 1;
    if (
      typeof question.timeLimitSeconds !== "number" ||
      !Number.isFinite(question.timeLimitSeconds)
    )
      question.timeLimitSeconds = 90;
    return question;
  });
  content.questions = ensureUniqueRecordIds(
    content.questions as Row[],
    "id",
    "question",
  );
  return content;
}

export function normalizePlannerTaskContent(value: unknown) {
  return normalizePlanContent(value) as unknown as Row;
}

export function normalizeArtifactContent(
  blueprintKey: SpectraBlueprintKey,
  value: unknown,
): Row {
  if (blueprintKey === "document") return normalizeDocumentContent(value);
  if (blueprintKey === "flashcard_deck")
    return normalizeFlashcardDeckContent(value);
  if (blueprintKey === "quiz") return normalizeQuizContent(value);
  if (blueprintKey === "planner_task")
    return normalizePlannerTaskContent(value);
  if (blueprintKey === "timetable")
    return sharedTimetableContent(value) as unknown as Row;
  if (blueprintKey === "presentation")
    return normalizePresentationContent(value) as unknown as Row;
  if (blueprintKey === "sheets")
    return normalizeSheetsContent(value) as unknown as Row;
  if (blueprintKey === "code")
    return normalizeCodeContent(value) as unknown as Row;
  if (blueprintKey === "whiteboard")
    return normalizeWhiteboardContent(value) as unknown as Row;
  // Agents normalize through the Foundry document so mission, sections,
  // evidence and skills survive every server-side save alongside the legacy
  // projection the runtime reads.
  if (blueprintKey === "agent")
    return normalizeFoundryContent(value) as unknown as Row;
  return row(value);
}
