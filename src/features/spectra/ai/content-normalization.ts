import type { SpectraBlueprintKey } from "../data/api";

type Row = Record<string, unknown>;

function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Row) }
    : {};
}

function stableId(value: unknown, prefix: string, index: number) {
  return typeof value === "string" && value.trim() ? value : `${prefix}-${index + 1}`;
}

function stringValue(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string") ?? "";
}

export function normalizeDocumentContent(value: unknown) {
  const content = row(value);
  if (!Array.isArray(content.blocks)) return content;
  const aliases: Record<string, string> = {
    text: "paragraph", section: "heading", title: "heading", subheading: "heading",
    h1: "heading", h2: "heading", h3: "heading", bullet: "list", bullets: "list",
    bullet_list: "list", ordered_list: "list", formula: "math", tip: "callout",
    remember: "callout", info: "callout", note: "callout", study_note: "callout",
    collapsible: "callout", accordion: "callout", details: "callout", highlight: "paragraph",
  };
  content.blocks = content.blocks.map((value, index) => {
    const block = row(value);
    if (Object.keys(block).length === 0)
      return { id: `block-${index + 1}`, type: "paragraph", text: String(value ?? "") };
    const rawType = stringValue(block.type, "paragraph").trim().toLowerCase().replace(/[\s.-]+/g, "_");
    block.id = stableId(block.id, "block", index);
    block.type = aliases[rawType] ?? rawType;
    if (typeof block.text !== "string") {
      if (Array.isArray(block.rows))
        block.text = block.rows.map((item) => Array.isArray(item) ? item.join(" | ") : String(item)).join("\n");
      else {
        const title = stringValue(block.title, block.label);
        const body = stringValue(block.content, block.body, block.description);
        block.text = title && body ? `${title}: ${body}` : title || body;
      }
    }
    if (block.type === "heading") {
      const attrs = row(block.attrs);
      if (typeof attrs.level !== "number") {
        const inferred = rawType === "h1" ? 1 : rawType === "h3" ? 3 : typeof block.level === "number" ? block.level : 2;
        attrs.level = Math.max(1, Math.min(3, inferred));
      }
      block.attrs = attrs;
    }
    return block;
  });
  return content;
}

export function normalizeFlashcardDeckContent(value: unknown) {
  const content = row(value);
  if (!Array.isArray(content.cards)) return content;
  content.cards = content.cards.map((value, index) => {
    const card = row(value);
    card.id = stableId(card.id, "card", index);
    card.front = stringValue(card.front, card.question, card.term, card.title).trim();
    card.back = stringValue(card.back, card.answer, card.definition, card.explanation).trim();
    if (typeof card.hint !== "string" && typeof card.cue === "string") card.hint = card.cue;
    if (typeof card.section !== "string" && typeof card.group === "string") card.section = card.group;
    return card;
  });
  return content;
}

export function normalizeQuizContent(value: unknown) {
  const content = row(value);
  if (!Array.isArray(content.questions)) return content;
  const typeAliases: Record<string, string> = {
    mcq: "multiple_choice", multiplechoice: "multiple_choice", multiple_choice_question: "multiple_choice",
    short: "short_answer", free_response: "short_answer", truefalse: "true_false", boolean: "true_false",
    multi_select: "select_all", multiple_answers: "select_all", sequence: "ordering",
  };
  content.questions = content.questions.map((value, index) => {
    const question = row(value);
    question.id = stableId(question.id, "question", index);
    question.prompt = stringValue(question.prompt, question.question, question.text, question.title).trim();
    const rawType = stringValue(question.type, Array.isArray(question.options) ? "multiple_choice" : "short_answer")
      .trim().toLowerCase().replace(/[\s.-]+/g, "_");
    question.type = typeAliases[rawType] ?? rawType;
    if (question.type === "true_false" && !Array.isArray(question.options)) question.options = ["True", "False"];
    if (!Array.isArray(question.options) && Array.isArray(question.choices)) question.options = question.choices;
    const options = Array.isArray(question.options) ? question.options.map(String) : [];
    if (
      typeof question.correctAnswer !== "string" ||
      !question.correctAnswer.trim()
    ) {
      if (typeof question.answer === "number" && options[question.answer]) question.correctAnswer = options[question.answer];
      else question.correctAnswer = stringValue(
        question.answer,
        question.correct,
        question.solution,
        question.sampleAnswer,
        question.expectedAnswer,
      ).trim();
    }
    if (options.length && typeof question.correctAnswer === "string" && !options.includes(question.correctAnswer)) {
      const answerIndex = Number(question.correctAnswer);
      if (Number.isInteger(answerIndex) && options[answerIndex]) question.correctAnswer = options[answerIndex];
    }
    return question;
  });
  return content;
}

export function normalizePlannerTaskContent(value: unknown) {
  const content = row(value);
  const statusAliases: Record<string, string> = {
    pending: "todo", not_started: "todo", open: "todo", in_progress: "doing", active: "doing",
    complete: "done", completed: "done", finished: "done",
  };
  const status = stringValue(content.status, "todo").trim().toLowerCase().replace(/[\s.-]+/g, "_");
  content.status = statusAliases[status] ?? status;
  if (Array.isArray(content.subtasks)) {
    content.subtasks = content.subtasks.map((value, index) => {
      const subtask = row(value);
      subtask.id = stableId(subtask.id, "subtask", index);
      subtask.title = stringValue(subtask.title, subtask.text, subtask.name);
      if (typeof subtask.done !== "boolean") subtask.done = /^(done|complete|completed)$/i.test(stringValue(subtask.status));
      return subtask;
    });
  }
  return content;
}

export function normalizeArtifactContent(blueprintKey: SpectraBlueprintKey, value: unknown) {
  if (blueprintKey === "document") return normalizeDocumentContent(value);
  if (blueprintKey === "flashcard_deck") return normalizeFlashcardDeckContent(value);
  if (blueprintKey === "quiz") return normalizeQuizContent(value);
  return normalizePlannerTaskContent(value);
}
