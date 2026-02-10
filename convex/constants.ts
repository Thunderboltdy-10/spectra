export const EMBEDDING_DIMENSIONS = 3072;
export const DEFAULT_ORG_SLUG = "demo-school";

export const LIMITS = {
  maxTeacherFilesPerPack: 30,
  maxStudentPersonalFiles: 10,
  maxCharsPerFile: 250_000,
  maxChunksPerFile: 240,
  retrievalTopK: 8,
  defaultTokenBudgetPerOrgDaily: 1_500_000,
};

export const MODEL_DEFAULTS = {
  tutorFast: "google/gemini-2.0-flash-exp:free",
  tutorHigh: "deepseek/deepseek-r1-0528:free",
  marker: "meta-llama/llama-3.3-70b-instruct:free",
  markerHard: "deepseek/deepseek-r1-0528:free",
  multimodal: "google/gemma-3-27b-vision:free",
  verify: "google/gemini-2.0-flash-exp:free",
  openrouterAuto: "openrouter/auto",
  embedding: "openai/text-embedding-3-large",
  promptEnhance: "google/gemini-2.0-flash-exp:free",
  glmAir: "z-ai/glm-4.5-air:free",
  gptOss: "openai/gpt-oss-120b:free",
};
