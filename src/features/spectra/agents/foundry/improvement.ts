/**
 * Safe self-improvement
 * Phase 10 §10.12
 *
 * An agent never edits its own active release. Verified signals accumulate
 * until they justify a *candidate* release, which is evaluated and shadowed
 * before publication. Untrusted usage content can never become policy
 * (INV-18): only signals whose provenance is explicit and trusted are eligible.
 */

import {
  compareForRegression,
  releaseBlockers,
  type EvaluationReport,
} from "./evaluation";
import { detectSecurityConcerns } from "./evidence";
import type { SpectraSkill } from "./skills";

/**
 * Signal kinds eligible for learning. Notably absent: raw conversation text,
 * unreviewed agent output, and anything a user merely *said* inside a run. A
 * signal must represent a verified judgement, not content.
 */
export type LearningSignalKind =
  | "explicit_feedback"
  | "accepted_revision"
  | "known_outcome_comparison"
  | "authority_confirmed_decision"
  | "repeated_corrected_mistake"
  | "evaluation_failure"
  | "tool_trace"
  | "accepted_foundry_edit";

export type LearningSignal = {
  id: string;
  kind: LearningSignalKind;
  agentId: string;
  /** Who verified this signal. Anonymous signals are not eligible. */
  verifiedBy: {
    accountId: string;
    role: "creator" | "authority" | "reviewer" | "system";
  };
  /** Short, structured description — not raw usage content. */
  observation: string;
  /** Structured evidence pointer rather than inline untrusted text. */
  evidenceRef?: { kind: "eval_case" | "revision" | "tool_call"; id: string };
  /** Weight of this signal towards the improvement threshold. */
  weight: number;
  createdAt: number;
  /** True once this signal has contributed to a candidate release. */
  consumed: boolean;
};

/** Signal kinds that can only come from an authority, not any user. */
const AUTHORITY_ONLY: ReadonlySet<LearningSignalKind> = new Set([
  "authority_confirmed_decision",
  "known_outcome_comparison",
]);

/** Signal kinds whose observation text is machine-generated and safe. */
const SYSTEM_GENERATED: ReadonlySet<LearningSignalKind> = new Set([
  "evaluation_failure",
  "tool_trace",
]);

export type SignalRejection = {
  signalId: string;
  reason:
    | "unverified_source"
    | "insufficient_authority"
    | "contains_injection"
    | "already_consumed"
    | "observation_too_long";
  detail: string;
};

const MAX_OBSERVATION_LENGTH = 2_000;

/**
 * Filters signals down to those eligible to influence a candidate release.
 * A signal containing an injection attempt is rejected outright — it is not
 * sanitized and reused, because the judgement it encodes is untrustworthy.
 */
export function filterEligibleSignals(
  signals: readonly LearningSignal[],
): { eligible: LearningSignal[]; rejected: SignalRejection[] } {
  const eligible: LearningSignal[] = [];
  const rejected: SignalRejection[] = [];

  for (const signal of signals) {
    if (signal.consumed) {
      rejected.push({
        signalId: signal.id,
        reason: "already_consumed",
        detail: "Signal already contributed to a previous candidate release.",
      });
      continue;
    }

    if (!signal.verifiedBy.accountId) {
      rejected.push({
        signalId: signal.id,
        reason: "unverified_source",
        detail: "Signal has no verified originating account.",
      });
      continue;
    }

    if (
      AUTHORITY_ONLY.has(signal.kind) &&
      signal.verifiedBy.role !== "authority" &&
      signal.verifiedBy.role !== "creator"
    ) {
      rejected.push({
        signalId: signal.id,
        reason: "insufficient_authority",
        detail: `${signal.kind} requires an authority or creator, not ${signal.verifiedBy.role}.`,
      });
      continue;
    }

    if (signal.observation.length > MAX_OBSERVATION_LENGTH) {
      rejected.push({
        signalId: signal.id,
        reason: "observation_too_long",
        detail:
          "Observation exceeds the structured-summary bound, suggesting raw usage content was pasted in.",
      });
      continue;
    }

    if (!SYSTEM_GENERATED.has(signal.kind)) {
      const concerns = detectSecurityConcerns(signal.observation);
      if (concerns.length > 0) {
        rejected.push({
          signalId: signal.id,
          reason: "contains_injection",
          detail: `Observation contains ${concerns[0]!.kind.replace(/_/g, " ")} and cannot influence policy.`,
        });
        continue;
      }
    }

    eligible.push(signal);
  }

  return { eligible, rejected };
}

