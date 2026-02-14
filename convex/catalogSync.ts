import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { MODEL_DEFAULTS } from "./constants";
import { lookupCuratedModelMeta } from "./curatedModelRegistry";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const FEATURED: Record<string, number> = {
  "google/gemini-2.0-flash-exp:free": 1,
  "deepseek/deepseek-r1-0528:free": 2,
  "anthropic/claude-sonnet-4-5": 3,
  "google/gemini-2.5-pro": 4,
  "openai/gpt-4.1-mini": 5,
  "google/gemma-3-27b-vision:free": 6,
};

function rating(value: number, thresholds: [number, number]) {
  if (value <= thresholds[0]) return "low" as const;
  if (value <= thresholds[1]) return "medium" as const;
  return "high" as const;
}

function strengthText(model: {
  name: string;
  provider: string;
  description: string;
  contextLength?: number;
  tags: string[];
  isFree?: boolean;
  capabilities?: { reasoning: number; creative: number; code: number; vision: number; speed: number };
}) {
  const parts: string[] = [`${model.name} by ${model.provider}.`, model.description.slice(0, 200)];
  const caps = model.capabilities;
  if (caps) {
    if (caps.reasoning >= 7) parts.push("Strong reasoning, proofs, analysis, math, logic.");
    if (caps.code >= 7) parts.push("Programming, debugging, code generation, algorithms.");
    if (caps.vision >= 5) parts.push("Image understanding, diagrams, visual content, OCR.");
    if (caps.speed >= 8) parts.push("Very fast responses and tutoring.");
    if (caps.creative >= 7) parts.push("Creative writing and structured essays.");
  }
  if (model.isFree) parts.push("Free to use.");
  if (model.contextLength && model.contextLength > 100_000) parts.push("Very long context window.");
  if (model.tags.includes("reasoning")) parts.push("Deep thinking and step-by-step problem solving.");
  if (model.tags.includes("vision")) parts.push("Can see and understand images.");
  return parts.join(" ").slice(0, 600);
}

function chunkArray<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function openRouterFetch(path: string, apiKey: string, body?: unknown) {
  const response = await fetch(`${OPENROUTER_BASE_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`OpenRouter ${path} failed: ${await response.text()}`);
  }

  return response.json();
}

export const listOrgIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    return orgs.map((org) => org._id);
  },
});

export const refreshCatalog: ReturnType<typeof internalAction> = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY missing for catalog sync");
    }

    const limit = Math.min(Math.max(args.limit ?? 120, 10), 200);
    const modelsResponse = (await openRouterFetch("/models", apiKey)) as {
      data?: Array<{
        id: string;
        name?: string;
        description?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
        architecture?: { modality?: string };
        top_provider?: { name?: string };
      }>;
    };

    const mapped = (modelsResponse.data ?? []).slice(0, limit).map((model) => {
      const promptCost = parseFloat(model.pricing?.prompt ?? "");
      const completionCost = parseFloat(model.pricing?.completion ?? "");
      const inputCostPerM = Number.isFinite(promptCost) ? promptCost * 1_000_000 : undefined;
      const outputCostPerM = Number.isFinite(completionCost) ? completionCost * 1_000_000 : undefined;
      const avg = Number.isFinite((inputCostPerM ?? NaN) + (outputCostPerM ?? NaN))
        ? (inputCostPerM ?? 0) + (outputCostPerM ?? 0)
        : 10;

      const modality = model.architecture?.modality ?? "";
      const isVision = /image|multimodal/i.test(modality);
      const isFree = model.id.includes(":free") || (promptCost === 0 && completionCost === 0);
      const reasoningBoost = /(o3|o4|reason|deepseek|gpt-5|gemini-2\.5-pro)/i.test(model.id) ? 2 : 1;
      const fast = /(flash|mini|haiku|lite)/i.test(model.id);

      const item = {
        modelId: model.id,
        name: model.name || model.id,
        provider: model.top_provider?.name || model.id.split("/")[0] || "Unknown",
        description: model.description || "Model metadata from OpenRouter.",
        contextLength: model.context_length,
        inputCostPerM,
        outputCostPerM,
        tags: [
          isVision ? "vision" : "text",
          reasoningBoost > 1 ? "reasoning" : "general",
          ...(isFree ? ["free"] : []),
        ],
        costRating: rating(avg, [0.2, 3]),
        speedRating: fast ? "high" : "medium",
        reasoningRating: rating(reasoningBoost, [0.5, 1.5]),
        multimodalRating: isVision ? "strong" : "none",
        recommendedForPhysics: /(physics|math|science|reason|deepseek|gemini-2\.5-pro)/i.test(model.id),
        isFree,
        isFeatured: typeof FEATURED[model.id] === "number",
        featuredOrder: FEATURED[model.id],
        capabilities: {
          reasoning: reasoningBoost > 1 ? 8 : 4,
          creative: /(claude|gpt|gemini)/i.test(model.id) ? 7 : 5,
          code: /(code|coder|starcoder|deepseek)/i.test(model.id) ? 8 : 5,
          vision: isVision ? 7 : 0,
          speed: fast ? 9 : 5,
        },
      };
      const curated = lookupCuratedModelMeta(model.id);

      return {
        ...item,
        strengthText: strengthText(item),
        strengthEmbedding: undefined as number[] | undefined,
        releaseDate: curated?.releaseDate,
        knowledgeCutoff: curated?.knowledgeCutoff,
        curatedNotes: curated?.curatedNotes,
        benchmarkMMLU: curated?.benchmarkMMLU,
        benchmarkHumanEval: curated?.benchmarkHumanEval,
        arenaElo: curated?.arenaElo,
      };
    });

    for (const batch of chunkArray(mapped, 20)) {
      const embedded = await Promise.all(
        batch.map(async (model) => {
          if (!model.strengthText) return undefined;
          try {
            const response = (await openRouterFetch("/embeddings", apiKey, {
              model: MODEL_DEFAULTS.embedding,
              input: model.strengthText,
            })) as { data?: Array<{ embedding?: number[] }> };
            return response.data?.[0]?.embedding;
          } catch {
            return undefined;
          }
        }),
      );

      batch.forEach((model, index) => {
        model.strengthEmbedding = embedded[index];
      });
    }

    const orgIds = await ctx.runQuery(internal.catalogSync.listOrgIds, {});
    for (const orgId of orgIds) {
      await ctx.runMutation(internal.models.upsertModelCatalogForOrg, {
        orgId,
        models: mapped,
      });
    }

    return {
      ok: true,
      orgCount: orgIds.length,
      modelCount: mapped.length,
    };
  },
});
