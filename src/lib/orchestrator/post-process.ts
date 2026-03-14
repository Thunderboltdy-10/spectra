import { convexMutation, convexQuery } from "@/lib/convex-server";
import { buildRuntimeStatMap, pickModelAndFallbacks } from "@/lib/model-selection";
import { getLiveCatalogSnapshot } from "@/lib/openrouter-catalog-cache";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";
import { extractCitationsFromText } from "@/lib/orchestrator/compose";
import type { WebSearchSource } from "@/lib/orchestrator/retrieval";
import { withTimeout, type MemoryEntry } from "@/lib/orchestrator/history";
import type { Citation } from "@/types";

const TITLE_MIN_WORDS = 2;
const TITLE_MAX_WORDS = 6;
const MEMORY_MAX_ENTRIES = 40;
const MEMORY_MAX_RAW_CHARS = 1500;
const MEMORY_DECAY_CONFIDENCE = 0.3;
const MEMORY_DECAY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MEMORY_PROFILE_MAX_ENTRIES = 8;
const MEMORY_PROFILE_MIN_SCORE = 0.08;

type UtilityModelSelection = {
  model: string;
  fallbackModels: string[];
};

async function selectUtilityModel(params: {
  actorClerkId: string;
  requiredCapabilities?: Array<"reasoning" | "vision" | "code" | "search" | "image_generation">;
  preferredCapabilities?: Array<"reasoning" | "vision" | "code" | "search" | "image_generation">;
  preferFast?: boolean;
  preferCheap?: boolean;
}): Promise<UtilityModelSelection> {
  const [dbCatalog, runtimeStats, budget] = await Promise.all([
    convexQuery("models:listModels", {
      actorClerkId: params.actorClerkId,
    }).catch(() => [] as Array<Record<string, unknown>>),
    convexQuery("models:listRuntimeStats", {
      actorClerkId: params.actorClerkId,
    }).catch(() => [] as Array<{ modelId: string; successCount: number; failureCount: number; avgLatencyMs?: number }>),
    convexQuery("usage:checkUserBudget", {
      actorClerkId: params.actorClerkId,
    }).catch(() => ({ tier: "normal" as const })),
  ]);
  const liveCatalog = await getLiveCatalogSnapshot({
    fallbackCatalog: dbCatalog as Array<{
      modelId: string;
      name?: string;
      provider?: string;
      description?: string;
      contextLength?: number;
      inputCostPerM?: number;
      outputCostPerM?: number;
      tags?: string[];
      isFree?: boolean;
      costRating?: "low" | "medium" | "high";
      speedRating?: "low" | "medium" | "high";
      reasoningRating?: "low" | "medium" | "high";
      multimodalRating?: "none" | "basic" | "strong";
      capabilities?: {
        reasoning?: number;
        creative?: number;
        code?: number;
        vision?: number;
        speed?: number;
      };
    }>,
  });
  const catalog = liveCatalog.models.length > 0
    ? liveCatalog.models
    : (dbCatalog as Array<{
        modelId: string;
        name?: string;
        provider?: string;
        description?: string;
        contextLength?: number;
        inputCostPerM?: number;
        outputCostPerM?: number;
        tags?: string[];
        isFree?: boolean;
        costRating?: "low" | "medium" | "high";
        speedRating?: "low" | "medium" | "high";
        reasoningRating?: "low" | "medium" | "high";
        multimodalRating?: "none" | "basic" | "strong";
        capabilities?: {
          reasoning?: number;
          creative?: number;
          code?: number;
          vision?: number;
          speed?: number;
        };
      }>);

  const picked = pickModelAndFallbacks({
    catalog: catalog.filter((model) => model.modelId !== "openrouter/auto"),
    tier: (budget as { tier?: "normal" | "expensive_blocked" | "cheap_only" | "free_only" })?.tier ?? "normal",
    requiredCapabilities: params.requiredCapabilities,
    preferredCapabilities: params.preferredCapabilities,
    preferFast: params.preferFast ?? true,
    preferCheap: params.preferCheap ?? true,
    runtimeStats: buildRuntimeStatMap(
      runtimeStats as Array<{ modelId: string; successCount: number; failureCount: number; avgLatencyMs?: number }>,
    ),
    maxFallbacks: 3,
  });

  const model = picked.selected?.modelId ?? "openrouter/auto";
  return {
    model,
    fallbackModels: picked.fallbacks.filter((candidate) => candidate !== model),
  };
}

