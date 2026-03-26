import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import type {
  ClarificationBlock,
  ClarificationOption,
  ClarificationQuestion,
} from "@/lib/orchestrator/clarification";
import type { StudyMode } from "@/types";

type ClarificationCallUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

type PromptAwareClarificationResult = {
  block: ClarificationBlock;
  modelUsed?: string;
  usage?: ClarificationCallUsage;
};

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripCodeFence(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseStructuredJson(value: string): unknown {
  const cleaned = stripCodeFence(value);
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  const candidate = objectMatch?.[0] ?? cleaned;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function slugify(value: string, fallback: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return slug || fallback;
}

function toQuestionType(value: unknown): ClarificationQuestion["type"] {
  if (value === "single_choice") return "single_choice";
  if (value === "multi_choice") return "multi_choice";
  if (value === "confirmation") return "confirmation";
  return "free_text";
}

function sanitizeOption(raw: unknown, questionId: string, index: number): ClarificationOption | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as { id?: unknown; label?: unknown; description?: unknown };
  const label = typeof input.label === "string" ? compactText(input.label).slice(0, 70) : "";
  if (!label) return null;
  const id = typeof input.id === "string" && compactText(input.id)
    ? slugify(input.id, `${questionId}_opt_${index + 1}`)
    : slugify(label, `${questionId}_opt_${index + 1}`);
  const description = typeof input.description === "string"
    ? compactText(input.description).slice(0, 170)
    : undefined;
  return { id, label, description };
}

function sanitizeQuestion(raw: unknown, index: number): ClarificationQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as {
    id?: unknown;
    text?: unknown;
    type?: unknown;
    options?: unknown;
  };
  const text = typeof input.text === "string" ? compactText(input.text).slice(0, 220) : "";
  if (!text) return null;
  const id = typeof input.id === "string" && compactText(input.id)
    ? slugify(input.id, `question_${index + 1}`)
    : slugify(text, `question_${index + 1}`);
  const type = toQuestionType(input.type);
  const options = Array.isArray(input.options)
    ? input.options
      .map((option, optionIndex) => sanitizeOption(option, id, optionIndex))
      .filter((option): option is ClarificationOption => Boolean(option))
      .slice(0, 4)
    : [];

  if ((type === "single_choice" || type === "multi_choice" || type === "confirmation") && options.length === 0) {
    return null;
  }

  return {
    id,
    text,
    type,
    options: options.length > 0 ? options : undefined,
  };
}

function sanitizeClarificationBlock(raw: unknown): ClarificationBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as { context?: unknown; questions?: unknown };
  const context = typeof input.context === "string"
    ? compactText(input.context).slice(0, 220)
    : "";
  if (!context) return null;
  if (!Array.isArray(input.questions)) return null;

  const questions = input.questions
    .map((question, index) => sanitizeQuestion(question, index))
    .filter((question): question is ClarificationQuestion => Boolean(question))
    .slice(0, 3);

  if (questions.length === 0) return null;

  return { context, questions };
}

export async function generatePromptAwareClarification(params: {
  mode: StudyMode;
  reason: string;
  message: string;
  fallbackBlock: ClarificationBlock;
  onModelCall?: (call: {
    model: string;
    usage?: ClarificationCallUsage;
    durationMs?: number;
  }) => void;
}): Promise<PromptAwareClarificationResult | null> {
  const message = compactText(params.message);
  if (!message) return null;

  const startedAt = Date.now();
  const completion = await openRouterChatCompletion({
    model: MODEL_CONFIG.smartCheap,
    fallbackModels: [MODEL_CONFIG.tutorFast],
    messages: [
      {
        role: "system",
        content: `Return strict JSON only.
Shape:
{
  "context": "one short sentence",
  "questions": [
    {
      "id": "snake_case_id",
      "text": "specific question",
      "type": "single_choice" | "multi_choice" | "free_text" | "confirmation",
      "options": [{"id":"id","label":"label","description":"impact"}]
    }
  ]
}
Rules:
- Max 3 questions.
- Prefer multiple-choice for speed (at least 1 choice question).
- Questions must reference the user's actual topic, not generic placeholders.
- Keep each question concise and actionable.
- No markdown, no commentary, no code fences.`,
      },
      {
        role: "user",
        content: `Mode: ${params.mode}
Clarification reason: ${params.reason}
User request: ${message}

Current fallback clarification (use this as quality baseline, but make it more specific):
${JSON.stringify(params.fallbackBlock, null, 2)}`,
      },
    ],
    temperature: 0.1,
    maxTokens: 520,
    reasoningEffort: "low",
  });

  const modelUsed = completion.model ?? MODEL_CONFIG.smartCheap;
  const usage = completion.usage;
  params.onModelCall?.({
    model: modelUsed,
    usage,
    durationMs: Date.now() - startedAt,
  });

  const rawContent = completion.choices?.[0]?.message?.content ?? "";
  const parsed = parseStructuredJson(rawContent);
  const block = sanitizeClarificationBlock(parsed);
  if (!block) return null;

  const hasChoiceQuestion = block.questions.some(
    (question) =>
      (question.type === "single_choice" || question.type === "multi_choice" || question.type === "confirmation")
      && (question.options?.length ?? 0) > 0,
  );
  if ((params.mode === "research" || params.mode === "explain") && !hasChoiceQuestion) {
    return null;
  }

  return {
    block,
    modelUsed,
    usage,
  };
}
