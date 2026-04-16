import { requireActor } from "@/lib/auth-server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { ok } from "@/lib/http";
import { fetchOpenRouterModels } from "@/lib/openrouter";
import { DEFAULT_MANUAL_MODEL_COST_CAP_PER_MILLION } from "@/lib/model-policy";

type LiveModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextLength?: number;
  pricing: {
    prompt?: number;
    completion?: number;
  };
  tags: string[];
  created?: string;
};

const CACHE_TTL_MS = 60 * 60 * 1000;

declare global {
  var __modelLiveCache:
    | {
        cachedAt: number;
        models: LiveModel[];
      }
    | undefined;
}

function parsePrice(value?: string) {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < 0) return undefined;
  return parsed * 1_000_000;
}

function mapTags(id: string, provider: string, modality?: string) {
  const tags = new Set<string>();
  if (/reason|r1|o3|o4|claude|gemini-2\.5/i.test(id)) tags.add("reasoning");
  if (/mini|flash|haiku|lite/i.test(id)) tags.add("fast");
  if (/vision|image|multimodal/i.test(modality ?? "")) tags.add("vision");
  tags.add(provider.toLowerCase());
  return [...tags];
}

function shouldExclude(modelId: string, modality: string, promptCost?: number, completionCost?: number) {
  const lower = modality.toLowerCase();
  const audioOnly = lower.includes("audio") && !lower.includes("text") && !lower.includes("image");
  const speechOnly = lower.includes("speech") && !lower.includes("text");
  if (audioOnly || speechOnly) return true;
  const freeLike = modelId.includes(":free") || ((promptCost ?? 0) === 0 && (completionCost ?? 0) === 0);
  if (!freeLike && (typeof promptCost !== "number" || typeof completionCost !== "number")) return true;
  if ((promptCost ?? 0) > DEFAULT_MANUAL_MODEL_COST_CAP_PER_MILLION) return true;
  if ((completionCost ?? 0) > DEFAULT_MANUAL_MODEL_COST_CAP_PER_MILLION) return true;
  return false;
}

export async function GET() {
  return withRouteErrorHandling(async () => {
    await requireActor();

    const now = Date.now();
    if (globalThis.__modelLiveCache && now - globalThis.__modelLiveCache.cachedAt < CACHE_TTL_MS) {
      return ok({
        models: globalThis.__modelLiveCache.models,
        cachedAt: new Date(globalThis.__modelLiveCache.cachedAt).toISOString(),
      });
    }

    const models = await fetchOpenRouterModels();

    const mapped: LiveModel[] = [];
    for (const model of models) {
      const prompt = parsePrice(model.pricing?.prompt);
      const completion = parsePrice(model.pricing?.completion);
      const modality = model.architecture?.modality ?? "text";

      if (shouldExclude(model.id, modality, prompt, completion)) continue;

      const provider = model.top_provider?.name || model.id.split("/")[0] || "Unknown";
      mapped.push({
        id: model.id,
        name: model.name || model.id,
        provider,
        description: model.description || "",
        contextLength: model.context_length,
        pricing: {
          prompt,
          completion,
        },
        tags: mapTags(model.id, provider, modality),
        created:
          typeof model.created === "number" && Number.isFinite(model.created)
            ? new Date(model.created * 1000).toISOString()
            : undefined,
      });
    }

    globalThis.__modelLiveCache = {
      cachedAt: now,
      models: mapped,
    };

    return ok({
      models: mapped,
      cachedAt: new Date(now).toISOString(),
    });
  });
}
