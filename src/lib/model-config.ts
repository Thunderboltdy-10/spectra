export const MODEL_CONFIG = {
  tutorFast: "google/gemini-2.0-flash-exp:free",
  tutorHigh: "deepseek/deepseek-r1-0528:free",
  marker: "meta-llama/llama-3.3-70b-instruct:free",
  markerHard: "deepseek/deepseek-r1-0528:free",
  multimodal: "google/gemma-3-27b-vision:free",
  verify: "google/gemini-2.0-flash-exp:free",
  autoRouter: "openrouter/auto",
  embedding: "openai/text-embedding-3-large",
  promptEnhance: "google/gemini-2.0-flash-exp:free",
  glmAir: "z-ai/glm-4.5-air:free",
  gptOss: "openai/gpt-oss-120b:free",

  // Paid tier for normal spending.
  smartPaid: "anthropic/claude-sonnet-4-5",
  smartCheap: "openai/gpt-4.1-mini",
  reasoningPaid: "google/gemini-2.5-pro",

  // Search-focused routes.
  searchFast: "perplexity/sonar",
  searchDeep: "perplexity/sonar-pro",

  // Image generation.
  imageGen: "google/gemini-2.5-flash-image-preview",
} as const;

export const IMAGE_GEN_FALLBACKS = [
  "google/gemini-2.5-flash-image-preview",
  "openai/gpt-image-1",
  "black-forest-labs/flux-1-schnell",
] as const;

export type ModelConfigKey = keyof typeof MODEL_CONFIG;
export type ModelId = (typeof MODEL_CONFIG)[ModelConfigKey];

export const MODEL_COST_BLOCK_LIST = new Set<string>([
  "anthropic/claude-opus-4.1",
  "anthropic/claude-opus-4.1:thinking",
  "anthropic/claude-opus-4.6",
  "anthropic/claude-opus-4.6-fast",
  "google/gemini-2.5-pro-preview-06-05",
]);

export const ROUTER_FALLBACKS: Record<string, string[]> = {
  [MODEL_CONFIG.tutorFast]: [MODEL_CONFIG.marker, MODEL_CONFIG.gptOss],
  [MODEL_CONFIG.tutorHigh]: [MODEL_CONFIG.marker, MODEL_CONFIG.tutorFast],
  [MODEL_CONFIG.marker]: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.gptOss],
  [MODEL_CONFIG.multimodal]: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker],
  [MODEL_CONFIG.autoRouter]: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.tutorHigh,
    MODEL_CONFIG.gptOss,
    MODEL_CONFIG.marker,
    MODEL_CONFIG.smartCheap,
  ],
  [MODEL_CONFIG.glmAir]: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker],
  [MODEL_CONFIG.gptOss]: [MODEL_CONFIG.tutorHigh, MODEL_CONFIG.marker],

  [MODEL_CONFIG.smartPaid]: [MODEL_CONFIG.smartCheap, MODEL_CONFIG.tutorFast],
  [MODEL_CONFIG.smartCheap]: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker],
  [MODEL_CONFIG.reasoningPaid]: [MODEL_CONFIG.smartPaid, MODEL_CONFIG.tutorHigh],
  [MODEL_CONFIG.searchFast]: [MODEL_CONFIG.searchDeep, MODEL_CONFIG.tutorFast],
  [MODEL_CONFIG.searchDeep]: [MODEL_CONFIG.searchFast, MODEL_CONFIG.reasoningPaid],
};

export const CHEAP_MODEL_DEFAULTS = new Set<string>([
  MODEL_CONFIG.tutorFast,
  MODEL_CONFIG.marker,
  MODEL_CONFIG.glmAir,
  MODEL_CONFIG.smartCheap,
  MODEL_CONFIG.searchFast,
]);
