import { convexMutation, convexQuery } from "@/lib/convex-server";

type UsagePricing = {
  inputCostPerM?: number;
  outputCostPerM?: number;
  isFree?: boolean;
};

type CompletionLike = {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

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
  pricing?: UsagePricing;
  skipIfZeroTokens?: boolean;
}) {
  const actorClerkId = params.actorClerkId?.trim();
  const model = params.model?.trim();
  const inputTokens = Math.max(0, Math.round(params.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.round(params.outputTokens ?? 0));
  const skipIfZeroTokens = params.skipIfZeroTokens ?? true;
  if (!actorClerkId || !model) return false;
  if (skipIfZeroTokens && inputTokens + outputTokens <= 0) return false;

  const pricing = await resolveUsagePricing({
    actorClerkId,
    model,
    pricing: params.pricing,
  });

  await convexMutation("usage:recordUsageWithCost", {
    actorClerkId,
    chatId: params.chatId,
    messageId: params.messageId,
    model,
    inputTokens,
    outputTokens,
    inputCostPerM: pricing.inputCostPerM,
    outputCostPerM: pricing.outputCostPerM,
  });

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
  } | null;
  pricing?: UsagePricing;
  skipIfZeroTokens?: boolean;
}) {
  return recordModelUsage({
    actorClerkId: params.actorClerkId,
    chatId: params.chatId,
    messageId: params.messageId,
    model: params.model,
    inputTokens: params.inputTokens ?? params.usage?.prompt_tokens,
    outputTokens: params.outputTokens ?? params.usage?.completion_tokens,
    pricing: params.pricing,
    skipIfZeroTokens: params.skipIfZeroTokens,
  });
}
