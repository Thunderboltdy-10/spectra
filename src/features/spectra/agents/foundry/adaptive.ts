/**
 * Adaptive creation paths and sufficiency
 * Phase 10 §10.4 and §10.9
 *
 * This module decides *which* facet of an agent's competence is the next
 * highest-value thing to establish. It deliberately does not write the
 * conversational prompt — the creator model writes context-specific prompts
 * (§10.3). What lives here is the deterministic planning skeleton: archetype
 * inference, facet weighting, and the sufficiency check that lets
 * "Continue building" stop on its own.
 */

import type { AgentMission } from "./mission";
import {
  coveredFacets,
  FOUNDRY_FACETS,
  type FoundryFacet,
  type FoundrySectionKind,
  type FoundryState,
} from "./sections";

/**
 * Broad mission shapes. These are recognition aids for weighting facets, not
 * product categories — an agent may match several or none, and an unmatched
 * mission still gets a sensible generic weighting.
 */
export type MissionArchetype =
  | "marker_tutor"
  | "research_specialist"
  | "process_agent"
  | "personal_assistant"
  | "creative_agent"
  | "technical_agent"
  | "general";

type ArchetypeSignal = {
  archetype: MissionArchetype;
  terms: readonly string[];
};

const ARCHETYPE_SIGNALS: readonly ArchetypeSignal[] = [
  {
    archetype: "marker_tutor",
    terms: [
      "mark",
      "marking",
      "grade",
      "grading",
      "rubric",
      "assess",
      "assessment",
      "feedback",
      "tutor",
      "teach",
      "examiner",
      "moderate",
      "coursework",
    ],
  },
  {
    archetype: "research_specialist",
    terms: [
      "research",
      "source",
      "sources",
      "cite",
      "citation",
      "literature",
      "evidence",
      "paper",
      "study",
      "investigate",
      "survey",
      "fact-check",
    ],
  },
  {
    archetype: "process_agent",
    terms: [
      "process",
      "procedure",
      "policy",
      "workflow",
      "compliance",
      "approval",
      "onboarding",
      "ticket",
      "sop",
      "escalate",
      "operations",
    ],
  },
  {
    archetype: "personal_assistant",
    terms: [
      "assistant",
      "my schedule",
      "remind",
      "reminder",
      "inbox",
      "personal",
      "routine",
      "preferences",
      "organise",
      "organize",
      "plan my",
    ],
  },
  {
    archetype: "creative_agent",
    terms: [
      "write",
      "writing",
      "creative",
      "story",
      "copy",
      "brand",
      "design",
      "draft",
      "tone of voice",
      "narrative",
      "script",
    ],
  },
  {
    archetype: "technical_agent",
    terms: [
      "code",
      "codebase",
      "debug",
      "build",
      "deploy",
      "api",
      "test",
      "refactor",
      "engineer",
      "script",
      "database",
      "pipeline",
    ],
  },
];

