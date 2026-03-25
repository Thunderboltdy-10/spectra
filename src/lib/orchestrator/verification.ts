import { openRouterChatCompletion, type OpenRouterMessage } from "@/lib/openrouter";
import { markerVerificationPrompt } from "@/lib/prompts/policy";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";
import type { RouteTraceFallback } from "@/types";

export type VerificationSubcall = {
  label: string;
  modelUsed?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
};

export function parseVerificationJson(value: string) {
  try {
    const json = JSON.parse(value.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return {
      pass: Boolean(json.pass),
      reason: typeof json.reason === "string" ? json.reason : "No reason provided",
    };
  } catch {
    return { pass: false, reason: "Verification parser failed" };
  }
}

export async function runMarkerVerificationPipeline(params: {
  actorClerkId?: string;
  chatId?: string;
  primaryModel: string;
  fallbackModels: string[];
  messages: OpenRouterMessage[];
  thinkingLevel?: "low" | "medium" | "high";
  maxTokens?: number;
  verificationModel?: string;
  onFallback?: (event: RouteTraceFallback) => void;
  logger?: {
    info: (message: string, context?: Record<string, unknown>) => void;
  };
}) {
  const reasoningEffort =
    params.thinkingLevel === "high"
      ? "high"
      : params.thinkingLevel === "medium"
        ? "medium"
        : "low";
  let responseText = "";
  let modelUsed = params.primaryModel;
  let usageIn = 0;
  let usageOut = 0;
  let usageCost = 0;
  let verificationPassed: boolean | undefined;
  const subcalls: VerificationSubcall[] = [];

  const initial = await openRouterChatCompletion({
    model: params.primaryModel,
    fallbackModels: params.fallbackModels,
    messages: params.messages,
    reasoningEffort,
    maxTokens: params.maxTokens,
    onFallback: params.onFallback,
  });

  responseText = initial.choices?.[0]?.message?.content ?? "";
  modelUsed = initial.model ?? modelUsed;
  usageIn = initial.usage?.prompt_tokens ?? usageIn;
  usageOut = initial.usage?.completion_tokens ?? usageOut;
  usageCost += initial.usage?.cost ?? 0;
  subcalls.push({
    label: "Marker draft generation",
    modelUsed: initial.model ?? params.primaryModel,
    usage: initial.usage,
  });
  if (params.actorClerkId) {
    await recordOpenRouterUsage({
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      model: initial.model ?? params.primaryModel,
      usage: initial.usage,
    }).catch(() => {});
  }

  if (params.verificationModel) {
    const verify = await openRouterChatCompletion({
      model: params.verificationModel,
      fallbackModels: params.fallbackModels,
      messages: [
        { role: "system", content: "Return strict JSON only." },
        { role: "user", content: markerVerificationPrompt(responseText) },
      ],
      temperature: 0,
      reasoningEffort: "low",
      onFallback: params.onFallback,
    });

    const parsed = parseVerificationJson(verify.choices?.[0]?.message?.content ?? "{}");
    usageIn += verify.usage?.prompt_tokens ?? 0;
    usageOut += verify.usage?.completion_tokens ?? 0;
    if (params.actorClerkId) {
      await recordOpenRouterUsage({
        actorClerkId: params.actorClerkId,
        chatId: params.chatId,
        model: verify.model ?? params.verificationModel,
        usage: verify.usage,
      }).catch(() => {});
    }
    usageCost += verify.usage?.cost ?? 0;
    subcalls.push({
      label: "Marker verification pass",
      modelUsed: verify.model ?? params.verificationModel,
      usage: verify.usage,
    });
    verificationPassed = parsed.pass;
    params.logger?.info("marker verification complete", {
      verificationPassed,
    });

    if (!parsed.pass) {
      const retry = await openRouterChatCompletion({
        model: params.primaryModel,
        fallbackModels: params.fallbackModels,
        messages: [
          ...params.messages,
          {
            role: "system",
            content:
              "Regenerate with stronger citation discipline and explicit rubric scoring. Ensure key claims map to provided sources.",
          },
        ],
        temperature: 0.1,
        reasoningEffort,
        maxTokens: params.maxTokens,
        onFallback: params.onFallback,
      });

      responseText = retry.choices?.[0]?.message?.content ?? responseText;
      modelUsed = retry.model ?? modelUsed;
      usageIn += retry.usage?.prompt_tokens ?? 0;
      usageOut += retry.usage?.completion_tokens ?? 0;
      usageCost += retry.usage?.cost ?? 0;
      subcalls.push({
        label: "Marker retry generation",
        modelUsed: retry.model ?? params.primaryModel,
        usage: retry.usage,
      });
      if (params.actorClerkId) {
        await recordOpenRouterUsage({
          actorClerkId: params.actorClerkId,
          chatId: params.chatId,
          model: retry.model ?? params.primaryModel,
          usage: retry.usage,
        }).catch(() => {});
      }
    }
  }

  return {
    responseText,
    modelUsed,
    usageIn,
    usageOut,
    usage: {
      prompt_tokens: usageIn,
      completion_tokens: usageOut,
      total_tokens: usageIn + usageOut,
      cost: usageCost > 0 ? usageCost : undefined,
    },
    verificationPassed,
    subcalls,
  };
}
