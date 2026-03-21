export type CuratedModelMeta = {
  releaseDate?: string;
  knowledgeCutoff?: string;
  curatedNotes?: string;
  benchmarkMMLU?: number;
  benchmarkHumanEval?: number;
  arenaElo?: number;
};

export const CURATED_MODEL_REGISTRY: Record<string, CuratedModelMeta> = {
  "openai/gpt-5.4-nano": {
    releaseDate: "2026-03",
    knowledgeCutoff: "2025-06",
    curatedNotes: "Very low-cost utility and tutoring route with strong instruction following.",
  },
  "openai/gpt-5.4-mini": {
    releaseDate: "2026-03",
    knowledgeCutoff: "2025-06",
    curatedNotes: "Balanced high-quality route for reasoning-heavy school tasks at moderate cost.",
  },
  "openai/gpt-4.1-mini": {
    releaseDate: "2025-04",
    knowledgeCutoff: "2024-06",
    curatedNotes: "Balanced cost/quality for general tutoring and coding support.",
    benchmarkMMLU: 82.4,
    benchmarkHumanEval: 88.1,
    arenaElo: 1220,
  },
  "openai/gpt-4o": {
    releaseDate: "2024-05",
    knowledgeCutoff: "2023-10",
    curatedNotes: "Strong multimodal baseline with fast response characteristics.",
    benchmarkMMLU: 86,
    benchmarkHumanEval: 90,
    arenaElo: 1265,
  },
  "anthropic/claude-sonnet-4-5": {
    releaseDate: "2025-09",
    knowledgeCutoff: "2025-03",
    curatedNotes: "High-quality long-form reasoning and writing coherence.",
    benchmarkMMLU: 87.2,
    benchmarkHumanEval: 91.5,
    arenaElo: 1290,
  },
  "anthropic/claude-sonnet-4.5": {
    releaseDate: "2025-09",
    knowledgeCutoff: "2025-03",
    curatedNotes: "High-quality long-form reasoning and writing coherence.",
    benchmarkMMLU: 87.2,
    benchmarkHumanEval: 91.5,
    arenaElo: 1290,
  },
  "stepfun/step-3.5-flash:free": {
    releaseDate: "2026-02",
    knowledgeCutoff: "2025-03",
    curatedNotes: "Fast free route for routine tutoring turns and short-form guidance.",
  },
  "openai/gpt-oss-120b:free": {
    releaseDate: "2026-02",
    knowledgeCutoff: "2025-03",
    curatedNotes: "Large open model with strong free-tier reasoning depth.",
  },
  "qwen/qwen3-next-80b-a3b-instruct:free": {
    releaseDate: "2026-01",
    knowledgeCutoff: "2025-02",
    curatedNotes: "Free reasoning-focused model suitable for grading and exam prep.",
  },
  "nvidia/nemotron-3-super-120b-a12b:free": {
    releaseDate: "2026-03",
    knowledgeCutoff: "2025-04",
    curatedNotes: "High-capacity free model optimized for robust instruction following.",
  },
  "anthropic/claude-opus-4.1:thinking": {
    releaseDate: "2025-09",
    knowledgeCutoff: "2025-03",
    curatedNotes: "Premium deep-reasoning variant suitable for difficult analysis.",
    benchmarkMMLU: 89,
    benchmarkHumanEval: 93,
    arenaElo: 1320,
  },
  "google/gemini-2.5-pro": {
    releaseDate: "2025-03",
    knowledgeCutoff: "2025-01",
    curatedNotes: "Strong across reasoning and multimodal tasks with large context.",
    benchmarkMMLU: 88.5,
    benchmarkHumanEval: 90.2,
    arenaElo: 1305,
  },
  "google/gemini-2.0-flash-exp:free": {
    releaseDate: "2024-12",
    knowledgeCutoff: "2024-06",
    curatedNotes: "Low-cost high-speed route for routine tutoring tasks.",
    benchmarkMMLU: 80.1,
    benchmarkHumanEval: 81.3,
    arenaElo: 1190,
  },
  "deepseek/deepseek-r1-0528:free": {
    releaseDate: "2025-05",
    knowledgeCutoff: "2024-12",
    curatedNotes: "Reasoning-focused open model with strong mathematical performance.",
    benchmarkMMLU: 85.5,
    benchmarkHumanEval: 87.7,
    arenaElo: 1255,
  },
  "deepseek/deepseek-v3": {
    releaseDate: "2024-12",
    knowledgeCutoff: "2024-08",
    curatedNotes: "Generalist open model with strong coding and analysis balance.",
    benchmarkMMLU: 83.9,
    benchmarkHumanEval: 86.8,
    arenaElo: 1235,
  },
  "meta-llama/llama-3.3-70b-instruct:free": {
    releaseDate: "2024-12",
    knowledgeCutoff: "2024-03",
    curatedNotes: "Reliable free model for structured instruction responses.",
    benchmarkMMLU: 79.6,
    benchmarkHumanEval: 79.2,
    arenaElo: 1160,
  },
  "mistralai/mistral-large": {
    releaseDate: "2025-02",
    knowledgeCutoff: "2024-09",
    curatedNotes: "Strong multilingual and coding performance at medium cost.",
    benchmarkMMLU: 82,
    benchmarkHumanEval: 84,
    arenaElo: 1215,
  },
  "qwen/qwen3-32b": {
    releaseDate: "2025-06",
    knowledgeCutoff: "2025-01",
    curatedNotes: "Efficient reasoning-focused open model with strong STEM utility.",
    benchmarkMMLU: 84.1,
    benchmarkHumanEval: 85.6,
    arenaElo: 1228,
  },
};

export function lookupCuratedModelMeta(modelId: string) {
  if (CURATED_MODEL_REGISTRY[modelId]) return CURATED_MODEL_REGISTRY[modelId];
  const key = Object.keys(CURATED_MODEL_REGISTRY).find((entry) => modelId.startsWith(entry));
  return key ? CURATED_MODEL_REGISTRY[key] : undefined;
}
