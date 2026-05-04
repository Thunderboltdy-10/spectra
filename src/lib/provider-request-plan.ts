import type { CatalogModelEntry } from "@/lib/model-selection";
import type { OpenRouterMessage, OpenRouterToolDefinition, OpenRouterReasoningEffort } from "@/lib/openrouter";

export type ProviderRequestCapabilityPlan = {
  modelId: string;
  supportedParameters: string[];
  inputModalities: string[];
  outputModalities: string[];
  omittedParameters: string[];
  warnings: string[];
  requireParameters: boolean;
  nativeTools: boolean;
  nativeStructuredOutput: boolean;
  nativeReasoning: boolean;
  nativeVision: boolean;
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function findModel(modelId: string, catalog?: CatalogModelEntry[]) {
  if (!catalog?.length) return undefined;
  const normalized = modelId.replace(/:free$/i, "");
  return catalog.find((model) =>
    model.modelId === modelId
    || model.modelId.replace(/:free$/i, "") === normalized,
  );
}

function supports(params: string[], ...keys: string[]) {
  const set = new Set(params.map(normalize));
  return keys.some((key) => set.has(normalize(key)));
}

function messageHasImage(messages: OpenRouterMessage[]) {
  return messages.some((message) =>
    Array.isArray(message.content)
    && message.content.some((part) => part.type === "image_url"),
  );
}

export function buildProviderRequestCapabilityPlan(params: {
  modelId: string;
  messages: OpenRouterMessage[];
  modelCatalog?: CatalogModelEntry[];
  tools?: OpenRouterToolDefinition[];
  toolChoice?: "auto" | "none";
  reasoningEffort?: OpenRouterReasoningEffort;
  structuredOutputRequested?: boolean;
}): ProviderRequestCapabilityPlan {
  const meta = findModel(params.modelId, params.modelCatalog);
  const supportedParameters = (meta?.supportedParameters ?? []).map(normalize);
  const inputModalities = (meta?.inputModalities ?? []).map(normalize);
  const outputModalities = (meta?.outputModalities ?? []).map(normalize);
  const unknown = !meta || supportedParameters.length === 0;
  const omittedParameters: string[] = [];
  const warnings: string[] = [];

  const nativeTools = unknown || supports(supportedParameters, "tools", "tool_choice");
  const nativeToolChoice = unknown || supports(supportedParameters, "tool_choice");
  const nativeReasoning = unknown || supports(supportedParameters, "reasoning", "reasoning_effort", "include_reasoning");
  const nativeStructuredOutput = unknown || supports(supportedParameters, "response_format", "structured_outputs", "json_schema");
  const nativeVision = inputModalities.length === 0 || inputModalities.includes("image");

  if ((params.tools?.length ?? 0) > 0 && !nativeTools) {
    omittedParameters.push("tools");
    warnings.push("Model metadata does not advertise native tool calling; tools must run through a helper/server path.");
  }
  if (params.toolChoice && !nativeToolChoice) {
    omittedParameters.push("tool_choice");
  }
  if (params.reasoningEffort && !nativeReasoning) {
    omittedParameters.push("reasoning");
  }
  if (params.structuredOutputRequested && !nativeStructuredOutput) {
    omittedParameters.push("response_format");
  }
  if (messageHasImage(params.messages) && !nativeVision) {
    omittedParameters.push("image_input");
    warnings.push("Model metadata is text-only; image evidence should be injected from a prepass.");
  }

  return {
    modelId: params.modelId,
    supportedParameters,
    inputModalities,
    outputModalities,
    omittedParameters,
    warnings,
    requireParameters: Boolean(meta && supportedParameters.length > 0),
    nativeTools,
    nativeStructuredOutput,
    nativeReasoning,
    nativeVision,
  };
}

export function filterOpenRouterRequestParams<T extends {
  tools?: OpenRouterToolDefinition[];
  toolChoice?: "auto" | "none";
  reasoningEffort?: OpenRouterReasoningEffort;
}>(params: T, plan: ProviderRequestCapabilityPlan): T {
  return {
    ...params,
    tools: plan.nativeTools ? params.tools : undefined,
    toolChoice: plan.nativeTools && !plan.omittedParameters.includes("tool_choice") ? params.toolChoice : undefined,
    reasoningEffort: plan.nativeReasoning ? params.reasoningEffort : undefined,
  };
}
