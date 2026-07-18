import { defineArtifactSkill } from "../types";

export const presentationSkill = defineArtifactSkill({
  typeKey: "presentation",
  purpose:
    "Create Spectra-native visual narratives whose slides are useful to present, understandable at a glance, and polished enough to share.",
  createWhen: [
    "Ideas need a paced visual sequence for an audience rather than a prose document.",
    "Start from objective, audience, and narrative arc; do not turn paragraphs into arbitrary slides.",
  ],
  inspect: [
    "Inspect the outline, theme, sections, and targeted slides before loading object-level detail.",
    "Resolve permissioned Sheets ranges, media, citations, and embeds only when the selected slide needs them.",
  ],
  regions: [
    "theme",
    "section",
    "slide",
    "slide object",
    "speaker notes",
    "citation",
    "accessibility reading order",
    "animation",
    "chart binding",
    "presenter setting",
  ],
  operations: [
    "Plan narrative and outline, add or reorder slides, compose layouts, create/rewrite/move/resize objects, apply themes, and write speaker notes.",
    "Generate charts from stable Sheets ranges and check overflow, contrast, hierarchy, alignment, reading order, sources, and presenter output.",
  ],
  preservationRules: [
    "Preserve unaffected slide/object identity, constraints, reading order, animations, notes, citations, source bindings, and live-versus-pinned source policy.",
    "Never fabricate citations, reveal inaccessible source data, or flatten editable native objects unless a declared export format requires it.",
  ],
  validation: [
    "Check canvas bounds, text overflow, missing media/fonts, contrast, type scale, alignment, alt text, reading order, citations, and unavailable live sources.",
    "Ensure every slide advances the narrative and remains legible in presenter, embed, exported, narrow review, and reduced-motion states.",
  ],
  approvals: [
    "Use a proposal branch for broad regeneration; preview deck-wide restyling, destructive slide deletion, source rebinding, and lossy import substitutions.",
  ],
  connections: [
    "Charts can bind live or pinned Sheets ranges; slides can embed permissioned artifacts and cite documents, quizzes, decks, code visualisations, and threads.",
  ],
  workingEffects: [
    "Text forms or morphs in its real frame; shapes, charts, and media materialize; moved objects settle into layout deliberately.",
    "Independent objects or slides may animate concurrently, and every effect clears after success, failure, rejection, cancellation, revocation, or navigation.",
  ],
});
