/**
 * Competence-aware agent routing
 * Phase 10 §10.11
 *
 * Routing decides whether an agent is substantially better suited for a request
 * than ordinary Spectra. A low-confidence routing decision keeps ordinary
 * Spectra; automatic routing remains visible and reversible (agent skill §52).
 */

import type { AgentMission } from "./mission";
import { activateSkills, type SkillActivation, type SpectraSkill } from "./skills";
import type { EvidenceSummary } from "./evidence";
import type { EvaluationReport } from "./evaluation";

export type RoutingEvaluation = Pick<
  EvaluationReport,
  "status" | "verificationStrength" | "passedCount" | "caseCount"
>;

export type RoutingSignal = {
  weight: number;
  reason: string;
};

export type RoutingDecision = {
  agentId: string;
  confidence: "high" | "medium" | "low";
  score: number;
  signals: RoutingSignal[];
  /** Skills that would activate, with their prerequisite status. */
  activeSkills: SkillActivation[];
  /** Reasons this agent is NOT suited, despite matching signals. */
  exclusions: string[];
  /** True when evidence/tools the agent needs are unavailable at runtime. */
  degraded: boolean;
};

export type RoutingContext = {
  request: string;
  workTypes?: string[];
  inputTypes?: string[];
  /** Currently available work and school entities in the request context. */
  availableContext?: string[];
  /** Tools the invoking user has access to. */
  availableTools?: string[];
  /** Evidence bindings accessible to the invoking user. */
  availableEvidence?: string[];
};

const CONFIDENCE_THRESHOLDS = {
  high: 85,
  medium: 65,
  low: 45,
};

/**
 * Decides whether to route a request to this agent. A decision below the `low`
 * threshold means ordinary Spectra is more appropriate (§10.11).
 */
export function decideRouting(input: {
  agent: {
    id: string;
    mission: AgentMission;
    skills: readonly SpectraSkill[];
    routingDescription: string;
    routingExamples: readonly string[];
    negativeExamples: readonly string[];
  };
  evidence: EvidenceSummary;
  latestEvaluation?: RoutingEvaluation;
  context: RoutingContext;
}): RoutingDecision | null {
  const { agent, evidence, latestEvaluation, context } = input;
  const signals: RoutingSignal[] = [];
  const exclusions: string[] = [];
  let requestFit = false;

  // Explicit negative examples block routing immediately.
  const negativeHit = [...agent.negativeExamples, ...agent.mission.exclusions].find((example) =>
    intentMatch(context.request, example, 0.7),
  );
  if (negativeHit) {
    return null;
  }

  // Mission domain overlap
  const domainOverlap = agent.mission.domains.filter((domain) =>
    context.request.toLowerCase().includes(domain.toLowerCase()),
  );
  if (domainOverlap.length > 0) {
    signals.push({
      weight: 15 + domainOverlap.length * 5,
      reason: `Request mentions ${domainOverlap.join(", ")}`,
    });
  }

  // Routing description and examples
  if (agent.routingDescription.trim()) {
    const descriptionMatch = intentMatch(
      context.request,
      agent.routingDescription,
      0.5,
      2,
    );
    if (descriptionMatch) {
      requestFit = true;
      signals.push({
        weight: Math.round(descriptionMatch * 40),
        reason: "Request matches routing description",
      });
    }
  }

  let strongestExample: RoutingSignal | undefined;
  for (const example of agent.routingExamples) {
    const exampleMatch = intentMatch(context.request, example, 0.6, 2);
    if (exampleMatch && exampleMatch * 35 > (strongestExample?.weight ?? 0)) {
      requestFit = true;
      strongestExample = {
        weight: Math.round(exampleMatch * 35),
        reason: `Similar to example: ${example.slice(0, 60)}`,
      };
    }
  }
  if (strongestExample) signals.push(strongestExample);

  // Expected input/output types
  if (context.inputTypes) {
    const inputHits = agent.mission.expectedInputs.filter((input) =>
      context.inputTypes!.some(
        (type) => input.kind === type || input.description.includes(type),
      ),
    );
    if (inputHits.length > 0) {
      signals.push({
        weight: 20,
        reason: `Handles ${inputHits.length} expected input type(s)`,
      });
    }
  }

  if (context.workTypes) {
    const outputHits = agent.mission.expectedOutputs.filter((output) =>
      context.workTypes!.some(
        (type) => output.kind === type || output.description.includes(type),
      ),
    );
    if (outputHits.length > 0) {
      signals.push({
        weight: 20,
        reason: `Produces ${outputHits.length} expected output type(s)`,
      });
    }
  }

  // Skill activation
  const activeSkills = activateSkills(agent.skills, {
    request: context.request,
    ...(context.inputTypes ? { inputTypes: context.inputTypes } : {}),
    ...(context.workTypes ? { workTypes: context.workTypes } : {}),
    ...(context.availableEvidence
      ? { availableEvidenceIds: context.availableEvidence }
      : {}),
    ...(context.availableTools
      ? { availableToolIds: context.availableTools }
      : {}),
  }).filter((activation) => activation.reasons.length > 0);

  // Type/always triggers can support a matching mission but cannot establish
  // suitability by themselves. Use the creator's task-specific trigger text.
  requestFit ||= activeSkills.some(({ skill }) => skill.triggers.some((trigger) => {
    if (trigger.kind === "keyword") return trigger.terms.some((term) => {
      const phrase = tokenize(term).join(" ");
      return phrase.length > 0 && ` ${tokenize(context.request).join(" ")} `.includes(` ${phrase} `);
    });
    if (trigger.kind === "intent") return [trigger.description, ...trigger.examples]
      .some((example) => intentMatch(context.request, example, 0.6, 2) > 0);
    return false;
  }));
  if (!requestFit) return null;

  if (activeSkills.length > 0) {
    const skillWeight = activeSkills.reduce(
      (total, activation) => total + Math.min(activation.score, 30),
      0,
    );
    signals.push({
      weight: Math.min(skillWeight, 30),
      reason: `${activeSkills.length} skill(s) activate`,
    });
  }

  // Evidence depth
  if (evidence.confirmedCount > 0 && evidence.criteriaCount > 5) {
    signals.push({
      weight: 25,
      reason: `${evidence.criteriaCount} confirmed criteria from evidence`,
    });
  } else if (evidence.sourceCount > 0) {
    signals.push({
      weight: 10,
      reason: `${evidence.sourceCount} evidence source(s)`,
    });
  }

  // Recent evaluation strength
  if (latestEvaluation) {
    if (latestEvaluation.status === "passed" && latestEvaluation.caseCount > 0) {
      const evalWeight =
        latestEvaluation.verificationStrength === "strong"
          ? 20
          : latestEvaluation.verificationStrength === "moderate"
            ? 12
            : 5;
      signals.push({
        weight: evalWeight,
        reason: `${latestEvaluation.verificationStrength} evaluation passed`,
      });
    } else if (latestEvaluation.status === "failed") {
      exclusions.push(
        `Latest evaluation failed (${latestEvaluation.passedCount}/${latestEvaluation.caseCount} passed)`,
      );
    } else {
      exclusions.push("Evaluation has not completed successfully");
    }
  } else {
    exclusions.push("No evaluation has run");
  }

  // Degradation: skills need evidence/tools the runtime lacks
  const degraded = activeSkills.some(
    (activation) => activation.missing.length > 0,
  );
  if (degraded) {
    const missing = [
      ...new Set(activeSkills.flatMap((activation) => activation.missing)),
    ];
    exclusions.push(`Missing: ${missing.join(", ")}`);
  }

  // Security concerns block high confidence
  if (evidence.securityConcerns > 0) {
    exclusions.push(
      `${evidence.securityConcerns} untrusted directive(s) in evidence`,
    );
  }

  const score = signals.reduce((total, signal) => total + signal.weight, 0);

  if (score < CONFIDENCE_THRESHOLDS.low) return null;

  const confidence: RoutingDecision["confidence"] =
    score >= CONFIDENCE_THRESHOLDS.high && exclusions.length === 0
      ? "high"
      : score >= CONFIDENCE_THRESHOLDS.medium
        ? "medium"
        : "low";

  // Downgrade confidence when exclusions exist
  const finalConfidence: RoutingDecision["confidence"] =
    exclusions.length > 0 && confidence === "high"
      ? "medium"
      : confidence;

  return {
    agentId: agent.id,
    confidence: finalConfidence,
    score,
    signals,
    activeSkills,
    exclusions,
    degraded,
  };
}

