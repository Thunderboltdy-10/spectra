/**
 * Modified adaptation of Anthropic's frontend-design guidance (Apache-2.0),
 * pinned at anthropics/skills@33375500bcea98d610eb30ce10ac4e59b89c390d.
 * Spectra changes: native editable artifacts, existing tokens/tools, no required
 * design stages, font bans, fixed palette or decorative treatment.
 * Source, modification notes and license: public/skills/licenses/anthropic-frontend-design/.
 */
export const artifactDesignGuidance = [
  "Let the subject, audience and use determine the design. Follow the user's reference or existing artifact style; otherwise choose a coherent direction using the available native theme and typography tools. A one-page memo, projected talk and reusable workbook need different densities.",
  "Make typography, spacing and alignment carry the hierarchy. Use colour, rules, numbering and emphasis to communicate a real distinction, not to decorate every section. Repeat layouts when comparison benefits from consistency; vary them when the explanation changes.",
  "Put the most useful idea in focus and keep supporting detail quiet. Use an editable chart, table, equation or diagram when it explains the content. Motion or a transition should clarify a change or pace the presentation; static work is equally valid.",
  "Review the actual saved result at its intended size and native export when available. Check legibility, contrast, overflow, reading order and editability. Refine the specific defect; preserve the user's content and style instead of applying a generic makeover. Never claim an inspection that did not happen.",
] as const;
