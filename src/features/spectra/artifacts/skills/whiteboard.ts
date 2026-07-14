import { defineArtifactSkill } from "../types";
export const whiteboardSkill = defineArtifactSkill({
  typeKey: "whiteboard", purpose: "Organize ideas spatially through nodes, connectors, frames, layers, and embedded artifacts.",
  createWhen: ["Spatial relationships, brainstorming, mapping, or freeform collaborative composition is central."], inspect: ["Inspect the visible viewport and spatial outline before loading selected nodes or neighboring frames."],
  regions: ["node", "edge", "frame", "group", "layer", "viewport"], operations: ["Create, rewrite, move, connect, group, align, distribute, organize, embed, and validate nodes."],
  preservationRules: ["Preserve stable node identity, connectors, layers, groups, z-order, and off-screen content."], validation: ["Check orphan edges, inaccessible content, overlap, bounds, locked layers, and embed permissions."],
  approvals: ["Preview broad auto-layout, group deletion, layer clearing, and changes outside the visible viewport."], connections: ["Nodes may embed live artifacts without granting access or copying their content."], workingEffects: ["Nodes materialize and reorganize along calm paths; independent spatial regions can animate concurrently."],
});
