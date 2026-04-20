export const CURATED_FEATURED: Array<{
  modelId: string;
  label: string;
  order: number;
}> = [
  { modelId: "z-ai/glm-4.5-air:free", label: "Fast Included", order: 1 },
  { modelId: "moonshotai/kimi-k2:free", label: "Deep Reasoning", order: 2 },
  { modelId: "minimax/minimax-m1", label: "Best Writing", order: 3 },
  { modelId: "moonshotai/kimi-k2", label: "Best Reasoning", order: 4 },
  { modelId: "z-ai/glm-4.5-air", label: "Smart & Cheap", order: 5 },
  { modelId: "qwen/qwen2.5-vl-72b-instruct:free", label: "Vision", order: 6 },
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
