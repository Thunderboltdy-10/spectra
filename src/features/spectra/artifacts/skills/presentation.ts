import { defineArtifactSkill } from "../types";
export const presentationSkill = defineArtifactSkill({
  typeKey: "presentation", purpose: "Create Spectra-native visual narratives with polished layouts, objects, motion, and presenting.",
  createWhen: ["Ideas should be communicated as a sequence of visual slides rather than prose."], inspect: ["Inspect deck outline and theme, then load targeted slides and objects."],
  regions: ["slide", "slide object", "speaker notes", "theme token", "animation", "chart binding"], operations: ["Add slides, compose layouts, rewrite or move objects, apply theme, generate charts, and check overflow."],
  preservationRules: ["Preserve unaffected object identity, constraints, reading order, animation, and source bindings."], validation: ["Check overflow, contrast, typography, alignment, media, reading order, and presenter output."],
  approvals: ["Preview deck-wide restyling, slide deletion, and lossy imported-feature changes."], connections: ["Slides can bind live Sheets charts and embed other permissioned artifacts."], workingEffects: ["Objects materialize, move, resize, or restyle in place with deliberate composition motion."],
});
