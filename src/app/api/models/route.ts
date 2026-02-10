import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { fetchOpenRouterModels } from "@/lib/openrouter";

function toRating(value: number, thresholds: [number, number]) {
  if (value <= thresholds[0]) return "low";
  if (value <= thresholds[1]) return "medium";
  return "high";
}

function mapOpenRouterModels(limit: number, models: Awaited<ReturnType<typeof fetchOpenRouterModels>>) {
  return models.slice(0, limit).map((model) => {
    const prompt = parseFloat(model.pricing?.prompt ?? "0");
    const completion = parseFloat(model.pricing?.completion ?? "0");
    const avgCost = Number.isFinite(prompt + completion) ? prompt + completion : 0.00001;
    const modality = model.architecture?.modality ?? "";
    const isMulti = modality.toLowerCase().includes("image") || modality.toLowerCase().includes("multimodal");
    const id = model.id;
    const isFree = (prompt === 0 && completion === 0) || id.includes(":free");

    const reasoningBoost = /(o3|o4|reason|deepseek|claude-3\.7|gpt-5)/i.test(id) ? 2 : 1;

    const isFast = /(flash|mini|lite|haiku)/i.test(id);
    const speedVal = isFast ? 9 : 5;
    const reasoningVal = reasoningBoost > 1 ? 8 : 4;
    const visionVal = isMulti ? 7 : 0;
    const creativeVal = /(claude|gpt|gemini)/i.test(id) ? 7 : 5;
    const codeVal = /(code|coder|starcoder|codestral|deepseek)/i.test(id) ? 8 : 5;

    return {
      modelId: id,
      name: model.name || id,
      provider: model.top_provider?.name || id.split("/")[0] || "Unknown",
      description: model.description || "Model metadata from OpenRouter.",
      contextLength: model.context_length,
      inputCostPerM: Number.isFinite(prompt) ? prompt : undefined,
      outputCostPerM: Number.isFinite(completion) ? completion : undefined,
      tags: [
        isMulti ? "vision" : "text",
        /(o3|o4|reason|deepseek)/i.test(id) ? "reasoning" : "general",
        /(math|science|stem|academic|education|edu)/i.test(id) ? "academic" : "general-purpose",
        ...(isFree ? ["free"] : []),
      ],
      costRating: toRating(avgCost, [0.000004, 0.00002]),
      speedRating: isFast ? "high" : "medium",
      reasoningRating: toRating(reasoningBoost, [0.5, 1.5]),
      multimodalRating: isMulti ? "strong" : "none",
      recommendedForPhysics: /(o3|o4|physics|stem|reason|math|science)/i.test(id),
      isFree,
      capabilities: {
        reasoning: reasoningVal,
        creative: creativeVal,
        code: codeVal,
        vision: visionVal,
        speed: speedVal,
      },
    };
  });
}

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();

    await convexMutation("models:seedCatalogIfEmpty", { actorClerkId: actor.clerkId });

    const models = await convexQuery("models:listModels", { actorClerkId: actor.clerkId });
    return ok({ models, actorRole: actor.role });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") {
      return badRequest("Only admin can refresh models", 403);
    }

    const body = (await request.json().catch(() => ({}))) as { limit?: number };
    const limit = Math.min(Math.max(body.limit ?? 40, 5), 120);

    const openRouterModels = await fetchOpenRouterModels();
    const mapped = mapOpenRouterModels(limit, openRouterModels);

    await convexMutation("models:upsertModelCatalog", {
      actorClerkId: actor.clerkId,
      models: mapped,
    });

    return ok({ refreshed: mapped.length, provider: "openrouter" });
  });
}
