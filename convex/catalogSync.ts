import { internalAction, internalQuery, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { MODEL_DEFAULTS } from "./constants";
import { lookupCuratedModelMeta } from "./curatedModelRegistry";
import { getArtificialAnalysisApiKey, getOpenRouterApiKey, warnOpenRouterMissing } from "./env";
import type { Id } from "./_generated/dataModel";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const ARTIFICIAL_ANALYSIS_BASE_URL = "https://artificialanalysis.ai/api/v2";
const ENDPOINT_SAMPLE_LIMIT = 60;
const ENDPOINT_FETCH_CONCURRENCY = 6;

type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  created?: number;
  pricing?: Record<string, string | number | undefined>;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  top_provider?: { name?: string };
  supported_parameters?: unknown;
};

type EndpointAggregate = {
  latencyP50Ms?: number;
  uptimePercent?: number;
};

type ArtificialAnalysisModel = {
  id?: string;
  name?: string;
  slug?: string;
  model_creator?: { name?: string; slug?: string };
  evaluations?: Record<string, number | undefined>;
  pricing?: {
    price_1m_blended_3_to_1?: number;
    price_1m_input_tokens?: number;
    price_1m_output_tokens?: number;
  };
  median_output_tokens_per_second?: number;
  median_time_to_first_token_seconds?: number;
  median_time_to_first_answer_token?: number;
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

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parsePricePerM(value: unknown) {
  const parsed = toFiniteNumber(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, parsed as number) * 1_000_000;
}

function normalizeParamName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseSupportedParameters(raw: unknown) {
  const names = new Set<string>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        const normalized = normalizeParamName(item);
        if (normalized) names.add(normalized);
        continue;
      }
      if (item && typeof item === "object") {
        const maybeName = normalizeParamName((item as { name?: string; key?: string }).name ?? (item as { key?: string }).key);
        if (maybeName) names.add(maybeName);
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === false || value === null || value === undefined) continue;
      const normalized = normalizeParamName(key);
      if (normalized) names.add(normalized);
    }
  }

  return Array.from(names.values()).sort();
}

function parseModalities(model: OpenRouterModel) {
  const arch = model.architecture ?? {};
  const input = new Set<string>();
  const output = new Set<string>();

  for (const value of arch.input_modalities ?? []) {
    const normalized = normalizeParamName(value);
    if (normalized) input.add(normalized);
  }
  for (const value of arch.output_modalities ?? []) {
    const normalized = normalizeParamName(value);
    if (normalized) output.add(normalized);
  }

  const modality = String(arch.modality ?? "").toLowerCase();
  if (modality) {
    const [left, right] = modality.split("->");
    for (const part of String(left ?? "").split(/[+,/]/)) {
      const normalized = normalizeParamName(part);
      if (normalized) input.add(normalized);
    }
    for (const part of String(right ?? modality).split(/[+,/]/)) {
      const normalized = normalizeParamName(part);
      if (normalized) output.add(normalized);
    }
  }

  return {
    inputModalities: Array.from(input.values()),
    outputModalities: Array.from(output.values()),
  };
}

function parseCachePricing(pricing: Record<string, string | number | undefined> | undefined) {
  const readPerM =
    parsePricePerM(pricing?.cache_read)
    ?? parsePricePerM(pricing?.prompt_cache_read)
    ?? parsePricePerM(pricing?.input_cache_read)
    ?? parsePricePerM(pricing?.cached_input);

  const writePerM =
    parsePricePerM(pricing?.cache_write)
    ?? parsePricePerM(pricing?.prompt_cache_write)
    ?? parsePricePerM(pricing?.input_cache_write)
    ?? parsePricePerM(pricing?.cache_creation_input);

  return {
    cachePricingReadPerM: readPerM,
    cachePricingWritePerM: writePerM,
  };
}

