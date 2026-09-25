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
    "Choose one coherent visual direction appropriate to the subject and audience: a restrained palette, deliberate type scale, consistent alignment, and one memorable explanatory visual. Let the content drive variation rather than decorating every slide alike.",
    "A source's numeric comparison needs a real editable chart or table with checked values, units, categories, and series. For a new chart, author a chart object whose content has chartType, categories, and named numeric series with matching categories and values; put units in the series names and valueAxisTitle. Use a permissioned Sheets chart binding only when a readable source range already exists. Never substitute a labelled shape, diagram, or stock image for data. State the comparison's conclusion without implying causation the source does not establish.",
    "Plan narrative and outline, add or reorder slides, compose layouts, create/rewrite/move/resize objects, apply themes, and write speaker notes.",
    "Use the native layout vocabulary intentionally: title-content for a conventional explanation, title-visual-text for an evidence-led slide, visual-story for a dominant visual with supporting copy, three-ideas for three parallel points, statement for one memorable claim, two-column for comparison, and full-bleed only when the media can carry the slide.",
    "A layout is a starting constraint, not a finished design. After choosing it, adjust object geometry, type scale, crop, whitespace, alignment, and emphasis to fit the actual content; never leave generic placeholders or default cascaded coordinates.",
    "Keep all visible text at 20px or larger, including chart and table labels. If the content does not fit, simplify or rebalance the slide. On slides with three or more visible objects, set accessibility.readingOrder to every visible object ID exactly once in the intended spoken order.",
    "Generate charts from a stable Sheets range when one is already available, otherwise embed the checked source values in the native chart object. Check overflow, contrast, hierarchy, alignment, reading order, sources, and presenter output.",
    "Attach citations and exact sourceRefs/evidence handles from context to each supported claim or slide. Use the actual supporting passage/page; a general source footer alone does not establish support. Spectra rebuilds the References slides from slide citations after every write, so never hand-author a references slide or copy one into outlines.",
    "When the user gives an exact total slide count, count generated References slides in that total. Reserve enough slides for Spectra's generated References pages and use the remaining slides for the authored narrative; if the requested total cannot fit the required narrative and references, ask one concise clarification before creating the deck.",
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
