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
    "Use the native layout vocabulary intentionally: title-content for a conventional explanation, title-visual-text for an evidence-led slide, visual-story for a dominant visual with supporting copy, three-ideas for three parallel points, statement for one memorable claim, two-column for comparison, and full-bleed only when the media can carry the slide.",
    "A layout is a starting constraint, not a finished design. After choosing it, adjust object geometry, type scale, crop, whitespace, alignment, and emphasis to fit the actual content; never leave generic placeholders or default cascaded coordinates.",
    "Generate charts from stable Sheets ranges and check overflow, contrast, hierarchy, alignment, reading order, sources, and presenter output.",
    "Attach citations (label plus source URL from context) to each slide that draws on a source. Spectra rebuilds the References slides from slide citations after every write, so never hand-author a references slide and never copy one into outlines.",
  ],
  preservationRules: [
    "Preserve unaffected slide/object identity, constraints, reading order, animations, notes, citations, source bindings, and live-versus-pinned source policy. Preserve generated References slides untouched; Spectra owns their content.",
    "Never fabricate citations, reveal inaccessible source data, or flatten editable native objects unless a declared export format requires it. Every citation label must name a real source from context.",
  ],
  validation: [
    "Check canvas bounds, text overflow, missing media/fonts, contrast, type scale, alignment, alt text, reading order, citations, and unavailable live sources.",
    "Reject slides that look like documents pasted onto a canvas: keep one clear idea per slide, prefer short display copy, maintain deliberate whitespace, align every edge, and use visuals or diagrams when they improve understanding.",
    "Inspect the rendered slide at presentation scale after every structural change. Fix collisions, tiny text, accidental empty regions, weak hierarchy, repeated layouts, and low-information decorative shapes before declaring success.",
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
