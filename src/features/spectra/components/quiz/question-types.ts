import { id, type QuizQuestion } from "../artifact-content-model";

/**
 * One name per question type, used by the type control, the question list and
 * the printed sheet, so a type is never called two things in one product.
 */
export const QUIZ_TYPE_LABELS: Record<QuizQuestion["type"], string> = {
  multiple_choice: "Multiple choice",
  true_false: "True or false",
  select_all: "Select all that apply",
  ordering: "Ordering",
  short_answer: "Short answer",
  numeric: "Numeric",
  fill_blank: "Fill in the blank",
  long_response: "Long response",
  matching: "Matching",
};

export const QUIZ_TYPE_OPTIONS = (Object.keys(QUIZ_TYPE_LABELS) as Array<QuizQuestion["type"]>).map((type) => ({
  value: type,
  label: QUIZ_TYPE_LABELS[type],
}));

/** Types answered by picking from (or ordering) a list of options. */
export const OPTION_TYPES: ReadonlySet<QuizQuestion["type"]> = new Set(["multiple_choice", "true_false", "select_all", "ordering"]);

/** The letter a learner sees beside an option: A, B, C… */
export function optionLetter(index: number) {
  return String.fromCharCode(65 + (index % 26));
}

/**
 * The patch that turns a question into another type, keeping what still means
 * something: options carry over between option types, true or false gets its
 * two fixed options, and matching starts with two empty pairs.
 */
export function retypeQuestion(question: QuizQuestion, type: QuizQuestion["type"]): Partial<QuizQuestion> {
  const freshOptions = OPTION_TYPES.has(type) && type !== "true_false" && question.options.length === 0;
  return {
    type,
    options: type === "true_false" ? ["True", "False"] : freshOptions ? ["", "", "", ""] : question.options,
    optionIds: type === "true_false" ? [id("option"), id("option")] : freshOptions ? [id("option"), id("option"), id("option"), id("option")] : question.optionIds,
    correctAnswers: type === "select_all" || type === "ordering" || type === "fill_blank" ? (question.correctAnswers ?? []) : [],
    matchingPairs:
      type === "matching" && (question.matchingPairs ?? []).length < 2
        ? [
            { id: id("pair"), left: "", right: "" },
            { id: id("pair"), left: "", right: "" },
          ]
        : question.matchingPairs,
  };
}

/**
 * Ways this question's answer key cannot be resolved as written. The key is
 * matched on the option's text, so two options that read the same are
 * genuinely undecidable and a blank one can never be the answer. They are said
 * while the author can still fix them, rather than only at publish.
 */
export function answerKeyProblems(question: QuizQuestion): string[] {
  if (!OPTION_TYPES.has(question.type)) return [];
  const problems: string[] = [];
  const filled = question.options.filter((option) => option.trim());
  const duplicate = filled.find((option, index) => filled.findIndex((candidate) => candidate.trim() === option.trim()) !== index);
  if (duplicate) problems.push(`Two options both say "${duplicate.trim()}". Make one of them different so the answer is clear.`);
  // A blank option is only a problem once the answer is keyed (for an
  // ordering, once there is an order to speak of): before then it is simply
  // one still being written.
  const keyed =
    question.type === "ordering"
      ? filled.length > 1
      : question.type === "select_all"
        ? (question.correctAnswers ?? []).length > 0
        : Boolean(question.correctAnswer?.trim());
  const blank = question.options.flatMap((option, index) => (option.trim() ? [] : [optionLetter(index)]));
  if (keyed && blank.length)
    problems.push(
      blank.length === 1
        ? `Option ${blank[0]} is empty. Write it or remove it.`
        : `Options ${blank.slice(0, -1).join(", ")} and ${blank.at(-1)} are empty. Write them or remove them.`,
    );
  if (question.type === "select_all") {
    if (!(question.correctAnswers ?? []).length) problems.push("Press the letter of each correct option.");
  } else if (question.type !== "ordering" && !question.correctAnswer?.trim()) problems.push("Press the letter of the correct option.");
  return problems;
}
