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

const DOMAIN_TERMS = [
  "hypothesis",
  "methodology",
  "counterargument",
  "causation",
  "variance",
  "evaluation",
  "framework",
  "taxonomy",
  "rubric",
  "synthesis",
];

export type PromptCategory =
  | "code"
  | "math_science"
  | "creative"
  | "research"
  | "general"
  | "debate"
  | "comparison"
  | "synthesis"
  | "practical_application";

export type QuestionType = "what" | "why" | "how" | "evaluate" | "compare" | "other";
export type ExplainDepth = "introductory" | "intermediate" | "advanced";

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
  skipModelCalls?: boolean;
};

export type AutoSettingsResult = {
  message: string;
  promptEnhanced: boolean;
  searchEnabled: boolean;
  thinkingLevel: ThinkingLevel;
  complexity: "simple" | "medium" | "complex";
  promptCategory: PromptCategory;
  questionType: QuestionType;
  isMultipart: boolean;
};

export function classifyExplainDepth(prompt: string, userMemory?: string): ExplainDepth {
  const text = `${prompt}\n${userMemory ?? ""}`.toLowerCase();
  const advancedMarkers =
    /(formal proof|edge case|asymptotic|theorem|research paper|graduate|phd|abstraction|optimization)/i.test(text);
  const introMarkers =
    /(for beginners|eli5|simple terms|basic|new to this|just starting|beginner)/i.test(text);
  const domainMarkers =
    /(newton|photosynthesis|mitosis|calculus|thermodynamics|algorithm|macroeconomics|chemistry|biology|physics)/i.test(text);

  if (advancedMarkers) return "advanced";
  if (introMarkers) return "introductory";
  if (prompt.length > 260 || /(evaluate|compare|synthesize|derive)/i.test(prompt)) return "advanced";
  if ((prompt.length < 80 && !domainMarkers) || /(what is|explain like)/i.test(prompt.toLowerCase())) {
    return "introductory";
  }
  return "intermediate";
}

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

function detectQuestionType(message: string): QuestionType {
  const normalized = message.trim().toLowerCase();
  if (/^(what|which)\b/.test(normalized)) return "what";
  if (/^(why)\b/.test(normalized)) return "why";
  if (/^(how)\b/.test(normalized)) return "how";
  if (/^(evaluate|assess|critique|analyze)\b/.test(normalized)) return "evaluate";
  if (/^(compare|contrast)\b/.test(normalized)) return "compare";
  return "other";
}

function detectMultipart(message: string) {
  const normalized = message.toLowerCase();
  return (
    /(^|\n)\s*(\d+\.|-|\*)\s+/.test(message) ||
    /\b(first|second|third|then|finally)\b/.test(normalized)
  );
}

export function classifyComplexity(message: string): "simple" | "medium" | "complex" {
  const normalized = message.toLowerCase();
  const hasComplexVerb = HIGH_THINKING_MARKERS.some((marker) => normalized.includes(marker));
  const multipart = detectMultipart(message);
  const questionType = detectQuestionType(message);
  const wordCount = Math.max(1, message.trim().split(/\s+/).length);
  const avgWordLength =
    message
      .trim()
      .split(/\s+/)
      .reduce((sum, part) => sum + part.length, 0) / wordCount;
  const domainHits = DOMAIN_TERMS.filter((term) => normalized.includes(term)).length;

  let score = 0;
  score += Math.min(1, wordCount / 280) * 0.35;
  score += hasComplexVerb ? 0.2 : 0;
  score += multipart ? 0.18 : 0;
  score += Math.min(1, domainHits / 5) * 0.2;
  score += avgWordLength > 5 ? 0.05 : 0;
  if (questionType === "evaluate" || questionType === "compare") score += 0.12;
  if (questionType === "why" || questionType === "how") score += 0.05;

  if (hasComplexVerb && multipart && wordCount >= 20) return "complex";

  if (score >= 0.62 || message.length > 550) return "complex";
  if (score >= 0.34 || message.length > 190) return "medium";
  return "simple";
}

function classifyPromptCategory(
  message: string,
): PromptCategory {
  const normalized = message.toLowerCase();
  if (/(debate|argue both sides|counterargument|rebuttal|position statement)/i.test(normalized)) {
    return "debate";
  }
  if (/(compare|contrast|versus|vs\.?|difference between|similarities)/i.test(normalized)) {
    return "comparison";
  }
  if (/(synthesize|combine these sources|integrate evidence|meta-analysis|cross-reference)/i.test(normalized)) {
    return "synthesis";
  }
  if (/(apply this|real-world|case study|practical|implementation plan|action plan)/i.test(normalized)) {
    return "practical_application";
  }
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
    const normalizedPrompt = (parsed.prompt?.trim() || message).slice(0, 700);
    return {
      prompt: normalizedPrompt,
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 4) : [],
    };
  } catch {
    return fallback;
  }
}

export async function runAutoSettingsPipeline(input: AutoSettingsInput): Promise<AutoSettingsResult> {
  const complexity = classifyComplexity(input.message);
  const promptCategory = classifyPromptCategory(input.message);
  const questionType = detectQuestionType(input.message);
  const isMultipart = detectMultipart(input.message);
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

  if (input.autoEnhancePrompt && enhanceMode !== "off" && !input.skipModelCalls) {
    const enhanced = await maybeEnhancePrompt(input.message);
    if (enhanced.prompt.trim() && enhanced.prompt.trim() !== input.message.trim()) {
      message = enhanced.prompt.trim();
      promptEnhanced = true;
    } else if (enhanceMode === "on") {
      promptEnhanced = true;
    }
  } else if (enhanceMode === "on") {
    promptEnhanced = true;
  }

  return {
    message,
    promptEnhanced,
    searchEnabled,
    thinkingLevel,
    complexity,
    promptCategory,
    questionType,
    isMultipart,
  };
}