function canonicalMemoryKey(rawKey: string) {
  const normalized = rawKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "general_note";
  if (/(learning|study)_style|preferred_style/.test(normalized)) return "learning_style";
  if (/weakness|struggle|difficulty/.test(normalized)) return "struggles";
  if (/goal|objective|target/.test(normalized)) return "goals";
  if (/subject.*prefer|favorite_subject|subject_interest/.test(normalized)) return "subject_preferences";
  return normalized;
}

function trimMemoryText(value: string) {
  if (value.length <= MEMORY_MAX_RAW_CHARS) return value;
  return value.slice(0, MEMORY_MAX_RAW_CHARS).trimEnd();
}

export function formatMemory(entries: MemoryEntry[]) {
  if (entries.length === 0) return "";
  const lines: string[] = [];
  let size = 0;
  for (const entry of entries) {
    const line = `- ${entry.key}: ${entry.value}`.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const nextSize = size + line.length + (lines.length > 0 ? 1 : 0);
    if (nextSize > MEMORY_MAX_RAW_CHARS) break;
    lines.push(line);
    size = nextSize;
  }
  return trimMemoryText(lines.join("\n"));
}

export function mergeMemoryEntries(existing: MemoryEntry[], incoming: MemoryEntry[]) {
  const now = Date.now();
  const map = new Map<string, MemoryEntry>();

  const normalizedExisting = existing
    .map((entry) => ({
      key: canonicalMemoryKey(entry.key),
      value: entry.value.replace(/\s+/g, " ").trim(),
      confidence: Math.max(0, Math.min(1, Number(entry.confidence ?? 0.6))),
      extractedAt: Number.isFinite(entry.extractedAt) ? Number(entry.extractedAt) : now,
    }))
    .filter((entry) => entry.value.length > 0)
    .filter((entry) => !(entry.confidence < MEMORY_DECAY_CONFIDENCE && now - entry.extractedAt > MEMORY_DECAY_AGE_MS));

  for (const entry of normalizedExisting) {
    map.set(entry.key, entry);
  }

  for (const rawEntry of incoming) {
    const key = canonicalMemoryKey(rawEntry.key);
    const value = rawEntry.value.replace(/\s+/g, " ").trim();
    if (!value) continue;
    const entry: MemoryEntry = {
      key,
      value,
      confidence: Math.max(0, Math.min(1, Number(rawEntry.confidence ?? 0.6))),
      extractedAt: Number.isFinite(rawEntry.extractedAt) ? Number(rawEntry.extractedAt) : now,
    };
    const previous = map.get(key);
    if (!previous) {
      map.set(key, entry);
      continue;
    }

    const newer = entry.extractedAt >= previous.extractedAt;
    map.set(key, {
      key,
      value: newer ? entry.value : previous.value,
      confidence: Math.max(previous.confidence, entry.confidence),
      extractedAt: Math.max(previous.extractedAt, entry.extractedAt),
    });
  }

  return [...map.values()]
    .sort((a, b) => b.confidence - a.confidence || b.extractedAt - a.extractedAt)
    .slice(0, MEMORY_MAX_ENTRIES);
}

