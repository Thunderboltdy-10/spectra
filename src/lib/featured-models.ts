export const CURATED_FEATURED: Array<{
  modelId: string;
  label: string;
  order: number;
}> = [
  { modelId: "stepfun/step-3.5-flash:free", label: "Fast Included", order: 1 },
  { modelId: "openai/gpt-oss-120b:free", label: "Deep Reasoning", order: 2 },
  { modelId: "anthropic/claude-sonnet-4.5", label: "Best Writing", order: 3 },
  { modelId: "openai/gpt-5.4-mini", label: "Best Reasoning", order: 4 },
  { modelId: "openai/gpt-5.4-nano", label: "Smart & Cheap", order: 5 },
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