function hasPromptCachingSupport(params: {
  modelId: string;
  supportedParameters: string[];
  cachePricingReadPerM?: number;
  cachePricingWritePerM?: number;
}) {
  if (typeof params.cachePricingReadPerM === "number" || typeof params.cachePricingWritePerM === "number") {
    return true;
  }

  if (params.modelId.toLowerCase().startsWith("anthropic/")) return true;

  return params.supportedParameters.some((name) =>
    name.includes("cache")
    || name === "cache_control"
    || name === "prompt_cache"
    || name === "prompt_caching",
  );
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

async function artificialAnalysisFetch(path: string, apiKey: string) {
  const response = await fetch(`${ARTIFICIAL_ANALYSIS_BASE_URL}${path}`, {
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Artificial Analysis ${path} failed: ${await response.text()}`);
  }
  return response.json();
}

function normalizeModelSearchKey(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[:/_.]+/g, " ")
    .replace(/\b(instruct|chat|free|preview|latest|thinking)\b/g, " ")
    .replace(/\b\d{4}[- ]?\d{2}[- ]?\d{2}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildArtificialAnalysisIndex(rows: ArtificialAnalysisModel[]) {
  const index = new Map<string, ArtificialAnalysisModel>();
  for (const row of rows) {
    const creator = row.model_creator?.slug ?? row.model_creator?.name;
    for (const key of [
      normalizeModelSearchKey(row.slug),
      normalizeModelSearchKey(row.name),
      normalizeModelSearchKey(`${creator ?? ""} ${row.name ?? ""}`),
      normalizeModelSearchKey(`${creator ?? ""} ${row.slug ?? ""}`),
    ]) {
      if (key) index.set(key, row);
    }
  }
  return index;
}

function lookupArtificialAnalysisModel(index: Map<string, ArtificialAnalysisModel>, modelId: string, name?: string) {
  const provider = modelId.split("/")[0];
  const slug = modelId.split("/").slice(1).join(" ");
  const candidates = [
    normalizeModelSearchKey(`${provider} ${slug}`),
    normalizeModelSearchKey(slug),
    normalizeModelSearchKey(name),
  ].filter(Boolean);
  for (const key of candidates) {
    const exact = index.get(key);
    if (exact) return exact;
  }
  for (const [key, value] of index) {
    if (candidates.some((candidate) => candidate.length > 5 && (key.includes(candidate) || candidate.includes(key)))) {
      return value;
    }
  }
  return undefined;
}

function collectNumericByKey(root: unknown, keyMatcher: (key: string) => boolean, out: number[] = []) {
  if (Array.isArray(root)) {
    for (const item of root) collectNumericByKey(item, keyMatcher, out);
    return out;
  }

  if (!root || typeof root !== "object") return out;

  for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
    if (keyMatcher(key)) {
      const numeric = toFiniteNumber(value);
      if (typeof numeric === "number") out.push(numeric);
    }

    if (value && typeof value === "object") {
      collectNumericByKey(value, keyMatcher, out);
    }
  }

  return out;
}

function mean(values: number[]) {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseEndpointAggregate(payload: unknown): EndpointAggregate {
  const envelope = payload as { data?: unknown[]; endpoints?: unknown[] };
  const rows = Array.isArray(envelope?.data)
    ? envelope.data
    : Array.isArray(envelope?.endpoints)
      ? envelope.endpoints
      : Array.isArray(payload)
        ? payload
        : [payload];

  const latencyCandidates = collectNumericByKey(rows, (key) => {
    const normalized = key.toLowerCase();
    return (
      normalized === "latencyp50"
      || normalized === "latency_p50"
      || normalized === "latencyp50ms"
      || normalized === "latency_p50_ms"
      || (normalized.includes("latency") && normalized.includes("p50"))
    );
  });

  const uptimeCandidatesRaw = collectNumericByKey(rows, (key) => key.toLowerCase().includes("uptime"));
  const uptimeCandidates = uptimeCandidatesRaw
    .map((value) => (value <= 1 ? value * 100 : value))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 100);

  return {
    latencyP50Ms: mean(latencyCandidates),
    uptimePercent: mean(uptimeCandidates),
  };
}

function modelIdToEndpointPath(modelId: string) {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) return undefined;
  const author = modelId.slice(0, slash);
  const slug = modelId.slice(slash + 1);
  return `/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`;
}

async function fetchEndpointStatsForModels(params: {
  modelIds: string[];
  apiKey: string;
}) {
  const uniqueIds = Array.from(new Set(params.modelIds.filter(Boolean)));
  const statsByModelId = new Map<string, EndpointAggregate>();

  for (const batch of chunkArray(uniqueIds, ENDPOINT_FETCH_CONCURRENCY)) {
    const rows = await Promise.all(
      batch.map(async (modelId) => {
        const path = modelIdToEndpointPath(modelId);
        if (!path) return { modelId, stats: undefined as EndpointAggregate | undefined };
        try {
          const payload = await openRouterFetch(path, params.apiKey);
          return { modelId, stats: parseEndpointAggregate(payload) };
        } catch {
          return { modelId, stats: undefined as EndpointAggregate | undefined };
        }
      }),
    );

    for (const row of rows) {
      if (!row.stats) continue;
      statsByModelId.set(row.modelId, row.stats);
    }
  }

  return statsByModelId;
}

function mapOpenRouterModels(params: {
  models: OpenRouterModel[];
  limit: number;
  endpointStatsByModelId: Map<string, EndpointAggregate>;
  artificialAnalysisByKey?: Map<string, ArtificialAnalysisModel>;
}) {
  const mapped = params.models.slice(0, params.limit).map((model) => {
    const promptCost = toFiniteNumber(model.pricing?.prompt);
    const completionCost = toFiniteNumber(model.pricing?.completion);
    const inputCostPerM = Number.isFinite(promptCost) ? (promptCost as number) * 1_000_000 : undefined;
    const outputCostPerM = Number.isFinite(completionCost) ? (completionCost as number) * 1_000_000 : undefined;
    const avg = Number.isFinite((inputCostPerM ?? NaN) + (outputCostPerM ?? NaN))
      ? (inputCostPerM ?? 0) + (outputCostPerM ?? 0)
      : 10;

    const supportedParameters = parseSupportedParameters(model.supported_parameters);
    const { inputModalities, outputModalities } = parseModalities(model);
    const modalityBlob = `${inputModalities.join(" ")} ${outputModalities.join(" ")}`;
    const isVision = /image|vision|multimodal/.test(modalityBlob);
    const isFree = model.id.includes(":free") || (promptCost === 0 && completionCost === 0);
    const reasoningBoost = /(o3|o4|reason|deepseek|gpt-5|gemini-2\.5-pro)/i.test(model.id) ? 2 : 1;
    const fast = /(flash|mini|haiku|lite)/i.test(model.id);
    const supportsSearch =
      supportedParameters.some((name) => name.includes("search") || name === "web_search_options")
      || /(search|sonar|perplexity|web)/i.test(model.id);

    const { cachePricingReadPerM, cachePricingWritePerM } = parseCachePricing(model.pricing);
    const promptCachingSupported = hasPromptCachingSupport({
      modelId: model.id,
      supportedParameters,
      cachePricingReadPerM,
      cachePricingWritePerM,
    });

    const endpointStats = params.endpointStatsByModelId.get(model.id);

    const createdIso =
      typeof model.created === "number" && Number.isFinite(model.created)
        ? new Date(model.created * 1000).toISOString()
        : undefined;
    const artificial = lookupArtificialAnalysisModel(params.artificialAnalysisByKey ?? new Map(), model.id, model.name);
    const intelligenceIndex = artificial?.evaluations?.artificial_analysis_intelligence_index;
    const codingIndex = artificial?.evaluations?.artificial_analysis_coding_index;
    const mathIndex = artificial?.evaluations?.artificial_analysis_math_index;
    const inputCostPerMWithAA = artificial?.pricing?.price_1m_input_tokens ?? inputCostPerM;
    const outputCostPerMWithAA = artificial?.pricing?.price_1m_output_tokens ?? outputCostPerM;
    const speedWithAA = artificial?.median_output_tokens_per_second;
    const ttftWithAA = artificial?.median_time_to_first_answer_token ?? artificial?.median_time_to_first_token_seconds;

    const item = {
      modelId: model.id,
      name: model.name || model.id,
      provider: model.id.split("/")[0] || model.top_provider?.name || "Unknown",
      description: model.description || "Model metadata from OpenRouter.",
      contextLength: model.context_length,
      inputCostPerM: inputCostPerMWithAA,
      outputCostPerM: outputCostPerMWithAA,
      supportedParameters,
      promptCachingSupported,
      cachePricingReadPerM,
      cachePricingWritePerM,
      endpointLatencyP50Ms: ttftWithAA ? ttftWithAA * 1000 : endpointStats?.latencyP50Ms,
      endpointUptimePercent: endpointStats?.uptimePercent,
      inputModalities,
      outputModalities,
      tags: [
        isVision ? "vision" : "text",
        reasoningBoost > 1 ? "reasoning" : "general",
        ...(isFree ? ["free"] : []),
        ...(supportsSearch ? ["search"] : []),
      ],
      costRating: rating(avg, [0.2, 3]),
      speedRating: typeof speedWithAA === "number" ? (speedWithAA >= 90 ? "high" : speedWithAA >= 35 ? "medium" : "low") : fast ? "high" : "medium",
      reasoningRating: typeof intelligenceIndex === "number" ? rating(intelligenceIndex, [45, 60]) : rating(reasoningBoost, [0.5, 1.5]),
      multimodalRating: isVision ? "strong" : "none",
      recommendedForPhysics: /(physics|math|science|reason|deepseek|gemini-2\.5-pro)/i.test(model.id),
      isFree,
      isFeatured: false,
      featuredOrder: undefined,
      capabilities: {
        reasoning: typeof intelligenceIndex === "number" ? Math.max(4, Math.min(10, Math.round(intelligenceIndex / 10))) : reasoningBoost > 1 ? 8 : 4,
        creative: /(claude|gpt|gemini)/i.test(model.id) ? 7 : 5,
        code: typeof codingIndex === "number" ? Math.max(4, Math.min(10, Math.round(codingIndex / 10))) : /(code|coder|starcoder|deepseek)/i.test(model.id) ? 8 : 5,
        vision: isVision ? 7 : 0,
        speed: typeof speedWithAA === "number" ? Math.max(3, Math.min(10, Math.round(speedWithAA / 18))) : fast ? 9 : 5,
      },
    };
    const curated = lookupCuratedModelMeta(model.id);

    return {
      ...item,
      strengthText: strengthText(item),
      strengthEmbedding: undefined as number[] | undefined,
      releaseDate: createdIso ?? curated?.releaseDate,
      knowledgeCutoff: curated?.knowledgeCutoff,
      curatedNotes: curated?.curatedNotes,
      benchmarkMMLU: curated?.benchmarkMMLU,
      benchmarkHumanEval: curated?.benchmarkHumanEval,
      benchmarkArtificialAnalysisIntelligence: intelligenceIndex,
      benchmarkArtificialAnalysisCoding: codingIndex,
      benchmarkArtificialAnalysisMath: mathIndex,
      arenaElo: curated?.arenaElo,
    };
  });

  return mapped;
}

export const listOrgIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    return orgs.map((org) => org._id);
  },
});

export const listModelUsageCounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const usage = await ctx.db.query("usageEvents").collect();
    const counts = new Map<string, number>();
    for (const row of usage) {
      const key = row.model?.trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([modelId, count]) => ({ modelId, count }));
  },
});

async function refreshCatalogBase(params: {
  ctx: ActionCtx;
  limit?: number;
  includeEmbeddings: boolean;
}) {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    warnOpenRouterMissing("catalog_sync");
    return {
      ok: true,
      skipped: true,
      reason: "openrouter_api_key_missing",
      orgCount: 0,
      modelCount: 0,
      endpointStatsCount: 0,
    };
  }

  const limit = Math.min(Math.max(params.limit ?? 400, 50), 400);
  const modelsResponse = (await openRouterFetch("/models", apiKey)) as { data?: OpenRouterModel[] };
  const allModels = modelsResponse.data ?? [];
  const artificialApiKey = getArtificialAnalysisApiKey();
  let artificialAnalysisByKey: Map<string, ArtificialAnalysisModel> | undefined;
  if (artificialApiKey) {
    try {
      const payload = (await artificialAnalysisFetch("/data/llms/models", artificialApiKey)) as { data?: ArtificialAnalysisModel[] };
      artificialAnalysisByKey = buildArtificialAnalysisIndex(payload.data ?? []);
    } catch {
      artificialAnalysisByKey = undefined;
    }
  }

  const usageCounts = (await params.ctx.runQuery(internal.catalogSync.listModelUsageCounts, {})) as Array<{
    modelId: string;
    count: number;
  }>;
  const usageByModelId = new Map<string, number>(usageCounts.map((row) => [row.modelId, row.count]));
  const endpointTargetIds = [...allModels]
    .sort((a, b) => {
      const aUsage = usageByModelId.get(a.id) ?? 0;
      const bUsage = usageByModelId.get(b.id) ?? 0;
      if (aUsage !== bUsage) return bUsage - aUsage;
      const aCreated = a.created ?? 0;
      const bCreated = b.created ?? 0;
      if (aCreated !== bCreated) return bCreated - aCreated;
      return a.id.localeCompare(b.id);
    })
    .slice(0, ENDPOINT_SAMPLE_LIMIT)
    .map((model) => model.id);

  const endpointStatsByModelId = await fetchEndpointStatsForModels({
    modelIds: endpointTargetIds,
    apiKey,
  });

  const mapped = mapOpenRouterModels({
    models: allModels,
    limit,
    endpointStatsByModelId,
    artificialAnalysisByKey,
  });

  if (params.includeEmbeddings) {
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
  }

  const orgIds = (await params.ctx.runQuery(internal.catalogSync.listOrgIds, {})) as Id<"orgs">[];
  for (const orgId of orgIds) {
    await params.ctx.runMutation(internal.models.upsertModelCatalogForOrg, {
      orgId,
      models: mapped,
    });
  }

  return {
    ok: true,
    orgCount: orgIds.length,
    modelCount: mapped.length,
    endpointStatsCount: endpointStatsByModelId.size,
  };
}

export const refreshCatalog: ReturnType<typeof internalAction> = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => refreshCatalogBase({
    ctx,
    limit: args.limit,
    includeEmbeddings: true,
  }),
});

export const refreshCatalogRuntime: ReturnType<typeof internalAction> = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => refreshCatalogBase({
    ctx,
    limit: args.limit,
    includeEmbeddings: false,
  }),
});
