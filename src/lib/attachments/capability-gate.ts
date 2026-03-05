import { modelSupportsCapability, pickModelAndFallbacks, type CatalogModelEntry } from "@/lib/model-selection";

const LEGACY_VISION_PATTERNS = [
  /vision/i,
  /image/i,
  /multimodal/i,
  /visual/i,
];

export function isVisionCapable(modelId: string, modelCatalog: CatalogModelEntry[] = []): boolean {
  const inCatalog = modelCatalog.find((model) => model.modelId === modelId);
  if (inCatalog) {
    return modelSupportsCapability(inCatalog, "vision");
  }
  return LEGACY_VISION_PATTERNS.some((pattern) => pattern.test(modelId));
}

export type CapabilityGateResult = {
  finalModel: string;
  modelSwitched: boolean;
  requiresPrepass: boolean;
  prepassModel?: string;
  userNotice?: string;
};

export function gateCapabilities(params: {
  selectedModel: string;
  requiresVision: boolean;
  fallbackModels: string[];
  modelCatalog?: CatalogModelEntry[];
  spendingTier?: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
}): CapabilityGateResult {
  const modelCatalog = params.modelCatalog ?? [];

  if (!params.requiresVision) {
    return {
      finalModel: params.selectedModel,
      modelSwitched: false,
      requiresPrepass: false,
    };
  }

  if (isVisionCapable(params.selectedModel, modelCatalog)) {
    return {
      finalModel: params.selectedModel,
      modelSwitched: false,
      requiresPrepass: false,
    };
  }

  const visionFallback = params.fallbackModels.find((modelId) => isVisionCapable(modelId, modelCatalog));
  if (visionFallback) {
    return {
      finalModel: visionFallback,
      modelSwitched: true,
      requiresPrepass: false,
      userNotice: `Switched to vision-capable model ${visionFallback}.`,
    };
  }

  const catalogVision = pickModelAndFallbacks({
    catalog: modelCatalog.filter((model) => model.modelId !== "openrouter/auto"),
    tier: params.spendingTier ?? "normal",
    requiredCapabilities: ["vision"],
    preferredModelIds: [params.selectedModel],
    maxFallbacks: 2,
  }).selected?.modelId;

  if (catalogVision) {
    return {
      finalModel: params.selectedModel,
      modelSwitched: false,
      requiresPrepass: true,
      prepassModel: catalogVision,
      userNotice: "Primary model is text-only; running a vision prepass.",
    };
  }

  return {
    finalModel: params.selectedModel,
    modelSwitched: false,
    requiresPrepass: true,
    prepassModel: params.selectedModel,
    userNotice: "Primary model is text-only; running a vision prepass.",
  };
}
