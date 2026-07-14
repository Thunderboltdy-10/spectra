import { defineArtifactSkill } from "../types";
export const agentSkill = defineArtifactSkill({
  typeKey: "agent", purpose: "Define a reusable specialist through scoped instructions, skills, tools, resources, routing, and evaluation.",
  createWhen: ["A recurring workflow benefits from specialized behaviour and permissioned resources."], inspect: ["Load the selected version, routing summary, and only the bindings needed for the present change."],
  regions: ["instructions", "skill binding", "tool binding", "resource binding", "routing example", "evaluation case"], operations: ["Rewrite instructions, bind capabilities, propose versions, evaluate, share, and route."],
  preservationRules: ["Never broaden resource access beyond the invoking actor; creator-only deletion remains invariant."], validation: ["Run safety, routing, permission, regression, and usefulness evaluations before publishing a version."],
  approvals: ["Require confirmation for consequential tools, broader sharing, or binding sensitive resources."], connections: ["Agents use permissioned artifacts as knowledge and are automatically routed only at sufficient confidence."], workingEffects: ["Configuration regions update individually; evaluation and routing state remain visible and reversible."],
});
