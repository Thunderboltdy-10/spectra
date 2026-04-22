import { modelSupportsCapability, pickModelAndFallbacks, type CatalogModelEntry } from "@/lib/model-selection";
import { getCatalogBackedEmergencyModel } from "@/lib/model-config";
import { canUseInTier } from "@/lib/routing/heuristic";
import { supportsDocumentReasoningModel } from "@/lib/runtime/model-guardrails";

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

function isDocumentReasoningCapable(modelId: string, modelCatalog: CatalogModelEntry[] = []) {
  const inCatalog = modelCatalog.find((model) => model.modelId === modelId);
  if (!inCatalog) return false;
  return supportsDocumentReasoningModel(inCatalog);
}

export type CapabilityGateResult = {
  finalModel: string;
  modelSwitched: boolean;
  requiresPrepass: boolean;
  prepassKind?: "vision" | "file_understanding";
  prepassModel?: string;
  userNotice?: string;
};

export function gateCapabilities(params: {
  selectedModel: string;
  requiresVision: boolean;
  requiresFileUnderstanding?: boolean;
  requiresDocumentReasoning?: boolean;
  fallbackModels: string[];
  modelCatalog?: CatalogModelEntry[];
  spendingTier?: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
}): CapabilityGateResult {
  const modelCatalog = params.modelCatalog ?? [];
  const selectedMeta = modelCatalog.find((model) => model.modelId === params.selectedModel);
  const needsDocumentReasoning = Boolean(params.requiresDocumentReasoning || params.requiresFileUnderstanding);
  const tier = params.spendingTier ?? "normal";

  if (!params.requiresVision && !needsDocumentReasoning) {
    return {
      finalModel: params.selectedModel,
      modelSwitched: false,
      requiresPrepass: false,
    };
  }

  const hasVision = selectedMeta ? modelSupportsCapability(selectedMeta, "vision") : isVisionCapable(params.selectedModel, modelCatalog);
  const hasDocumentReasoning = selectedMeta ? supportsDocumentReasoningModel(selectedMeta) : false;
  const hasFileUnderstanding = hasDocumentReasoning;
  const missingVision = Boolean(params.requiresVision && !hasVision);
  const missingDocumentReasoning = Boolean(needsDocumentReasoning && (!hasDocumentReasoning || !hasFileUnderstanding));

  if (!missingVision && !missingDocumentReasoning) {
    return {
      finalModel: params.selectedModel,
      modelSwitched: false,
      requiresPrepass: false,
    };
  }

  const fullCapabilityFallback = params.fallbackModels.find((modelId) => {
    if (!modelId || modelId === params.selectedModel) return false;
    if (missingVision && !isVisionCapable(modelId, modelCatalog)) return false;
    if (missingDocumentReasoning && !isDocumentReasoningCapable(modelId, modelCatalog)) return false;
    return true;
  });
  if (fullCapabilityFallback) {
    return {
      finalModel: fullCapabilityFallback,
      modelSwitched: true,
      requiresPrepass: false,
      userNotice: `Switched to capability-compatible model ${fullCapabilityFallback}.`,
    };
  }

  const visionFallback = missingVision
    ? params.fallbackModels.find((modelId) => modelId && modelId !== params.selectedModel && isVisionCapable(modelId, modelCatalog))
    : undefined;
  if (visionFallback && !missingDocumentReasoning) {
    return {
      finalModel: visionFallback,
      modelSwitched: true,
      requiresPrepass: false,
      userNotice: `Switched to vision-capable model ${visionFallback}.`,
    };
  }

  const documentFallback = missingDocumentReasoning
    ? params.fallbackModels.find((modelId) => modelId && modelId !== params.selectedModel && isDocumentReasoningCapable(modelId, modelCatalog))
    : undefined;
  if (documentFallback && (!missingVision || isVisionCapable(documentFallback, modelCatalog))) {
    return {
      finalModel: documentFallback,
      modelSwitched: true,
      requiresPrepass: false,
      userNotice: `Switched to document-capable model ${documentFallback}.`,
    };
  }

  const catalogVision = missingVision ? pickModelAndFallbacks({
    catalog: modelCatalog.filter((model) => model.modelId !== "openrouter/auto"),
    tier,
    requiredCapabilities: ["vision"],
    preferredModelIds: [params.selectedModel],
    maxFallbacks: 2,
  }).selected?.modelId : undefined;
  const documentCatalog = modelCatalog.filter((model) =>
    model.modelId
    && model.modelId !== "openrouter/auto"
    && supportsDocumentReasoningModel(model)
    && canUseInTier(model.modelId, tier, modelCatalog),
  );
  const catalogDocument = missingDocumentReasoning
    ? (
      pickModelAndFallbacks({
        catalog: documentCatalog,
        tier,
        requiredCapabilities: ["reasoning"],
        preferredModelIds: [params.selectedModel],
        maxFallbacks: 2,
      }).selected?.modelId
      ?? documentCatalog[0]?.modelId
    )
    : undefined;

  if (catalogVision || catalogDocument) {
    const prepassModel = missingVision ? catalogVision : catalogDocument;
    return {
      finalModel: params.selectedModel,
      modelSwitched: false,
      requiresPrepass: true,
      prepassKind: missingVision ? "vision" : "file_understanding",
      prepassModel,
      userNotice: missingVision
        ? "Primary model is text-only; running a vision prepass."
        : "Primary model is weak for file understanding; running a document prepass.",
    };
  }

  // Last resort: only select a prepass model that is explicitly vision-capable.
  // Never fall back to the selected text-only model for image prepass.
  const lastResortPrepass = missingVision
    ? params.fallbackModels.find((modelId) => isVisionCapable(modelId, modelCatalog))
    : documentFallback;
  if (lastResortPrepass) {
    return {
      finalModel: params.selectedModel,
      modelSwitched: false,
      requiresPrepass: true,
      prepassKind: missingVision ? "vision" : "file_understanding",
      prepassModel: lastResortPrepass,
      userNotice: missingVision
        ? "No vision-capable model found in current tier; image analysis may be limited."
        : "No strong document model found in current tier; running a lightweight document prepass.",
    };
  }

  const emergencyFallbackModel = getCatalogBackedEmergencyModel({
    catalog: modelCatalog,
    role: missingVision ? "vision" : "reasoning",
  });
  const defaultPrepassModel = canUseInTier(
    emergencyFallbackModel,
    tier,
    modelCatalog,
  )
    ? emergencyFallbackModel
    : undefined;
  if (defaultPrepassModel) {
    return {
      finalModel: params.selectedModel,
      modelSwitched: false,
      requiresPrepass: true,
      prepassKind: missingVision ? "vision" : "file_understanding",
      prepassModel: defaultPrepassModel,
      userNotice: missingVision
        ? "Primary model is text-only; running a vision prepass."
        : "Primary model is weak for file understanding; running a document prepass.",
    };
  }

  return {
    finalModel: params.selectedModel,
    modelSwitched: false,
    requiresPrepass: false,
    userNotice: missingVision
      ? "No vision-capable model is available in your current tier for image attachments."
      : "No document-capable model is available in your current tier for attachment reasoning.",
  };
}
