import { defineArtifactSkill } from "../types";
export const flashcardDeckSkill = defineArtifactSkill({
  typeKey: "flashcard_deck", purpose: "Build concise active-recall cards for low-stakes practice and spaced review.",
  createWhen: ["The learner needs repeated recall of concepts, terms, processes, or worked cues."], inspect: ["Inspect deck settings and card summaries before loading specific fronts or backs."],
  regions: ["card", "card front", "card back", "hint", "source reference", "study metadata"], operations: ["Add, rewrite, split, merge, reorder, tag, validate, and connect cards to sources."],
  preservationRules: ["Keep unaffected sides, study history, source references, and card identity stable."], validation: ["Reject empty sides, duplicates, accidental answer leakage, and inaccessible media."],
  approvals: ["Preview mass replacement or deletion; ordinary additions and targeted rewrites are reversible."], connections: ["Cards may be generated from documents and embedded as formative practice."], workingEffects: ["The targeted side turns over or resolves into its new content without leaving a persistent tint."],
});
