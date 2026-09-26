import { defineArtifactSkill } from "../types";
import { artifactDesignGuidance } from "./artifact-design";

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
    ...artifactDesignGuidance,
    "A source's numeric comparison needs a real editable chart or table with checked values, units, categories, and series. For a new chart, author a chart object whose content has chartType, categories, and named numeric series with matching categories and values; put units in the series names and valueAxisTitle. Use a permissioned Sheets chart binding only when a readable source range already exists. Never substitute a labelled shape, diagram, or stock image for data. State the comparison's conclusion without implying causation the source does not establish.",
    "Plan narrative and outline, add or reorder slides, compose layouts, create/rewrite/move/resize objects, apply themes, and write speaker notes.",
    "Use the native layout vocabulary intentionally: title-content for a conventional explanation, title-visual-text for an evidence-led slide, visual-story for a dominant visual with supporting copy, three-ideas for three parallel points, statement for one memorable claim, two-column for comparison, and full-bleed only when the media can carry the slide.",
    "A layout is a starting constraint, not a finished design. After choosing it, adjust object geometry, type scale, crop, whitespace, alignment, and emphasis to fit the actual content; never leave generic placeholders or default cascaded coordinates.",
    "Size text for the actual viewing context: projected body copy usually needs at least 20px, while close-reading handouts and secondary labels may be smaller if legible. Preserve explicitly requested sizes. If content does not fit, revise the layout or deliberately edit the copy; do not silently remove it. On slides with three or more visible objects, set accessibility.readingOrder to every visible object ID exactly once in spoken order.",
    "Generate charts from a stable Sheets range when one is already available, otherwise embed the checked source values in the native chart object. Check overflow, contrast, hierarchy, alignment, reading order, sources, and presenter output.",
    "For claims based on supplied evidence, attach exact server-issued evidence handles in the slide's sourceRefs. Spectra supplies readable citation metadata and exports attribution with speaker notes. Use the supporting passage/page; a general source footer alone does not establish support. Creative work, original examples, and ordinary explanations do not need invented citations.",
    "Honor the requested slide count using the actual slide sequence. Add a separate references slide only when the user requests it or the brief's citation convention calls for one; include it in any requested total. Citations can remain on narrative slides without an extra page. No bibliography is added automatically.",
  ],
  preservationRules: [
    "Preserve unaffected slide/object identity, constraints, reading order, animations, notes, citations, source bindings, and live-versus-pinned source policy. Preserve existing bibliography slides on unrelated edits; when changing their cited sources, update the bibliography as part of that edit rather than leaving stale attribution.",
    "Never fabricate citations, reveal inaccessible source data, or flatten editable native objects unless a declared export format requires it. Every citation label must name a real source from context.",
  ],
  validation: [
    "Check canvas bounds, text overflow, missing media/fonts, contrast, type scale, alignment, alt text, reading order, citations, and unavailable live sources.",
    "Reject slides that look like documents pasted onto a canvas: keep one clear idea per slide, prefer short display copy, maintain deliberate whitespace, align every edge, and use visuals or diagrams when they improve understanding.",
    "Inspect the rendered slide at its intended viewing scale when available. Fix collisions, illegible text, accidental empty regions, weak hierarchy and decorative shapes without meaning. Consistent comparison slides and purposeful text-only sequences are valid; do not vary layouts just to meet a quota.",
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