function intentMatch(request: string, target: string, threshold: number, minimumHits = 1): number {
  const requestTokens = [...new Set(tokenize(request))];
  const targetTokens = [...new Set(tokenize(target))];
  if (requestTokens.length === 0 || targetTokens.length === 0) return 0;
  let hits = 0;
  for (const token of targetTokens) {
    if (requestTokens.includes(token)) hits += 1;
  }
  const overlap = hits / targetTokens.length;
  return hits >= minimumHits && overlap >= threshold ? overlap : 0;
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "on",
  "with",
  "is",
  "are",
  "be",
  "this",
  "that",
  "it",
  "can",
  "you",
  "i",
  "me",
  "my",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

/**
 * Selects the best agent from a pool. Returns null when ordinary Spectra is
 * more appropriate than any available agent (§10.11).
 */
export function selectBestAgent(
  decisions: readonly RoutingDecision[],
): RoutingDecision | null {
  const viable = decisions.filter(
    (decision) =>
      decision.confidence !== "low" &&
      decision.exclusions.length === 0 &&
      !decision.degraded,
  );

  if (viable.length === 0) return null;

  return viable.sort((left, right) => {
    if (left.confidence !== right.confidence) {
      const order = { high: 3, medium: 2, low: 1 };
      return order[right.confidence] - order[left.confidence];
    }
    return right.score - left.score;
  })[0] ?? null;
}

/**
 * Routing reason visible to the user, explaining why this agent was selected.
 * Kept concise — the full decision structure is logged but not shown (§10.11).
 */
export function routingReason(decision: RoutingDecision): string {
  const primary = decision.signals
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 2)
    .map((signal) => signal.reason.toLowerCase())
    .join("; ");

  const skills =
    decision.activeSkills.length > 0
      ? ` (${decision.activeSkills.length} specialized skill${decision.activeSkills.length === 1 ? "" : "s"})`
      : "";

  return `${primary}${skills}`.trim();
}