export function shouldInjectMemory(message: string) {
  const normalized = message.toLowerCase();
  return /(i\b|my\b|me\b|struggle|goal|preference|prefer|weakness|improve|last time|again|remember)/i.test(
    normalized,
  );
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function overlapScore(queryTokens: string[], entryTokens: Set<string>) {
  if (queryTokens.length === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (entryTokens.has(token)) overlap += 1;
  }
  return overlap / queryTokens.length;
}

function recencyScore(extractedAt: number) {
  const age = Math.max(0, Date.now() - extractedAt);
  if (age <= 7 * 24 * 60 * 60 * 1000) return 1;
  if (age <= 30 * 24 * 60 * 60 * 1000) return 0.7;
  if (age <= 90 * 24 * 60 * 60 * 1000) return 0.45;
  return 0.2;
}

export function buildRelevantMemoryProfile(params: {
  message: string;
  entries: MemoryEntry[];
  rawMemoryText?: string;
}) {
  const queryTokens = tokenize(params.message);
  if (params.entries.length === 0) {
    return params.rawMemoryText ? params.rawMemoryText.slice(0, MEMORY_MAX_RAW_CHARS) : "";
  }

  const ranked = params.entries
    .map((entry) => {
      const entryTokens = new Set(tokenize(`${entry.key} ${entry.value}`));
      const lexical = overlapScore(queryTokens, entryTokens);
      const confidence = Math.max(0, Math.min(1, Number(entry.confidence ?? 0.5)));
      const recency = recencyScore(entry.extractedAt);
      const score = lexical * 0.58 + confidence * 0.26 + recency * 0.16;
      return { ...entry, score };
    })
    .sort((a, b) => b.score - a.score || b.extractedAt - a.extractedAt);

  const shortlisted = ranked
    .filter((entry, index) => index < 2 || entry.score >= MEMORY_PROFILE_MIN_SCORE)
    .slice(0, MEMORY_PROFILE_MAX_ENTRIES)
    .map((entry) => ({
      key: entry.key,
      value: entry.value,
      confidence: entry.confidence,
      extractedAt: entry.extractedAt,
    }));

  const profile = formatMemory(shortlisted);
  if (profile) return profile;
  return params.rawMemoryText ? params.rawMemoryText.slice(0, MEMORY_MAX_RAW_CHARS) : "";
}

export function inferCitations(
  response: string,
  retrieved: Array<{
    resourceId?: string;
    filename: string;
    page?: number;
    sourceType: "pack" | "personal";
    score?: number;
  }>,
  searchSources: WebSearchSource[],
  attachmentFallback: Citation[] = [],
): Citation[] {
  const fallback = retrieved.map((source) => ({
    resourceId: source.resourceId,
    filename: source.filename,
    page: source.page,
    sourceType: source.sourceType,
    snippet: (source as { text?: string }).text?.slice(0, 220),
  }));

  const inferred = extractCitationsFromText(response, fallback);
  const merged = [...inferred];
  for (const source of searchSources) {
    merged.push({
      filename: source.title || source.domain || source.url,
      sourceType: "search",
      url: source.url,
      title: source.title,
      domain: source.domain,
      snippet: source.snippet,
    });
  }

  const unique = new Map<string, Citation>();
  for (const item of merged) {
    const key = item.sourceType === "search"
      ? `search:${item.url ?? item.filename}`
      : `${item.sourceType}:${item.resourceId ?? ""}:${item.url ?? ""}:${item.filename}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, item);
      continue;
    }
    if (item.sourceType === "search") {
      const next: Citation = { ...existing };
      if (!next.url && item.url) next.url = item.url;
      if (!next.domain && item.domain) next.domain = item.domain;
      if (!next.snippet && item.snippet) next.snippet = item.snippet;
      const existingTitle = next.title || "";
      const incomingTitle = item.title || "";
      if (incomingTitle && incomingTitle.length > existingTitle.length) {
        next.title = incomingTitle;
        next.filename = incomingTitle;
      }
      unique.set(key, next);
      continue;
    }
    if (typeof existing.page !== "number" && typeof item.page === "number") {
      unique.set(key, { ...existing, page: item.page });
    }
  }

  if (unique.size === 0 && attachmentFallback.length > 0) {
    for (const attachment of attachmentFallback) {
      const key = `${attachment.sourceType}:${attachment.resourceId ?? ""}:${attachment.url ?? ""}:${attachment.filename}`;
      if (!unique.has(key)) {
        unique.set(key, attachment);
      }
    }
  }

  return [...unique.values()].slice(0, 8);
}

function normalizeCitationToken(value: string) {
  return value
    .toLowerCase()
    .replace(/§\s*\d+(\.\d+)*/g, " ")
    .replace(/\.[a-z0-9]{2,5}$/i, " ")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove citation markers [N] that do not correspond to any citation in the
 * provided array. Numeric markers whose index (1-based) is out of range are
 * stripped entirely, preventing orphan footnote references in the UI.
 */
export function stripOrphanCitations(text: string, citations: Citation[]): string {
  if (!text) return text;
  if (citations.length === 0) {
    return text.replace(/\[(\d+)\]/g, "");
  }
  const validNums = new Set(citations.map((_, i) => i + 1));
  return text.replace(/\[(\d+)\]/g, (match, numStr) => {
    const num = parseInt(numStr, 10);
    return validNums.has(num) ? match : "";
  });
}

export function rewriteCitationMarkers(response: string, citations: Citation[]) {
  if (!response) return response;

  const rewritten = response
    .replace(/\[([^\]\n]{1,90})\](?!\()/g, (match, rawToken) => {
      const token = String(rawToken ?? "").trim();
      if (!token) return match;
      if (/^\d+(?:\s*,\s*\d+)*$/.test(token)) return "";

      const normalizedToken = normalizeCitationToken(token);
      if (!normalizedToken) return match;

      const matchedCitation = citations.some((citation) => {
        const filename = normalizeCitationToken(citation.filename);
        const title = normalizeCitationToken(citation.title ?? "");
        const domain = normalizeCitationToken(citation.domain ?? "");
        return filename.includes(normalizedToken) || title.includes(normalizedToken) || domain.includes(normalizedToken);
      });

      if (matchedCitation || token.includes("§")) {
        return "";
      }
      return match;
    })
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return rewritten;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function tokenizeWords(value: string) {
  return compactText(value)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 1 || /\d/.test(word));
}

function looksCodeHeavy(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const codeMarkers = (trimmed.match(/[{}()[\];=<>`]/g) ?? []).length;
  const lines = trimmed.split("\n");
  const fenced = /```/.test(trimmed);
  return fenced || codeMarkers >= 8 || lines.filter((line) => /\b(const|let|function|class|import|return)\b/.test(line)).length >= 2;
}

function heuristicTitle(source: string) {
  if (!source.trim()) return "General Study Session";
  if (looksCodeHeavy(source)) return "Code Debugging Session";

  const words = tokenizeWords(source);
  if (words.length >= TITLE_MIN_WORDS) {
    return words.slice(0, TITLE_MAX_WORDS).join(" ");
  }
  if (words.length === 1) {
    return `${words[0]} session`;
  }
  return "General Study";
}

function normalizeTitle(candidate: string, fallbackSource: string) {
  const cleaned = compactText(
    candidate
      .replace(/^title\s*:\s*/i, "")
      .replace(/[\n\r]+/g, " ")
      .replace(/^['"`\s]+|['"`\s]+$/g, ""),
  );

  const words = tokenizeWords(cleaned).slice(0, TITLE_MAX_WORDS);
  const fallbackWords = tokenizeWords(fallbackSource);
  while (words.length < TITLE_MIN_WORDS && fallbackWords.length > 0) {
    const next = fallbackWords.shift();
    if (next) words.push(next);
  }
  while (words.length < TITLE_MIN_WORDS) {
    words.push(["study", "chat", "topic"][words.length % 3]);
  }

  const title = words.slice(0, TITLE_MAX_WORDS).join(" ").slice(0, 80);
  return title || heuristicTitle(fallbackSource);
}

