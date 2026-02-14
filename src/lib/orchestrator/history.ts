import { convexMutation } from "@/lib/convex-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import type { ChatMessage, Citation, StudyMode } from "@/types";
import { inferAttempt, inferReflection } from "@/lib/prompts/policy";

export type MemoryEntry = {
  key: string;
  value: string;
  confidence: number;
  extractedAt: number;
};

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

export async function maybeCompactHistory(params: {
  actorClerkId: string;
  chatId: string;
  history: ChatMessage[];
}) {
  if (params.history.length <= 20) return;

  const source = params.history
    .slice(0, Math.max(0, params.history.length - 6))
    .map((message) => `${message.role.toUpperCase()}: ${message.content.slice(0, 380)}`)
    .join("\n\n")
    .slice(0, 12000);

  const completion = await withTimeout(
    openRouterChatCompletion({
      model: MODEL_CONFIG.tutorFast,
      fallbackModels: [MODEL_CONFIG.marker],
      messages: [
        {
          role: "system",
          content:
            "Summarize this conversation for future context compaction. Keep key goals, constraints, misconceptions, and progress in <180 words.",
        },
        {
          role: "user",
          content: source,
        },
      ],
      temperature: 0.1,
    }),
    5000,
  );

  const summary = completion?.choices?.[0]?.message?.content?.trim();
  if (!summary) return;

  await convexMutation("chats:setContextSummary", {
    actorClerkId: params.actorClerkId,
    chatId: params.chatId,
    contextSummary: summary.slice(0, 2000),
  });
}
