import type { RequestClass } from "@/lib/auto-settings";
import type { SpendingTier } from "@/types";

export type PipelineStageId =
  | "classifyRequest"
  | "autoSettings"
  | "buildRoutePlan"
  | "memoryRead"
  | "ragRetrieval"
  | "webSearch"
  | "modelSelection"
  | "clarificationCheck"
  | "multiAgent"
  | "generation"
  | "rehydration"
  | "postProcess";

export type PipelineSkippedStage = {
  step: PipelineStageId;
  reason: string;
};

export type PipelineState = {
  requestClass: RequestClass;
  classificationReason: string;
  executionPlan: PipelineStageId[];
  completedStages: PipelineStageId[];
  skippedStages: PipelineSkippedStage[];
  costBudgetUsd: number;
  usageBudgetTokens: number;
  usageBudgetRemaining: number;
};

type PipelineControllerInput = {
  requestClass: RequestClass;
  classificationReason: string;
};

const ALL_STAGES: PipelineStageId[] = [
  "classifyRequest",
  "autoSettings",
  "buildRoutePlan",
  "memoryRead",
  "ragRetrieval",
  "webSearch",
  "modelSelection",
  "clarificationCheck",
  "multiAgent",
  "generation",
  "rehydration",
  "postProcess",
];

const EXECUTION_PLAN_BY_CLASS: Record<RequestClass, PipelineStageId[]> = {
  T0: ["classifyRequest", "modelSelection", "generation", "postProcess"],
  T1: [
    "classifyRequest",
    "autoSettings",
    "buildRoutePlan",
    "memoryRead",
    "modelSelection",
    "generation",
    "postProcess",
  ],
  T2: [
    "classifyRequest",
    "autoSettings",
    "buildRoutePlan",
    "memoryRead",
    "ragRetrieval",
    "webSearch",
    "modelSelection",
    "clarificationCheck",
    "generation",
    "postProcess",
  ],
  T3: [
    "classifyRequest",
    "autoSettings",
    "buildRoutePlan",
    "memoryRead",
    "ragRetrieval",
    "webSearch",
    "modelSelection",
    "clarificationCheck",
    "multiAgent",
    "generation",
    "rehydration",
    "postProcess",
  ],
};

const CLASS_BUDGET_USD: Record<RequestClass, number> = {
  T0: 0.001,
  T1: 0.01,
  T2: 0.05,
  T3: 0.15,
};

function dedupe<T>(values: T[]) {
  return [...new Set(values)];
}

function stageAllowedByPlan(stage: PipelineStageId, executionPlan: PipelineStageId[]) {
  return executionPlan.includes(stage);
}

function usageTokenBudgetForUsd(costBudgetUsd: number) {
  // Conservative budget conversion: assume worst-case 30 USD / 1M tokens.
  return Math.max(300, Math.floor((costBudgetUsd * 1_000_000) / 30));
}

export function buildExecutionPlan(requestClass: RequestClass) {
  return [...EXECUTION_PLAN_BY_CLASS[requestClass]];
}

export function budgetForRequestClass(requestClass: RequestClass) {
  return CLASS_BUDGET_USD[requestClass];
}

export class PipelineController {
  private state: PipelineState;

  constructor(input: PipelineControllerInput) {
    this.state = {
      requestClass: input.requestClass,
      classificationReason: input.classificationReason,
      executionPlan: buildExecutionPlan(input.requestClass),
      completedStages: ["classifyRequest"],
      skippedStages: [],
      costBudgetUsd: budgetForRequestClass(input.requestClass),
      usageBudgetTokens: usageTokenBudgetForUsd(budgetForRequestClass(input.requestClass)),
      usageBudgetRemaining: usageTokenBudgetForUsd(budgetForRequestClass(input.requestClass)),
    };

    for (const stage of ALL_STAGES) {
      if (stageAllowedByPlan(stage, this.state.executionPlan)) continue;
      if (stage === "classifyRequest") continue;
      this.markStageSkipped(stage, `Skipped by ${input.requestClass} execution policy.`);
    }
  }

