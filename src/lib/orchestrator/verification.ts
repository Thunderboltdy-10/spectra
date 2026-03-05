import { openRouterChatCompletion, type OpenRouterMessage } from "@/lib/openrouter";
import { markerVerificationPrompt } from "@/lib/prompts/policy";
import type { RouteTraceFallback } from "@/types";

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
  primaryModel: string;
  fallbackModels: string[];
  messages: OpenRouterMessage[];
  maxTokens?: number;
  verificationModel?: string;
  onFallback?: (event: RouteTraceFallback) => void;
  logger?: {
    info: (message: string, context?: Record<string, unknown>) => void;
  };
}) {
  let responseText = "";
  let modelUsed = params.primaryModel;
  let usageIn = 0;
  let usageOut = 0;
  let verificationPassed: boolean | undefined;

  const initial = await openRouterChatCompletion({
    model: params.primaryModel,
    fallbackModels: params.fallbackModels,
    messages: params.messages,
    maxTokens: params.maxTokens,
    onFallback: params.onFallback,
  });

  responseText = initial.choices?.[0]?.message?.content ?? "";
  modelUsed = initial.model ?? modelUsed;
  usageIn = initial.usage?.prompt_tokens ?? usageIn;
  usageOut = initial.usage?.completion_tokens ?? usageOut;

  if (params.verificationModel) {
    const verify = await openRouterChatCompletion({
      model: params.verificationModel,
      fallbackModels: params.fallbackModels,
      messages: [
        { role: "system", content: "Return strict JSON only." },
        { role: "user", content: markerVerificationPrompt(responseText) },
      ],
      temperature: 0,
      onFallback: params.onFallback,
    });

    const parsed = parseVerificationJson(verify.choices?.[0]?.message?.content ?? "{}");
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
        maxTokens: params.maxTokens,
        onFallback: params.onFallback,
      });

      responseText = retry.choices?.[0]?.message?.content ?? responseText;
      modelUsed = retry.model ?? modelUsed;
      usageIn += retry.usage?.prompt_tokens ?? 0;
      usageOut += retry.usage?.completion_tokens ?? 0;
    }
  }

  return {
    responseText,
    modelUsed,
    usageIn,
    usageOut,
    verificationPassed,
  };
}