/**
 * Improvement is batched, not per-message: a candidate is only proposed once
 * accumulated signal weight crosses the threshold *and* enough distinct signals
 * exist that one opinion cannot move the agent (§10.12).
 */
export type ImprovementThreshold = {
  minimumWeight: number;
  minimumDistinctSignals: number;
  minimumDistinctVerifiers: number;
};

export const DEFAULT_IMPROVEMENT_THRESHOLD: ImprovementThreshold = {
  minimumWeight: 10,
  minimumDistinctSignals: 3,
  minimumDistinctVerifiers: 2,
};

export type ThresholdAssessment = {
  reached: boolean;
  weight: number;
  distinctSignals: number;
  distinctVerifiers: number;
  missing: string[];
};

export function assessThreshold(
  signals: readonly LearningSignal[],
  threshold: ImprovementThreshold = DEFAULT_IMPROVEMENT_THRESHOLD,
): ThresholdAssessment {
  const weight = signals.reduce((total, signal) => total + signal.weight, 0);
  const distinctSignals = signals.length;
  const distinctVerifiers = new Set(
    signals.map((signal) => signal.verifiedBy.accountId),
  ).size;

  const missing: string[] = [];
  if (weight < threshold.minimumWeight) {
    missing.push(
      `${threshold.minimumWeight - weight} more signal weight required`,
    );
  }
  if (distinctSignals < threshold.minimumDistinctSignals) {
    missing.push(
      `${threshold.minimumDistinctSignals - distinctSignals} more distinct signal(s) required`,
    );
  }
  if (distinctVerifiers < threshold.minimumDistinctVerifiers) {
    missing.push(
      `${threshold.minimumDistinctVerifiers - distinctVerifiers} more independent verifier(s) required`,
    );
  }

  return {
    reached: missing.length === 0,
    weight,
    distinctSignals,
    distinctVerifiers,
    missing,
  };
}

/* ------------------------------------------------------------------ */
/* Candidate releases                                                 */
/* ------------------------------------------------------------------ */

export type ImprovementChange =
  | { kind: "skill_added"; skill: SpectraSkill; rationale: string }
  | {
      kind: "skill_revised";
      skillId: string;
      fromVersion: number;
      toVersion: number;
      rationale: string;
    }
  | { kind: "skill_deprecated"; skillId: string; rationale: string }
  | {
      kind: "routing_adjusted";
      field: "description" | "examples" | "negative_examples" | "domains";
      rationale: string;
    }
  | {
      kind: "evidence_rebound";
      bindingId: string;
      rationale: string;
    };

export type CandidateRelease = {
  id: string;
  agentId: string;
  /** Release this candidate would supersede. */
  baseReleaseId: string;
  changes: ImprovementChange[];
  /** Signals that justified this candidate. */
  signalIds: string[];
  state:
    | "proposed"
    | "evaluating"
    | "shadowing"
    | "ready"
    | "rejected"
    | "published";
  evaluation?: EvaluationReport;
  /** Comparison against the base release's evaluation. */
  comparison?: ReturnType<typeof compareForRegression>;
  /** Shadow-run outcome, when a shadow comparison was performed. */
  shadow?: ShadowComparison;
  provenance: ImprovementProvenance;
  createdAt: number;
  updatedAt: number;
  rejectionReason?: string;
};

/** Every change carries provenance so it can be explained and rolled back. */
export type ImprovementProvenance = {
  proposedBy: "compiler" | "creator";
  signalKinds: LearningSignalKind[];
  verifierAccountIds: string[];
  thresholdSnapshot: ThresholdAssessment;
  baseReleaseId: string;
};

export type ShadowComparison = {
  sampleCount: number;
  candidateWins: number;
  baseWins: number;
  ties: number;
  /** Judged by an independent model or human where available. */
  judgedBy: "independent_model" | "human" | "self";
  /** Cases where the candidate was worse — these block publication. */
  regressions: string[];
};

/**
 * A candidate may only publish when its evaluation passes, no regression is
 * detected against the base release, and the shadow comparison shows no
 * degradation. Anything else keeps the active release in place.
 */
