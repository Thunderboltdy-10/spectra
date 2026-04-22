import type { AssignmentLevel, RoutePlan, RuntimeExecutionPath, ThreadStrategy } from "@/types";
import type { StudyMode } from "@/lib/contracts/studyModes";
import type { RuntimeSelectionSignals, RuntimeSurface } from "@/lib/orchestrator/runtime-contract";

export type RuntimePathInput = {
  activeSurface: RuntimeSurface;
  mode: StudyMode;
  message: string;
  explicitFocus: boolean;
  mutationIntent: boolean;
  targets: Array<"workspace" | "artifact" | "planner" | "widget" | "note" | "version">;
  hasAttachments: boolean;
  needsSearch: boolean;
  outputType: RuntimeSelectionSignals["outputType"];
  versionIntent: boolean;
  diffIntent: boolean;
  assignmentLevel: AssignmentLevel;
  threadStrategy?: ThreadStrategy;
};

function countTargets(input: RuntimePathInput) {
  return new Set(input.targets).size;
}

export function selectRuntimeExecutionPath(input: RuntimePathInput): {
  executionPath: RuntimeExecutionPath;
  reason: string;
  signals: RuntimeSelectionSignals;
} {
  const lower = input.message.toLowerCase();
  const targetCount = countTargets(input);
  const explicitWorkflow =
    /\b(step by step|iterate|workflow|first .* then|research and compare|investigate|audit)\b/.test(lower);
  const actionHeavy =
    input.mutationIntent
    || input.outputType === "workspace_mutation"
    || input.outputType === "artifact_mutation"
    || targetCount > 0;
  const deepResearch =
    input.needsSearch
    || input.outputType === "research"
    || input.mode === "research";
  const continuityBias =
    input.threadStrategy?.action === "defer_to_workspace_action"
    || input.threadStrategy?.action === "fork";

  let executionPath: RuntimeExecutionPath = "direct_chat";
  let reason = "Defaulted to direct chat because no deterministic action or research signals dominated.";

  if (deepResearch) {
    executionPath = "research_workflow";
    reason = "Selected research workflow due to search/research requirements.";
  } else if (
    actionHeavy
    && (
      explicitWorkflow
      || continuityBias
      || input.assignmentLevel === "L3"
      || input.assignmentLevel === "L4"
      || input.hasAttachments
      || targetCount >= 2
    )
  ) {
    executionPath = "action_loop";
    reason = "Selected action loop because the request targets mutable surfaces with multi-step or high-complexity signals.";
  } else if (actionHeavy || input.hasAttachments || input.versionIntent || input.diffIntent) {
    executionPath = "single_action";
    reason = "Selected single action because the request needs one bounded mutation or focused inspection.";
  }

  return {
    executionPath,
    reason,
    signals: {
      activeSurface: input.activeSurface,
      explicitFocus: input.explicitFocus,
      mutationIntent: input.mutationIntent,
      targetCount,
      hasAttachments: input.hasAttachments,
      needsSearch: input.needsSearch,
      outputType: input.outputType,
      versionIntent: input.versionIntent,
      diffIntent: input.diffIntent,
    },
  };
}

export function buildExecutionPathInputs(params: {
  routePlan: RoutePlan;
  mode: StudyMode;
  message: string;
  activeSurface: RuntimeSurface;
  artifactId?: string;
  workstreamId?: string;
}): RuntimePathInput {
  const lower = params.message.toLowerCase();
  const workspaceAction = params.routePlan.workspaceAction;
  const targets: RuntimePathInput["targets"] = [];
  if (params.workstreamId || params.routePlan.workstreamAssignment.status === "assigned") targets.push("workspace");
  if (params.artifactId || params.routePlan.requestedArtifactFormats.length > 0) targets.push("artifact");
  if (workspaceAction?.intent === "planner") targets.push("planner");
  if (workspaceAction?.intent === "widget") targets.push("widget");
  if (workspaceAction?.intent === "note") targets.push("note");
  if (/\b(version|restore|rollback|history)\b/.test(lower)) targets.push("version");

  const versionIntent = /\b(version|restore|rollback|history)\b/.test(lower);
  const diffIntent = /\b(diff|compare versions|changes since|what changed)\b/.test(lower);
  const explicitFocus =
    Boolean(params.artifactId || params.workstreamId)
    || /\b(this artifact|this workspace|this workstream|current thread|current note)\b/.test(lower);
  const mutationIntent =
    Boolean(workspaceAction)
    || /\b(create|make|build|generate|draft|save|update|edit|rewrite|rename|move|attach|restore)\b/.test(lower);
  const outputType: RuntimeSelectionSignals["outputType"] =
    params.routePlan.shouldUseWebSearch || params.mode === "research"
      ? "research"
      : versionIntent || diffIntent
        ? "version_diff"
        : params.activeSurface === "artifact" || params.routePlan.requestedArtifactFormats.length > 0
          ? mutationIntent ? "artifact_mutation" : "conversation"
          : params.activeSurface === "workspace" && mutationIntent
            ? "workspace_mutation"
            : "conversation";

  return {
    activeSurface: params.activeSurface,
    mode: params.mode,
    message: params.message,
    explicitFocus,
    mutationIntent,
    targets,
    hasAttachments: params.routePlan.hasAttachments,
    needsSearch: params.routePlan.shouldUseWebSearch,
    outputType,
    versionIntent,
    diffIntent,
    assignmentLevel: params.routePlan.assignmentLevel,
    threadStrategy: params.routePlan.threadStrategy,
  };
}
