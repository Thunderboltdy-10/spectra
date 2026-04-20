export type CuratedModelMeta = {
  releaseDate?: string;
  knowledgeCutoff?: string;
  curatedNotes?: string;
  benchmarkMMLU?: number;
  benchmarkHumanEval?: number;
  arenaElo?: number;
};

export const CURATED_MODEL_REGISTRY: Record<string, CuratedModelMeta> = {
  "openai/gpt-5.4-nano": { curatedNotes: "Low-cost utility model." },
  "openai/gpt-5.4-mini": { curatedNotes: "Balanced reasoning model." },
  "openai/gpt-4.1-mini": {
    curatedNotes: "Balanced cost/quality for general tutoring and coding support.",
    benchmarkMMLU: 82.4,
    benchmarkHumanEval: 88.1,
    arenaElo: 1220,
  },
  "openai/gpt-4o": {
    curatedNotes: "Strong multimodal baseline with fast response characteristics.",
    benchmarkMMLU: 86,
    benchmarkHumanEval: 90,
    arenaElo: 1265,
  },
  "anthropic/claude-sonnet-4-5": {
    curatedNotes: "High-quality long-form reasoning and writing coherence.",
    benchmarkMMLU: 87.2,
    benchmarkHumanEval: 91.5,
    arenaElo: 1290,
  },
  "anthropic/claude-sonnet-4.5": {
    curatedNotes: "High-quality long-form reasoning and writing coherence.",
    benchmarkMMLU: 87.2,
    benchmarkHumanEval: 91.5,
    arenaElo: 1290,
  },
  "anthropic/claude-opus-4.1:thinking": {
    curatedNotes: "Premium deep-reasoning variant suitable for difficult analysis.",
    benchmarkMMLU: 89,
    benchmarkHumanEval: 93,
    arenaElo: 1320,
  },
  "google/gemini-2.5-pro": {
    curatedNotes: "Strong across reasoning and multimodal tasks with large context.",
    benchmarkMMLU: 88.5,
    benchmarkHumanEval: 90.2,
    arenaElo: 1305,
  },
  "google/gemini-2.0-flash-exp:free": {
    curatedNotes: "Low-cost high-speed route for routine tutoring tasks.",
    benchmarkMMLU: 80.1,
    benchmarkHumanEval: 81.3,
    arenaElo: 1190,
  },
  "deepseek/deepseek-r1-0528:free": {
    curatedNotes: "Reasoning-focused open model with strong mathematical performance.",
    benchmarkMMLU: 85.5,
    benchmarkHumanEval: 87.7,
    arenaElo: 1255,
  },
  "deepseek/deepseek-v3": {
    curatedNotes: "Generalist open model with strong coding and analysis balance.",
    benchmarkMMLU: 83.9,
    benchmarkHumanEval: 86.8,
    arenaElo: 1235,
  },
  "meta-llama/llama-3.3-70b-instruct:free": {
    curatedNotes: "Reliable free model for structured instruction responses.",
    benchmarkMMLU: 79.6,
    benchmarkHumanEval: 79.2,
    arenaElo: 1160,
  },
  "mistralai/mistral-large": {
    curatedNotes: "Strong multilingual and coding performance at medium cost.",
    benchmarkMMLU: 82,
    benchmarkHumanEval: 84,
    arenaElo: 1215,
  },
  "qwen/qwen3-32b": {
    curatedNotes: "Efficient reasoning-focused open model with strong STEM utility.",
    benchmarkMMLU: 84.1,
    benchmarkHumanEval: 85.6,
    arenaElo: 1228,
  },
  "minimax/minimax-m2.5:free": { curatedNotes: "Useful for budget-constrained analysis-heavy turns." },
  "moonshotai/kimi-k2": { curatedNotes: "Long-context multilingual model suited to synthesis and reading-heavy tasks." },
  "z-ai/glm-4.5-air:free": { curatedNotes: "Fast low-cost route for everyday tutoring and concise workflows." },
  "z-ai/glm-4.5": { curatedNotes: "Higher-capability GLM tier for premium reasoning and extended context tasks." },
  "mistralai/mistral-small": { curatedNotes: "Balanced multilingual model with strong cost/performance for everyday requests." },
};

export function lookupCuratedModelMeta(modelId: string) {
  if (CURATED_MODEL_REGISTRY[modelId]) return CURATED_MODEL_REGISTRY[modelId];
  const key = Object.keys(CURATED_MODEL_REGISTRY).find((entry) => modelId.startsWith(entry));
  return key ? CURATED_MODEL_REGISTRY[key] : undefined;
}
