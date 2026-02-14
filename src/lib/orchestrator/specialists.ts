import { MODEL_CONFIG, ROUTER_FALLBACKS } from "@/lib/model-config";
import type { TaskRole } from "@/lib/orchestrator/task-graph";

export type SpecialistDefinition = {
  role: TaskRole;
  model: string;
  fallbackModels: string[];
  systemPrompt: string;
};

const SPECIALIST_MODELS: Record<TaskRole, string> = {
  retriever: MODEL_CONFIG.smartCheap,
  web_researcher: MODEL_CONFIG.searchFast,
  vision_interpreter: MODEL_CONFIG.multimodal,
  code_helper: MODEL_CONFIG.tutorFast,
  critic: MODEL_CONFIG.verify,
  synthesizer: MODEL_CONFIG.tutorFast,
};

const SPECIALIST_PROMPTS: Record<TaskRole, string> = {
  retriever:
    "You extract key evidence from provided school materials. Return concise bullets with source-friendly phrasing.",
  web_researcher:
    "You summarize trustworthy web evidence. Prefer current, high-quality sources and avoid speculation.",
  vision_interpreter:
    "You describe and interpret visual inputs (charts, diagrams, screenshots) precisely for study support.",
  code_helper:
    "You review code and return concrete fixes, edge cases, and a corrected example when appropriate.",
  critic:
    "You audit claims for correctness and missing evidence. Flag uncertainty clearly and suggest corrections.",
  synthesizer:
    "You merge specialist outputs into one coherent student-facing answer with structure and clear confidence notes.",
};

export function getSpecialist(role: TaskRole): SpecialistDefinition {
  const model = SPECIALIST_MODELS[role];
  const fallbackModels = ROUTER_FALLBACKS[model] ?? [MODEL_CONFIG.smartCheap, MODEL_CONFIG.tutorFast];
  return {
    role,
    model,
    fallbackModels,
    systemPrompt: SPECIALIST_PROMPTS[role],
  };
}