export function inferArchetypes(mission: AgentMission): MissionArchetype[] {
  const haystack = [
    mission.objective,
    ...mission.domains,
    ...mission.intendedUsers,
    ...mission.expectedInputs.map((input) => input.description),
    ...mission.expectedOutputs.map((output) => output.description),
  ]
    .join(" ")
    .toLowerCase();

  const scored = ARCHETYPE_SIGNALS.map((signal) => ({
    archetype: signal.archetype,
    score: signal.terms.reduce(
      (total, term) => (haystack.includes(term) ? total + 1 : total),
      0,
    ),
  }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored.length > 0
    ? scored.slice(0, 2).map((entry) => entry.archetype)
    : ["general"];
}

/**
 * Facet weights per archetype. Weight 0 means the facet is not automatically
 * pursued for this mission shape — the user can still ask for it explicitly.
 */
const ARCHETYPE_WEIGHTS: Record<
  MissionArchetype,
  Partial<Record<FoundryFacet, number>>
> = {
  marker_tutor: {
    criteria: 100,
    evidence: 95,
    calibration: 85,
    outputs: 70,
    boundaries: 60,
    evaluation: 55,
    inputs: 50,
    interaction: 40,
    procedure: 30,
    tools: 10,
  },
  research_specialist: {
    evidence: 95,
    criteria: 80,
    procedure: 75,
    tools: 70,
    outputs: 65,
    boundaries: 55,
    evaluation: 50,
    inputs: 45,
    interaction: 35,
    calibration: 20,
  },
  process_agent: {
    procedure: 100,
    boundaries: 90,
    tools: 85,
    inputs: 70,
    outputs: 65,
    criteria: 55,
    evidence: 50,
    evaluation: 45,
    interaction: 30,
    calibration: 15,
  },
  personal_assistant: {
    boundaries: 90,
    interaction: 80,
    procedure: 60,
    inputs: 55,
    tools: 50,
    outputs: 45,
    evaluation: 30,
    criteria: 25,
    evidence: 20,
    calibration: 10,
  },
  creative_agent: {
    outputs: 95,
    interaction: 85,
    criteria: 75,
    evidence: 60,
    calibration: 55,
    boundaries: 45,
    inputs: 40,
    evaluation: 35,
    procedure: 25,
    tools: 10,
  },
  technical_agent: {
    tools: 95,
    procedure: 90,
    outputs: 75,
    evaluation: 70,
    boundaries: 65,
    inputs: 60,
    criteria: 50,
    evidence: 40,
    interaction: 25,
    calibration: 20,
  },
  general: {
    inputs: 70,
    outputs: 70,
    criteria: 60,
    boundaries: 55,
    procedure: 50,
    interaction: 45,
    evidence: 40,
    tools: 35,
    evaluation: 30,
    calibration: 15,
  },
};

/** Facets that are always pursued regardless of archetype. */
const BASELINE_WEIGHTS: Partial<Record<FoundryFacet, number>> = {
  objective: 120,
  interaction: 110,
};

/** Below this weight a facet is not worth an automatic section. */
const PURSUIT_THRESHOLD = 40;

export type FacetPlan = {
  facet: FoundryFacet;
  weight: number;
  /** Section kind that best captures this facet for the inferred archetypes. */
  suggestedKind: FoundrySectionKind;
  /** Why this is the next highest-value question, for the creator model. */
  rationale: string;
};

const FACET_KINDS: Record<FoundryFacet, FoundrySectionKind> = {
  objective: "long_text",
  interaction: "long_text",
  inputs: "multi_choice",
  outputs: "long_text",
  criteria: "long_text",
  evidence: "file_attachment",
  procedure: "long_text",
  boundaries: "multi_choice",
  tools: "permission_selection",
  calibration: "example_pair",
  evaluation: "evaluation_response",
};

const FACET_RATIONALE: Record<FoundryFacet, string> = {
  objective: "The agent has no usable objective yet.",
  interaction: "How the agent should feel to work with is unestablished.",
  inputs: "What the agent will be given is undefined, so it cannot validate work.",
  outputs: "The shape of a correct answer is undefined.",
  criteria: "There are no criteria that separate a good result from a poor one.",
  evidence:
    "Real source material would materially improve competence in this domain.",
  procedure: "The steps the agent should follow are not established.",
  boundaries: "What the agent must not do or decide alone is unspecified.",
  tools: "Required capabilities and approval boundaries are unselected.",
  calibration:
    "Worked examples would let the agent match expected judgement, not just describe it.",
  evaluation:
    "There is no way to check the agent behaves correctly before publishing.",
};

export function planFacetWeights(
  mission: AgentMission,
): Map<FoundryFacet, number> {
  const archetypes = inferArchetypes(mission);
  const weights = new Map<FoundryFacet, number>();

  for (const facet of FOUNDRY_FACETS) {
    const archetypeWeight = Math.max(
      ...archetypes.map(
        (archetype) => ARCHETYPE_WEIGHTS[archetype][facet] ?? 0,
      ),
    );
    weights.set(
      facet,
      Math.max(archetypeWeight, BASELINE_WEIGHTS[facet] ?? 0),
    );
  }

  // Mission-declared evidence requirements raise evidence above the threshold
  // even when the archetype would not have pursued it.
  if (mission.evidenceRequirements.length > 0) {
    weights.set("evidence", Math.max(weights.get("evidence") ?? 0, 90));
  }
  // An agent allowed to make decisions always needs explicit boundaries.
  if (mission.decisionsAllowed.some((policy) => policy.autonomy !== "always_ask")) {
    weights.set("boundaries", Math.max(weights.get("boundaries") ?? 0, 85));
  }

  return weights;
}

/**
 * The next section worth generating, or null when the current state is
 * sufficient. "Continue building" stops on null (§10.4); the user may still
 * request more through the creator composer.
 */
export function nextFacetPlan(
  mission: AgentMission,
  state: FoundryState,
): FacetPlan | null {
  const weights = planFacetWeights(mission);
  const covered = coveredFacets(state);
  const open = new Set(
    state.sections
      .filter((section) => section.status === "open")
      .map((section) => section.facet),
  );

  const candidate = FOUNDRY_FACETS.filter(
    (facet) => !covered.has(facet) && !open.has(facet),
  )
    .map((facet) => ({ facet, weight: weights.get(facet) ?? 0 }))
    .filter((entry) => entry.weight >= PURSUIT_THRESHOLD)
    .sort((left, right) => right.weight - left.weight)[0];

  if (!candidate) return null;

  return {
    facet: candidate.facet,
    weight: candidate.weight,
    suggestedKind: FACET_KINDS[candidate.facet],
    rationale: FACET_RATIONALE[candidate.facet],
  };
}

export type SufficiencyReport = {
  sufficient: boolean;
  /** 0-1 completeness across facets the mission actually needs. */
  coverage: number;
  pursuedFacets: FoundryFacet[];
  missingFacets: FoundryFacet[];
  /** Facets deliberately not pursued for this mission shape. */
  notApplicable: FoundryFacet[];
};

export function assessSufficiency(
  mission: AgentMission,
  state: FoundryState,
): SufficiencyReport {
  const weights = planFacetWeights(mission);
  const covered = coveredFacets(state);

  const pursued = FOUNDRY_FACETS.filter(
    (facet) => (weights.get(facet) ?? 0) >= PURSUIT_THRESHOLD,
  );
  const notApplicable = FOUNDRY_FACETS.filter(
    (facet) => (weights.get(facet) ?? 0) < PURSUIT_THRESHOLD,
  );
  const missing = pursued.filter((facet) => !covered.has(facet));

  return {
    sufficient: missing.length === 0,
    coverage:
      pursued.length === 0
        ? 1
        : (pursued.length - missing.length) / pursued.length,
    pursuedFacets: pursued,
    missingFacets: missing,
    notApplicable,
  };
}
