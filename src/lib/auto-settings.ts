import { MODEL_CONFIG } from "@/lib/model-config";
import { isModeAvailable } from "@/lib/modes";
import { openRouterChatCompletion } from "@/lib/openrouter";
import type { SpendingTier, StudyMode, ThinkingLevel } from "@/types";

const SEARCH_KEYWORDS = [
  "latest",
  "current",
  "today",
  "yesterday",
  "tomorrow",
  "news",
  "who won",
  "recent",
  "breaking",
  "update",
  "last week",
  "this month",
  "live",
  "up-to-date",
];

const SEARCH_OPT_OUT = [
  "don't search",
  "do not search",
  "without searching",
  "no web search",
  "no browsing",
  "offline only",
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
  conversationHistory?: ConversationHistoryEntry[];
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
  suggestedMode: string | null;
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
  if (SEARCH_OPT_OUT.some((phrase) => normalized.includes(phrase))) {
    return false;
  }
  if (SEARCH_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return true;
  }
  if (/\b(search|look up|lookup|find online|web)\b/i.test(normalized)) {
    return true;
  }
  if (/\b(score|stock|price|weather|forecast|election|ceo|president)\b/i.test(normalized)) {
    return true;
  }

  const currentYear = new Date().getUTCFullYear();
  const years = [...normalized.matchAll(/\b(20\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => Number.isFinite(year));

  return years.some((year) => year >= currentYear - 1);
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

function isLowSignalChitChat(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 4) return false;
  const normalized = trimmed.toLowerCase().replace(/[!?.\s]+/g, " ").trim();
  if (!normalized) return true;
  return /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|gm|gn|good morning|good afternoon|good evening)$/.test(
    normalized,
  );
}

export type ConversationHistoryEntry = {
  role: string;
  content: string;
  mode?: string;
};

function ensureAvailableSuggestedMode(mode: string | null): string | null {
  if (!mode) return null;
  if (isModeAvailable(mode as StudyMode)) return mode;

  const fallbackByUnavailable: Partial<Record<StudyMode, StudyMode>> = {
    explain: "tutor",
    marker: "general",
    exam: "quiz",
    draft_coach: "tutor",
  };
  const fallback = fallbackByUnavailable[mode as StudyMode];
  if (fallback && isModeAvailable(fallback)) {
    return fallback;
  }
  return "general";
}

/**
 * Detects a suggested study mode from the message text alone (no history).
 * Returns null if no confident mode signal is found.
 */
export function detectSuggestedMode(message: string): string | null {
  const normalized = message.toLowerCase().trim();
  const abstractOutputPattern =
    /\b(plan|summary|conclusion|comparison|list|table|chart|diagram|outline|roadmap|analysis|report|essay|email)\b/i;
  const visualNounPattern =
    /\b(image|picture|photo|illustration|art|artwork|logo|poster|icon|banner|wallpaper|render|portrait|scene|character|landscape|cover|thumbnail|concept art)\b/i;

  // Image generation - check first as it's most distinct.
  if (
    /\b(create|generate|make|design)\b/i.test(message) &&
    visualNounPattern.test(message)
  ) {
    return "image";
  }
  // Direct drawing commands (e.g., "draw a cat"), excluding abstract outputs.
  if (
    /^\s*(draw|sketch|paint|illustrate|render)\b/i.test(message) &&
    !abstractOutputPattern.test(message)
  ) {
    return "image";
  }
  // Quiz detection
  if (/\b(quiz me|test me|test my knowledge|give me a quiz|pop quiz|practice questions|multiple choice)\b/i.test(normalized)) {
    return "quiz";
  }
  // Flashcard detection
  if (/\b(make flashcards?|create cards?|flashcard|flash card|study cards?|memorize|review cards)\b/i.test(normalized)) {
    return "flashcard";
  }
  // Research detection
  if (/\b(research|find sources|cite sources|literature review|find papers|evidence|bibliography)\b/i.test(normalized)) {
    return "research";
  }
  // Explain detection - require explicit teaching/explanation intent
  // "what is" alone is too broad, needs context like "explain what is" or "teach me what is"
  if (/\b(explain (?:how|why|the)|teach me|break down|eli5|help me understand)\b/i.test(normalized) && normalized.length < 200) {
    return "explain";
  }
  // "what is" only triggers explain if followed by technical/complex terms
  if (/\b(what is|what are)\s+(?:the |a |an )?(?:process|mechanism|algorithm|theory|concept|principle|difference between|relationship|significance)/i.test(normalized) && normalized.length < 200) {
    return "explain";
  }
  // Review/Mark detection
  if (/\b(review|grade|mark|feedback on|rubric|evaluate my)\b/i.test(normalized)) {
    return "marker";
  }
  // Draft coaching detection
  if (/\b(write|essay|draft|composition|improve my writing)\b/i.test(normalized) && normalized.length > 30) {
    return "draft_coach";
  }
  // Exam detection
  if (/\b(exam|final test|comprehensive test|assessment)\b/i.test(normalized)) {
    return "exam";
  }
  return null;
}

/**
 * Conversation-aware mode suggestion.
 * Considers the current message AND recent conversation history to pick the best mode.
 * Returns null if no confident switch is warranted.
 */
export function suggestMode(
  message: string,
  conversationHistory?: ConversationHistoryEntry[],
): string | null {
  // First get the message-only signal
  const messageMode = detectSuggestedMode(message);

  // If no history, fall back to message-only detection
  if (!conversationHistory || conversationHistory.length === 0) {
    return ensureAvailableSuggestedMode(messageMode);
  }

  const lower = message.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  // Look at the last assistant message for context
  const lastAssistant = [...conversationHistory].reverse().find((entry) => entry.role === "assistant");
  const lastAssistantMode = lastAssistant?.mode ?? null;
  const lastAssistantContent = (lastAssistant?.content ?? "").toLowerCase();

  // If last message was a quiz and user responds with "explain" or "teach me", switch to tutor
  if (
    lastAssistantMode === "quiz" &&
    /\b(explain|teach me|i don't understand|help me understand|what does|why is|how does)\b/i.test(lower)
  ) {
    return ensureAvailableSuggestedMode("tutor");
  }

  // If last message was a quiz result with a low score signal, suggest tutor
  if (
    lastAssistantMode === "quiz" &&
    /(score|result|got.*wrong|incorrect|failed|try again)/i.test(lastAssistantContent) &&
    wordCount < 10 &&
    !/\b(quiz|another|more questions|again)\b/i.test(lower)
  ) {
    return ensureAvailableSuggestedMode("tutor");
  }

  // If user has been in tutor mode for 6+ messages, suggest quiz to test understanding
  // (Only when message is short and doesn't ask for more explanation)
  const tutorMessageCount = conversationHistory.filter((entry) => entry.mode === "tutor").length;
  if (
    tutorMessageCount >= 6 &&
    lastAssistantMode === "tutor" &&
    wordCount < 6 &&
    /\b(ok|okay|got it|i see|i understand|makes sense|thanks|thank you|cool|got that)\b/i.test(lower)
  ) {
    return ensureAvailableSuggestedMode("quiz");
  }

  // After flashcard review, if user says they're ready or finished, suggest quiz
  if (
    lastAssistantMode === "flashcard" &&
    /\b(ready|done|finished|test me|quiz me now|all done|studied)\b/i.test(lower)
  ) {
    return ensureAvailableSuggestedMode("quiz");
  }

  // If the message itself has a confident signal, return it
  if (messageMode) {
    return ensureAvailableSuggestedMode(messageMode);
  }

  // Short follow-up in quiz context - stay in quiz
  if (lastAssistantMode === "quiz" && wordCount < 4) {
    return ensureAvailableSuggestedMode("quiz");
  }

  return ensureAvailableSuggestedMode(null);
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
  const allowAutoEnhancement = !isLowSignalChitChat(input.message);

  const forceLocalEnhancement = (raw: string) => {
    const clean = raw.trim();
    return [
      "Student request:",
      clean,
      "",
      "Clarified objective:",
      "- Keep scope focused on the core task.",
      "- Explain steps clearly and explicitly.",
      "- Include concise examples where useful.",
    ].join("\n");
  };

  if (input.autoEnhancePrompt && enhanceMode !== "off" && !input.skipModelCalls && (enhanceMode === "on" || allowAutoEnhancement)) {
    const enhanced = await maybeEnhancePrompt(input.message);
    if (enhanced.prompt.trim() && enhanced.prompt.trim() !== input.message.trim()) {
      message = enhanced.prompt.trim();
      promptEnhanced = true;
    } else if (enhanceMode === "on") {
      message = forceLocalEnhancement(input.message);
      promptEnhanced = true;
    }
  } else if (enhanceMode === "on") {
    message = forceLocalEnhancement(input.message);
    promptEnhanced = true;
  }

  const suggestedMode = ensureAvailableSuggestedMode(
    suggestMode(input.message, input.conversationHistory),
  );

  return {
    message,
    promptEnhanced,
    searchEnabled,
    thinkingLevel,
    complexity,
    promptCategory,
    questionType,
    isMultipart,
    suggestedMode,
  };
}
