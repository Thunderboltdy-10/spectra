import type { CatalogModelEntry, ModelCapability } from "@/lib/model-selection";

export type ModelRole =
  | "utilityFree"
  | "tutorFast"
  | "tutorHigh"
  | "reasoningFree"
  | "reasoningPaid"
  | "codeFree"
  | "searchFast"
  | "embedding"
  | "imageGen";

export type RoleCriteria = {
  requiredCapabilities?: ModelCapability[];
  preferredCapabilities?: ModelCapability[];
  preferFree?: boolean;
  preferPaid?: boolean;
  preferFast?: boolean;
  preferCheap?: boolean;
  minUptimePercent?: number;
};

export const MODEL_ROLE_CRITERIA: Record<ModelRole, RoleCriteria> = {
  utilityFree: {
    preferFree: true,
    preferFast: true,
    preferCheap: true,
    minUptimePercent: 90,
  },
  tutorFast: {
    preferFree: true,
    preferFast: true,
    preferCheap: true,
  },
  tutorHigh: {
    requiredCapabilities: ["reasoning"],
    preferredCapabilities: ["reasoning"],
    preferFast: false,
    preferCheap: false,
  },
  reasoningFree: {
    requiredCapabilities: ["reasoning"],
    preferFree: true,
    preferCheap: true,
  },
  reasoningPaid: {
    requiredCapabilities: ["reasoning"],
    preferPaid: true,
    preferCheap: true,
  },
  codeFree: {
    requiredCapabilities: ["code"],
    preferFree: true,
    preferCheap: true,
  },
  searchFast: {
    requiredCapabilities: ["search"],
    preferFast: true,
    preferCheap: true,
  },
  embedding: {
    preferPaid: true,
    preferCheap: true,
  },
  imageGen: {
    requiredCapabilities: ["image_generation"],
    preferFast: true,
  },
};

export const MODEL_FAMILY_PATTERNS: Array<{ family: string; test: RegExp }> = [
  { family: "deepseek", test: /^deepseek\//i },
  { family: "qwen", test: /^qwen\//i },
  { family: "gemma", test: /^google\/gemma-/i },
  { family: "openai", test: /^openai\//i },
  { family: "anthropic", test: /^anthropic\//i },
  { family: "minimax", test: /^minimax\//i },
  { family: "kimi", test: /^moonshotai\//i },
  { family: "glm", test: /^(z-ai|thudm)\//i },
  { family: "stepfun", test: /^stepfun\//i },
];

export function modelFamily(modelId: string) {
  const normalized = modelId.trim().toLowerCase();
  for (const candidate of MODEL_FAMILY_PATTERNS) {
    if (candidate.test.test(normalized)) return candidate.family;
  }
  return normalized.split("/")[0] || "unknown";
}

export function averageModelCost(model: CatalogModelEntry) {
  if (model.isFree || model.modelId.includes(":free")) return 0;
  const input = typeof model.inputCostPerM === "number" && Number.isFinite(model.inputCostPerM)
    ? Math.max(0, model.inputCostPerM)
    : 8;
  const output = typeof model.outputCostPerM === "number" && Number.isFinite(model.outputCostPerM)
    ? Math.max(0, model.outputCostPerM)
    : 10;
  return (input + output) / 2;
}

export function modelSupportsCapabilityLite(model: CatalogModelEntry, capability: ModelCapability) {
  const blob = `${model.modelId} ${model.name ?? ""} ${model.description ?? ""} ${(model.tags ?? []).join(" ")}`.toLowerCase();
  if (capability === "reasoning") {
    return Boolean((model.capabilities?.reasoning ?? 0) >= 6 || model.reasoningRating === "high" || /reason|logic|math/.test(blob));
  }
  if (capability === "code") {
    return Boolean((model.capabilities?.code ?? 0) >= 6 || /code|coder|program/.test(blob));
  }
  if (capability === "vision") {
    return Boolean(
      (model.capabilities?.vision ?? 0) >= 4
      || model.multimodalRating === "strong"
      || model.multimodalRating === "basic"
      || /vision|image|multimodal/.test(blob),
    );
  }
  if (capability === "search") {
    return Boolean((model.supportedParameters ?? []).some((item) => item.includes("search")) || /search|sonar|perplexity/.test(blob));
  }
  return /image_generation|text-to-image|diffusion|image model/.test(blob);
}

export function scoreModelForRole(model: CatalogModelEntry, criteria: RoleCriteria) {
  for (const required of criteria.requiredCapabilities ?? []) {
    if (!modelSupportsCapabilityLite(model, required)) return -Infinity;
  }

  const isFree = Boolean(model.isFree || model.modelId.includes(":free"));
  const avgCost = averageModelCost(model);
  const speed = typeof model.capabilities?.speed === "number"
    ? Math.max(0, Math.min(10, model.capabilities.speed)) / 10
    : model.speedRating === "high"
      ? 1
      : model.speedRating === "medium"
        ? 0.6
        : 0.25;
  const reasoning = typeof model.capabilities?.reasoning === "number"
    ? Math.max(0, Math.min(10, model.capabilities.reasoning)) / 10
    : model.reasoningRating === "high"
      ? 0.9
      : model.reasoningRating === "medium"
        ? 0.6
        : 0.25;
  const uptime = typeof model.endpointUptimePercent === "number"
    ? Math.max(0, Math.min(100, model.endpointUptimePercent)) / 100
    : 0.84;

  if (typeof criteria.minUptimePercent === "number" && uptime * 100 < criteria.minUptimePercent) {
    return -Infinity;
  }

  let score = 0.2;
  score += speed * 0.22;
  score += reasoning * 0.18;
  score += uptime * 0.15;
  score += avgCost <= 0.05 ? 0.2 : avgCost <= 2.5 ? 0.12 : avgCost <= 8 ? 0.06 : 0;

  if (criteria.preferFree && isFree) score += 0.2;
  if (criteria.preferPaid && !isFree) score += 0.12;
  if (criteria.preferFast) score += speed * 0.15;
  if (criteria.preferCheap) score += avgCost <= 2.5 ? 0.12 : avgCost <= 8 ? 0.05 : -0.08;

  for (const preferred of criteria.preferredCapabilities ?? []) {
    if (modelSupportsCapabilityLite(model, preferred)) score += 0.07;
  }

  if (model.promptCachingSupported) score += 0.03;
  return score;
}
