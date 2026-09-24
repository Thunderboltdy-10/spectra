import { defineArtifactSkill } from "../types";
export const quizSkill = defineArtifactSkill({
  typeKey: "quiz",
  purpose:
    "Create practice and formative question experiences, never graded or high-stakes assessment.",
  createWhen: [
    "The user wants to check understanding through questions, feedback, and review.",
    "A permissioned document, deck, sheet, class resource, or conversation should become reusable formative practice.",
  ],
  inspect: [
    "Inspect question outline and settings, then load only targeted questions and sources.",
    "Inspect published state, pool membership, answer model, media availability, and active attempt constraints before changing a practiced quiz.",
  ],
  regions: [
    "question prompt",
    "answer option",
    "matching pair",
    "numeric tolerance",
    "accepted fill answer",
    "long-response rubric",
    "correct-answer state",
    "explanation",
    "feedback",
    "question media and alternative text",
    "difficulty, timing, taxonomy, standards, tags, sources, section, and pool placement",
    "quiz settings",
    "practice publish state",
  ],
  operations: [
    "Create one artifact with content.questions[]. Multiple-choice correctAnswer must exactly match a real option. Use plausible distractors tied to misconceptions and explanations that teach why the correct answer works; preserve the requested count and difficulty.",
    "Plan source coverage; add, rewrite, reorder, or change question types; configure one clear answer model; build matching, ordering, numeric, fill, and pooled interactions; add advisory long-response rubrics; explain answers; and validate correctness, ambiguity, bias, accessibility, and source coverage.",
    "Import and map supported QTI 2.x, Moodle XML, CSV, TSV, or Spectra JSON with explicit fidelity notes; export supported QTI 2.2, CSV, JSON, or print/PDF without claiming fidelity for adapted interactions.",
    "Publish only a valid formative version. Any later authored or AI content change returns the working copy to draft while version-pinned attempts remain immutable.",
  ],
  preservationRules: [
    "Preserve response history separately from content and do not expose answers unintentionally.",
    "Never reveal answer keys, rubrics, private responses, or advisory feedback before the configured release moment.",
    "Preserve stable question, option, pair, and pool identities; do not replace unrelated questions when editing a selected region.",
    "Keep quizzes formative: do not introduce proctoring, punitive grading, locked browsers, or consequential gradebook behavior.",
  ],
  validation: [
    "Ensure one unambiguous correctness control, valid options, useful feedback, and formative-only language.",
    "Reject blank prompts, duplicate options, missing expected answers, incomplete matching pairs, inconsistent pool draw counts, negative points, and long responses without review guidance before publish.",
    "Check that media has useful alternative text and that imported source/provenance remains distinguishable.",
  ],
  approvals: [
    "Preview broad replacement, removal of attempted questions, publish-state changes, or consequential import mappings.",
  ],
  connections: [
    "Quizzes can be sourced from permissioned documents, decks, Sheets, or class resources.",
    "Quiz results remain private learning records; aggregate operational analytics never include prompts or response content.",
  ],
  workingEffects: [
    "Options appear or transform in place and correctness transitions deliberately at the exact field.",
    "Generated prompts, rubrics, explanations, media, pool settings, and release settings animate only in their claimed regions and return fully to normal on every terminal state.",
  ],
});
