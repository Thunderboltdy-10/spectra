/**
 * Background compiler agents
 * Phase 10 §10.8
 *
 * Compilation runs as internal durable jobs that never appear as ordinary Live
 * Dock tabs. Their status surfaces inside Agent Foundry instead — "Analysing 3
 * sources", "Compiling 6 skills", "Running 12 checks", "Build complete".
 */

import {
  createInternalRun,
  type InternalRunDescriptor,
} from "../../runs/background/internal-run-policy";
import type { AgentMission } from "./mission";
import type { EvidenceBinding, EvidenceExtraction } from "./evidence";
import { detectCrossSourceContradictions } from "./evidence";
import {
  detectSkillOverlap,
  orphanedSkillBindings,
  skillIssues,
  type SpectraSkill,
} from "./skills";
import type { EvaluationReport } from "./evaluation";

export type CompilerStage =
  | "interpret_mission"
  | "extract_evidence"
  | "propose_skills"
  | "create_evaluations"
  | "produce_routing_signature"
  | "identify_failure_modes"
  | "detect_overlap"
  | "compile_release";

export const COMPILER_STAGES: readonly CompilerStage[] = [
  "interpret_mission",
  "extract_evidence",
  "propose_skills",
  "create_evaluations",
  "produce_routing_signature",
  "identify_failure_modes",
  "detect_overlap",
  "compile_release",
];

export type CompilerStageState = {
  stage: CompilerStage;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  /** Progress within the stage, when it processes a countable set. */
  processed?: number;
  total?: number;
  /** Short, human phrasing shown in Foundry. Never internal jargon. */
  label: string;
  detail?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
};

export type CompilerJob = {
  id: string;
  agentId: string;
  /** Internal durable run backing this job — hidden from the Live Dock. */
  run: InternalRunDescriptor;
  stages: CompilerStageState[];
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  /** Content hash of the draft this job compiled, for staleness detection. */
  draftHash: string;
  startedAt: number;
  completedAt?: number;
};

/** Stage labels are written for the creator, not the engineer. */
function defaultLabel(stage: CompilerStage): string {
  switch (stage) {
    case "interpret_mission":
      return "Reading the mission";
    case "extract_evidence":
      return "Analysing sources";
    case "propose_skills":
      return "Drafting skills";
    case "create_evaluations":
      return "Writing checks";
    case "produce_routing_signature":
      return "Working out when to use this agent";
    case "identify_failure_modes":
      return "Looking for weak points";
    case "detect_overlap":
      return "Checking for duplicate skills";
    case "compile_release":
      return "Preparing the release";
  }
}

export function createCompilerJob(input: {
  id: string;
  agentId: string;
  draftHash: string;
  /** Stages this draft does not need — e.g. no evidence supplied. */
  skipStages?: CompilerStage[];
  now: number;
}): CompilerJob {
  const skip = new Set(input.skipStages ?? []);
  return {
    id: input.id,
    agentId: input.agentId,
    run: createInternalRun({
      runId: `agent-compile-${input.id}`,
      ownerSurface: `agent:${input.agentId}`,
      presentation: "in_surface",
      statusLabel: "Building this agent",
    }),
    stages: COMPILER_STAGES.map((stage) => ({
      stage,
      status: skip.has(stage) ? "skipped" : "pending",
      label: defaultLabel(stage),
    })),
    status: "queued",
    draftHash: input.draftHash,
    startedAt: input.now,
  };
}

export function beginStage(
  job: CompilerJob,
  stage: CompilerStage,
  input: { total?: number; label?: string; detail?: string; now: number },
): CompilerJob {
  return {
    ...job,
    status: "running",
    stages: job.stages.map((state) =>
      state.stage === stage
        ? {
            ...state,
            status: "running",
            startedAt: input.now,
            ...(input.total !== undefined ? { total: input.total, processed: 0 } : {}),
            ...(input.label ? { label: input.label } : {}),
            ...(input.detail ? { detail: input.detail } : {}),
          }
        : state,
    ),
  };
}

export function advanceStage(
  job: CompilerJob,
  stage: CompilerStage,
  processed: number,
): CompilerJob {
  return {
    ...job,
    stages: job.stages.map((state) =>
      state.stage === stage ? { ...state, processed } : state,
    ),
  };
}

export function completeStage(
  job: CompilerJob,
  stage: CompilerStage,
  input: { detail?: string; now: number },
): CompilerJob {
  const stages = job.stages.map((state) =>
    state.stage === stage
      ? {
          ...state,
          status: "completed" as const,
          completedAt: input.now,
          ...(input.detail ? { detail: input.detail } : {}),
          ...(state.total !== undefined ? { processed: state.total } : {}),
        }
      : state,
  );
  const remaining = stages.some(
    (state) => state.status === "pending" || state.status === "running",
  );
  return {
    ...job,
    stages,
    status: remaining ? "running" : "completed",
    ...(remaining ? {} : { completedAt: input.now }),
  };
}

export function failStage(
  job: CompilerJob,
  stage: CompilerStage,
  input: { error: string; now: number },
): CompilerJob {
  return {
    ...job,
    status: "failed",
    completedAt: input.now,
    stages: job.stages.map((state) =>
      state.stage === stage
        ? {
            ...state,
            status: "failed",
            error: input.error,
            completedAt: input.now,
          }
        : state,
    ),
  };
}

