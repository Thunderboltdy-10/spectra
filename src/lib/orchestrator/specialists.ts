import type { CatalogModelEntry, ModelRuntimeStat } from "@/lib/model-selection";
import { selectModelForPhase } from "@/lib/routing/phase-router";
import type { SpendingTier } from "@/types";
import type { TaskRole } from "@/lib/orchestrator/task-graph";

export type SpecialistDefinition = {
  role: TaskRole;
  model: string;
  fallbackModels: string[];
  systemPrompt: string;
};

const SPECIALIST_PROMPTS: Record<TaskRole, string> = {
  workflow_planner:
    "You design a compact staged workflow before execution. Clarify dependencies, sequencing, and risk checks.",
  retriever:
    "You extract key evidence from provided school materials. Return concise bullets with source-friendly phrasing.",
  web_researcher:
    "You summarize trustworthy web evidence. Prefer current, high-quality sources and avoid speculation.",
  vision_interpreter:
    "You describe and interpret visual inputs (charts, diagrams, screenshots) precisely for study support.",
  code_helper:
    "You review code and return concrete fixes, edge cases, and a corrected example when appropriate.",
  curriculum_planner:
    "You translate goals into a concrete learning plan with milestones, sequence, and workload pacing.",
  fact_checker:
    "You verify claims, dates, and numbers against available evidence and clearly mark uncertainty.",
  pedagogy_coach:
    "You optimize explanations for the user's level, identify misconceptions, and suggest better teaching flow.",
  exam_strategist:
    "You focus on exam constraints: rubric alignment, mark allocation, and time-efficient answer structure.",
  critic:
    "You audit claims for correctness and missing evidence. Flag uncertainty clearly and suggest corrections.",
  synthesizer:
    "You merge specialist outputs into one coherent user-facing answer with structure and clear confidence notes.",
};

function roleRequirements(role: TaskRole) {
  if (role === "workflow_planner") return { required: ["reasoning"] as const, preferred: ["search"] as const };
  if (role === "vision_interpreter") return { required: ["vision"] as const, preferred: ["reasoning"] as const };
  if (role === "web_researcher") return { required: ["search"] as const, preferred: ["reasoning"] as const };
  if (role === "fact_checker" || role === "critic") return { required: ["reasoning"] as const, preferred: ["search"] as const };
  if (role === "code_helper") return { required: ["code"] as const, preferred: ["reasoning"] as const };
  if (role === "synthesizer") return { required: ["reasoning"] as const, preferred: ["code"] as const };
  if (role === "exam_strategist") return { required: ["reasoning"] as const, preferred: [] as const };
  return { required: [] as const, preferred: ["reasoning"] as const };
}

export function getSpecialist(
  role: TaskRole,
  options?: {
    defaultModel?: string;
    fallbackModels?: string[];
    roleModelOverrides?: Partial<Record<TaskRole, string>>;
    catalog?: CatalogModelEntry[];
    runtimeStats?: Record<string, ModelRuntimeStat>;
    spendingTier?: SpendingTier;
    avoidModels?: string[];
  },
): SpecialistDefinition {
  const roleOverride = options?.roleModelOverrides?.[role];
  const defaultModel = options?.defaultModel;
  const catalog = options?.catalog ?? [];
  const tier = options?.spendingTier ?? "normal";

  const explicitModel = roleOverride ?? defaultModel;
  const requirements = roleRequirements(role);

  const decision = catalog.length > 0
    ? selectModelForPhase({
        phaseId: `specialist_${role}`,
        phaseLabel: role.replace(/_/g, " "),
        mode: "research",
        routerMode: "auto",
        spendingTier: tier,
        thinkingLevel: role === "retriever" || role === "web_researcher" ? "low" : "medium",
        stakes: role === "critic" || role === "fact_checker" ? "high" : "medium",
        messageLength: 900,
        needsSearch: role === "web_researcher" || role === "fact_checker",
        requiredCapabilities: [...requirements.required],
        preferredCapabilities: [...requirements.preferred],
        preferredModelIds: explicitModel ? [explicitModel] : undefined,
        previousModelUsed: options?.avoidModels?.at(-1),
        recentModels: options?.avoidModels ?? [],
        requestClass: "T2",
        manualModelConfirmedExpensive: false,
        modelCatalog: catalog.filter((model) => model.modelId !== "openrouter/auto"),
        modelRuntimeStats: options?.runtimeStats,
        seedKey: `${role}:${options?.avoidModels?.join(",") ?? ""}`,
      })
    : undefined;

  const model = decision?.selectedModel ?? explicitModel ?? options?.fallbackModels?.[0] ?? "openrouter/auto";
  const fallbackModels = Array.from(
    new Set(
      [
        ...(decision?.fallbackModels ?? []),
        ...(options?.fallbackModels ?? []),
      ].filter((candidate) => candidate && candidate !== model),
    ),
  ).slice(0, 5);

  return {
    role,
    model,
    fallbackModels,
    systemPrompt: SPECIALIST_PROMPTS[role],
  };
}
