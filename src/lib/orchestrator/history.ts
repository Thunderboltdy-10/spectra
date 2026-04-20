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

export type ThreadCommitment = {
  text: string;
  status: "open" | "done" | "blocked";
};

export type ThreadSnapshot = {
  rawRecentTurns: Array<{ role: ChatMessage["role"]; content: string; mode?: StudyMode }>;
  commitments: ThreadCommitment[];
  unresolvedTasks: string[];
  activeConstraints: string[];
  evidenceReferences: string[];
  continuityHints: string[];
  summary: string;
};

export function shouldScheduleCompaction(params: {
  history: ChatMessage[];
  mode?: StudyMode;
  hasExistingSummary?: boolean;
  contextWindowTokens?: number;
  routerMode?: "auto" | "manual" | "openrouter_auto";
}) {
  if (params.hasExistingSummary) return false;
  if ((params.routerMode ?? "auto") !== "auto") return false;
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

function extractListByPattern(history: ChatMessage[], pattern: RegExp, max = 6) {
  const values: string[] = [];
  for (const message of history.slice(-18)) {
    const matches = compactText(message.content)
      .split(/(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .filter((line) => pattern.test(line));
    for (const match of matches) {
      const clean = match.slice(0, 220);
      if (!values.some((value) => value.toLowerCase() === clean.toLowerCase())) {
        values.push(clean);
      }
      if (values.length >= max) return values;
    }
  }
  return values;
}

export function buildThreadSnapshot(history: ChatMessage[], summary?: string): ThreadSnapshot {
  const rawRecentTurns = history.slice(-8).map((message) => ({
    role: message.role,
    content: compactText(message.content).slice(0, 320),
    mode: message.mode,
  }));
  const commitments = extractListByPattern(
    history,
    /\b(i will|we will|i'll|we'll|next step|plan is|i can|i should|you should|todo|to do|must|need to)\b/i,
    6,
  ).map((text) => ({
    text,
    status: /\b(done|completed|finished|resolved)\b/i.test(text) ? "done" as const : "open" as const,
  }));
  const unresolvedTasks = extractListByPattern(
    history,
    /\b(still need|remaining|unresolved|blocked|not yet|todo|to do|follow up|pending)\b/i,
    6,
  );
  const activeConstraints = extractListByPattern(
    history,
    /\b(don't|do not|must|need to|required|constraint|limit|only|exactly|without)\b/i,
    6,
  );
  const evidenceReferences = Array.from(new Set(history
    .flatMap((message) => (message.citations ?? []).map((citation) => citation.filename))
    .filter(Boolean)
    .slice(-8)));
  const continuityHints = extractListByPattern(
    history,
    /\b(continue|same thread|previous|earlier|last time|as above|pick up|resume)\b/i,
    5,
  );

  return {
    rawRecentTurns,
    commitments,
    unresolvedTasks,
    activeConstraints,
    evidenceReferences,
    continuityHints,
    summary: summary ?? fallbackCompactSummary(history),
  };
}

export function formatThreadSnapshotForPrompt(snapshot: ThreadSnapshot | null) {
  if (!snapshot) return "";
  const lines: string[] = ["THREAD SNAPSHOT:"];
  if (snapshot.summary) lines.push(`Summary: ${snapshot.summary}`);
  if (snapshot.commitments.length > 0) {
    lines.push("Commitments:");
    snapshot.commitments.forEach((item) => lines.push(`- [${item.status}] ${item.text}`));
  }
  if (snapshot.unresolvedTasks.length > 0) {
    lines.push("Unresolved tasks:");
    snapshot.unresolvedTasks.forEach((item) => lines.push(`- ${item}`));
  }
  if (snapshot.activeConstraints.length > 0) {
    lines.push("Constraints:");
    snapshot.activeConstraints.forEach((item) => lines.push(`- ${item}`));
  }
  if (snapshot.evidenceReferences.length > 0) {
    lines.push(`Evidence refs: ${snapshot.evidenceReferences.join(", ")}`);
  }
  if (snapshot.rawRecentTurns.length > 0) {
    lines.push("Recent raw turns:");
    snapshot.rawRecentTurns.forEach((turn) => lines.push(`- ${turn.role}: ${turn.content}`));
  }
  return lines.join("\n").slice(0, 3000);
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
