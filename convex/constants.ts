export const EMBEDDING_DIMENSIONS = 3072;
export const DEFAULT_ORG_SLUG = "demo-school";

export const LIMITS = {
  maxTeacherFilesPerPack: 30,
  maxStudentPersonalFiles: 25,
  maxCharsPerFile: 250_000,
  maxChunksPerFile: 240,
  retrievalTopK: 8,
  defaultTokenBudgetPerOrgDaily: 1_500_000,
};

export const MODEL_DEFAULTS = {
  tutorFast: "stepfun/step-3.5-flash:free",
  tutorHigh: "minimax/minimax-m2.5:free",
  marker: "qwen/qwen3-next-80b-a3b-instruct:free",
  markerHard: "nvidia/nemotron-3-super-120b-a12b:free",
  multimodal: "google/gemma-3-27b-vision:free",
  verify: "openai/gpt-5.4-mini",
  openrouterAuto: "openrouter/auto",
  embedding: "openai/text-embedding-3-large",
  promptEnhance: "stepfun/step-3.5-flash:free",
  glmAir: "z-ai/glm-4.5-air:free",
  gptOss: "openai/gpt-oss-120b:free",
};
