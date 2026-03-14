import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { fetchOpenRouterModels, openRouterEmbedding } from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";
import { featuredMeta } from "@/lib/featured-models";
import { MAX_MODEL_COST_PER_MILLION } from "@/lib/model-policy";

type MappedModel = {
  modelId: string;
  name: string;
  provider: string;
  description: string;
  contextLength?: number;
  inputCostPerM?: number;
  outputCostPerM?: number;
  tags: string[];
  costRating: "low" | "medium" | "high";
  speedRating: "low" | "medium" | "high";
  reasoningRating: "low" | "medium" | "high";
  multimodalRating: "none" | "basic" | "strong";
  recommendedForPhysics: boolean;
  isFree?: boolean;
  isFeatured?: boolean;
  featuredOrder?: number;
  capabilities?: {
    reasoning: number;
    creative: number;
    code: number;
    vision: number;
    speed: number;
  };
  strengthText?: string;
  strengthEmbedding?: number[];
};

function toRating(value: number, thresholds: [number, number]) {
  if (value <= thresholds[0]) return "low" as const;
  if (value <= thresholds[1]) return "medium" as const;
  return "high" as const;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function generateStrengthText(model: MappedModel): string {
  const parts: string[] = [];
  parts.push(`${model.name} by ${model.provider}.`);
  if (model.description) parts.push(model.description.slice(0, 200));

  const caps = model.capabilities;
  if (caps) {
    if (caps.reasoning >= 7) parts.push("Strong reasoning, proofs, analysis, math, logic.");
    if (caps.code >= 7) parts.push("Programming, debugging, code generation, algorithms.");
    if (caps.vision >= 5) parts.push("Image understanding, diagrams, visual content, OCR.");
    if (caps.speed >= 8) parts.push("Very fast responses, good for quick questions and tutoring.");
    if (caps.creative >= 7) parts.push("Creative writing, essays, stories, content generation.");
  }

  if (model.isFree) parts.push("Free to use.");
  if (model.contextLength && model.contextLength > 100_000) {
    parts.push("Very long context window for large documents.");
  }

  if (model.tags.includes("reasoning")) parts.push("Deep thinking and step-by-step problem solving.");
  if (model.tags.includes("vision")) parts.push("Can see and understand images.");

  return parts.join(" ").slice(0, 600);
}

function mapOpenRouterModels(limit: number, models: Awaited<ReturnType<typeof fetchOpenRouterModels>>): MappedModel[] {
  const mapped: MappedModel[] = [];
  for (const model of models) {
    const promptCost = parseFloat(model.pricing?.prompt ?? "");
    const completionCost = parseFloat(model.pricing?.completion ?? "");
    const promptPerM = Number.isFinite(promptCost) ? promptCost * 1_000_000 : undefined;
    const completionPerM = Number.isFinite(completionCost) ? completionCost * 1_000_000 : undefined;
    const isFree = model.id.includes(":free") || (promptCost === 0 && completionCost === 0);
    const hasKnownPricing =
      typeof promptPerM === "number" && Number.isFinite(promptPerM)
      && typeof completionPerM === "number" && Number.isFinite(completionPerM);
    if (!isFree) {
      if (!hasKnownPricing) continue;
      if (promptPerM! > MAX_MODEL_COST_PER_MILLION || completionPerM! > MAX_MODEL_COST_PER_MILLION) continue;
    }
    const avgCost = Number.isFinite((promptPerM ?? NaN) + (completionPerM ?? NaN))
      ? (promptPerM ?? 0) + (completionPerM ?? 0)
      : 10;

    const modality = model.architecture?.modality ?? "";
    const isMulti = modality.toLowerCase().includes("image") || modality.toLowerCase().includes("multimodal");
    const id = model.id;

    const reasoningBoost = /(o3|o4|reason|deepseek|claude-3\.7|gpt-5|gemini-2\.5-pro)/i.test(id) ? 2 : 1;
    const isFast = /(flash|mini|lite|haiku)/i.test(id);

    mapped.push({
      modelId: id,
      name: model.name || id,
      provider: model.top_provider?.name || id.split("/")[0] || "Unknown",
      description: model.description || "Model metadata from OpenRouter.",
      contextLength: model.context_length,
      inputCostPerM: promptPerM,
      outputCostPerM: completionPerM,
      tags: [
        isMulti ? "vision" : "text",
        /(o3|o4|reason|deepseek)/i.test(id) ? "reasoning" : "general",
        /(math|science|stem|academic|education|edu)/i.test(id) ? "academic" : "general-purpose",
      ],
      costRating: toRating(avgCost, [0.2, 3]),
      speedRating: isFast ? "high" : "medium",
      reasoningRating: toRating(reasoningBoost, [0.5, 1.5]),
      multimodalRating: isMulti ? "strong" : "none",
      recommendedForPhysics: /(o3|o4|physics|stem|reason|math|science|deepseek|gemini-2\.5-pro)/i.test(id),
      isFree,
      capabilities: {
        reasoning: reasoningBoost > 1 ? 8 : 4,
        creative: /(claude|gpt|gemini)/i.test(id) ? 7 : 5,
        code: /(code|coder|starcoder|codestral|deepseek)/i.test(id) ? 8 : 5,
        vision: isMulti ? 7 : 0,
        speed: isFast ? 9 : 5,
      },
      ...featuredMeta(id),
      strengthText: "",
    });
    mapped[mapped.length - 1]!.strengthText = generateStrengthText(mapped[mapped.length - 1]!);
    if (mapped.length >= limit) break;
  }
  return mapped;
}

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();

    await convexMutation("models:seedCatalogIfEmpty", { actorClerkId: actor.clerkId });

    const [models, featured, mostUsed, mostUsedByUser] = await Promise.all([
      convexQuery("models:listModels", { actorClerkId: actor.clerkId }),
      convexQuery("models:listFeaturedModels", { actorClerkId: actor.clerkId }),
      convexQuery("models:getMostUsedModels", { actorClerkId: actor.clerkId, limit: 8 }),
      convexQuery("models:getMostUsedModelsByUser", { actorClerkId: actor.clerkId, limit: 8 }),
    ]);
    return ok({ models, featured, mostUsed, mostUsedByUser, actorRole: actor.role });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") {
      return badRequest("Only admin can refresh models", 403);
    }

    const body = (await request.json().catch(() => ({}))) as { limit?: number };
    const limit = Math.min(Math.max(body.limit ?? 40, 5), 160);

    const openRouterModels = await fetchOpenRouterModels();
    const mapped = mapOpenRouterModels(limit, openRouterModels);

    for (const batch of chunkArray(mapped, 20)) {
      const embeddings = await Promise.all(
        batch.map(async (model) => {
          if (!model.strengthText) return undefined;
          try {
            return await openRouterEmbedding(model.strengthText, MODEL_CONFIG.embedding);
          } catch {
            return undefined;
          }
        }),
      );

      batch.forEach((model, index) => {
        model.strengthEmbedding = embeddings[index];
      });
    }

    await convexMutation("models:upsertModelCatalog", {
      actorClerkId: actor.clerkId,
      models: mapped,
    });

    return ok({ refreshed: mapped.length, provider: "openrouter" });
  });
}
