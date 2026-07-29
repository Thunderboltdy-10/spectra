import { defineArtifactSkill } from "../types";

export const flashcardDeckSkill = defineArtifactSkill({
  typeKey: "flashcard_deck",
  purpose:
    "Build concise, source-grounded active-recall cards for low-stakes practice and private spaced review.",
  createWhen: [
    "The learner needs repeated retrieval of concepts, terms, processes, formulae, diagrams, or worked cues.",
    "A document, presentation, class resource, or permitted workspace source should become reusable practice.",
  ],
  inspect: [
    "Inspect deck settings, section coverage, duplicate signals, card variants, and source summaries before loading only the sides that need work.",
    "Treat private scheduling and review history as user-owned state, never shared deck content.",
  ],
  regions: [
    "section",
    "card",
    "card front",
    "card back",
    "cloze deletion",
    "image-occlusion mask",
    "media and alternative text",
    "hint",
    "explanation",
    "accepted alternatives",
    "source reference",
    "tag",
    "learning objective",
  ],
  operations: [
    "Add, rewrite, split, merge, reorder, tag, validate, and connect cards to sources.",
    "Create valid {{cN::answer::optional hint}} cloze deletions without leaking the answer in the prompt.",
    "Propose image-occlusion regions only against an existing permitted image asset; never invent an asset id.",
    "Enable reverse study only when both directions are independently useful and unambiguous.",
    "Build a coverage map before large generation and rebalance difficulty without padding the deck with near-duplicates.",
  ],
  preservationRules: [
    "Keep unaffected sides, stable card and mask ids, media, study history, source references, and manually authored explanations intact.",
    "Do not replace an entire deck for a selected-side edit.",
    "Never place private answers, scheduler state, or another learner's review history in shared content.",
  ],
  validation: [
    "Reject empty sides, duplicate or trivially inverted cards, accidental answer leakage, malformed cloze syntax, inaccessible media, masks outside image bounds, and reverse cards that are not meaningful in both directions.",
    "Every generated card must test one useful retrieval target and have enough context to stand alone.",
  ],
  approvals: [
    "Preview mass replacement, deletion, source-wide regeneration, or destructive section changes; ordinary additions and targeted rewrites are reversible.",
  ],
  connections: [
    "Cards may be generated from permissioned documents and presentations, linked back to exact sources, embedded as formative practice, or composed with planner tasks and agents.",
  ],
  workingEffects: [
    "The targeted side forms or turns over, a cloze closes around the selected answer, or masks settle over the real image; every effect clears on all terminal outcomes.",
  ],
});
