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
    "Inspect deck settings, nested-deck and tag coverage, duplicate signals, card variants, source summaries, and the deck's FSRS-family parameters before loading only the sides that need work.",
    "Treat private scheduling and review history as user-owned state, never shared deck content.",
    "Retention, forecast, activity, and leech inspection may summarize the requesting learner's private state, but must never copy it into authored cards or expose another learner's history.",
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
    "nested deck path",
    "FSRS-family deck options",
  ],
  operations: [
    "Add, rewrite, split, merge, reorder, tag, validate, and connect cards to sources.",
    "Duplicate, delete, move, retag, or patch selected cards through typed bulk operations; preview destructive bulk changes.",
    "Create and rename nested Parent::Child deck paths and merge deck-local tags without changing stable card ids.",
    "Create valid {{cN::answer::optional hint}} cloze deletions without leaking the answer in the prompt.",
    "Propose image-occlusion regions only against an existing permitted image asset; never invent an asset id.",
    "Enable reverse study only when both directions are independently useful and unambiguous.",
    "Configure desired retention, daily limits, learning and relearning steps, maximum interval, and leech threshold, or apply a named gentle, balanced, or intensive preset.",
    "Inspect private retention, 30-day forecast, activity heatmap, and leech summaries only when the requesting learner has study authority.",
    "Preview and commit copy imports and prepare CSV, TSV, print, or versioned Spectra package exports; never describe these as live AnkiWeb or Quizlet sync.",
    "Build a coverage map before large generation and rebalance difficulty without padding the deck with near-duplicates.",
  ],
  preservationRules: [
    "Keep unaffected sides, stable card and mask ids, media, study history, source references, and manually authored explanations intact.",
    "Do not replace an entire deck for a selected-side edit.",
    "Never place private answers, scheduler state, or another learner's review history in shared content.",
    "Preserve unsupported APKG add-on/template/media information as import warnings; never execute add-ons or custom template code.",
  ],
  validation: [
    "Reject empty sides, duplicate or trivially inverted cards, accidental answer leakage, malformed cloze syntax, inaccessible media, masks outside image bounds, and reverse cards that are not meaningful in both directions.",
    "Reject invalid desired-retention ranges, empty learning-step arrays, negative daily limits, impossible nested-deck paths, and leech thresholds below two lapses.",
    "Every generated card must test one useful retrieval target and have enough context to stand alone.",
  ],
  approvals: [
    "Preview mass replacement, bulk deletion, private-history reset, source-wide regeneration, or destructive nested-deck changes; ordinary additions and targeted rewrites are reversible.",
  ],
  connections: [
    "Cards may be generated from permissioned documents and presentations, linked back to exact sources, embedded as formative practice, or composed with planner tasks and agents.",
  ],
  workingEffects: [
    "The targeted side forms or turns over, a cloze closes around the selected answer, or masks settle over the real image; every effect clears on all terminal outcomes.",
  ],
});
