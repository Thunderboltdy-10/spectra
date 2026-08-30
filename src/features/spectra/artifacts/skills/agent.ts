import { defineArtifactSkill } from "../types";

export const agentSkill = defineArtifactSkill({
  typeKey: "agent",
  purpose:
    "Define a reusable, versioned specialist through scoped instructions, skills, tools, permissioned resources, routing descriptors, behavior, and evaluation.",
  createWhen: [
    "A recurring workflow benefits from specialized behaviour, tested instructions, or permissioned resources.",
    "A focused assistant should be automatically selected for a recognizable class of requests without making its private invocations visible to the creator.",
  ],
  inspect: [
    "Inspect the live draft, latest immutable release, routing summary, publish gates, resource health, and only the stable configuration regions required for the requested change.",
    "Inspect resource permissions and reviewed or pinned versions without copying protected content into the agent definition.",
    "Inspect evaluation categories, regression results, aggregate outcome categories, and explicit feedback without reading unrelated prompts, threads, memory, or private artifact context.",
  ],
  regions: [
    "profile and purpose",
    "audience intent",
    "scope and exclusions",
    "instructions",
    "behavior and boundaries",
    "skill binding",
    "tool binding and approval",
    "resource binding and version policy",
    "routing descriptor",
    "positive routing example",
    "negative routing example",
    "model policy",
    "evaluation case",
    "release notes",
  ],
  operations: [
    "Inspect the adaptive mission, reviewed sources, competence gaps, compiled operating brief, and skill versions.",
    "Add, review, or remove quarantined source bindings; compile, approve, reject, edit, duplicate, or remove a typed skill.",
    "Inspect the generated layered suite; run it against the exact draft; filter case results; inspect judge, score, latency, tokens, response excerpt, and limitations; compare durable runs.",
    "Compare immutable release snapshots and linked evaluations; release to the creator, on request, or published; promote, roll back, suspend, or deprecate with the declared authority gate.",
    "Edit positive and negative routing evidence, enable or disable automatic routing, and preview the production routing decision; low confidence retains ordinary Spectra.",
    "Inspect privacy-safe aggregate usage and consented feedback only. Private prompts, responses, threads, memory, and provider-private traces are unavailable.",
  ],
  preservationRules: [
    "Never broaden resource access beyond the invoking actor, copy inaccessible resource content, expose private invocation data, or weaken creator-only deletion.",
    "Published releases are immutable. All changes land in the live draft or a proposal and require a new release.",
    "Preserve stable skill, tool, resource, eval, and routing-example identities when editing their content.",
    "Do not learn directly from private conversations or silently alter behavior from feedback; aggregate evidence may support a separately evaluated proposal.",
  ],
  validation: [
    "Run schema, instruction, audience, tool, resource-permission, routing, privacy, regression, jailbreak, citation, usefulness, and source-leak gates before publishing.",
    "Verify every enabled tool is allowlisted with least privilege and an appropriate approval mode, every resource remains accessible for its declared audience, and every required eval passes.",
    "Verify the portable manifest contains no secrets, prompts, threads, memory, private outputs, or copied resource content.",
    "Verify edited skills increment their version, duplicated skills start at version one with a new identity, and published releases remain immutable.",
    "Verify run and release comparisons say when a snapshot, judge, limitation record, or regression baseline is unavailable rather than substituting zero or success.",
  ],
  approvals: [
    "Require confirmation for consequential tools, broader sharing or publication, sensitive resource bindings, audience expansion, model-policy changes, or destructive configuration rewrites.",
    "Automatic medium/high-confidence invocation routing itself does not request confirmation; the chosen agent remains visible and reversible.",
  ],
  connections: [
    "Agents use permissioned artifacts as knowledge, may be placed in workspaces or followed without copying, and are automatically routed only when substantially better suited.",
    "A selected release loads only its relevant instructions, enabled skills, allowed tools, resource bindings, and specialized context; it never injects every available agent.",
    "Private invocation threads remain owned by the invoking user and are not part of agent history or creator analytics.",
  ],
  workingEffects: [
    "Profile, instruction, resource, skill, behavior, evaluation, and release regions update independently with real operation-bound blue treatment.",
    "Evaluation and routing state remain specific, visible, and reversible; every effect clears after success, failure, cancellation, rejection, permission loss, or navigation, with a restrained reduced-motion state.",
  ],
  specialistGuides: [
    {
      id: "agent-evaluation",
      trigger:
        "The request creates tests, diagnoses weaknesses, proposes improvement, or prepares a release.",
      instructions: [
        "Cover representative success cases, ambiguity, refusal, privacy, prompt injection, resource leakage, citation, tool approval, and routing boundaries.",
        "Keep fixtures synthetic or explicitly consented and never copy private invocation text into an eval.",
        "Compare required eval results with the current release and block regressions before publish.",
      ],
    },
    {
      id: "agent-resource-binding",
      trigger:
        "The operation adds, updates, removes, or diagnoses a knowledge or artifact resource.",
      instructions: [
        "Resolve current actor access, intended audience compatibility, reviewed or pinned version, provenance, and revocation behavior.",
        "Do not embed source content in the configuration or allow the agent to launder access.",
        "Re-run resource coverage and leak evaluations after a binding changes.",
      ],
    },
  ],
});
