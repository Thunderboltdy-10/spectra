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
  imageGen: "google/gemini-3-pro-image-preview",
} as const;

// Available image generation models
export const IMAGE_GEN_MODELS = [
  { id: "google/gemini-3-pro-image-preview", name: "Gemini 3 Pro Image", provider: "Google", recommended: true },
  { id: "google/gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", provider: "Google", recommended: false },
  { id: "openai/gpt-image-1", name: "GPT Image 1", provider: "OpenAI", recommended: false },
  { id: "recraft-ai/recraft-v3", name: "Recraft V3", provider: "Recraft", recommended: false },
] as const;

export const IMAGE_GEN_FALLBACKS = [
  "google/gemini-3-pro-image-preview",
  "google/gemini-2.5-flash-image",
  "openai/gpt-image-1",
] as const;

export function getImageModelOptions() {
  return IMAGE_GEN_MODELS.map(m => ({ ...m, isFree: m.id.includes(":free") }));
}

export function getDefaultImageModel(): string {
  return IMAGE_GEN_MODELS[0].id;
}

export type ModelConfigKey = keyof typeof MODEL_CONFIG;
export type ModelId = (typeof MODEL_CONFIG)[ModelConfigKey];

// Deprecated: static ban lists introduce opaque routing bias.
// Keep export for backward compatibility in tests/callers, but leave empty.
export const MODEL_COST_BLOCK_LIST = new Set<string>();

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

// Mode-based model recommendations (model IDs to suggest for each mode)
export const MODE_MODEL_RECOMMENDATIONS: Record<string, string[]> = {
  tutor: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.tutorHigh,
    MODEL_CONFIG.smartCheap,
  ],
  marker: [
    MODEL_CONFIG.marker,
    MODEL_CONFIG.markerHard,
    MODEL_CONFIG.tutorFast,
  ],
  quiz: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.marker,
    MODEL_CONFIG.smartCheap,
  ],
  flashcard: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.marker,
    MODEL_CONFIG.smartCheap,
  ],
  research: [
    MODEL_CONFIG.reasoningPaid,
    MODEL_CONFIG.tutorHigh,
    MODEL_CONFIG.searchDeep,
  ],
  explain: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.smartCheap,
    MODEL_CONFIG.tutorHigh,
  ],
  exam: [
    MODEL_CONFIG.smartCheap,
    MODEL_CONFIG.marker,
    MODEL_CONFIG.tutorFast,
  ],
  draft_coach: [
    MODEL_CONFIG.smartPaid,
    MODEL_CONFIG.smartCheap,
    MODEL_CONFIG.tutorFast,
  ],
  image: [
    "google/gemini-3-pro-image-preview",
    "google/gemini-2.5-flash-image",
    "openai/gpt-image-1",
  ],
  general: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.smartCheap,
    MODEL_CONFIG.marker,
  ],
  auto: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.tutorHigh,
    MODEL_CONFIG.smartCheap,
  ],
};

// Get recommended models for a specific mode
export function getRecommendedModelsForMode(mode: string): string[] {
  return MODE_MODEL_RECOMMENDATIONS[mode] || MODE_MODEL_RECOMMENDATIONS.general;
}
