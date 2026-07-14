import { defineArtifactSkill } from "../types";
export const quizSkill = defineArtifactSkill({
  typeKey: "quiz", purpose: "Create practice and formative question experiences, never graded or high-stakes assessment.",
  createWhen: ["The user wants to check understanding through questions, feedback, and review."], inspect: ["Inspect question outline and settings, then load only targeted questions and sources."],
  regions: ["question prompt", "answer option", "correct-answer state", "explanation", "feedback", "quiz settings"], operations: ["Add, rewrite, reorder, change type, add one clear correct answer, explain, and validate questions."],
  preservationRules: ["Preserve response history separately from content and do not expose answers unintentionally."], validation: ["Ensure one unambiguous correctness control, valid options, useful feedback, and formative-only language."],
  approvals: ["Preview broad replacement or removal of attempted questions."], connections: ["Quizzes can be sourced from permissioned documents, decks, Sheets, or class resources."], workingEffects: ["Options appear or transform in place and correctness transitions deliberately at the exact field."],
});
