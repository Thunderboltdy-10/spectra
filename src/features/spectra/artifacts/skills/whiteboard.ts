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
    "Convert selected text into a diagram or reorganize a bounded region through a ghost/bounding-box proposal.",
  ],
  preservationRules: [
    "Preserve stable node identity, connector endpoints, pages, layers, groups, z-order, locked nodes, off-screen content, provenance, and accessibility order.",
    "Never move locked or out-of-scope nodes, expose inaccessible embeds, or destroy manual geometry during a local rewrite.",
  ],
  validation: [
    "Check orphan connectors, extreme/corrupt geometry, overlap, bounds, locked layers, semantic labels, reading order, missing assets, and embed permissions.",
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