async function generateTitleFromSnippet(source: string, fallbackSource: string, actorClerkId: string) {
  const utility = await selectUtilityModel({
    actorClerkId,
    preferredCapabilities: ["reasoning"],
    preferFast: true,
    preferCheap: true,
  });
  const completion = await withTimeout(
    openRouterChatCompletion({
      model: utility.model,
      fallbackModels: utility.fallbackModels,
      messages: [
        {
          role: "system",
          content:
            "Generate a conversation title in 2 to 6 words. Keep the same language as the user when possible. Return plain title text only with no quotes.",
        },
        {
          role: "user",
          content: source.slice(0, 700),
        },
      ],
      temperature: 0.1,
      maxTokens: 24,
    }),
    4500,
  );

  const raw = completion?.choices?.[0]?.message?.content ?? "";
  if (completion) {
    await recordOpenRouterUsage({
      actorClerkId,
      model: completion.model ?? utility.model,
      usage: completion.usage,
    }).catch(() => {});
  }
  return normalizeTitle(raw, fallbackSource);
}

export async function maybeGenerateTitle(params: {
  chatId: string;
  actorClerkId: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<string | undefined> {
  try {
    const source = `User: ${params.userMessage}\nAssistant: ${params.assistantMessage.slice(0, 260)}`;
    const fallbackSource = compactText(`${params.userMessage} ${params.assistantMessage.slice(0, 180)}`);
    const title = await generateTitleFromSnippet(source, fallbackSource || params.userMessage, params.actorClerkId);

    await convexMutation("chats:setChatTitle", {
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      title,
    });
    return title;
  } catch {
    return undefined;
  }
}

export async function maybeGenerateTitleFromUserPrompt(params: {
  chatId: string;
  actorClerkId: string;
  userMessage: string;
}): Promise<string | undefined> {
  try {
    const fallbackSource = compactText(params.userMessage);
    const title = await generateTitleFromSnippet(
      params.userMessage,
      fallbackSource || heuristicTitle(params.userMessage),
      params.actorClerkId,
    );

    await convexMutation("chats:setChatTitle", {
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      title,
    });
    return title;
  } catch {
    return undefined;
  }
}

export async function maybeExtractMemory(params: {
  actorClerkId: string;
  existingEntries: MemoryEntry[];
  userMessage: string;
  assistantResponse: string;
}): Promise<MemoryEntry[]> {
  const snippet = `User: ${params.userMessage.slice(0, 500)}\nAssistant: ${params.assistantResponse.slice(0, 500)}`;
  const utility = await selectUtilityModel({
    actorClerkId: params.actorClerkId,
    preferredCapabilities: ["reasoning"],
    preferFast: true,
    preferCheap: true,
  });

  const completion = await withTimeout(
    openRouterChatCompletion({
      model: utility.model,
      fallbackModels: utility.fallbackModels,
      messages: [
        {
          role: "system",
          content:
            "Extract durable student facts. Focus on: name, grade/year, school, timezone/location, languages, subjects, goals, weaknesses, interests, study habits, communication preferences, learning style, and personality traits. Return JSON array of {key,value,confidence}. Only include facts likely to help future tutoring.",
        },
        {
          role: "user",
          content: snippet,
        },
      ],
      temperature: 0,
    }),
    5000,
  );

  const now = Date.now();
  const extracted: MemoryEntry[] = [];

  const heuristics = (() => {
    const text = params.userMessage.replace(/\s+/g, " ").trim();
    if (!text) return [] as MemoryEntry[];

    const inferred: MemoryEntry[] = [];
    const patterns: Array<{ key: string; regex: RegExp; confidence: number }> = [
      { key: "goals", regex: /\b(my goal is|i want to|i need to|help me)\b/i, confidence: 0.72 },
      { key: "subject_preferences", regex: /\b(i (love|like|enjoy)|favorite subject|interested in)\b/i, confidence: 0.64 },
      { key: "struggles", regex: /\b(i struggle with|i find .* hard|i'm stuck on|confused about)\b/i, confidence: 0.74 },
      { key: "learning_style", regex: /\b(i prefer|please explain|step by step|simple terms|visual)\b/i, confidence: 0.58 },
      { key: "timezone", regex: /\b(my timezone is|i am in|i'm in|based in|utc[+-]?\d{1,2})\b/i, confidence: 0.66 },
      { key: "language", regex: /\b(i speak|my language is|please answer in|respond in)\b/i, confidence: 0.65 },
      { key: "identity", regex: /\b(i am|i'm)\b.{0,48}\b(student|teacher|grade|year|college|university)\b/i, confidence: 0.67 },
      { key: "communication_style", regex: /\b(be concise|short answers|detailed answers|more detail|less detail)\b/i, confidence: 0.62 },
      { key: "memory_updates", regex: /\b(update my memory|remember this|save this|from now on)\b/i, confidence: 0.78 },
    ];

    for (const pattern of patterns) {
      if (!pattern.regex.test(text)) continue;
      inferred.push({
        key: pattern.key,
        value: text.slice(0, 200),
        confidence: pattern.confidence,
        extractedAt: now,
      });
    }
    return inferred.slice(0, 4);
  })();
  extracted.push(...heuristics);

  if (completion) {
    await recordOpenRouterUsage({
      actorClerkId: params.actorClerkId,
      model: completion.model ?? utility.model,
      usage: completion.usage,
    }).catch(() => {});
    const raw = completion.choices?.[0]?.message?.content ?? "[]";
    const jsonMatch = raw.match(/\[[\s\S]*\]/) ?? raw.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as
          | Array<{ key?: string; value?: string; confidence?: number }>
          | { key?: string; value?: string; confidence?: number };
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        extracted.push(
          ...entries
            .filter((entry) => typeof entry.key === "string" && typeof entry.value === "string")
            .slice(0, 8)
            .map((entry) => ({
              key: String(entry.key),
              value: String(entry.value),
              confidence: Math.max(0, Math.min(1, Number(entry.confidence ?? 0.6))),
              extractedAt: now,
            })),
        );
      } catch {
        // Fallback to heuristic extraction only.
      }
    }
  }

  if (extracted.length === 0) return [];

  const merged = mergeMemoryEntries(params.existingEntries, extracted);
  const rawSnippet = trimMemoryText(
    [
      "Recent conversation snippet:",
      snippet,
      "",
      "Merged memory:",
      formatMemory(merged),
    ].join("\n"),
  );
  await convexMutation("memory:upsertUserMemory", {
    actorClerkId: params.actorClerkId,
    entries: merged,
    rawMemoryText: rawSnippet,
  });

  return extracted;
}
