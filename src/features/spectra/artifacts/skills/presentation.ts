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
    "Plan the objective, audience and narrative arc first, then write the whole deck in one create_artifact call: the theme, every slide and each slide's speaker notes. Use edit_artifact afterwards only for changes the user asks for, or to fix problems the readback lists, all fixes in one call.",
    "Spectra's layout engine places and sizes every object from the layout you choose; you choose the layout and write the words. Keep display copy short enough to fit: one idea per slide and a few short lines of body. If a slide is too full, split it rather than cramming it.",
    "Use the layouts intentionally: title-content for a conventional explanation, title-visual-text for an evidence-led slide, visual-story for a dominant visual with supporting copy, three-ideas for three parallel points, statement for one memorable claim, two-column for comparison, and full-bleed only when the visual can carry the slide. A layout that wants a visual needs one.",
    "A source's numeric comparison needs a real chart or table with checked values: a chart visual with chartType, categories and named numeric series (units in the series names), or a table. Never substitute a labelled shape for data. State the comparison's conclusion without implying causation the source does not establish.",
    "When claims rest on sources the user gave, name the source on the slide or in its notes. Never invent citations; creative work, original examples and ordinary explanations need none.",
    "Honor the requested slide count using the actual slide sequence. Add a separate references slide only when the user requests it or the brief's citation convention calls for one; include it in any requested total.",
  ],
  preservationRules: [
    "Preserve unaffected slide/object identity, constraints, reading order, animations, notes, citations, source bindings, and live-versus-pinned source policy. Preserve existing bibliography slides on unrelated edits; when changing their cited sources, update the bibliography as part of that edit rather than leaving stale attribution.",
    "Never fabricate citations, reveal inaccessible source data, or flatten editable native objects unless a declared export format requires it. Every citation label must name a real source from context.",
  ],
  validation: [
    "Read the readback: every slide has a specific title and complete content, nothing overflows, every layout has what it needs, and the requested slide count holds.",
    "Reject slides that look like documents pasted onto a canvas: keep one clear idea per slide, prefer short display copy, and use a chart, table or diagram when it improves understanding. Consistent comparison slides and purposeful text-only sequences are valid; do not vary layouts just to meet a quota.",
    "Ensure every slide advances the narrative and its notes say what the presenter adds beyond the slide.",
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
