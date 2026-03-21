import { convexMutation } from "@/lib/convex-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";
import type { ChatMessage, Citation, StudyMode } from "@/types";
import { inferAttempt, inferReflection } from "@/lib/prompts/policy";

export type MemoryEntry = {
  key: string;
  value: string;
  confidence: number;
  extractedAt: number;
};

export function shouldScheduleCompaction(params: {
  history: ChatMessage[];
  mode?: StudyMode;
  hasExistingSummary?: boolean;
  contextWindowTokens?: number;
}) {
  if (params.hasExistingSummary) return false;
  const turns = params.history.length;
  if (turns <= 10) return false;

  const totalChars = params.history.reduce((sum, message) => {
    const content = typeof message.content === "string" ? message.content.length : 0;
    const thinking = typeof message.thinkingContent === "string" ? message.thinkingContent.length : 0;
    return sum + content + Math.min(800, thinking);
  }, 0);

  // Context-aware compaction: if we know the model's context window, compact at ~75%
  if (params.contextWindowTokens && params.contextWindowTokens > 0) {
    const estimatedTokens = Math.ceil(totalChars / 4);
    const threshold = Math.floor(params.contextWindowTokens * 0.75);
    if (estimatedTokens >= threshold && turns > 10) return true;
  }

  // Fallback to turn-count heuristics
  const mode = params.mode ?? "general";
  const denseModes = mode === "research" || mode === "document" || mode === "exam";
  if (turns >= 24) return true;
  if (denseModes && turns >= 16) return true;
  if (turns >= 14 && totalChars >= 9_000) return true;
  if (turns >= 12 && totalChars >= 14_000) return true;
  return false;
}

export function toChatMessageShape(messages: Array<Record<string, unknown>>): ChatMessage[] {
  return messages.map((message) => ({
    _id: String(message._id),
    role: message.role as ChatMessage["role"],
    content: String(message.content ?? ""),
    enhancedContent:
      typeof message.enhancedContent === "string" ? message.enhancedContent : undefined,
    mode: message.mode as StudyMode,
    citations: (message.citations as Citation[]) ?? [],
    modelRequested: typeof message.modelRequested === "string" ? message.modelRequested : undefined,
    modelUsed: typeof message.modelUsed === "string" ? message.modelUsed : undefined,
    whyThisResponse: typeof message.whyThisResponse === "string" ? message.whyThisResponse : undefined,
    usageIn: typeof message.usageIn === "number" ? message.usageIn : undefined,
    usageOut: typeof message.usageOut === "number" ? message.usageOut : undefined,
    verificationPassed:
      typeof message.verificationPassed === "boolean" ? message.verificationPassed : undefined,
    thinkingContent:
      typeof message.thinkingContent === "string" ? message.thinkingContent : undefined,
    routeTrace: message.routeTrace as ChatMessage["routeTrace"],
    createdAt: Number(message.createdAt ?? Date.now()),
  }));
}

export function extractAttemptStats(messages: ChatMessage[]) {
  let attemptCount = 0;
  let hasReflection = false;

  for (const message of messages) {
    if (message.role !== "user") continue;
    if (inferAttempt(message.content)) {
      attemptCount += 1;
    }
    if (inferReflection(message.content)) {
      hasReflection = true;
    }
  }

  return { attemptCount, hasReflection };
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, timeoutMs);

    void promise
      .then((value) => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve(value);
        }
      })
      .catch(() => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve(null);
        }
      });
  });
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function fallbackCompactSummary(history: ChatMessage[]) {
  const compacted = history.slice(-14);
  const userLines = compacted
    .filter((message) => message.role === "user")
    .map((message) => compactText(message.content).slice(0, 160))
    .filter(Boolean);
  const assistantLines = compacted
    .filter((message) => message.role === "assistant")
    .map((message) => compactText(message.content).slice(0, 160))
    .filter(Boolean);

  const lines = [
    "Goals",
    ...userLines.slice(0, 3).map((line) => `- ${line}`),
    "Attempts",
    ...userLines.slice(3, 6).map((line) => `- ${line}`),
    "Key Guidance",
    ...assistantLines.slice(0, 4).map((line) => `- ${line}`),
    "Outstanding Questions",
    userLines.length > 0 ? `- ${userLines[userLines.length - 1]}` : "- None captured.",
    "Next Steps",
    "- Continue from latest chat turns and verify against rubric/resources.",
  ];

  return lines.join("\n").slice(0, 2000);
}

export async function maybeCompactHistory(params: {
  actorClerkId: string;
  chatId: string;
  history: ChatMessage[];
  onModelCall?: (call: {
    model: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
    durationMs?: number;
  }) => void;
}) {
  if (!shouldScheduleCompaction({ history: params.history, hasExistingSummary: false })) return;

  const olderHistory = params.history.slice(0, Math.max(0, params.history.length - 6));
  const source = olderHistory
    .map((message) => `${message.role.toUpperCase()} [${message.mode}]: ${compactText(message.content).slice(0, 300)}`)
    .join("\n\n")
    .slice(0, 12000);

  const startedAt = Date.now();
  const completionPromise = openRouterChatCompletion({
    model: MODEL_CONFIG.tutorFast,
    fallbackModels: [MODEL_CONFIG.marker],
    messages: [
      {
        role: "system",
        content:
          "Summarize this study conversation for memory compaction. Output plain text with headings: Goals, Attempts, Key Guidance, Outstanding Questions, Next Steps. Use concise bullet points and keep total length between 120 and 220 words.",
      },
      {
        role: "user",
        content: source,
      },
    ],
    temperature: 0.1,
  });
  let usageRecorded = false;
  const recordUsage = async (completion: Awaited<typeof completionPromise>) => {
    if (usageRecorded) return;
    usageRecorded = true;
    const model = completion.model ?? MODEL_CONFIG.tutorFast;
    const usage = completion.usage;
    const durationMs = Date.now() - startedAt;
    await recordOpenRouterUsage({
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      model,
      usage,
    }).catch(() => {});
    params.onModelCall?.({
      model,
      usage,
      durationMs,
    });
  };
  void completionPromise.then((completion) => {
    void recordUsage(completion);
  }).catch(() => {});

  const completion = await withTimeout(
    completionPromise,
    5000,
  );

  const summary = completion?.choices?.[0]?.message?.content?.trim() ?? fallbackCompactSummary(olderHistory);
  if (completion) {
    await recordUsage(completion);
  }
  if (!summary) return;

  await convexMutation("chats:setContextSummary", {
    actorClerkId: params.actorClerkId,
    chatId: params.chatId,
    contextSummary: summary.slice(0, 2000),
  });
}
