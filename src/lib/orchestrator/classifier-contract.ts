import { THINKING_LEVELS, type ThinkingLevel } from "@/lib/contracts/studyModes";
import { listRegisteredSkills } from "@/lib/skills/skill-registry";
import type { StudyMode } from "@/types";

export const CLASSIFIER_TIERS = ["T0", "T1", "T2", "T3"] as const;
export type ClassifierTier = (typeof CLASSIFIER_TIERS)[number];

export const CLASSIFIER_OUTPUT_FORMATS = [
  "conversational",
  "strict_quiz",
  "strict_flashcards",
  "claims_evidence_reliability",
  "artifact_ready",
  "explanation_with_visual",
  "visual_artifact",
] as const;
export type ClassifierOutputFormat = (typeof CLASSIFIER_OUTPUT_FORMATS)[number];

export type ClassifierWorkspaceTarget =
  | { kind: "current"; workspaceId?: string }
  | { kind: "specific"; workspaceId: string }
  | { kind: "none"; workspaceId?: undefined };

export type ClassifierInput = {
  message: string;
  mode: StudyMode;
  scope: {
    level: "global" | "workspace" | "artifact" | "chat";
    workspaceId?: string;
    workspaceTitle?: string;
    agentId?: string;
    itemIds: string[];
  };
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: string;
    mode?: string;
  }>;
  availableSkills: string[];
  availableAgents: Array<{
    id: string;
    name: string;
    category?: string;
    description?: string;
  }>;
  userPreferences: {
    thinkingLevel: ThinkingLevel;
    routerMode: "auto" | "manual" | "openrouter_auto";
    memoryEnabled: boolean;
    usePersonalResources: boolean;
  };
};

export type ClassifierDecision = {
  tier: ClassifierTier;
  skills: string[];
  workspaceTarget: ClassifierWorkspaceTarget;
  workspaceIntent?: "note" | "planner" | "thread" | "result" | "widget";
  agentId: string | null;
  needsSearch: boolean;
  needsMemory: boolean;
  needsRag: boolean;
  outputFormat: ClassifierOutputFormat;
  thinkingLevel: ThinkingLevel;
  confidence: number;
};

export type ClassifierDecisionSource = {
  tier?: string;
  skills?: unknown;
  workspaceTarget?: unknown;
  workspaceIntent?: unknown;
  agentId?: unknown;
  needsSearch?: unknown;
  needsMemory?: unknown;
  needsRag?: unknown;
  outputFormat?: string;
  thinkingLevel?: string;
  confidence?: unknown;
};

export function buildClassifierInput(params: {
  message: string;
  mode: StudyMode;
  activeWorkstreamId?: string;
  activeWorkstreamTitle?: string;
  scopeLevel?: "global" | "workspace" | "artifact" | "chat";
  selectedAgentId?: string;
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: string;
    mode?: string;
  }>;
  userThinkingLevel: ThinkingLevel;
  routerMode: "auto" | "manual" | "openrouter_auto";
  memoryEnabled: boolean;
  usePersonalResources: boolean;
  availableAgents: Array<{
    _id: string;
    name: string;
    category: string;
    description: string;
  }>;
  activeArtifactId?: string;
  activeArtifactTitle?: string;
}) {
  const skillIds = listRegisteredSkills().map((skill) => skill.id);
  const scopeLevel =
    params.scopeLevel
    ?? (params.activeArtifactId ? "artifact" : params.activeWorkstreamId ? "workspace" : "global");
  const itemIds = params.activeArtifactId ? [params.activeArtifactId] : [];
  const workspaceTitle =
    scopeLevel === "artifact" && params.activeArtifactTitle
      ? params.activeArtifactTitle
      : params.activeWorkstreamTitle;
  return {
    message: params.message.trim(),
    mode: params.mode,
    scope: {
      level: scopeLevel,
      workspaceId: params.activeWorkstreamId,
      workspaceTitle,
      agentId: params.selectedAgentId,
      itemIds,
    },
    conversationHistory: params.conversationHistory,
    availableSkills: skillIds,
    availableAgents: params.availableAgents.map((agent) => ({
      id: agent._id,
      name: agent.name,
      category: agent.category,
      description: agent.description,
    })),
    userPreferences: {
      thinkingLevel: params.userThinkingLevel,
      routerMode: params.routerMode,
      memoryEnabled: params.memoryEnabled,
      usePersonalResources: params.usePersonalResources,
    },
  } satisfies ClassifierInput;
}

