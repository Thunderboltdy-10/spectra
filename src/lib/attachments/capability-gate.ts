import { MODEL_CONFIG } from "@/lib/model-config";

const VISION_CAPABLE_PATTERNS = [
  /vision/i,
  /gemma.*27b/i,
  /gemini/i,
  /gpt-4/i,
  /gpt-4[\d.-]*o/i,
  /gpt-5/i,
  /claude-sonnet/i,
  /claude-opus/i,
  /pixtral/i,
  /llama-3\.2.*vision/i,
];

export function isVisionCapable(modelId: string): boolean {
  return VISION_CAPABLE_PATTERNS.some((pattern) => pattern.test(modelId));
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
}): CapabilityGateResult {
  if (!params.requiresVision) {
    return {
      finalModel: params.selectedModel,
      modelSwitched: false,
      requiresPrepass: false,
    };
  }

  if (isVisionCapable(params.selectedModel)) {
    return {
      finalModel: params.selectedModel,
      modelSwitched: false,
      requiresPrepass: false,
    };
  }

  const visionFallback = params.fallbackModels.find((model) => isVisionCapable(model));
  if (visionFallback) {
    return {
      finalModel: visionFallback,
      modelSwitched: true,
      requiresPrepass: false,
      userNotice: `Switched to vision-capable model ${visionFallback}.`,
    };
  }

  return {
    finalModel: params.selectedModel,
    modelSwitched: false,
    requiresPrepass: true,
    prepassModel: MODEL_CONFIG.multimodal,
    userNotice: "Primary model is text-only; using a vision prepass.",
  };
}
