export const visualisationDesignGuide = Object.freeze({
  id: "spectra-visualisation-design-v1",
  trigger:
    "Load when creating or materially styling a rendered interactive visualisation, chart, simulation, or educational tool.",
  instructions: [
    "Design the rendered experience as a focused Spectra learning tool, not a generic dashboard or miniature developer project.",
    "Use SpectraEmbed.tokens or CSS variables derived from them for ink, paper, rules, mint, cyan, violet, and orange; never invent a disconnected theme or purple-gradient AI aesthetic.",
    "Use a clear editorial hierarchy, restrained control density, generous plotting space, concise labels, and progressive disclosure for secondary configuration.",
    "Select the visual form from the educational relationship: position for magnitude, aligned length for comparison, line/area for change, nodes and directed edges for systems, and animation only when it explains a transition.",
    "Every data mark needs a textual or programmatic equivalent, meaningful focus order, sufficient contrast, keyboard operation, responsive reflow, and a complete reduced-motion path.",
    "Keep motion deliberate: transition changed entities in place, preserve spatial continuity, avoid electrical glows/noise, and stop every animation when the operation ends.",
    "Use native HTML controls and semantic landmarks. Expose a document title, primary heading, concise instructions, units, legend where necessary, and visible focus styles.",
    "Emit only named, bounded interaction events through the Spectra SDK. Never read ambient credentials, use external network calls, or place secrets in source or rendered output.",
    "Verify narrow and wide layouts, long labels, empty/extreme values, interaction reset, color-independent meaning, keyboard use, reduced motion, and embed sizing before considering the visualisation complete.",
    "For tiny educational sketches and diagrams, keep SVG/HTML compact: prefer simple shapes and short labels over dense path dumps, embedded fonts, or multi-thousand-line markup so creation finishes in one tool call.",
  ],
} as const);
