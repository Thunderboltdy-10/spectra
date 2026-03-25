import { convexMutation } from "@/lib/convex-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { resolveRoleModelBundle } from "@/lib/model-role-resolver";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";
import type { ChatMessage, Citation, StudyMode } from "@/types";
import { inferAttempt, inferReflection } from "@/lib/prompts/policy";

const COMPACTION_TRIGGER_RATIO = 0.9;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const MIN_MESSAGES_FOR_COMPACTION = 12;
const MASK_OLDER_THAN_RECENT_TURNS = 8;

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
  if (turns < MIN_MESSAGES_FOR_COMPACTION) return false;

  const contextWindowTokens =
    typeof params.contextWindowTokens === "number" && params.contextWindowTokens > 0
      ? params.contextWindowTokens
      : DEFAULT_CONTEXT_WINDOW_TOKENS;
  const thresholdTokens = Math.floor(contextWindowTokens * COMPACTION_TRIGGER_RATIO);
  const rawEstimate = estimateHistoryTokens(params.history, false);
  if (rawEstimate < thresholdTokens) return false;

  // Primary strategy: mask search/RAG-heavy observations in older turns before summarizing.
  const maskedEstimate = estimateHistoryTokens(params.history, true);
  return maskedEstimate >= thresholdTokens;
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

function countUrls(value: string) {
  return (value.match(/https?:\/\/[^\s)\]]+/g) ?? []).length;
}

function maskObservationContent(message: ChatMessage) {
  if (message.role !== "assistant") return message.content;
  const citations = Array.isArray(message.citations) ? message.citations : [];
  const searchCitationCount = citations.filter((citation) => citation.sourceType === "search").length;
  if (searchCitationCount > 0) {
    return `[Search: "web query" — ${searchCitationCount} result${searchCitationCount === 1 ? "" : "s"}]`;
  }
  const ragCitationCount = citations.filter(
    (citation) => citation.sourceType === "pack" || citation.sourceType === "personal",
  ).length;
  if (ragCitationCount > 0) {
    return `[RAG: cited ${ragCitationCount} classroom source${ragCitationCount === 1 ? "" : "s"}]`;
  }

  const content = message.content ?? "";
  const urlCount = countUrls(content);
  if (urlCount >= 2) {
    return `[Search: linked web references — ${urlCount} result${urlCount === 1 ? "" : "s"}]`;
  }
  if (/source reliability scan|research evidence matrix|web search results/i.test(content)) {
    return "[Search: summarized evidence block]";
  }
  return content;
}

function estimateHistoryTokens(history: ChatMessage[], maskOlderObservations: boolean) {
  const cutoffIndex = Math.max(0, history.length - MASK_OLDER_THAN_RECENT_TURNS);
  const totalChars = history.reduce((sum, message, index) => {
    const contentValue = maskOlderObservations && index < cutoffIndex
      ? maskObservationContent(message)
      : message.content;
    const contentChars = typeof contentValue === "string" ? contentValue.length : 0;
    const thinkingChars = typeof message.thinkingContent === "string" ? Math.min(400, message.thinkingContent.length) : 0;
    return sum + contentChars + thinkingChars;
  }, 0);
  return Math.ceil(totalChars / 4);
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

  const olderHistory = params.history.slice(0, Math.max(0, params.history.length - MASK_OLDER_THAN_RECENT_TURNS));
  const maskedOlderHistory = olderHistory.map((message) => ({
    ...message,
    content: maskObservationContent(message),
  }));
  const source = olderHistory
    .map((message, index) => {
      const masked = maskedOlderHistory[index];
      return `${message.role.toUpperCase()} [${message.mode}]: ${compactText(masked?.content ?? message.content).slice(0, 300)}`;
    })
    .join("\n\n")
    .slice(0, 12000);

  const utility = await resolveRoleModelBundle({
    actorClerkId: params.actorClerkId,
    role: "utilityFree",
    fallbackModel: MODEL_CONFIG.utilityFree,
    maxFallbacks: 2,
  }).catch(() => ({
    model: MODEL_CONFIG.utilityFree,
    fallbackModels: [MODEL_CONFIG.marker],
  }));

  const startedAt = Date.now();
  const completionPromise = openRouterChatCompletion({
    model: utility.model,
    fallbackModels: utility.fallbackModels,
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
    const model = completion.model ?? utility.model;
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
