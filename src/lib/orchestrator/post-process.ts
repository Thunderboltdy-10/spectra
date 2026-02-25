import { convexMutation } from "@/lib/convex-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { extractCitationsFromText } from "@/lib/orchestrator/compose";
import type { WebSearchSource } from "@/lib/orchestrator/retrieval";
import { withTimeout, type MemoryEntry } from "@/lib/orchestrator/history";
import type { Citation } from "@/types";

const TITLE_MIN_WORDS = 2;
const TITLE_MAX_WORDS = 5;
const MEMORY_MAX_ENTRIES = 20;
const MEMORY_MAX_RAW_CHARS = 1500;
const MEMORY_DECAY_CONFIDENCE = 0.3;
const MEMORY_DECAY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
    .filter(Boolean);
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

async function generateTitleFromSnippet(source: string, fallbackSource: string) {
  const completion = await withTimeout(
    openRouterChatCompletion({
      model: MODEL_CONFIG.glmAir,
      fallbackModels: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker],
      messages: [
        {
          role: "system",
          content:
            "Generate a conversation title in 2 to 5 words. Keep the same language as the user when possible. Return plain title text only with no quotes.",
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
    const title = await generateTitleFromSnippet(source, fallbackSource || params.userMessage);

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
    const title = await generateTitleFromSnippet(params.userMessage, fallbackSource || heuristicTitle(params.userMessage));

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
}) {
  const snippet = `User: ${params.userMessage.slice(0, 500)}\nAssistant: ${params.assistantResponse.slice(0, 500)}`;

  const completion = await withTimeout(
    openRouterChatCompletion({
      model: MODEL_CONFIG.tutorFast,
      fallbackModels: [MODEL_CONFIG.marker],
      messages: [
        {
          role: "system",
          content:
            "Extract durable facts about this student: learning level, subject preferences, struggles, study style, goals. Return JSON array of {key,value,confidence}. Only include persistent facts.",
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

  if (!completion) return;

  const raw = completion.choices?.[0]?.message?.content ?? "[]";
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ key?: string; value?: string; confidence?: number }>;
    const now = Date.now();
    const extracted: MemoryEntry[] = parsed
      .filter((entry) => typeof entry.key === "string" && typeof entry.value === "string")
      .slice(0, 8)
      .map((entry) => ({
        key: String(entry.key),
        value: String(entry.value),
        confidence: Math.max(0, Math.min(1, Number(entry.confidence ?? 0.6))),
        extractedAt: now,
      }));

    const merged = mergeMemoryEntries(params.existingEntries, extracted);
    await convexMutation("memory:upsertUserMemory", {
      actorClerkId: params.actorClerkId,
      entries: merged,
      rawMemoryText: formatMemory(merged),
    });
  } catch {
    // Ignore malformed model output.
  }
}