  getState() {
    return {
      ...this.state,
      executionPlan: [...this.state.executionPlan],
      completedStages: [...this.state.completedStages],
      skippedStages: [...this.state.skippedStages],
      usageBudgetTokens: this.state.usageBudgetTokens,
      usageBudgetRemaining: this.state.usageBudgetRemaining,
    };
  }

  shouldRun(stage: PipelineStageId) {
    return stageAllowedByPlan(stage, this.state.executionPlan);
  }

  markStageCompleted(stage: PipelineStageId) {
    this.state.skippedStages = this.state.skippedStages.filter((row) => row.step !== stage);
    if (!this.state.completedStages.includes(stage)) {
      this.state.completedStages.push(stage);
    }
  }

  markStageSkipped(stage: PipelineStageId, reason: string) {
    this.state.completedStages = this.state.completedStages.filter((item) => item !== stage);
    const existing = this.state.skippedStages.find((row) => row.step === stage);
    if (existing) {
      existing.reason = reason;
      return;
    }
    this.state.skippedStages.push({ step: stage, reason });
  }

  consumeUsageTokens(tokens: number) {
    if (!Number.isFinite(tokens) || tokens <= 0) return this.state.usageBudgetRemaining;
    this.state.usageBudgetRemaining = Math.max(0, this.state.usageBudgetRemaining - Math.round(tokens));
    return this.state.usageBudgetRemaining;
  }

  applyCostGates(params: {
    allowSearch: boolean;
    allowRag: boolean;
    allowMultiAgent: boolean;
    spendingTier: SpendingTier;
    forceMultiAgentRequested: boolean;
    orchestratorEnabled: boolean;
    budgetSoftLimited: boolean;
  }) {
    const searchEnabled = params.allowSearch && this.shouldRun("webSearch");
    let ragEnabled = params.allowRag && this.shouldRun("ragRetrieval");
    let multiAgentEnabled = params.allowMultiAgent && this.shouldRun("multiAgent");

    if (!searchEnabled) {
      this.markStageSkipped("webSearch", "Search is disabled for this route.");
    }
    if (!ragEnabled) {
      this.markStageSkipped("ragRetrieval", "RAG is disabled for this route.");
    }
    if (!multiAgentEnabled) {
      this.markStageSkipped("multiAgent", "Multi-agent is disabled for this route.");
    }

    if (params.spendingTier === "free_only" && multiAgentEnabled) {
      multiAgentEnabled = false;
      this.markStageSkipped("multiAgent", "free_only tier disables multi-agent orchestration.");
    }
    if (params.spendingTier === "free_only" && ragEnabled) {
      ragEnabled = false;
      this.markStageSkipped("ragRetrieval", "free_only tier disables RAG retrieval to avoid embedding spend.");
    }

    const tierAllowsForcedMultiAgent = params.spendingTier !== "free_only";
    const forceDeniedReasons: string[] = [];
    if (params.forceMultiAgentRequested) {
      if (!tierAllowsForcedMultiAgent) forceDeniedReasons.push(`tier ${params.spendingTier} blocks forced multi-agent`);
      if (!params.orchestratorEnabled) forceDeniedReasons.push("org orchestrator_v2 feature is disabled");
    }

    const forceMultiAgentAllowed = params.forceMultiAgentRequested && forceDeniedReasons.length === 0;
    if (forceMultiAgentAllowed) {
      multiAgentEnabled = true;
      this.markStageCompleted("multiAgent");
    }
    if (params.forceMultiAgentRequested && !forceMultiAgentAllowed) {
      this.markStageSkipped("multiAgent", `forceMultiAgent denied: ${forceDeniedReasons.join("; ")}.`);
    }

    return {
      searchEnabled,
      ragEnabled,
      multiAgentEnabled,
      forceMultiAgentAllowed,
      forceDeniedReasons,
      executionPlan: dedupe(this.state.executionPlan),
      completedStages: dedupe(this.state.completedStages),
      skippedStages: [...this.state.skippedStages],
      costBudgetUsd: this.state.costBudgetUsd,
      usageBudgetTokens: this.state.usageBudgetTokens,
      usageBudgetRemaining: this.state.usageBudgetRemaining,
    };
  }
}