/**
 * One-line status for the Foundry header. Shows the active stage with its
 * count when it has one, and the terminal state otherwise. Takes the job's
 * observable fields only, so the persisted record and the in-memory job can
 * share one implementation.
 */
export type CompilerJobView = Pick<CompilerJob, "status" | "stages">;

export function compilerStatusLabel(job: CompilerJobView): string {
  if (job.status === "completed") return "Build complete";
  if (job.status === "cancelled") return "Build cancelled";
  if (job.status === "failed") {
    const failed = job.stages.find((state) => state.status === "failed");
    return failed ? `Stopped: ${failed.label.toLowerCase()}` : "Build stopped";
  }

  const active = job.stages.find((state) => state.status === "running");
  if (!active) return "Waiting to start";

  if (active.total !== undefined && active.total > 0) {
    return `${active.label} (${active.processed ?? 0}/${active.total})`;
  }
  return active.label;
}

export function compilerProgress(job: CompilerJobView): number {
  const counted = job.stages.filter((state) => state.status !== "skipped");
  if (counted.length === 0) return 1;
  const done = counted.filter((state) => state.status === "completed").length;
  const active = counted.find((state) => state.status === "running");
  const partial =
    active?.total && active.total > 0 ? (active.processed ?? 0) / active.total : 0;
  return Math.min(1, (done + partial) / counted.length);
}

/** A job compiled from a draft that has since changed is stale. */
export function isStale(job: CompilerJob, currentDraftHash: string): boolean {
  return job.draftHash !== currentDraftHash;
}

/* ------------------------------------------------------------------ */
/* Deterministic compilation checks                                   */
/* ------------------------------------------------------------------ */

export type CompilationDiagnostic = {
  severity: "error" | "warning" | "info";
  stage: CompilerStage;
  message: string;
  /** Skill or binding this diagnostic concerns. */
  subjectId?: string;
};

/**
 * The parts of compilation that do not need a model. Running these first means
 * an obviously incomplete draft never spends model tokens.
 */
export function runDeterministicChecks(input: {
  mission: AgentMission;
  skills: readonly SpectraSkill[];
  bindings: readonly EvidenceBinding[];
  evaluation?: EvaluationReport;
}): CompilationDiagnostic[] {
  const diagnostics: CompilationDiagnostic[] = [];
  const { mission, skills, bindings, evaluation } = input;

  if (!mission.objective.trim()) {
    diagnostics.push({
      severity: "error",
      stage: "interpret_mission",
      message: "The agent has no objective, so nothing can be compiled.",
    });
  }

  for (const skill of skills) {
    for (const issue of skillIssues(skill)) {
      diagnostics.push({
        severity: "error",
        stage: "propose_skills",
        message: issue,
        subjectId: skill.id,
      });
    }
    if (skill.failureModes.length === 0) {
      diagnostics.push({
        severity: "warning",
        stage: "identify_failure_modes",
        message: `"${skill.name}" declares no failure modes, so it cannot recover from a bad result.`,
        subjectId: skill.id,
      });
    }
  }

  for (const orphan of orphanedSkillBindings(skills, bindings)) {
    diagnostics.push({
      severity: "error",
      stage: "extract_evidence",
      message: `A skill depends on evidence "${orphan.bindingId}" that no longer exists.`,
      subjectId: orphan.skillId,
    });
  }

  for (const overlap of detectSkillOverlap(skills)) {
    diagnostics.push({
      severity: "warning",
      stage: "detect_overlap",
      message: `Skills ${overlap.left} and ${overlap.right} trigger on substantially the same requests (${Math.round(overlap.overlap * 100)}% overlap).`,
      subjectId: overlap.left,
    });
  }

  const extractions = bindings
    .map((binding) => binding.extraction)
    .filter((extraction): extraction is EvidenceExtraction => Boolean(extraction));

  for (const contradiction of detectCrossSourceContradictions(extractions)) {
    diagnostics.push({
      severity: "warning",
      stage: "extract_evidence",
      message: contradiction.description,
      subjectId: contradiction.id,
    });
  }

  for (const extraction of extractions) {
    if (extraction.securityConcerns.length > 0) {
      diagnostics.push({
        severity: "warning",
        stage: "extract_evidence",
        message: `${extraction.securityConcerns.length} instruction-like passage(s) in this source were quarantined and did not become agent policy.`,
        subjectId: extraction.sourceId,
      });
    }
  }

  if (!evaluation) {
    diagnostics.push({
      severity: "warning",
      stage: "create_evaluations",
      message: "No evaluation has run, so the agent's behaviour is unverified.",
    });
  } else if (evaluation.limitations.length > 0) {
    for (const limitation of evaluation.limitations) {
      diagnostics.push({
        severity: "info",
        stage: "create_evaluations",
        message: limitation.detail,
      });
    }
  }

  return diagnostics;
}

/** Stages that can be skipped for a draft with no evidence or skills yet. */
export function stagesToSkip(input: {
  bindings: readonly EvidenceBinding[];
  skills: readonly SpectraSkill[];
}): CompilerStage[] {
  const skip: CompilerStage[] = [];
  if (input.bindings.length === 0) skip.push("extract_evidence");
  if (input.skills.length < 2) skip.push("detect_overlap");
  return skip;
}
