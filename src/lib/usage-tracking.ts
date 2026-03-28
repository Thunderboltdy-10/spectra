import { convexMutation, convexQuery } from "@/lib/convex-server";

type UsagePricing = {
  inputCostPerM?: number;
  outputCostPerM?: number;
  cachePricingReadPerM?: number;
  cachePricingWritePerM?: number;
  isFree?: boolean;
};

type CompletionLike = {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    cached_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

function estimateCacheSavingsCents(params: {
  usage?: {
    cached_tokens?: number;
    cache_creation_input_tokens?: number;
  } | null;
  pricing?: UsagePricing;
}) {
  const cachedTokens = Math.max(0, Math.round(params.usage?.cached_tokens ?? 0));
  const cacheCreationTokens = Math.max(0, Math.round(params.usage?.cache_creation_input_tokens ?? 0));
  if (cachedTokens <= 0 && cacheCreationTokens <= 0) return undefined;

  const inputCostPerM =
    typeof params.pricing?.inputCostPerM === "number" && Number.isFinite(params.pricing.inputCostPerM)
      ? Math.max(0, params.pricing.inputCostPerM)
      : undefined;
  if (!inputCostPerM || inputCostPerM <= 0) return undefined;

  const cacheReadPerM =
    typeof params.pricing?.cachePricingReadPerM === "number" && Number.isFinite(params.pricing.cachePricingReadPerM)
      ? Math.max(0, params.pricing.cachePricingReadPerM)
      : inputCostPerM * 0.1;
  const cacheWritePerM =
    typeof params.pricing?.cachePricingWritePerM === "number" && Number.isFinite(params.pricing.cachePricingWritePerM)
      ? Math.max(0, params.pricing.cachePricingWritePerM)
      : inputCostPerM * 1.25;

  const readSavingsCents = ((cachedTokens / 1_000_000) * (inputCostPerM - cacheReadPerM)) * 100;
  const writePremiumCents = ((cacheCreationTokens / 1_000_000) * (cacheWritePerM - inputCostPerM)) * 100;
  const savings = Math.max(0, readSavingsCents - Math.max(0, writePremiumCents));
  if (savings <= 0) return undefined;
  return Number(savings.toFixed(6));
}

async function resolveUsagePricing(params: {
  actorClerkId: string;
  model: string;
  pricing?: UsagePricing;
}) {
  if (
    typeof params.pricing?.inputCostPerM === "number"
    || typeof params.pricing?.outputCostPerM === "number"
    || params.pricing?.isFree
  ) {
    return params.pricing;
  }

  return (await convexQuery("models:getModelPricing", {
    actorClerkId: params.actorClerkId,
    modelId: params.model,
  })) as UsagePricing;
}

export async function recordModelUsage(params: {
  actorClerkId?: string;
  chatId?: string;
  messageId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  openRouterCost?: number;
  cacheSavingsCents?: number;
  finishReason?: string;
  truncatedByLength?: boolean;
  pricing?: UsagePricing;
  skipIfZeroTokens?: boolean;
}) {
  const actorClerkId = params.actorClerkId?.trim();
  const model = params.model?.trim();
  const inputTokens = Math.max(0, Math.round(params.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.round(params.outputTokens ?? 0));
  const openRouterCost =
    typeof params.openRouterCost === "number" && Number.isFinite(params.openRouterCost)
      ? Math.max(0, params.openRouterCost)
      : undefined;
  const skipIfZeroTokens = params.skipIfZeroTokens ?? true;
  if (!actorClerkId || !model) return false;
  if (skipIfZeroTokens && inputTokens + outputTokens <= 0 && !openRouterCost) return false;

  const pricing = await resolveUsagePricing({
    actorClerkId,
    model,
    pricing: params.pricing,
  });

  try {
    await convexMutation("usage:recordUsageWithCost", {
      actorClerkId,
      chatId: params.chatId,
      messageId: params.messageId,
      model,
      inputTokens,
      outputTokens,
      openRouterCost,
      cacheSavingsCents: params.cacheSavingsCents,
      finishReason: params.finishReason,
      truncatedByLength: params.truncatedByLength,
      inputCostPerM: pricing.inputCostPerM,
      outputCostPerM: pricing.outputCostPerM,
    });
  } catch (error) {
    // If the mutation fails (e.g. validator rejects openRouterCost), retry without it
    const isValidationError =
      error instanceof Error &&
      (error.message.includes("ArgumentValidationError") ||
        error.message.includes("extra field"));
    if (isValidationError && openRouterCost !== undefined) {
      try {
        await convexMutation("usage:recordUsageWithCost", {
          actorClerkId,
          chatId: params.chatId,
          messageId: params.messageId,
          model,
          inputTokens,
          outputTokens,
          cacheSavingsCents: params.cacheSavingsCents,
          finishReason: params.finishReason,
          truncatedByLength: params.truncatedByLength,
          inputCostPerM: pricing.inputCostPerM,
          outputCostPerM: pricing.outputCostPerM,
        });
      } catch {
        // Usage recording must never block chat — silently drop
        console.warn("[usage-tracking] retry without openRouterCost also failed");
      }
    } else {
      // Non-validation errors: log and continue, never block chat
      console.warn("[usage-tracking] recordUsageWithCost failed:", error);
    }
  }

  return true;
}

export async function recordCompletionUsage(params: {
  actorClerkId?: string;
  chatId?: string;
  messageId?: string;
  completion?: CompletionLike | null;
  model?: string;
  pricing?: UsagePricing;
}) {
  const completion = params.completion;
  if (!completion) return false;

  return recordModelUsage({
    actorClerkId: params.actorClerkId,
    chatId: params.chatId,
    messageId: params.messageId,
    model: params.model ?? completion.model,
    inputTokens: completion.usage?.prompt_tokens,
    outputTokens: completion.usage?.completion_tokens,
    pricing: params.pricing,
  });
}

export async function recordOpenRouterUsage(params: {
  actorClerkId?: string;
  chatId?: string;
  messageId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    cached_tokens?: number;
    cache_creation_input_tokens?: number;
  } | null;
  openRouterCost?: number;
  finishReason?: string;
  truncatedByLength?: boolean;
  pricing?: UsagePricing;
  skipIfZeroTokens?: boolean;
}) {
  const actorClerkId = params.actorClerkId?.trim();
  const model = params.model?.trim();
  const effectivePricing =
    params.pricing
    ?? (actorClerkId && model
      ? await resolveUsagePricing({
        actorClerkId,
        model,
        pricing: params.pricing,
      })
      : undefined);

  return recordModelUsage({
    actorClerkId,
    chatId: params.chatId,
    messageId: params.messageId,
    model,
    inputTokens: params.inputTokens ?? params.usage?.prompt_tokens,
    outputTokens: params.outputTokens ?? params.usage?.completion_tokens,
    openRouterCost:
      params.openRouterCost
      ?? (typeof params.usage?.cost === "number" && Number.isFinite(params.usage.cost)
        ? params.usage.cost
        : undefined),
    finishReason: params.finishReason,
    truncatedByLength: params.truncatedByLength,
    cacheSavingsCents: estimateCacheSavingsCents({
      usage: params.usage,
      pricing: effectivePricing,
    }),
    pricing: effectivePricing,
    skipIfZeroTokens: params.skipIfZeroTokens,
  });
}

export async function recordSearchUsage(params: {
  actorClerkId?: string;
  chatId?: string;
  messageId?: string;
  provider?: string;
  operation: string;
  creditsUsed?: number;
  costCents?: number;
  finishReason?: string;
}) {
  const actorClerkId = params.actorClerkId?.trim();
  if (!actorClerkId) return false;
  const creditsUsed =
    typeof params.creditsUsed === "number" && Number.isFinite(params.creditsUsed)
      ? Math.max(0, params.creditsUsed)
      : 0;
  if (creditsUsed <= 0 && typeof params.costCents !== "number") return false;

  try {
    await convexMutation("usage:recordSearchUsage", {
      actorClerkId,
      chatId: params.chatId,
      messageId: params.messageId,
      provider: params.provider,
      operation: params.operation,
      creditsUsed,
      costCents:
        typeof params.costCents === "number" && Number.isFinite(params.costCents)
          ? Math.max(0, params.costCents)
          : undefined,
      finishReason: params.finishReason,
    });
    return true;
  } catch (error) {
    console.warn("[usage-tracking] recordSearchUsage failed:", error);
    return false;
  }
}
