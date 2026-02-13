export const CURATED_FEATURED: Array<{
  modelId: string;
  label: string;
  order: number;
}> = [
  { modelId: "google/gemini-2.0-flash-exp:free", label: "Fast & Free", order: 1 },
  { modelId: "deepseek/deepseek-r1-0528:free", label: "Deep Reasoning", order: 2 },
  { modelId: "anthropic/claude-sonnet-4-5", label: "Best Writing", order: 3 },
  { modelId: "google/gemini-2.5-pro", label: "Best Reasoning", order: 4 },
  { modelId: "openai/gpt-4.1-mini", label: "Smart & Cheap", order: 5 },
  { modelId: "google/gemma-3-27b-vision:free", label: "Vision", order: 6 },
];

export function featuredMeta(modelId: string) {
  const match = CURATED_FEATURED.find((entry) => entry.modelId === modelId);
  if (!match) return undefined;
  return {
    isFeatured: true,
    featuredOrder: match.order,
    featuredLabel: match.label,
  };
}
