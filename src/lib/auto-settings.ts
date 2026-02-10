import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import type { SpendingTier, ThinkingLevel } from "@/types";

const SEARCH_KEYWORDS = [
  "latest",
  "current",
  "today",
  "2025",
  "2026",
  "news",
  "who won",
  "recent",
  "breaking",
  "update",
  "last week",
  "this month",
];

const HIGH_THINKING_MARKERS = [
  "prove",
  "derive",
  "explain why",
  "show that",
  "analyze",
  "compare",
  "evaluate",
  "critique",
];

export type AutoSettingsInput = {
  message: string;
  currentThinkingLevel: ThinkingLevel;
  spendingTier: SpendingTier;
  autoEnhancePrompt: boolean;
  autoThinking: boolean;
  autoSearch: boolean;
  enhanceMode?: "auto" | "on" | "off";
  thinkingMode?: "auto" | "on" | "off";
  searchMode?: "auto" | "on" | "off";
};

export type AutoSettingsResult = {
  message: string;
  promptEnhanced: boolean;
  searchEnabled: boolean;
  thinkingLevel: ThinkingLevel;
  complexity: "simple" | "medium" | "complex";
  promptCategory: "code" | "math_science" | "creative" | "research" | "general";
};

export function detectSearchIntent(message: string) {
  const normalized = message.toLowerCase();
  return SEARCH_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function detectThinkingLevel(message: string, fallback: ThinkingLevel): ThinkingLevel {
  const normalized = message.toLowerCase();
  const longPrompt = message.length > 400;
  const highMarker = HIGH_THINKING_MARKERS.some((marker) => normalized.includes(marker));

  if (highMarker || longPrompt) return "high";
  if (message.length > 160) return "medium";
  return fallback;
}

export function classifyComplexity(message: string): "simple" | "medium" | "complex" {
  const normalized = message.toLowerCase();
  const hasComplexVerb = HIGH_THINKING_MARKERS.some((marker) => normalized.includes(marker));
  if (hasComplexVerb || message.length > 500) return "complex";
  if (message.length > 180) return "medium";
  return "simple";
}

function classifyPromptCategory(
  message: string,
): "code" | "math_science" | "creative" | "research" | "general" {
  const normalized = message.toLowerCase();
  if (/(code|typescript|javascript|python|debug|function|api|sql|algorithm|bug)/i.test(normalized)) {
    return "code";
  }
  if (/(prove|derive|equation|physics|chemistry|math|calculus|integral|theorem|statistics)/i.test(normalized)) {
    return "math_science";
  }
  if (/(poem|story|creative|rewrite|tone|narrative|brainstorm|copywriting)/i.test(normalized)) {
    return "creative";
  }
  if (/(research|sources|citation|compare papers|evidence|latest|current|news)/i.test(normalized)) {
    return "research";
  }
  return "general";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(fallback);
      }
    }, timeoutMs);

    void promise
      .then((value) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(value);
        }
      })
      .catch(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(fallback);
        }
      });
  });
}

export async function maybeEnhancePrompt(message: string) {
  const fallback = {
    prompt: message,
    improvements: [] as string[],
  };

  const result = await withTimeout(
    openRouterChatCompletion({
      model: MODEL_CONFIG.promptEnhance,
      fallbackModels: [MODEL_CONFIG.tutorFast],
      messages: [
        {
          role: "system",
          content:
            "Rewrite the student prompt to be clearer and more specific while preserving intent. Return JSON: {\"prompt\": string, \"improvements\": string[]}",
        },
        {
          role: "user",
          content: message,
        },
      ],
      temperature: 0.2,
    }),
    2000,
    null,
  );

  if (!result) {
    return fallback;
  }

  const raw = result.choices?.[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(match[0]) as { prompt?: string; improvements?: string[] };
    return {
      prompt: parsed.prompt?.trim() || message,
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 4) : [],
    };
  } catch {
    return fallback;
  }
}

export async function runAutoSettingsPipeline(input: AutoSettingsInput): Promise<AutoSettingsResult> {
  const complexity = classifyComplexity(input.message);
  const promptCategory = classifyPromptCategory(input.message);
  const enhanceMode = input.enhanceMode ?? "auto";
  const thinkingMode = input.thinkingMode ?? "auto";
  const searchMode = input.searchMode ?? "auto";

  const searchEnabled = (() => {
    if (input.spendingTier === "free_only") return false;
    if (searchMode === "on") return true;
    if (searchMode === "off") return false;
    return input.autoSearch && detectSearchIntent(input.message);
  })();

  const thinkingLevel = (() => {
    if (thinkingMode === "on") return "high" as ThinkingLevel;
    if (thinkingMode === "off") return "low" as ThinkingLevel;
    return input.autoThinking
      ? detectThinkingLevel(input.message, input.currentThinkingLevel)
      : input.currentThinkingLevel;
  })();

  let message = input.message;
  let promptEnhanced = false;

  if (input.autoEnhancePrompt && enhanceMode !== "off") {
    const enhanced = await maybeEnhancePrompt(input.message);
    if (enhanced.prompt.trim() && enhanced.prompt.trim() !== input.message.trim()) {
      message = enhanced.prompt.trim();
      promptEnhanced = true;
    }
  }

  return {
    message,
    promptEnhanced,
    searchEnabled,
    thinkingLevel,
    complexity,
    promptCategory,
  };
}
