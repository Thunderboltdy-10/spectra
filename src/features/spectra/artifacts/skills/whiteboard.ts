import { defineArtifactSkill } from "../types";

export const whiteboardSkill = defineArtifactSkill({
  typeKey: "whiteboard",
  purpose:
    "Organize and communicate ideas spatially through pages, frames, nodes, connectors, drawings, and permissioned embedded work.",
  createWhen: [
    "Spatial relationships, brainstorming, concept mapping, diagramming, or freeform collaborative composition is central.",
  ],
  inspect: [
    "Inspect only the relevant page, viewport plus margin, selected frame, topology summary, and neighboring connectors before loading node detail.",
    "Use the non-spatial outline for large or accessibility-focused inspection; do not inject the entire board into ordinary context.",
  ],
  regions: [
    "page",
    "layer",
    "frame",
    "node property",
    "node text",
    "connector endpoint",
    "group",
    "source",
    "board setting",
    "viewport",
  ],
  operations: [
    "Create, rewrite, place, connect, group, align, distribute, cluster, label, embed, and validate nodes.",
    "Create frames and sections; change supported shape kinds; lock, unlock, reorder, duplicate, group, and ungroup bounded selections without changing stable identity.",
    "Attach connectors to named object anchors; set straight, elbow, or curved routes; label and reverse them; and choose none, arrow, circle, or diamond endpoint caps.",
    "Apply concept-map, study-map, reflection, or brainwriting templates; adjust visible note and card vote tallies; and configure grid visibility, snapping, and the virtualization threshold.",
    "Export the current page or selected frame through the registered PNG and SVG operations; PDF and portable-package export remain board-wide registered operations.",
    "Treat geometry as authored meaning: choose a spatial grammar (flow, hierarchy, comparison, timeline, matrix, cluster, or freeform map), calculate non-overlapping bounds, route connectors through clear channels, and keep labels readable at the default viewport.",
    "Convert selected text into a diagram or reorganize a bounded region through a ghost/bounding-box proposal.",
    "Refuse freehand ink, automatic obstacle routing, timed or anonymous voting, and native Miro or FigJam import with the capability's exact availability reason; do not simulate them with unrelated edits.",
    "Defer shared timer, music, and reaction widgets to P12.I6; use the local ephemeral laser pointer only for human facilitation, never as persisted board content.",
  ],
  preservationRules: [
    "Preserve stable node identity, connector endpoints, pages, layers, groups, z-order, locked nodes, off-screen content, provenance, and accessibility order.",
    "Never move locked or out-of-scope nodes, expose inaccessible embeds, or destroy manual geometry during a local rewrite.",
  ],
  validation: [
    "Check orphan connectors, extreme/corrupt geometry, overlap, bounds, locked layers, semantic labels, reading order, missing assets, and embed permissions.",
    "Inspect the rendered viewport after placement, not only the JSON: repair collisions, connector crossings, uneven spacing, tiny text, ambiguous direction, redundant decoration, and content stranded far from the main composition.",
    "Keep diagrams understandable in spatial, outline, exported, embedded, narrow, touch, and reduced-motion representations.",
  ],
  approvals: [
    "Preview broad auto-layout, frame/layer clearing, group deletion, large connector rewrites, and any change outside the selected viewport.",
  ],
  connections: [
    "Nodes may embed live or pinned permissioned artifacts and cite sources without granting access or copying private content.",
  ],
  workingEffects: [
    "Nodes materialize, connectors draw, and selected groups settle along calm paths; independent spatial regions may animate together.",
    "All effects clear after every terminal state, with static but clear reduced-motion treatment.",
  ],
});