export function validateClassifierInput(input: ClassifierInput) {
  return Boolean(
    input.message.trim()
    && input.scope
    && Array.isArray(input.scope.itemIds)
    && Array.isArray(input.conversationHistory)
    && Array.isArray(input.availableSkills)
    && Array.isArray(input.availableAgents)
    && input.userPreferences
    && THINKING_LEVELS.includes(input.userPreferences.thinkingLevel),
  );
}

export function validateClassifierDecision(
  source: ClassifierDecisionSource,
  availableSkillIds: string[],
): { ok: true; value: ClassifierDecision } | { ok: false; error: string } {
  const tier = source.tier;
  if (!tier || !CLASSIFIER_TIERS.includes(tier as ClassifierTier)) {
    return { ok: false, error: "Classifier tier is invalid." };
  }
  if (!Array.isArray(source.skills) || source.skills.some((skill) => typeof skill !== "string" || !availableSkillIds.includes(skill))) {
    return { ok: false, error: "Classifier skills must be registered skill IDs." };
  }
  if (typeof source.confidence !== "number" || Number.isNaN(source.confidence) || source.confidence < 0 || source.confidence > 1) {
    return { ok: false, error: "Classifier confidence must be within [0, 1]." };
  }
  if (!source.thinkingLevel || !THINKING_LEVELS.includes(source.thinkingLevel as ThinkingLevel)) {
    return { ok: false, error: "Classifier thinkingLevel is invalid." };
  }
  if (
    !source.outputFormat
    || !CLASSIFIER_OUTPUT_FORMATS.includes(source.outputFormat as ClassifierOutputFormat)
  ) {
    return { ok: false, error: "Classifier outputFormat is invalid." };
  }
  if (
    source.workspaceIntent !== undefined
    && source.workspaceIntent !== "note"
    && source.workspaceIntent !== "planner"
    && source.workspaceIntent !== "thread"
    && source.workspaceIntent !== "result"
    && source.workspaceIntent !== "widget"
  ) {
    return { ok: false, error: "Classifier workspaceIntent is invalid." };
  }
  if (typeof source.needsSearch !== "boolean" || typeof source.needsMemory !== "boolean" || typeof source.needsRag !== "boolean") {
    return { ok: false, error: "Classifier needs flags must be booleans." };
  }
  const workspaceTarget = source.workspaceTarget;
  if (!workspaceTarget || typeof workspaceTarget !== "object" || !("kind" in workspaceTarget)) {
    return { ok: false, error: "Classifier workspaceTarget is required." };
  }
  const workspaceTargetRecord = workspaceTarget as { kind: string; workspaceId?: unknown };
  if (workspaceTargetRecord.kind === "specific" && typeof workspaceTargetRecord.workspaceId !== "string") {
    return { ok: false, error: "Specific workspace target requires workspaceId." };
  }
  if (workspaceTargetRecord.kind !== "specific" && workspaceTargetRecord.kind !== "current" && workspaceTargetRecord.kind !== "none") {
    return { ok: false, error: "Classifier workspaceTarget kind is invalid." };
  }
  if (!(typeof source.agentId === "string" || source.agentId === null)) {
    return { ok: false, error: "Classifier agentId must be a string or null." };
  }
  return {
    ok: true,
    value: {
      tier: tier as ClassifierTier,
      skills: source.skills as string[],
      workspaceTarget: workspaceTarget as ClassifierWorkspaceTarget,
      workspaceIntent: source.workspaceIntent as ClassifierDecision["workspaceIntent"],
      agentId: source.agentId,
      needsSearch: source.needsSearch,
      needsMemory: source.needsMemory,
      needsRag: source.needsRag,
      outputFormat: source.outputFormat as ClassifierOutputFormat,
      thinkingLevel: source.thinkingLevel as ThinkingLevel,
      confidence: source.confidence,
    },
  };
}