export function candidatePublishBlockers(
  candidate: CandidateRelease,
): string[] {
  const blockers: string[] = [];

  if (candidate.state === "rejected") {
    blockers.push(candidate.rejectionReason ?? "Candidate was rejected.");
    return blockers;
  }

  if (!candidate.evaluation) {
    blockers.push("Candidate has not been evaluated.");
  } else {
    blockers.push(...releaseBlockers(candidate.evaluation));
  }

  if (candidate.comparison && !candidate.comparison.safe) {
    for (const regression of candidate.comparison.regressions) {
      blockers.push(
        `Regression in ${regression.layer}: ${regression.caseId} — ${regression.reason}`,
      );
    }
    const hidden = candidate.comparison.removedCases;
    if (hidden.length > 0) {
      blockers.push(
        `${hidden.length} evaluation case(s) removed rather than fixed.`,
      );
    }
  } else if (!candidate.comparison) {
    blockers.push("Candidate has not been compared against the current release.");
  }

  if (!candidate.shadow) {
    blockers.push("Candidate has not completed a shadow comparison.");
  } else {
    if (candidate.shadow.regressions.length > 0) {
      blockers.push(
        `Shadow comparison found ${candidate.shadow.regressions.length} case(s) where the candidate performed worse.`,
      );
    }
    if (candidate.shadow.candidateWins < candidate.shadow.baseWins) {
      blockers.push(
        "Shadow comparison favours the current release over the candidate.",
      );
    }
  }

  if (candidate.changes.length === 0) {
    blockers.push("Candidate contains no changes.");
  }

  return blockers;
}

/**
 * Advances a candidate through its lifecycle. State never skips forward: a
 * candidate cannot reach `ready` without evaluation, comparison and shadow.
 */
export function advanceCandidate(
  candidate: CandidateRelease,
  now: number,
): CandidateRelease {
  if (candidate.state === "rejected" || candidate.state === "published") {
    return candidate;
  }

  if (!candidate.evaluation) {
    return { ...candidate, state: "evaluating", updatedAt: now };
  }

  if (candidate.evaluation.status === "failed") {
    return {
      ...candidate,
      state: "rejected",
      rejectionReason: `Evaluation failed (${candidate.evaluation.passedCount}/${candidate.evaluation.caseCount} passed).`,
      updatedAt: now,
    };
  }

  if (candidate.evaluation.status === "running") {
    return { ...candidate, state: "evaluating", updatedAt: now };
  }

  if (candidate.comparison && !candidate.comparison.safe) {
    return {
      ...candidate,
      state: "rejected",
      rejectionReason: `${candidate.comparison.regressions.length} regression(s) against the current release.`,
      updatedAt: now,
    };
  }

  if (!candidate.shadow) {
    return { ...candidate, state: "shadowing", updatedAt: now };
  }

  const blockers = candidatePublishBlockers(candidate);
  return {
    ...candidate,
    state: blockers.length === 0 ? "ready" : "shadowing",
    updatedAt: now,
  };
}

/**
 * Human-readable explanation of a candidate, for the optional owner
 * notification and the Foundry release history (§10.12).
 */
export function describeCandidate(candidate: CandidateRelease): string {
  const parts = candidate.changes.map((change) => {
    switch (change.kind) {
      case "skill_added":
        return `added skill "${change.skill.name}"`;
      case "skill_revised":
        return `revised skill ${change.skillId} to v${change.toVersion}`;
      case "skill_deprecated":
        return `deprecated skill ${change.skillId}`;
      case "routing_adjusted":
        return `adjusted routing ${change.field.replace(/_/g, " ")}`;
      case "evidence_rebound":
        return `rebound evidence ${change.bindingId}`;
    }
  });

  const from = candidate.provenance.signalKinds
    .map((kind) => kind.replace(/_/g, " "))
    .filter((kind, index, all) => all.indexOf(kind) === index)
    .join(", ");

  return `${parts.join("; ")} — from ${from} verified by ${candidate.provenance.verifierAccountIds.length} reviewer(s).`;
}

/**
 * Rollback target for a published release. Because releases are immutable, a
 * rollback republishes an earlier release rather than reverting content.
 */
export type RollbackPlan = {
  agentId: string;
  fromReleaseId: string;
  toReleaseId: string;
  reason: string;
  /** Signals that will be un-consumed so they can inform a better candidate. */
  releaseSignalIds: string[];
};

export function planRollback(input: {
  agentId: string;
  currentReleaseId: string;
  previousReleaseId: string;
  reason: string;
  consumedSignalIds: readonly string[];
}): RollbackPlan {
  return {
    agentId: input.agentId,
    fromReleaseId: input.currentReleaseId,
    toReleaseId: input.previousReleaseId,
    reason: input.reason,
    releaseSignalIds: [...input.consumedSignalIds],
  };
}
